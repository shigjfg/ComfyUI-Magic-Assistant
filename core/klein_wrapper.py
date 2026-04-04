"""
Klein wrapper setup - add the missing FLUX.2 Klein wrapper to the user's nunchaku environment.

The standalone nunchaku pip package is missing nunchaku/wrappers/ which is needed for
ComfyUI integration. This module detects the situation and auto-patches by writing
the wrapper directly into the user's nunchaku site-packages.

The ComfyFlux2KleinWrapper source code is embedded here as a string constant, so this
works even if any other custom node directory is removed.

Path resolution:
  - Node location: ComfyUI/custom_nodes/ComfyUI-Magic-Assistant/core/
  - ComfyUI root:  ComfyUI/  (parent of custom_nodes/)
  - Python env:     ComfyUI_windows_portable/python_embeded/  (sibling of ComfyUI/)
"""
import ast
import os
import re
import sys

_NUNCHAKU_BASE = None
_COMFYUI_ROOT = None


def _detect_comfyui_root() -> str | None:
    """Infer ComfyUI root from this file's location.

    ComfyUI/custom_nodes/ComfyUI-Magic-Assistant/core/klein_wrapper.py
    -> ComfyUI/
    """
    global _COMFYUI_ROOT
    if _COMFYUI_ROOT is not None:
        return _COMFYUI_ROOT

    # core/klein_wrapper.py -> ComfyUI-Magic-Assistant -> custom_nodes -> ComfyUI root
    file_path = os.path.abspath(__file__)
    magic_assistant = os.path.dirname(os.path.dirname(file_path))  # core/ -> magic-assistant/
    custom_nodes = os.path.dirname(magic_assistant)               # magic-assistant/ -> custom_nodes/
    comfyui_root = os.path.dirname(custom_nodes)                   # custom_nodes/ -> ComfyUI/
    comfyui_root = os.path.normpath(comfyui_root)

    if os.path.isdir(comfyui_root):
        _COMFYUI_ROOT = comfyui_root
        return comfyui_root
    return None


def get_comfyui_python() -> str | None:
    """Return the path to ComfyUI's embedded Python executable."""
    comfyui_root = _detect_comfyui_root()
    if comfyui_root is None:
        return None
    # ComfyUI_windows_portable/python_embeded/python.exe
    parent = os.path.dirname(comfyui_root)  # ComfyUI/ -> ComfyUI_windows_portable/
    python_exe = os.path.join(parent, "python_embeded", "python.exe")
    if os.path.isfile(python_exe):
        return python_exe
    return None


def get_comfyui_python_lib() -> str | None:
    """Return the path to ComfyUI's embedded Python site-packages."""
    comfyui_python = get_comfyui_python()
    if comfyui_python is None:
        return None
    python_dir = os.path.dirname(comfyui_python)  # python_embeded/
    lib_dir = os.path.join(python_dir, "Lib", "site-packages")
    if os.path.isdir(lib_dir):
        return lib_dir
    return None


def _site_packages_from_python_exe(exe: str | None) -> str | None:
    """site-packages next to python.exe (portable embed / typical Windows layout)."""
    if not exe or not os.path.isfile(exe):
        return None
    root = os.path.dirname(os.path.abspath(exe))
    for rel in ("Lib/site-packages", "lib/site-packages"):
        sp = os.path.normpath(os.path.join(root, *rel.split("/")))
        if os.path.isdir(sp):
            return sp
    return None


def get_site_packages_candidates() -> list[str]:
    """All site-packages roots to probe for nunchaku (deduped, normalized).

    Prefer the interpreter ComfyUI is actually running under (sys.executable),
    then the path inferred from this node's ComfyUI folder layout.
    """
    seen: set[str] = set()
    out: list[str] = []
    for p in (
        _site_packages_from_python_exe(getattr(sys, "executable", None) or None),
        get_comfyui_python_lib(),
    ):
        if p and os.path.isdir(p):
            n = os.path.normpath(p)
            if n not in seen:
                seen.add(n)
                out.append(n)
    return out


def get_nunchaku_base() -> str | None:
    """Get the nunchaku package path in ComfyUI's embedded Python, or None.

    Tries:
      1. import nunchaku; dirname(nunchaku.__file__)
      2. {sys.executable}/../Lib/site-packages/nunchaku/
      3. Infer from ComfyUI root: {parent}/python_embeded/Lib/site-packages/nunchaku/

    Import can fail with OSError (DLL load) or other errors while the package
    directory still exists — those are not ImportError, so we always fall back
    to filesystem detection. Cached path is dropped if the folder was removed.
    """
    global _NUNCHAKU_BASE
    if _NUNCHAKU_BASE is not None:
        if not os.path.isdir(_NUNCHAKU_BASE):
            _NUNCHAKU_BASE = None
        else:
            return _NUNCHAKU_BASE

    try:
        import nunchaku

        _NUNCHAKU_BASE = os.path.normpath(os.path.dirname(nunchaku.__file__))
        return _NUNCHAKU_BASE
    except Exception:
        pass

    for lib_dir in get_site_packages_candidates():
        nun_path = os.path.join(lib_dir, "nunchaku")
        if os.path.isdir(nun_path) and os.path.isfile(os.path.join(nun_path, "__init__.py")):
            _NUNCHAKU_BASE = os.path.normpath(nun_path)
            return _NUNCHAKU_BASE

    return None


def is_wrapper_installed() -> bool:
    """Check if nunchaku.wrappers.klein is importable."""
    try:
        from nunchaku.wrappers.klein import ComfyFlux2KleinWrapper
        return True
    except ImportError:
        return False


_FLUX2_MODEL = "NunchakuFlux2Transformer2DModel"


def _scan_matching_bracket(content: str, open_idx: int, open_ch: str, close_ch: str) -> int:
    """Return index of matching close bracket, or -1. Skips # comments and string literals."""
    depth = 1
    i = open_idx + 1
    n = len(content)
    while i < n:
        c = content[i]
        if c == "#":
            while i < n and content[i] != "\n":
                i += 1
            continue
        if c in ('"', "'"):
            if i + 2 < n and content[i : i + 3] in ('"""', "'''"):
                triple = content[i : i + 3]
                i += 3
                while i + 2 < n:
                    if content[i : i + 3] == triple:
                        i += 3
                        break
                    i += 1
                continue
            quote = c
            i += 1
            while i < n:
                if content[i] == "\\":
                    i += 2
                    continue
                if content[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _find_import_open_paren(content: str, pattern: str) -> int | None:
    m = re.search(pattern, content)
    if not m:
        return None
    return m.end() - 1


def _insert_before_closing_paren(content: str, open_paren_idx: int, insertion: str) -> str:
    close_idx = _scan_matching_bracket(content, open_paren_idx, "(", ")")
    if close_idx < 0:
        raise ValueError("unbalanced parentheses in multiline import")
    return content[:close_idx] + insertion + content[close_idx:]


def _export_name_in_all_block(content: str, name: str) -> bool:
    m = re.search(r"__all__\s*=\s*\[", content)
    if not m:
        return False
    lb = m.end() - 1
    rb = _scan_matching_bracket(content, lb, "[", "]")
    if rb < 0:
        return False
    inner = content[lb : rb + 1]
    return f'"{name}"' in inner or f"'{name}'" in inner


def _add_export_to_all_list(content: str, name: str) -> tuple[str, bool]:
    if _export_name_in_all_block(content, name):
        return content, False
    m = re.search(r"__all__\s*=\s*\[", content)
    if not m:
        return content, False
    lb = m.end() - 1
    rb = _scan_matching_bracket(content, lb, "[", "]")
    if rb < 0:
        return content, False
    insert = f'\n    "{name}",'
    return content[:rb] + insert + content[rb:], True


def _patch_flux2_nunchaku_package_init(content: str) -> tuple[str, bool]:
    """Align with upstream PR #924: extend from .models import (...) and __all__."""
    c = content
    changed = False
    op = _find_import_open_paren(c, r"from\s+\.models\s+import\s*\(")
    if op is not None:
        ce = _scan_matching_bracket(c, op, "(", ")")
        if ce >= 0 and _FLUX2_MODEL not in c[op : ce + 1]:
            c = _insert_before_closing_paren(c, op, f"\n    {_FLUX2_MODEL},")
            changed = True
    c2, ch2 = _add_export_to_all_list(c, _FLUX2_MODEL)
    return c2, changed or ch2


def _patch_flux2_models_package_init(content: str) -> tuple[str, bool]:
    c = content
    changed = False
    op = _find_import_open_paren(c, r"from\s+\.transformers\s+import\s*\(")
    if op is not None:
        ce = _scan_matching_bracket(c, op, "(", ")")
        if ce >= 0 and _FLUX2_MODEL not in c[op : ce + 1]:
            c = _insert_before_closing_paren(c, op, f"\n    {_FLUX2_MODEL},")
            changed = True
    c2, ch2 = _add_export_to_all_list(c, _FLUX2_MODEL)
    return c2, changed or ch2


def _patch_flux2_transformers_package_init(content: str) -> tuple[str, bool]:
    c = content
    changed = False
    if not re.search(r"from\s+\.transformer_flux2\s+import", c):
        line = "from .transformer_flux2 import NunchakuFlux2Transformer2DModel\n"
        m = re.search(r"^__all__\s*=", c, re.MULTILINE)
        if m:
            c = c[: m.start()] + line + c[m.start() :]
        else:
            sep = "\n" if c.strip() else ""
            c = c.rstrip() + sep + line
        changed = True
    c2, ch2 = _add_export_to_all_list(c, _FLUX2_MODEL)
    return c2, changed or ch2


def _flush_init_py_writes(pairs: list[tuple[str, str]]) -> None:
    for path, content in pairs:
        ast.parse(content, filename=path)
    for path, content in pairs:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)


def install_wrapper_to_nunchaku() -> tuple[bool, str]:
    """Patch the user's nunchaku environment by writing all required files.

    Writes 5 files in total:
        {nunchaku_base}/torch_transfer_utils.py       (entire new file)
        {nunchaku_base}/models/transformers/transformer_flux2.py  (entire new file)
        {nunchaku_base}/__init__.py                    (add FLUX.2 export)
        {nunchaku_base}/models/__init__.py            (add FLUX.2 export)
        {nunchaku_base}/models/transformers/__init__.py (add FLUX.2 export)
    Plus wrappers/ (ComfyUI bridge):
        {nunchaku_base}/wrappers/__init__.py
        {nunchaku_base}/wrappers/klein.py

    Returns (success, message).
    """
    nunchaku_base = get_nunchaku_base()
    if nunchaku_base is None:
        return False, "nunchaku package not found in ComfyUI's Python environment."

    created = []
    modified = []

    # 1. torch_transfer_utils.py (entire file)
    torch_transfer_utils_path = os.path.join(nunchaku_base, "torch_transfer_utils.py")
    if not os.path.exists(torch_transfer_utils_path):
        with open(torch_transfer_utils_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(_TORCH_TRANSFER_UTILS_SOURCE)
        created.append(torch_transfer_utils_path)

    # 2. models/transformers/transformer_flux2.py (entire file)
    transformers_dir = os.path.join(nunchaku_base, "models", "transformers")
    os.makedirs(transformers_dir, exist_ok=True)
    transformer_flux2_path = os.path.join(transformers_dir, "transformer_flux2.py")
    if not os.path.exists(transformer_flux2_path):
        with open(transformer_flux2_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(_TRANSFORMER_FLUX2_SOURCE)
        created.append(transformer_flux2_path)

    # 3–5. __init__.py patches — same intent as nunchaku PR #924, without duplicating
    # whole import blocks or breaking __all__ (regex on [^]] caused syntax errors).
    init_writes: list[tuple[str, str]] = []
    init_path = os.path.join(nunchaku_base, "__init__.py")
    if os.path.exists(init_path):
        with open(init_path, "r", encoding="utf-8") as f:
            root_src = f.read()
        new_root, root_changed = _patch_flux2_nunchaku_package_init(root_src)
        if root_changed:
            init_writes.append((init_path, new_root))

    models_init_path = os.path.join(nunchaku_base, "models", "__init__.py")
    if os.path.exists(models_init_path):
        with open(models_init_path, "r", encoding="utf-8") as f:
            models_src = f.read()
        new_models, models_changed = _patch_flux2_models_package_init(models_src)
        if models_changed:
            init_writes.append((models_init_path, new_models))

    tf_init_path = os.path.join(transformers_dir, "__init__.py")
    if os.path.exists(tf_init_path):
        with open(tf_init_path, "r", encoding="utf-8") as f:
            tf_src = f.read()
        new_tf, tf_changed = _patch_flux2_transformers_package_init(tf_src)
        if tf_changed:
            init_writes.append((tf_init_path, new_tf))

    if init_writes:
        try:
            _flush_init_py_writes(init_writes)
        except SyntaxError as e:
            return False, (
                "Patch aborted: __init__.py would be invalid Python. "
                f"Restore nunchaku with pip or fix files manually. Detail: {e}"
            )
        modified.extend(p[0] for p in init_writes)

    # 6. wrappers/klein.py (ComfyUI bridge — entire file)
    wrappers_dir = os.path.join(nunchaku_base, "wrappers")
    os.makedirs(wrappers_dir, exist_ok=True)
    wrappers_init_path = os.path.join(wrappers_dir, "__init__.py")
    if not os.path.exists(wrappers_init_path):
        with open(wrappers_init_path, "w", encoding="utf-8") as f:
            f.write('"""Nunchaku model wrappers for ComfyUI integration."""\n')
            f.write("from .klein import ComfyFlux2KleinWrapper, copy_with_ctx\n")
            f.write('__all__ = ["ComfyFlux2KleinWrapper", "copy_with_ctx"]\n')
        created.append(wrappers_init_path)

    klein_py = os.path.join(wrappers_dir, "klein.py")
    if not os.path.exists(klein_py):
        with open(klein_py, "w", encoding="utf-8", newline="\n") as f:
            f.write(_KLEIN_WRAPPER_SOURCE)
        created.append(klein_py)

    parts = [f"Successfully patched nunchaku at {nunchaku_base}"]
    if created:
        parts.append("  Created: " + "\n  Created: ".join(created))
    if modified:
        parts.append("  Updated: " + "\n  Updated: ".join(modified))
    return True, "\n".join(parts)


def check_environment() -> dict:
    """Check the current state of the nunchaku FLUX.2 environment.

    Returns:
        dict with keys:
        - nunchaku_found: bool
        - nunchaku_base: str | None
        - wrapper_installed: bool
        - transformer_available: bool      # transformer_flux2.py present
        - torch_transfer_utils_available: bool
        - needs_patch: bool
        - comfyui_root: str | None
        - comfyui_python: str | None
        - comfyui_python_lib: str | None
        - install_status: str  # "ready" | "needs_patch" | "missing_nunchaku" | "missing_transformer" | "missing_core_files"
        - status_text: dict    # {"zh": str, "en": str}
        - suggestion: str
    """
    try:
        return _check_environment_impl()
    except Exception as exc:
        return {
            "nunchaku_found": False,
            "nunchaku_base": None,
            "wrapper_installed": False,
            "transformer_available": False,
            "torch_transfer_utils_available": False,
            "needs_patch": False,
            "comfyui_root": None,
            "comfyui_python": None,
            "comfyui_python_lib": None,
            "install_status": "check_failed",
            "status_text": {
                "zh": f"环境检测异常: {exc}",
                "en": f"Environment check failed: {exc}",
            },
            "suggestion": str(exc),
            "error": str(exc),
        }


def _check_environment_impl() -> dict:
    comfyui_root = _detect_comfyui_root()
    comfyui_python = get_comfyui_python()
    comfyui_python_lib = get_comfyui_python_lib()
    site_packages_searched = get_site_packages_candidates()
    nunchaku_base = get_nunchaku_base()
    nunchaku_found = nunchaku_base is not None

    wrapper_installed = is_wrapper_installed()

    transformer_available = False
    torch_transfer_utils_available = False
    if nunchaku_found:
        try:
            from nunchaku.models.transformers.transformer_flux2 import NunchakuFlux2Transformer2DModel
            transformer_available = True
        except ImportError:
            pass
        try:
            from nunchaku.torch_transfer_utils import pin_state_dict
            torch_transfer_utils_available = True
        except ImportError:
            pass

    core_files_ok = transformer_available and torch_transfer_utils_available
    needs_patch = (
        nunchaku_found
        and core_files_ok
        and not wrapper_installed
    )

    install_status = "ready"
    status_text = {"zh": "环境就绪，可以正常加载模型", "en": "Environment ready, can load models normally"}
    suggestion = ""

    if not nunchaku_found:
        install_status = "missing_nunchaku"
        tried = (
            "; ".join(site_packages_searched)
            if site_packages_searched
            else (comfyui_python_lib or "未知")
        )
        status_text = {
            "zh": f"未找到 nunchaku 包（已搜索 site-packages：{tried}）",
            "en": f"nunchaku package not found (searched site-packages: {tried})",
        }
        suggestion = (
            "nunchaku pip package not found. "
            "Please install: pip install nunchaku "
            "in ComfyUI's python_embeded."
        )
    elif nunchaku_found and not core_files_ok:
        install_status = "missing_core_files"
        status_text = {
            "zh": "nunchaku 已安装但缺少核心文件（transformer_flux2.py / torch_transfer_utils.py），"
                  "点击「嵌入到环境」按钮添加",
            "en": "nunchaku found but core files are missing (transformer_flux2.py / torch_transfer_utils.py), "
                  "click 'Install to Environment' to add them",
        }
        suggestion = (
            "nunchaku found but transformer_flux2.py or torch_transfer_utils.py is missing. "
            "Magic Klein Loader will automatically add them - no manual action needed."
        )
    elif needs_patch:
        install_status = "needs_patch"
        status_text = {
            "zh": "缺少 wrappers/klein.py，点击「嵌入到环境」按钮添加",
            "en": "wrappers/klein.py is missing, click 'Install to Environment' to add it",
        }
        suggestion = (
            "nunchaku found (core files OK), but wrappers/klein.py is missing. "
            "Magic Klein Loader will automatically add it - no manual action needed."
        )
    else:
        install_status = "ready"
        status_text = {
            "zh": "环境就绪，可以正常加载模型",
            "en": "Environment ready, can load models normally",
        }
        suggestion = "nunchaku environment ready (core files + wrapper available)."

    return {
        "nunchaku_found": nunchaku_found,
        "nunchaku_base": nunchaku_base,
        "wrapper_installed": wrapper_installed,
        "transformer_available": transformer_available,
        "torch_transfer_utils_available": torch_transfer_utils_available,
        "needs_patch": needs_patch,
        "comfyui_root": comfyui_root,
        "comfyui_python": comfyui_python,
        "comfyui_python_lib": comfyui_python_lib,
        "site_packages_searched": site_packages_searched,
        "install_status": install_status,
        "status_text": status_text,
        "suggestion": suggestion,
    }


# ---------------------------------------------------------------------------
# Embedded torch_transfer_utils.py
# From: https://github.com/nunchaku-ai/nunchaku/commit/a515fc2740a17410fa2fcef6dc59229744d82fa0/nunchaku/torch_transfer_utils.py
# ---------------------------------------------------------------------------
_TORCH_TRANSFER_UTILS_SOURCE = '''from __future__ import annotations

import os
import platform
from collections.abc import Callable, Sequence
from typing import Any, Literal

import torch
from torch import nn


DEFAULT_PIPELINE_COMPONENT_ATTRS: tuple[str, ...] = ("text_encoder", "text_encoder_2", "vae", "unet", "transformer")
_PRETOUCHED_SIGNATURE_ATTR = "_nunchaku_pretouched_cpu_signature"
_PIPELINE_PRETOUCH_DECISIONS_ATTR = "_nunchaku_pretouch_auto_decisions"
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}
_CpuTensorSignature = tuple[tuple[str, str, tuple[int, ...], str, int], ...]


def _env_flag(name: str) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def normalize_device(device: str | torch.device) -> torch.device:
    return device if isinstance(device, torch.device) else torch.device(device)


def _resolve_default_cuda_device() -> torch.device | None:
    if not torch.cuda.is_available():
        return None
    try:
        return torch.device(f"cuda:{torch.cuda.current_device()}")
    except Exception:
        return torch.device("cuda")


def _parse_bool_or_auto(value: bool | str, *, name: str) -> bool | Literal["auto"]:
    if isinstance(value, bool):
        return value

    normalized = value.strip().lower()
    if normalized == "auto":
        return "auto"
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise ValueError(f"Unsupported {name}={value!r}. Expected a boolean value or 'auto'.")


def _matches_default_h2d_staging_platform(device: torch.device) -> bool:
    if device.type != "cuda" or not torch.cuda.is_available():
        return False

    if platform.machine().lower() != "aarch64":
        return False

    index = 0 if device.index is None else device.index
    try:
        if index < 0 or index >= torch.cuda.device_count():
            return False
        capability = torch.cuda.get_device_capability(index)
    except Exception:
        return False

    return capability[0] == 12


def _resolve_page_size() -> int:
    try:
        return int(os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, ValueError, OSError):
        return 4096


def _scan_module_cpu_tensors(module: nn.Module) -> tuple[list[torch.Tensor], _CpuTensorSignature]:
    tensors: list[torch.Tensor] = []
    signature: list[tuple[str, str, tuple[int, ...], str, int]] = []
    for submodule in module.modules():
        for name, tensor in list(submodule.named_parameters(recurse=False)) + list(submodule.named_buffers(recurse=False)):
            if tensor.device.type != "cpu" or tensor.numel() == 0:
                continue
            tensors.append(tensor)
            signature.append((type(tensor).__name__, name, tuple(tensor.shape), str(tensor.dtype), tensor.data_ptr()))
    return tensors, tuple(signature)


def _pretouch_tensor(tensor: torch.Tensor, *, page_size: int) -> None:
    storage = tensor.untyped_storage()
    storage_size = len(storage)
    if storage_size == 0:
        return

    checksum = 0
    for offset in range(0, storage_size, page_size):
        checksum += int(storage[offset])
        checksum += int(storage[storage_size - 1])
    _ = checksum


def _pretouch_module_cpu_tensors(module: nn.Module) -> tuple[int, bool]:
    tensors, signature = _scan_module_cpu_tensors(module)
    if not signature:
        return 0, False

    marker = signature
    if getattr(module, _PRETOUCHED_SIGNATURE_ATTR, None) == marker:
        return 0, False

    page_size = _resolve_page_size()
    with torch.no_grad():
        for tensor in tensors:
            _pretouch_tensor(tensor, page_size=page_size)

    setattr(module, _PRETOUCHED_SIGNATURE_ATTR, marker)
    return len(tensors), True


def _need_pretouch_static(device: torch.device) -> bool:
    override = _env_flag("NUNCHAKU_PRETOUCH_CPU_TENSORS")
    if override is None:
        override = _env_flag("NUNCHAKU_PRETOUCH_PIPELINE_CPU_TENSORS")
    if override in _TRUE_VALUES:
        return True
    if override in _FALSE_VALUES:
        return False

    return _matches_default_h2d_staging_platform(device)


def _need_pin_memory_static(device: torch.device) -> bool:
    override = _env_flag("NUNCHAKU_PIN_MEMORY")
    if override in _TRUE_VALUES:
        return True
    if override in _FALSE_VALUES:
        return False
    return _matches_default_h2d_staging_platform(device)


def resolve_pin_memory(pin_memory: bool | str, device: str | torch.device) -> bool:
    device = normalize_device(device)
    if device.type != "cuda":
        return False

    pin_memory = _parse_bool_or_auto(pin_memory, name="pin_memory")
    if pin_memory == "auto":
        return _need_pin_memory_static(device)
    return pin_memory


def pin_state_dict(sd: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in sd.items():
        if isinstance(value, torch.Tensor) and value.device.type == "cpu" and value.numel() > 0:
            try:
                out[key] = value if value.is_pinned() else value.pin_memory()
            except Exception:
                out[key] = value
        else:
            out[key] = value
    return out


def resolve_pretouch_cpu_tensors(
    pretouch: bool | str,
    pipe: Any,
    device: str | torch.device,
    *,
    context: str = "pipeline_to_cuda",
    component_attrs: Sequence[str] = DEFAULT_PIPELINE_COMPONENT_ATTRS,
) -> bool:
    device = normalize_device(device)
    if device.type != "cuda":
        return False

    pretouch = _parse_bool_or_auto(pretouch, name="pretouch")
    if pretouch != "auto":
        return pretouch

    decisions = getattr(pipe, _PIPELINE_PRETOUCH_DECISIONS_ATTR, None)
    if not isinstance(decisions, dict):
        decisions = {}
    setattr(pipe, _PIPELINE_PRETOUCH_DECISIONS_ATTR, decisions)

    key = (
        device.type,
        device.index,
        context,
        tuple(component_attrs),
        _env_flag("NUNCHAKU_PRETOUCH_CPU_TENSORS"),
        _env_flag("NUNCHAKU_PRETOUCH_PIPELINE_CPU_TENSORS"),
    )
    if key in decisions:
        return decisions[key]

    decision = _need_pretouch_static(device)
    decisions[key] = decision
    return decision


def should_pretouch(device: str | torch.device | None = None) -> bool:
    """
    Return whether Nunchaku's default policy recommends pretouching CPU tensors.

    This is a public recommendation API. It does not trigger pretouch by
    itself; callers should use it to decide whether to invoke
    :func:`pretouch_pipeline_cpu_tensors` explicitly before ``pipe.to("cuda")``
    or before a CPU offload flow that will move model weights back to CUDA.

    When ``device`` is omitted, the current CUDA device is used if CUDA is
    available. This keeps the common single-GPU case concise while still
    allowing explicit multi-GPU selection.

    The default policy enables pretouch on ``aarch64`` systems with
    Blackwell-class CUDA GPUs (compute capability major version 12).
    Environment overrides via ``NUNCHAKU_PRETOUCH_CPU_TENSORS`` or
    ``NUNCHAKU_PRETOUCH_PIPELINE_CPU_TENSORS`` take precedence.
    """
    if device is None:
        resolved_device = _resolve_default_cuda_device()
        if resolved_device is None:
            return False
    else:
        resolved_device = normalize_device(device)
    return _need_pretouch_static(resolved_device)


def pretouch_pipeline_cpu_tensors(
    pipe: Any,
    component_attrs: Sequence[str] = DEFAULT_PIPELINE_COMPONENT_ATTRS,
    on_component: Callable[[str], None] | None = None,
) -> bool:
    """
    Pretouch common pipeline components on CPU before CUDA transfer.

    This is the main explicit execution API. It walks the known CPU-side
    pipeline components, touches one byte per memory page for each tensor,
    and skips components whose CPU tensor signature has not changed since the
    previous pretouch call.

    Returns ``True`` when at least one component was newly pretouched and
    ``False`` when nothing needed touching.
    """
    touched_any = False
    for attr in component_attrs:
        if not hasattr(pipe, attr):
            continue
        module = getattr(pipe, attr)
        if module is None or not isinstance(module, nn.Module):
            continue
        touched, did_pretouch = _pretouch_module_cpu_tensors(module)
        if on_component is not None and did_pretouch:
            on_component(attr)
        touched_any = touched > 0 or touched_any
    return touched_any


def maybe_pretouch_pipeline_cpu_tensors(
    pipe: Any,
    device: str | torch.device,
    *,
    pretouch: bool | str = "auto",
    context: str = "pipeline_to_cuda",
    component_attrs: Sequence[str] = DEFAULT_PIPELINE_COMPONENT_ATTRS,
    on_component: Callable[[str], None] | None = None,
) -> bool:
    """
    Conditionally pretouch pipeline CPU tensors using an explicit policy.

    This helper is still explicit: callers opt in by invoking it. When
    ``pretouch="auto"``, the decision follows :func:`should_pretouch` and the
    environment-variable overrides. When ``pretouch`` is a boolean, that value
    is used directly.
    """
    if not resolve_pretouch_cpu_tensors(
        pretouch,
        pipe,
        device,
        context=context,
        component_attrs=component_attrs,
    ):
        return False
    return pretouch_pipeline_cpu_tensors(
        pipe,
        component_attrs=component_attrs,
        on_component=on_component,
    )
'''


# ---------------------------------------------------------------------------
# Embedded transformer_flux2.py
# From: https://github.com/nunchaku-ai/nunchaku/commit/a515fc2740a17410fa2fcef6dc59229744d82fa0/nunchaku/models/transformers/transformer_flux2.py
# ---------------------------------------------------------------------------
_TRANSFORMER_FLUX2_SOURCE = '''"""
Python-only Nunchaku runtime for FLUX.2 transformers.
"""

import gc
import json
import math
from pathlib import Path
import os
import torch
from warnings import warn
from diffusers.models.attention_dispatch import dispatch_attention_fn
from diffusers.models.embeddings import apply_rotary_emb
from diffusers.models.modeling_outputs import Transformer2DModelOutput
from diffusers.models.transformers.transformer_flux2 import (
    Flux2Attention,
    Flux2FeedForward,
    Flux2Modulation,
    Flux2ParallelSelfAttention,
    Flux2SingleTransformerBlock,
    Flux2Transformer2DModel,
    Flux2TransformerBlock,
)
from huggingface_hub import utils

try:
    from diffusers.utils import apply_lora_scale
except ImportError:

    def apply_lora_scale(_kwargs_name: str = "joint_attention_kwargs"):
        def decorator(func):
            return func

        return decorator

from ..._C.ops import attention_fp16
from ...ops.fused import fused_qkv_norm_rottary
from ...torch_transfer_utils import pin_state_dict, resolve_pin_memory
from ...utils import (
    check_hardware_compatibility,
    get_precision,
    get_precision_from_quantization_config,
    pad_tensor,
)
from ..embeddings import pack_rotemb
from ..linear import SVDQW4A4Linear
from ..utils import CPUOffloadManager, fuse_linears
from .utils import NunchakuModelLoaderMixin, patch_scale_key


def _flux2_kv_causal_attention(
    query: torch.Tensor,
    key: torch.Tensor,
    value: torch.Tensor,
    num_txt_tokens: int,
    num_ref_tokens: int,
    kv_cache=None,
    backend=None,
) -> torch.Tensor:
    if num_ref_tokens == 0 and kv_cache is None:
        return dispatch_attention_fn(query, key, value, backend=backend)

    if kv_cache is not None:
        k_ref, v_ref = kv_cache.get()
        k_all = torch.cat([key[:, :num_txt_tokens], k_ref, key[:, num_txt_tokens:]], dim=1)
        v_all = torch.cat([value[:, :num_txt_tokens], v_ref, value[:, num_txt_tokens:]], dim=1)
        return dispatch_attention_fn(query, k_all, v_all, backend=backend)

    ref_start = num_txt_tokens
    ref_end = num_txt_tokens + num_ref_tokens

    q_txt = query[:, :ref_start]
    q_ref = query[:, ref_start:ref_end]
    q_img = query[:, ref_end:]

    k_txt = key[:, :ref_start]
    k_ref = key[:, ref_start:ref_end]
    k_img = key[:, ref_end:]

    v_txt = value[:, :ref_start]
    v_ref = value[:, ref_start:ref_end]
    v_img = value[:, ref_end:]

    q_txt_img = torch.cat([q_txt, q_img], dim=1)
    k_all = torch.cat([k_txt, k_ref, k_img], dim=1)
    v_all = torch.cat([v_txt, v_ref, v_img], dim=1)
    attn_txt_img = dispatch_attention_fn(query=q_txt_img, key=k_all, value=v_all, backend=backend)
    attn_txt = attn_txt_img[:, :ref_start]
    attn_img = attn_txt_img[:, ref_start:]
    attn_ref = dispatch_attention_fn(query=q_ref, key=k_ref, value=v_ref, backend=backend)
    return torch.cat([attn_txt, attn_ref, attn_img], dim=1)


def _pack_flux2_rotary_emb(freqs_cis: tuple[torch.Tensor, torch.Tensor]) -> torch.Tensor:
    cos, sin = freqs_cis
    if cos.ndim != 2 or sin.ndim != 2 or cos.shape != sin.shape:
        raise ValueError("Expected Flux.2 rotary embeddings as a (cos, sin) tuple with shape (seq_len, dim).")

    # Flux.2 uses repeat_interleave_real=True, so every rotary pair shares the same cos/sin values.
    rotemb = torch.stack([sin[:, 0::2], cos[:, 0::2]], dim=-1).unsqueeze(0).unsqueeze(-2).contiguous()
    return pack_rotemb(pad_tensor(rotemb, 256, 1))


def _alloc_packed_qkv(batch_size: int, heads: int, num_tokens: int, head_dim: int, device: torch.device, pad_size: int = 256):
    num_tokens_pad = math.ceil(num_tokens / pad_size) * pad_size
    query = torch.empty(batch_size, heads, num_tokens_pad, head_dim, dtype=torch.float16, device=device)
    key = torch.empty_like(query)
    value = torch.empty_like(query)
    return query, key, value, num_tokens_pad


def _apply_gated_residual(residual: torch.Tensor, gate: torch.Tensor, update: torch.Tensor) -> torch.Tensor:
    if torch.is_grad_enabled():
        return residual + gate * update
    residual.addcmul_(gate, update)
    return residual


class NunchakuFlux2Attention(Flux2Attention):
    def __init__(self, other: Flux2Attention, **kwargs):
        super(Flux2Attention, self).__init__()
        self.head_dim = other.head_dim
        self.inner_dim = other.inner_dim
        self.query_dim = other.query_dim
        self.out_dim = other.out_dim
        self.heads = other.heads
        self.use_bias = other.use_bias
        self.dropout = other.dropout
        self.added_kv_proj_dim = other.added_kv_proj_dim
        self.added_proj_bias = other.added_proj_bias
        self.fused_projections = True
        processor = getattr(other, "processor", None)
        self._attention_backend = getattr(processor, "_attention_backend", None)
        self._parallel_config = getattr(processor, "_parallel_config", None)

        self.norm_q = other.norm_q
        self.norm_k = other.norm_k
        self.to_out = other.to_out
        self.to_out[0] = SVDQW4A4Linear.from_linear(self.to_out[0], **kwargs)

        with torch.device("meta"):
            to_qkv = fuse_linears([other.to_q, other.to_k, other.to_v])
            self.to_qkv = SVDQW4A4Linear.from_linear(to_qkv, **kwargs)

        if self.added_kv_proj_dim is not None:
            self.norm_added_q = other.norm_added_q
            self.norm_added_k = other.norm_added_k
            self.to_add_out = SVDQW4A4Linear.from_linear(other.to_add_out, **kwargs)
            with torch.device("meta"):
                to_added_qkv = fuse_linears([other.add_q_proj, other.add_k_proj, other.add_v_proj])
                self.to_added_qkv = SVDQW4A4Linear.from_linear(to_added_qkv, **kwargs)

    def forward(
        self,
        hidden_states: torch.Tensor,
        encoder_hidden_states: torch.Tensor | None = None,
        attention_mask: torch.Tensor | None = None,
        image_rotary_emb: tuple[torch.Tensor, torch.Tensor] | torch.Tensor | None = None,
        **kwargs,
    ) -> torch.Tensor:
        kv_cache = kwargs.get("kv_cache", None)
        kv_cache_mode = kwargs.get("kv_cache_mode", None)
        num_ref_tokens = int(kwargs.get("num_ref_tokens", 0))
        use_packed_fp16 = (
            kv_cache_mode is None
            and encoder_hidden_states is not None
            and isinstance(image_rotary_emb, tuple)
            and len(image_rotary_emb) == 2
            and image_rotary_emb[0].ndim == 3
            and hidden_states.is_cuda
        )
        if use_packed_fp16:
            batch_size = hidden_states.shape[0]
            num_txt_tokens = encoder_hidden_states.shape[1]
            num_img_tokens = hidden_states.shape[1]
            num_txt_tokens_pad = math.ceil(num_txt_tokens / 256) * 256
            num_img_tokens_pad = math.ceil(num_img_tokens / 256) * 256
            num_tokens_pad = num_txt_tokens_pad + num_img_tokens_pad
            query = torch.empty(
                batch_size, self.heads, num_tokens_pad, self.head_dim, dtype=torch.float16, device=hidden_states.device
            )
            key = torch.empty_like(query)
            value = torch.empty_like(query)
            fused_qkv_norm_rottary(
                hidden_states,
                self.to_qkv,
                self.norm_q,
                self.norm_k,
                image_rotary_emb[0],
                output=(
                    query[:, :, num_txt_tokens_pad:],
                    key[:, :, num_txt_tokens_pad:],
                    value[:, :, num_txt_tokens_pad:],
                ),
                attn_tokens=num_img_tokens,
            )
            fused_qkv_norm_rottary(
                encoder_hidden_states,
                self.to_added_qkv,
                self.norm_added_q,
                self.norm_added_k,
                image_rotary_emb[1],
                output=(query[:, :, :num_txt_tokens_pad], key[:, :, :num_txt_tokens_pad], value[:, :, :num_txt_tokens_pad]),
                attn_tokens=num_txt_tokens,
            )
            attention_output = torch.empty(
                batch_size,
                num_tokens_pad,
                self.heads * self.head_dim,
                dtype=hidden_states.dtype,
                device=hidden_states.device,
            )
            attention_fp16(query, key, value, attention_output, self.head_dim ** (-0.5))
            encoder_hidden_states = attention_output[:, :num_txt_tokens]
            hidden_states = attention_output[:, num_txt_tokens_pad : num_txt_tokens_pad + num_img_tokens]
            encoder_hidden_states = self.to_add_out(encoder_hidden_states)
            hidden_states = self.to_out[0](hidden_states)
            hidden_states = self.to_out[1](hidden_states)
            return hidden_states, encoder_hidden_states

        if (
            encoder_hidden_states is not None
            and isinstance(image_rotary_emb, tuple)
            and len(image_rotary_emb) == 2
            and image_rotary_emb[0].ndim == 3
        ):
            batch_size = hidden_states.shape[0]
            qkv = fused_qkv_norm_rottary(
                hidden_states,
                self.to_qkv,
                self.norm_q,
                self.norm_k,
                image_rotary_emb[0],
            )
            query, key, value = qkv.chunk(3, dim=-1)
            query = query.view(batch_size, -1, self.heads, self.head_dim)
            key = key.view(batch_size, -1, self.heads, self.head_dim)
            value = value.view(batch_size, -1, self.heads, self.head_dim)

            encoder_qkv = fused_qkv_norm_rottary(
                encoder_hidden_states,
                self.to_added_qkv,
                self.norm_added_q,
                self.norm_added_k,
                image_rotary_emb[1],
            )
            encoder_query, encoder_key, encoder_value = encoder_qkv.chunk(3, dim=-1)
            encoder_query = encoder_query.view(batch_size, -1, self.heads, self.head_dim)
            encoder_key = encoder_key.view(batch_size, -1, self.heads, self.head_dim)
            encoder_value = encoder_value.view(batch_size, -1, self.heads, self.head_dim)
            encoder_seq_len = encoder_hidden_states.shape[1]
            query = torch.cat([encoder_query, query], dim=1)
            key = torch.cat([encoder_key, key], dim=1)
            value = torch.cat([encoder_value, value], dim=1)
        else:
            query, key, value = self.to_qkv(hidden_states).chunk(3, dim=-1)
            query = query.unflatten(-1, (self.heads, -1))
            key = key.unflatten(-1, (self.heads, -1))
            value = value.unflatten(-1, (self.heads, -1))
            query = self.norm_q(query)
            key = self.norm_k(key)

        encoder_seq_len = 0
        if encoder_hidden_states is not None and self.added_kv_proj_dim is not None:
            encoder_query, encoder_key, encoder_value = self.to_added_qkv(encoder_hidden_states).chunk(3, dim=-1)
            encoder_query = encoder_query.unflatten(-1, (self.heads, -1))
            encoder_key = encoder_key.unflatten(-1, (self.heads, -1))
            encoder_value = encoder_value.unflatten(-1, (self.heads, -1))
            encoder_query = self.norm_added_q(encoder_query)
            encoder_key = self.norm_added_k(encoder_key)
            encoder_seq_len = encoder_hidden_states.shape[1]
            query = torch.cat([encoder_query, query], dim=1)
            key = torch.cat([encoder_key, key], dim=1)
            value = torch.cat([encoder_value, value], dim=1)

        if image_rotary_emb is not None:
            query = apply_rotary_emb(query, image_rotary_emb, sequence_dim=1)
            key = apply_rotary_emb(key, image_rotary_emb, sequence_dim=1)

        if kv_cache_mode == "extract" and kv_cache is not None and num_ref_tokens > 0:
            ref_start = encoder_seq_len
            ref_end = encoder_seq_len + num_ref_tokens
            kv_cache.store(key[:, ref_start:ref_end].clone(), value[:, ref_start:ref_end].clone())

        if kv_cache_mode == "extract" and num_ref_tokens > 0:
            hidden_states = _flux2_kv_causal_attention(
                query, key, value, encoder_seq_len, num_ref_tokens, backend=self._attention_backend
            )
        elif kv_cache_mode == "cached" and kv_cache is not None:
            hidden_states = _flux2_kv_causal_attention(
                query, key, value, encoder_seq_len, 0, kv_cache=kv_cache, backend=self._attention_backend
            )
        else:
            hidden_states = dispatch_attention_fn(
                query,
                key,
                value,
                attn_mask=attention_mask,
                backend=self._attention_backend,
                parallel_config=self._parallel_config,
            )
        hidden_states = hidden_states.flatten(2, 3).to(query.dtype)

        if encoder_seq_len:
            encoder_hidden_states, hidden_states = hidden_states.split_with_sizes(
                [encoder_seq_len, hidden_states.shape[1] - encoder_seq_len], dim=1
            )
            encoder_hidden_states = self.to_add_out(encoder_hidden_states)
            hidden_states = self.to_out[0](hidden_states)
            hidden_states = self.to_out[1](hidden_states)
            if encoder_seq_len:
                return hidden_states, encoder_hidden_states
        return hidden_states


class NunchakuFlux2FeedForward(Flux2FeedForward):
    def __init__(self, other: Flux2FeedForward, **kwargs):
        super(Flux2FeedForward, self).__init__()
        self.linear_in = SVDQW4A4Linear.from_linear(other.linear_in, **kwargs)
        self.act_fn = other.act_fn
        self.linear_out = SVDQW4A4Linear.from_linear(other.linear_out, **kwargs)
        # FLUX.2 PTQ does not currently apply ShiftedLinear on these SwiGLU down-projections,
        # so int4 must keep the signed activation path.
        self.linear_out.act_unsigned = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.linear_in(x)
        x = self.act_fn(x)
        x = self.linear_out(x)
        return x


class NunchakuFlux2ParallelSelfAttention(Flux2ParallelSelfAttention):
    def __init__(self, other: Flux2ParallelSelfAttention, **kwargs):
        super(Flux2ParallelSelfAttention, self).__init__()
        self.head_dim = other.head_dim
        self.inner_dim = other.inner_dim
        self.query_dim = other.query_dim
        self.out_dim = other.out_dim
        self.heads = other.heads
        self.use_bias = other.use_bias
        self.dropout = other.dropout
        self.mlp_ratio = other.mlp_ratio
        self.mlp_hidden_dim = other.mlp_hidden_dim
        self.mlp_mult_factor = other.mlp_mult_factor
        processor = getattr(other, "processor", None)
        self._attention_backend = getattr(processor, "_attention_backend", None)
        self._parallel_config = getattr(processor, "_parallel_config", None)

        # Keep clear parameter names for export/runtime alignment.
        with torch.device("meta"):
            qkv_proj = torch.nn.Linear(other.query_dim, other.inner_dim * 3, bias=other.use_bias)
            mlp_fc1 = torch.nn.Linear(other.query_dim, other.mlp_hidden_dim * other.mlp_mult_factor, bias=other.use_bias)
            out_proj = torch.nn.Linear(other.inner_dim, other.out_dim, bias=other.to_out.bias is not None)
            mlp_fc2 = torch.nn.Linear(other.mlp_hidden_dim, other.out_dim, bias=other.to_out.bias is not None)
        self.qkv_proj = SVDQW4A4Linear.from_linear(qkv_proj, **kwargs)
        self.mlp_fc1 = SVDQW4A4Linear.from_linear(mlp_fc1, **kwargs)
        self.mlp_act_fn = other.mlp_act_fn
        self.norm_q = other.norm_q
        self.norm_k = other.norm_k
        self.out_proj = SVDQW4A4Linear.from_linear(out_proj, **kwargs)
        self.mlp_fc2 = SVDQW4A4Linear.from_linear(mlp_fc2, **kwargs)
        # FLUX.2 PTQ does not currently apply ShiftedLinear on these SwiGLU down-projections,
        # so int4 must keep the signed activation path.
        self.mlp_fc2.act_unsigned = False

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: torch.Tensor | None = None,
        image_rotary_emb: torch.Tensor | None = None,
        **kwargs,
    ) -> torch.Tensor:
        kv_cache = kwargs.get("kv_cache", None)
        kv_cache_mode = kwargs.get("kv_cache_mode", None)
        num_txt_tokens = int(kwargs.get("num_txt_tokens", 0))
        num_ref_tokens = int(kwargs.get("num_ref_tokens", 0))
        use_packed_fp16 = kv_cache_mode is None and torch.is_tensor(image_rotary_emb) and image_rotary_emb.ndim == 3 and hidden_states.is_cuda
        if use_packed_fp16:
            batch_size = hidden_states.shape[0]
            num_tokens = hidden_states.shape[1]
            query, key, value, num_tokens_pad = _alloc_packed_qkv(
                batch_size, self.heads, num_tokens, self.head_dim, hidden_states.device
            )
            fused_qkv_norm_rottary(
                hidden_states,
                self.qkv_proj,
                self.norm_q,
                self.norm_k,
                image_rotary_emb,
                output=(query, key, value),
                attn_tokens=num_tokens,
            )
            attn_output = torch.empty(
                batch_size,
                num_tokens_pad,
                self.heads * self.head_dim,
                dtype=hidden_states.dtype,
                device=hidden_states.device,
            )
            attention_fp16(query, key, value, attn_output, self.head_dim ** (-0.5))
            attn_output = attn_output[:, :num_tokens]
            mlp_hidden_states = self.mlp_act_fn(self.mlp_fc1(hidden_states))
            return self.out_proj(attn_output) + self.mlp_fc2(mlp_hidden_states)

        if torch.is_tensor(image_rotary_emb) and image_rotary_emb.ndim == 3:
            batch_size = hidden_states.shape[0]
            qkv = fused_qkv_norm_rottary(hidden_states, self.qkv_proj, self.norm_q, self.norm_k, image_rotary_emb)
            query, key, value = qkv.chunk(3, dim=-1)
            query = query.view(batch_size, -1, self.heads, self.head_dim)
            key = key.view(batch_size, -1, self.heads, self.head_dim)
            value = value.view(batch_size, -1, self.heads, self.head_dim)
        else:
            qkv = self.qkv_proj(hidden_states)
            query, key, value = qkv.chunk(3, dim=-1)
            query = query.unflatten(-1, (self.heads, -1))
            key = key.unflatten(-1, (self.heads, -1))
            value = value.unflatten(-1, (self.heads, -1))
            query = self.norm_q(query)
            key = self.norm_k(key)
        if image_rotary_emb is not None:
            query = apply_rotary_emb(query, image_rotary_emb, sequence_dim=1)
            key = apply_rotary_emb(key, image_rotary_emb, sequence_dim=1)

        if kv_cache_mode == "extract" and kv_cache is not None and num_ref_tokens > 0:
            ref_start = num_txt_tokens
            ref_end = num_txt_tokens + num_ref_tokens
            kv_cache.store(key[:, ref_start:ref_end].clone(), value[:, ref_start:ref_end].clone())

        if kv_cache_mode == "extract" and num_ref_tokens > 0:
            attn_output = _flux2_kv_causal_attention(
                query, key, value, num_txt_tokens, num_ref_tokens, backend=self._attention_backend
            )
        elif kv_cache_mode == "cached" and kv_cache is not None:
            attn_output = _flux2_kv_causal_attention(
                query, key, value, num_txt_tokens, 0, kv_cache=kv_cache, backend=self._attention_backend
            )
        else:
            attn_output = dispatch_attention_fn(
                query,
                key,
                value,
                attn_mask=attention_mask,
                backend=self._attention_backend,
                parallel_config=self._parallel_config,
            )
        attn_output = attn_output.flatten(2, 3).to(query.dtype)
        mlp_hidden_states = self.mlp_act_fn(self.mlp_fc1(hidden_states))
        return self.out_proj(attn_output) + self.mlp_fc2(mlp_hidden_states)


class NunchakuFlux2TransformerBlock(Flux2TransformerBlock):
    def __init__(self, block: Flux2TransformerBlock, **kwargs):
        super(Flux2TransformerBlock, self).__init__()
        self.mlp_hidden_dim = block.mlp_hidden_dim
        self.norm1 = block.norm1
        self.norm1_context = block.norm1_context
        self.attn = NunchakuFlux2Attention(block.attn, **kwargs)
        self.norm2 = block.norm2
        self.ff = NunchakuFlux2FeedForward(block.ff, **kwargs)
        self.norm2_context = block.norm2_context
        self.ff_context = NunchakuFlux2FeedForward(block.ff_context, **kwargs)

    def forward(
        self,
        hidden_states: torch.Tensor,
        encoder_hidden_states: torch.Tensor,
        temb_mod_img: torch.Tensor,
        temb_mod_txt: torch.Tensor,
        image_rotary_emb: tuple[torch.Tensor, torch.Tensor] | None = None,
        joint_attention_kwargs: dict | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        joint_attention_kwargs = joint_attention_kwargs or {}

        (shift_msa, scale_msa, gate_msa), (shift_mlp, scale_mlp, gate_mlp) = Flux2Modulation.split(temb_mod_img, 2)
        (c_shift_msa, c_scale_msa, c_gate_msa), (c_shift_mlp, c_scale_mlp, c_gate_mlp) = Flux2Modulation.split(
            temb_mod_txt, 2
        )

        norm_hidden_states = self.norm1(hidden_states)
        norm_hidden_states = (1 + scale_msa) * norm_hidden_states + shift_msa

        norm_encoder_hidden_states = self.norm1_context(encoder_hidden_states)
        norm_encoder_hidden_states = (1 + c_scale_msa) * norm_encoder_hidden_states + c_shift_msa

        attn_output, context_attn_output = self.attn(
            hidden_states=norm_hidden_states,
            encoder_hidden_states=norm_encoder_hidden_states,
            image_rotary_emb=image_rotary_emb,
            **joint_attention_kwargs,
        )

        hidden_states = _apply_gated_residual(hidden_states, gate_msa, attn_output)

        norm_hidden_states = self.norm2(hidden_states)
        norm_hidden_states = norm_hidden_states * (1 + scale_mlp) + shift_mlp
        hidden_states = _apply_gated_residual(hidden_states, gate_mlp, self.ff(norm_hidden_states))

        encoder_hidden_states = _apply_gated_residual(encoder_hidden_states, c_gate_msa, context_attn_output)

        norm_encoder_hidden_states = self.norm2_context(encoder_hidden_states)
        norm_encoder_hidden_states = norm_encoder_hidden_states * (1 + c_scale_mlp) + c_shift_mlp
        encoder_hidden_states = _apply_gated_residual(
            encoder_hidden_states, c_gate_mlp, self.ff_context(norm_encoder_hidden_states)
        )
        if encoder_hidden_states.dtype == torch.float16:
            encoder_hidden_states = encoder_hidden_states.clip(-65504, 65504)

        return encoder_hidden_states, hidden_states


class NunchakuFlux2SingleTransformerBlock(Flux2SingleTransformerBlock):
    def __init__(self, block: Flux2SingleTransformerBlock, **kwargs):
        super(Flux2SingleTransformerBlock, self).__init__()
        self.norm = block.norm
        self.attn = NunchakuFlux2ParallelSelfAttention(block.attn, **kwargs)

    def forward(
        self,
        hidden_states: torch.Tensor,
        encoder_hidden_states: torch.Tensor | None,
        temb_mod: torch.Tensor,
        image_rotary_emb: tuple[torch.Tensor, torch.Tensor] | None = None,
        joint_attention_kwargs: dict | None = None,
        split_hidden_states: bool = False,
        text_seq_len: int | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor] | torch.Tensor:
        if encoder_hidden_states is not None:
            text_seq_len = encoder_hidden_states.shape[1]
            hidden_states = torch.cat([encoder_hidden_states, hidden_states], dim=1)

        mod_shift, mod_scale, mod_gate = Flux2Modulation.split(temb_mod, 1)[0]
        norm_hidden_states = self.norm(hidden_states)
        norm_hidden_states = (1 + mod_scale) * norm_hidden_states + mod_shift

        joint_attention_kwargs = joint_attention_kwargs or {}
        attn_output = self.attn(
            hidden_states=norm_hidden_states,
            image_rotary_emb=image_rotary_emb,
            **joint_attention_kwargs,
        )

        hidden_states = _apply_gated_residual(hidden_states, mod_gate, attn_output)
        if hidden_states.dtype == torch.float16:
            hidden_states = hidden_states.clip(-65504, 65504)

        if split_hidden_states:
            encoder_hidden_states, hidden_states = hidden_states[:, :text_seq_len], hidden_states[:, text_seq_len:]
            return encoder_hidden_states, hidden_states
        return hidden_states


class NunchakuFlux2Transformer2DModel(Flux2Transformer2DModel, NunchakuModelLoaderMixin):
    def _patch_model(self, **kwargs):
        for i, block in enumerate(self.transformer_blocks):
            self.transformer_blocks[i] = NunchakuFlux2TransformerBlock(block, **kwargs)
        for i, block in enumerate(self.single_transformer_blocks):
            self.single_transformer_blocks[i] = NunchakuFlux2SingleTransformerBlock(block, **kwargs)
        self.offload = False
        self.transformer_block_offload_manager = None
        self.single_transformer_block_offload_manager = None
        return self

    def set_offload(self, offload: bool, **kwargs):
        if offload == self.offload:
            return

        self.offload = offload
        if offload:
            use_pin_memory = kwargs.get("use_pin_memory", True)
            num_blocks_on_gpu = kwargs.get("num_blocks_on_gpu", 1)
            self.transformer_block_offload_manager = CPUOffloadManager(
                self.transformer_blocks,
                use_pin_memory=use_pin_memory,
                on_gpu_modules=[
                    self.time_guidance_embed,
                    self.double_stream_modulation_img,
                    self.double_stream_modulation_txt,
                    self.single_stream_modulation,
                    self.x_embedder,
                    self.context_embedder,
                    self.norm_out,
                    self.proj_out,
                ],
                num_blocks_on_gpu=num_blocks_on_gpu,
            )
            self.single_transformer_block_offload_manager = CPUOffloadManager(
                self.single_transformer_blocks,
                use_pin_memory=use_pin_memory,
                num_blocks_on_gpu=num_blocks_on_gpu,
            )
        else:
            self.transformer_block_offload_manager = None
            self.single_transformer_block_offload_manager = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    @apply_lora_scale("joint_attention_kwargs")
    def forward(
        self,
        hidden_states: torch.Tensor,
        encoder_hidden_states: torch.Tensor = None,
        timestep: torch.LongTensor = None,
        img_ids: torch.Tensor = None,
        txt_ids: torch.Tensor = None,
        guidance: torch.Tensor = None,
        joint_attention_kwargs: dict | None = None,
        return_dict: bool = True,
        kv_cache=None,
        kv_cache_mode: str | None = None,
        num_ref_tokens: int = 0,
        ref_fixed_timestep: float = 0.0,
    ) -> torch.Tensor | Transformer2DModelOutput:
        if kv_cache_mode is not None:
            return super().forward(
                hidden_states=hidden_states,
                encoder_hidden_states=encoder_hidden_states,
                timestep=timestep,
                img_ids=img_ids,
                txt_ids=txt_ids,
                guidance=guidance,
                joint_attention_kwargs=joint_attention_kwargs,
                return_dict=return_dict,
                kv_cache=kv_cache,
                kv_cache_mode=kv_cache_mode,
                num_ref_tokens=num_ref_tokens,
                ref_fixed_timestep=ref_fixed_timestep,
            )

        if self.offload:
            device = hidden_states.device
            self.transformer_block_offload_manager.set_device(device)
            self.single_transformer_block_offload_manager.set_device(device)

        num_txt_tokens = encoder_hidden_states.shape[1]
        timestep = timestep.to(hidden_states.dtype) * 1000
        if guidance is not None:
            guidance = guidance.to(hidden_states.dtype) * 1000
        temb = self.time_guidance_embed(timestep, guidance)
        double_stream_mod_img = self.double_stream_modulation_img(temb)
        double_stream_mod_txt = self.double_stream_modulation_txt(temb)
        single_stream_mod = self.single_stream_modulation(temb)
        hidden_states = self.x_embedder(hidden_states)
        encoder_hidden_states = self.context_embedder(encoder_hidden_states)

        if img_ids.ndim == 3:
            img_ids = img_ids[0]
        if txt_ids.ndim == 3:
            txt_ids = txt_ids[0]

        image_rotary_emb = self.pos_embed(img_ids)
        text_rotary_emb = self.pos_embed(txt_ids)
        rotary_emb_img = _pack_flux2_rotary_emb(image_rotary_emb)
        rotary_emb_txt = _pack_flux2_rotary_emb(text_rotary_emb)
        rotary_emb_single = _pack_flux2_rotary_emb(
            (
                torch.cat([text_rotary_emb[0], image_rotary_emb[0]], dim=0),
                torch.cat([text_rotary_emb[1], image_rotary_emb[1]], dim=0),
            )
        )
        kv_attn_kwargs = joint_attention_kwargs

        if self.offload:
            compute_stream = torch.cuda.current_stream()
            self.transformer_block_offload_manager.initialize(compute_stream)
            for index_block in range(len(self.transformer_blocks)):
                with torch.cuda.stream(compute_stream):
                    block = self.transformer_block_offload_manager.get_block(index_block)
                    if torch.is_grad_enabled() and self.gradient_checkpointing:
                        encoder_hidden_states, hidden_states = self._gradient_checkpointing_func(
                            block,
                            hidden_states,
                            encoder_hidden_states,
                            double_stream_mod_img,
                            double_stream_mod_txt,
                            (rotary_emb_img, rotary_emb_txt),
                            kv_attn_kwargs,
                        )
                    else:
                        encoder_hidden_states, hidden_states = block(
                            hidden_states=hidden_states,
                            encoder_hidden_states=encoder_hidden_states,
                            temb_mod_img=double_stream_mod_img,
                            temb_mod_txt=double_stream_mod_txt,
                            image_rotary_emb=(rotary_emb_img, rotary_emb_txt),
                            joint_attention_kwargs=kv_attn_kwargs,
                        )
                    self.transformer_block_offload_manager.step(compute_stream)
        else:
            for index_block, block in enumerate(self.transformer_blocks):
                if torch.is_grad_enabled() and self.gradient_checkpointing:
                    encoder_hidden_states, hidden_states = self._gradient_checkpointing_func(
                        block,
                        hidden_states,
                        encoder_hidden_states,
                        double_stream_mod_img,
                        double_stream_mod_txt,
                        (rotary_emb_img, rotary_emb_txt),
                        kv_attn_kwargs,
                    )
                else:
                    encoder_hidden_states, hidden_states = block(
                        hidden_states=hidden_states,
                        encoder_hidden_states=encoder_hidden_states,
                        temb_mod_img=double_stream_mod_img,
                        temb_mod_txt=double_stream_mod_txt,
                        image_rotary_emb=(rotary_emb_img, rotary_emb_txt),
                        joint_attention_kwargs=kv_attn_kwargs,
                    )

        hidden_states = torch.cat([encoder_hidden_states, hidden_states], dim=1)
        kv_attn_kwargs_single = kv_attn_kwargs

        if self.offload:
            self.single_transformer_block_offload_manager.initialize(compute_stream)
            for index_block in range(len(self.single_transformer_blocks)):
                with torch.cuda.stream(compute_stream):
                    block = self.single_transformer_block_offload_manager.get_block(index_block)
                    if torch.is_grad_enabled() and self.gradient_checkpointing:
                        hidden_states = self._gradient_checkpointing_func(
                            block,
                            hidden_states,
                            None,
                            single_stream_mod,
                            rotary_emb_single,
                            kv_attn_kwargs_single,
                        )
                    else:
                        hidden_states = block(
                            hidden_states=hidden_states,
                            encoder_hidden_states=None,
                            temb_mod=single_stream_mod,
                            image_rotary_emb=rotary_emb_single,
                            joint_attention_kwargs=kv_attn_kwargs_single,
                        )
                    self.single_transformer_block_offload_manager.step(compute_stream)
        else:
            for index_block, block in enumerate(self.single_transformer_blocks):
                if torch.is_grad_enabled() and self.gradient_checkpointing:
                    hidden_states = self._gradient_checkpointing_func(
                        block,
                        hidden_states,
                        None,
                        single_stream_mod,
                        rotary_emb_single,
                        kv_attn_kwargs_single,
                    )
                else:
                    hidden_states = block(
                        hidden_states=hidden_states,
                        encoder_hidden_states=None,
                        temb_mod=single_stream_mod,
                        image_rotary_emb=rotary_emb_single,
                        joint_attention_kwargs=kv_attn_kwargs_single,
                    )

        hidden_states = hidden_states[:, num_txt_tokens:, ...]

        hidden_states = self.norm_out(hidden_states, temb)
        output = self.proj_out(hidden_states)

        if not return_dict:
            return (output,)

        return Transformer2DModelOutput(sample=output)

    @classmethod
    @utils.validate_hf_hub_args
    def from_pretrained(cls, pretrained_model_name_or_path: str | os.PathLike[str], **kwargs):
        device = kwargs.get("device", "cpu")
        offload = kwargs.get("offload", False)
        pin_memory = kwargs.get("pin_memory", "auto")
        torch_dtype = kwargs.get("torch_dtype", torch.bfloat16)

        if offload:
            raise NotImplementedError("Offload is not supported for NunchakuFlux2Transformer2DModel")

        if isinstance(pretrained_model_name_or_path, str):
            pretrained_model_name_or_path = Path(pretrained_model_name_or_path)

        if not (
            pretrained_model_name_or_path.is_file()
            or pretrained_model_name_or_path.name.endswith((".safetensors", ".sft"))
        ):
            raise AssertionError("Only safetensors are supported")

        transformer, model_state_dict, metadata = cls._build_model(pretrained_model_name_or_path, **kwargs)
        quantization_config = json.loads(metadata.get("quantization_config", "{}"))
        rank = int(quantization_config.get("rank", 32))
        if quantization_config:
            precision = get_precision_from_quantization_config(quantization_config)
            if torch.device(device).type == "cuda":
                check_hardware_compatibility(quantization_config, device)
            else:
                precision = get_precision(device=device)
            if precision == "fp4":
                precision = "nvfp4"

        transformer = transformer.to(torch_dtype)
        transformer._patch_model(precision=precision, rank=rank, torch_dtype=torch_dtype)
        transformer = transformer.to_empty(device=device)

        patch_scale_key(transformer, model_state_dict)
        if resolve_pin_memory(pin_memory, device):
            model_state_dict = pin_state_dict(model_state_dict)

        transformer.load_state_dict(model_state_dict)

        if kwargs.get("return_metadata", False):
            return transformer, metadata
        return transformer

    def to(self, *args, **kwargs):
        device_arg_or_kwarg_present = any(isinstance(arg, torch.device) for arg in args) or "device" in kwargs

        for arg in args:
            if not isinstance(arg, str):
                continue
            try:
                torch.device(arg)
                device_arg_or_kwarg_present = True
            except RuntimeError:
                pass

        if getattr(self, "offload", False) and device_arg_or_kwarg_present:
            warn("Skipping moving the model to GPU as offload is enabled", UserWarning)
            return self
        return super(type(self), self).to(*args, **kwargs)
'''


# ---------------------------------------------------------------------------
# Embedded ComfyFlux2KleinWrapper source code
# This is the complete, self-contained wrapper that bridges nunchaku's
# quantized FLUX.2 transformer with ComfyUI's forward conventions.
# ---------------------------------------------------------------------------
_KLEIN_WRAPPER_SOURCE = '''"""
ComfyFlux2KleinWrapper - bridges nunchaku's FLUX.2 Klein transformer with ComfyUI.

This module is auto-generated and embedded in Magic Assistant.
"""

from typing import Callable, Optional, Tuple

import torch
from comfy.ldm.common_dit import pad_to_patch_size
from comfy.model_patcher import ModelPatcher
from einops import rearrange, repeat
from torch import nn

from nunchaku.models.transformers.transformer_flux2 import NunchakuFlux2Transformer2DModel
from nunchaku.caching.fbcache import cache_context, create_cache_context
from nunchaku.lora.flux.compose import compose_lora
from nunchaku.utils import load_state_dict_in_safetensors


class ComfyFlux2KleinWrapper(nn.Module):
    """
    Wrapper for Nunchaku FLUX.2 Klein transformer to support ComfyUI workflows,
    LoRA composition, and caching.

    Parameters
    ----------
    model : NunchakuFlux2Transformer2DModel
        The underlying Nunchaku FLUX.2 Klein model to wrap.
    config : dict
        Model configuration dictionary.
    pulid_pipeline : object, optional
        Optional pipeline for Pulid integration.
    customized_forward : Callable, optional
        Optional custom forward function.
    forward_kwargs : dict, optional
        Additional keyword arguments for the forward pass.
    ctx_for_copy : dict
        A dict that holds initialization context for later duplication of this object.
    """

    def __init__(
        self,
        model: NunchakuFlux2Transformer2DModel,
        config: dict,
        pulid_pipeline=None,
        customized_forward: Callable = None,
        forward_kwargs: Optional[dict] = None,
        ctx_for_copy: Optional[dict] = None,
    ):
        super().__init__()
        self.model = model
        self.dtype = next(model.parameters()).dtype
        self.config = config
        self.loras = []

        self.pulid_pipeline = pulid_pipeline
        self.customized_forward = customized_forward
        self.forward_kwargs = {} if forward_kwargs is None else forward_kwargs

        self.ctx_for_copy = (ctx_for_copy or {}).copy()

        self._prev_timestep = None
        self._cache_context = None

    def process_img(self, x, index=0, h_offset=0, w_offset=0):
        """
        Preprocess an input image tensor for the model.

        Pads and rearranges the image into patches and generates corresponding image IDs.

        Parameters
        ----------
        x : torch.Tensor
            Input image tensor of shape (batch, channels, height, width).
        index : int, optional
            Index for image ID encoding.
        h_offset : int, optional
            Height offset for patch IDs.
        w_offset : int, optional
            Width offset for patch IDs.

        Returns
        -------
        img : torch.Tensor
            Rearranged image tensor of shape (batch, num_patches, patch_dim).
        img_ids : torch.Tensor
            Image ID tensor of shape (batch, num_patches, num_axes).
        """
        bs, c, h, w = x.shape
        patch_size = self.config.get("patch_size", 1)
        axes_dim = self.config.get("axes_dim", [32, 32, 32, 32])
        num_axes = len(axes_dim)
        x = pad_to_patch_size(x, (patch_size, patch_size))

        img = rearrange(x, "b c (h ph) (w pw) -> b (h w) (c ph pw)", ph=patch_size, pw=patch_size)
        h_len = (h + (patch_size // 2)) // patch_size
        w_len = (w + (patch_size // 2)) // patch_size

        h_offset = (h_offset + (patch_size // 2)) // patch_size
        w_offset = (w_offset + (patch_size // 2)) // patch_size

        id_dtype = torch.float32
        img_ids = torch.zeros((h_len, w_len, num_axes), device=x.device, dtype=id_dtype)
        img_ids[:, :, 0] = img_ids[:, :, 1] + index
        img_ids[:, :, 1] = img_ids[:, :, 1] + torch.linspace(
            h_offset, h_len - 1 + h_offset, steps=h_len, device=x.device, dtype=id_dtype
        ).unsqueeze(1)
        img_ids[:, :, 2] = img_ids[:, :, 2] + torch.linspace(
            w_offset, w_len - 1 + w_offset, steps=w_len, device=x.device, dtype=id_dtype
        ).unsqueeze(0)
        return img, repeat(img_ids, "h w c -> b (h w) c", b=bs)

    def forward(
        self,
        x,
        timestep,
        context,
        y=None,
        guidance=None,
        control=None,
        transformer_options=None,
        **kwargs,
    ):
        """
        Forward pass for the wrapped FLUX.2 Klein model.

        Handles LoRA composition, caching, PuLID integration, and reference latents.
        """
        if transformer_options is None:
            transformer_options = {}
        if y is None:
            y = transformer_options.get("y")
        if guidance is None:
            guidance = kwargs.get("guidance")

        if isinstance(timestep, torch.Tensor):
            if timestep.numel() == 1:
                timestep_float = timestep.item()
            else:
                timestep_float = timestep.flatten()[0].item()
        else:
            assert isinstance(timestep, float)
            timestep_float = timestep

        model = self.model
        assert isinstance(model, NunchakuFlux2Transformer2DModel)

        bs, c, h_orig, w_orig = x.shape
        patch_size = self.config.get("patch_size", 1)
        h_len = (h_orig + (patch_size // 2)) // patch_size
        w_len = (w_orig + (patch_size // 2)) // patch_size

        img, img_ids = self.process_img(x)
        img_tokens = img.shape[1]

        ref_latents = kwargs.get("ref_latents")
        ref_index_scale = float(self.config.get("ref_index_scale", 10.0))
        if ref_latents is not None:
            h = 0
            w = 0
            index = 0.0
            for ref in ref_latents:
                h_offset = 0
                w_offset = 0
                index += ref_index_scale
                if ref.shape[-2] + h > ref.shape[-1] + w:
                    w_offset = w
                else:
                    h_offset = h

                kontext, kontext_ids = self.process_img(ref, index=index, h_offset=h_offset, w_offset=w_offset)
                img = torch.cat([img, kontext], dim=1)
                img_ids = torch.cat([img_ids, kontext_ids], dim=1)
                h = max(h, ref.shape[-2] + h_offset)
                w = max(w, ref.shape[-1] + w_offset)

        axes_dim = self.config.get("axes_dim", [32, 32, 32, 32])
        num_axes = len(axes_dim)
        id_dtype = torch.float32
        txt_ids = torch.zeros((bs, context.shape[1], num_axes), device=x.device, dtype=id_dtype)
        txt_ids_dims = self.config.get("txt_ids_dims", [3])
        if len(txt_ids_dims) > 0:
            seq = context.shape[1]
            for i in txt_ids_dims:
                txt_ids[:, :, i] = torch.linspace(
                    0, seq - 1, steps=seq, device=x.device, dtype=id_dtype
                )

        if hasattr(model, "comfy_lora_meta_list") and self.loras != model.comfy_lora_meta_list:
            lora_to_be_composed = []
            for _ in range(max(0, len(model.comfy_lora_meta_list) - len(self.loras))):
                model.comfy_lora_meta_list.pop()
                model.comfy_lora_sd_list.pop()
            for i in range(len(self.loras)):
                meta = self.loras[i]
                if i >= len(model.comfy_lora_meta_list):
                    sd = load_state_dict_in_safetensors(meta[0])
                    model.comfy_lora_meta_list.append(meta)
                    model.comfy_lora_sd_list.append(sd)
                elif model.comfy_lora_meta_list[i] != meta:
                    if meta[0] != model.comfy_lora_meta_list[i][0]:
                        sd = load_state_dict_in_safetensors(meta[0])
                        model.comfy_lora_sd_list[i] = sd
                    model.comfy_lora_meta_list[i] = meta
                lora_to_be_composed.append(({k: v for k, v in model.comfy_lora_sd_list[i].items()}, meta[1]))

            composed_lora = compose_lora(lora_to_be_composed)

            if len(composed_lora) == 0:
                model.reset_lora()
            else:
                if "x_embedder.lora_A.weight" in composed_lora:
                    new_in_channels = composed_lora["x_embedder.lora_A.weight"].shape[1]
                    current_in_channels = model.x_embedder.in_features
                    if new_in_channels < current_in_channels:
                        model.reset_x_embedder()
                model.update_lora_params(composed_lora)

        if getattr(model, "residual_diff_threshold_multi", 0) != 0 or getattr(model, "_is_cached", False):
            cache_invalid = False

            if self._prev_timestep is None:
                cache_invalid = True
            elif self._prev_timestep < timestep_float + 1e-5:
                cache_invalid = True

            if cache_invalid:
                self._cache_context = create_cache_context()

            self._prev_timestep = timestep_float
            with cache_context(self._cache_context):
                if self.customized_forward is None:
                    out = model(
                        hidden_states=img,
                        encoder_hidden_states=context,
                        guidance=guidance if self.config["guidance_embed"] else None,
                    ).sample
                else:
                    out = self.customized_forward(
                        model,
                        hidden_states=img,
                        encoder_hidden_states=context,
                        timestep=timestep,
                        img_ids=img_ids,
                        txt_ids=txt_ids,
                        guidance=guidance if self.config["guidance_embed"] else None,
                        **self.forward_kwargs,
                    ).sample
        else:
            if self.customized_forward is None:
                out = model(
                    hidden_states=img,
                    encoder_hidden_states=context,
                    timestep=timestep,
                    img_ids=img_ids,
                    txt_ids=txt_ids,
                    guidance=guidance if self.config["guidance_embed"] else None,
                ).sample
            else:
                out = self.customized_forward(
                    model,
                    hidden_states=img,
                    encoder_hidden_states=context,
                    timestep=timestep,
                    img_ids=img_ids,
                    txt_ids=txt_ids,
                    guidance=guidance if self.config["guidance_embed"] else None,
                    **self.forward_kwargs,
                ).sample

        if self.pulid_pipeline is not None and hasattr(model, "transformer_blocks"):
            self.model.transformer_blocks[0].pulid_ca = None

        out = out[:, :img_tokens]
        out = rearrange(
            out,
            "b (h w) (c ph pw) -> b c (h ph) (w pw)",
            h=h_len,
            w=w_len,
            ph=patch_size,
            pw=patch_size,
        )
        out = out[:, :, :h_orig, :w_orig]

        self._prev_timestep = timestep_float
        return out


def copy_with_ctx(model_wrapper: ComfyFlux2KleinWrapper) -> Tuple[ComfyFlux2KleinWrapper, ModelPatcher]:
    """
    Duplicates a ComfyFlux2KleinWrapper object with its initialization context.

    Also creates a ModelPatcher object that holds the model_base object.
    """
    from comfy.model_base import BaseModel

    ctx_for_copy = model_wrapper.ctx_for_copy
    ret_model_wrapper = ComfyFlux2KleinWrapper(
        model_wrapper.model,
        config=ctx_for_copy["comfy_config"]["model_config"],
        ctx_for_copy={
            "comfy_config": ctx_for_copy["comfy_config"],
            "model_config": ctx_for_copy["model_config"],
            "device": ctx_for_copy["device"],
            "device_id": ctx_for_copy["device_id"],
        },
    )
    model_base = ctx_for_copy["model_config"].get_model({})
    model_base.diffusion_model = ret_model_wrapper
    ret_model = ModelPatcher(model_base, ctx_for_copy["device"], ctx_for_copy["device_id"])
    return ret_model_wrapper, ret_model
'''
