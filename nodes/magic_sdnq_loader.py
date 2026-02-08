"""
Magic SDNQ Loader - Load SDNQ quantized models with MODEL, CLIP, VAE outputs.

SDNQ provides 50-75% VRAM savings. Outputs work with Magic Power LoRA (SDNQ mode).
Requires: sdnq, diffusers, huggingface_hub
"""

import os
import sys
import torch
import gc
import subprocess
from typing import Tuple, Optional

# Add parent for core imports
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

from core.sdnq_config import get_dtype_from_string
from core.sdnq_registry import get_model_names_for_dropdown, get_repo_id_from_name, get_model_info
from core.sdnq_downloader import download_model, check_model_cached, get_cached_model_path
from core.sdnq_wrapper import wrap_pipeline_components


def _check_cpp_compiler() -> bool:
    """Check if C++ compiler is available (needed for torch.compile on Windows)."""
    if sys.platform != "win32":
        return True
    try:
        subprocess.run(["cl"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _cleanup_resources(pipeline=None, force=True):
    """Cleanup pipeline and torch state to prevent session corruption."""
    try:
        if pipeline is not None:
            try:
                if hasattr(pipeline, 'to'):
                    pipeline.to('cpu')
            except Exception:
                pass
            del pipeline
        if force:
            gc.collect()
            gc.collect()
            if torch.cuda.is_available():
                try:
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
                    torch.cuda.reset_peak_memory_stats()
                except Exception:
                    pass
            try:
                torch._dynamo.reset()
            except Exception:
                pass
            gc.collect()
    except Exception as e:
        print(f"[SDNQ] Cleanup warning: {e}")


class MagicSDNQLoader:
    """
    Load SDNQ quantized models. Outputs MODEL, CLIP, VAE for use with Magic Power LoRA (SDNQ mode).
    """

    @classmethod
    def INPUT_TYPES(cls):
        model_options = ["--Custom Model--"] + get_model_names_for_dropdown()
        return {
            "required": {
                "model_selection": (model_options, {
                    "default": model_options[1] if len(model_options) > 1 else model_options[0],
                }),
                "dtype": (["bfloat16", "float16", "float32"], {"default": "bfloat16"}),
                "memory_mode": (["gpu", "balanced", "lowvram"], {
                    "default": "balanced",
                    "tooltip": "gpu=全显存(24GB+), balanced=CPU卸载(12-16GB), lowvram=顺序卸载(8GB)"
                }),
                "use_quantized_matmul": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "custom_repo_or_path": ("STRING", {"default": "", "multiline": False}),
                "auto_download": ("BOOLEAN", {"default": True, "tooltip": "模型未缓存时自动从 HuggingFace 下载"}),
                "use_xformers": ("BOOLEAN", {"default": True, "tooltip": "xFormers 注意力 (10-45% 加速)。未安装时回退到 SDPA"}),
                "use_torch_compile": ("BOOLEAN", {"default": False, "tooltip": "torch.compile 加速 (1.8-3x)。使用 max-autotune-no-cudagraphs 避免 cudaMallocAsync 报错。首次运行需编译约 30-60 秒"}),
                "enable_vae_tiling": ("BOOLEAN", {"default": False, "tooltip": "大图时 VAE 分块处理省显存"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "load_model"
    CATEGORY = "✨ Magic Assistant"

    def load_model(
        self,
        model_selection: str,
        dtype: str,
        memory_mode: str = "balanced",
        use_quantized_matmul: bool = True,
        custom_repo_or_path: str = "",
        auto_download: bool = True,
        use_xformers: bool = True,
        use_torch_compile: bool = False,
        enable_vae_tiling: bool = False,
    ) -> Tuple:
        if model_selection == "--Custom Model--":
            if not custom_repo_or_path or not custom_repo_or_path.strip():
                raise ValueError(
                    "Custom Model selected but no repo ID or path provided. "
                    "Enter a HuggingFace repo ID (e.g. Disty0/FLUX.1-dev-qint8) or local path."
                )
            model_path = custom_repo_or_path.strip()
            model_info = None
        else:
            repo_id = get_repo_id_from_name(model_selection)
            if not repo_id:
                raise ValueError(f"Invalid model selection: {model_selection}")
            model_info = get_model_info(model_selection)
            model_path = repo_id
            if check_model_cached(repo_id):
                cached = get_cached_model_path(repo_id)
                if cached:
                    model_path = cached
            elif auto_download:
                model_path = download_model(repo_id)
            else:
                from core.sdnq_config import get_sdnq_models_dir
                sdnq_dir = get_sdnq_models_dir()
                raise ValueError(
                    f"Model not cached. Enable 'auto_download' to download from HuggingFace, "
                    f"or manually place model in: {sdnq_dir}"
                )

        model_path = model_path.strip()
        torch_dtype = get_dtype_from_string(dtype)
        is_local = os.path.exists(model_path)
        compiler_available = _check_cpp_compiler()

        if not compiler_available:
            torch._dynamo.config.suppress_errors = True
            torch._dynamo.config.verbose = False
            print("[SDNQ] ℹ C++ compiler not found - suppressing torch.compile errors; will still attempt Quantized MatMul")

        print(f"[SDNQ] Loading model from: {model_path}")
        print(f"[SDNQ] Using dtype: {dtype} ({torch_dtype})")
        print(f"[SDNQ] Memory mode: {memory_mode} (gpu=全显存24GB+, balanced=CPU卸载12-16GB, lowvram=顺序卸载8GB)")
        print("[SDNQ] Pre-load cleanup...")
        gc.collect()
        if torch.cuda.is_available():
            try:
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
            except Exception:
                pass
        try:
            torch._dynamo.reset()
        except Exception:
            pass

        pipeline = None
        try:
            # Register SDNQ with diffusers
            try:
                from sdnq import SDNQConfig
            except ImportError:
                raise RuntimeError(
                    "SDNQ support requires the 'sdnq' package. Install with: pip install sdnq"
                )

            print("[SDNQ] Loading pipeline (DiffusionPipeline auto-detects SDNQ from config)...")
            pipeline = __import__("diffusers").DiffusionPipeline.from_pretrained(
                model_path,
                torch_dtype=torch_dtype,
                local_files_only=is_local,
                attn_implementation="sdpa",
            )

            # Optional SDNQ optimizations (Quantized MatMul)
            # 与 comfyui-sdnq 一致：强制尝试应用，可带来 30-80% 加速
            # 不检查 compiler_available / triton_ok，直接尝试；失败则回退
            qmatmul_ok = False
            if use_quantized_matmul and torch.cuda.is_available():
                _orig_use_torch_compile = None
                try:
                    import sdnq.common
                    _orig_use_torch_compile = getattr(sdnq.common, "use_torch_compile", None)
                    sdnq.common.use_torch_compile = True  # 强制启用，与 comfyui-sdnq 的 _triton_available=True 等效
                    from sdnq.loader import apply_sdnq_options_to_model
                    print("[SDNQ] Applying Triton Quantized MatMul optimizations...")
                    if hasattr(pipeline, 'transformer') and pipeline.transformer is not None:
                        pipeline.transformer = apply_sdnq_options_to_model(
                            pipeline.transformer, use_quantized_matmul=True
                        )
                        qmatmul_ok = True
                        print("[SDNQ] ✓ Optimization applied to transformer")
                    if hasattr(pipeline, 'unet') and pipeline.unet is not None:
                        pipeline.unet = apply_sdnq_options_to_model(
                            pipeline.unet, use_quantized_matmul=True
                        )
                        qmatmul_ok = True
                        print("[SDNQ] ✓ Optimization applied to UNet")
                    # text_encoder：官方 Flux2Klein 示例会应用，VL 模型（Qwen-Image 等）可能因维度非 8 倍数失败，单独 try 避免影响其他组件
                    if hasattr(pipeline, 'text_encoder') and pipeline.text_encoder is not None:
                        try:
                            pipeline.text_encoder = apply_sdnq_options_to_model(
                                pipeline.text_encoder, use_quantized_matmul=True
                            )
                            qmatmul_ok = True
                            print("[SDNQ] ✓ Optimization applied to text_encoder")
                        except Exception as te_err:
                            print(f"[SDNQ] ℹ️ text_encoder optimization skipped: {te_err}")
                    if hasattr(pipeline, 'text_encoder_2') and pipeline.text_encoder_2 is not None:
                        try:
                            pipeline.text_encoder_2 = apply_sdnq_options_to_model(
                                pipeline.text_encoder_2, use_quantized_matmul=True
                            )
                            qmatmul_ok = True
                            print("[SDNQ] ✓ Optimization applied to text_encoder_2")
                        except Exception as te2_err:
                            print(f"[SDNQ] ℹ️ text_encoder_2 optimization skipped: {te2_err}")
                except Exception as e:
                    print(f"[SDNQ] ⚠️ Failed to apply optimizations: {e}")
                    print("[SDNQ] Continuing without optimizations...")
                finally:
                    try:
                        if _orig_use_torch_compile is not None:
                            sdnq.common.use_torch_compile = _orig_use_torch_compile
                    except NameError:
                        pass
            elif use_quantized_matmul and not torch.cuda.is_available():
                print("[SDNQ] ℹ️ Quantized MatMul requires CUDA. Optimization disabled.")
            elif not use_quantized_matmul:
                print("[SDNQ] Quantized MatMul optimization disabled")

            # torch.compile 延后到 Sampler 执行（在 LoRA 加载之后），否则 PEFT 无法注入 adapter
            # 与 comfyui-sdnq 一致：Loader 不 compile，保证 LoRA 能正常加载
            compile_ok = False
            pipeline._sdnq_use_torch_compile = False
            if use_torch_compile and torch.cuda.is_available():
                pipeline._sdnq_use_torch_compile = True
                compile_ok = True
                print("[SDNQ] ✓ torch.compile 将在首次采样时应用（LoRA 加载后再 compile）")

            # xFormers (must be before memory management)
            # 若用户勾选但未安装 xformers，会静默回退到 SDPA，不会报错
            xformers_ok = False
            if use_xformers:
                try:
                    import xformers  # noqa: F401
                    print("[SDNQ] Enabling xFormers memory-efficient attention...")
                    pipeline.enable_xformers_memory_efficient_attention()
                    xformers_ok = True
                    print("[SDNQ] ✓ xFormers memory-efficient attention enabled")
                except (ImportError, ModuleNotFoundError) as e:
                    print(f"[SDNQ] ⚠️ xFormers not installed (skipped): {e}")
                    print("[SDNQ] Using SDPA instead. To use xFormers: pip install xformers")
                except Exception as e:
                    print(f"[SDNQ] ⚠️ xFormers failed (skipped): {e}")
                    print("[SDNQ] Using SDPA instead")
            else:
                print("[SDNQ] Using SDPA (scaled dot product attention, PyTorch 2.0+ default)")

            # Memory management
            if memory_mode == "gpu":
                print("[SDNQ] Moving model to GPU (full GPU mode)...")
                pipeline.to("cuda")
                print("[SDNQ] ✓ Model loaded to GPU (all components on VRAM)")
            elif memory_mode == "balanced":
                print("[SDNQ] Enabling model CPU offload (balanced mode)...")
                pipeline.enable_model_cpu_offload()
                print("[SDNQ] ✓ Model offloading enabled (efficient VRAM usage)")
            elif memory_mode == "lowvram":
                print("[SDNQ] Enabling sequential CPU offload (low VRAM mode)...")
                pipeline.enable_sequential_cpu_offload()
                print("[SDNQ] ✓ Sequential offloading enabled (minimal VRAM usage)")

            # VAE tiling
            vae_tiling_ok = False
            if enable_vae_tiling:
                try:
                    pipeline.enable_vae_tiling()
                    vae_tiling_ok = True
                    print("[SDNQ] ✓ VAE tiling enabled")
                except Exception as e:
                    print(f"[SDNQ] ⚠️ VAE tiling failed: {e}")

            model_type = (model_info or {}).get("type")
            model, clip, vae = wrap_pipeline_components(pipeline, model_type=model_type)

            # 加载完成汇总：当前模式、成功状态
            mode_desc = {"gpu": "全显存(24GB+)", "balanced": "CPU 卸载(12-16GB)", "lowvram": "顺序卸载(8GB)"}.get(memory_mode, memory_mode)
            attn_desc = "xFormers" if xformers_ok else "SDPA"
            print(f"\n{'='*50}")
            print("[SDNQ] ✓ 加载完成 (Model loaded successfully)")
            print(f"{'='*50}")
            print(f"  当前模式: {memory_mode} ({mode_desc})")
            print(f"  注意力: {attn_desc}")
            print(f"  Quantized MatMul: {'已启用' if qmatmul_ok else '未启用'}")
            print(f"  torch.compile: {'已启用' if compile_ok else '未启用'}")
            print(f"  VAE Tiling: {'已启用' if vae_tiling_ok else '未启用'}")
            print(f"  Pipeline: {type(pipeline).__name__}")
            print(f"{'='*50}\n")
            return (model, clip, vae)

        except Exception as e:
            err_str = str(e)
            print(f"\n{'='*60}")
            print("✗ [SDNQ] Model loading failed!")
            print(f"{'='*60}")
            print(f"Error: {err_str}")
            print(f"\nTroubleshooting:")
            print(f"  1. Verify model path / repo ID is correct")
            print(f"  2. For HuggingFace: check internet connection")
            print(f"  3. Ensure model is SDNQ-quantized")
            print(f"  4. pip install sdnq huggingface-hub")
            print(f"  5. For Qwen/VL models: pip install --upgrade transformers diffusers")
            print(f"{'='*60}\n")

            _cleanup_resources(pipeline, force=True)
            print("[SDNQ] ✓ Cleanup complete - session should remain stable")

            # 针对性错误提示
            if "Config" in err_str and ("has no attribute" in err_str or "object has no attribute" in err_str):
                raise RuntimeError(
                    f"SDNQ 加载失败 (transformers/diffusers 版本不兼容)\n\n"
                    f"错误: {err_str}\n\n"
                    f"修复: pip install --upgrade transformers diffusers\n"
                    f"或: pip install git+https://github.com/huggingface/transformers.git"
                ) from e
            if any(x in err_str for x in ["does not recognize", "Unrecognized", "not supported", "quantization"]):
                raise RuntimeError(
                    f"SDNQ 加载失败 (库版本过旧)\n\n"
                    f"错误: {err_str}\n\n"
                    f"修复: pip install --upgrade transformers diffusers sdnq"
                ) from e

            raise RuntimeError(
                f"SDNQ 加载失败: {err_str}\n\n"
                f"排查: 1) 检查路径/repo 2) 网络 3) pip install sdnq 4) 更新 transformers diffusers"
            ) from e
