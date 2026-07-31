import hashlib
import os
import time

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import comfy.model_management
import folder_paths
import node_helpers
from comfy_api.latest import InputImpl
from server import PromptServer

class MagicPhotopeaNode:
    OUTPUT_NODE = True 

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = []
        
        # 1. 扫描 input 根目录 (符合你的新需求)
        if os.path.exists(input_dir):
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            files = folder_paths.filter_files_content_types(files, ["image"])
            # 杩囨护 mask editor 缂撳瓨鏂囦欢 (clipspace-painted-*.png / clipspace-mask-*.png / clipspace-paint-*.png)
            # 杩欎簺鏄疌omfyUI 闅旂紪杈戝櫒鐨勪腑闂寸紦瀛橈紝涓嶆槸鐢ㄦ埛鐨勫師鍥撅紝娓呯悊缂撳瓨鎸夐挳浼氫竴閿娓呴櫎
            files = [f for f in files if not f.lower().startswith("clipspace-")]
        
        # 按修改时间排序（最新的在最前）
        files.sort(key=lambda x: os.path.getmtime(os.path.join(input_dir, x)), reverse=True)
        
        if not files:
            files = ["canvas_empty.png"]

        return {
            "required": {
                # 参数名保持 "image" 以兼容官方遮罩编辑器
                "image": (files, {"image_upload": True}),
            },
            "optional": {
                "image_input": ("IMAGE", ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"
    CATEGORY = "✨ Magic Assistant"

    @classmethod
    def IS_CHANGED(s, image, image_input=None, **kwargs):
        # 如果有输入图像连接，每一帧都强制更新
        if image_input is not None:
            return float(time.time())

        if not image or image == "canvas_empty.png":
            return float(time.time())

        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, image, image_input=None, **kwargs):
        if image_input is not None or not image or image == "canvas_empty.png":
            return True

        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)

        return True

    @staticmethod
    def _load_with_official_pipeline(image_path):
        """Load IMAGE/MASK with the same pipeline used by ComfyUI's LoadImage."""
        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        components = InputImpl.VideoFromFile(image_path).get_components()
        if components.images.shape[0] > 0:
            output_image = components.images.to(device=device, dtype=dtype)
            output_mask = (
                (1.0 - components.alpha[..., -1]).to(device=device, dtype=dtype)
                if components.alpha is not None
                else torch.zeros(
                    (components.images.shape[0], 64, 64),
                    dtype=dtype,
                    device=device,
                )
            )
            return output_image, output_mask

        # Pillow fallback retained for animated WebP files unsupported by PyAV.
        img = node_helpers.pillow(Image.open, image_path)
        output_images = []
        output_masks = []
        w, h = None, None

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            image_frame = frame.convert("RGB")

            if len(output_images) == 0:
                w, h = image_frame.size
            if image_frame.size != (w, h):
                continue

            image_array = np.array(image_frame).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_array)[None,]
            if "A" in frame.getbands():
                alpha = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(alpha)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")

            output_images.append(image_tensor.to(dtype=dtype))
            output_masks.append(mask.unsqueeze(0).to(dtype=dtype))

        output_image = torch.cat(output_images, dim=0)
        output_mask = torch.cat(output_masks, dim=0)
        return (
            output_image.to(device=device, dtype=dtype),
            output_mask.to(device=device, dtype=dtype),
        )

    @staticmethod
    def _find_mask_editor_rgb_companion(image_path):
        """Return the full-RGB layer paired with a ComfyUI mask-editor PNG."""
        filename = os.path.basename(image_path)
        timestamp = None

        for prefix in ("clipspace-painted-masked-", "clipspace-mask-"):
            if filename.startswith(prefix) and filename.lower().endswith(".png"):
                timestamp = filename[len(prefix):-4]
                break

        if not timestamp:
            return None

        companion_path = os.path.join(
            os.path.dirname(image_path),
            f"clipspace-painted-{timestamp}.png",
        )
        return companion_path if os.path.isfile(companion_path) else None

    def load_image(self, image, image_input=None, unique_id=None, **kwargs):
        input_dir = folder_paths.get_input_directory()

        # --- A. 自动导入逻辑 (当有外部图片连入时) ---
        # 🌟 修改：现在直接保存到 input 根目录，不再存入子文件夹
        if image_input is not None:
            try:
                img_tensor = image_input[0] 
                i = 255. * img_tensor.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                # 命名带上时间戳防止覆盖
                new_filename = f"Import_{int(time.time())}.png"
                file_path = os.path.join(input_dir, new_filename)
                img.save(file_path)
                
                # 通知前端更新
                if unique_id:
                    PromptServer.instance.send_sync("magic_photopea_imported", {
                        "node_id": unique_id,
                        "filename": new_filename
                    })
                image = new_filename # 更新要读取的文件名
            except Exception as e:
                print(f"❌ [MagicPhotopea] Import failed: {e}")

        # --- B. 核心加载逻辑 ---
        # 🌟 修复：解决“黑图”问题的关键
        if not image or image == "canvas_empty.png":
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        image_path = None
        
        # 1. 优先：使用官方 API 获取路径 (兼容 clipspace 和 input)
        try:
            image_path = folder_paths.get_annotated_filepath(image)
        except Exception:
            # 2. 备选：如果在 input 根目录直接拼接
            potential_path = os.path.join(input_dir, image)
            if os.path.exists(potential_path):
                image_path = potential_path

        # 如果还是找不到，打印错误并返回黑图
        if not image_path or not os.path.exists(image_path):
            print(f"⚠️ [MagicPhotopea] Image file not found: {image}")
            # 返回黑色占位图，防止工作流报错崩溃
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        # 3. 使用与官方 LoadImage 相同的解码路径。
        try:
            output_image, output_mask = self._load_with_official_pipeline(image_path)

            # 新版官方遮罩编辑器把透明区 RGB 写成黑色，同时另存一张
            # clipspace-painted-*.png 保存完整 RGB。若检测到这组文件，IMAGE
            # 使用完整 RGB，MASK 仍使用 masked PNG 的 alpha，避免遮罩残影。
            rgb_companion_path = self._find_mask_editor_rgb_companion(image_path)
            if rgb_companion_path:
                companion_image, _ = self._load_with_official_pipeline(rgb_companion_path)
                if companion_image.shape == output_image.shape:
                    output_image = companion_image
                else:
                    print(
                        "⚠️ [MagicPhotopea] Mask-editor RGB companion shape mismatch: "
                        f"{companion_image.shape} != {output_image.shape}"
                    )

            return output_image, output_mask

        except Exception as e:
            print(f"❌ [MagicPhotopea] Read Error: {e}")
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))