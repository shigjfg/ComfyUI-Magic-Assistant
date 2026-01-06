import os
import json
import shutil
from server import PromptServer
from aiohttp import web
import folder_paths

# --- 1. 恢复全局路径定义 (这是为了救活 __init__.py) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_DIR = os.path.join(BASE_DIR, "savedata")
USER_DIR = os.path.join(BASE_DIR, "userdata")

class MagicUtils:
    # --- 2. 类内部同时也保留定义 (这是为了让新节点也能用) ---
    BASE_DIR = BASE_DIR
    PRESET_DIR = PRESET_DIR
    USER_DIR = USER_DIR
    
    # 默认数据
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
        "dimensions": ["SDXL_1024x1024", "SD1.5_512x512"]
    }

    @classmethod
    def ensure_user_dir(cls):
        if not os.path.exists(cls.USER_DIR): 
            os.makedirs(cls.USER_DIR, exist_ok=True)

    @classmethod
    def _load_dual_data(cls, filename, default_fallback=None):
        data = {}
        if default_fallback: data.update(default_fallback)
        # 使用 cls.PRESET_DIR 和 cls.USER_DIR
        for d in [cls.PRESET_DIR, cls.USER_DIR]:
            p = os.path.join(d, filename)
            if os.path.exists(p):
                try:
                    with open(p, 'r', encoding='utf-8') as f: data.update(json.load(f))
                except: pass
        return data

    @classmethod
    def _save_user_data(cls, filename, data):
        cls.ensure_user_dir()
        with open(os.path.join(cls.USER_DIR, filename), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

    @classmethod
    def get_llm_config(cls): return cls._load_dual_data("llm_settings.txt", cls.DEFAULT_LLM)
    @classmethod
    def get_rules_config(cls): return cls._load_dual_data("replace_rules.txt", {}) 
    @classmethod
    def get_resolutions_config(cls): return cls._load_dual_data("resolutions.txt", cls.DEFAULT_RESOLUTIONS)
    @classmethod
    def get_logic_config(cls): return cls._load_dual_data("logic_rules.json", cls.DEFAULT_LOGICS)

# --- API 路由 ---
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

@PromptServer.instance.routes.post("/ma/delete_file")
async def delete_file(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        if ".." in filename or "/" in filename or "\\" in filename: return web.json_response({"status": "error"})
        
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, subfolder)
        file_path = os.path.join(target_dir, filename)

        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error", "message": "Not found"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.post("/ma/rename_file")
async def rename_file(request):
    try:
        data = await request.json()
        old_name = data.get("old_name")
        new_name = data.get("new_name")
        subfolder = data.get("subfolder", "")
        
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, subfolder)
        old_path = os.path.join(target_dir, old_name)
        new_path = os.path.join(target_dir, new_name)

        if os.path.exists(old_path) and not os.path.exists(new_path):
            os.rename(old_path, new_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.post("/ma/clear_clipspace")
async def clear_clipspace(request):
    try:
        input_dir = folder_paths.get_input_directory()
        clipspace_dir = os.path.join(input_dir, "clipspace")
        count = 0
        if os.path.exists(clipspace_dir):
            for f in os.listdir(clipspace_dir):
                file_path = os.path.join(clipspace_dir, f)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                        count += 1
                except: pass
        return web.json_response({"status": "success", "count": count})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.get("/ma/get_file_list")
async def get_file_list(request):
    try:
        input_dir = folder_paths.get_input_directory()
        files = []
        
        if os.path.exists(input_dir):
            for f in os.listdir(input_dir):
                if os.path.isfile(os.path.join(input_dir, f)) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff')):
                    files.append(f)
        
        def get_mtime(fname):
            p = os.path.join(input_dir, fname)
            if os.path.exists(p): return os.path.getmtime(p)
            return 0

        files.sort(key=get_mtime, reverse=True)
        return web.json_response({"files": files})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})