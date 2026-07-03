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
import asyncio
import functools
from datetime import datetime
from collections import defaultdict

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    from utils import MagicUtils
except ImportError:
    from ..utils import MagicUtils


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
                # int8_mode 仅为向后兼容旧工作流的 widgets_values 索引占位，节点完全忽略其值。
                # ComfyUI 官方 model_patcher.py 已原生支持 INT8/FP8 等量化权重的 LoRA 应用。
                "int8_mode": ("STRING", {"default": "none"}),
                "sdnq_mode": ("STRING", {"default": "none"}),
                "klein_mode": ("STRING", {"default": "auto"}),
                "adaptive_mode": ("BOOLEAN", {"default": False}),  # 自适应模式：自动检测模型类型选择合适模式
                "lora串输出已连接": ("BOOLEAN", {"default": True}),  # 由前端根据图连接注入：未连接=链末端
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING", "MAGIC_LORA_CHAIN")
    RETURN_NAMES = ("model", "clip", "lora_preview", "tags_output", "lora串输出")
    OUTPUT_IS_LIST = (False, False, True, False, False)  # IMAGE是列表输出（图片组）
    FUNCTION = "apply_loras"
    CATEGORY = "✨ Magic Assistant"

    # 类级别缓存：存储已加载的 LoRA 数据
    # 键: (lora_path, weight) 元组
    # 值: 加载的 lora dict
    _loaded_loras = {}

    # 类级别：本次执行使用的 LoRA 缓存键集合（用于执行后清理未使用的缓存）
    # 使用类属性确保在多次运行间正确追踪
    _current_run_used_keys = set()

    @classmethod
    def _mark_lora_used(cls, cache_key):
        """标记本次运行使用了某个 LoRA 缓存"""
        cls._current_run_used_keys.add(cache_key)

    @classmethod
    def _reset_used_tracking(cls):
        """重置追踪状态，在每次 apply_loras 开始时调用"""
        cls._current_run_used_keys = set()

    @classmethod
    def _get_cached_lora(cls, lora_path, weight):
        """从缓存获取 LoRA 数据，或加载并缓存"""
        cache_key = (lora_path, weight)
        cls._mark_lora_used(cache_key)  # 记录本次使用了该 LoRA
        if cache_key in cls._loaded_loras:
            print(f"   💾 [Cache Hit] {os.path.basename(lora_path)} (weight={weight})")
            return cls._loaded_loras[cache_key]
        
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        cls._loaded_loras[cache_key] = lora
        return lora

    @classmethod
    def _cleanup_unused_lora_cache(cls):
        """清理本次执行中未使用的 LoRA 缓存，释放内存"""
        if not cls._loaded_loras:
            return
        
        # 找出本次执行未使用的缓存项
        unused_keys = set(cls._loaded_loras.keys()) - cls._current_run_used_keys
        if not unused_keys:
            return
        
        # 清除未使用的缓存并释放内存
        cleared_count = 0
        for cache_key in unused_keys:
            lora_data = cls._loaded_loras.get(cache_key)
            if lora_data is not None:
                cleared_count += 1
                # 遍历所有张量并移动到 CPU 然后删除（帮助释放 GPU 内存）
                for key in list(lora_data.keys()):
                    tensor = lora_data[key]
                    if hasattr(tensor, 'cpu'):
                        try:
                            tensor = tensor.cpu()
                        except Exception:
                            pass
                    del tensor
                # 清除字典中的引用
                lora_data.clear()
            del cls._loaded_loras[cache_key]
        
        print(f"   🧹 [Cache Cleanup] 已释放 {cleared_count} 个未使用 LoRA 的缓存")
        cls._current_run_used_keys = set()  # 重置追踪状态

    @classmethod
    def _clear_lora_cache(cls, lora_path=None):
        """清除缓存，可指定清除特定路径或全部"""
        if lora_path is None:
            cls._loaded_loras.clear()
        else:
            # 清除与该路径相关的所有缓存项
            keys_to_remove = [k for k in cls._loaded_loras if k[0] == lora_path]
            for k in keys_to_remove:
                del cls._loaded_loras[k]

    # 检测模型是否为 SDNQ 模型（DiffusionPipeline 或 Magic SDNQ Loader 的 wrapper）
    @staticmethod
    def is_sdnq_model(model):
        """检测模型是否为 SDNQ 模型（diffusers DiffusionPipeline 或 Magic SDNQ Loader 的 pipeline wrapper）"""
        try:
            from diffusers import DiffusionPipeline

            if isinstance(model, DiffusionPipeline):
                return True

            if hasattr(model, 'get_pipeline'):
                pipeline = model.get_pipeline()
                if isinstance(pipeline, DiffusionPipeline):
                    return True

            if hasattr(model, 'unet') or hasattr(model, 'transformer'):
                if hasattr(model, 'text_encoder') or hasattr(model, 'vae'):
                    return True

            return False
        except ImportError:
            return False
        except Exception:
            return False

    # 检测模型是否为 Klein 模型（ComfyFlux2KleinWrapper）
    @staticmethod
    def is_klein_model(model):
        """检测模型是否为 Klein 模型（由 Magic Nunchaku FLUX.2 Klein Loader 加载）。"""
        try:
            if not hasattr(model, 'model') or not hasattr(model.model, 'diffusion_model'):
                return False
            wrapper_cls_name = type(model.model.diffusion_model).__name__
            return wrapper_cls_name == "ComfyFlux2KleinWrapper"
        except Exception:
            return False


    # 检测模型是否为 SDNQ 模型（DiffusionPipeline 或 Magic SDNQ Loader 的 wrapper）
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

    def apply_loras(self, lora_stack, model=None, clip=None, adaptive_mode=False, sdnq_mode="none", klein_mode="auto", **kwargs):
        """
        应用 LoRA
        sdnq_mode: "none" (默认), "sdnq" (SDNQ 模式，用于 DiffusionPipeline)
        klein_mode: "none" | "klein" | "auto" (auto 在自适应模式或自动检测时使用)
        链末端由「lora串输出」是否被连接判定：未连接则为末端，末端才加载 LoRA 并需连接 model/clip。

        注意：ComfyUI 官方已在 model_patcher.py 中提供 INT8 等量化权重的 LoRA 支持
        （应用补丁后调用 comfy.float.stochastic_rounding 把结果舍入回权重的原始 dtype），
        因此本加载器与官方 LoraLoader 的默认路径完全一致，可自动处理 FP8/INT8/INT4 等
        量化模型，无需任何特殊适配。
        """
        # 重置本次执行使用的 LoRA 追踪（每次运行独立追踪）
        MagicPowerLoraLoader._reset_used_tracking()

        # -------------------------
        # 调试开关：MAGIC_ASSISTANT_DEBUG
        # -------------------------
        # 用途：排查前端传入的隐藏参数（adaptive/sdnq/klein 等）是否正确。
        # 为什么需要：ComfyUI 的 workflow/节点属性在不同版本之间可能出现“旧数据污染”或类型漂移（例如 true/false 字符串），
        # 这会导致模式判断错误。打开此开关可以打印关键字段，快速定位是前端注入、workflow 保存，还是后端解析出了问题。
        #
        # 开启方式：在启动 ComfyUI 的环境变量中设置：
        #   MAGIC_ASSISTANT_DEBUG=1
        # 示例（Windows PowerShell）：
        #   $env:MAGIC_ASSISTANT_DEBUG=1; python main.py
        # 或者写进你的启动脚本/快捷方式环境。
        #
        # 注意：开启后会打印较多日志，建议仅在排障期间开启。
        debug_enabled = os.getenv("MAGIC_ASSISTANT_DEBUG", "").strip().lower() in {"1", "true", "yes", "y", "on"}

        if debug_enabled:
            # [DEBUG] 打印 adaptive_mode 的原始输入值，用于排查模式判断错误
            print(f"[DEBUG] adaptive_mode 原始值: {repr(adaptive_mode)} (type={type(adaptive_mode).__name__})", flush=True)

            # [DEBUG] 打印 kwargs 中的相关字段（前端隐藏字段 / 串接字段）
            debug_kwargs = {
                k: v
                for k, v in kwargs.items()
                if any(x in k for x in ["adaptive", "mode", "klein", "sdnq", "lora串"])
            }
            if debug_kwargs:
                print(f"[DEBUG] kwargs 中的相关字段: {debug_kwargs}", flush=True)

        # 确保 adaptive_mode 是正确的布尔值（处理前端可能传递的字符串 "false" / "true"）
        # 说明：
        # - 前端隐藏 widget 是 text 类型，历史原因可能传递字符串。
        # - 这里统一转换为 Python bool，后续逻辑只看 bool。
        if isinstance(adaptive_mode, str):
            adaptive_mode = adaptive_mode.strip().lower() == "true"
        adaptive_mode = bool(adaptive_mode)
        if debug_enabled:
            print(f"[DEBUG] adaptive_mode 转换后: {adaptive_mode}", flush=True)

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
        is_sdnq = self.is_sdnq_model(out_model)
        is_klein = self.is_klein_model(out_model)

        # ========== 自适应模式检测 ==========
        if adaptive_mode:
            print(f"🔄 [MagicPowerLora] 自适应模式：检测到 Klein={is_klein}, SDNQ={is_sdnq}")
            if is_klein:
                klein_mode = "klein"
                sdnq_mode = "none"
                print(f"   → 自动切换到 Klein 模式")
            elif is_sdnq:
                sdnq_mode = "sdnq"
                print(f"   → 自动切换到 SDNQ 模式")
            else:
                sdnq_mode = "none"
                klein_mode = "none"
                print(f"   → 自动切换到标准模式（与官方 LoraLoader 一致，INT8/FP8 等量化模型由 model_patcher 自动处理）")
        # ====================================

        # 确保 klein_mode 有值（前端未注入时默认 "auto"）
        if isinstance(klein_mode, str):
            if klein_mode.lower() == "true":
                klein_mode = "klein"
            elif klein_mode.lower() == "false":
                klein_mode = "none"
        if klein_mode is None:
            klein_mode = "auto"

        if sdnq_mode == "sdnq" and not is_sdnq:
            print(f"⚠️ [MagicPowerLora] SDNQ 模式已启用，但模型似乎不是 SDNQ 模型（DiffusionPipeline），将回退到标准模式")
            sdnq_mode = "none"
        if sdnq_mode == "none" and is_sdnq:
            print(f"💡 [MagicPowerLora] 检测到 SDNQ 模型（DiffusionPipeline），建议在设置中启用 SDNQ 模式")
        if klein_mode == "klein" and not is_klein:
            print(f"⚠️ [MagicPowerLora] Klein 模式已启用，但模型似乎不是 Klein 模型，将回退到标准模式")
            klein_mode = "none"
        if klein_mode == "none" and is_klein:
            print(f"💡 [MagicPowerLora] 检测到 Klein 模型（Nunchaku FLUX.2 Klein），建议在设置中启用 Klein 模式")

        mode_str = f"{sdnq_mode}" if sdnq_mode == "sdnq" else (f"{klein_mode}" if klein_mode == "klein" else "standard")
        adaptive_str = f" (Adaptive)" if adaptive_mode else ""
        
        # 如果没有LoRA需要加载，直接返回（不做任何加载尝试）
        if not items_to_process:
            print(f"🚀 [MagicPowerLora] 链末端：无 LoRA 需要加载")
            if not preview_images:
                preview_images = [torch.zeros((1, 64, 64, 3), dtype=torch.float32, device="cpu")]
            return (out_model, out_clip, preview_images, "", lora_chain_out)
        
        print(f"🚀 [MagicPowerLora] 链末端：加载 {len(items_to_process)} 个 LoRA（含串接）... (Mode: {mode_str}{adaptive_str})")

        # 根据模式选择加载方式
        if klein_mode == "klein" and is_klein:
            # Klein/nunchaku 的 update_lora_params 每次调用都会先重置旧 LoRA。
            # 因此多 LoRA 必须先 compose 成一个 state dict，再一次性应用。
            try:
                wrapper = out_model.model.diffusion_model
                wrapper.reset_lora()
                print(f"   [Klein] 已重置旧 LoRA")
            except Exception as e:
                wrapper = None
                print(f"   ⚠️ [Klein] 重置旧 LoRA 失败: {e}")

            klein_loras = []
            for item in items_to_process:
                lora_name = item.get("name", "").strip()
                weight = float(item.get("weight", 1.0))
                if not lora_name:
                    continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Klein LoRA not found: {lora_name}")
                    continue

                klein_loras.append((lora_path, weight, lora_name, item))
                print(f"   [Klein] Queued: {lora_name} (strength={weight})")

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

            if wrapper is not None and klein_loras:
                try:
                    if len(klein_loras) == 1:
                        lora_path, weight, lora_name, _item = klein_loras[0]
                        wrapper.update_lora_params(lora_path, strength=weight)
                        print(f"   ✅ Applied (Klein): {lora_name} (strength={weight})")
                    else:
                        try:
                            from nunchaku.lora.common import compose_lora
                        except Exception:
                            from nunchaku.lora.common.compose import compose_lora

                        lora_specs = [(lora_path, weight) for lora_path, weight, _name, _item in klein_loras]
                        composed_lora = compose_lora(lora_specs)
                        wrapper.update_lora_params(composed_lora, strength=1.0)
                        names = ", ".join(name for _path, _weight, name, _item in klein_loras)
                        print(f"   ✅ Applied (Klein Compose): {len(klein_loras)} LoRA(s) mixed -> {names}")
                except Exception as e:
                    print(f"   ❌ Failed (Klein Compose): {e}")
            elif wrapper is not None:
                print(f"   ℹ️ [Klein] No valid LoRA to apply")

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
            # 与官方 LoraLoader 默认行为一致；ComfyUI 的 model_patcher.py 会在应用补丁后
            # 通过 comfy.float.stochastic_rounding 把权重舍入到 weight.dtype（如 torch.int8），
            # 因此 FP8/INT8/INT4 等量化模型也走这条路径，无需任何额外处理。
            for item in items_to_process:
                lora_name = item.get("name")
                weight = float(item.get("weight", 1.0))
                if not lora_name: continue

                lora_path = folder_paths.get_full_path("loras", lora_name)
                if lora_path is None:
                    print(f"⚠️ [MagicPowerLora] Lora not found: {lora_name}")
                    continue

                try:
                    # 使用缓存加载 LoRA
                    lora = MagicPowerLoraLoader._get_cached_lora(lora_path, weight)
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
        
        # 执行完成后清理未使用的 LoRA 缓存，释放内存
        MagicPowerLoraLoader._cleanup_unused_lora_cache()
        
        return (out_model, out_clip, preview_images, final_text, lora_chain_out)

# --- API 接口 ---

async def _run_blocking(fn, *args, **kwargs):
    """Run sync work off the event loop (Python 3.8: no asyncio.to_thread)."""
    if kwargs:
        call = functools.partial(fn, *args, **kwargs)
    else:
        call = lambda: fn(*args)
    if hasattr(asyncio, "to_thread"):
        if kwargs:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, call)
        return await asyncio.to_thread(fn, *args)
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, call)


def _coerce_version_number(v):
    """Civitai versionNumber may be int, float, str, or null; avoid TypeError on compare."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return float(int(v))
    if isinstance(v, (int, float)):
        x = float(v)
        if x != x or x in (float("inf"), float("-inf")):
            return 0.0
        return x
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return 0.0
        try:
            return float(s)
        except ValueError:
            return 0.0
    return 0.0


def _normalize_civitai_version_id(vid):
    if vid is None or isinstance(vid, bool):
        return None
    if isinstance(vid, int):
        return vid
    if isinstance(vid, float):
        if vid != vid or vid in (float("inf"), float("-inf")):
            return None
        return int(vid)
    if isinstance(vid, str) and vid.strip().isdigit():
        return int(vid.strip())
    return None


def _civitai_version_display(ver):
    """Civitai often omits versionNumber on model.modelVersions[]; use name or id."""
    if not isinstance(ver, dict):
        return ""
    num = ver.get("versionNumber")
    if num is not None and str(num).strip() != "":
        n = _coerce_version_number(num)
        if n == int(n):
            return f"v{int(n)}"
        return f"v{n}"
    name = (ver.get("name") or "").strip()
    if name:
        return name
    iv = _normalize_civitai_version_id(ver.get("id"))
    if iv is not None:
        return f"#{iv}"
    return "?"


def _parse_civitai_dt(s):
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _klein_b_variant(s):
    """
    Flux.2 Klein 4B / 9B 等需区分，不能笼统归为 flux。
    返回 '4' | '9' | ''；避免 14b 误匹配 4b。
    """
    if not s:
        return ""
    low = s.lower()
    if re.search(r"(?<![0-9])9\s*b\b", low) or re.search(r"(?<![0-9a-z])9b(?![0-9a-z])", low):
        return "9"
    if re.search(r"(?<![0-9])4\s*b\b", low) or re.search(r"(?<![0-9a-z])4b(?![0-9a-z])", low):
        return "4"
    return ""


def _normalize_base_model(bm):
    """将 baseModel 字符串归一化为可比对的内部标识符（含 Klein 4B/9B 等细粒度）。"""
    if not bm or not isinstance(bm, str):
        return ""
    s = bm.strip().lower()
    s_nospace = re.sub(r"\s+", "", s)

    # Flux.2 Klein 4B / 9B（须在通用 flux 匹配之前）
    if "klein" in s or "klein" in s_nospace:
        kb = _klein_b_variant(s)
        if kb == "9":
            return "flux2klein9b"
        if kb == "4":
            return "flux2klein4b"
        return "flux2klein_other"

    # 较长子串优先（避免 flux.1 被 flux 吞掉）
    _ordered = [
        ("flux.1 schnell", "flux1schnell"),
        ("flux.1 dev", "flux1dev"),
        ("flux.1", "flux1"),
        ("stable diffusion xl", "sdxl"),
        ("sdxl 1.0", "sdxl"),
        ("sdxl", "sdxl"),
        ("stable diffusion 2.1", "sd21"),
        ("sd 2.1", "sd21"),
        ("stable diffusion 2", "sd2"),
        ("sd 2", "sd2"),
        ("stable diffusion 1.5", "sd15"),
        ("sd 1.5", "sd15"),
        ("stable diffusion 1", "sd1"),
        ("sd 1", "sd1"),
        ("pony diffusion", "pony"),
        ("pony", "pony"),
        ("illustrious", "illustrious"),
        ("firefly", "firefly"),
        ("kolors", "kolors"),
        ("lumina", "lumina"),
        ("playground", "playground"),
    ]
    for pat, key in _ordered:
        if pat in s:
            return key
    if "flux" in s:
        return "flux_other"
    return re.sub(r"[\s\-_]+", "", s)


def _sanitize_for_json(obj):
    """Make payloads safe for JSON (RFC / browser JSON.parse): no NaN/Infinity."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if obj != obj or obj in (float("inf"), float("-inf")):
            return None
    return obj


def _ma_json_response(data, status=200):
    """JSON response that JavaScript JSON.parse always accepts."""
    try:
        payload = json.dumps(_sanitize_for_json(data), ensure_ascii=False, allow_nan=False)
    except Exception as e:
        payload = json.dumps(
            {"ok": False, "error": f"响应序列化失败: {e}", "duplicates": [], "updates": []},
            ensure_ascii=False,
            allow_nan=False,
        )
        status = 500
    try:
        return web.Response(
            body=payload.encode("utf-8"),
            status=status,
            content_type="application/json",
        )
    except Exception as e:
        fb = json.dumps({"ok": False, "error": str(e), "updates": [], "duplicates": []})
        return web.Response(body=fb.encode("utf-8"), status=500, content_type="application/json")


@PromptServer.instance.routes.get("/ma/lora/list")
async def get_lora_list(request):
    try:
        lora_names = folder_paths.get_filename_list("loras")
        return web.json_response({"files": lora_names})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})

@PromptServer.instance.routes.post("/ma/lora/detect_scan")
async def lora_detect_scan(request):
    """按目录或全部扫描 LoRA：检测重复文件（SHA256）。"""
    try:
        data = await request.json()
        scope = data.get("scope") or "folder"
        path_parts = data.get("path") or []
        result = await _run_blocking(_run_lora_detect_scan, scope, path_parts)
        return _ma_json_response(result)
    except Exception as e:
        return _ma_json_response({"ok": False, "error": str(e), "duplicates": []}, status=500)

@PromptServer.instance.routes.post("/ma/lora/update_check")
async def lora_update_check(request):
    """从 Civitai API 检查 LoRA 更新：遍历范围内的 LoRA，通过 SHA256 查询 Civitai 获取最新版本信息。"""
    try:
        data = await request.json()
        scope = data.get("scope") or "folder"
        path_parts = data.get("path") or []
        result = await _run_blocking(_safe_run_lora_update_check, scope, path_parts)
        return _ma_json_response(result)
    except Exception as e:
        return _ma_json_response({"ok": False, "error": str(e), "updates": []}, status=500)

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

# --- LoRA 检测（重复 / 可能新版本）---

_LORA_FILE_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".pt2", ".bin", ".pth", ".sft", ".pkl")

def _norm_lora_rel(p):
    return (p or "").replace("\\", "/").strip()

def _is_lora_extension(filename):
    n = (filename or "").lower()
    return any(n.endswith(ext) for ext in _LORA_FILE_SUFFIXES)

def _list_lora_rel_paths_for_scope(all_rels, scope, path_parts):
    """
    scope: 'all' | 'folder'
    path_parts: [] = 仅 loras 根目录下的文件（无子路径）；['a','b'] = 路径 a/b/ 下（含子目录）全部 LoRA
    """
    path_parts = [str(x).replace("\\", "/").strip("/") for x in (path_parts or []) if str(x).strip()]
    prefix = "/".join(path_parts)
    out = []
    for rel in all_rels:
        nr = _norm_lora_rel(rel)
        base = nr.split("/")[-1]
        if not _is_lora_extension(base):
            continue
        if scope == "all":
            out.append(rel)
            continue
        if not prefix:
            if "/" not in nr:
                out.append(rel)
        else:
            pref = prefix + "/"
            if nr == prefix or nr.startswith(pref):
                out.append(rel)
    return out

def _read_safetensors_meta(path):
    try:
        from safetensors import safe_open
        with safe_open(path, framework="np") as f:
            return dict(f.metadata() or {})
    except Exception:
        return {}

def _extract_base_model(meta):
    if not meta:
        return ""
    for k in ("ss_base_model_name", "modelspec.architecture", "ss_sd_model_name", "modelspec.sai_model_spec", "base_model"):
        v = meta.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()[:200]
    return ""


def _extract_base_model_from_sidecar(rel_path):
    """
    从爬取保存的介绍文件读「基础模型」（magicloradate/*.json 常为纯文本，非严格 JSON）。
    """
    fp = folder_paths.get_full_path("loras", rel_path)
    if not fp or not os.path.isfile(fp):
        return ""
    lora_dir = os.path.dirname(fp)
    stem = os.path.splitext(os.path.basename(fp))[0]
    paths_try = [
        os.path.join(lora_dir, "magicloradate", f"{stem}.json"),
        os.path.join(lora_dir, f"{stem}.json"),
        os.path.join(lora_dir, "magicloradate", f"{stem}.log"),
    ]
    for p in paths_try:
        if not os.path.isfile(p):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                text = f.read(131072)
            m = re.search(r"^\s*基础模型\s*[:：]\s*(.+)$", text, re.MULTILINE)
            if m:
                return m.group(1).strip()[:200]
            m2 = re.search(r"^\s*base\s*model\s*[:：]\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
            if m2:
                return m2.group(1).strip()[:200]
            try:
                j = json.loads(text)
                if isinstance(j, dict):
                    for k in ("baseModel", "base_model", "base_model_name"):
                        v = j.get(k)
                        if v is not None and str(v).strip():
                            return str(v).strip()[:200]
            except Exception:
                pass
        except Exception:
            continue
    return ""

def _normalize_lora_stem(rel_path):
    stem = os.path.splitext(os.path.basename(rel_path))[0].lower()
    stem = re.sub(r"\s*\(\d+\)\s*$", "", stem)
    stem = re.sub(r"[_\s-]+(v|ver)\d+(\.\d+)?\s*$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"[_\s.-]+\d{4}[-_]\d{2}[-_]\d{2}\s*$", "", stem)
    stem = stem.strip("._- \t")
    if not stem:
        stem = os.path.splitext(os.path.basename(rel_path))[0].lower()
    return stem

def _run_lora_detect_scan(scope, path_parts):
    scope = (scope or "folder").lower()
    if scope not in ("all", "folder"):
        scope = "folder"
    if not isinstance(path_parts, list):
        path_parts = []

    all_names = folder_paths.get_filename_list("loras")
    rels = _list_lora_rel_paths_for_scope(all_names, scope, path_parts)

    entries = []
    errors = []
    for rel in rels:
        fp = folder_paths.get_full_path("loras", rel)
        if not fp or not os.path.isfile(fp):
            continue
        try:
            st = os.stat(fp)
            mtime = int(st.st_mtime)
            size = st.st_size
            h = calculate_sha256(fp)
            meta = {}
            low = rel.lower()
            if low.endswith(".safetensors") or low.endswith(".sft"):
                meta = _read_safetensors_meta(fp)
            base = (_extract_base_model(meta) or "").lower()[:200]
            stem = _normalize_lora_stem(rel)
            entries.append({
                "path": _norm_lora_rel(rel),
                "hash": h,
                "mtime": mtime,
                "size": size,
                "base_model": base,
                "stem": stem,
            })
        except Exception as ex:
            errors.append({"path": rel, "error": str(ex)})

    by_hash = defaultdict(list)
    for e in entries:
        by_hash[e["hash"]].append(e)
    duplicates = []
    for h, lst in by_hash.items():
        if len(lst) > 1:
            duplicates.append({
                "hash": h,
                "files": sorted(lst, key=lambda x: x["path"]),
            })

    by_key_meta = defaultdict(list)
    by_key_weak = defaultdict(list)
    for e in entries:
        parent = os.path.dirname(e["path"]) or ""
        parent = parent.replace("\\", "/")
        if e["base_model"]:
            by_key_meta[(e["base_model"], e["stem"])].append(e)
        else:
            by_key_weak[(parent, e["stem"])].append(e)

    updates = []
    for (bm, stem), lst in by_key_meta.items():
        if len(lst) < 2 or len({e["hash"] for e in lst}) < 2:
            continue
        lst_sorted = sorted(lst, key=lambda x: x["mtime"], reverse=True)
        updates.append({
            "base_model": bm,
            "stem": stem,
            "newest": lst_sorted[0],
            "older": lst_sorted[1:],
        })

    updates_weak = []
    for (parent, stem), lst in by_key_weak.items():
        if len(lst) < 2 or len({e["hash"] for e in lst}) < 2:
            continue
        lst_sorted = sorted(lst, key=lambda x: x["mtime"], reverse=True)
        updates_weak.append({
            "parent": parent,
            "stem": stem,
            "newest": lst_sorted[0],
            "older": lst_sorted[1:],
        })

    return {
        "ok": True,
        "scoped_count": len(rels),
        "scanned": len(entries),
        "duplicates": duplicates,
        "errors": errors[:80],
    }


def _safe_run_lora_update_check(scope, path_parts):
    try:
        return _run_lora_update_check(scope, path_parts)
    except Exception as e:
        import traceback
        print(f"[ComfyUI-Magic-Assistant] lora update_check: {e}\n{traceback.format_exc()}")
        return {
            "ok": False,
            "error": str(e) or type(e).__name__,
            "updates": [],
            "scoped_count": 0,
            "scanned": 0,
            "errors": [],
        }


def _run_lora_update_check(scope, path_parts):
    """从 Civitai API 检查 LoRA 更新：遍历范围内的 LoRA，通过 SHA256 查询 Civitai 获取最新版本信息。"""
    scope = (scope or "folder").lower()
    if scope not in ("all", "folder"):
        scope = "folder"
    if not isinstance(path_parts, list):
        path_parts = []

    all_names = folder_paths.get_filename_list("loras")
    rels = _list_lora_rel_paths_for_scope(all_names, scope, path_parts)

    entries = []
    errors = []
    for rel in rels:
        fp = folder_paths.get_full_path("loras", rel)
        if not fp or not os.path.isfile(fp):
            continue
        try:
            st = os.stat(fp)
            mtime = int(st.st_mtime)
            size = st.st_size
            h = calculate_sha256(fp)
            low = rel.lower()
            is_safetensors = low.endswith(".safetensors") or low.endswith(".sft")
            entries.append({
                "path": _norm_lora_rel(rel),
                "hash": h,
                "mtime": mtime,
                "size": size,
                "is_safetensors": is_safetensors,
                "base_model": "",   # 稍后填充
            })
        except Exception as ex:
            errors.append({"path": rel, "error": str(ex)})

    # 批量读取 safetensors metadata（本地 base model）
    _bm_exts = (".safetensors", ".sft")
    for e in entries:
        if not e["is_safetensors"]:
            continue
        fp2 = folder_paths.get_full_path("loras", e["path"])
        if fp2 and os.path.isfile(fp2):
            try:
                meta = _read_safetensors_meta(fp2)
                e["base_model"] = _extract_base_model(meta)
            except Exception:
                pass
        if not (e.get("base_model") or "").strip():
            side = _extract_base_model_from_sidecar(e["path"])
            if side:
                e["base_model"] = side

    # 按 SHA256 分组，每组只需查询一次 Civitai
    by_hash = defaultdict(list)
    for e in entries:
        by_hash[e["hash"]].append(e)

    updates = []
    for h, group in by_hash.items():
        try:
            cv_data = fetch_civitai_data_by_hash(h)
            if not cv_data:
                continue
            local_vid = _normalize_civitai_version_id(cv_data.get("id"))
            local_version = _coerce_version_number(cv_data.get("versionNumber", 0))
            model = cv_data.get("model", {})
            if not isinstance(model, dict):
                model = {}
            versions = model.get("modelVersions")
            if not isinstance(versions, list):
                versions = []
            if not versions:
                continue
            local_bm_raw = (group[0].get("base_model") or "").strip()
            local_bm_norm = _normalize_base_model(local_bm_raw)
            # 优先用 hash 命中版本的 baseModel（比 ss_metadata 更准，因为是上传者填的）
            cv_bm_raw = (cv_data.get("baseModel") or "").strip()
            cv_bm_norm = _normalize_base_model(cv_bm_raw)

            # 在所有 modelVersions 中，先按 baseModel 分组，再在同组内找 max id
            # 只在「与本地 base model 相同的组」里找最新版
            bm_groups = defaultdict(list)
            for v in versions:
                if not isinstance(v, dict):
                    continue
                vid = _normalize_civitai_version_id(v.get("id"))
                if vid is None:
                    continue
                bm = _normalize_base_model(v.get("baseModel") or "")
                bm_groups[bm].append((vid, v))

            # 选用与本地 base model 匹配的那个分组；否则降级为 hash 命中版本的 base model
            target_bm = local_bm_norm if local_bm_norm else cv_bm_norm
            if not target_bm:
                target_bm = None

            candidates = []
            if target_bm and target_bm in bm_groups:
                candidates = bm_groups[target_bm]
            elif not target_bm:
                # 无 base model 时，对所有版本取 max id（避免漏报）
                for lst in bm_groups.values():
                    candidates.extend(lst)

            if not candidates:
                continue

            best_vid, best_ver = max(candidates, key=lambda x: x[0])
            max_vid = best_vid

            best_bm_norm = _normalize_base_model(best_ver.get("baseModel") or "")
            if target_bm and best_bm_norm and best_bm_norm != target_bm:
                continue
            # 本地已识别底模时，与 Civitai 最新版再比一次（防止归一化分组键一致但实际文案不同）
            if local_bm_norm and best_bm_norm and local_bm_norm != best_bm_norm:
                continue

            latest_version = _coerce_version_number(best_ver.get("versionNumber", 0))
            latest_version_id = best_ver.get("id")
            latest_download_url = None
            latest_published_at = None
            files = best_ver.get("files", [])
            if not isinstance(files, list):
                files = []
            for f in files:
                if not isinstance(f, dict):
                    continue
                if f.get("type") == "Model":
                    latest_download_url = f.get("downloadUrl") or f.get("url")
                    latest_published_at = f.get("publishedAt")
                    break

            newer_by_number = latest_version > local_version
            newer_by_id = local_vid is not None and max_vid > local_vid
            newer_by_date = False
            if not newer_by_number and not newer_by_id and local_vid is None:
                t_loc = _parse_civitai_dt(cv_data.get("createdAt"))
                t_best = _parse_civitai_dt(best_ver.get("createdAt") or best_ver.get("updatedAt"))
                if t_loc and t_best and t_best > t_loc:
                    newer_by_date = True
            if newer_by_number or newer_by_id or newer_by_date:
                updates.append({
                    "hash": h,
                    "path": group[0]["path"],
                    "local_version": local_version,
                    "latest_version": latest_version,
                    "local_label": _civitai_version_display(cv_data),
                    "latest_label": _civitai_version_display(best_ver),
                    "local_base_model": local_bm_raw,
                    "latest_base_model": (best_ver.get("baseModel") or "").strip(),
                    "latest_version_id": latest_version_id,
                    "latest_download_url": latest_download_url,
                    "model_url": f"https://civitai.com/models/{cv_data.get('modelId')}",
                    "model_name": model.get("name") if isinstance(model, dict) else "",
                    "published_at": latest_published_at,
                })
        except Exception as ex:
            errors.append({"path": group[0]["path"], "error": str(ex)})

    return {
        "ok": True,
        "scoped_count": len(rels),
        "scanned": len(entries),
        "updates": updates,
        "errors": errors[:80],
    }

def fetch_civitai_data_by_hash(hash_string, max_retries=3, api_delay=0.5):
    """从Civitai API获取数据（带重试机制）"""
    hnorm = (hash_string or "").strip()
    if not hnorm:
        return None
    # 官方示例里 SHA256 为大写；本地 hashlib 多为小写
    hash_for_url = hnorm.upper()
    for attempt in range(max_retries):
        try:
            url = f"https://civitai.com/api/v1/model-versions/by-hash/{hash_for_url}"
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
                    raw = response.read().decode("utf-8", errors="replace")
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(data, dict) or "modelId" not in data:
                        continue
                    model_url = f"https://civitai.com/api/v1/models/{data['modelId']}"
                    model_req = urllib.request.Request(model_url, headers=headers)
                    with urllib.request.urlopen(model_req, timeout=30) as model_response:
                        if model_response.status == 200:
                            mraw = model_response.read().decode("utf-8", errors="replace")
                            try:
                                data["model"] = json.loads(mraw)
                            except json.JSONDecodeError:
                                data["model"] = {}
                        else:
                            data["model"] = {}
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