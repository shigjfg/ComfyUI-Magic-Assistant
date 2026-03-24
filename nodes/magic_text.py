import re


def _ensure_trailing_comma_per_line(text: str) -> str:
    """与 WeiLin / 前端编辑器一致：每个非空行末尾有英文逗号；空行为空行。"""
    if not text or not isinstance(text, str):
        return text if isinstance(text, str) else ""
    lines = text.split("\n")
    out = []
    for line in lines:
        te = line.rstrip(" \t\u3000")
        if not te:
            out.append("")
        elif re.search(r",\s*$", te):
            out.append(te)
        else:
            out.append(te + ",")
    return "\n".join(out)


def _active_prompt_string(text: str) -> str:
    """去掉以 ! 开头的屏蔽段（逗号/换行分隔），用于实际编码与 final_text。"""
    if not text or not isinstance(text, str):
        return ""
    parts = []
    for seg in re.split(r"[\n,]+", text):
        s = seg.strip()
        if not s or s.startswith("!"):
            continue
        parts.append(s)
    return ", ".join(parts)


class MagicPromptBox:
    """
    主文本中逗号/换行分隔的段若以 ``!`` 开头，表示「屏蔽」：仍保存在节点文本里，
    但 ``final_text`` 输出与 CLIP 编码时会自动跳过该段（与编辑器 Tag 双击屏蔽一致）。
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # 主文本框 (支持多行、动态提示词)
                "text": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
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
        # 1. 文本合并：所有文本来源（主文本 + prepend_text）都先去掉「!屏蔽」段，再合并
        active_main = _active_prompt_string(text)

        # prepend_text 也需要过滤 ! 屏蔽段，防止通过连线绕过屏蔽
        active_prepend = _active_prompt_string(prepend_text) if prepend_text else ""

        result_text = active_prepend
        if active_main:
            if result_text:
                result_text = f"{result_text}, {active_main}"
            else:
                result_text = active_main

        result_text = _ensure_trailing_comma_per_line(result_text)

        print(f"🔮 [Magic-Box] Merged (active): {result_text[:50]}...")

        # 2. CLIP 编码逻辑 (可选)
        # 如果用户连了 CLIP，我们就顺便把文本编码了，省得再接一个 CLIP Text Encode
        # 完全复刻官方 CLIPTextEncode 的编码流程
        conditioning = None
        if clip is not None:
            tokens = clip.tokenize(result_text)
            conditioning = clip.encode_from_tokens_scheduled(tokens)
        return (result_text, conditioning, clip)