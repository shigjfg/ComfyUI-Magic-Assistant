import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import "./magic_ui_shared.js";

const NODE_NAME = "MagicPowerLoraLoader";

// ---------------------------------------------------------------------------
// Debug switch (frontend)
// ---------------------------------------------------------------------------
// 用途：在浏览器端打印诊断日志，排查「旧工作流污染」「隐藏 widget 注入」「模式字段错位」等问题。
//
// 开启方式（任选其一）：
// 1) 浏览器控制台执行并刷新页面：
//    localStorage.setItem('MAGIC_ASSISTANT_DEBUG', '1'); location.reload();
// 2) URL 参数（临时）：在 ComfyUI 页面地址后追加：
//    ?MAGIC_ASSISTANT_DEBUG=1
// 3) 代码临时开启：在控制台执行：
//    window.MAGIC_ASSISTANT_DEBUG = true
//
// 关闭方式：
//    localStorage.removeItem('MAGIC_ASSISTANT_DEBUG'); location.reload();
//
// 注意：开启后会打印较多日志，建议仅在排障期间启用。
const MPL_DEBUG_KEY = "MAGIC_ASSISTANT_DEBUG";
function mplIsDebugEnabled() {
    try {
        if (window.MAGIC_ASSISTANT_DEBUG === true) return true;
        const qs = new URLSearchParams(window.location.search || "");
        const qv = (qs.get(MPL_DEBUG_KEY) || "").trim().toLowerCase();
        if (["1", "true", "yes", "y", "on"].includes(qv)) return true;
        const lv = (localStorage.getItem(MPL_DEBUG_KEY) || "").trim().toLowerCase();
        return ["1", "true", "yes", "y", "on"].includes(lv);
    } catch (e) {
        return false;
    }
}
function mplDebugLog(...args) {
    if (mplIsDebugEnabled()) console.log("[MagicAssistant DEBUG]", ...args);
}

// 全局LoRA图片缓存（类似参考代码的loraImages）
let loraImagesCache = {};
let loraNamesCache = null;
let loraNamesOptionsCache = [];
let loraNamesLoadPromise = null;

// 统一的线性 SVG 图标库（stroke=currentColor，跟随文字色，风格统一）
const MPL_ICONS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    download: '<path d="M12 3v12"/><polyline points="6 11 12 17 18 11"/><line x1="4" y1="21" x2="20" y2="21"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    folderPlus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    sort: '<polyline points="7 4 7 20"/><polyline points="3 8 7 4 11 8"/><polyline points="17 20 17 4"/><polyline points="21 16 17 20 13 16"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeCute: '<ellipse cx="12" cy="12" rx="9" ry="6.2"/><circle cx="12" cy="12" r="2.8"/>',
    eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'
};
function mplIcon(name, size) {
    const body = MPL_ICONS[name];
    if (!body) return "";
    const s = size || 16;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto;">${body}</svg>`;
}

// 颜色来源模式：跟随全局（global）/ 独立固定（custom）。切换只改 UI，确定时写入对象持久化
function mplColorModeSwitch(parent, initial, onChange) {
    let mode = initial === "custom" ? "custom" : "global";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:10px;";
    const lab = document.createElement("span");
    lab.textContent = "颜色来源";
    lab.style.cssText = "font-size:12px;color:#a1a1aa;min-width:100px;";
    row.appendChild(lab);
    const mk = (key, text, tip) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.title = tip;
        b.style.cssText = "padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.12);transition:all 0.14s ease;";
        b.onclick = () => {
            if (mode === key) return;
            mode = key; paint(); onChange(mode);
        };
        row.appendChild(b);
        return b;
    };
    const bGlobal = mk("global", "跟随全局", "改动全局默认颜色时，本条会一起变化");
    const bCustom = mk("custom", "独立固定", "本条使用自己的颜色，不受全局改动影响");
    function paint() {
        const follow = mode === "global";
        bGlobal.style.background = follow ? "#6366f1" : "#18181c";
        bGlobal.style.color = follow ? "#fff" : "#a1a1aa";
        bGlobal.style.borderColor = follow ? "#6366f1" : "rgba(255,255,255,0.12)";
        bCustom.style.background = follow ? "#18181c" : "#6366f1";
        bCustom.style.color = follow ? "#a1a1aa" : "#fff";
        bCustom.style.borderColor = follow ? "rgba(255,255,255,0.12)" : "#6366f1";
    }
    paint();
    parent.appendChild(row);
    return { getMode: () => mode };
}

function mplNormalizeLoraName(name) {
    return String(name || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function mplClampWeight(v) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 1.0;
    return Math.max(-10, Math.min(10, parseFloat(n.toFixed(2))));
}
function mplLoraWeight(l) {
    const n = parseFloat(l?.weight);
    return Number.isFinite(n) ? n : 1.0;
}
function mplClipFollowsWeight(l) {
    if (!l || typeof l !== "object") return true;
    if (l.clipFollow === false) return false;
    if (l.clipFollow === true) return true;
    return l.clipWeight === undefined || l.clipWeight === null;
}
function mplClipWeightValue(l) {
    if (mplClipFollowsWeight(l)) return mplLoraWeight(l);
    const n = parseFloat(l?.clipWeight);
    return Number.isFinite(n) ? n : mplLoraWeight(l);
}
function mplSyncClipWeight(l) {
    if (!l || typeof l !== "object") return;
    if (mplClipFollowsWeight(l)) {
        l.clipFollow = true;
        l.clipWeight = mplLoraWeight(l);
    } else {
        l.clipWeight = mplClampWeight(l.clipWeight);
    }
}
function mplSetCustomClipWeight(l, v) {
    if (!l || typeof l !== "object") return false;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return false;
    l.clipFollow = false;
    l.clipWeight = mplClampWeight(n);
    return true;
}
function mplToggleClipFollow(l) {
    if (!l || typeof l !== "object") return true;
    const follow = !mplClipFollowsWeight(l);
    l.clipFollow = follow;
    if (follow) mplSyncClipWeight(l);
    else if (l.clipWeight === undefined || l.clipWeight === null) l.clipWeight = mplLoraWeight(l);
    return follow;
}
function mplParseCssColor(value) {
    const m = String(value || "").trim().match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return null;
    const p = m[1].split(",").map(v => parseFloat(v.trim()));
    if (p.length < 3 || p.slice(0, 3).some(v => !Number.isFinite(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function mplFolderDropColors(el) {
    for (let node = el; node; node = node.parentElement) {
        const c = mplParseCssColor(getComputedStyle(node).backgroundColor);
        if (!c || c.a < 0.35) continue;
        const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        return lum > 0.55
            ? { color: "#0b57d0", glow: "rgba(11,87,208,0.45)" }
            : { color: "#ffd166", glow: "rgba(255,209,102,0.48)" };
    }
    return { color: "#ffd166", glow: "rgba(255,209,102,0.48)" };
}
function mplUpdateClipBadgeUI(el, l) {
    if (!el || !l) return;
    mplSyncClipWeight(l);
    const follow = mplClipFollowsWeight(l);
    const val = mplClipWeightValue(l);
    el.textContent = "C " + val.toFixed(2);
    el.classList.toggle("mpl-clip-custom", !follow);
    el.title = follow
        ? `CLIP 权重：${val.toFixed(2)}（跟随模型权重）\n左键输入自定义值 · 右键切换自定义/跟随`
        : `CLIP 权重：${val.toFixed(2)}（自定义）\n左键修改 · 右键恢复跟随模型权重`;
}

// ===== LORA 串解析：兼容 <lora:名称:模型权重:CLIP权重> 格式 + 智能近似匹配 =====
const MPL_LORA_MATCH_CACHE = new WeakMap();
const MPL_LORA_FAMILY_PREFIX = /^(?:krea[\s._-]*2|k2|anima|sdxl|xl|pony|illustrious|noob(?:ai)?)(?:[\s._-]+|(?=[A-Z]))/i;
function mplStripLoraFamilyPrefix(value) {
    let s = String(value || "");
    for (let i = 0; i < 2; i++) {
        const next = s.replace(MPL_LORA_FAMILY_PREFIX, "");
        if (next === s) break;
        s = next;
    }
    return s;
}
function mplLoraNameVariants(value) {
    const base = String(value || "").replace(/\\/g, "/").split("/").pop()
        .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "").trim();
    const trim = (s) => s.replace(/^[\s._-]+|[\s._-]+$/g, "");
    const clean = trim(base);
    const noPrefix = trim(mplStripLoraFamilyPrefix(clean));
    return [...new Set([clean, noPrefix].filter(Boolean))];
}
function mplLoraCompactVariants(value) {
    const variants = mplLoraNameVariants(value)
        .map(s => s.toLowerCase().replace(/[\s._-]+/g, ""))
        .filter(Boolean);
    const confusable = variants.map(s => s.replace(/[1il]/g, "1").replace(/[0o]/g, "0"));
    return [...new Set([...variants, ...confusable])];
}
function mplBigramProfile(text) {
    const map = new Map();
    for (let i = 0; i < text.length - 1; i++) {
        const g = text.slice(i, i + 2);
        map.set(g, (map.get(g) || 0) + 1);
    }
    return { text, map, total: Math.max(0, text.length - 1) };
}
function mplBigramScore(a, b) {
    if (!a || !b || !a.total || !b.total) return a?.text === b?.text ? 1 : 0;
    if (a.text === b.text) return 1;
    const [small, large] = a.map.size <= b.map.size ? [a, b] : [b, a];
    let overlap = 0;
    for (const [g, count] of small.map) {
        const other = large.map.get(g);
        if (other) overlap += Math.min(count, other);
    }
    return (2 * overlap) / (a.total + b.total);
}
function mplLoraFuzzyEntries(list) {
    const cached = MPL_LORA_MATCH_CACHE.get(list);
    if (cached && cached.length === list.length) return cached.entries;
    const entries = list.map(name => ({
        name,
        profiles: mplLoraCompactVariants(name).map(mplBigramProfile),
    }));
    MPL_LORA_MATCH_CACHE.set(list, { length: list.length, entries });
    return entries;
}
function mplResolveLoraFileName(raw, options) {
    const wanted = String(raw || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!wanted) return { name: "", found: false };
    const list = Array.isArray(options) ? options : (Array.isArray(loraNamesOptionsCache) ? loraNamesOptionsCache : []);
    if (list.length) {
        const norm = (s) => String(s || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
        const stripExt = (s) => s.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "");
        const wNorm = norm(wanted);
        const wNoExt = stripExt(wNorm);
        const exact = list.find(f => norm(f) === wNorm || stripExt(norm(f)) === wNoExt);
        if (exact) return { name: exact, found: true };
        const base = wNoExt.split("/").pop();
        const byBase = list.find(f => stripExt(norm(f).split("/").pop()) === base);
        if (byBase) return { name: byBase, found: true };
        const bySuffix = list.find(f => norm(f).endsWith("/" + base));
        if (bySuffix) return { name: bySuffix, found: true };

        const targetProfiles = mplLoraCompactVariants(wanted).map(mplBigramProfile);
        let best = null, bestScore = 0;
        const candidates = [];
        for (const entry of mplLoraFuzzyEntries(list)) {
            let score = 0;
            for (const a of targetProfiles) {
                for (const b of entry.profiles) score = Math.max(score, mplBigramScore(a, b));
            }
            if (score >= 0.80) candidates.push({ name: entry.name, score });
            if (score > bestScore) {
                bestScore = score;
                best = entry.name;
            }
        }
        if (best && bestScore >= 0.83) {
            const top = candidates
                .filter(c => c.score >= Math.max(0.80, bestScore - 0.08))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
            return { name: best, found: true, fuzzy: true, candidates: top };
        }
    }
    return { name: wanted, found: false };
}

function mplChooseLoraMatches(matches) {
    return new Promise((resolve) => {
        document.querySelectorAll(".mpl-lora-match-overlay").forEach(el => el.remove());

        const overlay = document.createElement("div");
        overlay.className = "ma-modal-backdrop mpl-lora-match-overlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:10070;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;";
        const box = document.createElement("div");
        box.className = "ma-modal ma-modal-static-anim";
        box.style.cssText = "box-sizing:border-box;width:min(640px,94vw);max-height:82vh;display:flex;flex-direction:column;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.78);color:#f4f4f5;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;padding:18px 20px 16px;";
        const head = document.createElement("div");
        head.textContent = "LoRA 近似匹配";
        head.style.cssText = "font-size:15px;font-weight:650;color:#f4f4f5;margin-bottom:6px;";
        const msg = document.createElement("div");
        msg.textContent = "以下名称没有精确匹配。请确认推荐项，或改选其它本地文件；选择“保持原名称”则按原样加入。";
        msg.style.cssText = "font-size:12px;color:#a1a1aa;margin-bottom:12px;";
        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px;";
        const selects = [];
        matches.forEach((entry) => {
            const row = document.createElement("div");
            row.style.cssText = "padding:10px 12px;background:#18181c;border:1px solid rgba(255,255,255,0.08);border-radius:9px;";
            const raw = document.createElement("div");
            raw.textContent = "原始名称：" + entry._rawName;
            raw.title = entry._rawName;
            raw.style.cssText = "font:11.5px Consolas,monospace;color:#fbbf24;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px;";
            const sel = document.createElement("select");
            sel.className = "ma-select";
            sel.style.cssText = "box-sizing:border-box;width:100%;background:#09090b;border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:#f4f4f5;padding:6px 8px;font-size:12px;";
            const keep = document.createElement("option");
            keep.value = "";
            keep.textContent = "保持原名称（不匹配）";
            sel.appendChild(keep);
            (entry._matchCandidates || []).forEach((candidate) => {
                const opt = document.createElement("option");
                opt.value = candidate.name;
                opt.textContent = `${candidate.name}  （相似度 ${Math.round(candidate.score * 100)}%）`;
                sel.appendChild(opt);
            });
            if (entry._matchCandidates?.length) sel.value = entry._matchCandidates[0].name;
            row.append(raw, sel);
            list.appendChild(row);
            selects.push({ entry, sel });
        });

        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "ma-btn";
        cancel.textContent = "取消";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "ma-btn ma-btn-primary";
        ok.textContent = "使用所选匹配";
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
            else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); ok.click(); }
        };
        cancel.onclick = () => finish(false);
        ok.onclick = () => {
            selects.forEach(({ entry, sel }) => {
                const chosen = sel.value;
                entry._fuzzy = false;
                entry._matchCandidates = [];
                if (chosen) {
                    entry.name = chosen;
                    entry._found = true;
                } else {
                    entry.name = entry._rawName;
                    entry._found = false;
                }
            });
            finish(true);
        };
        row.appendChild(cancel);
        row.appendChild(ok);
        box.append(head, msg, list, row);
        ["pointerdown", "mousedown", "click", "dblclick", "wheel"].forEach(ev => {
            overlay.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === "wheel" });
        });
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey, true);
        setTimeout(() => { try { selects[0]?.sel.focus(); } catch (e) {} }, 20);
    });
}

function mplParseLoraString(text, options) {
    const src = String(text || "");
    const out = [];
    const pushEntry = (rawName, rawW, rawClip) => {
        const clean = String(rawName || "").trim();
        if (!clean) return;
        const resolved = mplResolveLoraFileName(clean, options);
        const w = rawW !== undefined && rawW !== "" && Number.isFinite(parseFloat(rawW)) ? mplClampWeight(rawW) : 1.0;
        const hasClip = rawClip !== undefined && rawClip !== "" && Number.isFinite(parseFloat(rawClip));
        const cw = hasClip ? mplClampWeight(rawClip) : w;
        const follow = !hasClip || Math.abs(cw - w) < 1e-6;
        out.push({
            name: resolved.name || clean,
            weight: w,
            clipWeight: cw,
            clipFollow: follow,
            enabled: true,
            tags: "",
            note: "",
            triggerWords: "",
            _found: resolved.found,
            _rawName: clean,
            _fuzzy: !!resolved.fuzzy,
            _matchCandidates: resolved.candidates || [],
        });
    };
    const re = /<lora:([^:>]+)(?::([^:>]+))?(?::([^:>]+))?>/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        pushEntry(m[1], m[2], m[3]);
    }
    if (!out.length) {
        src.split(/[\r\n]+/).forEach(line => {
            const t = line.trim();
            if (!t) return;
            const parts = t.split(/[:\t]+/).map(s => s.trim());
            if (parts[0]) pushEntry(parts[0], parts[1], parts[2]);
        });
    }
    return out;
}

// 唯一的「是否启用」判定：只有显式 false / 0 / "false" 等才算停用，缺省一律启用。
function mplLoraEnabled(item) {
    if (!item) return false;
    const v = item.enabled;
    if (v === undefined || v === null) return true;
    if (typeof v === "string") return !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase());
    return v !== false && v !== 0;
}

let MPL_LAST_REPAIRS = 0;
function mplNormalizeLoraData(data) {
    MPL_LAST_REPAIRS = 0;
    if (!data || typeof data !== "object") return data;
    const fix = (l) => {
        if (!l || typeof l !== "object") return;
        if (typeof l.enabled !== "boolean") MPL_LAST_REPAIRS++;
        l.enabled = mplLoraEnabled(l);
        if (l.note === undefined) l.note = "";
        if (l.triggerWords === undefined) l.triggerWords = "";
    };
    (Array.isArray(data.loras) ? data.loras : []).forEach(fix);
    (Array.isArray(data.folders) ? data.folders : []).forEach(f => {
        if (!f) return;
        if (!Array.isArray(f.loras)) f.loras = [];
        f.loras.forEach(fix);
    });
    return data;
}

// 预览图按需刷新：爬取到新图后给这张卡片/行加时间戳，绕过浏览器缓存
const MPL_IMG_BUST = new Map();
function mplBumpImage(name) {
    if (name) MPL_IMG_BUST.set(String(name), Date.now());
}
function mplBustSuffix(name) {
    const t = MPL_IMG_BUST.get(String(name || ""));
    return t ? "&t=" + t : "";
}

// 预设分类 + 收藏夹的全局数据（所有节点共享同一份，界面在「📂预设」弹窗里）
const MPL_SIDEBAR = {
    loaded: false,
    loading: null,
    presets: {},
    categories: [],
    assignments: {},
    preset_order: [],
    favorites: [],
};

// 打开中的「📂预设」弹窗刷新回调（节点内不再有侧栏，改为弹窗自刷新）
const MPL_PRESET_MODAL_REFRESHERS = new Set();

async function mplLoadSidebar(force) {
    if (!force && MPL_SIDEBAR.loaded) return MPL_SIDEBAR;
    if (MPL_SIDEBAR.loading) return MPL_SIDEBAR.loading;
    MPL_SIDEBAR.loading = (async () => {
        try {
            const [pRes, mRes, fRes] = await Promise.all([
                api.fetchApi("/ma/lora/get_presets").then(r => r.json()).catch(() => ({})),
                api.fetchApi("/ma/lora/preset_meta").then(r => r.json()).catch(() => ({})),
                api.fetchApi("/ma/lora/favorites").then(r => r.json()).catch(() => ({})),
            ]);
            MPL_SIDEBAR.presets = (pRes && pRes.presets) || {};
            MPL_SIDEBAR.categories = Array.isArray(mRes && mRes.categories) ? mRes.categories : [];
            MPL_SIDEBAR.assignments = (mRes && mRes.assignments) || {};
            MPL_SIDEBAR.preset_order = Array.isArray(mRes && mRes.preset_order) ? mRes.preset_order : [];
            MPL_SIDEBAR.favorites = Array.isArray(fRes && fRes.collections) ? fRes.collections : [];
            MPL_SIDEBAR.loaded = true;
        } catch (e) {
            console.warn("[MagicPowerLora] 侧栏数据加载失败:", e);
        } finally {
            MPL_SIDEBAR.loading = null;
        }
        return MPL_SIDEBAR;
    })();
    return MPL_SIDEBAR.loading;
}
async function mplSavePresetMeta() {
    try {
        await api.fetchApi("/ma/lora/preset_meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                categories: MPL_SIDEBAR.categories,
                assignments: MPL_SIDEBAR.assignments,
                preset_order: MPL_SIDEBAR.preset_order,
            }),
        });
    } catch (e) { console.warn("[MagicPowerLora] 保存预设分类失败:", e); }
}
async function mplSaveFavorites() {
    try {
        await api.fetchApi("/ma/lora/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collections: MPL_SIDEBAR.favorites }),
        });
    } catch (e) { console.warn("[MagicPowerLora] 保存收藏夹失败:", e); }
}
function mplRefreshAllSidebars() {
    MPL_PRESET_MODAL_REFRESHERS.forEach(fn => {
        try { fn(); } catch (e) {}
    });
}

// ===================== 页面内弹窗（替代 window.prompt / confirm / alert） =====================
// 兼容 ComfyUI 桌面端（Electron 不支持原生 prompt/confirm），同时统一沿用暗黑主题。
function mplDialog(opts = {}) {
    const {
        title = "",
        message = "",
        defaultValue = null,
        placeholder = "",
        okText = "确定",
        cancelText = "取消",
        danger = false,
        withInput = true,
    } = opts;

    return new Promise((resolve) => {
        document.querySelectorAll(".mpl-dialog-overlay").forEach(el => el.remove());

        const overlay = document.createElement("div");
        overlay.className = "ma-modal-backdrop mpl-dialog-overlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:10080;background:rgba(0,0,0,.66);" +
            "display:flex;align-items:center;justify-content:center;";

        const box = document.createElement("div");
        box.className = "ma-modal ma-modal-static-anim mpl-dialog";
        box.style.cssText = "box-sizing:border-box;width:min(420px,92vw);background:#111114;" +
            "border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.78);" +
            "color:#f4f4f5;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;padding:18px 20px 16px;";

        let input = null;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
            else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(withInput ? (input ? input.value : "") : true); }
        };

        if (title) {
            const head = document.createElement("div");
            head.textContent = title;
            head.style.cssText = "font-size:14.5px;font-weight:650;color:#f4f4f5;margin-bottom:8px;";
            box.appendChild(head);
        }
        if (message) {
            const msg = document.createElement("div");
            msg.textContent = message;
            msg.style.cssText = "font-size:12.5px;color:#a1a1aa;white-space:pre-wrap;word-break:break-word;margin-bottom:12px;";
            box.appendChild(msg);
        }
        if (withInput) {
            input = document.createElement("input");
            input.type = "text";
            input.className = "ma-input";
            input.value = defaultValue == null ? "" : String(defaultValue);
            if (placeholder) input.placeholder = placeholder;
            input.style.cssText = "box-sizing:border-box;width:100%;background:#09090b;border:1px solid rgba(255,255,255,0.14);" +
                "border-radius:8px;color:#f4f4f5;padding:8px 10px;font-size:13px;outline:none;";
            input.addEventListener("focus", () => { input.style.borderColor = "#6366f1"; });
            input.addEventListener("blur", () => { input.style.borderColor = "rgba(255,255,255,0.14)"; });
            box.appendChild(input);
        }

        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px;";
        if (cancelText) {
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "ma-btn";
            cancel.textContent = cancelText;
            cancel.onclick = () => finish(null);
            row.appendChild(cancel);
        }
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = danger ? "ma-btn ma-btn-danger" : "ma-btn ma-btn-primary";
        ok.textContent = okText;
        ok.onclick = () => finish(withInput ? (input ? input.value : "") : true);
        row.appendChild(ok);
        box.appendChild(row);

        ["pointerdown", "mousedown", "click", "dblclick", "wheel"].forEach(ev => {
            overlay.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === "wheel" });
        });
        overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(null); });

        overlay.appendChild(box);
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey, true);
        setTimeout(() => {
            if (input) { try { input.focus(); input.select(); } catch (e) {} }
            else { try { ok.focus(); } catch (e) {} }
        }, 30);
    });
}

function mplAsk(title, defaultValue = "", opts = {}) {
    return mplDialog(Object.assign({ title, defaultValue, withInput: true }, opts));
}
function mplConfirm(message, opts = {}) {
    return mplDialog(Object.assign({ title: "请确认", message, withInput: false, okText: "确定" }, opts))
        .then(v => v !== null);
}
function mplAlert(message, title = "提示") {
    return mplDialog({ title, message, withInput: false, okText: "知道了", cancelText: "" }).then(() => undefined);
}

// 点数字就地改值：在数值旁边弹一个迷你输入框
function mplEditValueAt(anchorEl, currentValue, opts = {}) {
    const { label = "", width = 92 } = opts;
    return new Promise((resolve) => {
        document.querySelectorAll(".mpl-inline-edit").forEach(el => el.remove());

        const wrap = document.createElement("div");
        wrap.className = "mpl-inline-edit";
        wrap.style.cssText = "position:fixed;z-index:10090;display:flex;align-items:center;gap:6px;" +
            "padding:6px 8px;background:#111114;border:1px solid #6366f1;border-radius:9px;" +
            "box-shadow:0 12px 30px rgba(0,0,0,.72);font:12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#f4f4f5;";

        if (label) {
            const lab = document.createElement("span");
            lab.textContent = label;
            lab.style.cssText = "color:#a1a1aa;white-space:nowrap;";
            wrap.appendChild(lab);
        }
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentValue == null ? "" : String(currentValue);
        input.style.cssText = "width:" + width + "px;box-sizing:border-box;background:#09090b;border:1px solid rgba(255,255,255,0.14);" +
            "border-radius:6px;color:#f4f4f5;padding:4px 6px;font-size:12px;text-align:center;outline:none;";
        wrap.appendChild(input);

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("mousedown", onDown, true);
            wrap.remove();
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
            else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(input.value); }
        };
        const onDown = (e) => { if (!wrap.contains(e.target)) finish(null); };

        document.body.appendChild(wrap);

        try {
            const r = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
            const w = wrap.offsetWidth || 140;
            const h = wrap.offsetHeight || 34;
            let left = r ? r.left + r.width / 2 - w / 2 : window.innerWidth / 2 - w / 2;
            let top = r ? r.bottom + 6 : window.innerHeight / 2;
            if (r && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
            left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
            wrap.style.left = left + "px";
            wrap.style.top = top + "px";
        } catch (e) {}

        ["pointerdown", "mousedown", "click", "dblclick"].forEach(ev => {
            wrap.addEventListener(ev, (e) => e.stopPropagation());
        });
        document.addEventListener("keydown", onKey, true);
        setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 20);
    });
}

// ===================== 预设与收藏导出 / 导入 =====================
function mplBuildSidebarBackup() {
    return {
        format: "magic-assistant-presets-favorites",
        version: 1,
        exported_at: new Date().toISOString(),
        presets: JSON.parse(JSON.stringify(MPL_SIDEBAR.presets || {})),
        categories: JSON.parse(JSON.stringify(MPL_SIDEBAR.categories || [])),
        assignments: JSON.parse(JSON.stringify(MPL_SIDEBAR.assignments || {})),
        preset_order: JSON.parse(JSON.stringify(MPL_SIDEBAR.preset_order || [])),
        favorites: JSON.parse(JSON.stringify(MPL_SIDEBAR.favorites || [])),
    };
}
function mplDownloadJson(filename, data) {
    const text = JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mplNormalizeSidebarImport(payload) {
    if (!payload || typeof payload !== "object") throw new Error("文件内容不是有效的 JSON 对象");
    const rawPresets = payload.presets && typeof payload.presets === "object" && !Array.isArray(payload.presets)
        ? payload.presets : null;
    if (!rawPresets) throw new Error("文件里没有 presets 字段");
    const presets = {};
    Object.keys(rawPresets).forEach(name => {
        const key = String(name || "").trim();
        if (!key || !rawPresets[name] || typeof rawPresets[name] !== "object") return;
        presets[key] = JSON.parse(JSON.stringify(rawPresets[name]));
    });
    const rawFavorites = Array.isArray(payload.favorites)
        ? payload.favorites
        : (Array.isArray(payload.favorites?.collections) ? payload.favorites.collections : []);
    const cats = Array.isArray(payload.categories) ? payload.categories : [];
    const asg = payload.assignments && typeof payload.assignments === "object" && !Array.isArray(payload.assignments)
        ? payload.assignments : {};
    const order = Array.isArray(payload.preset_order) ? payload.preset_order : [];
    return {
        presets,
        categories: cats.map(x => String(x)).filter(Boolean),
        assignments: Object.fromEntries(Object.entries(asg).map(([k, v]) => [String(k), String(v || "")])),
        preset_order: order.map(x => String(x)).filter(Boolean),
        favorites: JSON.parse(JSON.stringify(rawFavorites)),
    };
}
async function mplImportSidebarBackup(payload) {
    const data = mplNormalizeSidebarImport(payload);
    const currentNames = Object.keys(MPL_SIDEBAR.presets || {});
    for (const name of currentNames) {
        try {
            await api.fetchApi("/ma/lora/delete_preset", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
        } catch (e) {}
    }
    for (const [name, content] of Object.entries(data.presets)) {
        const resp = await api.fetchApi("/ma/lora/save_preset", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, content }),
        });
        const rj = await resp.json().catch(() => ({}));
        if (rj && rj.status === "error") throw new Error(rj.message || `保存预设 ${name} 失败`);
    }
    MPL_SIDEBAR.presets = data.presets;
    MPL_SIDEBAR.categories = data.categories;
    MPL_SIDEBAR.assignments = data.assignments;
    MPL_SIDEBAR.preset_order = data.preset_order;
    MPL_SIDEBAR.favorites = data.favorites;
    await mplSavePresetMeta();
    await mplSaveFavorites();
    await mplLoadSidebar(true);
    mplRefreshAllSidebars();
    return Object.keys(data.presets).length;
}

// ---------- Lora-Manager 标题/备注 + 按文件名记忆的备注 ----------
const MPL_LM = { info: {}, notes: {}, paths: {}, loaded: false, loading: null };
async function mplLoadExtraInfo(force) {
    if (!force && MPL_LM.loaded) return MPL_LM;
    if (MPL_LM.loading) return MPL_LM.loading;
    MPL_LM.loading = (async () => {
        try {
            const [iRes, nRes, pRes] = await Promise.all([
                api.fetchApi("/ma/lora/lm_info").then(r => r.json()).catch(() => ({})),
                api.fetchApi("/ma/lora/notes").then(r => r.json()).catch(() => ({})),
                api.fetchApi("/ma/lora/paths").then(r => r.json()).catch(() => ({})),
            ]);
            MPL_LM.info = (iRes && iRes.info) || {};
            MPL_LM.notes = (nRes && nRes.notes) || {};
            MPL_LM.paths = (pRes && pRes.paths) || {};
            MPL_LM.loaded = true;
            mplDecorateAllNames();
        } catch (e) { console.warn("[MagicPowerLora] 读取 LoRA 标题/备注失败:", e); }
        finally { MPL_LM.loading = null; }
        return MPL_LM;
    })();
    return MPL_LM.loading;
}
function mplPathFor(name) {
    if (!name) return "";
    const variants = [String(name), String(name).replace(/\\/g, "/"), String(name).replace(/\//g, "\\")];
    for (const v of variants) if (MPL_LM.paths[v]) return MPL_LM.paths[v];
    return "";
}
function mplLmEntry(name) {
    if (!name) return {};
    const variants = [String(name), String(name).replace(/\\/g, "/"), String(name).replace(/\//g, "\\")];
    for (const v of variants) if (MPL_LM.info[v]) return MPL_LM.info[v];
    return {};
}
function mplTitleFor(name) {
    return String(mplLmEntry(name).title || "").trim();
}
function mplLoraMatchesText(name, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const raw = `${name}\n${mplTitleFor(name)}`.toLowerCase();
    if (raw.includes(q)) return true;
    const hay = raw.replace(/[_\-\\/.]+/g, " ");
    return q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok));
}
function mplNoteFor(name) {
    const variants = [String(name || ""), String(name || "").replace(/\\/g, "/"), String(name || "").replace(/\//g, "\\")];
    for (const v of variants) {
        const own = MPL_LM.notes[v];
        if (own !== undefined && String(own).trim()) return String(own);
    }
    return String(mplLmEntry(name).notes || "").trim();
}
async function mplSetNote(name, note, previous) {
    if (!name) return;
    const value = String(note || "");
    if (!value.trim() && !(previous && String(previous).trim())) return;
    if (value.trim()) MPL_LM.notes[name] = value;
    else delete MPL_LM.notes[name];
    try {
        await api.fetchApi("/ma/lora/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, note: value }),
        });
    } catch (e) { console.warn("[MagicPowerLora] 保存备注失败:", e); }
}
function mplDecorateName(el, name) {
    if (!el) return;
    const t = mplTitleFor(name);
    el.title = t ? `${name}\n标题：${t}` : name;
}
function mplDecorateAllNames() {
    document.querySelectorAll(".mpl-lora-name[data-lora]").forEach(el => mplDecorateName(el, el.dataset.lora));
}
function mplDecorateNewLora(l) {
    if (!l) return l;
    if (!l.note) l.note = mplNoteFor(l.name) || "";
    const key = mplMetadataNameKey(l.name);
    let info = mplLmEntry(l.name);
    if (!info || !Object.keys(info).length) info = MPL_LM.info?.[l.name] || MPL_LM.info?.[key] || null;
    if (!info && MPL_LM.info) {
        for (const [name, entry] of Object.entries(MPL_LM.info)) {
            if (mplMetadataNameKey(name) === key) { info = entry; break; }
        }
    }
    const infoWords = String(info?.trigger_words || info?.triggerWords || "").trim();
    if (!String(l.tags || "").trim() && !String(l.triggerWords || "").trim() && infoWords) {
        l.tags = infoWords;
        l.triggerWords = infoWords;
    } else if (String(l.tags || "").trim()) l.triggerWords = l.tags;
    else if (String(l.triggerWords || "").trim()) l.tags = l.triggerWords;
    const rec = Number(info?.recommended_weight);
    if ((l.recommendedWeight === undefined || l.recommendedWeight === null) &&
        Number.isFinite(rec) && rec > 0 && rec <= 1) {
        l.recommendedWeight = rec;
        l.recommendedWeightSource = info?.recommended_weight_source || "作者推荐";
    }
    mplSyncClipWeight(l);
    return l;
}
void mplLoadExtraInfo();

function mplPresetFolders(content) {
    if (!content) return [];
    if (Array.isArray(content)) return content.filter(f => f && Array.isArray(f.loras));
    if (Array.isArray(content.folders)) return content.folders.filter(f => f && Array.isArray(f.loras));
    if (Array.isArray(content.loras)) return [{ name: "预设", loras: content.loras }];
    return [];
}

function mplCollectConfiguredLoraNames(node) {
    const names = [];
    const collect = (items) => (items || []).forEach(item => {
        if (item && mplLoraEnabled(item) && item.name) names.push(String(item.name));
    });
    collect(node?.loraData?.loras);
    (node?.loraData?.folders || []).forEach(folder => {
        if (folder && !folder.ignored) collect(folder.loras);
    });

    // Old workflows may not have lora_data_state yet; read the hidden widget
    // as a compatibility fallback.
    if (names.length === 0) {
        try {
            const raw = node?._stackWidget?.value ?? node?.widgets_values?.[2];
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            collect(Array.isArray(parsed) ? parsed : parsed?.loras);
        } catch (e) { /* ignore malformed legacy data */ }
    }
    return [...new Set(names.filter(Boolean))];
}

function mplUpdateMissingLoraState(node) {
    if (!node || !loraNamesCache) return;
    const missing = mplCollectConfiguredLoraNames(node)
        .filter(name => !loraNamesCache.has(mplNormalizeLoraName(name)));
    node._mplMissingLoras = missing;
    node.setDirtyCanvas?.(true, true);
}

function mplSyncModelValidationWidgets(node) {
    if (!node || node.type !== NODE_NAME) return;
    const configured = mplCollectConfiguredLoraNames(node);
    node._mplModelValidationWidgets ||= [];

    configured.forEach((name, index) => {
        const widgetName = "__mpl_lora_model_" + index;
        let widget = node._mplModelValidationWidgets[index];
        if (!widget) {
            widget = node.addWidget("combo", widgetName, name, () => {}, {
                values: loraNamesOptionsCache,
                serialize: false,
            });
            widget.hidden = true;
            widget.serialize = false;
            widget.options.hidden = true;
            widget.options.serialize = false;
            widget.computeSize = () => [0, 0];
            node._mplModelValidationWidgets[index] = widget;
        }
        widget.options.values = loraNamesOptionsCache;
        widget.value = name;
    });

    // Disable stale validation widgets after a LoRA is deleted from the stack.
    for (let index = configured.length; index < node._mplModelValidationWidgets.length; index++) {
        const widget = node._mplModelValidationWidgets[index];
        if (!widget) continue;
        widget.options.values = [];
        widget.value = "";
    }
}

function mplSetLoraNameList(files) {
    loraNamesOptionsCache = Array.isArray(files) ? files : [];
    loraNamesCache = new Set(loraNamesOptionsCache.map(mplNormalizeLoraName));
    mplRefreshMissingLoraStates();
    mplRefreshOfficialMissingModels();
}

function mplRefreshOfficialMissingModels() {
    if (!loraNamesCache) return;
    if (typeof app?.refreshMissingModels !== "function") return;
    void app.refreshMissingModels({ silent: false, reloadDefs: false }).catch(error => {
        console.warn("[MagicPowerLora] 官方模型扫描失败:", error);
    });
}

function mplRefreshMissingLoraStates() {
    const nodes = app?.graph?._nodes || [];
    nodes.forEach(node => {
        if (node?.type === NODE_NAME || node?.constructor?.type === NODE_NAME) {
            mplUpdateMissingLoraState(node);
            mplSyncModelValidationWidgets(node);
        }
    });
}

async function loadLoraNameList() {
    if (loraNamesLoadPromise) return loraNamesLoadPromise;
    loraNamesLoadPromise = (async () => {
        try {
            const resp = await api.fetchApi("/ma/lora/list");
            const data = await resp.json();
            mplSetLoraNameList(data?.files);
        } catch (e) {
            // A failed scan must not mark every node missing.
            loraNamesCache = null;
            console.warn("[MagicPowerLora] LoRA文件列表检查失败:", e);
        } finally {
            loraNamesLoadPromise = null;
        }
    })();
    return loraNamesLoadPromise;
}

// 加载所有LoRA图片列表（类似参考代码的loadImageList）
async function loadLoraImageList() {
    try {
        const resp = await api.fetchApi("/ma/lora/images");
        loraImagesCache = await resp.json();
        mplDebugLog("LoRA图片列表已加载，共", Object.keys(loraImagesCache).length, "个LoRA");
    } catch (e) {
        console.error("[MagicPowerLora] 加载LoRA图片列表时出错:", e);
        loraImagesCache = {};
    }
}

// 初始化时加载图片列表
loadLoraImageList();
// 同步加载工作流缺失检测所需的 LoRA 文件名列表
loadLoraNameList();

// ---------------------------------------------------------------------------
// 全局单例 LoRA 悬停预览浮层（彻底防止浮层残留）
// ---------------------------------------------------------------------------
const MA_LoraPreview = (() => {
    let div = null;
    let timer = null;
    let activeRow = null;
    let boundDocMove = false;
    let guardTimer = null;

    function stopGuard() {
        if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    }

    function teardown() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (div) { div.remove(); div = null; }
        activeRow = null;
        stopGuard();
    }

    function startGuard(row) {
        stopGuard();
        guardTimer = setInterval(() => {
            if (!div) { stopGuard(); return; }
            if (activeRow !== row || !row.isConnected) { teardown(); return; }
        }, 250);
    }

    function installGlobalGuards() {
        if (boundDocMove) return;
        boundDocMove = true;
        window.addEventListener("scroll", teardown, true);
        window.addEventListener("resize", teardown, true);
        document.addEventListener("pointerleave", teardown, true);
        document.addEventListener("visibilitychange", () => { if (document.hidden) teardown(); });
    }

    function place(rect) {
        if (!div) return;
        const pw = 300, ph = 300, margin = 10;
        let left = rect.right + margin;
        let top = rect.top;
        if (left + pw > window.innerWidth) left = rect.left - pw - margin;
        if (top + ph > window.innerHeight) top = window.innerHeight - ph - margin;
        left = Math.max(margin, left);
        top = Math.max(margin, top);
        div.style.left = left + "px";
        div.style.top = top + "px";
    }

    function bindRowHover(row, lora) {
        installGlobalGuards();
        row.onmouseenter = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            teardown();
            activeRow = row;
            const rect0 = row.getBoundingClientRect();
            timer = setTimeout(() => {
                timer = null;
                if (activeRow !== row || !document.body.contains(row)) { activeRow = null; return; }
                document.querySelectorAll(".mpl-lora-preview").forEach(p => p.remove());
                div = document.createElement("div");
                div.className = "mpl-lora-preview";
                div.style.cssText =
                    "position:fixed;z-index:10000;background:#111114;border:1px solid rgba(255,255,255,0.16);" +
                    "border-radius:10px;padding:8px;box-shadow:0 16px 40px rgba(0,0,0,0.85);" +
                    "pointer-events:none;max-width:300px;max-height:300px;display:block;";
                const img = document.createElement("img");
                img.style.cssText = "max-width:284px;max-height:284px;object-fit:contain;display:block;border-radius:6px;";
                const safeName = encodeURIComponent(lora.name);
                img.src = api.apiURL(`/ma/lora/image?name=${safeName}&t=${Date.now()}`);
                img.onerror = () => {
                    if (div) div.innerHTML = `<div style="padding:20px;color:#71717a;text-align:center;">${mplT("无预览图")}</div>`;
                };
                div.appendChild(img);
                document.body.appendChild(div);
                place(rect0);
                startGuard(row);
            }, 300);
        };
        row.onmouseleave = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            teardown();
        };
    }

    return { bindRowHover, teardown, _getDiv: () => div };
})();

function mplClearLoraPreview() {
    try { MA_LoraPreview.teardown(); } catch (e) {}
    try { document.querySelectorAll(".mpl-lora-preview").forEach(p => p.remove()); } catch (e) {}
}

// ---------------------------------------------------------------------------
// i18n helpers
// ---------------------------------------------------------------------------
function mplGetCurrentLanguage() {
    try {
        if (window.getCurrentLanguage) return window.getCurrentLanguage();
        return localStorage.getItem("magic_language_switcher_lang") || "zh";
    } catch (e) {
        return "zh";
    }
}

function mplTranslateText(text, lang) {
    try {
        if (window.translateText) return window.translateText(text, lang, "MagicPowerLoraLoader");
        if (window.allTranslations?.MagicPowerLoraLoader?.[text]?.[lang]) {
            return window.allTranslations.MagicPowerLoraLoader[text][lang];
        }
    } catch (e) { /* ignore */ }
    return text;
}

function mplT(text) {
    return mplTranslateText(text, mplGetCurrentLanguage());
}

const MPL_METADATA_SETTINGS_KEY = "magic_power_lora_fetch_settings";
let mplMetadataModal = null;

function mplMetadataNameKey(name) {
    return String(name || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function mplLoadMetadataSettings() {
    let settings = {};
    try {
        settings = JSON.parse(localStorage.getItem(MPL_METADATA_SETTINGS_KEY) || "{}") || {};
    } catch (error) { /* use the existing single-download defaults */ }
    return {
        download_txt: settings.download_txt !== false,
        download_json: settings.download_json !== false,
        download_image: settings.download_image !== false,
        download_log: settings.download_log !== false,
        save_path: settings.save_path === "subfolder" ? "subfolder" : "same_dir",
    };
}

function mplCollectMetadataNames(node, scope = "node", localFiles = []) {
    let items;
    if (scope === "all") {
        items = localFiles.map(name => ({ name }));
    } else if (scope.startsWith("folder:")) {
        items = node?.loraData?.folders?.[Number(scope.slice(7))]?.loras || [];
    } else {
        items = [
            ...(node?.loraData?.loras || []),
            ...(node?.loraData?.folders || []).flatMap(folder => folder?.loras || []),
        ];
    }
    const seen = new Set();
    return items.reduce((names, item) => {
        const name = typeof item?.name === "string" ? item.name : "";
        const key = mplMetadataNameKey(name);
        if (key && !seen.has(key)) {
            seen.add(key);
            names.push(name);
        }
        return names;
    }, []);
}

function mplSplitTriggerWords(value) {
    return String(value == null ? "" : value)
        .split(/[\r\n,，;；]+/)
        .map(s => s.trim())
        .filter(Boolean);
}
function mplTriggerDisabledList(lora) {
    if (!lora || !Array.isArray(lora.triggerDisabled)) return [];
    return lora.triggerDisabled.map(s => String(s).trim()).filter(Boolean);
}
function mplSameTriggerWord(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
function mplIsTriggerWordDisabled(lora, word) {
    return mplTriggerDisabledList(lora).some(x => mplSameTriggerWord(x, word));
}
function mplTriggerEffectivelyDisabled(lora, word) {
    return !lora || lora.triggerEnabled === false || mplIsTriggerWordDisabled(lora, word);
}
function mplSetTriggerWordEnabled(lora, word, enabled) {
    if (!lora) return;
    const words = mplSplitTriggerWords(lora.tags || lora.triggerWords);
    if (!words.length) return;
    const target = words.find(w => mplSameTriggerWord(w, word)) || word;
    let disabled = mplTriggerDisabledList(lora);
    if (enabled) {
        if (lora.triggerEnabled === false) {
            lora.triggerEnabled = true;
            disabled = words.filter(w => !mplSameTriggerWord(w, target));
        } else {
            disabled = disabled.filter(w => !mplSameTriggerWord(w, target));
        }
    } else {
        if (lora.triggerEnabled !== false) {
            const has = disabled.some(w => mplSameTriggerWord(w, target));
            if (!has) disabled.push(target);
        }
    }
    lora.triggerDisabled = disabled;
}
function mplSetTriggerWords(item, words) {
    if (!item || typeof item !== "object") return;
    const text = String(words == null ? "" : words).trim();
    const list = mplSplitTriggerWords(text);
    if (Array.isArray(item.triggerDisabled) && item.triggerDisabled.length) {
        item.triggerDisabled = item.triggerDisabled.filter(w => list.some(x => mplSameTriggerWord(x, w)));
    }
    item.tags = text;
    item.triggerWords = text;
}

function mplApplyMetadataData(node, name, data) {
    const key = mplMetadataNameKey(name);
    let changed = false;
    const recWeight = (typeof data?.recommendedWeight === "number" && data.recommendedWeight > 0 && data.recommendedWeight <= 1)
        ? data.recommendedWeight : null;
    const recSource = typeof data?.recommendedWeightSource === "string" ? data.recommendedWeightSource : "";
    const items = [
        ...(node?.loraData?.loras || []),
        ...(node?.loraData?.folders || []).flatMap(folder => folder?.loras || []),
    ];
    for (const item of items) {
        if (mplMetadataNameKey(item?.name) !== key) continue;
        for (const field of ["triggerWords", "jsonInfo", "logInfo"]) {
            if (field === "triggerWords") {
                const existing = String(item.tags || item.triggerWords || "").trim();
                const incoming = String(data?.triggerWords || "").trim();
                if (!existing && incoming) {
                    mplSetTriggerWords(item, incoming);
                    changed = true;
                }
                continue;
            }
            if (typeof data?.[field] === "string" && item[field] !== data[field]) {
                item[field] = data[field];
                changed = true;
            }
        }
        if (recWeight !== null) {
            if (item.recommendedWeight !== recWeight) { item.recommendedWeight = recWeight; changed = true; }
            if (item.recommendedWeightSource !== recSource) { item.recommendedWeightSource = recSource; changed = true; }
        }
    }
    return changed;
}

function mplMetadataTypes(settings) {
    return ["txt", "json", "image", "log"].filter(type => settings[`download_${type}`]);
}

function mplMetadataFieldState(name, type, metadata = {}, fieldStates = {}) {
    const key = mplMetadataNameKey(name);
    const recorded = fieldStates[key]?.[type] || {};
    if (["invalid", "local_error"].includes(recorded.state)) return { ...recorded, needs_fetch: false };
    if (metadata[key]?.[type] === true) return { ...recorded, state: "present", needs_fetch: false };
    if (recorded.state && recorded.state !== "present") {
        return { ...recorded, needs_fetch: ["missing", "error"].includes(recorded.state) && recorded.needs_fetch !== false };
    }
    return { state: "missing", needs_fetch: true };
}

const MPL_METADATA_SETTLED_STATES = ["not_found", "unavailable", "unresolved", "unsupported", "user_skipped"];

function mplMetadataAllSettled(name, settings, metadata = {}, fieldStates = {}) {
    const types = mplMetadataTypes(settings);
    if (!types.length) return false;
    if (mplMetadataRecNeeded(name, settings, metadata)) return false;
    let hasSettled = false;
    const done = types.every(type => {
        const state = mplMetadataFieldState(name, type, metadata, fieldStates).state;
        if (MPL_METADATA_SETTLED_STATES.includes(state)) { hasSettled = true; return true; }
        return state === "present";
    });
    return done && hasSettled;
}

function mplMetadataHasLm(name, metadata) {
    return !!(metadata && metadata[mplMetadataNameKey(name)]?.lm);
}

function mplMetadataHasRec(name, metadata) {
    const value = metadata?.[mplMetadataNameKey(name)]?.recommended_weight;
    return typeof value === "number" && value > 0;
}

function mplMetadataRecNeeded(name, settings, metadata) {
    const entry = metadata?.[mplMetadataNameKey(name)];
    if (settings.download_rec === false || !entry || mplMetadataHasRec(name, metadata)) return false;
    return entry.recommended_weight_available === true;
}

function mplMetadataRequestedTypes(name, settings, metadata = null, fieldStates = {}) {
    const types = mplMetadataTypes(settings);
    if (settings.local_action) {
        return types.filter(type => {
            const field = mplMetadataFieldState(name, type, metadata || {}, fieldStates);
            if (settings.local_action === "adopt") {
                return !field.local_reviewed && !["present", "invalid", "local_error"].includes(field.state);
            }
            return field.local_reviewed === true || field.state === "user_skipped";
        });
    }
    const retry = settings.retry_types?.[mplMetadataNameKey(name)];
    const requested = Array.isArray(retry) ? types.filter(type => retry.includes(type)) : types;
    if (!metadata) return requested;
    const retrySettled = settings.force_refresh === true || settings.update_existing === true;
    if (!retrySettled && mplMetadataAllSettled(name, settings, metadata || {}, fieldStates)) return [];
    return requested.filter(type => {
        const field = mplMetadataFieldState(name, type, metadata, fieldStates);
        if (settings.update_existing) return field.state !== "local_error";
        if (["present", "invalid", "local_error"].includes(field.state)) return false;
        if (MPL_METADATA_SETTLED_STATES.includes(field.state)) return retrySettled;
        return settings.force_refresh === true || field.needs_fetch === true;
    });
}

function mplMetadataNeeds(name, settings, metadata, fieldStates = {}) {
    return mplMetadataRequestedTypes(name, settings, metadata, fieldStates).length > 0 ||
        (!settings.local_action && mplMetadataRecNeeded(name, settings, metadata));
}

function mplMetadataFailureDetails(result, typeLabels) {
    const failedTypes = Array.isArray(result.failed) && result.failed.length
        ? result.failed
        : result.status === "error" ? result.requested_types || [] : [];
    return failedTypes.map(type => {
        const field = result.field_states?.[type] || {};
        const reason = field.last_error || field.reason;
        return reason ? { type, label: typeLabels[`download_${type}`] || type, reason } : null;
    }).filter(Boolean);
}

function mplMetadataLocalIssues(name, settings, metadata, fieldStates = {}) {
    return mplMetadataTypes(settings).some(type => ["invalid", "local_error"].includes(mplMetadataFieldState(name, type, metadata, fieldStates).state));
}

function mplMergeMetadataFieldStates(name, result, metadata, fieldStates, requestedTypes = []) {
    const key = mplMetadataNameKey(name);
    metadata[key] ||= {};
    fieldStates[key] ||= {};
    const requested = new Set(requestedTypes);
    for (const type of result.saved || []) {
        metadata[key][type] = true;
        fieldStates[key][type] = { state: "present", needs_fetch: false };
    }
    const updates = result.field_states || Object.fromEntries((result.unavailable || []).map(type => [type, { state: "unavailable", needs_fetch: false }]));
    for (const [type, update] of Object.entries(updates)) {
        if (!requested.has(type) || !update || typeof update !== "object") continue;
        const previous = fieldStates[key][type];
        if (update.state === "present") metadata[key][type] = true;
        if (["invalid", "local_error"].includes(update.state)) {
            fieldStates[key][type] = { ...previous, ...update, needs_fetch: false };
        } else if (metadata[key][type] === true) {
            fieldStates[key][type] = { ...update, state: "present", needs_fetch: false };
        } else if (update.state === "error" && ["unavailable", "not_found", "unresolved", "unsupported", "user_skipped"].includes(previous?.state)) {
            fieldStates[key][type] = { ...previous, last_error: update.reason, last_attempt_at: update.checked_at };
        } else {
            fieldStates[key][type] = { ...previous, ...update };
        }
    }
}

function mplFilterMetadataNames(names, filters, settings, metadata, fieldStates = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    return names.filter(name => {
        const key = mplMetadataNameKey(name);
        const directory = key.split("/").slice(0, -1).join("/");
        if (filters.directory === "." && !filters.recursive && directory) return false;
        if (filters.directory && filters.directory !== ".") {
            if (directory !== filters.directory && !(filters.recursive && directory.startsWith(filters.directory + "/"))) return false;
        }
        if (search && !mplLoraMatchesText(name, search)) return false;
        if (search) return true;
        const mode = filters.status || (filters.onlyMissing ? "pending" : "all");
        if (mode === "not_found") return mplMetadataAllSettled(name, settings, metadata, fieldStates);
        if (mode === "local_missing") return mplMetadataTypes(settings).some(type => mplMetadataFieldState(name, type, metadata, fieldStates).state !== "present");
        if (mode === "pending" && settings.local_action) return mplMetadataNeeds(name, settings, metadata, fieldStates);
        return mode !== "pending" || mplMetadataNeeds(name, settings, metadata, fieldStates) || mplMetadataLocalIssues(name, settings, metadata, fieldStates);
    });
}

function mplMetadataPreflight(names, selected, settings, metadata, fieldStates = {}) {
    const selectedNames = names.filter(name => selected.has(mplMetadataNameKey(name)));
    const actionableNames = selectedNames.filter(name => mplMetadataNeeds(name, settings, metadata, fieldStates));
    const issues = selectedNames.filter(name => mplMetadataLocalIssues(name, settings, metadata, fieldStates)).length;
    const notFound = selectedNames.filter(name => mplMetadataAllSettled(name, settings, metadata, fieldStates)).length;
    const complete = selectedNames.filter(name => !mplMetadataNeeds(name, settings, metadata, fieldStates) && !mplMetadataLocalIssues(name, settings, metadata, fieldStates) && !mplMetadataAllSettled(name, settings, metadata, fieldStates)).length;
    return { scoped: names.length, selected: selectedNames.length, need: actionableNames.length, complete, issues, notFound, names: selectedNames, actionableNames };
}

function mplMetadataHasSharedSelection(names, sharedInfo) {
    const selected = new Set(names.map(mplMetadataNameKey));
    return names.some(name => {
        const group = sharedInfo[mplMetadataNameKey(name)] || [];
        return new Set([name, ...group].map(mplMetadataNameKey).filter(key => selected.has(key))).size > 1;
    });
}

function mplMetadataGraphNodes(origin) {
    const nodes = (app?.graph?._nodes || []).filter(node => node?.type === NODE_NAME || node?.constructor?.type === NODE_NAME);
    return [...new Set([origin, ...nodes])];
}

async function mplRunMetadataQueue(names, settings, state, onProgress, metadata = null, fieldStates = {}) {
    const results = [];
    state.running = true;
    state.pauseResult = null;
    let stopped = false;
    let completed = 0;
    try {
        const runOne = async (name) => {
            if (state.cancelRequested || stopped) return;
            onProgress({ current: name, completed, total: names.length });
            let result;
            let requestedTypes = mplMetadataRequestedTypes(name, settings, metadata, fieldStates);
            if (!requestedTypes.length && mplMetadataRecNeeded(name, settings, metadata)) requestedTypes = ["rec"];
            if (!requestedTypes.length) { completed++; return; }
            try {
                const response = await api.fetchApi("/ma/lora/fetch_metadata", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        lora_name: name,
                        options: {
                            ...Object.fromEntries(["txt", "json", "image", "log"].map(type => [`download_${type}`, requestedTypes.includes(type)])),
                            download_rec: settings.download_rec !== false,
                        },
                        save_path_mode: settings.save_path,
                        overwrite: settings.overwrite === true,
                        force_refresh: settings.force_refresh === true,
                        ...(settings.update_existing === true ? { update_existing: true } : {}),
                    }),
                });
                result = await response.json();
                if (!response.ok || !["success", "skipped", "checked", "empty", "not_found", "partial", "error"].includes(result?.status)) {
                    result = { ...result, status: "error", message: result?.message || `${mplT("请求失败")} (${response.status})` };
                }
            } catch (error) {
                result = { status: "error", message: error.message || String(error) };
            }
            const confirmedEmpty = !result.saved?.length && requestedTypes.every(type => result.field_states?.[type] ? ["unavailable", "unresolved", "unsupported"].includes(result.field_states[type].state) : result.unavailable?.includes(type));
            const sourceNotFound = !result.saved?.length && requestedTypes.every(type => result.field_states?.[type]?.state === "not_found");
            let status = result.status;
            if (["success", "skipped", "empty"].includes(status)) {
                if (sourceNotFound) status = "not_found";
                else if (confirmedEmpty || status === "empty") status = "checked";
            }
            const entry = { ...result, status, name, requested_types: requestedTypes };
            results.push(entry);
            completed++;
            onProgress({ current: name, completed, total: names.length, result: entry });
            if (entry.stop_queue) {
                state.pauseResult = entry;
                stopped = true;
            }
        };
        let cursor = 0;
        const worker = async () => {
            while (!state.cancelRequested && !stopped && cursor < names.length) {
                const name = names[cursor++];
                await runOne(name);
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, names.length) }, () => worker()));
        return results;
    } finally {
        state.running = false;
    }
}

/** 与「添加 Lora」弹窗相同的目录树（用于检测范围导航） */
function buildMplFolderTree(allFiles) {
    const folderTree = {};
    const rootFiles = [];
    (allFiles || []).forEach(file => {
        const parts = file.split(/[/\\]/);
        if (parts.length === 1) {
            rootFiles.push(file);
        } else {
            let current = folderTree;
            for (let i = 0; i < parts.length - 1; i++) {
                const folderName = parts[i];
                if (!current[folderName]) {
                    current[folderName] = { files: [], folders: {} };
                }
                if (i === parts.length - 2) {
                    current[folderName].files.push(file);
                } else {
                    if (!current[folderName].folders) {
                        current[folderName].folders = {};
                    }
                    current = current[folderName].folders;
                }
            }
        }
    });
    return { folderTree, rootFiles };
}

function mplGetSubfolderNames(folderTree, pathParts) {
    let map = folderTree;
    for (const p of pathParts) {
        if (!map[p] || !map[p].folders) return [];
        map = map[p].folders;
    }
    return Object.keys(map).sort();
}

// 「添加 Lora」/「LoRA 检测」弹窗的浏览状态：记住上次打开的文件夹、全部模式与自动添加触发词开关
const MPL_BROWSER_STATE_KEY = "magic_power_lora_browser_state";

function mplLoadBrowserState() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(MPL_BROWSER_STATE_KEY) || "{}") || {};
    } catch (error) { saved = {}; }
    return {
        path: Array.isArray(saved.path) ? saved.path.filter(p => typeof p === "string" && p) : [],
        showAll: saved.showAll === true,
        // 默认开启：未保存过时为 true，用户手动关闭后记住关闭状态
        autoAddTag: saved.autoAddTag !== false,
    };
}

function mplSaveBrowserState(patch) {
    try {
        const next = Object.assign({}, mplLoadBrowserState(), patch || {});
        localStorage.setItem(MPL_BROWSER_STATE_KEY, JSON.stringify(next));
    } catch (error) { /* localStorage 不可用时忽略 */ }
}

/** 截断到目录树中仍存在的最深路径（文件夹被删除/改名时自动回退） */
function mplSanitizeFolderPath(folderTree, pathParts) {
    const valid = [];
    let map = folderTree || {};
    for (const p of pathParts || []) {
        if (!map || !Object.prototype.hasOwnProperty.call(map, p)) break;
        valid.push(p);
        map = map[p].folders || {};
    }
    return valid;
}

app.registerExtension({
    name: "Magic.Power.Lora",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            const MPL_MIN_W = 470; //设置强力lora加载器节点的最小宽高
            const MPL_MIN_H = 350;

            // 覆盖 computeSize：强制最小尺寸（ComfyUI 前端会调用此方法）
            const origComputeSize = nodeType.prototype.computeSize;
            nodeType.prototype.computeSize = function() {
                const result = origComputeSize ? origComputeSize.apply(this, arguments) : (this.size || [MPL_MIN_W, MPL_MIN_H]);
                // 根据 layoutSettings 计算动态最小宽度
                // 箭头模式控件约 80px，滑条模式约 sliderWidth + 46px
                // 额外加 20px padding 确保按钮完全显示
                let dynMinW = MPL_MIN_W + 20;
                if (this.layoutSettings && this.layoutSettings.weightStyle === "slider") {
                    const sw = this.layoutSettings.sliderWidth ?? 110;
                    const sv = this.layoutSettings.showWeightValue !== false ? 46 : 0;
                    dynMinW = Math.max(MPL_MIN_W + 20, MPL_MIN_W + 20 + Math.max(0, sw + sv - 60));
                }
                const w = Math.max(Array.isArray(result) ? result[0] : MPL_MIN_W, dynMinW);
                const h = Math.max(Array.isArray(result) ? result[1] : MPL_MIN_H, MPL_MIN_H);
                return [w, h];
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                if (!this.loraData) {
                    this.loraData = { folders: [], loras: [] };
                }
                if (!this.loraData.loras) this.loraData.loras = [];
                if (!this.loraData.folders) this.loraData.folders = [];

                if (!this.widgets) this.widgets = [];
                let stackWidget = this.widgets.find(w => w.name === "lora_stack");
                if (!stackWidget) {
                    stackWidget = this.addWidget("text", "lora_stack", "[]", () => {}, {});
                }
                // 完全隐藏widget（参考zml代码的方式）
                stackWidget.hidden = true;
                stackWidget.computeSize = () => [0, 0];
                // 移除 lora_stack 的输入端口（防止用户误连接）
                const stackInputIdx = this.inputs?.findIndex(i => i.name === "lora_stack");
                if (stackInputIdx >= 0) {
                    this.removeInput(stackInputIdx);
                }

                // INT8 模式占位（向后兼容）：ComfyUI 官方已在 model_patcher.py 提供 INT8 等量化
                // 权重的 LoRA 支持，不再需要自定义模式。此处仅保留同名 widget 占位，避免旧工作流
                // 的 widgets_values 索引错位；其值固定为 "none"，本节点完全忽略。
                let int8ModeWidget = this.widgets.find(w => w.name === "int8_mode");
                if (!int8ModeWidget) {
                    int8ModeWidget = this.addWidget("text", "int8_mode", "none", () => {}, {});
                }
                int8ModeWidget.hidden = true;
                int8ModeWidget.computeSize = () => [0, 0];
                int8ModeWidget.value = "none"; // 强制覆盖任何旧值
                this._int8ModeWidget = int8ModeWidget;

                // SDNQ 模式设置（隐藏的 widget）
                let sdnqModeWidget = this.widgets.find(w => w.name === "sdnq_mode");
                if (!sdnqModeWidget) {
                    sdnqModeWidget = this.addWidget("text", "sdnq_mode", "none", () => {}, {});
                }
                sdnqModeWidget.hidden = true;
                sdnqModeWidget.computeSize = () => [0, 0];
                this._sdnqModeWidget = sdnqModeWidget;

                // 自适应模式设置（隐藏的 widget）
                let adaptiveModeWidget = this.widgets.find(w => w.name === "adaptive_mode");
                if (!adaptiveModeWidget) {
                    adaptiveModeWidget = this.addWidget("text", "adaptive_mode", "false", () => {}, {});
                }
                adaptiveModeWidget.hidden = true;
                adaptiveModeWidget.computeSize = () => [0, 0];
                this._adaptiveModeWidget = adaptiveModeWidget;

                // Klein 模式设置（隐藏的 widget）
                let kleinModeWidget = this.widgets.find(w => w.name === "klein_mode");
                if (!kleinModeWidget) {
                    kleinModeWidget = this.addWidget("text", "klein_mode", "auto", () => {}, {});
                }
                kleinModeWidget.hidden = true;
                kleinModeWidget.computeSize = () => [0, 0];
                this._kleinModeWidget = kleinModeWidget;

                // Anima 2.9B 模式设置（隐藏的 widget）：none 关闭 / auto 自动检测 40 层 Anima / anima 强制 28→40 层转换
                let animaModeWidget = this.widgets.find(w => w.name === "anima_mode");
                if (!animaModeWidget) {
                    animaModeWidget = this.addWidget("text", "anima_mode", "none", () => {}, {});
                }
                animaModeWidget.hidden = true;
                animaModeWidget.computeSize = () => [0, 0];
                this._animaModeWidget = animaModeWidget;

                // 初始化 SDNQ 模式（从属性中读取）
                if (this.sdnqMode === undefined) {
                    this.sdnqMode = this.properties["sdnq_mode"] || "none";
                }
                // 初始化自适应模式（从属性中读取）
                // 注意：不能用 `if (!this.adaptiveMode)`，否则 false 会被当作“未初始化”
                if (this.adaptiveMode === undefined) {
                    this.adaptiveMode = this.properties["adaptive_mode"] === true || this.properties["adaptive_mode"] === "true";
                }

                // 初始化 Klein 模式（从属性中读取）
                if (this.kleinMode === undefined) {
                    this.kleinMode = this.properties["klein_mode"] || "auto";
                }

                // 初始化 Anima 2.9B 模式（从属性中读取）
                if (this.animaMode === undefined) {
                    this.animaMode = this.properties["anima_mode"] || "none";
                }

                // 初始化布局设置（权重控件样式等）
                if (!this.layoutSettings) {
                    const saved = this.properties["layout_settings"];
                    const defaults = {
                        weightStyle: "arrows",
                        sliderStep: 0.05,
                        sliderMin: -2,
                        sliderMax: 2,
                        sliderWidth: 110,
                        showWeightValue: true,
                        snapToZero: true,
                        hideClip: true,
                        hideRecWeight: false,
                    };
                    this.layoutSettings = (saved && typeof saved === "object")
                        ? Object.assign({}, defaults, saved)
                        : defaults;
                }

                // 初始化颜色设置（选中态颜色）
                if (!this.colorSettings) {
                    const savedColors = this.properties["color_settings"];
                    const colorDefaults = { selectBg: "#2b3b5e", selectBar: "#6366f1", selectText: "#eef1ff" };
                    this.colorSettings = (savedColors && typeof savedColors === "object")
                        ? Object.assign({}, colorDefaults, savedColors)
                        : colorDefaults;
                }

                // 初始化文件夹全局默认颜色（外卡片背景 / 里标题栏 / 左侧色条 / 忽略与未忽略颜色）
                if (!this.folderColorSettings) {
                    const savedFolderColors = this.properties["folder_color_settings"];
                    const folderColorDefaults = { outer: "", inner: "", bar: "", ignore: "", normal: "" };
                    this.folderColorSettings = (savedFolderColors && typeof savedFolderColors === "object")
                        ? Object.assign({}, folderColorDefaults, savedFolderColors)
                        : folderColorDefaults;
                }

                this._stackWidget = stackWidget;

                // 根据 layoutSettings 计算最小宽度（滑条模式需要更宽）
                // 额外加 20px padding 确保按钮完全显示
                const computeMinWidth = (layout) => {
                    if (layout && layout.weightStyle === "slider") {
                        const sw = layout.sliderWidth ?? 110;
                        const sv = layout.showWeightValue !== false ? 46 : 0;
                        return Math.max(MPL_MIN_W + 20, MPL_MIN_W + 20 + Math.max(0, sw + sv - 60));
                    }
                    return MPL_MIN_W + 20;
                };
                const initMinW = computeMinWidth(this.layoutSettings);
                this.size = [Math.max(initMinW, MPL_MIN_W), MPL_MIN_H];
                this.minWidth = initMinW;
                this.minHeight = MPL_MIN_H;

                // onResize：用户拖拽调整时强制不小于最小尺寸
                this.onResize = function(size) {
                    if (size && size[0] !== undefined && size[1] !== undefined) {
                        const curMinW = computeMinWidth(this.layoutSettings);
                        size[0] = Math.max(size[0], curMinW);
                        size[1] = Math.max(size[1], MPL_MIN_H);
                        // ComfyUI 的 DomWidget 布局会优先使用 widget.width（存在即固定），
                        // 一旦被写成具体数值，节点拉宽后嵌入 UI 仍停留在初始窄宽度。
                        // 因此这里始终保持「未设置」，让它每帧跟随 node.size[0] 动态计算。
                        if (this._mplDomWidget) {
                            try { delete this._mplDomWidget.width; } catch (e) {}
                        }
                    }
                };

                this.createDOMInterface();
                // addDOMWidget registers its resize hook after this node's
                // hook. Calling it once here keeps the DOM widget aligned
                // when a saved workflow restores a different node size.
                this._mplSyncDOMLayout?.();
                this._mplScheduleLayoutSync?.();
                return r;
            };

            // 🌟 1. 创建 DOM 界面（使用 addDOMWidget，自动跟随节点缩放）
            nodeType.prototype.createDOMInterface = function() {
                if(this.embeddedDiv) return;

                this.embeddedDiv = document.createElement("div");
                this.embeddedDiv.className = "mpl-embedded-container notranslate";
                this.embeddedDiv.setAttribute("translate", "no");
                
                // 🛑 核心修复：全域事件拦截 🛑
                // 必须配合 CSS 中的 pointer-events: auto 才能生效
                
                // A. 拦截滚轮 (防止缩放画布)
                this.embeddedDiv.addEventListener("wheel", (e) => { 
                    e.stopPropagation(); 
                }, { passive: false });

                // B. 拦截点击 (防止移动画布)
                const stopProp = (e) => { e.stopPropagation(); };
                this.embeddedDiv.addEventListener("pointerdown", stopProp);
                this.embeddedDiv.addEventListener("mousedown", stopProp);
                this.embeddedDiv.addEventListener("click", stopProp);
                this.embeddedDiv.addEventListener("dblclick", stopProp);

                // --- 列表容器 ---
                this.listContainer = document.createElement("div");
                this.listContainer.className = "mpl-list-scroll";
                
                // 拖拽文件进入的处理
                this.listContainer.ondragover = (e) => e.preventDefault();
                this.listContainer.ondrop = (e) => {
                    e.preventDefault();
                    try {
                        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                        // 从左栏拖入：预设 → 新建文件夹；收藏 → 添加 LoRA
                        if (data && (data.kind === 'mpl-preset' || data.kind === 'mpl-favorite')) {
                            this._mplNativeDropAt = Date.now();
                            this._mplApplySidePayload(data, this._mplComputeDropTarget(e.clientX, e.clientY));
                            return;
                        }
                        // 拖到列表空白处：把该 LoRA 放到根列表末尾（保持“拖出文件夹”可用）
                        if (data && (data.type === 'sort' || data.type === 'top')) {
                            e.stopPropagation();
                            if (data.type === 'top' && typeof data.tok === 'string' && data.tok.startsWith('f:')) {
                                const drop = this._mplComputeTopDropTarget(e.clientX, e.clientY);
                                if (drop && drop.tok && drop.tok !== data.tok) {
                                    this._mplPlaceToken(data.tok, drop.tok, drop.after);
                                } else {
                                    const tl = this._topLayout || [];
                                    const ti = tl.indexOf(data.tok);
                                    if (ti >= 0) tl.splice(ti, 1);
                                    tl.push(data.tok);
                                }
                                this._currentTopDrag = null;
                                this.renderEmbeddedList();
                                this.updateWidget();
                                return;
                            }
                            let item = null;
                            if (data.type === 'top' && typeof data.tok === 'string' && data.tok.startsWith('l:')) {
                                const uid = data.tok.slice(2);
                                item = (this.loraData.loras || []).find(l => this._uidFor(l) === uid) || null;
                                if (!item) {
                                    for (const f of (this.loraData.folders || [])) {
                                        item = (f.loras || []).find(l => this._uidFor(l) === uid) || null;
                                        if (item) break;
                                    }
                                }
                            } else if (data.type === 'sort' && data.sourceLIdx !== undefined) {
                                if (data.sourceType === 'root') item = (this.loraData.loras || [])[data.sourceLIdx] || null;
                                else if (data.sourceType === 'folder') {
                                    const f = (this.loraData.folders || [])[data.sourceFIdx];
                                    item = f ? (f.loras || [])[data.sourceLIdx] : null;
                                }
                            }
                            if (!item) return;
                            const topDrop = this._mplComputeTopDropTarget(e.clientX, e.clientY);
                            const movedTok = "l:" + this._uidFor(item);
                            if (!(this.loraData.loras || []).includes(item)) {
                                for (const f of (this.loraData.folders || [])) {
                                    const i = (f.loras || []).indexOf(item);
                                    if (i >= 0) { f.loras.splice(i, 1); break; }
                                }
                                this.loraData.loras.push(item);
                            }
                            if (topDrop && topDrop.tok && topDrop.tok !== movedTok) {
                                this._mplPlaceToken(movedTok, topDrop.tok, topDrop.after);
                            } else {
                                const tl = this._topLayout || [];
                                const i = tl.indexOf(movedTok);
                                if (i >= 0) tl.splice(i, 1);
                                tl.push(movedTok);
                            }
                            this._currentTopDrag = null;
                            this._currentSortDrag = null;
                            this.renderEmbeddedList();
                            this.updateWidget();
                            return;
                        }
                        if (data.type === 'folder') {
                            if (data.fIdx >= 0 && data.fIdx < this.loraData.folders.length) {
                                const srcFolder = this.loraData.folders[data.fIdx];
                                if (data.lIdx >= 0 && data.lIdx < srcFolder.loras.length) {
                                    const loraItem = JSON.parse(JSON.stringify(srcFolder.loras[data.lIdx]));
                                    srcFolder.loras.splice(data.lIdx, 1);
                                    this.loraData.loras.push(loraItem);
                                    this.renderEmbeddedList();
                                    this.updateWidget(); 
                                }
                            }
                        }
                    } catch(err) {
                        console.error("拖拽到根列表错误:", err);
                    }
                };

                // 节点内不再保留左侧栏（预设分类 / 收藏夹已经整合进「📂预设」弹窗），
                // 只保留 LoRA 列表 + 底栏，节点更紧凑、宽度也能完整铺满。
                this.embeddedDiv.appendChild(this.listContainer);

                // --- Klein 模式提示 Banner（检测到 Klein 模型但未启用对应模式时显示）---
                this._kleinBannerEl = null;

                // --- 底部按钮区 ---
                const footer = document.createElement("div");
                footer.className = "mpl-footer";
                
                const createBtn = (txt, cls, cb) => {
                    const b = document.createElement("button");
                    b.textContent = txt; b.className = cls; b.onclick = cb; return b;
                };
                footer.append(
                    createBtn("➕ 添加 Lora", "mpl-btn-add", () => this.showAddLoraModal()),
                    createBtn("📥 一键下载信息", "mpl-btn-metadata", () => this.showBatchMetadataModal()),
                    createBtn("📁+", "mpl-btn-icon", () => this.addFolder()),
                    createBtn("📂预设", "mpl-btn-icon", () => this.loadPresetModal()),
                    createBtn("⚙️设置", "mpl-btn-icon", () => this.showSettingsModal())
                );
                this.embeddedDiv.appendChild(footer);
                this._updateKleinBanner();

                // 使用 addDOMWidget 将 UI 添加到节点内部，自动跟随节点缩放
                this._mplDomWidget = this.addDOMWidget("mpl_ui", "div", this.embeddedDiv, {
                    serialize: false,
                    hideOnZoom: false,
                });

                this.injectStyles();
                this.renderEmbeddedList();
                this.updateWidget(); 
                this._mplInstallLayoutGuard();
            };

            nodeType.prototype._mplSyncDOMLayout = function() {
                if (!this.embeddedDiv) return;
                this.embeddedDiv.style.width = "100%";
                this.embeddedDiv.style.maxWidth = "none";
                this.embeddedDiv.style.boxSizing = "border-box";
                // 不给 _mplDomWidget.width 赋值：保持“跟随节点宽度”的默认行为，
                // 否则工作流载入 / 手动缩放后会残留旧宽度，UI 被挤成窄条。
                if (this._mplDomWidget && this._mplDomWidget.width !== undefined) {
                    try { delete this._mplDomWidget.width; } catch (e) {}
                }
                if (this._mplDomWidget?.options?.afterResize) {
                    this._mplDomWidget.options.afterResize.call(this._mplDomWidget, this);
                }
                this.onResize?.(this.size);
                this.setDirtyCanvas?.(true, true);
            };
            nodeType.prototype._mplGuardLayout = function() {
                if (!this.embeddedDiv || this._mplGuardBusy) return;
                this._mplGuardBusy = true;
                try {
                    const minW = this.minWidth || (MPL_MIN_W + 20);
                    let changed = false;
                    const sw = Number(this.size?.[0]);
                    const sh = Number(this.size?.[1]);
                    if (Number.isFinite(sw) && sw > 0 && sw < minW - 0.5) {
                        const h = Math.max(Number.isFinite(sh) ? sh : 0, MPL_MIN_H);
                        this.size[0] = minW;
                        this.size[1] = h;
                        try { this.setSize?.([minW, h]); } catch (e) {}
                        changed = true;
                    }
                    const w = this._mplDomWidget;
                    if (w && w.width != null) {
                        try { delete w.width; } catch (e) { w.width = null; }
                        changed = true;
                    }
                    if (changed) this.setDirtyCanvas?.(true, true);
                } finally {
                    this._mplGuardBusy = false;
                }
            };
            nodeType.prototype._mplInstallLayoutGuard = function() {
                if (this._mplGuardInstalled) return;
                this._mplGuardInstalled = true;
                this._mplGuardTimer = setInterval(() => {
                    try { this._mplGuardLayout?.(); } catch (e) {}
                }, 600);
            };
            // 文件夹头部上下边缘：拖 LoRA 时插到该文件夹前/后；中间仍拖入文件夹
            nodeType.prototype._mplFolderHeaderDropEdge = function(fDiv, y) {
                const header = fDiv?.querySelector(":scope > .mpl-folder-header");
                const r = (header || fDiv)?.getBoundingClientRect();
                if (!r) return "";
                const band = Math.min(14, Math.max(8, r.height * 0.35));
                if (y <= r.top + band) return "before";
                if (y >= r.bottom - band) return "after";
                return "";
            };
            nodeType.prototype._mplScheduleLayoutSync = function() {
                if (this._mplLayoutSyncTimers) {
                    this._mplLayoutSyncTimers.forEach(t => clearTimeout(t));
                }
                this._mplLayoutSyncTimers = [];
                const run = () => {
                    try { this._mplSyncDOMLayout(); } catch (e) {}
                    try { this._mplRefreshStatusBar(); } catch (e) {}
                };
                [0, 50, 150, 350, 800].forEach(ms => {
                    this._mplLayoutSyncTimers.push(setTimeout(run, ms));
                });
                if (!this._mplResizeObserver && typeof ResizeObserver !== "undefined" && this.embeddedDiv) {
                    try {
                        this._mplResizeObserver = new ResizeObserver(() => {
                            const w = this.embeddedDiv ? this.embeddedDiv.clientWidth : 0;
                            if (this.size?.[0] && w !== this.size[0]) {
                                this.setDirtyCanvas?.(true, true);
                            }
                        });
                        this._mplResizeObserver.observe(this.embeddedDiv);
                    } catch (e) {}
                }
            };

            nodeType.prototype._mplComputeDropTarget = function(x, y) {
                const el = document.elementFromPoint(x, y);
                if (!el || !el.closest(".mpl-list-scroll")) return null;
                const rowEl = el.closest(".mpl-lora-row");
                const folderEl = el.closest(".mpl-folder-row");
                if (rowEl) {
                    if (folderEl) {
                        const fIdx = parseInt(folderEl.dataset.fidx, 10);
                        const folder = (this.loraData.folders || [])[fIdx];
                        if (!folder) return null;
                        const rows = Array.from(folderEl.querySelectorAll(":scope > .mpl-lora-row"));
                        const lIdx = rows.indexOf(rowEl);
                        const r = rowEl.getBoundingClientRect();
                        return { kind: "folder", fIdx, lIdx: lIdx < 0 ? (folder.loras || []).length : lIdx, after: y > r.top + r.height / 2, token: "f:" + this._uidFor(folder) };
                    }
                    const rows = Array.from(this.listContainer.querySelectorAll(":scope > .mpl-lora-row"));
                    const idx = rows.indexOf(rowEl);
                    const lTokens = (this._topLayout || []).filter(t => String(t).startsWith("l:"));
                    const token = idx >= 0 ? lTokens[idx] : null;
                    const r = rowEl.getBoundingClientRect();
                    return { kind: "root", idx: idx < 0 ? 0 : idx, after: y > r.top + r.height / 2, token: token || null };
                }
                if (folderEl) {
                    const fIdx = parseInt(folderEl.dataset.fidx, 10);
                    const folder = (this.loraData.folders || [])[fIdx];
                    if (!folder) return null;
                    return { kind: "folder", fIdx, lIdx: (folder.loras || []).length, after: false, token: "f:" + this._uidFor(folder) };
                }
                return { kind: "end" };
            };

            nodeType.prototype._mplTopTokenForEl = function(el) {
                if (!el) return null;
                if (el.classList.contains("mpl-folder-row")) {
                    const f = (this.loraData.folders || [])[parseInt(el.dataset.fidx, 10)];
                    return f ? "f:" + this._uidFor(f) : null;
                }
                if (el.classList.contains("mpl-lora-row") && this.listContainer && el.parentElement === this.listContainer) {
                    const rows = Array.from(this.listContainer.querySelectorAll(":scope > .mpl-lora-row"));
                    const lTokens = (this._topLayout || []).filter(t => String(t).startsWith("l:"));
                    const idx = rows.indexOf(el);
                    return idx >= 0 && lTokens[idx] ? lTokens[idx] : null;
                }
                return null;
            };

            nodeType.prototype._mplComputeTopDropTarget = function(x, y) {
                const el = document.elementFromPoint(x, y);
                if (!el || !el.closest(".mpl-list-scroll")) return null;
                const folderEl = el.closest(".mpl-folder-row");
                if (folderEl) {
                    const tok = this._mplTopTokenForEl(folderEl);
                    if (tok) {
                        const r = folderEl.getBoundingClientRect();
                        return { tok, after: y > r.top + r.height / 2 };
                    }
                }
                const rowEl = el.closest(".mpl-lora-row");
                if (rowEl && rowEl.parentElement === this.listContainer) {
                    const tok = this._mplTopTokenForEl(rowEl);
                    if (tok) {
                        const r = rowEl.getBoundingClientRect();
                        return { tok, after: y > r.top + r.height / 2 };
                    }
                }
                const kids = Array.from(this.listContainer.children).filter(k =>
                    k.classList.contains("mpl-folder-row") || k.classList.contains("mpl-lora-row"));
                for (const k of kids) {
                    const r = k.getBoundingClientRect();
                    if (y < r.top) {
                        const tok = this._mplTopTokenForEl(k);
                        if (tok) return { tok, after: false };
                    } else if (y <= r.bottom) {
                        const tok = this._mplTopTokenForEl(k);
                        if (tok) return { tok, after: y > r.top + r.height / 2 };
                    }
                }
                return null;
            };

            nodeType.prototype._mplApplySidePayload = function(payload, drop) {
                if (!payload) return;
                if (payload.kind === "mpl-preset") this._mplApplyPreset(payload.name, drop);
                else if (payload.kind === "mpl-favorite") this._mplAddLoraByName(payload.name, drop);
            };

            nodeType.prototype._mplSideMenu = function(x, y, items) {
                const old = document.querySelector(".mpl-ctx-menu");
                if (old) old.remove();
                const menu = document.createElement("div");
                menu.className = "mpl-ctx-menu";
                menu.style.cssText = "position:fixed;z-index:10030;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.72);padding:5px;min-width:150px;font-size:12.5px;color:#f4f4f5;";
                menu.style.left = x + "px";
                menu.style.top = y + "px";
                const close = () => { menu.remove(); document.removeEventListener("mousedown", onDown, true); };
                const onDown = (ev) => { if (!menu.contains(ev.target)) close(); };
                items.forEach(it => {
                    const row = document.createElement("div");
                    row.style.cssText = "padding:7px 11px;border-radius:7px;cursor:pointer;white-space:nowrap;" + (it.danger ? "color:#f87171;" : "color:#d4d4d8;");
                    row.textContent = it.label;
                    row.onmouseenter = () => row.style.background = it.danger ? "rgba(239,68,68,0.14)" : "rgba(99,102,241,0.16)";
                    row.onmouseleave = () => row.style.background = "transparent";
                    row.onclick = (ev) => { ev.stopPropagation(); close(); it.fn(); };
                    menu.appendChild(row);
                });
                document.body.appendChild(menu);
                const r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + "px";
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + "px";
                setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
            };

            // ---------- 预设操作 ----------
            nodeType.prototype._mplApplyPreset = function(name, drop) {
                const folders = mplPresetFolders(MPL_SIDEBAR.presets[name]);
                if (!folders.length) { void mplAlert("该预设没有可用的 LoRA"); return; }
                const added = [];
                folders.forEach(f => {
                    const copy = JSON.parse(JSON.stringify(f));
                    delete copy._uid;
                    copy.name = copy.name || name;
                    (copy.loras || []).forEach(l => { delete l._uid; l.enabled = mplLoraEnabled(l); mplDecorateNewLora(l); });
                    this.loraData.folders.push(copy);
                    added.push(copy);
                });
                const refTok = drop && drop.token;
                if (refTok && Array.isArray(this._topLayout) && added.length) {
                    let ref = refTok, after = !!drop.after;
                    added.forEach(f => {
                        const tok = "f:" + this._uidFor(f);
                        this._mplPlaceToken(tok, ref, after);
                        ref = tok; after = true;
                    });
                }
                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype._mplPresetMenu = function(name, x, y) {
                this._mplSideMenu(x || 200, y || 200, [{
                    label: "重命名预设", fn: async () => {
                        const nn = await mplAsk("重命名预设", name, { message: "输入新的预设名称：" });
                        if (!nn || !nn.trim() || nn.trim() === name) return;
                        const newName = nn.trim();
                        try {
                            const resp = await api.fetchApi("/ma/lora/rename_preset", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ old: name, new: newName }),
                            });
                            const rj = await resp.json();
                            if (!rj || rj.status !== "success") {
                                await mplAlert("重命名失败：" + ((rj && rj.message) || "未知错误"));
                                return;
                            }
                            await mplLoadSidebar(true);
                            mplRefreshAllSidebars();
                        } catch (e) {
                            await mplAlert("重命名失败：" + e);
                        }
                    }
                }, {
                    label: "删除预设：" + name, danger: true, fn: async () => {
                        if (!(await mplConfirm(`确定要删除预设 "${name}" 吗？`, { danger: true, okText: "删除" }))) return;
                        await api.fetchApi("/ma/lora/delete_preset", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name }),
                        }).catch(() => {});
                        delete MPL_SIDEBAR.presets[name];
                        delete MPL_SIDEBAR.assignments[name];
                        await mplLoadSidebar(true);
                        mplRefreshAllSidebars();
                    }
                }]);
            };

            nodeType.prototype._mplDropFolderAsPreset = async function(e, category) {
                let presetName = "";
                try {
                    const rawPreset = e.dataTransfer.getData("text/plain");
                    if (rawPreset) {
                        const pj = JSON.parse(rawPreset);
                        if (pj && pj.kind === "mpl-preset") presetName = pj.name || "";
                    }
                } catch (_) {}
                if (presetName) {
                    if (category) MPL_SIDEBAR.assignments[presetName] = category;
                    else delete MPL_SIDEBAR.assignments[presetName];
                    mplSavePresetMeta().then(() => mplRefreshAllSidebars());
                    return;
                }

                let tok = "";
                try {
                    const raw = e.dataTransfer.getData("application/x-mpl-folder");
                    if (raw) tok = JSON.parse(raw).tok || "";
                } catch (_) {}
                if (!tok) return;
                const uid = String(tok).slice(2);
                const folder = (this.loraData.folders || []).find(f => this._uidFor(f) === uid);
                if (!folder) return;
                const def = folder.name || "预设";
                const name = await mplAsk("保存为预设", def, {
                    message: category ? `保存到分类「${category}」，预设名称：` : "预设名称：",
                });
                if (!name || !name.trim()) return;
                const content = { folders: [JSON.parse(JSON.stringify(folder))] };
                delete content.folders[0]._uid;
                (content.folders[0].loras || []).forEach(l => delete l._uid);
                api.fetchApi("/ma/lora/save_preset", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name.trim(), content, category }),
                }).then(() => mplLoadSidebar(true)).then(() => mplRefreshAllSidebars())
                  .catch((err) => void mplAlert("保存预设失败: " + err));
            };

            nodeType.prototype._mplNewPresetCategory = async function() {
                const name = await mplAsk("新建预设分类", "", { message: "给这个分类起个名字：" });
                if (!name || !name.trim()) return;
                const n = name.trim();
                if (!MPL_SIDEBAR.categories.includes(n)) MPL_SIDEBAR.categories.push(n);
                await mplSavePresetMeta();
                mplRefreshAllSidebars();
            };

            // ---------- LORA 串导入弹窗（支持 <lora:名称:模型权重:CLIP权重> + 近似匹配） ----------
            nodeType.prototype.showLoraStringModal = async function() {
                document.querySelectorAll(".mpl-lorastring-overlay").forEach(el => el.remove());
                try { await loadLoraNameList(); } catch (e) {}
                try { await mplLoadExtraInfo(); } catch (e) {}

                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop mpl-lorastring-overlay";
                overlay.style.cssText = "position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;";

                const box = document.createElement("div");
                box.className = "ma-modal ma-modal-static-anim";
                box.style.cssText = "box-sizing:border-box;width:min(640px,94vw);max-height:86vh;display:flex;flex-direction:column;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.78);color:#f4f4f5;font:12.5px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;overflow:hidden;";

                const head = document.createElement("div");
                head.style.cssText = "padding:14px 18px;background:#151519;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:10px;";
                const hTitle = document.createElement("div");
                hTitle.textContent = "📋 导入 LORA 串";
                hTitle.style.cssText = "font-size:14.5px;font-weight:650;flex:1;";
                const closeX = document.createElement("button");
                closeX.type = "button";
                closeX.textContent = "✕";
                closeX.className = "ma-btn";
                closeX.style.cssText = "padding:2px 8px;background:transparent;border-color:transparent;color:#a1a1aa;";
                closeX.onclick = () => overlay.remove();
                head.append(hTitle, closeX);

                const body = document.createElement("div");
                body.style.cssText = "padding:14px 18px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;flex:1;";

                const tip = document.createElement("div");
                tip.textContent = "粘贴 <lora:名称:模型权重:CLIP权重>（或每行 名称:权重）。自动忽略常见模型前缀（krea2/k2/anima 等）并容忍拼写/OCR 轻微差异，导入时自动同步触发词与作者推荐权重。";
                tip.style.cssText = "font-size:11.5px;color:#a1a1aa;line-height:1.55;";

                const ta = document.createElement("textarea");
                ta.className = "ma-input";
                ta.rows = 4;
                ta.placeholder = "示例：<lora:style_v1:0.8:0.7> <lora:detailer:0.5>";
                ta.style.cssText = "width:100%;box-sizing:border-box;background:#09090b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#f4f4f5;padding:9px 11px;font:12px/1.5 Consolas,monospace;resize:vertical;min-height:76px;";

                const nameRow = document.createElement("div");
                nameRow.style.cssText = "display:flex;align-items:center;gap:8px;";
                const nameLab = document.createElement("span");
                nameLab.textContent = "新建群组名：";
                nameLab.style.cssText = "font-size:12px;color:#a1a1aa;white-space:nowrap;";
                const nameInput = document.createElement("input");
                nameInput.type = "text";
                nameInput.className = "ma-input";
                nameInput.value = "LORA串";
                nameInput.placeholder = "留空则直接添加到根列表";
                nameInput.style.cssText = "flex:1;padding:6px 10px;font-size:12px;";
                nameRow.append(nameLab, nameInput);

                const count = document.createElement("div");
                count.style.cssText = "font-size:11.5px;color:#a1a1aa;min-height:18px;";

                const list = document.createElement("div");
                list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;";

                let parsed = [];
                const renderParsed = () => {
                    list.innerHTML = "";
                    parsed.forEach((it) => {
                        const row = document.createElement("div");
                        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;background:#18181c;border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:12px;";
                        const chk = document.createElement("input");
                        chk.type = "checkbox";
                        chk.checked = it.enabled !== false;
                        chk.style.cssText = "accent-color:#6366f1;cursor:pointer;";
                        chk.onchange = () => { it.enabled = chk.checked; };
                        const nm = document.createElement("span");
                        nm.textContent = (it.name.split(/[/\\]/).pop() || it.name).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "");
                        nm.title = it._fuzzy ? `${it._rawName} → ${it.name}` : it.name;
                        nm.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (it._found ? (it._fuzzy ? "#fbbf24" : "#f4f4f5") : "#f87171") + ";";
                        const mkWeight = (label, value, key, color) => {
                            const el = document.createElement("span");
                            el.textContent = label + " " + Number(value).toFixed(2);
                            el.title = key === "clipWeight"
                                ? (mplClipFollowsWeight(it) ? "CLIP 跟随模型权重\n右键改为自定义" : "CLIP 自定义权重\n右键恢复跟随")
                                : "单击修改模型权重";
                            el.style.cssText = "color:" + color + ";min-width:56px;text-align:right;cursor:pointer;font-family:Consolas,monospace;font-size:11.5px;";
                            el.onclick = async () => {
                                const v = await mplEditValueAt(el, value, { label: key === "weight" ? "M" : "C" });
                                if (v === null) return;
                                if (key === "weight") {
                                    const n = parseFloat(v);
                                    if (!Number.isFinite(n)) return;
                                    it.weight = mplClampWeight(n);
                                    mplSyncClipWeight(it);
                                } else {
                                    if (!mplSetCustomClipWeight(it, v)) return;
                                }
                                renderParsed();
                            };
                            if (key === "clipWeight") {
                                el.oncontextmenu = (e) => {
                                    e.preventDefault();
                                    mplToggleClipFollow(it);
                                    renderParsed();
                                };
                            }
                            return el;
                        };
                        const mw = mkWeight("M", mplLoraWeight(it), "weight", "#a5b4fc");
                        const cw = mkWeight("C", mplClipWeightValue(it), "clipWeight", mplClipFollowsWeight(it) ? "#71717a" : "#34d399");
                        row.append(chk, nm, mw, cw);
                        list.appendChild(row);
                    });
                    const ok = parsed.filter(x => x._found).length;
                    const fuzzy = parsed.filter(x => x.enabled && x._matchCandidates?.length).length;
                    count.textContent = parsed.length
                        ? ("解析到 " + parsed.length + " 个 LoRA，本机定位 " + ok + " 个" +
                            (parsed.length - ok ? "（未定位的会保留，加载时按缺失提示）" : "") +
                            (fuzzy ? `；近似匹配 ${fuzzy} 个，加入时会确认` : ""))
                        : "请粘贴 LORA 串进行解析";
                };
                const parseAndRender = () => {
                    parsed = mplParseLoraString(ta.value);
                    renderParsed();
                };
                ta.oninput = parseAndRender;

                const btns = document.createElement("div");
                btns.style.cssText = "padding:12px 18px;background:#151519;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;gap:8px;";
                const mkBtn = (text, primary, fn) => {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.className = primary ? "ma-btn ma-btn-primary" : "ma-btn";
                    b.textContent = text;
                    b.onclick = fn;
                    return b;
                };
                const collect = async () => {
                    const matches = parsed.filter(x => x.enabled && x._matchCandidates?.length);
                    if (matches.length && !(await mplChooseLoraMatches(matches))) return null;
                    const items = parsed.filter(x => x.enabled).map(x => {
                        const c = Object.assign({}, x);
                        delete c._found;
                        delete c._rawName;
                        delete c._fuzzy;
                        delete c._matchCandidates;
                        return mplDecorateNewLora(c);
                    });
                    if (!items.length) { void mplAlert("没有可加入的 LoRA"); return null; }
                    return items;
                };
                const addToNode = (groupName, items) => {
                    if (groupName) {
                        this.loraData.folders.push({ name: groupName, loras: items, collapsed: false });
                    } else {
                        items.forEach(it => this.loraData.loras.push(it));
                    }
                    this.renderEmbeddedList();
                    this.updateWidget();
                };
                btns.appendChild(mkBtn("取消", false, () => overlay.remove()));
                btns.appendChild(mkBtn("直接加入根列表", false, async () => {
                    const items = await collect();
                    if (!items) return;
                    addToNode("", items);
                    overlay.remove();
                }));
                btns.appendChild(mkBtn("加入为群组", true, async () => {
                    const items = await collect();
                    if (!items) return;
                    addToNode(nameInput.value.trim() || "LORA串", items);
                    overlay.remove();
                }));

                body.append(tip, ta, nameRow, count, list);
                box.append(head, body, btns);
                overlay.appendChild(box);
                ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"].forEach(ev => {
                    overlay.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === "wheel" });
                });
                overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
                document.body.appendChild(overlay);
                parseAndRender();
                setTimeout(() => { try { ta.focus(); } catch (e) {} }, 30);
            };

            nodeType.prototype._mplCategoryMenu = function(e, name, isCat) {
                const idx = MPL_SIDEBAR.categories.indexOf(name);
                const items = [{
                    label: "重命名分类", fn: async () => {
                        const nn = await mplAsk("重命名分类", name, { message: "输入新的分类名称：" });
                        if (!nn || !nn.trim()) return;
                        const v = nn.trim();
                        MPL_SIDEBAR.categories[idx] = v;
                        Object.keys(MPL_SIDEBAR.assignments).forEach(k => {
                            if (MPL_SIDEBAR.assignments[k] === name) MPL_SIDEBAR.assignments[k] = v;
                        });
                        mplSavePresetMeta().then(() => mplRefreshAllSidebars());
                    }
                }, {
                    label: "删除分类（预设保留在未分类）", danger: true, fn: async () => {
                        if (!(await mplConfirm(`删除分类 "${name}"？分类里的预设会移到「未分类」。`, { danger: true, okText: "删除" }))) return;
                        MPL_SIDEBAR.categories.splice(idx, 1);
                        Object.keys(MPL_SIDEBAR.assignments).forEach(k => {
                            if (MPL_SIDEBAR.assignments[k] === name) delete MPL_SIDEBAR.assignments[k];
                        });
                        mplSavePresetMeta().then(() => mplRefreshAllSidebars());
                    }
                }];
                this._mplSideMenu(e.clientX, e.clientY, items);
            };

            // ---------- 收藏夹操作 ----------
            // 右键菜单「加入收藏夹」：选一个已有收藏夹，或者现场新建一个
            nodeType.prototype._mplAddLoraToFavoriteMenu = async function(name, x, y) {
                if (!name) return;
                try { await mplLoadSidebar(); } catch (e) {}
                const cols = Array.isArray(MPL_SIDEBAR.favorites) ? MPL_SIDEBAR.favorites : (MPL_SIDEBAR.favorites = []);
                const addTo = async (colName) => {
                    let col = cols.find(c => c.name === colName);
                    if (!col) {
                        col = { name: colName, items: [] };
                        cols.push(col);
                    }
                    col.items = col.items || [];
                    if (col.items.includes(name)) return;
                    col.items.push(name);
                    await mplSaveFavorites();
                    mplRefreshAllSidebars();
                };
                if (!cols.length) {
                    const nn = await mplAsk("新建收藏夹", "我的收藏", { message: "给这个收藏夹起个名字：" });
                    if (nn && nn.trim()) void addTo(nn.trim());
                    return;
                }
                const items = cols.map(c => ({
                    label: "收藏到：" + c.name,
                    fn: () => { void addTo(c.name); },
                }));
                items.push({
                    label: "＋ 新建收藏夹…",
                    fn: async () => {
                        const nn = await mplAsk("新建收藏夹", "", { message: "给这个收藏夹起个名字：" });
                        if (nn && nn.trim()) void addTo(nn.trim());
                    },
                });
                this._mplSideMenu(x || 240, y || 240, items);
            };

            nodeType.prototype._mplAddLoraByName = function(name, drop) {
                if (!name) return;
                const lora = mplDecorateNewLora({
                    name, weight: 1.0, enabled: true, tags: "", note: "", triggerWords: "", jsonInfo: "", logInfo: "",
                });
                if (drop && drop.kind === "folder") {
                    const folder = (this.loraData.folders || [])[drop.fIdx];
                    if (folder) {
                        folder.loras = folder.loras || [];
                        const at = Math.max(0, Math.min(folder.loras.length, (drop.lIdx || 0) + (drop.after ? 1 : 0)));
                        folder.loras.splice(at, 0, lora);
                        folder.collapsed = false;
                        this.renderEmbeddedList();
                        this.updateWidget();
                        return;
                    }
                }
                this.loraData.loras.push(lora);
                if (drop && drop.token && Array.isArray(this._topLayout)) {
                    this._mplPlaceToken("l:" + this._uidFor(lora), drop.token, !!drop.after);
                }
                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype._mplDropLoraIntoFavorite = function(e, collectionName) {
                let name = "";
                try {
                    const raw = e.dataTransfer.getData("application/x-mpl-lora");
                    if (raw) name = JSON.parse(raw).name || "";
                } catch (_) {}
                if (!name) return;
                const col = MPL_SIDEBAR.favorites.find(c => c.name === collectionName);
                if (!col) return;
                col.items = col.items || [];
                if (!col.items.includes(name)) {
                    col.items.push(name);
                    mplSaveFavorites().then(() => mplRefreshAllSidebars());
                }
            };

            nodeType.prototype._mplRemoveFavorite = function(name, collectionName) {
                const col = MPL_SIDEBAR.favorites.find(c => c.name === collectionName);
                if (!col) return;
                col.items = (col.items || []).filter(n => n !== name);
                mplSaveFavorites().then(() => mplRefreshAllSidebars());
            };

            nodeType.prototype._mplDropLoraLoose = function(e) {
                let name = "";
                try {
                    const raw = e.dataTransfer.getData("application/x-mpl-lora");
                    if (raw) name = JSON.parse(raw).name || "";
                } catch (_) {}
                if (!name) return;
                const addTo = (col) => {
                    col.items = col.items || [];
                    if (!col.items.includes(name)) {
                        col.items.push(name);
                        mplSaveFavorites().then(() => mplRefreshAllSidebars());
                    }
                };
                const cols = MPL_SIDEBAR.favorites;
                if (cols.length === 0) {
                    const col = { name: "我的收藏", items: [] };
                    MPL_SIDEBAR.favorites.push(col);
                    addTo(col);
                } else if (cols.length === 1) {
                    addTo(cols[0]);
                } else {
                    this._mplSideMenu(e.clientX, e.clientY, cols.map(c => ({
                        label: "收藏到：" + c.name,
                        fn: () => addTo(c),
                    })));
                }
            };

            nodeType.prototype._mplNewFavoriteCollection = async function() {
                const name = await mplAsk("新建收藏夹", "", { message: "给这个收藏夹起个名字：" });
                if (!name || !name.trim()) return;
                const n = name.trim();
                if (!MPL_SIDEBAR.favorites.some(c => c.name === n)) {
                    MPL_SIDEBAR.favorites.push({ name: n, items: [] });
                }
                await mplSaveFavorites();
                mplRefreshAllSidebars();
            };

            nodeType.prototype._mplFavoriteMenu = function(e, name) {
                const items = [{
                    label: "重命名收藏夹", fn: async () => {
                        const nn = await mplAsk("重命名收藏夹", name, { message: "输入新的收藏夹名称：" });
                        if (!nn || !nn.trim()) return;
                        const col = MPL_SIDEBAR.favorites.find(c => c.name === name);
                        if (col) col.name = nn.trim();
                        mplSaveFavorites().then(() => mplRefreshAllSidebars());
                    }
                }, {
                    label: "删除收藏夹", danger: true, fn: async () => {
                        if (!(await mplConfirm(`删除收藏夹 "${name}"？`, { danger: true, okText: "删除" }))) return;
                        MPL_SIDEBAR.favorites = MPL_SIDEBAR.favorites.filter(c => c.name !== name);
                        mplSaveFavorites().then(() => mplRefreshAllSidebars());
                    }
                }];
                this._mplSideMenu(e.clientX, e.clientY, items);
            };

            // 🌟 3. 注入 CSS (保留原有 Linear/Vercel 暗黑主题色盘，融合双栏与卡片细节)
            nodeType.prototype.injectStyles = function() {
                if(document.getElementById("mpl-styles")) return;
                const s = document.createElement("style");
                s.id = "mpl-styles";
                s.innerHTML = `
                    .mpl-embedded-container {
                        --ma-panel-bg: #111114;
                        --ma-surface: #18181c;
                        --ma-surface-raised: #222228;
                        --ma-text: #f4f4f5;
                        --ma-muted: #a1a1aa;
                        --ma-border: rgba(255,255,255,0.08);
                        --ma-accent: #6366f1;
                        --ma-accent-soft: rgba(99,102,241,0.16);
                        --ma-danger: #ef4444;
                        --ma-warn: #f59e0b;
                        --ma-success: #10b981;
                        display: flex;
                        flex-direction: column;
                        background: var(--ma-panel-bg);
                        border-radius: 10px;
                        border: 1px solid var(--ma-border);
                        color: var(--ma-text);
                        pointer-events: auto;
                        overflow: hidden;
                        box-sizing: border-box;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif;
                        font-size: 12px;
                        /* 始终铺满节点：ComfyUI 会按 widget 可用区域给高度 */
                        width: 100%;
                        height: 100%;
                        min-height: 0;
                        max-height: none;
                        --comfy-widget-min-height: 220px;
                        --comfy-widget-height: 100%;
                    }
                    .mpl-list-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; background: #09090b; pointer-events: auto; }
                    .mpl-list-scroll::-webkit-scrollbar { width: 7px; }
                    .mpl-list-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 6px; }
                    .mpl-list-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
                    .mpl-empty-hint {
                        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
                        padding: 26px 10px; color: var(--ma-muted); font-size: 12px; text-align: center;
                    }
                    .mpl-empty-hint b { color: #d4d4d8; font-weight: 600; }
                    .mpl-footer {
                        height: 38px; background: #141418; border-top: 1px solid var(--ma-border);
                        display: flex; align-items: center; padding: 0 6px; gap: 5px; pointer-events: auto;
                    }
                    .mpl-folder-row {
                        background: var(--folder-bg, var(--folder-def-outer, var(--ma-surface)));
                        margin-bottom: 6px; border-radius: 8px; overflow: hidden;
                        border: 1px solid var(--ma-border); border-left: 4px solid transparent;
                    }
                    .mpl-folder-row.has-sel {
                        border-left: 4px solid var(--folder-c, var(--folder-def-bar, var(--ma-accent)));
                    }
                    .mpl-folder-ignore {
                        width: 22px; height: 22px; padding: 0; margin: 0 2px;
                        box-sizing: border-box;
                        display: inline-flex; align-items: center; justify-content: center; line-height: 0;
                        background: transparent; border: 2px solid transparent; border-radius: 50%;
                        color: var(--folder-normal-color, var(--folder-ignore-color, #8fb8e8));
                        cursor: pointer; flex: 0 0 auto; transition: all 0.14s;
                    }
                    .mpl-folder-ignore svg { display: block; flex: 0 0 auto; vertical-align: middle; shape-rendering: geometricPrecision; }
                    .mpl-folder-ignore:not(.active) svg * { stroke-width: 2.1; }
                    .mpl-folder-ignore:not(.active) svg > ellipse { fill: color-mix(in srgb, currentColor 22%, transparent); }
                    .mpl-folder-ignore:not(.active) svg > circle { fill: transparent; }
                    .mpl-folder-ignore:not(.active):hover svg > ellipse { fill: color-mix(in srgb, currentColor 34%, transparent); }
                    .mpl-folder-ignore:hover { background: transparent; border-color: transparent; }
                    .mpl-folder-ignore.active {
                        background: color-mix(in srgb, var(--folder-ignore-color, #8fb8e8) 28%, transparent);
                        border-color: var(--folder-ignore-color, rgba(159,200,242,0.72));
                        color: var(--folder-ignore-color, #b7dbff);
                    }
                    .mpl-folder-row.ignored {
                        border-left: 4px dashed var(--folder-ignore-color, #8fb8e8) !important;
                        background: color-mix(in srgb, var(--folder-ignore-color, #8fb8e8) 7%, var(--ma-surface)) !important;
                    }
                    .mpl-folder-row.ignored .mpl-folder-header {
                        background: color-mix(in srgb, var(--folder-ignore-color, #8fb8e8) 14%, transparent) !important;
                        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--folder-ignore-color, #8fb8e8) 32%, transparent);
                    }
                    .mpl-folder-row.ignored .mpl-folder-title,
                    .mpl-folder-row.ignored .mpl-folder-title:hover { color: var(--folder-ignore-color, #9fc8f2) !important; }
                    .mpl-folder-row.ignored .mpl-folder-header input[type="checkbox"] { opacity: .45 !important; }
                    .mpl-folder-row.ignored .mpl-lora-row { opacity: .5 !important; }
                    .mpl-folder-row .mpl-lora-row { margin-left: 4px; }
                    .mpl-folder-row.drag-over {
                        border: 2px dashed var(--mpl-folder-drop-color, #ffd166) !important;
                        box-shadow: 0 0 0 2px var(--mpl-folder-drop-glow, rgba(255,209,102,0.48)),
                                    0 0 14px var(--mpl-folder-drop-glow, rgba(255,209,102,0.36)) !important;
                    }
                    .mpl-folder-header {
                        padding: 5px 8px; color: var(--ma-text); cursor: pointer; display: flex; align-items: center; gap: 5px;
                        font-weight: 600; font-size: 12.5px; min-height: 30px;
                        background: var(--folder-head-bg, var(--folder-def-inner, linear-gradient(180deg, rgba(255,255,255,0.04), transparent)));
                        border-bottom: 1px solid rgba(255,255,255,0.04);
                    }
                    .mpl-folder-title { border-bottom: 1px dashed transparent; flex: 0 0 auto; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .mpl-folder-title:hover { color: #818cf8; border-color: var(--ma-border); }
                    .mpl-folder-controls { display: flex; align-items: center; gap: 4px; margin-left: auto; }
                    .mpl-lora-row {
                        display: flex; align-items: center; gap: 5px; padding: 3px 6px; margin: 1px 0;
                        background: transparent; border: 1px solid transparent; border-left: 3px solid transparent;
                        border-radius: 7px; cursor: pointer; transition: background .12s, border-color .12s;
                    }
                    .mpl-lora-row.root-item { margin-bottom: 2px; }
                    .mpl-lora-row:hover { background: var(--ma-surface-raised); border-color: var(--ma-border); }
                    .mpl-lora-row.mpl-selected {
                        background: var(--lora-sel-bg, var(--ma-color-select-bg, var(--ma-accent-soft))) !important;
                        border-color: var(--lora-sel-border, var(--ma-color-select-border, rgba(99,102,241,0.42))) !important;
                        border-left: 3px solid var(--lora-sel-bar, var(--ma-color-select-bar, var(--ma-accent))) !important;
                    }
                    .mpl-lora-row.mpl-selected .mpl-lora-name {
                        color: var(--lora-sel-text, var(--ma-color-select-text, #f4f4f5)) !important;
                    }
                    .mpl-lora-row.mpl-disabled { opacity: 0.45; }
                    .mpl-lora-row.mpl-disabled .mpl-lora-name { color: var(--ma-muted); }
                    /* 清晰的行内元素分布：🖼 缩略图 · ☰ 拖拽 · 勾选 · 名称 · 拖拽区 · 备注 · 权重 · 🏷️ · ✎ · × */
                    .mpl-lora-thumb {
                        flex: 0 0 26px; width: 26px; height: 26px; border-radius: 6px; overflow: hidden;
                        background: linear-gradient(135deg, #27272e, #18181c); border: 1px solid var(--ma-border);
                        display: flex; align-items: center; justify-content: center; cursor: default;
                    }
                    .mpl-lora-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
                    .mpl-lora-thumb.mpl-lora-thumb-empty { background: var(--ma-surface); }
                    .mpl-sort-handle {
                        flex: 0 0 14px; width: 14px; height: 20px; display: flex; align-items: center; justify-content: center;
                        cursor: move; color: #52525b; font-size: 12px; line-height: 1; user-select: none;
                        border-radius: 4px; transition: color .15s, background .15s;
                    }
                    .mpl-sort-handle:hover { color: #d4d4d8; background: rgba(255,255,255,0.06); }
                    .mpl-lora-row > input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: #6366f1; cursor: pointer; }
                    .mpl-lora-row .mpl-drag-area { flex: 0 0 10px; width: 10px; min-width: 0; }
                    .mpl-lora-name { flex: 1 1 auto; min-width: 60px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ma-text); font-size: 12px; font-weight: 500; }
                    .mpl-lora-row .mpl-note-input { flex: 0 0 84px; width: 84px; max-width: 84px; min-width: 84px; padding: 3px 7px; background: #09090b; border: 1px solid var(--ma-border); border-radius: 6px; color: var(--ma-text); font-size: 11.5px; }
                    .mpl-lora-row .mpl-note-input:focus { border-color: var(--ma-accent); outline: none; }
                    .mpl-weight-container { flex: 0 0 auto; min-width: 106px; display: flex; align-items: center; background: #09090b; border-radius: 6px; border: 1px solid var(--ma-border); overflow: hidden; }
                    .mpl-weight-display { flex: 1 1 auto; min-width: 42px; padding: 2px 6px; text-align: center; color: var(--ma-text); font-size: 11.5px; user-select: none; background: transparent; cursor: pointer; font-variant-numeric: tabular-nums; }
                    .mpl-weight-display:hover { background: var(--ma-surface-raised); }
                    .mpl-lora-clip-weight {
                        flex: 0 0 auto; min-width: 46px; height: 22px; padding: 0 5px; box-sizing: border-box;
                        display: inline-flex; align-items: center; justify-content: center;
                        border: 1px solid var(--ma-border); border-radius: 6px; background: #09090b;
                        color: #a1a1aa; font: 10.5px Consolas, monospace; cursor: pointer; user-select: none; white-space: nowrap;
                    }
                    .mpl-lora-clip-weight:hover { border-color: rgba(99,102,241,0.5); color: #f4f4f5; }
                    .mpl-lora-clip-weight.mpl-clip-custom { border-color: rgba(16,185,129,0.5); background: rgba(16,185,129,0.12); color: #6ee7b7; }
                    .mpl-lora-rec-weight {
                        flex: 0 0 auto; height: 22px; padding: 0 5px; box-sizing: border-box;
                        display: inline-flex; align-items: center; justify-content: center;
                        border: 1px solid rgba(16,185,129,0.36); border-radius: 6px; background: rgba(16,185,129,0.10);
                        color: #6ee7b7; font: 10px Consolas, monospace; cursor: pointer; user-select: none; white-space: nowrap;
                        transition: all 0.14s;
                    }
                    .mpl-lora-rec-weight:hover { border-color: rgba(16,185,129,0.68); background: rgba(16,185,129,0.2); color: #a7f3d0; }
                    .mpl-lora-rec-weight.is-applied { border-color: rgba(16,185,129,0.22); background: rgba(16,185,129,0.06); color: #86efac; opacity: 0.78; }
                    .mpl-lora-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 4px; }
                    .mpl-btn-add { flex: 1.4; background: #6366f1; border: none; color: white; border-radius: 6px; height: 28px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }
                    .mpl-btn-add:hover { background: #818cf8; }
                    .mpl-btn-metadata { flex: 1.4; background: #18181c; border: 1px solid var(--ma-border); color: var(--ma-text); border-radius: 6px; height: 28px; cursor: pointer; font-size: 12px; white-space: nowrap; }
                    .mpl-btn-metadata:hover { background: #222228; border-color: rgba(99,102,241,0.45); }
                    .mpl-btn-icon {
                        min-width: 38px; height: 28px; background: #18181c; border: 1px solid var(--ma-border);
                        color: #d4d4d8; border-radius: 6px; cursor: pointer; font-size: 12px; padding: 0 7px;
                        display: flex; align-items: center; justify-content: center; white-space: nowrap;
                    }
                    .mpl-btn-icon:hover { background: #222228; border-color: rgba(99,102,241,0.45); color: white; }
                    .mpl-mini-input { width: 40px; background: #09090b; border: 1px solid var(--ma-border); color: white; text-align: center; border-radius: 4px; }
                    .mpl-mini-btn {
                        background: var(--ma-surface); border: 1px solid var(--ma-border); cursor: pointer; color: var(--ma-muted);
                        padding: 0; border-radius: 6px; font-size: 13px; width: 24px; height: 22px;
                        display: flex; align-items: center; justify-content: center; transition: all 0.14s;
                    }
                    .mpl-mini-btn:hover { background: var(--ma-surface-raised); color: var(--ma-text); border-color: rgba(99,102,241,0.45); }
                    .mpl-mini-btn.del:hover { background: rgba(239,68,68,0.16); color: #f87171; border-color: rgba(239,68,68,0.45); }
                    .mpl-mini-btn.edit { color: #818cf8; }
                    .mpl-mini-btn.edit:hover { background: rgba(99,102,241,0.18); color: #fff; }
                    /* 🏷️ 小方按钮：有触发词亮起，右键可临时关闭触发词 */
                    .mpl-mini-btn.tag { color: #71717a; font-size: 12px; }
                    .mpl-mini-btn.tag:hover { color: #d4d4d8; }
                    .mpl-mini-btn.tag.active { color: #a5b4fc; border-color: rgba(99,102,241,0.45); background: rgba(99,102,241,0.14); }
                    .mpl-mini-btn.tag.active:hover { color: #fff; border-color: rgba(99,102,241,0.7); }
                    .mpl-mini-btn.tag.mpl-trigger-partial { color: #d8b4fe; border-color: rgba(192,132,252,0.52); background: rgba(192,132,252,0.14); }
                    .mpl-mini-btn.tag.mpl-trigger-off { color: #71717a; border-style: dashed; background: transparent; text-decoration: line-through; }
                    .mpl-multisel-bar {
                        position: sticky; top: -8px; z-index: 6;
                        display: none; align-items: center; gap: 8px;
                        margin: 0 0 6px; padding: 5px 9px; border-radius: 8px;
                        background: rgba(24,24,28,0.97); border: 1px solid var(--ma-border);
                        font-size: 11.5px; color: var(--ma-muted); backdrop-filter: blur(6px);
                    }
                    .mpl-multisel-bar .mpl-multisel-count { font-weight: 600; color: #f4f4f5; }
                    .mpl-ms-master {
                        margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
                        font-size: 11px; padding: 2px 9px; border-radius: 999px; cursor: pointer; white-space: nowrap;
                        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #a1a1aa;
                    }
                    .mpl-ms-master:hover { border-color: rgba(99,102,241,0.55); color: #f4f4f5; }
                    .mpl-ms-master.on { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.5); color: #c7d2fe; }
                    .mpl-ms-warn {
                        flex: 0 0 auto; width: 20px; height: 20px; padding: 0;
                        display: inline-flex; align-items: center; justify-content: center;
                        border-radius: 6px; background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.42);
                        color: #fca5a5; font-size: 11px; line-height: 1; cursor: pointer;
                    }
                    .mpl-top-drop-active { box-shadow: 0 0 0 2px rgba(99,102,241,0.75) inset !important; border-radius: 8px; }
                    .mpl-top-drop-before { box-shadow: inset 0 4px 0 0 var(--mpl-folder-drop-color, #ffd166) !important; }
                    .mpl-top-drop-after { box-shadow: inset 0 -4px 0 0 var(--mpl-folder-drop-color, #ffd166) !important; }
                    .mpl-insert-line { height: 2px; background: #6366f1; margin: 2px 4px; border-radius: 2px; }
                    .mpl-lora-preview { display: none; }
                    .mpl-metadata-dialog {
                        position: fixed; z-index: 9999; display: flex; flex-direction: column;
                        width: 840px; height: 610px; max-width: calc(100vw - 40px); max-height: calc(100vh - 56px);
                        min-width: min(660px, calc(100vw - 40px)); min-height: min(420px, calc(100vh - 56px));
                        background: #111114; color: #f4f4f5; border: 1px solid rgba(255,255,255,0.11); border-radius: 14px;
                        box-shadow: 0 24px 64px rgba(0,0,0,.78), 0 4px 16px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.07);
                        overflow: hidden; resize: both;
                        box-sizing: border-box; font: 12.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif; outline: none;
                    }
                    .mpl-metadata-dialog *, .mpl-metadata-dialog *::before, .mpl-metadata-dialog *::after { box-sizing: border-box; }
                    .mpl-metadata-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: linear-gradient(180deg, rgba(255,255,255,.03) 0%, rgba(255,255,255,0) 100%), #111114; border-bottom: 1px solid rgba(255,255,255,0.07); flex-shrink: 0; cursor: move; }
                    .mpl-metadata-title { font-size: 14px; font-weight: 600; flex: 1; color: #f4f4f5; letter-spacing: -0.01em; }
                    .mpl-metadata-header-icon { color: #818cf8; font-size: 16px; }
                    .mpl-metadata-close { width: 26px; height: 26px; padding: 0 !important; font-size: 17px !important; background: transparent !important; border-color: transparent !important; color: #a1a1aa !important; border-radius: 6px !important; }
                    .mpl-metadata-close:hover { background: #222228 !important; color: #f4f4f5 !important; }
                    .mpl-metadata-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
                    .mpl-metadata-filters { padding: 11px 16px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.07); background: #0d0d10; flex-shrink: 0; }
                    .mpl-metadata-filter-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
                    .mpl-metadata-field { display: flex; align-items: center; gap: 7px; min-width: 0; }
                    .mpl-metadata-field > span { color: #a1a1aa; white-space: nowrap; font-size: 11.5px; font-weight: 500; }
                    .mpl-metadata-scope { width: 230px; flex-shrink: 0; }
                    .mpl-metadata-directory { flex: 1; min-width: 100px; }
                    .mpl-metadata-dialog select, .mpl-metadata-dialog input[type=search] {
                        min-width: 0; width: 100%; height: 30px; margin: 0; padding: 4px 9px;
                        color: #f4f4f5; background: #09090b; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
                        font: inherit; outline: none; transition: border-color 0.14s, box-shadow 0.14s;
                    }
                    .mpl-metadata-dialog select:focus, .mpl-metadata-dialog input[type=search]:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.2); }
                    .mpl-metadata-dialog input[type=checkbox] { width: 13px; height: 13px; margin: 0; accent-color: #6366f1; flex-shrink: 0; }
                    .mpl-metadata-check { display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; font-size: 11.5px; color: #d4d4d8; }
                    .mpl-metadata-dialog .mpl-metadata-search-row { flex-wrap: wrap; }
                    .mpl-metadata-dialog .mpl-metadata-search-row input.mpl-metadata-search { flex: 1 1 260px; width: auto; min-width: min(220px, 100%); max-width: 100%; }
                    .mpl-metadata-dialog .mpl-metadata-search-row select.mpl-metadata-status-filter { flex: 0 0 150px; width: 150px; min-width: 130px; max-width: 100%; }
                    .mpl-metadata-dialog .mpl-metadata-search-row .mpl-metadata-refresh { flex: 0 0 auto; width: auto; }
                    .mpl-metadata-workspace { display: grid; grid-template-columns: 195px minmax(0,1fr); flex: 1; min-height: 0; }
                    .mpl-metadata-settings { padding: 12px 14px; border-right: 1px solid rgba(255,255,255,0.07); background: #0d0d10; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
                    .mpl-metadata-setting-group { display: flex; flex-direction: column; gap: 7px; }
                    .mpl-metadata-caption { color: #a1a1aa; font-size: 11px; font-weight: 600; }
                    .mpl-metadata-types { display: flex; flex-direction: column; gap: 6px; }
                    .mpl-metadata-type { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; background: #18181c; cursor: pointer; font-size: 11.5px; color: #d4d4d8; transition: all 0.14s; }
                    .mpl-metadata-type:has(input:checked) { border-color: rgba(99,102,241,0.42); background: rgba(99,102,241,0.14); color: #f4f4f5; }
                    .mpl-metadata-mode-help { font-size: 11px; color: #71717a; line-height: 1.6; }
                    .mpl-metadata-library { min-width: 0; min-height: 0; padding: 10px 14px 0; display: flex; flex-direction: column; gap: 8px; background: #111114; }
                    .mpl-metadata-selection { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
                    .mpl-metadata-counts { margin-left: auto; display: flex; align-items: center; gap: 9px; color: #a1a1aa; font-size: 11px; flex-wrap: wrap; }
                    .mpl-metadata-hint { color: #71717a; font-size: 11px; line-height: 1.5; flex-shrink: 0; }
                    .mpl-metadata-warning { color: #fbbf24; font-size: 11px; white-space: pre-wrap; max-height: 65px; overflow: auto; flex-shrink: 0; }
                    .mpl-metadata-warning:empty { display: none; }
                    .mpl-metadata-inventory { flex: 1; min-height: 100px; overflow: auto; overscroll-behavior: contain; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: #09090b; }
                    .mpl-metadata-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11.5px; }
                    .mpl-metadata-table thead { position: sticky; top: 0; z-index: 1; background: #18181c; color: #a1a1aa; box-shadow: 0 1px 0 rgba(255,255,255,0.08); }
                    .mpl-metadata-table th { padding: 8px 7px; text-align: left; font-weight: 600; white-space: nowrap; }
                    .mpl-metadata-table td { padding: 7px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
                    .mpl-metadata-table tr:has(input:checked) { background: rgba(99,102,241,0.1); }
                    .mpl-metadata-table tbody tr:hover { background: #18181c; }
                    .mpl-metadata-file { overflow: hidden; }
                    .mpl-metadata-file-name { color: #f4f4f5; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .mpl-metadata-file-path { color: #71717a; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
                    .mpl-metadata-status { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; font-weight: 500; }
                    .mpl-metadata-present { color: #34d399; background: rgba(16,185,129,0.14); border: 1px solid rgba(16,185,129,0.3); }
                    .mpl-metadata-missing { color: #fbbf24; background: rgba(245,158,11,0.14); border: 1px solid rgba(245,158,11,0.3); }
                    .mpl-metadata-unavailable { color: #a1a1aa; background: #222228; border: 1px solid rgba(255,255,255,0.08); }
                    .mpl-metadata-progress { padding: 9px 16px; border-top: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; gap: 10px; background: #0d0d10; flex-shrink: 0; }
                    .mpl-metadata-progress-text { width: 125px; min-width: 0; font-size: 11px; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .mpl-metadata-progress-row { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
                    .mpl-metadata-progress progress { flex: 1; min-width: 0; width: 100%; height: 6px; accent-color: #6366f1; }
                    .mpl-metadata-progress-count { color: #a1a1aa; font-size: 10.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
                    .mpl-metadata-current { color: #71717a; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
                    .mpl-metadata-results { flex-shrink: 0; margin-bottom: 8px; color: #a1a1aa; font-size: 11px; }
                    .mpl-metadata-results summary { cursor: pointer; padding: 5px 0; font-weight: 600; color: #d4d4d8; }
                    .mpl-metadata-stats { display: flex; flex-wrap: wrap; gap: 9px; font-size: 10.5px; padding-bottom: 5px; }
                    .mpl-metadata-result-list { max-height: 105px; overflow-y: auto; overscroll-behavior: contain; font-size: 10.5px; }
                    .mpl-metadata-result { padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.06); overflow-wrap: anywhere; }
                    .mpl-metadata-result-title { display: flex; align-items: baseline; gap: 7px; color: #e4e4e7; }
                    .mpl-metadata-result-status { color: #34d399; white-space: nowrap; font-weight: 600; }
                    .mpl-metadata-result-status-error { color: #fbbf24; }
                    .mpl-metadata-result-message { color: #a1a1aa; margin-top: 3px; white-space: pre-wrap; }
                    .mpl-metadata-footer { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.07); background: #09090b; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
                    .mpl-metadata-footer-spacer { flex: 1; }
                    .mpl-metadata-dialog button { padding: 6px 11px; margin: 0; border: 1px solid rgba(255,255,255,0.11); border-radius: 6px; background: #18181c; color: #e4e4e7; cursor: pointer; font: 11.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight: 500; white-space: nowrap; transition: all 0.14s ease; }
                    .mpl-metadata-dialog button:hover:not(:disabled) { background: #27272e; border-color: rgba(255,255,255,0.2); color: #ffffff; }
                    .mpl-metadata-dialog button:disabled { opacity: .42; cursor: default; }
                    .mpl-metadata-dialog .mpl-metadata-primary { background: #6366f1; border-color: rgba(255,255,255,0.14); color: white; font-weight: 600; padding: 6px 16px; }
                    .mpl-metadata-dialog .mpl-metadata-primary:hover:not(:disabled) { background: #818cf8; }
                    @media (max-width: 720px) {
                        .mpl-metadata-workspace { grid-template-columns: 155px minmax(0,1fr); }
                        .mpl-metadata-scope { width: 190px; }
                        .mpl-metadata-filter-row { flex-wrap: wrap; }
                        .mpl-metadata-counts { margin-left: 0; }
                        .mpl-metadata-current { display: none; }
                    }
                    .mpl-spinner { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:20px; height:20px; border:2px solid #333; border-top:2px solid #fff; border-radius:50%; animation:mpl-spin 1s linear infinite; }
                    @keyframes mpl-spin { 0% { transform:translate(-50%,-50%) rotate(0deg); } 100% { transform:translate(-50%,-50%) rotate(360deg); } }
                `;
                document.head.appendChild(s);
            };

            // --- 数据处理与渲染逻辑 ---
            nodeType.prototype.updateWidget = function() {
                mplNormalizeLoraData(this.loraData);
                if (!this._stackWidget) {
                    this._stackWidget = this.widgets?.find(w => w.name === "lora_stack");
                }
                if (this._stackWidget) {
                    const stack = [];
                    const masked = this.triggerMaster === false;
                    const pushLora = (l) => {
                        if (!l || !mplLoraEnabled(l)) return;
                        stack.push(masked ? Object.assign({}, l, { triggerEnabled: false }) : l);
                    };
                    if(this.loraData.folders) {
                        this.loraData.folders.forEach(f => {
                            if (f.ignored) return;
                            (f.loras || []).forEach(pushLora);
                        });
                    }
                    if(this.loraData.loras) {
                        (this.loraData.loras || []).forEach(pushLora);
                    }
                    this._stackWidget.value = JSON.stringify(stack);
                }
                
                // 更新 SDNQ 模式 widget
                if (!this._sdnqModeWidget) {
                    this._sdnqModeWidget = this.widgets?.find(w => w.name === "sdnq_mode");
                }
                if (this._sdnqModeWidget) {
                    const sdnqMode = this.sdnqMode || this.properties["sdnq_mode"] || "none";
                    this._sdnqModeWidget.value = sdnqMode;
                }

                // 更新自适应模式 widget
                if (!this._adaptiveModeWidget) {
                    this._adaptiveModeWidget = this.widgets?.find(w => w.name === "adaptive_mode");
                }
                const adaptiveBool = this.adaptiveMode === true || this.adaptiveMode === "true"
                    || this.properties["adaptive_mode"] === true || this.properties["adaptive_mode"] === "true";
                if (this._adaptiveModeWidget) {
                    this._adaptiveModeWidget.value = String(adaptiveBool);
                }

                // 更新 Klein 模式 widget
                if (!this._kleinModeWidget) {
                    this._kleinModeWidget = this.widgets?.find(w => w.name === "klein_mode");
                }
                if (this._kleinModeWidget) {
                    const kleinMode = this.kleinMode || this.properties["klein_mode"] || "auto";
                    this._kleinModeWidget.value = kleinMode;
                }

                // 更新 Anima 2.9B 模式 widget
                if (!this._animaModeWidget) {
                    this._animaModeWidget = this.widgets?.find(w => w.name === "anima_mode");
                }
                if (this._animaModeWidget) {
                    const animaMode = this.animaMode || this.properties["anima_mode"] || "none";
                    this._animaModeWidget.value = animaMode;
                }

                this.properties["lora_data_state"] = JSON.stringify(this.loraData);
                if (this.loraData.selected) delete this.loraData.selected;
                this._syncTopLayout && this._syncTopLayout();
                this.properties["top_layout"] = JSON.stringify(this._topLayout || []);
                this.properties["sdnq_mode"] = this.sdnqMode || "none";
                this.properties["klein_mode"] = this.kleinMode || "auto";
                this.properties["anima_mode"] = this.animaMode || "none";
                this.adaptiveMode = adaptiveBool;
                this.properties["adaptive_mode"] = adaptiveBool;
                this.properties["trigger_master"] = this.triggerMaster !== false;
                mplUpdateMissingLoraState(this);
                mplSyncModelValidationWidgets(this);
                mplRefreshOfficialMissingModels();
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(w) {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                
                if (this.widgets) {
                    const stackWidget = this.widgets.find(w => w.name === "lora_stack");
                    if (stackWidget) {
                        stackWidget.hidden = true;
                        stackWidget.computeSize = () => [0, 0];
                    }
                    const stackInputIdx = this.inputs?.findIndex(i => i.name === "lora_stack");
                    if (stackInputIdx >= 0) {
                        this.removeInput(stackInputIdx);
                    }
                    const int8ModeWidget = this.widgets.find(w => w.name === "int8_mode");
                    if (int8ModeWidget) {
                        int8ModeWidget.hidden = true;
                        int8ModeWidget.computeSize = () => [0, 0];
                        int8ModeWidget.value = "none";
                    }
                    const sdnqModeWidget = this.widgets.find(w => w.name === "sdnq_mode");
                    if (sdnqModeWidget) {
                        sdnqModeWidget.hidden = true;
                        sdnqModeWidget.computeSize = () => [0, 0];
                    }
                    const adaptiveModeWidget = this.widgets.find(w => w.name === "adaptive_mode");
                    if (adaptiveModeWidget) {
                        adaptiveModeWidget.hidden = true;
                        adaptiveModeWidget.computeSize = () => [0, 0];
                    }
                    const kleinModeWidget = this.widgets.find(w => w.name === "klein_mode");
                    if (kleinModeWidget) {
                        kleinModeWidget.hidden = true;
                        kleinModeWidget.computeSize = () => [0, 0];
                    }
                    const animaModeWidget = this.widgets.find(w => w.name === "anima_mode");
                    if (animaModeWidget) {
                        animaModeWidget.hidden = true;
                        animaModeWidget.computeSize = () => [0, 0];
                    }
                }
                
                // 恢复 SDNQ 模式设置
                if (this.properties["sdnq_mode"] !== undefined) {
                    this.sdnqMode = String(this.properties["sdnq_mode"] || "none");
                } else {
                    this.sdnqMode = "none";
                    this.properties["sdnq_mode"] = "none";
                }

                // 恢复自适应模式设置
                if (this.properties["adaptive_mode"] !== undefined) {
                    this.adaptiveMode = this.properties["adaptive_mode"] === true || this.properties["adaptive_mode"] === "true";
                } else {
                    this.adaptiveMode = false;
                    this.properties["adaptive_mode"] = false;
                }
                this.triggerMaster = this.properties["trigger_master"] !== false;
                // 恢复 Klein 模式设置
                if (this.properties["klein_mode"] !== undefined) {
                    this.kleinMode = String(this.properties["klein_mode"] || "auto");
                } else {
                    this.kleinMode = "auto";
                    this.properties["klein_mode"] = "auto";
                }
                // 恢复 Anima 2.9B 模式设置
                const animaWidgetVal = (this.widgets?.find(w => w.name === "anima_mode") || this._animaModeWidget)?.value;
                if (animaWidgetVal !== undefined && animaWidgetVal !== "") {
                    this.animaMode = String(animaWidgetVal);
                } else if (this.properties["anima_mode"] !== undefined) {
                    this.animaMode = String(this.properties["anima_mode"] || "none");
                } else {
                    this.animaMode = "none";
                }
                this.properties["anima_mode"] = this.animaMode;

                // 恢复布局设置
                const layoutDefaults = {
                    weightStyle: "arrows",
                    sliderStep: 0.05,
                    sliderMin: -2,
                    sliderMax: 2,
                    sliderWidth: 110,
                    showWeightValue: true,
                    snapToZero: true,
                    hideClip: true,
                    hideRecWeight: false,
                };
                if (this.properties["layout_settings"] && typeof this.properties["layout_settings"] === "object") {
                    this.layoutSettings = Object.assign({}, layoutDefaults, this.properties["layout_settings"]);
                } else {
                    this.layoutSettings = Object.assign({}, layoutDefaults);
                }
                
                if (this.properties["lora_data_state"]) {
                    try { 
                        this.loraData = mplNormalizeLoraData(JSON.parse(this.properties["lora_data_state"]));
                        if (this.properties["top_layout"]) {
                            try { this._topLayout = JSON.parse(this.properties["top_layout"]) || []; } catch(e) { this._topLayout = []; }
                        }
                    } catch(e) {}
                } else if (this.widgets_values && this.widgets_values[2]) {
                    try {
                        const stack = JSON.parse(this.widgets_values[2]);
                        this.loraData = { 
                            folders: [], 
                            loras: stack.map(l => ({
                                ...l, 
                                enabled: true, 
                                note: l.note || "",
                                triggerWords: l.triggerWords || "",
                                jsonInfo: l.jsonInfo || "",
                                logInfo: l.logInfo || ""
                            })) 
                        };
                    } catch(e) {}
                }
                if (this.widgets_values && this.widgets_values.length > 3 && this.widgets_values[3] !== undefined && this.widgets_values[3] !== "") {
                    if (this._int8ModeWidget) this._int8ModeWidget.value = "none";
                }
                if (this.widgets_values && this.widgets_values.length > 4 && this.widgets_values[4] !== undefined && this.widgets_values[4] !== "") {
                    this.sdnqMode = this.widgets_values[4];
                    this.properties["sdnq_mode"] = this.sdnqMode;
                }
                const wAdaptive = this.widgets_values?.[5];
                const wAdaptiveHasValue = wAdaptive !== undefined && wAdaptive !== "";
                if (this.widgets_values && this.widgets_values.length > 5 && wAdaptiveHasValue) {
                    this.adaptiveMode = wAdaptive === "true" || wAdaptive === true;
                    this.properties["adaptive_mode"] = this.adaptiveMode;
                }
                const wKlein = this.widgets_values?.[6];
                const wKleinHasValue = wKlein !== undefined && wKlein !== "";
                if (this.widgets_values && this.widgets_values.length > 6 && wKleinHasValue) {
                    this.kleinMode = this.widgets_values[6];
                    this.properties["klein_mode"] = this.kleinMode;
                }

                const normalizeSdnq = (v) => v === "sdnq" ? "sdnq" : "none";
                const normalizeKlein = (v) => v === "klein" ? "klein" : (v === "auto" ? "auto" : "none");

                const fixedSdnq = normalizeSdnq(this.sdnqMode ?? this.properties["sdnq_mode"]);
                if (fixedSdnq !== (this.sdnqMode ?? this.properties["sdnq_mode"])) {
                    this.sdnqMode = fixedSdnq;
                    this.properties["sdnq_mode"] = fixedSdnq;
                    if (this._sdnqModeWidget) this._sdnqModeWidget.value = fixedSdnq;
                }

                const fixedKlein = normalizeKlein(this.kleinMode ?? this.properties["klein_mode"]);
                if (fixedKlein !== (this.kleinMode ?? this.properties["klein_mode"])) {
                    this.kleinMode = fixedKlein;
                    this.properties["klein_mode"] = fixedKlein;
                    if (this._kleinModeWidget) this._kleinModeWidget.value = fixedKlein;
                }

                if ((this.properties["adaptive_mode"] === true || this.properties["adaptive_mode"] === "true")
                    && (!wAdaptiveHasValue || wAdaptive === "false" || wAdaptive === false)) {
                    this.adaptiveMode = false;
                    this.properties["adaptive_mode"] = false;
                    if (this._adaptiveModeWidget) this._adaptiveModeWidget.value = "false";
                }

                {
                    const savedColors = this.properties["color_settings"];
                    const colorDefaults = { selectBg: "#2b3b5e", selectBar: "#6366f1", selectText: "#eef1ff" };
                    this.colorSettings = (savedColors && typeof savedColors === "object")
                        ? Object.assign({}, colorDefaults, savedColors)
                        : colorDefaults;
                    const savedFolderColors = this.properties["folder_color_settings"];
                    const folderColorDefaults = { outer: "", inner: "", bar: "", ignore: "", normal: "" };
                    this.folderColorSettings = (savedFolderColors && typeof savedFolderColors === "object")
                        ? Object.assign({}, folderColorDefaults, savedFolderColors)
                        : folderColorDefaults;
                }

                this.updateWidget?.();
                this.applyColorSettings?.();
                this.applyFolderColorSettings?.();
                {
                    const minW = this.minWidth || (MPL_MIN_W + 20);
                    const curW = Number(this.size?.[0]) || 0;
                    const curH = Number(this.size?.[1]) || 0;
                    if (curW > 0 && (curW < minW - 0.5 || curH < MPL_MIN_H - 0.5)) {
                        this.size[0] = Math.max(curW, minW);
                        this.size[1] = Math.max(curH, MPL_MIN_H);
                    }
                }
                this._mplSyncDOMLayout?.();
                
                setTimeout(() => {
                    this.createDOMInterface();
                    this.renderEmbeddedList();
                    this._updateKleinBanner?.();
                    mplUpdateMissingLoraState(this);
                    mplSyncModelValidationWidgets(this);
                    this._mplSyncDOMLayout?.();
                    this._mplScheduleLayoutSync?.();
                    this._mplGuardLayout?.();
                    void loadLoraNameList();
                }, 100);
                return r;
            };

            const onNodeRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                const r = onNodeRemoved ? onNodeRemoved.apply(this, arguments) : undefined;
                if (this._mplLayoutSyncTimers) {
                    this._mplLayoutSyncTimers.forEach(t => clearTimeout(t));
                    this._mplLayoutSyncTimers = null;
                }
                if (this._mplResizeObserver) {
                    try { this._mplResizeObserver.disconnect(); } catch (e) {}
                    this._mplResizeObserver = null;
                }
                if (this._mplGuardTimer) {
                    clearInterval(this._mplGuardTimer);
                    this._mplGuardTimer = null;
                }
                this._mplGuardInstalled = false;
                this._mplGuardBusy = false;
                if (this._previewTimeout) {
                    clearTimeout(this._previewTimeout);
                    this._previewTimeout = null;
                }
                if (this._previewDiv) {
                    this._previewDiv.remove();
                    this._previewDiv = null;
                }
                setTimeout(() => mplRefreshOfficialMissingModels(), 0);
                const previews = document.querySelectorAll('.mpl-lora-preview');
                previews.forEach(preview => preview.remove());
                return r;
            };

            nodeType.prototype.applyColorSettings = function() {
                const c = this.colorSettings || {};
                const root = this.embeddedContainer || (this.listContainer ? this.listContainer.closest(".mpl-embedded-container") : null) || this.listContainer;
                if (!root || !root.style) return;
                if (c.selectBg) root.style.setProperty("--ma-color-select-bg", c.selectBg);
                if (c.selectBar) root.style.setProperty("--ma-color-select-border", c.selectBar + "88");
                if (c.selectBar) root.style.setProperty("--ma-color-select-bar", c.selectBar);
                if (c.selectText) root.style.setProperty("--ma-color-select-text", c.selectText);
            };
            nodeType.prototype.applyFolderColorSettings = function() {
                const f = this.folderColorSettings || {};
                const root = this.embeddedContainer || (this.listContainer ? this.listContainer.closest(".mpl-embedded-container") : null) || this.listContainer;
                if (!root || !root.style) return;
                if (f.outer) root.style.setProperty("--folder-def-outer", f.outer);
                else root.style.removeProperty("--folder-def-outer");
                if (f.inner) root.style.setProperty("--folder-def-inner", f.inner);
                else root.style.removeProperty("--folder-def-inner");
                if (f.bar) root.style.setProperty("--folder-def-bar", f.bar);
                else root.style.removeProperty("--folder-def-bar");
                if (f.ignore) root.style.setProperty("--folder-ignore-color", f.ignore);
                else root.style.removeProperty("--folder-ignore-color");
                if (f.normal && f.normal !== "#8b8d9b") root.style.setProperty("--folder-normal-color", f.normal);
                else root.style.removeProperty("--folder-normal-color");
            };
            nodeType.prototype._ensureMultiSelectState = function() {
                if (!this.loraData.selected || typeof this.loraData.selected !== "object") {
                    this.loraData.selected = {};
                }
                return this.loraData.selected;
            };
            nodeType.prototype._msKey = function(lora) {
                return String((lora && (lora.name || lora.id)) || "");
            };
            nodeType.prototype._isMultiSelected = function(container, lora) {
                return !!lora && mplLoraEnabled(lora);
            };
            nodeType.prototype._addMultiSelected = function(container, lora) {
                if (lora) lora.enabled = true;
            };
            nodeType.prototype._removeMultiSelected = function(container, lora) {
                if (lora) lora.enabled = false;
            };
            nodeType.prototype._getMultiSelectedLoras = function() {
                const all = [];
                (this.loraData.loras || []).forEach(l => all.push(l));
                (this.loraData.folders || []).forEach(f => {
                    if (f.ignored) return;
                    (f.loras || []).forEach(l => all.push(l));
                });
                return all.filter(l => l && mplLoraEnabled(l));
            };
            nodeType.prototype._clearMultiSelect = function() {
                this.loraData.selected = {};
            };
            nodeType.prototype._refreshMultiSelectUI = function() {
                const n = this._getMultiSelectedLoras().length;
                const bar = this.listContainer && this.listContainer.querySelector(".mpl-multisel-bar");
                if (bar) {
                    bar.style.display = "flex";
                    const label = bar.querySelector(".mpl-ms-label");
                    if (label) {
                        if (n > 0) {
                            label.textContent = `已启用 ${n} 个 LoRA`;
                            label.style.color = "#f4f4f5";
                        } else {
                            label.textContent = "暂未启用 LoRA";
                            label.style.color = "#a1a1aa";
                        }
                    }
                }
                if (this.listContainer) {
                    const fRows = this.listContainer.querySelectorAll(".mpl-folder-row");
                    fRows.forEach((fDiv) => {
                        const cb = fDiv.querySelector(':scope > .mpl-folder-header > input[type="checkbox"]');
                        if (!cb) return;
                        const idx = parseInt(fDiv.dataset.fidx, 10);
                        const folder = this.loraData.folders[idx];
                        if (!folder) return;
                        const total = (folder.loras || []).length;
                        const cnt = (folder.loras || []).filter(l => this._isMultiSelected(folder, l)).length;
                        cb.checked = total > 0 && cnt === total;
                        cb.indeterminate = cnt > 0 && cnt < total;
                        if (cnt > 0) fDiv.classList.add("has-sel");
                        else fDiv.classList.remove("has-sel");
                    });
                }
                if (this.updateWidget) this.updateWidget();
            };
            // 紧凑状态条：左侧只显示「已启用 N 个 LoRA」，右侧一个触发词总开关；
            // 只有真的没接入工作流时才出现一个小小的 ⚠ 图标（不显示节点 ID 之类的噪音）。
            nodeType.prototype._buildMultiSelectBar = function() {
                const bar = document.createElement("div");
                bar.className = "mpl-multisel-bar";
                bar.style.display = "flex";
                const n = this._getMultiSelectedLoras().length;
                const label = document.createElement("span");
                label.className = "mpl-ms-label";
                if (n > 0) {
                    label.textContent = `已启用 ${n} 个 LoRA`;
                    label.style.color = "#f4f4f5";
                } else {
                    label.textContent = "暂未启用 LoRA";
                    label.style.color = "#a1a1aa";
                }
                bar.appendChild(label);
                const masterOn = this.triggerMaster !== false;
                const masterBtn = document.createElement("button");
                masterBtn.type = "button";
                masterBtn.className = "mpl-ms-master" + (masterOn ? " on" : "");
                masterBtn.innerHTML = mplIcon("tag", 12) + '<span>触发词</span>';
                masterBtn.title = masterOn
                    ? "触发词正在输出。单击屏蔽所有触发词（不影响各行小开关的状态）"
                    : "所有触发词已被屏蔽。单击恢复输出（各行小开关状态保持不变）";
                masterBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.triggerMaster = (this.triggerMaster === false);
                    this.updateWidget();
                    this.renderEmbeddedList();
                };
                masterBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
                bar.appendChild(masterBtn);
                this._mplRefreshStatusBar(bar);
                return bar;
            };

            // 只在真的「没接入工作流」时给出提示（不常驻显示节点 ID）
            nodeType.prototype._mplLinkStatus = function() {
                const outs = this.outputs || [];
                const outCount = (i) => {
                    const o = outs[i];
                    return o && Array.isArray(o.links) ? o.links.length : 0;
                };
                const anyOut = outs.some((o, i) => outCount(i) > 0);
                const modelIn = (this.inputs || []).find(i => i.name === "model");
                const hasModelIn = !!(modelIn && modelIn.link !== null && modelIn.link !== undefined && modelIn.link !== false);
                let activePeer = null;
                try {
                    const same = (app?.graph?._nodes || []).filter(n => n && n !== this && (n.type === NODE_NAME || n.constructor?.type === NODE_NAME));
                    activePeer = same.find(n => {
                        const mIn = (n.inputs || []).find(i => i.name === "model");
                        const mOut = (n.outputs || [])[0];
                        return !!(mIn && mIn.link != null && mOut && Array.isArray(mOut.links) && mOut.links.length);
                    }) || null;
                } catch (e) {}
                if (!anyOut) {
                    return {
                        detached: true,
                        activePeer,
                        title: "输出没有任何连线，ComfyUI 不会执行本节点——在这里勾选/取消 LoRA 不会影响出图。" +
                            (activePeer ? " 单击可定位画布上已接入工作流的那一个加载器。" : ""),
                    };
                }
                if (!hasModelIn && outCount(4) === 0) {
                    return {
                        detached: true,
                        activePeer,
                        title: "链末端需要 model 输入才会应用 LoRA，请把上游模型接到本节点的 model 输入。",
                    };
                }
                return { detached: false, activePeer };
            };

            // 只维护一个不打扰的小 ⚠ 图标（只有真的没接入时才出现）
            nodeType.prototype._mplRefreshStatusBar = function(bar) {
                const target = bar || this.listContainer?.querySelector(".mpl-multisel-bar");
                if (!target) return;
                const st = this._mplLinkStatus();
                let warn = target.querySelector(".mpl-ms-warn");
                if (!st.detached) {
                    if (warn) warn.remove();
                    return;
                }
                if (!warn) {
                    warn = document.createElement("button");
                    warn.type = "button";
                    warn.className = "mpl-ms-warn";
                    warn.textContent = "⚠";
                    warn.addEventListener("pointerdown", (e) => e.stopPropagation());
                    target.appendChild(warn);
                }
                warn.title = st.title || "";
                warn.style.cursor = st.activePeer ? "pointer" : "default";
                warn.onclick = (e) => {
                    e.stopPropagation();
                    const peer = st.activePeer;
                    if (!peer) return;
                    try {
                        app.canvas?.centerOnNode?.(peer);
                        if (typeof app.canvas?.selectNode === "function") app.canvas.selectNode(peer);
                        else if (typeof app.canvas?.selectNodes === "function") app.canvas.selectNodes([peer]);
                        app.canvas?.setDirty?.(true, true);
                    } catch (err) {}
                };
            };

            const onConnectionsChangeOrig = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function() {
                const r = onConnectionsChangeOrig ? onConnectionsChangeOrig.apply(this, arguments) : undefined;
                this._mplRefreshStatusBar();
                return r;
            };

            // ---------- 顶层统一布局（文件夹与散装 LoRA 自由穿插）----------
            nodeType.prototype._uidFor = function(obj) {
                if (!obj._uid) {
                    obj._uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                }
                return obj._uid;
            };
            nodeType.prototype._syncTopLayout = function() {
                const folders = this.loraData.folders || [];
                const loras = this.loraData.loras || [];
                if (!Array.isArray(this._topLayout)) this._topLayout = [];
                const valid = new Set();
                folders.forEach(f => valid.add("f:" + this._uidFor(f)));
                loras.forEach(l => valid.add("l:" + this._uidFor(l)));
                this._topLayout = this._topLayout.filter(tok => valid.has(tok));
                const present = new Set(this._topLayout);
                folders.forEach(f => { const k = "f:" + this._uidFor(f); if (!present.has(k)) { this._topLayout.push(k); present.add(k); } });
                loras.forEach(l => { const k = "l:" + this._uidFor(l); if (!present.has(k)) { this._topLayout.push(k); present.add(k); } });
                return this._topLayout;
            };
            nodeType.prototype._moveTopToken = function(srcTok, dstTok, after) {
                if (!this._topLayout) return;
                const arr = this._topLayout;
                const si = arr.indexOf(srcTok);
                if (si < 0) return;
                arr.splice(si, 1);
                let di = arr.indexOf(dstTok);
                if (di < 0) { arr.push(srcTok); return; }
                if (after) di += 1;
                arr.splice(di, 0, srcTok);
            };
            nodeType.prototype._mplPlaceToken = function(token, targetToken, after) {
                if (!Array.isArray(this._topLayout)) this._topLayout = [];
                const arr = this._topLayout;
                const si = arr.indexOf(token);
                if (si >= 0) arr.splice(si, 1);
                const di = arr.indexOf(targetToken);
                if (di < 0) { arr.push(token); return; }
                arr.splice(after ? di + 1 : di, 0, token);
            };
            nodeType.prototype._mplInsertLoraByToken = function(movedLora, targetLora, after) {
                if (!movedLora || !targetLora) return;
                this._mplPlaceToken("l:" + this._uidFor(movedLora), "l:" + this._uidFor(targetLora), after);
            };

            nodeType.prototype.renderEmbeddedList = function() {
                if(!this.listContainer) return;
                mplNormalizeLoraData(this.loraData);
                
                const previews = document.querySelectorAll('.mpl-lora-preview');
                previews.forEach(preview => preview.remove());
                
                const container = this.listContainer;
                const _prevScrollTop = container.scrollTop;
                container.innerHTML = "";
                this._listEl = container;

                this._ensureMultiSelectState();
                this.applyColorSettings();
                this.applyFolderColorSettings();
                container.appendChild(this._buildMultiSelectBar());

                const _layout = this._syncTopLayout();
                const _folderByIdx = this.loraData.folders;
                const _rootLoras = this.loraData.loras;

                const self = this;
                const _mkTopDragHandle = (handleEl, tok, dimEl, extra) => {
                    handleEl.draggable = true;
                    handleEl.ondragstart = (e) => {
                        e.stopPropagation();
                        mplClearLoraPreview();
                        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "top", tok: tok }));
                        e.dataTransfer.setData("application/x-top-drag", "true");
                        e.dataTransfer.effectAllowed = "move";
                        if (String(tok).startsWith("f:")) {
                            try { e.dataTransfer.setData("application/x-mpl-folder", JSON.stringify({ tok })); } catch (_) {}
                        }
                        if (extra) {
                            try { e.dataTransfer.setData(extra.mime, JSON.stringify(extra.value)); } catch (_) {}
                        }
                        self._currentTopDrag = tok;
                        if (dimEl) dimEl.style.opacity = "0.4";
                    };
                    handleEl.ondragend = () => {
                        if (dimEl) dimEl.style.opacity = "1";
                        self._currentTopDrag = null;
                        (self._listEl ? self._listEl.querySelectorAll(".mpl-insert-line") : []).forEach(el => el.remove());
                    };
                };
                const _clearTopMark = (el) => el.classList.remove("mpl-top-drop-active", "mpl-top-drop-before", "mpl-top-drop-after");
                const _bindTopDropTarget = (el, tok) => {
                    el.addEventListener("dragover", (e) => {
                        if (!self._currentTopDrag) return;
                        e.preventDefault();
                        _clearTopMark(el);
                        const rect = el.getBoundingClientRect();
                        el.classList.add((e.clientY - rect.top) > rect.height / 2 ? "mpl-top-drop-after" : "mpl-top-drop-before");
                    });
                    el.addEventListener("dragleave", () => _clearTopMark(el));
                    el.addEventListener("drop", (e) => {
                        const raw = e.dataTransfer.getData("text/plain");
                        if (!raw) return;
                        let data; try { data = JSON.parse(raw); } catch (_) { return; }
                        if (!data || data.type !== "top") return;
                        e.preventDefault(); e.stopPropagation();
                        _clearTopMark(el);
                        if (data.tok === tok) { self._currentTopDrag = null; return; }
                        const rect = el.getBoundingClientRect();
                        const after = (e.clientY - rect.top) > rect.height / 2;
                        self._moveTopToken(data.tok, tok, after);
                        self._currentTopDrag = null;
                        self.renderEmbeddedList();
                        self.updateWidget();
                    });
                };

                _layout.forEach((tok) => {
                    if (tok.startsWith("f:")) {
                        const uid = tok.slice(2);
                        const fIdx = _folderByIdx.findIndex(f => this._uidFor(f) === uid);
                        if (fIdx < 0) return;
                        const folder = _folderByIdx[fIdx];
                        const fDiv = document.createElement("div");
                        fDiv.className = "mpl-folder-row" + (folder.ignored ? " ignored" : "");
                        fDiv.dataset.fidx = String(fIdx);
                        if ((folder.loras || []).some(l => this._isMultiSelected(folder, l))) {
                            fDiv.classList.add("has-sel");
                        }
                        if (folder.colorMode !== "global") {
                            if (folder.color) fDiv.style.setProperty("--folder-c", folder.color);
                            if (folder.bgColor) fDiv.style.setProperty("--folder-bg", folder.bgColor);
                            if (folder.headBg) fDiv.style.setProperty("--folder-head-bg", folder.headBg);
                        }
                        fDiv.oncontextmenu = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.showFolderContextMenu(folder, fDiv, e.clientX, e.clientY);
                        };

                        fDiv.ondragenter = () => {
                            const dc = mplFolderDropColors(fDiv);
                            fDiv.style.setProperty("--mpl-folder-drop-color", dc.color);
                            fDiv.style.setProperty("--mpl-folder-drop-glow", dc.glow);
                        };
                        fDiv.ondragover = (e) => {
                            e.preventDefault();
                            fDiv.classList.remove("drag-over", "mpl-top-drop-before", "mpl-top-drop-after");
                            if (this._currentTopDrag) {
                                const r = fDiv.getBoundingClientRect();
                                fDiv.classList.add((e.clientY - r.top) > r.height / 2 ? "mpl-top-drop-after" : "mpl-top-drop-before");
                                return;
                            }
                            const isLoraDrag = this._currentSortDrag || e.dataTransfer.types.includes("application/x-sort-drag");
                            const edge = isLoraDrag ? this._mplFolderHeaderDropEdge(fDiv, e.clientY) : "";
                            if (edge) fDiv.classList.add(edge === "before" ? "mpl-top-drop-before" : "mpl-top-drop-after");
                            else fDiv.classList.add("drag-over");
                        };
                        fDiv.ondragleave = () => { fDiv.classList.remove("drag-over", "mpl-top-drop-before", "mpl-top-drop-after"); };
                        fDiv.ondrop = (e) => {
                            e.preventDefault();
                            fDiv.classList.remove("drag-over", "mpl-top-drop-before", "mpl-top-drop-after");
                            try {
                                const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                                if (data) {
                                    const loraEdge = this._mplFolderHeaderDropEdge(fDiv, e.clientY);
                                    const isLoraDrag = data.type === "sort" ||
                                        (data.type === "top" && typeof data.tok === "string" && data.tok.startsWith("l:"));
                                    if (isLoraDrag && loraEdge) {
                                        e.stopPropagation();
                                        let moved = null;
                                        if (data.type === "top") {
                                            const uid = data.tok.slice(2);
                                            moved = (this.loraData.loras || []).find(l => this._uidFor(l) === uid) || null;
                                            if (!moved) {
                                                for (const f of (this.loraData.folders || [])) {
                                                    const i = (f.loras || []).findIndex(l => this._uidFor(l) === uid);
                                                    if (i >= 0) { moved = f.loras[i]; f.loras.splice(i, 1); break; }
                                                }
                                            }
                                        } else if (data.sourceType === "root") {
                                            moved = (this.loraData.loras || [])[data.sourceLIdx] || null;
                                        } else if (data.sourceType === "folder") {
                                            const src = this.loraData.folders[data.sourceFIdx];
                                            if (src && data.sourceLIdx >= 0 && data.sourceLIdx < (src.loras || []).length) {
                                                moved = src.loras[data.sourceLIdx];
                                                src.loras.splice(data.sourceLIdx, 1);
                                            }
                                        }
                                        if (moved) {
                                            if (!(this.loraData.loras || []).includes(moved)) this.loraData.loras.push(moved);
                                            this._mplPlaceToken("l:" + this._uidFor(moved), tok, loraEdge === "after");
                                        }
                                        this._currentTopDrag = null;
                                        this._currentSortDrag = null;
                                        this.renderEmbeddedList();
                                        this.updateWidget();
                                        return;
                                    }
                                }
                                if (data && data.type === "top" && typeof data.tok === "string") {
                                    e.stopPropagation();
                                    if (data.tok.startsWith("l:")) {
                                        const uid = data.tok.slice(2);
                                        const ri = this.loraData.loras.findIndex(l => this._uidFor(l) === uid);
                                        if (ri >= 0) {
                                            const moved = this.loraData.loras[ri];
                                            this.loraData.loras.splice(ri, 1);
                                            folder.loras.push(moved);
                                            folder.collapsed = false;
                                        }
                                    } else if (data.tok.startsWith("f:") && data.tok !== tok) {
                                        const rect = fDiv.getBoundingClientRect();
                                        const after = (e.clientY - rect.top) > rect.height / 2;
                                        this._moveTopToken(data.tok, tok, after);
                                    }
                                    this._currentTopDrag = null;
                                    this.renderEmbeddedList();
                                    this.updateWidget();
                                    return;
                                }
                                let movedItem = null;
                                if (data.sourceLIdx !== undefined && (data.sourceType === "root" || data.sourceType === "folder")) {
                                    if (data.sourceType === "root") {
                                        const src = this.loraData.loras;
                                        if (data.sourceLIdx >= 0 && data.sourceLIdx < src.length) {
                                            movedItem = src[data.sourceLIdx];
                                            src.splice(data.sourceLIdx, 1);
                                        }
                                    } else {
                                        if (data.sourceFIdx >= 0 && data.sourceFIdx < this.loraData.folders.length) {
                                            const srcFolder = this.loraData.folders[data.sourceFIdx];
                                            if (data.sourceFIdx !== fIdx && data.sourceLIdx >= 0 && data.sourceLIdx < srcFolder.loras.length) {
                                                movedItem = srcFolder.loras[data.sourceLIdx];
                                                srcFolder.loras.splice(data.sourceLIdx, 1);
                                            }
                                        }
                                    }
                                } else if (data.type === "root") {
                                    if (data.lIdx >= 0 && data.lIdx < this.loraData.loras.length) {
                                        movedItem = this.loraData.loras[data.lIdx];
                                        this.loraData.loras.splice(data.lIdx, 1);
                                    }
                                } else if (data.type === "folder") {
                                    if (data.fIdx >= 0 && data.fIdx < this.loraData.folders.length) {
                                        const srcFolder = this.loraData.folders[data.fIdx];
                                        if (data.fIdx !== fIdx && data.lIdx >= 0 && data.lIdx < srcFolder.loras.length) {
                                            movedItem = srcFolder.loras[data.lIdx];
                                            srcFolder.loras.splice(data.lIdx, 1);
                                        }
                                    }
                                }
                                if (movedItem) {
                                    folder.loras.push(movedItem);
                                    folder.collapsed = false;
                                    this.renderEmbeddedList();
                                    this.updateWidget();
                                }
                            } catch (err) {
                                console.error("拖拽到文件夹错误:", err);
                            }
                        };

                        const header = document.createElement("div");
                        header.className = "mpl-folder-header";

                        const collapseIcon = document.createElement("span");
                        collapseIcon.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:16px;color:#a1a1aa;cursor:pointer;";
                        collapseIcon.innerHTML = mplIcon(folder.collapsed ? 'chevronRight' : 'chevronDown', 14);
                        collapseIcon.onclick = (e) => { e.stopPropagation(); folder.collapsed = !folder.collapsed; this.renderEmbeddedList(); };
                        _mkTopDragHandle(collapseIcon, tok, fDiv);
                        collapseIcon.addEventListener("pointerdown", (e)=>e.stopPropagation());
                        collapseIcon.addEventListener("mousedown", (e)=>e.stopPropagation());

                        const ignoreBtn = document.createElement("button");
                        ignoreBtn.type = "button";
                        ignoreBtn.className = "mpl-folder-ignore" + (folder.ignored ? " active" : "");
                        ignoreBtn.innerHTML = mplIcon(folder.ignored ? "eyeOff" : "eyeCute", folder.ignored ? 13 : 16);
                        ignoreBtn.title = folder.ignored ? "恢复此文件夹（重新参与加载）" : "忽略此文件夹（不参与加载，保留组内勾选状态）";
                        ignoreBtn.onclick = (e) => {
                            e.stopPropagation();
                            folder.ignored = !folder.ignored;
                            this.updateWidget();
                            this.renderEmbeddedList();
                        };
                        ignoreBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                        ignoreBtn.addEventListener("mousedown", (e)=>e.stopPropagation());
                        ignoreBtn.addEventListener("click", (e)=>e.stopPropagation());

                        const folderToggle = document.createElement("input");
                        folderToggle.type = "checkbox";
                        const _fLoras = (folder.loras || []);
                        const _fSelCount = _fLoras.filter(l => this._isMultiSelected(folder, l)).length;
                        folderToggle.checked = _fLoras.length > 0 && _fSelCount === _fLoras.length;
                        folderToggle.indeterminate = _fSelCount > 0 && _fSelCount < _fLoras.length;
                        folderToggle.title = "启用/停用此文件夹内的全部 LoRA";
                        folderToggle.style.cssText = "width:15px;height:15px;cursor:pointer;margin-right:4px;margin-left:2px;accent-color:#6366f1;";
                        folderToggle.onchange = (e) => {
                            e.stopPropagation();
                            const newState = folderToggle.checked;
                            if (folder.loras && folder.loras.length > 0) {
                                folder.loras.forEach(lora => { newState ? this._addMultiSelected(folder, lora) : this._removeMultiSelected(folder, lora); });
                                this.updateWidget();
                                this.renderEmbeddedList();
                            }
                        };
                        folderToggle.addEventListener("pointerdown", (e)=>e.stopPropagation());
                        folderToggle.addEventListener("mousedown", (e)=>e.stopPropagation());
                        folderToggle.addEventListener("click", (e)=>e.stopPropagation());

                        const title = document.createElement("span");
                        title.className = "mpl-folder-title";
                        title.textContent = folder.name;
                        title.title = "左键折叠/展开 · 眼睛按钮忽略/恢复 · 右键菜单";
                        title.draggable = true;
                        title.ondragstart = (e) => {
                            e.stopPropagation();
                            try {
                                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "top", tok }));
                                e.dataTransfer.setData("application/x-mpl-folder", JSON.stringify({ tok }));
                                e.dataTransfer.effectAllowed = "copy";
                            } catch (_) {}
                        };
                        title.onclick = (e) => {
                            e.stopPropagation();
                            folder.collapsed = !folder.collapsed;
                            this.renderEmbeddedList();
                        };

                        header.appendChild(collapseIcon);
                        header.appendChild(ignoreBtn);
                        header.appendChild(folderToggle);
                        header.appendChild(title);

                        const titleSpace = document.createElement("div");
                        titleSpace.className = "mpl-folder-title-space";
                        titleSpace.style.cssText = "flex:1 1 auto; min-width:8px; align-self:stretch; cursor:move;";
                        titleSpace.title = "拖动调整位置；单击折叠/展开";
                        titleSpace.onclick = (e) => {
                            e.stopPropagation();
                            folder.collapsed = !folder.collapsed;
                            this.renderEmbeddedList();
                        };
                        _mkTopDragHandle(titleSpace, tok, fDiv);
                        header.appendChild(titleSpace);

                        const controls = document.createElement("div");
                        controls.className = "mpl-folder-controls";

                        const saveBtn = document.createElement("button");
                        saveBtn.className = "mpl-mini-btn save";
                        saveBtn.innerHTML = "💾";
                        saveBtn.title = "保存为预设";
                        saveBtn.onclick = (e) => {
                            e.stopPropagation();
                            this.saveFolderPreset(folder);
                        };
                        saveBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                        const delBtn = document.createElement("button");
                        delBtn.className = "mpl-mini-btn del";
                        delBtn.innerHTML = mplIcon("close", 13);
                        delBtn.title = "删除文件夹";
                        delBtn.onclick = async (e) => {
                            e.stopPropagation();
                            if (await mplConfirm("Delete folder?", { danger: true, okText: "删除" })) {
                                if (this._previewTimeout) { clearTimeout(this._previewTimeout); this._previewTimeout = null; }
                                if (this._previewDiv) { this._previewDiv.remove(); this._previewDiv = null; }
                                document.querySelectorAll('.mpl-lora-preview').forEach(p => p.remove());
                                this.loraData.folders.splice(fIdx, 1);
                                this.renderEmbeddedList();
                                this.updateWidget();
                            }
                        };
                        delBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                        controls.append(saveBtn, delBtn);
                        header.appendChild(controls);

                        header.onclick = (e) => {
                            if (e.target === header ||
                                (e.target.classList && e.target.classList.contains("mpl-folder-title-space"))) {
                                folder.collapsed = !folder.collapsed;
                                this.renderEmbeddedList();
                            }
                        };
                        fDiv.appendChild(header);

                        if (!folder.collapsed) {
                            folder.loras.forEach((lora, lIdx) => {
                                const row = this.createLoraRow(lora, 'folder', fIdx, lIdx);
                                row.querySelector(".del").onclick = () => {
                                    if (this._previewTimeout) { clearTimeout(this._previewTimeout); this._previewTimeout = null; }
                                    if (this._previewDiv) { this._previewDiv.remove(); this._previewDiv = null; }
                                    document.querySelectorAll('.mpl-lora-preview').forEach(p => p.remove());
                                    folder.loras.splice(lIdx, 1);
                                    this.renderEmbeddedList();
                                    this.updateWidget();
                                };
                                fDiv.appendChild(row);
                            });
                        }
                        container.appendChild(fDiv);
                    } else if (tok.startsWith("l:")) {
                        const uid = tok.slice(2);
                        const lIdx = _rootLoras.findIndex(l => this._uidFor(l) === uid);
                        if (lIdx < 0) return;
                        const lora = _rootLoras[lIdx];
                        const row = this.createLoraRow(lora, 'root', -1, lIdx);
                        row.classList.add("root-item");
                        const topHandle = row.querySelector(".mpl-sort-handle");
                        if (topHandle) { _mkTopDragHandle(topHandle, tok, row, { mime: "application/x-mpl-lora", value: { name: lora.name } }); }
                        _bindTopDropTarget(row, tok);
                        row.querySelector(".del").onclick = () => {
                            if (this._previewTimeout) { clearTimeout(this._previewTimeout); this._previewTimeout = null; }
                            if (this._previewDiv) { this._previewDiv.remove(); this._previewDiv = null; }
                            document.querySelectorAll('.mpl-lora-preview').forEach(p => p.remove());
                            _rootLoras.splice(lIdx, 1);
                            this.renderEmbeddedList();
                            this.updateWidget();
                        };
                        container.appendChild(row);
                    }
                });
                // 空列表时给一个明确引导，避免「一片空白不知道干啥」
                if (!container.querySelector(".mpl-lora-row") && !container.querySelector(".mpl-folder-row")) {
                    const hint = document.createElement("div");
                    hint.className = "mpl-empty-hint";
                    hint.innerHTML = '<div>还没有 LoRA</div>' +
                        '<div style="font-size:11.5px;color:#52525b;line-height:1.6;">点下方「➕ 添加 Lora」选择模型；常用组合可存为预设，在「📂预设」里一键发送。</div>';
                    container.appendChild(hint);
                }
                if (_prevScrollTop > 0) container.scrollTop = _prevScrollTop;
            };

            // 通用的弹窗拖拽功能（一比一参考 magic_resolution.js）
            nodeType.prototype.makeDialogDraggable = function(dialog, titleBar) {
                let isDragging = false;
                let offsetX = 0;
                let offsetY = 0;

                titleBar.style.cursor = "move";
                titleBar.style.userSelect = "none";

                const dragStart = (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                        e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                        return;
                    }

                    const rect = dialog.getBoundingClientRect();

                    let mouseX, mouseY;
                    if (e.type === "mousedown") {
                        mouseX = e.clientX;
                        mouseY = e.clientY;
                        isDragging = true;
                    } else if (e.type === "touchstart") {
                        mouseX = e.touches[0].clientX;
                        mouseY = e.touches[0].clientY;
                        isDragging = true;
                    } else {
                        return;
                    }

                    offsetX = mouseX - rect.left;
                    offsetY = mouseY - rect.top;

                    e.preventDefault();
                };

                const drag = (e) => {
                    if (!isDragging) return;

                    e.preventDefault();

                    let mouseX, mouseY;
                    if (e.type === "mousemove") {
                        mouseX = e.clientX;
                        mouseY = e.clientY;
                    } else if (e.type === "touchmove") {
                        mouseX = e.touches[0].clientX;
                        mouseY = e.touches[0].clientY;
                    } else {
                        return;
                    }

                    let newX = mouseX - offsetX;
                    let newY = mouseY - offsetY;

                    const minX = 0;
                    const minY = 0;
                    const maxX = window.innerWidth - dialog.offsetWidth;
                    const maxY = window.innerHeight - dialog.offsetHeight;
                    newX = Math.max(minX, Math.min(newX, maxX));
                    newY = Math.max(minY, Math.min(newY, maxY));

                    dialog.style.top = '0px';
                    dialog.style.left = '0px';
                    dialog.style.right = '';
                    dialog.style.bottom = '';

                    const parent = dialog.parentElement;
                    if (parent && parent !== document.body && parent.style.display === 'flex') {
                        parent.style.display = 'block';
                        parent.style.position = 'fixed';
                        parent.style.top = '0';
                        parent.style.left = '0';
                        parent.style.width = '100%';
                        parent.style.height = '100%';
                    }

                    dialog.style.position = 'fixed';
                    dialog.style.transform = `translate(${newX}px, ${newY}px)`;
                };

                const dragEnd = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    try {
                        if (typeof dialog.__maSaveWinPos === "function") {
                            const r = dialog.getBoundingClientRect();
                            dialog.style.transform = "";
                            dialog.style.top = r.top + "px";
                            dialog.style.left = r.left + "px";
                            dialog.style.right = "";
                            dialog.style.bottom = "";
                            const parent = dialog.parentElement;
                            if (parent && parent !== document.body &&
                                (parent.style.display === 'flex' || parent.style.position === 'fixed')) {
                                parent.style.display = '';
                                parent.style.position = '';
                                parent.style.top = '';
                                parent.style.left = '';
                                parent.style.width = '';
                                parent.style.height = '';
                            }
                            dialog.__maSaveWinPos();
                        }
                    } catch (e) {}
                };

                titleBar.addEventListener("mousedown", dragStart);
                titleBar.addEventListener("touchstart", dragStart);
                document.addEventListener("mousemove", drag);
                document.addEventListener("touchmove", drag);
                document.addEventListener("mouseup", dragEnd);
                document.addEventListener("touchend", dragEnd);
                return () => {
                    isDragging = false;
                    titleBar.removeEventListener("mousedown", dragStart);
                    titleBar.removeEventListener("touchstart", dragStart);
                    document.removeEventListener("mousemove", drag);
                    document.removeEventListener("touchmove", drag);
                    document.removeEventListener("mouseup", dragEnd);
                    document.removeEventListener("touchend", dragEnd);
                };
            };

            // --- Klein 模式提示 Banner ---
            nodeType.prototype._updateKleinBanner = function() {
                const container = this.embeddedDiv;
                if (!container) return;

                if (this._kleinBannerEl) {
                    this._kleinBannerEl.remove();
                    this._kleinBannerEl = null;
                }

                const kleinMode = this.kleinMode
                    ?? this.properties?.klein_mode
                    ?? this._kleinModeWidget?.value
                    ?? "auto";
                const isKleinActive = String(kleinMode).toLowerCase() === "klein";

                if (isKleinActive) return;

                const isKleinModelConnected = this.inputs?.some(input => {
                    if (!input.link) return false;
                    const link = app.graph.links?.[input.link];
                    if (!link) return false;
                    const originNode = app.graph.getNodeById(link.origin_id);
                    return originNode?.type === "MagicKleinLoader";
                });

                if (!isKleinModelConnected) return;

                const banner = document.createElement("div");
                banner.style.cssText = `
                    background: #1a3a2a;
                    border-left: 3px solid #4CAF50;
                    border-right: 3px solid #4CAF50;
                    padding: 8px 12px;
                    margin: 4px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                    color: #a5d6a7;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                `;
                banner.innerHTML = `
                    <span style="font-size: 14px;">&#x1F31F;</span>
                    <span style="flex: 1;">
                        已检测到 Klein 模型，请前往 <b>&#x2699;&#xFE0F;设置 &rarr; LoRA 加载模式</b>
                        启用 <b>tonera-Klein-Nunchaku</b> 模式以正确加载 LoRA
                    </span>
                    <button
                        style="background:#2e7d32;border:1px solid #4CAF50;color:#a5d6a7;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;flex-shrink:0;"
                    >前往设置</button>
                `;

                banner.querySelector("button").onclick = () => {
                    this.showSettingsModal();
                };

                const listContainer = this.listContainer;
                if (listContainer && listContainer.parentNode) {
                    listContainer.parentNode.insertBefore(banner, listContainer);
                } else if (container) {
                    container.appendChild(banner);
                }

                this._kleinBannerEl = banner;
            };

            nodeType.prototype.showTagEditModal = function(lora) {
                // 创建遮罩层
                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop";
                overlay.style.zIndex = "10001";
                
                // 创建弹窗
                const dialog = document.createElement("div");
                dialog.className = "ma-modal";
                dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 540px;
                    max-width: 92vw;
                    z-index: 10002;
                `;
                
                // 标题栏（可拖拽）
                const title = document.createElement("div");
                title.textContent = "编辑触发词";
                title.className = "ma-modal-header ma-modal-title";
                
                // 输入框容器
                const inputContainer = document.createElement("div");
                inputContainer.className = "ma-modal-body";
                inputContainer.style.padding = "18px 20px";
                
                const label = document.createElement("label");
                label.textContent = "使用触发词时需要将tags_output连接出去，可以连到文本框、clip框等等";
                label.className = "ma-section-label";
                label.style.marginBottom = "10px";
                
                const textarea = document.createElement("textarea");
                textarea.className = "ma-textarea";
                textarea.value = lora.tags || "";
                textarea.style.cssText = `
                    width: 100%;
                    min-height: 110px;
                    resize: vertical;
                `;
                textarea.placeholder = "输入标签，用逗号分隔...";
                
                inputContainer.appendChild(label);
                inputContainer.appendChild(textarea);
                
                // 按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.className = "ma-modal-footer";
                
                // 获取现成tag按钮
                const fetchBtn = document.createElement("button");
                fetchBtn.textContent = "🔍 获取现成tag";
                fetchBtn.className = "ma-btn ma-btn-success";
                fetchBtn.style.marginRight = "auto";
                fetchBtn.onclick = async () => {
                    try {
                        // 读取本地的.txt文件
                        const response = await api.fetchApi('/ma/lora/get_lora_file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_filename: lora.name, file_type: 'txt' })
                        });
                        
                        const result = await response.json();
                        
                        if (result.status === 'success' && result.content && result.content.trim()) {
                            // 获取当前文本框内容
                            const currentValue = textarea.value.trim();
                            
                            // 追加内容：先添加","和换行，然后追加新内容
                            let newValue = currentValue;
                            if (currentValue) {
                                // 如果当前内容不为空，先添加","和换行
                                newValue += ",\n";
                            }
                            // 追加.txt文件的内容
                            newValue += result.content.trim();
                            
                            // 更新文本框内容
                            textarea.value = newValue;
                            
                            // 将光标移动到末尾
                            textarea.focus();
                            textarea.setSelectionRange(newValue.length, newValue.length);
                        } else {
                            // 没有读取到文件或内容为空
                            void mplAlert("没有获取到现成的tag");
                        }
                    } catch (error) {
                        console.error("读取txt文件时出错:", error);
                        void mplAlert("没有获取到现成的tag");
                    }
                };
                
                // 确定按钮
                const confirmBtn = document.createElement("button");
                confirmBtn.textContent = "确定";
                confirmBtn.className = "ma-btn ma-btn-primary";
                confirmBtn.onclick = () => {
                    lora.tags = textarea.value.trim();
                    this.renderEmbeddedList();
                    this.updateWidget();
                    document.body.removeChild(overlay);
                };
                
                // 取消按钮
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.className = "ma-btn";
                cancelBtn.onclick = () => {
                    document.body.removeChild(overlay);
                };
                
                // 阻止事件冒泡
                const stopProp = (e) => { e.stopPropagation(); };
                dialog.addEventListener("pointerdown", stopProp);
                dialog.addEventListener("pointermove", stopProp);
                dialog.addEventListener("pointerup", stopProp);
                dialog.addEventListener("mousedown", stopProp);
                dialog.addEventListener("wheel", stopProp, { passive: false });
                
                // 点击遮罩层关闭
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        document.body.removeChild(overlay);
                    }
                };
                
                // ESC键关闭
                const handleEsc = (e) => {
                    if (e.key === "Escape") {
                        document.body.removeChild(overlay);
                        document.removeEventListener("keydown", handleEsc);
                    }
                };
                document.addEventListener("keydown", handleEsc);
                
                // 组装弹窗
                buttonContainer.appendChild(fetchBtn);
                buttonContainer.appendChild(confirmBtn);
                buttonContainer.appendChild(cancelBtn);
                dialog.appendChild(title);
                dialog.appendChild(inputContainer);
                dialog.appendChild(buttonContainer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                
                // 使弹窗可拖拽
                this.makeDialogDraggable(dialog, title);
                
                // 自动聚焦到输入框
                setTimeout(() => textarea.focus(), 100);
            };

            nodeType.prototype.showLoraEditModal = async function(lora, type, fIdx, lIdx, filePath) {
                // 先读取本地文件内容
                const loraName = filePath || lora.name;
                let fileContents = {
                    txt: '',
                    json: '',
                    log: ''
                };
                
                try {
                    const [txtResp, jsonResp, logResp] = await Promise.all([
                        api.fetchApi('/ma/lora/get_lora_file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_filename: loraName, file_type: 'txt' })
                        }).catch(() => null),
                        api.fetchApi('/ma/lora/get_lora_file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_filename: loraName, file_type: 'json' })
                        }).catch(() => null),
                        api.fetchApi('/ma/lora/get_lora_file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_filename: loraName, file_type: 'log' })
                        }).catch(() => null)
                    ]);
                    
                    if (txtResp) {
                        const txtData = await txtResp.json();
                        if (txtData.status === 'success' && txtData.content) {
                            fileContents.txt = txtData.content;
                        }
                    }
                    if (jsonResp) {
                        const jsonData = await jsonResp.json();
                        if (jsonData.status === 'success' && jsonData.content) {
                            fileContents.json = jsonData.content;
                        }
                    }
                    if (logResp) {
                        const logData = await logResp.json();
                        if (logData.status === 'success' && logData.content) {
                            fileContents.log = logData.content;
                        }
                    }
                } catch (e) {
                    console.error("读取本地文件时出错:", e);
                }
                
                // 创建遮罩层
                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop";
                overlay.style.zIndex = "10001";
                
                // 创建弹窗
                const dialog = document.createElement("div");
                dialog.className = "ma-modal";
                dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    min-width: min(680px, 94vw);
                    max-width: 960px;
                    width: 85%;
                    max-height: 88vh;
                    z-index: 10002;
                `;
                
                // 标题栏
                const header = document.createElement("div");
                header.className = "ma-modal-header";
                
                const lmInfo = mplLmEntry(loraName);
                const loraStem = String(loraName).split(/[/\\]/).pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "");
                const lmTitle = String(lmInfo.title || "").trim();

                const title = document.createElement("div");
                title.textContent = lmTitle ? `编辑 LoRA 内容: ${lmTitle}` : `编辑 LoRA 内容: ${lora.name.split(/[/\\]/).pop()}`;
                title.className = "ma-modal-title";
                title.style.flex = "1";
                title.style.cursor = "pointer";
                title.title = (lmTitle || loraStem) + "\n单击复制标题";

                const copyText = async (text) => {
                    const val = String(text == null ? "" : text);
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(val);
                            return true;
                        }
                    } catch (e) {}
                    try {
                        const ta = document.createElement("textarea");
                        ta.value = val;
                        ta.style.cssText = "position:fixed;left:-9999px;top:0;";
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        ta.remove();
                        return true;
                    } catch (e) { return false; }
                };

                title.onclick = async (e) => {
                    e.stopPropagation();
                    const ok = await copyText(lmTitle || loraStem);
                    const prev = title.textContent;
                    title.textContent = ok ? "✓ 已复制标题" : "复制失败";
                    setTimeout(() => { title.textContent = prev; }, 900);
                };
                
                const deleteBtn = document.createElement("button");
                deleteBtn.textContent = "删除";
                deleteBtn.className = "ma-btn ma-btn-danger";
                deleteBtn.onclick = async () => {
                    if (await mplConfirm("确定要删除这个 LoRA 及其所有相关文件吗？此操作不可恢复！", { danger: true, okText: "删除" })) {
                        try {
                            const response = await api.fetchApi('/ma/lora/delete_lora_complete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lora_name: lora.name })
                            });
                            const result = await response.json();
                            
                            if (result.status === 'success') {
                                const deletedLoraName = lora.name;
                                
                                if (this._previewTimeout) {
                                    clearTimeout(this._previewTimeout);
                                    this._previewTimeout = null;
                                }
                                if (this._previewDiv) {
                                    this._previewDiv.remove();
                                    this._previewDiv = null;
                                }
                                const allPreviews = document.querySelectorAll('.mpl-lora-preview');
                                allPreviews.forEach(preview => preview.remove());
                                
                                if (type === 'folder' && fIdx >= 0 && lIdx >= 0) {
                                    if (this.loraData.folders[fIdx] && this.loraData.folders[fIdx].loras[lIdx]) {
                                        this.loraData.folders[fIdx].loras.splice(lIdx, 1);
                                    }
                                } else if (type === 'root' && lIdx >= 0) {
                                    if (this.loraData.loras[lIdx]) {
                                        this.loraData.loras.splice(lIdx, 1);
                                    }
                                } else {
                                    const loraName = lora.name;
                                    const rootIdx = this.loraData.loras.findIndex(l => l.name === loraName);
                                    if (rootIdx >= 0) {
                                        this.loraData.loras.splice(rootIdx, 1);
                                    } else {
                                        for (let fi = 0; fi < this.loraData.folders.length; fi++) {
                                            const folder = this.loraData.folders[fi];
                                            const li = folder.loras.findIndex(l => l.name === loraName);
                                            if (li >= 0) {
                                                folder.loras.splice(li, 1);
                                                break;
                                            }
                                        }
                                    }
                                }
                                
                                await loadLoraImageList();
                                this.renderEmbeddedList();
                                this.updateWidget();
                                this.refreshLoraImageCache(deletedLoraName);
                                
                                if (this._addLoraModal && this._addLoraModal.parentElement && this._refreshFileListFunc) {
                                    await this._refreshFileListFunc();
                                } else if (this._addLoraModal && this._addLoraModal.parentElement && this._renderContentFunc) {
                                    this._renderContentFunc();
                                }
                                
                                document.body.removeChild(overlay);
                                void mplAlert(result.message || "删除成功");
                            } else {
                                void mplAlert(result.message || "删除失败");
                            }
                        } catch (error) {
                            console.error("删除LoRA时出错:", error);
                            void mplAlert("删除失败: " + error.message);
                        }
                    }
                };
                header.appendChild(title);
                header.appendChild(deleteBtn);

                // 顶部快捷信息栏（位置打开、基础模型、CivitAI 跳转、附加备注）
                const infoSection = document.createElement("div");
                infoSection.style.cssText = "padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.08);background:#0d0d10;display:flex;flex-direction:column;gap:8px;flex-shrink:0;";

                const topActions = document.createElement("div");
                topActions.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
                const addNodeBtn = document.createElement("button");
                addNodeBtn.type = "button";
                addNodeBtn.className = "ma-btn ma-btn-primary";
                addNodeBtn.textContent = "➕ 添加到节点";
                addNodeBtn.style.cssText = "padding:4px 12px;font-size:12px;";
                addNodeBtn.onclick = () => {
                    if (!this.loraData) this.loraData = { loras: [], folders: [] };
                    if (!Array.isArray(this.loraData.loras)) this.loraData.loras = [];
                    const newLora = mplDecorateNewLora({
                        name: loraName, weight: 1.0, enabled: true, tags: fileContents.txt || "", note: "", triggerWords: fileContents.txt || "", jsonInfo: "", logInfo: "",
                    });
                    const _addRec = Number(lmInfo.recommended_weight);
                    if (Number.isFinite(_addRec) && _addRec > 0 && _addRec <= 1 && newLora.recommendedWeight === undefined) {
                        newLora.recommendedWeight = _addRec;
                        newLora.recommendedWeightSource = lmInfo.recommended_weight_source || "作者推荐";
                    }
                    this.loraData.loras.push(newLora);
                    this.renderEmbeddedList();
                    this.updateWidget();
                };
                const civitaiBtn = document.createElement("button");
                civitaiBtn.type = "button";
                civitaiBtn.className = "ma-btn";
                civitaiBtn.textContent = "🌐 在 CivitAI 查看";
                civitaiBtn.style.cssText = "padding:4px 12px;font-size:12px;";
                civitaiBtn.onclick = () => { try { this.openLoraCivitai(loraName); } catch (e) { console.warn(e); } };
                topActions.appendChild(addNodeBtn);
                topActions.appendChild(civitaiBtn);

                const absPath = mplPathFor(loraName);
                const dirPath = absPath
                    ? absPath.replace(/\/[^\/]*$/, "/")
                    : (String(loraName).split(/[/\\]/).slice(0, -1).join("/") ? String(loraName).split(/[/\\]/).slice(0, -1).join("/") + "/" : "");
                const metaInfoLine = document.createElement("div");
                metaInfoLine.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;color:#a1a1aa;";
                const fileSpan = document.createElement("span");
                fileSpan.textContent = `文件名: ${loraStem}`;
                fileSpan.style.color = "#d4d4d8";
                const baseModelSpan = document.createElement("span");
                baseModelSpan.textContent = `基础模型: ${String(lmInfo.base_model || "").trim() || "—"}`;
                const _infoRecW = Number(lmInfo.recommended_weight ?? lora?.recommendedWeight);
                const _hasInfoRec = Number.isFinite(_infoRecW) && _infoRecW > 0 && _infoRecW <= 1;
                const recSpan = document.createElement("span");
                recSpan.textContent = `推荐权重: ${_hasInfoRec ? "荐 " + _infoRecW.toFixed(2) : "—"}`;
                recSpan.style.color = _hasInfoRec ? "#6ee7b7" : "#a1a1aa";
                recSpan.title = _hasInfoRec
                    ? `作者推荐权重 ${_infoRecW.toFixed(2)}（${lmInfo.recommended_weight_source || lora?.recommendedWeightSource || "作者推荐"}）`
                    : "未找到作者推荐权重";
                const dirSpan = document.createElement("span");
                dirSpan.textContent = `📂 位置: ${dirPath || "根目录"} (点击打开目录)`;
                dirSpan.style.cssText = "color:#818cf8;cursor:pointer;";
                dirSpan.title = "点击在资源管理器中定位该 LoRA";
                dirSpan.onclick = () => {
                    api.fetchApi("/ma/lora/open_folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lora_name: loraName }),
                    }).catch((e) => console.warn("[MA Loader] 打开文件夹失败:", e));
                };
                metaInfoLine.append(fileSpan, baseModelSpan, recSpan, dirSpan);
                topActions.appendChild(metaInfoLine);
                infoSection.appendChild(topActions);

                const prevNote = String(lora.note || "");
                const noteRow = document.createElement("div");
                noteRow.style.cssText = "display:flex;align-items:center;gap:8px;";
                const noteLabel = document.createElement("span");
                noteLabel.textContent = "附加备注:";
                noteLabel.style.cssText = "color:#a1a1aa;font-size:12px;white-space:nowrap;";
                const noteInput = document.createElement("input");
                noteInput.type = "text";
                noteInput.className = "ma-input";
                noteInput.value = prevNote || mplNoteFor(loraName);
                noteInput.placeholder = "在此添加你的持久化备注...";
                noteInput.style.cssText = "flex:1;padding:5px 10px;font-size:12px;";
                noteInput.addEventListener("keydown", (e) => e.stopPropagation());
                noteInput.addEventListener("pointerdown", (e) => e.stopPropagation());
                noteRow.append(noteLabel, noteInput);
                infoSection.appendChild(noteRow);
                
                // Tab容器
                const tabContainer = document.createElement("div");
                tabContainer.className = "ma-tabs";
                
                const tabs = [
                    { id: 'txt', label: '触发词文件(txt)' },
                    { id: 'json', label: '官网介绍文档(json)' },
                    { id: 'log', label: '介绍文件(log)' }
                ];
                
                let currentTab = 'txt';
                const tabButtons = {};
                
                tabs.forEach(tab => {
                    const tabBtn = document.createElement("button");
                    tabBtn.textContent = tab.label;
                    tabBtn.dataset.tab = tab.id;
                    tabBtn.className = "ma-tab-btn" + (currentTab === tab.id ? " active" : "");
                    tabBtn.onclick = () => {
                        currentTab = tab.id;
                        tabs.forEach(t => {
                            const btn = tabButtons[t.id];
                            btn.className = "ma-tab-btn" + (currentTab === t.id ? " active" : "");
                        });
                        contentAreas.forEach((area, idx) => {
                            area.style.display = tabs[idx].id === currentTab ? 'flex' : 'none';
                        });
                    };
                    tabButtons[tab.id] = tabBtn;
                    tabContainer.appendChild(tabBtn);
                });
                
                // 内容区域容器
                const contentWrapper = document.createElement("div");
                contentWrapper.className = "ma-modal-body";
                contentWrapper.style.cssText = `
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 260px;
                    overflow: hidden;
                    padding: 16px 20px;
                `;
                
                const contentAreas = [];
                tabs.forEach(tab => {
                    const contentArea = document.createElement("div");
                    contentArea.dataset.tab = tab.id;
                    contentArea.style.cssText = `
                        display: ${currentTab === tab.id ? 'flex' : 'none'};
                        flex-direction: column;
                        flex: 1;
                        height: 100%;
                    `;
                    
                    const textarea = document.createElement("textarea");
                    textarea.className = "ma-textarea ma-textarea-code";
                    textarea.style.cssText = `
                        flex: 1;
                        width: 100%;
                        min-height: 280px;
                        padding: 14px;
                        resize: both;
                    `;
                    
                    if (tab.id === 'txt') {
                        textarea.value = fileContents.txt || '';
                    } else if (tab.id === 'json') {
                        textarea.value = fileContents.json || '';
                    } else {
                        textarea.value = fileContents.log || '';
                    }
                    
                    contentArea.appendChild(textarea);
                    contentWrapper.appendChild(contentArea);
                    contentAreas.push(contentArea);
                });
                
                // 底部按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.className = "ma-modal-footer";
                
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.className = "ma-btn";
                cancelBtn.onclick = () => {
                    document.body.removeChild(overlay);
                };
                
                const saveBtn = document.createElement("button");
                saveBtn.textContent = "保存";
                saveBtn.className = "ma-btn ma-btn-primary";
                const showSaveTargetDialog = () => new Promise((resolve) => {
                    const saveOverlay = document.createElement("div");
                    saveOverlay.className = "ma-modal-backdrop";
                    saveOverlay.style.zIndex = "10005";
                    
                    const saveDialog = document.createElement("div");
                    saveDialog.className = "ma-modal ma-modal-static-anim";
                    saveDialog.style.cssText = "padding: 20px 22px; width: 420px; max-width: 92vw; z-index: 10006;";
                    
                    const title = document.createElement("p");
                    title.textContent = "选择保存位置";
                    title.style.cssText = "margin: 0 0 10px; color: #f4f4f5; font-weight: 600; font-size: 15px;";
                    
                    const tips = document.createElement("p");
                    tips.textContent = "请选择要将修改内容保存到哪里。您也可以选择同时保存到两个位置。";
                    tips.style.cssText = "margin: 0 0 14px; color: #a1a1aa; line-height: 1.5; font-size: 12.5px;";
                    
                    const targetContainer = document.createElement("div");
                    targetContainer.className = "ma-card";
                    targetContainer.style.cssText = "margin: 4px 0 16px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap;";
                    
                    const targetLabel = document.createElement("span");
                    targetLabel.textContent = "保存位置";
                    targetLabel.style.cssText = "color: #a1a1aa; font-size: 12px; font-weight: 500;";
                    
                    const sameLabel = document.createElement("label");
                    sameLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer; font-size: 12.5px;";
                    const inputSame = document.createElement("input");
                    inputSame.type = "radio";
                    inputSame.name = "save-target";
                    inputSame.value = "same";
                    inputSame.checked = true;
                    inputSame.style.accentColor = "#6366f1";
                    const sameText = document.createTextNode("同层级");
                    sameLabel.appendChild(inputSame);
                    sameLabel.appendChild(sameText);
                    
                    const magicLabel = document.createElement("label");
                    magicLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer; font-size: 12.5px;";
                    const inputMagic = document.createElement("input");
                    inputMagic.type = "radio";
                    inputMagic.name = "save-target";
                    inputMagic.value = "magicloradate";
                    inputMagic.style.accentColor = "#6366f1";
                    const magicText = document.createTextNode("magicloradate子目录");
                    magicLabel.appendChild(inputMagic);
                    magicLabel.appendChild(magicText);
                    
                    const bothLabel = document.createElement("label");
                    bothLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer; font-size: 12.5px;";
                    const inputBoth = document.createElement("input");
                    inputBoth.type = "radio";
                    inputBoth.name = "save-target";
                    inputBoth.value = "both";
                    inputBoth.style.accentColor = "#6366f1";
                    const bothText = document.createTextNode("同时保存");
                    bothLabel.appendChild(inputBoth);
                    bothLabel.appendChild(bothText);
                    
                    targetContainer.appendChild(targetLabel);
                    targetContainer.appendChild(sameLabel);
                    targetContainer.appendChild(magicLabel);
                    targetContainer.appendChild(bothLabel);
                    
                    const buttons = document.createElement("div");
                    buttons.style.cssText = "display: flex; gap: 10px; justify-content: flex-end;";
                    
                    const okBtn = document.createElement("button");
                    okBtn.textContent = "确定";
                    okBtn.className = "ma-btn ma-btn-primary";
                    
                    const cancelBtn2 = document.createElement("button");
                    cancelBtn2.textContent = "取消";
                    cancelBtn2.className = "ma-btn";
                    
                    const close = () => {
                        try {
                            document.body.removeChild(saveOverlay);
                            document.body.removeChild(saveDialog);
                        } catch (_) {}
                    };
                    
                    okBtn.onclick = () => {
                        const val = inputBoth.checked ? "both" : (inputMagic.checked ? "magicloradate" : "same");
                        close();
                        resolve(val);
                    };
                    
                    cancelBtn2.onclick = () => {
                        close();
                        resolve(null);
                    };
                    
                    buttons.appendChild(okBtn);
                    buttons.appendChild(cancelBtn2);
                    
                    saveDialog.appendChild(title);
                    saveDialog.appendChild(tips);
                    saveDialog.appendChild(targetContainer);
                    saveDialog.appendChild(buttons);
                    
                    saveOverlay.appendChild(saveDialog);
                    document.body.appendChild(saveOverlay);
                });
                
                saveBtn.onclick = async () => {
                    const loraName = filePath || lora.name;
                    
                    try {
                        const probeRes = await api.fetchApi('/ma/lora/probe_save_targets', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_name: loraName })
                        });
                        const probe = await probeRes.json();
                        
                        const magicDirExists = !!probe.magicloradate_dir_exists;
                        const magicReadable = !!probe.magicloradate_has_readable;
                        const sameReadable = !!probe.same_has_readable;
                        
                        let targets = [];
                        let needChoice = false;
                        
                        if (magicDirExists && magicReadable && !sameReadable) {
                            targets = ["magicloradate"];
                        } else if (magicDirExists && !magicReadable && !sameReadable) {
                            needChoice = true;
                        } else if (!magicDirExists && sameReadable) {
                            targets = ["same"];
                        } else if (!magicDirExists && !sameReadable) {
                            needChoice = true;
                        } else if (magicReadable && sameReadable) {
                            targets = ["magicloradate", "same"];
                        } else if (magicDirExists && sameReadable && !magicReadable) {
                            targets = ["same"];
                        }
                        
                        if (needChoice || targets.length === 0) {
                            const userTarget = await showSaveTargetDialog();
                            if (!userTarget) return;
                            if (userTarget === "both") {
                                targets = ["magicloradate", "same"];
                            } else {
                                targets = [userTarget];
                            }
                        }
                        
                        const txtArea = contentAreas[0].querySelector('textarea');
                        const jsonArea = contentAreas[1].querySelector('textarea');
                        const logArea = contentAreas[2].querySelector('textarea');
                        
                        const saveOne = async (file_type, content, target) => {
                            const res = await api.fetchApi('/ma/lora/save_lora_file', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    lora_name: loraName,
                                    file_type: file_type,
                                    content: content,
                                    target: target
                                })
                            });
                            return res.json();
                        };
                        
                        let results = [];
                        for (const t of targets) {
                            const r1 = await saveOne("txt", txtArea.value, t);
                            const r2 = await saveOne("json", jsonArea.value, t);
                            const r3 = await saveOne("log", logArea.value, t);
                            results.push(r1, r2, r3);
                        }
                        
                        const allOk = results.every(r => r && r.status === "success");
                        if (allOk) {
                            const targetText = targets.length === 2 ? "magicloradate 和 同层级" : (targets[0] === "magicloradate" ? "magicloradate子目录" : "同层级");
                            void mplAlert(`LoRA '${loraName.split(/[/\\]/).pop()}' 的内容已保存到 ${targetText}！`);
                            
                            lora.triggerWords = txtArea.value;
                            lora.tags = txtArea.value;
                            lora.jsonInfo = jsonArea.value;
                            lora.logInfo = logArea.value;
                            const nextNote = noteInput.value;
                            if (nextNote !== prevNote) {
                                lora.note = nextNote;
                                void mplSetNote(loraName, nextNote, prevNote);
                            }
                            
                            if (filePath && (fIdx === -1 || !this.loraData.loras.find(l => l.name === filePath))) {
                                let foundInFolder = false;
                                for (let fi = 0; fi < this.loraData.folders.length; fi++) {
                                    const folder = this.loraData.folders[fi];
                                    if (folder.loras.find(l => l.name === filePath)) {
                                        foundInFolder = true;
                                        break;
                                    }
                                }
                                if (!foundInFolder) {
                                    lora.enabled = mplLoraEnabled(lora);
                                    if (!lora.weight) lora.weight = 1.0;
                                    if (!lora.tags) lora.tags = '';
                                    if (!lora.note) lora.note = '';
                                    this.loraData.loras.push(lora);
                                }
                            }
                            
                            this.renderEmbeddedList();
                            this.updateWidget();
                            document.body.removeChild(overlay);
                        } else {
                            const msgs = results.filter(r => r && r.status !== "success").map(r => r.message || "未知错误").join("\n");
                            void mplAlert(`部分或全部保存失败：\n${msgs}`);
                        }
                    } catch (error) {
                        console.error("保存LoRA内容时出错:", error);
                        void mplAlert(`保存时发生错误：${error.message}`);
                    }
                };
                // 爬取信息按钮
                const fetchBtn = document.createElement("button");
                fetchBtn.textContent = "爬取信息";
                fetchBtn.className = "ma-btn ma-btn-success";
                fetchBtn.onclick = () => {
                    this.showFetchModal(lora, contentAreas, overlay);
                };
                
                buttonContainer.appendChild(cancelBtn);
                buttonContainer.appendChild(fetchBtn);
                buttonContainer.appendChild(saveBtn);
                
                const stopProp = (e) => { e.stopPropagation(); };
                dialog.addEventListener("pointerdown", stopProp);
                dialog.addEventListener("pointermove", stopProp);
                dialog.addEventListener("pointerup", stopProp);
                dialog.addEventListener("mousedown", stopProp);
                dialog.addEventListener("wheel", stopProp, { passive: false });
                
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        document.body.removeChild(overlay);
                    }
                };
                
                const handleEsc = (e) => {
                    if (e.key === "Escape") {
                        document.body.removeChild(overlay);
                        document.removeEventListener("keydown", handleEsc);
                    }
                };
                document.addEventListener("keydown", handleEsc);
                
                dialog.appendChild(header);
                dialog.appendChild(infoSection);
                dialog.appendChild(tabContainer);
                dialog.appendChild(contentWrapper);
                dialog.appendChild(buttonContainer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                
                this.makeDialogDraggable(dialog, header);
                
                setTimeout(() => {
                    const currentArea = contentAreas.find(a => a.dataset.tab === currentTab);
                    if (currentArea) {
                        const textarea = currentArea.querySelector('textarea');
                        if (textarea) textarea.focus();
                    }
                }, 100);
            };

            // 批量加载选中 LoRA 的触发词、推荐权重与预览图
            nodeType.prototype.showBatchEditModal = async function(fileList) {
                const files = Array.from(fileList || []);
                if (!files.length) { void mplAlert("请先选择要处理的 LoRA"); return; }

                const fetchOverlay = document.createElement("div");
                fetchOverlay.className = "ma-modal-backdrop";
                fetchOverlay.style.zIndex = "10020";
                const fetchDialog = document.createElement("div");
                fetchDialog.className = "ma-modal ma-modal-static-anim";
                fetchDialog.setAttribute("data-magic-i18n", "manual");
                fetchDialog.style.cssText = "padding:20px 22px;min-width:480px;max-width:580px;width:90%;z-index:10021;position:relative;";

                const title = document.createElement("div");
                title.textContent = "批量加载 LoRA 信息（已选 " + files.length + " 个）";
                title.style.cssText = "font-size:15px;font-weight:650;color:#f4f4f5;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:move;user-select:none;";
                fetchDialog.appendChild(title);

                const listBox = document.createElement("div");
                listBox.style.cssText = "max-height:92px;overflow:auto;background:#09090b;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 10px;font-size:12px;color:#d4d4d8;line-height:1.5;margin-bottom:14px;";
                listBox.textContent = files.map(f => String(f).split(/[/\\]/).pop()).join("、");
                fetchDialog.appendChild(listBox);

                const infoLine = document.createElement("div");
                infoLine.textContent = "将补全触发词、模型介绍、推荐权重与预览图，保存到 LoRA 同目录；与 LoRA Manager 互通，已有信息不会重复下载。";
                infoLine.style.cssText = "font-size:12px;color:#a1a1aa;line-height:1.6;background:#18181c;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 10px;margin-bottom:16px;";
                fetchDialog.appendChild(infoLine);

                const statusLine = document.createElement("div");
                statusLine.style.cssText = "font-size:12px;color:#a1a1aa;min-height:18px;margin-bottom:6px;";
                fetchDialog.appendChild(statusLine);

                const buttonContainer = document.createElement("div");
                buttonContainer.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);";

                const cancelFetchBtn = document.createElement("button");
                cancelFetchBtn.textContent = "取消";
                cancelFetchBtn.className = "ma-btn";

                const fetchConfirmBtn = document.createElement("button");
                fetchConfirmBtn.textContent = "开始加载";
                fetchConfirmBtn.className = "ma-btn ma-btn-primary";

                buttonContainer.appendChild(cancelFetchBtn);
                buttonContainer.appendChild(fetchConfirmBtn);
                fetchDialog.appendChild(buttonContainer);

                const closeFetch = () => { try { document.body.removeChild(fetchOverlay); } catch (e) {} };
                cancelFetchBtn.onclick = closeFetch;

                for (const ev of ["pointerdown", "pointermove", "pointerup", "mousedown", "wheel", "keydown"]) {
                    fetchDialog.addEventListener(ev, (e) => e.stopPropagation(), ev === "wheel" ? { passive: false } : undefined);
                }
                fetchOverlay.appendChild(fetchDialog);
                document.body.appendChild(fetchOverlay);
                if (this.makeDialogDraggable) this.makeDialogDraggable(fetchDialog, title);

                fetchConfirmBtn.onclick = async () => {
                    const savePathMode = "same_dir";
                    const options = { download_txt: true, download_json: true, download_image: true, download_log: true, download_rec: true };
                    let okCount = 0, failCount = 0, tagCount = 0, recCount = 0, imgCount = 0;
                    const errs = [];
                    fetchConfirmBtn.disabled = true;
                    cancelFetchBtn.disabled = true;
                    fetchConfirmBtn.textContent = "加载中...";
                    let doneCount = 0;
                    const runOne = async (f) => {
                        const short = String(f).split(/[/\\]/).pop();
                        statusLine.textContent = `加载中 ${Math.min(doneCount + 1, files.length)}/${files.length}：${short}`;
                        try {
                            const response = await api.fetchApi('/ma/lora/fetch_metadata', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    lora_name: f,
                                    options: options,
                                    save_path_mode: savePathMode,
                                    overwrite: false,
                                    force_refresh: true,
                                })
                            });
                            const rj = await response.json();
                            if (!(response.ok || ['success','partial','skipped'].includes(rj && rj.status))) {
                                throw new Error((rj && rj.message) || ('HTTP ' + response.status));
                            }
                            const data = (rj && rj.data) || {};
                            const v = typeof data.triggerWords === "string" ? data.triggerWords.trim() : "";
                            const rw = Number(data.recommendedWeight);
                            const hasRec = Number.isFinite(rw) && rw > 0;
                            if (v || hasRec) mplApplyMetadataData(this, f, data);
                            if (v) tagCount++;
                            if (hasRec) recCount++;
                            mplBumpImage(f);
                            if (this.refreshLoraImageCache) this.refreshLoraImageCache(f);
                            imgCount++;
                            okCount++;
                        } catch (e) {
                            failCount++;
                            errs.push(`${short}: ${e.message}`);
                        } finally {
                            doneCount++;
                        }
                    };
                    let cursor = 0;
                    const worker = async () => {
                        while (cursor < files.length) {
                            const f = files[cursor++];
                            await runOne(f);
                        }
                    };
                    await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
                    statusLine.textContent = `完成：处理 ${okCount} 个（触发词 ${tagCount} 个、推荐权重 ${recCount} 个、预览 ${imgCount} 个），失败 ${failCount} 个`;
                    if (failCount) void mplAlert(`部分失败：\n` + errs.join("\n"));
                    await mplLoadExtraInfo(true);
                    if (this.renderEmbeddedList) this.renderEmbeddedList();
                    if (this.updateWidget) this.updateWidget();
                    if (this._addLoraModal && this._addLoraModal.isConnected && this._refreshFileListFunc) {
                        try { await this._refreshFileListFunc(); } catch (e) { console.error(e); }
                    }
                    fetchConfirmBtn.disabled = false;
                    cancelFetchBtn.disabled = false;
                    fetchConfirmBtn.textContent = "完成";
                    setTimeout(closeFetch, 700);
                };
            };

            // 一键补全当前工作流所有强力 LoRA 节点中的全部 LoRA 信息
            nodeType.prototype.fetchAllLoraMetadata = async function() {
                const origin = this;
                if (this._mplFetchAllRunning) { void mplAlert("正在补全中，请稍候…"); return; }
                const graphNodes = mplMetadataGraphNodes(origin);
                const nameToNodes = new Map();
                const names = [];
                for (const target of graphNodes) {
                    for (const name of mplCollectMetadataNames(target)) {
                        const key = mplMetadataNameKey(name);
                        if (!key) continue;
                        if (!nameToNodes.has(key)) { nameToNodes.set(key, new Set()); names.push(name); }
                        nameToNodes.get(key).add(target);
                    }
                }
                if (!names.length) { void mplAlert("当前工作流的 LoRA 节点里还没有 LoRA，请先添加"); return; }
                if (!(await mplConfirm(
                    `将强制重新爬取当前工作流中 ${names.length} 个 LoRA 的信息（触发词 + 作者推荐权重 + 预览图），\n并把结果同步回填到所有节点中。\n\n本地自命名、来源查不到的 LoRA 会跳过，保持原样。\n\n开始吗？`,
                    { title: "一键补全当前工作流 LoRA", okText: "开始" }
                ))) return;

                this._mplFetchAllRunning = true;
                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop";
                overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.68);z-index:10070;display:flex;align-items:center;justify-content:center;";
                const dlg = document.createElement("div");
                dlg.className = "ma-modal ma-modal-static-anim";
                dlg.style.cssText = "background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:20px 22px;min-width:420px;max-width:540px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.78);color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;";
                const ttl = document.createElement("div");
                ttl.textContent = "⚡ 一键补全当前工作流 LoRA";
                ttl.style.cssText = "font-size:15px;font-weight:650;margin-bottom:6px;";
                const sub = document.createElement("div");
                sub.textContent = `共 ${names.length} 个 LoRA · 强制重爬并回填到所有节点`;
                sub.style.cssText = "font-size:12px;color:#a1a1aa;margin-bottom:14px;";
                const cur = document.createElement("div");
                cur.style.cssText = "font-size:12px;color:#d4d4d8;margin-bottom:10px;min-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                const barWrap = document.createElement("div");
                barWrap.style.cssText = "height:7px;background:#222228;border-radius:4px;overflow:hidden;margin-bottom:10px;";
                const bar = document.createElement("div");
                bar.style.cssText = "height:100%;width:0%;background:#6366f1;transition:width .15s;";
                barWrap.appendChild(bar);
                const stat = document.createElement("div");
                stat.style.cssText = "font-size:12px;color:#a1a1aa;min-height:18px;";
                const btnRow = document.createElement("div");
                btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);";
                const stopBtn = document.createElement("button");
                stopBtn.textContent = "停止";
                stopBtn.type = "button";
                stopBtn.className = "ma-btn";
                const closeBtn = document.createElement("button");
                closeBtn.textContent = "关闭";
                closeBtn.type = "button";
                closeBtn.className = "ma-btn ma-btn-primary";
                closeBtn.style.display = "none";
                btnRow.append(stopBtn, closeBtn);
                dlg.append(ttl, sub, cur, barWrap, stat, btnRow);
                overlay.appendChild(dlg);
                document.body.appendChild(overlay);
                for (const ev of ["pointerdown", "pointermove", "pointerup", "mousedown", "wheel", "keydown"]) {
                    dlg.addEventListener(ev, e => e.stopPropagation(), ev === "wheel" ? { passive: false } : undefined);
                }
                closeBtn.onclick = () => { try { document.body.removeChild(overlay); } catch (e) {} };

                const settings = {
                    download_txt: true, download_json: true, download_image: true, download_log: true, download_rec: true,
                    save_path: "same_dir", overwrite: true, update_existing: true, force_refresh: true,
                };
                const state = { running: false, cancelRequested: false, pauseResult: null };
                stopBtn.onclick = () => {
                    state.cancelRequested = true;
                    stopBtn.disabled = true;
                    stopBtn.textContent = "停止中…";
                    cur.textContent = "正在停止，等待当前文件完成…";
                };
                let filled = 0, recFilled = 0, notFound = 0, failed = 0;
                const affected = new Set(graphNodes);
                try {
                    const results = await mplRunMetadataQueue(names, settings, state, ({ current, completed, total, result }) => {
                        cur.textContent = `处理中 ${completed}/${total}：${String(current).split(/[\\/]/).pop()}`;
                        bar.style.width = Math.round(completed / Math.max(1, total) * 100) + "%";
                        if (result) {
                            const w = String(result.data?.triggerWords || "").trim();
                            const hasRec = typeof result.data?.recommendedWeight === "number" && result.data.recommendedWeight > 0;
                            if (w || hasRec) {
                                if (w) filled++;
                                if (hasRec) recFilled++;
                                for (const target of (nameToNodes.get(mplMetadataNameKey(result.name)) || [])) {
                                    if (mplApplyMetadataData(target, result.name, result.data)) affected.add(target);
                                }
                                try { mplBumpImage(result.name); } catch (e) {}
                            }
                            if (result.status === "not_found" || result.field_states?.txt?.state === "not_found") notFound++;
                            if (result.status === "error") failed++;
                        }
                    });
                    if (!failed) failed = results.filter(r => r.status === "error").length;
                } catch (e) {
                    failed++;
                    console.warn("[MagicPowerLora] 一键补全异常:", e);
                }

                try { await mplLoadExtraInfo(true); } catch (e) {}
                for (const target of affected) {
                    try {
                        target.updateWidget?.();
                        target.renderEmbeddedList?.();
                        if (target._addLoraModal?.isConnected && target._refreshFileListFunc) {
                            try { await target._refreshFileListFunc(); } catch (e) {}
                        }
                    } catch (e) {}
                }
                bar.style.width = "100%";
                bar.style.background = state.pauseResult ? "#f59e0b" : "#10b981";
                const pauseNote = state.pauseResult ? "（来源请求受限，已暂停，可稍后重试）" : "";
                stat.textContent = `完成：触发词 ${filled} 个 · 推荐权重 ${recFilled} 个 · 来源未找到 ${notFound} 个 · 失败 ${failed} 个 ${pauseNote}`;
                cur.textContent = state.cancelRequested ? "已停止" : "已全部处理";
                stopBtn.style.display = "none";
                closeBtn.style.display = "inline-block";
                this._mplFetchAllRunning = false;
            };

            nodeType.prototype.showBatchMetadataModal = function() {
                if (mplMetadataModal?.isConnected) {
                    mplMetadataModal.focus();
                    return;
                }
                const node = this;
                const settings = mplLoadMetadataSettings();
                const state = { running: false, cancelRequested: false };
                const results = new Map();
                let localFiles = [];
                let metadata = {};
                let fieldStates = {};
                let sharedInfo = {};
                let visibleNames = [];
                const selected = new Set();
                let selectionTouched = false;
                let inventoryCheckboxes = [];
                let loadingFiles = true;
                let inventoryReady = false;
                let closed = false;
                let lastSettings = null;
                const el = (tag, text, className, parent) => {
                    const element = document.createElement(tag);
                    if (text) element.textContent = mplT(text);
                    if (className) element.className = className;
                    if (parent) parent.appendChild(element);
                    return element;
                };
                const dialog = el("div", "", "mpl-metadata-dialog");
                dialog.style.left = Math.max(20, (window.innerWidth - Math.min(820, window.innerWidth - 40)) / 2) + "px";
                dialog.style.top = Math.max(28, (window.innerHeight - Math.min(600, window.innerHeight - 56)) / 2) + "px";
                dialog.setAttribute("role", "dialog");
                dialog.setAttribute("aria-modal", "false");
                dialog.setAttribute("aria-label", mplT("LoRA 信息管理"));
                dialog.tabIndex = -1;
                const header = el("div", "", "mpl-metadata-header", dialog);
                el("span", "📥", "mpl-metadata-header-icon", header);
                el("div", "LoRA 信息管理", "mpl-metadata-title", header);
                const headerCloseBtn = el("button", "×", "mpl-metadata-close", header);
                headerCloseBtn.type = "button";
                headerCloseBtn.setAttribute("aria-label", mplT("关闭"));
                headerCloseBtn.title = mplT("关闭");
                const body = el("div", "", "mpl-metadata-body", dialog);
                const filters = el("div", "", "mpl-metadata-filters", body);
                const filterRow = el("div", "", "mpl-metadata-filter-row", filters);
                const scopeRow = el("label", "", "mpl-metadata-field mpl-metadata-scope", filterRow);
                el("span", "下载范围", "", scopeRow);
                const scopeSelect = el("select", "", "", scopeRow);
                scopeSelect.setAttribute("aria-label", mplT("下载范围"));
                const addScope = (value, text, translate = true) => {
                    const option = el("option", "", "", scopeSelect);
                    option.value = value;
                    option.textContent = translate ? mplT(text) : text;
                };
                addScope("all", "全部本地 LoRA");
                addScope("node", "当前节点全部 LoRA（含禁用项）");
                (node.loraData?.folders || []).forEach((folder, index) => {
                    addScope(`folder:${index}`, `${mplT("节点文件夹：")}${folder.name}`, false);
                });
                scopeSelect.value = "all";
                const directoryRow = el("div", "", "mpl-metadata-field mpl-metadata-directory", filterRow);
                el("span", "本地目录", "", directoryRow);
                const directorySelect = el("select", "", "", directoryRow);
                directorySelect.setAttribute("aria-label", mplT("本地目录"));
                const recursiveLabel = el("label", "", "mpl-metadata-check", filterRow);
                const recursiveCheckbox = el("input", "", "", recursiveLabel);
                recursiveCheckbox.type = "checkbox";
                recursiveCheckbox.checked = true;
                recursiveCheckbox.setAttribute("aria-label", mplT("包含子目录"));
                el("span", "包含子目录", "", recursiveLabel);
                const searchRow = el("div", "", "mpl-metadata-filter-row mpl-metadata-search-row", filters);
                const search = el("input", "", "mpl-metadata-search", searchRow);
                search.type = "search";
                search.placeholder = mplT("搜索文件名、路径或标题…");
                search.setAttribute("aria-label", mplT("搜索文件名、路径或标题…"));
                const statusSelect = el("select", "", "mpl-metadata-status-filter", searchRow);
                statusSelect.setAttribute("aria-label", mplT("信息状态筛选"));
                for (const [value, label] of [["pending", "仅看待处理"], ["local_missing", "所有本地缺项"], ["not_found", "未找到来源"], ["all", "全部状态"]]) {
                    const option = el("option", label, "", statusSelect);
                    option.value = value;
                }
                statusSelect.value = "pending";
                const workspace = el("div", "", "mpl-metadata-workspace", body);
                const settingsPanel = el("div", "", "mpl-metadata-settings", workspace);
                const typeGroup = el("div", "", "mpl-metadata-setting-group", settingsPanel);
                const typeCaption = el("div", "下载内容", "mpl-metadata-caption", typeGroup);
                const optionRow = el("div", "", "mpl-metadata-types", typeGroup);
                const checkboxes = {};
                const typeLabels = { download_txt: "触发词 (.txt)", download_json: "模型介绍 (.json)", download_image: "预览图像", download_log: "推荐权重 (.log)" };
                for (const [key, label] of [
                    ["download_txt", "触发词文件 (.txt)"],
                    ["download_json", "模型介绍信息 (.json)"],
                    ["download_image", "预览图像"],
                    ["download_log", "默认权重下载 (.log)"],
                ]) {
                    const wrapper = el("label", "", "mpl-metadata-type", optionRow);
                    const checkbox = el("input", "", "", wrapper);
                    checkbox.type = "checkbox";
                    checkbox.checked = settings[key];
                    checkbox.setAttribute("data-download-type", key.slice(9));
                    checkbox.setAttribute("aria-label", mplT(label));
                    el("span", typeLabels[key], "", wrapper);
                    checkboxes[key] = checkbox;
                }
                const pathRow = el("label", "", "mpl-metadata-setting-group", settingsPanel);
                el("span", "保存路径", "mpl-metadata-caption", pathRow);
                const pathSelect = el("select", "", "", pathRow);
                pathSelect.setAttribute("aria-label", mplT("保存路径"));
                for (const [value, label] of [["same_dir", "LoRA 同目录"], ["subfolder", "magicloradate 子目录"]]) {
                    const option = el("option", label, "", pathSelect);
                    option.value = value;
                }
                pathSelect.value = settings.save_path;
                pathSelect.title = mplT("已有信息更新原位置，新信息按保存位置保存。");
                const modeRow = el("label", "", "mpl-metadata-setting-group", settingsPanel);
                el("span", "处理方式", "mpl-metadata-caption", modeRow);
                const modeSelect = el("select", "", "", modeRow);
                modeSelect.setAttribute("aria-label", mplT("处理方式"));
                for (const [value, label] of [["missing", "补全所选信息"], ["recheck", "重新检查来源"], ["update", "更新已有信息"], ["adopt", "标记已整理（离线）"], ["restore", "恢复自动补全（离线）"]]) {
                    const option = el("option", label, "", modeSelect);
                    option.value = value;
                }
                modeSelect.value = "missing";
                const modeHelp = el("div", "", "mpl-metadata-mode-help", settingsPanel);
                const library = el("div", "", "mpl-metadata-library", workspace);
                const sharedWarning = el("div", "", "mpl-metadata-warning", library);
                const selectionRow = el("div", "", "mpl-metadata-selection", library);
                const selectVisibleBtn = el("button", "选择当前可见项", "", selectionRow);
                const clearSelectionBtn = el("button", "清空选择", "", selectionRow);
                const refreshInventoryBtn = el("button", "刷新列表", "mpl-metadata-refresh", searchRow);
                [selectVisibleBtn, clearSelectionBtn, refreshInventoryBtn].forEach(button => { button.type = "button"; });
                const preflightRow = el("div", "", "mpl-metadata-counts", selectionRow);
                const preflightCounters = {};
                for (const [key, label] of [["scoped", "当前范围"], ["selected", "已勾选"], ["need", "将处理"], ["notFound", "未找到来源"], ["complete", "无需获取"], ["issues", "本地异常"]]) {
                    const stat = el("span", "", "", preflightRow);
                    el("span", label, "", stat);
                    preflightCounters[key] = el("span", "", "", stat);
                    preflightCounters[key].style.marginLeft = "4px";
                }
                el("div", "只有当前范围和筛选结果中勾选的 LoRA 会被处理。", "mpl-metadata-hint", library);
                const inventoryErrors = el("div", "", "mpl-metadata-warning", library);
                const inventoryWrap = el("div", "", "mpl-metadata-inventory", library);
                const inventoryTable = el("table", "", "mpl-metadata-table", inventoryWrap);
                const head = el("thead", "", "", inventoryTable);
                const headRow = el("tr", "", "", head);
                for (const [label, width] of [["选择", "42px"], ["LoRA 文件", ""], [".txt", "55px"], [".json", "55px"], ["预览", "55px"], [".log", "55px"]]) {
                    const cell = el("th", label, "", headRow);
                    if (width) cell.style.width = width;
                }
                const inventoryBody = el("tbody", "", "", inventoryTable);
                const resultDetails = el("details", "", "mpl-metadata-results", library);
                el("summary", "处理结果", "", resultDetails);
                const stats = el("div", "", "mpl-metadata-stats", resultDetails);
                const resultList = el("div", "", "mpl-metadata-result-list", resultDetails);
                const progressPanel = el("div", "", "mpl-metadata-progress", dialog);
                const phase = el("div", "准备就绪", "mpl-metadata-progress-text", progressPanel);
                phase.setAttribute("aria-live", "polite");
                const progressRow = el("div", "", "mpl-metadata-progress-row", progressPanel);
                const progress = el("progress", "", "", progressRow);
                progress.max = 1;
                progress.value = 0;
                const progressCount = el("span", "", "mpl-metadata-progress-count", progressRow);
                progressCount.textContent = "0 / 0";
                const currentName = el("div", "", "mpl-metadata-current", progressPanel);
                const counters = {};
                const statusLabels = { success: "已补充", checked: "检查完成", reviewed: "已整理", restored: "已恢复", skipped: "已跳过", not_found: "未找到来源", partial: "部分完成", error: "失败" };
                const statusCounts = Object.fromEntries(Object.keys(statusLabels).map(status => [status, 0]));
                for (const [status, label] of Object.entries(statusLabels)) {
                    const stat = el("span", "", "", stats);
                    el("span", label, "", stat);
                    counters[status] = el("span", "", "", stat);
                    counters[status].style.marginLeft = "4px";
                    counters[status].textContent = "0";
                }
                const footer = el("div", "", "mpl-metadata-footer", dialog);
                const closeBtn = el("button", "关闭", "", footer);
                const workflowFillBtn = el("button", "⚡ 一键补全当前工作流", "", footer);
                workflowFillBtn.title = mplT("强制重爬当前工作流所有 LoRA 节点的触发词、作者推荐权重与预览图并回填");
                workflowFillBtn.onclick = () => {
                    if (state.running) return;
                    void node.fetchAllLoraMetadata();
                };
                el("div", "", "mpl-metadata-footer-spacer", footer);
                const stopBtn = el("button", "停止后续下载", "", footer);
                const retryBtn = el("button", "重试当前范围失败项", "", footer);
                retryBtn.title = mplT("仅重试当前可见且勾选的失败项，沿用上次处理方式和失败字段。");
                const startBtn = el("button", "开始下载", "mpl-metadata-primary", footer);
                [closeBtn, workflowFillBtn, stopBtn, retryBtn, startBtn].forEach(button => { button.type = "button"; });
                stopBtn.disabled = true;
                retryBtn.disabled = true;
                const readSettings = () => ({
                    ...Object.fromEntries(Object.entries(checkboxes).map(([key, checkbox]) => [key, checkbox.checked])),
                    download_rec: true,
                    save_path: pathSelect.value,
                    overwrite: modeSelect.value === "update",
                    update_existing: modeSelect.value === "update",
                    force_refresh: ["update", "recheck"].includes(modeSelect.value),
                    local_action: ["adopt", "restore"].includes(modeSelect.value) ? modeSelect.value : null,
                });
                const isLocalAction = () => ["adopt", "restore"].includes(modeSelect.value);
                const scopeNames = () => mplCollectMetadataNames(node, scopeSelect.value, localFiles || []);
                const selectedNames = () => mplMetadataPreflight(visibleNames, selected, readSettings(), metadata, fieldStates).actionableNames;
                const retryNames = () => {
                    const visible = new Set(visibleNames.map(mplMetadataNameKey));
                    return Array.from(results.values()).filter(result => selected.has(mplMetadataNameKey(result.name)) && visible.has(mplMetadataNameKey(result.name)) && ["error", "partial"].includes(result.status)).map(result => result.name);
                };
                const updateControls = () => {
                    const busy = state.running || loadingFiles;
                    for (const control of [scopeSelect, pathSelect, modeSelect, directorySelect, recursiveCheckbox, search, statusSelect, selectVisibleBtn, clearSelectionBtn, refreshInventoryBtn]) control.disabled = busy;
                    Object.values(checkboxes).forEach(checkbox => { checkbox.disabled = busy; });
                    inventoryCheckboxes.forEach(checkbox => { checkbox.disabled = busy; });
                    const preflight = mplMetadataPreflight(visibleNames, selected, readSettings(), metadata, fieldStates);
                    const hasSharedSelection = !isLocalAction() && mplMetadataHasSharedSelection(preflight.actionableNames, sharedInfo);
                    sharedWarning.textContent = hasSharedSelection ? mplT("选中项包含共享信息文件的同名模型，请每组只选择一个。") : "";
                    startBtn.disabled = busy || !inventoryReady || !preflight.need || hasSharedSelection || !Object.values(checkboxes).some(checkbox => checkbox.checked);
                    pathSelect.disabled = busy || isLocalAction();
                    retryBtn.disabled = busy || isLocalAction() || !lastSettings || !retryNames().length;
                    stopBtn.disabled = !state.running || state.cancelRequested || state.localReview;
                    closeBtn.disabled = state.running;
                    headerCloseBtn.disabled = state.running;
                    phase.title = phase.textContent;
                    for (const key of Object.keys(preflightCounters)) preflightCounters[key].textContent = loadingFiles ? "…" : String(preflight[key]);
                };
                const autoSelectPending = () => {
                    selected.clear();
                    for (const name of scopeNames()) {
                        const key = mplMetadataNameKey(name);
                        if (!mplMetadataNeeds(name, readSettings(), metadata, fieldStates)) continue;
                        if (!isLocalAction() && (sharedInfo[key] || []).some(sharedName => selected.has(mplMetadataNameKey(sharedName)))) continue;
                        selected.add(key);
                    }
                };
                const renderInventory = () => {
                    visibleNames = mplFilterMetadataNames(scopeNames(), {
                        directory: directorySelect.value,
                        recursive: recursiveCheckbox.checked,
                        search: search.value,
                        status: statusSelect.value,
                    }, readSettings(), metadata, fieldStates);
                    inventoryBody.replaceChildren();
                    inventoryCheckboxes = [];
                    for (const name of visibleNames) {
                        const key = mplMetadataNameKey(name);
                        const row = el("tr", "", "", inventoryBody);
                        const selectCell = el("td", "", "", row);
                        const checkbox = el("input", "", "", selectCell);
                        checkbox.type = "checkbox";
                        checkbox.checked = selected.has(key);
                        checkbox.setAttribute("data-lora-name", name);
                        checkbox.setAttribute("aria-label", name);
                        checkbox.onchange = () => {
                            selectionTouched = true;
                            if (checkbox.checked) selected.add(key); else selected.delete(key);
                            updateControls();
                        };
                        inventoryCheckboxes.push(checkbox);
                        const nameCell = el("td", "", "mpl-metadata-file", row);
                        nameCell.title = name;
                        const parts = mplMetadataNameKey(name).split("/");
                        const fileName = el("div", "", "mpl-metadata-file-name", nameCell);
                        fileName.textContent = parts.pop();
                        const filePath = el("div", "", "mpl-metadata-file-path", nameCell);
                        filePath.textContent = parts.join("/") || mplT("根目录");
                        if (sharedInfo[key]?.length) filePath.title = `${mplT("共享信息文件：")}${sharedInfo[key].join(", ")}`;
                        const rowStates = ["txt", "json", "image", "log"].map(type => mplMetadataFieldState(name, type, metadata, fieldStates).state);
                        if (rowStates.every(value => ["unavailable", "unresolved", "unsupported"].includes(value))) {
                            el("div", rowStates.every(value => value === "unavailable") ? "已检查，来源无可用信息" : "已检查，暂无可用信息", "mpl-metadata-file-path", nameCell);
                        }
                        for (const type of ["txt", "json", "image", "log"]) {
                            const field = mplMetadataFieldState(name, type, metadata, fieldStates);
                            const labels = { present: "已有", missing: "待获取", unavailable: "未提供", not_found: "未匹配", error: "失败", invalid: "不可用", unsupported: "不支持", unresolved: "未提取", local_error: "读取异常", user_skipped: "已整理" };
                            const cell = el("td", "", "", row);
                            const status = el("span", labels[field.state] || "待获取", "mpl-metadata-status " + (field.state === "present" ? "mpl-metadata-present" : ["missing", "error", "invalid", "local_error"].includes(field.state) ? "mpl-metadata-missing" : "mpl-metadata-unavailable"), cell);
                            const explanations = { unavailable: type === "image" ? "本次来源未返回可用预览" : "来源未提供", not_found: "未找到来源，可重新检查或手动补充。", invalid: "本地文件不可用；更新已有信息可修复，普通补全不会覆盖。", local_error: "本地信息读取失败，请检查目录访问权限后刷新列表。", unresolved: "未提取到可用内容，可重新检查或手动补充。", unsupported: "来源内容暂无法在本机处理，可重新检查或手动补充。", user_skipped: "用户已确认整理，普通补全跳过；可恢复自动补全或重新检查来源。" };
                            const details = [mplT(explanations[field.state] || labels[field.state] || "待获取")];
                            if (field.reason) details.push(String(field.reason));
                            if (field.checked_at) {
                                const checkedDate = new Date(field.checked_at);
                                details.push(`${mplT("上次检查：")}${Number.isNaN(checkedDate.getTime()) ? field.checked_at : checkedDate.toLocaleString()}`);
                            }
                            if (field.last_error) details.push(`${mplT("最近重查失败：")}${field.last_error}`);
                            if (field.local_reviewed) {
                                if (field.state !== "user_skipped") details.push(mplT("用户已确认整理，普通补全跳过；可恢复自动补全或重新检查来源。"));
                                if (field.local_reviewed_at) {
                                    const reviewDate = new Date(field.local_reviewed_at);
                                    details.push(`${mplT("整理时间：")}${Number.isNaN(reviewDate.getTime()) ? field.local_reviewed_at : reviewDate.toLocaleString()}`);
                                }
                                if (field.source_state && field.state === "user_skipped") details.push(`${mplT("来源检查结果：")}${mplT(labels[field.source_state] || field.source_state)}${field.source_reason ? ` — ${field.source_reason}` : ""}`);
                            }
                            status.title = details.join("\n");
                        }
                    }
                    if (!visibleNames.length) {
                        const row = el("tr", "", "", inventoryBody);
                        const cell = el("td", "暂无符合条件的 LoRA", "mpl-metadata-hint", row);
                        cell.style.textAlign = "center";
                        cell.style.padding = "20px";
                        cell.colSpan = 6;
                    }
                    updateControls();
                };
                const saveSettings = () => {
                    const { overwrite, update_existing, force_refresh, local_action, ...savedSettings } = readSettings();
                    try { localStorage.setItem(MPL_METADATA_SETTINGS_KEY, JSON.stringify(savedSettings)); }
                    catch (error) { console.warn("[MagicPowerLora] 保存下载设置失败:", error); }
                    if (!selectionTouched) autoSelectPending();
                    renderInventory();
                };
                Object.values(checkboxes).forEach(checkbox => { checkbox.onchange = saveSettings; });
                pathSelect.onchange = saveSettings;
                scopeSelect.onchange = () => {
                    if (!selectionTouched) autoSelectPending();
                    renderInventory();
                };
                directorySelect.onchange = renderInventory;
                recursiveCheckbox.onchange = renderInventory;
                search.oninput = renderInventory;
                statusSelect.onchange = renderInventory;
                const updateModeHelp = () => {
                    const help = {
                        update: ["更新所选类型的现有信息文件（含 .txt）；节点权重和自定义触发词保持不变。", "覆盖所选信息文件，节点设置不变。"],
                        recheck: ["重查未提供、未匹配或未提取的所选字段，保留已有文件和节点设置。", "重查缺项，保留已有内容。"],
                        missing: ["补全未检查或获取失败的所选字段；已确认无内容的字段跳过，保留已有文件和节点设置。", "补全待处理项，已确认空值不重复获取。"],
                        adopt: ["将所选字段标记为用户已整理，普通补全跳过；不检查在线来源，可随时撤销。", "人工标记已整理，不联网。"],
                        restore: ["仅撤销所选字段的人工整理标记，恢复原来的补全判断；不会立即获取在线信息。", "撤销人工标记，不联网。"],
                    }[modeSelect.value];
                    modeHelp.title = mplT(help[0]);
                    modeHelp.textContent = mplT(help[1]);
                    startBtn.textContent = mplT(modeSelect.value === "adopt" ? "保存整理标记" : modeSelect.value === "restore" ? "恢复自动补全" : "开始下载");
                    typeCaption.textContent = mplT(isLocalAction() ? "标记内容" : "下载内容");
                    pathRow.style.display = isLocalAction() ? "none" : "flex";
                };
                modeSelect.onchange = () => {
                    statusSelect.value = modeSelect.value === "update" ? "all" : modeSelect.value === "recheck" ? "local_missing" : "pending";
                    if (!selectionTouched || isLocalAction()) autoSelectPending();
                    updateModeHelp();
                    renderInventory();
                };
                selectVisibleBtn.onclick = () => {
                    selectionTouched = true;
                    visibleNames.forEach(name => selected.add(mplMetadataNameKey(name)));
                    renderInventory();
                };
                clearSelectionBtn.onclick = () => {
                    selectionTouched = true;
                    selected.clear();
                    renderInventory();
                };
                const loadInventory = async (autoSelect = false, force = false) => {
                    loadingFiles = true;
                    if (!state.running) phase.textContent = mplT("正在读取本地 LoRA 列表…");
                    updateControls();
                    try {
                        const response = await api.fetchApi("/ma/lora/list?include_metadata=true" + (force ? "&force=1" : ""));
                        const data = await response.json();
                        if (!response.ok || data.error || !Array.isArray(data.files)) throw new Error(data.error || data.message || mplT("读取本地 LoRA 列表失败"));
                        if (closed) return;
                        localFiles = data.files;
                        metadata = Object.fromEntries(Object.entries(data.metadata || {}).map(([name, values]) => [mplMetadataNameKey(name), values]));
                        if (data.field_states) fieldStates = Object.fromEntries(Object.entries(data.field_states).map(([name, values]) => [mplMetadataNameKey(name), values]));
                        sharedInfo = Object.fromEntries(Object.entries(data.shared_info || {}).map(([name, group]) => [mplMetadataNameKey(name), group]));
                        inventoryReady = true;
                        mplSetLoraNameList(localFiles);
                        const oldDirectory = directorySelect.value;
                        directorySelect.replaceChildren();
                        for (const [value, label] of [["", "所有目录"], [".", "根目录"]]) {
                            const option = el("option", label, "", directorySelect);
                            option.value = value;
                        }
                        const directories = new Set();
                        for (const name of localFiles) {
                            const parts = mplMetadataNameKey(name).split("/").slice(0, -1);
                            for (let length = 1; length <= parts.length; length++) directories.add(parts.slice(0, length).join("/"));
                        }
                        for (const directory of [...directories].sort((a, b) => a.localeCompare(b))) {
                            const option = el("option", "", "", directorySelect);
                            option.value = directory;
                            option.textContent = directory;
                        }
                        let _savedDir = oldDirectory;
                        if (!_savedDir) {
                            try { _savedDir = localStorage.getItem("MA_META_DIR") || ""; } catch(e) {}
                        }
                        directorySelect.value = [...directorySelect.options].some(option => option.value === _savedDir) ? _savedDir : "";
                        try { localStorage.setItem("MA_META_DIR", directorySelect.value); } catch(e) {}
                        inventoryErrors.replaceChildren();
                        if (Array.isArray(data.errors) && data.errors.length) {
                            el("div", "清单读取异常", "", inventoryErrors);
                            for (const error of data.errors) {
                                const errorLine = el("div", "", "", inventoryErrors);
                                errorLine.textContent = `${error.path || ""}: ${error.error || ""}`;
                            }
                        }
                        if (data.record_warning) {
                            const warning = el("div", "", "", inventoryErrors);
                            warning.textContent = `${mplT("检查记录未保存：")}${data.record_warning}`;
                        }
                        if (autoSelect) autoSelectPending();
                        if (!state.running) phase.textContent = mplT("准备就绪");
                    } catch (error) {
                        inventoryErrors.textContent = `${mplT("读取本地 LoRA 列表失败")}: ${error.message}`;
                        if (!state.running) phase.textContent = mplT("读取本地 LoRA 列表失败");
                    } finally {
                        loadingFiles = false;
                        if (!closed) renderInventory();
                    }
                };
                directorySelect.addEventListener("change", () => {
                    try { localStorage.setItem("MA_META_DIR", directorySelect.value); } catch(e) {}
                });
                refreshInventoryBtn.onclick = () => loadInventory(false, true);
                const resultRows = new Map();
                const updateResults = (result) => {
                    const key = mplMetadataNameKey(result.name);
                    const previous = results.get(key);
                    if (previous) statusCounts[previous.status]--;
                    statusCounts[result.status]++;
                    results.set(key, result);
                    let row = resultRows.get(key);
                    if (!row) {
                        row = el("div", "", "mpl-metadata-result", resultList);
                        resultRows.set(key, row);
                    }
                    row.replaceChildren();
                    const rowTitle = el("div", "", "mpl-metadata-result-title", row);
                    el("span", statusLabels[result.status], "mpl-metadata-result-status" + (["error", "partial"].includes(result.status) ? " mpl-metadata-result-status-error" : ""), rowTitle);
                    const name = el("span", "", "", rowTitle);
                    name.textContent = result.name;
                    const message = el("div", "", "mpl-metadata-result-message", row);
                    message.textContent = result.message || "";
                    const recW = result.data?.recommendedWeight;
                    if (typeof recW === "number" && recW > 0) {
                        const recLine = el("div", "", "mpl-metadata-result-message", row);
                        recLine.style.color = "#34d399";
                        recLine.textContent = `作者推荐权重 ${recW.toFixed(2)}${result.data?.recommendedWeightSource ? "（" + result.data.recommendedWeightSource + "）" : ""}，已保存到信息管理`;
                    } else if (result.data?.recommendedWeightSkipped === true) {
                        const recLine = el("div", "", "mpl-metadata-result-message", row);
                        recLine.style.color = "#71717a";
                        recLine.textContent = "该项无作者推荐权重信息，已跳过";
                    }
                    if (result.unavailable?.length) {
                        const unavailable = el("div", "", "mpl-metadata-result-message", row);
                        const explanations = { unavailable: "来源未提供", not_found: "未找到来源", unsupported: "不支持", unresolved: "未提取" };
                        unavailable.textContent = result.unavailable.map(type => `${mplT(typeLabels[`download_${type}`] || type)}: ${mplT(explanations[result.field_states?.[type]?.state] || "来源未提供")}`).join("; ");
                    }
                    const failureDetails = mplMetadataFailureDetails(result, typeLabels)
                        .map(detail => `${mplT(detail.label)}: ${detail.reason}`);
                    if (failureDetails.length) {
                        const failure = el("div", "", "mpl-metadata-result-message mpl-metadata-result-status-error", row);
                        failure.textContent = `${mplT("失败原因：")}${failureDetails.join("; ")}`;
                    }
                    if (result.record_warning) {
                        const warning = el("div", "", "mpl-metadata-warning", row);
                        warning.textContent = `${mplT("检查记录未保存：")}${result.record_warning}`;
                    }
                    for (const status of Object.keys(counters)) {
                        counters[status].textContent = String(statusCounts[status]);
                    }
                    resultDetails.open = true;
                };
                const clearRunResults = () => {
                    results.clear();
                    resultRows.clear();
                    resultList.replaceChildren();
                    for (const status of Object.keys(counters)) {
                        statusCounts[status] = 0;
                        counters[status].textContent = "0";
                    }
                };
                const runLocalReview = async (names, runSettings) => {
                    if (state.running || loadingFiles || !names.length) return;
                    const reviewed = runSettings.local_action === "adopt";
                    const types = mplMetadataTypes(runSettings);
                    state.running = true;
                    state.localReview = true;
                    state.cancelRequested = false;
                    state.pauseResult = null;
                    lastSettings = null;
                    clearRunResults();
                    progress.max = names.length;
                    progress.value = 0;
                    progressCount.textContent = `0 / ${names.length}`;
                    phase.textContent = mplT(reviewed ? "正在保存整理标记…" : "正在恢复自动补全…");
                    updateControls();
                    try {
                        const response = await api.fetchApi("/ma/lora/local_metadata_review", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lora_names: names, types, reviewed }),
                        });
                        const result = await response.json();
                        if (!["success", "partial", "error"].includes(result?.status) || !Array.isArray(result.updated) || !Array.isArray(result.errors)) {
                            throw new Error(result?.message || `${mplT("请求失败")} (${response.status})`);
                        }
                        const updated = new Set(result.updated.map(mplMetadataNameKey));
                        const errorsByName = new Map();
                        for (const error of result.errors) {
                            const key = mplMetadataNameKey(error.name);
                            const previous = errorsByName.get(key);
                            errorsByName.set(key, [previous, error.error || mplT("整理标记保存失败")].filter(Boolean).join("\n"));
                        }
                        let failed = 0;
                        for (const name of names) {
                            const key = mplMetadataNameKey(name);
                            const error = errorsByName.get(key) || (!updated.has(key) ? result.message || mplT("未收到此项的处理结果") : null);
                            if (error) {
                                failed++;
                                updateResults({ name, status: "error", message: error });
                            } else {
                                updateResults({ name, status: reviewed ? "reviewed" : "restored", message: mplT(reviewed ? "人工整理标记已保存，普通补全跳过所选缺项。" : "人工整理标记已撤销，未获取在线信息。") });
                            }
                        }
                        progress.value = names.length;
                        progressCount.textContent = `${names.length} / ${names.length}`;
                        await loadInventory(false, true);
                        phase.textContent = failed || result.errors.length || !response.ok || result.status === "error"
                            ? mplT("整理标记未全部完成，请查看结果。")
                            : mplT(reviewed ? "整理标记已保存。" : "已恢复自动补全，尚未获取在线信息。");
                    } catch (error) {
                        for (const name of names) updateResults({ name, status: "error", message: error.message || String(error) });
                        phase.textContent = `${mplT("整理标记处理失败：")}${error.message || String(error)}`;
                    } finally {
                        state.running = false;
                        state.localReview = false;
                        currentName.textContent = "";
                        updateControls();
                    }
                };
                const run = async (names, runSettings, clearResults) => {
                    if (state.running || loadingFiles || !names.length) return;
                    state.cancelRequested = false;
                    state.running = true;
                    lastSettings = { ...runSettings };
                    if (clearResults) clearRunResults();
                    phase.textContent = mplT("下载中…");
                    updateControls();
                    const changedNames = new Set();
                    const affectedNodes = new Set([node]);
                    const graphNodes = mplMetadataGraphNodes(node);
                    const referencesByName = new Map();
                    for (const target of graphNodes) {
                        for (const name of mplCollectMetadataNames(target)) {
                            const key = mplMetadataNameKey(name);
                            if (!referencesByName.has(key)) referencesByName.set(key, new Set());
                            referencesByName.get(key).add(target);
                        }
                    }
                    try {
                        await mplRunMetadataQueue(names, runSettings, state, ({ current, completed, total, result }) => {
                            currentName.textContent = current;
                            currentName.title = current;
                            progress.max = total;
                            progress.value = completed;
                            progressCount.textContent = `${completed} / ${total}`;
                            if (result) {
                                mplMergeMetadataFieldStates(result.name, result, metadata, fieldStates, result.requested_types);
                                const hasRecW = result.data && typeof result.data.recommendedWeight === "number" && result.data.recommendedWeight > 0;
                                const noopSkipped = result.status === "skipped" && !result.saved?.length
                                    && !(result.data && result.data.triggerWords) && !hasRecW;
                                if (!noopSkipped) updateResults(result);
                                if (result.saved?.length || (result.data && result.data.triggerWords) || hasRecW) {
                                    changedNames.add(result.name);
                                    for (const target of referencesByName.get(mplMetadataNameKey(result.name)) || []) {
                                        mplApplyMetadataData(target, result.name, result.data);
                                        affectedNodes.add(target);
                                    }
                                }
                            }
                        }, metadata, fieldStates);
                        state.running = true;
                        if (changedNames.size) {
                            affectedNodes.forEach(target => target.updateWidget());
                            await loadLoraImageList();
                            await mplLoadExtraInfo(true);
                            for (const target of affectedNodes) {
                                target.renderEmbeddedList();
                                if (target._addLoraModal?.isConnected && target._refreshFileListFunc) await target._refreshFileListFunc();
                                changedNames.forEach(name => {
                                    mplBumpImage(name);
                                    target.refreshLoraImageCache(name);
                                });
                            }
                        }
                        await loadInventory(false, true);
                        if (state.pauseResult) {
                            const retryAfter = state.pauseResult.retry_after;
                            const retryHint = retryAfter == null ? "" : ` ${mplT(/^\d+(\.\d+)?$/.test(String(retryAfter)) ? "重试等待秒数：" : "建议重试时间：")}${retryAfter}`;
                            phase.textContent = `${mplT("来源请求受限，已暂停后续处理：")}${state.pauseResult.message || mplT("请求失败")}${retryHint}`;
                        } else {
                            phase.textContent = mplT(state.cancelRequested ? "已停止，当前文件已处理完成。" : "信息检查与补全完成");
                        }
                    } catch (error) {
                        phase.textContent = `${mplT("下载任务失败")}: ${error.message}`;
                    } finally {
                        state.running = false;
                        currentName.textContent = "";
                        updateControls();
                    }
                };
                const startRun = async (names, runSettings, clearResults) => {
                    const snapshot = names.filter(name =>
                        mplMetadataRequestedTypes(name, runSettings, metadata, fieldStates).length ||
                        (!runSettings.local_action && mplMetadataRecNeeded(name, runSettings, metadata)));
                    if (!snapshot.length) {
                        phase.textContent = mplT("所选信息无需处理。");
                        return;
                    }
                    if (runSettings.local_action) {
                        if (runSettings.local_action === "adopt") {
                            const prompt = [
                                `${mplT("所选 LoRA：")}${snapshot.length}`,
                                `${mplT("信息类型：")}${mplMetadataTypes(runSettings).map(type => mplT(typeLabels[`download_${type}`])).join(", ")}`,
                                mplT("人工确认所选缺项暂不在线补全，不检查来源。可用“恢复自动补全”撤销。"),
                            ].join("\n");
                            if (!(await mplConfirm(prompt, { okText: "继续" }))) return;
                        }
                        return runLocalReview(snapshot, runSettings);
                    }
                    if (mplMetadataHasSharedSelection(snapshot, sharedInfo)) {
                        phase.textContent = mplT("选中项包含共享信息文件的同名模型，请每组只选择一个。");
                        return;
                    }
                    if (runSettings.overwrite) {
                        const types = [...new Set(snapshot.flatMap(name => mplMetadataRequestedTypes(name, runSettings, metadata, fieldStates)))];
                        const existingNames = snapshot.filter(name => mplMetadataRequestedTypes(name, runSettings, metadata, fieldStates).some(type => metadata[mplMetadataNameKey(name)]?.[type] || mplMetadataFieldState(name, type, metadata, fieldStates).state === "invalid"));
                        const existingCount = snapshot.reduce((count, name) => count + mplMetadataRequestedTypes(name, runSettings, metadata, fieldStates).filter(type => metadata[mplMetadataNameKey(name)]?.[type] || mplMetadataFieldState(name, type, metadata, fieldStates).state === "invalid").length, 0);
                        const prompt = [
                            mplT("更新已有信息确认"),
                            `${mplT("所选 LoRA：")}${snapshot.length}`,
                            `${mplT("将更新已有信息的 LoRA：")}${existingNames.length}`,
                            `${mplT("将更新的已有信息项：")}${existingCount}`,
                            `${mplT("信息类型：")}${types.map(type => type === "image" ? mplT("预览图像") : `.${type}`).join(", ")}`,
                            mplT("会覆盖所选模型的已有信息文件，节点权重和自定义触发词保持不变。"),
                        ].join("\n");
                        if (!(await mplConfirm(prompt, { okText: "继续" }))) return;
                    }
                    return run(snapshot, runSettings, clearResults);
                };
                startBtn.onclick = () => {
                    saveSettings();
                    return startRun(selectedNames(), readSettings(), true);
                };
                retryBtn.onclick = () => {
                    if (!lastSettings || isLocalAction()) return;
                    const names = retryNames();
                    const retryTypes = {};
                    for (const name of names) {
                        const result = results.get(mplMetadataNameKey(name));
                        const failed = result?.failed;
                        retryTypes[mplMetadataNameKey(name)] = Array.isArray(failed) && failed.length ? failed : result?.requested_types || mplMetadataTypes(lastSettings || {});
                    }
                    return startRun(names, { ...lastSettings, retry_types: retryTypes }, false);
                };
                const stop = () => {
                    if (!state.running || state.localReview) return;
                    state.cancelRequested = true;
                    phase.textContent = mplT("正在停止：等待当前文件处理完成…");
                    updateControls();
                };
                stopBtn.onclick = stop;
                const close = () => {
                    if (state.running) { stop(); return; }
                    closed = true;
                    releaseDrag?.();
                    dialog.remove();
                    if (mplMetadataModal === dialog) mplMetadataModal = null;
                };
                const handleEsc = event => {
                    event.stopPropagation();
                    if (event.key === "Escape" && !closed) { event.preventDefault(); close(); }
                };
                closeBtn.onclick = close;
                headerCloseBtn.onclick = close;
                for (const eventName of ["pointerdown", "pointermove", "pointerup", "mousedown", "wheel"]) {
                    dialog.addEventListener(eventName, event => event.stopPropagation());
                }
                dialog.addEventListener("keydown", handleEsc);
                dialog.addEventListener("keyup", event => event.stopPropagation());
                header.addEventListener("mousedown", event => {
                    if (!event.target.closest("button")) dialog.focus();
                });
                document.body.appendChild(dialog);
                mplMetadataModal = dialog;
                const releaseDrag = node.makeDialogDraggable(dialog, header);
                updateModeHelp();
                updateControls();
                dialog.focus();
                return loadInventory(true);
            };

            nodeType.prototype.showFetchModal = function(lora, contentAreas, parentOverlay) {
                let fetching = false;
                // 设置存储的键名
                const SETTINGS_KEY = "magic_power_lora_fetch_settings";
                
                // 加载保存的设置
                const loadSettings = () => {
                    try {
                        const saved = localStorage.getItem(SETTINGS_KEY);
                        if (saved) {
                            return JSON.parse(saved);
                        }
                    } catch (e) {
                        console.error("加载爬取设置时出错:", e);
                    }
                    // 默认设置
                    return {
                        download_txt: true,
                        download_json: true,
                        download_image: true,
                        download_log: true,
                        save_path: "same_dir"
                    };
                };
                
                // 保存设置
                const saveSettings = (settings) => {
                    try {
                        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
                    } catch (e) {
                        console.error("保存爬取设置时出错:", e);
                    }
                };
                
                // 加载设置
                const savedSettings = loadSettings();
                
                // 创建遮罩层
                const fetchOverlay = document.createElement("div");
                fetchOverlay.className = "ma-modal-backdrop";
                fetchOverlay.style.zIndex = "10003";
                
                // 创建弹窗
                const fetchDialog = document.createElement("div");
                fetchDialog.className = "ma-modal ma-modal-static-anim";
                fetchDialog.style.cssText = `
                    width: 480px;
                    max-width: 92vw;
                    z-index: 10004;
                    position: relative;
                `;
                
                // 标题栏（可拖拽）
                const title = document.createElement("div");
                title.textContent = "爬取 LoRA 信息";
                title.className = "ma-modal-header ma-modal-title";
                
                const fetchBody = document.createElement("div");
                fetchBody.className = "ma-modal-body";
                fetchBody.style.padding = "18px 20px";

                // 下载选项
                const optionsContainer = document.createElement("div");
                optionsContainer.className = "ma-card";
                optionsContainer.style.marginBottom = "14px";
                
                const optionsTitle = document.createElement("div");
                optionsTitle.textContent = "下载选项";
                optionsTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                    margin-bottom: 6px;
                `;
                optionsContainer.appendChild(optionsTitle);
                const fetchHelp = document.createElement("div");
                fetchHelp.textContent = mplT("重新检查缺项，保留已有文件和编辑内容。");
                fetchHelp.style.cssText = "color: #71717a; font-size: 11.5px; margin-bottom: 12px;";
                optionsContainer.appendChild(fetchHelp);
                
                const downloadTxt = document.createElement("label");
                downloadTxt.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const txtCheckbox = document.createElement("input");
                txtCheckbox.type = "checkbox";
                txtCheckbox.checked = savedSettings.download_txt !== false; // 默认true
                txtCheckbox.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                downloadTxt.appendChild(txtCheckbox);
                downloadTxt.appendChild(document.createTextNode("触发词文件 (.txt)"));
                
                const downloadJson = document.createElement("label");
                downloadJson.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const jsonCheckbox = document.createElement("input");
                jsonCheckbox.type = "checkbox";
                jsonCheckbox.checked = savedSettings.download_json !== false; // 默认true
                jsonCheckbox.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                downloadJson.appendChild(jsonCheckbox);
                downloadJson.appendChild(document.createTextNode("模型介绍信息 (.json)"));
                
                const downloadImage = document.createElement("label");
                downloadImage.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const imageCheckbox = document.createElement("input");
                imageCheckbox.type = "checkbox";
                imageCheckbox.checked = savedSettings.download_image !== false; // 默认true
                imageCheckbox.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                downloadImage.appendChild(imageCheckbox);
                downloadImage.appendChild(document.createTextNode("预览图像"));
                
                const downloadLog = document.createElement("label");
                downloadLog.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const logCheckbox = document.createElement("input");
                logCheckbox.type = "checkbox";
                logCheckbox.checked = savedSettings.download_log !== false; // 默认true
                logCheckbox.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                downloadLog.appendChild(logCheckbox);
                downloadLog.appendChild(document.createTextNode("默认权重下载 (.log)"));
                
                optionsContainer.appendChild(downloadTxt);
                optionsContainer.appendChild(downloadJson);
                optionsContainer.appendChild(downloadImage);
                optionsContainer.appendChild(downloadLog);
                
                // 保存路径选择
                const pathContainer = document.createElement("div");
                pathContainer.className = "ma-card";
                
                const pathTitle = document.createElement("div");
                pathTitle.textContent = "保存路径";
                pathTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                    margin-bottom: 10px;
                `;
                pathContainer.appendChild(pathTitle);
                
                const pathSameDir = document.createElement("label");
                pathSameDir.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const sameDirRadio = document.createElement("input");
                sameDirRadio.type = "radio";
                sameDirRadio.name = "save_path";
                sameDirRadio.value = "same_dir";
                sameDirRadio.checked = savedSettings.save_path !== "subfolder"; // 默认same_dir
                sameDirRadio.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                pathSameDir.appendChild(sameDirRadio);
                pathSameDir.appendChild(document.createTextNode("保存到 LoRA 同目录下"));
                
                const pathSubfolder = document.createElement("label");
                pathSubfolder.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; color: #d4d4d8; font-size: 12.5px;";
                const subfolderRadio = document.createElement("input");
                subfolderRadio.type = "radio";
                subfolderRadio.name = "save_path";
                subfolderRadio.value = "subfolder";
                subfolderRadio.checked = savedSettings.save_path === "subfolder";
                subfolderRadio.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                pathSubfolder.appendChild(subfolderRadio);
                pathSubfolder.appendChild(document.createTextNode("保存到 magicloradate 子文件夹"));
                
                pathContainer.appendChild(pathSameDir);
                pathContainer.appendChild(pathSubfolder);
                
                // 自动保存设置的函数
                const autoSaveSettings = () => {
                    const currentSettings = {
                        download_txt: txtCheckbox.checked,
                        download_json: jsonCheckbox.checked,
                        download_image: imageCheckbox.checked,
                        download_log: logCheckbox.checked,
                        save_path: sameDirRadio.checked ? "same_dir" : "subfolder"
                    };
                    saveSettings(currentSettings);
                };
                
                // 为所有选项添加change事件监听，自动保存
                txtCheckbox.addEventListener("change", autoSaveSettings);
                jsonCheckbox.addEventListener("change", autoSaveSettings);
                imageCheckbox.addEventListener("change", autoSaveSettings);
                logCheckbox.addEventListener("change", autoSaveSettings);
                sameDirRadio.addEventListener("change", autoSaveSettings);
                subfolderRadio.addEventListener("change", autoSaveSettings);
                
                // 按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.className = "ma-modal-footer";
                
                // 取消按钮
                const cancelFetchBtn = document.createElement("button");
                cancelFetchBtn.textContent = "取消";
                cancelFetchBtn.className = "ma-btn";
                cancelFetchBtn.onclick = () => {
                    closeFetch();
                };
                
                // 爬取按钮
                const fetchConfirmBtn = document.createElement("button");
                fetchConfirmBtn.textContent = "开始爬取";
                fetchConfirmBtn.className = "ma-btn ma-btn-primary";
                fetchConfirmBtn.onclick = async () => {
                    if (![txtCheckbox, jsonCheckbox, imageCheckbox, logCheckbox].some(checkbox => checkbox.checked)) return;
                    fetching = true;
                    const controls = [txtCheckbox, jsonCheckbox, imageCheckbox, logCheckbox, sameDirRadio, subfolderRadio, cancelFetchBtn];
                    controls.forEach(control => { control.disabled = true; });
                    fetchConfirmBtn.disabled = true;
                    fetchConfirmBtn.textContent = "爬取中...";
                    const editors = ["triggerWords", "jsonInfo", "logInfo"].map((field, index) => ({ field, textarea: contentAreas[index]?.querySelector('textarea') }));
                    const editorValues = new Map(editors.map(({ field, textarea }) => [field, textarea?.value || ""]));
                    
                    try {
                        const options = {
                            download_txt: txtCheckbox.checked,
                            download_json: jsonCheckbox.checked,
                            download_image: imageCheckbox.checked,
                            download_log: logCheckbox.checked,
                            download_rec: true,
                        };
                        const savePathMode = sameDirRadio.checked ? "same_dir" : "subfolder";
                        
                        // 保存当前设置（确保在爬取前保存）
                        autoSaveSettings();
                        
                        const response = await api.fetchApi('/ma/lora/fetch_metadata', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lora_name: lora.name,
                                options: options,
                                save_path_mode: savePathMode,
                                overwrite: false,
                                force_refresh: true,
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && ['success', 'partial', 'skipped', 'checked', 'empty', 'not_found'].includes(result.status)) {
                            // Fill empty editors only; retain saved content and edits made while fetching.
                            for (const { field, textarea } of editors) {
                                const value = result.data?.[field];
                                if (typeof value !== "string" || !value.trim()) continue;
                                const previous = editorValues.get(field);
                                if (textarea && (previous.trim() || textarea.value !== previous)) continue;
                                if (textarea) textarea.value = value;
                                if (!String(lora[field] || "").trim()) {
                                    if (field === "triggerWords") mplSetTriggerWords(lora, value);
                                    else lora[field] = value;
                                }
                            }
                            const rw = Number(result.data?.recommendedWeight);
                            if (Number.isFinite(rw) && rw > 0) mplApplyMetadataData(this, lora.name, result.data);
                            
                            // 刷新全局图片列表缓存（类似参考代码的loadImageList）
                            await loadLoraImageList();
                            await mplLoadExtraInfo(true);
                            
                            // 刷新缓存（重新渲染列表）
                            this.renderEmbeddedList();
                            this.updateWidget();
                            
                            // 刷新所有显示该lora图片的地方
                            this.refreshLoraImageCache(lora.name);
                            
                            // 如果"添加Lora"窗口打开，重新获取文件列表并渲染
                            if (this._addLoraModal && this._addLoraModal.parentElement && this._refreshFileListFunc) {
                                // 调用refreshFileList函数重新获取文件列表并渲染
                                await this._refreshFileListFunc();
                            } else if (this._addLoraModal && this._addLoraModal.parentElement && this._renderContentFunc) {
                                // 如果没有refreshFileList，至少调用renderContent
                                this._renderContentFunc();
                            }
                            
                            fetching = false;
                            closeFetch();
                            const message = result.message || mplT(result.saved?.length ? "信息检查与补全完成" : "已检查，未新增信息。");
                            void mplAlert(message + (result.record_warning ? `\n${mplT("检查记录未保存：")}${result.record_warning}` : ""));
                        } else {
                            void mplAlert((result.message || mplT("爬取失败")) + (result.record_warning ? `\n${mplT("检查记录未保存：")}${result.record_warning}` : ""));
                        }
                    } catch (error) {
                        console.error("爬取元数据时出错:", error);
                        void mplAlert("爬取失败: " + error.message);
                    } finally {
                        fetching = false;
                        controls.forEach(control => { control.disabled = false; });
                        fetchConfirmBtn.disabled = ![txtCheckbox, jsonCheckbox, imageCheckbox, logCheckbox].some(checkbox => checkbox.checked);
                        fetchConfirmBtn.textContent = mplT("开始爬取");
                    }
                };
                const updateFetchAvailability = () => { fetchConfirmBtn.disabled = fetching || ![txtCheckbox, jsonCheckbox, imageCheckbox, logCheckbox].some(checkbox => checkbox.checked); };
                [txtCheckbox, jsonCheckbox, imageCheckbox, logCheckbox].forEach(checkbox => checkbox.addEventListener("change", updateFetchAvailability));
                updateFetchAvailability();
                
                buttonContainer.appendChild(cancelFetchBtn);
                buttonContainer.appendChild(fetchConfirmBtn);
                
                // 阻止事件冒泡
                const stopProp = (e) => { e.stopPropagation(); };
                fetchDialog.addEventListener("pointerdown", stopProp);
                fetchDialog.addEventListener("pointermove", stopProp);
                fetchDialog.addEventListener("pointerup", stopProp);
                fetchDialog.addEventListener("mousedown", stopProp);
                
                // 点击遮罩层关闭
                fetchOverlay.onclick = (e) => {
                    if (e.target === fetchOverlay) {
                        closeFetch();
                    }
                };
                
                // ESC键关闭
                const handleEsc = (e) => {
                    if (e.key === "Escape") {
                        closeFetch();
                    }
                };
                const closeFetch = () => {
                    if (fetching) return;
                    fetchOverlay.remove();
                    document.removeEventListener("keydown", handleEsc);
                };
                document.addEventListener("keydown", handleEsc);
                
                // 组装弹窗
                fetchBody.appendChild(optionsContainer);
                fetchBody.appendChild(pathContainer);
                fetchDialog.appendChild(title);
                fetchDialog.appendChild(fetchBody);
                fetchDialog.appendChild(buttonContainer);
                fetchOverlay.appendChild(fetchDialog);
                document.body.appendChild(fetchOverlay);
                
                // 使弹窗可拖拽
                this.makeDialogDraggable(fetchDialog, title);
            };

            nodeType.prototype.refreshLoraImageCache = function(loraName) {
                // 生成时间戳来强制刷新缓存
                const timestamp = new Date().getTime();
                const safeName = encodeURIComponent(loraName);
                const newImageUrl = api.apiURL(`/ma/lora/image?name=${safeName}&t=${timestamp}`);
                
                // 刷新"添加Lora"窗口中的图片 - 直接查找所有卡片
                const allCards = document.querySelectorAll('[title]');
                allCards.forEach(card => {
                    const cardTitle = card.title || card.getAttribute('title');
                    if (cardTitle === loraName) {
                        const img = card.querySelector('img');
                        if (img) {
                            const imgBox = img.parentElement;
                            const spinner = imgBox ? imgBox.querySelector('.mpl-spinner') : null;
                            
                            // 显示加载状态
                            if (spinner) {
                                spinner.style.display = 'block';
                            }
                            img.style.opacity = "0";
                            
                            // 强制重新加载图片
                            const tempImg = new Image();
                            tempImg.onload = () => {
                                img.src = newImageUrl;
                                img.style.opacity = "1";
                                if (spinner) {
                                    spinner.remove();
                                }
                            };
                            tempImg.onerror = () => {
                                // 即使加载失败也更新URL，让浏览器重新尝试
                                img.src = newImageUrl;
                                if (spinner) {
                                    spinner.remove();
                                }
                            };
                            tempImg.src = newImageUrl;
                        }
                    }
                });
                
                // 刷新主节点列表中的预览图
                if (this.listContainer) {
                    const rows = this.listContainer.querySelectorAll('.mpl-lora-row');
                    rows.forEach(row => {
                        // 通过查找包含lora名称的元素来匹配
                        const nameElement = row.querySelector('.mpl-lora-name');
                        if (nameElement && (nameElement.textContent.includes(loraName.split(/[/\\]/).pop()) || nameElement.title === loraName)) {
                            // 如果该行有预览图，刷新它
                            const previewDiv = row.querySelector('.mpl-lora-preview');
                            if (previewDiv) {
                                const previewImg = previewDiv.querySelector('img');
                                if (previewImg) {
                                    previewImg.src = newImageUrl;
                                }
                            }
                        }
                    });
                }
                
                // 刷新所有显示该lora图片的img元素（通过查找包含lora名称的图片URL）
                const allImages = document.querySelectorAll('img');
                allImages.forEach(img => {
                    const imgSrc = img.src || '';
                    if (imgSrc.includes('/ma/lora/image')) {
                        // 提取name参数
                        const nameMatch = imgSrc.match(/[?&]name=([^&]+)/);
                        if (nameMatch) {
                            try {
                                const nameParam = decodeURIComponent(nameMatch[1]);
                                if (nameParam === loraName) {
                                    // 更新URL，添加或更新时间戳
                                    const baseUrl = imgSrc.split('&t=')[0].split('?t=')[0];
                                    const separator = baseUrl.includes('?') ? '&' : '?';
                                    img.src = baseUrl + separator + 't=' + timestamp;
                                }
                            } catch (e) {
                                // 如果解码失败，尝试简单匹配
                                if (imgSrc.includes(encodeURIComponent(loraName))) {
                                    const baseUrl = imgSrc.split('&t=')[0].split('?t=')[0];
                                    const separator = baseUrl.includes('?') ? '&' : '?';
                                    img.src = baseUrl + separator + 't=' + timestamp;
                                }
                            }
                        }
                    }
                });
            };

            nodeType.prototype.createLoraRow = function(lora, type, fIdx, lIdx) {
                lora.enabled = mplLoraEnabled(lora);
                if (lora.weight === undefined || lora.weight === null) lora.weight = 1.0;
                if (!lora.tags) lora.tags = "";
                if (!lora.note) lora.note = "";
                if (!lora.triggerWords) lora.triggerWords = "";
                if (!lora.jsonInfo) lora.jsonInfo = "";
                if (!lora.logInfo) lora.logInfo = "";
                if (!lora.name) lora.name = "";
                
                const row = document.createElement("div");
                row.className = "mpl-lora-row";
                row.title = mplLoraEnabled(lora) ? "已启用：参与加载（点击整行停用）" : "未启用：不会参与加载（点击整行启用）";
                if (!mplLoraEnabled(lora)) row.classList.add("mpl-disabled");
                row.dataset.selected = "false";
                if (lora.colorMode !== "global" && lora.color && typeof lora.color === "object") {
                    if (lora.color.bg) row.style.setProperty("--lora-sel-bg", lora.color.bg);
                    if (lora.color.bar) {
                        row.style.setProperty("--lora-sel-bar", lora.color.bar);
                        row.style.setProperty("--lora-sel-border", lora.color.bar + "88");
                    }
                    if (lora.color.text) row.style.setProperty("--lora-sel-text", lora.color.text);
                }
                row.draggable = false;
                
                const dragArea = document.createElement("div");
                dragArea.className = "mpl-drag-area";
                dragArea.style.cssText = `
                    flex: 0 0 10px;
                    width: 10px;
                    cursor: move;
                    user-select: none;
                `;
                dragArea.draggable = true;
                dragArea.ondragstart = (e) => {
                    mplClearLoraPreview();
                    const dragInfo = { type: 'sort', sourceType: type, sourceFIdx: fIdx, sourceLIdx: lIdx };
                    e.dataTransfer.setData("text/plain", JSON.stringify(dragInfo));
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/x-sort-drag", "true");
                    e.dataTransfer.setData("application/x-sort-source-type", type);
                    try { e.dataTransfer.setData("application/x-mpl-lora", JSON.stringify({ name: lora.name })); } catch (_) {}
                    this._currentSortDrag = dragInfo;
                    row.style.opacity = "0.3";
                };
                dragArea.ondragend = () => { 
                    row.style.opacity = mplLoraEnabled(lora) ? "1" : "0.45"; 
                };
                
                row.ondragover = (e) => {
                    e.preventDefault();
                    const isSortDrag = e.dataTransfer.types.includes("application/x-sort-drag") || this._currentSortDrag;
                    if (isSortDrag) {
                        const dragInfo = this._currentSortDrag;
                        if (!dragInfo) return;
                        if (dragInfo.sourceLIdx !== undefined) {
                            const rect = row.getBoundingClientRect();
                            const mouseY = e.clientY - rect.top;
                            const isTopHalf = mouseY < rect.height / 2;
                            if (isTopHalf) {
                                row.style.borderTop = "2px dashed #FF9800";
                                row.style.borderBottom = "none";
                            } else {
                                row.style.borderBottom = "2px dashed #FF9800";
                                row.style.borderTop = "none";
                            }
                            return;
                        }
                        return;
                    }
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                };
                
                row.ondragleave = () => {
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                };
                
                row.ondrop = (e) => {
                    e.preventDefault();
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                    try {
                        const dragData = e.dataTransfer.getData("text/plain");
                        if (!dragData) {
                            this._currentSortDrag = null;
                            return;
                        }
                        const data = JSON.parse(dragData);
                        this._currentSortDrag = null;
                        
                        if (data.type === 'top' && typeof data.tok === 'string' && data.tok.startsWith('l:')) {
                            e.preventDefault();
                            e.stopPropagation();
                            const uid = data.tok.slice(2);
                            let srcArr = this.loraData.loras;
                            let srcIdx = (srcArr || []).findIndex(l => this._uidFor(l) === uid);
                            if (srcIdx < 0) {
                                srcArr = null;
                                for (const f of (this.loraData.folders || [])) {
                                    const i = (f.loras || []).findIndex(l => this._uidFor(l) === uid);
                                    if (i >= 0) { srcArr = f.loras; srcIdx = i; break; }
                                }
                            }
                            if (!srcArr || srcIdx < 0) return;
                            const targetArr = (type === 'folder') ? this.loraData.folders[fIdx].loras : this.loraData.loras;
                            if (!targetArr) return;
                            const rect = row.getBoundingClientRect();
                            const after = (e.clientY - rect.top) >= rect.height / 2;
                            const item = srcArr[srcIdx];
                            const fromRoot = (srcArr === this.loraData.loras);
                            srcArr.splice(srcIdx, 1);
                            if (srcArr === targetArr) {
                                let at = srcArr.indexOf(lora);
                                if (at < 0) at = srcArr.length;
                                srcArr.splice(after ? at + 1 : at, 0, item);
                            } else {
                                const idx = Math.max(0, Math.min(after ? lIdx + 1 : lIdx, targetArr.length));
                                targetArr.splice(idx, 0, item);
                            }
                            if (targetArr === this.loraData.loras) {
                                this._mplInsertLoraByToken(item, lora, after);
                            } else if (fromRoot) {
                                const tok = "l:" + this._uidFor(item);
                                const tl = this._topLayout || [];
                                const ti = tl.indexOf(tok);
                                if (ti >= 0) tl.splice(ti, 1);
                            }
                            if (type === 'folder' && this.loraData.folders[fIdx]) this.loraData.folders[fIdx].collapsed = false;
                            this._currentTopDrag = null;
                            this.renderEmbeddedList();
                            this.updateWidget();
                            return;
                        }

                        if (data.type === 'top' && typeof data.tok === 'string' && data.tok.startsWith('f:') && type === 'root') {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = row.getBoundingClientRect();
                            const after = (e.clientY - rect.top) >= rect.height / 2;
                            this._mplPlaceToken(data.tok, "l:" + this._uidFor(lora), after);
                            this._currentTopDrag = null;
                            this.renderEmbeddedList();
                            this.updateWidget();
                            return;
                        }

                        if (data.type === 'sort') {
                            e.stopPropagation();
                            if (data.sourceLIdx !== undefined && (data.sourceType === 'root' || data.sourceType === 'folder')) {
                                const targetLoras = (type === 'folder') ? this.loraData.folders[fIdx].loras : this.loraData.loras;
                                const srcLoras = (data.sourceType === 'folder') ? this.loraData.folders[data.sourceFIdx].loras : this.loraData.loras;
                                if (!srcLoras || !targetLoras) return;
                                const sourceIdx = data.sourceLIdx;
                                const targetIdx = lIdx;
                                if (srcLoras === targetLoras && sourceIdx === targetIdx) return;

                                const rect = row.getBoundingClientRect();
                                const mouseY = e.clientY - rect.top;
                                const isTopHalf = mouseY < rect.height / 2;

                                const targetItem = targetLoras[targetIdx];
                                const movedItem = JSON.parse(JSON.stringify(srcLoras[sourceIdx]));
                                srcLoras.splice(sourceIdx, 1);

                                if (srcLoras === targetLoras) {
                                    let insertIdx;
                                    if (sourceIdx < targetIdx) {
                                        insertIdx = isTopHalf ? targetIdx - 1 : targetIdx;
                                    } else {
                                        insertIdx = isTopHalf ? targetIdx : targetIdx + 1;
                                    }
                                    insertIdx = Math.max(0, Math.min(insertIdx, targetLoras.length));
                                    targetLoras.splice(insertIdx, 0, movedItem);
                                    if (targetLoras === this.loraData.loras && targetItem) {
                                        this._mplInsertLoraByToken(movedItem, targetItem, !isTopHalf);
                                    }
                                } else {
                                    let insertIdx = isTopHalf ? targetIdx : targetIdx + 1;
                                    insertIdx = Math.max(0, Math.min(insertIdx, targetLoras.length));
                                    targetLoras.splice(insertIdx, 0, movedItem);
                                    if (targetLoras === this.loraData.loras && targetItem) {
                                        this._mplInsertLoraByToken(movedItem, targetItem, !isTopHalf);
                                    } else if (srcLoras === this.loraData.loras) {
                                        const tok = "l:" + this._uidFor(movedItem);
                                        const tl = this._topLayout || [];
                                        const ti = tl.indexOf(tok);
                                        if (ti >= 0) tl.splice(ti, 1);
                                    }
                                }
                                this.renderEmbeddedList();
                                this.updateWidget();
                                return;
                            }
                            return;
                        }
                    } catch(err) {
                        console.error("拖拽排序错误:", err);
                    }
                };

                const setSelected = (on) => {
                    row.dataset.selected = on ? "true" : "false";
                    if (on) row.classList.add("mpl-selected");
                    else row.classList.remove("mpl-selected");
                };
                if (this._isMultiSelected(this.loraData, lora)) setSelected(true);

                row.onclick = (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' ||
                        e.target.classList.contains('mpl-mini-btn') ||
                        e.target.classList.contains('mpl-mini-input') ||
                        e.target.closest('.mpl-mini-btn') ||
                        e.target.closest('.mpl-mini-input') ||
                        e.target.closest('.mpl-lora-actions') ||
                        e.target.closest('.mpl-sort-handle') ||
                        e.target === noteInput || e.target.closest('.mpl-mini-input') ||
                        e.target === weightContainer || e.target.closest('.mpl-weight-container')) {
                        return;
                    }
                    lora.enabled = !mplLoraEnabled(lora);
                    if (row._mplCheckEl) row._mplCheckEl.checked = lora.enabled;
                    this.renderEmbeddedList();
                    this.updateWidget();
                };

                MA_LoraPreview.bindRowHover(row, lora);

                // 🖼 左侧缩略图（加载失败时只留空占位，不会撑大行）
                const thumb = document.createElement("div");
                thumb.className = "mpl-lora-thumb";
                const thumbImg = document.createElement("img");
                const safeThumbName = encodeURIComponent(lora.name);
                thumbImg.loading = "lazy";
                thumbImg.decoding = "async";
                thumbImg.src = api.apiURL(`/ma/lora/image?name=${safeThumbName}${mplBustSuffix(lora.name)}`);
                thumbImg.onerror = () => { thumb.classList.add("mpl-lora-thumb-empty"); thumbImg.remove(); };
                thumb.appendChild(thumbImg);
                thumb.title = lora.name;
                thumb.addEventListener("pointerdown", (e) => e.stopPropagation());
                thumb.addEventListener("mousedown", (e) => e.stopPropagation());

                // ☰ 排序手柄：拖动排序 / 拖出文件夹（复用 dragArea 的拖拽逻辑）
                const sortHandle = document.createElement("div");
                sortHandle.className = "mpl-sort-handle";
                sortHandle.textContent = "☰";
                sortHandle.title = "拖动排序";
                sortHandle.draggable = true;
                sortHandle.ondragstart = dragArea.ondragstart;
                sortHandle.ondragend = dragArea.ondragend;
                sortHandle.addEventListener("pointerdown", (e) => e.stopPropagation());
                sortHandle.addEventListener("mousedown", (e) => e.stopPropagation());

                // ☑ 启用开关（与整行点击、文件夹总开关保持同步）
                const check = document.createElement("input");
                check.type = "checkbox";
                check.checked = mplLoraEnabled(lora);
                check.title = "启用 / 停用此 LoRA";
                check.addEventListener("pointerdown", (e) => e.stopPropagation());
                check.addEventListener("mousedown", (e) => e.stopPropagation());
                check.addEventListener("click", (e) => e.stopPropagation());
                check.onchange = () => {
                    lora.enabled = check.checked;
                    row.style.opacity = check.checked ? "1" : "0.45";
                    this.renderEmbeddedList();
                    this.updateWidget();
                };
                row._mplCheckEl = check;

                const name = document.createElement("div");
                name.className = "mpl-lora-name notranslate";
                name.setAttribute("translate", "no");
                const displayName = (lora.name.split(/[/\\]/).pop() || lora.name).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "");
                name.textContent = displayName;
                name.dataset.lora = lora.name;
                mplDecorateName(name, lora.name);
                name.draggable = true;
                name.style.cursor = "move";
                name.ondragstart = (e) => {
                    mplClearLoraPreview();
                    const info = { type: "sort", sourceType: type, sourceFIdx: fIdx, sourceLIdx: lIdx };
                    e.dataTransfer.setData("text/plain", JSON.stringify(info));
                    e.dataTransfer.setData("application/x-sort-drag", "true");
                    try { e.dataTransfer.setData("application/x-mpl-lora", JSON.stringify({ name: lora.name })); } catch (_) {}
                    e.dataTransfer.effectAllowed = "move";
                    this._currentSortDrag = info;
                    row.style.opacity = "0.3";
                };
                name.ondragend = () => { 
                    this._currentSortDrag = null;
                    row.style.opacity = mplLoraEnabled(lora) ? "1" : "0.45"; 
                };

                if (!lora.note) lora.note = "";
                const noteInput = document.createElement("input");
                noteInput.type = "text";
                noteInput.className = "mpl-note-input";
                noteInput.value = lora.note || "";
                noteInput.placeholder = "备注...";
                noteInput.onchange = () => {
                    const previous = lora.note || "";
                    lora.note = noteInput.value;
                    void mplSetNote(lora.name, lora.note, previous);
                    this.updateWidget();
                };
                noteInput.onblur = () => {
                    if (lora.note === noteInput.value) return;
                    const previous = lora.note || "";
                    lora.note = noteInput.value;
                    void mplSetNote(lora.name, lora.note, previous);
                    this.updateWidget();
                };
                noteInput.addEventListener("keydown", (e)=>e.stopPropagation());
                noteInput.addEventListener("pointerdown", (e)=>e.stopPropagation());
                noteInput.addEventListener("mousedown", (e)=>e.stopPropagation());

                let clipBadge = null;
                let recBadge = null;
                const refreshClipBadge = () => mplUpdateClipBadgeUI(clipBadge, lora);
                const syncClipWithWeight = () => {
                    mplSyncClipWeight(lora);
                    refreshClipBadge();
                };

                const weightContainer = document.createElement("div");
                weightContainer.className = "mpl-weight-container";
                
                const decreaseBtn = document.createElement("button");
                decreaseBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
                decreaseBtn.style.cssText = `
                    width: 18px;
                    height: 18px;
                    background: #18181c;
                    border: none;
                    color: #a1a1aa;
                    cursor: pointer;
                    font-size: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                `;
                decreaseBtn.onclick = (e) => {
                    e.stopPropagation();
                    lora.weight = Math.max(-10, parseFloat((lora.weight - 0.01).toFixed(2)));
                    weightDisplay.textContent = lora.weight.toFixed(2);
                    syncClipWithWeight();
                    this.updateWidget();
                };
                decreaseBtn.onmouseenter = () => decreaseBtn.style.background = "#27272e";
                decreaseBtn.onmouseleave = () => decreaseBtn.style.background = "#18181c";
                decreaseBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                const weightDisplay = document.createElement("div");
                weightDisplay.className = "mpl-weight-display";
                weightDisplay.textContent = parseFloat(lora.weight).toFixed(2);
                weightDisplay.onclick = async (e) => {
                    e.stopPropagation();
                    const newVal = await mplEditValueAt(weightDisplay, lora.weight, { label: "权重" });
                    if (newVal !== null) {
                        const numVal = parseFloat(newVal);
                        if (!isNaN(numVal)) {
                            lora.weight = Math.max(-10, Math.min(10, numVal));
                            weightDisplay.textContent = lora.weight.toFixed(2);
                            syncClipWithWeight();
                            this.updateWidget();
                        }
                    }
                };
                
                const increaseBtn = document.createElement("button");
                increaseBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
                increaseBtn.style.cssText = `
                    width: 18px;
                    height: 18px;
                    background: #18181c;
                    border: none;
                    color: #a1a1aa;
                    cursor: pointer;
                    font-size: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                `;
                increaseBtn.onclick = (e) => {
                    e.stopPropagation();
                    lora.weight = Math.min(10, parseFloat((lora.weight + 0.01).toFixed(2)));
                    weightDisplay.textContent = lora.weight.toFixed(2);
                    syncClipWithWeight();
                    this.updateWidget();
                };
                increaseBtn.onmouseenter = () => increaseBtn.style.background = "#27272e";
                increaseBtn.onmouseleave = () => increaseBtn.style.background = "#18181c";
                increaseBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                weightContainer.appendChild(decreaseBtn);
                weightContainer.appendChild(weightDisplay);
                weightContainer.appendChild(increaseBtn);

                const layoutCfg = this.layoutSettings || { weightStyle: "arrows" };
                if (layoutCfg.weightStyle === "slider") {
                    while (weightContainer.firstChild) weightContainer.removeChild(weightContainer.firstChild);

                    const sliderMin = layoutCfg.sliderMin ?? -2;
                    const sliderMax = layoutCfg.sliderMax ?? 2;
                    const sliderWidth = layoutCfg.sliderWidth ?? 110;
                    const sliderStep = layoutCfg.sliderStep ?? 0.05;
                    const showValue = layoutCfg.showWeightValue !== false;
                    const snapToZero = layoutCfg.snapToZero !== false;

                    weightContainer.style.flexShrink = "0";
                    weightContainer.style.width = (sliderWidth + (showValue ? 46 : 0)) + "px";

                    const applySliderWeight = (newVal) => {
                        const clamped = Math.max(sliderMin, Math.min(sliderMax, newVal));
                        lora.weight = parseFloat(clamped.toFixed(2));
                        syncClipWithWeight();
                        updateSliderUI();
                        this.updateWidget();
                    };

                    const track = document.createElement("div");
                    track.style.cssText = `
                        position: relative;
                        flex: 1 1 0;
                        min-width: 0;
                        height: 20px;
                        background: transparent;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        padding: 0 7px;
                        box-sizing: border-box;
                    `;

                    const rail = document.createElement("div");
                    rail.style.cssText = `
                        position: absolute;
                        left: 7px;
                        right: 7px;
                        top: 50%;
                        height: 4px;
                        transform: translateY(-50%);
                        background: #27272e;
                        border-radius: 3px;
                        pointer-events: none;
                    `;
                    track.appendChild(rail);

                    const zeroLine = document.createElement("div");
                    zeroLine.style.cssText = `
                        position: absolute;
                        left: 50%;
                        top: 5px;
                        bottom: 5px;
                        width: 1px;
                        background: #52525b;
                        pointer-events: none;
                    `;
                    track.appendChild(zeroLine);

                    const fill = document.createElement("div");
                    fill.style.cssText = `
                        position: absolute;
                        top: 8px;
                        height: 4px;
                        background: linear-gradient(90deg,#6366f1,#818cf8);
                        border-radius: 3px;
                        pointer-events: none;
                    `;
                    track.appendChild(fill);

                    const sThumb = document.createElement("div");
                    sThumb.style.cssText = `
                        position: absolute;
                        top: 50%;
                        width: 12px;
                        height: 16px;
                        background: #f4f4f5;
                        border: 1px solid #6366f1;
                        border-radius: 5px;
                        transform: translate(-50%, -50%);
                        cursor: grab;
                        pointer-events: none;
                        box-shadow: 0 1px 4px rgba(0,0,0,0.55), 0 0 0 2px rgba(99,102,241,0.18);
                    `;
                    track.appendChild(sThumb);

                    const valueDisplay = document.createElement("div");
                    valueDisplay.className = "mpl-weight-display";
                    valueDisplay.textContent = parseFloat(lora.weight).toFixed(2);
                    valueDisplay.style.cssText = `
                        min-width: 40px;
                        padding: 2px 5px;
                        text-align: center;
                        color: #f4f4f5;
                        font-size: 11.5px;
                        user-select: none;
                        background: transparent;
                        font-variant-numeric: tabular-nums;
                        height: 20px;
                        display: ${showValue ? "flex" : "none"};
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        border-left: 1px solid rgba(255,255,255,0.08);
                        flex-shrink: 0;
                    `;
                    valueDisplay.onclick = async (e) => {
                        e.stopPropagation();
                        const newVal = await mplEditValueAt(valueDisplay, lora.weight, { label: "权重" });
                        if (newVal !== null) {
                            const numVal = parseFloat(newVal);
                            if (!isNaN(numVal)) {
                                applySliderWeight(numVal);
                            }
                        }
                    };

                    const valueToPercent = (v) => {
                        const range = sliderMax - sliderMin;
                        if (range === 0) return 50;
                        return ((v - sliderMin) / range) * 100;
                    };
                    const percentToValue = (pct) => {
                        const range = sliderMax - sliderMin;
                        return sliderMin + (pct / 100) * range;
                    };

                    const updateSliderUI = () => {
                        const pct = Math.max(0, Math.min(100, valueToPercent(lora.weight)));
                        sThumb.style.left = pct + "%";
                        if (lora.weight >= 0) {
                            fill.style.left = "50%";
                            fill.style.width = (pct - 50) + "%";
                            fill.style.background = "linear-gradient(90deg,#6366f1,#818cf8)";
                        } else {
                            fill.style.left = pct + "%";
                            fill.style.width = (50 - pct) + "%";
                            fill.style.background = "linear-gradient(90deg,#fca5a5,#ef4444)";
                        }
                        valueDisplay.textContent = lora.weight.toFixed(2);
                    };

                    let isDragging = false;
                    const onPointerMove = (e) => {
                        if (!isDragging) return;
                        const rect = track.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                        let newVal = percentToValue(pct);
                        if (snapToZero && Math.abs(newVal) < 0.02) newVal = 0;
                        newVal = Math.round(newVal / sliderStep) * sliderStep;
                        applySliderWeight(newVal);
                    };
                    const onPointerUp = () => {
                        isDragging = false;
                        document.removeEventListener("pointermove", onPointerMove);
                        document.removeEventListener("pointerup", onPointerUp);
                    };

                    track.addEventListener("pointerdown", (e) => {
                        e.stopPropagation();
                        isDragging = true;
                        const rect = track.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                        let newVal = percentToValue(pct);
                        if (snapToZero && Math.abs(newVal) < 0.02) newVal = 0;
                        newVal = Math.round(newVal / sliderStep) * sliderStep;
                        applySliderWeight(newVal);
                        document.addEventListener("pointermove", onPointerMove);
                        document.addEventListener("pointerup", onPointerUp);
                    });

                    track.addEventListener("wheel", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const delta = e.deltaY > 0 ? -sliderStep : sliderStep;
                        applySliderWeight(lora.weight + delta);
                    }, { passive: false });

                    weightContainer.appendChild(track);
                    weightContainer.appendChild(valueDisplay);
                    updateSliderUI();
                }

                // 🏷️ 触发词按钮：左键编辑触发词；右键开关触发词（多触发词支持逐项屏蔽）
                const tagBtn = document.createElement("button");
                tagBtn.className = "mpl-mini-btn tag notranslate";
                tagBtn.setAttribute("translate", "no");
                const _rawTrigText = String(lora.tags || lora.triggerWords || "").trim();
                const _trigWords = mplSplitTriggerWords(_rawTrigText);
                const _activeTrigWords = _trigWords.filter(w => !mplTriggerEffectivelyDisabled(lora, w));
                const _trigText = _activeTrigWords.join(", ");
                const _trigOn = lora.triggerEnabled !== false;
                const _trigOffCount = _trigWords.filter(w => mplTriggerEffectivelyDisabled(lora, w)).length;
                const _trigPartial = _trigWords.length >= 2 && _trigOffCount > 0 && _trigOffCount < _trigWords.length;
                if (_activeTrigWords.length && _trigOn) tagBtn.classList.add("active");
                if (!_trigOn || (_trigWords.length && !_activeTrigWords.length)) tagBtn.classList.add("mpl-trigger-off");
                if (_trigPartial) tagBtn.classList.add("mpl-trigger-partial");
                tagBtn.textContent = "🏷️";
                if (_activeTrigWords.length) {
                    if (_trigWords.length >= 2) {
                        const state = _trigPartial ? `部分屏蔽 ${_trigOffCount}/${_trigWords.length}` : "全部启用";
                        tagBtn.title = `触发词（${state}）· 左键编辑 · 右键逐项屏蔽\n${_trigText}`;
                    } else {
                        tagBtn.title = `触发词：已启用（左键编辑 · 右键关闭）\n${_trigText}`;
                    }
                } else if (_trigWords.length) {
                    tagBtn.title = `触发词：已全部屏蔽（${_trigWords.length} 个已隐藏）· 左键编辑 · 右键启用`;
                } else {
                    tagBtn.title = "暂无触发词（左键添加）";
                }
                tagBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showTagEditModal(lora);
                };
                tagBtn.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (_trigWords.length >= 2) {
                        this.showTriggerWordMenu(lora, e.clientX, e.clientY);
                        return;
                    }
                    lora.triggerEnabled = (lora.triggerEnabled === false);
                    this.renderEmbeddedList();
                    this.updateWidget();
                };
                tagBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                const editBtn = document.createElement("button");
                editBtn.className = "mpl-mini-btn edit";
                editBtn.innerHTML = mplIcon("edit", 13);
                editBtn.title = "编辑 LoRA 内容";
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showLoraEditModal(lora, type, fIdx, lIdx);
                };
                editBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                const del = document.createElement("button");
                del.className = "mpl-mini-btn del";
                del.innerHTML = mplIcon("close", 13);
                del.title = "删除";
                del.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                const preventDrag = (e) => {
                    e.stopPropagation();
                    if (e.target === check || e.target === sortHandle || e.target === thumb ||
                        e.target === noteInput || 
                        e.target === weightContainer || e.target.closest('.mpl-weight-container') ||
                        e.target === clipBadge || e.target === recBadge ||
                        e.target === tagBtn || e.target === editBtn || e.target === del ||
                        (typeof decreaseBtn !== 'undefined' && e.target === decreaseBtn) || (typeof increaseBtn !== 'undefined' && e.target === increaseBtn) || (typeof weightDisplay !== 'undefined' && e.target === weightDisplay)) {
                        e.preventDefault();
                        return false;
                    }
                };

                // 可选 CLIP 权重徽标（默认隐藏，在「⚙️设置 → 布局样式」中开启）
                mplSyncClipWeight(lora);
                if (this.layoutSettings && this.layoutSettings.hideClip === false) {
                    clipBadge = document.createElement("div");
                    clipBadge.className = "mpl-lora-clip-weight";
                    mplUpdateClipBadgeUI(clipBadge, lora);
                    clipBadge.onclick = async (e) => {
                        e.stopPropagation();
                        const v = await mplEditValueAt(clipBadge, mplClipWeightValue(lora), { label: "CLIP" });
                        if (v !== null && mplSetCustomClipWeight(lora, v)) {
                            refreshClipBadge();
                            this.updateWidget();
                        }
                    };
                    clipBadge.oncontextmenu = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        mplToggleClipFollow(lora);
                        refreshClipBadge();
                        this.updateWidget();
                    };
                    clipBadge.addEventListener("pointerdown", e => e.stopPropagation());
                    clipBadge.addEventListener("mousedown", e => e.stopPropagation());
                    clipBadge.addEventListener("dragstart", preventDrag);
                }

                // 紧凑作者推荐权重标签：仅在存在推荐值且未隐藏时显示，不占用空位
                if (!(this.layoutSettings && this.layoutSettings.hideRecWeight)) {
                    const _recW = Number(lora.recommendedWeight);
                    if (Number.isFinite(_recW) && _recW > 0 && _recW <= 1) {
                        recBadge = document.createElement("div");
                        const _same = Math.abs(mplLoraWeight(lora) - _recW) < 0.005;
                        recBadge.className = "mpl-lora-rec-weight" + (_same ? " is-applied" : "");
                        recBadge.textContent = "荐 " + _recW.toFixed(2);
                        const _src = lora.recommendedWeightSource || "作者推荐";
                        recBadge.title = "作者推荐权重 " + _recW.toFixed(2) + "（" + _src + "）\n单击套用到模型权重" + (_same ? "\n（当前已是推荐值）" : "");
                        recBadge.onclick = (e) => {
                            e.stopPropagation();
                            lora.weight = _recW;
                            mplSyncClipWeight(lora);
                            this.renderEmbeddedList();
                            this.updateWidget();
                        };
                        recBadge.addEventListener("pointerdown", e => e.stopPropagation());
                        recBadge.addEventListener("mousedown", e => e.stopPropagation());
                        recBadge.addEventListener("dragstart", preventDrag);
                    }
                }
                
                check.addEventListener("dragstart", preventDrag);
                thumb.addEventListener("dragstart", preventDrag);
                noteInput.addEventListener("dragstart", preventDrag);
                weightContainer.addEventListener("dragstart", preventDrag);
                tagBtn.addEventListener("dragstart", preventDrag);
                editBtn.addEventListener("dragstart", preventDrag);
                del.addEventListener("dragstart", preventDrag);
                
                const actions = document.createElement("div");
                actions.className = "mpl-lora-actions";
                actions.append(tagBtn, editBtn, del);

                row.append(
                    thumb, sortHandle, check, name, dragArea, noteInput, weightContainer,
                    ...(clipBadge ? [clipBadge] : []),
                    ...(recBadge ? [recBadge] : []),
                    actions
                );

                row.oncontextmenu = (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.showLoraRowContextMenu(lora, type, fIdx, lIdx, e.clientX, e.clientY);
                };
                return row;
            };

            // LoRA 颜色设置弹窗
            nodeType.prototype.showLoraColorModal = function(lora) {
                const old = document.querySelector('.mpl-lora-color-overlay');
                if (old) old.remove();
                const DEF = { bg: "#2b3b5e", bar: "#6366f1", text: "#eef1ff" };
                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop mpl-lora-color-overlay";
                overlay.style.cssText = "position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center;";
                const dlg = document.createElement("div");
                dlg.className = "ma-modal ma-modal-static-anim";
                dlg.style.cssText = "padding:18px 20px;min-width:340px;color:#f4f4f5;font-size:13px;";
                const title = document.createElement("div");
                title.textContent = "颜色设置：" + (lora.name || "");
                title.style.cssText = "font-size:14px;font-weight:650;color:#f4f4f5;margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px;";
                dlg.appendChild(title);

                const cs = this.colorSettings || {};
                const gcur = {
                    bg: cs.selectBg || DEF.bg,
                    bar: cs.selectBar || DEF.bar,
                    text: cs.selectText || DEF.text,
                };
                const hasLocal = !!(lora.color && typeof lora.color === "object");
                const lcur = {
                    bg: (hasLocal && lora.color.bg) || gcur.bg,
                    bar: (hasLocal && lora.color.bar) || gcur.bar,
                    text: (hasLocal && lora.color.text) || gcur.text,
                };
                const initialMode = lora.colorMode || (hasLocal ? "custom" : "global");

                const section = (text, hint) => {
                    const s = document.createElement("div");
                    s.style.cssText = "border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;margin-bottom:12px;background:#18181c;";
                    const h = document.createElement("div");
                    h.textContent = text;
                    h.style.cssText = "font-size:13px;font-weight:600;color:#e4e4e7;margin-bottom:8px;";
                    s.appendChild(h);
                    if (hint) {
                        const p = document.createElement("div");
                        p.textContent = hint;
                        p.style.cssText = "font-size:11px;color:#a1a1aa;margin-bottom:8px;";
                        s.appendChild(p);
                    }
                    dlg.appendChild(s);
                    return s;
                };
                const mkRow = (parent, label, val) => {
                    const w = document.createElement("div");
                    w.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;";
                    const l = document.createElement("div");
                    l.textContent = label;
                    l.style.cssText = "color:#d4d4d8;min-width:100px;font-size:12px;";
                    const inp = document.createElement("input");
                    inp.type = "color"; inp.value = val;
                    inp.style.cssText = "width:44px;height:26px;border:1px solid rgba(255,255,255,0.12);border-radius:5px;background:#09090b;cursor:pointer;";
                    w.appendChild(l); w.appendChild(inp); parent.appendChild(w);
                    return inp;
                };

                const localSec = section("本条 LoRA 颜色", "选择颜色来源后，下方色块用于「独立固定」模式");
                let applyLoraMode = () => {};
                const modeSwitch = mplColorModeSwitch(localSec, initialMode, (mode) => applyLoraMode(mode));
                const lbg = mkRow(localSec, "选中背景色", lcur.bg);
                const lbar = mkRow(localSec, "左侧色条", lcur.bar);
                const ltext = mkRow(localSec, "文字色", lcur.text);

                const preview = document.createElement("div");
                preview.style.cssText = "padding:7px 9px;border-radius:8px;font-size:12px;font-weight:600;margin:0 0 12px;";
                const renderPreview = () => {
                    preview.style.background = lbg.value;
                    preview.style.borderLeft = "3px solid " + lbar.value;
                    preview.style.color = ltext.value;
                    preview.textContent = "示例 LoRA 行（选中状态）";
                };
                [lbg, lbar, ltext].forEach(i => i.addEventListener("input", renderPreview));
                renderPreview();
                dlg.appendChild(preview);

                const globalSec = section("全局默认颜色", "跟随全局的 LoRA 使用此颜色；改动会同步到所有跟随全局的条目");
                const gbg = mkRow(globalSec, "选中背景色", gcur.bg);
                const gbar = mkRow(globalSec, "左侧色条", gcur.bar);
                const gtext = mkRow(globalSec, "文字色", gcur.text);

                applyLoraMode = (mode) => {
                    const follow = mode === "global";
                    if (follow) {
                        lbg.value = gbg.value; lbar.value = gbar.value; ltext.value = gtext.value;
                    }
                    [lbg, lbar, ltext].forEach(i => { i.disabled = follow; i.style.opacity = follow ? "0.45" : "1"; });
                    renderPreview();
                };
                applyLoraMode(modeSwitch.getMode());
                [gbg, gbar, gtext].forEach(i => i.addEventListener("input", () => {
                    if (modeSwitch.getMode() !== "global") return;
                    lbg.value = gbg.value; lbar.value = gbar.value; ltext.value = gtext.value;
                    renderPreview();
                }));

                const btnRow = document.createElement("div");
                btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;";
                const clearBtn = document.createElement("button");
                clearBtn.textContent = "清除本条色";
                clearBtn.className = "ma-btn";
                clearBtn.style.marginRight = "auto";
                clearBtn.onclick = () => {
                    delete lora.color;
                    lora.colorMode = "global";
                    this.renderEmbeddedList(); this.updateWidget();
                    overlay.remove();
                };
                const resetBtn = document.createElement("button");
                resetBtn.textContent = "恢复默认颜色";
                resetBtn.className = "ma-btn";
                resetBtn.onclick = () => {
                    gbg.value = DEF.bg; gbar.value = DEF.bar; gtext.value = DEF.text;
                    if (modeSwitch.getMode() === "global") {
                        lbg.value = DEF.bg; lbar.value = DEF.bar; ltext.value = DEF.text;
                        renderPreview();
                    }
                };
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.className = "ma-btn";
                cancelBtn.onclick = () => overlay.remove();
                const okBtn = document.createElement("button");
                okBtn.textContent = "确定";
                okBtn.className = "ma-btn ma-btn-primary";
                okBtn.onclick = () => {
                    const mode = modeSwitch.getMode();
                    lora.colorMode = mode;
                    if (mode === "custom") {
                        lora.color = { bg: lbg.value, bar: lbar.value, text: ltext.value };
                    } else {
                        delete lora.color;
                    }
                    this.colorSettings = { selectBg: gbg.value, selectBar: gbar.value, selectText: gtext.value };
                    this.properties["color_settings"] = this.colorSettings;
                    this.renderEmbeddedList(); this.updateWidget();
                    this.applyColorSettings?.();
                    this.setDirtyCanvas?.(true, true);
                    overlay.remove();
                };
                btnRow.appendChild(clearBtn); btnRow.appendChild(resetBtn); btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
                dlg.appendChild(btnRow);
                overlay.appendChild(dlg);
                overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
                document.body.appendChild(overlay);
            };

            // 文件夹颜色设置弹窗
            nodeType.prototype.showFolderColorModal = function(folder, fDiv) {
                const old = document.querySelector('.mpl-folder-color-overlay');
                if (old) old.remove();
                const DEF = { outer: "#18181c", inner: "#222228", bar: "#6366f1", ignore: "#8fb8e8", normal: "#8fb8e8" };
                const overlay = document.createElement("div");
                overlay.className = "ma-modal-backdrop mpl-folder-color-overlay";
                overlay.style.cssText = "position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center;";
                const dlg = document.createElement("div");
                dlg.className = "ma-modal ma-modal-static-anim";
                dlg.style.cssText = "padding:18px 20px;min-width:360px;color:#f4f4f5;font-size:13px;";
                const title = document.createElement("div");
                title.textContent = "文件夹颜色设置：" + (folder.name || "");
                title.style.cssText = "font-size:14px;font-weight:650;color:#f4f4f5;margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;";
                dlg.appendChild(title);

                const gcs = this.folderColorSettings || {};
                const gcur = {
                    outer: gcs.outer || "",
                    inner: gcs.inner || "",
                    bar: gcs.bar || "",
                    ignore: gcs.ignore || "",
                    normal: gcs.normal && gcs.normal !== "#8b8d9b" ? gcs.normal : "",
                };
                const hasLocal = !!(folder.color || folder.bgColor || folder.headBg);
                const lcur = {
                    outer: folder.bgColor || gcur.outer || DEF.outer,
                    inner: folder.headBg || gcur.inner || DEF.inner,
                    bar: folder.color || gcur.bar || DEF.bar,
                };
                const initialMode = folder.colorMode || (hasLocal ? "custom" : "global");

                const section = (text, hint) => {
                    const s = document.createElement("div");
                    s.style.cssText = "border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;margin-bottom:12px;background:#18181c;";
                    const h = document.createElement("div");
                    h.textContent = text;
                    h.style.cssText = "font-size:13px;font-weight:600;color:#e4e4e7;margin-bottom:8px;";
                    s.appendChild(h);
                    if (hint) {
                        const p = document.createElement("div");
                        p.textContent = hint;
                        p.style.cssText = "font-size:11px;color:#a1a1aa;margin-bottom:8px;";
                        s.appendChild(p);
                    }
                    dlg.appendChild(s);
                    return s;
                };
                const mkRow = (parent, label, val) => {
                    const w = document.createElement("div");
                    w.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;";
                    const l = document.createElement("div");
                    l.textContent = label;
                    l.style.cssText = "color:#d4d4d8;min-width:120px;font-size:12px;";
                    const inp = document.createElement("input");
                    inp.type = "color"; inp.value = val;
                    inp.style.cssText = "width:44px;height:26px;border:1px solid rgba(255,255,255,0.12);border-radius:5px;background:#09090b;cursor:pointer;";
                    const clearBtn = document.createElement("span");
                    clearBtn.textContent = "✕";
                    clearBtn.title = "清除此项单独颜色（回退全局）";
                    clearBtn.style.cssText = "cursor:pointer;color:#a1a1aa;font-size:12px;padding:0 4px;";
                    w.appendChild(l); w.appendChild(inp); w.appendChild(clearBtn); parent.appendChild(w);
                    inp.__clearBtn = clearBtn;
                    clearBtn.onclick = () => { inp.dataset.cleared = "1"; };
                    inp.addEventListener("input", () => { delete inp.dataset.cleared; });
                    return inp;
                };

                const localSec = section("本条文件夹颜色", "选择颜色来源后，下方色块用于「独立固定」模式");
                let applyFolderMode = () => {};
                const modeSwitch = mplColorModeSwitch(localSec, initialMode, (mode) => applyFolderMode(mode));
                const lInner = mkRow(localSec, "标题栏背景", lcur.inner);
                const lOuter = mkRow(localSec, "卡片背景", lcur.outer);
                const lBar = mkRow(localSec, "左侧色条", lcur.bar);

                const preview = document.createElement("div");
                preview.style.cssText = "border-radius:8px;overflow:hidden;margin:0 0 12px;border:1px solid rgba(255,255,255,0.08);";
                const ph = document.createElement("div");
                ph.style.cssText = "padding:6px 9px;font-size:12px;font-weight:600;";
                ph.textContent = "文件夹标题";
                const pb = document.createElement("div");
                pb.style.cssText = "padding:8px 9px;font-size:11px;color:#a1a1aa;";
                pb.textContent = "· 内含 LoRA 行区域";
                preview.appendChild(ph); preview.appendChild(pb);
                const renderPreview = () => {
                    preview.style.background = lOuter.value;
                    preview.style.borderLeft = "4px solid " + lBar.value;
                    ph.style.background = lInner.value;
                    ph.style.color = "#f4f4f5";
                };
                [lOuter, lInner, lBar].forEach(i => i.addEventListener("input", renderPreview));
                renderPreview();
                dlg.appendChild(preview);

                const globalSec = section("全局默认文件夹颜色", "跟随全局的文件夹使用此颜色；改动会同步到所有跟随全局的文件夹");
                const gInner = mkRow(globalSec, "标题栏背景", gcur.inner || DEF.inner);
                const gOuter = mkRow(globalSec, "卡片背景", gcur.outer || DEF.outer);
                const gBar = mkRow(globalSec, "左侧色条", gcur.bar || DEF.bar);
                const gIgnore = mkRow(globalSec, "忽略时颜色", gcur.ignore || DEF.ignore);
                const gNormal = mkRow(globalSec, "未忽略颜色", gcur.normal || DEF.normal);

                applyFolderMode = (mode) => {
                    const follow = mode === "global";
                    if (follow) {
                        lInner.value = gInner.value; lOuter.value = gOuter.value; lBar.value = gBar.value;
                        [lInner, lOuter, lBar].forEach(i => delete i.dataset.cleared);
                    }
                    [lInner, lOuter, lBar].forEach(i => {
                        i.disabled = follow;
                        i.style.opacity = follow ? "0.45" : "1";
                        if (i.__clearBtn) { i.__clearBtn.style.pointerEvents = follow ? "none" : "auto"; i.__clearBtn.style.opacity = follow ? "0.4" : "1"; }
                    });
                    renderPreview();
                };
                applyFolderMode(modeSwitch.getMode());
                [gInner, gOuter, gBar].forEach(i => i.addEventListener("input", () => {
                    if (modeSwitch.getMode() !== "global") return;
                    lInner.value = gInner.value; lOuter.value = gOuter.value; lBar.value = gBar.value;
                    renderPreview();
                }));

                const btnRow = document.createElement("div");
                btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;";
                const clearBtn = document.createElement("button");
                clearBtn.textContent = "清除本条色";
                clearBtn.className = "ma-btn";
                clearBtn.style.marginRight = "auto";
                clearBtn.onclick = () => {
                    delete folder.color; delete folder.bgColor; delete folder.headBg;
                    folder.colorMode = "global";
                    this.renderEmbeddedList(); this.updateWidget();
                    overlay.remove();
                };
                const resetBtn = document.createElement("button");
                resetBtn.textContent = "恢复默认颜色";
                resetBtn.className = "ma-btn";
                resetBtn.onclick = () => {
                    gOuter.value = DEF.outer; gInner.value = DEF.inner; gBar.value = DEF.bar;
                    gIgnore.value = DEF.ignore; gNormal.value = DEF.normal;
                    gOuter.dataset.cleared = "1"; gInner.dataset.cleared = "1"; gBar.dataset.cleared = "1";
                    gIgnore.dataset.cleared = "1"; gNormal.dataset.cleared = "1";
                    if (modeSwitch.getMode() === "global") {
                        lOuter.value = DEF.outer; lInner.value = DEF.inner; lBar.value = DEF.bar;
                        renderPreview();
                    }
                };
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.className = "ma-btn";
                cancelBtn.onclick = () => overlay.remove();
                const okBtn = document.createElement("button");
                okBtn.textContent = "确定";
                okBtn.className = "ma-btn ma-btn-primary";
                okBtn.onclick = () => {
                    const mode = modeSwitch.getMode();
                    folder.colorMode = mode;
                    if (mode === "custom") {
                        if (lOuter.dataset.cleared) delete folder.bgColor; else folder.bgColor = lOuter.value;
                        if (lInner.dataset.cleared) delete folder.headBg; else folder.headBg = lInner.value;
                        if (lBar.dataset.cleared) delete folder.color; else folder.color = lBar.value;
                    } else {
                        delete folder.color; delete folder.bgColor; delete folder.headBg;
                    }
                    this.folderColorSettings = {
                        outer: gOuter.dataset.cleared ? "" : gOuter.value,
                        inner: gInner.dataset.cleared ? "" : gInner.value,
                        bar: gBar.dataset.cleared ? "" : gBar.value,
                        ignore: gIgnore.dataset.cleared ? "" : gIgnore.value,
                        normal: gNormal.dataset.cleared ? "" : gNormal.value,
                    };
                    this.properties["folder_color_settings"] = this.folderColorSettings;
                    this.renderEmbeddedList(); this.updateWidget();
                    this.applyFolderColorSettings?.();
                    this.setDirtyCanvas?.(true, true);
                    overlay.remove();
                };
                btnRow.appendChild(clearBtn); btnRow.appendChild(resetBtn); btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
                dlg.appendChild(btnRow);
                overlay.appendChild(dlg);
                overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
                document.body.appendChild(overlay);
            };

            nodeType.prototype._builtinColorPresets = function() {
                return [
                    { name: "星夜紫蓝", lora: { selectBg: "#3d4d8c", selectBar: "#8ab4ff", selectText: "#f2f6ff" }, folder: { outer: "#1b1e2e", inner: "#272c44", bar: "#6c8cff" } },
                    { name: "极夜青碧", lora: { selectBg: "#0f5148", selectBar: "#3ef0d4", selectText: "#eafffb" }, folder: { outer: "#0c1f1d", inner: "#13322e", bar: "#2fe0c8" } },
                    { name: "暮色玫瑰", lora: { selectBg: "#5c2340", selectBar: "#ff8fc4", selectText: "#fff0f7" }, folder: { outer: "#241019", inner: "#3a1b2a", bar: "#ff7ab6" } },
                    { name: "琥珀暖橙", lora: { selectBg: "#5c3a12", selectBar: "#ffb454", selectText: "#fff6e8" }, folder: { outer: "#241a0c", inner: "#3a2a13", bar: "#ffa94d" } },
                    { name: "森野青绿", lora: { selectBg: "#1f5230", selectBar: "#6ff09a", selectText: "#eafff0" }, folder: { outer: "#101f15", inner: "#1b3322", bar: "#67d98b" } },
                    { name: "深空靛蓝", lora: { selectBg: "#2e2a6e", selectBar: "#9a8bff", selectText: "#f1eeff" }, folder: { outer: "#14132b", inner: "#22204a", bar: "#8aa1ff" } },
                    { name: "赤焰朱红", lora: { selectBg: "#5c1f28", selectBar: "#ff6b78", selectText: "#fff0f1" }, folder: { outer: "#241014", inner: "#3a1b20", bar: "#ff5f6d" } },
                    { name: "薄荷清灰", lora: { selectBg: "#2b4a52", selectBar: "#8fe4ea", selectText: "#f0fdff" }, folder: { outer: "#171f22", inner: "#233036", bar: "#7fd4d8" } },
                    { name: "葡萄奶紫", lora: { selectBg: "#432a66", selectBar: "#c79bff", selectText: "#f8f2ff" }, folder: { outer: "#1d1429", inner: "#2d2040", bar: "#b98bff" } },
                    { name: "石墨单色", lora: { selectBg: "#3c414b", selectBar: "#aeb8c6", selectText: "#fafcff" }, folder: { outer: "#202329", inner: "#2c3037", bar: "#9aa4b2" } },
                ];
            };

            nodeType.prototype._loadCustomColorPresets = function() {
                try {
                    const raw = localStorage.getItem("MA_COLOR_PRESETS");
                    const arr = raw ? JSON.parse(raw) : [];
                    return Array.isArray(arr) ? arr : [];
                } catch (e) { return []; }
            };
            nodeType.prototype._saveCustomColorPresets = function(arr) {
                try { localStorage.setItem("MA_COLOR_PRESETS", JSON.stringify(arr)); } catch (e) {}
            };

            nodeType.prototype._applyColorPreset = function(preset) {
                if (!preset) return;
                const l = preset.lora || {};
                const f = preset.folder || {};
                this.colorSettings = {
                    selectBg: l.selectBg || "#2b3b5e",
                    selectBar: l.selectBar || "#6366f1",
                    selectText: l.selectText || "#eef1ff",
                };
                this.folderColorSettings = {
                    outer: f.outer || "",
                    inner: f.inner || "",
                    bar: f.bar || "",
                    ignore: f.ignore || "",
                    normal: f.normal || "",
                };
                this.properties["color_settings"] = this.colorSettings;
                this.properties["folder_color_settings"] = this.folderColorSettings;
                this.renderEmbeddedList();
                this.updateWidget();
                this.applyColorSettings?.();
                this.applyFolderColorSettings?.();
                this.setDirtyCanvas?.(true, true);
            };

            nodeType.prototype.showColorPresetModal = function() {
                this.showSettingsModal("layout");
            };

            nodeType.prototype._mplLoraInIgnoredFolder = function(lora) {
                if (!lora) return false;
                return (this.loraData.folders || []).some(f => f.ignored && (f.loras || []).includes(lora));
            };

            nodeType.prototype._mplGroupSelectedIntoFolder = function(fallbackLora) {
                const folders = this.loraData.folders || [];
                const roots = this.loraData.loras || [];
                this._syncTopLayout();
                const layout = this._topLayout.slice();
                const folderByUid = new Map(folders.map(f => [this._uidFor(f), f]));
                const rootByUid = new Map(roots.map(l => [this._uidFor(l), l]));
                const seen = new Set();
                const picked = [];
                layout.forEach(tok => {
                    if (tok.startsWith("l:")) {
                        const l = rootByUid.get(tok.slice(2));
                        if (l && mplLoraEnabled(l) && !seen.has(l)) {
                            seen.add(l);
                            picked.push({ lora: l, containerTok: tok, isRoot: true });
                        }
                    } else if (tok.startsWith("f:")) {
                        const f = folderByUid.get(tok.slice(2));
                        if (f && !f.ignored) (f.loras || []).forEach(l => {
                            if (l && mplLoraEnabled(l) && !seen.has(l)) {
                                seen.add(l);
                                picked.push({ lora: l, containerTok: tok, isRoot: false });
                            }
                        });
                    }
                });
                if (!picked.length && fallbackLora) {
                    if (this._mplLoraInIgnoredFolder(fallbackLora)) {
                        void mplAlert("该 LoRA 所在群组已被忽略，不参与分组；请先取消忽略。");
                        return;
                    }
                    const tok = "l:" + this._uidFor(fallbackLora);
                    picked.push({ lora: fallbackLora, containerTok: tok, isRoot: true });
                }
                if (!picked.length) return;

                const pickedSet = new Set(picked.map(p => p.lora));
                const rootTokens = new Set(picked.filter(p => p.isRoot).map(p => p.containerTok));
                const firstTok = picked[0].containerTok;
                const firstOrigIdx = layout.indexOf(firstTok);
                const removedBefore = firstOrigIdx >= 0
                    ? layout.slice(0, firstOrigIdx).filter(t => rootTokens.has(t)).length
                    : 0;

                for (let i = roots.length - 1; i >= 0; i--) {
                    if (pickedSet.has(roots[i])) roots.splice(i, 1);
                }
                folders.forEach(f => {
                    if (!Array.isArray(f.loras)) return;
                    for (let i = f.loras.length - 1; i >= 0; i--) {
                        if (pickedSet.has(f.loras[i])) f.loras.splice(i, 1);
                    }
                });

                let num = 1;
                while (folders.some(f => f.name === `新建文件夹${num}`)) num++;
                const folder = {
                    name: `新建文件夹${num}`,
                    collapsed: false,
                    loras: picked.map(p => p.lora),
                };
                folders.push(folder);

                const cleaned = layout.filter(t => !rootTokens.has(t));
                let insertIdx = firstOrigIdx >= 0 ? firstOrigIdx - removedBefore : cleaned.length;
                insertIdx = Math.max(0, Math.min(insertIdx, cleaned.length));
                cleaned.splice(insertIdx, 0, "f:" + this._uidFor(folder));
                this._topLayout = cleaned;

                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype._mplCopyIntoNewFolder = function(fallbackLora) {
                const folders = this.loraData.folders || [];
                const roots = this.loraData.loras || [];
                this._syncTopLayout();
                const layout = this._topLayout.slice();
                const folderByUid = new Map(folders.map(f => [this._uidFor(f), f]));
                const rootByUid = new Map(roots.map(l => [this._uidFor(l), l]));
                const seen = new Set();
                const picked = [];
                layout.forEach(tok => {
                    if (tok.startsWith("l:")) {
                        const l = rootByUid.get(tok.slice(2));
                        if (l && mplLoraEnabled(l) && !seen.has(l)) { seen.add(l); picked.push({ lora: l, tok }); }
                    } else if (tok.startsWith("f:")) {
                        const f = folderByUid.get(tok.slice(2));
                        if (f && !f.ignored) (f.loras || []).forEach(l => {
                            if (l && mplLoraEnabled(l) && !seen.has(l)) { seen.add(l); picked.push({ lora: l, tok }); }
                        });
                    }
                });
                if (!picked.length && fallbackLora) {
                    if (this._mplLoraInIgnoredFolder(fallbackLora)) {
                        void mplAlert("该 LoRA 所在群组已被忽略，不参与额外群组；请先取消忽略。");
                        return;
                    }
                    picked.push({ lora: fallbackLora, tok: "l:" + this._uidFor(fallbackLora) });
                }
                if (!picked.length) return;

                let num = 1;
                while (folders.some(f => f.name === `新建文件夹${num}`)) num++;
                const folder = {
                    name: `新建文件夹${num}`,
                    collapsed: false,
                    loras: picked.map(p => {
                        const copy = JSON.parse(JSON.stringify(p.lora));
                        delete copy._uid;
                        copy.enabled = mplLoraEnabled(p.lora);
                        return mplDecorateNewLora(copy);
                    }),
                };
                folders.push(folder);
                const arr = this._topLayout;
                const folderTok = "f:" + this._uidFor(folder);
                const di = arr.indexOf(picked[picked.length - 1].tok);
                if (di >= 0) arr.splice(di + 1, 0, folderTok);
                else arr.push(folderTok);

                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype._mplDuplicateLoras = function(sources) {
                const picked = [...new Set((sources || []).filter(Boolean))];
                if (!picked.length) return;
                if (!Array.isArray(this.loraData.loras)) this.loraData.loras = [];
                const roots = this.loraData.loras;
                const folders = this.loraData.folders || [];
                this._syncTopLayout();

                const rootByUid = new Map(roots.map(l => [this._uidFor(l), l]));
                const folderByUid = new Map(folders.map(f => [this._uidFor(f), f]));
                const wanted = new Set(picked);
                const ordered = [];
                const seen = new Set();
                this._topLayout.forEach(tok => {
                    if (tok.startsWith("l:")) {
                        const l = rootByUid.get(tok.slice(2));
                        if (l && wanted.has(l) && !seen.has(l)) { seen.add(l); ordered.push(l); }
                    } else if (tok.startsWith("f:")) {
                        const f = folderByUid.get(tok.slice(2));
                        if (f) (f.loras || []).forEach(l => {
                            if (wanted.has(l) && !seen.has(l)) { seen.add(l); ordered.push(l); }
                        });
                    }
                });
                picked.forEach(l => { if (!seen.has(l)) ordered.push(l); });
                if (!ordered.length) return;

                ordered.forEach(l => {
                    const copy = JSON.parse(JSON.stringify(l));
                    delete copy._uid;
                    copy.enabled = mplLoraEnabled(l);
                    mplDecorateNewLora(copy);
                    roots.push(copy);
                });
                this._syncTopLayout();
                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype.showTriggerWordMenu = function(lora, x, y) {
                const old = document.querySelector('.mpl-ctx-menu');
                if (old) old.remove();
                const words = mplSplitTriggerWords(lora?.tags || lora?.triggerWords);
                if (!words.length) return;
                const menu = document.createElement("div");
                menu.className = "mpl-ctx-menu";
                menu.style.cssText = "position:fixed;z-index:10030;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.72);padding:6px;min-width:210px;max-width:300px;font-size:12.5px;color:#f4f4f5;";
                menu.style.left = x + "px";
                menu.style.top = y + "px";

                const head = document.createElement("div");
                head.textContent = `触发词（${words.length} 个）`;
                head.style.cssText = "padding:5px 10px 7px;color:#a1a1aa;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;font-size:12px;";
                menu.appendChild(head);

                const mkAction = (label, danger, fn) => {
                    const it = document.createElement("div");
                    it.textContent = label;
                    it.style.cssText = "padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;color:" + (danger ? "#f87171" : "#d4d4d8") + ";";
                    it.onmouseenter = () => it.style.background = danger ? "rgba(239,68,68,0.14)" : "rgba(99,102,241,0.16)";
                    it.onmouseleave = () => it.style.background = "transparent";
                    it.onclick = (ev) => {
                        ev.stopPropagation();
                        menu.remove();
                        fn();
                        this.renderEmbeddedList();
                        this.updateWidget();
                    };
                    menu.appendChild(it);
                };
                mkAction("全部启用", false, () => {
                    lora.triggerEnabled = true;
                    lora.triggerDisabled = [];
                });
                mkAction("全部屏蔽", true, () => {
                    lora.triggerEnabled = false;
                });

                const sep = document.createElement("div");
                sep.style.cssText = "height:1px;background:rgba(255,255,255,0.08);margin:5px 4px;";
                menu.appendChild(sep);

                const listWrap = document.createElement("div");
                listWrap.style.cssText = "max-height:240px;overflow-y:auto;";
                words.forEach(word => {
                    const row = document.createElement("label");
                    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;color:#d4d4d8;";
                    row.onmouseenter = () => row.style.background = "rgba(99,102,241,0.12)";
                    row.onmouseleave = () => row.style.background = "transparent";
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = !mplTriggerEffectivelyDisabled(lora, word);
                    cb.style.cssText = "accent-color:#6366f1;cursor:pointer;flex-shrink:0;";
                    cb.addEventListener("pointerdown", e => e.stopPropagation());
                    cb.onchange = () => {
                        mplSetTriggerWordEnabled(lora, word, cb.checked);
                        this.renderEmbeddedList();
                        this.updateWidget();
                    };
                    const txt = document.createElement("span");
                    txt.className = "notranslate";
                    txt.setAttribute("translate", "no");
                    txt.textContent = word;
                    txt.title = word;
                    txt.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                    row.append(cb, txt);
                    listWrap.appendChild(row);
                });
                menu.appendChild(listWrap);

                document.body.appendChild(menu);
                const r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + "px";
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + "px";
                ["pointerdown", "mousedown", "wheel"].forEach(ev =>
                    menu.addEventListener(ev, e => e.stopPropagation(), { passive: ev === "wheel" }));

                const close = (ev) => {
                    if (menu.contains(ev.target)) return;
                    menu.remove();
                    document.removeEventListener("pointerdown", close, true);
                };
                setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
            };

            nodeType.prototype.showLoraRowContextMenu = function(lora, type, fIdx, lIdx, x, y) {
                const old = document.querySelector('.mpl-ctx-menu');
                if (old) old.remove();
                const menu = document.createElement("div");
                menu.className = "mpl-ctx-menu";
                menu.style.cssText = "position:fixed;z-index:10030;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.72);padding:5px;min-width:158px;font-size:12.5px;color:#f4f4f5;";
                menu.style.left = x + "px";
                menu.style.top = y + "px";

                const mkItem = (label, fn, danger, icon) => {
                    const it = document.createElement("div");
                    it.style.cssText = "padding:8px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s;display:flex;align-items:center;gap:8px;" + (danger ? "color:#f87171;" : "color:#d4d4d8;");
                    it.innerHTML = (icon ? '<span style="display:inline-flex;opacity:.85;">' + mplIcon(icon, 15) + '</span>' : '') + '<span>' + label + '</span>';
                    it.onmouseenter = () => it.style.background = danger ? "rgba(239,68,68,0.14)" : "rgba(99,102,241,0.16)";
                    it.onmouseleave = () => it.style.background = "transparent";
                    it.onclick = (ev) => { ev.stopPropagation(); menu.remove(); fn(); };
                    menu.appendChild(it);
                    return it;
                };
                const selectedLoras = this._getMultiSelectedLoras();
                const actionLoras = selectedLoras.length > 1 ? selectedLoras : [lora];
                const many = actionLoras.length > 1;
                mkItem("替换 LoRA", () => {
                    this.showAddLoraModal({ replaceTarget: { type, fIdx, lIdx } });
                }, false, 'refresh');
                mkItem("加入收藏夹 ⭐", () => {
                    this._mplAddLoraToFavoriteMenu(lora.name, x, y);
                });
                mkItem(many ? `复制 LoRA（${actionLoras.length} 个）` : "复制 LoRA", () => {
                    this._mplDuplicateLoras(actionLoras);
                }, false, 'copy');
                if (many) {
                    mkItem("单独复制此项", () => {
                        this._mplDuplicateLoras([lora]);
                    }, false, 'copy');
                }
                const selectedCount = selectedLoras.length;
                mkItem(selectedCount ? `组成文件夹（选中 ${selectedCount} 个）` : "组成文件夹", () => {
                    this._mplGroupSelectedIntoFolder(lora);
                }, false, 'folderPlus');
                mkItem(selectedCount ? `额外群组（复制 ${selectedCount} 个）` : "额外群组（复制）", () => {
                    this._mplCopyIntoNewFolder(lora);
                }, false, 'layers');
                const fetchTargets = actionLoras.filter(l => l && l.name).map(l => l.name);
                if (fetchTargets.length) {
                    mkItem(many ? `爬取信息（${fetchTargets.length} 个）` : "爬取信息", () => {
                        this.showBatchEditModal(fetchTargets);
                    }, false, 'download');
                }
                mkItem("在 Civitai 打开", () => {
                    if (lora && lora.name) this.openLoraCivitai(lora.name);
                }, false, 'link');
                mkItem("颜色设置", () => {
                    this.showLoraColorModal(lora);
                }, false, 'palette');
                mkItem("删除", () => {
                    if (type === 'root') this.loraData.loras.splice(lIdx, 1);
                    else if (type === 'folder' && this.loraData.folders[fIdx]) this.loraData.folders[fIdx].loras.splice(lIdx, 1);
                    this.renderEmbeddedList(); this.updateWidget();
                }, true, 'trash');

                document.body.appendChild(menu);
                const r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + "px";
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + "px";

                const closeHandler = (ev) => {
                    if (menu.contains(ev.target)) return;
                    menu.remove();
                    cleanup();
                };
                const cleanup = () => {
                    document.removeEventListener("mousedown", closeHandler, true);
                    document.removeEventListener("pointerdown", closeHandler, true);
                    document.removeEventListener("wheel", closeHandler, true);
                    window.removeEventListener("blur", onBlur);
                    document.removeEventListener("visibilitychange", onVisibility, true);
                };
                const onBlur = () => { if (menu.parentNode) menu.remove(); cleanup(); };
                const onVisibility = () => { if (document.hidden) { if (menu.parentNode) menu.remove(); cleanup(); } };
                setTimeout(() => {
                    document.addEventListener("mousedown", closeHandler, true);
                    document.addEventListener("pointerdown", closeHandler, true);
                    document.addEventListener("wheel", closeHandler, true);
                    window.addEventListener("blur", onBlur);
                    document.addEventListener("visibilitychange", onVisibility, true);
                }, 0);
            };

            nodeType.prototype._editCardLora = function(f) {
                const tempLora = {
                    name: f,
                    enabled: true,
                    weight: 1.0,
                    tags: '',
                    note: '',
                    triggerWords: '',
                    jsonInfo: '',
                    logInfo: ''
                };
                let existingLora = null;
                let existingType = null;
                let existingFIdx = -1;
                let existingLIdx = -1;

                for (let i = 0; i < this.loraData.loras.length; i++) {
                    if (this.loraData.loras[i].name === f) {
                        existingLora = this.loraData.loras[i];
                        existingType = 'root';
                        existingLIdx = i;
                        break;
                    }
                }
                if (!existingLora) {
                    for (let fi = 0; fi < this.loraData.folders.length; fi++) {
                        const folder = this.loraData.folders[fi];
                        for (let li = 0; li < folder.loras.length; li++) {
                            if (folder.loras[li].name === f) {
                                existingLora = folder.loras[li];
                                existingType = 'folder';
                                existingFIdx = fi;
                                existingLIdx = li;
                                break;
                            }
                        }
                        if (existingLora) break;
                    }
                }
                const loraToEdit = existingLora || tempLora;
                this.showLoraEditModal(
                    loraToEdit,
                    existingType || 'root',
                    existingFIdx,
                    existingLIdx,
                    f
                );
            };

            nodeType.prototype.showAddLoraCardContextMenu = function(loraName, x, y, fetchTargets) {
                const old = document.querySelector('.mpl-ctx-menu');
                if (old) old.remove();
                const menu = document.createElement("div");
                menu.className = "mpl-ctx-menu";
                menu.style.cssText = "position:fixed;z-index:10030;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.72);padding:5px;min-width:170px;font-size:12.5px;color:#f4f4f5;";
                menu.style.left = x + "px";
                menu.style.top = y + "px";

                const mkItem = (label, fn, danger, icon) => {
                    const it = document.createElement("div");
                    it.style.cssText = "padding:8px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s;display:flex;align-items:center;gap:8px;" + (danger ? "color:#f87171;" : "color:#d4d4d8;");
                    it.innerHTML = (icon ? '<span style="display:inline-flex;opacity:.85;">' + mplIcon(icon, 15) + '</span>' : '') + '<span>' + label + '</span>';
                    it.onmouseenter = () => it.style.background = danger ? "rgba(239,68,68,0.14)" : "rgba(99,102,241,0.16)";
                    it.onmouseleave = () => it.style.background = "transparent";
                    it.onclick = (ev) => { ev.stopPropagation(); menu.remove(); cleanup(); fn(); };
                    menu.appendChild(it);
                    return it;
                };
                const targets = (Array.isArray(fetchTargets) ? fetchTargets : []).filter(Boolean);
                if (targets.length) {
                    mkItem(targets.length > 1 ? `爬取信息（已选 ${targets.length} 个）` : "爬取信息", () => {
                        this.showBatchEditModal(targets);
                    }, false, 'download');
                }
                mkItem("在 Civitai 打开", () => {
                    this.openLoraCivitai(loraName);
                }, false, 'link');
                mkItem("编辑信息/触发词", () => {
                    this._editCardLora(loraName);
                }, false, 'edit');

                document.body.appendChild(menu);
                const r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + "px";
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + "px";

                const closeHandler = (ev) => {
                    if (menu.contains(ev.target)) return;
                    menu.remove();
                    cleanup();
                };
                const cleanup = () => {
                    document.removeEventListener("mousedown", closeHandler, true);
                    document.removeEventListener("pointerdown", closeHandler, true);
                    document.removeEventListener("wheel", closeHandler, true);
                    window.removeEventListener("blur", onBlur);
                    document.removeEventListener("visibilitychange", onVisibility, true);
                };
                const onBlur = () => { if (menu.parentNode) menu.remove(); cleanup(); };
                const onVisibility = () => { if (document.hidden) { if (menu.parentNode) menu.remove(); cleanup(); } };
                setTimeout(() => {
                    document.addEventListener("mousedown", closeHandler, true);
                    document.addEventListener("pointerdown", closeHandler, true);
                    document.addEventListener("wheel", closeHandler, true);
                    window.addEventListener("blur", onBlur);
                    document.addEventListener("visibilitychange", onVisibility, true);
                }, 0);
            };

            nodeType.prototype.openLoraCivitai = async function(loraName) {
                const toast = document.createElement("div");
                toast.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:10080;background:#111114;border:1px solid rgba(255,255,255,0.14);color:#f4f4f5;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,0.7);";
                toast.textContent = "正在查询 Civitai…";
                document.body.appendChild(toast);
                try {
                    const resp = await api.fetchApi("/ma/lora/civitai_url", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lora_name: loraName }),
                    });
                    let data = {};
                    try { data = await resp.json(); } catch (e) {}
                    if (data && data.ok && data.url) {
                        toast.textContent = "已打开 Civitai";
                        window.open(data.url, "_blank", "noopener,noreferrer");
                    } else {
                        toast.textContent = "未找到 Civitai 地址：" + ((data && data.error) || ("HTTP " + resp.status));
                    }
                } catch (e) {
                    toast.textContent = "查询失败：" + (e && e.message ? e.message : e);
                }
                setTimeout(() => toast.remove(), 2600);
            };

            nodeType.prototype.showFolderContextMenu = function(folder, fDiv, x, y) {
                const old = document.querySelector('.mpl-ctx-menu');
                if (old) old.remove();
                const menu = document.createElement("div");
                menu.className = "mpl-ctx-menu";
                menu.style.cssText = "position:fixed;z-index:10030;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.72);padding:6px;min-width:180px;font-size:12.5px;color:#f4f4f5;";
                menu.style.left = x + "px";
                menu.style.top = y + "px";

                const mkItem = (label, fn, danger, icon) => {
                    const it = document.createElement("div");
                    it.style.cssText = "padding:8px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s;display:flex;align-items:center;gap:8px;" + (danger ? "color:#f87171;" : "color:#d4d4d8;");
                    it.innerHTML = (icon ? '<span style="display:inline-flex;opacity:.85;">' + mplIcon(icon, 15) + '</span>' : '') + '<span>' + label + '</span>';
                    it.onmouseenter = () => it.style.background = danger ? "rgba(239,68,68,0.14)" : "rgba(99,102,241,0.16)";
                    it.onmouseleave = () => it.style.background = "transparent";
                    it.onclick = (ev) => { ev.stopPropagation(); menu.remove(); fn(); };
                    menu.appendChild(it);
                };
                mkItem("保存为预设组", async () => {
                    const defName = String(folder.name || "预设").trim() || "预设";
                    const oldCat = (MPL_SIDEBAR.assignments && MPL_SIDEBAR.assignments[defName]) || "";
                    const name = await mplAsk("保存为预设组", defName, {
                        message: "保存当前 LORA 组为预设（同名会覆盖更新）" + (oldCat ? "\n当前分类：" + oldCat : ""),
                    });
                    if (!name || !name.trim()) return;
                    const nm = name.trim();
                    const category = (MPL_SIDEBAR.assignments && MPL_SIDEBAR.assignments[nm]) || oldCat || "";
                    const content = { folders: [JSON.parse(JSON.stringify(folder))] };
                    delete content.folders[0]._uid;
                    (content.folders[0].loras || []).forEach(l => delete l._uid);
                    api.fetchApi("/ma/lora/save_preset", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: nm, content, category }),
                    }).then(r => r.json()).then(res => {
                        if (res && res.status === "error") {
                            void mplAlert("保存预设失败：" + ((res && res.message) || "未知错误"));
                            return;
                        }
                        return mplLoadSidebar(true).then(() => mplRefreshAllSidebars());
                    }).catch(err => void mplAlert("保存预设失败: " + err));
                }, false, 'save');
                mkItem("颜色设置", () => {
                    this.showFolderColorModal(folder, fDiv);
                }, false, 'palette');
                mkItem("重命名", async () => {
                    const newName = await mplAsk("重命名文件夹", folder.name, { message: "输入新的文件夹名称：" });
                    if (newName && newName.trim()) { folder.name = newName.trim(); this.renderEmbeddedList(); this.updateWidget(); }
                }, false, 'edit');
                mkItem("删除文件夹", async () => {
                    if (await mplConfirm("Delete folder?", { danger: true, okText: "删除" })) {
                        if (this._previewTimeout) { clearTimeout(this._previewTimeout); this._previewTimeout = null; }
                        if (this._previewDiv) { this._previewDiv.remove(); this._previewDiv = null; }
                        document.querySelectorAll('.mpl-lora-preview').forEach(p => p.remove());
                        const idx = this.loraData.folders.indexOf(folder);
                        if (idx >= 0) this.loraData.folders.splice(idx, 1);
                        this.renderEmbeddedList();
                        this.updateWidget();
                    }
                }, true, 'trash');

                document.body.appendChild(menu);
                const r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + "px";
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + "px";

                const closeHandler = (ev) => {
                    if (menu.contains(ev.target)) return;
                    menu.remove();
                    cleanup();
                };
                const cleanup = () => {
                    document.removeEventListener("mousedown", closeHandler, true);
                    document.removeEventListener("pointerdown", closeHandler, true);
                    document.removeEventListener("wheel", closeHandler, true);
                    window.removeEventListener("blur", onBlur);
                    document.removeEventListener("visibilitychange", onVisibility, true);
                };
                const onBlur = () => { if (menu.parentNode) menu.remove(); cleanup(); };
                const onVisibility = () => { if (document.hidden) { if (menu.parentNode) menu.remove(); cleanup(); } };
                setTimeout(() => {
                    document.addEventListener("mousedown", closeHandler, true);
                    document.addEventListener("pointerdown", closeHandler, true);
                    document.addEventListener("wheel", closeHandler, true);
                    window.addEventListener("blur", onBlur);
                    document.addEventListener("visibilitychange", onVisibility, true);
                }, 0);
            };

            nodeType.prototype.showLoraImagePreview = function(lora) {
                const existing = document.querySelector('.mpl-img-preview-overlay');
                if (existing) existing.remove();
                const overlay = document.createElement("div");
                overlay.className = "mpl-img-preview-overlay";
                overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10020;display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
                const img = document.createElement("img");
                img.src = api.apiURL(`/ma/lora/image?name=${encodeURIComponent(lora.name)}&t=${Date.now()}`);
                img.style.cssText = "max-width:80vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.8);background:#18181c;";
                img.onerror = () => { overlay.innerHTML = '<div style="color:#a1a1aa;font-size:15px;">无预览图</div>'; };
                overlay.appendChild(img);
                overlay.onclick = () => overlay.remove();
                document.body.appendChild(overlay);
            };

            nodeType.prototype.addFolder = function() {
                const existingNames = this.loraData.folders.map(f => f.name);
                const blankFolderPattern = /^空白文件夹(\d+)$/;
                const blankFolderNumbers = existingNames
                    .map(name => {
                        const match = name.match(blankFolderPattern);
                        return match ? parseInt(match[1], 10) : null;
                    })
                    .filter(num => num !== null)
                    .sort((a, b) => a - b);
                
                let newNumber = 1;
                if (blankFolderNumbers.length > 0) {
                    let maxNumber = blankFolderNumbers[blankFolderNumbers.length - 1];
                    for (let i = 1; i <= maxNumber; i++) {
                        if (!blankFolderNumbers.includes(i)) {
                            newNumber = i;
                            break;
                        }
                    }
                    if (newNumber === 1 && blankFolderNumbers.includes(1)) {
                        newNumber = maxNumber + 1;
                    }
                }
                
                const newFolderName = `空白文件夹${newNumber}`;
                if (!existingNames.includes(newFolderName)) {
                    this.loraData.folders.push({ name: newFolderName, loras: [], collapsed: false });
                    this.renderEmbeddedList();
                    this.updateWidget();
                } else {
                    let fallbackNumber = newNumber + 1;
                    while (existingNames.includes(`空白文件夹${fallbackNumber}`)) {
                        fallbackNumber++;
                    }
                    this.loraData.folders.push({ name: `空白文件夹${fallbackNumber}`, loras: [], collapsed: false });
                    this.renderEmbeddedList();
                    this.updateWidget();
                }
            };

            nodeType.prototype.showAddLoraModal = async function(opts) {
                try {
                    const pendingReplace = opts && opts.replaceTarget ? opts.replaceTarget : null;
                    const actionMode = pendingReplace ? "replace" : "add";
                    let cacheTimestamp = new Date().getTime();
                    try { await mplLoadSidebar(); } catch (e) {}
                    
                    const resp = await api.fetchApi("/ma/lora/list");
                    const data = await resp.json();
                    const allFiles = data.files || [];
                    let allMtimes = data.mtimes || {};
                    allFiles.forEach(f => { if (allMtimes[f] === undefined) allMtimes[f] = 0; });
                    mplSetLoraNameList(allFiles);
                    
                    const folderTree = {};
                    const rootFiles = [];
                    allFiles.forEach(file => {
                        const parts = String(file).split(/[/\\]/);
                        if (parts.length === 1) {
                            rootFiles.push(file);
                        } else {
                            let current = folderTree;
                            for (let i = 0; i < parts.length - 1; i++) {
                                const folderName = parts[i];
                                if (!current[folderName]) {
                                    current[folderName] = { files: [], folders: {} };
                                }
                                if (i === parts.length - 2) {
                                    current[folderName].files.push(file);
                                } else {
                                    if (!current[folderName].folders) {
                                        current[folderName].folders = {};
                                    }
                                    current = current[folderName].folders;
                                }
                            }
                        }
                    });
                    
                    const savedBrowserState = mplLoadBrowserState();
                    let currentPath = mplSanitizeFolderPath(folderTree, savedBrowserState.path);
                    let selectedFiles = new Set();
                    let autoAddTag = savedBrowserState.autoAddTag;
                    let showAllMode = savedBrowserState.showAll;
                    let sortMode = "name";
                    let sortDir = "desc";
                    try { const _sp = JSON.parse(localStorage.getItem("MA_LORA_SORT")||"null"); if (_sp){ if(_sp.mode) sortMode=_sp.mode; if(_sp.dir) sortDir=_sp.dir; } } catch(e){}
                    const sortPersist = () => { try { localStorage.setItem("MA_LORA_SORT", JSON.stringify({ mode: sortMode, dir: sortDir })); } catch(e){} };
                    
                    const dialog = document.createElement("div");
                    let _dpos = null;
                    try { _dpos = JSON.parse(localStorage.getItem("MA_ADD_LORA_WIN") || "null"); } catch(e) { _dpos = null; }
                    let _dw = 860, _dh = 800, _dl, _dt;
                    if (_dpos && typeof _dpos.w === "number" && typeof _dpos.left === "number") {
                        _dw = _dpos.w; _dh = _dpos.h; _dl = _dpos.left; _dt = _dpos.top;
                    } else {
                        _dw = 860; _dh = 800;
                        _dl = Math.max(16, window.innerWidth / 2 - 430);
                        _dt = Math.max(16, window.innerHeight / 2 - 400);
                    }
                    _dl = Math.max(0, Math.min(_dl, window.innerWidth - 120));
                    _dt = Math.max(0, Math.min(_dt, window.innerHeight - 80));
                    dialog.style.cssText = `position:fixed;top:${_dt}px;left:${_dl}px;width:${_dw}px;height:${_dh}px;max-width:96vw;max-height:92vh;background:#111114;border:1px solid rgba(255,255,255,0.12);z-index:9999;display:flex;flex-direction:column;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.78), 0 0 0 1px rgba(255,255,255,0.05) inset;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;overflow:hidden;`;
                    dialog.__maSaveWinPos = () => {
                        try {
                            const r = dialog.getBoundingClientRect();
                            localStorage.setItem("MA_ADD_LORA_WIN", JSON.stringify({ left: r.left, top: r.top, w: r.width, h: r.height }));
                        } catch(e) {}
                    };
                    
                    dialog.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: false });
                    const stopEvent = (e) => { e.stopPropagation(); };
                    dialog.addEventListener("pointerdown", stopEvent);
                    dialog.addEventListener("pointermove", stopEvent);
                    dialog.addEventListener("pointerup", stopEvent);
                    dialog.addEventListener("mousedown", stopEvent);
                    dialog.addEventListener("keydown", stopEvent);

                    const header = document.createElement("div");
                    header.style.cssText = "padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;align-items:center;background:#151519;border-radius:14px 14px 0 0;cursor:move;user-select:none;";
                    
                    const title = document.createElement("div");
                    title.textContent = actionMode === "replace" ? "替换 Lora" : "添加 Lora";
                    title.style.cssText = "color:#f4f4f5;font-weight:650;font-size:15px;white-space:nowrap;flex:1;letter-spacing:-0.01em;";
                    
                    header.appendChild(title);
                    if (actionMode === "add") {
                        const loraStrBtn = document.createElement("button");
                        loraStrBtn.type = "button";
                        loraStrBtn.className = "ma-btn";
                        loraStrBtn.textContent = "📋 导入 LORA 串";
                        loraStrBtn.title = "粘贴 <lora:名称:权重> 批量导入（支持前缀忽略与近似匹配）";
                        loraStrBtn.style.cssText = "padding:5px 11px;font-size:12px;white-space:nowrap;";
                        loraStrBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
                        loraStrBtn.onclick = (e) => {
                            e.stopPropagation();
                            try { document.body.removeChild(dialog); } catch (_) {}
                            void this.showLoraStringModal();
                        };
                        header.appendChild(loraStrBtn);
                    }
                    dialog.appendChild(header);
                    
                    const pathBar = document.createElement("div");
                    pathBar.style.cssText = "padding:8px 18px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0d0d10;display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
                    
                    const allTabIdleStyle = "padding:4px 10px;background:#18181c;border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#d4d4d8;cursor:pointer;font-size:12px;font-weight:500;transition:all 0.15s;";
                    const allTabActiveStyle = "padding:4px 10px;background:rgba(239,68,68,0.16);border:1px solid rgba(239,68,68,0.45);border-radius:6px;color:#fca5a5;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.15s;";
                    const allTab = document.createElement("div");
                    allTab.textContent = "全部";
                    allTab.style.cssText = allTabIdleStyle;
                    allTab.onclick = () => {
                        if (showAllMode) {
                            showAllMode = false;
                            allTab.textContent = "全部";
                            allTab.style.cssText = allTabIdleStyle;
                            currentPath = [];
                            renderContent();
                        } else {
                            showAllMode = true;
                            allTab.textContent = "取消全部";
                            allTab.style.cssText = allTabActiveStyle;
                            renderContent();
                        }
                    };
                    if (showAllMode) {
                        allTab.textContent = "取消全部";
                        allTab.style.cssText = allTabActiveStyle;
                    }
                    pathBar.appendChild(allTab);
                    
                    const pathDisplay = document.createElement("div");
                    pathDisplay.style.cssText = "color:#a1a1aa;font-size:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;";
                    
                    const updatePathDisplay = () => {
                        pathDisplay.innerHTML = "";
                        if (showAllMode) return;
                        const rootSpan = document.createElement("span");
                        rootSpan.textContent = "根目录";
                        rootSpan.style.cssText = "color:#818cf8;cursor:pointer;font-weight:500;";
                        rootSpan.onclick = () => {
                            if (showAllMode) {
                                showAllMode = false;
                                allTab.textContent = "全部";
                                allTab.style.cssText = allTabIdleStyle;
                            }
                            currentPath = [];
                            renderContent();
                        };
                        rootSpan.onmouseenter = () => rootSpan.style.color = "#a5b4fc";
                        rootSpan.onmouseleave = () => rootSpan.style.color = "#818cf8";
                        pathDisplay.appendChild(rootSpan);
                        if (currentPath.length > 0) {
                            const separator1 = document.createElement("span");
                            separator1.textContent = " > ";
                            separator1.style.cssText = "color:#52525b;";
                            pathDisplay.appendChild(separator1);
                            currentPath.forEach((folderName, index) => {
                                const pathItem = document.createElement("span");
                                pathItem.textContent = folderName;
                                pathItem.style.cssText = "color:#818cf8;cursor:pointer;font-weight:500;";
                                pathItem.onclick = () => {
                                    if (showAllMode) {
                                        showAllMode = false;
                                        allTab.textContent = "全部";
                                        allTab.style.cssText = allTabIdleStyle;
                                    }
                                    currentPath = currentPath.slice(0, index + 1);
                                    renderContent();
                                };
                                pathItem.onmouseenter = () => pathItem.style.color = "#a5b4fc";
                                pathItem.onmouseleave = () => pathItem.style.color = "#818cf8";
                                pathDisplay.appendChild(pathItem);
                                if (index < currentPath.length - 1) {
                                    const separator = document.createElement("span");
                                    separator.textContent = " > ";
                                    separator.style.cssText = "color:#52525b;";
                                    pathDisplay.appendChild(separator);
                                }
                            });
                        }
                    };
                    
                    updatePathDisplay();
                    pathBar.appendChild(pathDisplay);

                    // 添加位置选择器（放在路径栏右侧，避免挤压搜索工具栏导致换行）
                    const addTargetWrap = document.createElement("div");
                    addTargetWrap.style.cssText = "display:flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:auto;";
                    const addTargetLabel = document.createElement("span");
                    addTargetLabel.textContent = "加入位置:";
                    addTargetLabel.style.cssText = "color:#a1a1aa;font-size:12px;white-space:nowrap;";
                    const addTargetSelect = document.createElement("select");
                    addTargetSelect.className = "ma-select";
                    addTargetSelect.style.cssText = "padding:4px 9px;font-size:12px;max-width:220px;width:auto;";
                    addTargetSelect.title = "添加 LoRA 时归入的节点群组或预设组";
                    const buildAddTargetOptions = () => {
                        const prev = addTargetSelect.value;
                        addTargetSelect.innerHTML = "";
                        const mkOpt = (v, t) => {
                            const o = document.createElement("option");
                            o.value = v; o.textContent = t; addTargetSelect.appendChild(o);
                        };
                        mkOpt("root", "📂 当前节点（不分组）");
                        (this.loraData.folders || []).forEach((f, i) => {
                            mkOpt("f:" + i, "📁 " + (f.name || ("组 " + (i + 1))) + "（本节点）");
                        });
                        Object.keys(MPL_SIDEBAR.presets || {}).forEach(n => {
                            const cat = (MPL_SIDEBAR.assignments && MPL_SIDEBAR.assignments[n]) || "";
                            mkOpt("p:" + n, "⭐ " + n + (cat ? "（" + cat + "）" : "（预设组）"));
                        });
                        try {
                            const saved = localStorage.getItem("MA_ADD_TARGET") || "root";
                            if ([...addTargetSelect.options].some(o => o.value === saved)) addTargetSelect.value = saved;
                            else if (prev && [...addTargetSelect.options].some(o => o.value === prev)) addTargetSelect.value = prev;
                        } catch (e) {}
                    };
                    buildAddTargetOptions();
                    addTargetSelect.onchange = () => { try { localStorage.setItem("MA_ADD_TARGET", addTargetSelect.value); } catch (e) {} };
                    addTargetWrap.append(addTargetLabel, addTargetSelect);
                    if (actionMode !== "replace") pathBar.appendChild(addTargetWrap);
                    dialog.appendChild(pathBar);
                    
                    const toolbar = document.createElement("div");
                    toolbar.style.cssText = "padding:10px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:#111114;display:flex;gap:12px;align-items:center;flex-wrap:wrap;";
                    
                    const search = document.createElement("input");
                    search.placeholder = "🔍 搜索当前目录（支持文件名与标题）...";
                    search.className = "ma-input";
                    // 弹性铺开并与右侧控件同行对齐，避免多余换行
                    search.style.cssText = "flex:1 1 220px;min-width:180px;padding:7px 11px;font-size:12.5px;";
                    search.addEventListener("keydown", (e) => { e.stopPropagation(); });
                    search.addEventListener("pointerdown", (e) => { e.stopPropagation(); });

                    // 一个下拉搞定排序（名称/时间 × 正序/倒序），不再额外堆箭头按钮
                    const sortContainer = document.createElement("div");
                    sortContainer.style.cssText = "display:flex;align-items:center;gap:6px;flex:0 0 auto;";
                    const sortLabel = document.createElement("span");
                    sortLabel.textContent = "排序:";
                    sortLabel.style.cssText = "color:#a1a1aa;font-size:12px;white-space:nowrap;";
                    const sortSelect = document.createElement("select");
                    sortSelect.className = "ma-select";
                    sortSelect.style.cssText = "padding:6px 9px;font-size:12px;width:auto;";
                    sortSelect.title = "排序方式";
                    sortSelect.innerHTML = [
                        '<option value="name:asc">按名称 A→Z</option>',
                        '<option value="name:desc">按名称 Z→A</option>',
                        '<option value="time:desc">按修改时间 最新</option>',
                        '<option value="time:asc">按修改时间 最早</option>',
                    ].join("");
                    sortSelect.value = sortMode + ":" + sortDir;
                    if (!sortSelect.value) sortSelect.value = "name:asc";
                    sortSelect.onchange = () => {
                        const parts = sortSelect.value.split(":");
                        sortMode = parts[0] || "name";
                        sortDir = parts[1] || "asc";
                        sortPersist();
                        renderContent();
                    };
                    sortContainer.append(sortLabel, sortSelect);

                    const resolveAddTarget = () => {
                        const val = addTargetSelect.value || "root";
                        if (val === "root") return this.loraData.loras;
                        if (val.indexOf("f:") === 0) {
                            const idx = parseInt(val.slice(2), 10);
                            let f = (this.loraData.folders || [])[idx];
                            if (!f) { f = { name: "新组", loras: [], collapsed: false }; this.loraData.folders.push(f); }
                            return (f.loras = f.loras || []);
                        }
                        if (val.indexOf("p:") === 0) {
                            const pname = val.slice(2);
                            let f = (this.loraData.folders || []).find(x => x && x.name === pname);
                            if (!f) {
                                let base = [];
                                try {
                                    const pfs = mplPresetFolders(MPL_SIDEBAR.presets[pname]);
                                    const src = pfs.find(x => x.name === pname) || pfs[0];
                                    if (src) base = (src.loras || []).map(l => mplDecorateNewLora(JSON.parse(JSON.stringify(l))));
                                } catch (e) {}
                                f = { name: pname, loras: base, collapsed: false };
                                (this.loraData.folders = this.loraData.folders || []).push(f);
                            }
                            return (f.loras = f.loras || []);
                        }
                        return this.loraData.loras;
                    };

                    const mplSortList = (arr) => {
                        const copy = arr.slice();
                        const dir = (sortDir === "asc") ? 1 : -1;
                        if (sortMode === "time") {
                            copy.sort((a, b) => {
                                const ma = allMtimes[a] || 0;
                                const mb = allMtimes[b] || 0;
                                if (ma !== mb) return (ma - mb) * dir;
                                return String(a).localeCompare(String(b), "zh");
                            });
                        } else {
                            copy.sort((a, b) => String(a).localeCompare(String(b), "zh") * dir);
                        }
                        return copy;
                    };
                    
                    const autoTagContainer = document.createElement("div");
                    autoTagContainer.style.cssText = "display:flex;align-items:center;gap:6px;";
                    const autoTagLabel = document.createElement("span");
                    autoTagLabel.textContent = "自动添加触发词";
                    autoTagLabel.style.cssText = "color:#a1a1aa;font-size:12px;font-weight:500;";
                    const autoTagToggle = document.createElement("label");
                    autoTagToggle.style.cssText = "position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;";
                    const toggleInput = document.createElement("input");
                    toggleInput.type = "checkbox";
                    toggleInput.style.cssText = "opacity:0;width:0;height:0;";
                    toggleInput.checked = autoAddTag;
                    const toggleSlider = document.createElement("span");
                    toggleSlider.style.cssText = "position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#27272a;border:1px solid rgba(255,255,255,0.12);transition:.25s;border-radius:20px;";
                    const toggleKnob = document.createElement("span");
                    toggleKnob.style.cssText = "position:absolute;height:14px;width:14px;left:2px;bottom:2px;background-color:white;transition:.25s;border-radius:50%;";
                    if (autoAddTag) {
                        toggleSlider.style.backgroundColor = "#6366f1";
                        toggleKnob.style.transform = "translateX(16px)";
                    }
                    toggleInput.onchange = (e) => {
                        autoAddTag = e.target.checked;
                        mplSaveBrowserState({ autoAddTag });
                        if (autoAddTag) {
                            toggleSlider.style.backgroundColor = "#6366f1";
                            toggleKnob.style.transform = "translateX(16px)";
                        } else {
                            toggleSlider.style.backgroundColor = "#27272a";
                            toggleKnob.style.transform = "translateX(0)";
                        }
                    };
                    toggleSlider.appendChild(toggleKnob);
                    autoTagToggle.append(toggleInput, toggleSlider);
                    autoTagContainer.append(autoTagLabel, autoTagToggle);

                    const refreshBtn = document.createElement("button");
                    refreshBtn.type = "button";
                    refreshBtn.className = "ma-btn";
                    refreshBtn.innerHTML = mplIcon("refresh", 14) + '<span style="margin-left:4px;">刷新</span>';
                    refreshBtn.title = "重新扫描 LoRA 目录，显示新加入的本地文件";
                    refreshBtn.style.cssText = "padding:6px 10px;font-size:12px;display:inline-flex;align-items:center;";
                    refreshBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (refreshBtn.disabled) return;
                        refreshBtn.disabled = true;
                        const label = refreshBtn.querySelector("span");
                        if (label) label.textContent = "扫描中…";
                        try { await refreshFileList(); }
                        finally {
                            refreshBtn.disabled = false;
                            if (label) label.textContent = "刷新";
                        }
                    };
                    
                    // 右侧控件成组靠右：搜索在左、排序/开关/刷新同行靠右，不折行错位
                    const toolbarRight = document.createElement("div");
                    toolbarRight.style.cssText = "display:flex;align-items:center;gap:12px;flex:0 0 auto;flex-wrap:nowrap;";
                    toolbarRight.append(sortContainer, autoTagContainer, refreshBtn);
                    toolbar.append(search, toolbarRight);
                    dialog.appendChild(toolbar);
                    
                    const content = document.createElement("div");
                    content.className = "mpl-add-scroll";
                    content.style.cssText = "flex:1;overflow-y:auto;padding:14px 18px;background:#09090b;display:grid;grid-template-columns:repeat(auto-fill, minmax(118px, 1fr));grid-auto-rows:172px;gap:10px;align-content:start;overscroll-behavior: contain;";
                    dialog.appendChild(content);
                    
                    const footer = document.createElement("div");
                    footer.style.cssText = "padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08);background:#151519;display:flex;align-items:center;justify-content:space-between;border-radius:0 0 14px 14px;";
                    
                    const selectedCount = document.createElement("div");
                    selectedCount.style.cssText = "color:#a1a1aa;font-size:12.5px;font-weight:500;";
                    selectedCount.textContent = "已选择 0 个 LoRA";
                    
                    const footerButtons = document.createElement("div");
                    footerButtons.style.cssText = "display:flex;gap:8px;align-items:center;";
                    
                    const detectBtn = document.createElement("button");
                    detectBtn.type = "button";
                    detectBtn.className = "ma-btn";
                    detectBtn.textContent = "🚨 LoRA 检测";
                    detectBtn.title = "检测重复文件（哈希）与 LoRA 更新（Civitai）";
                    detectBtn.style.cssText = "padding:7px 14px;font-size:12.5px;white-space:nowrap;";
                    detectBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.showLoraDetectModal({
                            initialPath: currentPath.slice(),
                            initialShowAll: showAllMode,
                            allFiles,
                            folderTree,
                        });
                    };
                    
                    const addBtn = document.createElement("button");
                    addBtn.className = "ma-btn ma-btn-primary";
                    addBtn.textContent = actionMode === "replace" ? "替换为选中 LoRA" : "添加选中 LoRA";
                    addBtn.style.cssText = "padding:7px 16px;font-size:12.5px;";
                    
                    const closeBtn = document.createElement("button");
                    closeBtn.className = "ma-btn";
                    closeBtn.textContent = "关闭";
                    closeBtn.style.cssText = "padding:7px 14px;font-size:12.5px;";

                    // 未选中任何文件时按钮半透明，避免误点
                    const updateAddBtn = () => {
                        const empty = selectedFiles.size === 0;
                        addBtn.disabled = empty;
                        addBtn.style.opacity = empty ? "0.55" : "1";
                        addBtn.style.cursor = empty ? "not-allowed" : "pointer";
                    };
                    updateAddBtn();

                    footerButtons.appendChild(detectBtn);
                    footerButtons.appendChild(addBtn);
                    footerButtons.appendChild(closeBtn);
                    footer.appendChild(selectedCount);
                    footer.appendChild(footerButtons);
                    dialog.appendChild(footer);
                    
                    const createLoraCard = (f) => {
                        const card = document.createElement("div");
                        const isSelected = selectedFiles.has(f);
                        card.style.cssText = `
                            width:100%;
                            height:100%;
                            background:${isSelected ? 'rgba(99, 102, 241, 0.14)' : '#18181c'};
                            border-radius:10px;
                            overflow:hidden;
                            cursor:pointer;
                            border:${isSelected ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)'};
                            transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                            position:relative;
                            display:flex;
                            flex-direction:column;
                            box-shadow:${isSelected ? '0 0 0 2px rgba(99, 102, 241, 0.28), 0 8px 20px rgba(0,0,0,0.45)' : '0 2px 8px rgba(0,0,0,0.3)'};
                            transform:${isSelected ? 'scale(0.98)' : 'scale(1)'};
                        `;
                        card.title = f;
                        card.dataset.selected = isSelected;
                        
                        card.onclick = (e) => {
                            if (e.target.closest('button') && e.target.closest('button').innerHTML === "✎") {
                                return;
                            }
                            e.stopPropagation();
                            if (selectedFiles.has(f)) {
                                selectedFiles.delete(f);
                            } else {
                                selectedFiles.add(f);
                            }
                            const nowSelected = selectedFiles.has(f);
                            card.dataset.selected = nowSelected;
                            card.style.background = nowSelected ? 'rgba(99, 102, 241, 0.14)' : '#18181c';
                            card.style.border = nowSelected ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)';
                            card.style.boxShadow = nowSelected ? '0 0 0 2px rgba(99, 102, 241, 0.28), 0 8px 20px rgba(0,0,0,0.45)' : '0 2px 8px rgba(0,0,0,0.3)';
                            card.style.transform = nowSelected ? 'scale(0.98)' : 'scale(1)';
                            updateSelectedCount();
                            updateAddBtn();
                        };

                        card.oncontextmenu = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const targets = selectedFiles.has(f) && selectedFiles.size
                                ? Array.from(selectedFiles)
                                : [f];
                            this.showAddLoraCardContextMenu(f, e.clientX, e.clientY, targets);
                        };
                        
                        card.onmouseover = () => { 
                            if (!selectedFiles.has(f)) {
                                card.style.borderColor = "rgba(99, 102, 241, 0.6)"; 
                                card.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.5)"; 
                            } else {
                                card.style.boxShadow = "0 0 0 2px rgba(99, 102, 241, 0.4), 0 8px 24px rgba(0,0,0,0.5)";
                            }
                        };
                        card.onmouseout = () => { 
                            const isSel = selectedFiles.has(f);
                            card.style.borderColor = isSel ? "#6366f1" : "rgba(255,255,255,0.1)"; 
                            card.style.boxShadow = isSel ? "0 0 0 2px rgba(99, 102, 241, 0.28), 0 8px 20px rgba(0,0,0,0.45)" : "0 2px 8px rgba(0,0,0,0.3)"; 
                        };
                            
                        const imgBox = document.createElement("div");
                        imgBox.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#09090b;z-index:0;";
                        
                        const img = document.createElement("img");
                        img.style.cssText = "width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.25s;display:block;";
                        img.loading = "lazy";
                        img.decoding = "async";
                        const spinner = document.createElement("div"); 
                        spinner.className = "mpl-spinner"; 
                        imgBox.appendChild(spinner);
                        const safeName = encodeURIComponent(f);
                        img.src = api.apiURL(`/ma/lora/image?name=${safeName}&w=320${mplBustSuffix(f)}`);
                        img.onload = () => { img.style.opacity = "1"; spinner.remove(); };
                        img.onerror = () => {
                            img.style.display = "none"; spinner.remove();
                            const fallback = document.createElement("div"); 
                            fallback.innerHTML = "No Image";
                            fallback.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#52525b;font-size:11px;background:#111114;";
                            imgBox.appendChild(fallback);
                        };
                        imgBox.appendChild(img);
                        
                        const nameBox = document.createElement("div");
                        nameBox.style.cssText = "position:absolute;bottom:0;left:0;width:100%;padding:5px 6px;font-size:11px;color:#f4f4f5;background:rgba(9,9,11,0.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;z-index:1;text-align:center;backdrop-filter:blur(6px);border-top:1px solid rgba(255,255,255,0.06);";
                        const titleText = mplTitleFor(f);
                        nameBox.textContent = titleText || f.split(/[/\\]/).pop().replace(/\.(safetensors|pt|ckpt)$/, "");

                        const editBtn = document.createElement("button");
                        editBtn.innerHTML = "✎";
                        editBtn.style.cssText = `
                            position: absolute;
                            top: 6px;
                            right: 6px;
                            width: 24px;
                            height: 24px;
                            background: rgba(17, 17, 20, 0.78);
                            backdrop-filter: blur(6px);
                            border: 1px solid rgba(255, 255, 255, 0.16);
                            border-radius: 6px;
                            color: #e4e4e7;
                            cursor: pointer;
                            font-size: 13px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            z-index: 10;
                            padding: 0;
                            line-height: 1;
                            transition: all 0.15s;
                        `;
                        editBtn.onclick = (e) => {
                            e.stopPropagation();
                            this._editCardLora(f);
                        };
                        editBtn.onmouseenter = () => { editBtn.style.background = "#6366f1"; editBtn.style.color = "#fff"; editBtn.style.borderColor = "#818cf8"; };
                        editBtn.onmouseleave = () => { editBtn.style.background = "rgba(17, 17, 20, 0.78)"; editBtn.style.color = "#e4e4e7"; editBtn.style.borderColor = "rgba(255, 255, 255, 0.16)"; };
                        editBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                        card.appendChild(imgBox);
                        card.appendChild(nameBox);
                        card.appendChild(editBtn);
                        return card;
                    };

                    let _renderToken = 0;
                    let _pendingScrollTop = null;
                    const appendCardsChunked = (taskList, batch = 48) => {
                        const token = ++_renderToken;
                        let idx = 0;
                        const runBatch = () => {
                            if (token !== _renderToken) return;
                            const end = Math.min(idx + batch, taskList.length);
                            const frag = document.createDocumentFragment();
                            for (; idx < end; idx++) {
                                const card = taskList[idx]();
                                if (card) frag.appendChild(card);
                            }
                            content.appendChild(frag);
                            if (_pendingScrollTop != null) content.scrollTop = _pendingScrollTop;
                            if (idx < taskList.length) {
                                requestAnimationFrame(runBatch);
                            } else {
                                _pendingScrollTop = null;
                            }
                        };
                        runBatch();
                    };
                    
                    const getCurrentFolder = () => {
                        if (currentPath.length === 0) {
                            return { files: rootFiles, folders: folderTree };
                        }
                        let current = folderTree;
                        for (let i = 0; i < currentPath.length; i++) {
                            const folderName = currentPath[i];
                            if (current[folderName]) {
                                if (i === currentPath.length - 1) {
                                    return { files: current[folderName].files || [], folders: current[folderName].folders || {} };
                                } else {
                                    current = current[folderName].folders || {};
                                }
                            } else {
                                return { files: [], folders: {} };
                            }
                        }
                        return { files: [], folders: {} };
                    };

                    const currentSubtreeFiles = () => {
                        const norm = (s) => String(s).replace(/\\/g, "/");
                        if (!currentPath.length) return allFiles.slice();
                        const prefix = norm(currentPath.join("/")) + "/";
                        return allFiles.filter(f => norm(f).startsWith(prefix));
                    };
                    
                    const renderContent = (preserveScroll = false) => {
                        _renderToken++;
                        _pendingScrollTop = preserveScroll ? content.scrollTop : null;
                        content.innerHTML = "";
                        const filter = search.value.trim().toLowerCase();
                        mplSaveBrowserState({ path: currentPath.slice(), showAll: showAllMode });
                        updatePathDisplay();
                        
                        if (showAllMode) {
                            const hits = mplSortList(allFiles.filter(f => !filter || mplLoraMatchesText(f, filter)));
                            appendCardsChunked(hits.map(f => () => createLoraCard(f)));
                            return;
                        }
                        if (filter) {
                            const hits = mplSortList(currentSubtreeFiles().filter(f => mplLoraMatchesText(f, filter)));
                            appendCardsChunked(hits.map(f => () => createLoraCard(f)));
                            return;
                        }
                        
                        const current = getCurrentFolder();
                        const folders = mplSortList(Object.keys(current.folders || {}));
                        const files = mplSortList(current.files || []);
                        
                        folders.forEach(folderName => {
                            const folderCard = document.createElement("div");
                            folderCard.style.cssText = "width:100%;height:100%;background:#18181c;border-radius:10px;overflow:hidden;cursor:pointer;border:1px solid rgba(255,255,255,0.09);transition:all 0.18s;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;";
                            const folderIcon = document.createElement("div");
                            folderIcon.textContent = "📁";
                            folderIcon.style.cssText = "font-size:44px;margin-bottom:8px;";
                            const folderNameEl = document.createElement("div");
                            folderNameEl.textContent = folderName;
                            folderNameEl.style.cssText = "color:#e4e4e7;font-size:11.5px;font-weight:500;text-align:center;padding:0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;box-sizing:border-box;";
                            folderCard.append(folderIcon, folderNameEl);
                            folderCard.onclick = () => {
                                if (showAllMode) {
                                    showAllMode = false;
                                    allTab.textContent = "全部";
                                    allTab.style.cssText = allTabIdleStyle;
                                }
                                currentPath.push(folderName);
                                renderContent();
                            };
                            folderCard.onmouseover = () => { folderCard.style.borderColor = "#6366f1"; folderCard.style.background = "#222228"; };
                            folderCard.onmouseout = () => { folderCard.style.borderColor = "rgba(255,255,255,0.09)"; folderCard.style.background = "#18181c"; };
                            content.appendChild(folderCard);
                        });
                        
                        appendCardsChunked(files.map(f => () => createLoraCard(f)));
                    };
                    
                    const refreshFileList = async () => {
                        try {
                            const resp = await api.fetchApi("/ma/lora/list");
                            const data = await resp.json();
                            const newAllFiles = data.files || [];
                            allMtimes = data.mtimes || {};
                            newAllFiles.forEach(f => { if (allMtimes[f] === undefined) allMtimes[f] = 0; });
                            mplSetLoraNameList(newAllFiles);
                            
                            const newFolderTree = {};
                            const newRootFiles = [];
                            newAllFiles.forEach(file => {
                                const parts = String(file).split(/[/\\]/);
                                if (parts.length === 1) {
                                    newRootFiles.push(file);
                                } else {
                                    let current = newFolderTree;
                                    for (let i = 0; i < parts.length - 1; i++) {
                                        const folderName = parts[i];
                                        if (!current[folderName]) {
                                            current[folderName] = { files: [], folders: {} };
                                        }
                                        if (i === parts.length - 2) {
                                            current[folderName].files.push(file);
                                        } else {
                                            if (!current[folderName].folders) {
                                                current[folderName].folders = {};
                                            }
                                            current = current[folderName].folders;
                                        }
                                    }
                                }
                            });
                            
                            allFiles.length = 0;
                            allFiles.push(...newAllFiles);
                            Object.keys(folderTree).forEach(key => delete folderTree[key]);
                            Object.assign(folderTree, newFolderTree);
                            rootFiles.length = 0;
                            rootFiles.push(...newRootFiles);
                            cacheTimestamp = Date.now();
                            renderContent(true);
                        } catch (e) {
                            console.error("刷新文件列表时出错:", e);
                        }
                    };
                    
                    this._renderContentFunc = renderContent;
                    this._refreshFileListFunc = refreshFileList;
                    this._addLoraModal = dialog;
                    
                    const updateSelectedCount = () => {
                        selectedCount.textContent = `已选择 ${selectedFiles.size} 个 LoRA`;
                    };
                    
                    search.oninput = () => {
                        renderContent();
                    };
                    
                    addBtn.onclick = async () => {
                        if (actionMode === "replace") {
                            if (!pendingReplace) { void mplAlert("请先选择要替换的 LoRA"); return; }
                            const first = Array.from(selectedFiles)[0];
                            if (!first) { void mplAlert("请选择要替换成的 LoRA"); return; }
                            await this.performReplaceLora(pendingReplace, first);
                            document.body.removeChild(dialog);
                            return;
                        }
                        const parsePreferredWeight = (logContent) => {
                            if (!logContent || !logContent.trim()) return null;
                            try {
                                try {
                                    const jsonData = JSON.parse(logContent);
                                    const preferredWeight = jsonData["preferred weight"] || 
                                                          jsonData["preferredWeight"] || 
                                                          jsonData["preferred_weight"] ||
                                                          jsonData["weight"];
                                    if (preferredWeight !== undefined && !isNaN(parseFloat(preferredWeight))) {
                                        const weightValue = parseFloat(preferredWeight);
                                        if (weightValue >= -10 && weightValue <= 10) {
                                            return weightValue;
                                        }
                                    }
                                } catch (jsonError) {
                                    const weightPattern = /preferred\s+weight[:\s=]+([+-]?\d*\.?\d+)/i;
                                    const match = logContent.match(weightPattern);
                                    if (match && match[1]) {
                                        const weight = parseFloat(match[1]);
                                        if (!isNaN(weight)) {
                                            return Math.max(-10, Math.min(10, weight));
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error("解析preferred weight时出错:", e);
                            }
                            return null;
                        };
                        
                        const weightPromises = Array.from(selectedFiles).map(async (fileName) => {
                            try {
                                const response = await api.fetchApi('/ma/lora/get_lora_file', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ lora_filename: fileName, file_type: 'log' })
                                });
                                const result = await response.json();
                                if (result.status === 'success' && result.content) {
                                    const preferredWeight = parsePreferredWeight(result.content);
                                    return { fileName, preferredWeight };
                                }
                            } catch (e) {
                                console.error(`读取${fileName}的log文件时出错:`, e);
                            }
                            return { fileName, preferredWeight: null };
                        });
                        
                        const weightResults = await Promise.all(weightPromises);
                        const weightMap = new Map();
                        weightResults.forEach(({ fileName, preferredWeight }) => {
                            weightMap.set(fileName, preferredWeight);
                        });
                        
                        if (autoAddTag) {
                            const readPromises = Array.from(selectedFiles).map(async (fileName) => {
                                try {
                                    const response = await api.fetchApi('/ma/lora/get_lora_file', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ lora_filename: fileName, file_type: 'txt' })
                                    });
                                    const result = await response.json();
                                    if (result.status === 'success' && result.content) {
                                        return { fileName, tags: result.content.trim() };
                                    }
                                } catch (e) {
                                    console.error(`读取${fileName}的txt文件时出错:`, e);
                                }
                                return { fileName, tags: '' };
                            });
                            
                            const tagResults = await Promise.all(readPromises);
                            const tagMap = new Map();
                            tagResults.forEach(({ fileName, tags }) => {
                                tagMap.set(fileName, tags);
                            });
                            
                            const addDest = resolveAddTarget();
                            selectedFiles.forEach(fileName => {
                                const preferredWeight = weightMap.get(fileName);
                                addDest.push(mplDecorateNewLora({ 
                                    name: fileName, 
                                    weight: preferredWeight !== null ? preferredWeight : 1.0, 
                                    enabled: true, 
                                    tags: tagMap.get(fileName) || "", 
                                    note: "" 
                                }));
                            });
                        } else {
                            const addDest = resolveAddTarget();
                            selectedFiles.forEach(fileName => {
                                const preferredWeight = weightMap.get(fileName);
                                addDest.push(mplDecorateNewLora({ 
                                    name: fileName, 
                                    weight: preferredWeight !== null ? preferredWeight : 1.0, 
                                    enabled: true, 
                                    tags: "", 
                                    note: "" 
                                }));
                            });
                        }
                        
                        this.renderEmbeddedList();
                        this.updateWidget();
                        document.body.removeChild(dialog);
                    };
                    
                    closeBtn.onclick = () => {
                        document.body.removeChild(dialog);
                    };
                    
                    const handleEsc = (e) => {
                        if (e.key === "Escape") {
                            document.body.removeChild(dialog);
                            document.removeEventListener("keydown", handleEsc);
                        }
                    };
                    document.addEventListener("keydown", handleEsc);
                    
                    document.body.appendChild(dialog);
                    const focusSearch = () => {
                        try {
                            if (dialog.isConnected && !dialog.contains(document.activeElement)) search.focus();
                        } catch (e) {}
                    };
                    setTimeout(focusSearch, 0);
                    setTimeout(focusSearch, 150);
                    this.makeDialogDraggable(dialog, header);
                    requestAnimationFrame(() => {
                        try { renderContent(); } catch(e) { console.error(e); }
                    });
                } catch(e) { void mplAlert("Error: "+e); }
            };

            // 替换指定位置 LoRA 文件；保留模型/CLIP 权重与启用状态，按新文件重新同步触发词、备注与推荐权重
            nodeType.prototype.performReplaceLora = async function(target, newName) {
                if (!target) return;
                let lora = null;
                if (target.type === "root") {
                    lora = (this.loraData.loras || [])[target.lIdx] || null;
                } else if (target.type === "folder") {
                    const folder = (this.loraData.folders || [])[target.fIdx];
                    if (folder) lora = (folder.loras || [])[target.lIdx] || null;
                }
                if (!lora) return;
                const keep = {
                    weight: lora.weight,
                    clipWeight: lora.clipWeight,
                    clipFollow: lora.clipFollow,
                    enabled: lora.enabled,
                };
                lora.name = newName;
                lora.tags = "";
                lora.triggerWords = "";
                delete lora.triggerDisabled;
                delete lora.recommendedWeight;
                delete lora.recommendedWeightSource;
                lora.note = "";
                mplDecorateNewLora(lora);
                if (!String(lora.tags || "").trim() || lora.recommendedWeight === undefined) {
                    try {
                        await mplLoadExtraInfo(true);
                        mplDecorateNewLora(lora);
                    } catch (e) {}
                }
                if (!String(lora.tags || "").trim()) {
                    try {
                        const res = await api.fetchApi("/ma/lora/get_lora_file", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lora_filename: newName, file_type: "txt" }),
                        }).then(r => r.json());
                        if (res && res.status === "success" && res.content) mplSetTriggerWords(lora, res.content);
                    } catch (e) {}
                }
                Object.assign(lora, keep);
                this.renderEmbeddedList();
                this.updateWidget();
            };

            nodeType.prototype.showLoraDetectModal = async function(opts) {
                opts = opts || {};
                const savedBrowserState = mplLoadBrowserState();
                // 从「添加 Lora」打开时沿用其当前路径，否则恢复上次记住的文件夹
                let currentPath = Array.isArray(opts.initialPath) ? opts.initialPath.slice() : savedBrowserState.path;
                let showAllMode = typeof opts.initialShowAll === "boolean" ? opts.initialShowAll : savedBrowserState.showAll;
                let allFiles = opts.allFiles;
                let folderTree = opts.folderTree;
                try {
                    if (!allFiles || !folderTree) {
                        const resp = await api.fetchApi("/ma/lora/list");
                        const data = await resp.json();
                        allFiles = data.files || [];
                        const built = buildMplFolderTree(allFiles);
                        folderTree = built.folderTree;
                    }
                    currentPath = mplSanitizeFolderPath(folderTree, currentPath);

                    // 直接挂 body，不用 overlay（参考 magic_resolution.js 的做法）
                    const dialog = document.createElement("div");
                    dialog.className = "ma-modal";
                    dialog.style.cssText = `
                        position: fixed;
                        top: 50%; left: 50%;
                        transform: translate(-50%, -50%);
                        width: min(740px, 96vw);
                        max-height: 88vh;
                        background: #111114;
                        border: 1px solid rgba(255, 255, 255, 0.12);
                        border-radius: 14px;
                        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
                        display: flex;
                        flex-direction: column;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
                        color: #f4f4f5;
                        z-index: 10050;
                        overflow: hidden;
                    `;

                    const header = document.createElement("div");
                    header.style.cssText = "padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:#151519;border-radius:14px 14px 0 0;cursor:move;user-select:none;display:flex;justify-content:space-between;align-items:center;";
                    const title = document.createElement("div");
                    title.textContent = "LoRA 检测（重复 + 更新）";
                    title.style.cssText = "font-weight:650;font-size:15px;color:#f4f4f5;";
                    const closeX = document.createElement("button");
                    closeX.className = "ma-modal-close";
                    closeX.textContent = "✕";
                    header.appendChild(title);
                    header.appendChild(closeX);

                    const pathBar = document.createElement("div");
                    pathBar.style.cssText = "padding:8px 18px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0d0d10;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
                    const detectTabIdleStyle = "padding:4px 10px;background:#18181c;border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#d4d4d8;cursor:pointer;font-size:12px;font-weight:500;";
                    const detectTabActiveStyle = "padding:4px 10px;background:rgba(239,68,68,0.16);border:1px solid rgba(239,68,68,0.45);border-radius:6px;color:#fca5a5;cursor:pointer;font-size:12px;font-weight:600;";
                    const allTab = document.createElement("div");
                    allTab.textContent = "全部";
                    allTab.style.cssText = detectTabIdleStyle;
                    const pathDisplay = document.createElement("div");
                    pathDisplay.style.cssText = "color:#a1a1aa;font-size:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;flex:1;";

                    const scopeHint = document.createElement("div");
                    scopeHint.style.cssText = "padding:8px 18px;background:rgba(99,102,241,0.08);font-size:12px;color:#a5b4fc;border-bottom:1px solid rgba(255,255,255,0.06);";

                    const folderRow = document.createElement("div");
                    folderRow.style.cssText = "padding:8px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:#111114;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-height:100px;overflow-y:auto;";

                    const fmtSize = (n) => {
                        if (n == null) return "";
                        if (n < 1024) return n + " B";
                        if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
                        return (n / 1048576).toFixed(1) + " MB";
                    };
                    const fmtTime = (ts) => {
                        try { return new Date(ts * 1000).toLocaleString(); } catch (_) { return String(ts); }
                    };

                    const updateScopeUI = () => {
                        // 与「添加 Lora」共用同一份记忆：检测弹窗里切换的文件夹下次也会恢复
                        mplSaveBrowserState({ path: currentPath.slice(), showAll: showAllMode });
                        if (showAllMode) {
                            scopeHint.textContent = "检测范围：全部 LoRA 文件（可能较慢）";
                            allTab.textContent = "取消全部";
                            allTab.style.cssText = detectTabActiveStyle;
                            pathDisplay.innerHTML = "";
                            folderRow.innerHTML = "<span style='color:#71717a;font-size:12px;'>全部模式下可点击下方「开始检测」扫描所有目录。</span>";
                            return;
                        }
                        allTab.textContent = "全部";
                        allTab.style.cssText = detectTabIdleStyle;
                        if (currentPath.length === 0) {
                            scopeHint.textContent = "检测范围：根目录 — 仅 loras 根下的文件（不包含子文件夹内文件）。进入子文件夹可检测该文件夹及其下所有子目录。";
                        } else {
                            scopeHint.textContent = "检测范围：文件夹「" + currentPath.join("/") + "」及其所有子目录内的 LoRA。";
                        }
                        pathDisplay.innerHTML = "";
                        const rootSpan = document.createElement("span");
                        rootSpan.textContent = "根目录";
                        rootSpan.style.cssText = "color:#818cf8;cursor:pointer;font-weight:500;";
                        rootSpan.onclick = () => { showAllMode = false; currentPath = []; updateScopeUI(); };
                        pathDisplay.appendChild(rootSpan);
                        currentPath.forEach((folderName, index) => {
                            const sep = document.createElement("span");
                            sep.textContent = " > ";
                            sep.style.color = "#52525b";
                            pathDisplay.appendChild(sep);
                            const sp = document.createElement("span");
                            sp.textContent = folderName;
                            sp.style.cssText = "color:#818cf8;cursor:pointer;font-weight:500;";
                            sp.onclick = () => { currentPath = currentPath.slice(0, index + 1); updateScopeUI(); };
                            pathDisplay.appendChild(sp);
                        });
                        folderRow.innerHTML = "";
                        const subs = mplGetSubfolderNames(folderTree, currentPath);
                        if (!subs.length) {
                            const t = document.createElement("span");
                            t.style.cssText = "color:#71717a;font-size:12px;";
                            t.textContent = "当前层级无子文件夹，可直接开始检测。";
                            folderRow.appendChild(t);
                        } else {
                            subs.forEach(name => {
                                const b = document.createElement("button");
                                b.type = "button";
                                b.textContent = "📁 " + name;
                                b.style.cssText = "padding:4px 10px;background:#18181c;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#d4d4d8;cursor:pointer;font-size:12px;transition:all 0.15s;";
                                b.onmouseenter = () => { b.style.background = "#222228"; b.style.borderColor = "#6366f1"; };
                                b.onmouseleave = () => { b.style.background = "#18181c"; b.style.borderColor = "rgba(255,255,255,0.1)"; };
                                b.onclick = () => { currentPath = currentPath.concat([name]); updateScopeUI(); };
                                folderRow.appendChild(b);
                            });
                        }
                    };

                    allTab.onclick = () => {
                        if (showAllMode) {
                            showAllMode = false;
                            currentPath = [];
                        } else {
                            showAllMode = true;
                        }
                        updateScopeUI();
                    };

                    pathBar.appendChild(allTab);
                    pathBar.appendChild(pathDisplay);

                    const bodyScroll = document.createElement("div");
                    bodyScroll.style.cssText = "flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px;min-height:220px;background:#0d0d10;";

                    const mkSectionTitle = (txt, color) => {
                        const d = document.createElement("div");
                        d.textContent = txt;
                        d.style.cssText = "font-size:13px;font-weight:600;color:" + (color || "#f4f4f5") + ";margin-bottom:4px;";
                        return d;
                    };
                    const dupBox = document.createElement("div");
                    dupBox.style.cssText = "min-height:72px;padding:12px;background:#18181c;border-radius:10px;border:1px solid rgba(255,255,255,0.08);";
                    dupBox.innerHTML = "<div style='color:#71717a;font-size:12px;'>点击右下角「开始检测」后显示：内容完全相同（SHA256 一致）的重复 LoRA。</div>";
                    const updBox = document.createElement("div");
                    updBox.style.cssText = "min-height:72px;padding:12px;background:#18181c;border-radius:10px;border:1px solid rgba(255,255,255,0.08);";
                    updBox.innerHTML = "<div style='color:#71717a;font-size:12px;'>点击右下角「检测 LoRA 更新」后，通过 SHA256 查询 Civitai，匹配到则对比本地版本与 Civitai 最新版本号，显示有更新的 LoRA。</div>";

                    bodyScroll.appendChild(mkSectionTitle("① 重复 LoRA（哈希相同）", "#fca5a5"));
                    bodyScroll.appendChild(dupBox);
                    bodyScroll.appendChild(mkSectionTitle("② LoRA 更新（Civitai）", "#6ee7b7"));
                    bodyScroll.appendChild(updBox);

                    const footer = document.createElement("div");
                    footer.style.cssText = "padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08);background:#151519;border-radius:0 0 14px 14px;display:flex;justify-content:flex-end;align-items:center;gap:10px;";

                    const dupBtn = document.createElement("button");
                    dupBtn.type = "button";
                    dupBtn.className = "ma-btn ma-btn-danger";
                    dupBtn.textContent = "🔍 检测重复 LoRA";

                    const updBtn = document.createElement("button");
                    updBtn.type = "button";
                    updBtn.className = "ma-btn ma-btn-primary";
                    updBtn.textContent = "🌐 检测 LoRA 更新";

                    const allBtn = document.createElement("button");
                    allBtn.type = "button";
                    allBtn.className = "ma-btn ma-btn-success";
                    allBtn.textContent = "🚀 全部检测";

                    const parseJsonResp = async (resp) => {
                        const status = resp.status;
                        const text = await resp.text();
                        try {
                            return text ? JSON.parse(text) : null;
                        } catch (je) {
                            const hint = (text || "").replace(/\s+/g, " ").trim().slice(0, 200);
                            throw new Error(
                                (je && je.message ? je.message : String(je)) +
                                (hint ? " · 响应开头: " + hint : "") +
                                " (HTTP " + status + ")"
                            );
                        }
                    };

                    const renderDupResults = (data) => {
                        if (!data || !data.ok) {
                            dupBox.innerHTML = "<div style='color:#f87171;font-size:12px;'>检测失败：" + (data && data.error ? data.error : "未知错误") + "</div>";
                            return;
                        }
                        const summary = "<div style='color:#71717a;font-size:11px;margin-bottom:8px;'>本次扫描：范围内 " + data.scoped_count + " 个 LoRA 路径，已读取 " + data.scanned + " 个文件。</div>";
                        dupBox.innerHTML = summary;
                        if (!data.duplicates || !data.duplicates.length) {
                            dupBox.innerHTML += "<div style='color:#6ee7b7;font-size:12px;'>未发现内容完全相同的重复文件。</div>";
                        } else {
                            data.duplicates.forEach(g => {
                                const div = document.createElement("div");
                                div.style.cssText = "margin-bottom:10px;padding:10px;background:rgba(239,68,68,0.08);border-radius:8px;border:1px solid rgba(239,68,68,0.25);border-left:3px solid #ef4444;";
                                const h = document.createElement("div");
                                h.style.cssText = "color:#fca5a5;font-size:11px;font-weight:600;margin-bottom:6px;word-break:break-all;";
                                h.textContent = "相同 SHA256 · " + (g.hash || "").slice(0, 24) + "…";
                                div.appendChild(h);
                                (g.files || []).forEach(f => {
                                    const row = document.createElement("div");
                                    row.style.cssText = "color:#d4d4d8;font-size:11px;padding:2px 0;word-break:break-all;";
                                    row.textContent = (f.path || "") + "  ·  " + fmtTime(f.mtime) + "  ·  " + fmtSize(f.size);
                                    div.appendChild(row);
                                });
                                dupBox.appendChild(div);
                            });
                        }
                    };

                    const renderUpdResults = (data) => {
                        if (!data || !data.ok) {
                            updBox.innerHTML = "<div style='color:#f87171;font-size:12px;'>检测失败：" + (data && data.error ? data.error : "未知错误") + "</div>";
                            return;
                        }
                        const summary = "<div style='color:#71717a;font-size:11px;margin-bottom:8px;'>本次扫描：范围内 " + data.scoped_count + " 个 LoRA 路径，已读取 " + data.scanned + " 个文件，查询 Civitai 中…</div>";
                        updBox.innerHTML = summary;
                        if (!data.updates || !data.updates.length) {
                            updBox.innerHTML += "<div style='color:#6ee7b7;font-size:12px;'>所有 LoRA 都已是 Civitai 上的最新版本，或无法在 Civitai 找到匹配记录。</div>";
                        } else {
                            data.updates.forEach(u => {
                                const div = document.createElement("div");
                                div.style.cssText = "margin-bottom:10px;padding:10px;background:rgba(16,185,129,0.08);border-radius:8px;border:1px solid rgba(16,185,129,0.25);border-left:3px solid #10b981;";
                                const t = document.createElement("div");
                                t.style.cssText = "color:#6ee7b7;font-size:11px;font-weight:600;margin-bottom:4px;word-break:break-all;";
                                const lat = (u.latest_label && String(u.latest_label).trim()) ? String(u.latest_label).trim() : ("v" + u.latest_version);
                                const locv = (u.local_label && String(u.local_label).trim()) ? String(u.local_label).trim() : ("v" + u.local_version);
                                t.textContent = (u.model_name || u.path) + "  ·  Civitai 最新: " + lat;
                                div.appendChild(t);
                                const loc = document.createElement("div");
                                loc.style.cssText = "color:#e4e4e7;font-size:11px;margin-bottom:4px;";
                                let locText = "本地版本: " + locv + "  ·  文件: " + u.path;
                                if (u.local_base_model) locText += "  ·  Base: " + u.local_base_model;
                                loc.textContent = locText;
                                div.appendChild(loc);
                                if (u.model_url) {
                                    const lnk = document.createElement("a");
                                    lnk.href = u.model_url;
                                    lnk.target = "_blank";
                                    lnk.style.cssText = "color:#818cf8;font-size:11px;text-decoration:none;font-weight:500;";
                                    lnk.textContent = "在 Civitai 查看 →";
                                    div.appendChild(lnk);
                                }
                                updBox.appendChild(div);
                            });
                        }
                    };

                    const setLoading = (btn, label, loading) => {
                        btn.disabled = loading;
                        btn.textContent = loading ? "处理中…" : label;
                        btn.style.opacity = loading ? "0.7" : "1";
                    };

                    dupBtn.onclick = async () => {
                        setLoading(dupBtn, "🔍 检测重复 LoRA", true);
                        try {
                            const r = await api.fetchApi("/ma/lora/detect_scan", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    scope: showAllMode ? "all" : "folder",
                                    path: currentPath,
                                }),
                            });
                            renderDupResults(await parseJsonResp(r));
                        } catch (err) {
                            renderDupResults({ ok: false, error: String(err) });
                        } finally {
                            setLoading(dupBtn, "🔍 检测重复 LoRA", false);
                        }
                    };

                    updBtn.onclick = async () => {
                        setLoading(updBtn, "🌐 检测 LoRA 更新", true);
                        try {
                            const r = await api.fetchApi("/ma/lora/update_check", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    scope: showAllMode ? "all" : "folder",
                                    path: currentPath,
                                }),
                            });
                            renderUpdResults(await parseJsonResp(r));
                        } catch (err) {
                            renderUpdResults({ ok: false, error: String(err) });
                        } finally {
                            setLoading(updBtn, "🌐 检测 LoRA 更新", false);
                        }
                    };

                    allBtn.onclick = async () => {
                        setLoading(allBtn, "🚀 全部检测", true);
                        dupBtn.disabled = true;
                        updBtn.disabled = true;
                        dupBox.innerHTML = "<div style='color:#888;font-size:12px;'>检测中…</div>";
                        updBox.innerHTML = "<div style='color:#888;font-size:12px;'>检测中…</div>";
                        try {
                            const [dupRes, updRes] = await Promise.all([
                                api.fetchApi("/ma/lora/detect_scan", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        scope: showAllMode ? "all" : "folder",
                                        path: currentPath,
                                    }),
                                }),
                                api.fetchApi("/ma/lora/update_check", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        scope: showAllMode ? "all" : "folder",
                                        path: currentPath,
                                    }),
                                }),
                            ]);
                            try {
                                renderDupResults(await parseJsonResp(dupRes));
                            } catch (e) {
                                dupBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>重复检测失败：" + e + "</div>";
                            }
                            try {
                                renderUpdResults(await parseJsonResp(updRes));
                            } catch (e) {
                                updBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>更新检测失败：" + e + "</div>";
                            }
                        } catch (err) {
                            dupBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>检测失败：" + err + "</div>";
                            updBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>检测失败：" + err + "</div>";
                        } finally {
                            setLoading(allBtn, "🚀 全部检测", false);
                            dupBtn.disabled = false;
                            updBtn.disabled = false;
                        }
                    };

                    footer.appendChild(dupBtn);
                    footer.appendChild(updBtn);
                    footer.appendChild(allBtn);

                    dialog.appendChild(header);
                    dialog.appendChild(pathBar);
                    dialog.appendChild(scopeHint);
                    dialog.appendChild(folderRow);
                    dialog.appendChild(bodyScroll);
                    dialog.appendChild(footer);
                    document.body.appendChild(dialog);

                    updateScopeUI();

                    // 拖拽实现：与 magic_resolution.js 完全一致的策略
                    // 初始居中用 top/left + transform，拖动时切 top/left，不碰 transform
                    let isDragging = false;
                    let offsetX = 0;
                    let offsetY = 0;
                    let hasMovedToFixed = false; // 只在首次拖动时切换一次

                    const dragStart = (e) => {
                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                            e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                            return;
                        }
                        const rect = dialog.getBoundingClientRect();
                        let mouseX, mouseY;
                        if (e.type === "mousedown") {
                            mouseX = e.clientX;
                            mouseY = e.clientY;
                        } else if (e.type === "touchstart") {
                            mouseX = e.touches[0].clientX;
                            mouseY = e.touches[0].clientY;
                        } else {
                            return;
                        }
                        offsetX = mouseX - rect.left;
                        offsetY = mouseY - rect.top;
                        isDragging = true;
                        e.preventDefault();
                    };

                    const drag = (e) => {
                        if (!isDragging) return;
                        e.preventDefault();
                        let mouseX, mouseY;
                        if (e.type === "mousemove") {
                            mouseX = e.clientX;
                            mouseY = e.clientY;
                        } else if (e.type === "touchmove") {
                            mouseX = e.touches[0].clientX;
                            mouseY = e.touches[0].clientY;
                        } else {
                            return;
                        }
                        let newX = mouseX - offsetX;
                        let newY = mouseY - offsetY;

                        const minX = 0;
                        const minY = 0;
                        const maxX = window.innerWidth - dialog.offsetWidth;
                        const maxY = window.innerHeight - dialog.offsetHeight;
                        newX = Math.max(minX, Math.min(newX, maxX));
                        newY = Math.max(minY, Math.min(newY, maxY));

                        // 首次拖动：从居中 transform 切换到 top/left 定位（只执行一次）
                        if (!hasMovedToFixed) {
                            hasMovedToFixed = true;
                            dialog.style.transform = '';
                            dialog.style.top = newY + 'px';
                            dialog.style.left = newX + 'px';
                        } else {
                            dialog.style.top = newY + 'px';
                            dialog.style.left = newX + 'px';
                        }
                    };

                    const dragEnd = () => {
                        isDragging = false;
                    };

                    header.addEventListener("mousedown", dragStart);
                    header.addEventListener("touchstart", dragStart);
                    document.addEventListener("mousemove", drag);
                    document.addEventListener("touchmove", drag);
                    document.addEventListener("mouseup", dragEnd);
                    document.addEventListener("touchend", dragEnd);

                    const escHandler = (e) => {
                        if (e.key !== "Escape" || !dialog.parentNode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        closeDetectModal();
                    };
                    const closeDetectModal = () => {
                        document.removeEventListener("keydown", escHandler, true);
                        document.removeEventListener("mousemove", drag);
                        document.removeEventListener("touchmove", drag);
                        document.removeEventListener("mouseup", dragEnd);
                        document.removeEventListener("touchend", dragEnd);
                        if (dialog.parentNode) document.body.removeChild(dialog);
                    };
                    closeX.onclick = () => closeDetectModal();
                    document.addEventListener("keydown", escHandler, true);
                } catch (e) {
                    void mplAlert("LoRA 检测: " + e);
                }
            };

            nodeType.prototype.saveFolderPreset = async function(folder) {
                const name = await mplAsk("保存为预设", folder.name, { message: "预设名称：" });
                if(!name || !name.trim()) return;
                try {
                    await api.fetchApi("/ma/lora/save_preset", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: name.trim(), content: { folders: [folder] } })
                    });
                    await mplLoadSidebar(true);
                    mplRefreshAllSidebars();
                    void mplAlert("预设已保存");
                } catch(e) { void mplAlert(String(e)); }
            };

            nodeType.prototype.showSettingsModal = function(initialTab = "mode") {
                // 从节点 / 属性 / 隐藏 widget 读取并归一化（避免 adaptive_mode 为字符串 "false" 时 !this.adaptiveMode 误判）
                const parseAdaptive = (v) => v === true || v === "true" || v === 1;
                const sdnqRaw = this.sdnqMode ?? this.properties["sdnq_mode"] ?? this._sdnqModeWidget?.value ?? "none";
                const kleinRaw = this.kleinMode ?? this.properties["klein_mode"] ?? this._kleinModeWidget?.value ?? "auto";
                const adaptiveRaw = this.adaptiveMode ?? this.properties["adaptive_mode"] ?? this._adaptiveModeWidget?.value;
                const animaRaw = this.animaMode ?? this.properties["anima_mode"] ?? this._animaModeWidget?.value ?? "none";
                const currentAnimaMode = String(animaRaw || "none").toLowerCase();
                const currentSdnqMode = String(sdnqRaw || "none").toLowerCase();
                const currentKleinMode = String(kleinRaw || "auto").toLowerCase();
                const isAdaptive = parseAdaptive(adaptiveRaw);
                const sdnqOn = currentSdnqMode === "sdnq";
                const kleinOn = currentKleinMode === "klein";
                // 与确定按钮逻辑一致：自适应 > Klein > SDNQ > 默认（标准，与官方 LoraLoader 一致）
                // 注：ComfyUI 官方已在 model_patcher.py 提供 INT8/FP8 等量化权重的 LoRA 支持，
                // 因此本加载器不再需要专门的 INT8 模式选项，默认即可处理 INT8 模型。
                let primaryMode = "default";
                if (isAdaptive) primaryMode = "adaptive";
                else if (kleinOn) primaryMode = "klein";
                else if (sdnqOn) primaryMode = "sdnq";
                else if (currentAnimaMode === "anima") primaryMode = "anima";
                
                // 关闭已存在的悬浮设置窗口，避免重复堆叠
                document.querySelectorAll(".mpl-settings-floating").forEach(el => {
                    try { el.__mplCleanup?.(); } catch (e) { el.remove(); }
                });

                let _spos = null;
                try { _spos = JSON.parse(localStorage.getItem("MA_SETTINGS_WIN") || "null"); } catch (e) { _spos = null; }
                let _sw = Math.min(580, Math.round(window.innerWidth * 0.94));
                let _sh = Math.min(680, Math.round(window.innerHeight * 0.85));
                let _sl = Math.max(16, Math.round(window.innerWidth / 2 - _sw / 2));
                let _st = Math.max(16, Math.round(window.innerHeight / 2 - _sh / 2));
                if (_spos && typeof _spos.w === "number" && typeof _spos.left === "number") {
                    _sw = Math.max(460, Math.min(_spos.w, window.innerWidth - 24));
                    _sh = Math.max(360, Math.min(_spos.h, window.innerHeight - 24));
                    _sl = Math.max(0, Math.min(_spos.left, window.innerWidth - 120));
                    _st = Math.max(0, Math.min(_spos.top, window.innerHeight - 80));
                }

                // 无全屏遮罩悬浮设置窗，可边改设置边查看/操作画布
                const dialog = document.createElement("div");
                dialog.className = "ma-modal mpl-settings-floating";
                dialog.tabIndex = -1;
                dialog.style.cssText = `
                    position: fixed;
                    top: ${_st}px;
                    left: ${_sl}px;
                    padding: 0;
                    width: ${_sw}px;
                    height: ${_sh}px;
                    min-width: min(460px, 94vw);
                    min-height: 360px;
                    max-width: 96vw;
                    max-height: 92vh;
                    resize: both;
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    outline: none;
                `;
                dialog.__maSaveWinPos = () => {
                    try {
                        const r = dialog.getBoundingClientRect();
                        localStorage.setItem("MA_SETTINGS_WIN", JSON.stringify({ left: r.left, top: r.top, w: r.width, h: r.height }));
                    } catch (e) {}
                };

                // 标题栏（可拖拽，带右上角关闭按钮）
                const title = document.createElement("div");
                title.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    font-size: 15px;
                    font-weight: 650;
                    color: #f4f4f5;
                    padding: 12px 16px 12px 20px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    cursor: move;
                    user-select: none;
                    background: #151519;
                    flex-shrink: 0;
                `;
                const titleText = document.createElement("span");
                titleText.textContent = "设置";
                const closeX = document.createElement("button");
                closeX.type = "button";
                closeX.textContent = "✕";
                closeX.style.cssText = "width:26px;height:26px;padding:0;border-radius:7px;border:1px solid transparent;background:transparent;color:#a1a1aa;cursor:pointer;font-size:14px;";
                closeX.onmouseenter = () => { closeX.style.background = "#222228"; closeX.style.color = "#f4f4f5"; };
                closeX.onmouseleave = () => { closeX.style.background = "transparent"; closeX.style.color = "#a1a1aa"; };
                closeX.addEventListener("pointerdown", (e) => e.stopPropagation());
                title.append(titleText, closeX);

                // Tab 切换栏
                const tabBar = document.createElement("div");
                tabBar.style.cssText = `
                    display: flex;
                    background: #111114;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    padding: 0 12px;
                    flex-shrink: 0;
                `;
                const tabButtons = {};
                const tabContents = {};
                const tabDefs = [
                    { id: "mode", label: "模式切换" },
                    { id: "layout", label: "布局样式" },
                ];
                let currentTab = initialTab === "layout" ? "layout" : "mode";
                tabDefs.forEach((tab) => {
                    const btn = document.createElement("button");
                    btn.textContent = tab.label;
                    btn.dataset.tab = tab.id;
                    const active = currentTab === tab.id;
                    btn.style.cssText = `
                        flex: 1;
                        padding: 10px 16px;
                        background: transparent;
                        border: none;
                        border-bottom: 2px solid ${active ? "#6366f1" : "transparent"};
                        color: ${active ? "#f4f4f5" : "#a1a1aa"};
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: ${active ? "600" : "500"};
                        transition: all 0.15s;
                    `;
                    btn.onmouseenter = () => {
                        if (currentTab !== tab.id) btn.style.color = "#e4e4e7";
                    };
                    btn.onmouseleave = () => {
                        if (currentTab !== tab.id) btn.style.color = "#a1a1aa";
                    };
                    btn.onclick = () => {
                        currentTab = tab.id;
                        tabDefs.forEach((t) => {
                            const b = tabButtons[t.id];
                            const c = tabContents[t.id];
                            const isActive = t.id === currentTab;
                            b.style.borderBottomColor = isActive ? "#6366f1" : "transparent";
                            b.style.color = isActive ? "#f4f4f5" : "#a1a1aa";
                            b.style.fontWeight = isActive ? "600" : "500";
                            c.style.display = isActive ? "block" : "none";
                        });
                    };
                    tabButtons[tab.id] = btn;
                    tabBar.appendChild(btn);
                });

                // 内容区域（可滚动）
                const content = document.createElement("div");
                content.style.cssText = "flex: 1; overflow-y: auto; padding: 18px 20px; min-height: 0; background: #111114;";

                // 按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.style.cssText = "display: flex; gap: 10px; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; background: #151519;";

                // 设置项容器
                const settingsContainer = document.createElement("div");
                settingsContainer.style.cssText = "display: flex; flex-direction: column; gap: 20px;";
                
                // ========== LoRA 加载模式 ==========
                const defaultSection = document.createElement("div");
                defaultSection.style.cssText = "display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px;";

                const defaultTitle = document.createElement("div");
                defaultTitle.textContent = "LoRA 加载模式";
                defaultTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                    margin-bottom: 4px;
                `;

                const defaultModeContainer = document.createElement("div");
                defaultModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                const optionCardIdleCss = "display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 11px 14px; background: #18181c; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); transition: all 0.15s;";

                // 自适应模式（单选按钮，排在最前面）
                const adaptiveMode = document.createElement("label");
                adaptiveMode.style.cssText = optionCardIdleCss;
                const radioAdaptive = document.createElement("input");
                radioAdaptive.type = "radio";
                radioAdaptive.name = "global_mode";
                radioAdaptive.value = "adaptive";
                radioAdaptive.checked = primaryMode === "adaptive";
                radioAdaptive.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #10b981;";
                const labelAdaptive = document.createElement("div");
                labelAdaptive.style.cssText = "flex: 1;";
                const labelAdaptiveTitle = document.createElement("div");
                labelAdaptiveTitle.textContent = "自适应模式";
                labelAdaptiveTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                const labelAdaptiveDesc = document.createElement("div");
                labelAdaptiveDesc.textContent = "自动检测模型类型并选择合适的加载模式（Klein→Nunchaku 原生 API，SDNQ→SDNQ，普通→标准；INT8/FP8 等量化模型走标准模式，由 ComfyUI 官方 model_patcher 自动处理）";
                labelAdaptiveDesc.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                labelAdaptive.appendChild(labelAdaptiveTitle);
                labelAdaptive.appendChild(labelAdaptiveDesc);
                adaptiveMode.appendChild(radioAdaptive);
                adaptiveMode.appendChild(labelAdaptive);
                defaultModeContainer.appendChild(adaptiveMode);

                // 默认模式（标准 LoRA）
                const defaultMode = document.createElement("label");
                defaultMode.style.cssText = optionCardIdleCss;
                const radioDefault = document.createElement("input");
                radioDefault.type = "radio";
                radioDefault.name = "global_mode";
                radioDefault.value = "default";
                radioDefault.checked = primaryMode === "default";
                radioDefault.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1;";
                const labelDefault = document.createElement("div");
                labelDefault.style.cssText = "flex: 1;";
                const labelDefaultTitle = document.createElement("div");
                labelDefaultTitle.textContent = "默认模式（标准 LoRA）";
                labelDefaultTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                const labelDefaultDesc = document.createElement("div");
                labelDefaultDesc.textContent = "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型（官方 model_patcher.py 已原生支持 INT8/FP8/INT4 等量化权重的 LoRA 应用）";
                labelDefaultDesc.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                labelDefault.appendChild(labelDefaultTitle);
                labelDefault.appendChild(labelDefaultDesc);
                defaultMode.appendChild(radioDefault);
                defaultMode.appendChild(labelDefault);
                defaultModeContainer.appendChild(defaultMode);

                // 模式选中状态更新
                const updateModeSelection = () => {
                    // 自适应模式
                    if (radioAdaptive.checked) {
                        adaptiveMode.style.borderColor = "rgba(16, 185, 129, 0.55)";
                        adaptiveMode.style.background = "rgba(16, 185, 129, 0.1)";
                    } else {
                        adaptiveMode.style.borderColor = "rgba(255, 255, 255, 0.08)";
                        adaptiveMode.style.background = "#18181c";
                    }
                    // 默认模式
                    if (radioDefault.checked) {
                        defaultMode.style.borderColor = "rgba(99, 102, 241, 0.6)";
                        defaultMode.style.background = "rgba(99, 102, 241, 0.12)";
                    } else {
                        defaultMode.style.borderColor = "rgba(255, 255, 255, 0.08)";
                        defaultMode.style.background = "#18181c";
                    }
                };

                // 选中自适应模式时，取消其他模式
                radioAdaptive.addEventListener("change", () => {
                    updateModeSelection();
                    if (radioAdaptive.checked) {
                        radioSdnqSdnq.checked = false;
                        radioKleinKlein.checked = false;
                        if (radioAnima) radioAnima.checked = false;
                        if (typeof updateAnimaSelection === "function") updateAnimaSelection();
                        updateSdnqSelection();
                        updateKleinSelection();
                    }
                });

                // 选中默认模式时，取消其他模式
                radioDefault.addEventListener("change", () => {
                    updateModeSelection();
                    if (radioDefault.checked) {
                        radioSdnqSdnq.checked = false;
                        radioKleinKlein.checked = false;
                        if (radioAnima) radioAnima.checked = false;
                        if (typeof updateAnimaSelection === "function") updateAnimaSelection();
                        updateSdnqSelection();
                        updateKleinSelection();
                    }
                });
                updateModeSelection();

                defaultSection.appendChild(defaultTitle);
                defaultSection.appendChild(defaultModeContainer);
                settingsContainer.appendChild(defaultSection);

                // 注意：ComfyUI 官方已在 model_patcher.py 提供 INT8/FP8 等量化权重的 LoRA 支持
                // （apply_loras 后调用 comfy.float.stochastic_rounding 把权重舍入到 weight.dtype），
                // 因此本加载器不再需要专门的 INT8 模式选项，默认模式即可正确加载 INT8 LoRA。

                // ========== tonera-Klein-Nunchaku 模式设置区域 ==========
                const kleinSection = document.createElement("div");
                kleinSection.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                const kleinTitle = document.createElement("div");
                kleinTitle.textContent = "tonera-Klein-Nunchaku LoRA 模式";
                kleinTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                `;

                const kleinDesc = document.createElement("div");
                kleinDesc.textContent = "专用于 tonera/FLUX.2-klein-9B-Nunchaku 量化模型的原生 LoRA 加载（普通 Klein 模型请用默认模式）";
                kleinDesc.style.cssText = `
                    font-size: 11.5px;
                    color: #a1a1aa;
                    margin-bottom: 4px;
                    line-height: 1.45;
                `;

                const kleinModeContainer = document.createElement("div");
                kleinModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                // tonera-Klein-Nunchaku 模式（选中时激活）
                const kleinModeKlein = document.createElement("label");
                kleinModeKlein.style.cssText = optionCardIdleCss;
                const radioKleinKlein = document.createElement("input");
                radioKleinKlein.type = "radio";
                radioKleinKlein.name = "klein_mode";
                radioKleinKlein.value = "klein";
                radioKleinKlein.checked = primaryMode === "klein";
                radioKleinKlein.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1;";
                const labelKleinKlein = document.createElement("div");
                labelKleinKlein.style.cssText = "flex: 1;";
                const labelKleinKleinTitle = document.createElement("div");
                labelKleinKleinTitle.textContent = "tonera-Klein-Nunchaku 模式";
                labelKleinKleinTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                const labelKleinKleinDesc = document.createElement("div");
                labelKleinKleinDesc.textContent = "使用 Nunchaku 原生 LoRA API（update_lora_params）加载 tonera FLUX.2-klein-9B-Nunchaku 专用 LoRA";
                labelKleinKleinDesc.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                labelKleinKlein.appendChild(labelKleinKleinTitle);
                labelKleinKlein.appendChild(labelKleinKleinDesc);
                kleinModeKlein.appendChild(radioKleinKlein);
                kleinModeKlein.appendChild(labelKleinKlein);

                // Klein 模式选中状态更新
                const updateKleinSelection = () => {
                    [kleinModeKlein].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "rgba(99, 102, 241, 0.6)";
                            mode.style.background = "rgba(99, 102, 241, 0.12)";
                        } else {
                            mode.style.borderColor = "rgba(255, 255, 255, 0.08)";
                            mode.style.background = "#18181c";
                        }
                    });
                };

                radioKleinKlein.addEventListener("change", () => {
                    updateKleinSelection();
                    // 选择 Klein 模式时取消其他特殊模式
                    if (radioKleinKlein.checked) {
                        radioAdaptive.checked = false;
                        radioDefault.checked = false;
                        radioSdnqSdnq.checked = false;
                        if (radioAnima) radioAnima.checked = false;
                        if (typeof updateAnimaSelection === "function") updateAnimaSelection();
                        updateModeSelection();
                        updateSdnqSelection();
                    }
                });
                updateKleinSelection();

                kleinModeContainer.appendChild(kleinModeKlein);

                kleinSection.appendChild(kleinTitle);
                kleinSection.appendChild(kleinDesc);
                kleinSection.appendChild(kleinModeContainer);

                settingsContainer.appendChild(kleinSection);

                // ========== SDNQ 模式设置区域 ==========
                const sdnqSection = document.createElement("div");
                sdnqSection.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                const sdnqTitle = document.createElement("div");
                sdnqTitle.textContent = "SDNQ LoRA 模式";
                sdnqTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                `;

                const sdnqDesc = document.createElement("div");
                sdnqDesc.textContent = "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式";
                sdnqDesc.style.cssText = `
                    font-size: 11.5px;
                    color: #a1a1aa;
                    margin-bottom: 4px;
                    line-height: 1.45;
                `;

                // SDNQ 模式选择容器
                const sdnqModeContainer = document.createElement("div");
                sdnqModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                // SDNQ 模式
                const sdnqModeSdnq = document.createElement("label");
                sdnqModeSdnq.style.cssText = optionCardIdleCss;
                const radioSdnqSdnq = document.createElement("input");
                radioSdnqSdnq.type = "radio";
                radioSdnqSdnq.name = "sdnq_mode";
                radioSdnqSdnq.value = "sdnq";
                radioSdnqSdnq.checked = primaryMode === "sdnq";
                radioSdnqSdnq.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1;";
                const labelSdnqSdnq = document.createElement("div");
                labelSdnqSdnq.style.cssText = "flex: 1;";
                const labelSdnqSdnqTitle = document.createElement("div");
                labelSdnqSdnqTitle.textContent = "SDNQ 模式";
                labelSdnqSdnqTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                const labelSdnqSdnqDesc = document.createElement("div");
                labelSdnqSdnqDesc.textContent = "使用 diffusers PEFT adapter 系统加载 LoRA，支持多个 LoRA 并行应用，适用于 SDNQ 量化模型（DiffusionPipeline）";
                labelSdnqSdnqDesc.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                labelSdnqSdnq.appendChild(labelSdnqSdnqTitle);
                labelSdnqSdnq.appendChild(labelSdnqSdnqDesc);
                sdnqModeSdnq.appendChild(radioSdnqSdnq);
                sdnqModeSdnq.appendChild(labelSdnqSdnq);

                // SDNQ 模式选中状态更新
                const updateSdnqSelection = () => {
                    [sdnqModeSdnq].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "rgba(99, 102, 241, 0.6)";
                            mode.style.background = "rgba(99, 102, 241, 0.12)";
                        } else {
                            mode.style.borderColor = "rgba(255, 255, 255, 0.08)";
                            mode.style.background = "#18181c";
                        }
                    });
                };

                radioSdnqSdnq.addEventListener("change", () => {
                    updateSdnqSelection();
                    // 选择 SDNQ 模式时，取消默认模式、Klein 模式和 Anima 模式
                    if (radioSdnqSdnq.checked) {
                        radioAdaptive.checked = false;
                        radioDefault.checked = false;
                        radioKleinKlein.checked = false;
                        if (radioAnima) radioAnima.checked = false;
                        if (typeof updateAnimaSelection === "function") updateAnimaSelection();
                        updateModeSelection();
                        updateKleinSelection();
                    }
                });
                updateSdnqSelection();

                sdnqModeContainer.appendChild(sdnqModeSdnq);

                sdnqSection.appendChild(sdnqTitle);
                sdnqSection.appendChild(sdnqDesc);
                sdnqSection.appendChild(sdnqModeContainer);

                settingsContainer.appendChild(sdnqSection);

                // ========== Anima 2.9B LoRA 模式设置区域（与 Klein/SDNQ 互斥，仅标准加载路径生效） ==========
                const animaSection = document.createElement("div");
                animaSection.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                const animaTitle = document.createElement("div");
                animaTitle.textContent = "Anima 2.9B LoRA 模式";
                animaTitle.style.cssText = `
                    font-size: 13px;
                    font-weight: 600;
                    color: #f4f4f5;
                `;

                const animaDesc = document.createElement("div");
                animaDesc.textContent = "专用于 Anima 2.9B（40 层）模型加载旧版 28 层 Anima LoRA：标准加载路径下自动在内存中暂存重映射（28→40 层），不写盘、不改原文件、不新增文件";
                animaDesc.style.cssText = `
                    font-size: 11.5px;
                    color: #a1a1aa;
                    margin-bottom: 4px;
                    line-height: 1.45;
                `;

                const animaModeContainer = document.createElement("div");
                animaModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                // Anima 2.9B 模式（选中时激活，与 Klein/SDNQ 互斥）
                const animaModeAnima = document.createElement("label");
                animaModeAnima.style.cssText = optionCardIdleCss;
                const radioAnima = document.createElement("input");
                radioAnima.type = "radio";
                radioAnima.name = "anima_mode";
                radioAnima.value = "anima";
                radioAnima.checked = currentAnimaMode === "anima";
                radioAnima.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #a855f7;";
                const labelAnima = document.createElement("div");
                labelAnima.style.cssText = "flex: 1;";
                const labelAnimaTitle = document.createElement("div");
                labelAnimaTitle.textContent = "Anima 2.9B 模式";
                labelAnimaTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                const labelAnimaDesc = document.createElement("div");
                labelAnimaDesc.textContent = "标准加载路径下自动把 28 层 Anima LoRA 重映射为 40 层（仅对 Anima LoRA 生效，其他 LoRA 原样加载）";
                labelAnimaDesc.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                labelAnima.appendChild(labelAnimaTitle);
                labelAnima.appendChild(labelAnimaDesc);
                animaModeAnima.appendChild(radioAnima);
                animaModeAnima.appendChild(labelAnima);

                // Anima 模式选中状态更新
                const updateAnimaSelection = () => {
                    [animaModeAnima].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "rgba(168, 85, 247, 0.55)";
                            mode.style.background = "rgba(168, 85, 247, 0.12)";
                        } else {
                            mode.style.borderColor = "rgba(255, 255, 255, 0.08)";
                            mode.style.background = "#18181c";
                        }
                    });
                };

                radioAnima.addEventListener("change", () => {
                    updateAnimaSelection();
                    if (radioAnima.checked) {
                        radioAdaptive.checked = false;
                        radioDefault.checked = false;
                        radioKleinKlein.checked = false;
                        radioSdnqSdnq.checked = false;
                        updateModeSelection();
                        updateKleinSelection();
                        updateSdnqSelection();
                    }
                });
                updateAnimaSelection();

                animaModeContainer.appendChild(animaModeAnima);

                animaSection.appendChild(animaTitle);
                animaSection.appendChild(animaDesc);
                animaSection.appendChild(animaModeContainer);

                settingsContainer.appendChild(animaSection);

                // ========== 模式切换 Tab 内容 ==========
                const modeTabContent = document.createElement("div");
                modeTabContent.style.cssText = currentTab === "mode" ? "display: block;" : "display: none;";
                modeTabContent.appendChild(settingsContainer);
                tabContents["mode"] = modeTabContent;

                // ========== 布局样式 Tab 内容 ==========
                const layoutTabContent = document.createElement("div");
                layoutTabContent.style.cssText = currentTab === "layout" ? "display: block;" : "display: none;";
                tabContents["layout"] = layoutTabContent;

                const layoutContainer = document.createElement("div");
                layoutContainer.style.cssText = "display: flex; flex-direction: column; gap: 16px;";

                const layoutTitle = document.createElement("div");
                layoutTitle.textContent = "权重控件样式";
                layoutTitle.style.cssText = "font-size: 13px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;";
                const layoutDesc = document.createElement("div");
                layoutDesc.textContent = "选择 LoRA 列表中权重调节控件的样式。滑条模式下可直接拖动调整权重，数值仍可点击编辑。";
                layoutDesc.style.cssText = "font-size: 11.5px; color: #a1a1aa; margin-bottom: 8px; line-height: 1.45;";

                const styleSection = document.createElement("div");
                styleSection.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

                const buildStyleOption = (value, label, desc) => {
                    const wrap = document.createElement("label");
                    wrap.style.cssText = optionCardIdleCss;
                    const radio = document.createElement("input");
                    radio.type = "radio";
                    radio.name = "mpl_weight_style";
                    radio.value = value;
                    radio.checked = (this.layoutSettings?.weightStyle || "arrows") === value;
                    radio.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1;";
                    const info = document.createElement("div");
                    info.style.cssText = "flex: 1;";
                    const t = document.createElement("div");
                    t.textContent = label;
                    t.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600;";
                    const d = document.createElement("div");
                    d.textContent = desc;
                    d.style.cssText = "color: #a1a1aa; font-size: 11.5px; margin-top: 3px; line-height: 1.45;";
                    info.appendChild(t);
                    info.appendChild(d);
                    wrap.appendChild(radio);
                    wrap.appendChild(info);
                    return { wrap, radio };
                };

                const styleArrows = buildStyleOption("arrows", "箭头按钮（默认）", "左右两个箭头按钮，每次点击 ±0.01；中间数字可点击直接输入。");
                const styleSlider = buildStyleOption("slider", "滑条", "水平滑条拖动调整权重；右侧显示当前数值，数值仍可点击编辑。");
                styleSection.appendChild(styleArrows.wrap);
                styleSection.appendChild(styleSlider.wrap);

                const sliderParamsSection = document.createElement("div");
                sliderParamsSection.style.cssText = "display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #18181c; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);";

                const sliderParamsTitle = document.createElement("div");
                sliderParamsTitle.textContent = "滑条参数";
                sliderParamsTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600; margin-bottom: 2px;";
                sliderParamsSection.appendChild(sliderParamsTitle);

                const buildNumberRow = (labelText, key, min, max, step) => {
                    const row = document.createElement("div");
                    row.style.cssText = "display: flex; align-items: center; gap: 10px;";
                    const lab = document.createElement("div");
                    lab.textContent = labelText;
                    lab.style.cssText = "color: #d4d4d8; font-size: 12px; min-width: 90px;";
                    const input = document.createElement("input");
                    input.type = "number";
                    input.className = "ma-input";
                    input.min = String(min);
                    input.max = String(max);
                    input.step = String(step);
                    input.value = String(this.layoutSettings?.[key] ?? 0);
                    input.style.cssText = "flex: 1; padding: 6px 10px; font-size: 12px;";
                    row.appendChild(lab);
                    row.appendChild(input);
                    return { row, input };
                };

                const stepRow = buildNumberRow("步长", "sliderStep", 0.01, 1, 0.01);
                const minRow = buildNumberRow("最小值", "sliderMin", -10, 0, 0.1);
                const maxRow = buildNumberRow("最大值", "sliderMax", 0, 10, 0.1);
                const widthRow = buildNumberRow("滑条宽度(px)", "sliderWidth", 60, 300, 5);
                sliderParamsSection.appendChild(stepRow.row);
                sliderParamsSection.appendChild(minRow.row);
                sliderParamsSection.appendChild(maxRow.row);
                sliderParamsSection.appendChild(widthRow.row);

                const buildCheckboxRow = (labelText, key, defaultValue = true) => {
                    const row = document.createElement("label");
                    row.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0;";
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = this.layoutSettings?.[key] ?? defaultValue;
                    cb.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
                    const lab = document.createElement("div");
                    lab.textContent = labelText;
                    lab.style.cssText = "color: #d4d4d8; font-size: 12px;";
                    row.appendChild(cb);
                    row.appendChild(lab);
                    return { row, cb };
                };
                const showValueRow = buildCheckboxRow("滑条旁显示当前数值", "showWeightValue", true);
                const snapRow = buildCheckboxRow("拖动时吸附 0（±0.02 范围内）", "snapToZero", true);
                sliderParamsSection.appendChild(showValueRow.row);
                sliderParamsSection.appendChild(snapRow.row);

                // 列表显示开关（CLIP 权重列 & 作者推荐权重标签）
                const displaySection = document.createElement("div");
                displaySection.style.cssText = "display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: #18181c; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);";
                const displayTitle = document.createElement("div");
                displayTitle.textContent = "列表显示";
                displayTitle.style.cssText = "color: #f4f4f5; font-size: 13px; font-weight: 600; margin-bottom: 2px;";
                const showClipRow = buildCheckboxRow("显示 CLIP 权重列（右键切换跟随/自定义，默认隐藏）", "__showClip", !(this.layoutSettings?.hideClip ?? true));
                showClipRow.cb.checked = !(this.layoutSettings?.hideClip ?? true);
                const showRecRow = buildCheckboxRow("显示作者推荐权重标签（存在推荐值时显示「荐」，单击套用）", "__showRec", !(this.layoutSettings?.hideRecWeight ?? false));
                showRecRow.cb.checked = !(this.layoutSettings?.hideRecWeight ?? false);
                displaySection.append(displayTitle, showClipRow.row, showRecRow.row);

                const updateStyleSelection = () => {
                    [styleArrows, styleSlider].forEach((s) => {
                        if (s.radio.checked) {
                            s.wrap.style.borderColor = "rgba(99, 102, 241, 0.6)";
                            s.wrap.style.background = "rgba(99, 102, 241, 0.12)";
                        } else {
                            s.wrap.style.borderColor = "rgba(255, 255, 255, 0.08)";
                            s.wrap.style.background = "#18181c";
                        }
                    });
                    sliderParamsSection.style.display = styleSlider.radio.checked ? "flex" : "none";
                };
                styleArrows.radio.addEventListener("change", updateStyleSelection);
                styleSlider.radio.addEventListener("change", updateStyleSelection);
                updateStyleSelection();

                layoutContainer.appendChild(layoutTitle);
                layoutContainer.appendChild(layoutDesc);
                layoutContainer.appendChild(styleSection);
                layoutContainer.appendChild(sliderParamsSection);
                layoutContainer.appendChild(displaySection);

                // ========== 主题配色与颜色预设（融合进布局样式 Tab） ==========
                const colorDivider = document.createElement("div");
                colorDivider.style.cssText = "height: 1px; background: rgba(255, 255, 255, 0.08); margin: 4px 0;";
                layoutContainer.appendChild(colorDivider);

                const DEF_LORA_COLOR = { selectBg: "#2b3b5e", selectBar: "#6366f1", selectText: "#eef1ff" };
                const DEF_FOLDER_COLOR = { outer: "#18181c", inner: "#222228", bar: "#6366f1" };
                const initCs = this.colorSettings || {};
                const initFs = this.folderColorSettings || {};
                let folderColorCustomized = !!(initFs.outer || initFs.inner || initFs.bar);

                const colorHeaderRow = document.createElement("div");
                colorHeaderRow.style.cssText = "display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;";
                const colorHeaderLeft = document.createElement("div");
                const colorTitle = document.createElement("div");
                colorTitle.textContent = "主题配色与预设";
                colorTitle.style.cssText = "font-size: 13px; font-weight: 600; color: #f4f4f5; margin-bottom: 3px;";
                const colorDesc = document.createElement("div");
                colorDesc.textContent = "点击预设卡片一键套用整套配色（LoRA 选中高亮 + 文件夹默认色），也可手动微调色值并另存为预设。";
                colorDesc.style.cssText = "font-size: 11.5px; color: #a1a1aa; line-height: 1.45;";
                colorHeaderLeft.appendChild(colorTitle);
                colorHeaderLeft.appendChild(colorDesc);

                const resetColorBtn = document.createElement("button");
                resetColorBtn.type = "button";
                resetColorBtn.textContent = "恢复默认配色";
                resetColorBtn.className = "ma-btn";
                resetColorBtn.style.cssText = "padding: 5px 10px; font-size: 11.5px; flex-shrink: 0; white-space: nowrap;";
                colorHeaderRow.appendChild(colorHeaderLeft);
                colorHeaderRow.appendChild(resetColorBtn);
                layoutContainer.appendChild(colorHeaderRow);

                // 实时预览与微调工作台卡片
                const colorStudioCard = document.createElement("div");
                colorStudioCard.style.cssText = "display: flex; flex-direction: column; gap: 12px; padding: 14px; background: #18181c; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08);";

                // 1) 实时效果预览框
                const livePreviewWrap = document.createElement("div");
                livePreviewWrap.style.cssText = "border-radius: 8px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); transition: all 0.15s;";
                const liveFolderHead = document.createElement("div");
                liveFolderHead.style.cssText = "padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; font-weight: 600; color: #f4f4f5;";
                const liveFolderTitle = document.createElement("span");
                liveFolderTitle.textContent = "📁 示例文件夹（默认配色预览）";
                const liveFolderBadge = document.createElement("span");
                liveFolderBadge.textContent = "2 个 LoRA";
                liveFolderBadge.style.cssText = "font-size: 10.5px; color: #a1a1aa; font-weight: 500; background: rgba(0,0,0,0.28); padding: 1px 6px; border-radius: 999px;";
                liveFolderHead.appendChild(liveFolderTitle);
                liveFolderHead.appendChild(liveFolderBadge);

                const liveFolderBody = document.createElement("div");
                liveFolderBody.style.cssText = "padding: 7px 8px; display: flex; flex-direction: column; gap: 5px;";
                const liveLoraSelected = document.createElement("div");
                liveLoraSelected.style.cssText = "padding: 6px 10px; border-radius: 6px; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; transition: all 0.15s;";
                const liveLoraSelectedName = document.createElement("span");
                liveLoraSelectedName.textContent = "✓ 示例 LoRA 模型（选中高亮状态）";
                const liveLoraSelectedWeight = document.createElement("span");
                liveLoraSelectedWeight.textContent = "1.00";
                liveLoraSelectedWeight.style.cssText = "font-size: 10.5px; opacity: 0.9; background: rgba(0,0,0,0.22); padding: 1px 6px; border-radius: 4px; font-variant-numeric: tabular-nums;";
                liveLoraSelected.appendChild(liveLoraSelectedName);
                liveLoraSelected.appendChild(liveLoraSelectedWeight);

                const liveLoraIdle = document.createElement("div");
                liveLoraIdle.style.cssText = "padding: 5px 10px; border-radius: 6px; font-size: 11px; color: #a1a1aa; background: rgba(255,255,255,0.03); border-left: 3px solid transparent; display: flex; align-items: center; justify-content: space-between;";
                const liveLoraIdleName = document.createElement("span");
                liveLoraIdleName.textContent = "○ 普通 LoRA 模型（未选中状态）";
                const liveLoraIdleWeight = document.createElement("span");
                liveLoraIdleWeight.textContent = "0.75";
                liveLoraIdleWeight.style.cssText = "font-size: 10.5px; color: #71717a; font-variant-numeric: tabular-nums;";
                liveLoraIdle.appendChild(liveLoraIdleName);
                liveLoraIdle.appendChild(liveLoraIdleWeight);

                liveFolderBody.appendChild(liveLoraSelected);
                liveFolderBody.appendChild(liveLoraIdle);
                livePreviewWrap.appendChild(liveFolderHead);
                livePreviewWrap.appendChild(liveFolderBody);
                colorStudioCard.appendChild(livePreviewWrap);

                // 2) 双栏色板微调区（LoRA 选中色 + 文件夹默认色）
                const pickersGrid = document.createElement("div");
                pickersGrid.style.cssText = "display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;";

                const buildColorGroup = (groupTitle, items) => {
                    const box = document.createElement("div");
                    box.style.cssText = "background: #111114; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 9px 10px; display: flex; flex-direction: column; gap: 7px;";
                    const gt = document.createElement("div");
                    gt.textContent = groupTitle;
                    gt.style.cssText = "font-size: 11.5px; font-weight: 600; color: #d4d4d8;";
                    box.appendChild(gt);
                    const pillsRow = document.createElement("div");
                    pillsRow.style.cssText = "display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;";
                    const inputs = {};
                    items.forEach((it) => {
                        const pill = document.createElement("label");
                        pill.style.cssText = "display: flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 6px; background: #18181c; border: 1px solid rgba(255, 255, 255, 0.08); cursor: pointer; transition: border-color 0.15s;";
                        pill.onmouseenter = () => { pill.style.borderColor = "rgba(99, 102, 241, 0.5)"; };
                        pill.onmouseleave = () => { pill.style.borderColor = "rgba(255, 255, 255, 0.08)"; };
                        const inp = document.createElement("input");
                        inp.type = "color";
                        inp.value = it.value;
                        inp.style.cssText = "width: 18px; height: 18px; border: none; padding: 0; background: transparent; cursor: pointer; flex-shrink: 0;";
                        const txt = document.createElement("span");
                        txt.textContent = it.label;
                        txt.style.cssText = "font-size: 11px; color: #d4d4d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
                        pill.appendChild(inp);
                        pill.appendChild(txt);
                        pillsRow.appendChild(pill);
                        inputs[it.key] = inp;
                    });
                    box.appendChild(pillsRow);
                    return { box, inputs };
                };

                const loraGroup = buildColorGroup("LoRA 选中高亮", [
                    { key: "selectBg", label: "背景", value: initCs.selectBg || DEF_LORA_COLOR.selectBg },
                    { key: "selectBar", label: "色条", value: initCs.selectBar || DEF_LORA_COLOR.selectBar },
                    { key: "selectText", label: "文字", value: initCs.selectText || DEF_LORA_COLOR.selectText },
                ]);
                const folderGroup = buildColorGroup("文件夹默认色", [
                    { key: "inner", label: "标题栏", value: initFs.inner || DEF_FOLDER_COLOR.inner },
                    { key: "outer", label: "底色", value: initFs.outer || DEF_FOLDER_COLOR.outer },
                    { key: "bar", label: "色条", value: initFs.bar || DEF_FOLDER_COLOR.bar },
                ]);
                pickersGrid.appendChild(loraGroup.box);
                pickersGrid.appendChild(folderGroup.box);
                colorStudioCard.appendChild(pickersGrid);

                // 3) 行内另存为预设输入栏
                const savePresetBar = document.createElement("div");
                savePresetBar.style.cssText = "display: flex; align-items: center; gap: 8px; padding-top: 2px;";
                const savePresetInput = document.createElement("input");
                savePresetInput.type = "text";
                savePresetInput.className = "ma-input";
                savePresetInput.placeholder = "输入预设名称（如：赛博霓虹），将当前配色保存为自定义预设...";
                savePresetInput.style.cssText = "flex: 1; padding: 6px 10px; font-size: 12px;";
                const savePresetBtn = document.createElement("button");
                savePresetBtn.type = "button";
                savePresetBtn.className = "ma-btn ma-btn-primary";
                savePresetBtn.textContent = "另存当前配色为预设";
                savePresetBtn.style.cssText = "padding: 6px 12px; font-size: 12px; flex-shrink: 0; white-space: nowrap;";
                savePresetBar.appendChild(savePresetInput);
                savePresetBar.appendChild(savePresetBtn);
                colorStudioCard.appendChild(savePresetBar);

                layoutContainer.appendChild(colorStudioCard);

                // 4) 预设方案网格
                const presetGridTitle = document.createElement("div");
                presetGridTitle.textContent = "预设方案列表";
                presetGridTitle.style.cssText = "font-size: 12px; font-weight: 600; color: #d4d4d8; margin-top: 2px; margin-bottom: -6px;";
                layoutContainer.appendChild(presetGridTitle);

                const presetGrid = document.createElement("div");
                presetGrid.style.cssText = "display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;";
                layoutContainer.appendChild(presetGrid);

                const normHex = (v) => String(v || "").trim().toLowerCase();
                const isPresetActive = (preset) => {
                    const l = preset.lora || {};
                    const f = preset.folder || {};
                    return (
                        normHex(loraGroup.inputs.selectBg.value) === normHex(l.selectBg || DEF_LORA_COLOR.selectBg) &&
                        normHex(loraGroup.inputs.selectBar.value) === normHex(l.selectBar || DEF_LORA_COLOR.selectBar) &&
                        normHex(loraGroup.inputs.selectText.value) === normHex(l.selectText || DEF_LORA_COLOR.selectText) &&
                        normHex(folderGroup.inputs.outer.value) === normHex(f.outer || DEF_FOLDER_COLOR.outer) &&
                        normHex(folderGroup.inputs.inner.value) === normHex(f.inner || DEF_FOLDER_COLOR.inner) &&
                        normHex(folderGroup.inputs.bar.value) === normHex(f.bar || DEF_FOLDER_COLOR.bar)
                    );
                };

                const updateLiveColorPreview = () => {
                    const lBg = loraGroup.inputs.selectBg.value || DEF_LORA_COLOR.selectBg;
                    const lBar = loraGroup.inputs.selectBar.value || DEF_LORA_COLOR.selectBar;
                    const lTxt = loraGroup.inputs.selectText.value || DEF_LORA_COLOR.selectText;
                    const fOuter = folderGroup.inputs.outer.value || DEF_FOLDER_COLOR.outer;
                    const fInner = folderGroup.inputs.inner.value || DEF_FOLDER_COLOR.inner;
                    const fBar = folderGroup.inputs.bar.value || DEF_FOLDER_COLOR.bar;

                    livePreviewWrap.style.background = fOuter;
                    livePreviewWrap.style.borderLeft = "4px solid " + fBar;
                    liveFolderHead.style.background = fInner;
                    liveLoraSelected.style.background = lBg;
                    liveLoraSelected.style.color = lTxt;
                    liveLoraSelected.style.borderLeft = "3px solid " + lBar;
                };

                const renderPresetCards = () => {
                    presetGrid.innerHTML = "";
                    const makeCard = (preset, isCustom, idx) => {
                        const l = preset.lora || {};
                        const f = preset.folder || {};
                        const active = isPresetActive(preset);
                        const card = document.createElement("div");
                        card.style.cssText = `
                            border: 1px solid ${active ? "rgba(99, 102, 241, 0.75)" : "rgba(255, 255, 255, 0.08)"};
                            border-radius: 9px;
                            overflow: hidden;
                            cursor: pointer;
                            background: ${active ? "rgba(99, 102, 241, 0.10)" : "#18181c"};
                            transition: border-color 0.15s, background 0.15s, transform 0.1s;
                            display: flex;
                            flex-direction: column;
                        `;
                        card.onmouseenter = () => {
                            if (!active) card.style.borderColor = "rgba(99, 102, 241, 0.5)";
                        };
                        card.onmouseleave = () => {
                            if (!active) card.style.borderColor = "rgba(255, 255, 255, 0.08)";
                        };

                        // 顶部名称栏 + 色点
                        const bar = document.createElement("div");
                        bar.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; gap: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);";
                        const nameWrap = document.createElement("div");
                        nameWrap.style.cssText = "display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;";
                        const nm = document.createElement("span");
                        nm.textContent = preset.name;
                        nm.style.cssText = "font-size: 12px; font-weight: 600; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
                        nameWrap.appendChild(nm);
                        if (active) {
                            const badge = document.createElement("span");
                            badge.textContent = "当前使用";
                            badge.style.cssText = "font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(99, 102, 241, 0.22); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); flex-shrink: 0;";
                            nameWrap.appendChild(badge);
                        }
                        bar.appendChild(nameWrap);

                        const rightTools = document.createElement("div");
                        rightTools.style.cssText = "display: flex; align-items: center; gap: 4px; flex-shrink: 0;";
                        [f.bar || l.selectBar || "#6366f1", f.inner || "#222228", l.selectBg || "#2b3b5e", l.selectBar || "#6366f1"].forEach((swColor) => {
                            const dot = document.createElement("span");
                            dot.style.cssText = `width: 10px; height: 10px; border-radius: 999px; background: ${swColor}; border: 1px solid rgba(255,255,255,0.22); display: inline-block;`;
                            rightTools.appendChild(dot);
                        });
                        if (isCustom) {
                            const del = document.createElement("span");
                            del.textContent = "✕";
                            del.title = "删除该自定义预设";
                            del.style.cssText = "cursor: pointer; color: #f87171; font-size: 12px; padding: 0 2px 0 4px; line-height: 1;";
                            del.onclick = (e) => {
                                e.stopPropagation();
                                const arr = this._loadCustomColorPresets();
                                arr.splice(idx, 1);
                                this._saveCustomColorPresets(arr);
                                renderPresetCards();
                            };
                            rightTools.appendChild(del);
                        }
                        bar.appendChild(rightTools);
                        card.appendChild(bar);

                        // 迷你文件夹 + LoRA 选中预览块
                        const pv = document.createElement("div");
                        pv.style.cssText = "background: " + (f.outer || "#18181c") + "; border-left: 3px solid " + (f.bar || l.selectBar || "#6366f1") + "; margin: 7px 8px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06);";
                        const ph = document.createElement("div");
                        ph.style.cssText = "padding: 4px 8px; font-size: 10.5px; font-weight: 600; color: #e4e4e7; background: " + (f.inner || "#222228") + ";";
                        ph.textContent = "📁 " + preset.name;
                        const pl = document.createElement("div");
                        pl.style.cssText = "margin: 5px 6px; padding: 3px 7px; border-radius: 5px; font-size: 10.5px; font-weight: 500; background: " + (l.selectBg || "#2b3b5e") + "; color: " + (l.selectText || "#eef1ff") + "; border-left: 3px solid " + (l.selectBar || "#6366f1") + ";";
                        pl.textContent = "LoRA 行（选中）";
                        pv.appendChild(ph);
                        pv.appendChild(pl);
                        card.appendChild(pv);

                        card.onclick = () => {
                            loraGroup.inputs.selectBg.value = l.selectBg || DEF_LORA_COLOR.selectBg;
                            loraGroup.inputs.selectBar.value = l.selectBar || DEF_LORA_COLOR.selectBar;
                            loraGroup.inputs.selectText.value = l.selectText || DEF_LORA_COLOR.selectText;
                            folderGroup.inputs.outer.value = f.outer || DEF_FOLDER_COLOR.outer;
                            folderGroup.inputs.inner.value = f.inner || DEF_FOLDER_COLOR.inner;
                            folderGroup.inputs.bar.value = f.bar || DEF_FOLDER_COLOR.bar;
                            folderColorCustomized = !!(f.outer || f.inner || f.bar);
                            updateLiveColorPreview();
                            renderPresetCards();
                            this._applyColorPreset(preset);
                        };
                        return card;
                    };

                    this._builtinColorPresets().forEach((p) => presetGrid.appendChild(makeCard(p, false, -1)));
                    this._loadCustomColorPresets().forEach((p, i) => presetGrid.appendChild(makeCard(p, true, i)));
                };

                Object.values(loraGroup.inputs).forEach((inp) => {
                    inp.addEventListener("input", () => {
                        updateLiveColorPreview();
                        renderPresetCards();
                    });
                });
                Object.values(folderGroup.inputs).forEach((inp) => {
                    inp.addEventListener("input", () => {
                        folderColorCustomized = true;
                        updateLiveColorPreview();
                        renderPresetCards();
                    });
                });

                resetColorBtn.onclick = () => {
                    loraGroup.inputs.selectBg.value = DEF_LORA_COLOR.selectBg;
                    loraGroup.inputs.selectBar.value = DEF_LORA_COLOR.selectBar;
                    loraGroup.inputs.selectText.value = DEF_LORA_COLOR.selectText;
                    folderGroup.inputs.outer.value = DEF_FOLDER_COLOR.outer;
                    folderGroup.inputs.inner.value = DEF_FOLDER_COLOR.inner;
                    folderGroup.inputs.bar.value = DEF_FOLDER_COLOR.bar;
                    folderColorCustomized = false;
                    updateLiveColorPreview();
                    renderPresetCards();
                };

                savePresetBtn.onclick = async () => {
                    const name = (savePresetInput.value || "").trim() || await mplAsk("保存配色预设", "我的配色", { message: "给当前配色起个名字：" });
                    if (!name || !name.trim()) return;
                    const curFs = this.folderColorSettings || {};
                    const preset = {
                        name: name.trim(),
                        lora: {
                            selectBg: loraGroup.inputs.selectBg.value || DEF_LORA_COLOR.selectBg,
                            selectBar: loraGroup.inputs.selectBar.value || DEF_LORA_COLOR.selectBar,
                            selectText: loraGroup.inputs.selectText.value || DEF_LORA_COLOR.selectText,
                        },
                        folder: {
                            outer: folderGroup.inputs.outer.value || DEF_FOLDER_COLOR.outer,
                            inner: folderGroup.inputs.inner.value || DEF_FOLDER_COLOR.inner,
                            bar: folderGroup.inputs.bar.value || DEF_FOLDER_COLOR.bar,
                            ignore: curFs.ignore || "",
                            normal: curFs.normal || "",
                        },
                    };
                    const arr = this._loadCustomColorPresets();
                    arr.push(preset);
                    this._saveCustomColorPresets(arr);
                    savePresetInput.value = "";
                    renderPresetCards();
                };

                updateLiveColorPreview();
                renderPresetCards();

                layoutTabContent.appendChild(layoutContainer);

                content.appendChild(modeTabContent);
                content.appendChild(layoutTabContent);

                const closeSettings = () => {
                    try { dialog.__maSaveWinPos?.(); } catch (e) {}
                    dialog.remove();
                };
                dialog.__mplCleanup = closeSettings;
                closeX.onclick = () => closeSettings();

                const stopProp = (e) => { e.stopPropagation(); };
                dialog.addEventListener("pointerdown", stopProp);
                dialog.addEventListener("pointermove", stopProp);
                dialog.addEventListener("pointerup", (e) => {
                    e.stopPropagation();
                    dialog.__maSaveWinPos?.();
                });
                dialog.addEventListener("mousedown", stopProp);
                dialog.addEventListener("wheel", stopProp, { passive: false });
                dialog.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" && !document.querySelector(".mpl-dialog-overlay")) {
                        e.preventDefault();
                        closeSettings();
                    }
                });

                // 确定按钮
                const confirmBtn = document.createElement("button");
                confirmBtn.className = "ma-btn ma-btn-primary";
                confirmBtn.textContent = "确定";
                confirmBtn.onclick = () => {
                    const isAdaptiveSelected = radioAdaptive.checked;
                    const isDefaultSelected = radioDefault.checked;
                    const scope = dialog;
                    let selectedSdnqMode = "none";
                    if (!isDefaultSelected && !isAdaptiveSelected) selectedSdnqMode = scope.querySelector('input[name="sdnq_mode"]:checked')?.value || "none";
                    this.sdnqMode = selectedSdnqMode;
                    this.properties["sdnq_mode"] = selectedSdnqMode;
                    this.adaptiveMode = isAdaptiveSelected;
                    this.properties["adaptive_mode"] = isAdaptiveSelected;
                    let selectedKleinMode = "none";
                    if (!isDefaultSelected && !isAdaptiveSelected) selectedKleinMode = scope.querySelector('input[name="klein_mode"]:checked')?.value || "none";
                    this.kleinMode = selectedKleinMode;
                    this.properties["klein_mode"] = selectedKleinMode;
                    if (this._sdnqModeWidget) this._sdnqModeWidget.value = selectedSdnqMode;
                    if (this._kleinModeWidget) this._kleinModeWidget.value = selectedKleinMode;
                    if (this._adaptiveModeWidget) this._adaptiveModeWidget.value = String(isAdaptiveSelected);

                    // Anima 2.9B 模式（独立于加载模式，仅标准加载路径生效）
                    let selectedAnimaMode = scope.querySelector('input[name="anima_mode"]:checked')?.value || "none";
                    this.animaMode = selectedAnimaMode;
                    this.properties["anima_mode"] = selectedAnimaMode;
                    if (this._animaModeWidget) this._animaModeWidget.value = selectedAnimaMode;

                    // 保存布局设置
                    const selectedStyle = scope.querySelector('input[name="mpl_weight_style"]:checked')?.value || "arrows";
                    const newLayout = {
                        weightStyle: selectedStyle,
                        sliderStep: Math.max(0.01, parseFloat(stepRow.input.value) || 0.05),
                        sliderMin: Math.min(0, parseFloat(minRow.input.value) || -2),
                        sliderMax: Math.max(0, parseFloat(maxRow.input.value) || 2),
                        sliderWidth: Math.max(60, Math.min(300, parseInt(widthRow.input.value, 10) || 110)),
                        showWeightValue: showValueRow.cb.checked,
                        snapToZero: snapRow.cb.checked,
                        hideClip: !showClipRow.cb.checked,
                        hideRecWeight: !showRecRow.cb.checked,
                    };
                    if (newLayout.sliderMin >= newLayout.sliderMax) {
                        newLayout.sliderMax = newLayout.sliderMin + 0.1;
                    }
                    this.layoutSettings = newLayout;
                    this.properties["layout_settings"] = newLayout;

                    // 保存主题配色设置（保留已设置的文件夹忽略/未忽略颜色）
                    const prevFs = this.folderColorSettings || {};
                    this.colorSettings = {
                        selectBg: loraGroup.inputs.selectBg.value || DEF_LORA_COLOR.selectBg,
                        selectBar: loraGroup.inputs.selectBar.value || DEF_LORA_COLOR.selectBar,
                        selectText: loraGroup.inputs.selectText.value || DEF_LORA_COLOR.selectText,
                    };
                    this.folderColorSettings = folderColorCustomized
                        ? {
                              outer: folderGroup.inputs.outer.value || DEF_FOLDER_COLOR.outer,
                              inner: folderGroup.inputs.inner.value || DEF_FOLDER_COLOR.inner,
                              bar: folderGroup.inputs.bar.value || DEF_FOLDER_COLOR.bar,
                              ignore: prevFs.ignore || "",
                              normal: prevFs.normal || "",
                          }
                        : { outer: "", inner: "", bar: "", ignore: prevFs.ignore || "", normal: prevFs.normal || "" };
                    this.properties["color_settings"] = this.colorSettings;
                    this.properties["folder_color_settings"] = this.folderColorSettings;
                    this.applyColorSettings?.();
                    this.applyFolderColorSettings?.();

                    // 根据布局调整节点最小宽度（仅在用户未手动调大时）
                    // 箭头模式控件宽度约 80px，滑条模式约 sliderWidth + 46px
                    // 额外加 20px padding 确保按钮完全显示
                    const arrowMinW = 490;
                    const sliderMinW = 490 + Math.max(0, (newLayout.sliderWidth ?? 110) + (newLayout.showWeightValue !== false ? 46 : 0) - 60);
                    const targetMinW = newLayout.weightStyle === "slider" ? Math.max(arrowMinW, sliderMinW) : arrowMinW;
                    if (this.minWidth !== undefined && this.minWidth < targetMinW) {
                        this.minWidth = targetMinW;
                    }
                    // 如果当前宽度小于新的最小宽度，自动扩展
                    if (this.size && Array.isArray(this.size) && this.size[0] < targetMinW) {
                        this.size[0] = targetMinW;
                        this.setDirtyCanvas?.(true, true);
                    }

                    this.updateWidget();
                    this._updateKleinBanner?.();
                    this.renderEmbeddedList?.();
                    closeSettings();
                };

                // 取消按钮
                const cancelBtn = document.createElement("button");
                cancelBtn.className = "ma-btn";
                cancelBtn.textContent = "取消";
                cancelBtn.onclick = () => closeSettings();

                // 组装弹窗（直接挂 body，无全屏遮罩）
                buttonContainer.appendChild(cancelBtn);
                buttonContainer.appendChild(confirmBtn);
                dialog.appendChild(title);
                dialog.appendChild(tabBar);
                dialog.appendChild(content);
                dialog.appendChild(buttonContainer);
                document.body.appendChild(dialog);

                // 使弹窗可拖拽
                this.makeDialogDraggable(dialog, title);
            };

            // 📂 预设与收藏中心：无遮罩悬浮窗口，可边操作画布边使用预设与收藏
            nodeType.prototype.loadPresetModal = async function() {
                document.querySelectorAll(".mpl-preset-floating").forEach(el => {
                    try { el.__mplCleanup?.(); } catch (e) { el.remove(); }
                });

                let _ppos = null;
                try { _ppos = JSON.parse(localStorage.getItem("MA_PRESET_WIN") || "null"); } catch (e) { _ppos = null; }
                let _pw = Math.min(820, Math.round(window.innerWidth * 0.92));
                let _ph = Math.min(580, Math.round(window.innerHeight * 0.85));
                let _pl = Math.max(16, Math.round(window.innerWidth / 2 - _pw / 2));
                let _pt = Math.max(16, Math.round(window.innerHeight / 2 - _ph / 2));
                if (_ppos && typeof _ppos.w === "number" && typeof _ppos.left === "number") {
                    _pw = Math.max(520, Math.min(_ppos.w, window.innerWidth - 24));
                    _ph = Math.max(360, Math.min(_ppos.h, window.innerHeight - 24));
                    _pl = Math.max(0, Math.min(_ppos.left, window.innerWidth - 120));
                    _pt = Math.max(0, Math.min(_ppos.top, window.innerHeight - 80));
                }

                const dialog = document.createElement("div");
                dialog.className = "ma-modal mpl-preset-floating";
                dialog.tabIndex = -1;
                dialog.style.cssText = `position:fixed;top:${_pt}px;left:${_pl}px;width:${_pw}px;height:${_ph}px;min-width:min(520px,94vw);min-height:360px;max-width:96vw;max-height:92vh;resize:both;display:flex;flex-direction:column;overflow:hidden;background:#111114;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.78);color:#f4f4f5;z-index:9998;outline:none;font:12.5px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;`;
                dialog.__maSaveWinPos = () => {
                    try {
                        const r = dialog.getBoundingClientRect();
                        localStorage.setItem("MA_PRESET_WIN", JSON.stringify({ left: r.left, top: r.top, w: r.width, h: r.height }));
                    } catch (e) {}
                };

                // ---------------- 头部 ----------------
                const header = document.createElement("div");
                header.style.cssText = "flex:0 0 auto;padding:12px 16px;display:flex;align-items:center;gap:10px;background:#151519;border-bottom:1px solid rgba(255,255,255,0.08);cursor:move;user-select:none;";

                const title = document.createElement("div");
                title.textContent = "📂 预设与收藏";
                title.style.cssText = "font-size:15px;font-weight:650;letter-spacing:-0.01em;flex:0 0 auto;";

                const tabBar = document.createElement("div");
                tabBar.style.cssText = "display:flex;gap:3px;padding:3px;border-radius:9px;background:#0d0d10;border:1px solid rgba(255,255,255,0.08);";

                const headRight = document.createElement("div");
                headRight.style.cssText = "margin-left:auto;display:flex;align-items:center;gap:8px;";

                const mkHeadBtn = (text, titleText, primary = false) => {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.textContent = text;
                    if (titleText) b.title = titleText;
                    b.style.cssText = primary
                        ? "padding:5px 12px;font-size:12px;border-radius:7px;border:1px solid rgba(99,102,241,0.55);background:rgba(99,102,241,0.16);color:#e0e7ff;cursor:pointer;white-space:nowrap;"
                        : "padding:5px 12px;font-size:12px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:#18181c;color:#d4d4d8;cursor:pointer;white-space:nowrap;";
                    b.onmouseenter = () => { b.style.borderColor = "rgba(99,102,241,0.7)"; b.style.color = "#fff"; };
                    b.onmouseleave = () => {
                        b.style.borderColor = primary ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.12)";
                        b.style.color = primary ? "#e0e7ff" : "#d4d4d8";
                    };
                    return b;
                };

                const exportBtn = mkHeadBtn("导出备份", "导出全部预设、分类、排序与收藏夹为 JSON 文件");
                const importBtn = mkHeadBtn("导入备份", "从 JSON 文件导入预设与收藏（导入前会自动下载当前数据备份）");
                const backupFileInput = document.createElement("input");
                backupFileInput.type = "file";
                backupFileInput.accept = ".json,application/json";
                backupFileInput.style.display = "none";

                const refreshBtn = mkHeadBtn("刷新", "刷新预设与收藏列表");

                const closeBtn = document.createElement("button");
                closeBtn.type = "button";
                closeBtn.textContent = "✕";
                closeBtn.style.cssText = "width:26px;height:26px;padding:0;border-radius:7px;border:1px solid transparent;background:transparent;color:#a1a1aa;cursor:pointer;font-size:14px;";
                closeBtn.onmouseenter = () => { closeBtn.style.background = "#222228"; closeBtn.style.color = "#f4f4f5"; };
                closeBtn.onmouseleave = () => { closeBtn.style.background = "transparent"; closeBtn.style.color = "#a1a1aa"; };

                headRight.append(exportBtn, importBtn, backupFileInput, refreshBtn, closeBtn);
                header.append(title, tabBar, headRight);

                // ---------------- 主体：左侧筛选 + 右侧列表 ----------------
                const body = document.createElement("div");
                body.style.cssText = "flex:1 1 auto;min-height:0;display:flex;";

                const filterCol = document.createElement("div");
                filterCol.style.cssText = "flex:0 0 196px;width:196px;display:flex;flex-direction:column;min-height:0;background:#0d0d10;border-right:1px solid rgba(255,255,255,0.08);";

                const filterHead = document.createElement("div");
                filterHead.style.cssText = "flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,0.05);";

                const filterTitle = document.createElement("span");
                filterTitle.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.03em;color:#a1a1aa;white-space:nowrap;";

                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.textContent = "+ 分类";
                addBtn.style.cssText = "padding:3px 8px;font-size:11px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:#18181c;color:#d4d4d8;cursor:pointer;white-space:nowrap;";
                addBtn.onmouseenter = () => { addBtn.style.borderColor = "rgba(99,102,241,0.55)"; addBtn.style.color = "#fff"; };
                addBtn.onmouseleave = () => { addBtn.style.borderColor = "rgba(255,255,255,0.12)"; addBtn.style.color = "#d4d4d8"; };

                const filterList = document.createElement("div");
                filterList.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px;";

                filterHead.append(filterTitle, addBtn);
                filterCol.append(filterHead, filterList);

                const listCol = document.createElement("div");
                listCol.style.cssText = "flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:12px 14px;background:#09090b;";

                body.append(filterCol, listCol);

                const footer = document.createElement("div");
                footer.style.cssText = "flex:0 0 auto;padding:9px 16px;min-height:36px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#151519;border-top:1px solid rgba(255,255,255,0.08);color:#71717a;font-size:11.5px;line-height:1.4;";
                const footerHint = document.createElement("span");
                footerHint.textContent = "提示：节点里点文件夹标题栏的 💾 可保存为预设；右键左侧分类可以重命名 / 删除。";
                const footerStatus = document.createElement("span");
                footerStatus.style.cssText = "color:#6ee7b7;white-space:nowrap;flex-shrink:0;";
                footer.append(footerHint, footerStatus);

                const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                exportBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        await mplLoadSidebar(true);
                        const data = mplBuildSidebarBackup();
                        mplDownloadJson(`magic-assistant-presets-favorites-${stamp()}.json`, data);
                        footerStatus.textContent = `已导出 ${Object.keys(data.presets).length} 个预设、${data.favorites.length} 个收藏夹`;
                    } catch (err) {
                        const msg = "导出失败：" + ((err && err.message) || err);
                        footerStatus.textContent = msg;
                        void mplAlert(msg);
                    }
                };
                importBtn.onclick = (e) => {
                    e.stopPropagation();
                    backupFileInput.click();
                };
                backupFileInput.onchange = async () => {
                    const file = backupFileInput.files && backupFileInput.files[0];
                    if (!file) return;
                    try {
                        const payload = JSON.parse(await file.text());
                        mplNormalizeSidebarImport(payload);
                        await mplLoadSidebar(true);
                        mplDownloadJson(`magic-assistant-backup-before-import-${stamp()}.json`, mplBuildSidebarBackup());
                        if (!(await mplConfirm("导入会覆盖当前所有预设与收藏。当前数据已自动下载为备份文件，继续导入吗？", { okText: "继续导入" }))) {
                            footerStatus.textContent = "已取消导入";
                            return;
                        }
                        const count = await mplImportSidebarBackup(payload);
                        const msg = `导入完成：${count} 个预设，${(MPL_SIDEBAR.favorites || []).length} 个收藏夹`;
                        footerStatus.textContent = msg;
                        await doRefresh();
                        void mplAlert(msg);
                    } catch (err) {
                        const msg = "导入失败：" + ((err && err.message) || err);
                        footerStatus.textContent = msg;
                        void mplAlert(msg);
                    } finally {
                        backupFileInput.value = "";
                    }
                };

                dialog.append(header, body, footer);

                // ---------------- 状态 ----------------
                let activeTab = "presets"; // presets | favorites
                let catFilter = "";        // "" = 全部, "__uncat__" = 未分类, 其他 = 分类名
                let favFilter = "";        // "" = 全部收藏, 其他 = 收藏夹名

                // ---------------- 小工具 ----------------
                const emptyHint = (titleText, subText) => {
                    const box = document.createElement("div");
                    box.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:56px 20px;text-align:center;";
                    const t = document.createElement("div");
                    t.textContent = titleText;
                    t.style.cssText = "font-size:13px;font-weight:600;color:#d4d4d8;";
                    const s = document.createElement("div");
                    s.textContent = subText;
                    s.style.cssText = "font-size:11.5px;color:#71717a;max-width:400px;line-height:1.65;";
                    box.append(t, s);
                    return box;
                };

                const mkBtn = (label, titleText, cb, danger) => {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.textContent = label;
                    b.title = titleText || label;
                    b.style.cssText = "padding:4px 9px;font-size:11.5px;border-radius:6px;cursor:pointer;white-space:nowrap;border:1px solid " +
                        (danger ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.12)") + ";background:" +
                        (danger ? "rgba(239,68,68,0.12)" : "#18181c") + ";color:" + (danger ? "#fca5a5" : "#d4d4d8") + ";";
                    b.onmouseenter = () => { b.style.borderColor = danger ? "rgba(239,68,68,0.65)" : "rgba(99,102,241,0.55)"; b.style.color = "#fff"; };
                    b.onmouseleave = () => { b.style.borderColor = danger ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.12)"; b.style.color = danger ? "#fca5a5" : "#d4d4d8"; };
                    b.onclick = (e) => { e.stopPropagation(); cb && cb(e); };
                    return b;
                };

                const mkFilterRow = (label, count, active, onClick, onContext) => {
                    const row = document.createElement("div");
                    row.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:12px;" +
                        (active ? "background:rgba(99,102,241,0.16);color:#e0e7ff;" : "color:#d4d4d8;");
                    const nameEl = document.createElement("span");
                    nameEl.textContent = label;
                    nameEl.title = label;
                    nameEl.style.cssText = "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                    const badge = document.createElement("span");
                    badge.textContent = String(count);
                    badge.style.cssText = "flex:0 0 auto;min-width:18px;text-align:center;padding:0 5px;border-radius:9px;background:rgba(255,255,255,0.06);font-size:10px;line-height:15px;color:" + (active ? "#c7d2fe" : "#71717a") + ";";
                    row.append(nameEl, badge);
                    if (!active) {
                        row.onmouseenter = () => { row.style.background = "rgba(255,255,255,0.05)"; };
                        row.onmouseleave = () => { row.style.background = "transparent"; };
                    }
                    row.onclick = (e) => { e.stopPropagation(); onClick && onClick(); };
                    if (onContext) {
                        row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onContext(e); };
                    }
                    return row;
                };

                // ---------------- 数据刷新 ----------------
                const doRefresh = async () => {
                    try { await mplLoadSidebar(true); } catch (e) {}
                    renderFilters();
                    renderBody();
                };
                MPL_PRESET_MODAL_REFRESHERS.add(doRefresh);

                // ---------------- 左侧筛选 ----------------
                const renderFilters = () => {
                    filterList.innerHTML = "";
                    const st = MPL_SIDEBAR;
                    if (activeTab === "presets") {
                        filterTitle.textContent = "预设分类";
                        addBtn.textContent = "+ 分类";
                        addBtn.onclick = async (e) => {
                            e.stopPropagation();
                            await this._mplNewPresetCategory();
                            try { renderFilters(); renderBody(); } catch (err) {}
                        };
                        const allNames = Object.keys(st.presets || {});
                        const cats = Array.isArray(st.categories) ? st.categories.slice() : [];
                        const countOf = (cat) => allNames.filter(n => {
                            const a = st.assignments[n] || "";
                            if (cat === "") return true;
                            if (cat === "__uncat__") return !a || !cats.includes(a);
                            return a === cat;
                        }).length;
                        filterList.appendChild(mkFilterRow("全部预设", countOf(""), catFilter === "", () => {
                            catFilter = "";
                            renderFilters();
                            renderBody();
                        }));
                        cats.forEach(cat => {
                            filterList.appendChild(mkFilterRow(cat, countOf(cat), catFilter === cat, () => {
                                catFilter = cat;
                                renderFilters();
                                renderBody();
                            }, (e) => this._mplCategoryMenu(e, cat, true)));
                        });
                        filterList.appendChild(mkFilterRow("未分类", countOf("__uncat__"), catFilter === "__uncat__", () => {
                            catFilter = "__uncat__";
                            renderFilters();
                            renderBody();
                        }));
                    } else {
                        filterTitle.textContent = "收藏夹";
                        addBtn.textContent = "+ 收藏夹";
                        addBtn.onclick = async (e) => {
                            e.stopPropagation();
                            await this._mplNewFavoriteCollection();
                            try { renderFilters(); renderBody(); } catch (err) {}
                        };
                        const cols = Array.isArray(st.favorites) ? st.favorites : [];
                        const seen = new Set();
                        let total = 0;
                        cols.forEach(c => (c.items || []).forEach(n => { if (!seen.has(n)) { seen.add(n); total++; } }));
                        filterList.appendChild(mkFilterRow("全部收藏", total, favFilter === "", () => {
                            favFilter = "";
                            renderFilters();
                            renderBody();
                        }));
                        cols.forEach(c => {
                            filterList.appendChild(mkFilterRow(c.name, (c.items || []).length, favFilter === c.name, () => {
                                favFilter = c.name;
                                renderFilters();
                                renderBody();
                            }, (e) => this._mplFavoriteMenu(e, c.name)));
                        });
                        if (!cols.length) {
                            const hint = document.createElement("div");
                            hint.textContent = "还没有收藏夹，点上方「+ 收藏夹」新建一个。";
                            hint.style.cssText = "padding:10px 8px;color:#52525b;font-size:11px;line-height:1.6;";
                            filterList.appendChild(hint);
                        }
                    }
                };

                // ---------------- 右侧列表 ----------------
                const buildPresetCard = (name) => {
                    const st = MPL_SIDEBAR;
                    const cats = Array.isArray(st.categories) ? st.categories.slice() : [];
                    const folders = mplPresetFolders(st.presets[name]);
                    const loraCount = folders.reduce((sum, f) => sum + ((f.loras || []).length), 0);

                    const card = document.createElement("div");
                    card.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;border-radius:10px;background:#18181c;border:1px solid rgba(255,255,255,0.08);transition:border-color .15s,background .15s;";
                    card.onmouseenter = () => { card.style.borderColor = "rgba(99,102,241,0.45)"; card.style.background = "#1e1e24"; };
                    card.onmouseleave = () => { card.style.borderColor = "rgba(255,255,255,0.08)"; card.style.background = "#18181c"; };

                    const icon = document.createElement("span");
                    icon.textContent = "📁";
                    icon.style.cssText = "font-size:17px;flex:0 0 auto;";

                    const info = document.createElement("div");
                    info.style.cssText = "flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;";
                    const nameEl = document.createElement("div");
                    nameEl.textContent = name;
                    nameEl.title = name;
                    nameEl.style.cssText = "font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                    const meta = document.createElement("div");
                    meta.textContent = `${loraCount} 个 LoRA · ${folders.length} 个文件夹`;
                    meta.style.cssText = "font-size:11px;color:#71717a;";
                    info.append(nameEl, meta);

                    const controls = document.createElement("div");
                    controls.style.cssText = "flex:0 0 auto;display:flex;align-items:center;gap:6px;";

                    const catSelect = document.createElement("select");
                    catSelect.className = "ma-select";
                    catSelect.title = "调整所属分类";
                    catSelect.style.cssText = "padding:4px 8px;font-size:11.5px;max-width:118px;";
                    const uncatOpt = document.createElement("option");
                    uncatOpt.value = "";
                    uncatOpt.textContent = "未分类";
                    catSelect.appendChild(uncatOpt);
                    cats.forEach(c => {
                        const op = document.createElement("option");
                        op.value = c;
                        op.textContent = c;
                        catSelect.appendChild(op);
                    });
                    const currentCat = st.assignments[name];
                    catSelect.value = currentCat && cats.includes(currentCat) ? currentCat : "";
                    catSelect.onchange = async (e) => {
                        e.stopPropagation();
                        if (catSelect.value) MPL_SIDEBAR.assignments[name] = catSelect.value;
                        else delete MPL_SIDEBAR.assignments[name];
                        await mplSavePresetMeta();
                        renderFilters();
                        renderBody();
                    };

                    const renameBtn = mkBtn("✎", "重命名预设", async () => {
                        const nn = await mplAsk("重命名预设", name, { message: "输入新的预设名称：" });
                        if (!nn || !nn.trim() || nn.trim() === name) return;
                        try {
                            const resp = await api.fetchApi("/ma/lora/rename_preset", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ old: name, new: nn.trim() }),
                            });
                            const rj = await resp.json();
                            if (!rj || rj.status !== "success") {
                                void mplAlert("重命名失败：" + ((rj && rj.message) || "未知错误"));
                                return;
                            }
                            await doRefresh();
                        } catch (err) {
                            void mplAlert("重命名失败：" + err);
                        }
                    });

                    const sendBtn = mkBtn("发送到节点", "把这个预设的文件夹加入节点", () => {
                        this._mplApplyPreset(name);
                        sendBtn.textContent = "已发送 ✓";
                        setTimeout(() => { try { sendBtn.textContent = "发送到节点"; } catch (e) {} }, 1200);
                    });

                    const delBtn = mkBtn("×", "删除预设", async () => {
                        if (!(await mplConfirm(`确定要删除预设 "${name}" 吗？`, { danger: true, okText: "删除" }))) return; 
                        try {
                            await api.fetchApi("/ma/lora/delete_preset", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ name }),
                            });
                            delete MPL_SIDEBAR.presets[name];
                            delete MPL_SIDEBAR.assignments[name];
                            await doRefresh();
                        } catch (err) {
                            void mplAlert("删除失败：" + err);
                        }
                    }, true);

                    controls.append(catSelect, renameBtn, sendBtn, delBtn);
                    card.append(icon, info, controls);
                    return card;
                };

                const buildFavRow = (name, collection) => {
                    const row = document.createElement("div");
                    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:6px;border-radius:9px;background:#18181c;border:1px solid rgba(255,255,255,0.08);transition:border-color .15s,background .15s;";
                    row.onmouseenter = () => { row.style.borderColor = "rgba(99,102,241,0.45)"; row.style.background = "#1e1e24"; };
                    row.onmouseleave = () => { row.style.borderColor = "rgba(255,255,255,0.08)"; row.style.background = "#18181c"; };

                    const icon = document.createElement("span");
                    icon.textContent = "⭐";
                    icon.style.cssText = "font-size:14px;flex:0 0 auto;";

                    const info = document.createElement("div");
                    info.style.cssText = "flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;";
                    const nameEl = document.createElement("div");
                    nameEl.textContent = (String(name).split(/[/\\]/).pop() || String(name)).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, "");
                    nameEl.title = name;
                    nameEl.style.cssText = "font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                    const pathEl = document.createElement("div");
                    pathEl.textContent = name;
                    pathEl.title = name;
                    pathEl.style.cssText = "font-size:10.5px;color:#52525b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                    info.append(nameEl, pathEl);

                    const controls = document.createElement("div");
                    controls.style.cssText = "flex:0 0 auto;display:flex;align-items:center;gap:6px;";

                    const addBtnEl = mkBtn("添加到节点", "把这个 LoRA 加入节点", () => {
                        this._mplAddLoraByName(name);
                        addBtnEl.textContent = "已添加 ✓";
                        setTimeout(() => { try { addBtnEl.textContent = "添加到节点"; } catch (e) {} }, 1200);
                    });
                    const removeBtn = mkBtn("移除", "从当前收藏夹移除", () => {
                        this._mplRemoveFavorite(name, collection);
                        setTimeout(() => { try { renderFilters(); renderBody(); } catch (e) {} }, 60);
                    }, true);

                    controls.append(addBtnEl, removeBtn);
                    row.append(icon, info, controls);
                    return row;
                };

                const renderBody = () => {
                    listCol.innerHTML = "";
                    const st = MPL_SIDEBAR;
                    if (activeTab === "presets") {
                        const cats = Array.isArray(st.categories) ? st.categories.slice() : [];
                        const all = Object.keys(st.presets || {});
                        const ordered = [];
                        (st.preset_order || []).forEach(n => { if (all.includes(n) && !ordered.includes(n)) ordered.push(n); });
                        all.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });
                        const shown = ordered.filter(n => {
                            const a = st.assignments[n] || "";
                            if (catFilter === "") return true;
                            if (catFilter === "__uncat__") return !a || !cats.includes(a);
                            return a === catFilter;
                        });
                        if (!shown.length) {
                            listCol.appendChild(emptyHint(
                                all.length ? "这个分类里还没有预设" : "还没有任何预设",
                                "在节点里配置好 LoRA 后，点文件夹标题栏的 💾 就能把它保存成预设；保存后的预设会出现在这里。"
                            ));
                            return;
                        }
                        shown.forEach(name => listCol.appendChild(buildPresetCard(name)));
                        return;
                    }

                    const cols = Array.isArray(st.favorites) ? st.favorites : [];
                    const seen = new Map();
                    cols.forEach(c => (c.items || []).forEach(n => { if (!seen.has(n)) seen.set(n, c.name); }));
                    let entries = [];
                    if (favFilter === "") {
                        entries = Array.from(seen.entries()).map(([n, cname]) => ({ name: n, collection: cname }));
                    } else {
                        const col = cols.find(c => c.name === favFilter);
                        entries = ((col && col.items) || []).map(n => ({ name: n, collection: favFilter }));
                    }
                    if (!entries.length) {
                        listCol.appendChild(emptyHint(
                            cols.length ? "这个收藏夹还是空的" : "还没有收藏的 LoRA",
                            "在节点里右键 LoRA 行，选择「加入收藏夹」，就能把常用的 LoRA 收集到这里。"
                        ));
                        return;
                    }
                    entries.forEach(({ name, collection }) => listCol.appendChild(buildFavRow(name, collection)));
                };

                // ---------------- 顶部标签 ----------------
                const paintTabs = () => {
                    [tabPresets, tabFavs].forEach(b => {
                        const on = b.dataset.tab === activeTab;
                        b.style.background = on ? "rgba(99,102,241,0.18)" : "transparent";
                        b.style.borderColor = on ? "rgba(99,102,241,0.55)" : "transparent";
                        b.style.color = on ? "#e0e7ff" : "#a1a1aa";
                        b.style.fontWeight = on ? "600" : "500";
                    });
                };
                const mkTab = (key, text) => {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.dataset.tab = key;
                    b.textContent = text;
                    b.style.cssText = "padding:5px 12px;font-size:12px;border-radius:7px;border:1px solid transparent;background:transparent;color:#a1a1aa;cursor:pointer;white-space:nowrap;transition:all .15s;";
                    b.onclick = (e) => {
                        e.stopPropagation();
                        if (activeTab === key) return;
                        activeTab = key;
                        paintTabs();
                        renderFilters();
                        renderBody();
                    };
                    return b;
                };
                const tabPresets = mkTab("presets", "📁 预设分组");
                const tabFavs = mkTab("favorites", "⭐ 收藏夹");
                tabBar.append(tabPresets, tabFavs);
                paintTabs();

                // ---------------- 关闭 / 事件（无全屏遮罩，不阻塞画布操作） ----------------
                const cleanup = () => {
                    try { dialog.__maSaveWinPos?.(); } catch (e) {}
                    MPL_PRESET_MODAL_REFRESHERS.delete(doRefresh);
                    dialog.remove();
                };
                dialog.__mplCleanup = cleanup;
                closeBtn.onclick = () => cleanup();
                refreshBtn.onclick = () => { void doRefresh(); };

                const stopProp = (e) => { e.stopPropagation(); };
                dialog.addEventListener("pointerdown", stopProp);
                dialog.addEventListener("pointermove", stopProp);
                dialog.addEventListener("pointerup", (e) => {
                    e.stopPropagation();
                    dialog.__maSaveWinPos?.();
                });
                dialog.addEventListener("mousedown", stopProp);
                dialog.addEventListener("wheel", stopProp, { passive: false });
                dialog.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" && !document.querySelector(".mpl-dialog-overlay")) {
                        e.preventDefault();
                        cleanup();
                    }
                });

                // 先载入并渲染列表再挂载到 DOM，避免先闪空框再跳出内容
                await mplLoadSidebar();
                renderFilters();
                renderBody();

                document.body.appendChild(dialog);

                // 点击标签/按钮时不要让弹窗被拖走
                tabBar.addEventListener("pointerdown", stopProp);
                headRight.addEventListener("pointerdown", stopProp);

                this.makeDialogDraggable(dialog, header);
            };

        }
    },
    // 注入「lora串输出已连接」：根据 prompt 中是否有其他【加载器】引用本节点的 lora串输出 判定链末端
    init(app) {
        const LORA_OUTPUT_INDEX = 4; // RETURN_NAMES: model, clip, lora_preview, tags_output, lora串输出
        const MODEL_OUTPUT_INDEX = 0;
        const CHAIN_LOADER_TYPES = new Set(["MagicPowerLoraLoader", "MAPowerLoraLoader"]);
        const originalQueuePrompt = api.queuePrompt;
        api.queuePrompt = async function (index, prompt, ...args) {
            if (prompt && prompt.output && typeof prompt.output === "object") {
                const output = prompt.output;
                const consumers = new Map();
                for (const nodeId of Object.keys(output)) {
                    const inputs = output[nodeId] && output[nodeId].inputs;
                    if (!inputs) continue;
                    for (const key of Object.keys(inputs)) {
                        const val = inputs[key];
                        if (!Array.isArray(val) || val.length < 2) continue;
                        const src = String(val[0]);
                        let entry = consumers.get(src);
                        if (!entry) consumers.set(src, entry = { chain: new Set(), model: new Set() });
                        if (val[1] === LORA_OUTPUT_INDEX) entry.chain.add(String(nodeId));
                        else if (val[1] === MODEL_OUTPUT_INDEX) entry.model.add(String(nodeId));
                    }
                }
                for (const nodeId of Object.keys(output)) {
                    const node = output[nodeId];
                    if (!node || node.class_type !== NODE_NAME) continue;
                    if (!node.inputs) node.inputs = {};
                    const entry = consumers.get(String(nodeId));
                    const continues = !!entry && Array.from(entry.chain).some((consumerId) => {
                        const consumer = output[consumerId];
                        if (entry.model.has(consumerId)) return true;
                        return !!consumer && CHAIN_LOADER_TYPES.has(consumer.class_type);
                    });
                    node.inputs["lora串输出已连接"] = continues;
                }
            }
            return originalQueuePrompt.apply(api, [index, prompt, ...args]);
        };
    }
});

if (typeof document !== "undefined" && !window.__MPL_GUARD_POINTER_BOUND__) {
    window.__MPL_GUARD_POINTER_BOUND__ = true;
    let _mplLastGuard = 0;
    document.addEventListener("pointerup", () => {
        const now = Date.now();
        if (now - _mplLastGuard < 200) return;
        _mplLastGuard = now;
        setTimeout(() => {
            try {
                (app?.graph?._nodes || []).forEach(n => {
                    if (n && typeof n._mplGuardLayout === "function") n._mplGuardLayout();
                });
            } catch (e) {}
        }, 30);
    }, true);
}
