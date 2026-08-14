"""Anima 28 层 LoRA -> 40 层（Anima 2.9B）键名重映射：纯内存版。

映射规范参照 ComfyUI-Anima-28to40-Lora-Converter (MIT)
https://github.com/R0smontis/ComfyUI-Anima-28to40-Lora-Converter
以及其上游 ComfyUI-Anima-28to40-Lora-Stack
https://github.com/hpoc766-afk/ComfyUI-Anima-28to40-Lora-Stack

40 层模型在位置 (2, 5, 8, 11, 14, 17, 21, 24, 27, 30, 33, 36) 插入 12 个新层，
原 28 个主干层按顺序填入其余位置；插入层不复制任何 LoRA 权重。
示例映射：0->0、2->3、14->20、27->39。

与上游转换器的关键区别（本模块的设计目标）：
- **只在内存里暂存应用**：重映射产生一个新的 dict，张量只做「引用」不 clone，
  不写任何 .safetensors 文件。既不破坏原 LoRA，也不会在硬盘上多出一份副本。
- **宽容**：非 Anima LoRA、已经是 40 层结构的 LoRA 不抛异常中断整个工作流，
  而是返回状态码由调用方决定「原样加载 + 打印提示」。
"""

import re

OLD_BLOCK_COUNT = 28
NEW_BLOCK_COUNT = 40
INSERTION_POSITIONS = (2, 5, 8, 11, 14, 17, 21, 24, 27, 30, 33, 36)

# 重映射结果状态
STATUS_CONVERTED = "converted"            # 成功重映射
STATUS_ALREADY_40 = "already_40"          # 已经是 40 层结构（含超出 0-27 的层索引）
STATUS_NOT_ANIMA = "not_anima"            # 未包含可识别的 Anima 主干 blocks 键
STATUS_ERROR = "error"                    # 其他异常（如映射后键名冲突）


def build_old_to_new_map(
    old_block_count=OLD_BLOCK_COUNT,
    new_block_count=NEW_BLOCK_COUNT,
    insertion_positions=INSERTION_POSITIONS,
):
    """根据插入层位置生成旧层索引 -> 新层索引的一一映射。"""
    insertions = set(insertion_positions)
    if len(insertions) != new_block_count - old_block_count:
        raise ValueError("插入层数量与新旧层数差值不一致")
    if any(index < 0 or index >= new_block_count for index in insertions):
        raise ValueError("插入层位置超出新模型层范围")

    old_to_new = {}
    old_index = 0
    for new_index in range(new_block_count):
        if new_index in insertions:
            continue
        if old_index >= old_block_count:
            raise ValueError("生成映射时旧层数量溢出")
        old_to_new[old_index] = new_index
        old_index += 1

    if old_index != old_block_count:
        raise ValueError(f"仅映射了 {old_index} 个旧层，预期 {old_block_count} 个")
    return old_to_new


OLD_TO_NEW = build_old_to_new_map()

# 仅识别 Anima 主干层，避免误把 llm_adapter(.|_)blocks_* 当成主模型层。
# Anima 的 diffusion_model 下同时存在 blocks（主干）和 llm_adapter.blocks（文本适配器），
# 后者层数不随 28/40 变化，必须原样保留。
BLOCK_PATTERNS = (
    re.compile(r"(?P<prefix>lora_unet_blocks_)(?P<idx>\d+)(?P<suffix>_)"),
    re.compile(r"(?P<prefix>(?:^|[./])net[./]blocks[./])(?P<idx>\d+)(?P<suffix>[./])"),
    re.compile(r"(?P<prefix>(?:^|[./])diffusion_model[./]blocks[./])(?P<idx>\d+)(?P<suffix>[./])"),
)


class LoraRemapError(ValueError):
    """LoRA 结构不符合 Anima 28 层映射要求。"""


def find_main_block(key):
    """返回键中第一个 Anima 主干层匹配及其索引；非主干键返回 (None, None)。"""
    for pattern in BLOCK_PATTERNS:
        match = pattern.search(key)
        if match is not None:
            return match, int(match.group("idx"))
    return None, None


def remap_key(key, old_to_new=OLD_TO_NEW):
    """重映射单个键；无主干层索引的键保持原样。

    返回 (新键, 旧索引, 新索引)；非主干键的索引为 None。
    """
    match, old_index = find_main_block(key)
    if match is None or old_index is None:
        return key, None, None
    if old_index not in old_to_new:
        hint = (
            "；该文件可能已经是 40 层结构或不是 28 层 Anima LoRA"
            if old_index >= OLD_BLOCK_COUNT
            else ""
        )
        raise LoraRemapError(
            f"键 {key!r} 使用了不支持的主干层 {old_index}；"
            f"仅支持 0-{OLD_BLOCK_COUNT - 1}{hint}"
        )

    new_index = old_to_new[old_index]
    new_key = f"{key[:match.start('idx')]}{new_index}{key[match.end('idx'):]}"
    return new_key, old_index, new_index


def analyze_lora_blocks(state_dict):
    """扫描 LoRA 的主干层索引分布，用于判断是否需要 / 能够转换。

    返回 dict:
      matched_keys: 命中主干 blocks 模式的键数量
      indices:      出现过的主干层索引集合
      min_index / max_index: 主干层索引范围（无主干键时为 None）
    """
    matched_keys = 0
    indices = set()
    for key in state_dict.keys():
        match, idx = find_main_block(key)
        if match is None or idx is None:
            continue
        matched_keys += 1
        indices.add(idx)
    return {
        "matched_keys": matched_keys,
        "indices": indices,
        "min_index": min(indices) if indices else None,
        "max_index": max(indices) if indices else None,
    }


def is_28_layer_anima_lora(state_dict):
    """是否为可转换的 28 层 Anima LoRA（含主干键且最大层索引 <= 27）。"""
    info = analyze_lora_blocks(state_dict)
    if info["matched_keys"] == 0 or info["max_index"] is None:
        return False
    return info["max_index"] < OLD_BLOCK_COUNT


def remap_lora_state_dict(state_dict, source_name="<memory>", old_to_new=OLD_TO_NEW):
    """严格版：校验并返回适用于 40 层模型的 LoRA state dict。

    张量对象仅被重新引用，不执行 clone，也不生成新增 12 层的权重。
    结构不符合要求时抛出 LoraRemapError。
    """
    remapped = {}
    main_block_key_count = 0
    collisions = []

    for key, value in state_dict.items():
        try:
            new_key, old_index, _ = remap_key(key, old_to_new)
        except LoraRemapError as error:
            raise LoraRemapError(f"LoRA {source_name}: {error}") from error

        if old_index is not None:
            main_block_key_count += 1
        if new_key in remapped:
            collisions.append(new_key)
            continue
        remapped[new_key] = value

    if main_block_key_count == 0:
        raise LoraRemapError(
            f"LoRA {source_name} 未包含可识别的 Anima 主干 blocks_0 至 blocks_27 权重；"
            "支持的键名前缀：lora_unet_blocks_*、net.blocks.*、diffusion_model.blocks.*"
        )
    if collisions:
        preview = "\n  ".join(collisions[:20])
        suffix = "" if len(collisions) <= 20 else f"\n  ...另有 {len(collisions) - 20} 个"
        raise LoraRemapError(
            f"LoRA {source_name} 映射后发生键名冲突：\n  {preview}{suffix}"
        )

    return remapped


def remap_lora_state_dict_safe(state_dict, source_name="<memory>", old_to_new=OLD_TO_NEW):
    """宽容版：供加载器调用，永不抛异常。

    返回 (state_dict, status, message)：
      - status == STATUS_CONVERTED: state_dict 为重映射后的新 dict
      - 其他状态: 原样返回传入的 state_dict，由调用方决定是否照原样加载
    """
    if not state_dict:
        return state_dict, STATUS_NOT_ANIMA, "LoRA 为空，跳过 Anima 层转换"

    info = analyze_lora_blocks(state_dict)

    if info["matched_keys"] == 0:
        return (
            state_dict,
            STATUS_NOT_ANIMA,
            f"{source_name} 未包含 Anima 主干 blocks 键（支持 lora_unet_blocks_*、"
            "net.blocks.*、diffusion_model.blocks.*），按原样加载",
        )

    max_index = info["max_index"]
    if max_index is not None and max_index >= OLD_BLOCK_COUNT:
        return (
            state_dict,
            STATUS_ALREADY_40,
            f"{source_name} 主干层最大索引为 {max_index}（>= {OLD_BLOCK_COUNT}），"
            "判定为已是 40 层结构，跳过转换并按原样加载",
        )

    try:
        remapped = remap_lora_state_dict(state_dict, source_name=source_name, old_to_new=old_to_new)
    except LoraRemapError as error:
        return state_dict, STATUS_ERROR, str(error)
    except Exception as error:  # noqa: BLE001 - 兜底，绝不让转换失败中断工作流
        return state_dict, STATUS_ERROR, f"{source_name} 层转换异常: {error}"

    message = (
        f"{source_name} 已暂存转换 28 层 -> 40 层："
        f"{info['matched_keys']} 个主干键，覆盖 {len(info['indices'])} 层"
    )
    return remapped, STATUS_CONVERTED, message


def get_model_block_count(model):
    """取 ComfyUI ModelPatcher 主干 blocks 层数；无法判定时返回 None。

    注意只看 diffusion_model.blocks（主干），不看 llm_adapter.blocks。
    """
    try:
        diffusion_model = getattr(getattr(model, "model", None), "diffusion_model", None)
        if diffusion_model is None:
            return None
        blocks = getattr(diffusion_model, "blocks", None)
        if blocks is None:
            return None
        return len(blocks)
    except Exception:
        return None


def is_anima_40_model(model):
    """是否为 40 层 Anima 主干模型（Anima 2.9B）。"""
    return get_model_block_count(model) == NEW_BLOCK_COUNT


def is_anima_model(model):
    """是否为 Anima 系模型：diffusion_model 同时具备 blocks 与 llm_adapter。"""
    try:
        diffusion_model = getattr(getattr(model, "model", None), "diffusion_model", None)
        if diffusion_model is None:
            return False
        return hasattr(diffusion_model, "blocks") and hasattr(diffusion_model, "llm_adapter")
    except Exception:
        return False


__all__ = [
    "BLOCK_PATTERNS",
    "INSERTION_POSITIONS",
    "LoraRemapError",
    "NEW_BLOCK_COUNT",
    "OLD_BLOCK_COUNT",
    "OLD_TO_NEW",
    "STATUS_ALREADY_40",
    "STATUS_CONVERTED",
    "STATUS_ERROR",
    "STATUS_NOT_ANIMA",
    "analyze_lora_blocks",
    "build_old_to_new_map",
    "find_main_block",
    "get_model_block_count",
    "is_28_layer_anima_lora",
    "is_anima_40_model",
    "is_anima_model",
    "remap_key",
    "remap_lora_state_dict",
    "remap_lora_state_dict_safe",
]
