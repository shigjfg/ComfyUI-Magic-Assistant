import os
import json
import shutil
from server import PromptServer
from aiohttp import web
import folder_paths  # 👈 新增引入：用于获取 ComfyUI 标准路径

# --- 1. 路径定义 ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_DIR = os.path.join(BASE_DIR, "savedata")
USER_DIR = os.path.join(BASE_DIR, "userdata")

# --- 2. 默认数据 ---
DEFAULT_LLM = {
    "Default OpenAI": {
        "name": "Default OpenAI",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-3.5-turbo"
    }
}

DEFAULT_LOGICS = {}

DEFAULT_RESOLUTIONS = {
    "presets": [512, 768, 832, 960, 1024, 1152, 1280, 1536, 2048],
    "dimensions": [
        "SDXL_1024x1024", "SDXL_1152x896", "SDXL_896x1152", "SDXL_1216x832", 
        "SDXL_832x1216", "SDXL_1344x768", "SDXL_768x1344", "SDXL_1536x640", 
        "SDXL_640x1536", "2K_1024x1536", "2K_1536x1024", 
        "SD1.5_512x512", "SD1.5_512x768", "SD1.5_768x512"
    ]
}

class MagicUtils:
    # --- 3. 核心工具方法 ---

    @classmethod
    def ensure_user_dir(cls):
        """确保 userdata 文件夹存在"""
        if not os.path.exists(USER_DIR):
            os.makedirs(USER_DIR)

    @classmethod
    def _load_dual_data(cls, filename, default_fallback=None):
        """双向读取逻辑: Savedata (预设) + Userdata (私有)"""
        data = {}
        
        if default_fallback and isinstance(default_fallback, dict):
            data.update(default_fallback)

        preset_path = os.path.join(PRESET_DIR, filename)
        if os.path.exists(preset_path):
            try:
                with open(preset_path, 'r', encoding='utf-8') as f:
                    preset_data = json.load(f)
                    if isinstance(preset_data, dict):
                        data.update(preset_data)
            except Exception as e:
                print(f"⚠️ [MagicUtils] Load Preset Error ({filename}): {e}")

        user_path = os.path.join(USER_DIR, filename)
        if os.path.exists(user_path):
            try:
                with open(user_path, 'r', encoding='utf-8') as f:
                    user_data = json.load(f)
                    if isinstance(user_data, dict):
                        data.update(user_data)
            except Exception as e:
                print(f"⚠️ [MagicUtils] Load UserData Error ({filename}): {e}")
        
        return data

    @classmethod
    def _save_user_data(cls, filename, data):
        """保存数据 -> 强制保存到 userdata"""
        cls.ensure_user_dir()
        file_path = os.path.join(USER_DIR, filename)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"🔮 [MagicUtils] Saved to privacy folder: {file_path}")

    # --- 4. 对外接口 ---
    @classmethod
    def get_llm_config(cls): return cls._load_dual_data("llm_settings.txt", DEFAULT_LLM)
    @classmethod
    def get_rules_config(cls): return cls._load_dual_data("replace_rules.txt", {}) 
    @classmethod
    def get_resolutions_config(cls): return cls._load_dual_data("resolutions.txt", DEFAULT_RESOLUTIONS)
    @classmethod
    def get_logic_config(cls): return cls._load_dual_data("logic_rules.json", DEFAULT_LOGICS)

# --- 5. API 路由 ---
@PromptServer.instance.routes.get("/ma/get_config")
async def get_config(request):
    return web.json_response({
        "llm": MagicUtils.get_llm_config(), 
        "rules": MagicUtils.get_rules_config(), 
        "resolutions": MagicUtils.get_resolutions_config(),
        "logics": MagicUtils.get_logic_config()
    })

@PromptServer.instance.routes.post("/ma/save_config")
async def save_config(request):
    data = await request.json()
    if "llm" in data: MagicUtils._save_user_data("llm_settings.txt", data["llm"])
    if "rules" in data: MagicUtils._save_user_data("replace_rules.txt", data["rules"])
    if "resolutions" in data: MagicUtils._save_user_data("resolutions.txt", data["resolutions"])
    if "logics" in data: MagicUtils._save_user_data("logic_rules.json", data["logics"])
    return web.json_response({"status": "success"})

# --- 🌟 新增功能: 文件管理 API (删除/重命名) ---
# 这些接口将支持 V4.0 图库的高级管理功能

@PromptServer.instance.routes.post("/ma/delete_file")
async def delete_file(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        
        # 安全检查
        if ".." in filename or "/" in filename or "\\" in filename:
             return web.json_response({"status": "error", "message": "Invalid filename"})

        # 使用 ComfyUI 标准路径获取 input 目录
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, subfolder)
        file_path = os.path.join(target_dir, filename)

        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"🗑️ [MagicUtils] Deleted: {file_path}")
            return web.json_response({"status": "success"})
        else:
            return web.json_response({"status": "error", "message": "File not found"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

# --- 在 utils.py 的最末尾追加以下代码 ---

@PromptServer.instance.routes.post("/ma/clear_clipspace")
async def clear_clipspace(request):
    try:
        # 获取标准的 input 目录
        input_dir = folder_paths.get_input_directory()
        clipspace_dir = os.path.join(input_dir, "clipspace")
        
        deleted_count = 0
        
        if os.path.exists(clipspace_dir):
            for filename in os.listdir(clipspace_dir):
                file_path = os.path.join(clipspace_dir, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path) # 删除文件
                        deleted_count += 1
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path) # 删除子文件夹
                        deleted_count += 1
                except Exception as e:
                    print(f"⚠️ Failed to delete {file_path}. Reason: {e}")
                    
            print(f"🧹 [MagicUtils] Cleared clipspace cache: {deleted_count} files removed.")
            return web.json_response({"status": "success", "count": deleted_count})
        else:
            return web.json_response({"status": "success", "count": 0, "message": "No clipspace dir found"})
            
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})