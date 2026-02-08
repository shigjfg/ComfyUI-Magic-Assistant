"""
ComfyUI Type Wrappers for SDNQ Models

Wraps diffusers pipeline components into ComfyUI-compatible types (MODEL, CLIP, VAE).
Includes clone(), latent_format, model_options for better ComfyUI compatibility.
"""

import torch
from typing import Any, Tuple, Optional


class SDNQModelWrapper:
    """
    Wraps a diffusers transformer/unet model for ComfyUI MODEL compatibility.
    Provides clone(), latent_format, model_options, load_device for ComfyUI nodes.
    Note: KSampler may not work directly as it expects ModelPatcher; use with Magic Power LoRA SDNQ mode.
    """

    def __init__(self, pipeline, model_component, model_type=None):
        self.pipeline = pipeline
        self.model = model_component
        if model_type:
            self.model_type = self._normalize_model_type(model_type)
        else:
            self.model_type = self._detect_model_type()
        # ComfyUI expects load_device (e.g. for KSampler)
        try:
            import comfy.model_management
            self.load_device = comfy.model_management.get_torch_device()
        except ImportError:
            self.load_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _normalize_model_type(self, model_type: str) -> str:
        if not model_type:
            return "unknown"
        model_type = model_type.upper()
        if "FLUX" in model_type:
            return "flux"
        elif "SD3" in model_type:
            return "sd3"
        elif "SDXL" in model_type:
            return "sdxl"
        return "unknown"

    def _detect_model_type(self) -> str:
        """根据 pipeline 结构检测模型类型，支持 FLUX/Flux2/SD3/SDXL/Qwen/Z-Image/Chroma/GLM"""
        pipe_name = str(getattr(self.pipeline.__class__, "__name__", "") or "").lower()
        if "flux2" in pipe_name or "flux.2" in pipe_name:
            return "flux2"
        if "qwen" in pipe_name and "image" in pipe_name:
            return "qwen_image"
        if "zimage" in pipe_name or "z_image" in pipe_name:
            return "z_image"
        if "chroma" in pipe_name:
            return "chroma"
        if "glm" in pipe_name and "image" in pipe_name:
            return "glm_image"
        if hasattr(self.pipeline, 'transformer'):
            transformer_class = self.pipeline.transformer.__class__.__name__
            if "SD3" in transformer_class:
                return "sd3"
            return "flux"
        elif hasattr(self.pipeline, 'unet'):
            return "sdxl"
        return "unknown"

    def _get_latent_format(self):
        """ComfyUI latent_format：FLUX 16ch, Flux2 128ch, SDXL 4ch, Z-Image/Qwen 用 Flux(16ch)"""
        try:
            import comfy.latent_formats
            pipe_name = str(getattr(self.pipeline.__class__, "__name__", "") or "").lower()
            # Flux2/Flux2Klein 必须优先（128 通道）
            if "flux2" in pipe_name or "flux.2" in pipe_name:
                return comfy.latent_formats.Flux2()
            if self.model_type == "sd3":
                return comfy.latent_formats.SD3()
            if self.model_type == "sdxl":
                return comfy.latent_formats.SDXL()
            if self.model_type == "chroma":
                return getattr(comfy.latent_formats, "ChromaRadiance", comfy.latent_formats.Flux)()
            # Flux / Qwen-Image / Z-Image / GLM 等 DiT 架构多为 16 通道
            return comfy.latent_formats.Flux()
        except ImportError:
            return None

    @property
    def model_options(self):
        """ComfyUI model_options dict for compatibility."""
        return {}

    def clone(self):
        """Return a shallow clone for ComfyUI batching/sampling compatibility."""
        return SDNQModelWrapper(self.pipeline, self.model, self.model_type)

    def get_model(self):
        return self.model

    def get_pipeline(self):
        return self.pipeline

    def get_model_object(self, name: str):
        if name == "latent_format":
            return self._get_latent_format()
        if hasattr(self.pipeline, name):
            return getattr(self.pipeline, name)
        if hasattr(self.model, name):
            return getattr(self.model, name)
        return None


def _is_flux2klein_pipeline(pipeline) -> bool:
    """Detect Flux2Klein pipeline (Qwen3 text encoder with special layer concat format)."""
    if pipeline is None:
        return False
    name = getattr(pipeline.__class__, "__name__", "") or ""
    return "Flux2Klein" in name or "flux2klein" in name.lower()


class SDNQCLIPWrapper:
    """Wraps diffusers text encoder for ComfyUI CLIP compatibility."""

    # Flux2Klein (Qwen3) uses layers 9, 18, 27 concatenated -> (batch, seq, 3*4096=12288)
    _QWEN3_HIDDEN_LAYERS = (9, 18, 27)
    _QWEN3_MAX_SEQ_LENGTH = 512

    def __init__(self, pipeline, text_encoder, tokenizer):
        self.pipeline = pipeline
        self.text_encoder = text_encoder
        self.tokenizer = tokenizer
        self._is_flux2klein = _is_flux2klein_pipeline(pipeline)

    def tokenize(self, text, images=None, **kwargs):
        """Tokenize text. For Flux2Klein (Qwen3), uses apply_chat_template for correct format."""
        tok = self.tokenizer
        if hasattr(tok, 'tokenizer'):
            tok = tok.tokenizer
        if images is not None and hasattr(self.tokenizer, '__call__'):
            return self.tokenizer(text=text, images=images, return_tensors="pt", padding=True, **kwargs)

        if self._is_flux2klein and hasattr(tok, 'apply_chat_template'):
            # Flux2Klein/Qwen3 expects chat template format (same as pipeline._get_qwen3_prompt_embeds)
            text = [text] if isinstance(text, str) else text
            all_input_ids, all_attention_masks = [], []
            for single in text:
                messages = [{"role": "user", "content": single}]
                formatted = tok.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
                )
                inp = tok(
                    formatted,
                    return_tensors="pt",
                    padding="max_length",
                    truncation=True,
                    max_length=self._QWEN3_MAX_SEQ_LENGTH,
                )
                all_input_ids.append(inp["input_ids"])
                all_attention_masks.append(inp["attention_mask"])
            return {
                "input_ids": torch.cat(all_input_ids, dim=0),
                "attention_mask": torch.cat(all_attention_masks, dim=0),
            }

        if hasattr(tok, '__call__'):
            return tok(text, return_tensors="pt", padding=True, **kwargs)
        raise NotImplementedError(f"Tokenizer type {type(self.tokenizer)} not supported")

    def encode_from_tokens(self, tokens, return_pooled=False, return_dict=False, **kwargs):
        """Encode tokens to embeddings. For Flux2Klein, uses layers 9,18,27 concat (12288-dim)."""
        if hasattr(tokens, 'data'):
            token_dict = tokens.data
        elif isinstance(tokens, dict):
            token_dict = tokens
        else:
            token_dict = {"input_ids": tokens}

        inputs = {}
        for key in ['input_ids', 'attention_mask', 'pixel_values']:
            if key in token_dict:
                value = token_dict[key]
                if hasattr(value, 'to'):
                    inputs[key] = value.to(self.text_encoder.device)
                else:
                    inputs[key] = value

        if self._is_flux2klein:
            # Flux2Klein: use layers 9, 18, 27 and concatenate (same as pipeline._get_qwen3_prompt_embeds)
            inputs["output_hidden_states"] = True
            inputs["use_cache"] = False
            outputs = self.text_encoder(**inputs)
            hs = outputs.hidden_states
            if hs is None:
                raise AttributeError("Flux2Klein text encoder did not return hidden_states")
            out = torch.stack([hs[k] for k in self._QWEN3_HIDDEN_LAYERS], dim=1)
            batch_size, num_channels, seq_len, hidden_dim = out.shape
            cond = out.permute(0, 2, 1, 3).reshape(batch_size, seq_len, num_channels * hidden_dim)
            pooled = cond[:, 0] if cond is not None else None
        else:
            outputs = self.text_encoder(**inputs)
            if hasattr(outputs, 'last_hidden_state'):
                cond = outputs.last_hidden_state
            elif hasattr(outputs, 'hidden_states') and outputs.hidden_states is not None:
                cond = outputs.hidden_states[-1]
            elif hasattr(outputs, 'logits'):
                cond = outputs.logits
            else:
                raise AttributeError(f"Text encoder output has no recognizable embedding attribute. Available: {dir(outputs)}")
            pooled = outputs.pooler_output if hasattr(outputs, 'pooler_output') and outputs.pooler_output is not None else (
                outputs.pooled_output if hasattr(outputs, 'pooled_output') and outputs.pooled_output is not None else cond[:, 0]
            )

        if return_dict:
            return {"cond": cond, "pooled_output": pooled}
        elif return_pooled:
            return cond, pooled
        return cond

    def encode_from_tokens_scheduled(self, tokens, unprojected=False, add_dict=None, show_pbar=True):
        if add_dict is None:
            add_dict = {}
        return_pooled = "unprojected" if unprojected else True
        pooled_dict = self.encode_from_tokens(tokens, return_pooled=return_pooled, return_dict=True)
        cond = pooled_dict.pop("cond")
        pooled_dict.update(add_dict)
        return [[cond, pooled_dict]]

    def encode(self, text: str) -> torch.Tensor:
        tokens = self.tokenize(text, return_tensors="pt", padding=True)
        return self.encode_from_tokens(tokens)

    def get_text_encoder(self):
        return self.text_encoder

    def get_tokenizer(self):
        return self.tokenizer


def _get_vae_scaling_factor(vae, default: float = 0.18215) -> float:
    """兼容 FrozenDict 等 config 格式，安全获取 scaling_factor。
    Flux2 使用 BN 而非 scaling_factor，返回 1.0 表示不缩放。"""
    if hasattr(vae, "bn") and vae.bn is not None:
        return 1.0  # Flux2 VAE 使用 BN，不使用 scaling_factor
    cfg = getattr(vae, "config", None)
    if cfg is None:
        return default
    v = getattr(cfg, "scaling_factor", None)
    if v is not None:
        return float(v)
    if hasattr(cfg, "get"):
        v = cfg.get("scaling_factor")
        if v is not None:
            return float(v)
    return default


def _get_vae_shift_factor(vae, default: float = 0.0) -> float:
    """获取 shift_factor，Flux/SD3 使用，SD/SDXL 为 0。"""
    if hasattr(vae, "bn") and vae.bn is not None:
        return 0.0  # Flux2 无 shift
    cfg = getattr(vae, "config", None)
    if cfg is None:
        return default
    v = getattr(cfg, "shift_factor", None)
    if v is not None:
        return float(v)
    if hasattr(cfg, "get"):
        v = cfg.get("shift_factor")
        if v is not None:
            return float(v)
    return default


class SDNQVAEWrapper:
    """Wraps diffusers VAE for ComfyUI VAE compatibility."""

    def __init__(self, vae):
        self.vae = vae

    def _vae_device(self):
        """VAE 实际计算设备。CPU offload 时模型在 CPU，但 forward 会在 CUDA 执行，故优先用 CUDA"""
        if torch.cuda.is_available():
            return torch.device("cuda")
        try:
            return next(self.vae.parameters()).device
        except Exception:
            return torch.device("cpu")

    def encode(self, images: torch.Tensor) -> torch.Tensor:
        with torch.no_grad():
            dev = self._vae_device()
            images = images.to(dev, dtype=next(self.vae.parameters()).dtype)
            # ComfyUI IMAGE 格式为 (B, H, W, C)，diffusers VAE 期望 (B, C, H, W)
            if images.dim() == 4 and images.shape[-1] in (3, 4):
                images = images.permute(0, 3, 1, 2)
            # ComfyUI 图像为 [0,1]，diffusers VAE 期望 [-1,1]（与 ComfyUI VAE process_input 一致）
            images = images * 2.0 - 1.0
            latents = self.vae.encode(images).latent_dist.sample()
            # 与 diffusers pipeline 一致：Flux/SD3 用 (raw-shift)*scale，SD/SDXL 用 raw*scale
            sf = _get_vae_scaling_factor(self.vae)
            shift = _get_vae_shift_factor(self.vae)
            latents = (latents - shift) * sf
        return latents.cpu()

    def decode(self, latents: torch.Tensor) -> torch.Tensor:
        with torch.no_grad():
            dev = self._vae_device()
            latents = latents.to(dev, dtype=next(self.vae.parameters()).dtype)
            # 与 diffusers pipeline 一致：Flux/SD3 用 (latents/scale)+shift，SD/SDXL 用 latents/scale
            sf = _get_vae_scaling_factor(self.vae)
            shift = _get_vae_shift_factor(self.vae)
            latents = (latents / sf) + shift
            images = self.vae.decode(latents).sample
        # ComfyUI IMAGE 格式为 (B, H, W, C)，diffusers 输出 (B, C, H, W)
        if images.dim() == 4 and images.shape[1] in (3, 4):
            images = images.permute(0, 2, 3, 1)
        # 转为 float32：ComfyUI save_images 用 .numpy()，numpy 不支持 bfloat16
        out = images.cpu()
        if out.dtype == torch.bfloat16:
            out = out.float()
        # VAE 输出为 [-1, 1]，需反归一化到 [0, 1]（与 diffusers image_processor.denormalize 一致）
        out = (out * 0.5 + 0.5).clamp(0.0, 1.0)
        return out

    def get_vae(self):
        return self.vae


def wrap_pipeline_components(pipeline, model_type=None) -> Tuple[SDNQModelWrapper, SDNQCLIPWrapper, SDNQVAEWrapper]:
    """Wrap diffusers pipeline components into ComfyUI-compatible objects."""
    if hasattr(pipeline, 'transformer') and pipeline.transformer is not None:
        model_component = pipeline.transformer
    elif hasattr(pipeline, 'unet') and pipeline.unet is not None:
        model_component = pipeline.unet
    else:
        raise ValueError("Pipeline missing transformer or unet component")

    text_encoder = getattr(pipeline, 'text_encoder', None)
    tokenizer = getattr(pipeline, 'tokenizer', None)
    if text_encoder is None or tokenizer is None:
        raise ValueError("Pipeline missing text_encoder or tokenizer component")

    vae = getattr(pipeline, 'vae', None)
    if vae is None:
        raise ValueError("Pipeline missing vae component")

    model_wrapper = SDNQModelWrapper(pipeline, model_component, model_type=model_type)
    clip_wrapper = SDNQCLIPWrapper(pipeline, text_encoder, tokenizer)
    vae_wrapper = SDNQVAEWrapper(vae)

    return (model_wrapper, clip_wrapper, vae_wrapper)
