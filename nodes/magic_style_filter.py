# -*- coding: utf-8 -*-
"""风格词过滤：规则秒判 + 微型本地 LLM 只处理模糊段，节点内常驻加载。"""

import gc
import logging
import os
import re
import threading
import time

DEFAULT_MODEL = r"E:\ComfyUI-aki-v1.3\models\LLM\Qwen3.5-4B\Qwen3.5-4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"

_SYS = ("You classify numbered parts of an image prompt. STYLE = art medium, lighting, color grading, "
        "film/photo look, quality words, mood, genre. CONTENT = subject, people, objects, action, place, "
        "clothing, camera framing, text to render. Reply ONLY with the numbers of STYLE parts.")

# 只保留"几乎不可能是内容"的风格词，避免误伤 light / composition 这类双义词
_STYLE_TERMS = [
    "cinematic", "film still", "film grain", "film look", "aesthetic", "color grading", "colour grading",
    "editorial", "masterpiece", "best quality", "high quality", "ultra detailed", "highly detailed",
    "8k", "4k", "hdr", "sharp focus", "rich atmosphere", "volumetric light", "rim light", "bokeh",
    "shallow depth of field", "photorealistic", "photorealism", "3d render", "cgi", "octane render",
    "unreal engine", "artstation", "oil painting", "watercolor", "ink wash", "pixel art", "low poly",
    "movie still", "cinematic lighting", "soft lighting", "dramatic lighting", "studio lighting",
    "golden hour", "moody", "melancholic", "ethereal", "dreamy", "atmospheric", "editorial composition",
    "电影感", "胶片", "柔光", "逆光", "氛围感", "高级感", "水彩", "油画", "动漫", "插画", "厚涂",
    "赛博朋克", "水墨", "质感", "光影", "色调", "颗粒", "写实", "超写实", "大师作品", "高质量",
]

_LEAD_WORDS = (
    "cinematic|moody|melancholic|ethereal|dreamy|photorealistic|realistic|stylized|"
    "atmospheric|editorial|dramatic|soft|cinematic-quality|hyperrealistic|surreal|"
    "电影感|胶片感|氛围感|高级感"
)
_LEAD_STYLE = re.compile(
    r"^(?:a |an |the )?(?:(?:" + _LEAD_WORDS + r")\s*[,，]?\s*)+",
    re.I,
)

# 出现这些词说明句子在描述画面里"有什么/在干什么"，整句必须保留
_CONTENT_HINTS = re.compile(
    r"\b(?:1girl|1boy|2girls|2boys|3girls|solo|no humans|multiple girls|"
    r"room|street|window|wall|floor|table|chair|bed|door|sky|city|forest|beach|"
    r"frames?|framing|angle|camera|shot of|close-up|portrait|wearing|dressed|sitting|"
    r"standing|holding|looking|walking|lying|hair|eyes|face|skin|ears|hands|dress|shirt|"
    r"jacket|smoke|cigarette|glow of|expression|her|his|she|he|they|woman|man|girl|boy|"
    r"cat|dog|背景|房间|街道|头发|眼睛|表情|穿着|坐在|站在)\b",
    re.I,
)

_MODEL_LOCK = threading.Lock()
_MODEL = None
_MODEL_KEY = None
_GRAMMAR = None
_CACHE = {}


def _get_grammar():
    global _GRAMMAR
    if _GRAMMAR is None:
        from llama_cpp import LlamaGrammar
        _GRAMMAR = LlamaGrammar.from_string(
            'root ::= "none" | num ("," num)*\nnum ::= [1-9] [0-9]*\n', verbose=False)
    return _GRAMMAR


def _get_llm(model_path, n_gpu_layers):
    global _MODEL, _MODEL_KEY
    key = (str(model_path), int(n_gpu_layers))
    if _MODEL is not None and _MODEL_KEY == key:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None and _MODEL_KEY == key:
            return _MODEL
        if _MODEL is not None:
            _MODEL = None
            _MODEL_KEY = None
            gc.collect()
        if not model_path or not os.path.isfile(model_path):
            raise FileNotFoundError(f"本地模型不存在: {model_path}")
        from llama_cpp import Llama
        t0 = time.perf_counter()
        _MODEL = Llama(model_path=model_path, n_ctx=768, n_batch=512,
                       n_gpu_layers=int(n_gpu_layers), verbose=False)
        _MODEL_KEY = key
        logging.info("[Magic Assistant] 风格过滤模型已加载 %.2fs", time.perf_counter() - t0)
    return _MODEL


def release_llm():
    global _MODEL, _MODEL_KEY
    with _MODEL_LOCK:
        _MODEL = None
        _MODEL_KEY = None
    gc.collect()


def _norm(s):
    return re.sub(r"\s+", " ", str(s).strip().lower()).strip(" ,，.。;；")


def _style_ratio(seg):
    words = [w for w in re.findall(r"[a-zA-Z0-9\-]+|[\u4e00-\u9fff]{2,}", seg.lower()) if len(w) > 1]
    if not words:
        return 0.0
    hit = sum(1 for w in words if any(t in w or w in t for t in _STYLE_TERMS))
    return hit / len(words)


_STYLE_PREFIX = (
    "the image ", "the overall ", "the mood", "the atmosphere", "the palette",
    "the color palette", "the colour palette", "lighting is", "the lighting", "the style",
    "the aesthetic", "no watermarks", "creating ", "high aesthetic", "clean color",
    "sharp architectural", "editorial ", "rich atmosphere", "film still", "soft cinematic",
)


_SENT_DELIM = re.compile(r"([.!?。！？]\s*|\n+)")
_TAG_DELIM = re.compile(r"([,;，；]\s*)")


def _split_parts(text):
    """返回 [(片段, 原文分隔符)]，保留原始标点与空格，避免把散文切成碎词。"""
    prose = bool(re.search(r"[.!?。！？]\s+\S", text))
    units = []
    if prose:
        p = _SENT_DELIM.split(text)
        for i in range(0, len(p), 2):
            s = p[i].strip()
            if s:
                units.append((s, p[i + 1] if i + 1 < len(p) else ""))
    else:
        units = [(text.strip(), "")]

    out = []
    for s, tail in units:
        sub = _TAG_DELIM.split(s)
        commas = len(sub) // 2
        # 只有"逗号堆叠的风格标签串"才按逗号拆；带内容描述的长句整句判断
        taglike = (not prose) or (
            commas >= 2 and len(s.split()) / (commas + 1) <= 4 and not _CONTENT_HINTS.search(s))
        if not taglike or not commas:
            out.append((s, tail))
            continue
        for j in range(0, len(sub), 2):
            t = sub[j].strip()
            if not t:
                continue
            out.append((t, sub[j + 1] if j + 1 < len(sub) else tail))
    return out


def _route(seg):
    low = seg.lower().strip()
    n = len(low.split())
    ratio = _style_ratio(seg)
    if any(low.startswith(p) for p in _STYLE_PREFIX):
        return "style"
    if _CONTENT_HINTS.search(seg) and ratio < 0.6:
        return "content"
    if _LEAD_STYLE.match(seg) and n <= 6:
        return "style"
    if n <= 8 and ratio >= 0.5:
        return "style"
    if n >= 9 and ratio <= 0.30:
        return "content"
    if "_" in seg or "＿" in seg:
        return "content"
    return "gray"


def _ask_llm(llm, segs):
    items = "\n".join(f"{i}.{s}" for i, s in enumerate(segs, 1))
    res = llm.create_chat_completion(
        messages=[{"role": "system", "content": _SYS},
                  {"role": "user", "content": items}],
        max_tokens=max(8, min(32, len(segs) * 3)),
        temperature=0.0,
        grammar=_get_grammar(),
    )
    txt = (res["choices"][0]["message"]["content"] or "").strip()
    if not txt or txt.lower().startswith("none"):
        return set()
    return {int(x) for x in re.findall(r"\d+", txt) if 1 <= int(x) <= len(segs)}


class MALLMStyleFilter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "", "forceInput": False,
                                    "tooltip": "完整提示词；输出只保留内容描述。"}),
                "clip": ("CLIP", {"tooltip": "用过滤后的文本直接编码成 conditioning。"}),
            },
            "optional": {
                "触发词": ("STRING", {"forceInput": True,
                                      "tooltip": "LoRA 触发词，原样保留不参与过滤；接强力LoRA加载器的 tags_output 输出。"}),
                "model_path": ("STRING", {"default": DEFAULT_MODEL}),
                "n_gpu_layers": ("INT", {"default": -1, "min": -1, "max": 128, "step": 1,
                                         "tooltip": "-1=全部放 GPU；显存紧张时改 0 用 CPU。"}),
                "max_llm_parts": ("INT", {"default": 10, "min": 0, "max": 64, "step": 1,
                                          "tooltip": "最多送多少段给 LLM 判断；0=只用规则。"}),
                "unload_after": ("BOOLEAN", {"default": False,
                                             "tooltip": "跑完释放模型，省显存但下次要重载。"}),
            },
        }

    RETURN_TYPES = ("STRING", "CONDITIONING")
    RETURN_NAMES = ("内容提示词", "positive")
    OUTPUT_TOOLTIPS = ("过滤后的提示词，可接预览核对。", "过滤后文本编码的 conditioning，接采样器 positive。")
    FUNCTION = "run"
    CATEGORY = "✨ Magic Assistant"
    DESCRIPTION = "规则秒判 + 微型本地 LLM 只判模糊段，剥离风格词让 LoRA 风格接管。"

    def run(self, text, clip, model_path=DEFAULT_MODEL, n_gpu_layers=-1,
            max_llm_parts=10, unload_after=False, **kwargs):
        text = (text or "").strip()
        trig = str(kwargs.get("触发词") or "").strip()
        if not text:
            return (trig, clip.encode_from_tokens_scheduled(clip.tokenize(trig)))

        key = (text, trig, model_path, int(n_gpu_layers), int(max_llm_parts))
        if key in _CACHE:
            filtered = _CACHE[key]
            logging.info("[Magic Assistant] 风格过滤: cache hit")
            return (filtered, clip.encode_from_tokens_scheduled(clip.tokenize(filtered)))

        t0 = time.perf_counter()
        parts = _split_parts(text)
        if trig:
            trig_pieces = {_norm(p) for p in re.split(r"[,，;；\n]", trig) if p.strip()}
            trig_low = trig.lower()
            body = []
            for seg, delim in parts:
                ns = _norm(seg)
                if ns in trig_pieces or (ns and ns in trig_low):
                    continue
                body.append((seg, delim))
            parts = body
        segs = [p[0] for p in parts]
        delims = [p[1] for p in parts]
        if segs:
            lead = _LEAD_STYLE.sub("", segs[0]).strip(" ,，")
            if lead and len(lead.split()) >= 2:
                segs[0] = lead
        routes = [_route(s) for s in segs]
        keep = [r != "style" for r in routes]

        gray_idx = [i for i, r in enumerate(routes) if r == "gray"]
        used_llm = False
        if gray_idx and max_llm_parts > 0:
            batch = gray_idx[:int(max_llm_parts)]
            try:
                llm = _get_llm(model_path, n_gpu_layers)
                bad = _ask_llm(llm, [segs[i] for i in batch])
                for j, i in enumerate(batch, 1):
                    if j in bad:
                        keep[i] = False
                used_llm = True
            except Exception as e:
                logging.warning("[Magic Assistant] 风格过滤 LLM 失败，仅用规则: %s", e)

        kept_idx = [i for i in range(len(segs)) if keep[i]]
        while kept_idx:
            first = kept_idx[0]
            lead = _LEAD_STYLE.sub("", segs[first]).strip(" ,，")
            if not lead:
                kept_idx.pop(0)
                continue
            if lead != segs[first] and len(lead.split()) >= 2:
                segs[first] = lead
            break

        filtered = "".join(segs[i] + delims[i] for i in kept_idx).strip()
        filtered = filtered.rstrip(",;，； \t")
        if filtered and text.rstrip().endswith(".") and not filtered.endswith("."):
            filtered += "."
        filtered = re.sub(r"\s*,\s*", ", ", filtered)
        filtered = re.sub(r"(?:, )+\.", ".", filtered).strip(" ,")
        n_kept = len(kept_idx)
        if trig:
            filtered = trig.rstrip(" ,，") + (", " + filtered if filtered else "")
        _CACHE[key] = filtered
        if len(_CACHE) > 64:
            _CACHE.pop(next(iter(_CACHE)))

        if unload_after:
            release_llm()

        logging.info(
            "[Magic Assistant] 风格过滤: %s 删 %d/%d 段 %.0fms -> %r",
            "规则+LLM" if used_llm else "规则", len(segs) - n_kept, len(segs),
            (time.perf_counter() - t0) * 1000, filtered[:90],
        )
        return (filtered, clip.encode_from_tokens_scheduled(clip.tokenize(filtered)))
