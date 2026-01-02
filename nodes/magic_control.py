import torch

class MagicUniversalSwitch:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # 移除 match_query，改用 properties 存储
                
                # 控制模式
                "control_mode": (["🔇 禁用模式 (Mute)", "🙈 忽略模式 (Bypass)"], {"default": "🔇 禁用模式 (Mute)"}),
                
                # 最大同时开启数量
                "max_active": ("INT", {"default": 1, "min": 1, "max": 99, "step": 1}),
                
                # 刷新按钮
                "refresh": ("BOOLEAN", {"default": True, "label_on": "♻️ 刷新列表 (Refresh)", "label_off": "♻️ 刷新列表 (Refresh)"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "✨ Magic Assistant"
    OUTPUT_NODE = True

    def do_nothing(self, **kwargs):
        return ()