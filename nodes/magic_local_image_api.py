"""Local Image Studio API routes for MagicPhotopeaNode.

Provides:
- POST /ma/local_studio/basic           : Visual Crop / Rotate / Pad / Megapixel Resize & Canvas Resolution
- GET  /ma/local_studio/controlnet_list : Dynamically discover installed comfyui_controlnet_aux preprocessors
- POST /ma/local_studio/controlnet_run  : Execute a ControlNet preprocessor (or built-in Canny fallback)
"""

from __future__ import annotations

import asyncio
import base64
import io
import math
import os
import time
import traceback
from typing import Any

import numpy as np
import torch
from aiohttp import web
from PIL import Image, ImageColor, ImageEnhance, ImageFilter, ImageOps

import folder_paths
from server import PromptServer


MAX_DIMENSION = 16384
MAX_PADDING = 8192

_RESAMPLE_MAP = {
    "lanczos": Image.Resampling.LANCZOS,
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
    "area": Image.Resampling.BOX,
    "nearest": Image.Resampling.NEAREST,
    "nearest-exact": Image.Resampling.NEAREST,
}


# ---------------------------------------------------------------------------
# Helpers: Image loading / encoding / color / geometry
# ---------------------------------------------------------------------------

def _resolve_input_image_path(filename: str) -> str:
    if not filename or filename == "canvas_empty.png":
        raise FileNotFoundError("当前节点还没有选择有效图片，请先上传或选择一张图片。")

    try:
        path = folder_paths.get_annotated_filepath(filename)
        if path and os.path.isfile(path):
            return path
    except Exception:
        pass

    input_dir = folder_paths.get_input_directory()
    candidate = os.path.normpath(os.path.join(input_dir, filename))
    input_dir_norm = os.path.normpath(input_dir)
    if candidate.startswith(input_dir_norm) and os.path.isfile(candidate):
        return candidate

    raise FileNotFoundError(f"找不到图片文件: {filename}")


def _load_pil_source(filename: str | None = None, image_data_url: str | None = None) -> Image.Image:
    """Load source image either from an inline base64 data URL (chained step) or ComfyUI input file."""
    if image_data_url and isinstance(image_data_url, str) and image_data_url.startswith("data:image/"):
        _, b64 = image_data_url.split(",", 1)
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGBA")

    path = _resolve_input_image_path(filename or "")
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert("RGBA")


def _pil_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _parse_rgb_color(color_str: str | None, fallback: tuple[int, int, int] = (128, 128, 128)) -> tuple[int, int, int]:
    if not color_str:
        return fallback
    text = str(color_str).strip()
    try:
        rgb = ImageColor.getrgb(text)
        return int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return fallback


def _align_axis(size: int, pad_a: int, pad_b: int, multiple: int) -> tuple[int, int, int, int]:
    """Align (pad_a + size + pad_b) to a multiple, preserving AusBoss-style clean borders.

    Returns (pad_a, pad_b, trim_a, output_len).
    """
    m = max(1, int(multiple))
    total = pad_a + size + pad_b
    rem = total % m
    if m <= 1 or rem == 0:
        return pad_a, pad_b, 0, total

    if pad_a > 0 or pad_b > 0:
        extra = m - rem
        if pad_a > 0 and pad_b > 0:
            add_a = extra // 2
            add_b = extra - add_a
        elif pad_a > 0:
            add_a, add_b = extra, 0
        else:
            add_a, add_b = 0, extra
        return pad_a + add_a, pad_b + add_b, 0, total + extra

    # No padding on this axis: trim crop gently down to multiple (if big enough)
    if size > m:
        trim_a = rem // 2
        return 0, 0, trim_a, size - rem
    return 0, 0, 0, size


def _make_padded_background(
    core_rgb: Image.Image,
    out_w: int,
    out_h: int,
    paste_x: int,
    paste_y: int,
    fill_mode: str,
    fill_rgb: tuple[int, int, int],
) -> Image.Image:
    """Create an RGB background canvas for padding using solid/edge/mirror/blur."""
    mode = (fill_mode or "solid").strip().lower()
    if mode == "solid":
        return Image.new("RGB", (out_w, out_h), fill_rgb)

    if mode == "blur":
        bg = core_rgb.resize((max(1, out_w), max(1, out_h)), Image.Resampling.BILINEAR)
        radius = max(8, min(64, int(min(out_w, out_h) * 0.04)))
        return bg.filter(ImageFilter.GaussianBlur(radius=radius))

    # edge or mirror via numpy pad
    arr = np.asarray(core_rgb, dtype=np.uint8)
    pad_left = max(0, paste_x)
    pad_top = max(0, paste_y)
    pad_right = max(0, out_w - paste_x - core_rgb.width)
    pad_bottom = max(0, out_h - paste_y - core_rgb.height)

    if mode == "mirror":
        # numpy reflect fails when pad >= dim; fall back to symmetric/wrap iteratively or edge
        ch, cw = arr.shape[:2]
        if pad_left < cw and pad_right < cw and pad_top < ch and pad_bottom < ch and cw > 1 and ch > 1:
            padded = np.pad(arr, ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)), mode="reflect")
        else:
            padded = np.pad(arr, ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)), mode="symmetric")
        return Image.fromarray(padded[:out_h, :out_w], mode="RGB")

    # edge replicate
    padded = np.pad(arr, ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)), mode="edge")
    return Image.fromarray(padded[:out_h, :out_w], mode="RGB")


def _compute_mp_target(width: int, height: int, megapixels: float, step: int) -> tuple[int, int]:
    mp = max(0.05, min(32.0, float(megapixels)))
    s = max(1, min(256, int(step)))
    target_pixels = mp * 1_000_000.0
    scale = math.sqrt(target_pixels / max(1.0, float(width * height)))
    new_w = max(s, int(round((width * scale) / s)) * s)
    new_h = max(s, int(round((height * scale) / s)) * s)
    new_w = max(16, min(MAX_DIMENSION, new_w))
    new_h = max(16, min(MAX_DIMENSION, new_h))
    return new_w, new_h


def _run_crop_rotate_pad(img: Image.Image, payload: dict[str, Any]) -> dict[str, Any]:
    rotation = float(payload.get("rotation_degrees", 0.0) or 0.0)
    rotation = ((rotation + 180.0) % 360.0) - 180.0
    if abs(rotation) < 0.01:
        rotation = 0.0

    fill_mode = str(payload.get("fill_mode", "solid") or "solid").strip().lower()
    fill_rgb = _parse_rgb_color(payload.get("fill_color", "#808080"))
    feather = max(0, min(256, int(payload.get("feather", 0) or 0)))
    canvas_multiple = max(1, min(256, int(payload.get("canvas_multiple", 1) or 1)))

    # 1. Rotate
    rgba = img.convert("RGBA")
    if rotation != 0.0:
        rot_fill = (fill_rgb[0], fill_rgb[1], fill_rgb[2], 0)
        rotated = rgba.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=rot_fill)
    else:
        rotated = rgba.copy()

    rot_w, rot_h = rotated.size

    # 2. Crop box on rotated image
    crop_x = max(0, min(rot_w - 1, int(round(float(payload.get("crop_x", 0) or 0)))))
    crop_y = max(0, min(rot_h - 1, int(round(float(payload.get("crop_y", 0) or 0)))))
    raw_cw = int(round(float(payload.get("crop_width", 0) or 0)))
    raw_ch = int(round(float(payload.get("crop_height", 0) or 0)))
    avail_w = rot_w - crop_x
    avail_h = rot_h - crop_y
    crop_w = avail_w if raw_cw <= 0 else max(1, min(raw_cw, avail_w))
    crop_h = avail_h if raw_ch <= 0 else max(1, min(raw_ch, avail_h))

    # 3. Pad + multiple alignment
    pad_l = max(0, min(MAX_PADDING, int(round(float(payload.get("pad_left", 0) or 0)))))
    pad_t = max(0, min(MAX_PADDING, int(round(float(payload.get("pad_top", 0) or 0)))))
    pad_r = max(0, min(MAX_PADDING, int(round(float(payload.get("pad_right", 0) or 0)))))
    pad_b = max(0, min(MAX_PADDING, int(round(float(payload.get("pad_bottom", 0) or 0)))))

    pad_l, pad_r, trim_l, out_w = _align_axis(crop_w, pad_l, pad_r, canvas_multiple)
    pad_t, pad_b, trim_t, out_h = _align_axis(crop_h, pad_t, pad_b, canvas_multiple)

    crop_x += trim_l
    crop_y += trim_t
    crop_w = max(1, out_w - pad_l - pad_r)
    crop_h = max(1, out_h - pad_t - pad_b)

    if out_w > MAX_DIMENSION or out_h > MAX_DIMENSION:
        raise ValueError(f"输出尺寸过大 ({out_w}×{out_h})，超过上限 {MAX_DIMENSION}px。")

    cropped = rotated.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))

    # 4. Compose output
    if fill_mode == "transparent":
        canvas = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
        if feather > 0 and (pad_l or pad_t or pad_r or pad_b or rotation != 0.0):
            alpha = cropped.getchannel("A")
            # Shrink alpha inward slightly with blur for smooth feather
            mask_canvas = Image.new("L", (out_w, out_h), 0)
            mask_canvas.paste(alpha, (pad_l, pad_t))
            blurred = mask_canvas.filter(ImageFilter.GaussianBlur(radius=max(1, feather / 2.0)))
            m_arr = np.minimum(np.asarray(mask_canvas, dtype=np.uint8), np.asarray(blurred, dtype=np.uint8))
            fg = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
            fg.paste(cropped, (pad_l, pad_t))
            fg.putalpha(Image.fromarray(m_arr, mode="L"))
            canvas = fg
        else:
            canvas.paste(cropped, (pad_l, pad_t), cropped)
        output_img = canvas
    else:
        # Flatten cropped onto fill_rgb where rotation corners or source transparency exist
        flat_crop = Image.new("RGB", cropped.size, fill_rgb)
        flat_crop.paste(cropped.convert("RGB"), mask=cropped.getchannel("A"))

        bg = _make_padded_background(flat_crop, out_w, out_h, pad_l, pad_t, fill_mode, fill_rgb)
        if feather > 0 and (pad_l or pad_t or pad_r or pad_b or rotation != 0.0):
            # Soft transition between pasted core and padded background
            alpha_mask = Image.new("L", (out_w, out_h), 0)
            alpha_mask.paste(cropped.getchannel("A"), (pad_l, pad_t))
            blurred = alpha_mask.filter(ImageFilter.GaussianBlur(radius=max(1, feather / 2.0)))
            # Keep outer padded region 0, feather inward
            m_orig = np.asarray(alpha_mask, dtype=np.float32) / 255.0
            m_blur = np.asarray(blurred, dtype=np.float32) / 255.0
            blend = np.clip(np.minimum(m_orig, np.maximum(0.0, m_blur * 2.0 - 1.0)), 0.0, 1.0)
            fg_full = bg.copy()
            fg_full.paste(flat_crop, (pad_l, pad_t))
            out_arr = (
                np.asarray(fg_full, dtype=np.float32) * blend[..., None]
                + np.asarray(bg, dtype=np.float32) * (1.0 - blend[..., None])
            )
            output_img = Image.fromarray(np.clip(out_arr, 0, 255).astype(np.uint8), mode="RGB")
        else:
            bg.paste(flat_crop, (pad_l, pad_t))
            output_img = bg

    # 5. Optional resize to megapixel budget
    if bool(payload.get("resize_enabled", False)):
        mp = float(payload.get("megapixels", 1.0) or 1.0)
        step = int(payload.get("resolution_steps", 32) or 32)
        method = str(payload.get("resize_method", "lanczos") or "lanczos").lower()
        resample = _RESAMPLE_MAP.get(method, Image.Resampling.LANCZOS)
        new_w, new_h = _compute_mp_target(output_img.width, output_img.height, mp, step)
        if (new_w, new_h) != output_img.size:
            output_img = output_img.resize((new_w, new_h), resample)

    return {
        "image": _pil_to_data_url(output_img),
        "width": output_img.width,
        "height": output_img.height,
        "megapixels": round((output_img.width * output_img.height) / 1_000_000.0, 2),
    }


def _run_resolution_transform(img: Image.Image, payload: dict[str, Any]) -> dict[str, Any]:
    target_w = max(64, min(MAX_DIMENSION, int(round(float(payload.get("target_width", img.width) or img.width)))))
    target_h = max(64, min(MAX_DIMENSION, int(round(float(payload.get("target_height", img.height) or img.height)))))
    fit_mode = str(payload.get("fit_mode", "pad") or "pad").strip().lower()
    fill_mode = str(payload.get("fill_mode", "solid") or "solid").strip().lower()
    fill_rgb = _parse_rgb_color(payload.get("fill_color", "#808080"))
    method = str(payload.get("resize_method", "lanczos") or "lanczos").lower()
    resample = _RESAMPLE_MAP.get(method, Image.Resampling.LANCZOS)

    src_rgba = img.convert("RGBA")
    src_w, src_h = src_rgba.size

    if fit_mode == "stretch":
        if fill_mode == "transparent":
            out = src_rgba.resize((target_w, target_h), resample)
        else:
            flat = Image.new("RGB", src_rgba.size, fill_rgb)
            flat.paste(src_rgba.convert("RGB"), mask=src_rgba.getchannel("A"))
            out = flat.resize((target_w, target_h), resample)
    elif fit_mode == "crop":
        scale = max(target_w / max(1, src_w), target_h / max(1, src_h))
        rw = max(target_w, int(round(src_w * scale)))
        rh = max(target_h, int(round(src_h * scale)))
        resized = src_rgba.resize((rw, rh), resample)
        left = max(0, (rw - target_w) // 2)
        top = max(0, (rh - target_h) // 2)
        cropped = resized.crop((left, top, left + target_w, top + target_h))
        if fill_mode == "transparent":
            out = cropped
        else:
            out = Image.new("RGB", (target_w, target_h), fill_rgb)
            out.paste(cropped.convert("RGB"), mask=cropped.getchannel("A"))
    elif fit_mode == "contain":
        scale = min(target_w / max(1, src_w), target_h / max(1, src_h))
        rw = max(1, int(round(src_w * scale)))
        rh = max(1, int(round(src_h * scale)))
        if fill_mode == "transparent":
            out = src_rgba.resize((rw, rh), resample)
        else:
            flat = Image.new("RGB", src_rgba.size, fill_rgb)
            flat.paste(src_rgba.convert("RGB"), mask=src_rgba.getchannel("A"))
            out = flat.resize((rw, rh), resample)
    else:
        # "pad": keep aspect ratio, fit inside target box and pad remaining space
        scale = min(target_w / max(1, src_w), target_h / max(1, src_h))
        rw = max(1, min(target_w, int(round(src_w * scale))))
        rh = max(1, min(target_h, int(round(src_h * scale))))
        resized = src_rgba.resize((rw, rh), resample)
        px = (target_w - rw) // 2
        py = (target_h - rh) // 2
        if fill_mode == "transparent":
            out = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
            out.paste(resized, (px, py), resized)
        else:
            flat = Image.new("RGB", (rw, rh), fill_rgb)
            flat.paste(resized.convert("RGB"), mask=resized.getchannel("A"))
            bg = _make_padded_background(flat, target_w, target_h, px, py, fill_mode, fill_rgb)
            bg.paste(flat, (px, py))
            out = bg

    return {
        "image": _pil_to_data_url(out),
        "width": out.width,
        "height": out.height,
        "megapixels": round((out.width * out.height) / 1_000_000.0, 2),
    }


def _run_color_adjust(img: Image.Image, payload: dict[str, Any]) -> dict[str, Any]:
    """High-quality color grading, flip, invert, sharpen & blur filter."""
    rgba = img.convert("RGBA")

    if bool(payload.get("flip_h", False)):
        rgba = ImageOps.mirror(rgba)
    if bool(payload.get("flip_v", False)):
        rgba = ImageOps.flip(rgba)

    rgb = rgba.convert("RGB")
    alpha = rgba.getchannel("A")

    brightness = max(0.1, min(3.0, float(payload.get("brightness", 1.0) or 1.0)))
    contrast = max(0.1, min(3.0, float(payload.get("contrast", 1.0) or 1.0)))
    saturation = max(0.0, min(3.0, float(payload.get("saturation", 1.0) or 1.0)))
    hue_shift = float(payload.get("hue", 0.0) or 0.0)
    temperature = max(-100.0, min(100.0, float(payload.get("temperature", 0.0) or 0.0)))
    sharpness = max(0.0, min(4.0, float(payload.get("sharpness", 1.0) or 1.0)))
    blur = max(0.0, min(40.0, float(payload.get("blur", 0.0) or 0.0)))
    grayscale = bool(payload.get("grayscale", False))
    invert = bool(payload.get("invert", False))

    if abs(brightness - 1.0) > 1e-3:
        rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
    if abs(contrast - 1.0) > 1e-3:
        rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    if abs(saturation - 1.0) > 1e-3:
        rgb = ImageEnhance.Color(rgb).enhance(saturation)

    if abs(hue_shift) > 0.5:
        hsv = np.array(rgb.convert("HSV"), dtype=np.uint8)
        delta = int(round((hue_shift % 360.0) / 360.0 * 255.0))
        hsv[..., 0] = (hsv[..., 0].astype(np.int32) + delta) % 256
        rgb = Image.fromarray(hsv, mode="HSV").convert("RGB")

    if abs(temperature) > 0.5:
        arr = np.asarray(rgb, dtype=np.float32)
        t = temperature / 100.0
        arr[..., 0] = np.clip(arr[..., 0] + t * 28.0, 0, 255)
        arr[..., 2] = np.clip(arr[..., 2] - t * 28.0, 0, 255)
        rgb = Image.fromarray(arr.astype(np.uint8), mode="RGB")

    if grayscale:
        rgb = ImageOps.grayscale(rgb).convert("RGB")

    if invert:
        rgb = ImageOps.invert(rgb)

    if abs(sharpness - 1.0) > 1e-3:
        rgb = ImageEnhance.Sharpness(rgb).enhance(sharpness)

    if blur > 0.05:
        rgb = rgb.filter(ImageFilter.GaussianBlur(radius=blur))

    # Preserve transparency if source actually had transparent pixels
    a_arr = np.asarray(alpha, dtype=np.uint8)
    if int(a_arr.min()) < 255:
        r_ch, g_ch, b_ch = rgb.split()
        out = Image.merge("RGBA", (r_ch, g_ch, b_ch, alpha))
    else:
        out = rgb

    return {
        "image": _pil_to_data_url(out),
        "width": out.width,
        "height": out.height,
        "megapixels": round((out.width * out.height) / 1_000_000.0, 2),
    }


# ---------------------------------------------------------------------------
# ControlNet Aux Preprocessor Discovery & Execution
# ---------------------------------------------------------------------------

# Curated catalog of popular comfyui_controlnet_aux preprocessors with Chinese labels & grouping.
_CURATED_CONTROLNET_CATALOG: list[dict[str, str]] = [
    # Edge & Lineart
    {"id": "CannyEdgePreprocessor", "group": "edge", "zh": "Canny 边缘检测", "desc": "经典硬边缘线条提取，适合结构轮廓控制"},
    {"id": "LineArtPreprocessor", "group": "edge", "zh": "写实线稿 (LineArt)", "desc": "提取精细写实素描线稿"},
    {"id": "AnimeLineArtPreprocessor", "group": "edge", "zh": "动漫线稿 (Anime LineArt)", "desc": "专为二次元插画优化的干净线稿"},
    {"id": "AnyLineArtPreprocessor_aux", "group": "edge", "zh": "AnyLine 精细线稿", "desc": "高细节综合线稿提取（AnyLine）"},
    {"id": "LineartStandardPreprocessor", "group": "edge", "zh": "标准线稿 (Standard)", "desc": "轻量快速的传统线稿提取"},
    {"id": "Manga2Anime_LineArt_Preprocessor", "group": "edge", "zh": "漫画线稿 (Manga)", "desc": "适合黑白漫画与网点去噪线稿"},
    {"id": "HEDPreprocessor", "group": "edge", "zh": "HED 柔和边缘", "desc": "保留柔和明暗轮廓的软边缘"},
    {"id": "PiDiNetPreprocessor", "group": "edge", "zh": "PiDiNet 软边缘", "desc": "更干净的神经网络软边缘提取"},
    {"id": "TEEDPreprocessor", "group": "edge", "zh": "TEED 轻量边缘", "desc": "高对比度轻量级边缘检测"},
    {"id": "ScribblePreprocessor", "group": "edge", "zh": "涂鸦线稿 (Scribble)", "desc": "简笔涂鸦风格轮廓"},
    {"id": "Scribble_XDoG_Preprocessor", "group": "edge", "zh": "XDoG 涂鸦边缘", "desc": "可调阈值的 XDoG 素描涂鸦"},
    {"id": "M-LSDPreprocessor", "group": "edge", "zh": "M-LSD 建筑直线", "desc": "专门提取室内外建筑透视直线"},
    {"id": "BinaryPreprocessor", "group": "edge", "zh": "黑白二值图 (Binary)", "desc": "按阈值将图像转为纯黑白"},
    # Depth & Normal
    {"id": "DepthAnythingPreprocessor", "group": "depth", "zh": "Depth Anything 深度图", "desc": "通用高精度单目深度估计（支持 VitL/VitB/VitS）"},
    {"id": "DepthAnythingV2Preprocessor", "group": "depth", "zh": "Depth Anything V2 深度图", "desc": "新一代高细节深度图估计"},
    {"id": "Zoe_DepthAnythingPreprocessor", "group": "depth", "zh": "Zoe Depth Anything", "desc": "度量级深度估计，空间层次更强"},
    {"id": "Zoe-DepthMapPreprocessor", "group": "depth", "zh": "Zoe 深度图", "desc": "经典 ZoeDepth 深度图"},
    {"id": "MiDaS-DepthMapPreprocessor", "group": "depth", "zh": "MiDaS 深度图", "desc": "经典稳健的 MiDaS 深度估计"},
    {"id": "LeReS-DepthMapPreprocessor", "group": "depth", "zh": "LeReS 深度图", "desc": "支持前景/背景截断的深度图"},
    {"id": "BAE-NormalMapPreprocessor", "group": "depth", "zh": "BAE 法线贴图", "desc": "提取物体表面凹凸法线方向"},
    {"id": "DSINE-NormalMapPreprocessor", "group": "depth", "zh": "DSINE 法线贴图", "desc": "高精度表面法线贴图估计"},
    {"id": "MiDaS-NormalMapPreprocessor", "group": "depth", "zh": "MiDaS 法线贴图", "desc": "基于 MiDaS 的快速法线图"},
    # Pose & Human
    {"id": "DWPreprocessor", "group": "pose", "zh": "DWPose 骨骼姿态", "desc": "高精准全身 + 手部 + 面部骨骼姿态提取"},
    {"id": "OpenposePreprocessor", "group": "pose", "zh": "OpenPose 骨骼姿态", "desc": "经典 OpenPose 人体姿态关键点"},
    {"id": "DensePosePreprocessor", "group": "pose", "zh": "DensePose 密集姿态", "desc": "人体表面 UV 密集分割姿态"},
    {"id": "MediaPipe-FaceMeshPreprocessor", "group": "pose", "zh": "MediaPipe 面部网格", "desc": "精准人脸五官网格与表情控制"},
    {"id": "AnimalPosePreprocessor", "group": "pose", "zh": "动物骨骼姿态", "desc": "针对四足动物的关键点姿态提取"},
    # Segmentation & Other
    {"id": "OneFormer-COCO-SemSegPreprocessor", "group": "other", "zh": "OneFormer 语义分割 (COCO)", "desc": "通用物体与场景语义分割"},
    {"id": "OneFormer-ADE20K-SemSegPreprocessor", "group": "other", "zh": "OneFormer 场景分割 (ADE20K)", "desc": "室内外建筑与场景语义分割"},
    {"id": "SAMPreprocessor", "group": "other", "zh": "SAM 万物分割", "desc": "Segment Anything 自动区域分割"},
    {"id": "AnimeFace_SemSegPreprocessor", "group": "other", "zh": "动漫人脸分割", "desc": "二次元角色面部五官区域分割"},
    {"id": "TilePreprocessor", "group": "other", "zh": "Tile 模糊重绘预处理", "desc": "金字塔降采样平滑，适合 Tile 重绘/放大"},
    {"id": "ColorPreprocessor", "group": "other", "zh": "Color 色块分布", "desc": "提取马赛克色块用于构图配色引导"},
    {"id": "ShufflePreprocessor", "group": "other", "zh": "Content Shuffle 内容打乱", "desc": "打乱纹理用于风格迁移参考"},
]

_PARAM_ZH_LABELS: dict[str, str] = {
    "low_threshold": "低阈值",
    "high_threshold": "高阈值",
    "resolution": "处理分辨率",
    "ckpt_name": "模型权重",
    "coarse": "粗略模式",
    "safe": "安全截断",
    "detect_hand": "检测手部",
    "detect_body": "检测身体",
    "detect_face": "检测面部",
    "bbox_detector": "人体检测模型",
    "pose_estimator": "姿态估计模型",
    "scale_stick_for_xinsr_cn": "Xinsr 线条缩放",
    "bg_threshold": "背景阈值",
    "rm_nearest": "移除近景 (%)",
    "rm_background": "移除背景 (%)",
    "boost": "细节增强 (Boost)",
    "score_threshold": "置信度阈值",
    "dist_threshold": "距离阈值",
    "bin_threshold": "二值化阈值",
    "threshold": "阈值",
    "pyrUp_iters": "金字塔迭代次数",
    "max_faces": "最大人脸数",
    "min_confidence": "最小置信度",
    "model": "模型",
    "cmap": "配色方案",
    "a": "系数 a",
    "fov": "视野角 (FOV)",
    "iterations": "迭代次数",
    "guassian_sigma": "高斯模糊 Sigma",
    "intensity_threshold": "强度阈值",
    "safe_steps": "安全步数",
    "seed": "随机种子",
    # RMBG params
    "sensitivity": "灵敏度",
    "process_res": "处理分辨率",
    "mask_blur": "遮罩模糊",
    "mask_offset": "遮罩偏移",
    "invert_output": "反转输出",
    "refine_foreground": "精细前景优化",
    "unload_model": "释放模型显存",
    "background": "背景类型",
    "background_color": "背景颜色",
}

_SKIP_DISCOVER_IDS = {
    "AIO_Preprocessor",
    "ExecuteAllControlNetPreprocessors",
    "ControlNetPreprocessorSelector",
    "ControlNetAuxSimpleAddText",
    "InpaintPreprocessor",
    "MeshGraphormer+ImpactDetector-DepthMapPreprocessor",
    "DiffusionEdge_Preprocessor",
    "SavePoseKpsAsJsonFile",
    "FacialPartColoringFromPoseKps",
    "UpperBodyTrackingFromPoseKps",
    "RenderPeopleKps",
    "RenderAnimalKps",
    "Unimatch_OptFlowPreprocessor",
    "MaskOptFlow",
}


def _serialize_input_schema(node_cls: Any) -> list[dict[str, Any]]:
    """Extract editable non-image parameters from a ComfyUI node's INPUT_TYPES()."""
    if not hasattr(node_cls, "INPUT_TYPES"):
        return []
    raw = node_cls.INPUT_TYPES() or {}
    merged: list[tuple[str, Any, bool]] = []
    for k, v in (raw.get("required") or {}).items():
        merged.append((k, v, True))
    for k, v in (raw.get("optional") or {}).items():
        merged.append((k, v, False))

    fields: list[dict[str, Any]] = []
    for name, spec, is_req in merged:
        if name == "image":
            continue
        if not isinstance(spec, (tuple, list)) or len(spec) == 0:
            continue
        type_or_choices = spec[0]
        opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}

        # Skip non-primitive linked sockets (IMAGE, MASK, MODEL, etc.), keep COLORCODE as color picker
        if isinstance(type_or_choices, str) and type_or_choices not in ("INT", "FLOAT", "STRING", "BOOLEAN", "COLORCODE"):
            continue

        label = _PARAM_ZH_LABELS.get(name, name)
        if isinstance(type_or_choices, (list, tuple)):
            choices = [str(x) for x in type_or_choices]
            default_val = opts.get("default", choices[0] if choices else "")
            fields.append({
                "name": name,
                "label": label,
                "type": "COMBO",
                "choices": choices,
                "default": str(default_val),
                "required": is_req,
            })
        elif type_or_choices == "COLORCODE":
            fields.append({
                "name": name,
                "label": label,
                "type": "COLOR",
                "default": str(opts.get("default", "#222222")),
                "required": is_req,
            })
        elif type_or_choices == "INT":
            fields.append({
                "name": name,
                "label": label,
                "type": "INT",
                "default": int(opts.get("default", 512 if name == "resolution" else 0)),
                "min": int(opts.get("min", 0)),
                "max": int(opts.get("max", 4096)),
                "step": int(opts.get("step", 1)),
                "required": is_req,
            })
        elif type_or_choices == "FLOAT":
            fields.append({
                "name": name,
                "label": label,
                "type": "FLOAT",
                "default": float(opts.get("default", 0.0)),
                "min": float(opts.get("min", 0.0)),
                "max": float(opts.get("max", 100.0)),
                "step": float(opts.get("step", 0.01)),
                "required": is_req,
            })
        elif type_or_choices == "BOOLEAN":
            fields.append({
                "name": name,
                "label": label,
                "type": "BOOLEAN",
                "default": bool(opts.get("default", False)),
                "required": is_req,
            })
        elif type_or_choices == "STRING":
            fields.append({
                "name": name,
                "label": label,
                "type": "STRING",
                "default": str(opts.get("default", "")),
                "required": is_req,
            })
    return fields


def _discover_controlnet_preprocessors() -> dict[str, Any]:
    import nodes as comfy_nodes

    mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    display_map = getattr(comfy_nodes, "NODE_DISPLAY_NAME_MAPPINGS", {}) or {}

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    aux_count = 0

    for entry in _CURATED_CONTROLNET_CATALOG:
        nid = entry["id"]
        node_cls = mappings.get(nid)
        if node_cls is None:
            continue
        seen.add(nid)
        aux_count += 1
        items.append({
            "id": nid,
            "display_name": str(display_map.get(nid, nid)),
            "zh_name": entry["zh"],
            "group": entry["group"],
            "desc": entry["desc"],
            "installed": True,
            "params": _serialize_input_schema(node_cls),
        })

    # Also auto-include any other ControlNet Preprocessors registered by comfyui_controlnet_aux
    for nid, node_cls in mappings.items():
        if nid in seen or nid in _SKIP_DISCOVER_IDS:
            continue
        cat = str(getattr(node_cls, "CATEGORY", "") or "")
        if not cat.startswith("ControlNet Preprocessors"):
            continue
        # Must accept an IMAGE input and output an IMAGE
        ret = getattr(node_cls, "RETURN_TYPES", ()) or ()
        if not ret or ret[0] != "IMAGE":
            continue
        try:
            itypes = node_cls.INPUT_TYPES() or {}
            req = itypes.get("required") or {}
            if "image" not in req:
                continue
        except Exception:
            continue

        cat_l = cat.lower()
        if "depth" in cat_l or "normal" in cat_l:
            grp = "depth"
        elif "pose" in cat_l or "face" in cat_l:
            grp = "pose"
        elif "line" in cat_l or "edge" in cat_l or "scribble" in cat_l:
            grp = "edge"
        else:
            grp = "other"

        aux_count += 1
        seen.add(nid)
        disp = str(display_map.get(nid, nid))
        items.append({
            "id": nid,
            "display_name": disp,
            "zh_name": disp,
            "group": grp,
            "desc": cat,
            "installed": True,
            "params": _serialize_input_schema(node_cls),
        })

    return {
        "aux_installed": aux_count > 0,
        "aux_count": aux_count,
        "items": items,
    }


def _tensor_to_pil(tensor: torch.Tensor) -> Image.Image:
    t = tensor
    if t.ndim == 4:
        t = t[0]
    elif t.ndim == 3 and t.shape[0] == 1 and t.shape[-1] > 4:
        # (1, H, W) mask tensor
        t = t[0]
    arr = np.clip(t.detach().cpu().float().numpy() * 255.0, 0, 255).astype(np.uint8)
    if arr.ndim == 2:
        return Image.fromarray(arr, mode="L").convert("RGB")
    if arr.shape[-1] == 1:
        return Image.fromarray(arr[..., 0], mode="L").convert("RGB")
    if arr.shape[-1] == 4:
        return Image.fromarray(arr, mode="RGBA")
    return Image.fromarray(arr[..., :3], mode="RGB")


def _extract_image_tensor(result: Any) -> torch.Tensor:
    """Extract first IMAGE tensor from a ComfyUI node execution return value."""
    if isinstance(result, dict) and "result" in result:
        result = result["result"]
    if isinstance(result, (tuple, list)):
        for item in result:
            if isinstance(item, torch.Tensor) and item.ndim >= 3:
                return item
    if isinstance(result, torch.Tensor) and result.ndim >= 3:
        return result
    raise RuntimeError("预处理器未返回有效的图像张量 (IMAGE)。")


def _coerce_node_kwargs(node_cls: Any, img_tensor: torch.Tensor, params: dict[str, Any]) -> dict[str, Any]:
    schema = _serialize_input_schema(node_cls)
    call_kwargs: dict[str, Any] = {"image": img_tensor}
    for field in schema:
        fname = field["name"]
        ftype = field["type"]
        raw_val = params.get(fname, field["default"])
        if raw_val is None:
            raw_val = field["default"]
        if ftype == "INT":
            call_kwargs[fname] = int(round(float(raw_val)))
        elif ftype == "FLOAT":
            call_kwargs[fname] = float(raw_val)
        elif ftype == "BOOLEAN":
            if isinstance(raw_val, str):
                call_kwargs[fname] = raw_val.strip().lower() in ("1", "true", "yes", "on", "enable")
            else:
                call_kwargs[fname] = bool(raw_val)
        elif ftype == "COMBO":
            val_s = str(raw_val)
            choices = field.get("choices") or []
            call_kwargs[fname] = val_s if (not choices or val_s in choices) else choices[0]
        else:
            call_kwargs[fname] = str(raw_val)
    return call_kwargs


def _execute_controlnet_preprocessor(img: Image.Image, preprocessor_id: str, params: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()

    import nodes as comfy_nodes

    mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    node_cls = mappings.get(preprocessor_id)
    if node_cls is None:
        raise ValueError(
            f"未检测到 ControlNet 预处理器节点 '{preprocessor_id}'，请先安装 comfyui_controlnet_aux 插件并重启 ComfyUI。"
        )

    # Convert PIL to standard ComfyUI BHWC float32 [0, 1] RGB tensor
    rgb = img.convert("RGB")
    img_np = np.asarray(rgb, dtype=np.float32) / 255.0
    img_tensor = torch.from_numpy(img_np).unsqueeze(0)

    call_kwargs = _coerce_node_kwargs(node_cls, img_tensor, params)
    fn_name = getattr(node_cls, "FUNCTION", "execute")
    instance = node_cls()
    fn = getattr(instance, fn_name)

    with torch.no_grad():
        result = fn(**call_kwargs)

    out_tensor = _extract_image_tensor(result)
    out_img = _tensor_to_pil(out_tensor)

    return {
        "image": _pil_to_data_url(out_img),
        "width": out_img.width,
        "height": out_img.height,
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


# ---------------------------------------------------------------------------
# RMBG Node Discovery & Execution (comfyui-rmbg)
# ---------------------------------------------------------------------------

_RMBG_INSTANCE_CACHE: Any = None
_RMBG_CLASS_REF: Any = None


def _discover_rmbg_node() -> dict[str, Any]:
    import nodes as comfy_nodes

    mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    display_map = getattr(comfy_nodes, "NODE_DISPLAY_NAME_MAPPINGS", {}) or {}
    node_cls = mappings.get("RMBG")
    if node_cls is None:
        return {
            "installed": False,
            "node_id": "RMBG",
            "display_name": "去除背景 (RMBG)",
            "params": [],
        }

    return {
        "installed": True,
        "node_id": "RMBG",
        "display_name": str(display_map.get("RMBG", "Remove Background (RMBG)")),
        "params": _serialize_input_schema(node_cls),
    }


def _execute_rmbg(img: Image.Image, params: dict[str, Any], output_type: str = "image") -> dict[str, Any]:
    global _RMBG_INSTANCE_CACHE, _RMBG_CLASS_REF
    t0 = time.perf_counter()

    import nodes as comfy_nodes

    mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    node_cls = mappings.get("RMBG")
    if node_cls is None:
        raise ValueError(
            "未检测到去除背景节点 (RMBG)，请先安装 ComfyUI-RMBG（comfyui-rmbg）插件并重启 ComfyUI。"
        )

    if _RMBG_INSTANCE_CACHE is None or _RMBG_CLASS_REF is not node_cls:
        _RMBG_INSTANCE_CACHE = node_cls()
        _RMBG_CLASS_REF = node_cls

    rgb = img.convert("RGB")
    img_np = np.asarray(rgb, dtype=np.float32) / 255.0
    img_tensor = torch.from_numpy(img_np).unsqueeze(0)

    call_kwargs = _coerce_node_kwargs(node_cls, img_tensor, params)
    fn_name = getattr(node_cls, "FUNCTION", "process_image")
    fn = getattr(_RMBG_INSTANCE_CACHE, fn_name)

    with torch.no_grad():
        result = fn(**call_kwargs)

    if isinstance(result, dict) and "result" in result:
        result = result["result"]

    if not isinstance(result, (tuple, list)) or len(result) < 3:
        raise RuntimeError("RMBG 节点返回格式异常，预期返回 (IMAGE, MASK, MASK_IMAGE)。")

    out_image_pil = _tensor_to_pil(result[0])
    out_mask_pil = _tensor_to_pil(result[1])
    out_mask_image_pil = _tensor_to_pil(result[2])

    outputs = {
        "image": {
            "image": _pil_to_data_url(out_image_pil),
            "width": out_image_pil.width,
            "height": out_image_pil.height,
        },
        "mask": {
            "image": _pil_to_data_url(out_mask_pil),
            "width": out_mask_pil.width,
            "height": out_mask_pil.height,
        },
        "mask_image": {
            "image": _pil_to_data_url(out_mask_image_pil),
            "width": out_mask_image_pil.width,
            "height": out_mask_image_pil.height,
        },
    }

    sel = output_type if output_type in outputs else "image"
    chosen = outputs[sel]
    return {
        "selected": sel,
        "image": chosen["image"],
        "width": chosen["width"],
        "height": chosen["height"],
        "outputs": outputs,
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


# ---------------------------------------------------------------------------
# aiohttp Route Registration
# ---------------------------------------------------------------------------

_ROUTES_REGISTERED = False


def register_local_studio_routes() -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    _ROUTES_REGISTERED = True

    @PromptServer.instance.routes.post("/ma/local_studio/basic")
    async def ma_local_studio_basic(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
            filename = payload.get("filename")
            image_data_url = payload.get("image_data_url")
            submode = str(payload.get("submode", "crop_rotate_pad") or "crop_rotate_pad").strip().lower()

            def _work() -> dict[str, Any]:
                t0 = time.perf_counter()
                img = _load_pil_source(filename=filename, image_data_url=image_data_url)
                if submode == "resolution":
                    res = _run_resolution_transform(img, payload)
                elif submode == "adjust":
                    res = _run_color_adjust(img, payload)
                else:
                    res = _run_crop_rotate_pad(img, payload)
                res["elapsed_ms"] = int((time.perf_counter() - t0) * 1000)
                return res

            result = await asyncio.to_thread(_work)
            return web.json_response({"status": "success", **result})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=400)

    @PromptServer.instance.routes.get("/ma/local_studio/controlnet_list")
    async def ma_local_studio_controlnet_list(request: web.Request) -> web.Response:
        try:
            data = await asyncio.to_thread(_discover_controlnet_preprocessors)
            return web.json_response({"status": "success", **data})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @PromptServer.instance.routes.post("/ma/local_studio/controlnet_run")
    async def ma_local_studio_controlnet_run(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
            filename = payload.get("filename")
            image_data_url = payload.get("image_data_url")
            preprocessor = str(payload.get("preprocessor") or "").strip()
            params = payload.get("params") or {}
            if not preprocessor:
                return web.json_response({"status": "error", "message": "请先选择一个 ControlNet 预处理器。"}, status=400)

            def _work() -> dict[str, Any]:
                img = _load_pil_source(filename=filename, image_data_url=image_data_url)
                return _execute_controlnet_preprocessor(img, preprocessor, params)

            result = await asyncio.to_thread(_work)
            return web.json_response({"status": "success", **result})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @PromptServer.instance.routes.get("/ma/local_studio/rmbg_info")
    async def ma_local_studio_rmbg_info(request: web.Request) -> web.Response:
        try:
            data = await asyncio.to_thread(_discover_rmbg_node)
            return web.json_response({"status": "success", **data})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @PromptServer.instance.routes.post("/ma/local_studio/rmbg_run")
    async def ma_local_studio_rmbg_run(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
            filename = payload.get("filename")
            image_data_url = payload.get("image_data_url")
            params = payload.get("params") or {}
            output_type = str(payload.get("output_type", "image") or "image").strip().lower()

            def _work() -> dict[str, Any]:
                img = _load_pil_source(filename=filename, image_data_url=image_data_url)
                return _execute_rmbg(img, params, output_type=output_type)

            result = await asyncio.to_thread(_work)
            return web.json_response({"status": "success", **result})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=500)


register_local_studio_routes()
