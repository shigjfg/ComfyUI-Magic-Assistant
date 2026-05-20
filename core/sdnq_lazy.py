"""
Lazy-loads all core.sdnq_* modules on first access.

Usage:
    from core.sdnq_lazy import (
        get_sdnq_models_dir, get_dtype_from_string,
        get_model_names_for_dropdown, get_model_info, get_repo_id_from_name,
        download_model, get_cached_model_path, check_model_cached,
        wrap_pipeline_components,
    )

All re-exports mirror core/__init__.py's old __all__ so callers are drop-in
compatible.
"""

import sys
import importlib

# The modules that contain SDNQ-only code.
_SDNQ_SUBMODULES = (
    "sdnq_config",
    "sdnq_registry",
    "sdnq_downloader",
    "sdnq_body_only",
    "sdnq_wrapper",
)


def _load_sdnq_submodule(name: str):
    """Lazily import and cache a core.sdnq_* submodule."""
    if name in _SDNQ_SUBMODULES:
        full = f"core.{name}"
    else:
        full = name
    if full not in sys.modules:
        import core
        importlib.import_module(full)
    return sys.modules[full]


def __getattr__(name: str):
    """PEP 562 – module-level __getattr__ for lazy attribute lookup."""

    # ---------- core.sdnq_config ----------
    if name == "get_sdnq_models_dir":
        mod = _load_sdnq_submodule("sdnq_config")
        return mod.get_sdnq_models_dir
    if name == "get_dtype_from_string":
        mod = _load_sdnq_submodule("sdnq_config")
        return mod.get_dtype_from_string

    # ---------- core.sdnq_registry ----------
    if name == "get_model_names_for_dropdown":
        mod = _load_sdnq_submodule("sdnq_registry")
        return mod.get_model_names_for_dropdown
    if name == "get_model_info":
        mod = _load_sdnq_submodule("sdnq_registry")
        return mod.get_model_info
    if name == "get_repo_id_from_name":
        mod = _load_sdnq_submodule("sdnq_registry")
        return mod.get_repo_id_from_name

    # ---------- core.sdnq_downloader ----------
    if name == "download_model":
        mod = _load_sdnq_submodule("sdnq_downloader")
        return mod.download_model
    if name == "get_cached_model_path":
        mod = _load_sdnq_submodule("sdnq_downloader")
        return mod.get_cached_model_path
    if name == "check_model_cached":
        mod = _load_sdnq_submodule("sdnq_downloader")
        return mod.check_model_cached

    # ---------- core.sdnq_wrapper ----------
    if name == "wrap_pipeline_components":
        mod = _load_sdnq_submodule("sdnq_wrapper")
        return mod.wrap_pipeline_components
    if name == "DiffusersVAEFromComfy":
        mod = _load_sdnq_submodule("sdnq_wrapper")
        return mod.DiffusersVAEFromComfy

    # ---------- core.sdnq_body_only ----------
    if name == "load_body_only_pipeline":
        mod = _load_sdnq_submodule("sdnq_body_only")
        return mod.load_body_only_pipeline

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


# Mirror the old __all__ so other modules doing `from core.sdnq_lazy import *`
# still get a clean namespace.
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
