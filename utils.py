import os
import json
import shutil
import re
import bisect
import base64
import asyncio
import threading
import uuid
import time
import tempfile
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from server import PromptServer
from aiohttp import web

from .ma_prompt_cleaning import ma_clean_prompt
import folder_paths
import aiohttp

# --- 1. 恢复全局路径定义 (这是为了救活 __init__.py) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRESET_DIR = os.path.join(BASE_DIR, "savedata")
USER_DIR = os.path.join(BASE_DIR, "userdata")

# --- 提示词补全词典（savedata/22w补全提示词.txt，格式：中文,英文tag）---
_PROMPT_AC_LOCK = threading.Lock()
_PROMPT_AC_CACHE = None  # dict: entries, buckets, norm_exact_map, preset_sorted_by_norm, ...
PROMPT_AUTOCOMPLETE_FILE = "tag预设库.txt"
_MAGIC_PRESET_TAGS_FILE = "magic_preset_tags.txt"
_PRESET_TAGS_LOCK = threading.Lock()
_PRESET_TAGS_CACHE = None


def ma_invalidate_prompt_autocomplete_cache():
    """清除补全索引缓存；下次搜索时重新加载（合并预设库 + 用户标签组）。"""
    global _PROMPT_AC_CACHE
    _PROMPT_AC_CACHE = None


def _ma_load_prompt_autocomplete_sync():
    """同步加载并建桶索引，避免每次全表扫描。

    数据源（按优先级）：
    1. tag预设库.txt（预设库，单行 中文,英文tag）
    2. userdata/magic_new_tagsets.txt   → 每行一组：名称,(整段英文)，整段作为一条补全（不拆逗号）
    3. userdata/magic_favorite_tagsets.txt → 同上

    用户标签组条目：source="custom"、kind="tagset"，en 为整组英文（插入时整段写入）。
    """
    global _PROMPT_AC_CACHE
    preset_entries = []
    custom_entries = []

    # --- 1. 预设库（格式：中文,英文tag）---
    ac_paths = [
        os.path.join(PRESET_DIR, PROMPT_AUTOCOMPLETE_FILE),
        os.path.join(USER_DIR, PROMPT_AUTOCOMPLETE_FILE),
    ]
    ac_path = next((p for p in ac_paths if os.path.isfile(p)), None)
    if ac_path:
        with open(ac_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or "," not in line:
                    continue
                cn, en = line.split(",", 1)
                cn = cn.strip()
                en = en.strip()
                if not en:
                    continue
                preset_entries.append({"cn": cn, "en": en, "source": "preset"})
        print(
            f"\033[36m🔮 [Magic Assistant] 预设补全索引已加载: {len(preset_entries)} 条 ({ac_path})\033[0m"
        )

    # --- 2. 用户标签组：仅「新建标签」（magic_new_tagsets.txt），收藏已在预设库里，不需要进补全 ---
    new_tagset_path = os.path.join(USER_DIR, MAGIC_NEW_TAGSETS_FILE)
    custom_count = 0

    if os.path.isfile(new_tagset_path):
        sets = ma_read_tagset_file(new_tagset_path)
        for st in sets:
            group_name = (st.get("name") or "").strip()
            raw_content = st.get("content") or ""
            full_en = ma_normalize_tagset_content(raw_content)
            if not full_en:
                continue
            custom_entries.append(
                {
                    "cn": group_name or "标签组",
                    "en": full_en,
                    "source": "custom",
                    "setName": group_name,
                    "kind": "tagset",
                }
            )
            custom_count += 1

    if custom_count:
        print(
            f"\033[36m🔮 [Magic Assistant] 自建标签组已注入补全: {custom_count} 组（整组补全，不含收藏）\033[0m"
        )

    entries = preset_entries + custom_entries
    en_buckets = {}
    cn_buckets = {}
    for idx, e in enumerate(entries):
        en = e["en"]
        fc = en[0]
        ek = fc.lower() if fc.isascii() else fc
        en_buckets.setdefault(ek, []).append(idx)
        cn = e.get("cn") or ""
        if cn:
            cn_buckets.setdefault(cn[0], []).append(idx)

    # 预计算小写 / 规范化 en，补全时少做重复 normalize；norm_exact_map 优先自建组
    norm_exact_map = {}
    for e in custom_entries:
        en = e.get("en") or ""
        e["_en_l_cached"] = en.lower()
        en_norm = ma_normalize_en_for_tag_match(en)
        e["_en_norm_cached"] = en_norm
        if en_norm:
            norm_exact_map.setdefault(en_norm, e)
    for e in preset_entries:
        en = e.get("en") or ""
        e["_en_l_cached"] = en.lower()
        en_norm = ma_normalize_en_for_tag_match(en)
        e["_en_norm_cached"] = en_norm
        if en_norm and en_norm not in norm_exact_map:
            norm_exact_map[en_norm] = e

    # 中文→规范化英文的反向映射（支持 Danbooru 中文搜索：输入中文查出对应英文，再查 Danbooru）
    cn_norm_map = {}
    cn_norm_list = []
    cn_norm_sorted = []
    # 先收集全部 cn→norm 对
    for e in entries:
        cn = e.get("cn") or ""
        if not cn:
            continue
        en_norm = e.get("_en_norm_cached") or ma_normalize_en_for_tag_match(e.get("en") or "")
        if en_norm:
            cn_norm_map[cn] = en_norm
    # 按中文拼音/字面排序，便于二分前缀匹配
    cn_norm_sorted = sorted(cn_norm_map.items(), key=lambda x: x[0])
    cn_norm_list = [k for k, _ in cn_norm_sorted]

    preset_sorted_by_norm = sorted(
        preset_entries,
        key=lambda x: (x.get("_en_norm_cached") or "", x.get("en") or ""),
    )
    preset_norm_list = [e.get("_en_norm_cached") or "" for e in preset_sorted_by_norm]

    print(
        f"\033[36m[Magic Assistant] 补全索引完成 | 预设 {len(preset_entries)} 条 | "
        f"自建 {len(custom_entries)} 条 | norm_exact_map {len(norm_exact_map)} 条 | "
        f"cn_norm_map {len(cn_norm_map)} 条（支持 Danbooru 中文搜索）\033[0m"
    )

    return {
        "entries": entries,
        "preset_entries": preset_entries,
        "custom_entries": custom_entries,
        "en_buckets": en_buckets,
        "cn_buckets": cn_buckets,
        "ac_path": ac_path,
        "custom_count": custom_count,
        "norm_exact_map": norm_exact_map,
        "preset_sorted_by_norm": preset_sorted_by_norm,
        "preset_norm_list": preset_norm_list,
        "cn_norm_map": cn_norm_map,
        "cn_norm_list": cn_norm_list,
        "cn_norm_sorted": cn_norm_sorted,
    }


def ma_get_prompt_autocomplete_cache():
    global _PROMPT_AC_CACHE
    if _PROMPT_AC_CACHE is not None:
        return _PROMPT_AC_CACHE
    with _PROMPT_AC_LOCK:
        if _PROMPT_AC_CACHE is None:
            _PROMPT_AC_CACHE = _ma_load_prompt_autocomplete_sync()
    return _PROMPT_AC_CACHE


def ma_normalize_en_for_tag_match(s: str) -> str:
    """英文 tag 匹配用：空格与下划线视为等价，合并为单一下划线再比（simple background ≈ simple_background）。"""
    if not s or not isinstance(s, str):
        return ""
    t = s.strip().lower()
    t = re.sub(r"[\s_]+", "_", t)
    return t.strip("_")


def ma_strip_autocomplete_query_edges(q: str) -> str:
    """内联补全 / Danbooru 搜索用：去掉首尾空白与常见中英文标点。

    仅剥离无搜索语义的分隔符：逗号（中英文）、句号（半全角）、中日文顿号。
    保留对 tag 有意义的字符：; : ( ) / = ! ? @ # 等
    （danbooru tag 如 score:9、rating:safe、!tag 排除、(solo) 等需精确匹配）。
    """
    if not q or not isinstance(q, str):
        return ""
    q = q.strip()
    # 全角空格、半角空白换行、，。！？、；： 与半角 ,.!? 等
    # 去掉 ;:() 等：danbooru tag 结构中这些字符是搜索关键字的一部分（如 score:9、rating:safe、!tag 排除、(solo)）
    # 叹号 ! 用于 NOT 排除，问号 ? / @ / # 也可能有搜索意义，全部保留
    _strip = " \t\n\r\u3000\uFF0C\u3002\u3001,."
    while q and q[0] in _strip:
        q = q[1:]
    while q and q[-1] in _strip:
        q = q[:-1]
    return q.strip()


# Danbooru 中文补全：词库键多为「1个女性」而非「女孩」，仅用子串匹配会优先命中「girl_sandwich」等说明里含「女孩」的条目。
# 此处为高频口语提供英文 tag 别名（与 Danbooru 官方 tag 名一致）。
MA_CN_DANBOORU_EN_ALIASES: dict[str, str] = {
    # 单字：词库多为「1个女性」等整句，前缀「女*」会扫到海量键，Danbooru *en* 易混入无关高热度 artist
    "女": "1girl",
    "男": "1boy",
    "女孩": "1girl",
    "男孩子": "1boy",
    "男孩": "1boy",
    "男人": "1boy",
    "女人": "1girl",
    "女性": "1girl",
    "男性": "1boy",
}
# 中文查询最多向 Danbooru 发几次 tags.json（每次最多 100 条）；过大则无关 en 的 *xxx* 会把列表搅乱
MA_CN_DANBOORU_API_FANOUT = 5
# 英文 *q*：多翻几页再按「有本地中文优先」排序；编辑标签 per_page≥80 走 FULL（8页），补全 per_page<80 走 AUTOCOMPLETE（1页）
MA_DANBOORU_EN_SCAN_PAGES_FULL = 8
MA_DANBOORU_EN_SCAN_PAGES_AUTOCOMPLETE = 1
# 中文：每个英文根多翻几页，便于「释义含整段关键词」过滤后仍能凑满一页（补全与编辑标签统一用此深度）
MA_DANBOORU_CN_SCAN_PAGES_PER_ROOT_FULL = 5


def ma_norm_query_tokens(q_norm: str) -> set:
    """将规范化后的 query 按下划线/逗号拆成片段（用于 batch 匹配，避免 mat 误命中 mature 内的子串）。"""
    if not q_norm:
        return set()
    s = q_norm.replace(",", "_")
    return {p for p in (t.strip() for t in s.split("_")) if p}


def ma_search_prompt_autocomplete(q: str, limit: int | None = 50):
    """按英文 tag 包含匹配 或 中文释义包含匹配，返回最多 limit 条。

    limit 为 None 时不截断，返回全部匹配（编辑标签弹窗「显示全部」用；大数据集时请用更长关键词）。

    用户标签组（kind=tagset / source=custom）排在预设库之前返回，避免短关键词（如「测」）
    时预设条目先占满 limit，导致自建组名「测试1」等永远进不了列表。
    """
    data = ma_get_prompt_autocomplete_cache()
    custom_entries = data.get("custom_entries")
    preset_entries = data.get("preset_entries")
    entries = data.get("entries") or []
    if not q or not entries:
        return []
    q = ma_strip_autocomplete_query_edges((q or "").strip())
    if not q:
        return []
    q_lower = q.lower()
    q_norm = ma_normalize_en_for_tag_match(q)

    def _en_norm_in_query_safe(en_norm: str, q_norm_inner: str) -> bool:
        """避免 en_norm 为 v 时命中 very（子串）；短词仅允许等于某个 _ 分段。"""
        if not en_norm or not q_norm_inner:
            return False
        if en_norm in ma_norm_query_tokens(q_norm_inner):
            return True
        if len(en_norm) <= 2:
            return False
        return en_norm in q_norm_inner

    def entry_matches(e):
        cn = e.get("cn") or ""
        if q in cn:
            return True
        en_l = e.get("_en_l_cached")
        if en_l is None:
            en_l = (e.get("en") or "").lower()
        en_norm = e.get("_en_norm_cached")
        if en_norm is None:
            en_norm = ma_normalize_en_for_tag_match(e.get("en") or "")
        if q_norm and en_norm and q_norm == en_norm:
            return True
        if len(en_l) < len(q_lower):
            return False
        en_match = q_lower in en_l
        if not en_match and q_norm and en_norm:
            en_match = q_norm in en_norm or _en_norm_in_query_safe(en_norm, q_norm)
        return en_match

    if custom_entries is None or preset_entries is None:
        custom_entries = [e for e in entries if e.get("kind") == "tagset" or e.get("source") == "custom"]
        preset_entries = [e for e in entries if not (e.get("kind") == "tagset" or e.get("source") == "custom")]

    norm_exact_map = data.get("norm_exact_map") or {}
    preset_sorted = data.get("preset_sorted_by_norm")
    preset_norm_list = data.get("preset_norm_list")
    if (
        not isinstance(preset_sorted, list)
        or not isinstance(preset_norm_list, list)
        or len(preset_sorted) != len(preset_norm_list)
    ):
        preset_sorted = sorted(
            preset_entries,
            key=lambda x: (x.get("_en_norm_cached") or ma_normalize_en_for_tag_match(x.get("en") or ""), x.get("en") or ""),
        )
        preset_norm_list = [
            e.get("_en_norm_cached") or ma_normalize_en_for_tag_match(e.get("en") or "") for e in preset_sorted
        ]

    results = []
    seen = set()

    def add_entry(e):
        i = id(e)
        if i in seen:
            return
        seen.add(i)
        results.append(e)

    def at_limit():
        return limit is not None and len(results) >= limit

    # 规范化完全一致（O(1)，自建优先已在 norm_exact_map 构建时处理）
    if q_norm and q_norm in norm_exact_map:
        add_entry(norm_exact_map[q_norm])
        if at_limit():
            return results

    for e in custom_entries:
        if entry_matches(e):
            add_entry(e)
            if at_limit():
                return results

    # 预设库：按规范化 en 排序后，前缀命中为连续区间，避免每次全表扫一遍
    if q_norm and preset_norm_list:
        i = bisect.bisect_left(preset_norm_list, q_norm)
        while i < len(preset_sorted):
            n = preset_norm_list[i]
            if not n.startswith(q_norm):
                break
            e = preset_sorted[i]
            if entry_matches(e):
                add_entry(e)
                if at_limit():
                    return results
            i += 1

    for e in preset_entries:
        if id(e) in seen:
            continue
        if entry_matches(e):
            add_entry(e)
            if at_limit():
                break
    return results

class MagicUtils:
    # --- 2. 类内部同时也保留定义 (这是为了让新节点也能用) ---
    BASE_DIR = BASE_DIR
    PRESET_DIR = PRESET_DIR
    USER_DIR = USER_DIR
    
    # 默认数据
    DEFAULT_LLM = {
        "Default OpenAI": {
            "name": "Default OpenAI",
            "base_url": "https://api.openai.com/v1",
            "api_key": "",
            "model": "gpt-3.5-turbo"
        }
    }
    DEFAULT_LOGICS = {}
    DEFAULT_RESOLUTIONS = {
        "presets": [512, 768, 832, 960, 1024, 1152, 1280, 1536, 2048],
        "dimensions": ["SDXL_1024x1024", "SD1.5_512x512"]
    }
    _DEFAULT_SETTINGS = {
        "dialog_size": {"width": 720, "height": 400, "textareaMinHeight": 160},
        "edit_tags_modal_size": {"width": 720, "height": 560},
        # Magic 提示词编辑器 · 历史记录最大条数（存 settings.txt）
        "prompt_history_max": 20,
        # 内联补全单次最多返回/展示条数（1～500，与 utils 中 ma_prompt_autocomplete 上限一致）
        "prompt_autocomplete_limit": 50,
        # 编辑 Tab 顶部工具栏按钮是否显示（默认全开）
        "editor_toolbar": {
            "format": True,
            "dedup": True,
            "clear_all": True,
            "clear_disabled": True,
            "copy": True,
            "edit_tags": True,
            "translate_all": True,
            "translate_input": True,
            # 内联补全弹窗：与前端 editor_toolbar 键一致
            "autocomplete_popup": True,
        },
        # Magic 提示词编辑器 · 「格式化」按钮调用的清洗选项（与 ma_prompt_cleaning 一致，不含修复分区语法）
        "format_options": {
            "cleanup_commas": True,
            "cleanup_whitespace": True,
            "remove_lora_tags": False,
            "cleanup_newlines": "false",
            "fix_brackets": "both",
            "underscore_to_space": True,
            "complete_weight_syntax": True,
            "smart_bracket_escaping": True,
            "standardize_commas": True,
        },
        # 多功能提示词框 · 翻译使用的 LLM 配置名（键名与 userdata/llm_settings.txt 一致，与 MagicPromptReplace 共用）
        "translate_llm_profile": "",
        # 一键翻译：已废弃，请用 translate_mode；保留以兼容旧 settings.txt
        "translate_llm_force": False,
        # 翻译模式："normal" | "force"（与前端设置一致）
        "translate_mode": "normal",
        # LLM 翻译缓存最大条数（LRU，超出自动淘汰最旧条目）
        "llm_cache_max": 150,
        # 补全模式："local" | "danbooru"（默认本地：首次使用无需检测远端连接，体验更流畅）
        "danbooru_mode": "local",
    }
    SETTINGS_FILE = "settings.txt"

    @classmethod
    def ensure_user_dir(cls):
        if not os.path.exists(cls.USER_DIR):
            os.makedirs(cls.USER_DIR, exist_ok=True)

    @classmethod
    def _load_dual_data(cls, filename, default_fallback=None):
        data = {}
        if default_fallback: data.update(default_fallback)
        for d in [cls.PRESET_DIR, cls.USER_DIR]:
            p = os.path.join(d, filename)
            if os.path.exists(p):
                try:
                    with open(p, 'r', encoding='utf-8') as f: data.update(json.load(f))
                except: pass
        return data

    @classmethod
    def _save_user_data(cls, filename, data):
        cls.ensure_user_dir()
        with open(os.path.join(cls.USER_DIR, filename), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

    @classmethod
    def _load_settings(cls):
        """加载全局设置（preset 优先覆盖 defaults，user 覆盖 preset）。"""
        data = cls._DEFAULT_SETTINGS.copy()
        for d in [cls.PRESET_DIR, cls.USER_DIR]:
            p = os.path.join(d, cls.SETTINGS_FILE)
            if os.path.exists(p):
                try:
                    with open(p, 'r', encoding='utf-8') as f:
                        saved = json.load(f)
                    for k, v in saved.items():
                        if isinstance(v, dict) and isinstance(data.get(k), dict):
                            data[k] = {**data[k], **v}
                        else:
                            data[k] = v
                except Exception: pass
        # 兼容旧 settings.txt 根键 autocomplete_enabled → editor_toolbar.autocomplete_popup
        ae = data.get("autocomplete_enabled")
        if isinstance(ae, bool):
            et = dict(data.get("editor_toolbar") or {})
            et["autocomplete_popup"] = ae
            data["editor_toolbar"] = et
        return data

    @classmethod
    def _save_settings(cls, partial: dict):
        """只保存 partial 中的字段，保留其他已有设置。"""
        cls.ensure_user_dir()
        path = os.path.join(cls.USER_DIR, cls.SETTINGS_FILE)
        existing = {}
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception: pass
        for k, v in partial.items():
            if isinstance(v, dict) and isinstance(existing.get(k), dict):
                existing[k] = {**existing[k], **v}
            else:
                existing[k] = v
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=4, ensure_ascii=False)

    @classmethod
    def get_llm_config(cls): return cls._load_dual_data("llm_settings.txt", cls.DEFAULT_LLM)
    @classmethod
    def get_rules_config(cls): return cls._load_dual_data("replace_rules.txt", {}) 
    @classmethod
    def get_resolutions_config(cls): return cls._load_dual_data("resolutions.txt", cls.DEFAULT_RESOLUTIONS)
    @classmethod
    def get_logic_config(cls): return cls._load_dual_data("logic_rules.json", cls.DEFAULT_LOGICS)

# --- Danbooru 远端 API 配置 ---
DANBOORU_API_BASE = "https://danbooru.donmai.us"
# 本地中文词库路径（与预设补全库共用目录，文件名固定）
DANBOORU_CN_DICT_PATH = os.path.join(PRESET_DIR, "tag预设库.txt")
# Danbooru tag 分类（与参考代码一致）
DANBOORU_CATEGORIES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
}
DANBOORU_CATEGORY_COLORS = {
    0: "#4e9af1",
    1: "#f1964e",
    3: "#c84ef1",
    4: "#4ef17a",
    5: "#f14e4e",
}
# 本地 danbooru 预设库路径（格式：中文,tag,分类,热度）
DANBOORU_PRESET_PATH = os.path.join(PRESET_DIR, "danbooru预设库.txt")
_DANBOORU_PRESET_CACHE = None
_DANBOORU_PRESET_CACHE_LOCK = threading.Lock()
_DANBOORU_PRESET_MTIME = 0
_DANBOORU_CN_CACHE = None
_DANBOORU_CN_CACHE_LOCK = threading.Lock()


def _ma_load_danbooru_cn_dict_sync():
    """加载本地中文词库，用于远端 tag 的中文翻译。"""
    global _DANBOORU_CN_CACHE
    if _DANBOORU_CN_CACHE is not None:
        return _DANBOORU_CN_CACHE
    with _DANBOORU_CN_CACHE_LOCK:
        if _DANBOORU_CN_CACHE is not None:
            return _DANBOORU_CN_CACHE
    cache = {}
    if os.path.isfile(DANBOORU_CN_DICT_PATH):
        try:
            with open(DANBOORU_CN_DICT_PATH, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line or "," not in line:
                        continue
                    cn, en = line.split(",", 1)
                    cn = cn.strip()
                    en = en.strip()
                    if not en:
                        continue
                    norm = ma_normalize_en_for_tag_match(en)
                    cache[norm] = {"cn": cn, "en": en}
        except Exception:
            pass
    _DANBOORU_CN_CACHE = cache
    return cache


def _ma_get_danbooru_cn(en_norm: str) -> str:
    """按规范化 en 查本地词库，返回中文或空字符串。"""
    cache = _ma_load_danbooru_cn_dict_sync()
    entry = cache.get(en_norm)
    return (entry.get("cn") or "") if entry else ""


# ---- 本地 Danbooru 预设库缓存（格式：中文,tag,分类,热度）----
def _ma_load_danbooru_preset_cache_sync() -> list[dict]:
    """加载 danbooru预设库.txt，返回 [{cn, en, category, count, en_norm}, ...]，
    按 category→count 降序排列，便于命中时直接取高热度在前。"""
    global _DANBOORU_PRESET_CACHE, _DANBOORU_PRESET_MTIME
    cur_mtime = os.path.getmtime(DANBOORU_PRESET_PATH) if os.path.isfile(DANBOORU_PRESET_PATH) else 0
    if _DANBOORU_PRESET_CACHE is not None and _DANBOORU_PRESET_MTIME == cur_mtime:
        return _DANBOORU_PRESET_CACHE
    with _DANBOORU_PRESET_CACHE_LOCK:
        if _DANBOORU_PRESET_CACHE is not None and _DANBOORU_PRESET_MTIME == cur_mtime:
            return _DANBOORU_PRESET_CACHE
    entries: list[dict] = []
    _cn_key_map: dict[str, list[dict]] = {}   # cn → [entries]（同中文多 tag 时取最高热度）
    _en_key_map: dict[str, dict] = {}           # en_norm → best entry
    try:
        with open(DANBOORU_PRESET_PATH, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                # 格式：中文,tag,分类,热度（最多3个逗号）
                parts = line.split(",")
                if len(parts) < 4:
                    continue
                cn = parts[0].strip()
                raw_en = parts[1].strip()
                cat_str = parts[2].strip()
                cnt_str = parts[3].strip()
                if not cn or not raw_en:
                    continue
                try:
                    count = int(cnt_str)
                except ValueError:
                    count = 0
                cat_map = {"通用": 0, "general": 0,
                           "画师": 1, "artist": 1,
                           "版权": 3, "copyright": 3,
                           "角色": 4, "character": 4,
                           "元数据": 5, "meta": 5}
                category = cat_map.get(cat_str, 0)
                en_norm = ma_normalize_en_for_tag_match(raw_en)
                entry = {
                    "cn": cn,
                    "en": raw_en.replace("_", " "),
                    "raw": raw_en,
                    "category": category,
                    "count": count,
                    "en_norm": en_norm,
                }
                # 同 en_norm 去重（保留最高热度）
                prev = _en_key_map.get(en_norm)
                if prev is None or count > prev["count"]:
                    _en_key_map[en_norm] = entry
                # 同 cn 收集（用于中文匹配）
                if cn not in _cn_key_map:
                    _cn_key_map[cn] = []
                _cn_key_map[cn].append(entry)
    except Exception:
        pass
    # 合并去重后的 entries
    seen_en = set()
    for entry in _en_key_map.values():
        if entry["en_norm"] not in seen_en:
            seen_en.add(entry["en_norm"])
            entries.append(entry)
    # 按 category→count 降序
    entries.sort(key=lambda e: (e["category"], -e["count"]))
    _DANBOORU_PRESET_CACHE = entries
    _DANBOORU_PRESET_MTIME = cur_mtime
    return entries


def _ma_search_danbooru_preset(q: str, limit: int = 50) -> list[dict]:
    """本地 danbooru预设库 搜索：中文/英文均支持包含匹配，返回最多 limit 条。

    排序规则与远端一致：有中文 → 无中文，各段内按热度降序。
    对外返回的字段与远端 Danbooru /ma/danbooru_autocomplete 完全一致（raw, en, category, count, cn）。
    """
    if not q:
        return []
    q = ma_strip_autocomplete_query_edges(q)
    if not q:
        return []
    entries = _ma_load_danbooru_preset_cache_sync()
    if not entries:
        return []

    is_cn = bool(q and any(ord(c) >= 0x4E00 for c in q))
    q_lower = q.lower()
    matched: list[dict] = []

    def _en_matches(en_norm: str) -> bool:
        # 英文匹配：规范化后包含 q
        if not en_norm:
            return False
        return en_norm in q_lower or q_lower in en_norm

    def _cn_matches(cn_val: str) -> bool:
        # 中文匹配：字面包含
        if not cn_val:
            return False
        return q in cn_val or cn_val in q

    def _gloss_exclude_longer_prefix(cn_val: str) -> bool:
        """3字以上中文查询，排除更长前缀复合释义（与 _ma_danbooru_chinese_query_matches_gloss 一致）"""
        if len(q) >= 3 and cn_val.startswith(q) and len(cn_val) > len(q):
            return True  # 被排除
        return False

    for entry in entries:
        en_norm = entry.get("en_norm") or ""
        cn_val = entry.get("cn") or ""

        if is_cn:
            # 中文查询：释义须命中 q，且排除更长前缀复合释义
            if not _cn_matches(cn_val):
                continue
            if _gloss_exclude_longer_prefix(cn_val):
                continue
            matched.append(entry)
        else:
            # 英文查询：规范化后包含
            if not _en_matches(en_norm):
                continue
            matched.append(entry)

    # 排序：有中文 → 无中文，各段内 count 降序
    def _sort_key(e: dict) -> tuple:
        has_cn = 1 if (e.get("cn") or "").strip() else 0
        return (-has_cn, -(e.get("count") or 0))
    matched.sort(key=_sort_key)
    return matched[:limit]


# --- 预设标签组（savedata/magic_preset_tags.txt）---
# 格式：分类名（无缩进）→ 分组名（4空格缩进）→ 标签英文（8空格缩进）


def _ma_preset_tags_path() -> str:
    return os.path.join(PRESET_DIR, _MAGIC_PRESET_TAGS_FILE)


def _ma_build_preset_cn_map():
    """读取 savedata/tag预设库.txt，建立英文→中文翻译映射。

    同一英文可能有多条（如"女孩,1girl"和"女孩儿,1girl"），只保留首个。
    同时做「空格↔下划线」双写，防止预设标签与词库格式细微差异导致匹配失败。
    """
    en_cn = {}
    ac_path = os.path.join(PRESET_DIR, PROMPT_AUTOCOMPLETE_FILE)
    if os.path.isfile(ac_path):
        try:
            with open(ac_path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line or "," not in line:
                        continue
                    parts = line.split(",", 1)
                    if len(parts) < 2:
                        continue
                    en_raw = parts[1].strip()
                    cn = parts[0].strip()
                    if not en_raw or not cn:
                        continue
                    # 首次出现则注册
                    if en_raw not in en_cn:
                        en_cn[en_raw] = cn
                    # 同时注册空格/下划线互换版本（双向）
                    en_underscore = en_raw.replace(" ", "_")
                    en_space = en_raw.replace("_", " ")
                    if en_underscore not in en_cn and en_underscore != en_raw:
                        en_cn[en_underscore] = cn
                    if en_space not in en_cn and en_space != en_raw:
                        en_cn[en_space] = cn
        except Exception:
            pass
    return en_cn


def _ma_load_preset_tags_sync():
    """同步加载 magic_preset_tags.txt，解析为 {categories: [{name, groups: [{name, tags: []}]}]}。
    支持任意缩进深度：按行首空格数判断层级（0=分类，4=分组，>=8=标签）。
    每个标签条目格式：{ text: en, cn: cn 或空字符串 }
    """
    global _PRESET_TAGS_CACHE
    if _PRESET_TAGS_CACHE is not None:
        return _PRESET_TAGS_CACHE
    with _PRESET_TAGS_LOCK:
        if _PRESET_TAGS_CACHE is not None:
            return _PRESET_TAGS_CACHE
        path = _ma_preset_tags_path()
        categories = []
        cur_cat = None
        cur_grp = None
        en_cn_map = _ma_build_preset_cn_map()
        if not os.path.isfile(path):
            _PRESET_TAGS_CACHE = categories
            return categories
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for raw in f:
                    line = raw.rstrip("\n\r")
                    if not line or line.startswith("#"):
                        continue
                    stripped = line.lstrip()
                    indent = len(line) - len(stripped)
                    content = stripped.strip()
                    if not content:
                        continue
                    if indent == 0:
                        # 分类
                        cur_cat = {"name": content, "groups": []}
                        categories.append(cur_cat)
                        cur_grp = None
                    elif indent >= 4 and indent < 8:
                        # 分组
                        cur_grp = {"name": content, "tags": []}
                        if cur_cat is not None:
                            cur_cat["groups"].append(cur_grp)
                        else:
                            # 顶层无分类兜底
                            fake_cat = {"name": "", "groups": []}
                            fake_cat["groups"].append(cur_grp)
                            categories.insert(0, fake_cat)
                            cur_cat = fake_cat
                    else:  # indent >= 8 → 标签
                        tag_en = content
                        tag_cn = en_cn_map.get(tag_en, "")
                        tag_entry = {"text": tag_en, "cn": tag_cn}
                        if cur_grp is not None:
                            cur_grp["tags"].append(tag_entry)
                        elif cur_cat is not None:
                            # 无分组兜底
                            fake_grp = {"name": "", "tags": [tag_entry]}
                            cur_cat["groups"].append(fake_grp)
                            cur_grp = fake_grp
        except Exception as e:
            print(f"\033[31m[Magic Assistant] 加载 preset_tags 失败: {e}\033[0m")
        _PRESET_TAGS_CACHE = categories
        return categories


def ma_invalidate_preset_tags_cache():
    global _PRESET_TAGS_CACHE
    _PRESET_TAGS_CACHE = None


# --- API 路由 ---
@PromptServer.instance.routes.get("/ma/get_config")
async def get_config(request):
    return web.json_response({
        "llm": MagicUtils.get_llm_config(), 
        "rules": MagicUtils.get_rules_config(), 
        "resolutions": MagicUtils.get_resolutions_config(),
        "logics": MagicUtils.get_logic_config()
    })

@PromptServer.instance.routes.post("/ma/save_config")
async def save_config(request):
    data = await request.json()
    if "llm" in data: MagicUtils._save_user_data("llm_settings.txt", data["llm"])
    if "rules" in data: MagicUtils._save_user_data("replace_rules.txt", data["rules"])
    if "resolutions" in data: MagicUtils._save_user_data("resolutions.txt", data["resolutions"])
    if "logics" in data: MagicUtils._save_user_data("logic_rules.json", data["logics"])
    return web.json_response({"status": "success"})


# --- 统一设置读写（存 userdata/settings.txt，可扩展） ---
@PromptServer.instance.routes.get("/ma/settings")
async def get_settings(request):
    return web.json_response(MagicUtils._load_settings())


@PromptServer.instance.routes.post("/ma/format_prompt")
async def ma_format_prompt_route(request):
    """前端「格式化」：按 userdata 中 format_options 或请求体覆盖项清洗整段文本。"""
    try:
        data = await request.json()
    except Exception:
        data = {}
    text = data.get("text")
    if text is None:
        text = ""
    text = str(text)
    opts = data.get("format_options")
    if not isinstance(opts, dict):
        opts = {}

    def _run():
        return ma_clean_prompt(text, opts)

    try:
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(None, _run)
        return web.json_response({"status": "success", "text": out})
    except Exception as e:
        traceback.print_exc()
        return web.json_response(
            {"status": "error", "message": str(e)},
            status=500,
        )


@PromptServer.instance.routes.post("/ma/settings")
async def save_settings(request):
    data = await request.json()
    MagicUtils._save_settings(data)
    if isinstance(data, dict) and "prompt_history_max" in data:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, ma_trim_prompt_history_to_max)
        except Exception:
            pass
    return web.json_response({"status": "success"})


@PromptServer.instance.routes.get("/ma/prompt_autocomplete")
async def ma_prompt_autocomplete(request):
    """提示词补全：
    - 英文 tag：包含匹配（不区分大小写）→ 'boy' 匹配 '1boy'、'2boys'、'boyshort_panties'
    - 中文释义：包含匹配 → '男孩' 匹配 '1个男孩'（1boy）、'女孩' 匹配 '1个女孩'、'多个女孩' 等
    查询参数 q、limit。limit<=0 表示不限制条数（返回全部匹配）；limit 为正数时限制在 1～5000（编辑器内联补全建议 50～100）。"""
    try:
        q = ma_strip_autocomplete_query_edges(request.query.get("q", "") or "")
        try:
            limit_raw = int(request.query.get("limit", "50"))
        except ValueError:
            limit_raw = 50
        if limit_raw <= 0:
            effective_limit = None
        else:
            effective_limit = max(1, min(limit_raw, 5000))
        loop = asyncio.get_running_loop()
        items = await loop.run_in_executor(
            None, lambda: ma_search_prompt_autocomplete(q, effective_limit)
        )
        return web.json_response({"items": items})
    except Exception as e:
        return web.json_response({"items": [], "error": str(e)})


@PromptServer.instance.routes.post("/ma/prompt_autocomplete/invalidate")
async def ma_prompt_autocomplete_invalidate(request):
    """清除补全索引缓存，下次搜索时自动重建（合并预设库 + 最新用户标签组）。"""
    try:
        ma_invalidate_prompt_autocomplete_cache()
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


@PromptServer.instance.routes.post("/ma/prompt_autocomplete/batch")
async def ma_prompt_autocomplete_batch(request):
    """批量查中文提示词（rebuildTagChips 批量获取 chip 翻译用）。

    请求体：{ "queries": ["word1", "word2", ...] }
    匹配策略（按优先级）：
    1. 精确规范化匹配（空格与 _ 等价）→ 返回中文
    2. 前缀/后缀模糊匹配 → 查询词是 tag 的前后缀 → 返回中文
    3. 包含匹配 → 查询词包含 tag（或被 tag 包含） → 返回中文
    无匹配则不返回该项（前端可再走 LLM 或显示「—」）。

    返回：{ "results": { "<规范化key>": {"en":"...", "cn":"..."}, ... } }
    已缓存的词直接跳过（前端自行维护 cnHintCache）。
    """
    try:
        body = await request.json()
        queries = body.get("queries", []) if isinstance(body, dict) else []
        if not isinstance(queries, list) or not queries:
            return web.json_response({"results": {}})

        cache = ma_get_prompt_autocomplete_cache()
        norm_map = cache.get("norm_exact_map")
        entries = cache.get("entries") or []
        if not norm_map:
            custom_entries = [e for e in entries if e.get("kind") == "tagset" or e.get("source") == "custom"]
            preset_entries = [e for e in entries if not (e.get("kind") == "tagset" or e.get("source") == "custom")]
            norm_map = {}
            for e in custom_entries + preset_entries:
                k = ma_normalize_en_for_tag_match(e.get("en") or "")
                if k and k not in norm_map:
                    norm_map[k] = e

        # 构建英文 tag 列表（用于模糊匹配）：(norm_key, entry)
        all_entries_for_fuzzy = list(norm_map.values())

        def _fuzzy_cn(q_norm):
            """模糊匹配：在英文 tag 列表中找最佳匹配，返回 (en, cn) 或 None。
            优先级：等长 tag > 更长的 dict tag > 更短的 dict tag。
            """
            if not q_norm or not all_entries_for_fuzzy:
                return None
            candidates = []
            for e in all_entries_for_fuzzy:
                k = e.get("_en_norm_cached") or ma_normalize_en_for_tag_match(e.get("en") or "")
                if not k or k == q_norm:
                    continue
                if k.startswith(q_norm) or q_norm.startswith(k):
                    candidates.append((k, e))
            if not candidates:
                return None
            # 按 tag 长度降序（更具体的 tag 优先），相等时保持插入顺序
            candidates.sort(key=lambda x: len(x[0]), reverse=True)
            best = candidates[0]
            return (best[1].get("en") or "", best[1].get("cn") or "")

        results = {}
        matched = 0
        fuzzy_matched = 0
        total = 0
        for q in queries:
            if not q or not isinstance(q, str):
                continue
            key = ma_normalize_en_for_tag_match(q)
            if not key:
                continue
            total += 1
            entry = norm_map.get(key)
            if entry:
                matched += 1
                results[key] = {"en": entry.get("en") or "", "cn": entry.get("cn") or ""}
            else:
                # 精确未命中，尝试模糊匹配
                fuzzy = _fuzzy_cn(key)
                if fuzzy:
                    fuzzy_matched += 1
                    results[key] = {"en": fuzzy[0], "cn": fuzzy[1]}

        print(
            f"\033[32m[Magic Assistant] batch 词典匹配 | 总查询 {total} 条 | 精确命中 {matched} 条 | 模糊命中 {fuzzy_matched} 条"
            f"{' | 全部命中' if matched + fuzzy_matched == total else f' | 未命中 {total - matched - fuzzy_matched} 条（将走 LLM）' if matched + fuzzy_matched > 0 else ''}\033[0m"
        )
        return web.json_response({"results": results})
    except Exception as e:
        return web.json_response({"results": {}, "error": str(e)})


# --- 多功能提示词框 · LLM 翻译（translate_llm_profile + llm_settings.txt）---

MA_TRANSLATE_TAGS_SYSTEM = """你是 Stable Diffusion / Danbooru 风格的英文 tag 翻译助手。
用户会提供若干英文 tag（可能含权重语法，如 (tag:1.2)、双方括号等），请为每一项给出简短、准确的中文释义（用于界面预览，非整句翻译）。
规则：
- 释义尽量短（2～12 字常见），像词典释义；专有名词可音译+说明。
- 必须输出且仅输出一个 JSON 数组，不要 markdown 代码块，不要任何前后说明文字。
- 数组中每个元素为对象：{"tag": "<必须与用户列表中对应项完全一致>", "cn": "<中文释义>"}
- 顺序与用户输入列表一致，条目数量必须一致。
- 若极难翻译，cn 可写「未知」或合理意译，不要留空字符串。"""


def _ma_chat_completions_url(base_url: str) -> str:
    u = (base_url or "").strip().rstrip("/")
    if not u:
        return ""
    if "/chat/completions" in u:
        return u
    if u.endswith("/v1"):
        return f"{u}/chat/completions"
    return f"{u}/v1/chat/completions"


def _ma_openai_chat_completions_sync(
    base_url: str,
    api_key: str,
    model: str,
    messages: list,
    *,
    temperature: float = 0.2,
    timeout: int = 180,
) -> tuple[str, dict]:
    """返回 (content, usage_dict)；usage_dict 含 prompt_tokens / completion_tokens / total_tokens。"""
    try:
        import requests
    except ImportError as e:
        raise RuntimeError("缺少 requests 库，无法调用 LLM") from e
    endpoint = _ma_chat_completions_url(base_url)
    if not endpoint:
        raise ValueError("base_url 为空")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": temperature}
    resp = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"LLM HTTP {resp.status_code}: {resp.text[:800]}")
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"LLM 返回异常: {data!r}"[:1200])
    content = (choices[0].get("message") or {}).get("content") or ""
    usage = data.get("usage") or {}
    return str(content).strip(), usage


def _ma_extract_json_from_llm_text(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return "[]"
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t)
    if m:
        return m.group(1).strip()
    return t


def _ma_parse_translate_tags_response(content: str) -> list:
    raw = _ma_extract_json_from_llm_text(content)
    data = json.loads(raw)
    if isinstance(data, dict):
        if "items" in data:
            data = data["items"]
        elif "translations" in data:
            data = data["translations"]
        else:
            # 单对象误返回
            data = [data] if data else []
    if not isinstance(data, list):
        raise ValueError("模型返回不是 JSON 数组")
    out = []
    for it in data:
        if not isinstance(it, dict):
            continue
        tag = str(it.get("tag", "")).strip()
        cn = str(it.get("cn", "")).strip()
        if tag:
            out.append({"tag": tag, "cn": cn})
    return out


def _ma_resolve_llm_for_translate(settings: dict, llm_data: dict):
    """返回 (profile_name, profile_dict)。"""
    want = (settings.get("translate_llm_profile") or "").strip()
    if want and isinstance(llm_data, dict) and want in llm_data:
        return want, llm_data[want]
    if llm_data:
        k = next(iter(llm_data.keys()))
        return k, llm_data[k]
    raise ValueError("未配置 LLM：请在「设置 → 翻译」中选择配置，或点击「管理 LLM」添加。")


def _ma_translate_tags_llm_sync(
    tags: list,
    settings: dict,
    send_all: bool = False,
    refresh: bool = False,
    *,
    chip_single: bool = False,
    queue_waiting: int | None = None,
) -> dict:
    # 统一 LLM 翻译逻辑：
    #
    # 正常模式（send_all=False, refresh=False）：
    #   已在 LLM 磁盘缓存的 tag → 跳过 API；未命中 → 送 LLM → _ma_cache_put 更新该 key（LRU，不删其它条目）
    #
    # 强制模式（send_all=True）：
    #   请求内全部 tag 都送 LLM（忽略磁盘缓存命中），结果逐条写入缓存
    #
    # 单条刷新（refresh=True，芯片「A/文」按钮）：
    #   仅本次请求的 tag 强制送 LLM，忽略磁盘缓存；写回时只更新对应规范化 key，不清空整个缓存文件
    #
    # send_all：强制翻译时，仅对「未命中 LLM 磁盘缓存」的 tag 送 LLM，已缓存的跳过（省 token）。
    #            与正常模式的区别：正常模式按「有无中文」决定送哪些；send_all 决定「哪些已有缓存的也要重译」。
    #            默认 True（覆盖所有）→ 实际改为「仅未命中者送 LLM，已命中者覆盖写回缓存」。
    # refresh：芯片「A/文」在强制翻译模式下，本次 tag 无视缓存、强制送 LLM。
    #          正常模式芯片默认 refresh=False（先查缓存）。
    #
    # 前端负责：正常/强制一键翻译时决定传哪些 tag（由 cnHintCache 有无中文决定）；
    #          芯片「A/文」在「强制翻译」模式下传 refresh=True，其余默认 False。

    cache_before_count = len(_ma_get_llm_cache())

    cached_map = {}   # norm_key -> {"tag": en_raw, "cn": cn}
    to_translate = []
    seen_norm = set()
    cache_hit_count = 0  # 在 refresh/send_all 下表示「若走缓存本会命中」的条数，仅用于日志
    for en_raw in tags:
        norm = ma_normalize_en_for_tag_match(en_raw)
        if not norm or norm in seen_norm:
            continue
        seen_norm.add(norm)
        if refresh:
            # 芯片强制模式：本条无视缓存，强制送 LLM
            if _ma_cache_lookup(norm) is not None:
                cache_hit_count += 1
            to_translate.append(en_raw)
        elif send_all:
            # 一键强制翻译：仅对「未命中缓存」的 tag 送 LLM，已命中的走缓存不占 token
            cached_cn = _ma_cache_lookup(norm)
            if cached_cn is not None:
                cached_map[norm] = {"tag": en_raw, "cn": cached_cn}
                cache_hit_count += 1
            else:
                to_translate.append(en_raw)
        else:
            cached_cn = _ma_cache_lookup(norm)
            if cached_cn is not None:
                cached_map[norm] = {"tag": en_raw, "cn": cached_cn}
            else:
                to_translate.append(en_raw)

    if not refresh and not send_all:
        cache_hit_count = len(cached_map)

    # 全命中 LLM 缓存 → 直接跳过 LLM（正常 / send_all / refresh 都可能提前 return）
    if not to_translate:
        all_items = list(cached_map.values())
        print(
            f"\033[35m[Magic Assistant] LLM 翻译{'【强制模式】' if send_all else ''}"
            f"| LLM 缓存命中 {cache_hit_count}/{len(tags)} 条 | "
            f"本次跳过 LLM（全部已在 LLM 缓存），共 {cache_before_count} 条\033[0m"
        )
        return {
            "items": all_items,
            "profile_used": "",
            "requested": len(tags),
            "returned": len(all_items),
            "cache_hits": cache_hit_count,
            "cache_total": cache_before_count,
            "send_all": send_all,
            "refresh": refresh,
            "llm_batch_size": 0,
        }

    # —— 调用 LLM ——
    llm_data = MagicUtils.get_llm_config()
    profile, active = _ma_resolve_llm_for_translate(settings, llm_data)
    base_url = (active.get("base_url") or "").strip().rstrip("/")
    api_key = active.get("api_key") or ""
    model = (active.get("model") or "").strip()
    if not base_url or not api_key:
        raise ValueError(f"LLM 配置「{profile}」缺少 base_url 或 api_key")

    items_json = json.dumps(to_translate, ensure_ascii=False)
    user_msg = (
        "以下为需要翻译的英文 tag 列表（JSON 数组）。请严格按系统说明返回 JSON 数组；"
        "每个对象的 tag 字段必须与下列数组中对应下标的字符串完全一致（逐字一致，含空格与标点）。\n\n"
        f"输入列表（共 {len(to_translate)} 条）：\n{items_json}"
    )
    messages = [
        {"role": "system", "content": MA_TRANSLATE_TAGS_SYSTEM},
        {"role": "user", "content": user_msg},
    ]
    content, usage = _ma_openai_chat_completions_sync(
        base_url, api_key, model, messages, temperature=0.2, timeout=180,
    )
    parsed = _ma_parse_translate_tags_response(content)

    if chip_single and tags:
        qnote = f" | 队列剩余 {queue_waiting} 条" if queue_waiting is not None and queue_waiting >= 0 else ""
        t0 = (tags[0] or "")[:72]
        print(f"\033[35m[Magic Assistant] 芯片单条 LLM 开始{qnote} | tag={t0!r}\033[0m")

    # 新结果写入缓存：仅更新本条目的规范化 key（LRU），不整文件覆盖
    for it in parsed:
        _ma_cache_put(it.get("tag") or "", it.get("cn") or "")
    cache_after_count = len(_ma_get_llm_cache())

    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    tt = usage.get("total_tokens", 0)

    parsed_by_norm = {}
    for it in parsed:
        kn = ma_normalize_en_for_tag_match(str(it.get("tag") or ""))
        if kn:
            parsed_by_norm[kn] = it

    # 合并：按 tags 原始顺序，全部 tag 都出现
    seen_norm2 = set()
    merged = []
    for en_raw in tags:
        norm = ma_normalize_en_for_tag_match(en_raw)
        if not norm or norm in seen_norm2:
            continue
        seen_norm2.add(norm)
        if norm in parsed_by_norm:
            merged.append(parsed_by_norm[norm])
        elif norm in cached_map:
            merged.append(cached_map[norm])

    if refresh:
        hit_note = f"磁盘缓存本可命中 {cache_hit_count} 条（已强制重译本条）" if cache_hit_count else ""
    elif send_all:
        hit_note = f"LLM 缓存命中 {cache_hit_count} 条（已跳过 API）" if cache_hit_count else ""
    else:
        hit_note = f"LLM 缓存命中 {cache_hit_count} 条（跳过 LLM）" if cache_hit_count else ""

    mode_tag = ""
    if chip_single:
        mode_tag = "【芯片单条】"
    elif send_all:
        mode_tag = "【强制模式】"

    print(
        f"\033[36m[Magic Assistant] LLM 翻译{mode_tag}"
        f"| profile={profile} | model={model} | "
        f"{hit_note + ' | ' if hit_note else ''}"
        f"本次 LLM 请求 {len(to_translate)} 条 → 解析 {len(parsed)} 条 | "
        f"tokens: prompt={pt} completion={ct} total={tt} | "
        f"缓存累计 {cache_after_count} 条\033[0m"
    )

    return {
        "items": merged,
        "profile_used": profile,
        "requested": len(tags),
        "returned": len(merged),
        "cache_hits": cache_hit_count,
        "cache_total": cache_after_count,
        "send_all": send_all,
        "refresh": refresh,
        "llm_batch_size": len(to_translate),
        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt},
    }


MA_TRANSLATE_LINE_SYSTEM = """你是面向 Stable Diffusion 的英译助手。用户在小输入框里粘贴任意语言，你要译成**自然、可用的英文**，不要机械套用「批量 tag 翻译」那套规则。

判断方式（按输入形态选一种，只输出一行，不要换行、不要解释、不要 markdown）：
1) **短词 / 明显是多个并列概念**（如「白衬衫、红裙子」「猫 狗」或用户用逗号/顿号列出若干名词）：输出 **Danbooru 式英文 tag**，用英文逗号加空格 `, ` 分隔；复合概念用下划线（如 white_shirt）。
2) **完整长句、叙事、描写、口语**（一句话讲场景或动作）：输出 **一整句自然英文**（可读、通顺），像正常翻译句子一样；**不要用逗号拆成多个伪 tag**（避免下游把逗号当成多个标签）。句内用 and、分号或从句连接；需要时用下划线仅限极短的复合词。

不要擅自扩写大量与原文无关的 tag。"""


def _ma_translate_line_llm_sync(text: str, settings: dict) -> dict:
    llm_data = MagicUtils.get_llm_config()
    profile, active = _ma_resolve_llm_for_translate(settings, llm_data)
    base_url = (active.get("base_url") or "").strip().rstrip("/")
    api_key = active.get("api_key") or ""
    model = active.get("model") or ""
    if not base_url or not api_key:
        raise ValueError(f"LLM 配置「{profile}」缺少 base_url 或 api_key")
    user_msg = f"请按系统说明译成一行英文（短则 tag 行，长则自然语句）：\n{text.strip()}"
    messages = [
        {"role": "system", "content": MA_TRANSLATE_LINE_SYSTEM},
        {"role": "user", "content": user_msg},
    ]
    content, usage = _ma_openai_chat_completions_sync(base_url, api_key, model, messages, temperature=0.35, timeout=90)
    line = content.split("\n")[0].strip()
    line = re.sub(r"^[\"']|[\"']$", "", line).strip()
    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    tt = usage.get("total_tokens", 0)
    print(
        f"\033[36m[Magic Assistant] LLM 单行翻译 | profile={profile} | model={model} | "
        f"tokens: prompt={pt} completion={ct} total={tt}\033[0m"
    )
    return {"text": line, "profile_used": profile}


@PromptServer.instance.routes.post("/ma/translate_tags_llm")
async def ma_translate_tags_llm_route(request):
    """批量翻译 tag 中文释义。

    请求体：{ "tags": [...], "send_all": bool, "refresh": bool, "chip_single": bool, "queue_waiting": int }
    - send_all：与设置 translate_mode=force 一致时忽略 LLM 磁盘缓存、全部重译
    - refresh：为 True 时本次请求的 tag 无视磁盘缓存、强制送 LLM（仍只更新对应 key 的 LRU）；芯片「A/文」在「强制翻译」模式下会传 True
    - chip_single + queue_waiting：终端日志展示单条队列进度
    最多 200 条。
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    tags = body.get("tags") if isinstance(body, dict) else None
    if not isinstance(tags, list) or not tags:
        return web.json_response({"status": "error", "message": "tags 必须为非空数组"}, status=400)
    clean = []
    for x in tags:
        if isinstance(x, str):
            t = x.strip()
            if t and len(t) <= 240:
                clean.append(t)
    # 去重保序
    seen = set()
    uniq = []
    for t in clean:
        k = ma_normalize_en_for_tag_match(t)
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(t)
    if len(uniq) > 200:
        uniq = uniq[:200]
    if not uniq:
        return web.json_response({"status": "error", "message": "没有有效的 tag"}, status=400)
    settings = MagicUtils._load_settings()
    tm = str(settings.get("translate_mode") or "").strip().lower()
    send_all_default = tm == "force" or bool(settings.get("translate_llm_force"))
    send_all = bool(body.get("send_all")) if "send_all" in body else send_all_default
    refresh = bool(body.get("refresh"))
    chip_single = bool(body.get("chip_single"))
    qw = body.get("queue_waiting") if isinstance(body, dict) else None
    queue_waiting = int(qw) if isinstance(qw, int) and qw >= 0 else None

    def _run():
        return _ma_translate_tags_llm_sync(
            uniq,
            settings,
            send_all=send_all,
            refresh=refresh,
            chip_single=chip_single,
            queue_waiting=queue_waiting,
        )

    try:
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(None, _run)
        return web.json_response({"status": "success", **out})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.post("/ma/translate_line_llm")
async def ma_translate_line_llm_route(request):
    """单行：中/英等 → 英文 tag 行。请求体：{ "text": "..." }"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    text = ""
    if isinstance(body, dict) and body.get("text") is not None:
        text = str(body.get("text"))
    text = text.strip()
    if not text or len(text) > 4000:
        return web.json_response({"status": "error", "message": "text 无效或过长"}, status=400)
    settings = MagicUtils._load_settings()

    def _run():
        return _ma_translate_line_llm_sync(text, settings)

    try:
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(None, _run)
        return web.json_response({"status": "success", **out})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# --- 用户标签组（userdata，每行：中文名称,(英文tag组合)）---
MAGIC_NEW_TAGSETS_FILE = "magic_new_tagsets.txt"
MAGIC_FAVORITE_TAGSETS_FILE = "magic_favorite_tagsets.txt"


def ma_parse_tagset_line(line: str):
    """解析一行：中文,(英文组) —— 英文整段包在最后一对括号内。"""
    line = (line or "").strip()
    if not line or ",(" not in line:
        return None
    cn, rest = line.split(",(", 1)
    cn = cn.strip()
    if not rest.endswith(")"):
        return None
    en = rest[:-1].strip()
    if not en:
        return None
    return {"name": cn, "content": en}


def ma_format_tagset_line(name: str, content: str) -> str:
    c = (content or "").strip()
    n = (name or "").strip()
    return f"{n},({c})"


def ma_read_tagset_file(path: str):
    """按行读取；若一行在「中文,(」之后未以 ) 结束（被误换行截断），则与后续行合并后再解析。"""
    items = []
    if not os.path.isfile(path):
        return items
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw_lines = [ln.rstrip("\n\r") for ln in f.readlines()]
    except Exception:
        return items
    i = 0
    n = len(raw_lines)
    while i < n:
        line = (raw_lines[i] or "").strip()
        i += 1
        if not line:
            continue
        chunk = line
        # 已出现「名称,(」但整段尚未以 ) 收尾 → 继续拼下一行，避免手写/拷贝导致折行后整组丢失
        while ",(" in chunk and not chunk.rstrip().endswith(")"):
            if i >= n:
                break
            nxt = (raw_lines[i] or "").strip()
            i += 1
            if not nxt:
                continue
            last = chunk.rstrip()[-1:] if chunk.rstrip() else ""
            first = nxt[:1]
            sep = ", "
            if last in "(," or not first or not (first.isalnum() or first in "_"):
                sep = " "
            chunk = chunk + sep + nxt
        p = ma_parse_tagset_line(chunk)
        if p:
            items.append(p)
    return items


def ma_normalize_tagset_content(raw: str) -> str:
    """把 content 里各种换行/回车、空格碎片统一成干净逗号分隔列表：'a , b\\nc ,  d' → 'a, b, c, d'"""
    if not raw:
        return ""
    # 1. 压平所有换行和制表
    flat = re.sub(r"[\r\n\t]+", " ", raw)
    # 2. 统一逗号（中文逗号、全角逗号、顿号 → 半角逗号）
    flat = flat.replace("，", ",").replace("、", ",")
    # 3. 切分、清洗、重组
    parts = []
    for seg in flat.split(","):
        seg = seg.strip()
        if seg:
            parts.append(seg)
    return ", ".join(parts)


def ma_write_tagset_file(path: str, items: list):
    """覆盖写入；仅保留 content 非空的项。写入前规范化 content，保证每行是一组且不含换行符。"""
    MagicUtils.ensure_user_dir()
    lines = []
    for it in items or []:
        raw = it.get("content") or ""
        c = ma_normalize_tagset_content(raw)
        if not c:
            continue
        n = (it.get("name") or "").strip()
        lines.append(ma_format_tagset_line(n, c))
    content = "\n".join(lines)
    if lines:
        content += "\n"
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=parent, suffix=".tmp", text=False)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        os.replace(tmp_path, path)
        tmp_path = None
    except Exception:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise


def _ma_tagset_paths():
    MagicUtils.ensure_user_dir()
    return (
        os.path.join(USER_DIR, MAGIC_NEW_TAGSETS_FILE),
        os.path.join(USER_DIR, MAGIC_FAVORITE_TAGSETS_FILE),
    )


# --- LLM 翻译缓存（userdata/llm_translation_cache.json，LRU，上限由 llm_cache_max 决定）---

_MA_LLM_CACHE_FILE = "llm_translation_cache.json"
_MA_LLM_CACHE_LOCK = threading.Lock()
_MA_LLM_CACHE = None  # list of {en, cn, timestamp}


def _ma_llm_cache_max() -> int:
    try:
        st = MagicUtils._load_settings()
        v = int(st.get("llm_cache_max") or 150)
        return max(10, min(v, 2000))
    except Exception:
        return 150


def _ma_llm_cache_path():
    return os.path.join(USER_DIR, _MA_LLM_CACHE_FILE)


def _ma_load_llm_cache() -> list:
    """从磁盘加载 LLM 翻译缓存（按 timestamp 升序）。"""
    path = _ma_llm_cache_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        # 过滤脏数据
        out = []
        for it in data:
            if isinstance(it, dict) and isinstance(it.get("en"), str) and isinstance(it.get("cn"), str):
                out.append({"en": it["en"], "cn": it["cn"], "timestamp": float(it.get("timestamp", 0))})
        return out
    except Exception:
        return []


def _ma_save_llm_cache(cache: list):
    """把 cache 写回磁盘（最多 _ma_llm_cache_max() 条，写临时文件再 rename）。"""
    path = _ma_llm_cache_path()
    MagicUtils.ensure_user_dir()
    limit = _ma_llm_cache_max()
    trimmed = cache[-limit:] if len(cache) > limit else cache
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(trimmed, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _ma_get_llm_cache() -> list:
    global _MA_LLM_CACHE
    if _MA_LLM_CACHE is None:
        with _MA_LLM_CACHE_LOCK:
            if _MA_LLM_CACHE is None:
                _MA_LLM_CACHE = _ma_load_llm_cache()
    return _MA_LLM_CACHE


def _ma_cache_lookup(norm_key: str) -> str | None:
    """按规范化 key（空格→_ 小写）查找缓存 cn，找不到返回 None。"""
    cache = _ma_get_llm_cache()
    for it in cache:
        if ma_normalize_en_for_tag_match(it["en"]) == norm_key:
            return it["cn"]
    return None


def _ma_cache_put(en_raw: str, cn: str):
    """把一对 en→cn 写入缓存；超过上限时删除最早的 LRU 条目。"""
    cache = _ma_get_llm_cache()
    norm_key = ma_normalize_en_for_tag_match(en_raw)
    # 先删掉已有的同规范化 key（旧条目）
    cache[:] = [
        it
        for it in cache
        if ma_normalize_en_for_tag_match(it["en"]) != norm_key
    ]
    cache.append({"en": en_raw, "cn": cn, "timestamp": time.time()})
    limit = _ma_llm_cache_max()
    if len(cache) > limit:
        cache[:] = cache[-limit:]
    with _MA_LLM_CACHE_LOCK:
        _MA_LLM_CACHE = cache
    _ma_save_llm_cache(cache)


def _ma_split_prompt_line_segments(line: str) -> list[str]:
    """与前端单行译 tag 一致：按中英文逗号、顿号拆成片段。"""
    if not line or not str(line).strip():
        return []
    parts = re.split(r"[,，、]", str(line))
    return [p.strip() for p in parts if p.strip()]


def ma_seed_llm_cache_from_translate_line(source_zh: str, en_line: str) -> int:
    """将单行输入框的「原文」与「模型返回的一行英文」写入 LLM 磁盘缓存。

    - 英文按逗号/顿号拆成多段且与中文段数一致：逐段对齐写入（与批量 tag 译一致）。
    - 英文仅一段：整行英文对应整段原文（长句自然译本的常见情况）。
    - 英文多段但与中文段数不一致：**不写入**（避免把整句中文重复绑到每个 tag 上）。
    返回成功写入的条数。
    """
    zh = (source_zh or "").strip()
    line = (en_line or "").strip()
    if not zh or not line:
        return 0
    en_parts = _ma_split_prompt_line_segments(line)
    zh_parts = _ma_split_prompt_line_segments(zh)
    if not en_parts:
        return 0
    cn_max = 240
    n = 0
    if len(en_parts) == 1:
        en_raw = en_parts[0]
        norm = ma_normalize_en_for_tag_match(en_raw)
        if norm:
            _ma_cache_put(en_raw, zh[:cn_max])
            n = 1
        return n
    if len(zh_parts) == len(en_parts):
        for en_raw, cn_raw in zip(en_parts, zh_parts):
            norm = ma_normalize_en_for_tag_match(en_raw)
            if not norm:
                continue
            cn_use = (cn_raw or "").strip()[:cn_max] or zh[:cn_max]
            _ma_cache_put(en_raw, cn_use)
            n += 1
    return n


@PromptServer.instance.routes.post("/ma/llm_translation_cache/seed_from_line")
async def ma_llm_cache_seed_from_line_route(request):
    """请求体：{ "source_zh": "...", "en_line": "..." } — 与单行译插入框配套，写入 llm_translation_cache。"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        return web.json_response({"status": "error", "message": "请求体必须是 JSON 对象"}, status=400)
    source_zh = str(body.get("source_zh") or "").strip()
    en_line = str(body.get("en_line") or "").strip()
    if not source_zh or not en_line:
        return web.json_response(
            {"status": "error", "message": "source_zh 与 en_line 不能为空"},
            status=400,
        )
    if len(source_zh) > 4000 or len(en_line) > 8000:
        return web.json_response({"status": "error", "message": "内容过长"}, status=400)

    def _run():
        return ma_seed_llm_cache_from_translate_line(source_zh, en_line)

    try:
        loop = asyncio.get_running_loop()
        n = await loop.run_in_executor(None, _run)
        print(f"\033[36m[Magic Assistant] LLM 缓存 seed_from_line | seeded={n}\033[0m")
        return web.json_response({"status": "success", "seeded": n})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.get("/ma/tag_sets")
async def ma_get_tag_sets(request):
    """返回 { new: [{name, content}], favorites: [...] }"""
    try:
        new_p, fav_p = _ma_tagset_paths()
        loop = asyncio.get_running_loop()

        def load():
            return {
                "new": ma_read_tagset_file(new_p),
                "favorites": ma_read_tagset_file(fav_p),
            }

        data = await loop.run_in_executor(None, load)
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"new": [], "favorites": [], "error": str(e)})


@PromptServer.instance.routes.post("/ma/tag_sets")
async def ma_post_tag_sets(request):
    """JSON 可含 new 或 new_tagsets、favorites 之一或两者，均为 [{name, content}]，整文件覆盖。"""
    try:
        try:
            data = await request.json()
        except Exception as e:
            return web.json_response(
                {"status": "error", "message": f"无效的 JSON 请求体: {e}"},
                status=400,
            )
        if not isinstance(data, dict):
            return web.json_response(
                {"status": "error", "message": "请求体必须是 JSON 对象"},
                status=400,
            )
        new_p, fav_p = _ma_tagset_paths()
        loop = asyncio.get_running_loop()

        def new_list_from_body():
            # 优先 new_tagsets，避免极少数环境对键名 "new" 的异常处理；兼容旧客户端
            v = data.get("new_tagsets")
            if v is None and "new" in data:
                v = data.get("new")
            return v

        def save():
            nl = new_list_from_body()
            if nl is not None:
                if not isinstance(nl, list):
                    raise ValueError("字段 new_tagsets/new 必须是数组")
                ma_write_tagset_file(new_p, nl)
            if "favorites" in data:
                fl = data.get("favorites")
                if fl is not None:
                    if not isinstance(fl, list):
                        raise ValueError("字段 favorites 必须是数组")
                    ma_write_tagset_file(fav_p, fl)

        await loop.run_in_executor(None, save)
        ma_invalidate_prompt_autocomplete_cache()
        return web.json_response({"status": "success"})
    except ValueError as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)
    except Exception as e:
        print(f"\033[31m[Magic Assistant] POST /ma/tag_sets 失败: {e}\033[0m")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.get("/ma/preset_tags")
async def ma_get_preset_tags(request):
    """返回预设标签组 { categories: [{name, groups: [{name, tags: []}]}] }"""
    try:
        loop = asyncio.get_running_loop()
        categories = await loop.run_in_executor(None, _ma_load_preset_tags_sync)
        return web.json_response({"categories": categories})
    except Exception as e:
        print(f"\033[31m[Magic Assistant] GET /ma/preset_tags 失败: {e}\033[0m")
        traceback.print_exc()
        return web.json_response({"categories": [], "error": str(e)}, status=500)


# --- Magic 提示词框 · 运行历史与历史收藏（userdata/magic_prompt_history.json）---
MAGIC_PROMPT_HISTORY_FILE = "magic_prompt_history.json"
_PROMPT_HISTORY_LOCK = threading.Lock()


def _ma_prompt_history_path():
    MagicUtils.ensure_user_dir()
    return os.path.join(USER_DIR, MAGIC_PROMPT_HISTORY_FILE)


def _ma_default_prompt_history_store():
    return {"history": [], "favorites": []}


def ma_load_prompt_history_store():
    """读取本地历史 JSON；缺省或损坏时返回空结构。"""
    path = _ma_prompt_history_path()
    if not os.path.isfile(path):
        return _ma_default_prompt_history_store()
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return _ma_default_prompt_history_store()
        h = data.get("history")
        f = data.get("favorites")
        if not isinstance(h, list):
            h = []
        if not isinstance(f, list):
            f = []
        return {"history": h, "favorites": f}
    except Exception:
        return _ma_default_prompt_history_store()


def ma_save_prompt_history_store(store: dict):
    """原子写入历史文件。"""
    MagicUtils.ensure_user_dir()
    path = _ma_prompt_history_path()
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    history = store.get("history") if isinstance(store.get("history"), list) else []
    favorites = store.get("favorites") if isinstance(store.get("favorites"), list) else []
    payload = {"history": history, "favorites": favorites}
    fd, tmp_path = tempfile.mkstemp(dir=parent, suffix=".tmp", text=False)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
        tmp_path = None
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def ma_normalize_prompt_history_key(text: str) -> str:
    """与写入前对比用：整段提示词压平、逗号规范化后的小写串。"""
    n = ma_normalize_tagset_content(text or "")
    return n.strip().lower()


def ma_get_prompt_history_max_entries() -> int:
    try:
        s = MagicUtils._load_settings()
        n = int(s.get("prompt_history_max", 20))
        return max(1, min(n, 500))
    except Exception:
        return 20


def ma_trim_prompt_history_to_max():
    """修改 prompt_history_max 后按新上限裁剪运行历史（收藏不动）。"""
    max_n = ma_get_prompt_history_max_entries()
    with _PROMPT_HISTORY_LOCK:
        st = ma_load_prompt_history_store()
        hist = list(st.get("history") or [])
        if len(hist) > max_n:
            st["history"] = hist[:max_n]
            ma_save_prompt_history_store(st)


@PromptServer.instance.routes.get("/ma/prompt_history")
async def ma_get_prompt_history(request):
    """返回 { history, favorites, max_entries }；max_entries 来自 settings。"""
    try:
        loop = asyncio.get_running_loop()

        def load():
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
            st = st.copy()
            st["max_entries"] = ma_get_prompt_history_max_entries()
            return st

        data = await loop.run_in_executor(None, load)
        return web.json_response(data)
    except Exception as e:
        return web.json_response(
            {"history": [], "favorites": [], "max_entries": 20, "error": str(e)},
            status=500,
        )


@PromptServer.instance.routes.post("/ma/prompt_history")
async def ma_post_prompt_history(request):
    """JSON: { action, ... } — append_run / delete_history / add_favorite / update_favorite / delete_favorite"""
    try:
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response(
                {"status": "error", "message": f"无效的 JSON: {e}"},
                status=400,
            )
        if not isinstance(body, dict):
            return web.json_response(
                {"status": "error", "message": "请求体须为 JSON 对象"},
                status=400,
            )
        action = (body.get("action") or "").strip()
        loop = asyncio.get_running_loop()

        def do_append_run():
            texts = body.get("texts")
            if not isinstance(texts, list):
                raise ValueError("append_run 需要 texts 数组")
            max_n = ma_get_prompt_history_max_entries()
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
                hist = list(st.get("history") or [])
                existing_keys = {ma_normalize_prompt_history_key(x.get("text", "")) for x in hist if isinstance(x, dict)}
                now_ms = int(time.time() * 1000)
                for raw in texts:
                    if not isinstance(raw, str):
                        continue
                    t = raw.strip()
                    if not t:
                        continue
                    key = ma_normalize_prompt_history_key(t)
                    if not key or key in existing_keys:
                        continue
                    existing_keys.add(key)
                    hist.insert(
                        0,
                        {
                            "id": str(uuid.uuid4()),
                            "text": t,
                            "ts": now_ms,
                        },
                    )
                    now_ms += 1
                hist = hist[:max_n]
                st["history"] = hist
                ma_save_prompt_history_store(st)
                return st

        def do_delete_history():
            hid = body.get("id")
            if not hid or not isinstance(hid, str):
                raise ValueError("delete_history 需要 id 字符串")
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
                hist = [x for x in (st.get("history") or []) if isinstance(x, dict) and x.get("id") != hid]
                st["history"] = hist
                ma_save_prompt_history_store(st)
                return st

        def do_add_favorite():
            name = (body.get("name") or "").strip() or "未命名收藏"
            text = body.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("add_favorite 需要非空 text")
            text = text.strip()
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
                fav = list(st.get("favorites") or [])
                key = ma_normalize_prompt_history_key(text)
                for x in fav:
                    if isinstance(x, dict) and ma_normalize_prompt_history_key(x.get("text", "")) == key:
                        return st
                fav.insert(
                    0,
                    {
                        "id": str(uuid.uuid4()),
                        "name": name,
                        "text": text,
                        "ts": int(time.time() * 1000),
                    },
                )
                st["favorites"] = fav
                ma_save_prompt_history_store(st)
                return st

        def do_update_favorite():
            fid = body.get("id")
            if not fid or not isinstance(fid, str):
                raise ValueError("update_favorite 需要 id")
            name = (body.get("name") or "").strip() or "未命名收藏"
            text = body.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("update_favorite 需要非空 text")
            text = text.strip()
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
                fav = list(st.get("favorites") or [])
                found = False
                for i, x in enumerate(fav):
                    if isinstance(x, dict) and x.get("id") == fid:
                        fav[i] = {
                            **x,
                            "name": name,
                            "text": text,
                            "ts": int(time.time() * 1000),
                        }
                        found = True
                        break
                if not found:
                    raise ValueError("找不到该收藏项")
                st["favorites"] = fav
                ma_save_prompt_history_store(st)
                return st

        def do_delete_favorite():
            fid = body.get("id")
            if not fid or not isinstance(fid, str):
                raise ValueError("delete_favorite 需要 id")
            with _PROMPT_HISTORY_LOCK:
                st = ma_load_prompt_history_store()
                fav = [x for x in (st.get("favorites") or []) if isinstance(x, dict) and x.get("id") != fid]
                st["favorites"] = fav
                ma_save_prompt_history_store(st)
                return st

        if action == "append_run":
            st = await loop.run_in_executor(None, do_append_run)
        elif action == "delete_history":
            st = await loop.run_in_executor(None, do_delete_history)
        elif action == "add_favorite":
            st = await loop.run_in_executor(None, do_add_favorite)
        elif action == "update_favorite":
            st = await loop.run_in_executor(None, do_update_favorite)
        elif action == "delete_favorite":
            st = await loop.run_in_executor(None, do_delete_favorite)
        else:
            return web.json_response(
                {"status": "error", "message": f"未知 action: {action}"},
                status=400,
            )
        st = st.copy()
        st["max_entries"] = ma_get_prompt_history_max_entries()
        return web.json_response({"status": "success", **st})
    except ValueError as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)
    except Exception as e:
        print(f"\033[31m[Magic Assistant] POST /ma/prompt_history 失败: {e}\033[0m")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.post("/ma/delete_file")
async def delete_file(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        if ".." in filename or "/" in filename or "\\" in filename: return web.json_response({"status": "error"})
        
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, subfolder)
        file_path = os.path.join(target_dir, filename)

        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error", "message": "Not found"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.post("/ma/rename_file")
async def rename_file(request):
    try:
        data = await request.json()
        old_name = data.get("old_name")
        new_name = data.get("new_name")
        subfolder = data.get("subfolder", "")
        
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, subfolder)
        old_path = os.path.join(target_dir, old_name)
        new_path = os.path.join(target_dir, new_name)

        if os.path.exists(old_path) and not os.path.exists(new_path):
            os.rename(old_path, new_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.post("/ma/clear_clipspace")
async def clear_clipspace(request):
    try:
        input_dir = folder_paths.get_input_directory()
        clipspace_dir = os.path.join(input_dir, "clipspace")
        pasted_dir = os.path.join(input_dir, "pasted")
        clipspace_count = 0
        pasted_count = 0
        for target_dir in [clipspace_dir, pasted_dir]:
            if not os.path.exists(target_dir):
                continue
            for f in os.listdir(target_dir):
                file_path = os.path.join(target_dir, f)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                        if target_dir == clipspace_dir:
                            clipspace_count += 1
                        else:
                            pasted_count += 1
                except Exception:
                    pass

        return web.json_response({
            "status": "success",
            "clipspace_count": clipspace_count,
            "pasted_count": pasted_count,
            "total_count": clipspace_count + pasted_count
        })
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

@PromptServer.instance.routes.get("/ma/get_file_list")
async def get_file_list(request):
    try:
        input_dir = folder_paths.get_input_directory()
        files = []
        
        if os.path.exists(input_dir):
            for f in os.listdir(input_dir):
                if os.path.isfile(os.path.join(input_dir, f)) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff')):
                    files.append(f)
        
        def get_mtime(fname):
            p = os.path.join(input_dir, fname)
            if os.path.exists(p): return os.path.getmtime(p)
            return 0

        files.sort(key=get_mtime, reverse=True)
        return web.json_response({"files": files})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})

@PromptServer.instance.routes.get("/ma/danbooru_autocomplete")
async def ma_danbooru_autocomplete(request):
    """Danbooru 补全：支持远端（默认）和本地预设库（source=preset）两种数据源。
    查询参数 q（搜索词）、limit（单页条数，默认 100，最大 100）、page（页码，从 1 起）、source（preset | remote）。
    source=preset 时走本地 danbooru预设库.txt（毫秒级加载，带分类+热度）。
    source=remote（或省略）时走 Danbooru 远端 API（分类+热度来自 Danbooru）。
    返回 items、page、has_more（本页条数达 limit 时可能还有下一页）、cn_translate（如输入含中文则为翻译出的英文关键词列表）。
    """
    try:
        q = ma_strip_autocomplete_query_edges(request.query.get("q") or "")
        if len(q) < 1:
            return web.json_response({"items": [], "page": 1, "has_more": False})

        source = (request.query.get("source") or "remote").strip().lower()
        is_preset = source == "preset"

        # 预设库（本地）：同步内存搜索，毫秒级响应
        if is_preset:
            try:
                limit = int(request.query.get("limit", "100"))
            except ValueError:
                limit = 100
            limit = max(1, min(500, limit))
            loop = asyncio.get_running_loop()
            items = await loop.run_in_executor(
                None, lambda: _ma_search_danbooru_preset(q, limit=limit)
            )
            return web.json_response({
                "items": items,
                "page": 1,
                "has_more": False,
                "source": "preset",
            })

        # 远端 Danbooru（保持原有逻辑不变）
        has_cn_query = bool(q and any(ord(c) >= 0x4E00 for c in q))
        cn_translated_en_norms = []
        if has_cn_query:
            _, local_entries = _ma_translate_cn_for_danbooru(q, limit=20)
            cn_translated_en_norms = [e.get("_en_norm_cached") or ma_normalize_en_for_tag_match(e.get("en") or "") for e in local_entries]

        try:
            page = int(request.query.get("page", "1"))
        except ValueError:
            page = 1
        page = max(1, page)
        try:
            per_page = int(request.query.get("limit", "100"))
        except ValueError:
            per_page = 100
        per_page = max(1, min(100, per_page))
        loop = asyncio.get_running_loop()
        items, has_more = await loop.run_in_executor(
            None, lambda: _ma_search_danbooru_remote(q, page=page, per_page=per_page)
        )
        return web.json_response({
            "items": items,
            "page": page,
            "has_more": has_more,
            "cn_translate": cn_translated_en_norms if has_cn_query else None,
            "source": "remote",
        })
    except Exception as e:
        return web.json_response({"items": [], "page": 1, "has_more": False, "error": str(e)})


def _ma_translate_cn_for_danbooru(q: str, limit: int = 10) -> tuple[list[str], list[dict]]:
    """将中文查询 q 翻译为英文 en_norm 列表，返回 (en_norm 列表, 对应本地条目，与 en 顺序对齐尽量一致)。

    顺序：口语别名 → 词库精确 cn → 前缀（中文键越短越靠前）→ 子串（键短、匹配位置靠前优先）。
    避免「女孩」只走子串时大量「被两个女孩夹在中间」类条目排在「1girl」之前。
    """
    if not q:
        return [], []
    q = ma_strip_autocomplete_query_edges(q)
    if not q:
        return [], []
    data = ma_get_prompt_autocomplete_cache()
    cn_norm_map = data.get("cn_norm_map") or {}
    cn_norm_sorted = data.get("cn_norm_sorted") or []
    cn_norm_list = data.get("cn_norm_list") or []

    ordered_en: list[str] = []
    seen_en: set[str] = set()
    qn = len(q)

    def add_en(en_norm: str) -> None:
        if not en_norm or en_norm in seen_en:
            return
        seen_en.add(en_norm)
        ordered_en.append(en_norm)

    alias_raw = MA_CN_DANBOORU_EN_ALIASES.get(q)
    if alias_raw:
        add_en(ma_normalize_en_for_tag_match(alias_raw))

    if q in cn_norm_map:
        add_en(cn_norm_map[q])

    # 单字且已有口语别名（如「女」→1girl）：不再叠前缀「女*」，否则仍会拼进短罗马字 en 导致 Danbooru 扫到画师名
    if alias_raw and qn <= 1:
        en_norms = ordered_en[:limit]
        if not en_norms:
            return [], []
        norm_exact_map = data.get("norm_exact_map") or {}
        preset_sorted = data.get("preset_sorted_by_norm") or []
        preset_norm_list = data.get("preset_norm_list") or []
        local_matches: list[dict] = []
        seen_local: set[int] = set()
        for en_norm in en_norms:
            entry = norm_exact_map.get(en_norm)
            if entry and id(entry) not in seen_local:
                seen_local.add(id(entry))
                local_matches.append(entry)
                continue
            idx = bisect.bisect_left(preset_norm_list, en_norm)
            while idx < len(preset_sorted):
                n = preset_norm_list[idx]
                if n != en_norm:
                    break
                e = preset_sorted[idx]
                if id(e) not in seen_local:
                    seen_local.add(id(e))
                    local_matches.append(e)
                idx += 1
        return en_norms, local_matches[: len(en_norms)]

    prefix_hits: list[tuple[int, int, str, str]] = []
    if cn_norm_list:
        idx = bisect.bisect_left(cn_norm_list, q)
        while idx < len(cn_norm_sorted):
            cn_key, en_norm = cn_norm_sorted[idx]
            if not cn_key.startswith(q):
                break
            prefix_hits.append((len(cn_key), idx, cn_key, en_norm))
            idx += 1
    # 单字/双字：禁止用超长中文键参与 Danbooru 根查询，否则 en 过短（如某画师罗马字）会 *xxx* 扫到海量 artist
    if qn <= 1:
        max_cn_chars = 5
        max_prefix_rows = 18
    elif qn == 2:
        max_cn_chars = 10
        max_prefix_rows = 36
    else:
        max_cn_chars = 10**9
        max_prefix_rows = 10**9
    prefix_hits = [t for t in prefix_hits if t[0] <= max_cn_chars]
    prefix_hits.sort(key=lambda t: (t[0], t[2]))
    if max_prefix_rows < 10**9:
        prefix_hits = prefix_hits[:max_prefix_rows]
    for *_, cn_key, en_norm in prefix_hits:
        if not _ma_danbooru_chinese_query_matches_gloss(q, cn_key):
            continue
        add_en(en_norm)

    # 单字、双字：不做全表子串扫描（「女」会命中数万条释文）
    if qn >= 3 and len(ordered_en) < max(limit, 20):
        sub_hits: list[tuple[int, int, str, str]] = []
        for cn_key, en_norm in cn_norm_map.items():
            if en_norm in seen_en:
                continue
            pos = cn_key.find(q)
            if pos < 0:
                continue
            sub_hits.append((len(cn_key), pos, cn_key, en_norm))
        sub_hits.sort(key=lambda t: (t[0], t[1], t[2]))
        cap = max(limit * 3, 30)
        for _, _, cn_key, en_norm in sub_hits:
            if not _ma_danbooru_chinese_query_matches_gloss(q, cn_key):
                continue
            add_en(en_norm)
            if len(ordered_en) >= cap:
                break

    en_norms = ordered_en[:limit]
    local_matches: list[dict] = []
    seen_local: set[int] = set()
    if not en_norms:
        return [], []

    norm_exact_map = data.get("norm_exact_map") or {}
    preset_sorted = data.get("preset_sorted_by_norm") or []
    preset_norm_list = data.get("preset_norm_list") or []

    for en_norm in en_norms:
        entry = norm_exact_map.get(en_norm)
        if entry and id(entry) not in seen_local:
            seen_local.add(id(entry))
            local_matches.append(entry)
            continue
        idx = bisect.bisect_left(preset_norm_list, en_norm)
        while idx < len(preset_sorted):
            n = preset_norm_list[idx]
            if n != en_norm:
                break
            e = preset_sorted[idx]
            if id(e) not in seen_local:
                seen_local.add(id(e))
                local_matches.append(e)
            idx += 1

    return en_norms, local_matches[: len(en_norms)]


def _ma_danbooru_name_matches_for_en_root(en_norm: str) -> str:
    """把规范化英文 tag 根转成 Danbooru search[name_matches] 通配串。

    中文翻译常得到「1girl」「2girls」等；若用 *1girl* 只会命中名字里含子串 1girl 的 tag（如 2boys+1girl），
    前几名之后易出现大量低热度怪 tag，和英文输入 gir → *gir* 的体验断层。

    对「数字 + 字母段」形式改为 *字母段*（如 1girl→*girl*、2girls→*girls*），与手打英文补全的覆盖面接近。
    """
    s = (en_norm or "").strip().lower()
    if not s:
        return "**"
    m = re.match(r"^(\d+)([a-z0-9_]+)$", s)
    if m:
        rest = m.group(2).strip("_")
        if len(rest) >= 3:
            return f"*{rest}*"
    return f"*{s}*"


def _ma_danbooru_row_has_local_cn(row: dict) -> bool:
    """本地 tag预设库是否对该 tag 有中文释义（用于排序，不等同于「与搜索词语义一致」）。"""
    cn = (row.get("cn") or "").strip()
    return bool(cn and cn != "—")


def _ma_danbooru_collect_tag_json_pages(
    _requests,
    url: str,
    base_params: dict,
    max_pages: int,
    fetch_limit: int = 100,
) -> tuple[list[dict], bool]:
    """请求 page=1..max_pages 并合并结果；多页并行以缩短补全/搜索等待。any_full：曾出现满页。"""
    lim = max(1, min(100, int(fetch_limit)))
    n = max(1, int(max_pages))

    def fetch_one(p: int) -> tuple[int, list, bool]:
        params = {**base_params, "limit": lim, "page": p}
        try:
            resp = _requests.get(url, params=params, timeout=12)
            if resp.status_code != 200:
                return p, [], False
            data = resp.json()
            if not isinstance(data, list) or not data:
                return p, [], False
            full = len(data) >= lim
            return p, data, full
        except Exception:
            return p, [], False

    pages_data: dict[int, list] = {}
    any_full = False
    workers = min(8, n)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(fetch_one, p) for p in range(1, n + 1)]
        for fut in as_completed(futs):
            p, data, page_full = fut.result()
            pages_data[p] = data
            if page_full:
                any_full = True
    all_rows: list[dict] = []
    for p in range(1, n + 1):
        all_rows.extend(pages_data.get(p, []))
    return all_rows, any_full


def _ma_batch_get_danbooru_cn(en_norms: list[str]) -> dict[str, str]:
    """批量查询多个 en_norm 的中文释义，一次加载词库 dict。返回 {en_norm: cn_str}。"""
    if not en_norms:
        return {}
    cache = _ma_load_danbooru_cn_dict_sync()
    return {nk: ((cache[nk].get("cn") or "") if nk in cache else "") for nk in en_norms}


def _ma_danbooru_chinese_query_matches_gloss(q: str, cn_gloss: str) -> bool:
    """判断中文搜索词 q 是否「命中」本地释义 cn_gloss（用于过滤与译根筛选）。

    须含 q；若 q 不少于 3 字且 gloss 以 q 为前缀且更长，视为另一枚复合词（如 q=健身房 与 健身房淋浴），
    不算命中——与标签搜索「精确到词」预期一致，并避免 *gym_shower* 等根被前缀词库带出来。
    """
    q = (q or "").strip()
    s = (cn_gloss or "").strip()
    if not q or not s or q not in s:
        return False
    if s == q:
        return True
    if len(q) >= 3 and s.startswith(q) and len(s) > len(q):
        return False
    return True


def _ma_danbooru_sort_key(row: dict, query: str | None) -> tuple:
    """Danbooru 结果排序：有本地中文且（中文搜索时）释义含关键词优先，再按热度降序。

    即：有中文（释义含 q，仅中文 q）→ 有中文（不含 q）→ 无中文；各段内按 count 降序。
    解决「搜 gym 时 gym(0) 有译名却在后」「搜 健身房 全是有译名的高热度体操服」等纯按热度的问题。
    """
    has_cn = 1 if _ma_danbooru_row_has_local_cn(row) else 0
    q = (query or "").strip()
    cn_hit = 0
    if has_cn and q and any(ord(c) >= 0x4E00 for c in q):
        cn = (row.get("cn") or "").strip()
        if _ma_danbooru_chinese_query_matches_gloss(q, cn):
            cn_hit = 1
    count = int(row.get("count") or 0)
    return (-has_cn, -cn_hit, -count)


def _ma_search_danbooru_remote(q: str, page: int = 1, per_page: int = 100) -> tuple[list, bool]:
    """实际执行 Danbooru API 搜索（含本地中文翻译）。返回 (结果列表, 是否可能还有下一页)。

    支持中文搜索：检测 q 是否含中文，若是则先在本地词库翻译为英文，再分别查 Danbooru。
    本地匹配的条目会合并到结果中（按本地匹配优先、Danbooru 热度填充的顺序）。
    """
    import requests as _requests
    q = ma_strip_autocomplete_query_edges(q or "")
    if not q:
        return [], False
    page = max(1, int(page))
    per_page = max(1, min(100, int(per_page)))
    url = f"{DANBOORU_API_BASE}/tags.json"

    # ---- 中文检测：含非 ASCII 汉字/CJK 字符即认为需要翻译查询 ----
    def _is_chinese_query(text: str) -> bool:
        return bool(text and any(ord(c) >= 0x4E00 for c in text))

    # 含中文：本地词库翻译为若干英文根，再查 Danbooru（仅用少量根，避免列表被无关 *xxx* 填满）
    if _is_chinese_query(q):
        en_norms, _local_entries = _ma_translate_cn_for_danbooru(q, limit=max(per_page, 50))
        if not en_norms:
            return [], False

        # 中文查询：补全(limit<80)与编辑标签均多页抓取再统一过滤分页，避免仅 1 页时与标签搜索结果集不一致
        scan_per_root = MA_DANBOORU_CN_SCAN_PAGES_PER_ROOT_FULL
        api_roots = en_norms[: max(1, MA_CN_DANBOORU_API_FANOUT)]
        seen_match_patterns: set[str] = set()
        patterns: list[str] = []
        for en_q in api_roots:
            match_pat = _ma_danbooru_name_matches_for_en_root(en_q)
            if match_pat in seen_match_patterns:
                continue
            seen_match_patterns.add(match_pat)
            patterns.append(match_pat)

        remote_results: list[dict] = []

        def _collect_cn_pat(pat: str):
            base_params = {
                "search[name_matches]": pat,
                "search[order]": "count",
                "only": "name,post_count,category",
            }
            return _ma_danbooru_collect_tag_json_pages(
                _requests, url, base_params, scan_per_root, fetch_limit=100
            )[0]

        if patterns:
            workers = min(5, len(patterns))
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_collect_cn_pat, pat) for pat in patterns]
                for fut in as_completed(futs):
                    remote_data = fut.result()
                    for item in remote_data:
                        raw = str(item.get("name") or "").strip()
                        if not raw:
                            continue
                        en_norm = ma_normalize_en_for_tag_match(raw)
                        remote_results.append({
                            "raw": raw,
                            "en": raw.replace("_", " "),
                            "count": int(item.get("post_count") or 0),
                            "category": int(item.get("category") or 0),
                            "cn": "",
                            "_en_norm": en_norm,
                        })

        # 去重保留最高热度，再排序
        best_by_norm: dict[str, dict] = {}
        for r in remote_results:
            en_norm = r.get("_en_norm") or ma_normalize_en_for_tag_match(r["raw"])
            prev = best_by_norm.get(en_norm)
            if prev is None or r["count"] > prev["count"]:
                best_by_norm[en_norm] = r

        # 批量查中文列（一次加载词库替代逐条 _ma_get_danbooru_cn）
        all_en_norms = [r["_en_norm"] for r in best_by_norm.values() if r.get("_en_norm")]
        cn_map = _ma_batch_get_danbooru_cn(all_en_norms)
        for r in best_by_norm.values():
            r["cn"] = cn_map.get(r["_en_norm"]) or ""
            r.pop("_en_norm", None)

        merged = sorted(best_by_norm.values(), key=lambda r: _ma_danbooru_sort_key(r, q))
        # 中文搜索：释义须命中 q（含排除「更长前缀复合释义」，与译根筛选一致）
        merged = [
            r for r in merged
            if _ma_danbooru_chinese_query_matches_gloss(q, (r.get("cn") or "").strip())
        ]
        start = (page - 1) * per_page
        page_slice = merged[start : start + per_page]
        for r in page_slice:
            r.pop("_en_norm", None)
        has_more = (start + per_page) < len(merged)
        return page_slice, has_more

    # ---- 纯英文/数字查询：补全（per_page<50）只拉 1 页保证 <1s；编辑标签 per_page>=80 仍多页 ----
    scan_pages = (
        MA_DANBOORU_EN_SCAN_PAGES_FULL
        if per_page >= 80
        else MA_DANBOORU_EN_SCAN_PAGES_AUTOCOMPLETE
    )
    base_params = {
        "search[name_matches]": f"*{q}*",
        "search[order]": "count",
        "only": "name,post_count,category",
    }
    data, _ = _ma_danbooru_collect_tag_json_pages(
        _requests, url, base_params, scan_pages, fetch_limit=100
    )
    if not data:
        return [], False

    results = []
    for item in data:
        raw = str(item.get("name") or "").strip()
        if not raw:
            continue
        display = raw.replace("_", " ")
        count = int(item.get("post_count") or 0)
        category = int(item.get("category") or 0)
        en_norm = ma_normalize_en_for_tag_match(raw)
        results.append({
            "raw": raw,
            "en": display,
            "count": count,
            "category": category,
            "cn": "",  # 暂空，批量查词库
            "_en_norm": en_norm,
        })
    # 批量查中文列（一次加载词库，替代逐条 _ma_get_danbooru_cn 每次都加载）
    en_norms = [r["_en_norm"] for r in results if r.get("_en_norm")]
    cn_map = _ma_batch_get_danbooru_cn(en_norms)
    for r in results:
        r["cn"] = cn_map.get(r["_en_norm"]) or ""
        r.pop("_en_norm", None)
    # 多页并行合并后若出现同名重复，只保留热度最高的一条（与中文分支 best_by_norm 一致）
    best_en: dict[str, dict] = {}
    for r in results:
        nk = ma_normalize_en_for_tag_match(r.get("raw") or "")
        if not nk:
            continue
        prev = best_en.get(nk)
        if prev is None or int(r.get("count") or 0) > int(prev.get("count") or 0):
            best_en[nk] = r
    results = list(best_en.values())
    results.sort(key=lambda r: _ma_danbooru_sort_key(r, q))
    start = (page - 1) * per_page
    page_rows = results[start : start + per_page]
    has_more = (start + per_page) < len(results)
    return page_rows, has_more


@PromptServer.instance.routes.get("/ma/danbooru_check_connection")
async def ma_danbooru_check_connection(request):
    """检测远端 Danbooru API 是否可达。返回 {ok, message}。"""
    import requests as _requests
    url = f"{DANBOORU_API_BASE}/tags.json"
    params = {"search[name_matches]": "solo", "limit": 1}
    try:
        resp = _requests.get(url, params=params, timeout=8)
        if resp.status_code == 200:
            return web.json_response({"ok": True, "message": "连接成功"})
        return web.json_response({"ok": False, "message": f"HTTP {resp.status_code}"})
    except Exception as e:
        return web.json_response({"ok": False, "message": str(e)})


# --- 更新检测 API ---
@PromptServer.instance.routes.get("/ma/check_update")
async def check_update(request):
    """
    检查更新：从 GitHub 获取最新版本号和 README 内容
    支持测试模式：添加 ?test=true 参数可以返回模拟的更新数据
    """
    try:
        # 检查是否为测试模式
        test_mode = request.query.get('test', '').lower() == 'true'
        
        if test_mode:
            # 测试模式：返回模拟的更新数据
            current_version = "1.3.8"
            # 模拟一个更新的版本
            latest_version = "1.3.7"
            has_update = True
            
            # 读取本地 README 文件作为测试数据
            readme_path = os.path.join(BASE_DIR, "README.md")
            readme_text = ""
            if os.path.exists(readme_path):
                try:
                    with open(readme_path, 'r', encoding='utf-8') as f:
                        readme_text = f.read()
                except:
                    pass
            
            # 从 README 中提取更新信息
            update_info = ""
            if readme_text:
                version_section_match = re.search(r'##\s*[📝版本更新介绍|Version Update Introduction].*?(?=##|$)', readme_text, re.DOTALL | re.IGNORECASE)
                if version_section_match:
                    update_info = version_section_match.group(0)
                else:
                    update_match = re.search(r'V?\d+\.\d+\.\d+.*?(?=V?\d+\.\d+\.\d+|$)', readme_text, re.DOTALL)
                    if update_match:
                        update_info = update_match.group(0)
            
            return web.json_response({
                "current_version": current_version,
                "latest_version": latest_version,
                "has_update": has_update,
                "update_info": update_info,
                "test_mode": True  # 标记这是测试模式
            })
        
        # 正常模式：从 GitHub 获取
        current_version = "1.3.8"  # Current version / 当前版本号
        repo_url = "https://api.github.com/repos/shigjfg/ComfyUI-Magic-Assistant"
        
        async with aiohttp.ClientSession() as session:
            # 获取最新 release 版本
            async with session.get(f"{repo_url}/releases/latest") as resp:
                if resp.status == 200:
                    release_data = await resp.json()
                    latest_version = release_data.get("tag_name", "").lstrip("vV")
                    latest_version = latest_version or release_data.get("name", "").lstrip("vV")
                else:
                    # 如果没有 release，尝试从 tags 获取
                    async with session.get(f"{repo_url}/tags") as tags_resp:
                        if tags_resp.status == 200:
                            tags_data = await tags_resp.json()
                            if tags_data and len(tags_data) > 0:
                                latest_version = tags_data[0].get("name", "").lstrip("vV")
                            else:
                                latest_version = None
                        else:
                            latest_version = None
            
            # 获取 README 内容
            async with session.get(f"{repo_url}/readme") as readme_resp:
                if readme_resp.status == 200:
                    readme_data = await readme_resp.json()
                    readme_content = readme_data.get("content", "")
                    # Base64 解码
                    readme_text = base64.b64decode(readme_content).decode('utf-8')
                else:
                    readme_text = ""
        
        # 解析版本号比较
        def version_compare(v1, v2):
            """比较版本号，返回 True 如果 v1 < v2"""
            if not v1 or not v2:
                return False
            try:
                v1_parts = [int(x) for x in v1.split('.')]
                v2_parts = [int(x) for x in v2.split('.')]
                max_len = max(len(v1_parts), len(v2_parts))
                v1_parts += [0] * (max_len - len(v1_parts))
                v2_parts += [0] * (max_len - len(v2_parts))
                for i in range(max_len):
                    if v1_parts[i] < v2_parts[i]:
                        return True
                    elif v1_parts[i] > v2_parts[i]:
                        return False
                return False
            except:
                return False
        
        has_update = latest_version and version_compare(current_version, latest_version)
        
        # 从 README 中提取更新信息
        update_info = ""
        if readme_text and has_update:
            # 查找版本更新介绍部分
            version_section_match = re.search(r'##\s*[📝版本更新介绍|Version Update Introduction].*?(?=##|$)', readme_text, re.DOTALL | re.IGNORECASE)
            if version_section_match:
                update_info = version_section_match.group(0)
            else:
                # 如果没有找到，尝试查找最近的更新内容
                update_match = re.search(r'V?\d+\.\d+\.\d+.*?(?=V?\d+\.\d+\.\d+|$)', readme_text, re.DOTALL)
                if update_match:
                    update_info = update_match.group(0)
        
        return web.json_response({
            "current_version": current_version,
            "latest_version": latest_version,
            "has_update": has_update,
            "update_info": update_info
        })
    except Exception as e:
        return web.json_response({
            "current_version": "1.3.7",
            "latest_version": None,
            "has_update": False,
            "update_info": "",
            "error": str(e)
        })
