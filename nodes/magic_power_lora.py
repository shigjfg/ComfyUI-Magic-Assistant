import torch
import os
import json
import folder_paths
import comfy.sd
import comfy.utils
from server import PromptServer
from aiohttp import web
import numpy as np
from PIL import Image
import hashlib
import urllib.request
import urllib.error
import urllib.parse
import re
import shutil
import time

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils

class MagicPowerLoraLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora_stack": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING")
    RETURN_NAMES = ("model", "clip", "lora_preview", "tags_output")
    OUTPUT_IS_LIST = (False, False, True, False)  # IMAGE是列表输出（图片组）
    FUNCTION = "apply_loras"
    CATEGORY = "✨ Magic Assistant"

    # 🌟 核心修复：更强大的图片查找逻辑（优先查找magicloradate子目录）
    @staticmethod
    def get_preview_path(lora_name):
        try:
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if lora_path is None: return None
            
            dirname = os.path.dirname(lora_path)
            filename_no_ext = os.path.splitext(os.path.basename(lora_path))[0]
            base_name = os.path.splitext(lora_path)[0]
            
            # 图片扩展名候选列表
            candidates = [".png", ".jpg", ".jpeg", ".webp"]
            candidates += [".preview.png", ".preview.jpg", ".cover.png", ".cover.jpg"]
            
            # 1. 优先检查 magicloradate 子目录（参考zml代码的zml子目录优先逻辑）
            magicloradate_dir = os.path.join(dirname, "magicloradate")
            if os.path.isdir(magicloradate_dir):
                for ext in candidates:
                    sub_path = os.path.join(magicloradate_dir, filename_no_ext + ext)
                    if os.path.exists(sub_path):
                        return sub_path
            
            # 2. 如果magicloradate子目录没有，检查同层级
            for ext in candidates:
                if os.path.exists(base_name + ext):
                    return base_name + ext
                
            return None
        except Exception:
            return None

    def apply_loras(self, model, clip, lora_stack):
        out_model = model
        out_clip = clip
        active_tags = []
        preview_images = []  # 改为列表，收集所有预览图

        try:
            if not isinstance(lora_stack, str) or not lora_stack.strip():
                stack_data = []
            else:
                stack_data = json.loads(lora_stack)
        except:
            stack_data = []

        items_to_process = []
        if isinstance(stack_data, dict):
            if "folders" in stack_data:
                for f in stack_data["folders"]:
                    if f.get("loras"):
                        items_to_process.extend([l for l in f["loras"] if l.get("enabled", True)])
            if "loras" in stack_data:
                items_to_process.extend([l for l in stack_data["loras"] if l.get("enabled", True)])
        elif isinstance(stack_data, list):
            items_to_process = [l for l in stack_data if l.get("enabled", True)]

        print(f"🚀 [MagicPowerLora] Processing {len(items_to_process)} Loras...")

        for item in items_to_process:
            lora_name = item.get("name")
            weight = float(item.get("weight", 1.0))
            if not lora_name: continue

            lora_path = folder_paths.get_full_path("loras", lora_name)
            if lora_path is None:
                print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                continue

            try:
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                out_model, out_clip = comfy.sd.load_lora_for_models(out_model, out_clip, lora, weight, weight)
                print(f"   ✅ Applied: {lora_name}")
            except Exception as e:
                print(f"   ❌ Failed: {lora_name} -> {e}")

            if "tags" in item and item["tags"]:
                active_tags.append(str(item["tags"]))

            # 为每个lora尝试加载预览图
            img_path = self.get_preview_path(lora_name)
            if img_path:
                try:
                    i = Image.open(img_path).convert("RGB")
                    i = np.array(i).astype(np.float32) / 255.0
                    preview_tensor = torch.from_numpy(i)[None,]
                    preview_images.append(preview_tensor)
                except Exception as e:
                    print(f"   ⚠️ Failed to load preview for {lora_name}: {e}")

        # 如果没有找到任何预览图，返回一个占位图
        if not preview_images:
            preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]

        final_text = ", ".join(active_tags)
        return (out_model, out_clip, preview_images, final_text)

# --- API 接口 ---

@PromptServer.instance.routes.get("/ma/lora/list")
async def get_lora_list(request):
    try:
        lora_names = folder_paths.get_filename_list("loras")
        return web.json_response({"files": lora_names})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})

@PromptServer.instance.routes.get("/ma/lora/images")
async def get_lora_images(request):
    """获取所有LoRA文件及其对应的预览图的映射（优先查找magicloradate子目录）"""
    try:
        lora_files = folder_paths.get_filename_list("loras")
        images = {}
        
        for lora_filename in lora_files:  # lora_filename is like "subdir/mylora.safetensors"
            lora_full_path = folder_paths.get_full_path("loras", lora_filename)
            if not lora_full_path:
                continue

            lora_dir = os.path.dirname(lora_full_path)
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_filename))[0]
            
            # 优先在 magicloradate 子目录查找预览图，若无则查找同层级（magicloradate > 同层级）
            magicloradate_dir = os.path.join(lora_dir, "magicloradate")
            found = False
            
            # 先检查magicloradate子目录
            for ext in [".png", ".jpg", ".jpeg", ".webp"]:
                preview_path_magic = os.path.join(magicloradate_dir, f"{lora_basename_no_ext}{ext}")
                if os.path.isfile(preview_path_magic):
                    lora_dir_relative = os.path.dirname(lora_filename)  # e.g. "subdir"
                    preview_basename = os.path.basename(preview_path_magic)  # e.g. "mylora.png"
                    relative_path_for_frontend = os.path.join(lora_dir_relative, preview_basename).replace("\\", "/")
                    images[lora_filename] = relative_path_for_frontend
                    found = True
                    break
            
            # 如果magicloradate子目录没有找到，检查同层级
            if not found:
                for ext in [".png", ".jpg", ".jpeg", ".webp"]:
                    preview_path_same = os.path.join(lora_dir, f"{lora_basename_no_ext}{ext}")
                    if os.path.isfile(preview_path_same):
                        lora_dir_relative = os.path.dirname(lora_filename)  # e.g. "subdir"
                        preview_basename = os.path.basename(preview_path_same)  # e.g. "mylora.png"
                        relative_path_for_frontend = os.path.join(lora_dir_relative, preview_basename).replace("\\", "/")
                        images[lora_filename] = relative_path_for_frontend
                        break
            
        return web.json_response(images)
    except Exception as e:
        print(f"获取LoRA图片列表时出错: {e}")
        return web.json_response({})

@PromptServer.instance.routes.get("/ma/lora/image")
async def get_lora_image(request):
    try:
        name = request.query.get("name")
        if not name: return web.Response(status=404)
        
        img_path = MagicPowerLoraLoader.get_preview_path(name)
        if img_path and os.path.exists(img_path):
            return web.FileResponse(img_path)
        
        return web.Response(status=404)
    except Exception as e:
        print(f"❌ Image API Error: {e}")
        return web.Response(status=500)

def get_preset_dir():
    target_dir = os.path.join(MagicUtils.USER_DIR, "lora_presets")
    if not os.path.exists(target_dir): os.makedirs(target_dir, exist_ok=True)
    return target_dir

@PromptServer.instance.routes.post("/ma/lora/save_preset")
async def save_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        content = data.get("content")
        if not preset_name or not content: return web.json_response({"status": "error"})
        
        file_path = os.path.join(get_preset_dir(), f"{preset_name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=4, ensure_ascii=False)
        return web.json_response({"status": "success"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.get("/ma/lora/get_presets")
async def get_presets(request):
    try:
        preset_dir = get_preset_dir()
        files = [f for f in os.listdir(preset_dir) if f.endswith(".json")]
        presets = {}
        for f in files:
            try:
                with open(os.path.join(preset_dir, f), 'r', encoding='utf-8') as pf:
                    presets[f.replace(".json", "")] = json.load(pf)
            except: pass
        return web.json_response({"presets": presets})
    except Exception as e: return web.json_response({"presets": {}, "error": str(e)})

@PromptServer.instance.routes.post("/ma/lora/delete_preset")
async def delete_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        if not preset_name: return web.json_response({"status": "error", "message": "缺少预设名称"})
        
        preset_dir = get_preset_dir()
        file_path = os.path.join(preset_dir, f"{preset_name}.json")
        
        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success", "message": f"预设 '{preset_name}' 已删除"})
        else:
            return web.json_response({"status": "error", "message": "预设文件不存在"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

# --- 爬取功能辅助函数 ---

def clean_html(raw_html):
    """清理HTML标签"""
    if not raw_html:
        return ""
    text = re.sub(r'</p>|<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    text = re.sub(r'<.*?>', '', text)
    text = re.sub(r'\n\s*\n', '\n', text).strip()
    return text

def calculate_sha256(filepath):
    """计算文件SHA256哈希值"""
    sha256 = hashlib.sha256()
    chunk_size = 65536
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()

def fetch_civitai_data_by_hash(hash_string, max_retries=3, api_delay=0.5):
    """从Civitai API获取数据（带重试机制）"""
    for attempt in range(max_retries):
        try:
            url = f"https://civitai.com/api/v1/model-versions/by-hash/{hash_string}"
            if attempt > 0:
                time.sleep(api_delay * (2 ** attempt))
            else:
                time.sleep(api_delay)
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    model_url = f"https://civitai.com/api/v1/models/{data['modelId']}"
                    model_req = urllib.request.Request(model_url, headers=headers)
                    with urllib.request.urlopen(model_req, timeout=30) as model_response:
                        if model_response.status == 200:
                            data['model'] = json.loads(model_response.read().decode('utf-8'))
                        else:
                            data['model'] = {}
                    return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(api_delay * (2 ** attempt))
                continue
            elif e.code == 404:
                return None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(api_delay * (2 ** attempt))
    return None

def download_file(url, destination_path):
    """下载文件，如果是视频则提取第一帧"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status == 200:
                content_type = response.getheader('Content-Type', '')
                is_video = content_type.startswith('video/') or url.lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))
                
                if is_video and CV2_AVAILABLE:
                    video_path = destination_path + ".temp.mp4"
                    with open(video_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    
                    cap = cv2.VideoCapture(video_path)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret:
                            img_ext = os.path.splitext(destination_path)[1].lower()
                            if img_ext not in ['.png', '.jpg', '.jpeg', '.webp']:
                                destination_path = os.path.splitext(destination_path)[0] + '.jpg'
                            cv2.imwrite(destination_path, frame)
                            cap.release()
                            try:
                                os.remove(video_path)
                            except:
                                pass
                            return True
                        cap.release()
                    try:
                        os.remove(video_path)
                    except:
                        pass
                    return False
                else:
                    with open(destination_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    return True
    except Exception as e:
        print(f"下载文件时出错 {url}: {e}")
    return False

def extract_lora_weight_from_civitai_data(civitai_data, lora_filename):
    """从Civitai数据中提取LoRA的推荐权重值"""
    try:
        lora_basename = os.path.splitext(lora_filename)[0].lower()
        images = civitai_data.get('images', [])
        for image in images:
            meta = image.get('meta', {})
            resources = meta.get('resources', [])
            for resource in resources:
                resource_name = resource.get('name', '').lower()
                resource_weight = resource.get('weight')
                if (resource_name and resource_weight is not None and 
                    (lora_basename in resource_name or resource_name in lora_basename)):
                    return float(resource_weight)
        return None
    except Exception as e:
        print(f"提取权重信息时出错: {e}")
        return None

@PromptServer.instance.routes.post("/ma/lora/fetch_metadata")
async def fetch_metadata(request):
    """爬取LoRA元数据"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name")
        options = data.get("options", {})
        save_path_mode = data.get("save_path_mode", "same_dir")  # "same_dir" or "subfolder"
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        download_txt = options.get("download_txt", True)
        download_json = options.get("download_json", True)
        download_image = options.get("download_image", True)
        download_log = options.get("download_log", True)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        # 确定保存目录
        if save_path_mode == "subfolder":
            save_dir = os.path.join(lora_dir, "magicloradate")
            os.makedirs(save_dir, exist_ok=True)
        else:
            save_dir = lora_dir
        
        # 计算哈希并获取Civitai数据
        file_hash = calculate_sha256(lora_path)
        civitai_data = fetch_civitai_data_by_hash(file_hash)
        
        result = {
            "status": "success",
            "message": [],
            "data": {
                "triggerWords": "",
                "jsonInfo": "",
                "logInfo": ""
            }
        }
        
        if not civitai_data:
            result["message"].append("无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）")
            return web.json_response(result)
        
        model_name = civitai_data.get('model', {}).get('name', 'Unknown')
        result["message"].append(f"已从Civitai获取到 '{model_name}' 的信息")
        
        # 保存触发词文件
        if download_txt and civitai_data.get('trainedWords'):
            words_content = ", ".join(civitai_data['trainedWords'])
            txt_path = os.path.join(save_dir, f"{lora_basename}.txt")
            try:
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(words_content)
                result["data"]["triggerWords"] = words_content
                result["message"].append("触发词已保存")
            except Exception as e:
                result["message"].append(f"触发词保存失败: {e}")
        
        # 保存介绍信息（JSON格式）
        if download_json:
            raw_model_desc = civitai_data.get('model', {}).get('description', '')
            raw_version_desc = civitai_data.get('description', '')
            model_desc = clean_html(raw_model_desc)
            version_desc = clean_html(raw_version_desc)
            base_model = civitai_data.get('baseModel', 'N/A')
            model_id = civitai_data.get('modelId')
            version_id = civitai_data.get('id')
            civitai_link = f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id and version_id else "链接不可用"
            
            json_content = (
                f"--- 基础信息 ---\n"
                f"基础模型: {base_model}\n"
                f"C站链接: {civitai_link}\n\n"
                f"--- 模型介绍 ---\n\n{model_desc if model_desc else '无模型介绍。'}\n\n"
                f"--- 版本信息 ---\n\n{version_desc if version_desc else '无版本信息。'}\n"
            )
            json_path = os.path.join(save_dir, f"{lora_basename}.json")
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    f.write(json_content)
                result["data"]["jsonInfo"] = json_content
                result["message"].append("介绍信息已保存")
            except Exception as e:
                result["message"].append(f"介绍信息保存失败: {e}")
        
        # 保存预览图像
        if download_image and civitai_data.get('images'):
            first_image = civitai_data['images'][0]
            img_url = first_image.get('url')
            if img_url:
                img_ext = os.path.splitext(urllib.parse.urlparse(img_url).path)[1]
                if not img_ext or img_ext.lower() not in ['.png', '.jpg', '.jpeg', '.webp']:
                    img_ext = '.jpg'
                img_path = os.path.join(save_dir, f"{lora_basename}{img_ext}")
                if download_file(img_url, img_path):
                    result["message"].append("预览图像已保存")
                else:
                    result["message"].append("预览图像保存失败")
        
        # 保存默认权重到.log文件
        if download_log:
            preferred_weight = extract_lora_weight_from_civitai_data(civitai_data, os.path.basename(lora_path))
            if preferred_weight is not None:
                log_path = os.path.join(save_dir, f"{lora_basename}.log")
                log_content = f'''{{
"description": "",
"sd version": "",
"activation text": "",
"preferred weight": {preferred_weight},
"negative text": "",
"notes": ""
}}'''
                try:
                    with open(log_path, 'w', encoding='utf-8') as f:
                        f.write(log_content)
                    result["data"]["logInfo"] = log_content
                    result["message"].append(f"默认权重已保存: {preferred_weight}")
                except Exception as e:
                    result["message"].append(f"默认权重保存失败: {e}")
            else:
                result["message"].append("未找到匹配的权重信息")
        
        result["message"] = "\n".join(result["message"])
        return web.json_response(result)
        
    except Exception as e:
        print(f"爬取元数据时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/probe_save_targets")
async def probe_save_targets(request):
    """探测指定LoRA的保存位置可用性（优先检查magicloradate子目录）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        magicloradate_dir_exists = os.path.isdir(magicloradate_dir)
        
        def check_file(path):
            return os.path.exists(path) and os.access(path, os.R_OK)
        
        same_txt = os.path.join(lora_dir, f"{lora_basename}.txt")
        same_json = os.path.join(lora_dir, f"{lora_basename}.json")
        same_log = os.path.join(lora_dir, f"{lora_basename}.log")
        
        magic_txt = os.path.join(magicloradate_dir, f"{lora_basename}.txt")
        magic_json = os.path.join(magicloradate_dir, f"{lora_basename}.json")
        magic_log = os.path.join(magicloradate_dir, f"{lora_basename}.log")
        
        same_files = {
            "txt": check_file(same_txt),
            "json": check_file(same_json),
            "log": check_file(same_log),
        }
        magic_files = {
            "txt": check_file(magic_txt),
            "json": check_file(magic_json),
            "log": check_file(magic_log),
        }
        
        result = {
            "status": "success",
            "magicloradate_dir_exists": magicloradate_dir_exists,
            "magicloradate_files": magic_files,
            "same_files": same_files,
            "magicloradate_has_readable": any(magic_files.values()),
            "same_has_readable": any(same_files.values()),
        }
        
        return web.json_response(result)
        
    except Exception as e:
        print(f"探测保存位置时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/save_lora_file")
async def save_lora_file(request):
    """保存指定LoRA文件的内容（支持保存到magicloradate子目录或同层级）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        content = data.get("content", "")
        target = str(data.get("target", "same")).lower()
        target = "magicloradate" if target == "magicloradate" or target == "subfolder" else "same"
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        if target == "magicloradate":
            file_path = os.path.join(lora_dir, "magicloradate", f"{lora_basename}{file_ext}")
        else:
            file_path = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        # 自动创建目录（如果不存在）
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return web.json_response({"status": "success", "message": f"{file_type}文件保存成功"})
        
    except Exception as e:
        print(f"保存LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/get_lora_file")
async def get_lora_file(request):
    """获取指定LoRA文件的内容（优先从magicloradate子目录读取）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        # 优先从magicloradate子目录读取，若无则从同层级读取
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        file_path_magic = os.path.join(magicloradate_dir, f"{lora_basename}{file_ext}")
        file_path_same = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        target_file = None
        if os.path.exists(file_path_magic):
            target_file = file_path_magic
        elif os.path.exists(file_path_same):
            target_file = file_path_same
        else:
            # 如果文件不存在，返回空内容
            return web.json_response({"status": "success", "content": ""})
        
        with open(target_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return web.json_response({"status": "success", "content": content})
        
    except Exception as e:
        print(f"读取LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/delete_lora_complete")
async def delete_lora_complete(request):
    """一键删除LoRA文件及其所有相关文件"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        deleted_files = []
        
        # 删除主LoRA文件
        try:
            os.remove(lora_path)
            deleted_files.append(os.path.basename(lora_path))
        except Exception as e:
            return web.json_response({"status": "error", "message": f"无法删除主LoRA文件: {e}"}, status=500)
        
        # 删除同目录下的相关文件
        for ext in ['.txt', '.json', '.log', '.png', '.jpg', '.jpeg', '.webp']:
            file_path = os.path.join(lora_dir, f"{lora_basename}{ext}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
        
        # 删除magicloradate子文件夹中的文件
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        if os.path.exists(magicloradate_dir):
            import glob
            pattern = os.path.join(magicloradate_dir, f"{lora_basename}.*")
            for file_path in glob.glob(pattern):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
            
            # 如果magicloradate目录为空，删除它
            if os.path.exists(magicloradate_dir) and not os.listdir(magicloradate_dir):
                try:
                    os.rmdir(magicloradate_dir)
                except Exception as e:
                    print(f"删除空目录时出错: {e}")
        
        return web.json_response({
            "status": "success",
            "message": f"成功删除 {len(deleted_files)} 个文件",
            "deleted_files": deleted_files
        })
        
    except Exception as e:
        print(f"删除LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)