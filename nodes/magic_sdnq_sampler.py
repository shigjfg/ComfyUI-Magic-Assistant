"""
Magic SDNQ K Sampler - SDNQ K 采样器

可连接的 K 采样器：接入 model、正负面条件、latent，输出 latent。
支持 SDNQ 模型（diffusers pipeline）与可选「SDNQ + KSampler」模式兼容其他模型。
"""

import math
import os
import sys
import torch
import torch.nn.functional as F
from typing import Tuple, Optional

_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

try:
    import comfy.model_management
    import comfy.utils
    import latent_preview
    from comfy.cli_args import args as comfy_args, LatentPreviewMethod
    import server
    from protocol import BinaryEventTypes
    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False
    server = None
    BinaryEventTypes = None
    comfy = None
    latent_preview = None
    LatentPreviewMethod = None
    comfy_args = None

# 调度器列表：与 comfyui-sdnq 源文件一致
# Flow-based: FLUX/SD3/Qwen/Z-Image | Traditional: SDXL/SD1.5
SCHEDULER_LIST = [
    "FlowMatchEulerDiscreteScheduler",
    "DPMSolverMultistepScheduler",
    "UniPCMultistepScheduler",
    "EulerDiscreteScheduler",
    "EulerAncestralDiscreteScheduler",
    "DDIMScheduler",
    "HeunDiscreteScheduler",
    "KDPM2DiscreteScheduler",
    "KDPM2AncestralDiscreteScheduler",
    "DPMSolverSinglestepScheduler",
    "DEISMultistepScheduler",
    "LMSDiscreteScheduler",
    "DDPMScheduler",
    "PNDMScheduler",
]

_scheduler_map = None

def _get_scheduler_map():
    global _scheduler_map
    if _scheduler_map is None:
        from diffusers.schedulers import (
            FlowMatchEulerDiscreteScheduler,
            DPMSolverMultistepScheduler,
            UniPCMultistepScheduler,
            EulerDiscreteScheduler,
            EulerAncestralDiscreteScheduler,
            DDIMScheduler,
            HeunDiscreteScheduler,
            KDPM2DiscreteScheduler,
            KDPM2AncestralDiscreteScheduler,
            DPMSolverSinglestepScheduler,
            DEISMultistepScheduler,
            LMSDiscreteScheduler,
            DDPMScheduler,
            PNDMScheduler,
        )
        _scheduler_map = {
            "FlowMatchEulerDiscreteScheduler": FlowMatchEulerDiscreteScheduler,
            "DPMSolverMultistepScheduler": DPMSolverMultistepScheduler,
            "UniPCMultistepScheduler": UniPCMultistepScheduler,
            "EulerDiscreteScheduler": EulerDiscreteScheduler,
            "EulerAncestralDiscreteScheduler": EulerAncestralDiscreteScheduler,
            "DDIMScheduler": DDIMScheduler,
            "HeunDiscreteScheduler": HeunDiscreteScheduler,
            "KDPM2DiscreteScheduler": KDPM2DiscreteScheduler,
            "KDPM2AncestralDiscreteScheduler": KDPM2AncestralDiscreteScheduler,
            "DPMSolverSinglestepScheduler": DPMSolverSinglestepScheduler,
            "DEISMultistepScheduler": DEISMultistepScheduler,
            "LMSDiscreteScheduler": LMSDiscreteScheduler,
            "DDPMScheduler": DDPMScheduler,
            "PNDMScheduler": PNDMScheduler,
        }
    return _scheduler_map


def _extract_embeddings_from_cond(cond) -> Tuple[Optional[torch.Tensor], Optional[torch.Tensor]]:
    """从 ComfyUI conditioning 提取 prompt_embeds 和 pooled_output"""
    if not cond or len(cond) == 0:
        return None, None
    first = cond[0]
    if not isinstance(first, (list, tuple)) or len(first) < 2:
        return None, None
    embeds = first[0]
    info = first[1] if isinstance(first[1], dict) else {}
    pooled = info.get("pooled_output")
    if isinstance(embeds, torch.Tensor):
        return embeds, pooled
    return None, None


def _extract_reference_latents_from_cond(cond) -> list:
    """从 ComfyUI conditioning 提取 reference_latents（用于 Flux2Klein 图像编辑）
    ReferenceLatent 节点会将 VAE 编码的 latent 注入 conditioning 的 reference_latents 键。
    """
    refs = []
    if not cond:
        return refs
    for item in cond:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        info = item[1] if isinstance(item[1], dict) else {}
        rl = info.get("reference_latents")
        if rl and isinstance(rl, (list, tuple)):
            for t in rl:
                if isinstance(t, torch.Tensor):
                    refs.append(t)
    return refs


def _ref_latents_to_pil_list(ref_latents: list, pipeline) -> list:
    """将 reference_latents（VAE latent）解码为 PIL 图像列表，供 diffusers pipeline 的 image 参数使用"""
    out = []
    if not ref_latents or not hasattr(pipeline, "vae") or pipeline.vae is None:
        return out
    try:
        import numpy as np
        from PIL import Image
        # 与 diffusers pipeline 一致：Flux2 用 BN，Flux/SD3 用 (latents/scale)+shift，SD/SDXL 用 latents/scale
        if hasattr(pipeline.vae, "bn") and pipeline.vae.bn is not None:
            sf, shift = 1.0, 0.0
        else:
            cfg = pipeline.vae.config
            sf = getattr(cfg, "scaling_factor", None) or (cfg.get("scaling_factor") if hasattr(cfg, "get") else None) or 0.18215
            shift = getattr(cfg, "shift_factor", None) or (cfg.get("shift_factor") if hasattr(cfg, "get") else None) or 0.0
        vae_dev = getattr(pipeline, "_execution_device", None) or ("cuda" if torch.cuda.is_available() else "cpu")
        vae_dtype = next(pipeline.vae.parameters()).dtype
        for lat in ref_latents:
            if not isinstance(lat, torch.Tensor):
                continue
            lat_in = lat.unsqueeze(0) if lat.dim() == 3 else lat
            lat_in = lat_in.to(device=vae_dev, dtype=vae_dtype)
            with torch.no_grad():
                vae_in = (lat_in / sf) + shift
                dec = pipeline.vae.decode(vae_in).sample
            arr = (dec[0].cpu().float().permute(1, 2, 0).numpy() * 0.5 + 0.5).clip(0, 1)
            arr = (arr * 255).astype(np.uint8)
            out.append(Image.fromarray(arr).convert("RGB"))
    except Exception as e:
        print(f"[SDNQ K Sampler] reference_latents 解码失败: {e}")
    return out


def _swap_scheduler(pipeline, scheduler_name: str):
    m = _get_scheduler_map()
    if scheduler_name not in m:
        raise ValueError(f"Unknown scheduler: {scheduler_name}")
    pipeline.scheduler = m[scheduler_name].from_config(pipeline.scheduler.config)


def _align_dim(dim: int, multiple: int) -> int:
    return (dim // multiple) * multiple


# ---------------------------------------------------------------------------
#  Inpaint 辅助：将 ComfyUI 的 noise_mask 适配到 diffusers pipeline 的 latent 空间
# ---------------------------------------------------------------------------

def _adapt_mask_to_latent(noise_mask: torch.Tensor, latent_shape, pipeline, height_px: int, width_px: int) -> torch.Tensor:
    """将 noise_mask (B,1,H_mask,W_mask) 适配到 pipeline 内部的 latent 形状。

    - 4D latent (B,C,H,W) → 缩放 mask 到 (B,1,H,W)，广播到 C 通道
    - 3D packed latent (B, seq_len, C) → 缩放 mask 到 latent 分辨率后 flatten 为 (B, seq_len, 1)

    返回值与 latent 维度一致，值域 [0,1]，1 = 重绘区。
    """
    if latent_shape is None:
        return noise_mask

    # 确保 mask 为 4D (B, 1, H, W)
    if noise_mask.dim() == 3:
        noise_mask = noise_mask.unsqueeze(1)
    if noise_mask.dim() == 2:
        noise_mask = noise_mask.unsqueeze(0).unsqueeze(0)

    if len(latent_shape) == 4:
        # 标准 4D latent: (B, C, H, W)  — SDXL / GLM 等
        h_lat, w_lat = latent_shape[2], latent_shape[3]
        mask = F.interpolate(noise_mask.float(), size=(h_lat, w_lat), mode="nearest")
        return mask  # (B, 1, h_lat, w_lat)  — 广播到 C 维度

    elif len(latent_shape) == 3:
        # Flux packed 3D latent: (B, seq_len, C)
        B_lat, seq_len, C = latent_shape
        vae_sf = getattr(pipeline, "vae_scale_factor", 16)
        # 计算 latent 空间的 h, w
        h_lat = max(1, height_px // vae_sf)
        w_lat = max(1, width_px // vae_sf)
        # Flux 的 packing: 把 (h_lat, w_lat) 的每 2x2 patch 合为一个 token
        # 所以 seq_len = (h_lat // 2) * (w_lat // 2)
        h_tok = max(1, h_lat // 2)
        w_tok = max(1, w_lat // 2)
        expected_seq = h_tok * w_tok
        # 自适应修正：如果 expected 和实际 seq_len 不一致，推算真实 h_tok/w_tok
        if expected_seq != seq_len:
            aspect = width_px / max(height_px, 1)
            w_tok = max(1, int(math.sqrt(seq_len * aspect)))
            h_tok = max(1, seq_len // w_tok)
            if h_tok * w_tok != seq_len:
                # 暴力搜索最接近的分解
                for wt in range(w_tok, 0, -1):
                    if seq_len % wt == 0:
                        w_tok = wt
                        h_tok = seq_len // wt
                        break
        # 缩放 mask 到 token 分辨率
        mask = F.interpolate(noise_mask.float(), size=(h_tok, w_tok), mode="nearest")
        # flatten: (B, 1, h_tok, w_tok) → (B, h_tok*w_tok, 1)
        mask = mask.reshape(mask.shape[0], 1, -1).permute(0, 2, 1)  # (B, seq_len, 1)
        return mask

    # 未知格式：返回原始 mask
    return noise_mask


def _scale_noise_for_inpaint(scheduler, original_latents, noise, timestep):
    """给原图 latent 按当前 timestep 加噪。优先使用 scheduler.scale_noise，fallback 到手动加噪。"""
    if hasattr(scheduler, "scale_noise") and callable(scheduler.scale_noise):
        try:
            return scheduler.scale_noise(original_latents, torch.tensor([timestep]), noise)
        except Exception:
            pass
    # Fallback: flow matching 手动加噪  noise_scaling: x = (1 - sigma) * x + sigma * noise
    # 对于 FlowMatch scheduler，timestep/1000 ≈ sigma
    sigma = timestep / 1000.0
    if isinstance(sigma, torch.Tensor):
        # reshape for broadcasting
        while sigma.dim() < original_latents.dim():
            sigma = sigma.unsqueeze(-1)
    return (1.0 - sigma) * original_latents + sigma * noise


class MagicSDNQSampler:
    """SDNQ K 采样器：model + 正负面条件 + latent → latent
    
    支持两种采样模式：
    - SDNQ：仅支持 SDNQ 模型（diffusers pipeline），使用 SDNQ 专用采样逻辑
    - SDNQ + KSampler：自动判定模型类型，SDNQ 模型走 SDNQ 逻辑，其他模型走 ComfyUI 官方 KSampler 逻辑
    """

    @classmethod
    def INPUT_TYPES(cls):
        # 官方 KSampler 的采样器和调度器列表（用于兼容模式）
        try:
            import comfy.samplers as _cs
            _comfy_samplers = _cs.KSampler.SAMPLERS
            _comfy_schedulers = _cs.KSampler.SCHEDULERS
        except Exception:
            _comfy_samplers = ["euler"]
            _comfy_schedulers = ["normal"]

        return {
            "required": {
                "model": ("MODEL", {"tooltip": "来自 Magic SDNQ Loader、LoRA Loader 或其他模型加载器"}),
                "positive": ("CONDITIONING", {"tooltip": "正面条件"}),
                "negative": ("CONDITIONING", {"tooltip": "负面条件"}),
                "latent": ("LATENT", {"tooltip": "空 latent"}),
                "seed": ("INT", {"default": 0, "min": -1, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "steps": ("INT", {"default": 25, "min": 1, "max": 150}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 30.0, "step": 0.1}),
                "scheduler": (SCHEDULER_LIST, {"default": "FlowMatchEulerDiscreteScheduler", "tooltip": "SDNQ 模式的调度器。FLUX/SD3/Qwen 用 FlowMatch; SDXL/SD1.5 用 DPMSolver/Euler"}),
                "降噪": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "预览方式": (
                    ["auto", "latent2rgb", "taesd", "none"],
                    {"default": "auto", "tooltip": "auto=自动, latent2rgb=快, taesd=慢但更清晰, none=不预览"}
                ),
                "采样模式": (
                    ["SDNQ", "SDNQ + KSampler"],
                    {"default": "SDNQ", "tooltip": "SDNQ=仅支持 SDNQ 模型; SDNQ + KSampler=同时兼容其他模型（自动判定）"}
                ),
            },
            "optional": {
                "sampler_name": (_comfy_samplers, {"default": "euler", "tooltip": "官方 KSampler 的采样器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）"}),
                "comfy_scheduler": (_comfy_schedulers, {"default": "normal", "tooltip": "官方 KSampler 的调度器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）"}),
            },
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "sample"
    CATEGORY = "✨ Magic Assistant"

    def sample(
        self,
        model,
        positive,
        negative,
        latent,
        seed: int,
        steps: int,
        cfg: float,
        scheduler: str,
        降噪: float,
        预览方式: str,
        采样模式: str = "SDNQ",
        sampler_name: str = "euler",
        comfy_scheduler: str = "normal",
        prompt=None,
        unique_id=None,
    ) -> Tuple:
        # ========== 模型类型判定 ==========
        pipeline = None
        if hasattr(model, "get_pipeline"):
            pipeline = model.get_pipeline()

        is_sdnq = pipeline is not None

        if not is_sdnq:
            if 采样模式 == "SDNQ":
                raise RuntimeError(
                    "当前采样模式为「SDNQ」，但接入的不是 SDNQ 模型。\n"
                    "请使用 Magic SDNQ Loader 加载模型，或将采样模式切换为「SDNQ + KSampler」以兼容其他模型。"
                )
            # ========== 非 SDNQ 模型 → 调用 ComfyUI 官方 KSampler ==========
            print(f"\n{'='*50}")
            print(f"[Magic Sampler] 非 SDNQ 模型 → 使用 ComfyUI KSampler")
            print(f"{'='*50}")
            print(f"  Sampler: {sampler_name}, Scheduler: {comfy_scheduler}")
            print(f"  Steps: {steps}, CFG: {cfg}, Denoise: {降噪}")
            print(f"  Seed: {seed}")
            print(f"{'='*50}\n")
            from nodes import common_ksampler
            return common_ksampler(
                model, seed, steps, cfg,
                sampler_name, comfy_scheduler,
                positive, negative, latent,
                denoise=降噪,
            )

        # 接入 ComfyUI 显存管理：采样前让 load_models_gpu 腾出空间并加载本模型，减少 12GB 下 OOM
        if COMFYUI_AVAILABLE and hasattr(model, "model_size") and hasattr(model, "load_device"):
            try:
                mem_model = model.model_size()
                inference_mem = (
                    comfy.model_management.minimum_inference_memory()
                    if hasattr(comfy.model_management, "minimum_inference_memory")
                    else 1024 * 1024 * 1024
                )
                if callable(inference_mem):
                    inference_mem = inference_mem()
                memory_required = mem_model + int(inference_mem)
                minimum_memory_required = mem_model + max(200 * 1024 * 1024, int(inference_mem * 0.5))
                comfy.model_management.load_models_gpu(
                    [model],
                    memory_required=memory_required,
                    minimum_memory_required=minimum_memory_required,
                )
            except Exception as e:
                print(f"[SDNQ K Sampler] load_models_gpu 跳过（将直接使用当前显存）: {e}")

        # 提取 conditioning
        prompt_embeds, pooled_embeds = _extract_embeddings_from_cond(positive)
        neg_embeds, neg_pooled = _extract_embeddings_from_cond(negative)

        if prompt_embeds is None:
            raise RuntimeError("请连接 CLIP 文本编码到 positive 输入")

        # 图像编辑：从 conditioning 的 reference_latents 解码参考图
        ref_pil = None
        ref_latents = _extract_reference_latents_from_cond(positive)
        if ref_latents:
            ref_pil_list = _ref_latents_to_pil_list(ref_latents, pipeline)
            ref_pil = ref_pil_list[0] if len(ref_pil_list) == 1 else (ref_pil_list if ref_pil_list else None)

        # latent 尺寸（用于 width/height）
        # 图像编辑时使用参考图尺寸；否则用 latent 推算
        samples = latent["samples"]
        noise_mask_raw = latent.get("noise_mask", None)  # 局部重绘 mask（来自 SetLatentNoiseMask / VAEEncodeForInpaint）
        batch, channels, h, w = samples.shape
        pipeline_name = type(pipeline).__name__
        _pname_lower = pipeline_name.lower()
        flux2klein = "flux2klein" in _pname_lower  # Flux2Klein 特殊处理（如跳过 negative_prompt）
        is_qwen_image = "qwen" in _pname_lower and "image" in _pname_lower  # QwenImage 使用 true_cfg_scale
        # 有 _pack_latents 的 pipeline（Flux/Flux2/QwenImage/ZImage/Chroma）的 prepare_latents
        # 内部会把 height/width 除以 vae_scale_factor*2 再除以 2，导致输出仅为传入值的一半。
        # 所以对这类 pipeline，传入 pipeline 的值需要 *2 补偿。
        _has_pack = hasattr(pipeline, "_pack_latents") and callable(getattr(pipeline, "_pack_latents", None))
        # 图像尺寸对齐：pack 系列对齐 16（vae_scale_factor * 2），其他 8
        dim_mult = 16 if _has_pack else 8
        if ref_pil is not None:
            # 有参考图（图编辑/inpaint）：以原图尺寸为准
            first_ref = ref_pil[0] if isinstance(ref_pil, list) else ref_pil
            src_w, src_h = first_ref.size
            width = max(8, _align_dim(src_w, dim_mult))
            height = max(8, _align_dim(src_h, dim_mult))
        else:
            # 文生图：从 latent 形状推算（ComfyUI latent 统一 h/8, w/8）
            width = max(8, _align_dim(w * 8, dim_mult))
            height = max(8, _align_dim(h * 8, dim_mult))

        _swap_scheduler(pipeline, scheduler)

        # 首次采样时应用 torch.compile（在 LoRA 已加载之后，与 comfyui-sdnq 顺序一致）
        if getattr(pipeline, "_sdnq_use_torch_compile", False) and torch.cuda.is_available():
            if not getattr(pipeline, "_sdnq_transformer_compiled", False):
                try:
                    print("[SDNQ K Sampler] Applying torch.compile (first run will compile ~30-60s)...")
                    if hasattr(pipeline, "transformer") and pipeline.transformer is not None:
                        t = pipeline.transformer
                        try:
                            t.to(memory_format=torch.channels_last)
                        except Exception:
                            pass
                        pipeline.transformer = torch.compile(t, mode="max-autotune-no-cudagraphs", fullgraph=False)
                        pipeline._sdnq_transformer_compiled = True
                        print("[SDNQ K Sampler] ✓ torch.compile applied (warmup on first generation)")
                    elif hasattr(pipeline, "unet") and pipeline.unet is not None:
                        u = pipeline.unet
                        try:
                            u.to(memory_format=torch.channels_last)
                        except Exception:
                            pass
                        pipeline.unet = torch.compile(u, mode="max-autotune-no-cudagraphs", fullgraph=False)
                        pipeline._sdnq_transformer_compiled = True
                        print("[SDNQ K Sampler] ✓ torch.compile applied (warmup on first generation)")
                except Exception as e:
                    print(f"[SDNQ K Sampler] ⚠️ torch.compile failed (continuing without): {e}")
                    pipeline._sdnq_use_torch_compile = False

        actual_seed = seed if seed >= 0 else torch.randint(0, 2**32, (1,)).item()
        generator = torch.Generator(device="cpu").manual_seed(actual_seed)

        # ----- 局部重绘（Inpaint）数据准备 -----
        # noise_mask_raw: 来自 SetLatentNoiseMask / VAEEncodeForInpaint，1=重绘区，0=保留区
        #
        # 策略分两类：
        #   A) 4D latent 模型（SD/SDXL/GLM 等）：noise latent 和 image latent 在同一空间，
        #      可以在 on_step_end 做逐步 latent-space mask blending（对齐 ComfyUI KSamplerX0Inpaint）
        #   B) 3D packed latent 模型（Flux/Flux2/Flux2Klein/QwenImage/ZImage/Chroma 等）：
        #      noise latent 和 image latent 分辨率不同（例如 noise=1014 tokens vs image=4056 tokens），
        #      latent-space blending 不可行。改为在 pipeline 输出后做像素空间 mask composite。
        inpaint_active = noise_mask_raw is not None
        _inpaint_state = {
            "mask": None,           # 适配到 pipeline latent 空间的 mask（仅 4D 模型使用）
            "original_latents": None,  # 原图 latent（仅 4D 模型使用）
            "noise": None,          # 噪声（仅 4D 模型使用）
            "use_pixel_composite": False,  # 3D packed latent 模型走像素空间 composite
            "initialized": False,
        }

        is_image_edit = ref_pil is not None
        is_inpaint = inpaint_active
        mode_str = "inpaint" if is_inpaint else ("image-to-image" if is_image_edit else "text-to-image")
        print(f"\n{'='*50}")
        print(f"[SDNQ K Sampler] Generating ({mode_str})")
        print(f"{'='*50}")
        print(f"  Pipeline: {pipeline_name}")
        print(f"  Size: {width}x{height} (aligned to {dim_mult})")
        if width * height > 1500 * 1500:
            print(f"  ⚠️ 分辨率较大，生成耗时较长，可尝试降低分辨率以加快速度")
        print(f"  Steps: {steps}, CFG: {cfg}, Scheduler: {scheduler}")
        print(f"  Seed: {actual_seed}")
        if flux2klein:
            print("  [Flux2Klein] negative_prompt not supported (Qwen3 T5)")
        if is_image_edit:
            print("  [Image Edit] 使用参考图像进行编辑")
        if is_inpaint:
            print("  [Inpaint] 局部重绘模式（noise_mask 已连接）")
        print(f"{'='*50}\n")

        # 降噪影响步数
        effective_steps = max(1, int(steps * 降噪))

        # latent 预览：与官方 K 采样器一致，使用 latent_preview.prepare_callback
        preview_method_map = {
            "auto": LatentPreviewMethod.Auto,
            "latent2rgb": LatentPreviewMethod.Latent2RGB,
            "taesd": LatentPreviewMethod.TAESD,
            "none": LatentPreviewMethod.NoPreviews,
        }
        comfy_callback = None
        progress_bar = None
        if COMFYUI_AVAILABLE and 预览方式 != "none" and latent_preview and LatentPreviewMethod and comfy_args:
            try:
                latent_format = model.get_model_object("latent_format") if hasattr(model, "get_model_object") else None
                if latent_format is not None:
                    load_device = getattr(model, "load_device", torch.device("cuda" if torch.cuda.is_available() else "cpu"))
                    if hasattr(load_device, "type") and load_device.type == "cpu" and torch.cuda.is_available():
                        load_device = torch.device("cuda")
                    target_method = preview_method_map.get(预览方式, LatentPreviewMethod.Auto)
                    old_method = comfy_args.preview_method
                    comfy_args.preview_method = target_method
                    try:
                        # 构造 prepare_callback 所需的 model 接口（需 load_device 与 model.latent_format）
                        _adapter = type("_PreviewModel", (), {
                            "load_device": load_device,
                            "model": type("_LF", (), {"latent_format": latent_format})(),
                        })()
                        comfy_callback = latent_preview.prepare_callback(_adapter, effective_steps)
                    finally:
                        comfy_args.preview_method = old_method
            except Exception:
                pass
        if COMFYUI_AVAILABLE:
            try:
                progress_bar = comfy.utils.ProgressBar(effective_steps, node_id=unique_id)
            except Exception:
                progress_bar = None

        # 传给 pipeline 的实际 height/width（packed pipeline 需要 *2 补偿）
        _pipe_height = height * 2 if _has_pack else height
        _pipe_width = width * 2 if _has_pack else width

        def _unpack_latent_for_preview(lat, pipe, h_px, w_px):
            """将 callback 的 latents 转为 (B, C, H, W) 供预览。自动适配：
            - 4D latent (SD/SDXL/Qwen/Z-Image/GLM 等): 直接返回
            - 3D packed latent (Flux/Flux2/Chroma 等): 尝试 pipeline unpack，回退到通用 reshape
            - 含 BN 的 VAE (Flux2 系列): 自动做 BN 反归一化"""
            if lat is None:
                return None
            if lat.dim() == 4:
                return lat  # 4D latent 模型，已是正确格式
            if lat.dim() != 3:
                return None
            vae_sf = getattr(pipe, "vae_scale_factor", 16)
            # 优先使用 pipeline 自带的 unpack（Flux1 等）
            if hasattr(pipe, "_unpack_latents") and callable(getattr(pipe, "_unpack_latents")):
                try:
                    return pipe._unpack_latents(lat, h_px, w_px, vae_sf)
                except Exception:
                    pass
            # 通用 3D packed → 4D: (B, seq_len, C) → (B, C, H, W)
            num_patches = lat.shape[1]
            h_lat = max(1, h_px // (vae_sf * 2))
            w_lat = max(1, w_px // (vae_sf * 2))
            if num_patches != h_lat * w_lat:
                import math
                w_lat = max(1, int(math.sqrt(num_patches * w_px / h_px)))
                h_lat = max(1, num_patches // w_lat)
            if num_patches != h_lat * w_lat:
                return None
            out = lat.permute(0, 2, 1).reshape(lat.shape[0], -1, h_lat, w_lat)
            # 含 BN 的 VAE（Flux2 系列）：在 unpack 后需要 BN 反归一化
            if hasattr(pipe, "vae") and pipe.vae is not None and hasattr(pipe.vae, "bn") and pipe.vae.bn is not None:
                bn = pipe.vae.bn
                eps = getattr(pipe.vae.config, "batch_norm_eps", 1e-5)
                mean = bn.running_mean.view(1, -1, 1, 1).to(out.device, out.dtype)
                std = torch.sqrt(bn.running_var.view(1, -1, 1, 1) + eps).to(out.device, out.dtype)
                out = out * std + mean
            return out

        def _compute_denoised_for_preview(prev_sample, noise_pred, pipe, step_index):
            """从 prev_sample + noise_pred 计算 denoised (x0)，与 K 采样器一致。失败则返回 None 回退到 latents"""
            if prev_sample is None or noise_pred is None:
                return None
            try:
                sched = getattr(pipe, "scheduler", None)
                if sched is None or not hasattr(sched, "sigmas"):
                    return None
                sigmas = sched.sigmas
                n = len(sigmas)
                idx = min(step_index, max(0, n - 2))
                sigma_hat = sigmas[idx].to(prev_sample.device, prev_sample.dtype)
                if idx + 1 < n:
                    sigma_next = sigmas[idx + 1].to(prev_sample.device, prev_sample.dtype)
                    dt = sigma_next - sigma_hat
                else:
                    dt = sigma_hat * 0.0
                sched_name = type(sched).__name__
                if "FlowMatch" in sched_name or "Flow" in sched_name:
                    sample = prev_sample - dt * noise_pred
                    denoised = sample - sigma_hat * noise_pred
                elif "Euler" in sched_name or "DPMSolver" in sched_name or "DDIM" in sched_name or "UniPC" in sched_name:
                    sigma_plus_dt = sigma_hat + dt
                    denoised = prev_sample - noise_pred * sigma_plus_dt
                else:
                    return None
                return denoised
            except Exception:
                return None

        def on_step_end(pipe, step_index, timestep, callback_kwargs):
            # ---------- 局部重绘：逐步 mask 混合 ----------
            # 策略分两类（基于 latent 维度自动判断，不依赖 pipeline 名称）：
            #   A) 4D latent (B,C,H,W)：SDXL/GLM 等，latent-space mask blending
            #   B) 3D packed latent (B,seq,C)：Flux/Flux2/QwenImage/ZImage/Chroma 等，像素空间 composite
            #
            # 原因：3D packed latent 模型的 noise latent 和 image latent 处于不同的
            # 分辨率空间（例如 noise=1014 tokens vs image=4056 tokens），
            # image_latents 作为 conditioning tokens concat，不在同一空间内。
            if inpaint_active and "latents" in callback_kwargs:
                latents = callback_kwargs["latents"]
                # 延迟初始化
                if not _inpaint_state["initialized"]:
                    lat_shape = latents.shape
                    lat_device = latents.device
                    lat_dtype = latents.dtype

                    # 基于 latent 维度判断策略：3D packed → 像素空间 composite
                    is_packed_3d = (latents.dim() == 3)
                    _inpaint_state["use_pixel_composite"] = is_packed_3d

                    if is_packed_3d:
                        # 3D packed latent：跳过 latent-space blending，标记为已初始化
                        _inpaint_state["initialized"] = True
                        print(f"  [Inpaint] 3D packed latent 检测（{type(pipe).__name__}）：跳过 latent-space blending，将在像素空间做 mask composite")
                    else:
                        # 4D latent 模型：初始化 mask 和 original latent 用于逐步 blending
                        _inpaint_state["mask"] = _adapt_mask_to_latent(
                            noise_mask_raw, lat_shape, pipe, height, width
                        ).to(device=lat_device, dtype=lat_dtype)

                        # 准备原图 latent
                        orig_lat = None
                        if ref_pil is not None and hasattr(pipe, "vae") and pipe.vae is not None:
                            try:
                                import numpy as np
                                from PIL import Image as PILImage
                                first_ref = ref_pil[0] if isinstance(ref_pil, list) else ref_pil
                                if first_ref.size != (width, height):
                                    first_ref = first_ref.resize((width, height), PILImage.LANCZOS)
                                arr = np.array(first_ref).astype(np.float32) / 255.0
                                img_t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
                                img_t = img_t.to(device=lat_device, dtype=lat_dtype) * 2.0 - 1.0
                                with torch.no_grad():
                                    enc_output = pipe.vae.encode(img_t)
                                    if hasattr(enc_output, "latent_dist"):
                                        orig_lat = enc_output.latent_dist.mode()
                                    elif hasattr(enc_output, "latents"):
                                        orig_lat = enc_output.latents
                                    else:
                                        orig_lat = enc_output.sample
                                print(f"  [Inpaint] 4D latent VAE encode: {orig_lat.shape}")
                            except Exception as e:
                                print(f"  [Inpaint] VAE encode 参考图失败: {e}")
                                orig_lat = None

                        if orig_lat is None:
                            orig_lat = samples.to(device=lat_device, dtype=lat_dtype)
                            print(f"  [Inpaint] 使用 ComfyUI samples: {orig_lat.shape}")

                        # shape 校验
                        if orig_lat.shape != latents.shape:
                            print(f"  [Inpaint] ⚠️ 4D shape 不匹配: original={orig_lat.shape} vs latent={latents.shape}")
                            if orig_lat.dim() == 4 and latents.dim() == 4:
                                orig_lat = F.interpolate(orig_lat, size=latents.shape[2:], mode="bilinear", align_corners=False)

                        _inpaint_state["original_latents"] = orig_lat
                        _inpaint_state["noise"] = torch.randn_like(orig_lat)
                        _inpaint_state["initialized"] = True
                        print(f"  [Inpaint] 4D 模型初始化完成: mask={_inpaint_state['mask'].shape}, "
                              f"original={orig_lat.shape}, latent={latents.shape}")

                # ========== 逐步 mask 混合（仅 4D latent 模型，3D packed 跳过）==========
                if _inpaint_state["initialized"] and not _inpaint_state["use_pixel_composite"]:
                    inp_mask = _inpaint_state["mask"]
                    inp_orig = _inpaint_state["original_latents"]
                    inp_noise = _inpaint_state["noise"]

                    # 非 Flux2：按当前去噪阶段给原图加噪
                    timesteps_list = pipe.scheduler.timesteps
                    if step_index < len(timesteps_list) - 1:
                        next_t = timesteps_list[step_index + 1]
                        blended = _scale_noise_for_inpaint(
                            pipe.scheduler, inp_orig, inp_noise, next_t
                        )
                    else:
                        blended = inp_orig

                    # mask=1 → 重绘区（保留模型输出），mask=0 → 保留区
                    latents = inp_mask * latents + (1.0 - inp_mask) * blended
                    callback_kwargs["latents"] = latents

            # ---------- 预览逻辑 ----------
            # 与官方 K 采样器一致：优先用 denoised (x0) 做预览，回退到 latents
            lat_unpacked = None
            if comfy_callback is not None and "latents" in callback_kwargs:
                lat = callback_kwargs["latents"]
                noise_pred = callback_kwargs.get("noise_pred")
                to_preview = None
                if noise_pred is not None:
                    denoised = _compute_denoised_for_preview(lat, noise_pred, pipe, step_index)
                    if denoised is not None:
                        to_preview = _unpack_latent_for_preview(denoised, pipe, _pipe_height, _pipe_width)
                if to_preview is None:
                    to_preview = _unpack_latent_for_preview(lat, pipe, _pipe_height, _pipe_width)
                lat_unpacked = to_preview
                if lat_unpacked is not None:
                    try:
                        comfy_callback(step_index, lat_unpacked, lat_unpacked, effective_steps)
                    except Exception:
                        if progress_bar is not None:
                            progress_bar.update_absolute(step_index + 1, effective_steps, None)
                else:
                    if progress_bar is not None:
                        progress_bar.update_absolute(step_index + 1, effective_steps, None)
            elif progress_bar is not None:
                progress_bar.update_absolute(step_index + 1, effective_steps, None)
            # 兜底：直接通过 server 发送预览（progress 系统可能因 node_id 等不生效）
            if lat_unpacked is not None and server is not None and BinaryEventTypes is not None and latent_preview and comfy_args:
                try:
                    load_dev = getattr(model, "load_device", torch.device("cuda" if torch.cuda.is_available() else "cpu"))
                    lf = model.get_model_object("latent_format") if hasattr(model, "get_model_object") else None
                    if lf is not None:
                        old_pm = comfy_args.preview_method
                        comfy_args.preview_method = preview_method_map.get(预览方式, LatentPreviewMethod.Auto)
                        try:
                            previewer = latent_preview.get_previewer(load_dev, lf)
                        finally:
                            comfy_args.preview_method = old_pm
                    else:
                        previewer = None
                    if previewer is not None:
                        preview_data = previewer.decode_latent_to_preview_image("JPEG", lat_unpacked)
                        inst = getattr(getattr(server, "PromptServer", None), "instance", None)
                        if inst is not None and getattr(inst, "client_id", None) is not None:
                            meta = {
                                "node_id": str(unique_id),
                                "display_node_id": str(unique_id),
                                "prompt_id": str(getattr(inst, "last_prompt_id", "") or ""),
                            }
                            inst.send_sync(BinaryEventTypes.PREVIEW_IMAGE_WITH_METADATA, (preview_data, meta), inst.client_id)
                except Exception:
                    pass
            if COMFYUI_AVAILABLE and comfy.model_management.processing_interrupted():
                raise InterruptedError("User interrupted")
            return callback_kwargs

        # QwenImagePipeline 使用 true_cfg_scale 而非 guidance_scale（见 diffusers 文档）
        kwargs = {
            "num_inference_steps": effective_steps,
            "generator": generator,
            "callback_on_step_end": on_step_end,
        }
        if is_qwen_image:
            kwargs["true_cfg_scale"] = cfg
        else:
            kwargs["guidance_scale"] = cfg
        # 请求 latents + noise_pred 传入 callback
        # inpaint 模式必须拿到 latents 做逐步混合；预览也需要 latents + noise_pred
        if comfy_callback is not None or inpaint_active:
            tensor_inputs = ["latents"]
            if hasattr(pipeline, "_callback_tensor_inputs"):
                cb_inputs = pipeline._callback_tensor_inputs
                if not isinstance(cb_inputs, list):
                    cb_inputs = list(cb_inputs) if cb_inputs else []
                if "noise_pred" not in cb_inputs:
                    pipeline._callback_tensor_inputs = list(cb_inputs) + ["noise_pred"]
                if comfy_callback is not None:
                    tensor_inputs.append("noise_pred")
            kwargs["callback_on_step_end_tensor_inputs"] = tensor_inputs

        # 移动到 pipeline 执行设备并统一 dtype（外接 CLIP 可能为 float32/float16，transformer 为 bfloat16）
        device = getattr(pipeline, "_execution_device", None)
        if device is None:
            try:
                comp = pipeline.transformer if hasattr(pipeline, "transformer") else pipeline.unet
                device = next(comp.parameters()).device
            except Exception:
                device = "cuda" if torch.cuda.is_available() else "cpu"
        # 优先使用 CUDA：offload 模式下模型参数在 CPU，但 forward 时在 GPU 计算
        is_cpu = (device == "cpu" or (hasattr(device, "type") and getattr(device, "type", None) == "cpu"))
        if is_cpu and torch.cuda.is_available():
            device = torch.device("cuda")
        try:
            model_dtype = next((pipeline.transformer if hasattr(pipeline, "transformer") else pipeline.unet).parameters()).dtype
        except Exception:
            model_dtype = torch.bfloat16
        kwargs["prompt_embeds"] = prompt_embeds.to(device=device, dtype=model_dtype)
        if not flux2klein:
            if pooled_embeds is not None:
                kwargs["pooled_prompt_embeds"] = pooled_embeds.to(device=device, dtype=model_dtype)
            if neg_embeds is not None:
                kwargs["negative_prompt_embeds"] = neg_embeds.to(device=device, dtype=model_dtype)
            if neg_pooled is not None:
                kwargs["negative_pooled_prompt_embeds"] = neg_pooled.to(device=device, dtype=model_dtype)

        # Packed latent pipeline（Flux/Flux2/QwenImage/ZImage/Chroma 等）的 prepare_latents
        # 内部会把 height/width 除以 vae_scale_factor*2 再除以 2，
        # 导致输出像素仅为传入 height/width 的一半。
        # 统一补偿：传入 2x 值，使输出尺寸 = 用户期望尺寸 (width x height)。
        if _has_pack:
            kwargs["width"] = width * 2
            kwargs["height"] = height * 2
        else:
            kwargs["width"] = width
            kwargs["height"] = height

        # 图像编辑：传递参考图像给 pipeline（Flux2/Flux2Klein 支持 image 参数）
        if ref_pil is not None:
            kwargs["image"] = ref_pil

        # 请求 latent 输出（非 packed latent pipeline 尝试直接返回 latent 避免额外 VAE decode）
        # Packed latent pipeline（Flux/Flux2/QwenImage/ZImage/Chroma 等）总是返回 PIL；
        # 其他 pipeline（SDXL/GLM 等）尝试 latent 输出，失败时 try-except 兜底
        if not _has_pack:
            kwargs["output_type"] = "latent"

        try:
            result = pipeline(**kwargs)
        except TypeError as e:
            err = str(e)
            # Flux2Klein 等 pipeline 不支持 pooled/negative 相关参数，移除后重试
            if "pooled_prompt_embeds" in err or "negative_prompt" in err or "negative_prompt_embeds" in err:
                kwargs.pop("pooled_prompt_embeds", None)
                kwargs.pop("negative_prompt", None)
                kwargs.pop("negative_prompt_embeds", None)
                kwargs.pop("negative_pooled_prompt_embeds", None)
                result = pipeline(**kwargs)
            elif "callback_on_step_end_tensor_inputs" in err:
                kwargs.pop("callback_on_step_end_tensor_inputs", None)
                print("[SDNQ K Sampler] 当前 pipeline 不支持 callback_on_step_end_tensor_inputs，采样过程预览不可用")
                result = pipeline(**kwargs)
            elif "image" in err and ref_pil is not None:
                kwargs.pop("image", None)
                print("[SDNQ K Sampler] 当前 pipeline 不支持 image 参数，回退为 text-to-image")
                result = pipeline(**kwargs)
            else:
                raise

        # ========== 像素空间 mask composite（3D packed latent 模型的 inpaint）==========
        # 3D packed latent 模型（Flux/Flux2/Flux2Klein/QwenImage/ZImage/Chroma 等）的
        # noise latent 和 image latent 在不同分辨率空间，无法做 latent blending。
        # 所以在 pipeline 输出 PIL 图片后，用原始 mask 在像素空间做 composite。
        _pixel_composited = None  # 如果做了像素 composite，存储结果
        if inpaint_active and _inpaint_state.get("use_pixel_composite", False) and hasattr(result, "images") and result.images:
            try:
                import numpy as np
                from PIL import Image as PILImage, ImageFilter
                gen_img = result.images[0] if isinstance(result.images, list) else result.images
                if hasattr(gen_img, "size"):
                    orig_img = ref_pil[0] if isinstance(ref_pil, list) else ref_pil
                    orig_w, orig_h = orig_img.size
                    gen_w, gen_h = gen_img.size
                    # 以原图尺寸为基准：把生成图 resize 到原图大小（pipeline 可能输出更小的图）
                    if gen_img.size != (orig_w, orig_h):
                        print(f"  [Inpaint] 生成图 ({gen_w}x{gen_h}) 与原图 ({orig_w}x{orig_h}) 尺寸不同，resize 生成图到原图尺寸")
                        gen_img = gen_img.resize((orig_w, orig_h), PILImage.LANCZOS)
                    # 准备 mask（1=重绘区，0=保留区）
                    # noise_mask_raw: (B,1,H,W) or (B,H,W) tensor
                    mask_t = noise_mask_raw
                    if mask_t.dim() == 4:
                        mask_t = mask_t[0, 0]
                    elif mask_t.dim() == 3:
                        mask_t = mask_t[0]
                    # resize mask 到原图尺寸
                    mask_np = mask_t.cpu().float().numpy()
                    mask_pil = PILImage.fromarray((mask_np * 255).astype(np.uint8), mode="L")
                    if mask_pil.size != (orig_w, orig_h):
                        mask_pil = mask_pil.resize((orig_w, orig_h), PILImage.LANCZOS)
                    # 对 mask 做高斯模糊，实现平滑过渡边缘
                    mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=5))
                    # PIL composite: mask=255→gen_img, mask=0→orig_img
                    _pixel_composited = PILImage.composite(gen_img, orig_img, mask_pil)
                    print(f"  [Inpaint] 像素空间 composite 完成: {orig_w}x{orig_h}")
            except Exception as e:
                print(f"  [Inpaint] 像素空间 composite 失败: {e}")
                import traceback; traceback.print_exc()

        # 若采样过程中未产生预览，结束时发送最终图像作为预览（Flux 返回 PIL）
        if (progress_bar is not None or comfy_callback is not None) and 预览方式 != "none":
            try:
                # 如果做了像素 composite，优先预览 composited 结果
                preview_img = _pixel_composited
                if preview_img is None:
                    img = getattr(result, "images", None)
                    if img and ((isinstance(img, list) and img) or (not isinstance(img, list) and img is not None)):
                        preview_img = img[0] if isinstance(img, list) else img
                if preview_img is not None and hasattr(preview_img, "size") and preview_img.size:
                    max_preview = 512
                    if COMFYUI_AVAILABLE and comfy_args is not None:
                        max_preview = getattr(comfy_args, "preview_size", 512)
                    preview_data = ("JPEG", preview_img, max_preview)
                    pbar = progress_bar if progress_bar is not None else comfy.utils.ProgressBar(effective_steps)
                    pbar.update_absolute(effective_steps, total=effective_steps, preview=preview_data)
            except Exception:
                pass

        # 取 latent
        out_latent = latent.copy()
        # 如果做了像素 composite，优先使用 composite 结果
        _result_images = result.images if hasattr(result, "images") else None
        if _pixel_composited is not None:
            _result_images = [_pixel_composited]
        if _result_images:
            first = _result_images[0] if isinstance(_result_images, list) else _result_images
            if isinstance(first, torch.Tensor):
                lat = first
                if lat.dim() == 3:
                    lat = lat.unsqueeze(0)
                out_latent["samples"] = lat.cpu()
            else:
                # PIL 输出（FLUX 等）：用 VAE 编码回 latent
                try:
                    import numpy as np
                    pil_img = first if hasattr(first, "size") else result.images[0]
                    arr = np.array(pil_img).astype(np.float32) / 255.0
                    img_t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
                    if hasattr(pipeline, "vae") and pipeline.vae is not None:
                        vae_dev = getattr(pipeline, "_execution_device", None)
                        if vae_dev is None or str(vae_dev).lower() == "cpu":
                            vae_dev = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
                        vae_dtype = next(pipeline.vae.parameters()).dtype
                        img_t = img_t.to(device=vae_dev, dtype=vae_dtype)
                        img_t = img_t * 2 - 1
                        with torch.no_grad():
                            enc = pipeline.vae.encode(img_t).latent_dist.sample()
                            # 与 diffusers pipeline 一致：latent = (raw - shift) * scale
                            # Flux2: bn 无 scaling，Flux/SD3: scaling+shift，SD/SDXL: scaling only
                            if hasattr(pipeline.vae, "bn") and pipeline.vae.bn is not None:
                                lat = enc
                                # Body-only 时 encode 返回 (B,32,H,W) 供 pipeline concat；下游 VAE Decode 需 ComfyUI 格式 (B,128,h,w)
                                if lat.dim() == 4 and lat.shape[1] == 32:
                                    from einops import rearrange
                                    lat = rearrange(lat, "b c (i pi) (j pj) -> b (c pi pj) i j", pi=2, pj=2)
                            else:
                                cfg = pipeline.vae.config
                                sf = getattr(cfg, "scaling_factor", None) or (cfg.get("scaling_factor") if hasattr(cfg, "get") else None) or 0.18215
                                shift = getattr(cfg, "shift_factor", None) or (cfg.get("shift_factor") if hasattr(cfg, "get") else None) or 0.0
                                lat = (enc - shift) * sf
                        out_latent["samples"] = lat.cpu()
                    else:
                        out_latent["samples"] = torch.zeros(batch, channels, h, w)
                except Exception as e:
                    print(f"[SDNQ K Sampler] VAE encode fallback: {e}")
                    out_latent["samples"] = torch.zeros(batch, channels, h, w)
        else:
            out_latent["samples"] = torch.zeros(batch, channels, h, w)

        return (out_latent,)


