from .utils import BASE_DIR
from .nodes.magic_prompt import MagicPromptReplace
from .nodes.magic_resize import MagicResolutionResize
from .nodes.magic_logic import MagicLogicCompute
from .nodes.magic_text import MagicPromptBox 
from .nodes.magic_control import MagicUniversalSwitch
from .nodes.magic_photopea import MagicPhotopeaNode  # <--- 新增这一行

# --- 节点映射 ---
NODE_CLASS_MAPPINGS = {
    "MagicPromptReplace": MagicPromptReplace,
    "MagicResolutionResize": MagicResolutionResize,
    "MagicLogicCompute": MagicLogicCompute,
    "MagicPromptBox": MagicPromptBox,
    "MagicUniversalSwitch": MagicUniversalSwitch,
    # 👇 新增这一行
    "MagicPhotopeaNode": MagicPhotopeaNode
}

# --- 节点显示名称 ---
NODE_DISPLAY_NAME_MAPPINGS = {
    "MagicPromptReplace": "✨ 多功能AI提示词替换 Magic Multi-Function AI Prompt Replace",
    "MagicResolutionResize": "📏 多功能图像缩放 Magic Multi-Function Image Resize",
    "MagicLogicCompute": "🧠 可自己编辑算法的逻辑计算 (带教程版) Magic Programmable Logic & Calc (Tutorial)",
    "MagicPromptBox": "📝 多功能提示词框 Magic Multi-Function Prompt Box",
    "MagicUniversalSwitch": "🎛️ 万能禁用/忽略多框 Magic Multi-Group Switch",
    "MagicPhotopeaNode": "🎨 Photopea图像处理 Photopea Processing & Load Image"
}

# --- 指定 Web 目录 ---
WEB_DIRECTORY = "./web"

print("\n" + "\033[36m" + "="*60 + "\033[0m")
print(f"\033[36m🔮 [Magic Assistant] 已加载 (V1.0.1 - Pin & Root Support)\033[0m")
print(f"\033[36m   👉 Nodes: {list(NODE_CLASS_MAPPINGS.keys())}\033[0m")
print("\033[36m" + "="*60 + "\033[0m" + "\n")