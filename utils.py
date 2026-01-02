import os
import json
from server import PromptServer
from aiohttp import web

# --- 路径定义 ---
BASE_DIR = os.path.dirname(__file__)
SAVE_DIR = os.path.join(BASE_DIR, "savedata")

LLM_PATH = os.path.join(SAVE_DIR, "llm_settings.txt")
RULES_PATH = os.path.join(SAVE_DIR, "replace_rules.txt")
RES_PATH = os.path.join(SAVE_DIR, "resolutions.txt")
LOGIC_PATH = os.path.join(SAVE_DIR, "logic_rules.json")

if not os.path.exists(SAVE_DIR):
    os.makedirs(SAVE_DIR)

DEFAULT_LLM = {
    "Default OpenAI": {
        "name": "Default OpenAI",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-3.5-turbo"
    }
}

DEFAULT_RULES = {
    "default_char": {
        "name": "角色替换 (Character)",
        "system": "你是一个提示词专家...",
        "guide": "保留画风..."
    }
}

DEFAULT_RESOLUTIONS = {
    "presets": [512, 768, 832, 960, 1024, 1152, 1280, 1536, 2048],
    "dimensions": [
        "SDXL_1024x1024", "SDXL_1152x896", "SDXL_896x1152", "SDXL_1216x832", 
        "SDXL_832x1216", "SDXL_1344x768", "SDXL_768x1344", "SDXL_1536x640", 
        "SDXL_640x1536", "2K_1024x1536", "2K_1536x1024", 
        "SD1.5_512x512", "SD1.5_512x768", "SD1.5_768x512"
    ]
}

# --- 🌟 100% 精确的数学逻辑 ---
# 使用交叉相乘法: w/h = 2/3 -> w*3 == h*2
# 这样可以彻底排除 832x1216 这种近似值

SDXL_UPSCALE_CODE = """# === SDXL 精确比例放大 ===
# 变量: w=宽, h=高

# 1. 精确 2:3 画幅 (w*3 == h*2)
# 例如: 768x1152, 1024x1536
IF w*3 == h*2 and w <= 768 RETURN 1152, 1728
IF w*3 == h*2 and w == 1152 RETURN 1536, 2304

# 2. 精确 3:2 画幅 (w*2 == h*3)
# 例如: 1152x768, 1536x1024
IF w*2 == h*3 and w <= 1152 RETURN 1728, 1152
IF w*2 == h*3 and w == 1728 RETURN 2304, 1536

# 3. 精确 3:4 画幅 (w*4 == h*3)
# 例如: 768x1024
IF w*4 == h*3 and w <= 768 RETURN 1152, 1536
IF w*4 == h*3 and w == 1152 RETURN 1536, 2048

# 4. 精确 4:3 画幅 (w*3 == h*4)
# 例如: 1024x768
IF w*3 == h*4 and w <= 1024 RETURN 1536, 1152
IF w*3 == h*4 and w == 1536 RETURN 2048, 1536

# 5. 其他任何比例 (包括 832x1216) -> 普通两倍放大
RETURN w * 2, h * 2"""

SDXL_DOWNSCALE_CODE = """# === SDXL 精确比例缩小 ===

# 1. 精确 2:3 缩小
IF w*3 == h*2 and w >= 1152 RETURN 768, 1152

# 2. 精确 3:2 缩小
IF w*2 == h*3 and w >= 1728 RETURN 1152, 768

# 3. 精确 3:4 缩小
IF w*4 == h*3 and w >= 1152 RETURN 768, 1024

# 4. 精确 4:3 缩小
IF w*3 == h*4 and w >= 1536 RETURN 1024, 768

# 5. 其他情况保持原样
RETURN w, h"""

DEFAULT_LOGICS = {
    "📈 智能放大 (SDXL)": SDXL_UPSCALE_CODE,
    "📉 智能缩小 (SDXL)": SDXL_DOWNSCALE_CODE,
    "⚖️ 取大值 (Max)": "IF a > b RETURN a\nRETURN b",
    "⚖️ 取小值 (Min)": "IF a < b RETURN a\nRETURN b",
    "✖️ 乘法 (Scale)": "RETURN w * b, h * b",
    "➗ 除法 (Divide)": "RETURN w / b, h / b",
    "1️⃣ 自定义测试": "IF w > 1024 RETURN 1024, 1024\nRETURN w, h"
}

class MagicUtils:
    @staticmethod
    def load_json_txt(path, default_data):
        if not os.path.exists(path):
            MagicUtils.save_json_txt(path, default_data)
            return default_data
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if path == LOGIC_PATH: return data 
                    if isinstance(default_data, dict):
                        for k, v in default_data.items():
                            if k not in data: data[k] = v
                return data
        except: return default_data

    @staticmethod
    def save_json_txt(path, data):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

    @staticmethod
    def get_llm_config(): return MagicUtils.load_json_txt(LLM_PATH, DEFAULT_LLM)
    @staticmethod
    def get_rules_config(): return MagicUtils.load_json_txt(RULES_PATH, DEFAULT_RULES)
    @staticmethod
    def get_resolutions_config(): return MagicUtils.load_json_txt(RES_PATH, DEFAULT_RESOLUTIONS)
    @staticmethod
    def get_logic_config(): return MagicUtils.load_json_txt(LOGIC_PATH, DEFAULT_LOGICS)

# --- API ---
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
    if "llm" in data: MagicUtils.save_json_txt(LLM_PATH, data["llm"])
    if "rules" in data: MagicUtils.save_json_txt(RULES_PATH, data["rules"])
    if "resolutions" in data: MagicUtils.save_json_txt(RES_PATH, data["resolutions"])
    if "logics" in data: MagicUtils.save_json_txt(LOGIC_PATH, data["logics"])
    return web.json_response({"status": "success"})