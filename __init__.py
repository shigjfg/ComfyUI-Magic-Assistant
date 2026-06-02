# 屏蔽 kornia 的可选依赖提示（必须在任何导入之前设置）
import os
os.environ["KORNIA_INSTALLATION_MODE"] = "skip"
os.environ["KORNIA_AUTOINSTALL"] = "0"

from .utils import BASE_DIR
from .nodes.magic_prompt import MagicPromptReplace
from .nodes.magic_resize import MagicResolutionResize
from .nodes.magic_logic import MagicLogicCompute
from .nodes.magic_text import MagicPromptBox
from .nodes.magic_control import MagicUniversalSwitch
from .nodes.magic_photopea import MagicPhotopeaNode
from .nodes.magic_power_lora import MagicPowerLoraLoader
from .nodes.magic_resolution import MagicResolution
from .nodes.magic_cache import MagicCache
from .nodes.magic_klein_loader import MagicKleinLoader

# --- SDNQ nodes: loaded lazily so that missing sdnq/diffusers does NOT block the plugin ---
_SDNQ_LOADER_NODE = None
_SDNQ_SAMPLER_NODE = None
_SDNQ_LOAD_ERROR = None

try:
    from .nodes.magic_sdnq_loader import MagicSDNQLoader

    _SDNQ_LOADER_NODE = MagicSDNQLoader
except Exception as e:
    _SDNQ_LOADER_NODE = None
    _SDNQ_LOAD_ERROR = f"MagicSDNQLoader: {e}"

try:
    from .nodes.magic_sdnq_sampler import MagicSDNQSampler

    _SDNQ_SAMPLER_NODE = MagicSDNQSampler
except Exception as e:
    _SDNQ_SAMPLER_NODE = None
    if _SDNQ_LOAD_ERROR:
        _SDNQ_LOAD_ERROR += f"; MagicSDNQSampler: {e}"
    else:
        _SDNQ_LOAD_ERROR = f"MagicSDNQSampler: {e}"

# --- 节点映射 ---
NODE_CLASS_MAPPINGS = {
    "MagicPromptReplace": MagicPromptReplace,
    "MagicResolutionResize": MagicResolutionResize,
    "MagicLogicCompute": MagicLogicCompute,
    "MagicPromptBox": MagicPromptBox,
    "MagicUniversalSwitch": MagicUniversalSwitch,
    "MagicPhotopeaNode": MagicPhotopeaNode,
    "MagicPowerLoraLoader": MagicPowerLoraLoader,
    "MagicResolution": MagicResolution,
    "MagicCache": MagicCache,
    "MagicKleinLoader": MagicKleinLoader,
}

# --- 节点显示名称 ---
NODE_DISPLAY_NAME_MAPPINGS = {
    "MagicPromptReplace": "✨ 多功能AI提示词替换 Magic Multi-Function AI Prompt Replace",
    "MagicResolutionResize": "📏 多功能图像缩放 Magic Multi-Function Image Resize",
    "MagicLogicCompute": "🧠 可自己编辑算法的逻辑计算 (带教程版) Magic Programmable Logic & Calc (Tutorial)",
    "MagicPromptBox": "📝 多功能提示词框 Magic Multi-Function Prompt Box",
    "MagicUniversalSwitch": "🎛️ 万能禁用/忽略多框 Magic Multi-Group Switch",
    "MagicPhotopeaNode": "🎨 Photopea图像处理 Photopea Processing & Load Image",
    "MagicPowerLoraLoader": "🚀 强力lora加载器 Magic Power LoRA Loader",
    "MagicResolution": "📐 分辨率输出器 Magic Resolution Output",
    "MagicCache": "⚡ Magic Cache 缓存加速 (TeaCache + FBCache)",
    "MagicKleinLoader": "🔮 Magic Nunchaku FLUX.2 Klein Loader",
}

# --- SDNQ 节点：仅在包可用时注册 ---
if _SDNQ_LOADER_NODE is not None:
    NODE_CLASS_MAPPINGS["MagicSDNQLoader"] = _SDNQ_LOADER_NODE
    NODE_DISPLAY_NAME_MAPPINGS["MagicSDNQLoader"] = (
        "📦 SDNQ模型加载器 Magic SDNQ Model Loader"
    )

if _SDNQ_SAMPLER_NODE is not None:
    NODE_CLASS_MAPPINGS["MagicSDNQSampler"] = _SDNQ_SAMPLER_NODE
    NODE_DISPLAY_NAME_MAPPINGS["MagicSDNQSampler"] = (
        "🎲 SDNQ K采样器 Magic SDNQ K Sampler"
    )

# --- 指定 Web 目录 ---
WEB_DIRECTORY = "./web"

print("\n" + "\033[36m" + "="*60 + "\033[0m")
print(f"\033[36m🔮 [Magic Assistant] 已加载 (V1.3.7)\033[0m")
print(f"\033[36m   👉 Nodes: {list(NODE_CLASS_MAPPINGS.keys())}\033[0m")
print("\033[36m" + "="*60 + "\033[0m" + "\n")

if _SDNQ_LOAD_ERROR is not None:
    print(
        "\033[33m"
        "[Magic Assistant] ⚠️  SDNQ nodes skipped — sdnq/diffusers packages not available.\n"
        "    插件其他功能不受影响。如需使用 SDNQ 节点，请安装:\n"
        "    pip install sdnq diffusers transformers huggingface_hub\n"
        f"    错误详情: {_SDNQ_LOAD_ERROR}"
        "\033[0m"
    )
