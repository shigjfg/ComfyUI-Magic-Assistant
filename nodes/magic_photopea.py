import os
import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence
import folder_paths
import time
from server import PromptServer

# 🌟 引入 ComfyUI 官方节点辅助工具
try:
    import node_helpers
except ImportError:
    node_helpers = None

# 1. 定义目录
MAGIC_PHOTOPEA_DIR = "magic_photopea"
input_dir = folder_paths.get_input_directory()
save_path = os.path.join(input_dir, MAGIC_PHOTOPEA_DIR)
default_input_path = input_dir

if not os.path.exists(save_path):
    os.makedirs(save_path)

class MagicPhotopeaNode:
    OUTPUT_NODE = True 

    @classmethod
    def INPUT_TYPES(s):
        files = []
        # 扫描 magic_photopea 和 input 目录
        if os.path.exists(save_path):
            files += [f for f in os.listdir(save_path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
        if os.path.exists(default_input_path):
            files += [f for f in os.listdir(default_input_path) if os.path.isfile(os.path.join(default_input_path, f)) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]

        files = list(set(files))
        # 按修改时间排序
        files.sort(key=lambda x: s._get_file_mtime(x), reverse=True)
        
        if not files:
            files = ["canvas_empty.png"]

        return {
            "required": {
                # 🌟 核心修改：为了兼容官方遮罩编辑器，名字必须叫 "image"
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

    @staticmethod
    def _get_file_mtime(filename):
        # 辅助函数：获取文件时间（优先看 magic_photopea 目录）
        p1 = os.path.join(save_path, filename)
        if os.path.exists(p1): return os.path.getmtime(p1)
        p2 = os.path.join(default_input_path, filename)
        if os.path.exists(p2): return os.path.getmtime(p2)
        return 0

    @classmethod
    def IS_CHANGED(s, image, image_input=None, **kwargs):
        if image_input is not None:
            return float(time.time())
        # 🌟 使用官方 API 检测 clipspace 路径的变化
        try:
            image_path = folder_paths.get_annotated_filepath(image)
            return os.path.getmtime(image_path)
        except:
            return s._get_file_mtime(image)

    @classmethod
    def VALIDATE_INPUTS(s, image, **kwargs):
        # 必须返回 True，允许 "clipspace/..." 这种不在列表里的文件名通过
        return True

    # 🌟 核心修改：参数名改为 image
    def load_image(self, image, image_input=None, unique_id=None, **kwargs):
        # --- A. 自动导入逻辑 ---
        if image_input is not None:
            try:
                img_tensor = image_input[0] 
                i = 255. * img_tensor.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                new_filename = f"Import_{int(time.time())}.png"
                file_path = os.path.join(save_path, new_filename)
                img.save(file_path)
                
                if unique_id:
                    PromptServer.instance.send_sync("magic_photopea_imported", {
                        "node_id": unique_id,
                        "filename": new_filename
                    })
                image = new_filename # 更新文件名
            except Exception as e:
                print(f"❌ [MagicPhotopea] Import failed: {e}")

        # --- B. 核心加载逻辑 (完全对齐官方 SimpleLoadImage) ---
        if not image or image == "canvas_empty.png":
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        image_path = None
        
        # 1. 优先尝试使用官方 API 查找路径 (解决 clipspace 问题的关键)
        try:
            image_path = folder_paths.get_annotated_filepath(image)
        except Exception:
            # 2. 如果官方 API 找不到，尝试手动查找 magic_photopea 目录
            manual_path = os.path.join(save_path, image)
            if os.path.exists(manual_path):
                image_path = manual_path

        if not image_path or not os.path.exists(image_path):
            # 最后的保底：看看是不是在 input 根目录
            fallback_path = os.path.join(default_input_path, image)
            if os.path.exists(fallback_path):
                image_path = fallback_path
            else:
                print(f"⚠️ [MagicPhotopea] Image not found: {image}")
                return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        # 3. 使用 node_helpers 打开图片
        try:
            if node_helpers:
                img = node_helpers.pillow(Image.open, image_path)
            else:
                img = Image.open(image_path)
            
            output_images = []
            output_masks = []

            for i in ImageSequence.Iterator(img):
                if node_helpers:
                    i = node_helpers.pillow(ImageOps.exif_transpose, i)
                else:
                    i = ImageOps.exif_transpose(i)

                if i.mode == 'I':
                    i = i.point(lambda i: i * (1 / 255))
                
                img_rgb = i.convert("RGB")
                img_np = np.array(img_rgb).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(img_np)[None,]
                
                # 🌟 4. 官方遮罩提取算法
                if 'A' in i.getbands():
                    mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                    mask = 1. - torch.from_numpy(mask)
                elif 'transparency' in i.info:
                    mask = np.array(i.convert('RGBA').getchannel('A')).astype(np.float32) / 255.0
                    mask = 1. - torch.from_numpy(mask)
                else:
                    mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
                    
                output_images.append(image_tensor)
                output_masks.append(mask.unsqueeze(0))

            if len(output_images) > 1:
                output_image = torch.cat(output_images, dim=0)
                output_mask = torch.cat(output_masks, dim=0)
            else:
                output_image = output_images[0]
                output_mask = output_masks[0]

            return (output_image, output_mask)

        except Exception as e:
            print(f"❌ [MagicPhotopea] Read Error: {e}")
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))