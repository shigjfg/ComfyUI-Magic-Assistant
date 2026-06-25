"""
Klein wrapper setup - add the missing FLUX.2 Klein wrapper to the user's nunchaku environment.

Downloads the latest FLUX.2 Klein support files directly from HuggingFace
(https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku) instead of embedding them,
ensuring files are always complete and up-to-date.

Files downloaded from HuggingFace:
    {nunchaku_base}/torch_transfer_utils.py
    {nunchaku_base}/models/transformers/transformer_flux2.py
    {nunchaku_base}/lora/common/__init__.py
    {nunchaku_base}/lora/common/compose.py
    {nunchaku_base}/lora/common/mixin.py

Embedded (ComfyUI-specific, not on HuggingFace):
    {nunchaku_base}/wrappers/klein.py

Path resolution:
  - Node location: ComfyUI/custom_nodes/ComfyUI-Magic-Assistant/core/
  - ComfyUI root:  ComfyUI/  (parent of custom_nodes/)
  - Python env:     ComfyUI_windows_portable/python_embeded/  (sibling of ComfyUI/)
"""
import ast
import hashlib
import os
import re
import sys
import urllib.request

_NUNCHAKU_BASE = None
_COMFYUI_ROOT = None

# HuggingFace source for FLUX.2 Klein support files
HF_REPO = "tonera/FLUX.2-klein-9B-Nunchaku"
HF_RAW_BASE = f"https://huggingface.co/{HF_REPO}/raw/main"

# Files to download from HuggingFace (relative to nunchaku_base)
# Maps: (hf_path, nunchaku_subpath) — hf_path is the path on HuggingFace repo root
_HF_FILES = [
    # Root-level FLUX.2 runtime files
    ("torch_transfer_utils.py",                           "torch_transfer_utils.py"),
    ("transformer_flux2.py",                             "models/transformers/transformer_flux2.py"),
    ("common/__init__.py",                               "lora/common/__init__.py"),
    ("common/compose.py",                                 "lora/common/compose.py"),
    ("common/mixin.py",                                  "lora/common/mixin.py"),
]

def _download_hf_file(hf_path: str) -> tuple[bytes, str]:
    """
    Download a file from HuggingFace and return (content_bytes, etag).
    Returns (b"", etag_or_empty) on failure.
    """
    url = f"{HF_RAW_BASE}/{hf_path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                return b"", ""
            content = resp.read()
            etag = resp.headers.get("ETag", "").strip('"')
            return content, etag
    except Exception as e:
        print(f"[Magic Klein] Download failed {url}: {e}")
        return b"", ""

def _write_file(path: str, content: bytes, newline: bool = True) -> None:
    """Write bytes to file, optionally normalising line endings to LF."""
    mode = "wb"
    with open(path, mode) as f:
        if newline and b"\r\n" in content:
            content = content.replace(b"\r\n", b"\n")
        f.write(content)

def _file_hash(path: str) -> str:
    """Return MD5 hex digest of a local file, or '' if unreadable."""
    try:
        with open(path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return ""

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

    Uses sys.path to find site-packages, which works for any ComfyUI installation:
    - Portable version (python_embeded)
    - Aki (秋叶版)
    - Desktop version (system Python)
    - Any custom installation
    """
    seen: set[str] = set()
    out: list[str] = []

    # Primary: use sys.path which always reflects the actual Python environment
    if sys.path:
        import site
        # site.getsitepackages() returns all site-packages directories
        # This works regardless of how Python was installed
        try:
            site_packages_dirs = site.getsitepackages()
        except AttributeError:
            # Python < 3.3 doesn't have getsitepackages
            site_packages_dirs = []

        # Also add sys.path entries that look like site-packages
        for p in sys.path:
            p_norm = os.path.normpath(p)
            if p_norm not in seen:
                # Check if it's a site-packages directory
                if "site-packages" in p_norm.lower():
                    if os.path.isdir(p):
                        seen.add(p_norm)
                        out.append(p_norm)
                        continue
                # Or use the directories from site.getsitepackages()
                for sp in site_packages_dirs:
                    sp_norm = os.path.normpath(sp)
                    if sp_norm == p_norm and sp_norm not in seen:
                        seen.add(sp_norm)
                        out.append(sp_norm)

        # Ensure the explicit site.getsitepackages() results are included
        for sp in site_packages_dirs:
            sp_norm = os.path.normpath(sp)
            if sp_norm not in seen and os.path.isdir(sp_norm):
                seen.add(sp_norm)
                out.append(sp_norm)

    # Fallback: try paths from sys.executable (works for embedded Python)
    exe_sp = _site_packages_from_python_exe(getattr(sys, "executable", None) or None)
    if exe_sp and os.path.isdir(exe_sp):
        exe_sp_norm = os.path.normpath(exe_sp)
        if exe_sp_norm not in seen:
            seen.add(exe_sp_norm)
            out.append(exe_sp_norm)

    # Last fallback: infer from ComfyUI root (portable version layout)
    comfyui_lib = get_comfyui_python_lib()
    if comfyui_lib and os.path.isdir(comfyui_lib):
        comfyui_lib_norm = os.path.normpath(comfyui_lib)
        if comfyui_lib_norm not in seen:
            seen.add(comfyui_lib_norm)
            out.append(comfyui_lib_norm)

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
    """Check if nunchaku.wrappers.klein is importable or the file exists."""
    # 先检查文件是否存在
    nunchaku_base = get_nunchaku_base()
    if nunchaku_base is not None:
        klein_file = os.path.join(nunchaku_base, "wrappers", "klein.py")
        if os.path.isfile(klein_file):
            return True
    # 回退到 import 检测
    try:
        from nunchaku.wrappers.klein import ComfyFlux2KleinWrapper
        return True
    except ImportError:
        pass
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
    """
    Patch models/transformers/__init__.py to:
      1. Fix broken 'from .torch_transfer_utils import pin_state_dict'
         (torch_transfer_utils lives at nunchaku/ root, so needs 'from ..torch_transfer_utils')
      2. Add 'from .transformer_flux2 import NunchakuFlux2Transformer2DModel' if missing
      3. Add 'NunchakuFlux2Transformer2DModel' to __all__ if missing
    """
    c = content
    changed = False

    # 1. Fix broken same-level import of torch_transfer_utils (which lives at nunchaku/ root)
    if re.search(r"from\s+\.torch_transfer_utils\s+import", c):
        c = re.sub(
            r"from\s+\.torch_transfer_utils\s+import\s+pin_state_dict",
            "from ..torch_transfer_utils import pin_state_dict",
            c,
        )
        changed = True

    # 2. Add transformer_flux2 import if missing
    if not re.search(r"from\s+\.transformer_flux2\s+import", c):
        line = "from .transformer_flux2 import NunchakuFlux2Transformer2DModel\n"
        m = re.search(r"^__all__\s*=", c, re.MULTILINE)
        if m:
            c = c[: m.start()] + line + c[m.start() :]
        else:
            sep = "\n" if c.strip() else ""
            c = c.rstrip() + sep + line
        changed = True

    # 3. Add model to __all__
    c2, ch2 = _add_export_to_all_list(c, _FLUX2_MODEL)
    return c2, changed or ch2

def _flush_init_py_writes(pairs: list[tuple[str, str]]) -> None:
    for path, content in pairs:
        ast.parse(content, filename=path)
    for path, content in pairs:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)

def install_wrapper_to_nunchaku(force_update: bool = False) -> tuple[bool, str]:
    """Download and install FLUX.2 Klein support files into the user's nunchaku environment.

    Downloads from HuggingFace (tonera/FLUX.2-klein-9B-Nunchaku):
        {nunchaku_base}/torch_transfer_utils.py
        {nunchaku_base}/models/transformers/transformer_flux2.py
        {nunchaku_base}/lora/common/__init__.py
        {nunchaku_base}/lora/common/compose.py
        {nunchaku_base}/lora/common/mixin.py

    Embeds (ComfyUI-specific bridge):
        {nunchaku_base}/wrappers/klein.py

    Args:
        force_update: if True, re-download all files even if they already exist.

    Returns (success, message).
    """
    nunchaku_base = get_nunchaku_base()
    if nunchaku_base is None:
        return False, "nunchaku package not found in ComfyUI's Python environment."

    created = []
    updated = []
    failed = []

    print(f"[Magic Klein] Installing FLUX.2 Klein files from {HF_REPO} ...")

    # 1. Download core files from HuggingFace
    for hf_rel_path, nunchaku_subpath in _HF_FILES:
        local_path = os.path.join(nunchaku_base, nunchaku_subpath)
        dir_name = os.path.dirname(local_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)

        existing_hash = _file_hash(local_path) if os.path.exists(local_path) else ""
        content_bytes, etag = _download_hf_file(hf_rel_path)

        if not content_bytes:
            failed.append(f"{nunchaku_subpath} (download failed)")
            continue

        new_hash = hashlib.md5(content_bytes).hexdigest()

        if not force_update and existing_hash and existing_hash == new_hash:
            print(f"  [skip, unchanged] {nunchaku_subpath}")
            continue

        try:
            _write_file(local_path, content_bytes)
            if existing_hash:
                updated.append(nunchaku_subpath)
                print(f"  [updated] {nunchaku_subpath}")
            else:
                created.append(nunchaku_subpath)
                print(f"  [created] {nunchaku_subpath}")
        except Exception as e:
            failed.append(f"{nunchaku_subpath} ({e})")

    # 2. Patch __init__.py files — add FLUX.2 exports / fix broken imports
    # Use dedicated patchers so each file gets the right transformations.
    _PATCHERS = {
        "":          _patch_flux2_nunchaku_package_init,        # nunchaku/__init__.py
        "models/":   _patch_flux2_models_package_init,          # nunchaku/models/__init__.py
        "models/transformers/": _patch_flux2_transformers_package_init,  # nunchaku/models/transformers/__init__.py
    }
    for sub_path, patcher_fn in _PATCHERS.items():
        init_path = os.path.join(nunchaku_base, sub_path, "__init__.py")
        if not os.path.exists(init_path):
            continue
        with open(init_path, "r", encoding="utf-8") as f:
            src = f.read()
        new_src, changed = patcher_fn(src)
        if changed:
            try:
                ast.parse(new_src, filename=init_path)
                with open(init_path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(new_src)
                updated.append(init_path)
                key = sub_path.rstrip("/") or "root"
                print(f"  [patched] {key}/__init__.py")
            except SyntaxError as e:
                return False, f"Patch aborted: {os.path.basename(init_path)} would be invalid Python: {e}"

    # 3. Embed wrappers/klein.py (ComfyUI-specific bridge — not on HuggingFace)
    wrappers_dir = os.path.join(nunchaku_base, "wrappers")
    os.makedirs(wrappers_dir, exist_ok=True)

    wrappers_init_path = os.path.join(wrappers_dir, "__init__.py")
    if not os.path.exists(wrappers_init_path):
        with open(wrappers_init_path, "w", encoding="utf-8") as f:
            f.write('"""Nunchaku model wrappers for ComfyUI integration."""\n')
            f.write("from .klein import ComfyFlux2KleinWrapper, copy_with_ctx\n")
            f.write('__all__ = ["ComfyFlux2KleinWrapper", "copy_with_ctx"]\n')
        created.append("wrappers/__init__.py")

    klein_py = os.path.join(wrappers_dir, "klein.py")
    try:
        _write_file(klein_py, _KLEIN_WRAPPER_SOURCE.encode("utf-8"))
        if os.path.exists(klein_py):
            updated.append("wrappers/klein.py")
        else:
            created.append("wrappers/klein.py")
    except Exception as e:
        failed.append(f"wrappers/klein.py ({e})")

    # Summary
    if failed:
        return False, ("Some files could not be installed:\n" +
                        "\n".join(f"  FAIL {f}" for f in failed))

    parts = [f"Successfully installed FLUX.2 Klein files to {nunchaku_base}"]
    if created:
        parts.append("  Created: " + "\n  Created: ".join(created))
    if updated:
        parts.append("  Updated: " + "\n  Updated: ".join(updated))

    print(f"[Magic Klein] Installation complete: {len(created)} created, {len(updated)} updated.")
    return True, "\n".join(parts)

def _check_diffusers_version() -> tuple[bool, str, str]:
    """
    Check if diffusers version is sufficient for nunchaku FLUX.2 Klein.
    
    Returns:
        (is_sufficient, current_version, min_required_version)
    """
    try:
        import diffusers
        current = diffusers.__version__
    except ImportError:
        return False, "not_installed", "0.37.0"
    
    # Minimum version for apply_lora_scale (used by nunchaku)
    min_version = "0.37.0"
    
    from packaging import version
    try:
        if version.parse(current) >= version.parse(min_version):
            return True, current, min_version
        else:
            return False, current, min_version
    except Exception:
        # If version parsing fails, assume it's too old
        return False, current, min_version


def check_environment() -> dict:
    """Check the current state of the nunchaku FLUX.2 environment.

    Returns:
        dict with keys:
        - nunchaku_found: bool
        - nunchaku_base: str | None
        - wrapper_installed: bool
        - transformer_available: bool      # transformer_flux2.py present
        - torch_transfer_utils_available: bool
        - common_available: bool          # lora/common/ present with all required files
        - common_files: dict              # per-file availability
        - needs_patch: bool
        - diffusers_ok: bool              # diffusers version >= 0.37.0
        - diffusers_version: str
        - comfyui_root: str | None
        - comfyui_python: str | None
        - comfyui_python_lib: str | None
        - install_status: str  # "ready" | "needs_patch" | "missing_nunchaku" | "missing_transformer" | "missing_core_files" | "missing_common" | "diffusers_old"
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
            "common_available": False,
            "common_files": {},
            "needs_patch": False,
            "diffusers_ok": False,
            "diffusers_version": "unknown",
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
    common_available = False
    common_files = {}
    REQUIRED_COMMON_FILES = ["__init__.py", "compose.py", "mixin.py"]
    if nunchaku_found:
        # 先检查文件是否存在（文件系统检测），再尝试 import
        # 这样即使 __init__.py 配置有问题，只要文件存在就认为是可用的
        transformer_file = os.path.join(nunchaku_base, "models", "transformers", "transformer_flux2.py")
        torch_transfer_file = os.path.join(nunchaku_base, "torch_transfer_utils.py")

        if os.path.isfile(transformer_file):
            try:
                from nunchaku.models.transformers.transformer_flux2 import NunchakuFlux2Transformer2DModel
                transformer_available = True
            except ImportError:
                # 文件存在但 import 失败，说明 __init__.py 未正确配置导入
                # 这种情况也视为文件可用，只是需要 patch
                transformer_available = True

        if os.path.isfile(torch_transfer_file):
            try:
                from nunchaku.torch_transfer_utils import pin_state_dict
                torch_transfer_utils_available = True
            except ImportError:
                torch_transfer_utils_available = True
        # 检查 lora/common/ 文件夹及文件完整性
        # 先用文件系统检测，import 只是辅助确认
        common_files = {}
        if nunchaku_base:
            common_dir = os.path.join(nunchaku_base, "lora", "common")
            if os.path.isdir(common_dir):
                common_files = {
                    fname: os.path.isfile(os.path.join(common_dir, fname))
                    for fname in REQUIRED_COMMON_FILES
                }
            else:
                common_files = {fname: False for fname in REQUIRED_COMMON_FILES}
            common_available = all(common_files.values())
        else:
            common_files = {fname: False for fname in REQUIRED_COMMON_FILES}
            common_available = False

    core_files_ok = transformer_available and torch_transfer_utils_available

    # Check diffusers version
    diffusers_ok, diffusers_version, diffusers_min = _check_diffusers_version()

    # common 文件夹不完整也视为需要更新
    needs_patch = (
        nunchaku_found
        and core_files_ok
        and (not wrapper_installed or not common_available)
    )

    install_status = "ready"
    status_text = {"zh": "环境就绪，可以正常加载模型", "en": "Environment ready, can load models normally"}
    suggestion = ""

    # diffusers version check has highest priority - needs to be fixed first
    if not diffusers_ok:
        install_status = "diffusers_old"
        status_text = {
            "zh": f"diffusers 版本过低（当前: {diffusers_version}，需要: ≥{diffusers_min}）",
            "en": f"diffusers version too old (current: {diffusers_version}, required: ≥{diffusers_min})",
        }
        python_path = comfyui_python or "python"
        suggestion = (
            f"Please update diffusers in ComfyUI's Python environment:\n"
            f'  {python_path} -m pip install -U diffusers\n'
            f"Restart ComfyUI after updating."
        )
    elif not nunchaku_found:
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
                  "点击「下载并安装」按钮添加",
            "en": "nunchaku found but core files are missing (transformer_flux2.py / torch_transfer_utils.py), "
                  "click 'Download & Install' to add them",
        }
        suggestion = (
            "nunchaku found but transformer_flux2.py or torch_transfer_utils.py is missing. "
            "Magic Klein Loader will automatically add them - no manual action needed."
        )
    elif nunchaku_found and not common_available:
        install_status = "missing_common"
        missing = [f for f, ok in common_files.items() if not ok]
        status_text = {
            "zh": f"lora/common/ 文件夹缺失或不完整（缺少：{', '.join(missing)}），"
                  "点击「下载并安装」按钮添加",
            "en": f"lora/common/ folder missing or incomplete (missing: {', '.join(missing)}), "
                  "click 'Download & Install' to add them",
        }
        suggestion = (
            "lora/common/ files are missing. "
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
        "common_available": common_available,
        "common_files": common_files,
        "needs_patch": needs_patch,
        "diffusers_ok": diffusers_ok,
        "diffusers_version": diffusers_version,
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

# ---------------------------------------------------------------------------
# Embedded models/transformers/utils.py
# From: https://github.com/nunchaku-ai/nunchaku/commit/a515fc2740a17410fa2fcef6dc59229744d82fa0/nunchaku/models/transformers/utils.py
# ---------------------------------------------------------------------------

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
        self.pulid_pipeline = pulid_pipeline
        self.customized_forward = customized_forward
        self.forward_kwargs = {} if forward_kwargs is None else forward_kwargs

        self.ctx_for_copy = (ctx_for_copy or {}).copy()

        self._prev_timestep = None
        self._cache_context = None

    # ------------------------------------------------------------------ #
    # LoRA management - delegates to the underlying nunchaku transformer
    # via SVDQLoRAMixin (update_lora_params / set_lora_strength / reset_lora)
    # ------------------------------------------------------------------ #

    def update_lora_params(self, lora_path_or_state_dict, strength: float = 1.0) -> None:
        """Load and apply LoRA weights via the nunchaku transformer's native API."""
        self.model.update_lora_params(lora_path_or_state_dict, strength=strength)

    def set_lora_strength(self, strength: float = 1.0) -> None:
        """Adjust LoRA strength without reloading weights."""
        self.model.set_lora_strength(strength)

    def reset_lora(self) -> None:
        """Remove all LoRA effects and restore original weights."""
        self.model.reset_lora()

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

# ---------------------------------------------------------------------------
# Embedded nunchaku/lora/common/compose.py
# From: nunchaku/lora/common/compose.py (author-provided file)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Embedded nunchaku/lora/common/mixin.py
# From: nunchaku/lora/common/mixin.py (author-provided file)
# ---------------------------------------------------------------------------

