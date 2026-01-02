import torch

class MagicPromptBox:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # 主文本框 (支持多行、动态提示词)
                "text": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
            },
            "optional": {
                # 您的核心需求：前置文本接口
                # 任何连到这里的字符串，都会自动跑到最前面，并加逗号
                "prepend_text": ("STRING", {"forceInput": True}),
                
                # 复刻截图功能：支持 CLIP 输入，直接输出条件
                "clip": ("CLIP", ),
            }
        }

    # 输出三个：合并后的文本、编码后的条件、CLIP原样透传
    RETURN_TYPES = ("STRING", "CONDITIONING", "CLIP")
    RETURN_NAMES = ("final_text", "conditioning", "clip")
    FUNCTION = "execute"
    CATEGORY = "✨ Magic Assistant"

    def execute(self, text, prepend_text="", clip=None):
        # 1. 文本合并逻辑 (核心)
        # 如果有前置文本，就放在前面，用逗号隔开
        result_text = text
        
        if prepend_text and isinstance(prepend_text, str) and prepend_text.strip():
            if result_text.strip():
                result_text = f"{prepend_text}, {result_text}"
            else:
                result_text = prepend_text
        
        print(f"🔮 [Magic-Box] Merged: {result_text[:50]}...")

        # 2. CLIP 编码逻辑 (可选)
        # 如果用户连了 CLIP，我们就顺便把文本编码了，省得再接一个 CLIP Text Encode
        conditioning = None
        if clip is not None:
            # ComfyUI 标准编码流程
            tokens = clip.tokenize(result_text)
            cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
            conditioning = [[cond, {"pooled_output": pooled}]]
        
        return (result_text, conditioning, clip)