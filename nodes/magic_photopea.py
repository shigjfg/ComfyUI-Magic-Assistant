import os
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths
import time
from server import PromptServer

# 1. 定义两个关键目录
# A. 我们的专用目录
MAGIC_PHOTOPEA_DIR = "magic_photopea"
input_dir = folder_paths.get_input_directory()
save_path = os.path.join(input_dir, MAGIC_PHOTOPEA_DIR)

# B. ComfyUI 默认上传目录 (Load Image 用的就是这个)
default_input_path = input_dir

if not os.path.exists(save_path):
    os.makedirs(save_path)

class MagicPhotopeaNode:
    OUTPUT_NODE = True 

    @classmethod
    def INPUT_TYPES(s):
        # --- 扫描文件列表 ---
        files = []
        
        # 1. 扫描 magic_photopea 文件夹 (Photopea 保存的图)
        if os.path.exists(save_path):
            files += [f for f in os.listdir(save_path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
            
        # 2. 扫描 input 根目录 (用户通过上传按钮传的图)
        if os.path.exists(default_input_path):
            files += [f for f in os.listdir(default_input_path) if os.path.isfile(os.path.join(default_input_path, f)) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]

        # 去重并排序 (按修改时间倒序，新图在前面)
        # 注意：如果有同名文件，优先显示最近修改的，但在加载时我们需要定一个优先级
        files = list(set(files))
        files.sort(key=lambda x: s._get_file_mtime(x), reverse=True)
        
        if not files:
            files = ["canvas_empty.png"]

        return {
            "required": {
                # 🌟 核心修改：添加 {"image_upload": True} 开启上传按钮
                "image_selection": (files, {"image_upload": True}),
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
        # 辅助函数：尝试在两个目录里找文件获取时间
        p1 = os.path.join(save_path, filename)
        if os.path.exists(p1): return os.path.getmtime(p1)
        p2 = os.path.join(default_input_path, filename)
        if os.path.exists(p2): return os.path.getmtime(p2)
        return 0

    def load_image(self, image_selection, image_input=None, unique_id=None, **kwargs):
        # --- 1. 自动导入逻辑 (来自其他节点) ---
        if image_input is not None:
            try:
                img_tensor = image_input[0] 
                i = 255. * img_tensor.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                # 保存到 magic_photopea 目录
                new_filename = f"Import_{int(time.time())}.png"
                file_path = os.path.join(save_path, new_filename)
                img.save(file_path)
                print(f"🔮 [MagicPhotopea] Auto-imported: {new_filename}")
                
                # 通知前端刷新
                if unique_id:
                    PromptServer.instance.send_sync("magic_photopea_imported", {
                        "node_id": unique_id,
                        "filename": new_filename
                    })

                image_selection = new_filename
            except Exception as e:
                print(f"❌ [MagicPhotopea] Import failed: {e}")

        # --- 2. 加载图片逻辑 (支持双目录查找) ---
        if not image_selection or image_selection == "canvas_empty.png":
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        # 🌟 优先级 A: 先找 magic_photopea 目录 (编辑过的图)
        target_path = os.path.join(save_path, image_selection)
        
        # 🌟 优先级 B: 如果找不到，找 input 根目录 (上传的图)
        if not os.path.exists(target_path):
            target_path = os.path.join(default_input_path, image_selection)

        # 如果还是找不到 (比如文件被删了)
        if not os.path.exists(target_path):
             print(f"⚠️ [MagicPhotopea] Image not found: {image_selection}")
             return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

        # 标准加载流程
        try:
            i = Image.open(target_path)
            i = ImageOps.exif_transpose(i)
            
            if 'A' in i.getbands():
                mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = 1.0 - mask
            else:
                mask = torch.zeros((1, 64, 64), dtype=torch.float32, device="cpu")

            image = i.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            
            if len(mask.shape) == 2:
                mask = mask.unsqueeze(0)
                
            return (image, mask)
        except Exception as e:
            print(f"❌ [MagicPhotopea] Read Error: {e}")
            return (torch.zeros((1, 512, 512, 3)), torch.zeros((1, 512, 512)))

    @classmethod
    def IS_CHANGED(s, image_selection, image_input=None, **kwargs):
        if image_input is not None:
            return float(time.time())
        # 检测文件修改时间
        if image_selection:
            return s._get_file_mtime(image_selection)
        return False

    @classmethod
    def VALIDATE_INPUTS(s, **kwargs):
        return True