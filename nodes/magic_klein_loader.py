"""
Magic Nunchaku FLUX.2 Klein Loader - Load Nunchaku FLUX.2 Klein models.

This node patches the user's existing nunchaku installation to add the missing
FLUX.2 Klein wrapper (wrappers/klein.py) which is not included in the standalone
nunchaku pip package. The wrapper source is embedded directly in this custom node.
"""
import gc
import json
import logging
import os
import torch
from typing import Tuple
from aiohttp import web

import comfy.model_management
import comfy.model_patcher
import folder_paths
from server import PromptServer

logger = logging.getLogger("MagicKleinLoader")

# Track whether the environment has been checked/patched this session
_ENVIRONMENT_CHECKED = False

# ---------------------------------------------------------------------------
# API endpoints for the settings popup
#
# IMPORTANT: Register at import time (decorators), same as utils.py.
# ComfyUI calls add_routes() once at startup; routes added later from
# INPUT_TYPES() are never mounted → HTTP 404 for /ma/klein/check_env.
# ---------------------------------------------------------------------------


@PromptServer.instance.routes.get("/ma/klein/check_env")
async def ma_klein_check_env(request):
    from core.klein_wrapper import check_environment

    try:
        env = check_environment()
        return web.json_response(env)
    except Exception as e:
        logger.error(f"[Magic Klein] check_environment error: {e}")
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/ma/klein/patch_env")
async def ma_klein_patch_env(request):
    from core.klein_wrapper import install_wrapper_to_nunchaku, check_environment

    try:
        body = await request.json() if request.can_read_body else {}
        force_update = bool(body.get("force_update", False))
    except Exception:
        force_update = False

    try:
        ok, msg = install_wrapper_to_nunchaku(force_update=force_update)
        env = check_environment()
        return web.json_response({
            "success": ok,
            "message": msg,
            "env": env,
        })
    except Exception as e:
        logger.error(f"[Magic Klein] patch_env error: {e}")
        return web.json_response({"error": str(e)}, status=500)


# ---------------------------------------------------------------------------
# Environment check
# ---------------------------------------------------------------------------

def _ensure_nunchaku_environment() -> bool:
    """
    Check nunchaku environment and patch if needed.

    Returns True if nunchaku is available with the wrapper installed.
    """
    global _ENVIRONMENT_CHECKED
    if _ENVIRONMENT_CHECKED:
        return True

    from core.klein_wrapper import check_environment, install_wrapper_to_nunchaku

    env = check_environment()

    logger.info(f"[Magic Klein] nunchaku found: {env['nunchaku_found']}")
    logger.info(f"[Magic Klein] transformer available: {env['transformer_available']}")
    logger.info(f"[Magic Klein] wrapper installed: {env['wrapper_installed']}")
    if env.get("suggestion"):
        logger.info(f"[Magic Klein] {env['suggestion']}")

    if env["needs_patch"]:
        logger.info("[Magic Klein] Patching nunchaku environment with FLUX.2 Klein wrapper...")
        ok, msg = install_wrapper_to_nunchaku()
        if ok:
            logger.info(f"[Magic Klein] Patch successful: {msg}")
        else:
            logger.error(f"[Magic Klein] Patch failed: {msg}")
            return False

    _ENVIRONMENT_CHECKED = True
    return env["nunchaku_found"] and env["transformer_available"]


def _get_safetensor_files() -> list:
    files = folder_paths.get_filename_list("diffusion_models")
    return [
        f for f in files
        if f.lower().endswith((".safetensors", ".sft"))
    ]


# ---------------------------------------------------------------------------
# Node class
# ---------------------------------------------------------------------------

class MagicKleinLoader:
    """
    Load Nunchaku FLUX.2 Klein quantized transformer models.

    This node uses the user's existing nunchaku installation and automatically
    patches it to add the missing FLUX.2 Klein wrapper (wrappers/klein.py) if needed.

    Supported models:
    - tonera/FLUX.2-klein-9B-Nunchaku (quantized by tonera, FP4/INT4)
      Place the quantized safetensors file in ComfyUI's diffusion_models/ folder.

    Key features:
    - Auto-patches missing wrapper files
    - Intelligent model caching (same model, different settings = no reload)
    - VRAM recommendation warnings
    - Supports bfloat16 / float16
    - Fully compatible with ComfyUI MODEL output
    """

    _cached_transformer = None
    _cached_path = None
    _cached_device = None
    _cached_dtype = None

    @classmethod
    def INPUT_TYPES(cls):
        safetensor_files = _get_safetensor_files()

        if not safetensor_files:
            safetensor_files = ["（未找到 .safetensors 模型文件）"]

        ngpus = torch.cuda.device_count()
        dtype_options = ["bfloat16", "float16"]

        return {
            "required": {
                "model_name": (
                    safetensor_files,
                    {
                        "tooltip": "Nunchaku FLUX.2 Klein model (.safetensors)",
                        "lazy": True,
                    },
                ),
                "device_id": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": max(0, ngpus - 1),
                        "step": 1,
                        "display": "number",
                        "tooltip": "GPU device ID",
                    },
                ),
                "data_type": (
                    dtype_options,
                    {
                        "default": "bfloat16",
                        "tooltip": "bfloat16 for Ada/Hopper+; use float16 for 20-series GPUs",
                    },
                ),
            },
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_model"
    CATEGORY = "✨ Magic Assistant"
    # ComfyUI API / Vue UI expect str here; dict breaks EditableText and shows UNKNOWN widgets.
    TITLE = "🔮 Magic Nunchaku FLUX.2 Klein Loader"
    DESCRIPTION = (
        "加载 Nunchaku FLUX.2 Klein 量化模型（tonera/FLUX.2-klein-9B-Nunchaku）；"
        "独立版，无需官方 ComfyUI-nunchaku。首次请点节点上 ⚙️ 设置检查环境。"
        " / Load quantized FLUX.2 Klein (tonera weights). Click ⚙️ Settings on first use."
    )

    def load_model(
        self,
        model_name: str,
        device_id: int,
        data_type: str,
        **kwargs,
    ) -> Tuple:
        if not _ensure_nunchaku_environment():
            raise RuntimeError(
                "[Magic Klein Loader] nunchaku environment is not ready.\n"
                "Please install nunchaku in ComfyUI's embedded Python, or "
                "click the 'Settings' button on this node to install the wrapper."
            )

        # Import from the (patched) user nunchaku environment
        from nunchaku.models.transformers.transformer_flux2 import NunchakuFlux2Transformer2DModel
        from nunchaku.wrappers.klein import ComfyFlux2KleinWrapper

        # Monkey-patch: nunchaku 1.3.x is missing _patch_model on NunchakuFlux2Transformer2DModel.
        # Without this, from_pretrained() crashes at transformer._patch_model().
        if not hasattr(NunchakuFlux2Transformer2DModel, '_patch_model'):
            # Ensure offload attr exists on the class so forward() (which checks self.offload)
            # never raises AttributeError even if _patch_model isn't called.
            NunchakuFlux2Transformer2DModel.offload = False

            def _patch_model(self, precision=None, rank=32, torch_dtype=torch.bfloat16, **kwargs):
                from nunchaku.models.transformers.transformer_flux2 import (
                    NunchakuFlux2TransformerBlock,
                    NunchakuFlux2SingleTransformerBlock,
                )
                self.offload = False  # forward() checks this
                for i, block in enumerate(self.transformer_blocks):
                    self.transformer_blocks[i] = NunchakuFlux2TransformerBlock(
                        block, precision=precision, rank=rank, torch_dtype=torch_dtype, **kwargs
                    )
                for i, block in enumerate(self.single_transformer_blocks):
                    self.single_transformer_blocks[i] = NunchakuFlux2SingleTransformerBlock(
                        block, precision=precision, rank=rank, torch_dtype=torch_dtype, **kwargs
                    )
                return self
            NunchakuFlux2Transformer2DModel._patch_model = _patch_model

        if model_name.startswith("（未找到"):
            raise ValueError(
                "No .safetensors model files found. "
                "Please place your Nunchaku FLUX.2 Klein .safetensors file in ComfyUI's "
                "'models/diffusion_models/' directory."
            )

        device = torch.device(f"cuda:{device_id}")
        torch_dtype = torch.float16 if data_type == "float16" else torch.bfloat16

        model_path = folder_paths.get_full_path_or_raise("diffusion_models", model_name)

        if device_id >= torch.cuda.device_count():
            raise ValueError(
                f"Invalid device_id {device_id}. Only {torch.cuda.device_count()} GPU(s) available."
            )

        gpu_props = torch.cuda.get_device_properties(device_id)
        gpu_mem_mib = gpu_props.total_memory / (1024**2)
        gpu_name = gpu_props.name
        logger.info(f"[Magic Klein] GPU {device_id} ({gpu_name}): {gpu_mem_mib:.0f} MiB")

        if gpu_mem_mib < 14336:
            logger.warning(
                f"[Magic Klein] GPU VRAM ({gpu_mem_mib:.0f} MiB) < 14 GiB. "
                "FLUX.2 Klein with nunchaku int4 may require significant VRAM. "
                "Consider using a GPU with more memory."
            )

        cache_key = (model_path, str(device), data_type)
        reload = (
            self._cached_path != cache_key[0]
            or self._cached_device != cache_key[1]
            or self._cached_dtype != cache_key[2]
        )

        if reload:
            if self._cached_transformer is not None:
                old_transformer = self._cached_transformer
                self._cached_transformer = None
                self._cached_path = None
                self._cached_device = None
                self._cached_dtype = None
                
                try:
                    old_transformer.to("cpu")
                except Exception:
                    pass
                
                del old_transformer
                gc.collect()
                comfy.model_management.cleanup_models_gc()
                comfy.model_management.soft_empty_cache()

            logger.info(f"[Magic Klein] Loading model from: {model_path}")
            transformer, metadata = NunchakuFlux2Transformer2DModel.from_pretrained(
                model_path,
                offload=False,
                device=device,
                torch_dtype=torch_dtype,
                return_metadata=True,
            )
            self._cached_transformer = transformer
            self._cached_path = model_path
            self._cached_device = str(device)
            self._cached_dtype = data_type
            logger.info("[Magic Klein] Model loaded successfully")
        else:
            transformer = self._cached_transformer
            metadata = {}

        comfy_config = self._build_comfy_config(metadata)

        model_class_name = comfy_config.get("model_class", "Flux2")
        model_config_dict = comfy_config["model_config"]

        if "disable_unet_model_creation" not in model_config_dict:
            model_config_dict["disable_unet_model_creation"] = True

        if model_class_name == "Flux2":
            from comfy.supported_models import Flux2
            model_class = Flux2
        else:
            from comfy.supported_models import Flux2
            model_class = Flux2
            logger.warning(f"[Magic Klein] Unknown model class '{model_class_name}', using Flux2")

        model_config = model_class(model_config_dict)
        model_config.set_inference_dtype(torch.bfloat16, None)
        model_config.custom_operations = None

        model = model_config.get_model({})

        offload_device = comfy.model_management.unet_offload_device()
        model.diffusion_model = ComfyFlux2KleinWrapper(
            transformer,
            config=comfy_config["model_config"],
            ctx_for_copy={
                "comfy_config": comfy_config,
                "model_config": model_config,
                "load_device": device,
                "offload_device": offload_device,
            },
        )

        patcher = comfy.model_patcher.CoreModelPatcher(
            model,
            load_device=device,
            offload_device=offload_device,
        )
        return (patcher,)

    def _build_comfy_config(self, metadata: dict) -> dict:
        """Build ComfyUI model config from model metadata or defaults."""
        if metadata:
            comfy_config_str = metadata.get("comfy_config")
            if comfy_config_str:
                parsed = json.loads(comfy_config_str)
                if parsed.get("model_config"):
                    return parsed

            diffusers_cfg_str = metadata.get("config")
            if diffusers_cfg_str:
                dc = json.loads(diffusers_cfg_str)
                return {
                    "model_class": "Flux2",
                    "model_config": {
                        "image_model": "flux2",
                        "in_channels": 16,
                        "out_channels": 128,
                        "hidden_size": 3072,
                        "context_in_dim": 4096,
                        "vec_in_dim": 768,
                        "num_heads": dc.get("num_attention_heads", 32),
                        "depth": dc.get("num_layers", 8),
                        "depth_single_blocks": dc.get("num_single_layers", 24),
                        "axes_dim": dc.get("axes_dims_rope", [32, 32, 32, 32]),
                        "theta": dc.get("rope_theta", 2000),
                        "patch_size": dc.get("patch_size", 1),
                        "guidance_embed": dc.get("guidance_embeds", False),
                        "global_modulation": True,
                        "mlp_silu_act": True,
                        "qkv_bias": False,
                        "ops_bias": False,
                        "default_ref_method": "index",
                        "ref_index_scale": 10.0,
                        "txt_ids_dims": [3],
                    },
                }

        return {
            "model_class": "Flux2",
            "model_config": {
                "image_model": "flux2",
                "in_channels": 16,
                "out_channels": 128,
                "hidden_size": 3072,
                "context_in_dim": 4096,
                "vec_in_dim": 768,
                "num_heads": 48,
                "depth": 24,
                "depth_single_blocks": 24,
                "axes_dim": [32, 32, 32, 32],
                "theta": 2000,
                "patch_size": 1,
                "guidance_embed": False,
                "global_modulation": True,
                "mlp_silu_act": True,
                "qkv_bias": False,
                "ops_bias": False,
                "default_ref_method": "index",
                "ref_index_scale": 10.0,
                "txt_ids_dims": [3],
            },
        }
