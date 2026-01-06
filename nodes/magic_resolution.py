import torch
import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils

class MagicResolution:
    @classmethod
    def INPUT_TYPES(s):
        # 读取配置
        res_config = MagicUtils.get_resolutions_config()
        dims = res_config.get("dimensions", ["512x512", "512x768"])
        
        return {
            "required": {
                "dim_preset": (dims, ),
                "width_px": ("INT", {"default": 512, "min": 64, "max": 8192}),
                "height_px": ("INT", {"default": 512, "min": 64, "max": 8192}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    FUNCTION = "execute"
    CATEGORY = "✨ Magic Assistant"

    def execute(self, dim_preset, width_px, height_px, batch_size):
        # 直接使用输入框的值，不需要交换逻辑
        final_width = width_px
        final_height = height_px
        
        # 创建空latent（latent需要除以8）
        latent_width = final_width // 8
        latent_height = final_height // 8
        
        # 确保latent尺寸至少为1
        latent_width = max(1, latent_width)
        latent_height = max(1, latent_height)
        
        # 创建批次latent
        latent = torch.zeros([batch_size, 4, latent_height, latent_width])
        
        print(f"🔮 [Magic-Resolution] Output: {final_width}x{final_height} | Batch: {batch_size} | Latent: {latent_width}x{latent_height}")
        
        return (final_width, final_height, {"samples": latent})

