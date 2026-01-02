import requests
import time
import os
import sys

# --- 关键修复：正确引用上级目录的 utils ---
# 获取当前文件所在目录 (custom_nodes/magic_assistant/nodes)
current_dir = os.path.dirname(os.path.abspath(__file__))
# 获取父级目录 (custom_nodes/magic_assistant)
parent_dir = os.path.dirname(current_dir)

# 将父级目录临时加入系统路径，以便可以 import utils
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from utils import MagicUtils
except ImportError:
    # 如果还是失败，尝试相对导入 (虽然在动态加载中不稳定，但作为备选)
    from ..utils import MagicUtils

class MagicPromptReplace:
    @classmethod
    def INPUT_TYPES(s):
        rules_data = MagicUtils.get_rules_config()
        llm_data = MagicUtils.get_llm_config()
        
        rules_list = [r.get("name") for r in rules_data.values()] or ["Loading..."]
        llm_list = list(llm_data.keys()) or ["Loading..."]

        return {
            "required": {
                "original_prompt": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "原始提示词 (Original)"}),
                "replace_tag": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "新内容 (New Content)"}),
                "llm_profile": (llm_list,),
                "rule_name": (rules_list,), 
            },
            "hidden": {
                "prompt_config_json": ("STRING", {"default": ""}), 
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("modified_prompt",)
    FUNCTION = "process_llm"
    CATEGORY = "✨ Magic Assistant"

    @classmethod
    def VALIDATE_INPUTS(s, rule_name, llm_profile, **kwargs):
        return True

    def log(self, msg, type="info"):
        RESET = "\033[0m"
        CYAN = "\033[36m"
        GREEN = "\033[32m"
        YELLOW = "\033[33m"
        RED = "\033[31m"
        prefix = "🔮 [Magic-Prompt]"
        
        if type == "start": print(f"{YELLOW}{prefix} 🚀 Start | {msg}{RESET}")
        elif type == "success": print(f"{GREEN}{prefix} ✅ Done  | {msg}{RESET}")
        elif type == "error": print(f"{RED}{prefix} ❌ Error | {msg}{RESET}")
        else: print(f"{CYAN}{prefix} ℹ️ Info  | {msg}{RESET}")

    def process_llm(self, original_prompt, replace_tag, rule_name, llm_profile, prompt_config_json=None):
        start_time = time.time()
        
        llm_data = MagicUtils.get_llm_config()
        rules_data = MagicUtils.get_rules_config()

        active_llm = llm_data.get(llm_profile)
        if not active_llm:
            if llm_data: 
                active_llm = list(llm_data.values())[0]
                self.log(f"Profile '{llm_profile}' missing, using default", "info")
            else: return ("Error: No LLM profiles.",)

        active_rule = None
        for r in rules_data.values():
            if r.get("name") == rule_name: active_rule = r; break
        if not active_rule:
            if rules_data: active_rule = list(rules_data.values())[0]
            else: return ("Error: No rules found.",)

        base_url = active_llm.get("base_url", "").rstrip('/')
        api_key = active_llm.get("api_key", "")
        model = active_llm.get("model", "")
        system_prompt = active_rule.get("system", "")
        target_features = active_rule.get("guide", "")

        if not base_url or not api_key: return (f"Error: Key/URL missing in '{llm_profile}'.",)

        self.log(f"LLM: {llm_profile} | Rule: {rule_name} | Model: {model}", "start")

        user_message = f"""
请根据以下指令修改提示词：
[原始提示词]: {original_prompt}
[新替换提示词]: {replace_tag}
[替换的指南]: {target_features}

任务要求：
1. 根据“替换的指南”，将“新替换提示词”自然融入到“原始提示词”中。
2. 根据“替换的指南”和当前扮演的角色，删除或替换“原始提示词”中不再适用或冲突的tag。
3. 直接输出修改后的最终tag字符串，用英文逗号分隔。不要输出任何解释性文字。
"""
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            "temperature": 0.7,
        }

        try:
            endpoint = base_url
            if "/chat/completions" not in base_url:
                 endpoint = f"{base_url}/chat/completions" if not base_url.endswith("/v1") else f"{base_url}/chat/completions"
            if "openai.com" in base_url and "v1" not in endpoint:
                endpoint = endpoint.replace("api.openai.com", "api.openai.com/v1")

            response = requests.post(endpoint, headers=headers, json=payload, timeout=60)
            if response.status_code != 200:
                self.log(f"HTTP {response.status_code}: {response.text}", "error")
                return (f"API Error: {response.text}",)
            
            result = response.json()
            if 'choices' in result:
                content = result['choices'][0]['message']['content'].strip()
                usage = result.get('usage', {})
                duration = time.time() - start_time
                self.log(f"Time: {duration:.2f}s | Tokens: {usage.get('total_tokens')}", "success")
                return (content,)
            else: return (f"Error: {result}",)

        except Exception as e:
            self.log(f"Ex: {e}", "error")
            return (f"Error: {e}",)