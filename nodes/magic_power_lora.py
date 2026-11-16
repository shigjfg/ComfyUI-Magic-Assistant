import torch
import os
import json
import folder_paths
import comfy.sd
import comfy.utils
import comfy.lora
from server import PromptServer
from aiohttp import web
import numpy as np
from PIL import Image
import hashlib
import urllib.request
import urllib.error
import urllib.parse
import re
import shutil
import tempfile
import time
import asyncio
import functools
import math
import stat
import sqlite3
import importlib.util
from datetime import datetime, timezone
from collections import defaultdict

_LORA_PREVIEW_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".preview.png", ".preview.jpg", ".cover.png", ".cover.jpg")

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

# 包内相对导入，避免与其他插件的顶层 utils 包冲突
from ..utils import MagicUtils

# Load the independent standard-library helper without executing core's SDNQ exports.
# ComfyUI may import this plugin under a generated package name, with no root on sys.path.
_lora_state_spec = importlib.util.spec_from_file_location(
    __name__ + "_metadata_state", os.path.join(os.path.dirname(os.path.dirname(__file__)), "core", "lora_metadata_state.py")
)
_lora_state_module = importlib.util.module_from_spec(_lora_state_spec)
_lora_state_spec.loader.exec_module(_lora_state_module)
LoraMetadataState = _lora_state_module.LoraMetadataState
_METADATA_KINDS = _lora_state_module.KINDS
_METADATA_SKIP_STATES = _lora_state_module.SKIP_STATES
file_identity = _lora_state_module.file_identity
identity_matches = _lora_state_module.identity_matches
model_lock = _lora_state_module.model_lock
field_state = _lora_state_module.field_state

_lm_spec = importlib.util.spec_from_file_location(
    __name__ + "_lm_sidecar", os.path.join(os.path.dirname(os.path.dirname(__file__)), "core", "lm_sidecar.py")
)
_lm_module = importlib.util.module_from_spec(_lm_spec)
_lm_spec.loader.exec_module(_lm_module)
lm_sidecar = _lm_module

_LM_META_CACHE = {}


def _lm_meta(lora_path):
    """读 LM sidecar，按 mtime+size 缓存；文件变动后自动失效。"""
    if not lora_path:
        return None
    path = lm_sidecar.sidecar_path(lora_path)
    try:
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        _LM_META_CACHE.pop(path, None)
        return None
    hit = _LM_META_CACHE.get(path)
    if hit and hit[0] == key:
        return hit[1]
    meta = lm_sidecar.read(lora_path)
    if len(_LM_META_CACHE) > 4096:
        _LM_META_CACHE.clear()
    _LM_META_CACHE[path] = (key, meta)
    return meta


def _lm_info(lora_path):
    meta = _lm_meta(lora_path)
    if not meta:
        return {}
    return {
        "title": lm_sidecar.title(meta),
        "notes": lm_sidecar.notes(meta),
        "trigger_words": lm_sidecar.trigger_words(meta),
        "base_model": str(meta.get("base_model") or "").strip(),
    }


def _resolve_lora_preview(lora_path):
    """预览图优先级：magicloradate 子目录 > LM sidecar > 同目录。"""
    if not lora_path:
        return None
    dirname = os.path.dirname(lora_path)
    stem = os.path.splitext(os.path.basename(lora_path))[0]
    sub_dir = os.path.join(dirname, "magicloradate")
    if os.path.isdir(sub_dir):
        for ext in _LORA_PREVIEW_SUFFIXES:
            candidate = os.path.join(sub_dir, stem + ext)
            if os.path.isfile(candidate):
                return candidate
    meta = _lm_meta(lora_path)
    if meta:
        path = lm_sidecar.preview_path(lora_path, meta)
        if path:
            return path
    for ext in _LORA_PREVIEW_SUFFIXES:
        candidate = os.path.join(dirname, stem + ext)
        if os.path.isfile(candidate):
            return candidate
    return None


_LM_DB_CACHE = {"key": None, "map": {}}


def _lm_db_path():
    base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "ComfyUI-LoRA-Manager")
    for rel in (("cache", "model", "comfyui.sqlite"), ("model_cache", "comfyui.sqlite")):
        path = os.path.join(base, *rel)
        if os.path.isfile(path):
            return path
    return None


def _norm_db_path(path):
    return str(path or "").replace("\\", "/").strip().lower()


def _lm_db_map():
    """只读读取 Lora-Manager 的模型库（file_path -> 记录），按文件 mtime 缓存。"""
    path = _lm_db_path()
    if not path:
        return {}
    try:
        st = os.stat(path)
        key = (path, st.st_mtime_ns, st.st_size)
    except OSError:
        return {}
    if _LM_DB_CACHE.get("key") == key:
        return _LM_DB_CACHE["map"]
    rows = {}
    try:
        con = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        for r in con.execute("SELECT file_path, file_name, civitai_id, civitai_model_id, civitai_name, "
                             "trained_words, preview_url, base_model FROM models"):
            rows[_norm_db_path(r["file_path"])] = dict(r)
        con.close()
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 读取 Lora-Manager 数据库失败: {e}")
        return {}
    _LM_DB_CACHE["key"] = key
    _LM_DB_CACHE["map"] = rows
    return rows


def _lm_db_row(lora_path):
    return _lm_db_map().get(_norm_db_path(lora_path)) if lora_path else None


def _lm_server_port():
    try:
        port = getattr(PromptServer.instance, "port", None)
        if port:
            return int(port)
    except Exception:
        pass
    return 8188


def _lm_push_preview(lora_path, preview_path):
    """用 Lora-Manager 的 replace-preview 接口把已存在的预览登记进它的库。"""
    try:
        if not preview_path or not os.path.isfile(preview_path):
            return False
        if os.path.getsize(preview_path) <= 0:
            return False
        with open(preview_path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(preview_path)[1].lower()
        ctype = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
        boundary = "----maPreview" + hashlib.md5((lora_path + str(time.time())).encode("utf-8")).hexdigest()
        crlf = b"\r\n"
        parts = []
        parts.append(("--" + boundary).encode() + crlf)
        parts.append(
            ('Content-Disposition: form-data; name="preview_file"; filename="'
             + os.path.basename(preview_path) + '"').encode() + crlf
            + ("Content-Type: " + ctype).encode() + crlf + crlf
        )
        parts.append(data)
        parts.append(crlf + ("--" + boundary).encode() + crlf)
        parts.append(b'Content-Disposition: form-data; name="model_path"' + crlf + crlf)
        parts.append(str(os.path.abspath(lora_path)).replace("\\", "/").encode())
        parts.append(crlf + ("--" + boundary).encode() + crlf)
        parts.append(b'Content-Disposition: form-data; name="nsfw_level"' + crlf + crlf + b"0")
        parts.append(crlf + ("--" + boundary + "--").encode() + crlf)
        body = b"".join(parts)
        url = f"http://127.0.0.1:{_lm_server_port()}/api/lm/loras/replace-preview"
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            ok = resp.status == 200
        _LM_DB_CACHE["key"] = None
        _LM_META_CACHE.pop(lm_sidecar.sidecar_path(lora_path), None)
        return ok
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 登记预览到 Lora-Manager 失败: {e}")
        return False


def _lm_preview_usable(url):
    """LM 库里的 preview_url 是否指向一个能显示的文件。"""
    url = str(url or "").strip()
    if not url:
        return False
    if url.lower().startswith(("http://", "https://")):
        return True
    return os.path.isfile(url.replace("/", os.sep))


def _lm_ensure_preview(lora_path):
    """LM 库里没有可用预览但本地同目录有图时，把图登记给 LM，让它正常显示。"""
    row = _lm_db_row(lora_path)
    if not row or _lm_preview_usable(row.get("preview_url")):
        return False
    preview = lm_sidecar.preview_path(lora_path, _lm_meta(lora_path))
    if not preview:
        stem = os.path.splitext(lora_path)[0]
        for ext in _LORA_PREVIEW_SUFFIXES:
            if os.path.isfile(stem + ext):
                preview = stem + ext
                break
    if not preview:
        return False
    return _lm_push_preview(lora_path, preview)


def _lm_manager_file_path(lora_path):
    """LM 缓存里的 file_path 用正斜杠；反斜杠会被判定为「不在缓存中」。"""
    return os.path.abspath(lora_path).replace("\\", "/")


_LM_FETCH_ROUTE = {"checked": False, "available": False}


def _lm_fetch_metadata_via_manager(lora_path):
    """交给 Lora-Manager 自己的下载链处理，让它的 sidecar / 预览 / 数据库 / 缓存一起更新。"""
    if _LM_FETCH_ROUTE["available"] is False and _LM_FETCH_ROUTE["checked"]:
        return False, "Lora-Manager 下载接口不可用"
    body = json.dumps({"file_path": _lm_manager_file_path(lora_path)}).encode("utf-8")
    url = f"http://127.0.0.1:{_lm_server_port()}/api/lm/loras/fetch-civitai"
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status != 200:
                return False, f"Lora-Manager 返回 HTTP {resp.status}"
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")[:200]
        except Exception:
            pass
        if e.code == 404 and "not found in cache" not in detail.lower():
            _LM_FETCH_ROUTE.update(checked=True, available=False)
        return False, f"Lora-Manager 下载接口不可用（HTTP {e.code}）{detail}"
    except Exception as e:
        _LM_FETCH_ROUTE.update(checked=True, available=False)
        return False, f"调用 Lora-Manager 下载接口失败: {e}"
    _LM_FETCH_ROUTE.update(checked=True, available=True)
    if not isinstance(payload, dict):
        return False, "Lora-Manager 返回格式异常"
    _LM_DB_CACHE["key"] = None
    _LM_META_CACHE.pop(lm_sidecar.sidecar_path(lora_path), None)
    if payload.get("success"):
        return True, ""
    return False, str(payload.get("error") or "Lora-Manager 未找到来源信息")


def _lm_is_complete(lora_path, meta=None):
    """Lora-Manager 是否会正常显示：数据库里有可用的预览图。"""
    row = _lm_db_row(lora_path)
    if row:
        return _lm_preview_usable(row.get("preview_url"))
    meta = _lm_meta(lora_path) if meta is None else meta
    if not isinstance(meta, dict):
        return False
    cv = meta.get("civitai") if isinstance(meta.get("civitai"), dict) else {}
    if not (cv.get("id") and str(meta.get("model_name") or "").strip()):
        return False
    try:
        return bool(lm_sidecar.preview_path(lora_path, meta))
    except Exception:
        return False


def _lm_provided_kinds(lora_path):
    """检查 LM sidecar 是否已提供触发词与预览图。"""
    if not lora_path:
        return {"txt": False, "image": False}
    meta = _lm_meta(lora_path)
    if not isinstance(meta, dict):
        return {"txt": False, "image": False}
    has_txt = bool(lm_sidecar.trigger_words(meta))
    has_img = bool(_lm_is_complete(lora_path, meta) or lm_sidecar.preview_path(lora_path, meta))
    return {"txt": has_txt, "image": has_img}


def _cached_sha256(lora_path):
    """复用 Lora-Manager sidecar / <名>.sha256 里的完整哈希，避免重复读取整个模型文件。"""
    try:
        meta = _lm_meta(lora_path)
        value = str((meta or {}).get("sha256") or "").strip().lower()
        if re.fullmatch(r"[0-9a-f]{64}", value):
            return value
    except Exception:
        pass
    try:
        sidecar = os.path.splitext(lora_path)[0] + ".sha256"
        if os.path.isfile(sidecar):
            with open(sidecar, "r", encoding="utf-8", errors="ignore") as f:
                value = (f.read().strip().split() or [""])[0].lower()
            if re.fullmatch(r"[0-9a-f]{64}", value):
                return value
    except Exception:
        pass
    return None


def _lora_preview_relative(preview_path, lora_filename):
    """把绝对预览路径转成相对 lora 根目录的路径，兼容子文件夹预览。"""
    real = os.path.realpath(preview_path)
    try:
        roots = folder_paths.get_folder_paths("loras")
    except Exception:
        roots = []
    for root in roots:
        r = os.path.realpath(root)
        try:
            if os.path.commonpath((real, r)) == r:
                return os.path.relpath(real, r).replace("\\", "/")
        except ValueError:
            continue
    return os.path.join(os.path.dirname(lora_filename), os.path.basename(preview_path)).replace("\\", "/")

# Anima 2.9B（40 层）LoRA 内存层转换：仅在「加载」时把旧 28 层 Anima LoRA 的键名重映射，
# 不写盘、不改动原文件与缓存（详见 nodes/anima_lora_remap.py）。
# 模块缺失时整体降级为「不转换」，保证节点仍可正常工作。
try:
    from .anima_lora_remap import (
        remap_lora_state_dict_safe,
        is_anima_40_model,
        is_anima_model,
        STATUS_CONVERTED,
        STATUS_ALREADY_40,
        STATUS_NOT_ANIMA,
        STATUS_ERROR,
    )
    ANIMA_REMAP_AVAILABLE = True
except Exception:
    ANIMA_REMAP_AVAILABLE = False
    remap_lora_state_dict_safe = None
    is_anima_40_model = lambda model: False  # noqa: E731
    is_anima_model = lambda model: False  # noqa: E731
    STATUS_CONVERTED = "converted"
    STATUS_ALREADY_40 = "already_40"
    STATUS_NOT_ANIMA = "not_anima"
    STATUS_ERROR = "error"


# --- LoRA 串（lora_chain）格式：仅本加载器识别，用于节点间传递 LoRA 列表 ---
MAGIC_LORA_CHAIN_KEY = "_magic_lora_chain"

def _parse_lora_chain(chain_in):
    """解析 lora串接受。
    合法格式为 dict: {"_magic_lora_chain": True, "loras": [...]}
    也兼容旧版 JSON 字符串格式。None / 空值返回空列表。
    """
    if chain_in is None:
        return []
    # 兼容旧版 JSON 字符串
    if isinstance(chain_in, str):
        if not chain_in.strip():
            return []
        try:
            chain_in = json.loads(chain_in)
        except (json.JSONDecodeError, TypeError):
            raise RuntimeError(
                "lora串接受 收到了无效数据，请确保连接自「强力 LoRA 加载器」的 lora串输出，不要接入其他文本或节点。"
            )
    if not isinstance(chain_in, dict) or chain_in.get(MAGIC_LORA_CHAIN_KEY) is not True:
        raise RuntimeError(
            "lora串接受 收到了非 LoRA 串格式的数据，请确保连接自「强力 LoRA 加载器」的 lora串输出。"
        )
    loras = chain_in.get("loras")
    if not isinstance(loras, list):
        return []
    return loras

def _serialize_lora_chain(items):
    """将 LoRA 列表打包为 lora串输出（dict 格式，作为 MAGIC_LORA_CHAIN 类型传递）。"""
    return {MAGIC_LORA_CHAIN_KEY: True, "loras": items}


def _lora_enabled(item):
    """后端唯一的「是否加载」判定，与前端 mplLoraEnabled 保持一致：缺省视为启用。"""
    if not isinstance(item, dict):
        return False
    value = item.get("enabled", True)
    if value is None:
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "off", "")
    return bool(value)


def _trigger_enabled(item):
    """触发词独立开关（triggerEnabled），缺省视为开启，兼容旧工作流。"""
    value = item.get("triggerEnabled", True)
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "off")
    return value is not False


CHAIN_LOADER_TYPES = ("MagicPowerLoraLoader", "MAPowerLoraLoader")


def _chain_continues_to_loader(prompt, node_id):
    """从完整 prompt 判断本节点的 lora串输出 是否交给了一个「会加载」的下游。

    只有真正接手加载的节点才算链继续：下游要么也接了本节点的 model 输出（说明在链上），
    要么本身就是 LoRA 加载器。PreviewAny 之类的调试节点也会吃 lora串输出，但不会加载，
    把它们算成下游会让本节点静默跳过加载。
    返回 None 表示无法判断（缺 prompt / node_id），调用方回退到前端注入值。
    """
    if not isinstance(prompt, dict) or node_id in (None, ""):
        return None
    own = str(node_id)
    own_node = prompt.get(own) or {}
    chain_out_idx = 2 if own_node.get("class_type") == "MAPowerLoraLoader" else 4
    chain_consumers, model_consumers = [], set()
    for other_id, node in prompt.items():
        inputs = (node or {}).get("inputs")
        if not isinstance(inputs, dict):
            continue
        for value in inputs.values():
            if not isinstance(value, list) or len(value) < 2 or str(value[0]) != own:
                continue
            if value[1] == chain_out_idx:
                chain_consumers.append(str(other_id))
            elif value[1] == 0:
                model_consumers.add(str(other_id))
    for consumer_id in chain_consumers:
        if consumer_id in model_consumers:
            return True
        if ((prompt.get(consumer_id) or {}).get("class_type")) in CHAIN_LOADER_TYPES:
            return True
    return False


class MagicPowerLoraLoader:
    @classmethod
    def VALIDATE_INPUTS(cls, lora_stack):
        """Validate every enabled LoRA in the serialized stack before execution.

        The visible LoRA picker is implemented by the frontend and stored in a
        hidden JSON widget, so ComfyUI's normal combo-value validation cannot
        detect files removed after a workflow was saved. Keep the validation at
        the node boundary to avoid silently applying an empty LoRA.
        """
        try:
            stack_data = json.loads(lora_stack) if isinstance(lora_stack, str) and lora_stack.strip() else []
        except (TypeError, ValueError):
            return "lora_stack contains invalid LoRA data"

        if isinstance(stack_data, dict):
            items = []
            for folder in stack_data.get("folders", []):
                if isinstance(folder, dict) and not folder.get("ignored"):
                    items.extend(folder.get("loras") or [])
            items.extend(stack_data.get("loras") or [])
        elif isinstance(stack_data, list):
            items = stack_data
        else:
            items = []

        missing = []
        for item in items:
            if not isinstance(item, dict) or not _lora_enabled(item):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            path = folder_paths.get_full_path("loras", name)
            if not path or not os.path.isfile(path):
                missing.append(name)

        if missing:
            shown = ", ".join(missing[:8])
            if len(missing) > 8:
                shown += f", ... (+{len(missing) - 8})"
            return f"Missing LoRA file(s): {shown}"
        return True

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_stack": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora串接受": ("MAGIC_LORA_CHAIN",),
            },
            "hidden": {
                # int8_mode 仅为向后兼容旧工作流的 widgets_values 索引占位，节点完全忽略其值。
                # ComfyUI 官方 model_patcher.py 已原生支持 INT8/FP8 等量化权重的 LoRA 应用。
                "int8_mode": ("STRING", {"default": "none"}),
                "sdnq_mode": ("STRING", {"default": "none"}),
                "klein_mode": ("STRING", {"default": "auto"}),
                "adaptive_mode": ("BOOLEAN", {"default": False}),  # 自适应模式：自动检测模型类型选择合适模式
                "anima_mode": ("STRING", {"default": "none"}),  # Anima 2.9B 模式：none 关闭 / anima 启用（与 Klein/SDNQ 一致，单值开关；仅标准加载路径生效，内存暂存不写盘）
                "lora串输出已连接": ("BOOLEAN", {"default": True}),  # 由前端根据图连接注入：未连接=链末端
                "unique_id": "UNIQUE_ID",  # 仅用于日志/链末端自检：同图有多个加载器时可分辨是谁
                "prompt": "PROMPT",  # 用于后端自检链末端，不依赖前端注入
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING", "MAGIC_LORA_CHAIN")
    RETURN_NAMES = ("model", "clip", "lora_preview", "tags_output", "lora串输出")
    OUTPUT_IS_LIST = (False, False, True, False, False)  # IMAGE是列表输出（图片组）
    FUNCTION = "apply_loras"
    CATEGORY = "✨ Magic Assistant"

    # 类级别缓存：存储已加载的 LoRA 数据
    # 键: (lora_path, weight) 元组
    # 值: 加载的 lora dict
    _loaded_loras = {}

    # 类级别缓存：LoRA 元数据（与官方 load_torch_file(return_metadata=True) 一致）
    # 键: (lora_path, weight) 元组，值: lora_metadata（dict 或 None）
    _lora_metadata_cache = {}

    # 类级别：本次执行使用的 LoRA 缓存键集合（用于执行后清理未使用的缓存）
    # 使用类属性确保在多次运行间正确追踪
    _current_run_used_keys = set()

    @classmethod
    def _mark_lora_used(cls, cache_key):
        """标记本次运行使用了某个 LoRA 缓存"""
        cls._current_run_used_keys.add(cache_key)

    @classmethod
    def _reset_used_tracking(cls):
        """重置追踪状态，在每次 apply_loras 开始时调用"""
        cls._current_run_used_keys = set()

    @classmethod
    def _get_cached_lora(cls, lora_path, weight):
        """从缓存获取 LoRA 数据，或加载并缓存"""
        cache_key = (lora_path, weight)
        cls._mark_lora_used(cache_key)  # 记录本次使用了该 LoRA
        if cache_key in cls._loaded_loras:
            print(f"   💾 [Cache Hit] {os.path.basename(lora_path)} (weight={weight})")
            return cls._loaded_loras[cache_key], cls._lora_metadata_cache.get(cache_key)
        
        try:
            lora, lora_metadata = comfy.utils.load_torch_file(
                lora_path, safe_load=True, return_metadata=True
            )
        except TypeError:
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            lora_metadata = None
        cls._loaded_loras[cache_key] = lora
        cls._lora_metadata_cache[cache_key] = lora_metadata
        return lora, lora_metadata

    @classmethod
    def _cleanup_unused_lora_cache(cls):
        """清理本次执行中未使用的 LoRA 缓存，释放内存"""
        if not cls._loaded_loras:
            return
        
        # 找出本次执行未使用的缓存项
        unused_keys = set(cls._loaded_loras.keys()) - cls._current_run_used_keys
        if not unused_keys:
            return
        
        # 清除未使用的缓存并释放内存
        cleared_count = 0
        for cache_key in unused_keys:
            lora_data = cls._loaded_loras.get(cache_key)
            if lora_data is not None:
                cleared_count += 1
                # 遍历所有张量并移动到 CPU 然后删除（帮助释放 GPU 内存）
                for key in list(lora_data.keys()):
                    tensor = lora_data[key]
                    if hasattr(tensor, 'cpu'):
                        try:
                            tensor = tensor.cpu()
                        except Exception:
                            pass
                    del tensor
                # 清除字典中的引用
                lora_data.clear()
            del cls._loaded_loras[cache_key]
            cls._lora_metadata_cache.pop(cache_key, None)
        
        print(f"   🧹 [Cache Cleanup] 已释放 {cleared_count} 个未使用 LoRA 的缓存")
        cls._current_run_used_keys = set()  # 重置追踪状态

    @classmethod
    def _clear_lora_cache(cls, lora_path=None):
        """清除缓存，可指定清除特定路径或全部"""
        if lora_path is None:
            cls._loaded_loras.clear()
            cls._lora_metadata_cache.clear()
        else:
            # 清除与该路径相关的所有缓存项
            keys_to_remove = [k for k in cls._loaded_loras if k[0] == lora_path]
            for k in keys_to_remove:
                del cls._loaded_loras[k]
                cls._lora_metadata_cache.pop(k, None)

    # 检测模型是否为 SDNQ 模型（DiffusionPipeline 或 Magic SDNQ Loader 的 wrapper）
    @staticmethod
    def is_sdnq_model(model):
        """检测模型是否为 SDNQ 模型（diffusers DiffusionPipeline 或 Magic SDNQ Loader 的 pipeline wrapper）"""
        try:
            from diffusers import DiffusionPipeline

            if isinstance(model, DiffusionPipeline):
                return True

            if hasattr(model, 'get_pipeline'):
                pipeline = model.get_pipeline()
                if isinstance(pipeline, DiffusionPipeline):
                    return True

            if hasattr(model, 'unet') or hasattr(model, 'transformer'):
                if hasattr(model, 'text_encoder') or hasattr(model, 'vae'):
                    return True

            return False
        except ImportError:
            return False
        except Exception:
            return False

    # 检测模型是否为 Klein 模型（ComfyFlux2KleinWrapper）
    @staticmethod
    def is_klein_model(model):
        """检测模型是否为 Klein 模型（由 Magic Nunchaku FLUX.2 Klein Loader 加载）。"""
        try:
            if not hasattr(model, 'model') or not hasattr(model.model, 'diffusion_model'):
                return False
            wrapper_cls_name = type(model.model.diffusion_model).__name__
            return wrapper_cls_name == "ComfyFlux2KleinWrapper"
        except Exception:
            return False


    # 检测模型是否为 SDNQ 模型（DiffusionPipeline 或 Magic SDNQ Loader 的 wrapper）
    @staticmethod
    def get_preview_path(lora_name):
        try:
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if lora_path is None: return None
            return _resolve_lora_preview(lora_path)
        except Exception:
            return None

    def apply_loras(self, lora_stack, model=None, clip=None, adaptive_mode=False, sdnq_mode="none", klein_mode="auto", anima_mode="none", **kwargs):
        """
        应用 LoRA
        sdnq_mode: "none" (默认), "sdnq" (SDNQ 模式，用于 DiffusionPipeline)
        klein_mode: "none" | "klein" | "auto" (auto 在自适应模式或自动检测时使用)
        链末端由「lora串输出」是否被连接判定：未连接则为末端，末端才加载 LoRA 并需连接 model/clip。

        注意：ComfyUI 官方已在 model_patcher.py 中提供 INT8 等量化权重的 LoRA 支持
        （应用补丁后调用 comfy.float.stochastic_rounding 把结果舍入回权重的原始 dtype），
        因此本加载器与官方 LoraLoader 的默认路径完全一致，可自动处理 FP8/INT8/INT4 等
        量化模型，无需任何特殊适配。
        """
        # 重置本次执行使用的 LoRA 追踪（每次运行独立追踪）
        MagicPowerLoraLoader._reset_used_tracking()

        # -------------------------
        # 调试开关：MAGIC_ASSISTANT_DEBUG
        # -------------------------
        # 用途：排查前端传入的隐藏参数（adaptive/sdnq/klein 等）是否正确。
        # 为什么需要：ComfyUI 的 workflow/节点属性在不同版本之间可能出现“旧数据污染”或类型漂移（例如 true/false 字符串），
        # 这会导致模式判断错误。打开此开关可以打印关键字段，快速定位是前端注入、workflow 保存，还是后端解析出了问题。
        #
        # 开启方式：在启动 ComfyUI 的环境变量中设置：
        #   MAGIC_ASSISTANT_DEBUG=1
        # 示例（Windows PowerShell）：
        #   $env:MAGIC_ASSISTANT_DEBUG=1; python main.py
        # 或者写进你的启动脚本/快捷方式环境。
        #
        # 注意：开启后会打印较多日志，建议仅在排障期间开启。
        debug_enabled = os.getenv("MAGIC_ASSISTANT_DEBUG", "").strip().lower() in {"1", "true", "yes", "y", "on"}
        node_id = kwargs.get("unique_id")
        node_tag = f"节点#{node_id} " if node_id not in (None, "") else ""

        if debug_enabled:
            # [DEBUG] 打印 adaptive_mode 的原始输入值，用于排查模式判断错误
            print(f"[DEBUG] adaptive_mode 原始值: {repr(adaptive_mode)} (type={type(adaptive_mode).__name__})", flush=True)

            # [DEBUG] 打印 kwargs 中的相关字段（前端隐藏字段 / 串接字段）
            debug_kwargs = {
                k: v
                for k, v in kwargs.items()
                if any(x in k for x in ["adaptive", "mode", "klein", "sdnq", "lora串"])
            }
            if debug_kwargs:
                print(f"[DEBUG] kwargs 中的相关字段: {debug_kwargs}", flush=True)

        # 确保 adaptive_mode 是正确的布尔值（处理前端可能传递的字符串 "false" / "true"）
        # 说明：
        # - 前端隐藏 widget 是 text 类型，历史原因可能传递字符串。
        # - 这里统一转换为 Python bool，后续逻辑只看 bool。
        if isinstance(adaptive_mode, str):
            adaptive_mode = adaptive_mode.strip().lower() == "true"
        adaptive_mode = bool(adaptive_mode)
        if debug_enabled:
            print(f"[DEBUG] adaptive_mode 转换后: {adaptive_mode}", flush=True)

        # 链末端判定：优先用后端从 prompt 自检（不依赖前端脚本是否加载/是否被缓存旧版），
        # 自检不可用时才回退到前端注入的字段（未注入时默认 True＝非末端，避免误加载）。
        derived_chain_end = _chain_continues_to_loader(kwargs.get("prompt"), node_id)
        if derived_chain_end is None:
            lora_output_connected = kwargs.get("lora串输出已连接", True)
            chain_end = not lora_output_connected
        else:
            chain_end = not derived_chain_end
            frontend_flag = kwargs.get("lora串输出已连接", None)
            if frontend_flag is not None and bool(frontend_flag) == bool(chain_end):
                print(f"⚠️ [MagicPowerLora] {node_tag}链末端判定与前端注入不一致（后端按图判定 chain_end={chain_end}），已采用后端结果")

        # ---------- 解析 lora串接受（MAGIC_LORA_CHAIN 类型，由 ComfyUI 自动传递）----------
        lora_chain_in = kwargs.get("lora串接受", None)
        try:
            received_list = _parse_lora_chain(lora_chain_in)
        except RuntimeError as e:
            raise RuntimeError(str(e))

        # ---------- 本节点 lora_stack 解析 ----------
        try:
            if not isinstance(lora_stack, str) or not lora_stack.strip():
                stack_data = []
            else:
                stack_data = json.loads(lora_stack)
        except Exception:
            stack_data = []

        own_items = []
        if isinstance(stack_data, dict):
            if "folders" in stack_data:
                for f in stack_data["folders"]:
                    if isinstance(f, dict) and not f.get("ignored") and f.get("loras"):
                        own_items.extend([l for l in f["loras"] if _lora_enabled(l)])
            if "loras" in stack_data:
                own_items.extend([l for l in stack_data["loras"] if _lora_enabled(l)])
        elif isinstance(stack_data, list):
            own_items = [l for l in stack_data if _lora_enabled(l)]

        # 合并顺序：本节点 + 接收到的（本节点在上，接收到的在下）
        merged = own_items + received_list
        lora_chain_out = _serialize_lora_chain(merged)

        # 链末端但未收到上游时提示：可能上游加载器未参与执行（依赖未进 prompt/执行列表）
        if chain_end and len(received_list) == 0:
            print(f"💡 [MagicPowerLora] 链末端：本节点 {len(own_items)} 个 LoRA，未收到上游 lora 串。若工作流中有上游加载器将「lora串输出」接到本节点「lora串接受」，请保存工作流后执行完整图（不要只执行部分节点）。")

        # ---------- 非链末端：只传出 lora 串，不加载；不要求 model/clip ----------
        if not chain_end:
            print(f"⏭️ [MagicPowerLora] {node_tag}非链末端：本节点 {len(own_items)} 个 LoRA 不在此节点加载，交由下游加载器处理（共 {len(merged)} 个）")
            placeholder_preview = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]
            return (model, clip, placeholder_preview, "", lora_chain_out)

        # ---------- 链末端：必须连接 model（clip 可选，未连 clip 时仅应用到 model） ----------
        if model is None:
            raise RuntimeError("链末端节点（未将 lora串输出 接到其他加载器的节点）必须连接 model。")
        out_model = model
        out_clip = clip
        active_tags = []
        preview_images = []

        items_to_process = merged  # 末端用合并后的整链列表加载

        # 检测模型类型
        is_sdnq = self.is_sdnq_model(out_model)
        is_klein = self.is_klein_model(out_model)
        # Anima 2.9B：是否为 40 层 Anima 主干模型（auto 模式下据此决定是否启用层转换）
        is_anima_40 = is_anima_40_model(out_model) if ANIMA_REMAP_AVAILABLE else False

        # ========== 自适应模式检测 ==========
        if adaptive_mode:
            print(f"🔄 [MagicPowerLora] 自适应模式：检测到 Klein={is_klein}, SDNQ={is_sdnq}")
            if is_klein:
                klein_mode = "klein"
                sdnq_mode = "none"
                print(f"   → 自动切换到 Klein 模式")
            elif is_sdnq:
                sdnq_mode = "sdnq"
                print(f"   → 自动切换到 SDNQ 模式")
            else:
                sdnq_mode = "none"
                klein_mode = "none"
                print(f"   → 自动切换到标准模式（与官方 LoraLoader 一致，INT8/FP8 等量化模型由 model_patcher 自动处理）")
        # ====================================

        # 确保 klein_mode 有值（前端未注入时默认 "auto"）
        if isinstance(klein_mode, str):
            if klein_mode.lower() == "true":
                klein_mode = "klein"
            elif klein_mode.lower() == "false":
                klein_mode = "none"
        if klein_mode is None:
            klein_mode = "auto"

        if sdnq_mode == "sdnq" and not is_sdnq:
            print(f"⚠️ [MagicPowerLora] SDNQ 模式已启用，但模型似乎不是 SDNQ 模型（DiffusionPipeline），将回退到标准模式")
            sdnq_mode = "none"
        if sdnq_mode == "none" and is_sdnq:
            print(f"💡 [MagicPowerLora] 检测到 SDNQ 模型（DiffusionPipeline），建议在设置中启用 SDNQ 模式")
        if klein_mode == "klein" and not is_klein:
            print(f"⚠️ [MagicPowerLora] Klein 模式已启用，但模型似乎不是 Klein 模型，将回退到标准模式")
            klein_mode = "none"
        if klein_mode == "none" and is_klein:
            print(f"💡 [MagicPowerLora] 检测到 Klein 模型（Nunchaku FLUX.2 Klein），建议在设置中启用 Klein 模式")

        # ========== Anima 2.9B 模式解析 ==========
        # 仅 "anima" 表示启用（与 Klein/SDNQ 一致，单值开关，互斥）。
        # 转换只在「标准」加载路径生效（Klein/SDNQ 走各自文件加载器，无法套用内存 state_dict 重映射）。
        # remap_lora_state_dict_safe 本身只对 28 层 Anima LoRA 生效，其他 LoRA / 已为 40 层 / 非 Anima 模型原样返回，
        # 因此「启用即自动」：标准加载路径下对适用的 Anima LoRA 暂存重映射，其余原样。
        anima_active = False
        if ANIMA_REMAP_AVAILABLE:
            am_raw = anima_mode
            if isinstance(am_raw, bool):
                am = "anima" if am_raw else "none"
            elif isinstance(am_raw, str):
                am = am_raw.strip().lower()
            else:
                am = str(am_raw).strip().lower()
            if am == "anima":
                anima_active = True
                print(f"🔄 [MagicPowerLora] Anima 2.9B 模式已启用：标准加载路径下将把 28 层 Anima LoRA 暂存重映射为 40 层（不写盘、不改原文件/缓存）")
        # =========================================

        mode_str = f"{sdnq_mode}" if sdnq_mode == "sdnq" else (f"{klein_mode}" if klein_mode == "klein" else "standard")
        adaptive_str = f" (Adaptive)" if adaptive_mode else ""
        
        # 如果没有LoRA需要加载，直接返回（不做任何加载尝试）
        if not items_to_process:
            print(f"🚀 [MagicPowerLora] 链末端：无 LoRA 需要加载")
            if not preview_images:
                preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]
            return (out_model, out_clip, preview_images, "", lora_chain_out)
        
        print(f"🚀 [MagicPowerLora] 链末端：加载 {len(items_to_process)} 个 LoRA（含串接）... (Mode: {mode_str}{adaptive_str})")

        # 根据模式选择加载方式
        if klein_mode == "klein" and is_klein:
            if anima_active:
                print(f"ℹ️ [Anima 2.9B] 当前为 Klein 模式，Anima 层转换不适用（Klein 走专用文件加载器）；如需 28→40 层转换请使用标准模式。")
            # Klein/nunchaku 的 update_lora_params 每次调用都会先重置旧 LoRA。
            # 因此多 LoRA 必须先 compose 成一个 state dict，再一次性应用。
            try:
                wrapper = out_model.model.diffusion_model
                wrapper.reset_lora()
                print(f"   [Klein] 已重置旧 LoRA")
            except Exception as e:
                wrapper = None
                print(f"   ⚠️ [Klein] 重置旧 LoRA 失败: {e}")

            klein_loras = []
            for item in items_to_process:
                lora_name = item.get("name", "").strip()
                weight = float(item.get("weight", 1.0))
                if not lora_name:
                    continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Klein LoRA not found: {lora_name}")
                    continue

                klein_loras.append((lora_path, weight, lora_name, item))
                print(f"   [Klein] Queued: {lora_name} (strength={weight})")

                img_path = self.get_preview_path(lora_name)
                if img_path:
                    try:
                        i = Image.open(img_path).convert("RGB")
                        i = np.array(i).astype(np.float32) / 255.0
                        preview_tensor = torch.from_numpy(i)[None,]
                        preview_images.append(preview_tensor)
                    except Exception:
                        pass

            if wrapper is not None and klein_loras:
                klein_applied = False
                try:
                    if len(klein_loras) == 1:
                        lora_path, weight, lora_name, _item = klein_loras[0]
                        wrapper.update_lora_params(lora_path, strength=weight)
                        print(f"   ✅ Applied (Klein): {lora_name} (strength={weight})")
                    else:
                        try:
                            from nunchaku.lora.common import compose_lora
                        except Exception:
                            from nunchaku.lora.common.compose import compose_lora

                        lora_specs = [(lora_path, weight) for lora_path, weight, _name, _item in klein_loras]
                        composed_lora = compose_lora(lora_specs)
                        wrapper.update_lora_params(composed_lora, strength=1.0)
                        names = ", ".join(name for _path, _weight, name, _item in klein_loras)
                        print(f"   ✅ Applied (Klein Compose): {len(klein_loras)} LoRA(s) mixed -> {names}")
                    klein_applied = True
                except Exception as e:
                    print(f"   ❌ Failed (Klein Compose): {e}")
                if klein_applied:
                    for _path, _weight, _name, _item in klein_loras:
                        if _trigger_enabled(_item) and _item.get("tags"):
                            active_tags.append(str(_item["tags"]))
            elif wrapper is not None:
                print(f"   ℹ️ [Klein] No valid LoRA to apply")

        elif sdnq_mode == "sdnq" and is_sdnq:
            if anima_active:
                print(f"ℹ️ [Anima 2.9B] 当前为 SDNQ 模式，Anima 层转换不适用（SDNQ 走专用文件加载器）；如需 28→40 层转换请使用标准模式。")
            # SDNQ 模式 - 链末端：先全局卸载，再按合并列表顺序加载（与 comfyui-sdnq 每次运行先卸再加载一致）
            sdnq_success = False
            try:
                from diffusers import DiffusionPipeline
                diffusers_ok = True
            except ImportError:
                print(f"❌ [MagicPowerLora] SDNQ 模式需要 diffusers 库，但未安装。")
                diffusers_ok = False

            if diffusers_ok:
                pipeline = out_model.get_pipeline() if hasattr(out_model, 'get_pipeline') else out_model
                if not isinstance(pipeline, DiffusionPipeline):
                    print(f"   ⚠️ [MagicPowerLora] SDNQ 模式需要 DiffusionPipeline，当前 model: {type(out_model).__name__}, pipeline: {type(pipeline).__name__}")
                else:
                    print(f"   [SDNQ] Pipeline: {type(pipeline).__name__}，链末端：先全局卸载再加载 {len(items_to_process)} 个 LoRA...")
                    if hasattr(pipeline, 'unload_lora_weights'):
                        pipeline.unload_lora_weights()
                        print(f"   [SDNQ] 已全局卸载")
                    lora_adapters = []
                    lora_weights = []

                    for idx, item in enumerate(items_to_process):
                        lora_name = item.get("name", "").strip()
                        weight = float(item.get("weight", 1.0))
                        if not lora_name:
                            continue
                        lora_path = None
                        try:
                            lora_path = folder_paths.get_full_path("loras", lora_name) or folder_paths.get_full_path("loras", lora_name.replace("\\", "/"))
                            if lora_path is None:
                                lora_folders = folder_paths.get_folder_paths("loras") or []
                                if lora_folders:
                                    for lora_folder in lora_folders:
                                        for name_variant in (lora_name, lora_name.replace("\\", "/"), lora_name.replace("/", "\\")):
                                            potential_path = os.path.normpath(os.path.join(lora_folder, name_variant))
                                            if os.path.isfile(potential_path):
                                                lora_path = potential_path
                                                break
                                        if lora_path is not None:
                                            break
                                if lora_path is None and lora_folders:
                                    fallback = os.path.normpath(os.path.join(lora_folders[0], lora_name))
                                    lora_path = fallback if os.path.isfile(fallback) else None
                        except Exception:
                            pass
                        if not lora_path or not os.path.isfile(lora_path):
                            print(f"   ⚠️ [SDNQ] LoRA 未找到: {lora_name}")
                            continue
                        try:
                            is_local_file = os.path.exists(lora_path) and os.path.isfile(lora_path)
                            path_hash = abs(hash(os.path.normpath(lora_path))) % (10 ** 8)
                            adapter_name = f"lora_{path_hash}_{idx}"
                            print(f"   [SDNQ] Loading ({adapter_name})... {lora_name} (strength: {weight})")
                            if is_local_file:
                                pipeline.load_lora_weights(
                                    os.path.dirname(lora_path),
                                    weight_name=os.path.basename(lora_path),
                                    adapter_name=adapter_name
                                )
                            else:
                                pipeline.load_lora_weights(lora_path, adapter_name=adapter_name)
                            lora_adapters.append(adapter_name)
                            lora_weights.append(weight)
                            print(f"   ✅ Applied (SDNQ): {lora_name} (strength: {weight})")
                            sdnq_success = True
                        except Exception as e:
                            import traceback
                            print(f"   ❌ Failed (SDNQ): {lora_name}")
                            traceback.print_exc()
                            continue
                        if _trigger_enabled(item) and "tags" in item and item.get("tags"):
                            active_tags.append(str(item["tags"]))
                        img_path = self.get_preview_path(lora_name)
                        if img_path:
                            try:
                                i = Image.open(img_path).convert("RGB")
                                i = np.array(i).astype(np.float32) / 255.0
                                preview_tensor = torch.from_numpy(i)[None,]
                                preview_images.append(preview_tensor)
                            except Exception:
                                pass

                    if lora_adapters:
                        try:
                            pipeline.set_adapters(lora_adapters, adapter_weights=lora_weights)
                            print(f"   ✅ [SDNQ] {len(lora_adapters)} LoRA(s) active")
                            sdnq_success = True
                        except Exception as e:
                            print(f"   ⚠️ [SDNQ] Failed to set adapter weights: {e}")
                            sdnq_success = False
                    elif items_to_process:
                        print(f"   ℹ️ [SDNQ] No LoRAs to load (本链均加载失败)")
                        sdnq_success = False

            if not sdnq_success and (sdnq_mode == "sdnq" and is_sdnq):
                print(f"   ⚠️ [MagicPowerLora] SDNQ LoRA 加载失败，无法回退到标准模式（SDNQ 模型与 ComfyUI 标准 LoRA 不兼容）")
                print(f"   💡 Troubleshooting（与 comfyui-sdnq 源节点一致）：")
                print(f"      1. 确认 LoRA 文件存在（.safetensors），路径格式与 loras 文件夹内一致")
                print(f"      2. 确认 LoRA 与当前 SDNQ 模型架构兼容（Flux2Klein 需 Flux2Klein 专用 LoRA）")
                print(f"      3. 可在 comfyui-sdnq 独立采样器中验证该 LoRA 是否能加载")
                print(f"      4. 或尝试不使用 LoRA 运行")
        
        else:
            # 标准模式（默认）或回退模式
            # 与官方 LoraLoader 默认行为一致；ComfyUI 的 model_patcher.py 会在应用补丁后
            # 通过 comfy.float.stochastic_rounding 把权重舍入到 weight.dtype（如 torch.int8），
            # 因此 FP8/INT8/INT4 等量化模型也走这条路径，无需任何额外处理。
            for item in items_to_process:
                lora_name = item.get("name")
                weight = float(item.get("weight", 1.0))
                if not lora_name: continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                    continue

                try:
                    # 使用缓存加载 LoRA（与官方 LoraLoader 同步：带回 lora_metadata）
                    lora, lora_metadata = MagicPowerLoraLoader._get_cached_lora(lora_path, weight)
                    # Anima 2.9B：标准加载路径下，对 28 层 Anima LoRA 做内存暂存层转换。
                    # remap 返回的是新 dict（张量仅引用不 clone），原缓存与磁盘文件均不改动。
                    if anima_active and remap_lora_state_dict_safe is not None:
                        lora, anima_status, anima_msg = remap_lora_state_dict_safe(lora, source_name=lora_name)
                        if anima_status == STATUS_CONVERTED:
                            print(f"   🔄 [Anima 2.9B] {anima_msg}")
                        elif debug_enabled or anima_status == STATUS_ERROR:
                            print(f"   ℹ️ [Anima 2.9B] {anima_msg}")
                    try:
                        out_model, out_clip = comfy.sd.load_lora_for_models(
                            out_model, out_clip, lora, weight, weight, lora_metadata=lora_metadata
                        )
                    except TypeError:
                        out_model, out_clip = comfy.sd.load_lora_for_models(
                            out_model, out_clip, lora, weight, weight
                        )
                    print(f"   ✅ Applied: {lora_name} (weight={weight})")
                    if _trigger_enabled(item) and item.get("tags"):
                        active_tags.append(str(item["tags"]))
                except Exception as e:
                    print(f"   ❌ Failed: {lora_name} -> {e}")

                # 为每个lora尝试加载预览图
                img_path = self.get_preview_path(lora_name)
                if img_path:
                    try:
                        i = Image.open(img_path).convert("RGB")
                        i = np.array(i).astype(np.float32) / 255.0
                        preview_tensor = torch.from_numpy(i)[None,]
                        preview_images.append(preview_tensor)
                    except Exception as e:
                        print(f"   ⚠️ Failed to load preview for {lora_name}: {e}")

        # 如果没有找到任何预览图，返回一个占位图
        if not preview_images:
            preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]

        final_text = ", ".join(active_tags)
        
        # 执行完成后清理未使用的 LoRA 缓存，释放内存
        MagicPowerLoraLoader._cleanup_unused_lora_cache()
        
        return (out_model, out_clip, preview_images, final_text, lora_chain_out)

# --- API 接口 ---

async def _run_blocking(fn, *args, **kwargs):
    """Run sync work off the event loop (Python 3.8: no asyncio.to_thread)."""
    if kwargs:
        call = functools.partial(fn, *args, **kwargs)
    else:
        call = lambda: fn(*args)
    if hasattr(asyncio, "to_thread"):
        if kwargs:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, call)
        return await asyncio.to_thread(fn, *args)
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, call)


def _coerce_version_number(v):
    """Civitai versionNumber may be int, float, str, or null; avoid TypeError on compare."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return float(int(v))
    if isinstance(v, (int, float)):
        x = float(v)
        if x != x or x in (float("inf"), float("-inf")):
            return 0.0
        return x
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return 0.0
        try:
            return float(s)
        except ValueError:
            return 0.0
    return 0.0


def _normalize_civitai_version_id(vid):
    if vid is None or isinstance(vid, bool):
        return None
    if isinstance(vid, int):
        return vid
    if isinstance(vid, float):
        if vid != vid or vid in (float("inf"), float("-inf")):
            return None
        return int(vid)
    if isinstance(vid, str) and vid.strip().isdigit():
        return int(vid.strip())
    return None


def _civitai_version_display(ver):
    """Civitai often omits versionNumber on model.modelVersions[]; use name or id."""
    if not isinstance(ver, dict):
        return ""
    num = ver.get("versionNumber")
    if num is not None and str(num).strip() != "":
        n = _coerce_version_number(num)
        if n == int(n):
            return f"v{int(n)}"
        return f"v{n}"
    name = (ver.get("name") or "").strip()
    if name:
        return name
    iv = _normalize_civitai_version_id(ver.get("id"))
    if iv is not None:
        return f"#{iv}"
    return "?"


def _parse_civitai_dt(s):
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _klein_b_variant(s):
    """
    Flux.2 Klein 4B / 9B 等需区分，不能笼统归为 flux。
    返回 '4' | '9' | ''；避免 14b 误匹配 4b。
    """
    if not s:
        return ""
    low = s.lower()
    if re.search(r"(?<![0-9])9\s*b\b", low) or re.search(r"(?<![0-9a-z])9b(?![0-9a-z])", low):
        return "9"
    if re.search(r"(?<![0-9])4\s*b\b", low) or re.search(r"(?<![0-9a-z])4b(?![0-9a-z])", low):
        return "4"
    return ""


def _normalize_base_model(bm):
    """将 baseModel 字符串归一化为可比对的内部标识符（含 Klein 4B/9B 等细粒度）。"""
    if not bm or not isinstance(bm, str):
        return ""
    s = bm.strip().lower()
    s_nospace = re.sub(r"\s+", "", s)

    # Flux.2 Klein 4B / 9B（须在通用 flux 匹配之前）
    if "klein" in s or "klein" in s_nospace:
        kb = _klein_b_variant(s)
        if kb == "9":
            return "flux2klein9b"
        if kb == "4":
            return "flux2klein4b"
        return "flux2klein_other"

    # 较长子串优先（避免 flux.1 被 flux 吞掉）
    _ordered = [
        ("flux.1 schnell", "flux1schnell"),
        ("flux.1 dev", "flux1dev"),
        ("flux.1", "flux1"),
        ("stable diffusion xl", "sdxl"),
        ("sdxl 1.0", "sdxl"),
        ("sdxl", "sdxl"),
        ("stable diffusion 2.1", "sd21"),
        ("sd 2.1", "sd21"),
        ("stable diffusion 2", "sd2"),
        ("sd 2", "sd2"),
        ("stable diffusion 1.5", "sd15"),
        ("sd 1.5", "sd15"),
        ("stable diffusion 1", "sd1"),
        ("sd 1", "sd1"),
        ("pony diffusion", "pony"),
        ("pony", "pony"),
        ("illustrious", "illustrious"),
        ("firefly", "firefly"),
        ("kolors", "kolors"),
        ("lumina", "lumina"),
        ("playground", "playground"),
    ]
    for pat, key in _ordered:
        if pat in s:
            return key
    if "flux" in s:
        return "flux_other"
    return re.sub(r"[\s\-_]+", "", s)


def _sanitize_for_json(obj):
    """Make payloads safe for JSON (RFC / browser JSON.parse): no NaN/Infinity."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if obj != obj or obj in (float("inf"), float("-inf")):
            return None
    return obj


def _ma_json_response(data, status=200):
    """JSON response that JavaScript JSON.parse always accepts."""
    try:
        payload = json.dumps(_sanitize_for_json(data), ensure_ascii=False, allow_nan=False)
    except Exception as e:
        payload = json.dumps(
            {"ok": False, "error": f"响应序列化失败: {e}", "duplicates": [], "updates": []},
            ensure_ascii=False,
            allow_nan=False,
        )
        status = 500
    try:
        return web.Response(
            body=payload.encode("utf-8"),
            status=status,
            content_type="application/json",
        )
    except Exception as e:
        fb = json.dumps({"ok": False, "error": str(e), "updates": [], "duplicates": []})
        return web.Response(body=fb.encode("utf-8"), status=500, content_type="application/json")


def _get_lora_metadata_paths(lora_path):
    """按读取优先级查找信息文件：magicloradate > LoRA 同级目录。"""
    paths = {"txt": None, "json": None, "image": None, "log": None}
    if not lora_path:
        return paths
    lora_dir = os.path.dirname(lora_path)
    basename = os.path.splitext(os.path.basename(lora_path))[0]
    for kind in paths:
        suffixes = _LORA_PREVIEW_SUFFIXES if kind == "image" else (f".{kind}",)
        for directory in (os.path.join(lora_dir, "magicloradate"), lora_dir):
            for suffix in suffixes:
                candidate = os.path.join(directory, basename + suffix)
                try:
                    if stat.S_ISREG(os.stat(candidate).st_mode):
                        paths[kind] = candidate
                        break
                except FileNotFoundError:
                    pass
            if paths[kind]:
                break
    return paths


def _get_lora_state_store():
    return LoraMetadataState(MagicUtils.USER_DIR)


def _metadata_field_states(paths, facts=None, local_reviews=None):
    """Local usable files take priority over source facts; no image decode or model hash."""
    states = {}
    for kind in _METADATA_KINDS:
        fact = (facts or {}).get(kind, {})
        source_error = {key: fact[key] for key in ("last_error", "error_at") if fact.get(key)}
        path = paths.get(kind)
        if path:
            try:
                size = os.stat(path).st_size
                if size == 0:
                    states[kind] = field_state(
                        "invalid", fact.get("checked_at"), "本地文件为空，请手动修复或更新已有信息", **source_error
                    )
                    continue
                if kind == "image":
                    with open(path, "rb") as source:
                        header = source.read(16)
                    valid_header = (header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\xff\xd8\xff")
                                    or (header.startswith(b"RIFF") and header[8:12] == b"WEBP"))
                    if len(header) < 16 or not valid_header:
                        raise ValueError("本地预览文件头无效或不完整，请手动修复或更新已有信息")
                if kind in ("txt", "json", "log"):
                    with open(path, "r", encoding="utf-8-sig") as source:
                        content = source.read(1024 * 1024 + 1)
                    if not content.strip():
                        raise ValueError("本地文件没有有效内容")
                    if kind == "log":
                        if len(content) > 1024 * 1024:
                            raise ValueError("权重信息文件过大")
                        value = json.loads(content)
                        weight = value.get("preferred weight") if isinstance(value, dict) else None
                        if isinstance(weight, bool) or weight is None or not math.isfinite(float(weight)):
                            raise ValueError("本地权重信息没有有效的推荐权重")
                states[kind] = field_state("present", fact.get("checked_at"), "本地已有可用信息", **source_error)
            except FileNotFoundError:
                states[kind] = field_state(
                    "missing", fact.get("checked_at"), "本地信息文件已被删除，需重新补充", **source_error
                )
            except (ValueError, UnicodeError, TypeError) as e:
                states[kind] = field_state("invalid", fact.get("checked_at"), str(e), **source_error)
            except OSError as e:
                states[kind] = field_state("local_error", fact.get("checked_at"), f"本地信息读取失败: {e}", **source_error)
            continue
        state = fact.get("state", "missing")
        reason = fact.get("reason", "尚未成功检查来源")
        if state == "present":
            state = "error" if fact.get("last_error") else "missing"
            reason = fact.get("last_error") or "曾保存的信息文件现在不存在，需重新补充"
        elif fact.get("last_error"):
            reason += f"；最近重查失败: {fact['last_error']}"
        states[kind] = field_state(state, fact.get("checked_at"), reason, **source_error)
    for kind, state in states.items():
        fact = (facts or {}).get(kind, {})
        review = (local_reviews or {}).get(kind)
        state.update(local_reviewed=bool(review), local_reviewed_at=review.get("reviewed_at") if review else None,
                     source_state=fact.get("state", "missing"), source_checked_at=fact.get("checked_at"),
                     source_reason=fact.get("reason", "尚未成功检查来源"))
        if state["state"] in ("present", "invalid", "local_error"):
            state["provenance"] = "local"
        elif review:
            state.update(state="user_skipped", needs_fetch=False, provenance="user",
                         reason="已手动标记为整理完成，普通补全将跳过；这不是来源检查结果")
        else:
            state["provenance"] = "source" if fact else None
    return states


_META_INVENTORY_CACHE = {}
_META_INVENTORY_TTL = 120.0


def _apply_lm_field_states(lora_path, states):
    """把 Lora-Manager 已提供的信息标成 present，避免列表里重复报缺项。"""
    try:
        lm_kinds = _lm_provided_kinds(lora_path)
    except Exception:
        return states
    for kind, provided in lm_kinds.items():
        state = states.get(kind)
        if not provided or not state or state.get("state") == "present":
            continue
        prev = dict(state)
        states[kind] = field_state("present", reason="Lora Manager 已有信息", provenance="lora_manager")
        states[kind].update(local_reviewed=False, local_reviewed_at=None,
                            source_state=prev.get("source_state", "missing"),
                            source_checked_at=prev.get("source_checked_at"),
                            source_reason=prev.get("source_reason", ""))
    return states


def _get_lora_metadata_inventory():
    """本地信息清单：不读取模型内容、不计算哈希、不访问网络。"""
    names = folder_paths.get_filename_list("loras")
    metadata = {}
    identities = {}
    paths_by_name = {}
    field_states = {}
    errors = []
    by_info_basename = {}
    for name in names:
        try:
            lora_path = folder_paths.get_full_path("loras", name)
            if lora_path:
                identities[name] = file_identity(lora_path)
                # 不同根目录的相同相对名称不冲突；同实体目录、同名模型共享信息。
                key = os.path.normcase(os.path.splitext(os.path.abspath(lora_path))[0])
                by_info_basename.setdefault(key, []).append(name)
            paths = _get_lora_metadata_paths(lora_path)
            paths_by_name[name] = paths
            lm_kinds = _lm_provided_kinds(lora_path) if lora_path else {}
            metadata[name] = {kind: bool(path) or bool(lm_kinds.get(kind)) for kind, path in paths.items()}
            metadata[name]["lm"] = bool(lora_path and _lm_is_complete(lora_path))
            if not lora_path:
                errors.append({"path": name, "error": "LoRA文件未找到"})
                field_states[name] = {kind: field_state("local_error", reason="LoRA 文件未找到或目录不可访问") for kind in _METADATA_KINDS}
        except Exception as e:
            metadata[name] = {"txt": False, "json": False, "image": False, "log": False, "lm": False}
            field_states[name] = {kind: field_state("local_error", reason=f"本地文件读取失败: {e}") for kind in _METADATA_KINDS}
            errors.append({"path": name, "error": str(e)})
    record_warning = None
    try:
        records = _get_lora_state_store().read_inventory(list(identities.values()))
    except Exception as e:
        records = {}
        record_warning = f"检查记录读取失败，未确认的缺项将重新检查: {e}"
    for name, paths in paths_by_name.items():
        if name not in field_states:
            identity = identities.get(name, {})
            record = records.get(identity.get("path"), {})
            states = _metadata_field_states(paths, record.get("fields", {}), record.get("local_reviews", {}))
            lora_path = folder_paths.get_full_path("loras", name)
            field_states[name] = _apply_lm_field_states(lora_path, states) if lora_path else states
    shared_info = {name: group for group in by_info_basename.values() if len(group) > 1 for name in group}
    result = {"files": names, "metadata": metadata, "field_states": field_states, "errors": errors, "shared_info": shared_info}
    if record_warning:
        result["record_warning"] = record_warning
    return result


@PromptServer.instance.routes.get("/ma/lora/list")
async def get_lora_list(request):
    try:
        if request.query.get("include_metadata", "").lower() == "true":
            force = request.query.get("force", "").lower() in ("1", "true", "yes")
            now = time.time()
            cached = _META_INVENTORY_CACHE.get("data")
            if not force and cached is not None and (now - _META_INVENTORY_CACHE.get("t", 0)) < _META_INVENTORY_TTL:
                return web.json_response(cached)
            inv = await _run_blocking(_get_lora_metadata_inventory)
            _META_INVENTORY_CACHE["data"] = inv
            _META_INVENTORY_CACHE["t"] = time.time()
            return web.json_response(inv)
        lora_names = folder_paths.get_filename_list("loras")
        file_mtimes = {}
        for name in lora_names:
            try:
                full = folder_paths.get_full_path("loras", name)
                if full and os.path.isfile(full):
                    file_mtimes[name] = int(os.path.getmtime(full))
            except Exception:
                pass
        return web.json_response({"files": lora_names, "mtimes": file_mtimes})
    except Exception as e:
        return web.json_response({"files": [], "mtimes": {}, "error": str(e)})


@PromptServer.instance.routes.post("/ma/lora/civitai_url")
async def lora_civitai_url(request):
    """返回指定 LoRA 在 Civitai 的模型页地址（按文件 SHA256 反查模型版本）。"""
    try:
        data = await request.json()
        lora_name = (data or {}).get("lora_name")
        if not isinstance(lora_name, str) or not lora_name.strip():
            return web.json_response({"ok": False, "error": "缺少 lora_name 参数"}, status=400)

        def _resolve():
            full = folder_paths.get_full_path("loras", lora_name)
            if not full or not os.path.isfile(full):
                return {"ok": False, "error": "找不到该 LoRA 文件"}
            # 先看 LM sidecar / 数据库是否已有 modelId
            meta = _lm_meta(full)
            cv_side = (meta or {}).get("civitai") if isinstance(meta, dict) else None
            if isinstance(cv_side, dict):
                mid = _normalize_civitai_version_id(cv_side.get("modelId"))
                vid = _normalize_civitai_version_id(cv_side.get("id"))
                if (mid or 0) > 0:
                    url = f"https://{_civitai_host()}/models/{mid}"
                    if vid and vid > 0:
                        url += f"?modelVersionId={vid}"
                    return {"ok": True, "url": url, "model_id": mid, "version_id": vid, "name": lm_sidecar.title(meta)}
            row = _lm_db_row(full) or {}
            if row.get("civitai_model_id"):
                mid = _normalize_civitai_version_id(row.get("civitai_model_id"))
                vid = _normalize_civitai_version_id(row.get("civitai_id"))
                if (mid or 0) > 0:
                    url = f"https://{_civitai_host()}/models/{mid}"
                    if vid and vid > 0:
                        url += f"?modelVersionId={vid}"
                    return {"ok": True, "url": url, "model_id": mid, "version_id": vid, "name": row.get("civitai_name") or ""}
            sha256 = _cached_sha256(full) or calculate_sha256(full)
            cv = fetch_civitai_data_by_hash(sha256, strict=True, include_model=False)
            if not isinstance(cv, dict):
                return {"ok": False, "error": "Civitai 未找到匹配的模型（可能非公开或哈希未收录）"}
            model_id = _normalize_civitai_version_id(cv.get("modelId"))
            version_id = _normalize_civitai_version_id(cv.get("id"))
            if (model_id or 0) <= 0:
                return {"ok": False, "error": "Civitai 未返回有效的模型 ID"}
            model_url = f"https://{_civitai_host()}/models/{model_id}"
            if version_id and version_id > 0:
                model_url += f"?modelVersionId={version_id}"
            return {
                "ok": True,
                "url": model_url,
                "model_id": model_id,
                "version_id": version_id,
                "name": cv.get("name") or "",
            }

        result = await _run_blocking(_resolve)
        return web.json_response(result, status=(200 if result.get("ok") else 404))
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post("/ma/lora/detect_scan")
async def lora_detect_scan(request):
    """按目录或全部扫描 LoRA：检测重复文件（SHA256）。"""
    try:
        data = await request.json()
        scope = data.get("scope") or "folder"
        path_parts = data.get("path") or []
        result = await _run_blocking(_run_lora_detect_scan, scope, path_parts)
        return _ma_json_response(result)
    except Exception as e:
        return _ma_json_response({"ok": False, "error": str(e), "duplicates": []}, status=500)

@PromptServer.instance.routes.post("/ma/lora/update_check")
async def lora_update_check(request):
    """从 Civitai API 检查 LoRA 更新：遍历范围内的 LoRA，通过 SHA256 查询 Civitai 获取最新版本信息。"""
    try:
        data = await request.json()
        scope = data.get("scope") or "folder"
        path_parts = data.get("path") or []
        result = await _run_blocking(_safe_run_lora_update_check, scope, path_parts)
        return _ma_json_response(result)
    except Exception as e:
        return _ma_json_response({"ok": False, "error": str(e), "updates": []}, status=500)

@PromptServer.instance.routes.get("/ma/lora/images")
async def get_lora_images(request):
    """获取所有LoRA文件及其对应的预览图的映射（magicloradate > LM > 同目录）。"""
    try:
        lora_files = folder_paths.get_filename_list("loras")
        images = {}
        for lora_filename in lora_files:
            lora_full_path = folder_paths.get_full_path("loras", lora_filename)
            if not lora_full_path:
                continue
            preview = _resolve_lora_preview(lora_full_path)
            if preview:
                images[lora_filename] = _lora_preview_relative(preview, lora_filename)
        return web.json_response(images)
    except Exception as e:
        print(f"获取LoRA图片列表时出错: {e}")
        return web.json_response({})

def _thumb_cache_dir():
    d = os.path.join(MagicUtils.USER_DIR, "thumb_cache")
    os.makedirs(d, exist_ok=True)
    return d


def _build_thumbnail(img_path, width):
    """Generate (or reuse) a cached WebP thumbnail for img_path. Returns (bytes, etag)."""
    try:
        st = os.stat(img_path)
    except OSError:
        return None, None
    mtime = int(st.st_mtime)
    key = hashlib.md5(f"{img_path}|{mtime}|{width}|v2".encode("utf-8")).hexdigest()
    cache_dir = _thumb_cache_dir()
    cache_file = os.path.join(cache_dir, key + ".webp")
    etag = '"' + key + '"'
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, "rb") as f:
                return f.read(), etag
        except OSError:
            pass
    try:
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            if width and im.width > width:
                ratio = width / float(im.width)
                im = im.resize((width, max(1, int(im.height * ratio))), Image.LANCZOS)
            import io as _io
            buf = _io.BytesIO()
            im.save(buf, format="WEBP", quality=82, method=4)
            data = buf.getvalue()
        tmp = cache_file + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, cache_file)
        return data, etag
    except Exception as e:
        print(f"❌ 生成缩略图失败 {img_path}: {e}")
        return None, None


@PromptServer.instance.routes.get("/ma/lora/image")
async def get_lora_image(request):
    try:
        name = request.query.get("name")
        if not name:
            return web.Response(status=404)
        img_path = await _run_blocking(MagicPowerLoraLoader.get_preview_path, name)
        if not img_path or not os.path.exists(img_path):
            return web.Response(status=404)

        width = 0
        w_raw = request.query.get("w")
        if w_raw:
            try:
                width = max(16, min(2048, int(w_raw)))
            except (ValueError, TypeError):
                width = 0

        if width:
            data, etag = await _run_blocking(_build_thumbnail, img_path, width)
            if data is not None:
                return web.Response(
                    body=data,
                    content_type="image/webp",
                    headers={"Cache-Control": "public, max-age=31536000, immutable", "ETag": etag},
                )
        try:
            st = os.stat(img_path)
            etag = '"%d-%d"' % (int(st.st_mtime), st.st_size)
        except OSError:
            etag = None
        headers = {"Cache-Control": "public, max-age=86400"}
        if etag:
            headers["ETag"] = etag
        return web.FileResponse(img_path, headers=headers)
    except Exception as e:
        print(f"❌ Image API Error: {e}")
        return web.Response(status=500)

def get_preset_dir():
    target_dir = os.path.join(MagicUtils.USER_DIR, "lora_presets")
    if not os.path.exists(target_dir): os.makedirs(target_dir, exist_ok=True)
    return target_dir

def _preset_meta_path():
    return os.path.join(get_preset_dir(), "_meta.json")

def _load_preset_meta():
    meta = {"categories": [], "assignments": {}, "preset_order": []}
    try:
        path = _preset_meta_path()
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cats = data.get("categories")
                asg = data.get("assignments")
                if isinstance(cats, list):
                    meta["categories"] = [str(c).strip() for c in cats if str(c).strip()]
                if isinstance(asg, dict):
                    meta["assignments"] = {str(k): str(v).strip() for k, v in asg.items() if str(v).strip()}
                order = data.get("preset_order")
                if isinstance(order, list):
                    seen_order = set()
                    for key in order:
                        key = str(key).strip()
                        if key and key not in seen_order:
                            seen_order.add(key)
                            meta["preset_order"].append(key)
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 读取预设分类失败: {e}")
    return meta

def _save_preset_meta(meta):
    with open(_preset_meta_path(), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

@PromptServer.instance.routes.get("/ma/lora/preset_meta")
async def get_preset_meta(request):
    return web.json_response(_load_preset_meta())

@PromptServer.instance.routes.post("/ma/lora/preset_meta")
async def save_preset_meta(request):
    try:
        data = await request.json()
        cats = []
        seen = set()
        for c in (data.get("categories") or []):
            s = str(c).strip()
            if s and s not in seen:
                seen.add(s)
                cats.append(s)
        asg = {}
        for k, v in (data.get("assignments") or {}).items():
            k = str(k).strip()
            v = str(v).strip()
            if k and v:
                asg[k] = v
        order = []
        seen_order = set()
        for key in (data.get("preset_order") or []):
            key = str(key).strip()
            if key and key not in seen_order:
                seen_order.add(key)
                order.append(key)
        _save_preset_meta({"categories": cats, "assignments": asg, "preset_order": order})
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

def _favorites_path():
    os.makedirs(MagicUtils.USER_DIR, exist_ok=True)
    return os.path.join(MagicUtils.USER_DIR, "lora_favorites.json")

def _load_favorites():
    collections = []
    try:
        path = _favorites_path()
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            raw = data.get("collections") if isinstance(data, dict) else data
            if isinstance(raw, list):
                for c in raw:
                    if not isinstance(c, dict):
                        continue
                    name = str(c.get("name") or "").strip()
                    if not name:
                        continue
                    items, seen = [], set()
                    for x in (c.get("items") or []):
                        s = str(x).strip()
                        if s and s not in seen:
                            seen.add(s)
                            items.append(s)
                    collections.append({"name": name, "items": items})
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 读取收藏夹失败: {e}")
    return collections

@PromptServer.instance.routes.get("/ma/lora/favorites")
async def get_favorites(request):
    return web.json_response({"collections": _load_favorites()})

@PromptServer.instance.routes.post("/ma/lora/favorites")
async def save_favorites(request):
    try:
        data = await request.json()
        raw = data.get("collections") or []
        collections = []
        for c in raw:
            if not isinstance(c, dict):
                continue
            name = str(c.get("name") or "").strip()
            if not name:
                continue
            items, seen = [], set()
            for x in (c.get("items") or []):
                s = str(x).strip()
                if s and s not in seen:
                    seen.add(s)
                    items.append(s)
            collections.append({"name": name, "items": items})
        with open(_favorites_path(), "w", encoding="utf-8") as f:
            json.dump({"collections": collections}, f, indent=2, ensure_ascii=False)
        return web.json_response({"status": "success", "collections": collections})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


def _notes_path():
    os.makedirs(MagicUtils.USER_DIR, exist_ok=True)
    return os.path.join(MagicUtils.USER_DIR, "lora_notes.json")


def _load_notes():
    try:
        with open(_notes_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if str(k).strip()}
    except (OSError, ValueError):
        pass
    return {}


def _save_notes(notes):
    path = _notes_path()
    fd, temp_path = tempfile.mkstemp(prefix=".lora-notes-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(notes, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@PromptServer.instance.routes.get("/ma/lora/notes")
async def get_lora_notes(request):
    return web.json_response({"notes": _load_notes()})


@PromptServer.instance.routes.post("/ma/lora/notes")
async def save_lora_notes(request):
    try:
        data = await request.json()
        name = str(data.get("name") or "").strip()[:512]
        note = str(data.get("note") or "")[:2000]
        if not name:
            return web.json_response({"status": "error", "message": "缺少 LoRA 名称"}, status=400)
        notes = _load_notes()
        if note.strip():
            notes[name] = note
        else:
            notes.pop(name, None)
        _save_notes(notes)
        return web.json_response({"status": "success", "notes": notes})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


@PromptServer.instance.routes.get("/ma/lora/lm_info")
async def get_lm_info(request):
    """Lora-Manager sidecar 里的标题/备注/触发词/基础模型。"""
    try:
        names = folder_paths.get_filename_list("loras")
        result = {}
        for name in names:
            lora_path = folder_paths.get_full_path("loras", name)
            if not lora_path:
                continue
            info = _lm_info(lora_path)
            if info:
                result[name] = info
        return web.json_response({"info": result})
    except Exception as e:
        return web.json_response({"info": {}, "error": str(e)})


@PromptServer.instance.routes.get("/ma/lora/paths")
async def get_lora_paths(request):
    """LoRA 绝对路径映射，供编辑窗口显示位置。"""
    try:
        result = {}
        for name in folder_paths.get_filename_list("loras"):
            path = folder_paths.get_full_path("loras", name)
            if path:
                result[name] = path.replace("\\", "/")
        return web.json_response({"paths": result})
    except Exception as e:
        return web.json_response({"paths": {}, "error": str(e)})


@PromptServer.instance.routes.post("/ma/lora/open_folder")
async def open_lora_folder(request):
    """在系统文件管理器中打开该 LoRA 所在目录。"""
    try:
        data = await request.json()
        name = str(data.get("lora_name") or "").strip()
        path = folder_paths.get_full_path("loras", name) if name else None
        if not path or not os.path.isfile(path):
            return web.json_response({"status": "error", "message": "LoRA 文件未找到"}, status=404)
        folder = os.path.dirname(path)
        if os.name == "nt":
            import subprocess
            subprocess.Popen(["explorer", f"/select,{os.path.normpath(path)}"])
        else:
            import subprocess
            subprocess.Popen(["xdg-open", folder])
        return web.json_response({"status": "success", "folder": folder})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.post("/ma/lora/save_preset")
async def save_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        content = data.get("content")
        if not preset_name or not content: return web.json_response({"status": "error"})
        
        file_path = os.path.join(get_preset_dir(), f"{preset_name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=4, ensure_ascii=False)
        if "category" in data:
            meta = _load_preset_meta()
            category = str(data.get("category") or "").strip()
            if category:
                if category not in meta["categories"]:
                    meta["categories"].append(category)
                meta["assignments"][str(preset_name)] = category
            else:
                meta["assignments"].pop(str(preset_name), None)
            _save_preset_meta(meta)
        return web.json_response({"status": "success"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.get("/ma/lora/get_presets")
async def get_presets(request):
    try:
        preset_dir = get_preset_dir()
        files = [f for f in os.listdir(preset_dir) if f.endswith(".json") and not f.startswith("_")]
        presets = {}
        for f in files:
            try:
                with open(os.path.join(preset_dir, f), 'r', encoding='utf-8') as pf:
                    presets[f.replace(".json", "")] = json.load(pf)
            except: pass
        return web.json_response({"presets": presets})
    except Exception as e: return web.json_response({"presets": {}, "error": str(e)})

@PromptServer.instance.routes.post("/ma/lora/delete_preset")
async def delete_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        if not preset_name: return web.json_response({"status": "error", "message": "缺少预设名称"})
        
        preset_dir = get_preset_dir()
        file_path = os.path.join(preset_dir, f"{preset_name}.json")
        
        if os.path.exists(file_path):
            os.remove(file_path)
            meta = _load_preset_meta()
            meta["assignments"].pop(str(preset_name), None)
            _save_preset_meta(meta)
            return web.json_response({"status": "success", "message": f"预设 '{preset_name}' 已删除"})
        else:
            return web.json_response({"status": "error", "message": "预设文件不存在"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.post("/ma/lora/rename_preset")
async def rename_preset(request):
    try:
        data = await request.json()
        old = str(data.get("old") or "").strip()
        new = str(data.get("new") or "").strip()
        if not old or not new:
            return web.json_response({"status": "error", "message": "缺少旧名称或新名称"})
        if old == new:
            return web.json_response({"status": "success"})
        invalid = ("/", "\\", "..")
        if any(c in old for c in invalid) or any(c in new for c in invalid) or new.startswith("_") or old.startswith("_"):
            return web.json_response({"status": "error", "message": "预设名称不能包含路径符号或以下划线开头"})

        preset_dir = get_preset_dir()
        src = os.path.join(preset_dir, f"{old}.json")
        dst = os.path.join(preset_dir, f"{new}.json")
        if not os.path.isfile(src):
            return web.json_response({"status": "error", "message": "原预设不存在"})
        if os.path.exists(dst):
            return web.json_response({"status": "error", "message": "已存在同名预设"})

        os.replace(src, dst)
        meta = _load_preset_meta()
        if old in meta["assignments"]:
            meta["assignments"][new] = meta["assignments"].pop(old)
        _save_preset_meta(meta)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

# --- 爬取功能辅助函数 ---

def clean_html(raw_html):
    """清理HTML标签"""
    if not raw_html:
        return ""
    text = re.sub(r'</p>|<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    text = re.sub(r'<.*?>', '', text)
    text = re.sub(r'\n\s*\n', '\n', text).strip()
    return text

def calculate_sha256(filepath):
    """计算文件SHA256哈希值"""
    sha256 = hashlib.sha256()
    chunk_size = 65536
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()

# --- LoRA 检测（重复 / 可能新版本）---

_LORA_FILE_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".pt2", ".bin", ".pth", ".sft", ".pkl")

def _norm_lora_rel(p):
    return (p or "").replace("\\", "/").strip()

def _is_lora_extension(filename):
    n = (filename or "").lower()
    return any(n.endswith(ext) for ext in _LORA_FILE_SUFFIXES)

def _list_lora_rel_paths_for_scope(all_rels, scope, path_parts):
    """
    scope: 'all' | 'folder'
    path_parts: [] = 仅 loras 根目录下的文件（无子路径）；['a','b'] = 路径 a/b/ 下（含子目录）全部 LoRA
    """
    path_parts = [str(x).replace("\\", "/").strip("/") for x in (path_parts or []) if str(x).strip()]
    prefix = "/".join(path_parts)
    out = []
    for rel in all_rels:
        nr = _norm_lora_rel(rel)
        base = nr.split("/")[-1]
        if not _is_lora_extension(base):
            continue
        if scope == "all":
            out.append(rel)
            continue
        if not prefix:
            if "/" not in nr:
                out.append(rel)
        else:
            pref = prefix + "/"
            if nr == prefix or nr.startswith(pref):
                out.append(rel)
    return out

def _read_safetensors_meta(path):
    try:
        from safetensors import safe_open
        with safe_open(path, framework="np") as f:
            return dict(f.metadata() or {})
    except Exception:
        return {}

def _extract_base_model(meta):
    if not meta:
        return ""
    for k in ("ss_base_model_name", "modelspec.architecture", "ss_sd_model_name", "modelspec.sai_model_spec", "base_model"):
        v = meta.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()[:200]
    return ""


def _extract_base_model_from_sidecar(rel_path):
    """
    从爬取保存的介绍文件读「基础模型」（magicloradate/*.json 常为纯文本，非严格 JSON）。
    """
    fp = folder_paths.get_full_path("loras", rel_path)
    if not fp or not os.path.isfile(fp):
        return ""
    lora_dir = os.path.dirname(fp)
    stem = os.path.splitext(os.path.basename(fp))[0]
    paths_try = [
        os.path.join(lora_dir, "magicloradate", f"{stem}.json"),
        os.path.join(lora_dir, f"{stem}.json"),
        os.path.join(lora_dir, "magicloradate", f"{stem}.log"),
    ]
    for p in paths_try:
        if not os.path.isfile(p):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                text = f.read(131072)
            m = re.search(r"^\s*基础模型\s*[:：]\s*(.+)$", text, re.MULTILINE)
            if m:
                return m.group(1).strip()[:200]
            m2 = re.search(r"^\s*base\s*model\s*[:：]\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
            if m2:
                return m2.group(1).strip()[:200]
            try:
                j = json.loads(text)
                if isinstance(j, dict):
                    for k in ("baseModel", "base_model", "base_model_name"):
                        v = j.get(k)
                        if v is not None and str(v).strip():
                            return str(v).strip()[:200]
            except Exception:
                pass
        except Exception:
            continue
    return ""

def _normalize_lora_stem(rel_path):
    stem = os.path.splitext(os.path.basename(rel_path))[0].lower()
    stem = re.sub(r"\s*\(\d+\)\s*$", "", stem)
    stem = re.sub(r"[_\s-]+(v|ver)\d+(\.\d+)?\s*$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"[_\s.-]+\d{4}[-_]\d{2}[-_]\d{2}\s*$", "", stem)
    stem = stem.strip("._- \t")
    if not stem:
        stem = os.path.splitext(os.path.basename(rel_path))[0].lower()
    return stem

def _run_lora_detect_scan(scope, path_parts):
    scope = (scope or "folder").lower()
    if scope not in ("all", "folder"):
        scope = "folder"
    if not isinstance(path_parts, list):
        path_parts = []

    all_names = folder_paths.get_filename_list("loras")
    rels = _list_lora_rel_paths_for_scope(all_names, scope, path_parts)

    entries = []
    errors = []
    for rel in rels:
        fp = folder_paths.get_full_path("loras", rel)
        if not fp or not os.path.isfile(fp):
            continue
        try:
            st = os.stat(fp)
            mtime = int(st.st_mtime)
            size = st.st_size
            h = calculate_sha256(fp)
            meta = {}
            low = rel.lower()
            if low.endswith(".safetensors") or low.endswith(".sft"):
                meta = _read_safetensors_meta(fp)
            base = (_extract_base_model(meta) or "").lower()[:200]
            stem = _normalize_lora_stem(rel)
            entries.append({
                "path": _norm_lora_rel(rel),
                "hash": h,
                "mtime": mtime,
                "size": size,
                "base_model": base,
                "stem": stem,
            })
        except Exception as ex:
            errors.append({"path": rel, "error": str(ex)})

    by_hash = defaultdict(list)
    for e in entries:
        by_hash[e["hash"]].append(e)
    duplicates = []
    for h, lst in by_hash.items():
        if len(lst) > 1:
            duplicates.append({
                "hash": h,
                "files": sorted(lst, key=lambda x: x["path"]),
            })

    by_key_meta = defaultdict(list)
    by_key_weak = defaultdict(list)
    for e in entries:
        parent = os.path.dirname(e["path"]) or ""
        parent = parent.replace("\\", "/")
        if e["base_model"]:
            by_key_meta[(e["base_model"], e["stem"])].append(e)
        else:
            by_key_weak[(parent, e["stem"])].append(e)

    updates = []
    for (bm, stem), lst in by_key_meta.items():
        if len(lst) < 2 or len({e["hash"] for e in lst}) < 2:
            continue
        lst_sorted = sorted(lst, key=lambda x: x["mtime"], reverse=True)
        updates.append({
            "base_model": bm,
            "stem": stem,
            "newest": lst_sorted[0],
            "older": lst_sorted[1:],
        })

    updates_weak = []
    for (parent, stem), lst in by_key_weak.items():
        if len(lst) < 2 or len({e["hash"] for e in lst}) < 2:
            continue
        lst_sorted = sorted(lst, key=lambda x: x["mtime"], reverse=True)
        updates_weak.append({
            "parent": parent,
            "stem": stem,
            "newest": lst_sorted[0],
            "older": lst_sorted[1:],
        })

    return {
        "ok": True,
        "scoped_count": len(rels),
        "scanned": len(entries),
        "duplicates": duplicates,
        "errors": errors[:80],
    }


def _safe_run_lora_update_check(scope, path_parts):
    try:
        return _run_lora_update_check(scope, path_parts)
    except Exception as e:
        import traceback
        print(f"[ComfyUI-Magic-Assistant] lora update_check: {e}\n{traceback.format_exc()}")
        return {
            "ok": False,
            "error": str(e) or type(e).__name__,
            "updates": [],
            "scoped_count": 0,
            "scanned": 0,
            "errors": [],
        }


def _run_lora_update_check(scope, path_parts):
    """从 Civitai API 检查 LoRA 更新：遍历范围内的 LoRA，通过 SHA256 查询 Civitai 获取最新版本信息。"""
    scope = (scope or "folder").lower()
    if scope not in ("all", "folder"):
        scope = "folder"
    if not isinstance(path_parts, list):
        path_parts = []

    all_names = folder_paths.get_filename_list("loras")
    rels = _list_lora_rel_paths_for_scope(all_names, scope, path_parts)

    entries = []
    errors = []
    for rel in rels:
        fp = folder_paths.get_full_path("loras", rel)
        if not fp or not os.path.isfile(fp):
            continue
        try:
            st = os.stat(fp)
            mtime = int(st.st_mtime)
            size = st.st_size
            h = calculate_sha256(fp)
            low = rel.lower()
            is_safetensors = low.endswith(".safetensors") or low.endswith(".sft")
            entries.append({
                "path": _norm_lora_rel(rel),
                "hash": h,
                "mtime": mtime,
                "size": size,
                "is_safetensors": is_safetensors,
                "base_model": "",   # 稍后填充
            })
        except Exception as ex:
            errors.append({"path": rel, "error": str(ex)})

    # 批量读取 safetensors metadata（本地 base model）
    _bm_exts = (".safetensors", ".sft")
    for e in entries:
        if not e["is_safetensors"]:
            continue
        fp2 = folder_paths.get_full_path("loras", e["path"])
        if fp2 and os.path.isfile(fp2):
            try:
                meta = _read_safetensors_meta(fp2)
                e["base_model"] = _extract_base_model(meta)
            except Exception:
                pass
        if not (e.get("base_model") or "").strip():
            side = _extract_base_model_from_sidecar(e["path"])
            if side:
                e["base_model"] = side

    # 按 SHA256 分组，每组只需查询一次 Civitai
    by_hash = defaultdict(list)
    for e in entries:
        by_hash[e["hash"]].append(e)

    updates = []
    for h, group in by_hash.items():
        try:
            cv_data = fetch_civitai_data_by_hash(h)
            if not cv_data:
                continue
            local_vid = _normalize_civitai_version_id(cv_data.get("id"))
            local_version = _coerce_version_number(cv_data.get("versionNumber", 0))
            model = cv_data.get("model", {})
            if not isinstance(model, dict):
                model = {}
            versions = model.get("modelVersions")
            if not isinstance(versions, list):
                versions = []
            if not versions:
                continue
            local_bm_raw = (group[0].get("base_model") or "").strip()
            local_bm_norm = _normalize_base_model(local_bm_raw)
            # 优先用 hash 命中版本的 baseModel（比 ss_metadata 更准，因为是上传者填的）
            cv_bm_raw = (cv_data.get("baseModel") or "").strip()
            cv_bm_norm = _normalize_base_model(cv_bm_raw)

            # 在所有 modelVersions 中，先按 baseModel 分组，再在同组内找 max id
            # 只在「与本地 base model 相同的组」里找最新版
            bm_groups = defaultdict(list)
            for v in versions:
                if not isinstance(v, dict):
                    continue
                vid = _normalize_civitai_version_id(v.get("id"))
                if vid is None:
                    continue
                bm = _normalize_base_model(v.get("baseModel") or "")
                bm_groups[bm].append((vid, v))

            # 选用与本地 base model 匹配的那个分组；否则降级为 hash 命中版本的 base model
            target_bm = local_bm_norm if local_bm_norm else cv_bm_norm
            if not target_bm:
                target_bm = None

            candidates = []
            if target_bm and target_bm in bm_groups:
                candidates = bm_groups[target_bm]
            elif not target_bm:
                # 无 base model 时，对所有版本取 max id（避免漏报）
                for lst in bm_groups.values():
                    candidates.extend(lst)

            if not candidates:
                continue

            best_vid, best_ver = max(candidates, key=lambda x: x[0])
            max_vid = best_vid

            best_bm_norm = _normalize_base_model(best_ver.get("baseModel") or "")
            if target_bm and best_bm_norm and best_bm_norm != target_bm:
                continue
            # 本地已识别底模时，与 Civitai 最新版再比一次（防止归一化分组键一致但实际文案不同）
            if local_bm_norm and best_bm_norm and local_bm_norm != best_bm_norm:
                continue

            latest_version = _coerce_version_number(best_ver.get("versionNumber", 0))
            latest_version_id = best_ver.get("id")
            latest_download_url = None
            latest_published_at = None
            files = best_ver.get("files", [])
            if not isinstance(files, list):
                files = []
            for f in files:
                if not isinstance(f, dict):
                    continue
                if f.get("type") == "Model":
                    latest_download_url = f.get("downloadUrl") or f.get("url")
                    latest_published_at = f.get("publishedAt")
                    break

            newer_by_number = latest_version > local_version
            newer_by_id = local_vid is not None and max_vid > local_vid
            newer_by_date = False
            if not newer_by_number and not newer_by_id and local_vid is None:
                t_loc = _parse_civitai_dt(cv_data.get("createdAt"))
                t_best = _parse_civitai_dt(best_ver.get("createdAt") or best_ver.get("updatedAt"))
                if t_loc and t_best and t_best > t_loc:
                    newer_by_date = True
            if newer_by_number or newer_by_id or newer_by_date:
                updates.append({
                    "hash": h,
                    "path": group[0]["path"],
                    "local_version": local_version,
                    "latest_version": latest_version,
                    "local_label": _civitai_version_display(cv_data),
                    "latest_label": _civitai_version_display(best_ver),
                    "local_base_model": local_bm_raw,
                    "latest_base_model": (best_ver.get("baseModel") or "").strip(),
                    "latest_version_id": latest_version_id,
                    "latest_download_url": latest_download_url,
                    "model_url": f"https://civitai.com/models/{cv_data.get('modelId')}",
                    "model_name": model.get("name") if isinstance(model, dict) else "",
                    "published_at": latest_published_at,
                })
        except Exception as ex:
            errors.append({"path": group[0]["path"], "error": str(ex)})

    return {
        "ok": True,
        "scoped_count": len(rels),
        "scanned": len(entries),
        "updates": updates,
        "errors": errors[:80],
    }

class _CivitaiRequestError(RuntimeError):
    def __init__(self, message, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.stop_queue = status in (401, 403, 429)
        self.retry_after = retry_after


class _MetadataSourceError(RuntimeError):
    def __init__(self, message, state="error"):
        super().__init__(message)
        self.state = state


class _LocalChangedError(RuntimeError):
    pass


_LM_SETTINGS_PATH = os.path.join(os.environ.get("LOCALAPPDATA", ""), "ComfyUI-LoRA-Manager", "settings.json")
_CIVITAI_HOST_CACHE = None


def _lm_settings():
    try:
        with open(_LM_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _civitai_api_key():
    value = str(_lm_settings().get("civitai_api_key") or "").strip()
    return value


def _civitai_host():
    """跟随 Lora-Manager 的 civitai_host 设置，默认 civitai.com。"""
    global _CIVITAI_HOST_CACHE
    if _CIVITAI_HOST_CACHE is not None:
        return _CIVITAI_HOST_CACHE
    host = "civitai.com"
    try:
        with open(_LM_SETTINGS_PATH, "r", encoding="utf-8") as f:
            value = json.load(f).get("civitai_host")
        candidate = str(value or "").strip().split("://")[-1].strip("/")
        if re.fullmatch(r"[A-Za-z0-9.\-]+(:\d+)?", candidate):
            host = candidate
    except (OSError, ValueError):
        pass
    _CIVITAI_HOST_CACHE = host
    return host


def _civitai_json_request(url, phase, max_retries, api_delay):
    headers = {'User-Agent': 'Mozilla/5.0 Magic-Assistant/LoRA-Metadata'}
    api_key = _civitai_api_key()
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    last_error = None
    for attempt in range(max(1, max_retries)):
        try:
            if api_delay and attempt:
                time.sleep(api_delay * (2 ** (attempt - 1)))
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
                if response.status != 200:
                    raise _CivitaiRequestError(f"获取 Civitai {phase}失败（HTTP {response.status}）", response.status,
                                               response.getheader("Retry-After"))
                data = json.loads(response.read().decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError(f"Civitai 返回了无效的{phase}")
                return data
        except urllib.error.HTTPError as e:
            retry_after = e.headers.get("Retry-After") if e.headers else None
            last_error = _CivitaiRequestError(f"获取 Civitai {phase}失败（HTTP {e.code}）", e.code, retry_after)
            if e.code < 500:
                break
        except _CivitaiRequestError as e:
            last_error = e
            if e.status and e.status < 500:
                break
        except Exception as e:
            last_error = _CivitaiRequestError(f"获取 Civitai {phase}失败: {e}")
    raise last_error


def fetch_civitai_data_by_hash(hash_string, max_retries=3, api_delay=0.2, strict=False, include_model=True):
    """Model-description failures preserve the valid version response and its fields."""
    hnorm = (hash_string or "").strip()
    if not hnorm:
        return None
    try:
        data = _civitai_json_request(f"https://{_civitai_host()}/api/v1/model-versions/by-hash/{hnorm.upper()}",
                                     "模型版本", max_retries, api_delay)
        if (_normalize_civitai_version_id(data.get("id")) or 0) <= 0 or (_normalize_civitai_version_id(data.get("modelId")) or 0) <= 0:
            raise _CivitaiRequestError("Civitai 返回了无效的模型版本信息")
    except _CivitaiRequestError as e:
        if e.status == 404:
            return None
        if strict:
            raise
        return None
    if not include_model:
        return data
    try:
        model = _civitai_json_request(f"https://{_civitai_host()}/api/v1/models/{data['modelId']}",
                                      "模型介绍", max_retries, api_delay)
        if _normalize_civitai_version_id(model.get("id")) != _normalize_civitai_version_id(data["modelId"]):
            raise _CivitaiRequestError("Civitai 返回了不匹配的模型介绍")
        data["model"] = model
    except _CivitaiRequestError as e:
        data["model"] = {}
        data["_model_error"] = str(e)
        if e.stop_queue:
            data["_stop_queue"] = True
            data["_retry_after"] = e.retry_after
    return data


def _fetch_civitai_by_version(version_id, include_model=True):
    """用 Lora-Manager 数据库里的版本 ID 直接取来源信息。"""
    try:
        vid = int(version_id)
    except (TypeError, ValueError):
        return None
    try:
        data = _civitai_json_request(f"https://{_civitai_host()}/api/v1/model-versions/{vid}",
                                     "模型版本", 2, 0.2)
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 按版本 ID 获取失败: {e}")
        return None
    if not isinstance(data, dict):
        return None
    if include_model and data.get("modelId"):
        try:
            model = _civitai_json_request(f"https://{_civitai_host()}/api/v1/models/{data['modelId']}",
                                          "模型介绍", 2, 0.2)
            data["model"] = model if isinstance(model, dict) else {}
        except Exception:
            data["model"] = {}
    return data


def _atomic_write_lora_text(destination_path, content, before_replace=None):
    """只在完整写入后替换旧文件，临时文件留在目标目录内。"""
    os.makedirs(os.path.dirname(destination_path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".magic-lora-", suffix=".tmp", dir=os.path.dirname(destination_path))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out_file:
            out_file.write(content)
        if before_replace:
            before_replace()
        os.replace(temp_path, destination_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

def download_file(url, destination_path, before_replace=None, strict=False):
    """下载文件，如果是视频则提取第一帧"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    temp_path = None
    video_path = None
    cap = None
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status == 200:
                content_type = response.getheader('Content-Type', '')
                url_path = urllib.parse.urlparse(url).path.lower()
                is_video = content_type.startswith('video/') or url_path.endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm'))
                if is_video and not CV2_AVAILABLE:
                    raise _MetadataSourceError("来源预览是视频，当前环境无法提取预览帧", "unsupported")
                os.makedirs(os.path.dirname(destination_path), exist_ok=True)
                fd, temp_path = tempfile.mkstemp(
                    prefix=".magic-lora-", suffix=os.path.splitext(destination_path)[1], dir=os.path.dirname(destination_path)
                )
                os.close(fd)
                if is_video:
                    fd, video_path = tempfile.mkstemp(prefix=".magic-lora-", suffix=".mp4", dir=os.path.dirname(destination_path))
                    os.close(fd)
                    with open(video_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    cap = cv2.VideoCapture(video_path)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if not ret or not cv2.imwrite(temp_path, frame):
                            return False
                    else:
                        return False
                else:
                    with open(temp_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    # Civitai 有时返回无后缀图像；也避免把错误页保存成预览。
                    with Image.open(temp_path) as source:
                        source.load()
                        source_format = source.format
                        preview = source.copy()
                    output_format = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP'}.get(
                        os.path.splitext(destination_path)[1].lower()
                    )
                    if output_format and source_format != output_format:
                        if output_format == 'JPEG':
                            preview = preview.convert('RGB')
                        preview.save(temp_path, format=output_format)
                if before_replace:
                    before_replace()
                os.replace(temp_path, destination_path)
                return True
            raise _CivitaiRequestError(f"预览下载失败（HTTP {response.status}）", response.status, response.getheader("Retry-After"))
    except urllib.error.HTTPError as e:
        if strict:
            raise _CivitaiRequestError(f"预览下载失败（HTTP {e.code}）", e.code,
                                       e.headers.get("Retry-After") if e.headers else None) from e
        print(f"下载文件时出错（HTTP {e.code}）")
    except Exception as e:
        if strict:
            raise
        print(f"下载文件时出错 {url}: {e}")
    finally:
        if cap is not None:
            cap.release()
        for path in (temp_path, video_path):
            if path and os.path.exists(path):
                os.remove(path)
    return False

def extract_lora_weight_from_civitai_data(civitai_data, lora_filename):
    """Prefer exact source identity; an exact filename is a conservative fallback."""
    lora_basename = os.path.splitext(os.path.basename(lora_filename))[0].strip().casefold()
    target_id = _normalize_civitai_version_id(civitai_data.get("id"))
    target_hash = str(civitai_data.get("_source_sha256") or "").casefold()
    exact = []
    named = []
    for image in civitai_data.get("images") or []:
        if not isinstance(image, dict):
            continue
        meta = image.get("meta") or {}
        if not isinstance(meta, dict):
            continue
        resources = []
        for key in ("civitaiResources", "resources", "additionalResources"):
            if isinstance(meta.get(key), list):
                resources.extend(meta[key])
        for resource in resources:
            if not isinstance(resource, dict) or str(resource.get("type", "lora")).casefold() not in ("lora", "locon"):
                continue
            try:
                weight = resource.get("weight")
                if weight is None or isinstance(weight, bool):
                    continue
                weight = float(weight)
                if not math.isfinite(weight):
                    continue
            except (ValueError, TypeError, OverflowError):
                continue
            version_id = next((_normalize_civitai_version_id(resource[key]) for key in ("modelVersionId", "versionId")
                               if key in resource), None)
            resource_hash = resource.get("hash")
            if not resource_hash and isinstance(resource.get("hashes"), dict):
                resource_hash = resource["hashes"].get("SHA256") or resource["hashes"].get("AutoV2")
            if not resource_hash and isinstance(meta.get("hashes"), dict):
                resource_hash = meta["hashes"].get(f"lora:{resource.get('name', '')}")
            resource_hash = str(resource_hash or "").casefold()
            if version_id is not None:
                if version_id == target_id:
                    exact.append(weight)
                continue
            if resource_hash:
                if target_hash and len(resource_hash) >= 10 and target_hash.startswith(resource_hash):
                    exact.append(weight)
                continue
            resource_name = os.path.splitext(str(resource.get("name") or ""))[0].strip().casefold()
            if resource_name and resource_name == lora_basename:
                named.append(weight)
    return exact[0] if exact else (named[0] if named else None)


def _metadata_source_content(data, kind, lora_filename):
    """Return content/key, or a confirmed reason. Missing/malformed keys are errors."""
    if kind == "txt":
        words = data.get("trainedWords")
        if not isinstance(words, list) or any(not isinstance(word, str) for word in words):
            raise _MetadataSourceError("来源触发词字段缺失或格式异常")
        content = ", ".join(word.strip() for word in words if word.strip())
        return (content, "triggerWords", "present", "") if content else (None, None, "unavailable", "来源未提供触发词")
    if kind == "json":
        if data.get("_model_error"):
            raise _MetadataSourceError(data["_model_error"])
        model = data.get("model")
        if not isinstance(model, dict):
            raise _MetadataSourceError("来源模型介绍字段缺失或格式异常")
        for value in (model.get("description"), data.get("description"), data.get("baseModel")):
            if value is not None and not isinstance(value, str):
                raise _MetadataSourceError("来源介绍信息格式异常")
        model_desc = clean_html(model.get("description") or "")
        version_desc = clean_html(data.get("description") or "")
        base_model = (data.get("baseModel") or "").strip()
        if base_model.casefold() in ("n/a", "na", "unknown", "none", "null"):
            base_model = ""
        if not model_desc and not version_desc and not base_model:
            if "description" not in model or "description" not in data or "baseModel" not in data:
                raise _MetadataSourceError("来源介绍信息字段缺失，尚不能确认没有介绍")
            return None, None, "unavailable", "来源未提供介绍或基础模型信息"
        sections = []
        if base_model:
            sections.append(f"--- 基础信息 ---\n基础模型: {base_model}")
        model_id, version_id = data.get("modelId"), data.get("id")
        if model_id and version_id:
            sections.append(f"C站链接: https://civitai.com/models/{model_id}?modelVersionId={version_id}")
        if model_desc:
            sections.append(f"--- 模型介绍 ---\n\n{model_desc}")
        if version_desc:
            sections.append(f"--- 版本信息 ---\n\n{version_desc}")
        return "\n\n".join(sections) + "\n", "jsonInfo", "present", ""
    images = data.get("images")
    if not isinstance(images, list) or any(not isinstance(image, dict) for image in images):
        raise _MetadataSourceError("来源预览字段缺失或格式异常")
    if kind == "log":
        for image in images:
            meta = image.get("meta")
            if meta is not None and not isinstance(meta, dict):
                raise _MetadataSourceError("来源权重元数据格式异常")
            for key in ("civitaiResources", "resources", "additionalResources"):
                resources = (meta or {}).get(key)
                if resources is not None and (not isinstance(resources, list) or any(not isinstance(r, dict) for r in resources)):
                    raise _MetadataSourceError("来源资源权重字段格式异常")
        weight = extract_lora_weight_from_civitai_data(data, lora_filename)
        if weight is None:
            return None, None, "unresolved", "未提取到能够确认属于此版本的推荐权重"
        return json.dumps({"description": "", "sd version": "", "activation text": "",
                           "preferred weight": weight, "negative text": "", "notes": ""},
                          ensure_ascii=False, indent=2, allow_nan=False), "logInfo", "present", ""
    if not images:
        return None, None, "unavailable", "来源未提供预览图像"
    videos = []
    for image in images:
        url = image.get("url")
        if not isinstance(url, str) or not url.strip():
            continue
        if urllib.parse.urlparse(url).scheme.lower() not in ("https", "http"):
            continue
        is_video = str(image.get("type", "")).lower() == "video" or urllib.parse.urlparse(url).path.lower().endswith(
            (".mp4", ".avi", ".mov", ".mkv", ".webm"))
        if not is_video:
            return url, None, "present", ""
        videos.append(url)
    if videos:
        if CV2_AVAILABLE:
            return videos[0], None, "present", ""
        return None, None, "unsupported", "来源只有视频预览，当前环境无法提取预览帧"
    raise _MetadataSourceError("来源预览条目没有有效的下载地址")


def _metadata_path_signature(path):
    if not path:
        return None
    try:
        info = os.stat(path)
        return (os.path.normcase(os.path.realpath(path)), info.st_size, info.st_mtime_ns)
    except FileNotFoundError:
        return None


def _merge_metadata_facts(facts, outcomes):
    merged = {kind: dict(fact) for kind, fact in facts.items()}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for kind, outcome in outcomes.items():
        if outcome["state"] == "error" and merged.get(kind, {}).get("state") in (
                "present", "unavailable", "not_found", "unresolved", "unsupported"):
            merged[kind]["last_error"] = outcome.get("reason", "")
            continue
        if outcome["state"] in ("present", "unavailable", "not_found", "unresolved", "unsupported", "error"):
            merged[kind] = {**outcome, "checked_at": now if outcome["state"] != "error" else None}
    return merged

def _civitai_title(data):
    model = data.get("model") if isinstance(data, dict) and isinstance(data.get("model"), dict) else {}
    return str(model.get("name") or "").strip()


def _sync_lm_sidecar(lora_path, *, civitai=None, sha256=None,
                     trigger_words=None, preview=None, title=None):
    """把爬取/本地信息同步成 Lora-Manager 可读的 sidecar + 同目录预览图。"""
    try:
        path = lm_sidecar.write(
            lora_path, title=title, trigger_words=trigger_words,
            preview=preview, civitai=civitai, sha256=sha256,
        )
        _LM_META_CACHE.pop(path, None)
        return True
    except Exception as e:
        print(f"⚠️ [MagicPowerLora] 同步 Lora-Manager 信息失败: {e}")
        return False


def _fetch_lora_metadata(lora_name, options, save_path_mode, overwrite=True, update_existing=False, force_refresh=False):
    """Per-model serialization; database transactions never enclose network requests."""
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path:
        return {"status": "error", "message": f"LoRA文件未找到: {lora_name}", "data": {},
                "saved": [], "unchanged": [], "unavailable": [], "failed": [], "_http_status": 404,
                "field_states": {kind: field_state("local_error", reason="LoRA 文件未找到") for kind in _METADATA_KINDS}}
    with model_lock(lora_path):
        return _fetch_lora_metadata_locked(lora_path, options, save_path_mode, overwrite, update_existing, force_refresh)


def _fetch_lora_metadata_locked(lora_path, options, save_path_mode, overwrite, update_existing, force_refresh):
    result = {"status": "success", "message": "", "data": {},
              "saved": [], "unchanged": [], "unavailable": [], "failed": []}
    labels = {"txt": "触发词", "json": "介绍信息", "image": "预览图像", "log": "推荐权重"}
    selected = [kind for kind in labels if options.get(f"download_{kind}", True)]
    force_refresh = force_refresh or overwrite or update_existing
    store = _get_lora_state_store()
    facts, outcomes, local_reviews, sha256 = {}, {}, {}, None
    messages = []

    def warn_record(error):
        result["record_warning"] = f"检查记录未能读取或保存，后续可能需要重新检查: {error}"

    try:
        identity = file_identity(lora_path)
        initial_paths = _get_lora_metadata_paths(lora_path)
        initial_signatures = {kind: _metadata_path_signature(path) for kind, path in initial_paths.items()}
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        save_dir = os.path.join(lora_dir, "magicloradate") if save_path_mode == "subfolder" else lora_dir
        destination_signatures = {}
        for kind in labels:
            suffixes = _LORA_PREVIEW_SUFFIXES if kind == "image" else (f".{kind}",)
            for suffix in suffixes:
                destination = os.path.join(save_dir, lora_basename + suffix)
                try:
                    destination_signatures[destination] = _metadata_path_signature(destination)
                except OSError as e:
                    destination_signatures[destination] = e
    except OSError as e:
        result.update(status="error", message=f"本地文件读取失败: {e}", failed=selected,
                      field_states={kind: field_state("local_error", reason=str(e)) for kind in labels})
        return result
    try:
        cached = store.read_inventory([identity]).get(identity["path"], {})
        sha256, facts = cached.get("sha256"), cached.get("fields", {})
        local_reviews = cached.get("local_reviews", {})
    except Exception as e:
        warn_record(e)
    states = _metadata_field_states(initial_paths, facts, local_reviews)
    lm_kinds = _lm_provided_kinds(lora_path)
    pending = []
    for kind in selected:
        if not overwrite and (initial_paths[kind] or lm_kinds.get(kind) or states[kind]["state"] in ("invalid", "local_error")):
            result["unchanged"].append(kind)
        elif not force_refresh and states[kind]["state"] == "user_skipped":
            result["unchanged"].append(kind)
        elif not force_refresh and states[kind]["state"] in _METADATA_SKIP_STATES:
            result["unavailable"].append(kind)
        else:
            pending.append(kind)
    if not pending:
        message = "所选信息已保留或已有来源检查结果，无需重复处理" if selected else "未选择需要检查的信息"
        if selected and all(states[kind]["state"] == "user_skipped" for kind in selected):
            message = "已按人工整理标记跳过所选字段"
        if lm_kinds.get("txt"):
            words = lm_sidecar.trigger_words(_lm_meta(lora_path))
            if words:
                result["data"]["triggerWords"] = words
        _META_INVENTORY_CACHE.clear()
        result.update(status="skipped", message=message, field_states=_apply_lm_field_states(lora_path, states))
        return result

    def finish():
        nonlocal facts
        try:
            if not identity_matches(identity, file_identity(lora_path)):
                raise _LocalChangedError("检查期间 LoRA 文件已变化，未保存本次检查记录")
            if sha256:
                try:
                    store.record(identity, sha256, outcomes,
                                 model_id=civitai_data.get("modelId") if civitai_data else None,
                                 version_id=civitai_data.get("id") if civitai_data else None)
                    for kind, outcome in outcomes.items():
                        if outcome["state"] in ("present", "unavailable", "not_found", "unresolved", "unsupported"):
                            local_reviews.pop(kind, None)
                except Exception as e:
                    warn_record(e)
            facts = _merge_metadata_facts(facts, outcomes)
            result["field_states"] = _apply_lm_field_states(
                lora_path, _metadata_field_states(_get_lora_metadata_paths(lora_path), facts, local_reviews))
        except (OSError, _LocalChangedError) as e:
            result["field_states"] = {kind: field_state("local_error", reason=str(e)) for kind in labels}
            result["record_warning"] = str(e)
        lm_words = lm_sidecar.trigger_words(_lm_meta(lora_path))
        if lm_words and "triggerWords" not in result.get("data", {}):
            result.setdefault("data", {})["triggerWords"] = lm_words
        _META_INVENTORY_CACHE.clear()
        return result

    civitai_data = None
    try:
        if not sha256:
            sha256 = _cached_sha256(lora_path)
        if not sha256:
            sha256 = calculate_sha256(lora_path)
            if not identity_matches(identity, file_identity(lora_path)):
                raise _LocalChangedError("计算哈希期间 LoRA 文件已变化，请重新检查")
            try:
                facts = store.read_hash(sha256)
            except Exception as e:
                warn_record(e)
            if not force_refresh:
                remaining = []
                for kind in pending:
                    if facts.get(kind, {}).get("state") in _METADATA_SKIP_STATES:
                        result["unavailable"].append(kind)
                    else:
                        remaining.append(kind)
                pending = remaining
                if not pending:
                    result.update(status="skipped", message="已复用相同模型的来源检查记录，无需重复获取")
                    return finish()
        civitai_data = fetch_civitai_data_by_hash(sha256, strict=True, include_model=True)
        if civitai_data is None:
            row = _lm_db_row(lora_path) or {}
            civitai_data = _fetch_civitai_by_version(row.get("civitai_id"), include_model=True)
        if civitai_data is not None and not isinstance(civitai_data, dict):
            raise _MetadataSourceError("来源模型版本响应格式异常")
        if civitai_data is not None and (((_normalize_civitai_version_id(civitai_data.get("id")) or 0) <= 0)
                or ((_normalize_civitai_version_id(civitai_data.get("modelId")) or 0) <= 0)):
            raise _MetadataSourceError("来源模型版本身份缺失，尚不能确认信息为空")
    except Exception as e:
        if isinstance(e, _LocalChangedError):
            result.update(status="error", message=str(e), failed=pending,
                          field_states={kind: field_state("local_error", reason=str(e)) for kind in labels})
            return result
        outcomes.update({kind: {"state": "error", "reason": str(e)} for kind in pending})
        result.update(status="error", message=str(e), failed=pending)
        if getattr(e, "stop_queue", False):
            result.update(stop_queue=True, retry_after=getattr(e, "retry_after", None))
        return finish()
    if civitai_data is None:
        reason = "当前来源未找到此 LoRA，可稍后重查或手动补充"
        outcomes.update({kind: {"state": "not_found", "reason": reason} for kind in pending})
        result.update(status="not_found", message=reason, unavailable=result["unavailable"] + pending)
        return finish()

    civitai_data["_source_sha256"] = sha256
    if civitai_data.get("_stop_queue"):
        result.update(stop_queue=True, retry_after=civitai_data.get("_retry_after"))
    def guard_destination(kind, destination):
        if not identity_matches(identity, file_identity(lora_path)):
            raise _LocalChangedError("检查期间 LoRA 文件已变化，已停止保存")
        current_paths = _get_lora_metadata_paths(lora_path)
        if current_paths[kind] != initial_paths[kind] or _metadata_path_signature(current_paths[kind]) != initial_signatures[kind]:
            raise _LocalChangedError(f"检查期间{labels[kind]}被修改，已保留本地内容")
        if not overwrite and current_paths[kind]:
            raise _LocalChangedError(f"已保留现有{labels[kind]}")
        expected = initial_signatures[kind] if destination == initial_paths[kind] else destination_signatures.get(destination)
        if isinstance(expected, OSError):
            raise expected
        if _metadata_path_signature(destination) != expected:
            raise _LocalChangedError(f"检查期间{labels[kind]}目标文件被修改，已保留本地内容")

    saved_txt = None
    saved_image = None
    for kind in pending:
        try:
            content, data_key, source_state, reason = _metadata_source_content(civitai_data, kind, os.path.basename(lora_path))
            if source_state != "present":
                outcomes[kind] = {"state": source_state, "reason": reason}
                result["unavailable"].append(kind)
                messages.append(reason)
                continue
            if kind == "image":
                suffix = os.path.splitext(urllib.parse.urlparse(content).path)[1].lower()
                if suffix not in (".png", ".jpg", ".jpeg", ".webp"):
                    suffix = ".jpg"
                destination = os.path.join(save_dir, lora_basename + suffix)
                if update_existing and initial_paths[kind]:
                    destination = initial_paths[kind]
                elif overwrite:
                    destination = next((os.path.join(save_dir, lora_basename + suffix) for suffix in _LORA_PREVIEW_SUFFIXES
                                        if destination_signatures.get(os.path.join(save_dir, lora_basename + suffix)) is not None),
                                       destination)
                guard_destination(kind, destination)
                if not download_file(content, destination, before_replace=lambda: guard_destination(kind, destination), strict=True):
                    raise _MetadataSourceError("预览下载失败或图像不可用")
                saved_image = destination
            else:
                destination = initial_paths[kind] if update_existing and initial_paths[kind] else os.path.join(save_dir, f"{lora_basename}.{kind}")
                guard_destination(kind, destination)
                _atomic_write_lora_text(destination, content, before_replace=lambda: guard_destination(kind, destination))
                result["data"][data_key] = content
                if kind == "txt":
                    saved_txt = content
            outcomes[kind] = {"state": "present", "reason": "来源信息已成功保存"}
            result["saved"].append(kind)
            messages.append(f"{labels[kind]}已保存")
        except _LocalChangedError as e:
            result["unchanged"].append(kind)
            messages.append(str(e))
        except Exception as e:
            state = getattr(e, "state", "error")
            outcomes[kind] = {"state": state, "reason": str(e)}
            if state == "unsupported":
                result["unavailable"].append(kind)
            else:
                result["failed"].append(kind)
            messages.append(f"{labels[kind]}处理失败: {e}")
            if getattr(e, "stop_queue", False):
                result.update(stop_queue=True, retry_after=getattr(e, "retry_after", None))
    _sync_lm_sidecar(
        lora_path, civitai=civitai_data, sha256=sha256,
        title=_civitai_title(civitai_data) or lm_sidecar.title(_lm_meta(lora_path)) or None,
        trigger_words=civitai_data.get("trainedWords") if isinstance(civitai_data.get("trainedWords"), list) else saved_txt,
        preview=saved_image or initial_paths.get("image"),
    )
    if result["failed"]:
        result["status"] = "partial" if result["saved"] else "error"
    elif not result["saved"]:
        result["status"] = "skipped"
        if outcomes and all(outcome["state"] == "unavailable" for outcome in outcomes.values()):
            messages.insert(0, "检查完成，来源未提供所选信息")
        else:
            messages.insert(0, "检查完成，已保留本地信息或确认暂无可补充内容")
    result["message"] = "\n".join(messages)
    return finish()

@PromptServer.instance.routes.post("/ma/lora/fetch_metadata")
async def fetch_metadata(request):
    """爬取LoRA元数据；哈希、网络与文件写入均不阻塞事件循环。"""
    try:
        data = await request.json()
        if not isinstance(data, dict) or not isinstance(data.get("lora_name"), str) or not data["lora_name"].strip():
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        options = data.get("options", {})
        save_path_mode = data.get("save_path_mode", "same_dir")
        overwrite = data.get("overwrite", True)
        update_existing = data.get("update_existing", False)
        force_refresh = data.get("force_refresh", False)
        if (not isinstance(options, dict) or save_path_mode not in ("same_dir", "subfolder")
                or not isinstance(overwrite, bool) or not isinstance(update_existing, bool) or not isinstance(force_refresh, bool)
                or any(not isinstance(options.get(f"download_{kind}", True), bool) for kind in _METADATA_KINDS)):
            return web.json_response({"status": "error", "message": "下载选项、保存位置或覆盖选项无效"}, status=400)
        result = await _run_blocking(_fetch_lora_metadata, data["lora_name"], options, save_path_mode, overwrite, update_existing, force_refresh)
        http_status = result.pop("_http_status", 200)
        return web.json_response(result, status=http_status)
    except (ValueError, TypeError) as e:
        return web.json_response({"status": "error", "message": f"请求参数无效: {e}"}, status=400)
    except Exception as e:
        print(f"爬取元数据时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)


def _review_lora_metadata_local(lora_names, types, reviewed=True):
    """Explicit user policy: resolve names and stat models, without opening any content."""
    if (not isinstance(lora_names, list) or not lora_names
            or any(not isinstance(name, str) or not name.strip() for name in lora_names)
            or not isinstance(types, list) or not types
            or any(not isinstance(kind, str) or kind not in _METADATA_KINDS for kind in types)
            or not isinstance(reviewed, bool)):
        raise ValueError("请提供有效的 LoRA 名称列表、信息类型和整理选项")
    types = list(dict.fromkeys(types))
    names = list(dict.fromkeys(lora_names))
    valid, errors = [], []
    for name in names:
        try:
            path = folder_paths.get_full_path("loras", name)
            if not path:
                raise FileNotFoundError("LoRA 文件未找到或目录不可访问")
            valid.append((name, file_identity(path)))
        except Exception as e:
            errors.append({"name": name, "error": str(e)})
    updated = []
    reviewed_at = None
    if valid:
        try:
            reviewed_at = _get_lora_state_store().review_local([identity for _, identity in valid], types, reviewed)
            updated = [name for name, _ in valid]
        except Exception as e:
            errors.extend({"name": name, "error": f"人工整理记录保存失败: {e}"} for name, _ in valid)
    status = "partial" if updated and errors else ("error" if errors else "success")
    action = "已离线标记整理完成" if reviewed else "已取消人工整理标记"
    message = f"{action}: {len(updated)} 个 LoRA"
    if errors:
        message += f"；{len(errors)} 个失败"
    return {"status": status, "updated": updated, "errors": errors, "message": message,
            "reviewed": reviewed, "types": types, "reviewed_at": reviewed_at}


@PromptServer.instance.routes.post("/ma/lora/local_metadata_review")
async def review_lora_metadata_local(request):
    """Manual offline adoption/restoration; no hashing, network or sidecar I/O."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("请求内容必须是对象")
        result = await _run_blocking(_review_lora_metadata_local, data.get("lora_names"), data.get("types"), data.get("reviewed"))
        return web.json_response(result)
    except (ValueError, TypeError) as e:
        return web.json_response({"status": "error", "updated": [], "errors": [], "message": str(e)}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "updated": [], "errors": [], "message": f"人工整理失败: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/probe_save_targets")
async def probe_save_targets(request):
    """探测指定LoRA的保存位置可用性（优先检查magicloradate子目录）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        magicloradate_dir_exists = os.path.isdir(magicloradate_dir)
        
        def check_file(path):
            return os.path.exists(path) and os.access(path, os.R_OK)
        
        same_txt = os.path.join(lora_dir, f"{lora_basename}.txt")
        same_json = os.path.join(lora_dir, f"{lora_basename}.json")
        same_log = os.path.join(lora_dir, f"{lora_basename}.log")
        
        magic_txt = os.path.join(magicloradate_dir, f"{lora_basename}.txt")
        magic_json = os.path.join(magicloradate_dir, f"{lora_basename}.json")
        magic_log = os.path.join(magicloradate_dir, f"{lora_basename}.log")
        
        same_files = {
            "txt": check_file(same_txt),
            "json": check_file(same_json),
            "log": check_file(same_log),
        }
        magic_files = {
            "txt": check_file(magic_txt),
            "json": check_file(magic_json),
            "log": check_file(magic_log),
        }
        
        result = {
            "status": "success",
            "magicloradate_dir_exists": magicloradate_dir_exists,
            "magicloradate_files": magic_files,
            "same_files": same_files,
            "magicloradate_has_readable": any(magic_files.values()),
            "same_has_readable": any(same_files.values()),
        }
        
        return web.json_response(result)
        
    except Exception as e:
        print(f"探测保存位置时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/save_lora_file")
async def save_lora_file(request):
    """保存指定LoRA文件的内容（支持保存到magicloradate子目录或同层级）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        content = data.get("content", "")
        target = str(data.get("target", "same")).lower()
        target = "magicloradate" if target == "magicloradate" or target == "subfolder" else "same"
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        if target == "magicloradate":
            file_path = os.path.join(lora_dir, "magicloradate", f"{lora_basename}{file_ext}")
        else:
            file_path = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        # 自动创建目录（如果不存在）
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

        # 同步到 Lora-Manager sidecar，让那边也能读到手动编辑的触发词
        if file_type == "txt":
            try:
                lm_sidecar.write(lora_path, trigger_words=content,
                                 title=lm_sidecar.title(_lm_meta(lora_path)) or None)
                _LM_META_CACHE.pop(lm_sidecar.sidecar_path(lora_path), None)
            except Exception as e:
                print(f"⚠️ [MagicPowerLora] 同步 Lora-Manager 触发词失败: {e}")
        _META_INVENTORY_CACHE.clear()

        return web.json_response({"status": "success", "message": f"{file_type}文件保存成功"})
        
    except Exception as e:
        print(f"保存LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/get_lora_file")
async def get_lora_file(request):
    """获取指定LoRA文件的内容（优先从magicloradate子目录读取）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        # 优先从magicloradate子目录读取，若无则从同层级读取
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        file_path_magic = os.path.join(magicloradate_dir, f"{lora_basename}{file_ext}")
        file_path_same = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        target_file = None
        if os.path.exists(file_path_magic):
            target_file = file_path_magic
        elif os.path.exists(file_path_same):
            target_file = file_path_same
        else:
            # 额外来源：若本地 .txt 不存在，优先读取 Lora-Manager 的 sidecar（civitai.trainedWords）
            if file_type == "txt":
                lm_words = lm_sidecar.trigger_words(_lm_meta(lora_path))
                if lm_words:
                    return web.json_response({"status": "success", "content": lm_words, "source": "lora_manager"})
            # 如果文件不存在，返回空内容
            return web.json_response({"status": "success", "content": ""})
        
        with open(target_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return web.json_response({"status": "success", "content": content})
        
    except Exception as e:
        print(f"读取LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/delete_lora_complete")
async def delete_lora_complete(request):
    """一键删除LoRA文件及其所有相关文件"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        deleted_files = []
        
        # 删除主LoRA文件
        try:
            os.remove(lora_path)
            deleted_files.append(os.path.basename(lora_path))
        except Exception as e:
            return web.json_response({"status": "error", "message": f"无法删除主LoRA文件: {e}"}, status=500)
        
        # 删除同目录下的相关文件
        for ext in ['.txt', '.json', '.log', '.png', '.jpg', '.jpeg', '.webp']:
            file_path = os.path.join(lora_dir, f"{lora_basename}{ext}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
        
        # 删除magicloradate子文件夹中的文件
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        if os.path.exists(magicloradate_dir):
            import glob
            pattern = os.path.join(magicloradate_dir, f"{lora_basename}.*")
            for file_path in glob.glob(pattern):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
            
            # 如果magicloradate目录为空，删除它
            if os.path.exists(magicloradate_dir) and not os.listdir(magicloradate_dir):
                try:
                    os.rmdir(magicloradate_dir)
                except Exception as e:
                    print(f"删除空目录时出错: {e}")
        
        return web.json_response({
            "status": "success",
            "message": f"成功删除 {len(deleted_files)} 个文件",
            "deleted_files": deleted_files
        })
        
    except Exception as e:
        print(f"删除LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)
