import os
import sys

import comfy.utils

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils

class MagicResolutionResize:
    @classmethod
    def INPUT_TYPES(s):
        # 读取配置
        res_config = MagicUtils.get_resolutions_config()
        presets = res_config.get("presets", [512, 768, 1024])
        # 读取新增的尺寸预设
        dims = res_config.get("dimensions", ["512x512", "512x768"])
        
        return {
            "required": {
                "mode": (["✨ 长边预设 (Long Edge)", "🔢 按比例 (Ratio)", "📐 指定尺寸 (Dimensions)"],),
                
                # 模式1参数
                "resolution": (presets, {"default": 1024}), 
                
                # 模式2参数
                "scale_ratio": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 8.0, "step": 0.05}),
                
                # 模式3参数：新增 dimension_preset 放在宽/高前面
                # 注意：这个下拉菜单只是给前端JS用的“快捷方式”，后端不直接读取它
                "dim_preset": (dims, ), 
                "width_px": ("INT", {"default": 512, "min": 64, "max": 8192}),
                "height_px": ("INT", {"default": 512, "min": 64, "max": 8192}),

                "method": (["nearest-exact", "bilinear", "area", "bicubic", "lanczos", "bislerp"], {"default": "bicubic"}), 
            },
            "optional": {
                "image": ("IMAGE",),
                "latent": ("LATENT",),
            }
        }

    RETURN_TYPES = ("IMAGE", "LATENT")
    RETURN_NAMES = ("IMAGE", "LATENT")
    FUNCTION = "execute"
    CATEGORY = "✨ Magic Assistant"

    def calculate_new_size(self, mode, h, w, resolution, ratio, width_input, height_input, is_latent=False):
        new_w, new_h = w, h
        div = 8 if is_latent else 1

        if "Long Edge" in mode:
            target_res = int(resolution) // div
            target_res = max(1, target_res)
            scale = float(target_res) / max(h, w)
            new_h = int(h * scale)
            new_w = int(w * scale)

        elif "Ratio" in mode:
            new_w = int(w * ratio)
            new_h = int(h * ratio)

        elif "Dimensions" in mode:
            # 模式3直接用 width_px 和 height_px
            # dim_preset 只是前端辅助，后端不需要管它
            new_w = width_input // div
            new_h = height_input // div

        new_w = max(1, (new_w // 2) * 2) if not is_latent else max(1, new_w)
        new_h = max(1, (new_h // 2) * 2) if not is_latent else max(1, new_h)

        return new_h, new_w

    def execute(self, mode, resolution, scale_ratio, dim_preset, width_px, height_px, method, image=None, latent=None):
        ret_image = None
        ret_latent = None

        if image is not None:
            _, h, w, _ = image.shape
            new_h, new_w = self.calculate_new_size(mode, h, w, resolution, scale_ratio, width_px, height_px, False)

            if new_h != h or new_w != w:
                print(f"🔮 [Magic-Resize] Image: {w}x{h} -> {new_w}x{new_h} | Mode: {mode}")
                samples = image.movedim(-1, 1)
                ret_image = comfy.utils.common_upscale(
                    samples,
                    new_w,
                    new_h,
                    method,
                    "disabled",
                ).movedim(1, -1)
            else:
                ret_image = image

        if latent is not None:
            samples = latent["samples"]
            _, _, h, w = samples.shape
            new_h, new_w = self.calculate_new_size(mode, h, w, resolution, scale_ratio, width_px, height_px, True)

            if new_h != h or new_w != w:
                print(f"🔮 [Magic-Resize] Latent: {w}x{h} -> {new_w}x{new_h}")
                ret_latent = latent.copy()
                ret_latent["samples"] = comfy.utils.common_upscale(
                    samples,
                    new_w,
                    new_h,
                    method,
                    "disabled",
                )
            else:
                ret_latent = latent

        return (ret_image, ret_latent)