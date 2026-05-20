"""
Magic Assistant Core - SDNQ Support

SDNQ support is lazily loaded via sdnq_lazy to avoid blocking plugin
startup when SDNQ packages (sdnq, diffusers, transformers, etc.) are missing
or have import errors.
"""

# Re-export everything from sdnq_lazy so that `from core import ...` statements
# throughout the plugin are drop-in compatible.
from .sdnq_lazy import (
    get_sdnq_models_dir,
    get_dtype_from_string,
    get_model_names_for_dropdown,
    get_model_info,
    get_repo_id_from_name,
    download_model,
    get_cached_model_path,
    check_model_cached,
    wrap_pipeline_components,
    DiffusersVAEFromComfy,
    load_body_only_pipeline,
)

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
    "DiffusersVAEFromComfy",
    "load_body_only_pipeline",
]
