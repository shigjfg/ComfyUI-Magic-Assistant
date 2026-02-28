import torch
import os
import json
import folder_paths
import comfy.sd
import comfy.utils
import comfy.lora
from server import PromptServer
from aiohttp import web
import numpy as np
from PIL import Image
import hashlib
import urllib.request
import urllib.error
import urllib.parse
import re
import shutil
import time

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils

# =============================================================================
# INT8 LoRA 支持 - 整合的代码（不依赖外部导入）
# =============================================================================

# 尝试导入 LoRAAdapter（ComfyUI 的适配器基类）
try:
    from comfy.weight_adapter.lora import LoRAAdapter
    _LORA_ADAPTER_AVAILABLE = True
except ImportError:
    _LORA_ADAPTER_AVAILABLE = False

# --- INT8 量化工具函数 ---

def stochastic_round_int8_delta(x: torch.Tensor, scale, seed: int = 0) -> torch.Tensor:
    """
    使用随机舍入将 delta 张量量化为 INT8。
    用于 LoRA deltas 以最小化量化误差。
    """
    generator = torch.Generator(device=x.device)
    generator.manual_seed(seed)
    
    # 缩放到 INT8 范围
    if isinstance(scale, torch.Tensor):
        scale_val = scale.item() if scale.numel() == 1 else scale
    else:
        scale_val = float(scale)
    
    x_scaled = x / scale_val
    
    # 随机舍入
    x_floor = torch.floor(x_scaled)
    fraction = x_scaled - x_floor
    
    # 在目标设备上直接创建随机值
    random_vals = torch.rand(x_scaled.shape, generator=generator, device=x.device, dtype=x_scaled.dtype)
    x_rounded = torch.where(random_vals < fraction, x_floor + 1, x_floor)
    
    return torch.clamp(x_rounded, -128, 127).to(torch.int8)

# --- INT8 LoRA 适配器 ---

if _LORA_ADAPTER_AVAILABLE:
    class INT8LoRAPatchAdapter(LoRAAdapter):
        """
        专门的 LoRA 适配器，在 INT8 空间内就地补丁 INT8 权重。
        """
        def __init__(self, loaded_keys, weights, weight_scale, seed=0):
            super().__init__(loaded_keys, weights)
            self.weight_scale = weight_scale
            self.seed = seed

        def calculate_weight(self, weight, key, strength, strength_model, offset, function, intermediate_dtype=torch.float32, original_weight=None):
            v = self.weights
            up, down, alpha = v[0], v[1], v[2]
            
            rank = down.shape[0] if down.ndim >= 2 else 1
            scale = (alpha / rank) * strength if alpha is not None else strength
            
            device = weight.device
            
            # 在高精度 GPU 上计算 LoRA Delta
            comp_device = torch.device("cuda") if torch.cuda.is_available() else device
            
            up_f = up.to(comp_device, dtype=intermediate_dtype)
            down_f = down.to(comp_device, dtype=intermediate_dtype)
            
            # 处理可能的 mid weights (LoCon/LoHA)
            if v[3] is not None:
                mid_f = v[3].to(comp_device, dtype=intermediate_dtype)
                lora_diff = torch.mm(up_f.flatten(1), torch.mm(mid_f.flatten(1), down_f.flatten(1))).reshape(weight.shape)
            else:
                lora_diff = torch.mm(up_f.flatten(1), down_f.flatten(1)).reshape(weight.shape)
            
            # 应用补丁
            if weight.dtype == torch.int8:
                # --- INT8 空间补丁 ---
                delta_f = lora_diff * scale
                delta_int8 = stochastic_round_int8_delta(delta_f, self.weight_scale, self.seed)
                
                # 执行整数加法（int32 安全）然后钳制
                res = weight.to(comp_device, torch.int32) + delta_int8.to(comp_device, torch.int32)
                return torch.clamp(res, -128, 127).to(torch.int8).to(device)
            else:
                # 回退：标准浮点补丁
                return weight + (lora_diff * scale).to(weight.device, weight.dtype)
else:
    INT8LoRAPatchAdapter = None

# --- LoRA 串（lora_chain）格式：仅本加载器识别，用于节点间传递 LoRA 列表 ---
MAGIC_LORA_CHAIN_KEY = "_magic_lora_chain"

def _parse_lora_chain(chain_in):
    """解析 lora串接受。
    合法格式为 dict: {"_magic_lora_chain": True, "loras": [...]}
    也兼容旧版 JSON 字符串格式。None / 空值返回空列表。
    """
    if chain_in is None:
        return []
    # 兼容旧版 JSON 字符串
    if isinstance(chain_in, str):
        if not chain_in.strip():
            return []
        try:
            chain_in = json.loads(chain_in)
        except (json.JSONDecodeError, TypeError):
            raise RuntimeError(
                "lora串接受 收到了无效数据，请确保连接自「强力 LoRA 加载器」的 lora串输出，不要接入其他文本或节点。"
            )
    if not isinstance(chain_in, dict) or chain_in.get(MAGIC_LORA_CHAIN_KEY) is not True:
        raise RuntimeError(
            "lora串接受 收到了非 LoRA 串格式的数据，请确保连接自「强力 LoRA 加载器」的 lora串输出。"
        )
    loras = chain_in.get("loras")
    if not isinstance(loras, list):
        return []
    return loras

def _serialize_lora_chain(items):
    """将 LoRA 列表打包为 lora串输出（dict 格式，作为 MAGIC_LORA_CHAIN 类型传递）。"""
    return {MAGIC_LORA_CHAIN_KEY: True, "loras": items}

# --- 动态 LoRA 同步 Hook ---

class DynamicLoRAHook:
    """
    在 diffusion_model 上注册的 Hook，用于在每次前向传播开始时
    将动态 LoRA 属性与当前 ModelPatcher 上下文同步。
    """
    def __init__(self):
        self.current_lora_id = None

    def pre_forward(self, module, input_args, input_kwargs):
        # 1. 尝试查找 transformer_options
        transformer_options = input_kwargs.get("transformer_options", {})
        if not transformer_options:
            # 回退：某些模型在 context 中传递
            context = input_args[2] if len(input_args) > 2 else None
            if isinstance(context, dict) and "transformer_options" in context:
                transformer_options = context["transformer_options"]
        
        dynamic_loras = transformer_options.get("dynamic_loras", [])
        
        # 2. 为此 LoRA 集合生成唯一 ID
        # 使用 handles/strengths 检测变化
        lora_id = hash(tuple((id(d["patches"]), d["strength"]) for d in dynamic_loras)) if dynamic_loras else None
        
        if lora_id == self.current_lora_id:
            return None  # 已同步
        
        # 3. 同步所有线性层
        self.apply_composition(module, dynamic_loras)
        self.current_lora_id = lora_id
        return None

    def apply_composition(self, diffusion_model, dynamic_loras):
        # 按层预分组补丁
        layer_patches = {}
        if dynamic_loras:
            for entry in dynamic_loras:
                strength = entry["strength"]
                for key, adapter in entry["patches"].items():
                    if key not in layer_patches:
                        layer_patches[key] = []
                    layer_patches[key].append((adapter, strength))

        # 更新所有模块
        for name, module in diffusion_model.named_modules():
            # 检查是否是线性层（需要支持 LoRA）
            if not isinstance(module, torch.nn.Linear):
                continue
            
            # 如果模块没有 lora_A 属性，初始化它（用于动态模式）
            if not hasattr(module, "lora_A"):
                module.lora_A = None
            if not hasattr(module, "lora_B"):
                module.lora_B = None
            if not hasattr(module, "lora_alpha"):
                module.lora_alpha = None
            
            # 查找此模块的补丁
            # ComfyUI 键通常是 'diffusion_model.path.to.weight' 或 'path.to.weight'
            possible_keys = [f"diffusion_model.{name}.weight", f"{name}.weight"]
            patches = None
            for pk in possible_keys:
                if pk in layer_patches:
                    patches = layer_patches[pk]
                    break
            
            if not patches:
                module.lora_A = None
                module.lora_B = None
                module.lora_alpha = None
                continue

            # 组合
            all_A = []
            all_B = []
            for adapter, strength in patches:
                v = adapter.weights
                up, down, alpha, mid = v[0], v[1], v[2], v[3]
                rank = down.shape[0] if down.ndim >= 2 else 1
                scale = (alpha / rank) * strength if alpha is not None else strength
                
                curr_A = down
                if mid is not None:
                    curr_A = torch.mm(mid.flatten(1), down.flatten(1)).reshape(down.shape)
                
                all_A.append(curr_A * scale)
                all_B.append(up)
            
            if all_A:
                device = getattr(module, "weight", torch.tensor(0)).device
                module.lora_A = torch.cat(all_A, dim=0).to(device)
                module.lora_B = torch.cat(all_B, dim=1).to(device)
                module.lora_alpha = None
            else:
                module.lora_A = None
                module.lora_B = None

    @classmethod
    def register(cls, diffusion_model):
        if not hasattr(diffusion_model, "_dynamic_lora_hook"):
            hook = cls()
            diffusion_model._dynamic_lora_hook = hook
            diffusion_model.register_forward_pre_hook(hook.pre_forward, with_kwargs=True)
        return diffusion_model._dynamic_lora_hook

# INT8 支持可用性标志
INT8_AVAILABLE = _LORA_ADAPTER_AVAILABLE and INT8LoRAPatchAdapter is not None

class MagicPowerLoraLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_stack": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora串接受": ("MAGIC_LORA_CHAIN",),
            },
            "hidden": {
                "int8_mode": ("STRING", {"default": "none"}),
                "sdnq_mode": ("STRING", {"default": "none"}),
                "adaptive_mode": ("BOOLEAN", {"default": False}),  # 自适应模式：自动检测模型类型选择合适模式
                "lora串输出已连接": ("BOOLEAN", {"default": True}),  # 由前端根据图连接注入：未连接=链末端
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING", "MAGIC_LORA_CHAIN")
    RETURN_NAMES = ("model", "clip", "lora_preview", "tags_output", "lora串输出")
    OUTPUT_IS_LIST = (False, False, True, False, False)  # IMAGE是列表输出（图片组）
    FUNCTION = "apply_loras"
    CATEGORY = "✨ Magic Assistant"

    # 检测模型是否为 INT8 量化模型
    @staticmethod
    def is_int8_model(model):
        """检测模型是否使用 INT8 量化"""
        try:
            if not hasattr(model, 'model') or not hasattr(model.model, 'diffusion_model'):
                return False
            
            # 检查是否有量化层
            for name, module in model.model.diffusion_model.named_modules():
                if hasattr(module, '_is_quantized') and module._is_quantized:
                    return True
                # 检查权重是否为 INT8
                if hasattr(module, 'weight') and hasattr(module.weight, 'dtype'):
                    if module.weight.dtype == torch.int8:
                        return True
            return False
        except Exception:
            return False

    # 检测模型是否为 SDNQ 模型（DiffusionPipeline 或 Magic SDNQ Loader 的 wrapper）
    @staticmethod
    def is_sdnq_model(model):
        """检测模型是否为 SDNQ 模型（diffusers DiffusionPipeline 或 Magic SDNQ Loader 的 pipeline wrapper）"""
        try:
            from diffusers import DiffusionPipeline

            # 直接是 DiffusionPipeline
            if isinstance(model, DiffusionPipeline):
                return True

            # Magic SDNQ Loader 的 SDNQModelWrapper（有 get_pipeline 返回 pipeline）
            if hasattr(model, 'get_pipeline'):
                pipeline = model.get_pipeline()
                if isinstance(pipeline, DiffusionPipeline):
                    return True

            # 有 DiffusionPipeline 特征属性
            if hasattr(model, 'unet') or hasattr(model, 'transformer'):
                if hasattr(model, 'text_encoder') or hasattr(model, 'vae'):
                    return True

            return False
        except ImportError:
            return False
        except Exception:
            return False

    # 🌟 核心修复：更强大的图片查找逻辑（优先查找magicloradate子目录）
    @staticmethod
    def get_preview_path(lora_name):
        try:
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if lora_path is None: return None
            
            dirname = os.path.dirname(lora_path)
            filename_no_ext = os.path.splitext(os.path.basename(lora_path))[0]
            base_name = os.path.splitext(lora_path)[0]
            
            # 图片扩展名候选列表
            candidates = [".png", ".jpg", ".jpeg", ".webp"]
            candidates += [".preview.png", ".preview.jpg", ".cover.png", ".cover.jpg"]
            
            # 1. 优先检查 magicloradate 子目录（参考zml代码的zml子目录优先逻辑）
            magicloradate_dir = os.path.join(dirname, "magicloradate")
            if os.path.isdir(magicloradate_dir):
                for ext in candidates:
                    sub_path = os.path.join(magicloradate_dir, filename_no_ext + ext)
                    if os.path.exists(sub_path):
                        return sub_path
            
            # 2. 如果magicloradate子目录没有，检查同层级
            for ext in candidates:
                if os.path.exists(base_name + ext):
                    return base_name + ext
                
            return None
        except Exception:
            return None

    def apply_loras(self, lora_stack, model=None, clip=None, adaptive_mode=False, int8_mode="none", sdnq_mode="none", **kwargs):
        """
        应用 LoRA
        int8_mode: "none" (默认), "stochastic" (静态), "dynamic" (动态)
        sdnq_mode: "none" (默认), "sdnq" (SDNQ 模式，用于 DiffusionPipeline)
        链末端由「lora串输出」是否被连接判定：未连接则为末端，末端才加载 LoRA 并需连接 model/clip。
        """
        # 确保 adaptive_mode 是正确的布尔值（处理 JavaScript 传递的字符串 "false"）
        if isinstance(adaptive_mode, str):
            adaptive_mode = adaptive_mode.lower() == "true"
        adaptive_mode = bool(adaptive_mode)

        # 前端根据图连接注入 lora串输出已连接；未注入时默认 True（视为非末端，不加载，避免误加载）
        lora_output_connected = kwargs.get("lora串输出已连接", True)
        chain_end = not lora_output_connected

        # ---------- 解析 lora串接受（MAGIC_LORA_CHAIN 类型，由 ComfyUI 自动传递）----------
        lora_chain_in = kwargs.get("lora串接受", None)
        try:
            received_list = _parse_lora_chain(lora_chain_in)
        except RuntimeError as e:
            raise RuntimeError(str(e))

        # ---------- 本节点 lora_stack 解析 ----------
        try:
            if not isinstance(lora_stack, str) or not lora_stack.strip():
                stack_data = []
            else:
                stack_data = json.loads(lora_stack)
        except Exception:
            stack_data = []

        own_items = []
        if isinstance(stack_data, dict):
            if "folders" in stack_data:
                for f in stack_data["folders"]:
                    if f.get("loras"):
                        own_items.extend([l for l in f["loras"] if l.get("enabled", True)])
            if "loras" in stack_data:
                own_items.extend([l for l in stack_data["loras"] if l.get("enabled", True)])
        elif isinstance(stack_data, list):
            own_items = [l for l in stack_data if l.get("enabled", True)]

        # 合并顺序：本节点 + 接收到的（本节点在上，接收到的在下）
        merged = own_items + received_list
        lora_chain_out = _serialize_lora_chain(merged)

        # 链末端但未收到上游时提示：可能上游加载器未参与执行（依赖未进 prompt/执行列表）
        if chain_end and len(received_list) == 0:
            print(f"💡 [MagicPowerLora] 链末端：本节点 {len(own_items)} 个 LoRA，未收到上游 lora 串。若工作流中有上游加载器将「lora串输出」接到本节点「lora串接受」，请保存工作流后执行完整图（不要只执行部分节点）。")

        # ---------- 非链末端：只传出 lora 串，不加载；不要求 model/clip ----------
        if not chain_end:
            placeholder_preview = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]
            return (model, clip, placeholder_preview, "", lora_chain_out)

        # ---------- 链末端：必须连接 model 和 clip ----------
        if model is None or clip is None:
            raise RuntimeError("链末端节点（未将 lora串输出 接到其他加载器的节点）必须连接 model 和 clip。")
        out_model = model
        out_clip = clip
        active_tags = []
        preview_images = []

        items_to_process = merged  # 末端用合并后的整链列表加载

        # 检测模型类型
        is_int8 = self.is_int8_model(out_model)
        is_sdnq = self.is_sdnq_model(out_model)

        # ========== 自适应模式检测 ==========
        if adaptive_mode:
            print(f"🔄 [MagicPowerLora] 自适应模式：检测到 SDNQ={is_sdnq}, INT8={is_int8}")
            if is_sdnq:
                sdnq_mode = "sdnq"
                int8_mode = "none"
                print(f"   → 自动切换到 SDNQ 模式")
            elif is_int8:
                int8_mode = "dynamic"
                sdnq_mode = "none"
                print(f"   → 自动切换到 INT8 动态模式")
            else:
                int8_mode = "none"
                sdnq_mode = "none"
                print(f"   → 自动切换到标准模式")
        # ====================================

        if sdnq_mode == "sdnq" and not is_sdnq:
            print(f"⚠️ [MagicPowerLora] SDNQ 模式已启用，但模型似乎不是 SDNQ 模型（DiffusionPipeline），将回退到标准模式")
            sdnq_mode = "none"
        if sdnq_mode == "none" and is_sdnq:
            print(f"💡 [MagicPowerLora] 检测到 SDNQ 模型（DiffusionPipeline），建议在设置中启用 SDNQ 模式")
        # 仅在实际会走 INT8/标准路径时提示 INT8（走 SDNQ 时忽略节点上残留的 int8_mode 设置，避免误报）
        using_sdnq = (sdnq_mode == "sdnq" and is_sdnq)
        if not using_sdnq:
            if int8_mode != "none" and not is_int8:
                print(f"⚠️ [MagicPowerLora] INT8 模式已启用，但模型似乎不是 INT8 量化模型，将尝试使用 INT8 加载器")
            if int8_mode == "none" and is_int8:
                print(f"💡 [MagicPowerLora] 检测到 INT8 模型，建议在设置中启用 INT8 模式以获得更好的兼容性")

        mode_str = f"{int8_mode}" if int8_mode != "none" else (f"{sdnq_mode}" if sdnq_mode != "none" else "standard")
        adaptive_str = f" (Adaptive)" if adaptive_mode else ""
        
        # 如果没有LoRA需要加载，直接返回（不做任何加载尝试）
        if not items_to_process:
            print(f"🚀 [MagicPowerLora] 链末端：无 LoRA 需要加载")
            if not preview_images:
                preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]
            return (out_model, out_clip, preview_images, "", lora_chain_out)
        
        print(f"🚀 [MagicPowerLora] 链末端：加载 {len(items_to_process)} 个 LoRA（含串接）... (Mode: {mode_str}{adaptive_str})")

        # 根据模式选择加载方式
        if int8_mode == "stochastic" and INT8_AVAILABLE:
            # 静态模式（Stochastic）- 整合的 INT8 LoRA 加载逻辑
            for item in items_to_process:
                lora_name = item.get("name")
                weight = float(item.get("weight", 1.0))
                if not lora_name: continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                    continue

                try:
                    # 加载 LoRA 文件
                    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    
                    # 克隆 model patcher
                    model_patcher = out_model.clone()
                    
                    # 获取键映射
                    key_map = {}
                    if model_patcher.model.model_type.name != "ModelType.CLIP":
                        key_map = comfy.lora.model_lora_keys_unet(model_patcher.model, key_map)
                    
                    # 使用 ComfyUI 的 load_lora 处理各种 LoRA 格式
                    patch_dict = comfy.lora.load_lora(lora, key_map, log_missing=True)
                    
                    # 升级补丁以支持高精度 INT8 空间补丁
                    final_patch_dict = {}
                    applied_count = 0
                    seed = 318008  # 默认 seed
                    
                    for key, adapter in patch_dict.items():
                        # key 可以是 "layer.name.weight" 或 ("layer.name", (dim, start, size))
                        layer_name = key[0] if isinstance(key, tuple) else key
                        if layer_name.endswith(".weight"):
                            layer_name = layer_name[:-7]
                        
                        # 解析模块以检查量化状态并获取 scale
                        try:
                            parts = layer_name.split(".")
                            target_module = model_patcher.model.diffusion_model
                            for part in parts[1:] if parts[0] == "diffusion_model" else parts:
                                if part.isdigit():
                                    target_module = target_module[int(part)]
                                else:
                                    target_module = getattr(target_module, part)
                            
                            # 如果模块已量化，升级适配器到我们的高精度版本
                            if hasattr(target_module, '_is_quantized') and target_module._is_quantized:
                                w_scale = target_module.weight_scale
                                if isinstance(w_scale, torch.Tensor):
                                    w_scale = w_scale.item() if w_scale.numel() == 1 else w_scale
                                
                                # 创建专门的 INT8 适配器
                                if INT8LoRAPatchAdapter:
                                    new_adapter = INT8LoRAPatchAdapter(
                                        adapter.loaded_keys, 
                                        adapter.weights, 
                                        w_scale,
                                        seed=seed
                                    )
                                    final_patch_dict[key] = new_adapter
                                    applied_count += 1
                                else:
                                    final_patch_dict[key] = adapter
                            else:
                                final_patch_dict[key] = adapter
                                
                        except (AttributeError, KeyError, IndexError, TypeError):
                            final_patch_dict[key] = adapter
                    
                    # 添加补丁到 patcher
                    model_patcher.add_patches(final_patch_dict, weight)
                    out_model = model_patcher
                    
                    print(f"   ✅ Applied (INT8 Stochastic): {lora_name} ({applied_count} quantized layers)")
                except Exception as e:
                    print(f"   ❌ Failed (INT8 Stochastic): {lora_name} -> {e}")
                    # 回退到标准模式
                    try:
                        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                        out_model, out_clip = comfy.sd.load_lora_for_models(out_model, out_clip, lora, weight, weight)
                        print(f"   ✅ Applied (Fallback): {lora_name}")
                    except Exception as e2:
                        print(f"   ❌ Failed (Fallback): {lora_name} -> {e2}")

                if "tags" in item and item["tags"]:
                    active_tags.append(str(item["tags"]))

                # 为每个lora尝试加载预览图
                img_path = self.get_preview_path(lora_name)
                if img_path:
                    try:
                        i = Image.open(img_path).convert("RGB")
                        i = np.array(i).astype(np.float32) / 255.0
                        preview_tensor = torch.from_numpy(i)[None,]
                        preview_images.append(preview_tensor)
                    except Exception as e:
                        print(f"   ⚠️ Failed to load preview for {lora_name}: {e}")

        elif int8_mode == "dynamic" and INT8_AVAILABLE:
            # 动态模式（Dynamic）- 整合的 INT8 动态 LoRA 加载逻辑
            for item in items_to_process:
                lora_name = item.get("name")
                weight = float(item.get("weight", 1.0))
                if not lora_name: continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                    continue

                try:
                    # 加载 LoRA 文件
                    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    
                    # 克隆 model patcher
                    model_patcher = out_model.clone()
                    
                    # 1. 获取补丁映射
                    key_map = {}
                    if model_patcher.model.model_type.name != "ModelType.CLIP":
                        key_map = comfy.lora.model_lora_keys_unet(model_patcher.model, key_map)
                    
                    patch_dict = comfy.lora.load_lora(lora, key_map, log_missing=True)
                    
                    # 2. 注册全局 Hook（如果不存在）
                    DynamicLoRAHook.register(model_patcher.model.diffusion_model)
                    
                    # 3. 添加到 transformer_options 中的动态 LoRA 列表
                    # 这确保 ComfyUI 的克隆处理所有内容，并且是非粘性的
                    if "transformer_options" not in model_patcher.model_options:
                        model_patcher.model_options["transformer_options"] = {}
                    
                    opts = model_patcher.model_options["transformer_options"]
                    if "dynamic_loras" not in opts:
                        opts["dynamic_loras"] = []
                    else:
                        # 浅拷贝列表以避免修改父 patcher 的列表
                        opts["dynamic_loras"] = opts["dynamic_loras"].copy()
                    
                    opts["dynamic_loras"].append({
                        "name": lora_name,
                        "strength": weight,
                        "patches": patch_dict
                    })
                    
                    out_model = model_patcher
                    print(f"   ✅ Applied (INT8 Dynamic): {lora_name}")
                except Exception as e:
                    print(f"   ❌ Failed (INT8 Dynamic): {lora_name} -> {e}")
                    # 回退到标准模式
                    try:
                        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                        out_model, out_clip = comfy.sd.load_lora_for_models(out_model, out_clip, lora, weight, weight)
                        print(f"   ✅ Applied (Fallback): {lora_name}")
                    except Exception as e2:
                        print(f"   ❌ Failed (Fallback): {lora_name} -> {e2}")

                if "tags" in item and item["tags"]:
                    active_tags.append(str(item["tags"]))

                # 为每个lora尝试加载预览图
                img_path = self.get_preview_path(lora_name)
                if img_path:
                    try:
                        i = Image.open(img_path).convert("RGB")
                        i = np.array(i).astype(np.float32) / 255.0
                        preview_tensor = torch.from_numpy(i)[None,]
                        preview_images.append(preview_tensor)
                    except Exception as e:
                        print(f"   ⚠️ Failed to load preview for {lora_name}: {e}")

        elif sdnq_mode == "sdnq" and is_sdnq:
            # SDNQ 模式 - 链末端：先全局卸载，再按合并列表顺序加载（与 comfyui-sdnq 每次运行先卸再加载一致）
            sdnq_success = False
            try:
                from diffusers import DiffusionPipeline
                diffusers_ok = True
            except ImportError:
                print(f"❌ [MagicPowerLora] SDNQ 模式需要 diffusers 库，但未安装。")
                diffusers_ok = False

            if diffusers_ok:
                pipeline = out_model.get_pipeline() if hasattr(out_model, 'get_pipeline') else out_model
                if not isinstance(pipeline, DiffusionPipeline):
                    print(f"   ⚠️ [MagicPowerLora] SDNQ 模式需要 DiffusionPipeline，当前 model: {type(out_model).__name__}, pipeline: {type(pipeline).__name__}")
                else:
                    print(f"   [SDNQ] Pipeline: {type(pipeline).__name__}，链末端：先全局卸载再加载 {len(items_to_process)} 个 LoRA...")
                    if hasattr(pipeline, 'unload_lora_weights'):
                        pipeline.unload_lora_weights()
                        print(f"   [SDNQ] 已全局卸载")
                    lora_adapters = []
                    lora_weights = []

                    for idx, item in enumerate(items_to_process):
                        lora_name = item.get("name", "").strip()
                        weight = float(item.get("weight", 1.0))
                        if not lora_name:
                            continue
                        lora_path = None
                        try:
                            lora_path = folder_paths.get_full_path("loras", lora_name) or folder_paths.get_full_path("loras", lora_name.replace("\\", "/"))
                            if lora_path is None:
                                lora_folders = folder_paths.get_folder_paths("loras") or []
                                if lora_folders:
                                    for lora_folder in lora_folders:
                                        for name_variant in (lora_name, lora_name.replace("\\", "/"), lora_name.replace("/", "\\")):
                                            potential_path = os.path.normpath(os.path.join(lora_folder, name_variant))
                                            if os.path.isfile(potential_path):
                                                lora_path = potential_path
                                                break
                                        if lora_path is not None:
                                            break
                                if lora_path is None and lora_folders:
                                    fallback = os.path.normpath(os.path.join(lora_folders[0], lora_name))
                                    lora_path = fallback if os.path.isfile(fallback) else None
                        except Exception:
                            pass
                        if not lora_path or not os.path.isfile(lora_path):
                            print(f"   ⚠️ [SDNQ] LoRA 未找到: {lora_name}")
                            continue
                        try:
                            is_local_file = os.path.exists(lora_path) and os.path.isfile(lora_path)
                            path_hash = abs(hash(os.path.normpath(lora_path))) % (10 ** 8)
                            adapter_name = f"lora_{path_hash}_{idx}"
                            print(f"   [SDNQ] Loading ({adapter_name})... {lora_name} (strength: {weight})")
                            if is_local_file:
                                pipeline.load_lora_weights(
                                    os.path.dirname(lora_path),
                                    weight_name=os.path.basename(lora_path),
                                    adapter_name=adapter_name
                                )
                            else:
                                pipeline.load_lora_weights(lora_path, adapter_name=adapter_name)
                            lora_adapters.append(adapter_name)
                            lora_weights.append(weight)
                            print(f"   ✅ Applied (SDNQ): {lora_name} (strength: {weight})")
                            sdnq_success = True
                        except Exception as e:
                            import traceback
                            print(f"   ❌ Failed (SDNQ): {lora_name}")
                            traceback.print_exc()
                            continue
                        if "tags" in item and item.get("tags"):
                            active_tags.append(str(item["tags"]))
                        img_path = self.get_preview_path(lora_name)
                        if img_path:
                            try:
                                i = Image.open(img_path).convert("RGB")
                                i = np.array(i).astype(np.float32) / 255.0
                                preview_tensor = torch.from_numpy(i)[None,]
                                preview_images.append(preview_tensor)
                            except Exception:
                                pass

                    if lora_adapters:
                        try:
                            pipeline.set_adapters(lora_adapters, adapter_weights=lora_weights)
                            print(f"   ✅ [SDNQ] {len(lora_adapters)} LoRA(s) active")
                            sdnq_success = True
                        except Exception as e:
                            print(f"   ⚠️ [SDNQ] Failed to set adapter weights: {e}")
                            sdnq_success = False
                    elif items_to_process:
                        print(f"   ℹ️ [SDNQ] No LoRAs to load (本链均加载失败)")
                        sdnq_success = False

            if not sdnq_success and (sdnq_mode == "sdnq" and is_sdnq):
                print(f"   ⚠️ [MagicPowerLora] SDNQ LoRA 加载失败，无法回退到标准模式（SDNQ 模型与 ComfyUI 标准 LoRA 不兼容）")
                print(f"   💡 Troubleshooting（与 comfyui-sdnq 源节点一致）：")
                print(f"      1. 确认 LoRA 文件存在（.safetensors），路径格式与 loras 文件夹内一致")
                print(f"      2. 确认 LoRA 与当前 SDNQ 模型架构兼容（Flux2Klein 需 Flux2Klein 专用 LoRA）")
                print(f"      3. 可在 comfyui-sdnq 独立采样器中验证该 LoRA 是否能加载")
                print(f"      4. 或尝试不使用 LoRA 运行")
        
        else:
            # 标准模式（默认）或回退模式
            # 只有在没有选择 INT8 或 SDNQ 模式时才执行
            for item in items_to_process:
                lora_name = item.get("name")
                weight = float(item.get("weight", 1.0))
                if not lora_name: continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                    continue

                try:
                    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    out_model, out_clip = comfy.sd.load_lora_for_models(out_model, out_clip, lora, weight, weight)
                    print(f"   ✅ Applied: {lora_name}")
                except Exception as e:
                    print(f"   ❌ Failed: {lora_name} -> {e}")

                if "tags" in item and item["tags"]:
                    active_tags.append(str(item["tags"]))

                # 为每个lora尝试加载预览图
                img_path = self.get_preview_path(lora_name)
                if img_path:
                    try:
                        i = Image.open(img_path).convert("RGB")
                        i = np.array(i).astype(np.float32) / 255.0
                        preview_tensor = torch.from_numpy(i)[None,]
                        preview_images.append(preview_tensor)
                    except Exception as e:
                        print(f"   ⚠️ Failed to load preview for {lora_name}: {e}")

        # 如果没有找到任何预览图，返回一个占位图
        if not preview_images:
            preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]

        final_text = ", ".join(active_tags)
        return (out_model, out_clip, preview_images, final_text, lora_chain_out)

# --- API 接口 ---

@PromptServer.instance.routes.get("/ma/lora/list")
async def get_lora_list(request):
    try:
        lora_names = folder_paths.get_filename_list("loras")
        return web.json_response({"files": lora_names})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})

@PromptServer.instance.routes.get("/ma/lora/images")
async def get_lora_images(request):
    """获取所有LoRA文件及其对应的预览图的映射（优先查找magicloradate子目录）"""
    try:
        lora_files = folder_paths.get_filename_list("loras")
        images = {}
        
        for lora_filename in lora_files:  # lora_filename is like "subdir/mylora.safetensors"
            lora_full_path = folder_paths.get_full_path("loras", lora_filename)
            if not lora_full_path:
                continue

            lora_dir = os.path.dirname(lora_full_path)
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_filename))[0]
            
            # 优先在 magicloradate 子目录查找预览图，若无则查找同层级（magicloradate > 同层级）
            magicloradate_dir = os.path.join(lora_dir, "magicloradate")
            found = False
            
            # 先检查magicloradate子目录
            for ext in [".png", ".jpg", ".jpeg", ".webp"]:
                preview_path_magic = os.path.join(magicloradate_dir, f"{lora_basename_no_ext}{ext}")
                if os.path.isfile(preview_path_magic):
                    lora_dir_relative = os.path.dirname(lora_filename)  # e.g. "subdir"
                    preview_basename = os.path.basename(preview_path_magic)  # e.g. "mylora.png"
                    relative_path_for_frontend = os.path.join(lora_dir_relative, preview_basename).replace("\\", "/")
                    images[lora_filename] = relative_path_for_frontend
                    found = True
                    break
            
            # 如果magicloradate子目录没有找到，检查同层级
            if not found:
                for ext in [".png", ".jpg", ".jpeg", ".webp"]:
                    preview_path_same = os.path.join(lora_dir, f"{lora_basename_no_ext}{ext}")
                    if os.path.isfile(preview_path_same):
                        lora_dir_relative = os.path.dirname(lora_filename)  # e.g. "subdir"
                        preview_basename = os.path.basename(preview_path_same)  # e.g. "mylora.png"
                        relative_path_for_frontend = os.path.join(lora_dir_relative, preview_basename).replace("\\", "/")
                        images[lora_filename] = relative_path_for_frontend
                        break
            
        return web.json_response(images)
    except Exception as e:
        print(f"获取LoRA图片列表时出错: {e}")
        return web.json_response({})

@PromptServer.instance.routes.get("/ma/lora/image")
async def get_lora_image(request):
    try:
        name = request.query.get("name")
        if not name: return web.Response(status=404)
        
        img_path = MagicPowerLoraLoader.get_preview_path(name)
        if img_path and os.path.exists(img_path):
            return web.FileResponse(img_path)
        
        return web.Response(status=404)
    except Exception as e:
        print(f"❌ Image API Error: {e}")
        return web.Response(status=500)

def get_preset_dir():
    target_dir = os.path.join(MagicUtils.USER_DIR, "lora_presets")
    if not os.path.exists(target_dir): os.makedirs(target_dir, exist_ok=True)
    return target_dir

@PromptServer.instance.routes.post("/ma/lora/save_preset")
async def save_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        content = data.get("content")
        if not preset_name or not content: return web.json_response({"status": "error"})
        
        file_path = os.path.join(get_preset_dir(), f"{preset_name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=4, ensure_ascii=False)
        return web.json_response({"status": "success"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.get("/ma/lora/get_presets")
async def get_presets(request):
    try:
        preset_dir = get_preset_dir()
        files = [f for f in os.listdir(preset_dir) if f.endswith(".json")]
        presets = {}
        for f in files:
            try:
                with open(os.path.join(preset_dir, f), 'r', encoding='utf-8') as pf:
                    presets[f.replace(".json", "")] = json.load(pf)
            except: pass
        return web.json_response({"presets": presets})
    except Exception as e: return web.json_response({"presets": {}, "error": str(e)})

@PromptServer.instance.routes.post("/ma/lora/delete_preset")
async def delete_preset(request):
    try:
        data = await request.json()
        preset_name = data.get("name")
        if not preset_name: return web.json_response({"status": "error", "message": "缺少预设名称"})
        
        preset_dir = get_preset_dir()
        file_path = os.path.join(preset_dir, f"{preset_name}.json")
        
        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success", "message": f"预设 '{preset_name}' 已删除"})
        else:
            return web.json_response({"status": "error", "message": "预设文件不存在"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

# --- 爬取功能辅助函数 ---

def clean_html(raw_html):
    """清理HTML标签"""
    if not raw_html:
        return ""
    text = re.sub(r'</p>|<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    text = re.sub(r'<.*?>', '', text)
    text = re.sub(r'\n\s*\n', '\n', text).strip()
    return text

def calculate_sha256(filepath):
    """计算文件SHA256哈希值"""
    sha256 = hashlib.sha256()
    chunk_size = 65536
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()

def fetch_civitai_data_by_hash(hash_string, max_retries=3, api_delay=0.5):
    """从Civitai API获取数据（带重试机制）"""
    for attempt in range(max_retries):
        try:
            url = f"https://civitai.com/api/v1/model-versions/by-hash/{hash_string}"
            if attempt > 0:
                time.sleep(api_delay * (2 ** attempt))
            else:
                time.sleep(api_delay)
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    model_url = f"https://civitai.com/api/v1/models/{data['modelId']}"
                    model_req = urllib.request.Request(model_url, headers=headers)
                    with urllib.request.urlopen(model_req, timeout=30) as model_response:
                        if model_response.status == 200:
                            data['model'] = json.loads(model_response.read().decode('utf-8'))
                        else:
                            data['model'] = {}
                    return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(api_delay * (2 ** attempt))
                continue
            elif e.code == 404:
                return None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(api_delay * (2 ** attempt))
    return None

def download_file(url, destination_path):
    """下载文件，如果是视频则提取第一帧"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status == 200:
                content_type = response.getheader('Content-Type', '')
                is_video = content_type.startswith('video/') or url.lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))
                
                if is_video and CV2_AVAILABLE:
                    video_path = destination_path + ".temp.mp4"
                    with open(video_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    
                    cap = cv2.VideoCapture(video_path)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret:
                            img_ext = os.path.splitext(destination_path)[1].lower()
                            if img_ext not in ['.png', '.jpg', '.jpeg', '.webp']:
                                destination_path = os.path.splitext(destination_path)[0] + '.jpg'
                            cv2.imwrite(destination_path, frame)
                            cap.release()
                            try:
                                os.remove(video_path)
                            except:
                                pass
                            return True
                        cap.release()
                    try:
                        os.remove(video_path)
                    except:
                        pass
                    return False
                else:
                    with open(destination_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    return True
    except Exception as e:
        print(f"下载文件时出错 {url}: {e}")
    return False

def extract_lora_weight_from_civitai_data(civitai_data, lora_filename):
    """从Civitai数据中提取LoRA的推荐权重值"""
    try:
        lora_basename = os.path.splitext(lora_filename)[0].lower()
        images = civitai_data.get('images', [])
        for image in images:
            meta = image.get('meta', {})
            resources = meta.get('resources', [])
            for resource in resources:
                resource_name = resource.get('name', '').lower()
                resource_weight = resource.get('weight')
                if (resource_name and resource_weight is not None and 
                    (lora_basename in resource_name or resource_name in lora_basename)):
                    return float(resource_weight)
        return None
    except Exception as e:
        print(f"提取权重信息时出错: {e}")
        return None

@PromptServer.instance.routes.post("/ma/lora/fetch_metadata")
async def fetch_metadata(request):
    """爬取LoRA元数据"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name")
        options = data.get("options", {})
        save_path_mode = data.get("save_path_mode", "same_dir")  # "same_dir" or "subfolder"
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        download_txt = options.get("download_txt", True)
        download_json = options.get("download_json", True)
        download_image = options.get("download_image", True)
        download_log = options.get("download_log", True)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        # 确定保存目录
        if save_path_mode == "subfolder":
            save_dir = os.path.join(lora_dir, "magicloradate")
            os.makedirs(save_dir, exist_ok=True)
        else:
            save_dir = lora_dir
        
        # 计算哈希并获取Civitai数据
        file_hash = calculate_sha256(lora_path)
        civitai_data = fetch_civitai_data_by_hash(file_hash)
        
        result = {
            "status": "success",
            "message": [],
            "data": {
                "triggerWords": "",
                "jsonInfo": "",
                "logInfo": ""
            }
        }
        
        if not civitai_data:
            result["message"].append("无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）")
            return web.json_response(result)
        
        model_name = civitai_data.get('model', {}).get('name', 'Unknown')
        result["message"].append(f"已从Civitai获取到 '{model_name}' 的信息")
        
        # 保存触发词文件
        if download_txt and civitai_data.get('trainedWords'):
            words_content = ", ".join(civitai_data['trainedWords'])
            txt_path = os.path.join(save_dir, f"{lora_basename}.txt")
            try:
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(words_content)
                result["data"]["triggerWords"] = words_content
                result["message"].append("触发词已保存")
            except Exception as e:
                result["message"].append(f"触发词保存失败: {e}")
        
        # 保存介绍信息（JSON格式）
        if download_json:
            raw_model_desc = civitai_data.get('model', {}).get('description', '')
            raw_version_desc = civitai_data.get('description', '')
            model_desc = clean_html(raw_model_desc)
            version_desc = clean_html(raw_version_desc)
            base_model = civitai_data.get('baseModel', 'N/A')
            model_id = civitai_data.get('modelId')
            version_id = civitai_data.get('id')
            civitai_link = f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id and version_id else "链接不可用"
            
            json_content = (
                f"--- 基础信息 ---\n"
                f"基础模型: {base_model}\n"
                f"C站链接: {civitai_link}\n\n"
                f"--- 模型介绍 ---\n\n{model_desc if model_desc else '无模型介绍。'}\n\n"
                f"--- 版本信息 ---\n\n{version_desc if version_desc else '无版本信息。'}\n"
            )
            json_path = os.path.join(save_dir, f"{lora_basename}.json")
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    f.write(json_content)
                result["data"]["jsonInfo"] = json_content
                result["message"].append("介绍信息已保存")
            except Exception as e:
                result["message"].append(f"介绍信息保存失败: {e}")
        
        # 保存预览图像
        if download_image and civitai_data.get('images'):
            first_image = civitai_data['images'][0]
            img_url = first_image.get('url')
            if img_url:
                img_ext = os.path.splitext(urllib.parse.urlparse(img_url).path)[1]
                if not img_ext or img_ext.lower() not in ['.png', '.jpg', '.jpeg', '.webp']:
                    img_ext = '.jpg'
                img_path = os.path.join(save_dir, f"{lora_basename}{img_ext}")
                if download_file(img_url, img_path):
                    result["message"].append("预览图像已保存")
                else:
                    result["message"].append("预览图像保存失败")
        
        # 保存默认权重到.log文件
        if download_log:
            preferred_weight = extract_lora_weight_from_civitai_data(civitai_data, os.path.basename(lora_path))
            if preferred_weight is not None:
                log_path = os.path.join(save_dir, f"{lora_basename}.log")
                log_content = f'''{{
"description": "",
"sd version": "",
"activation text": "",
"preferred weight": {preferred_weight},
"negative text": "",
"notes": ""
}}'''
                try:
                    with open(log_path, 'w', encoding='utf-8') as f:
                        f.write(log_content)
                    result["data"]["logInfo"] = log_content
                    result["message"].append(f"默认权重已保存: {preferred_weight}")
                except Exception as e:
                    result["message"].append(f"默认权重保存失败: {e}")
            else:
                result["message"].append("未找到匹配的权重信息")
        
        result["message"] = "\n".join(result["message"])
        return web.json_response(result)
        
    except Exception as e:
        print(f"爬取元数据时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/probe_save_targets")
async def probe_save_targets(request):
    """探测指定LoRA的保存位置可用性（优先检查magicloradate子目录）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        magicloradate_dir_exists = os.path.isdir(magicloradate_dir)
        
        def check_file(path):
            return os.path.exists(path) and os.access(path, os.R_OK)
        
        same_txt = os.path.join(lora_dir, f"{lora_basename}.txt")
        same_json = os.path.join(lora_dir, f"{lora_basename}.json")
        same_log = os.path.join(lora_dir, f"{lora_basename}.log")
        
        magic_txt = os.path.join(magicloradate_dir, f"{lora_basename}.txt")
        magic_json = os.path.join(magicloradate_dir, f"{lora_basename}.json")
        magic_log = os.path.join(magicloradate_dir, f"{lora_basename}.log")
        
        same_files = {
            "txt": check_file(same_txt),
            "json": check_file(same_json),
            "log": check_file(same_log),
        }
        magic_files = {
            "txt": check_file(magic_txt),
            "json": check_file(magic_json),
            "log": check_file(magic_log),
        }
        
        result = {
            "status": "success",
            "magicloradate_dir_exists": magicloradate_dir_exists,
            "magicloradate_files": magic_files,
            "same_files": same_files,
            "magicloradate_has_readable": any(magic_files.values()),
            "same_has_readable": any(same_files.values()),
        }
        
        return web.json_response(result)
        
    except Exception as e:
        print(f"探测保存位置时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/save_lora_file")
async def save_lora_file(request):
    """保存指定LoRA文件的内容（支持保存到magicloradate子目录或同层级）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        content = data.get("content", "")
        target = str(data.get("target", "same")).lower()
        target = "magicloradate" if target == "magicloradate" or target == "subfolder" else "same"
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        if target == "magicloradate":
            file_path = os.path.join(lora_dir, "magicloradate", f"{lora_basename}{file_ext}")
        else:
            file_path = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        # 自动创建目录（如果不存在）
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return web.json_response({"status": "success", "message": f"{file_type}文件保存成功"})
        
    except Exception as e:
        print(f"保存LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/get_lora_file")
async def get_lora_file(request):
    """获取指定LoRA文件的内容（优先从magicloradate子目录读取）"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name") or data.get("lora_filename")
        file_type = data.get("file_type", "txt")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        if file_type == "txt":
            file_ext = ".txt"
        elif file_type == "log":
            file_ext = ".log"
        else:
            file_ext = ".json"
        
        # 优先从magicloradate子目录读取，若无则从同层级读取
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        file_path_magic = os.path.join(magicloradate_dir, f"{lora_basename}{file_ext}")
        file_path_same = os.path.join(lora_dir, f"{lora_basename}{file_ext}")
        
        target_file = None
        if os.path.exists(file_path_magic):
            target_file = file_path_magic
        elif os.path.exists(file_path_same):
            target_file = file_path_same
        else:
            # 如果文件不存在，返回空内容
            return web.json_response({"status": "success", "content": ""})
        
        with open(target_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return web.json_response({"status": "success", "content": content})
        
    except Exception as e:
        print(f"读取LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

@PromptServer.instance.routes.post("/ma/lora/delete_lora_complete")
async def delete_lora_complete(request):
    """一键删除LoRA文件及其所有相关文件"""
    try:
        data = await request.json()
        lora_name = data.get("lora_name")
        
        if not lora_name:
            return web.json_response({"status": "error", "message": "缺少lora_name参数"}, status=400)
        
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if not lora_path or not os.path.exists(lora_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_name}"}, status=404)
        
        lora_dir = os.path.dirname(lora_path)
        lora_basename = os.path.splitext(os.path.basename(lora_path))[0]
        
        deleted_files = []
        
        # 删除主LoRA文件
        try:
            os.remove(lora_path)
            deleted_files.append(os.path.basename(lora_path))
        except Exception as e:
            return web.json_response({"status": "error", "message": f"无法删除主LoRA文件: {e}"}, status=500)
        
        # 删除同目录下的相关文件
        for ext in ['.txt', '.json', '.log', '.png', '.jpg', '.jpeg', '.webp']:
            file_path = os.path.join(lora_dir, f"{lora_basename}{ext}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
        
        # 删除magicloradate子文件夹中的文件
        magicloradate_dir = os.path.join(lora_dir, "magicloradate")
        if os.path.exists(magicloradate_dir):
            import glob
            pattern = os.path.join(magicloradate_dir, f"{lora_basename}.*")
            for file_path in glob.glob(pattern):
                try:
                    os.remove(file_path)
                    deleted_files.append(os.path.basename(file_path))
                except Exception as e:
                    print(f"删除文件时出错 {file_path}: {e}")
            
            # 如果magicloradate目录为空，删除它
            if os.path.exists(magicloradate_dir) and not os.listdir(magicloradate_dir):
                try:
                    os.rmdir(magicloradate_dir)
                except Exception as e:
                    print(f"删除空目录时出错: {e}")
        
        return web.json_response({
            "status": "success",
            "message": f"成功删除 {len(deleted_files)} 个文件",
            "deleted_files": deleted_files
        })
        
    except Exception as e:
        print(f"删除LoRA文件时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)