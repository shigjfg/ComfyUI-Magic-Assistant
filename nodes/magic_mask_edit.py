import math

import torch
import torch.nn.functional as F

import comfy.utils


class MagicMaskCropResize:
    """Crop a square region around a mask and resize it for an edit model."""

    METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos", "bislerp"]

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

    @staticmethod
    def _image_size(image):
        return int(image.shape[2]), int(image.shape[1])

    @staticmethod
    def _as_mask(mask, batch, height, width, device):
        if mask is None:
            return torch.zeros((batch, height, width), dtype=torch.float32, device=device)
        mask = mask.to(device=device, dtype=torch.float32)
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        elif mask.ndim == 4:
            mask = mask[:, 0]
        if mask.ndim != 3:
            raise ValueError(f"Mask must have shape [B,H,W], got {tuple(mask.shape)}")
        if mask.shape[1] != height or mask.shape[2] != width:
            mask = comfy.utils.common_upscale(
                mask.unsqueeze(1), width, height, "nearest-exact", "disabled"
            ).squeeze(1)
        if mask.shape[0] == 1 and batch > 1:
            mask = mask.expand(batch, -1, -1)
        elif mask.shape[0] != batch:
            mask = mask[:1].expand(batch, -1, -1)
        return mask.clamp(0.0, 1.0)

    @staticmethod
    def _resize(image, width, height, method):
        if image.shape[2] == width and image.shape[1] == height:
            return image
        return comfy.utils.common_upscale(
            image.movedim(-1, 1), int(width), int(height), method, "disabled"
        ).movedim(1, -1)

    @staticmethod
    def _square_box(mask, width, height, padding):
        active = mask > 0
        ys, xs = torch.where(active)
        if xs.numel() == 0:
            return None

        left = int(xs.min().item())
        right = int(xs.max().item()) + 1
        top = int(ys.min().item())
        bottom = int(ys.max().item()) + 1
        side = max(right - left, bottom - top) + 2 * int(padding)
        side = max(1, side)

        center_x = (left + right) / 2.0
        center_y = (top + bottom) / 2.0
        x1 = int(math.floor(center_x - side / 2.0))
        y1 = int(math.floor(center_y - side / 2.0))
        return x1, y1, x1 + side, y1 + side

    @staticmethod
    def _pad_for_box(image, box, fill=0.0):
        x1, y1, x2, y2 = box
        left = max(0, -x1)
        top = max(0, -y1)
        right = max(0, x2 - image.shape[2])
        bottom = max(0, y2 - image.shape[1])
        if left or top or right or bottom:
            image = F.pad(image, (left, right, top, bottom), value=float(fill))
        return image, (x1 + left, y1 + top, x2 + left, y2 + top), (left, top, right, bottom)

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
        if image is None or image.ndim != 4:
            raise ValueError("image must have shape [B,H,W,C]")

        batch, height, width, channels = image.shape
        mask_tensor = self._as_mask(mask, batch, height, width, image.device)
        active = mask_tensor > float(mask_threshold)
        mask_empty = not bool(torch.any(active).item())

        if mask_empty:
            resized_image = self._resize(image, target_width, target_height, upscale_method)
            resized_mask = torch.zeros(
                (batch, int(target_height), int(target_width)), dtype=image.dtype, device=image.device
            )
            info = {
                "version": 1,
                "mask_empty": True,
                "original_size": (width, height),
                "crop_box": (0, 0, width, height),
                "clipped_box": (0, 0, width, height),
                "crop_size": (width, height),
                "target_size": (int(target_width), int(target_height)),
                "padding": int(padding),
                "batch_size": int(batch),
            }
            return resized_image, resized_mask, info, True

        # One shared box keeps the crop metadata valid for the whole image batch.
        box = self._square_box(active.any(dim=0), width, height, padding)
        x1, y1, x2, y2 = box
        crop_w, crop_h = x2 - x1, y2 - y1
        padded_image, padded_box, pad_info = self._pad_for_box(image.movedim(-1, 1), box, 0.0)
        padded_mask, _, _ = self._pad_for_box(mask_tensor.unsqueeze(1), box, 0.0)
        px1, py1, px2, py2 = padded_box

        cropped = padded_image[:, :, py1:py2, px1:px2].movedim(1, -1)
        cropped_mask = padded_mask[:, 0, py1:py2, px1:px2]
        resized_image = self._resize(cropped, target_width, target_height, upscale_method)
        resized_mask = comfy.utils.common_upscale(
            cropped_mask.unsqueeze(1), int(target_width), int(target_height), "bilinear", "disabled"
        ).squeeze(1).clamp(0.0, 1.0)

        info = {
            "version": 1,
            "mask_empty": False,
            "original_size": (width, height),
            "crop_box": (x1, y1, x2, y2),
            "clipped_box": (max(0, x1), max(0, y1), min(width, x2), min(height, y2)),
            "crop_size": (crop_w, crop_h),
            "target_size": (int(target_width), int(target_height)),
            "padding": int(padding),
            "padding_applied": pad_info,
            "batch_size": int(batch),
        }
        return resized_image, resized_mask, info, False


class MagicMaskResizeMerge:
    """Resize an edited crop back and blend it into the original image."""

    METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos", "bislerp"]

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

    @staticmethod
    def _resize(image, width, height, method):
        if image.shape[2] == width and image.shape[1] == height:
            return image
        return comfy.utils.common_upscale(
            image.movedim(-1, 1), int(width), int(height), method, "disabled"
        ).movedim(1, -1)

    @staticmethod
    def _match_batch(image, batch):
        if image.shape[0] == batch:
            return image
        if image.shape[0] == 1:
            return image.expand(batch, -1, -1, -1)
        return image[:batch]

    def resize_and_merge(self, original_image, processed_image, crop_info, upscale_method, cropped_mask=None):
        if not isinstance(crop_info, dict):
            raise ValueError("crop_info must be the output of MagicMaskCropResize")

        target_w, target_h = crop_info.get("target_size", (processed_image.shape[2], processed_image.shape[1]))
        processed = self._resize(processed_image, target_w, target_h, upscale_method)
        processed = self._match_batch(processed, original_image.shape[0])

        if crop_info.get("mask_empty", False):
            return (processed,)

        if original_image.ndim != 4 or processed.ndim != 4:
            raise ValueError("Images must have shape [B,H,W,C]")

        width, height = int(original_image.shape[2]), int(original_image.shape[1])
        x1, y1, x2, y2 = [int(v) for v in crop_info["crop_box"]]
        crop_w, crop_h = x2 - x1, y2 - y1
        if crop_w <= 0 or crop_h <= 0:
            return (original_image,)

        resized_crop = self._resize(processed, crop_w, crop_h, upscale_method)
        if cropped_mask is None:
            blend_mask = torch.ones(
                (original_image.shape[0], crop_h, crop_w), dtype=original_image.dtype, device=original_image.device
            )
        else:
            blend_mask = cropped_mask.to(device=original_image.device, dtype=original_image.dtype)
            if blend_mask.ndim == 2:
                blend_mask = blend_mask.unsqueeze(0)
            elif blend_mask.ndim == 4:
                blend_mask = blend_mask[:, 0]
            blend_mask = self._match_batch(blend_mask.unsqueeze(-1), original_image.shape[0]).squeeze(-1)
            blend_mask = comfy.utils.common_upscale(
                blend_mask.unsqueeze(1), crop_w, crop_h, "bilinear", "disabled"
            ).squeeze(1).clamp(0.0, 1.0)

        out = original_image.clone()
        ix1, iy1 = max(0, x1), max(0, y1)
        ix2, iy2 = min(width, x2), min(height, y2)
        if ix1 >= ix2 or iy1 >= iy2:
            return (out,)

        sx1, sy1 = ix1 - x1, iy1 - y1
        sx2, sy2 = sx1 + (ix2 - ix1), sy1 + (iy2 - iy1)
        source = resized_crop[:, sy1:sy2, sx1:sx2, :]
        alpha = blend_mask[:, sy1:sy2, sx1:sx2].unsqueeze(-1)
        out[:, iy1:iy2, ix1:ix2, :] = source * alpha + out[:, iy1:iy2, ix1:ix2, :] * (1.0 - alpha)
        return (out.clamp(0.0, 1.0),)
