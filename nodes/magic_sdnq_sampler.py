"""
Magic SDNQ Sampler - 可连接的 SDNQ 采样器

接口类似 K 采样器：接入 model、正负面条件、latent，输出 latent。
内部使用 diffusers pipeline 的 SDNQ 采样机制。
"""

import os
import sys
import torch
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
        print(f"[SDNQ Sampler] reference_latents 解码失败: {e}")
    return out


def _swap_scheduler(pipeline, scheduler_name: str):
    m = _get_scheduler_map()
    if scheduler_name not in m:
        raise ValueError(f"Unknown scheduler: {scheduler_name}")
    pipeline.scheduler = m[scheduler_name].from_config(pipeline.scheduler.config)


def _align_dim(dim: int, multiple: int) -> int:
    return (dim // multiple) * multiple


class MagicSDNQSampler:
    """可连接的 SDNQ 采样器：model + 正负面条件 + latent → latent"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "来自 Magic SDNQ Loader 或 LoRA Loader"}),
                "positive": ("CONDITIONING", {"tooltip": "正面条件"}),
                "negative": ("CONDITIONING", {"tooltip": "负面条件"}),
                "latent": ("LATENT", {"tooltip": "空 latent"}),
                "seed": ("INT", {"default": 0, "min": -1, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "steps": ("INT", {"default": 25, "min": 1, "max": 150}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 30.0, "step": 0.1}),
                "scheduler": (SCHEDULER_LIST, {"default": "FlowMatchEulerDiscreteScheduler", "tooltip": "FLUX/SD3/Qwen 用 FlowMatch; SDXL/SD1.5 用 DPMSolver/Euler"}),
                "降噪": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "预览方式": (
                    ["auto", "latent2rgb", "taesd", "none"],
                    {"default": "auto", "tooltip": "auto=自动, latent2rgb=快, taesd=慢但更清晰, none=不预览"}
                ),
            },
            "optional": {},
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
        prompt=None,
        unique_id=None,
    ) -> Tuple:
        pipeline = None
        if hasattr(model, "get_pipeline"):
            pipeline = model.get_pipeline()
        if pipeline is None:
            raise RuntimeError(
                "Magic SDNQ Sampler 需要来自 Magic SDNQ Loader 的 model。"
                "标准 K Sampler 的 model 不兼容。"
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
                print(f"[SDNQ Sampler] load_models_gpu 跳过（将直接使用当前显存）: {e}")

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
        batch, channels, h, w = samples.shape
        pipeline_name = type(pipeline).__name__
        flux2klein = "Flux2Klein" in pipeline_name or "flux2klein" in pipeline_name.lower()
        is_qwen_image = "QwenImage" in pipeline_name
        latent_scale = 16 if ("Flux" in pipeline_name or flux2klein) else 8
        dim_mult = 16 if flux2klein else 8
        if ref_pil is not None:
            first_ref = ref_pil[0] if isinstance(ref_pil, list) else ref_pil
            src_w, src_h = first_ref.size
            width = max(8, _align_dim(src_w, dim_mult))
            height = max(8, _align_dim(src_h, dim_mult))
        else:
            width = max(8, _align_dim(w * latent_scale, dim_mult))
            height = max(8, _align_dim(h * latent_scale, dim_mult))

        _swap_scheduler(pipeline, scheduler)

        # 首次采样时应用 torch.compile（在 LoRA 已加载之后，与 comfyui-sdnq 顺序一致）
        if getattr(pipeline, "_sdnq_use_torch_compile", False) and torch.cuda.is_available():
            if not getattr(pipeline, "_sdnq_transformer_compiled", False):
                try:
                    print("[SDNQ Sampler] Applying torch.compile (first run will compile ~30-60s)...")
                    if hasattr(pipeline, "transformer") and pipeline.transformer is not None:
                        t = pipeline.transformer
                        try:
                            t.to(memory_format=torch.channels_last)
                        except Exception:
                            pass
                        pipeline.transformer = torch.compile(t, mode="max-autotune-no-cudagraphs", fullgraph=False)
                        pipeline._sdnq_transformer_compiled = True
                        print("[SDNQ Sampler] ✓ torch.compile applied (warmup on first generation)")
                    elif hasattr(pipeline, "unet") and pipeline.unet is not None:
                        u = pipeline.unet
                        try:
                            u.to(memory_format=torch.channels_last)
                        except Exception:
                            pass
                        pipeline.unet = torch.compile(u, mode="max-autotune-no-cudagraphs", fullgraph=False)
                        pipeline._sdnq_transformer_compiled = True
                        print("[SDNQ Sampler] ✓ torch.compile applied (warmup on first generation)")
                except Exception as e:
                    print(f"[SDNQ Sampler] ⚠️ torch.compile failed (continuing without): {e}")
                    pipeline._sdnq_use_torch_compile = False

        actual_seed = seed if seed >= 0 else torch.randint(0, 2**32, (1,)).item()
        generator = torch.Generator(device="cpu").manual_seed(actual_seed)

        is_image_edit = ref_pil is not None
        print(f"\n{'='*50}")
        print("[SDNQ Sampler] Generating (" + ("image-to-image" if is_image_edit else "text-to-image") + ")")
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

        def _unpack_latent_for_preview(lat, pipe, h_px, w_px):
            """将 callback 的 latents 转为 (B, C, H, W) 供预览。支持多模型：
            - Flux2/Flux2Klein: packed (B,H*W,C) + BN 反归一化
            - Flux: packed，优先用 pipeline._unpack_latents
            - SD/SDXL/Z-Image 等: 已是 (B,C,H,W)"""
            if lat is None:
                return None
            if lat.dim() == 4:
                return lat  # SD/SDXL/Z-Image 等已是 (B, C, H, W)
            if lat.dim() != 3:
                return None
            vae_sf = getattr(pipe, "vae_scale_factor", 16)
            # Flux 有 _unpack_latents(height, width)，直接调用
            if hasattr(pipe, "_unpack_latents") and callable(getattr(pipe, "_unpack_latents")):
                try:
                    return pipe._unpack_latents(lat, h_px, w_px, vae_sf)
                except Exception:
                    pass
            # Flux2/Flux2Klein: packed (B, H*W, C) -> (B, C, H, W)
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
            # Flux2/Flux2Klein：pipeline 在 _unpack 后对 latent 做 BN 反归一化，预览需一致
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
            # 与官方 K 采样器一致：优先用 denoised (x0) 做预览，回退到 latents
            lat_unpacked = None
            if comfy_callback is not None and "latents" in callback_kwargs:
                lat = callback_kwargs["latents"]
                noise_pred = callback_kwargs.get("noise_pred")
                to_preview = None
                if noise_pred is not None:
                    denoised = _compute_denoised_for_preview(lat, noise_pred, pipe, step_index)
                    if denoised is not None:
                        to_preview = _unpack_latent_for_preview(denoised, pipe, height, width)
                if to_preview is None:
                    to_preview = _unpack_latent_for_preview(lat, pipe, height, width)
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
            "width": width,
            "height": height,
            "callback_on_step_end": on_step_end,
        }
        if is_qwen_image:
            kwargs["true_cfg_scale"] = cfg
        else:
            kwargs["guidance_scale"] = cfg
        # 请求 latents + noise_pred 传入 callback，用于 denoised 预览（与 K 采样器一致）
        if comfy_callback is not None:
            tensor_inputs = ["latents"]
            if hasattr(pipeline, "_callback_tensor_inputs"):
                cb_inputs = pipeline._callback_tensor_inputs
                if not isinstance(cb_inputs, list):
                    cb_inputs = list(cb_inputs) if cb_inputs else []
                if "noise_pred" not in cb_inputs:
                    pipeline._callback_tensor_inputs = list(cb_inputs) + ["noise_pred"]
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

        kwargs["width"] = width
        kwargs["height"] = height

        # 图像编辑：传递参考图像给 pipeline（Flux2/Flux2Klein 支持 image 参数）
        if ref_pil is not None:
            kwargs["image"] = ref_pil

        # 请求 latent 输出（非 FLUX 部分 pipeline 支持）
        if "Flux" not in pipeline_name:
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
                print("[SDNQ Sampler] 当前 pipeline 不支持 callback_on_step_end_tensor_inputs，采样过程预览不可用")
                result = pipeline(**kwargs)
            elif "image" in err and ref_pil is not None:
                kwargs.pop("image", None)
                print("[SDNQ Sampler] 当前 pipeline 不支持 image 参数，回退为 text-to-image")
                result = pipeline(**kwargs)
            else:
                raise

        # 若采样过程中未产生预览，结束时发送最终图像作为预览（Flux 返回 PIL）
        if (progress_bar is not None or comfy_callback is not None) and 预览方式 != "none":
            try:
                img = getattr(result, "images", None)
                if img and ((isinstance(img, list) and img) or (not isinstance(img, list) and img is not None)):
                    first = img[0] if isinstance(img, list) else img
                    if hasattr(first, "size") and first.size:
                        max_preview = 512
                        if COMFYUI_AVAILABLE and comfy_args is not None:
                            max_preview = getattr(comfy_args, "preview_size", 512)
                        preview_data = ("JPEG", first, max_preview)
                        pbar = progress_bar if progress_bar is not None else comfy.utils.ProgressBar(effective_steps)
                        pbar.update_absolute(effective_steps, total=effective_steps, preview=preview_data)
            except Exception:
                pass

        # 取 latent
        out_latent = latent.copy()
        if hasattr(result, "images") and result.images:
            first = result.images[0] if isinstance(result.images, list) else result.images
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
                    print(f"[SDNQ Sampler] VAE encode fallback: {e}")
                    out_latent["samples"] = torch.zeros(batch, channels, h, w)
        else:
            out_latent["samples"] = torch.zeros(batch, channels, h, w)

        return (out_latent,)


