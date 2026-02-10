"""
SDNQ body-only loading: load only transformer (+ scheduler) and use external CLIP/VAE.

When user connects CLIP and VAE to the loader, we load only the model body (e.g. ~5GB for
Klein 9B) and build the pipeline with wrapped external VAE and placeholder text_encoder/tokenizer
(since Sampler always passes prompt_embeds, the pipeline never uses them).
"""

import os
import torch
import torch.nn as nn
from typing import Optional, Tuple, Any

# Placeholder text encoder: pipeline requires one but we always pass prompt_embeds, so it's never used.
class _DummyTextEncoder(nn.Module):
    def __init__(self, hidden_size: int = 12288, device=None, dtype=None):
        super().__init__()
        self._hidden_size = hidden_size
        self._dummy = nn.Parameter(torch.zeros(1, 1, hidden_size, dtype=dtype or torch.bfloat16))
        if device is not None:
            self.to(device)

    @property
    def dtype(self):
        """Diffusers pipeline checks module.dtype (e.g. in enable_model_cpu_offload)."""
        return self._dummy.dtype

    @property
    def config(self):
        return type("C", (), {"hidden_size": self._hidden_size})()

    def forward(self, input_ids=None, attention_mask=None, output_hidden_states=False, use_cache=False, **kwargs):
        batch = 1
        if input_ids is not None and hasattr(input_ids, "shape"):
            batch = input_ids.shape[0]
        # Return dummy embeddings (batch, 1, hidden_size) so any accidental use doesn't crash
        out = self._dummy.expand(batch, 1, self._hidden_size)
        if output_hidden_states:
            return type("O", (), {"last_hidden_state": out, "hidden_states": (out,)})
        return type("O", (), {"last_hidden_state": out})()


def _load_flux2klein_body_only(
    model_path: str,
    torch_dtype: torch.dtype,
    is_local: bool,
    external_vae_for_diffusers,
    use_quantized_matmul: bool,
) -> Any:
    """
    Load only transformer + scheduler for Flux2Klein, build pipeline with external VAE
    and placeholder text_encoder/tokenizer. Returns the pipeline.
    """
    from sdnq import SDNQConfig  # noqa: F401 - register SDNQ
    from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel, FlowMatchEulerDiscreteScheduler

    # Load transformer only (SDNQ reads quantization_config from transformer subfolder)
    print("[SDNQ] Loading transformer only (body-only mode)...")
    transformer = Flux2Transformer2DModel.from_pretrained(
        model_path,
        subfolder="transformer",
        torch_dtype=torch_dtype,
        local_files_only=is_local,
    )
    if use_quantized_matmul and torch.cuda.is_available():
        try:
            from sdnq.loader import apply_sdnq_options_to_model
            transformer = apply_sdnq_options_to_model(transformer, use_quantized_matmul=True)
            print("[SDNQ] ✓ Quantized MatMul applied to transformer")
        except Exception as e:
            print(f"[SDNQ] ℹ️ Quantized MatMul skipped: {e}")

    # Load scheduler only
    print("[SDNQ] Loading scheduler...")
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
        model_path,
        subfolder="scheduler",
        local_files_only=is_local,
    )

    # Load tokenizer from repo (small, no heavy weights)
    print("[SDNQ] Loading tokenizer (for pipeline constructor)...")
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(
            model_path,
            subfolder="tokenizer",
            local_files_only=is_local,
        )
    except Exception as e:
        print(f"[SDNQ] ⚠️ Tokenizer load failed, using minimal placeholder: {e}")
        tokenizer = _minimal_tokenizer_placeholder()

    # Placeholder text encoder (never used when prompt_embeds are passed)
    text_encoder = _DummyTextEncoder(hidden_size=12288, dtype=torch_dtype)

    # Build pipeline with external VAE and placeholders
    print("[SDNQ] Building Flux2KleinPipeline (body + external VAE)...")
    pipeline = Flux2KleinPipeline(
        transformer=transformer,
        scheduler=scheduler,
        vae=external_vae_for_diffusers,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        is_distilled=True,
    )
    return pipeline


def _minimal_tokenizer_placeholder():
    """Return a minimal object that quacks like a tokenizer (__call__ returns input_ids, attention_mask)."""
    class _DummyTokenizer:
        def __call__(self, text=None, return_tensors="pt", padding=True, **kwargs):
            # Return minimal tensors so pipeline doesn't crash if it ever uses them
            return {"input_ids": torch.zeros(1, 8, dtype=torch.long), "attention_mask": torch.ones(1, 8, dtype=torch.long)}
    return _DummyTokenizer()


def _load_flux_body_only(
    model_path: str,
    torch_dtype: torch.dtype,
    is_local: bool,
    external_vae_for_diffusers,
    use_quantized_matmul: bool,
) -> Any:
    """
    Load only transformer + scheduler for FLUX.1 (FluxPipeline), build pipeline with
    external VAE and placeholder text_encoder/tokenizer. Same idea as Flux2Klein.
    """
    from sdnq import SDNQConfig  # noqa: F401 - register SDNQ
    from diffusers import FluxPipeline, FluxTransformer2DModel, FlowMatchEulerDiscreteScheduler

    print("[SDNQ] Loading FLUX transformer only (body-only mode)...")
    transformer = FluxTransformer2DModel.from_pretrained(
        model_path,
        subfolder="transformer",
        torch_dtype=torch_dtype,
        local_files_only=is_local,
    )
    if use_quantized_matmul and torch.cuda.is_available():
        try:
            from sdnq.loader import apply_sdnq_options_to_model
            transformer = apply_sdnq_options_to_model(transformer, use_quantized_matmul=True)
            print("[SDNQ] ✓ Quantized MatMul applied to transformer")
        except Exception as e:
            print(f"[SDNQ] ℹ️ Quantized MatMul skipped: {e}")

    print("[SDNQ] Loading scheduler...")
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
        model_path,
        subfolder="scheduler",
        local_files_only=is_local,
    )

    print("[SDNQ] Loading tokenizer (for pipeline constructor)...")
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(
            model_path,
            subfolder="tokenizer",
            local_files_only=is_local,
        )
    except Exception as e:
        print(f"[SDNQ] ⚠️ Tokenizer load failed, using minimal placeholder: {e}")
        tokenizer = _minimal_tokenizer_placeholder()

    # FLUX.1 使用 T5，hidden_size=4096 (T5-XXL)
    text_encoder = _DummyTextEncoder(hidden_size=4096, dtype=torch_dtype)

    print("[SDNQ] Building FluxPipeline (body + external VAE)...")
    pipeline = FluxPipeline(
        transformer=transformer,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        vae=external_vae_for_diffusers,
        scheduler=scheduler,
    )
    return pipeline


def load_body_only_pipeline(
    model_path: str,
    model_type: Optional[str],
    torch_dtype: torch.dtype,
    is_local: bool,
    external_vae_for_diffusers,
    use_quantized_matmul: bool,
) -> Any:
    """
    Load only the model body (transformer + scheduler) and build pipeline with
    external VAE and placeholder text_encoder/tokenizer.
    Supported: FLUX2 (Flux2Klein), FLUX (FluxPipeline). Qwen/others fall back to None.
    """
    if model_type and "FLUX2" in model_type.upper():
        return _load_flux2klein_body_only(
            model_path=model_path,
            torch_dtype=torch_dtype,
            is_local=is_local,
            external_vae_for_diffusers=external_vae_for_diffusers,
            use_quantized_matmul=use_quantized_matmul,
        )
    if model_type and "FLUX" in model_type.upper() and "FLUX2" not in model_type.upper():
        try:
            return _load_flux_body_only(
                model_path=model_path,
                torch_dtype=torch_dtype,
                is_local=is_local,
                external_vae_for_diffusers=external_vae_for_diffusers,
                use_quantized_matmul=use_quantized_matmul,
            )
        except Exception as e:
            print(f"[SDNQ] FLUX body-only load failed: {e}, falling back to full load")
            return None
    # Custom model: detect from model_index.json
    model_index_path = os.path.join(model_path, "model_index.json")
    if os.path.isfile(model_index_path):
        import json
        with open(model_index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
        class_name = (index.get("_class_name") or "").lower()
        if "flux2klein" in class_name:
            return _load_flux2klein_body_only(
                model_path=model_path,
                torch_dtype=torch_dtype,
                is_local=is_local,
                external_vae_for_diffusers=external_vae_for_diffusers,
                use_quantized_matmul=use_quantized_matmul,
            )
        if "fluxpipeline" in class_name and "flux2" not in class_name:
            try:
                return _load_flux_body_only(
                    model_path=model_path,
                    torch_dtype=torch_dtype,
                    is_local=is_local,
                    external_vae_for_diffusers=external_vae_for_diffusers,
                    use_quantized_matmul=use_quantized_matmul,
                )
            except Exception as e:
                print(f"[SDNQ] FLUX body-only (from index) failed: {e}")
    return None
