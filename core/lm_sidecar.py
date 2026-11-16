# -*- coding: utf-8 -*-
"""读写 ComfyUI-LoRA-Manager 的 <模型名>.metadata.json，让两边信息互通。

LM 的约定：sidecar 与 LoRA 同目录，预览图为同目录 <模型名>.<ext>，
模型页标题在 model_name / civitai.model.name，备注在 notes，
触发词在 civitai.trainedWords（字符串数组）。
"""

import json
import os
import re
import tempfile

PREVIEW_EXTS = (
    ".png", ".jpg", ".jpeg", ".webp", ".preview.png", ".preview.jpg",
    ".cover.png", ".cover.jpg",
)


def sidecar_path(lora_path):
    stem = os.path.splitext(os.path.basename(lora_path))[0]
    return os.path.join(os.path.dirname(lora_path), stem + ".metadata.json")


def read(lora_path):
    try:
        with open(sidecar_path(lora_path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, UnicodeError):
        return None


def _civitai(meta):
    value = (meta or {}).get("civitai")
    return value if isinstance(value, dict) else {}


def trigger_words(meta):
    cv = _civitai(meta)
    words = cv.get("trainedWords")
    if words is None:
        words = (meta or {}).get("trainedWords")
    if isinstance(words, list):
        return ", ".join(str(w).strip() for w in words if str(w).strip())
    if isinstance(words, str):
        return words.strip()
    return ""


def title(meta):
    cv = _civitai(meta)
    model = cv.get("model")
    value = (meta or {}).get("model_name")
    if not value and isinstance(model, dict):
        value = model.get("name")
    return str(value or "").strip()


def notes(meta):
    return str((meta or {}).get("notes") or "").strip()


def preview_path(lora_path, meta=None):
    """LM 的预览：优先 sidecar.preview_url 指向的本地文件，其次同目录 <名>.<ext>。"""
    if meta is None:
        meta = read(lora_path)
    raw = (meta or {}).get("preview_url")
    if isinstance(raw, str) and raw.strip():
        candidate = raw.strip()
        low = candidate.lower()
        if not low.startswith(("http://", "https://", "data:")):
            if not os.path.isabs(candidate):
                candidate = os.path.join(os.path.dirname(lora_path), candidate)
            candidate = candidate.replace("/", os.sep).replace("\\", os.sep)
            if os.path.isfile(candidate):
                return candidate
    stem = os.path.splitext(lora_path)[0]
    for ext in PREVIEW_EXTS:
        if os.path.isfile(stem + ext):
            return stem + ext
    return None


def info(lora_path):
    meta = read(lora_path)
    if not meta:
        return {}
    cv = _civitai(meta)
    return {
        "title": title(meta),
        "notes": notes(meta),
        "trigger_words": trigger_words(meta),
        "preview": preview_path(lora_path, meta) or "",
        "base_model": str(meta.get("base_model") or cv.get("baseModel") or "").strip(),
        "civitai_id": cv.get("id"),
        "model_id": cv.get("modelId"),
    }


def write(lora_path, *, title=None, trigger_words=None, preview=None,
          notes=None, civitai=None, sha256=None):
    """合并式写入，保留 LM 侧已有的未知字段；原子替换避免写坏。"""
    path = sidecar_path(lora_path)
    data = read(lora_path) or {}
    stem = os.path.splitext(os.path.basename(lora_path))[0]
    data["file_name"] = stem
    data["file_path"] = lora_path.replace("\\", "/")
    try:
        data["size"] = os.path.getsize(lora_path)
        data["modified"] = os.path.getmtime(lora_path)
    except OSError:
        pass
    if sha256:
        data["sha256"] = sha256
    if title:
        data["model_name"] = title
    if notes is not None:
        data["notes"] = notes
    if preview:
        data["preview_url"] = preview.replace("\\", "/")

    if civitai is not None:
        cv = _civitai(data)
        cv.update({k: v for k, v in civitai.items() if not str(k).startswith("_")})
        model = cv.get("model")
        if isinstance(model, dict):
            if title:
                model["name"] = title
            if model.get("tags"):
                data["tags"] = model["tags"]
            if model.get("description"):
                data["modelDescription"] = model["description"]
        if cv.get("baseModel"):
            data["base_model"] = cv["baseModel"]
        data["civitai"] = cv
        data["from_civitai"] = True
        data.setdefault("preview_nsfw_level", 0)

    if trigger_words is not None:
        if isinstance(trigger_words, (list, tuple)):
            words = [str(w).strip() for w in trigger_words if str(w).strip()]
        else:
            words = [w.strip() for w in re.split(r"[,，\n;；]", str(trigger_words)) if w.strip()]
        cv = _civitai(data)
        cv["trainedWords"] = words
        if title:
            model = cv.get("model")
            if not isinstance(model, dict):
                model = {}
            model["name"] = title
            cv["model"] = model
        data["civitai"] = cv
        data["trainedWords"] = words

    data.setdefault("notes", "")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".lm-meta-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    return path
