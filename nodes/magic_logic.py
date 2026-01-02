import torch
import math
import os
import sys

# --- 引用 utils ---
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils

class MagicLogicCompute:
    @classmethod
    def INPUT_TYPES(s):
        logic_data = MagicUtils.get_logic_config()
        keys = list(logic_data.keys())
        keys.sort(key=lambda x: 0 if "智能" in x else 1)
        
        return {
            "required": {
                "operation": (keys, ),
            },
            "optional": {
                "image": ("IMAGE",),
                "latent": ("LATENT",),
                "a": ("INT", {"default": 0, "min": 0, "max": 999999}), 
                "b": ("INT", {"default": 2, "min": 1, "max": 999999}), 
            }
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "BOOLEAN")
    RETURN_NAMES = ("result_1", "result_2", "ratio", "bool")
    FUNCTION = "execute"
    CATEGORY = "✨ Magic Assistant"

    # --- 伪代码解释器 ---
    def _run_script(self, code, w, h, a, b):
        lines = code.split('\n')
        
        env = {
            'w': w, 'h': h, 'a': a, 'b': b, 
            'math': math, 'abs': abs, 'min': min, 'max': max, 'round': round
        }
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('//'): continue

            # 情况 1: IF 条件判断
            if line.startswith("IF"):
                try:
                    if "RETURN" in line:
                        cond_part, action_part = line.split("RETURN", 1)
                        condition = cond_part[2:].strip()
                        
                        # 如果条件成立 -> 返回 True
                        if eval(condition, {}, env):
                            # 传入 force_bool=True，表示这是由条件触发的成功结果
                            return self._process_return(action_part, env, default_bool=True)
                except Exception as e:
                    print(f"❌ [Logic Error] IF failed: '{line}' -> {e}")
                    continue

            # 情况 2: 直接 RETURN
            if line.startswith("RETURN"):
                expr = line[6:].strip()
                # 如果代码直接走到这里（没有被上面的 IF 拦截），通常意味着“条件不满足”或“默认情况”
                # 但如果是只有一行代码的运算（如 a+b），它也算成功。
                # 这里的逻辑是：如果前面有 IF 但没进去，走到这里算 False。
                # 为了简单：默认的最后一行 RETURN 我们让它保持 True，
                # 但如果是 IF 失败后掉下来的，用户通常希望它是 False。
                # 这里我们暂定：直接 RETURN 默认为 False (代表 Fallback)，除非用户写明
                return self._process_return(expr, env, default_bool=False)

        return w, h, False

    def _process_return(self, expr, env, default_bool=True):
        try:
            # 支持显式返回布尔值: RETURN w, h, False
            parts = expr.split(",")
            
            # 3个返回值: w, h, bool
            if len(parts) >= 3:
                v1 = eval(parts[0], {}, env)
                v2 = eval(parts[1], {}, env)
                v3 = eval(parts[2], {}, env) # 强制指定布尔值
                return int(v1), int(v2), bool(v3)
            
            # 2个返回值: w, h (使用 default_bool)
            elif len(parts) == 2:
                v1 = eval(parts[0], {}, env)
                v2 = eval(parts[1], {}, env)
                return int(v1), int(v2), default_bool
            
            # 1个返回值: val (变成 val, val, default_bool)
            else:
                v = eval(expr, {}, env)
                return int(v), int(v), default_bool
                
        except Exception as e:
            print(f"❌ [Logic Error] RETURN failed: '{expr}' -> {e}")
            return env['w'], env['h'], False

    def execute(self, operation, image=None, latent=None, a=0, b=2):
        logic_data = MagicUtils.get_logic_config()
        script_code = logic_data.get(operation, "RETURN w, h")

        w, h = 0, 0
        if image is not None:
            w, h = image.shape[2], image.shape[1]
        elif latent is not None:
            w, h = latent["samples"].shape[3] * 8, latent["samples"].shape[2] * 8
        else:
            w, h = int(a), int(b)

        print(f"🔮 [Magic-Logic] Op: '{operation}' | Input: {w}x{h}, a={a}, b={b}")

        res_1, res_2, bool_val = self._run_script(script_code, w, h, int(a), int(b))
        
        print(f"   👉 Result: {res_1}, {res_2} | Bool: {bool_val}")
        
        ratio = float(res_1)/float(res_2) if res_2 != 0 else 0
        return (res_1, res_2, ratio, bool_val)