"""
Magic Assistant Core - SDNQ Support

SDNQ model loading and compatibility utilities.
"""

from .sdnq_config import get_sdnq_models_dir, get_dtype_from_string
from .sdnq_registry import (
    get_model_names_for_dropdown,
    get_model_info,
    get_repo_id_from_name,
)
from .sdnq_downloader import (
    download_model,
    get_cached_model_path,
    check_model_cached,
)
from .sdnq_wrapper import wrap_pipeline_components

__all__ = [
    "get_sdnq_models_dir",
    "get_dtype_from_string",
    "get_model_names_for_dropdown",
    "get_model_info",
    "get_repo_id_from_name",
    "download_model",
    "get_cached_model_path",
    "check_model_cached",
    "wrap_pipeline_components",
]
