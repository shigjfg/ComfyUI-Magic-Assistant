import os
import json
import shutil
from server import PromptServer
from aiohttp import web

# --- 1. 路径定义 ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_DIR = os.path.join(BASE_DIR, "savedata")
USER_DIR = os.path.join(BASE_DIR, "userdata")

# --- 2. 默认数据 (仅保留必要的兜底，算法全部移至 JSON) ---
DEFAULT_LLM = {
    "Default OpenAI": {
        "name": "Default OpenAI",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-3.5-turbo"
    }
}

# 这里的默认值留空，强制从 savedata/logic_rules.json 读取
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
        
        # 0. 加载代码兜底 (现在 logic 是空的了)
        if default_fallback and isinstance(default_fallback, dict):
            data.update(default_fallback)

        # 1. 读取官方预设 (Savedata) -> 这里的逻辑算法现在是主力
        preset_path = os.path.join(PRESET_DIR, filename)
        if os.path.exists(preset_path):
            try:
                with open(preset_path, 'r', encoding='utf-8') as f:
                    preset_data = json.load(f)
                    if isinstance(preset_data, dict):
                        data.update(preset_data)
            except Exception as e:
                print(f"⚠️ [MagicUtils] Load Preset Error ({filename}): {e}")

        # 2. 读取用户配置 (Userdata) -> 覆盖同名键
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
        
        # 简单逻辑：直接将前端传来的数据覆盖写入用户文件
        # 注意：如果您只想保存差异部分，逻辑会复杂很多。
        # 目前的逻辑是：用户点保存 -> 哪怕全是默认值，也会在 userdata 里存一份副本。
        # 这是一个妥协，为了代码简单稳健。
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