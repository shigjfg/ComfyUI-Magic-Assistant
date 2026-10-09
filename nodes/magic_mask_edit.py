import math

import torch
import torch.nn.functional as F
from scipy import ndimage

import comfy.utils
import node_helpers


METHODS = ["auto", "nearest-exact", "bilinear", "area", "bicubic", "lanczos", "bislerp"]


def _resize(image, width, height, method):
    width, height = int(width), int(height)
    if image.shape[2] == width and image.shape[1] == height:
        return image
    if method == "auto":
        method = "area" if width < image.shape[2] or height < image.shape[1] else "bicubic"
    return comfy.utils.common_upscale(
        image.movedim(-1, 1), width, height, method, "disabled"
    ).movedim(1, -1).clamp(0.0, 1.0)


def _resize_mask(mask, width, height, preserve_support=False, binary=False):
    if mask.shape[-2:] == (height, width):
        return mask
    if preserve_support and (width < mask.shape[-1] or height < mask.shape[-2]):
        size = (min(height, mask.shape[-2]), min(width, mask.shape[-1]))
        mask = F.adaptive_max_pool2d(mask.unsqueeze(1), size).squeeze(1)
        if mask.shape[-2:] == (height, width):
            return mask
    mode = "area" if width < mask.shape[-1] or height < mask.shape[-2] else "bilinear"
    if binary:
        mode = "nearest-exact"
    return F.interpolate(mask.unsqueeze(1), size=(height, width), mode=mode).squeeze(1).clamp(0.0, 1.0)


def _mask_bhw(mask, reference_size):
    if mask.ndim == 2:
        return mask.unsqueeze(0)
    if mask.ndim == 4:
        candidates = []
        if mask.shape[1] == 1:
            candidates.append(mask[:, 0])
        if mask.shape[-1] == 1:
            candidates.append(mask[..., 0])
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) == 2:
            if candidates[0].shape == candidates[1].shape:
                return candidates[0]
            width, height = reference_size
            exact = [value for value in candidates if value.shape[-2:] == (height, width)]
            if exact:
                return exact[0]
            aligned = [value for value in candidates if math.isclose(value.shape[-1] / value.shape[-2], width / height)]
            if len(aligned) == 1:
                return aligned[0]
            raise ValueError("Ambiguous 4D mask coordinates; use [B,H,W] to specify the mask layout")
    if mask.ndim != 3:
        raise ValueError("mask must have shape [B,H,W], [H,W], [B,1,H,W] or [B,H,W,1]")
    return mask


def _as_mask(mask, batch, height, width, device):
    if mask is None:
        return torch.zeros((batch, height, width), dtype=torch.float32, device=device)
    mask = _mask_bhw(mask, (width, height)).to(device=device, dtype=torch.float32)
    if mask.shape[0] == 1:
        mask = mask.expand(batch, -1, -1)
    elif mask.shape[0] != batch:
        raise ValueError(f"Mask batch {mask.shape[0]} does not match image batch {batch}; use one mask or one per image")
    return _resize_mask(mask.clamp(0.0, 1.0), width, height, preserve_support=True)


def _crop_box(active, width, height, padding, shape, ratio):
    ys, xs = torch.where(active)
    if xs.numel() == 0:
        return (0, 0, width, height), True
    left, right = int(xs.min().item()), int(xs.max().item()) + 1
    top, bottom = int(ys.min().item()), int(ys.max().item()) + 1
    crop_w, crop_h = right - left + 2 * padding, bottom - top + 2 * padding
    if shape == "square":
        crop_w = crop_h = max(crop_w, crop_h)
    elif shape == "target_ratio":
        if crop_w / crop_h < ratio:
            crop_w = math.ceil(crop_h * ratio)
        else:
            crop_h = math.ceil(crop_w / ratio)
    elif shape != "tight":
        raise ValueError(f"Unknown crop_shape: {shape}")
    crop_w, crop_h = min(width, crop_w), min(height, crop_h)
    # Move the whole window inward before cropping; never pad the source image with black.
    x = min(max(0, math.floor((left + right - crop_w) / 2)), width - crop_w)
    y = min(max(0, math.floor((top + bottom - crop_h) / 2)), height - crop_h)
    return (x, y, x + crop_w, y + crop_h), False


def _resize_layout(width, height, mode, target_width, target_height, factor, policy, multiple):
    if mode == "none":
        return width, height, width, height
    if mode == "target":
        scale = min(target_width / width, target_height / height)
    elif mode == "longest_side":
        scale = target_width / max(width, height)
    elif mode == "scale":
        scale = factor
    else:
        raise ValueError(f"Unknown resize_mode: {mode}")
    if policy == "upscale_only":
        scale = max(1.0, scale)
    elif policy == "downscale_only":
        scale = min(1.0, scale)
    elif policy != "both":
        raise ValueError(f"Unknown scale_policy: {policy}")
    content_w, content_h = max(1, round(width * scale)), max(1, round(height * scale))
    canvas_w, canvas_h = content_w, content_h
    if mode == "target":
        canvas_w, canvas_h = max(canvas_w, target_width), max(canvas_h, target_height)
    canvas_w = math.ceil(canvas_w / multiple) * multiple
    canvas_h = math.ceil(canvas_h / multiple) * multiple
    return content_w, content_h, canvas_w, canvas_h


def _crop(image, mask, target_width, target_height, padding, threshold, method,
          resize_mode="target", crop_shape="target_ratio", scale_factor=1.0,
          scale_policy="both", size_multiple=1, empty_mask_mode="preserve", mask_mode="binary"):
    if image is None or image.ndim != 4 or min(image.shape[:3]) < 1:
        raise ValueError("image must be a nonempty [B,H,W,C] tensor")
    target_width, target_height = int(target_width), int(target_height)
    padding, size_multiple = int(padding), int(size_multiple)
    if min(target_width, target_height, size_multiple) < 1 or padding < 0 or scale_factor <= 0:
        raise ValueError("Dimensions, size_multiple and scale_factor must be positive; padding cannot be negative")
    if empty_mask_mode not in ("preserve", "full_image"):
        raise ValueError(f"Unknown empty_mask_mode: {empty_mask_mode}")
    if mask_mode not in ("binary", "soft"):
        raise ValueError(f"Unknown mask_mode: {mask_mode}")
    batch, height, width, _ = image.shape
    masks = _as_mask(mask, batch, height, width, image.device)
    entries, layouts = [], []
    for index in range(batch):
        box, empty = _crop_box(masks[index] > threshold, width, height, padding, crop_shape, target_width / target_height)
        x1, y1, x2, y2 = box
        crop_w, crop_h = x2 - x1, y2 - y1
        source_mask = masks[index, y1:y2, x1:x2].clone()
        if empty:
            source_mask.fill_(1.0 if empty_mask_mode == "full_image" else 0.0)
        entries.append({"crop_box": box, "crop_size": (crop_w, crop_h), "mask_empty": empty,
                        "edit_full_image": empty and empty_mask_mode == "full_image", "source_mask": source_mask})
        layouts.append(_resize_layout(crop_w, crop_h, resize_mode, target_width, target_height, scale_factor, scale_policy, size_multiple))

    canvas_w, canvas_h = max(item[2] for item in layouts), max(item[3] for item in layouts)
    images_out, masks_out = [], []
    for index, (entry, layout) in enumerate(zip(entries, layouts)):
        x1, y1, x2, y2 = entry["crop_box"]
        content_w, content_h = layout[:2]
        crop = _resize(image[index:index + 1, y1:y2, x1:x2], content_w, content_h, method)
        model_mask = entry["source_mask"].unsqueeze(0)
        if mask_mode == "binary" and not entry["edit_full_image"]:
            model_mask = (model_mask > threshold).to(model_mask.dtype)
        crop_mask = _resize_mask(model_mask, content_w, content_h, preserve_support=True, binary=mask_mode == "binary")
        left, top = (canvas_w - content_w) // 2, (canvas_h - content_h) // 2
        right, bottom = canvas_w - content_w - left, canvas_h - content_h - top
        if left or top or right or bottom:
            crop = F.pad(crop.movedim(-1, 1), (left, right, top, bottom), mode="replicate").movedim(1, -1)
            crop_mask = F.pad(crop_mask, (left, right, top, bottom))
        entry["content_box"] = (left, top, left + content_w, top + content_h)
        images_out.append(crop)
        masks_out.append(crop_mask)
    empty = all(entry["mask_empty"] for entry in entries)
    info = {
        "version": 2, "original_image": image, "original_size": (width, height),
        "target_size": (canvas_w, canvas_h), "batch_size": batch, "mask_empty": empty,
        "padding": padding, "entries": entries,
        # Keep these fields usable for legacy consumers of a single crop.
        "crop_box": entries[0]["crop_box"], "clipped_box": entries[0]["crop_box"],
        "crop_size": entries[0]["crop_size"], "padding_applied": (0, 0, 0, 0),
    }
    return torch.cat(images_out), torch.cat(masks_out), info, empty


def _content_slice(tensor, content_box, canvas_size):
    canvas_w, canvas_h = canvas_size
    height, width = tensor.shape[1:3]
    x1, y1, x2, y2 = content_box
    left, top = min(width - 1, round(x1 * width / canvas_w)), min(height - 1, round(y1 * height / canvas_h))
    right, bottom = min(width, max(left + 1, round(x2 * width / canvas_w))), min(height, max(top + 1, round(y2 * height / canvas_h)))
    return tensor[:, top:bottom, left:right]


def _feather(mask, radius, box, original_size):
    if radius <= 0 or not bool(torch.any(mask > 0).item()):
        return mask
    x1, y1, x2, y2 = box
    width, height = original_size
    support = (mask > 0).to(mask.dtype)
    padded = F.pad(support[None, None], (1, 1, 1, 1), mode="replicate")[0, 0]
    if x1 > 0:
        padded[:, 0] = 0
    if x2 < width:
        padded[:, -1] = 0
    if y1 > 0:
        padded[0, :] = 0
    if y2 < height:
        padded[-1, :] = 0
    if not bool(torch.any(padded == 0).item()):
        return mask
    distances = ndimage.distance_transform_edt(padded.cpu().numpy())[1:-1, 1:-1]
    labels, count = ndimage.label(support.cpu().numpy(), structure=[[1, 1, 1], [1, 1, 1], [1, 1, 1]])
    depths = ndimage.maximum(distances, labels, index=list(range(1, count + 1)))
    widths = depths.clip(1.0, max(1.0, float(radius)))
    factors = (distances / widths[labels - 1]).clip(0.0, 1.0)
    # Each region reaches full strength inside; zero-mask pixels remain untouched.
    return mask * torch.as_tensor(factors, dtype=mask.dtype, device=mask.device)


def _can_edit(info):
    if "entries" in info:
        return any(not entry["mask_empty"] or entry.get("edit_full_image", False) for entry in info["entries"])
    return not info.get("mask_empty", False) or info.get("version") == 1


def _merge(original, processed, info, method, mask=None, blend_mode="mask", feather=0, opacity=1.0,
           input_layout="canvas", batch_order="repeat_batch"):
    if not isinstance(info, dict):
        raise ValueError("crop_info must come from Magic Mask Edit / MagicMaskCropResize")
    if original.ndim != 4 or min(original.shape[:3]) < 1:
        raise ValueError("Images must have shape [B,H,W,C]")
    width, height = original.shape[2], original.shape[1]
    if (width, height) != tuple(info["original_size"]):
        raise ValueError("Original image size differs from crop_info; use the original image that produced this crop")
    noop = float(opacity) <= 0 or not _can_edit(info)
    if processed is None:
        if not noop:
            raise ValueError("回贴模式需要编辑图像")
        processed_batch = original.shape[0]
    else:
        if processed.ndim != 4 or min(processed.shape[:3]) < 1:
            raise ValueError("Edited images must have nonempty shape [B,H,W,C]")
        if not noop:
            original, processed = node_helpers.image_alpha_fix(original, processed)
            if original.shape[-1] != processed.shape[-1]:
                raise ValueError(
                    f"Cannot merge original shape {tuple(original.shape)} with edited shape {tuple(processed.shape)} after channel adaptation"
                )
        processed_batch = processed.shape[0]
    original_batch = original.shape[0]
    if processed_batch != 1 and processed_batch % original_batch != 0:
        raise ValueError("Edited image batch must match the original batch, contain one image, or be an integer multiple")
    batch = max(original_batch, processed_batch)
    entries = info.get("entries")
    if entries is None:
        entries = [{"crop_box": info["crop_box"], "mask_empty": info.get("mask_empty", False)}] * original_batch
    if len(entries) != original_batch:
        raise ValueError("crop_info batch does not match the original image batch")
    if blend_mode not in ("mask", "crop"):
        raise ValueError(f"Unknown blend_mode: {blend_mode}")
    if input_layout not in ("canvas", "content"):
        raise ValueError(f"Unknown input_layout: {input_layout}")
    if batch_order not in ("repeat_batch", "repeat_each"):
        raise ValueError(f"Unknown batch_order: {batch_order}")
    target_size = info.get("target_size") or ((processed.shape[2], processed.shape[1]) if processed is not None else (width, height))
    repeats = batch // original_batch
    if repeats == 1:
        out = original.clone()
    elif batch_order == "repeat_batch":
        out = original.repeat(repeats, 1, 1, 1)
    else:
        out = original.repeat_interleave(repeats, dim=0)
    merged_mask = torch.zeros((batch, height, width), dtype=torch.float32, device=original.device)
    if noop:
        return out, merged_mask
    processed = processed.to(device=original.device, dtype=original.dtype)
    override = None
    if mask is not None and blend_mode == "mask":
        # Override masks are in edited-canvas coordinates, including its padding.
        reference_size = target_size if input_layout == "canvas" else (processed.shape[2], processed.shape[1])
        override = _mask_bhw(mask, reference_size).to(device=original.device, dtype=torch.float32).clamp(0.0, 1.0)
        if override.shape[0] not in (1, original_batch, batch):
            raise ValueError("Blend mask batch must contain one mask, one per original, or one per edited image")
    for index in range(batch):
        source_index = index % original_batch if batch_order == "repeat_batch" else index // repeats
        entry = entries[source_index]
        if entry["mask_empty"] and not entry.get("edit_full_image", info.get("version") == 1):
            continue
        x1, y1, x2, y2 = map(int, entry["crop_box"])
        crop_w, crop_h = x2 - x1, y2 - y1
        content_box = entry.get("content_box", (0, 0, *target_size))
        edited = processed[0:1] if processed_batch == 1 else processed[index:index + 1]
        if input_layout == "canvas":
            edited = _content_slice(edited, content_box, target_size)
        source = _resize(edited, crop_w, crop_h, method)[0]
        if blend_mode == "crop":
            alpha = torch.ones((crop_h, crop_w), device=original.device, dtype=torch.float32)
        elif override is not None:
            mask_index = 0 if override.shape[0] == 1 else source_index if override.shape[0] == original_batch else index
            crop_mask = override[mask_index:mask_index + 1].unsqueeze(-1)
            if input_layout == "canvas":
                crop_mask = _content_slice(crop_mask, content_box, target_size)
            crop_mask = crop_mask[..., 0]
            alpha = _resize_mask(crop_mask, crop_w, crop_h)[0]
        elif "source_mask" in entry:
            alpha = entry["source_mask"].to(device=original.device, dtype=torch.float32)
        else:
            alpha = torch.ones((crop_h, crop_w), device=original.device, dtype=torch.float32)
        alpha = _feather(alpha, feather, (x1, y1, x2, y2), (width, height)) * float(opacity)
        ix1, iy1, ix2, iy2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
        if ix1 >= ix2 or iy1 >= iy2:
            continue
        sx1, sy1 = ix1 - x1, iy1 - y1
        sx2, sy2 = sx1 + ix2 - ix1, sy1 + iy2 - iy1
        alpha = alpha[sy1:sy2, sx1:sx2].clamp(0.0, 1.0)
        out[index, iy1:iy2, ix1:ix2] = torch.lerp(out[index, iy1:iy2, ix1:ix2], source[sy1:sy2, sx1:sx2], alpha.unsqueeze(-1).to(original.dtype))
        merged_mask[index, iy1:iy2, ix1:ix2] = alpha
    return out, merged_mask


class MagicMaskEdit:
    """Prepare a mask crop or restore an edited crop using its saved geometry."""

    @classmethod
    def INPUT_TYPES(cls):
        inputs = {
            "required": {
                "mode": (["crop", "merge"], {"default": "crop", "socketless": True, "tooltip": "crop：接原图；merge：接编辑后的裁图和 crop_info。编辑模型前后各放一个本节点。"}),
                "image": ("IMAGE", {"lazy": True, "tooltip": "crop 接原图；merge 接编辑结果。默认保留裁图完整画布，已去补边时在设置选 content。"}),
                "resize_mode": (["target", "longest_side", "scale", "none"], {"default": "target", "socketless": True}),
                "target_width": ("INT", {"default": 1024, "min": 1, "max": 16384}),
                "target_height": ("INT", {"default": 1024, "min": 1, "max": 16384}),
                "padding": ("INT", {"default": 64, "min": 0, "max": 4096, "tooltip": "原图像素的上下文留白；贴边时窗口向图内移动。"}),
                "mask_threshold": ("FLOAT", {"default": 0.001, "min": 0.0, "max": 1.0, "step": 0.001}),
                "empty_mask_mode": (["preserve", "full_image"], {"default": "preserve", "tooltip": "无遮罩或低于检测阈值时：preserve 保留原图；full_image 编辑整图，仍恢复原尺寸。"}),
                "upscale_method": (METHODS, {"default": "auto", "tooltip": "auto：缩小用 area，放大用 bicubic，保留浮点精度。"}),
                "crop_shape": (["target_ratio", "square", "tight"], {"default": "target_ratio", "socketless": True}),
                "scale_factor": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 16.0, "step": 0.05}),
                "scale_policy": (["both", "upscale_only", "downscale_only"], {"default": "both"}),
                "size_multiple": ("INT", {"default": 8, "min": 1, "max": 256, "tooltip": "补齐输出画布倍数，不拉伸图像；none 模式保持原尺寸。"}),
                "blend_mode": (["mask", "crop"], {"default": "mask", "tooltip": "mask：只改遮罩；crop：替换整个裁切框。默认使用 crop_info 保存的原遮罩。"}),
                "feather": ("INT", {"default": 16, "min": 0, "max": 256, "tooltip": "原图像素的向内羽化；小区域自适应保留自身最大强度，0 为硬边。遮罩外不变。"}),
                "blend_opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "mask_mode": (["binary", "soft"], {"default": "binary", "tooltip": "供模型的遮罩：binary 二值且缩小保留细点；soft 保留软边。回贴仍使用源软遮罩。"}),
                "input_layout": (["canvas", "content"], {"default": "canvas", "tooltip": "编辑图与可选融合遮罩保留完整画布，或都已去掉裁切时的补边。"}),
                "batch_order": (["repeat_batch", "repeat_each"], {"default": "repeat_batch", "tooltip": "多候选结果：repeat_batch 为 A B A B（ComfyUI批次重复）；repeat_each 为 A A B B。"}),
            },
            "optional": {
                "mask": ("MASK", {"lazy": True, "tooltip": "crop：原图坐标的源遮罩；merge：与编辑图布局相同的自定义融合遮罩，不接时使用保存的源软遮罩。"}),
                "crop_info": ("CROP_INFO", {"lazy": True, "tooltip": "回贴连接裁切实例的 crop_info，包含原图、源遮罩与坐标；裁切模式不使用此输入。"}),
            },
        }
        for name in ("target_width", "target_height", "padding", "mask_threshold", "empty_mask_mode",
                     "upscale_method", "scale_factor", "scale_policy", "size_multiple", "feather", "mask_mode",
                     "input_layout", "batch_order"):
            inputs["required"][name][1]["lazy"] = True
        return inputs

    RETURN_TYPES = ("IMAGE", "MASK", "CROP_INFO", "BOOLEAN")
    RETURN_NAMES = ("image", "mask", "crop_info", "mask_empty")
    OUTPUT_TOOLTIPS = (
        "crop：供编辑模型的裁图；merge：恢复原图尺寸后的结果。",
        "crop：当前编辑画布中的模型遮罩；merge：原图坐标中的实际融合强度。",
        "裁切信息直接连回贴实例，不需要重复连原图。",
        "裁切输入的遮罩是否全为空（按检测阈值）；整图编辑模式即使为 True 仍会编辑。",
    )
    FUNCTION = "execute"
    CATEGORY = "✨ Magic Assistant"
    HAS_INTERMEDIATE_OUTPUT = True

    def check_lazy_status(self, mode, image=None, **kwargs):
        if mode == "crop":
            needed = {"image", "padding", "mask_threshold", "empty_mask_mode", "mask_mode"}
            if "mask" in kwargs:
                needed.add("mask")
            resize_mode, shape = kwargs.get("resize_mode", "target"), kwargs.get("crop_shape", "target_ratio")
            if resize_mode == "target" or shape == "target_ratio":
                needed.update(("target_width", "target_height"))
            elif resize_mode == "longest_side":
                needed.add("target_width")
            if resize_mode != "none":
                needed.update(("upscale_method", "scale_policy", "size_multiple"))
            if resize_mode == "scale":
                needed.add("scale_factor")
        elif mode == "merge":
            info = kwargs.get("crop_info")
            if info is None:
                return ["crop_info"] if "crop_info" in kwargs else []
            if not isinstance(info, dict) or "original_image" not in info:
                return []
            if kwargs.get("blend_opacity", 1.0) <= 0 or not _can_edit(info):
                return []
            needed = {"image", "upscale_method", "feather", "input_layout", "batch_order"}
            if kwargs.get("blend_mode", "mask") == "mask" and "mask" in kwargs:
                needed.add("mask")
        else:
            return []
        values = {"image": image, **kwargs}
        return [name for name in needed if name in values and values[name] is None]

    def execute(self, image=None, mode="crop", resize_mode="target", target_width=1024, target_height=1024,
                padding=64, mask_threshold=0.001, upscale_method="auto", crop_shape="target_ratio",
                scale_factor=1.0, scale_policy="both", size_multiple=8, blend_mode="mask", feather=16,
                blend_opacity=1.0, mask=None, crop_info=None, empty_mask_mode="preserve", mask_mode="binary",
                input_layout="canvas", batch_order="repeat_batch"):
        if mode == "crop":
            target_width = 1024 if target_width is None else target_width
            target_height = 1024 if target_height is None else target_height
            scale_factor = 1.0 if scale_factor is None else scale_factor
            size_multiple = 1 if size_multiple is None else size_multiple
            scale_policy = "both" if scale_policy is None else scale_policy
            result = _crop(image, mask, target_width, target_height, padding, mask_threshold, upscale_method,
                           resize_mode, crop_shape, scale_factor, scale_policy, size_multiple, empty_mask_mode, mask_mode)
            info = result[2]
            boxes = "; ".join(str(entry["crop_box"]) for entry in info["entries"][:4])
            status = f"裁切 {image.shape[2]}×{image.shape[1]} → {result[0].shape[2]}×{result[0].shape[1]} | 框 {boxes}"
            if result[3]:
                status += " | 空遮罩：" + ("整图编辑" if empty_mask_mode == "full_image" else "回贴保留原图")
        elif mode == "merge":
            if not isinstance(crop_info, dict) or "original_image" not in crop_info:
                raise ValueError("回贴模式需要本次裁切输出的 crop_info；旧版信息请使用 Magic Resize & Merge 并接原图")
            feather = 16 if feather is None else feather
            input_layout = "canvas" if input_layout is None else input_layout
            batch_order = "repeat_batch" if batch_order is None else batch_order
            merged, blend_mask = _merge(crop_info["original_image"], image, crop_info, upscale_method, mask, blend_mode,
                                       feather, blend_opacity, input_layout, batch_order)
            result = (merged, blend_mask, crop_info, bool(crop_info["mask_empty"]))
            status = f"回贴 {merged.shape[2]}×{merged.shape[1]} | {merged.shape[0]} 张 | {blend_mode} | 羽化 {feather}px"
            if blend_opacity <= 0 or not _can_edit(crop_info):
                status += " | 保留原图，跳过编辑分支"
        else:
            raise ValueError(f"Unknown mode: {mode}")
        return {"ui": {"mask_edit_status": [status]}, "result": result}


class MagicMaskCropResize:
    """Legacy crop interface; new workflows should use MagicMaskEdit."""

    METHODS = METHODS

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_width": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1}),
                "target_height": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1}),
                "padding": ("INT", {"default": 64, "min": 0, "max": 4096, "step": 1}),
                "mask_threshold": ("FLOAT", {"default": 0.001, "min": 0.0, "max": 1.0, "step": 0.001}),
                "upscale_method": (cls.METHODS, {"default": "lanczos"}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "CROP_INFO", "BOOLEAN")
    RETURN_NAMES = ("cropped_image", "cropped_mask", "crop_info", "mask_empty")
    FUNCTION = "crop_and_resize"
    CATEGORY = "✨ Magic Assistant/Mask Edit"
    DEPRECATED = True

    def crop_and_resize(
        self,
        image,
        target_width,
        target_height,
        padding,
        mask_threshold,
        upscale_method,
        mask=None,
    ):
        return _crop(image, mask, target_width, target_height, padding, mask_threshold, upscale_method, empty_mask_mode="full_image")


class MagicMaskResizeMerge:
    """Resize an edited crop back and blend it into the original image."""

    METHODS = METHODS

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original_image": ("IMAGE",),
                "processed_image": ("IMAGE",),
                "crop_info": ("CROP_INFO",),
                "upscale_method": (cls.METHODS, {"default": "lanczos"}),
            },
            "optional": {
                "cropped_mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "resize_and_merge"
    CATEGORY = "✨ Magic Assistant/Mask Edit"
    DEPRECATED = True

    def resize_and_merge(self, original_image, processed_image, crop_info, upscale_method, cropped_mask=None):
        return (_merge(original_image, processed_image, crop_info, upscale_method, cropped_mask)[0],)
