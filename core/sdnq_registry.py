"""
SDNQ Model Registry - Catalog of known SDNQ models from Disty0
https://huggingface.co/collections/Disty0/sdnq
https://huggingface.co/Disty0/models

Pipeline 类型由 diffusers 根据 model_index.json 自动检测，无需手动指定。
各模型适配说明见下方注释。
"""

from typing import Dict, List, Optional

# 仅保留 SDNQ 量化模型（名称或 repo_id 含 SDNQ）
# 参考: https://huggingface.co/collections/Disty0/sdnq
# 已移除: FLUX.1-dev-qint8、FLUX.1-dev-qint4（qint 为其他量化格式，非 SDNQ）
#
# 模型类型与 Pipeline 对应:
#   FLUX/FLUX2 -> FluxPipeline / Flux2KleinPipeline (diffusers 自动检测)
#   Qwen -> Qwen2VLForConditionalGeneration 等 (diffusers 自动检测)
#   Z-Image -> ZImagePipeline (diffusers 自动检测)
#   GLM -> GlmImagePipeline (需 diffusers 支持)
#   Chroma/Chrono/Hunyuan/SDXL -> 各自 Pipeline
SDNQ_MODEL_CATALOG = {
    # === FLUX.1 系列 (SDNQ) ===
    "FLUX.1-dev-SDNQ-uint4": {
        "repo_id": "Disty0/FLUX.1-dev-SDNQ-uint4-svd-r32",
        "type": "FLUX",
        "quant_level": "uint4",
        "description": "FLUX.1-dev 4-bit SVD - 文生图",
        "priority": 1
    },
    "FLUX.1-schnell-SDNQ-uint4": {
        "repo_id": "Disty0/FLUX.1-schnell-SDNQ-uint4-svd-r32",
        "type": "FLUX",
        "quant_level": "uint4",
        "description": "FLUX.1-schnell 4-bit SVD - 快速生成",
        "priority": 2
    },
    "FLUX.1-Krea-dev-SDNQ-uint4": {
        "repo_id": "Disty0/FLUX.1-Krea-dev-SDNQ-uint4-svd-r32",
        "type": "FLUX",
        "quant_level": "uint4",
        "description": "FLUX.1-Krea-dev 4-bit SVD",
        "priority": 3
    },
    "FLUX.1-Kontext-dev-SDNQ-uint4": {
        "repo_id": "Disty0/FLUX.1-Kontext-dev-SDNQ-uint4-svd-r32",
        "type": "FLUX",
        "quant_level": "uint4",
        "description": "FLUX.1-Kontext-dev 4-bit SVD",
        "priority": 4
    },

    # === FLUX.2 系列 (需 diffusers>=0.35) ===
    "FLUX.2-dev-SDNQ-uint4": {
        "repo_id": "Disty0/FLUX.2-dev-SDNQ-uint4-svd-r32",
        "type": "FLUX2",
        "quant_level": "uint4",
        "description": "FLUX.2-dev 4-bit SVD - 文生图",
        "priority": 5
    },
    "FLUX.2-klein-4B-SDNQ-4bit": {
        "repo_id": "Disty0/FLUX.2-klein-4B-SDNQ-4bit-dynamic",
        "type": "FLUX2",
        "quant_level": "4bit",
        "description": "FLUX.2-klein 4B - 小参数量版",
        "priority": 6
    },
    "FLUX.2-klein-9B-SDNQ-4bit": {
        "repo_id": "Disty0/FLUX.2-klein-9B-SDNQ-4bit-dynamic-svd-r32",
        "type": "FLUX2",
        "quant_level": "4bit",
        "description": "FLUX.2-klein 9B - 图生图/编辑 (已测试)",
        "priority": 7
    },

    # === Qwen-Image 系列 (仅保留 2509 及以上) ===
    "Qwen-Image-Edit-2509-SDNQ-uint4": {
        "repo_id": "Disty0/Qwen-Image-Edit-2509-SDNQ-uint4-svd-r32",
        "type": "Qwen",
        "quant_level": "uint4",
        "description": "Qwen-Image-Edit-2509 - 图生图",
        "priority": 12
    },
    "Qwen-Image-Edit-2511-SDNQ-uint4": {
        "repo_id": "Disty0/Qwen-Image-Edit-2511-SDNQ-uint4-svd-r32",
        "type": "Qwen",
        "quant_level": "uint4",
        "description": "Qwen-Image-Edit-2511 - 图生图 (较新)",
        "priority": 13
    },
    "Qwen-Image-2512-SDNQ-4bit": {
        "repo_id": "Disty0/Qwen-Image-2512-SDNQ-4bit-dynamic",
        "type": "Qwen",
        "quant_level": "4bit",
        "description": "Qwen-Image-2512 4-bit - 2025.12 更新",
        "priority": 16
    },
    "Qwen-Image-2512-SDNQ-uint4": {
        "repo_id": "Disty0/Qwen-Image-2512-SDNQ-uint4-svd-r32",
        "type": "Qwen",
        "quant_level": "uint4",
        "description": "Qwen-Image-2512 4-bit SVD",
        "priority": 17
    },

    # === Z-Image 系列 ===
    "Z-Image-Turbo-SDNQ-int8": {
        "repo_id": "Disty0/Z-Image-Turbo-SDNQ-int8",
        "type": "Z-Image",
        "quant_level": "int8",
        "description": "Z-Image-Turbo 8-bit - 质量最佳",
        "priority": 19
    },
    "Z-Image-Turbo-SDNQ-uint4": {
        "repo_id": "Disty0/Z-Image-Turbo-SDNQ-uint4-svd-r32",
        "type": "Z-Image",
        "quant_level": "uint4",
        "description": "Z-Image-Turbo 4-bit SVD - 省显存",
        "priority": 20
    },

    # === 其他图像模型 ===
    "Chroma1-HD-SDNQ-uint4": {
        "repo_id": "Disty0/Chroma1-HD-SDNQ-uint4-svd-r32",
        "type": "Chroma",
        "quant_level": "uint4",
        "description": "Chroma1-HD 4-bit SVD - 文生图",
        "priority": 21
    },
    "GLM-Image-SDNQ-4bit": {
        "repo_id": "Disty0/GLM-Image-SDNQ-4bit-dynamic",
        "type": "GLM",
        "quant_level": "4bit",
        "description": "GLM-Image 4-bit - 文生图",
        "priority": 24
    },
}


def get_model_names_for_dropdown() -> List[str]:
    """Get model names sorted by priority for dropdown."""
    return sorted(
        SDNQ_MODEL_CATALOG.keys(),
        key=lambda x: SDNQ_MODEL_CATALOG[x].get("priority", 999)
    )


def get_model_info(model_name: str) -> Optional[Dict]:
    """Get metadata for a model."""
    clean_name = model_name.split(" [")[0] if " [" in model_name else model_name
    return SDNQ_MODEL_CATALOG.get(clean_name)


def get_repo_id_from_name(model_name: str) -> Optional[str]:
    """Get HuggingFace repo ID from model name."""
    info = get_model_info(model_name)
    return info["repo_id"] if info else None
