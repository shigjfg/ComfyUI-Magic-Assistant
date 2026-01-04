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

class MagicPhotopeaNode:
    OUTPUT_NODE = True 

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = []
        
        # 1. 扫描 input 根目录 (符合你的新需求)
        if os.path.exists(input_dir):
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            files = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'))]
        
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
        
        # 即使是文件名，也检测一下文件的实际修改时间
        try:
            image_path = folder_paths.get_annotated_filepath(image)
            return os.path.getmtime(image_path)
        except:
            return float(time.time())

    @classmethod
    def VALIDATE_INPUTS(s, image, **kwargs):
        return True

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

        # 3. 读取图片 (对齐官方 LoadImage 节点)
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
                
                # 遮罩提取
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