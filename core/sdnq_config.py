"""
SDNQ Configuration - Model paths and dtype helpers
"""

import os
import torch
from typing import Optional


def get_sdnq_models_dir() -> str:
    """
    Get the directory where SDNQ models should be stored.
    Uses ComfyUI's models/diffusers/ folder, creating an 'sdnq' subdirectory.
    """
    try:
        import folder_paths
        diffusers_dirs = folder_paths.get_folder_paths("diffusers")
        if diffusers_dirs and len(diffusers_dirs) > 0:
            base_dir = diffusers_dirs[0]
            sdnq_dir = os.path.join(base_dir, "sdnq")
            os.makedirs(sdnq_dir, exist_ok=True)
            return sdnq_dir
    except (ImportError, Exception) as e:
        if isinstance(e, Exception):
            print(f"[SDNQ] Warning: Could not access ComfyUI models folder: {e}")

    fallback_dir = os.path.expanduser("~/.cache/comfyui/models/diffusers/sdnq")
    os.makedirs(fallback_dir, exist_ok=True)
    return fallback_dir


def get_dtype_from_string(dtype_str: str) -> torch.dtype:
    """Convert string dtype to torch dtype."""
    dtype_map = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }
    if dtype_str not in dtype_map:
        raise ValueError(f"Unsupported dtype: {dtype_str}. Supported: {list(dtype_map.keys())}")
    return dtype_map[dtype_str]
