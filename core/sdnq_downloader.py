"""
SDNQ Model Downloader - HuggingFace Hub integration
"""

import os
import time
from typing import Optional
from .sdnq_config import get_sdnq_models_dir


os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def download_model(
    repo_id: str,
    cache_dir: Optional[str] = None,
    force_download: bool = False,
    max_workers: int = 8
) -> str:
    """Download SDNQ model from HuggingFace to ComfyUI models folder."""
    if cache_dir is None:
        sdnq_base_dir = get_sdnq_models_dir()
    else:
        sdnq_base_dir = cache_dir

    model_name = repo_id.replace("/", "--")
    model_dir = os.path.join(sdnq_base_dir, model_name)

    if not force_download and os.path.exists(os.path.join(model_dir, "model_index.json")):
        print(f"[SDNQ] Model already exists at: {model_dir}")
        return model_dir

    print(f"\n[SDNQ] Downloading from HuggingFace: {repo_id}")
    from huggingface_hub import snapshot_download

    local_path = snapshot_download(
        repo_id=repo_id,
        local_dir=model_dir,
        local_dir_use_symlinks=False,
        force_download=force_download,
        max_workers=max_workers,
    )
    print(f"[SDNQ] Download complete: {local_path}")
    return local_path


def get_cached_model_path(repo_id: str, cache_dir: Optional[str] = None) -> Optional[str]:
    """Get path to downloaded model if it exists."""
    if cache_dir is None:
        sdnq_base_dir = get_sdnq_models_dir()
    else:
        sdnq_base_dir = cache_dir

    model_name = repo_id.replace("/", "--")
    local_model_dir = os.path.join(sdnq_base_dir, model_name)

    if os.path.exists(os.path.join(local_model_dir, "model_index.json")):
        return local_model_dir

    try:
        from huggingface_hub import try_to_load_from_cache
        cached_path = try_to_load_from_cache(repo_id=repo_id, filename="model_index.json")
        if cached_path and cached_path != "_not_found_":
            return os.path.dirname(cached_path)
    except Exception:
        pass
    return None


def check_model_cached(repo_id: str, cache_dir: Optional[str] = None) -> bool:
    """Check if model is already downloaded."""
    path = get_cached_model_path(repo_id, cache_dir)
    return path is not None and os.path.exists(path)
