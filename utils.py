import os
import json
import shutil
import re
import base64
from server import PromptServer
from aiohttp import web
import folder_paths
import aiohttp

# --- 1. 恢复全局路径定义 (这是为了救活 __init__.py) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_DIR = os.path.join(BASE_DIR, "savedata")
USER_DIR = os.path.join(BASE_DIR, "userdata")

# --- 从 pyproject.toml 读取版本号 ---
def get_current_version():
    """从 pyproject.toml 读取当前版本号"""
    try:
        pyproject_path = os.path.join(BASE_DIR, "pyproject.toml")
        if os.path.exists(pyproject_path):
            with open(pyproject_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # 使用正则表达式提取版本号
                match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
                if match:
                    return match.group(1)
    except Exception as e:
        print(f"Warning: Failed to read version from pyproject.toml: {e}")
    # 如果读取失败，返回默认值
    return "1.1.2"

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

# --- 更新检测 API ---
@PromptServer.instance.routes.get("/ma/check_update")
async def check_update(request):
    """
    检查更新：从 GitHub 获取最新版本号和 README 内容
    支持测试模式：添加 ?test=true 参数可以返回模拟的更新数据
    """
    try:
        # 检查是否为测试模式
        test_mode = request.query.get('test', '').lower() == 'true'
        
        if test_mode:
            # 测试模式：返回模拟的更新数据
            current_version = get_current_version()
            # 模拟一个更新的版本
            latest_version = "1.1.4"
            has_update = True
            
            # 读取本地 README 文件作为测试数据
            readme_path = os.path.join(BASE_DIR, "README.md")
            readme_text = ""
            if os.path.exists(readme_path):
                try:
                    with open(readme_path, 'r', encoding='utf-8') as f:
                        readme_text = f.read()
                except:
                    pass
            
            # 从 README 中提取更新信息
            update_info = ""
            if readme_text:
                version_section_match = re.search(r'##\s*[📝版本更新介绍|Version Update Introduction].*?(?=##|$)', readme_text, re.DOTALL | re.IGNORECASE)
                if version_section_match:
                    update_info = version_section_match.group(0)
                else:
                    update_match = re.search(r'V?\d+\.\d+\.\d+.*?(?=V?\d+\.\d+\.\d+|$)', readme_text, re.DOTALL)
                    if update_match:
                        update_info = update_match.group(0)
            
            return web.json_response({
                "current_version": current_version,
                "latest_version": latest_version,
                "has_update": has_update,
                "update_info": update_info,
                "test_mode": True  # 标记这是测试模式
            })
        
        # 正常模式：从 GitHub 获取
        current_version = get_current_version()  # 从 pyproject.toml 动态读取当前版本号
        repo_url = "https://api.github.com/repos/shigjfg/ComfyUI-Magic-Assistant"
        
        async with aiohttp.ClientSession() as session:
            # 获取最新 release 版本
            async with session.get(f"{repo_url}/releases/latest") as resp:
                if resp.status == 200:
                    release_data = await resp.json()
                    latest_version = release_data.get("tag_name", "").lstrip("vV")
                    latest_version = latest_version or release_data.get("name", "").lstrip("vV")
                else:
                    # 如果没有 release，尝试从 tags 获取
                    async with session.get(f"{repo_url}/tags") as tags_resp:
                        if tags_resp.status == 200:
                            tags_data = await tags_resp.json()
                            if tags_data and len(tags_data) > 0:
                                latest_version = tags_data[0].get("name", "").lstrip("vV")
                            else:
                                latest_version = None
                        else:
                            latest_version = None
            
            # 获取 README 内容
            async with session.get(f"{repo_url}/readme") as readme_resp:
                if readme_resp.status == 200:
                    readme_data = await readme_resp.json()
                    readme_content = readme_data.get("content", "")
                    # Base64 解码
                    readme_text = base64.b64decode(readme_content).decode('utf-8')
                else:
                    readme_text = ""
        
        # 解析版本号比较
        def version_compare(v1, v2):
            """比较版本号，返回 True 如果 v1 < v2"""
            if not v1 or not v2:
                return False
            try:
                v1_parts = [int(x) for x in v1.split('.')]
                v2_parts = [int(x) for x in v2.split('.')]
                max_len = max(len(v1_parts), len(v2_parts))
                v1_parts += [0] * (max_len - len(v1_parts))
                v2_parts += [0] * (max_len - len(v2_parts))
                for i in range(max_len):
                    if v1_parts[i] < v2_parts[i]:
                        return True
                    elif v1_parts[i] > v2_parts[i]:
                        return False
                return False
            except:
                return False
        
        has_update = latest_version and version_compare(current_version, latest_version)
        
        # 从 README 中提取更新信息
        update_info = ""
        if readme_text and has_update:
            # 查找版本更新介绍部分
            version_section_match = re.search(r'##\s*[📝版本更新介绍|Version Update Introduction].*?(?=##|$)', readme_text, re.DOTALL | re.IGNORECASE)
            if version_section_match:
                update_info = version_section_match.group(0)
            else:
                # 如果没有找到，尝试查找最近的更新内容
                update_match = re.search(r'V?\d+\.\d+\.\d+.*?(?=V?\d+\.\d+\.\d+|$)', readme_text, re.DOTALL)
                if update_match:
                    update_info = update_match.group(0)
        
        return web.json_response({
            "current_version": current_version,
            "latest_version": latest_version,
            "has_update": has_update,
            "update_info": update_info
        })
    except Exception as e:
        return web.json_response({
            "current_version": get_current_version(),
            "latest_version": None,
            "has_update": False,
            "update_info": "",
            "error": str(e)
        })