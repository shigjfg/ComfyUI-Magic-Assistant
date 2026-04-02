import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { openMagicLlmServiceModal } from "./magic_llm_shared.js";

// 必须与 __init__.py 和 nodes/magic_text.py 中的类名完全一致
const NODE_NAME = "MagicPromptBox";
console.log("🔮 Magic Text JS: Loaded!");

/** 多语言翻译：使用 language_switcher 的 MagicPromptBox 翻译表 */
function magicT(key) {
    if (key == null || key === "") return key;
    try {
        const fn = typeof window !== "undefined" && window.translateText;
        const lang = typeof window !== "undefined" && window.getCurrentLanguage ? window.getCurrentLanguage() : "zh";
        return fn ? fn(key, lang, "MagicPromptBox") : key;
    } catch (_) {
        return key;
    }
}

app.registerExtension({
    name: "Magic.MagicTextNode",
    setup() {
        hookMagicPromptHistoryAfterRun();
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            // 为每个节点生成唯一种子
            const nodeSeed = `magic_text_${this.id}_${Date.now()}`;

            // 查找主文本框 widget
            let textWidget = this.widgets ? this.widgets.find(w => w.name === "text") : null;

            // 添加编辑提示词按钮
            if (!this.widgets) this.widgets = [];
            this.addWidget("button", magicT("✏️ 编辑提示词"), null, () => {
                showPromptEditorModal(this, nodeSeed);
            });

            return r;
        };
    }
});

/** 与 utils.ma_normalize_prompt_history_key 一致：用于前端去重键 */
function magicNormalizeHistoryDedup(s) {
    if (s == null || s === "") return "";
    let flat = String(s).replace(/[\r\n\t]+/g, " ").replace(/，/g, ",").replace(/、/g, ",");
    const parts = [];
    for (const seg of flat.split(",")) {
        const t = seg.trim();
        if (t) parts.push(t);
    }
    return parts.join(", ").toLowerCase();
}

let _magicHistoryRunActive = false;

function hookMagicPromptHistoryAfterRun() {
    if (hookMagicPromptHistoryAfterRun._done) return;
    hookMagicPromptHistoryAfterRun._done = true;
    try {
        api.addEventListener("execution_start", () => {
            _magicHistoryRunActive = true;
        });
        /* 少数前端版本无 execution_start 时，用 progress 标记本次队列曾执行 */
        api.addEventListener("progress", () => {
            _magicHistoryRunActive = true;
        });
        api.addEventListener("execution_error", () => {
            _magicHistoryRunActive = false;
        });
        api.addEventListener("executing", (e) => {
            const d = e.detail;
            const nodeRef =
                d != null && typeof d === "object" && "node" in d ? d.node : d;
            if (nodeRef != null && nodeRef !== false) {
                _magicHistoryRunActive = true;
                return;
            }
            if (!_magicHistoryRunActive) return;
            _magicHistoryRunActive = false;
            void magicCollectAndPostPromptHistory();
        });
    } catch (err) {
        console.warn("[MagicText] prompt history hook", err);
    }
}

async function magicCollectAndPostPromptHistory() {
    try {
        const nodes = app.graph && app.graph._nodes ? app.graph._nodes : [];
        const texts = [];
        const seen = new Set();
        for (const n of nodes) {
            const t = n.type || n.comfyClass;
            if (t !== NODE_NAME) continue;
            const w = n.widgets && n.widgets.find((x) => x.name === "text");
            const raw = w && w.value != null ? String(w.value) : "";
            if (!raw.trim()) continue;
            const key = magicNormalizeHistoryDedup(raw);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            texts.push(raw);
        }
        if (!texts.length) return;
        const r = await fetch(api.apiURL("/ma/prompt_history"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "append_run", texts }),
        });
        if (!r.ok) {
            const tx = await r.text();
            console.warn("[MagicText] append_run failed", r.status, tx);
        }
    } catch (e) {
        console.warn("[MagicText] magicCollectAndPostPromptHistory", e);
    }
}

function magicFormatHistoryTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n)) return "—";
    const d = new Date(n);
    const now = Date.now();
    const diff = Math.max(0, now - n);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return magicT("刚刚");
    const min = Math.floor(sec / 60);
    if (min < 60) return min + magicT(" 分钟前");
    const hr = Math.floor(min / 60);
    if (hr < 48) return hr + magicT(" 小时前");
    const day = Math.floor(hr / 24);
    if (day < 14) return day + magicT(" 天前");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function magicFetchPromptHistory() {
    const r = await fetch(api.apiURL("/ma/prompt_history"), { credentials: "same-origin" });
    const j = await r.json();
    return {
        history: Array.isArray(j.history) ? j.history : [],
        favorites: Array.isArray(j.favorites) ? j.favorites : [],
        max_entries: j.max_entries ?? 20,
    };
}

async function magicPostPromptHistory(body) {
    const r = await fetch(api.apiURL("/ma/prompt_history"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    let j = null;
    try {
        j = JSON.parse(text);
    } catch (_) {
        /* ignore */
    }
    if (!r.ok || (j && j.status === "error")) {
        const msg = (j && j.message) || text || `HTTP ${r.status}`;
        throw new Error(msg);
    }
    return j;
}

// ============================================================
// 弹窗 UI 核心
// ============================================================

function preventConflict(element, { skipClick = false } = {}) {
    element.addEventListener("pointerdown", (e) => e.stopPropagation());
    element.addEventListener("mousedown", (e) => e.stopPropagation());
    if (!skipClick) element.addEventListener("click", (e) => e.stopPropagation());
    element.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
}

function makeDialogDraggable(dialog, titleBar) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    titleBar.style.cursor = "move";
    titleBar.style.userSelect = "none";

    const dragStart = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" ||
            e.target.tagName === "BUTTON" || e.target.closest("button")) {
            return;
        }
        const rect = dialog.getBoundingClientRect();
        let mouseX = e.type === "mousedown" ? e.clientX : e.touches[0].clientX;
        let mouseY = e.type === "mousedown" ? e.clientY : e.touches[0].clientY;
        offsetX = mouseX - rect.left;
        offsetY = mouseY - rect.top;
        isDragging = true;
        e.preventDefault();
    };

    const drag = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        let mouseX = e.type === "mousemove" ? e.clientX : e.touches[0].clientX;
        let mouseY = e.type === "mousemove" ? e.clientY : e.touches[0].clientY;
        let newX = mouseX - offsetX;
        let newY = mouseY - offsetY;
        const maxX = window.innerWidth - dialog.offsetWidth;
        const maxY = window.innerHeight - dialog.offsetHeight;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        // 移除原有定位方式
        dialog.style.top = "";
        dialog.style.left = "";
        dialog.style.right = "";
        dialog.style.bottom = "";

        // 如果父元素是 flex 居中，改为 block 固定定位
        const parent = dialog.parentElement;
        if (parent && parent.style.display === "flex") {
            parent.style.display = "block";
            parent.style.position = "fixed";
            parent.style.top = "0";
            parent.style.left = "0";
            parent.style.width = "100%";
            parent.style.height = "100%";
        }

        dialog.style.position = "fixed";
        dialog.style.transform = `translate(${newX}px, ${newY}px)`;
    };

    const dragEnd = () => { isDragging = false; };

    titleBar.addEventListener("mousedown", dragStart);
    titleBar.addEventListener("touchstart", dragStart);
    document.addEventListener("mousemove", drag);
    document.addEventListener("touchmove", drag);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("touchend", dragEnd);
}

/**
 * 右下角拖曳缩放弹窗（与标题栏拖拽配合：会先规范化为 top/left + 宽高）
 * @param {HTMLElement} dialog
 * @param {object} options
 * @param {number} [options.minWidth=420]
 * @param {number} [options.minHeight=260]
 * @param {number} [options.maxPad=16]
 * @param {function} [options.onResizeEnd] (width, height) => void
 */
function makeDialogResizable(dialog, options = {}) {
    const minW = options.minWidth ?? 420;
    const minH = options.minHeight ?? 260;
    const maxPad = options.maxPad ?? 16;
    const onResizeEnd = options.onResizeEnd;

    const handle = document.createElement("div");
    handle.title = magicT("拖动缩放窗体");
    handle.setAttribute("aria-label", "resize");
    handle.style.cssText = `
        position: absolute; right: 0; bottom: 0; width: 18px; height: 18px;
        cursor: se-resize; z-index: 20; display: flex; align-items: flex-end;
        justify-content: flex-end; padding: 0 3px 3px 0; box-sizing: border-box;
        color: ${THEME.text2};
    `;
    handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" style="pointer-events:none;opacity:0.65;"><path fill="currentColor" d="M12 12H8v-2h2V8h2v4zM12 6H8V4h4v2zM6 12H4v-2h2v2z"/></svg>`;
    preventConflict(handle);
    dialog.appendChild(handle);

    const normalizeLayout = () => {
        const r = dialog.getBoundingClientRect();
        dialog.style.top = `${Math.round(r.top)}px`;
        dialog.style.left = `${Math.round(r.left)}px`;
        dialog.style.width = `${Math.round(r.width)}px`;
        dialog.style.height = `${Math.round(r.height)}px`;
        dialog.style.transform = "none";
    };

    let resizing = false;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let sh = 0;

    const onMove = (e) => {
        if (!resizing) return;
        e.preventDefault();
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        const maxW = window.innerWidth - maxPad;
        const maxH = window.innerHeight - maxPad;
        let nw = Math.round(sw + dx);
        let nh = Math.round(sh + dy);
        nw = Math.max(minW, Math.min(nw, maxW));
        nh = Math.max(minH, Math.min(nh, maxH));
        dialog.style.width = `${nw}px`;
        dialog.style.height = `${nh}px`;
    };

    const onEnd = () => {
        resizing = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onEnd);
        document.removeEventListener("touchmove", onMoveTouch);
        document.removeEventListener("touchend", onEnd);
        if (onResizeEnd) onResizeEnd(parseInt(dialog.style.width), parseInt(dialog.style.height));
    };

    const onMoveTouch = (e) => {
        if (!resizing || !e.touches[0]) return;
        e.preventDefault();
        const te = e.touches[0];
        const dx = te.clientX - sx;
        const dy = te.clientY - sy;
        const maxW = window.innerWidth - maxPad;
        const maxH = window.innerHeight - maxPad;
        let nw = Math.round(sw + dx);
        let nh = Math.round(sh + dy);
        nw = Math.max(minW, Math.min(nw, maxW));
        nh = Math.max(minH, Math.min(nh, maxH));
        dialog.style.width = `${nw}px`;
        dialog.style.height = `${nh}px`;
    };

    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        normalizeLayout();
        const r = dialog.getBoundingClientRect();
        sx = e.clientX;
        sy = e.clientY;
        sw = r.width;
        sh = r.height;
        resizing = true;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onEnd);
    });

    handle.addEventListener("touchstart", (e) => {
        if (!e.touches[0]) return;
        e.preventDefault();
        e.stopPropagation();
        normalizeLayout();
        const r = dialog.getBoundingClientRect();
        const t = e.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        sw = r.width;
        sh = r.height;
        resizing = true;
        document.addEventListener("touchmove", onMoveTouch, { passive: false });
        document.addEventListener("touchend", onEnd);
    });
}

function closeModal(dialog) {
    if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
    }
}

// 弹窗主题色
const THEME = {
    bg: "#1e1e1e",
    bg2: "#252526",
    bg3: "#2d2d2d",
    border: "#3c3c3c",
    text: "#cccccc",
    text2: "#808080",
    accent: "#9C27B0",   // 紫色主题（与 Magic Assistant 一致）
    accent2: "#7B1FA2",
    hover: "#37373d",
    danger: "#f44336",
    success: "#4CAF50",
};

/** Tag 芯片：框选/多选/实时预览共用的高光（须与 refreshChipSelVisual 一致） */
const MAGIC_CHIP_SELECTED_GLOW =
    "0 0 0 2px #1890ff, 0 2px 10px rgba(24,144,255,0.35)";

/** 单击锁定工具栏时：芯片描边（与框选蓝光区分） */
const MAGIC_CHIP_TOOLBAR_PIN_OUTLINE = "2px solid rgba(186, 104, 200, 0.92)";
const MAGIC_CHIP_TOOLBAR_PIN_OFFSET = "2px";

/** 收藏列表变更后通知「编辑标签」弹窗刷新（若已打开） */
const MAGIC_TAG_SETS_CHANGED = "magic-assistant-tag-sets-changed";

function magicTagEnKey(s) {
    return String(s || "").trim().toLowerCase();
}

/**
 * 在主编辑 textarea 当前光标处插入英文 tag 片段；必要时补 ", "。
 * 点击「编辑标签」里的按钮时焦点会先离开 textarea，故用 mousedown 捕获阶段写入的
 * _magicLastCaret（与当前 value 长度一致时）恢复插入位置；否则插在末尾。
 */
function insertMagicPromptAtCaret(textarea, textToInsert, onAfter) {
    const raw = String(textToInsert || "").trim();
    if (!raw || !textarea) return;
    const v = textarea.value;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    const focusedHere = document.activeElement === textarea;
    if (focusedHere && typeof start === "number" && typeof end === "number" && start >= 0) {
        /* 使用实时 selection */
    } else {
        const mem = textarea._magicLastCaret;
        if (mem && typeof mem.start === "number" && mem.vlen === v.length) {
            start = Math.max(0, Math.min(mem.start, v.length));
            end = Math.max(0, Math.min(mem.end, v.length));
        } else {
            start = end = v.length;
        }
    }
    const before = v.slice(0, start);
    const after = v.slice(end);
    const needBefore = start > 0 && /[^\s,]/.test(before) && !/[,\n]\s*$/.test(before);
    const prefix = needBefore ? ", " : "";
    const needAfter = after.length > 0 && /[^\s,]/.test(after) && !/^\s*[,\n]/.test(after);
    const suffix = needAfter ? ", " : "";
    const insertion = prefix + raw + suffix;
    const newV = before + insertion + after;
    const norm = magicEnsureTrailingCommaPerLine(newV);
    const rawPos = (before + insertion).length;
    const newPos = magicMapCursorAfterEnsureTrailingComma(newV, rawPos);
    textarea.value = norm;
    textarea._magicLastCaret = { start: newPos, end: newPos, vlen: norm.length };
    try {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
    } catch (_) { /* ignore */ }
    if (typeof onAfter === "function") onAfter();
}

/** 编辑标签弹窗内搜索：与补全同接口；limit=0 时后端返回全部匹配（utils.py） */
const MAGIC_TAG_EDITOR_SEARCH_LIMIT = 0;
/** Danbooru 标签搜索单页条数（远端单次最多 100；滚动接近底部自动加载下一页） */
const DANBOORU_TAG_SEARCH_PAGE_SIZE = 100;

/** 卡片配色：新建 / 收藏（参考标签管理器色块头 + 深灰正文） */
const MAGIC_TAG_CARD_HEADER_NEW = "#9a8f4a";
const MAGIC_TAG_CARD_HEADER_FAV = "#5c6d8a";

/** 卡片正文预览：只展示前 maxTags 枚逗号分隔 tag，多则追加 ", ..." */
function magicFormatTagPreview(content, maxTags = 2) {
    const raw = (content || "").trim();
    if (!raw) return "";
    const parts = raw.split(/\s*,\s*/).filter((p) => p.length > 0);
    if (parts.length <= maxTags) return parts.join(", ");
    return `${parts.slice(0, maxTags).join(", ")}, ...`;
}

/**
 * POST /ma/tag_sets，失败时抛出带服务端 message 的 Error（便于排查 404/权限/JSON 等）。
 * 使用 new_tagsets 字段，避免极少数环境下键名 new 被异常处理。
 */
async function magicPostTagSets(body) {
    const r = await fetch(api.apiURL("/ma/tag_sets"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    let j = null;
    try {
        j = JSON.parse(text);
    } catch (_) {
        /* ignore */
    }
    if (!r.ok) {
        const msg =
            (j && (j.message || j.error || j.detail)) ||
            (text && text.length < 500 ? text : "") ||
            `HTTP ${r.status}（请确认已重启 ComfyUI 且扩展已加载）`;
        const err = new Error(msg);
        err.status = r.status;
        err.body = j;
        throw err;
    }
    return j;
}

/**
 * 「编辑标签」弹窗：三区域 UI（新建标签 / 收藏标签 可折叠卡片区 + 标签搜索表）。
 * 非模态：shell pointer-events:none，仅本窗体可点。
 * 搜索逻辑与提示词补全一致：GET /ma/prompt_autocomplete?q=&limit=（本地模式）
 * danbooru 模式：GET /ma/danbooru_autocomplete（远端，含分类）
 * @param {object} [ctx]
 * @param {function} [ctx.getTextarea] 主编辑区 textarea
 * @param {function} [ctx.afterInsert] 插入后回调（同步 editorText 等）
 * @param {boolean} [ctx.danbooruMode] 是否为 Danbooru 远端模式
 */
function showMagicEditTagsModal(shell, ctx = {}) {
    if (!shell) return;
    shell.querySelectorAll("[data-magic-edit-tags-modal='1']").forEach((el) => el.remove());

    const getTa = () => (typeof ctx.getTextarea === "function" ? ctx.getTextarea() : null);
    const doAfterInsert = () => {
        if (typeof ctx.afterInsert === "function") ctx.afterInsert();
    };
    const insertEn = (en) => insertMagicPromptAtCaret(getTa(), en, doAfterInsert);

    // Danbooru 模式
    const danbooruMode = !!(ctx && ctx.danbooruMode);

    let localNew = [];
    let localFav = [];

    const syncShellFavorites = () => {
        shell._magicFavoritesList = localFav.slice();
        shell._magicFavoriteEnKeys = new Set(localFav.map((x) => magicTagEnKey(x.content)));
    };

    const inner = document.createElement("div");
    inner.setAttribute("data-magic-edit-tags-modal", "1");
    inner.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 100070;
        pointer-events: auto;
        width: min(96vw, 720px); max-height: min(88vh, 720px);
        background: ${THEME.bg}; color: ${THEME.text};
        border: 1px solid ${THEME.border}; border-radius: 8px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.72);
        display: flex; flex-direction: column; overflow: hidden;
        min-height: 0;
        box-sizing: border-box;
    `;
    preventConflict(inner);

    const hdr = document.createElement("div");
    hdr.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
        padding: 12px 16px; background: ${THEME.bg2};
        border-bottom: 1px solid ${THEME.border};
        cursor: move; user-select: none;
    `;
    const hTitle = document.createElement("span");
    hTitle.textContent = magicT("🏷️ 编辑标签");
    hTitle.style.cssText = "font-size: 14px; font-weight: 600; color: #ddd;";
    const hClose = document.createElement("button");
    hClose.type = "button";
    hClose.textContent = "✕";
    hClose.setAttribute("aria-label", magicT("关闭"));
    hClose.style.cssText = `
        background: none; border: none; color: ${THEME.text2};
        cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px;
    `;
    hClose.addEventListener("mouseenter", () => { hClose.style.background = THEME.hover; });
    hClose.addEventListener("mouseleave", () => { hClose.style.background = "none"; });
    preventConflict(hClose);
    hdr.appendChild(hTitle);
    hdr.appendChild(hClose);
    inner.appendChild(hdr);
    makeDialogDraggable(inner, hdr);

    const body = document.createElement("div");
    // min-height:0 + overflow:hidden：让子项 flex 分区生效；表格只在下方区域内滚动，不挤扁上方卡片区
    body.style.cssText = `
        padding: 12px 14px 16px;
        flex: 1; min-height: 0; overflow: hidden;
        font-size: 13px; color: ${THEME.text2};
        line-height: 1.5;
        display: flex; flex-direction: column; gap: 0;
    `;
    preventConflict(body);

    const topZone = document.createElement("div");
    topZone.style.cssText = `
        flex-shrink: 0;
        max-height: min(40vh, 360px);
        overflow-x: hidden;
        overflow-y: auto;
        padding-right: 2px;
    `;
    preventConflict(topZone);

    /** null = 新建；数字 = 正在编辑 localNew 中下标 */
    let editingNewIndex = null;
    let newFormVisible = false;

    const newTagBar = document.createElement("div");
    newTagBar.style.cssText = `margin-bottom: 12px; flex-shrink: 0;`;
    const newTagToggle = document.createElement("button");
    newTagToggle.type = "button";
    newTagToggle.textContent = magicT("➕ 新建标签组");
    newTagToggle.style.cssText = `
        padding: 6px 12px; font-size: 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid ${THEME.accent}; background: rgba(156, 39, 176, 0.15);
        color: #e1bee7; font-weight: 600;
    `;
    preventConflict(newTagToggle);
    const newTagForm = document.createElement("div");
    newTagForm.style.cssText = `
        display: none; margin-top: 10px; padding: 12px;
        border: 1px solid ${THEME.border}; border-radius: 8px; background: ${THEME.bg3};
        box-sizing: border-box;
    `;
    preventConflict(newTagForm);
    const lblCn = document.createElement("label");
    lblCn.textContent = magicT("中文名称");
    lblCn.style.cssText = `display:block;font-size:11px;color:${THEME.text2};margin-bottom:4px;`;
    const inpCnNew = document.createElement("input");
    inpCnNew.type = "text";
    inpCnNew.placeholder = magicT("可选，如：我的画质组");
    inpCnNew.style.cssText = `
        width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 10px;
        border-radius: 6px; border: 1px solid ${THEME.border}; background: ${THEME.bg};
        color: ${THEME.text}; font-size: 13px;
    `;
    preventConflict(inpCnNew);
    const lblEn = document.createElement("label");
    lblEn.textContent = magicT("英文 tag 组合（逗号分隔，可多枚）");
    lblEn.style.cssText = `display:block;font-size:11px;color:${THEME.text2};margin-bottom:4px;`;
    const taEnNew = document.createElement("textarea");
    taEnNew.rows = 3;
    taEnNew.placeholder = magicT("如：masterpiece, best quality, absurdres");
    taEnNew.style.cssText = `
        width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 10px;
        border-radius: 6px; border: 1px solid ${THEME.border}; background: ${THEME.bg};
        color: ${THEME.text}; font-size: 12px; font-family: ui-monospace, monospace; resize: vertical;
    `;
    preventConflict(taEnNew);
    const formBtnRow = document.createElement("div");
    formBtnRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    const btnSaveNew = document.createElement("button");
    btnSaveNew.type = "button";
    btnSaveNew.textContent = magicT("保存到本地");
    btnSaveNew.style.cssText = `
        padding: 6px 14px; font-size: 12px; border-radius: 6px; cursor: pointer;
        border: none; background: ${THEME.success}; color: #fff; font-weight: 600;
    `;
    preventConflict(btnSaveNew);
    const btnCancelNew = document.createElement("button");
    btnCancelNew.type = "button";
    btnCancelNew.textContent = magicT("取消");
    btnCancelNew.style.cssText = `
        padding: 6px 14px; font-size: 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid ${THEME.border}; background: ${THEME.bg2}; color: ${THEME.text};
    `;
    preventConflict(btnCancelNew);
    formBtnRow.appendChild(btnSaveNew);
    formBtnRow.appendChild(btnCancelNew);
    newTagForm.appendChild(lblCn);
    newTagForm.appendChild(inpCnNew);
    newTagForm.appendChild(lblEn);
    newTagForm.appendChild(taEnNew);
    newTagForm.appendChild(formBtnRow);
    newTagBar.appendChild(newTagToggle);
    newTagBar.appendChild(newTagForm);

    const resetNewFormDraft = () => {
        editingNewIndex = null;
        inpCnNew.value = "";
        taEnNew.value = "";
        btnSaveNew.textContent = magicT("保存到本地");
    };

    const mkIconBtn = (label, title, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.style.cssText = `
            padding: 2px 6px; font-size: 12px; line-height: 1.25;
            border-radius: 4px; border: 1px solid rgba(0,0,0,0.28);
            background: rgba(255,255,255,0.4); color: #1a1a1a;
            cursor: pointer; font-weight: 700;
        `;
        b.addEventListener("mouseenter", () => {
            b.style.background = "rgba(255,255,255,0.72)";
        });
        b.addEventListener("mouseleave", () => {
            b.style.background = "rgba(255,255,255,0.4)";
        });
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            onClick(e);
        });
        preventConflict(b);
        return b;
    };

    /**
     * @param {"newTags" | "favorites"} cardMode — 决定卡片头操作按钮
     */
    const mkCollapsible = (sectionTitle, countHint, headerColor, cardItems, onCardClick, cardMode) => {
        const block = document.createElement("div");
        block.style.cssText = `
            margin-bottom: 12px;
            border: 1px solid ${THEME.border};
            border-radius: 8px;
            overflow: hidden;
            background: ${THEME.bg};
            flex-shrink: 0;
        `;
        let expanded = false;
        const headBtn = document.createElement("button");
        headBtn.type = "button";
        headBtn.style.cssText = `
            width: 100%; display: flex; align-items: center; justify-content: space-between;
            gap: 10px; padding: 10px 12px; margin: 0;
            background: ${THEME.bg3}; border: none; cursor: pointer;
            color: ${THEME.text}; font-size: 13px; font-weight: 600; text-align: left;
            box-sizing: border-box;
        `;
        preventConflict(headBtn);
        const headLeft = document.createElement("span");
        headLeft.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        const headLabel = document.createElement("span");
        headLabel.textContent = sectionTitle;
        headLabel.style.cssText = "white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
        const headBadge = document.createElement("span");
        headBadge.textContent = countHint;
        headBadge.style.cssText = `
            font-size: 11px; font-weight: 500; color: ${THEME.text2};
            flex-shrink: 0;
        `;
        headLeft.appendChild(headLabel);
        headLeft.appendChild(headBadge);
        const chev = document.createElement("span");
        chev.textContent = "▶";
        chev.style.cssText = `color:${THEME.text2}; font-size:10px; flex-shrink:0;`;
        headBtn.appendChild(headLeft);
        headBtn.appendChild(chev);

        const panel = document.createElement("div");
        panel.style.cssText = `padding: 12px; background: ${THEME.bg}; display: none;`;

        const renderCards = (items) => {
            panel.innerHTML = "";
            if (!items || !items.length) {
                const empty = document.createElement("div");
                empty.textContent = magicT("暂无标签，后续可在此管理。");
                empty.style.cssText = `text-align:center; padding:20px 12px; color:${THEME.text2}; font-size:12px;`;
                panel.appendChild(empty);
                headBadge.textContent = "0" + magicT(" 组");
                return;
            }
            headBadge.textContent = items.length + magicT(" 组");
            const grid = document.createElement("div");
            grid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
                gap: 10px;
            `;
            items.forEach((it, index) => {
                const card = document.createElement("div");
                card.style.cssText = `
                    border-radius: 6px; overflow: hidden;
                    border: 1px solid ${THEME.border};
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                `;
                if (typeof onCardClick === "function") {
                    card.style.cursor = "pointer";
                    card.title = magicT("点击卡片（除右上角按钮）将英文 tag 整组插入到主编辑区（不关闭本窗口）");
                    card.addEventListener("click", (e) => {
                        if (e.target && e.target.closest && e.target.closest("button")) return;
                        onCardClick(it);
                    });
                }
                const cap = document.createElement("div");
                cap.style.cssText = `
                    display: flex; align-items: flex-start; justify-content: space-between;
                    gap: 6px;
                    padding: 8px 10px; font-size: 12px; font-weight: 700;
                    color: #1a1a1a; background: ${headerColor};
                    line-height: 1.3;
                `;
                const capTitle = document.createElement("span");
                capTitle.textContent = it.name || magicT("未命名");
                capTitle.style.cssText = "flex: 1; min-width: 0; word-break: break-word;";
                cap.appendChild(capTitle);

                if (cardMode === "newTags") {
                    const btns = document.createElement("div");
                    btns.style.cssText = "display: flex; flex-shrink: 0; gap: 4px; align-items: flex-start;";
                    const bEdit = mkIconBtn("✎", magicT("修改中文名与英文 tag 组合"), () => {
                        editingNewIndex = index;
                        inpCnNew.value = it.name || "";
                        taEnNew.value = (it.content || "").trim();
                        newFormVisible = true;
                        newTagForm.style.display = "block";
                        newTagToggle.textContent = magicT("➖ 收起新建表单");
                        btnSaveNew.textContent = magicT("保存修改");
                    });
                    const bDel = mkIconBtn("🗑", magicT("删除此标签组"), async () => {
                        const name = (it.name || magicT("未命名")).trim();
                        if (!confirm(magicT("确定删除标签组「") + name + magicT("」？\n删除后不可恢复。"))) return;
                        const prev = localNew.slice();
                        localNew.splice(index, 1);
                        try {
                            await magicPostTagSets({ new_tagsets: localNew });
                            if (editingNewIndex === index) {
                                newFormVisible = false;
                                newTagForm.style.display = "none";
                                newTagToggle.textContent = magicT("➕ 新建标签组");
                                resetNewFormDraft();
                            } else if (editingNewIndex !== null && editingNewIndex > index) {
                                editingNewIndex -= 1;
                            }
                            secNew.renderCards(localNew);
                        } catch (e) {
                            localNew.length = 0;
                            prev.forEach((x) => localNew.push(x));
                            alert(
                                (e && e.message) ||
                                    magicT("删除失败。请检查 userdata 是否可写或是否已重启 ComfyUI。"),
                            );
                        }
                    });
                    btns.appendChild(bEdit);
                    btns.appendChild(bDel);
                    cap.appendChild(btns);
                } else if (cardMode === "favorites") {
                    const btns = document.createElement("div");
                    btns.style.cssText = "display: flex; flex-shrink: 0; gap: 4px; align-items: flex-start;";
                    const bDel = mkIconBtn("🗑", magicT("从收藏中删除"), async () => {
                        const name = (it.name || magicT("收藏")).trim();
                        if (!confirm(magicT("确定从收藏中删除「") + name + magicT("」？"))) return;
                        const prev = localFav.slice();
                        localFav.splice(index, 1);
                        try {
                            await magicPostTagSets({ favorites: localFav });
                            secFav.renderCards(localFav);
                            syncShellFavorites();
                            window.dispatchEvent(
                                new CustomEvent(MAGIC_TAG_SETS_CHANGED, {
                                    detail: { favorites: localFav.slice() },
                                }),
                            );
                        } catch (e) {
                            localFav.length = 0;
                            prev.forEach((x) => localFav.push(x));
                            alert(
                                (e && e.message) ||
                                    magicT("删除失败。请检查 userdata 是否可写或是否已重启 ComfyUI。"),
                            );
                        }
                    });
                    btns.appendChild(bDel);
                    cap.appendChild(btns);
                }

                const txt = document.createElement("div");
                txt.textContent = magicFormatTagPreview(it.content, 2);
                txt.style.cssText = `
                    padding: 8px 10px; font-size: 11px; color: ${THEME.text};
                    background: ${THEME.bg2}; word-break: break-word;
                    line-height: 1.45;
                    font-family: ui-monospace, monospace;
                `;
                card.appendChild(cap);
                card.appendChild(txt);
                grid.appendChild(card);
            });
            panel.appendChild(grid);
        };

        renderCards(cardItems);

        headBtn.addEventListener("click", () => {
            expanded = !expanded;
            panel.style.display = expanded ? "block" : "none";
            chev.textContent = expanded ? "▼" : "▶";
        });

        block.appendChild(headBtn);
        block.appendChild(panel);
        return { block, renderCards };
    };

    let secNew;
    let secFav;
    secNew = mkCollapsible(magicT("新建标签"), "", MAGIC_TAG_CARD_HEADER_NEW, [], (it) => insertEn(it.content), "newTags");
    secFav = mkCollapsible(
        magicT("收藏的标签"),
        "",
        MAGIC_TAG_CARD_HEADER_FAV,
        [],
        (it) => insertEn(it.content),
        "favorites",
    );

    newTagToggle.addEventListener("click", () => {
        const willShow = !newFormVisible;
        newFormVisible = !newFormVisible;
        newTagForm.style.display = newFormVisible ? "block" : "none";
        newTagToggle.textContent = newFormVisible ? magicT("➖ 收起新建表单") : magicT("➕ 新建标签组");
        if (willShow) resetNewFormDraft();
    });
    btnCancelNew.addEventListener("click", () => {
        newFormVisible = false;
        newTagForm.style.display = "none";
        newTagToggle.textContent = magicT("➕ 新建标签组");
        resetNewFormDraft();
    });
    btnSaveNew.addEventListener("click", async () => {
        const cn = inpCnNew.value.trim();
        let en = taEnNew.value
            .replace(/[\r\n]+/g, " ")
            .replace(/，/g, ",")
            .replace(/、/g, ",")
            .trim()
            .replace(/\s*,\s*/g, ", ")
            .replace(/,\s*,/g, ",");
        if (!en) {
            alert(magicT("请填写英文 tag 组合。"));
            return;
        }
        const isEdit = editingNewIndex !== null;
        let prevItem = null;
        if (isEdit) {
            prevItem = { ...localNew[editingNewIndex] };
            localNew[editingNewIndex] = { name: cn || "未命名", content: en };
        } else {
            localNew = localNew.concat([{ name: cn || "未命名", content: en }]);
        }
        try {
            await magicPostTagSets({ new_tagsets: localNew });
            secNew.renderCards(localNew);
            newFormVisible = false;
            newTagForm.style.display = "none";
            newTagToggle.textContent = magicT("➕ 新建标签组");
            resetNewFormDraft();
        } catch (e) {
            console.warn("[MagicText] save new tagset", e);
            if (isEdit) {
                if (prevItem && editingNewIndex !== null) localNew[editingNewIndex] = prevItem;
            } else {
                localNew.pop();
            }
            const hint =
                (e && e.message) ||
                magicT("保存失败。请检查：1) 已重启 ComfyUI；2) 插件目录下 userdata 可写；3) 浏览器 Network 里 POST /ma/tag_sets 的状态码。");
            alert(hint);
        }
    });

    topZone.appendChild(newTagBar);
    topZone.appendChild(secNew.block);
    topZone.appendChild(secFav.block);
    body.appendChild(topZone);

    const divider = document.createElement("div");
    divider.style.cssText = `
        height: 1px; background: ${THEME.border};
        margin: 10px 0 12px; flex-shrink: 0;
    `;
    body.appendChild(divider);

    const bottomZone = document.createElement("div");
    bottomZone.style.cssText = `
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;
    preventConflict(bottomZone);

    const searchTitle = document.createElement("div");
    searchTitle.textContent = magicT("标签搜索");
    searchTitle.style.cssText = `
        font-size: 12px; font-weight: 700; color: ${THEME.text};
        margin-bottom: 8px; letter-spacing: 0.02em;
        flex-shrink: 0;
    `;
    bottomZone.appendChild(searchTitle);

    const searchRow = document.createElement("div");
    searchRow.style.cssText = `
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px;
        flex-shrink: 0;
    `;
    const searchInp = document.createElement("input");
    searchInp.type = "text";
    searchInp.placeholder = magicT("输入英文 tag 或中文关键词…");
    searchInp.style.cssText = `
        flex: 1; min-width: 160px; padding: 8px 10px; border-radius: 6px;
        border: 1px solid ${THEME.border}; background: ${THEME.bg3}; color: ${THEME.text};
        font-size: 13px; box-sizing: border-box; outline: none;
    `;
    preventConflict(searchInp);
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.textContent = magicT("搜索");
    searchBtn.style.cssText = `
        padding: 8px 18px; border: none; border-radius: 6px; cursor: pointer;
        font-size: 13px; font-weight: 600; color: #fff;
        background: #1976d2; flex-shrink: 0;
    `;
    preventConflict(searchBtn);
    searchBtn.addEventListener("mouseenter", () => { searchBtn.style.opacity = "0.92"; });
    searchBtn.addEventListener("mouseleave", () => { searchBtn.style.opacity = "1"; });
    searchRow.appendChild(searchInp);
    searchRow.appendChild(searchBtn);
    bottomZone.appendChild(searchRow);

    let lastFetchedItems = [];
    let editTagsCatFilter = null;
    let editTagsCatSelect = null;
    /** Danbooru：搜索框与表格之间的条数统计行 */
    let searchStatRow = null;
    let danbooruTagSearchHasMore = false;
    let danbooruTagSearchPage = 1;
    let lastDanbooruSearchQuery = "";
    let danbooruLoadingMore = false;
    if (danbooruMode) {
        searchStatRow = document.createElement("div");
        searchStatRow.style.cssText = `
            font-size: 10px; color: ${THEME.text2}; margin: 0 0 8px 2px;
            line-height: 1.45; min-height: 16px;
        `;
        searchStatRow.textContent = ""; // 搜索后由 refreshTagSearchStat 填充
        bottomZone.appendChild(searchStatRow);
    }

    function refreshTagSearchStat() {
        if (!danbooruMode || !searchStatRow) return;
        const n = lastFetchedItems.length;
        const filtered =
            editTagsCatFilter == null
                ? lastFetchedItems
                : lastFetchedItems.filter((it) => it.category === editTagsCatFilter);
        const m = filtered.length;
        const parts = [];
        if (n > 0) {
            parts.push(magicT("已加载") + " " + n + " " + magicT("条"));
            if (editTagsCatFilter != null) {
                parts.push(magicT("· 筛选显示") + " " + m + " " + magicT("条"));
            }
            if (danbooruTagSearchHasMore) {
                parts.push(magicT("· 下拉列表可加载更多"));
            } else {
                parts.push(magicT("· 已全部加载"));
            }
        }
        searchStatRow.textContent = parts.join(" ");
    }

    /** 与 utils.ma_normalize_en_for_tag_match 一致：空格/下划线等价，避免分页合并时同一 tag 两种写法各出现一次 */
    const danbooruRowDedupeKey = (it) => {
        const s = String((it && (it.raw || it.en)) || "")
            .trim()
            .toLowerCase();
        if (!s) return "";
        return s.replace(/[\s_]+/g, "_").replace(/^_+|_+$/g, "");
    };
    const mergeDanbooruTagItems = (a, b) => {
        const seen = new Set(a.map((it) => danbooruRowDedupeKey(it)).filter(Boolean));
        const out = [...a];
        for (const it of b) {
            const k = danbooruRowDedupeKey(it);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(it);
        }
        return out;
    };

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = `
        flex: 1;
        min-height: 120px;
        border: 1px solid ${THEME.border}; border-radius: 6px;
        overflow: auto;
        background: ${THEME.bg2};
    `;
    preventConflict(tableWrap);

    const table = document.createElement("table");
    table.style.cssText = "width:100%; border-collapse:collapse; font-size:12px;";
    const thead = document.createElement("thead");
    const thr = document.createElement("tr");
    thr.style.cssText = `background:${THEME.bg3}; color:${THEME.text2};`;
    thead.style.cssText = `position: sticky; top: 0; z-index: 2; box-shadow: 0 1px 0 ${THEME.border};`;

    if (danbooruMode) {
        // 固定列宽 + table-layout:fixed，表头与单元格 text-align 一致，避免「分类」「热度」错位
        table.style.tableLayout = "fixed";
        const cg = document.createElement("colgroup");
        const colSpecs = [
            { w: "32%" },
            { w: "24%" },
            { w: "112px" },
            { w: "76px" },
            { w: "76px" },
        ];
        colSpecs.forEach(({ w }) => {
            const col = document.createElement("col");
            col.style.width = w;
            cg.appendChild(col);
        });
        table.appendChild(cg);

        const thAlign = ["left", "left", "center", "right", "center"];
        const colHdr = [
            magicT("Tag"),
            magicT("中文"),
            null,
            magicT("热度"),
            magicT("操作"),
        ];
        for (let i = 0; i < 5; i++) {
            const th = document.createElement("th");
            if (i === 2) {
                th.style.cssText = `
                    padding: 5px 4px;
                    text-align: center;
                    font-weight: 600;
                    border-bottom: 1px solid ${THEME.border};
                    box-sizing: border-box;
                    vertical-align: middle;
                `;
                const catHeadRow = document.createElement("div");
                catHeadRow.style.cssText =
                    "display:flex;flex-direction:row;align-items:center;justify-content:center;gap:3px;";
                const catTitle = document.createElement("span");
                catTitle.textContent = magicT("分类");
                catTitle.style.cssText = "font-size:10px;line-height:1;white-space:nowrap;";
                editTagsCatSelect = document.createElement("select");
                editTagsCatSelect.title = magicT("按分类筛选");
                editTagsCatSelect.style.cssText = `
                    flex:0 1 auto;width:auto;max-width:54px;min-width:0;height:17px;
                    line-height:15px;padding:0 1px 0 2px;margin:0;
                    font-size:9px;font-weight:600;font-family:inherit;
                    background:${THEME.bg3};color:${THEME.text};
                    border:1px solid ${THEME.border};border-radius:3px;
                    outline:none;cursor:pointer;box-sizing:border-box;
                `;
                DANBOORU_CAT_FILTER_OPTIONS.forEach((opt) => {
                    const op = document.createElement("option");
                    op.value = opt.value === null ? "" : String(opt.value);
                    op.textContent = opt.label;
                    editTagsCatSelect.appendChild(op);
                });
                preventConflict(editTagsCatSelect);
                editTagsCatSelect.addEventListener("change", () => {
                    const v = editTagsCatSelect.value;
                    editTagsCatFilter = v === "" ? null : Number(v);
                    refreshTagSearchStat();
                    if (lastFetchedItems.length) {
                        const emptyMsg = lastFetchedItems.length
                            ? magicT("该分类下无结果。")
                            : magicT("无结果，请更换关键词。");
                        const filtered =
                            editTagsCatFilter == null
                                ? lastFetchedItems
                                : lastFetchedItems.filter((it) => it.category === editTagsCatFilter);
                        renderSearchRows(filtered, emptyMsg);
                    }
                });
                catHeadRow.appendChild(catTitle);
                catHeadRow.appendChild(editTagsCatSelect);
                th.appendChild(catHeadRow);
            } else {
                th.textContent = colHdr[i];
                th.style.cssText = `
                    padding: 8px 8px;
                    text-align: ${thAlign[i]};
                    font-weight: 600;
                    border-bottom: 1px solid ${THEME.border};
                    box-sizing: border-box;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                `;
            }
            thr.appendChild(th);
        }
    } else {
        [magicT("Tag"), magicT("中文"), magicT("操作")].forEach((label, i) => {
            const th = document.createElement("th");
            th.textContent = label;
            th.style.cssText = `
                padding: 8px 10px; text-align: ${i === 2 ? "center" : "left"};
                font-weight: 600; border-bottom: 1px solid ${THEME.border};
                ${i === 0 ? "width:36%;" : ""}
                ${i === 2 ? "width:76px;" : ""}
            `;
            thr.appendChild(th);
        });
    }
    thead.appendChild(thr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    bottomZone.appendChild(tableWrap);

    const searchHint = document.createElement("div");
    searchHint.style.cssText = danbooruMode
        ? `
        margin-top: 8px; font-size: 11px; line-height: 1.45; flex-shrink: 0;
        color: ${THEME.success};
        padding: 8px 10px; border-radius: 6px;
        background: ${THEME.bg3};
        border: 1px solid rgba(76, 175, 80, 0.35);
    `
        : `
        margin-top: 8px; font-size: 11px; color: ${THEME.text2}; line-height: 1.45;
        flex-shrink: 0;
    `;
    if (danbooruMode) {
        // 与后端一致：Danbooru 只按英文 tag 名检索；「中文」列是本地词库释义，易与「中文包含」误解
        searchHint.innerHTML =
            magicT(
                "【Danbooru 远端】英文：多页取回后排序——有本地中文释义的优先于无中文，再按热度。中文搜索：词库译成英文根后向 Danbooru 按英文名匹配；「中文」列须命中你的词，且查询不少于 3 字时排除「更长前缀复合释义」（如搜「健身房」不显示释义为「健身房淋浴」的 tag）。「中文」列来自本地词库。若出现与前排相似的英文名，多为远端另一条独立 tag（含错拼），无预设译名时「中文」为—。",
            ) +
            magicT("（每页最多 100 条，向下滚动加载更多；关键词过短建议打更完整的词。）");
    } else {
        searchHint.innerHTML =
            magicT("匹配方式与提示词补全相同：英文 ") + "<b>" + magicT("包含") + "</b>" +
            magicT("（不区分大小写），中文 ") + "<b>" + magicT("包含") + "</b>" + magicT("。") +
            "<b>" + magicT("显示全部") + "</b>" + magicT("匹配结果（无条数上限）；自建标签组优先列出。关键词过短时结果可能很多，建议打全名缩小范围。");
    }
    bottomZone.appendChild(searchHint);

    body.appendChild(bottomZone);

    const fmtCount = (n) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
        if (n >= 1000) return (n / 1000).toFixed(1) + "K";
        return String(n || 0);
    };

    const renderSearchRows = (items, emptyMessage) => {
        tbody.innerHTML = "";
        const colSpan = danbooruMode ? 5 : 3;
        if (!items || !items.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = colSpan;
            td.textContent = emptyMessage || magicT("无结果，请更换关键词。");
            td.style.cssText = `padding:20px;text-align:center;color:${THEME.text2};`;
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        items.forEach((row) => {
            const tr = document.createElement("tr");
            tr.style.cssText = `border-bottom:1px solid ${THEME.border};`;
            tr.addEventListener("mouseenter", () => { tr.style.background = THEME.hover; });
            tr.addEventListener("mouseleave", () => { tr.style.background = "transparent"; });

            if (danbooruMode) {
                // Danbooru 模式：英文 / 中文 / 分类 / 热度 / 操作（与 thead 同 padding、text-align）
                const cellBase = `box-sizing:border-box;padding:8px 8px;vertical-align:middle;`;
                const tdEn = document.createElement("td");
                tdEn.style.cssText = `${cellBase}color:${THEME.text};text-align:left;overflow:hidden;`;
                const enText = document.createElement("span");
                enText.textContent = row.en || "";
                enText.style.cssText = "word-break:break-all;";
                tdEn.appendChild(enText);

                const tdCn = document.createElement("td");
                tdCn.textContent = row.cn || "—";
                tdCn.style.cssText = `${cellBase}color:${THEME.text2};text-align:left;word-break:break-word;`;

                const ck = magicDanbooruCategoryId(row);
                const catColor = DANBOORU_CATEGORY_COLORS[ck] || "#888";
                const catName = DANBOORU_CATEGORY_NAMES[ck] || "other";
                const tdCat = document.createElement("td");
                tdCat.style.cssText = `${cellBase}text-align:center;`;
                const catBadge = document.createElement("span");
                catBadge.textContent = catName;
                catBadge.style.cssText = `
                    display:inline-block; padding:1px 5px; font-size:9px; border-radius:3px;
                    background:${catColor}1a; color:${catColor}; border:1px solid ${catColor}55;
                    font-weight:600; max-width:100%; overflow:hidden; text-overflow:ellipsis;
                `;
                tdCat.appendChild(catBadge);

                const tdCnt = document.createElement("td");
                tdCnt.textContent = fmtCount(row.count);
                tdCnt.style.cssText = `${cellBase}color:${THEME.text2};font-size:11px;text-align:right;font-variant-numeric:tabular-nums;`;

                const tdOp = document.createElement("td");
                tdOp.style.cssText = `${cellBase}text-align:center;`;
                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.textContent = magicT("添加");
                addBtn.style.cssText = `
                    padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer;
                    border: 1px solid ${THEME.accent}; background: rgba(156, 39, 176, 0.2);
                    color: #e1bee7; font-weight: 600;
                `;
                preventConflict(addBtn);
                addBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertEn(row.en || "");
                });
                tdOp.appendChild(addBtn);

                tr.appendChild(tdEn);
                tr.appendChild(tdCn);
                tr.appendChild(tdCat);
                tr.appendChild(tdCnt);
                tr.appendChild(tdOp);
            } else {
                // 本地模式：英文 / 中文 / 操作
                const tdEn = document.createElement("td");
                tdEn.style.cssText = `padding:8px 10px;color:${THEME.text};vertical-align:middle;display:flex;align-items:center;gap:0;`;
                const enText = document.createElement("span");
                enText.style.cssText = "word-break:break-all;flex-shrink:1;";
                const enFull = row.en || "";
                const enShow =
                    row.kind === "tagset" ? magicFormatTagPreview(enFull, 2) : enFull;
                enText.textContent = enShow;
                if (row.kind === "tagset" && enFull && enFull !== enShow) {
                    enText.title = enFull;
                }
                tdEn.appendChild(enText);
                if (row.source === "custom") {
                    const badge = document.createElement("span");
                    badge.textContent = magicT("用户");
                    badge.title =
                        row.kind === "tagset"
                            ? `标签组「${row.setName || row.cn || "自定义"}」· 添加为整段`
                            : `来自「${row.setName || "自定义"}」`;
                    badge.style.cssText = `
                        margin-left: 6px; padding: 1px 5px; font-size: 10px;
                        border-radius: 3px; background: rgba(156, 39, 176, 0.28);
                        color: #ce93d8; font-weight: 600; flex-shrink: 0;
                        vertical-align: middle; line-height: 1.4;
                    `;
                    tdEn.appendChild(badge);
                }
                const tdCn = document.createElement("td");
                tdCn.textContent = row.cn || "—";
                tdCn.style.cssText = `padding:8px 10px;color:${THEME.text2};vertical-align:middle;word-break:break-word;`;
                const tdOp = document.createElement("td");
                tdOp.style.cssText = "padding:6px 8px;text-align:center;vertical-align:middle;";
                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.textContent = magicT("添加");
                addBtn.style.cssText = `
                    padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer;
                    border: 1px solid ${THEME.accent}; background: rgba(156, 39, 176, 0.2);
                    color: #e1bee7; font-weight: 600;
                `;
                preventConflict(addBtn);
                addBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertEn(row.en || "");
                });
                tdOp.appendChild(addBtn);
                tr.appendChild(tdEn);
                tr.appendChild(tdCn);
                tr.appendChild(tdOp);
            }
            tbody.appendChild(tr);
        });
    };

    const setSearchLoading = (on) => {
        tbody.innerHTML = "";
        const colSpan = danbooruMode ? 5 : 3;
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = colSpan;
        td.textContent = on ? magicT("搜索中…") : "";
        td.style.cssText = `padding:20px;text-align:center;color:${THEME.text2};`;
        tr.appendChild(td);
        tbody.appendChild(tr);
    };

    const loadMoreDanbooruTags = async () => {
        if (!danbooruMode || !danbooruTagSearchHasMore || danbooruLoadingMore || !lastDanbooruSearchQuery) {
            return;
        }
        danbooruLoadingMore = true;
        const nextPage = danbooruTagSearchPage + 1;
        try {
            const res = await magicDanbooruSearch(
                lastDanbooruSearchQuery,
                DANBOORU_TAG_SEARCH_PAGE_SIZE,
                nextPage,
            );
            if (!res.items.length) {
                danbooruTagSearchHasMore = false;
                refreshTagSearchStat();
                return;
            }
            lastFetchedItems = mergeDanbooruTagItems(lastFetchedItems, res.items);
            danbooruTagSearchPage = nextPage;
            danbooruTagSearchHasMore = res.hasMore;
            refreshTagSearchStat();
            const emptyMsg = lastFetchedItems.length
                ? magicT("该分类下无结果。")
                : magicT("无结果，请更换关键词。");
            const filtered =
                editTagsCatFilter == null
                    ? lastFetchedItems
                    : lastFetchedItems.filter((it) => it.category === editTagsCatFilter);
            renderSearchRows(filtered, emptyMsg);
        } catch (e) {
            console.warn("[MagicText] loadMoreDanbooruTags", e);
        } finally {
            danbooruLoadingMore = false;
        }
    };

    const runSearch = async () => {
        const q = (searchInp.value || "").trim();
        if (!q) {
            lastFetchedItems = [];
            lastDanbooruSearchQuery = "";
            danbooruTagSearchHasMore = false;
            danbooruTagSearchPage = 1;
            if (searchStatRow) searchStatRow.textContent = "";
            renderSearchRows([], magicT("请输入关键词后点击搜索。"));
            return;
        }
        searchBtn.disabled = true;
        setSearchLoading(true);
        try {
            let items = [];
            const isCnQuery = Boolean(q && /[\u4e00-\u9fff]/.test(q));
            if (danbooruMode) {
                lastDanbooruSearchQuery = q;
                danbooruTagSearchPage = 1;
                const res = await magicDanbooruSearch(q, DANBOORU_TAG_SEARCH_PAGE_SIZE, 1);
                items = res.items || [];
                danbooruTagSearchHasMore = res.hasMore;
                // 更新统计行提示（中文查询时）
                if (searchStatRow) {
                    const hasCnTranslate = Array.isArray(res.cnTranslate) && res.cnTranslate.length > 0;
                    if (isCnQuery && hasCnTranslate) {
                        const translatedEn = (res.cnTranslate || []).slice(0, 3).join(", ");
                        searchStatRow.textContent =
                            magicT("中文「") + q + magicT("」→「") + translatedEn + magicT("」已翻译为英文，从 Danbooru 获取热度排序");
                    } else if (isCnQuery && !items.length) {
                        searchStatRow.textContent = magicT("本地词库未找到「") + q + magicT("」的对应英文，Danbooru 无法直接搜索中文");
                    } else {
                        searchStatRow.textContent = "";
                    }
                }
            } else {
                // 本地模式搜索
                const params = new URLSearchParams({
                    q,
                    limit: String(MAGIC_TAG_EDITOR_SEARCH_LIMIT),
                });
                const url = api.apiURL(`/ma/prompt_autocomplete?${params.toString()}`);
                const res = await fetch(url, { credentials: "same-origin" });
                const data = await res.json();
                items = Array.isArray(data.items) ? data.items : [];
            }
            // 保存结果并重置分类筛选
            lastFetchedItems = items;
            if (editTagsCatSelect) {
                editTagsCatSelect.value = "";
                editTagsCatFilter = null;
            }
            renderSearchRows(
                items,
                items.length ? undefined : magicT("无结果，请更换关键词。"),
            );
            if (danbooruMode) {
                refreshTagSearchStat();
                void (async () => {
                    for (let i = 0; i < 30; i++) {
                        await new Promise((r) => requestAnimationFrame(r));
                        if (!danbooruTagSearchHasMore || danbooruLoadingMore) break;
                        const el = tableWrap;
                        if (el.scrollHeight > el.clientHeight + 10) break;
                        await loadMoreDanbooruTags();
                    }
                })();
            }
        } catch (err) {
            console.warn("[MagicText] tag search", err);
            tbody.innerHTML = "";
            const colSpan = danbooruMode ? 5 : 3;
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = colSpan;
            td.textContent = magicT("搜索失败，请稍后重试。");
            td.style.cssText = "padding:20px;text-align:center;color:#e57373;";
            tr.appendChild(td);
            tbody.appendChild(tr);
            if (searchStatRow) searchStatRow.textContent = "";
        } finally {
            searchBtn.disabled = false;
        }
    };

    if (danbooruMode) {
        let scrollTimer = null;
        tableWrap.addEventListener("scroll", () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                if (!danbooruTagSearchHasMore || danbooruLoadingMore) return;
                const el = tableWrap;
                if (el.scrollHeight <= el.clientHeight + 2) return;
                if (el.scrollTop + el.clientHeight < el.scrollHeight - 48) return;
                void loadMoreDanbooruTags();
            }, 120);
        });
    }

    searchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        runSearch();
    });
    searchInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runSearch();
        }
    });

    renderSearchRows([], magicT("请输入关键词后点击搜索。"));

    inner.appendChild(body);

    const tagSetsAbort = new AbortController();
    const onTagSetsChangedEv = () => {
        if (!inner.isConnected) return;
        fetch(api.apiURL("/ma/prompt_autocomplete/invalidate"), {
            method: "POST",
            credentials: "same-origin",
        }).catch(() => {});
        fetch(api.apiURL("/ma/tag_sets"), { credentials: "same-origin", signal: tagSetsAbort.signal })
            .then((r) => r.json())
            .then((d) => {
                if (Array.isArray(d.new)) {
                    localNew = d.new;
                    secNew.renderCards(localNew);
                }
                localFav = Array.isArray(d.favorites) ? d.favorites : [];
                secFav.renderCards(localFav);
                syncShellFavorites();
            })
            .catch(() => {});
    };
    window.addEventListener(MAGIC_TAG_SETS_CHANGED, onTagSetsChangedEv, { signal: tagSetsAbort.signal });

    (async () => {
        try {
            const r = await fetch(api.apiURL("/ma/tag_sets"), {
                credentials: "same-origin",
                signal: tagSetsAbort.signal,
            });
            const d = await r.json();
            localNew = Array.isArray(d.new) ? d.new : [];
            localFav = Array.isArray(d.favorites) ? d.favorites : [];
            secNew.renderCards(localNew);
            secFav.renderCards(localFav);
            syncShellFavorites();
        } catch (e) {
            if (e.name !== "AbortError") console.warn("[MagicText] tag_sets load", e);
        }
    })();

    const close = () => {
        try {
            tagSetsAbort.abort();
        } catch (_) { /* ignore */ }
        try {
            inner.remove();
        } catch (_) { /* ignore */ }
    };
    hClose.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
    });

    shell.appendChild(inner);
}

const AUTOCOMPLETE_LIMIT = 50;
/** 与 settings.editor_toolbar 键一致 */
const MAGIC_DEFAULT_EDITOR_TOOLBAR = {
    format: true,
    dedup: true,
    clear_all: true,
    clear_disabled: true,
    copy: true,
    edit_tags: true,
    translate_all: true,
    translate_input: true,
    /** 内联补全弹窗：false 时编辑框输入不弹出候选列表 */
    autocomplete_popup: true,
};

/** 与 utils.MagicUtils._DEFAULT_SETTINGS.format_options / ma_prompt_cleaning 一致 */
const MAGIC_DEFAULT_FORMAT_OPTIONS = {
    cleanup_commas: true,
    cleanup_whitespace: true,
    remove_lora_tags: false,
    cleanup_newlines: "false",
    fix_brackets: "both",
    underscore_to_space: true,
    complete_weight_syntax: true,
    smart_bracket_escaping: true,
    standardize_commas: true,
};

function magicMergeEditorToolbar(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    return { ...MAGIC_DEFAULT_EDITOR_TOOLBAR, ...o };
}

function magicMergeFormatOptions(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const out = { ...MAGIC_DEFAULT_FORMAT_OPTIONS, ...o };
    const nl = String(out.cleanup_newlines || "false");
    out.cleanup_newlines = ["false", "space", "comma"].includes(nl) ? nl : "false";
    const fb = String(out.fix_brackets || "both");
    out.fix_brackets = ["false", "parenthesis", "brackets", "both"].includes(fb) ? fb : "both";
    return out;
}

function magicClampAutocompleteLimit(n) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return AUTOCOMPLETE_LIMIT;
    return Math.max(1, Math.min(500, x));
}

const AUTOCOMPLETE_DEBOUNCE_MS = 160;
/** 补全浮层宽度（固定紧凑，不随整行文本框拉满） */
const AUTOCOMPLETE_PANEL_WIDTH_PX = 328;

/** Danbooru 远端 API 地址 */
const DANBOORU_API = "https://danbooru.donmai.us";

/** Danbooru 分类颜色（与参考代码一致） */
const DANBOORU_CATEGORY_COLORS = {
    0: "#4e9af1",
    1: "#f1964e",
    3: "#c84ef1",
    4: "#4ef17a",
    5: "#f14e4e",
};

/** Danbooru 分类名称 */
const DANBOORU_CATEGORY_NAMES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
};

/** 远端返回的 category（0 为 general）；避免 undefined 被当成无分类显示成 other */
function magicDanbooruCategoryId(it) {
    const v = it == null ? undefined : it.category;
    if (v === 0 || v === "0") return 0;
    if (v == null || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** 分类筛选下拉选项（用于补全弹窗和标签搜索） */
const DANBOORU_CAT_FILTER_OPTIONS = [
    { value: null,   label: "全部" },
    { value: 0,      label: "general" },
    { value: 1,      label: "artist" },
    { value: 3,      label: "copyright" },
    { value: 4,      label: "character" },
    { value: 5,      label: "meta" },
];

/** 与 userdata/settings.txt 中 danbooru_mode 一致：仅 local | danbooru */
function magicNormalizeDanbooruMode(v) {
    const s = v == null ? "" : String(v).trim().toLowerCase();
    return s === "danbooru" ? "danbooru" : "local";
}

/**
 * 仅更新 danbooru_mode（POST /ma/settings 会合并写入 settings.txt）
 */
async function magicPersistDanbooruModeOnly(mode) {
    const m = magicNormalizeDanbooruMode(mode);
    try {
        const r = await fetch("/ma/settings", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ danbooru_mode: m }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return true;
    } catch (e) {
        console.warn("[MagicText] magicPersistDanbooruModeOnly", e);
        return false;
    }
}

/**
 * 检测 Danbooru 远端是否可达。
 * 返回 Promise<{ok, message}>。
 */
async function magicDanbooruCheckConnection() {
    try {
        const r = await fetch(api.apiURL("/ma/danbooru_check_connection"), {
            credentials: "same-origin",
            signal: AbortSignal.timeout(10000),
        });
        const j = await r.json();
        return j;
    } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) };
    }
}

/** 与 utils.ma_strip_autocomplete_query_edges 一致 */
function magicStripAutocompleteQueryEdges(q) {
    if (q == null || typeof q !== "string") return "";
    let s = q.trim();
    const stripChars = " \t\n\r\u3000\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A,.!?;:";
    while (s && stripChars.indexOf(s[0]) !== -1) s = s.slice(1);
    while (s && stripChars.indexOf(s[s.length - 1]) !== -1) s = s.slice(0, -1);
    return s.trim();
}

/** 与 utils._is_chinese_query（任意字符 ord>=0x4E00）一致 */
function magicDanbooruQueryIsChinese(text) {
    if (!text) return false;
    for (const ch of text) {
        if (ch.codePointAt(0) >= 0x4e00) return true;
    }
    return false;
}

/** 与 utils._ma_danbooru_chinese_query_matches_gloss 一致（≥3 字排除更长前缀复合释义） */
function magicDanbooruChineseQueryMatchesGloss(q, cnGloss) {
    const qn = (q == null ? "" : String(q)).trim();
    const s = (cnGloss == null ? "" : String(cnGloss)).trim();
    if (!qn || !s || !s.includes(qn)) return false;
    if (s === qn) return true;
    if (qn.length >= 3 && s.startsWith(qn) && s.length > qn.length) return false;
    return true;
}

/**
 * Danbooru 模式下的搜索（分页）。
 * @param {string} [source] - "remote"（默认，远端 Danbooru）或 "preset"（本地 danbooru预设库，毫秒级）
 * @returns Promise<{ items, hasMore, page, cnTranslate }>
 */
async function magicDanbooruSearch(q, limit, page = 1, signal, source = "remote") {
    const params = new URLSearchParams({
        q,
        limit: String(limit || 100),
        page: String(page || 1),
    });
    if (source !== "remote") {
        params.set("source", source);
    }
    const r = await fetch(api.apiURL(`/ma/danbooru_autocomplete?${params.toString()}`), {
        credentials: "same-origin",
        signal,
    });
    if (!r.ok) {
        return { items: [], hasMore: false, page: page || 1, cnTranslate: null };
    }
    const j = await r.json();
    const items = Array.isArray(j.items) ? j.items : [];
    return {
        items,
        hasMore: j.has_more === true,
        page: typeof j.page === "number" ? j.page : page,
        cnTranslate: Array.isArray(j.cn_translate) ? j.cn_translate : null,
    };
}

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/** 弹窗内编辑区「上次高度」持久化到 settings.dialog_size.textareaMinHeight（历史字段名；实际存的是 height，不是 CSS min-height） */
const TEXTAREA_HEIGHT_MIN = 80;
const TEXTAREA_HEIGHT_MAX = 1200;
/** 布局用 min-height：须保持较小，否则与保存的大 height 相同会导致无法再用把手缩小 */
const TEXTAREA_RESIZE_FLOOR_PX = TEXTAREA_HEIGHT_MIN;
const TEXTAREA_RESIZE_SAVE_DEBOUNCE_MS = 400;

function clampTextareaHeightPx(h) {
    const n = Math.round(Number(h));
    if (!Number.isFinite(n)) return null;
    return Math.max(TEXTAREA_HEIGHT_MIN, Math.min(TEXTAREA_HEIGHT_MAX, n));
}

function readMagicTextareaHeightPx(ta, fallback) {
    const fb = clampTextareaHeightPx(fallback) ?? 160;
    if (!ta) return fb;
    const sh = parseInt(ta.style.height, 10);
    if (Number.isFinite(sh) && sh > 0) {
        const c = clampTextareaHeightPx(sh);
        if (c != null) return c;
    }
    const oh = Math.round(ta.offsetHeight);
    const c = clampTextareaHeightPx(oh);
    return c != null ? c : fb;
}

function persistMagicDialogSize(dialog, dlgCfg) {
    if (!dialog) return;
    const w = dialog.offsetWidth;
    const h = dialog.offsetHeight;
    const ta = dialog.querySelector("[data-magic-ta]");
    const taH = readMagicTextareaHeightPx(ta, dlgCfg.textareaMinHeight ?? 160);
    dlgCfg.textareaMinHeight = taH;
    fetch("/ma/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialog_size: { width: w, height: h, textareaMinHeight: taH } }),
    }).catch(() => {});
}

/** 主框是否应显示下方 Tag 区：完全空隐藏；仅有空格且无换行也隐藏；含换行即算有内容（对齐 WeiLin） */
function magicPromptHasVisibleContent(raw) {
    const s = raw ?? "";
    if (!s.length) return false;
    if (s.includes("\n")) return true;
    return s.trim().length > 0;
}

/** 屏蔽 tag 的前缀字符（! → *，避免与 !? 等表情/tag 混合用法冲突） */
const DISABLE_PREFIX = "*";
const DISABLE_REG = /^\*/;
function isDisabledTag(t) {
    return DISABLE_REG.test(t);
}

/**
 * 「:(」「>:(」等表情里的 '(' 不是 A1111/分组括号，不应提高深度，否则其后逗号无法切 tag。
 */
function magicIsEmoticonOpenParen(buf, ch) {
    if (ch !== "(") return false;
    if (/[><]\s*:\s*$/.test(buf)) return true;
    const t = buf.trim();
    if (/^[:;=<]$/.test(t)) return true;
    return false;
}

/**
 * 解析为片段列表：普通 tag 或换行占位（WeiLin 式换行芯片）。
 * 逗号仅在括号深度为 0 时切分，避免 (a:1.1, b) 被误切。
 */
function parseMagicPromptTags(raw) {
    const s = raw || "";
    const result = [];
    let buf = "";
    let depth = 0;
    const openB = "([{";
    const closeB = ")]}";

    const flushTag = () => {
        const t = buf.trim();
        buf = "";
        if (!t) return;
        const dis = isDisabledTag(t);
        result.push({
            isNewline: false,
            text: dis ? (t.slice(1).trim() || DISABLE_PREFIX) : t,
            disabled: dis,
        });
    };

    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "\n" && depth === 0) {
            flushTag();
            result.push({ isNewline: true });
            continue;
        }
        if (c === "," && depth === 0) {
            flushTag();
            continue;
        }
        if (openB.includes(c)) {
            if (!magicIsEmoticonOpenParen(buf, c)) depth++;
        } else if (closeB.includes(c)) depth = Math.max(0, depth - 1);
        buf += c;
    }
    flushTag();
    return result;
}

/**
 * 与 WeiLin 一致：每个非空行末尾必须有英文逗号（含最后一行）；空行保持为空。
 * 行尾空白会去掉后再判断/补逗号。
 */
function magicEnsureTrailingCommaPerLine(s) {
    if (s == null || s === "") return s;
    return s
        .split("\n")
        .map((line) => {
            const te = line.replace(/[ \t\u3000]+$/g, "");
            if (!te) return "";
            if (/,\s*$/.test(te)) return te;
            return `${te},`;
        })
        .join("\n");
}

/**
 * 应用 magicEnsureTrailingCommaPerLine 后，将原光标列位置映射到新字符串（仅处理行尾补 `,` 与去掉行尾空白）。
 */
function magicMapCursorAfterEnsureTrailingComma(oldText, oldPos) {
    const newText = magicEnsureTrailingCommaPerLine(oldText);
    if (oldText === newText) return Math.min(Math.max(0, oldPos), newText.length);
    const oldLines = oldText.split("\n");
    let o = 0;
    let n = 0;
    for (let i = 0; i < oldLines.length; i++) {
        const line = oldLines[i];
        const te = line.replace(/[ \t\u3000]+$/g, "");
        const out = !te ? "" : /,\s*$/.test(te) ? te : `${te},`;
        const oStart = o;
        const oEnd = o + line.length;
        if (oldPos >= oStart && oldPos <= oEnd) {
            const rel = oldPos - oStart;
            if (rel >= te.length) return Math.min(n + out.length, newText.length);
            return Math.min(n + rel, newText.length);
        }
        o = oEnd + (i < oldLines.length - 1 ? 1 : 0);
        n += out.length + (i < oldLines.length - 1 ? 1 : 0);
    }
    return Math.min(Math.max(0, oldPos), newText.length);
}

function serializeMagicPromptTags(tags) {
    const chunks = [];
    for (const t of tags) {
        if (t.isNewline) {
            chunks.push({ k: "n" });
            continue;
        }
        const x = (t.text || "").trim();
        if (!x) continue;
        chunks.push({ k: "t", s: t.disabled ? `${DISABLE_PREFIX}${x}` : x });
    }
    if (chunks.length === 0) return "";
    let out = "";
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (c.k === "n") {
            out += "\n";
            continue;
        }
        const prev = chunks[i - 1];
        if (i > 0 && prev && prev.k === "t" && !out.endsWith("\n")) {
            out += ", ";
        }
        out += c.s;
    }
    return magicEnsureTrailingCommaPerLine(out);
}

/** 将指定下标的 tag 片段按顺序序列化为文本（多选复制） */
function serializeMagicTagsAtIndices(tags, indexSet) {
    const sorted = [...indexSet].sort((a, b) => a - b);
    const slice = sorted.map((i) => tags[i]).filter(Boolean);
    return serializeMagicPromptTags(slice);
}

/**
 * 将 tags 中下标在 movingSorted（升序）的一组项移动到 targetIdx 锚点一侧。
 * targetIdx 不得落在 moving 集合内（拖放到自身时调用方应跳过）。
 */
function magicReorderTagsByIndices(tags, movingSorted, targetIdx, insertAfter) {
    const set = new Set(movingSorted);
    if (!tags.length || !movingSorted.length) return tags.slice();
    if (set.has(targetIdx)) return tags.slice();
    const moving = movingSorted.map((i) => tags[i]);
    const rest = tags.filter((_, i) => !set.has(i));
    let posInRest = 0;
    for (let i = 0; i < targetIdx; i++) {
        if (!set.has(i)) posInRest++;
    }
    if (insertAfter) posInRest++;
    const next = rest.slice();
    next.splice(posInRest, 0, ...moving);
    return next;
}

/**
 * 从芯片原文得到词典查询用的「核心英文 tag」：
 * 去掉前导 !、A1111 最外层 (tag:权重)、再反复剥最外层 () [] {}
 * 使 [[looking_back]]、(looking_outside:1.1) 等能命中裸 tag。
 */
function magicCoreTagForCnLookup(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    while (s.startsWith(DISABLE_PREFIX)) s = s.slice(1).trim();
    for (let g = 0; g < 8; g++) {
        const m = s.match(/^\((.+):([\d.]+)\)$/);
        if (m) {
            s = m[1].trim();
            continue;
        }
        break;
    }
    let prev = null;
    for (let g = 0; g < 32 && s !== prev; g++) {
        prev = s;
        const t1 = s.match(/^\((.+)\)$/);
        const t2 = s.match(/^\[(.+)\]$/);
        const t3 = s.match(/^\{(.+)\}$/);
        if (t1) s = t1[1].trim();
        else if (t2) s = t2[1].trim();
        else if (t3) s = t3[1].trim();
    }
    return s.trim();
}

/** 与 utils.ma_normalize_en_for_tag_match 一致：空格、下划线等价（simple background ≈ simple_background） */
function magicNormEnHint(x) {
    return String(x || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

/**
 * Tag 预览区：词库 /ma/prompt_autocomplete/batch 写入 cnHintCache 后，仍无中文（未缓存或空串）的核心 tag。
 * 返回去重后的「核心英文串」列表（与 batch 的 query 同语义），可一次性 POST /ma/translate_tags_llm。
 */
function magicCollectTagsMissingCnHint(textarea, cnHintCache) {
    if (!textarea || !cnHintCache) return [];
    const tags = parseMagicPromptTags(textarea.value);
    const ordered = [];
    const seen = new Set();
    for (const t of tags) {
        if (t.isNewline || !(t.text || "").trim()) continue;
        const coreRaw = magicCoreTagForCnLookup(t.text);
        const coreKey = magicNormEnHint(coreRaw);
        if (!coreKey) continue;
        const cached = cnHintCache.has(coreKey) ? cnHintCache.get(coreKey) : null;
        const hasCn = cached != null && String(cached).trim() !== "";
        if (hasCn) continue;
        if (seen.has(coreKey)) continue;
        seen.add(coreKey);
        ordered.push(String(coreRaw).slice(0, 200));
    }
    return ordered;
}

/** 强制 LLM 翻译：收集当前提示词内全部可译 tag（去重），与是否已有中文无关 */
function magicCollectAllTagsForLlmTranslate(textarea) {
    if (!textarea) return [];
    const tags = parseMagicPromptTags(textarea.value);
    const ordered = [];
    const seen = new Set();
    for (const t of tags) {
        if (t.isNewline || !(t.text || "").trim()) continue;
        const coreRaw = magicCoreTagForCnLookup(t.text);
        const coreKey = magicNormEnHint(coreRaw);
        if (!coreKey) continue;
        if (seen.has(coreKey)) continue;
        seen.add(coreKey);
        ordered.push(String(coreRaw).slice(0, 200));
    }
    return ordered;
}

/**
 * 单行输入框译稿写入 cnHintCache：与后端 seed 规则一致。
 * 仅一段英文 → 整段原文作释义；多段英文须与中文段数一致才逐段写入，否则跳过（避免整句中文贴到每个 tag）。
 */
function magicSeedCnHintFromTranslateLine(sourceZh, enLine, cnHintCache) {
    if (!cnHintCache || sourceZh == null || enLine == null) return 0;
    const zh = String(sourceZh).trim();
    const line = String(enLine).trim();
    if (!zh || !line) return 0;
    const splitSeg = (s) =>
        String(s)
            .split(/[,，、]/)
            .map((p) => p.trim())
            .filter(Boolean);
    const enParts = splitSeg(line);
    const zhParts = splitSeg(zh);
    if (!enParts.length) return 0;
    const cnMax = 240;
    let n = 0;
    if (enParts.length === 1) {
        const key = magicNormEnHint(magicCoreTagForCnLookup(enParts[0]));
        if (!key) return 0;
        cnHintCache.set(key, zh.slice(0, cnMax));
        return 1;
    }
    if (zhParts.length === enParts.length) {
        for (let i = 0; i < enParts.length; i++) {
            const cn = (zhParts[i] || "").trim().slice(0, cnMax) || zh.slice(0, cnMax);
            const key = magicNormEnHint(magicCoreTagForCnLookup(enParts[i]));
            if (!key) continue;
            cnHintCache.set(key, cn);
            n += 1;
        }
    }
    return n;
}

/**
 * 将 LLM 返回的 { tag, cn }[] 写入 cnHintCache（键与 batch 一致：magicNormEnHint(magicCoreTagForCnLookup(·))）。
 */
function magicApplyLlmTagTranslationsToCnCache(uniqueOrderedTags, items, cnHintCache) {
    if (!cnHintCache || !Array.isArray(items)) return;
    if (uniqueOrderedTags.length && items.length === uniqueOrderedTags.length) {
        for (let i = 0; i < items.length; i++) {
            const key = magicNormEnHint(magicCoreTagForCnLookup(uniqueOrderedTags[i]));
            if (!key) continue;
            const cn = String((items[i] && items[i].cn) || "").trim();
            cnHintCache.set(key, cn);
        }
        return;
    }
    for (const it of items) {
        if (!it) continue;
        const key = magicNormEnHint(magicCoreTagForCnLookup(it.tag));
        if (!key) continue;
        cnHintCache.set(key, String(it.cn || "").trim());
    }
}

/** 与 batch 一致：按 _ 拆成 token，避免 v 误命中 very_aesthetic 首字符 */
function magicNormTokensForHint(norm) {
    if (!norm) return new Set();
    return new Set(String(norm).split("_").filter(Boolean));
}

/** 在补全结果中选最贴切的 cn：优先 en 与核心 tag 归一化后一致，再最短包含关系（归一化后比较） */
function magicPickCnHintFromAutocompleteItems(items, coreLower) {
    if (!items?.length || !coreLower) return "";
    const exact = items.find((it) => magicNormEnHint(it.en) === coreLower);
    if (exact?.cn) return String(exact.cn);
    const containsCore = items
        .filter((it) => {
            const e = magicNormEnHint(it.en);
            return e && it.cn && e.includes(coreLower);
        })
        .sort((a, b) => magicNormEnHint(a.en).length - magicNormEnHint(b.en).length);
    if (containsCore.length) return String(containsCore[0].cn);
    const tok = magicNormTokensForHint(coreLower);
    const coreContainsEn = items
        .filter((it) => {
            const e = magicNormEnHint(it.en);
            if (!e || !it.cn) return false;
            /* 单字符/双字符 en 仅当与某 token 完全一致，禁止 v ⊂ very_aesthetic */
            if (e.length <= 2) return tok.has(e);
            return coreLower.includes(e);
        })
        .sort((a, b) => magicNormEnHint(b.en).length - magicNormEnHint(a.en).length);
    if (coreContainsEn.length) return String(coreContainsEn[0].cn);
    return "";
}

/** 在指定片段索引后插入换行占位（参考 weilin handelLineToken） */
function serializeMagicPromptTagsWithNewlineAfter(tags, afterIndex) {
    if (afterIndex < 0 || afterIndex >= tags.length) return serializeMagicPromptTags(tags);
    const t = tags[afterIndex];
    if (t && t.isNewline) return serializeMagicPromptTags(tags);
    const next = tags.slice();
    next.splice(afterIndex + 1, 0, { isNewline: true });
    return serializeMagicPromptTags(next);
}

/** 括号是否配对完整（与 weilin isBracketComplete 一致，不含尖括号） */
function isMagicBracketComplete(text) {
    const stack = [];
    const bracketMap = { "(": ")", "[": "]", "{": "}" };
    for (const ch of text) {
        if (bracketMap[ch]) stack.push(ch);
        else if (Object.values(bracketMap).includes(ch)) {
            if (stack.length === 0 || bracketMap[stack.pop()] !== ch) return false;
        }
    }
    return stack.length === 0;
}

/** 递归读取最内层末尾 :权重（weilin findInnerWeight） */
function findMagicTagInnerWeight(content) {
    const bracketPairs = [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: "{", close: "}" },
    ];
    for (const pair of bracketPairs) {
        if (content.startsWith(pair.open) && content.endsWith(pair.close)) {
            return findMagicTagInnerWeight(content.slice(1, -1));
        }
    }
    const weightMatch = content.match(/:(-?\d+(\.\d+)?)$/);
    return weightMatch ? parseFloat(weightMatch[1]) : 1;
}

function magicWrapTagText(text, bracketType) {
    const bracketPair = { "(": ")", "[": "]", "{": "}" }[bracketType];
    if (!bracketPair) return text;
    return `${bracketType}${text}${bracketPair}`;
}

function magicRemoveTagBracketLayer(text, bracketType) {
    const bracketPair = { "(": ")", "[": "]", "{": "}" };
    const close = bracketPair[bracketType];
    if (close && text.startsWith(bracketType) && text.endsWith(close)) {
        return text.slice(1, -1);
    }
    return text;
}

/**
 * 应用数值权重到单个 Tag 文本（与 weilin applyWeight 主分支一致，略去 Lora / 全角尖括号等）
 */
function applyMagicTagWeight(text, weightValue) {
    const w = Number(weightValue);
    if (!Number.isFinite(w)) return text;
    if (!isMagicBracketComplete(text)) return text;

    const hasOnlySingleParentheses = (s) =>
        s.startsWith("(") &&
        s.endsWith(")") &&
        !s.slice(1, -1).includes("(") &&
        !s.slice(1, -1).includes(")") &&
        !s.slice(1, -1).includes("[") &&
        !s.slice(1, -1).includes("]") &&
        !s.slice(1, -1).includes("{") &&
        !s.slice(1, -1).includes("}");

    let newText = text;
    const hasTrailingWeight = /:(-?\d+(\.\d+)?)$/.test(text);
    const weightedFormatMatch = text.match(/^\((.*?):(-?\d+(\.\d+)?)\)$/);

    if (hasTrailingWeight || weightedFormatMatch) {
        if (w === 1) {
            if (text.startsWith("(") && text.endsWith(")")) {
                newText = text.slice(1, -1).replace(/:(\d+(\.\d+)?)$/, "");
            } else {
                newText = text.replace(/:(\d+(\.\d+)?)$/, "");
            }
        } else if (weightedFormatMatch) {
            newText = `(${weightedFormatMatch[1]}:${w})`;
        } else {
            newText = text.replace(/:(-?\d+(\.\d+)?)$/, `:${w}`);
        }
    } else {
        const underscoreBracketMatch = text.match(/^([^_]+)_(\([^)]+\))$/);
        if (underscoreBracketMatch && !text.includes("\\(") && !text.includes("\\)")) {
            const [, prefix, bracketContent] = underscoreBracketMatch;
            newText = w === 1 ? text : `(${prefix} ${bracketContent}:${w})`;
        } else if (!/[\(\[\{\)\]\}]/.test(text)) {
            newText = w === 1 ? text : `(${text}:${w})`;
        } else if (w === 1 && hasOnlySingleParentheses(text)) {
            newText = text.slice(1, -1);
        } else if (w === 1) {
            newText = text;
        } else if (text.startsWith("(") && text.endsWith(")")) {
            newText = text.replace(/\)$/, `:${w})`);
        } else {
            newText = `(${text}:${w})`;
        }
    }
    return newText;
}

/** WeiLin 风格 Tag 悬浮工具栏：权重、收藏、括号、换行（删除按钮不放此处） */
function createMagicTagToolbarBar({ THEME: T, preventConflict: pc, compact = false, onFavoriteToggle }) {
    const bar = document.createElement("div");
    bar.setAttribute("data-magic-tag-toolbar", "1");
    const gap = compact ? "4px 5px" : "8px 10px";
    const pad = compact ? "4px 6px" : "8px 10px";
    const mb = compact ? "0" : "8px";
    bar.style.cssText = `
        display: flex; flex-wrap: wrap; align-items: center; gap: ${gap};
        row-gap: ${compact ? "3px" : "8px"};
        padding: ${pad}; margin-bottom: ${mb};
        background: ${T.bg3}; border: 1px solid ${T.border}; border-radius: 6px;
        box-sizing: border-box;
        width: max-content; max-width: min(96vw, 500px);
    `;

    const iconBtnBase = `
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid ${T.border}; background: ${T.bg2}; color: ${T.text};
        border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1;
        padding: 0; box-sizing: border-box;
    `;

    // —— 权重 ——
    const weightWrap = document.createElement("div");
    weightWrap.style.cssText = "display:flex;align-items:center;gap:6px;";
    const weightInp = document.createElement("input");
    weightInp.type = "number";
    weightInp.min = "0.1";
    weightInp.max = "2";
    weightInp.step = "0.1";
    weightInp.value = "1";
    weightInp.title = magicT("Tag 权重（改后失焦或按回车生效；1 可去掉权重标记，参考 WeiLin）");
    // 悬浮条内略紧凑，仍够显示 1.25 等小数；左侧数字 + 右侧浏览器 stepper
    weightInp.style.cssText = `
        width: ${compact ? "68px" : "76px"};
        min-height: ${compact ? "28px" : "30px"};
        height: ${compact ? "28px" : "30px"};
        padding: 4px 6px;
        font-size: 13px;
        line-height: 1.2;
        text-align: left;
        background: ${T.bg}; color: ${T.text}; border: 1px solid ${T.border};
        border-radius: 5px; box-sizing: border-box;
    `;
    pc(weightInp);
    const weightLbl = document.createElement("span");
    weightLbl.textContent = magicT("权重");
    weightLbl.style.cssText = `font-size: ${compact ? "11px" : "12px"}; color: ${T.text2}; user-select: none; white-space: nowrap; align-self: center;`;
    weightWrap.appendChild(weightInp);
    weightWrap.appendChild(weightLbl);
    bar.appendChild(weightWrap);

    // —— 收藏星（与「编辑标签」收藏区、userdata 联动）——
    let favOn = false;
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.title = onFavoriteToggle
        ? magicT("收藏 / 取消收藏（与「编辑标签」中收藏区同步）")
        : magicT("收藏");
    favBtn.setAttribute("aria-pressed", "false");
    favBtn.style.cssText = `${iconBtnBase} width: ${compact ? "26px" : "30px"}; height: ${compact ? "24px" : "28px"}; border: none; background: transparent; flex-shrink:0;`;
    const starSz = compact ? 18 : 20;
    favBtn.innerHTML = `
        <svg width="${starSz}" height="${starSz}" viewBox="0 0 24 24" aria-hidden="true" style="pointer-events:none;">
            <path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
    `;
    const applyFavStyle = () => {
        favBtn.style.color = favOn ? "#FFC107" : "#5c5c5c";
        favBtn.style.filter = favOn ? "none" : "grayscale(0.85)";
        favBtn.setAttribute("aria-pressed", favOn ? "true" : "false");
    };
    applyFavStyle();
    pc(favBtn);
    favBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !favOn;
        if (typeof onFavoriteToggle === "function") {
            try {
                const ok = await onFavoriteToggle(next);
                if (ok !== false) {
                    favOn = next;
                    applyFavStyle();
                }
            } catch (_) { /* 保持原状态 */ }
        } else {
            favOn = next;
            applyFavStyle();
        }
    });
    bar.appendChild(favBtn);

    const bh = compact ? "26px" : "28px";

    const mkBracketCluster = (openCh, closeCh, title) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;align-items:center;gap:2px;";
        const label = document.createElement("span");
        label.textContent = `${openCh}${closeCh}`;
        label.title = title;
        const mh = compact ? "26px" : "28px";
        const mw = compact ? "32px" : "36px";
        label.style.cssText = `
            display:inline-flex;align-items:center;justify-content:center;
            min-width: ${mw}; height: ${mh}; font-weight: 700; font-size: ${compact ? "11px" : "12px"};
            color: ${T.text2}; user-select: none; flex-shrink:0;
            border: 1px solid ${T.border}; border-radius: 4px; background: ${T.bg2};
        `;
        const col = document.createElement("div");
        col.style.cssText = "display:flex;flex-direction:column;gap:1px;";
        const mkMini = (sym, dataAct) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = sym;
            b.dataset.bracketOpen = openCh;
            b.dataset.bracketAct = dataAct;
            b.title = dataAct === "add" ? magicT("外包一层 ") + openCh + closeCh : magicT("去掉最外层 ") + openCh + closeCh;
            b.style.cssText = `
                ${iconBtnBase} min-width: ${compact ? "22px" : "24px"}; width: ${compact ? "22px" : "24px"};
                height: ${compact ? "16px" : "17px"}; min-height: 16px;
                font-size: 11px; font-weight: 600;
                padding: 0; cursor: pointer; opacity: 1;
            `;
            pc(b, { skipClick: true });
            return b;
        };
        col.appendChild(mkMini("+", "add"));
        col.appendChild(mkMini("−", "remove"));
        wrap.appendChild(label);
        wrap.appendChild(col);
        return wrap;
    };

    bar.appendChild(mkBracketCluster("(", ")", magicT("圆括号（WebUI 加权常用）")));
    bar.appendChild(mkBracketCluster("[", "]", magicT("方括号")));
    bar.appendChild(mkBracketCluster("{", "}", magicT("花括号")));

    // —— 换行（对齐 weilin line-token-btn：在当前 Tag 后插入换行分隔）——
    const newlineBtn = document.createElement("button");
    newlineBtn.type = "button";
    newlineBtn.title = magicT("在此 Tag 后换行（下一段用换行与当前段分开）");
    newlineBtn.style.cssText = `
        ${iconBtnBase} min-width: ${compact ? "34px" : "38px"}; height: ${bh};
        font-size: 11px; color: ${T.text}; flex-shrink: 0; padding: 0 6px; gap: 2px;
    `;
    newlineBtn.innerHTML = `<span style="opacity:0.85;font-size:13px">↵</span><span style="font-size:10px;color:${T.text2}">${magicT("换行")}</span>`;
    pc(newlineBtn);

    bar.appendChild(newlineBtn);

    return {
        bar,
        weightInp,
        favBtn,
        newlineBtn,
        getFavOn: () => favOn,
        setFavOn: (v) => {
            favOn = !!v;
            applyFavStyle();
        },
    };
}

/** 片段分隔符：半角逗号、全角逗号「，」、顿号「、」、换行（与提示词书写习惯一致） */
function magicIsPromptSegmentDelimiter(ch) {
    return ch === "," || ch === "\n" || ch === "\uFF0C" || ch === "\u3001";
}

/** 当前光标所在「逗号/换行」之间的片段，用于补全 query 与整段替换 */
function getSegmentAtCaret(value, caret) {
    let start = 0;
    for (let i = caret - 1; i >= 0; i--) {
        if (magicIsPromptSegmentDelimiter(value[i])) {
            start = i + 1;
            break;
        }
    }
    let end = value.length;
    for (let i = caret; i < value.length; i++) {
        if (magicIsPromptSegmentDelimiter(value[i])) {
            end = i;
            break;
        }
    }
    const segment = value.slice(start, end);
    return { segStart: start, segEnd: end, query: segment.trim() };
}

/**
 * 计算 textarea 内光标在视口中的位置（用于补全浮层跟随光标）
 * 基于 mirror div，与 textarea-caret-position 思路一致。
 *
 * 1) 镜像用 position:fixed 叠在 textarea 的 getBoundingClientRect() 上，并用
 *    span.getBoundingClientRect() 得到视口坐标（避免 offsetParent 错乱）。
 * 2) 宽度必须复制 getComputedStyle 的 width（已解析像素），不要用 clientWidth 当
 *    div 的 width：textarea 为 border-box + width:100% 时，clientWidth 是「内宽」，
 *    与 CSS width 语义不一致，镜像会变窄、换行提前，测得光标跑到行尾右侧，补全框
 *    再被 clamp 到窗口右缘（用户看到「离光标很远」）。
 */
function getTextareaCaretViewportRect(textarea, position) {
    const pos = position == null ? textarea.selectionStart : position;
    const computed = window.getComputedStyle(textarea);
    const ta = textarea.getBoundingClientRect();

    const mirror = document.createElement("div");
    document.body.appendChild(mirror);
    const ms = mirror.style;
    ms.position = "fixed";
    ms.left = `${ta.left}px`;
    ms.top = `${ta.top}px`;
    ms.visibility = "hidden";
    ms.pointerEvents = "none";
    ms.margin = "0";
    [
        "direction",
        "boxSizing",
        // Chrome/Edge：computed width 与 textarea 实际换行宽度一致（含滚动条等处理）
        "width",
        "height",
        "overflowX",
        "overflowY",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "borderStyle",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "fontStyle",
        "fontVariant",
        "fontWeight",
        "fontStretch",
        "fontSize",
        "fontSizeAdjust",
        "lineHeight",
        "fontFamily",
        "textAlign",
        "textTransform",
        "textIndent",
        "textDecoration",
        "letterSpacing",
        "wordSpacing",
        "tabSize",
        "whiteSpace",
        "wordWrap",
    ].forEach((prop) => {
        ms[prop] = computed.getPropertyValue(prop);
    });
    // 覆盖：隐藏滚动条并展开到完整内容高度，保证多行时 caret 纵坐标正确
    ms.overflow = "hidden";
    if (textarea.nodeName === "TEXTAREA") {
        ms.height = `${textarea.scrollHeight}px`;
    }
    mirror.textContent = "";
    mirror.appendChild(document.createTextNode(textarea.value.substring(0, pos)));
    const span = document.createElement("span");
    span.textContent = textarea.value.substring(pos) || ".";
    mirror.appendChild(span);

    const spanRect = span.getBoundingClientRect();
    const height = spanRect.height || parseFloat(computed.lineHeight) || 16;
    document.body.removeChild(mirror);

    return {
        left: spanRect.left,
        top: spanRect.top,
        bottom: spanRect.top + height,
        height,
    };
}

/**
 * 在编辑框上挂载 WeiLin 风格补全：左侧英文 tag，右侧中文说明；浮层跟随光标
 * @param {HTMLElement} panelMount — 建议用全屏透明壳层（pointer-events:none，无裁剪、无 transform，fixed 即视口坐标）
 * @param {HTMLElement[]} [scrollRoots] — 滚动时重算位置（如 content）
 */
function attachMagicPromptAutocomplete(textarea, { onInput, panelMount, scrollRoots = [], limit: acLimitOpt, danbooruMode = false } = {}) {
    const acLimit = magicClampAutocompleteLimit(
        acLimitOpt != null ? acLimitOpt : AUTOCOMPLETE_LIMIT,
    );
    let danbooruCatFilter = null;
    let danbooruCatSelect = null;
    if (typeof panelMount._magicAcDispose === "function") {
        try { panelMount._magicAcDispose(); } catch (_) { /* ignore */ }
        panelMount._magicAcDispose = null;
    }

    const panel = document.createElement("div");
    panel.setAttribute("data-magic-ac-panel", "1");
    panel.style.cssText = `
        display:none; flex-direction:column; position:fixed; z-index:100060;
        width:${AUTOCOMPLETE_PANEL_WIDTH_PX}px; min-width:240px; max-width:min(90vw, 340px);
        max-height:min(36vh, 260px); overflow:hidden;
        background:${THEME.bg2}; border:1px solid ${THEME.border};
        border-radius:6px; box-shadow:0 8px 28px rgba(0,0,0,0.55);
        pointer-events:auto; left:0; top:0;
    `;
    preventConflict(panel);
    panelMount.appendChild(panel);

    /** Danbooru 补全表头与数据行共用列宽，避免关闭按钮挤窄表头导致列错位 */
    const DANBOORU_AC_GRID = `minmax(0,1fr) minmax(0,34%) 76px 42px`;
    /** 本地补全仅两列（无分类/热度），表头与行共用 grid，避免与「分类」空列错位 */
    const LOCAL_AC_GRID = `minmax(0,1fr) minmax(0,38%)`;
    const headRow = document.createElement("div");
    headRow.style.cssText = danbooruMode
        ? `
        position:sticky; top:0; z-index:1;
        position:relative;
        padding:5px 28px 5px 8px;
        font-size:10px; color:${THEME.text2};
        border-bottom:1px solid ${THEME.border};
        background:${THEME.bg2};
        box-sizing:border-box;
    `
        : `
        display:flex; align-items:center; gap:6px;
        padding:3px 6px; font-size:10px; color:${THEME.text2};
        border-bottom:1px solid ${THEME.border}; position:sticky; top:0;
        background:${THEME.bg2}; z-index:1;
    `;
    const hEn = document.createElement("span");
    hEn.textContent = magicT("英文 tag");
    hEn.style.cssText = danbooruMode
        ? "min-width:0; font-weight:600; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
        : "min-width:0; font-weight:600; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
    const hCn = document.createElement("span");
    hCn.textContent = magicT("中文");
    hCn.style.cssText = danbooruMode
        ? "min-width:0; font-weight:600; text-align:left; line-height:1.25; word-break:break-word;"
        : "min-width:0; font-weight:600; text-align:left; line-height:1.25; word-break:break-word;";
    /** Danbooru：「分类」文字 + 紧凑筛选下拉，与数据列宽对齐 */
    let hCatWrap = null;
    const hCnt = document.createElement("span");
    hCnt.textContent = magicT("热度");
    hCnt.style.cssText =
        "flex:0 0 42px; flex-shrink:0; text-align:right; font-weight:600; font-variant-numeric:tabular-nums;";
    hCnt.style.display = danbooruMode ? "" : "none";
    const closeAc = document.createElement("button");
    closeAc.type = "button";
    closeAc.textContent = "✕";
    closeAc.title = magicT("关闭补全");
    closeAc.style.cssText = danbooruMode
        ? `position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:0 6px;border:none;background:transparent;color:${THEME.text2};cursor:pointer;font-size:14px;line-height:1;z-index:2;`
        : `flex-shrink:0;padding:0 6px;border:none;background:transparent;color:${THEME.text2};cursor:pointer;font-size:14px;line-height:1;`;
    preventConflict(closeAc);
    if (danbooruMode) {
        hCatWrap = document.createElement("div");
        hCatWrap.style.cssText = `
            flex:0 0 76px; flex-shrink:0; min-width:0;
            display:flex; flex-direction:row; align-items:center; justify-content:center;
            gap:3px; font-weight:600;
        `;
        const hCatLbl = document.createElement("span");
        hCatLbl.textContent = magicT("分类");
        hCatLbl.style.cssText = "font-size:9px; line-height:1; flex-shrink:0; white-space:nowrap;";
        danbooruCatSelect = document.createElement("select");
        danbooruCatSelect.title = magicT("按分类筛选");
        danbooruCatSelect.style.cssText = `
            flex:0 1 auto; width:auto; min-width:0; max-width:52px;
            height:17px; line-height:15px; padding:0 1px 0 2px; margin:0;
            font-size:9px; font-weight:600; font-family:inherit;
            background:${THEME.bg3}; color:${THEME.text};
            border:1px solid ${THEME.border}; border-radius:3px;
            outline:none; cursor:pointer; box-sizing:border-box;
            vertical-align:middle;
        `;
        DANBOORU_CAT_FILTER_OPTIONS.forEach((opt) => {
            const op = document.createElement("option");
            op.value = opt.value === null ? "" : String(opt.value);
            op.textContent = opt.label;
            danbooruCatSelect.appendChild(op);
        });
        preventConflict(danbooruCatSelect);
        danbooruCatSelect.addEventListener("change", () => {
            const v = danbooruCatSelect.value;
            danbooruCatFilter = v === "" ? null : Number(v);
            if (items.length) renderList();
        });
        hCatWrap.appendChild(hCatLbl);
        hCatWrap.appendChild(danbooruCatSelect);
        const headGrid = document.createElement("div");
        headGrid.style.cssText = `
            display:grid;
            grid-template-columns: ${DANBOORU_AC_GRID};
            column-gap:8px;
            align-items:center;
            width:100%;
            min-width:0;
            box-sizing:border-box;
        `;
        headGrid.appendChild(hEn);
        headGrid.appendChild(hCn);
        headGrid.appendChild(hCatWrap);
        headGrid.appendChild(hCnt);
        headRow.appendChild(headGrid);
        headRow.appendChild(closeAc);
    } else {
        const headGridLocal = document.createElement("div");
        headGridLocal.style.cssText = `
            display:grid;
            grid-template-columns: ${LOCAL_AC_GRID};
            column-gap:8px;
            align-items:center;
            flex:1;
            min-width:0;
        `;
        headGridLocal.appendChild(hEn);
        headGridLocal.appendChild(hCn);
        headRow.appendChild(headGridLocal);
        headRow.appendChild(closeAc);
    }
    panel.appendChild(headRow);

    const acHintBase = danbooruMode
        ? magicT("Danbooru 补全模式 · 热度排序 · 更多Tag请到编辑标签处搜索")
        : magicT("本地补全模式 · 自建标签组优先 · 词太短时预设结果多，可打全名缩小范围");
    const acHintRow = document.createElement("div");
    acHintRow.textContent = acHintBase;
    acHintRow.style.cssText = `
        padding: 3px 8px 4px; font-size: 9px; line-height: 1.35; color: ${THEME.text2};
        opacity: 0.92; border-bottom: 1px solid ${THEME.border}; flex-shrink: 0;
    `;
    panel.appendChild(acHintRow);

    const listRoot = document.createElement("div");
    listRoot.style.cssText = "flex:1; min-height:0; overflow-y:auto; overflow-x:hidden;";
    panel.appendChild(listRoot);

    let items = [];
    /** Danbooru 补全：正在等待远端（或 Danbooru 空后加载本地补充）时为 true */
    let danbooruAcPending = false;
    /** 递增序号：避免旧请求的 finally 在新请求已开始后仍把 pending 清掉并误渲染「无结果」 */
    let danbooruAcReqId = 0;
    let sel = 0;
    let visible = false;
    let acAbort = null;
    /** 供 keydown 使用（与 renderList 内 shown 同步） */
    let lastShownForKeys = [];

    const margin = 8;
    const updatePanelPosition = () => {
        if (!panelMount.contains(panel) || panel.style.display === "none") return;
        let caret;
        try {
            caret = getTextareaCaretViewportRect(textarea);
        } catch (_) {
            return;
        }
        const panelW = Math.min(
            340,
            Math.max(240, Math.min(AUTOCOMPLETE_PANEL_WIDTH_PX, window.innerWidth - 2 * margin))
        );
        panel.style.width = `${panelW}px`;
        panel.style.display = "flex";
        panel.style.visibility = "hidden";
        const ph = panel.offsetHeight || 200;
        panel.style.visibility = "";
        let left = caret.left;
        let top = caret.bottom + 6;
        left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));
        if (top + ph > window.innerHeight - margin) {
            top = caret.top - ph - 6;
        }
        top = Math.max(margin, Math.min(top, window.innerHeight - ph - margin));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    };

    const repositionIfVisible = () => {
        if (visible && panel.style.display !== "none") {
            updatePanelPosition();
        }
    };

    const acSignal = new AbortController();
    const sig = acSignal.signal;
    window.addEventListener("resize", repositionIfVisible, { signal: sig });
    scrollRoots.forEach((el) => {
        if (el && el.addEventListener) {
            el.addEventListener("scroll", repositionIfVisible, { capture: true, signal: sig });
        }
    });
    textarea.addEventListener("scroll", repositionIfVisible, { signal: sig });

    panelMount._magicAcDispose = () => {
        acSignal.abort();
        panel.remove();
    };

    const hide = () => {
        visible = false;
        panel.style.display = "none";
        items = [];
        danbooruAcPending = false;
        sel = 0;
        lastShownForKeys = [];
        listRoot.innerHTML = "";
        if (danbooruMode) {
            listRoot.style.display = "";
            listRoot.style.minHeight = "";
        }
        if (acAbort) {
            try { acAbort.abort(); } catch (_) { /* ignore */ }
            acAbort = null;
        }
    };

    closeAc.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hide();
    });

    const applyChoice = (it) => {
        const v = textarea.value;
        const caret = textarea.selectionStart;
        const { segStart, segEnd } = getSegmentAtCaret(v, caret);
        // 选完后默认加 ", "；仅当片段后面已经是逗号或换行时不重复加（末尾 segEnd===length 也要加逗号）
        const after = v[segEnd];
        const trailing = magicIsPromptSegmentDelimiter(after) ? "" : ", ";
        const tail = v.slice(segEnd).replace(/^[ ]+/, ""); // 只去前导空格，保留逗号/换行
        const newV = v.slice(0, segStart) + it.en + trailing + tail;
        const norm = magicEnsureTrailingCommaPerLine(newV);
        textarea.value = norm;
        const np = magicMapCursorAfterEnsureTrailingComma(newV, segStart + it.en.length + trailing.length);
        textarea.setSelectionRange(np, np);
        onInput();
        hide();
        textarea.focus();
    };

    const renderList = () => {
            listRoot.innerHTML = "";
            const caret0 = textarea.selectionStart;
            const { query: acQuery } = getSegmentAtCaret(textarea.value, caret0);

            if (danbooruMode && danbooruAcPending && (!items || !items.length)) {
                lastShownForKeys = [];
                listRoot.innerHTML = "";
                listRoot.style.display = "none";
                listRoot.style.minHeight = "0";
                visible = true;
                panel.style.display = "flex";
                updatePanelPosition();
                requestAnimationFrame(() => updatePanelPosition());
                return;
            }
            if (danbooruMode) {
                listRoot.style.display = "";
            }

            // 应用分类过滤（仅 Danbooru 模式有效）
            const shown = danbooruCatFilter == null ? items : items.filter(it => it.category === danbooruCatFilter);
            if (sel >= shown.length) sel = Math.max(0, shown.length - 1);

            if (!shown.length) {
                lastShownForKeys = [];
                const empty = document.createElement("div");
                empty.style.cssText = `
                    padding: 16px 10px; text-align: center;
                    color: ${THEME.text2}; font-size: 12px;
                `;
                const catHint = danbooruCatFilter != null && danbooruCatFilter !== "" && danbooruCatFilter !== undefined
                    ? `（${DANBOORU_CATEGORY_NAMES[danbooruCatFilter] || danbooruCatFilter} 分类）`
                    : "";
                empty.textContent = magicT("没有找到包含 \"") + acQuery + magicT("\" 的 tag") + catHint;
                listRoot.appendChild(empty);
                visible = true;
                if (!danbooruMode) {
                    acHintRow.textContent = acHintBase;
                }
                panel.style.display = "flex";
                updatePanelPosition();
                requestAnimationFrame(() => updatePanelPosition());
                return;
            }
            lastShownForKeys = shown;
            visible = true;
            const showCat = danbooruCatFilter != null && danbooruCatFilter !== "" && danbooruCatFilter !== undefined
                ? ` · ${DANBOORU_CATEGORY_NAMES[danbooruCatFilter] || danbooruCatFilter} ${shown.length} 条`
                : "";
            acHintRow.textContent =
                items.length >= acLimit
                    ? magicT("已显示 ") + acLimit + magicT(" 条（补全条数已达上限）") + showCat + magicT(" · 请输入更长关键词或至编辑标签处搜索")
                    : acHintBase + showCat;
            panel.style.display = "flex";

            const query = acQuery;
            const qLen = query.length;

            const highlightMatch = (text) => {
                if (!query) return text;
                const idx = text.toLowerCase().indexOf(query.toLowerCase());
                if (idx === -1) return text;
                return (
                    text.slice(0, idx) +
                    `<b style="color:#9C27B0;font-weight:700;">` + text.slice(idx, idx + qLen) + `</b>` +
                    text.slice(idx + qLen)
                );
            };

            const fmtCount = (n) => {
                if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
                if (n >= 1000) return (n / 1000).toFixed(1) + "K";
                return String(n || 0);
            };

            shown.forEach((it, idx) => {
                const row = document.createElement("div");
                row.style.cssText = danbooruMode
                    ? `
                    display:grid;
                    grid-template-columns: ${DANBOORU_AC_GRID};
                    column-gap:8px;
                    align-items:center;
                    padding:5px 8px; cursor:pointer; font-size:11px;
                    border-bottom:1px solid ${THEME.border};
                    box-sizing:border-box;
                `
                    : `
                    display:grid;
                    grid-template-columns: ${LOCAL_AC_GRID};
                    column-gap:8px;
                    align-items:center;
                    padding:5px 8px; cursor:pointer; font-size:11px;
                    border-bottom:1px solid ${THEME.border};
                    box-sizing:border-box;
                `;
                if (idx === sel) {
                    row.style.background = "rgba(24, 144, 255, 0.22)";
                }

                if (danbooruMode) {
                    // Danbooru 模式：英文 / 中文 / 分类 / 热度（与表头同 grid 列宽）
                    const enEl = document.createElement("span");
                    const enFull = it.en || "";
                    enEl.innerHTML = highlightMatch(enFull);
                    enEl.style.cssText =
                        "min-width:0; color:#e8e8e8; text-align:left; overflow-wrap:anywhere; word-break:break-word; line-height:1.35;";

                    const catKey = magicDanbooruCategoryId(it);
                    const catColor = DANBOORU_CATEGORY_COLORS[catKey] || "#888";
                    const catName = DANBOORU_CATEGORY_NAMES[catKey] || "other";
                    const catEl = document.createElement("span");
                    catEl.textContent = catName;
                    catEl.style.cssText = `
                        font-size:9px; padding:1px 5px;
                        border-radius:3px; text-align:center;
                        background:${catColor}1a; color:${catColor};
                        border:1px solid ${catColor}55; font-weight:600;
                    `;

                    const cntEl = document.createElement("span");
                    cntEl.textContent = fmtCount(it.count);
                    cntEl.style.cssText = "color:#666; font-size:10px; text-align:right; font-variant-numeric:tabular-nums;";

                    const cnText = it.cn ? highlightMatch(it.cn) : "—";
                    const cnEl = document.createElement("span");
                    cnEl.innerHTML = cnText;
                    cnEl.style.cssText =
                        "min-width:0; color:#ce93d8; text-align:left; word-break:break-word; line-height:1.35;";

                    row.appendChild(enEl);
                    row.appendChild(cnEl);
                    row.appendChild(catEl);
                    row.appendChild(cntEl);
                } else {
                    // 本地模式：英文 / 中文（含用户标签标识）
                    const enEl = document.createElement("span");
                    const enFull = it.en || "";
                    const enShow =
                        it.kind === "tagset" ? magicFormatTagPreview(enFull, 2) : enFull;
                    enEl.innerHTML = highlightMatch(enShow);
                    if (it.kind === "tagset" && enFull !== enShow) {
                        enEl.title = enFull;
                    }
                    enEl.style.cssText =
                        "min-width:0; color:#e8e8e8; text-align:left; overflow-wrap:anywhere; word-break:break-word; line-height:1.35; display:flex; align-items:center; gap:0;";
                    const cnEl = document.createElement("span");
                    cnEl.style.cssText =
                        "min-width:0; color:#ce93d8; text-align:left; word-break:break-word; line-height:1.35; display:flex; align-items:center; justify-content:flex-start; flex-wrap:wrap; gap:4px;";
                    if (it.source === "custom") {
                        const badge = document.createElement("span");
                        badge.textContent = magicT("用户");
                        badge.title =
                            it.kind === "tagset"
                                ? magicT("标签组「") + (it.setName || it.cn || magicT("自定义")) + magicT("」· 点击插入整段英文")
                                : magicT("来自「") + (it.setName || magicT("自定义")) + magicT("」");
                        badge.style.cssText = `
                            padding: 1px 4px; font-size: 10px;
                            border-radius: 3px; background: rgba(156, 39, 176, 0.28);
                            color: #ce93d8; font-weight: 600; flex-shrink: 0;
                            line-height: 1.4;
                        `;
                        cnEl.appendChild(badge);
                    }
                    const cnText = document.createElement("span");
                    cnText.innerHTML = highlightMatch(it.cn || "");
                    cnEl.appendChild(cnText);
                    row.appendChild(enEl);
                    row.appendChild(cnEl);
                }
                row.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    applyChoice(it);
                });
                preventConflict(row);
                listRoot.appendChild(row);
            });

        const active = listRoot.children[sel];
        if (active) active.scrollIntoView({ block: "nearest" });
        updatePanelPosition();
        requestAnimationFrame(() => updatePanelPosition());
    };

        const fetchSuggestions = async () => {
        const v = textarea.value;
        const caret = textarea.selectionStart;
        const { query } = getSegmentAtCaret(v, caret);
        if (!query || query.length < 1) {
            hide();
            return;
        }
        if (acAbort) {
            try { acAbort.abort(); } catch (_) { /* ignore */ }
        }
        acAbort = new AbortController();

        if (danbooruMode) {
            const isCnQuery = (text) => Boolean(text && /[\u4e00-\u9fff]/.test(text));
            const cnQuery = isCnQuery(query);
            const reqId = ++danbooruAcReqId;

            danbooruAcPending = true;
            items = [];
            sel = 0;
            acHintRow.textContent = magicT("正在查询 danbooru预设库…");
            renderList();

            try {
                const results = await magicDanbooruSearch(query, acLimit, 1, acAbort.signal, "preset");
                if (reqId !== danbooruAcReqId || acAbort.signal.aborted) return;

                const danbooItems = results.items || [];
                const qCn = magicStripAutocompleteQueryEdges(query);
                const danbooItemsCnFiltered =
                    magicDanbooruQueryIsChinese(qCn)
                        ? danbooItems.filter((it) =>
                              magicDanbooruChineseQueryMatchesGloss(qCn, (it && it.cn) || "")
                          )
                        : danbooItems;

                // 仅使用 savedata/danbooru预设库.txt，绝不回退到 tag预设库（避免两套词库混用）
                if (danbooItems.length === 0) {
                    items = [];
                    acHintRow.textContent = magicT(
                        "danbooru预设库中无匹配，请扩充 savedata/danbooru预设库.txt，或使用「编辑标签」搜索远端",
                    );
                } else {
                    items = danbooItemsCnFiltered;
                    acHintRow.textContent =
                        items.length
                            ? magicT("本地预设库 · 毫秒级加载 · 分类+热度来自 danbooru预设库")
                            : magicT("预设库无匹配，尝试更长关键词");
                }
                sel = 0;
            } catch (e) {
                if (reqId !== danbooruAcReqId || acAbort.signal.aborted) return;
                if (e.name !== "AbortError") {
                    console.warn("[MagicText] danbooru preset autocomplete", e);
                    items = [];
                    acHintRow.textContent = magicT("danbooru预设库加载失败，请重启 ComfyUI 或检查 savedata/danbooru预设库.txt");
                }
            } finally {
                if (reqId !== danbooruAcReqId) return;
                danbooruAcPending = false;
                if (acAbort.signal.aborted) return;
                renderList();
            }
            return;
        }

        // 本地模式
        const params = new URLSearchParams({ q: query, limit: String(acLimit) });
        const url = api.apiURL(`/ma/prompt_autocomplete?${params.toString()}`);
        try {
            const res = await fetch(url, { signal: acAbort.signal, credentials: "same-origin" });
            const data = await res.json();
            items = data.items || [];
            sel = 0;
            renderList();
        } catch (e) {
            if (e.name !== "AbortError") console.warn("[MagicText] autocomplete", e);
        }
    };

    const scheduleFetch = debounce(fetchSuggestions, AUTOCOMPLETE_DEBOUNCE_MS);

    // 仅在「实际打字」时触发补全；鼠标点击/方向键移动光标不触发（仿 WeiLin 逻辑）
    textarea.addEventListener("input", () => {
        onInput();
        scheduleFetch();
    });

    textarea.addEventListener("keydown", (e) => {
        if (!visible) return;
        if (e.key === "Escape") {
            e.preventDefault();
            hide();
            return;
        }
        if (!lastShownForKeys.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            sel = Math.min(sel + 1, lastShownForKeys.length - 1);
            renderList();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            sel = Math.max(sel - 1, 0);
            renderList();
        } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            applyChoice(lastShownForKeys[sel]);
        } else if (e.key === "Tab") {
            e.preventDefault();
            applyChoice(lastShownForKeys[sel]);
        }
    });
}

/**
 * 与 magic_cache.js 一致：同步主 STRING 文本到 LiteGraph/ComfyUI。
 * 仅改 widget.value + DOM input 时，widgets_values / prompt 仍可能是旧值，下游「展示文本」等会不同步。
 */
function syncMagicPromptTextWidget(node, textWidget, value) {
    if (!node || !textWidget) return;
    const v = value == null ? "" : String(value);
    textWidget.value = v;
    if (typeof textWidget.callback === "function") {
        try {
            textWidget.callback(v);
        } catch (e) {
            console.warn("[MagicText] text widget callback", e);
        }
    }
    if (textWidget.element) {
        textWidget.element.value = v;
        textWidget.element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    try {
        const idx = node.widgets?.indexOf?.(textWidget);
        if (idx != null && idx >= 0) {
            node.widgets_values = node.widgets_values || [];
            node.widgets_values[idx] = v;
        }
    } catch (e) {
        /* ignore */
    }
    try {
        if (typeof node.setDirtyCanvas === "function") {
            node.setDirtyCanvas(true, true);
        } else if (app.graph && typeof app.graph.setDirtyCanvas === "function") {
            app.graph.setDirtyCanvas(true, true);
        }
    } catch (e) {
        /* ignore */
    }
}

// 主弹窗函数（需 async：打开时 await 读取 /ma/settings）
async function showPromptEditorModal(node, nodeSeed) {
    // 同时只保留一个浮动编辑器；再打开时先关闭上一个（会落盘尺寸）
    document.querySelectorAll("[data-magic-prompt-shell='1']").forEach((el) => {
        if (typeof el._magicCloseEditor === "function") {
            el._magicCloseEditor();
        }
    });

    // 获取当前文本
    const textWidget = node.widgets.find(w => w.name === "text");
    const currentText = textWidget ? textWidget.value : "";

    // 非模态外壳：透明、不拦截指针，背后画布/节点可操作；仅窗体自身可点
    const shell = document.createElement("div");
    shell.setAttribute("data-magic-prompt-shell", "1");
    shell.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 10000; background: transparent;
    `;

    // 读取全局设置（弹窗尺寸、工具栏显隐、补全条数等）
    let ds = { dialog_size: { width: 720, height: 400, textareaMinHeight: 160 } };
    const magicEditorSettings = {
        editor_toolbar: { ...MAGIC_DEFAULT_EDITOR_TOOLBAR },
        format_options: { ...MAGIC_DEFAULT_FORMAT_OPTIONS },
        prompt_autocomplete_limit: AUTOCOMPLETE_LIMIT,
        prompt_history_max: 20,
        /** 翻译所用 LLM 配置名（userdata/settings.txt，与 llm_settings.txt 的 profile 键一致） */
        translate_llm_profile: "",
        /** 翻译模式："normal"（默认）或 "force" */
        translate_mode: "normal",
        /** LLM 翻译缓存最大条数（LRU），默认 150 */
        llm_cache_max: 150,
        /** 补全数据来源："local" | "danbooru" */
        danbooru_mode: "local",
    };
    try {
        const r = await fetch("/ma/settings", { credentials: "same-origin" });
        if (r.ok) {
            const all = await r.json();
            if (all.dialog_size) ds.dialog_size = all.dialog_size;
            magicEditorSettings.editor_toolbar = magicMergeEditorToolbar(all.editor_toolbar);
            magicEditorSettings.format_options = magicMergeFormatOptions(all.format_options);
            if (all.prompt_autocomplete_limit != null) {
                magicEditorSettings.prompt_autocomplete_limit = magicClampAutocompleteLimit(
                    all.prompt_autocomplete_limit,
                );
            }
            const hm = parseInt(all.prompt_history_max, 10);
            if (Number.isFinite(hm)) {
                magicEditorSettings.prompt_history_max = Math.max(1, Math.min(500, hm));
            }
            if (all.translate_llm_profile != null && all.translate_llm_profile !== undefined) {
                magicEditorSettings.translate_llm_profile = String(all.translate_llm_profile);
            }
            const savedMode = all.translate_mode || (all.translate_llm_force ? "force" : "normal");
            magicEditorSettings.translate_mode = savedMode;
            const lcm = parseInt(all.llm_cache_max, 10);
            if (Number.isFinite(lcm)) {
                magicEditorSettings.llm_cache_max = Math.max(10, Math.min(2000, lcm));
            }
            magicEditorSettings.danbooru_mode = magicNormalizeDanbooruMode(all.danbooru_mode);
            /* 兼容旧根键 autocomplete_enabled（服务端 _load_settings 已合并时可省略，双保险） */
            if (typeof all.autocomplete_enabled === "boolean") {
                const et0 = magicEditorSettings.editor_toolbar || {};
                const rawEt = all.editor_toolbar && typeof all.editor_toolbar === "object" ? all.editor_toolbar : {};
                if (!Object.prototype.hasOwnProperty.call(rawEt, "autocomplete_popup")) {
                    magicEditorSettings.editor_toolbar = { ...et0, autocomplete_popup: all.autocomplete_enabled };
                }
            }
        }
    } catch (_) { /* use defaults */ }
    shell._magicEditorSettings = magicEditorSettings;
    shell._magicFormatOptions = { ...magicEditorSettings.format_options };
    const dlgCfg = { ...ds.dialog_size };
    if (dlgCfg.textareaMinHeight == null || dlgCfg.textareaMinHeight === "") {
        dlgCfg.textareaMinHeight = 160;
    }

    const closeEditorOverlay = () => {
        persistMagicDialogSize(dialog, dlgCfg);
        if (shell._magicTagUiTimer) {
            clearTimeout(shell._magicTagUiTimer);
            shell._magicTagUiTimer = null;
        }
        if (shell._magicTaResizeObserver) {
            try { shell._magicTaResizeObserver.disconnect(); } catch (_) { /* ignore */ }
            shell._magicTaResizeObserver = null;
        }
        if (typeof shell._magicAcDispose === "function") {
            try { shell._magicAcDispose(); } catch (_) { /* ignore */ }
            shell._magicAcDispose = null;
        }
        if (shell._magicTagFloatHideTimer) {
            clearTimeout(shell._magicTagFloatHideTimer);
            shell._magicTagFloatHideTimer = null;
        }
        if (shell._magicTagFloatBar && shell._magicTagFloatBar.parentNode === shell) {
            shell.removeChild(shell._magicTagFloatBar);
        }
        shell._magicTagFloatBar = null;
        shell._magicTagFloatChip = null;
        if (shell._magicTagFloatScrollAbort) {
            try { shell._magicTagFloatScrollAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicTagFloatScrollAbort = null;
        }
        if (shell._magicCaretSaveAbort) {
            try { shell._magicCaretSaveAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicCaretSaveAbort = null;
        }
        if (shell._magicChipRowAbort) {
            try { shell._magicChipRowAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicChipRowAbort = null;
        }
        document.querySelectorAll("[data-magic-tag-rubber]").forEach((el) => el.remove());
        shell.querySelectorAll("[data-magic-tag-sel-popup], [data-magic-tag-drop-line]").forEach((el) => el.remove());
        shell._magicChipSelSet = null;
        shell._magicChipSelAnchor = null;
        shell._magicDragIndices = null;
        shell._magicTagChipsRubberArmed = false;
        shell._magicChipToolbarPinnedIndex = null;
        closeModal(shell);
    };
    shell._magicCloseEditor = closeEditorOverlay;

    // 主弹窗（浮动工具窗，非模态）
    const dialog = document.createElement("div");
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: ${dlgCfg.width}px; height: ${dlgCfg.height}px;
        pointer-events: auto;
        background: ${THEME.bg}; color: ${THEME.text};
        border: 1px solid ${THEME.border}; border-radius: 8px;
        box-shadow: 0 16px 56px rgba(0,0,0,0.72), 0 0 0 1px rgba(255,255,255,0.06);
        display: flex; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
        box-sizing: border-box;
    `;
    preventConflict(dialog);
    shell.appendChild(dialog);
    makeDialogResizable(dialog, {
        minWidth: 420,
        minHeight: 260,
        onResizeEnd: () => {
            persistMagicDialogSize(dialog, dlgCfg);
        },
    });

    // ---- Header ----
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px; background: ${THEME.bg2};
        border-bottom: 1px solid ${THEME.border};
        flex-shrink: 0;
    `;
    const title = document.createElement("span");
    title.style.cssText = "font-size: 15px; font-weight: 600; color: #ddd;";
    title.textContent = magicT("🔮 Magic 提示词编辑器");
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
        background: none; border: none; color: ${THEME.text2};
        cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px;
    `;
    closeBtn.addEventListener("mouseenter", () => closeBtn.style.background = THEME.hover);
    closeBtn.addEventListener("mouseleave", () => closeBtn.style.background = "none");
    closeBtn.addEventListener("click", () => closeEditorOverlay());
    preventConflict(closeBtn);
    header.appendChild(title);
    header.appendChild(closeBtn);
    dialog.appendChild(header);
    makeDialogDraggable(dialog, header);

    // ---- Tab Bar ----
    const tabBar = document.createElement("div");
    tabBar.style.cssText = `
        display: flex; background: ${THEME.bg2};
        border-bottom: 1px solid ${THEME.border}; flex-shrink: 0;
    `;
    const tabs = [
        { id: "edit", label: magicT("✒️ 编辑"), icon: "✒️" },
        { id: "history", label: magicT("📜 历史"), icon: "📜" },
        { id: "settings", label: magicT("⚙️ 设置"), icon: "⚙️" },
    ];
    let activeTab = "edit";
    tabs.forEach(t => {
        const btn = document.createElement("button");
        btn.textContent = t.label;
        btn.dataset.tab = t.id;
        btn.style.cssText = `
            flex: 1; padding: 10px 8px; background: none; border: none;
            color: ${THEME.text2}; cursor: pointer; font-size: 13px;
            border-bottom: 2px solid transparent; transition: all 0.2s;
        `;
        preventConflict(btn);
        btn.addEventListener("click", () => {
            activeTab = t.id;
            renderContent();
            // 更新 tab 高亮
            tabBar.querySelectorAll("button").forEach(b => {
                b.style.color = b.dataset.tab === activeTab ? "#fff" : THEME.text2;
                b.style.borderBottomColor = b.dataset.tab === activeTab ? THEME.accent : "transparent";
                b.style.background = b.dataset.tab === activeTab ? THEME.bg3 : "none";
            });
        });
        tabBar.appendChild(btn);
    });
    dialog.appendChild(tabBar);

    // ---- Content Area ----
    const content = document.createElement("div");
    content.style.cssText = `
        flex: 1; overflow-y: auto; padding: 16px;
        background: ${THEME.bg};
    `;
    preventConflict(content);
    dialog.appendChild(content);

    // ---- Footer ----
    const footer = document.createElement("div");
    footer.style.cssText = `
        display: flex; gap: 10px; align-items: center; justify-content: center;
        padding: 12px 18px; background: ${THEME.bg2};
        border-top: 1px solid ${THEME.border}; flex-shrink: 0;
    `;

    const btnStyle = (color) => `
        padding: 8px 28px; border: none; border-radius: 6px;
        cursor: pointer; font-size: 13px; color: #fff;
        background: ${color}; transition: opacity 0.2s;
    `;

    const footerCloseBtn = document.createElement("button");
    footerCloseBtn.textContent = magicT("✕ 关闭编辑器");
    footerCloseBtn.style.cssText = btnStyle(THEME.accent);
    preventConflict(footerCloseBtn);
    footerCloseBtn.addEventListener("mouseenter", () => (footerCloseBtn.style.opacity = "0.85"));
    footerCloseBtn.addEventListener("mouseleave", () => (footerCloseBtn.style.opacity = "1"));
    footerCloseBtn.addEventListener("click", () => closeEditorOverlay());

    footer.appendChild(footerCloseBtn);
    dialog.appendChild(footer);

    // =====================================================
    // 内容渲染
    // =====================================================
    let editorText = magicEnsureTrailingCommaPerLine(currentText);  // 本地编辑副本（与 WeiLin 一致：每行尾逗号）

    /** 历史/收藏操作后：写回 textarea（若在当前编辑 Tab）、节点 widget、widgets_values */
    function syncEditorTextToNodeAndDom() {
        const v = magicEnsureTrailingCommaPerLine(editorText);
        editorText = v;
        const ta = shell.querySelector("[data-magic-ta]");
        if (ta) {
            ta.value = v;
            ta._magicLastCaret = { start: v.length, end: v.length, vlen: v.length };
        }
        if (textWidget && node) syncMagicPromptTextWidget(node, textWidget, v);
    }

    function appendEditorTextFromHistorySnippet(snippet) {
        const raw = String(snippet || "").trim();
        if (!raw) return;
        let cur = (editorText || "").replace(/\s+$/, "");
        if (!cur) {
            editorText = magicEnsureTrailingCommaPerLine(raw);
        } else {
            const needSep = !(cur.endsWith(",") || /\n\s*$/.test(cur));
            editorText = magicEnsureTrailingCommaPerLine(cur + (needSep ? ", " : " ") + raw);
        }
        syncEditorTextToNodeAndDom();
    }

    function replaceEditorTextFromHistory(fullText) {
        editorText = magicEnsureTrailingCommaPerLine(fullText || "");
        syncEditorTextToNodeAndDom();
    }

    /** 编辑「历史收藏」名称与 tag 正文 */
    function openMagicHistoryFavoriteEditor(rootShell, item, onDone) {
        rootShell.querySelectorAll("[data-magic-fav-editor-overlay]").forEach((e) => e.remove());
        const overlay = document.createElement("div");
        overlay.setAttribute("data-magic-fav-editor-overlay", "1");
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:100075; pointer-events:auto;
            background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;
        `;
        preventConflict(overlay);
        const card = document.createElement("div");
        card.style.cssText = `
            width:min(92vw,520px); max-height:min(85vh,560px); overflow:hidden; display:flex; flex-direction:column;
            background:${THEME.bg}; border:1px solid ${THEME.border}; border-radius:10px;
            box-shadow:0 20px 60px rgba(0,0,0,0.65);
        `;
        preventConflict(card);
        const hdr = document.createElement("div");
        hdr.textContent = magicT("✎ 编辑收藏");
        hdr.style.cssText = `padding:12px 16px; font-weight:600; border-bottom:1px solid ${THEME.border}; background:${THEME.bg2}; color:#ddd;`;
        const body = document.createElement("div");
        body.style.cssText = `padding:14px 16px; overflow:auto; flex:1; min-height:0; display:flex; flex-direction:column; gap:10px;`;
        preventConflict(body);
        const ln = document.createElement("label");
        ln.textContent = magicT("名称");
        ln.style.cssText = `font-size:11px;color:${THEME.text2};`;
        const nameInp = document.createElement("input");
        nameInp.type = "text";
        nameInp.value = (item.name || "").trim();
        nameInp.style.cssText = `width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid ${THEME.border};background:${THEME.bg3};color:${THEME.text};`;
        preventConflict(nameInp);
        const lt = document.createElement("label");
        lt.textContent = magicT("英文 tag（逗号或换行分隔）");
        lt.style.cssText = `font-size:11px;color:${THEME.text2};`;
        const ta = document.createElement("textarea");
        ta.rows = 8;
        ta.value = item.text || "";
        ta.style.cssText = `width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid ${THEME.border};background:${THEME.bg3};color:${THEME.text};font-family:ui-monospace,monospace;font-size:12px;resize:vertical;min-height:140px;`;
        preventConflict(ta);
        body.appendChild(ln);
        body.appendChild(nameInp);
        body.appendChild(lt);
        body.appendChild(ta);
        const foot = document.createElement("div");
        foot.style.cssText = `display:flex; gap:10px; justify-content:flex-end; padding:12px 16px; border-top:1px solid ${THEME.border}; background:${THEME.bg2};`;
        const btnCancel = document.createElement("button");
        btnCancel.type = "button";
        btnCancel.textContent = magicT("取消");
        btnCancel.style.cssText = `padding:6px 16px;border-radius:6px;border:1px solid ${THEME.border};background:${THEME.bg3};color:${THEME.text};cursor:pointer;`;
        const btnSave = document.createElement("button");
        btnSave.type = "button";
        btnSave.textContent = magicT("保存");
        btnSave.style.cssText = `padding:6px 18px;border-radius:6px;border:none;background:${THEME.success};color:#fff;font-weight:600;cursor:pointer;`;
        preventConflict(btnCancel);
        preventConflict(btnSave);
        const close = () => {
            try {
                overlay.remove();
            } catch (_) { /* ignore */ }
        };
        btnCancel.addEventListener("click", close);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        btnSave.addEventListener("click", () => {
            const nm = nameInp.value.trim() || "未命名收藏";
            const tx = ta.value.trim();
            if (!tx) {
                alert(magicT("正文不能为空。"));
                return;
            }
            magicPostPromptHistory({
                action: "update_favorite",
                id: item.id,
                name: nm,
                text: tx,
            })
                .then(() => {
                    close();
                    if (typeof onDone === "function") onDone();
                })
                .catch((e) => alert((e && e.message) || String(e)));
        });
        foot.appendChild(btnCancel);
        foot.appendChild(btnSave);
        card.appendChild(hdr);
        card.appendChild(body);
        card.appendChild(foot);
        overlay.appendChild(card);
        rootShell.appendChild(overlay);
        nameInp.focus();
    }

    // 各 Tab 的内容生成器
    const tabContentFns = {
        edit: renderEditTab,
        history: renderHistoryTab,
        settings: renderSettingsTab,
    };

    function renderContent() {
        if (shell._magicTagFloatHideTimer) {
            clearTimeout(shell._magicTagFloatHideTimer);
            shell._magicTagFloatHideTimer = null;
        }
        if (shell._magicTagFloatBar) {
            shell._magicTagFloatBar.style.display = "none";
            shell._magicTagFloatBar.style.visibility = "hidden";
        }
        shell._magicTagFloatChip = null;
        if (shell._magicTagFloatScrollAbort) {
            try { shell._magicTagFloatScrollAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicTagFloatScrollAbort = null;
        }
        if (shell._magicTagUiTimer) {
            clearTimeout(shell._magicTagUiTimer);
            shell._magicTagUiTimer = null;
        }
        if (shell._magicTaResizeObserver) {
            try { shell._magicTaResizeObserver.disconnect(); } catch (_) { /* ignore */ }
            shell._magicTaResizeObserver = null;
        }
        if (typeof shell._magicAcDispose === "function") {
            try { shell._magicAcDispose(); } catch (_) { /* ignore */ }
            shell._magicAcDispose = null;
        }
        if (shell._magicCaretSaveAbort) {
            try { shell._magicCaretSaveAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicCaretSaveAbort = null;
        }
        if (shell._magicChipRowAbort) {
            try { shell._magicChipRowAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicChipRowAbort = null;
        }
        document.querySelectorAll("[data-magic-tag-rubber]").forEach((el) => el.remove());
        shell.querySelectorAll("[data-magic-tag-sel-popup], [data-magic-tag-drop-line]").forEach((el) => el.remove());
        shell._magicChipSelSet = null;
        shell._magicChipSelAnchor = null;
        shell._magicDragIndices = null;
        content.innerHTML = "";
        preventConflict(content);
        if (!tabContentFns[activeTab]) activeTab = "edit";
        const fn = tabContentFns[activeTab];
        if (fn) fn();
    }

    // ---- 编辑 Tab ----
    function renderEditTab() {
        content.style.alignItems = "stretch";
        // 勿在此处清空 _magicDanbooruAutocompleteActive：重建编辑区过程中若有代码读取该标志会误判为本地模式；
        // 实际值由文末 applyEditorAutocomplete(true/false) 统一设置。

        if (shell._magicChipRowAbort) {
            try {
                shell._magicChipRowAbort.abort();
            } catch (_) {
                /* ignore */
            }
            shell._magicChipRowAbort = null;
        }

        if (shell._magicTagFloatHideTimer) {
            clearTimeout(shell._magicTagFloatHideTimer);
            shell._magicTagFloatHideTimer = null;
        }
        if (shell._magicTagFloatBar && shell._magicTagFloatBar.parentNode) {
            shell._magicTagFloatBar.parentNode.removeChild(shell._magicTagFloatBar);
        }
        shell._magicTagFloatBar = null;
        shell._magicTagFloatChip = null;
        if (shell._magicTagFloatScrollAbort) {
            try { shell._magicTagFloatScrollAbort.abort(); } catch (_) { /* ignore */ }
            shell._magicTagFloatScrollAbort = null;
        }

        // 文本框先创建，供工具栏按钮闭包引用
        const textarea = document.createElement("textarea");
        textarea.value = editorText;
        textarea.dataset.magicTa = "1";
        const taH = clampTextareaHeightPx(dlgCfg.textareaMinHeight) ?? 160;
        textarea.style.cssText = `
            width: 100%; min-height: ${TEXTAREA_RESIZE_FLOOR_PX}px; height: ${taH}px; padding: 10px;
            background: ${THEME.bg3}; color: ${THEME.text};
            border: 1px solid ${THEME.border}; border-radius: 6px;
            font-size: 13px; line-height: 1.6; resize: vertical;
            box-sizing: border-box; outline: none; font-family: monospace;
        `;
        preventConflict(textarea);

        /** 在焦点被按钮/子窗体抢走之前记下光标（mousedown 捕获阶段，activeElement 仍是 textarea） */
        if (shell._magicCaretSaveAbort) {
            try { shell._magicCaretSaveAbort.abort(); } catch (_) { /* ignore */ }
        }
        const caretSaveAc = new AbortController();
        shell._magicCaretSaveAbort = caretSaveAc;
        const snapCaretBeforePointerLeavesTa = (e) => {
            if (document.activeElement !== textarea) return;
            const t = e.target;
            if (t === textarea) return;
            if (textarea.contains && textarea.contains(t)) return;
            textarea._magicLastCaret = {
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                vlen: textarea.value.length,
            };
        };
        shell.addEventListener("mousedown", snapCaretBeforePointerLeavesTa, {
            capture: true,
            signal: caretSaveAc.signal,
        });
        shell.addEventListener("touchstart", snapCaretBeforePointerLeavesTa, {
            capture: true,
            passive: true,
            signal: caretSaveAc.signal,
        });
        textarea.addEventListener(
            "keyup",
            () => {
                if (document.activeElement !== textarea) return;
                textarea._magicLastCaret = {
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd,
                    vlen: textarea.value.length,
                };
            },
            { signal: caretSaveAc.signal },
        );
        textarea.addEventListener(
            "mouseup",
            () => {
                if (document.activeElement !== textarea) return;
                textarea._magicLastCaret = {
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd,
                    vlen: textarea.value.length,
                };
            },
            { signal: caretSaveAc.signal },
        );

        /** 失焦时与 WeiLin 对齐：每行非空行尾自动补英文逗号 */
        textarea.addEventListener(
            "blur",
            () => {
                const cur = textarea.value;
                const norm = magicEnsureTrailingCommaPerLine(cur);
                if (norm === cur) {
                    editorText = cur;
                    updateStatAndChips();
                    return;
                }
                const sel = textarea.selectionStart;
                const mapped = magicMapCursorAfterEnsureTrailingComma(cur, sel);
                textarea.value = norm;
                editorText = norm;
                requestAnimationFrame(() => {
                    try {
                        textarea.setSelectionRange(mapped, mapped);
                    } catch (_) {
                        /* ignore */
                    }
                });
                updateStatAndChips();
            },
            { signal: caretSaveAc.signal },
        );

        (async () => {
            try {
                const r = await fetch(api.apiURL("/ma/tag_sets"), { credentials: "same-origin" });
                const d = await r.json();
                shell._magicFavoritesList = Array.isArray(d.favorites) ? d.favorites : [];
                shell._magicFavoriteEnKeys = new Set(
                    shell._magicFavoritesList.map((x) => magicTagEnKey(x.content)),
                );
            } catch (_) {
                shell._magicFavoritesList = [];
                shell._magicFavoriteEnKeys = new Set();
            }
        })();

        const stat = document.createElement("div");
        stat.style.cssText = `margin-top: 8px; font-size: 12px; color: ${THEME.text2}; text-align: right;`;

        const tagStrip = document.createElement("div");
        tagStrip.style.cssText = `
            margin-top: 10px; padding: 12px 14px 14px;
            background: ${THEME.bg2}; border: 1px solid ${THEME.border};
            border-radius: 6px; box-sizing: border-box;
        `;
        const tagStripTitle = document.createElement("div");
        tagStripTitle.style.cssText = `font-size: 11px; color: ${THEME.text2}; margin-bottom: 10px; line-height: 1.45;`;
        tagStripTitle.innerHTML = `
            <b>${magicT("Tag 预览")}</b>
            <span style="opacity:0.9">${magicT(" · 主框有内容才显示 · ↵ 换行芯片 · 单击 tag：锁定并显示权重条（点上方英文区才进入行内编辑；点下方中文区取消锁定） · 仅下方区域双击：屏蔽（*），避免与上方编辑冲突 · 点主输入框或空白处取消锁定 · 在芯片外侧留白或四周边距处拖拽：框选（过程中不弹工具条，实时蓝框预览） · 悬停芯片浅描边 · 框选后可整组拖拽（蓝线示落点）")}</span>
        `;
        const tagChipsHit = document.createElement("div");
        tagChipsHit.setAttribute("data-magic-tag-chips-hit", "1");
        tagChipsHit.style.cssText = `
            min-height: 88px;
            padding: 12px 14px 14px;
            margin: -4px -6px -6px;
            box-sizing: border-box;
            border-radius: 6px;
        `;
        const tagChipsRow = document.createElement("div");
        tagChipsRow.setAttribute("data-magic-tag-chips-row", "1");
        /** 纵向堆叠多行；每行内 flex 横排（↵ 固定在本行末尾，下一行另起一行，对齐 WeiLin） */
        tagChipsRow.style.cssText = `
            display: flex; flex-direction: column; align-items: stretch; gap: 12px;
            min-height: 64px;
        `;
        tagStrip.appendChild(tagStripTitle);
        tagChipsHit.appendChild(tagChipsRow);
        tagStrip.appendChild(tagChipsHit);
        shell._magicTagChipsRubberArmed = false;

        /** Tag 悬停浮层：挂在 shell 上（避免 dialog 的 transform 影响 fixed） */
        const tagFloat = createMagicTagToolbarBar({
            THEME,
            preventConflict,
            compact: true,
            onFavoriteToggle: async (wantOn) => {
                const barEl = shell._magicTagFloatBar;
                if (!barEl) return false;
                const idx = parseInt(barEl.dataset.tagIndex, 10);
                const tags = parseMagicPromptTags(textarea.value);
                const t = tags[idx];
                if (!t || t.isNewline) return false;
                const en = (t.text || "").trim();
                if (!en) return false;
                let cn = "";
                const chip = shell._magicTagFloatChip;
                if (chip) {
                    const hintEl = chip.querySelector("[data-magic-cn-hint]");
                    if (hintEl) {
                        const x = (hintEl.textContent || "").trim();
                        if (x && x !== "…" && x !== "—") cn = x;
                    }
                }
                const key = magicTagEnKey(en);
                let items = Array.isArray(shell._magicFavoritesList)
                    ? shell._magicFavoritesList.slice()
                    : [];
                if (wantOn) {
                    if (!items.some((it) => magicTagEnKey(it.content) === key)) {
                        // 规范化：压平换行、全角逗号，整理成干净逗号列表（与后端 ma_normalize_tagset_content 一致）
                        const safeEn = en
                            .replace(/[\r\n]+/g, " ")
                            .replace(/，/g, ",")
                            .replace(/、/g, ",")
                            .trim()
                            .replace(/\s*,\s*/g, ", ")
                            .replace(/,\s*,/g, ",");
                        items.push({ name: cn || "收藏", content: safeEn });
                    }
                } else {
                    items = items.filter((it) => magicTagEnKey(it.content) !== key);
                }
                try {
                    await magicPostTagSets({ favorites: items });
                    shell._magicFavoritesList = items;
                    if (!shell._magicFavoriteEnKeys) shell._magicFavoriteEnKeys = new Set();
                    if (wantOn) shell._magicFavoriteEnKeys.add(key);
                    else shell._magicFavoriteEnKeys.delete(key);
                    window.dispatchEvent(
                        new CustomEvent(MAGIC_TAG_SETS_CHANGED, { detail: { favorites: items } }),
                    );
                    return true;
                } catch (e) {
                    console.warn("[MagicText] favorite save", e && e.message ? e.message : e);
                    return false;
                }
            },
        });
        const floatBar = tagFloat.bar;
        floatBar.style.display = "none";
        floatBar.style.position = "fixed";
        floatBar.style.visibility = "hidden";
        floatBar.style.zIndex = "100055";
        floatBar.style.pointerEvents = "auto";
        floatBar.style.boxShadow = "0 10px 28px rgba(0,0,0,0.52)";
        preventConflict(floatBar);
        // 阻止 pointerdown/mousedown，避免用户在浮动条上拖拽时误选中文本
        floatBar.addEventListener("pointerdown", (e) => e.preventDefault());
        floatBar.addEventListener("mousedown", (e) => e.preventDefault());
        shell.appendChild(floatBar);
        shell._magicTagFloatBar = floatBar;
        // 首次定位前在 positionTagFloatBar 内测量并缓存（须先 display:flex，display:none 时宽高为 0）
        shell._magicTagFloatBarSize = { w: 0, h: 0, _initialized: false };

        /** 单次 RAF 定位（首次须先 display:flex 再测宽高，否则 sz.h=0 会把条叠在芯片上）
         *  首次定位时用两个 RAF 确保 number input 的 stepper 按钮尺寸被正确计算：
         *  - RAF1: display:flex → layout 开始
         *  - RAF2: 测量尺寸、设置位置并显示 → layout/repaint 已完成
         */
        const positionTagFloatBar = (chip) => {
            if (!chip || !chip.isConnected || !floatBar.isConnected) return;
            const sz = shell._magicTagFloatBarSize;
            const margin = 8;
            if (sz._initialized) {
                requestAnimationFrame(() => {
                    if (!chip.isConnected || !floatBar.isConnected) return;
                    const r = chip.getBoundingClientRect();
                    floatBar.style.display = "flex";
                    floatBar.style.transform = "translateX(-50%)";
                    let top = r.top - sz.h - margin;
                    if (top < 8) top = r.bottom + margin;
                    let cx = r.left + r.width / 2;
                    const half = sz.w / 2;
                    cx = Math.max(8 + half, Math.min(cx, window.innerWidth - 8 - half));
                    floatBar.style.left = Math.round(cx) + "px";
                    floatBar.style.top = Math.round(top) + "px";
                    floatBar.style.visibility = "visible";
                });
            } else {
                requestAnimationFrame(() => {
                    if (!chip.isConnected || !floatBar.isConnected) return;
                    floatBar.style.display = "flex";
                    floatBar.style.visibility = "hidden";
                    floatBar.style.transform = "translateX(-50%)";
                });
                requestAnimationFrame(() => {
                    if (!chip.isConnected || !floatBar.isConnected) return;
                    sz.w = floatBar.offsetWidth;
                    sz.h = floatBar.offsetHeight;
                    sz._initialized = true;
                    const r = chip.getBoundingClientRect();
                    let top = r.top - sz.h - margin;
                    if (top < 8) top = r.bottom + margin;
                    let cx = r.left + r.width / 2;
                    const half = sz.w / 2;
                    cx = Math.max(8 + half, Math.min(cx, window.innerWidth - 8 - half));
                    floatBar.style.left = Math.round(cx) + "px";
                    floatBar.style.top = Math.round(top) + "px";
                    floatBar.style.visibility = "visible";
                });
            }
        };

        const hideTagFloatBar = () => {
            floatBar.style.display = "none";
            floatBar.style.visibility = "hidden";
            shell._magicTagFloatChip = null;
        };

        const scheduleHideTagFloatBar = () => {
            if (shell._magicTagFloatHideTimer) {
                clearTimeout(shell._magicTagFloatHideTimer);
                shell._magicTagFloatHideTimer = null;
            }
            shell._magicTagFloatHideTimer = setTimeout(() => {
                shell._magicTagFloatHideTimer = null;
                hideTagFloatBar();
            }, 260);
        };

        const cancelHideTagFloatBar = () => {
            if (shell._magicTagFloatHideTimer) {
                clearTimeout(shell._magicTagFloatHideTimer);
                shell._magicTagFloatHideTimer = null;
            }
        };

        floatBar.addEventListener("mouseenter", cancelHideTagFloatBar);
        floatBar.addEventListener("mouseleave", () => {
            if (shell._magicChipToolbarPinnedIndex != null) return;
            scheduleHideTagFloatBar();
        });

        /** 芯片英文行内编辑：失焦以触发既有 blur→commit（点空白时 mousedown preventDefault 可能不带走焦点） */
        const blurChipTagInlineInputIfAny = () => {
            if (!tagChipsRow) return;
            const inp = tagChipsRow.querySelector("[data-magic-tag-index] input");
            if (inp) inp.blur();
        };

        /** 取消「单击锁定」并隐藏权重条（主输入框聚焦、点空白等） */
        const clearPinnedToolbar = () => {
            blurChipTagInlineInputIfAny();
            shell._magicChipToolbarPinnedIndex = null;
            cancelHideTagFloatBar();
            hideTagFloatBar();
            if (tagChipsRow) {
                tagChipsRow.querySelectorAll("[data-magic-tag-index][data-magic-toolbar-pin='1']").forEach((el) => {
                    el.removeAttribute("data-magic-toolbar-pin");
                    el.style.outline = "";
                    el.style.outlineOffset = "";
                });
            }
        };

        textarea.addEventListener(
            "focusin",
            () => {
                if (shell._magicChipToolbarPinnedIndex != null) {
                    clearPinnedToolbar();
                }
            },
            { signal: caretSaveAc.signal },
        );

        const onScrollReposition = () => {
            let ch = shell._magicTagFloatChip;
            if ((!ch || !ch.isConnected) && shell._magicChipToolbarPinnedIndex != null && tagChipsRow) {
                ch = tagChipsRow.querySelector(
                    `[data-magic-tag-index="${shell._magicChipToolbarPinnedIndex}"]`,
                );
            }
            if (ch && ch.isConnected && floatBar.style.display !== "none") {
                const chipEl =
                    tagChipsRow && tagChipsRow.querySelector(`[data-magic-tag-index="${ch.dataset.magicTagIndex}"]`);
                positionTagFloatBar(chipEl || ch);
            }
            positionSelPopup();
        };
        const tagFloatScrollAc = new AbortController();
        shell._magicTagFloatScrollAbort = tagFloatScrollAc;
        content.addEventListener("scroll", onScrollReposition, { capture: true, signal: tagFloatScrollAc.signal });
        window.addEventListener("resize", onScrollReposition, { signal: tagFloatScrollAc.signal });

        const cnHintCache = new Map();
        shell._magicRebuildPreserveIdx = null;
        shell._magicChipToolbarPinnedIndex = null;

        shell.querySelectorAll("[data-magic-tag-sel-popup], [data-magic-tag-drop-line]").forEach((el) => el.remove());
        shell._magicChipSelSet = new Set();
        shell._magicChipSelAnchor = null;
        shell._magicDragIndices = null;

        const dropLineEl = document.createElement("div");
        dropLineEl.setAttribute("data-magic-tag-drop-line", "1");
        dropLineEl.style.cssText = `
            display: none; position: fixed; width: 4px; border-radius: 2px;
            background: linear-gradient(180deg, #1890ff, #40a9ff);
            box-shadow: 0 0 12px rgba(24, 144, 255, 0.95);
            z-index: 100056; pointer-events: none;
        `;
        shell.appendChild(dropLineEl);

        const selPopup = document.createElement("div");
        selPopup.setAttribute("data-magic-tag-sel-popup", "1");
        selPopup.style.cssText = `
            display: none; position: fixed; z-index: 100057;
            min-width: 200px; max-width: min(92vw, 320px);
            background: ${THEME.bg2}; color: ${THEME.text};
            border: 1px solid ${THEME.border}; border-radius: 8px;
            box-shadow: 0 12px 36px rgba(0,0,0,0.55);
            padding: 8px 10px 10px; pointer-events: auto;
            box-sizing: border-box;
        `;
        preventConflict(selPopup);

        function showMagicChipToast(message) {
            let el = shell.querySelector("[data-magic-chip-toast='1']");
            if (!el) {
                el = document.createElement("div");
                el.setAttribute("data-magic-chip-toast", "1");
                el.style.cssText = `
                    display: none; position: fixed; z-index: 100059;
                    left: 50%; bottom: 28px; transform: translateX(-50%);
                    padding: 10px 22px; border-radius: 8px;
                    background: rgba(36, 36, 40, 0.96); color: #e8e8e8;
                    border: 1px solid ${THEME.border};
                    font-size: 13px; font-weight: 600;
                    box-shadow: 0 10px 32px rgba(0,0,0,0.5);
                    pointer-events: none; white-space: nowrap;
                `;
                shell.appendChild(el);
            }
            el.textContent = message;
            el.style.display = "block";
            if (shell._magicChipToastT) clearTimeout(shell._magicChipToastT);
            shell._magicChipToastT = setTimeout(() => {
                el.style.display = "none";
            }, 1800);
        }

        /** 芯片「A/文」单条 LLM：按点击顺序串行请求，不并发 */
        shell._magicChipLlmQueue = [];
        shell._magicChipLlmWorkerBusy = false;

        function enqueueMagicChipSingleLlm(coreRaw, coreKey, sub) {
            const raw = String(coreRaw || "").slice(0, 200);
            const key = coreKey && String(coreKey);
            if (!raw || !key) return;
            shell._magicChipLlmQueue.push({ coreRaw: raw, coreKey: key, sub });
            const pending = shell._magicChipLlmQueue.length;
            showMagicChipToast(magicT("已排队 ") + pending + magicT(" 条（按顺序翻译）"));
            void runMagicChipLlmWorker();
        }

        async function runMagicChipLlmWorker() {
            if (shell._magicChipLlmWorkerBusy) return;
            shell._magicChipLlmWorkerBusy = true;
            try {
                while (shell._magicChipLlmQueue.length) {
                    const job = shell._magicChipLlmQueue.shift();
                    const { coreRaw, coreKey, sub } = job;
                    const waitingBehind = shell._magicChipLlmQueue.length;
                    const translateMode =
                        (shell._magicEditorSettings && shell._magicEditorSettings.translate_mode) ||
                        "normal";
                    const forceChipRefresh = translateMode === "force";
                    if (sub && sub.isConnected) sub.textContent = "…";
                    try {
                        const r = await fetch(api.apiURL("/ma/translate_tags_llm"), {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                tags: [coreRaw],
                                send_all: false,
                                // refresh=true 会无视磁盘缓存强制打 API；默认 false 与一键翻译「正常模式」一致，先命中 llm_translation_cache
                                refresh: !!forceChipRefresh,
                                chip_single: true,
                                queue_waiting: waitingBehind,
                            }),
                        });
                        const j = await r.json();
                        if (j.status !== "success") {
                            throw new Error(j.message || `HTTP ${r.status}`);
                        }
                        magicApplyLlmTagTranslationsToCnCache([coreRaw], j.items || [], cnHintCache);
                        const cn = (cnHintCache.has(coreKey) && cnHintCache.get(coreKey)) || "";
                        const fromItem =
                            j.items && j.items[0] && String(j.items[0].cn || "").trim();
                        const line = String((cn && cn.trim()) || fromItem || "").trim();
                        if (sub && sub.isConnected) sub.textContent = line || "—";
                        const llmBatch =
                            j.llm_batch_size != null ? j.llm_batch_size : null;
                        if (llmBatch === 0 && line) {
                            showMagicChipToast(magicT("✅ 已命中 LLM 缓存（未请求 API）"));
                        }
                    } catch (err) {
                        console.warn("[MagicText] chip single LLM", err);
                        if (sub && sub.isConnected) sub.textContent = "—";
                        showMagicChipToast(magicT("❌ ") + ((err && err.message) || err));
                    }
                }
            } finally {
                shell._magicChipLlmWorkerBusy = false;
                if (shell._magicChipLlmQueue.length) void runMagicChipLlmWorker();
            }
        }

        const selPopupHead = document.createElement("div");
        selPopupHead.setAttribute("data-magic-sel-count", "1");
        selPopupHead.textContent = magicT("选中 0 个标签");
        selPopupHead.style.cssText = `font-size: 12px; font-weight: 600; color: #ddd; margin-bottom: 8px; text-align: center;`;
        selPopup.appendChild(selPopupHead);
        const selBtnRow = document.createElement("div");
        selBtnRow.style.cssText = "display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;";
        const mkSelBtn = (label, title, color, onClick) => {
            const b = document.createElement("button");
            b.type = "button";
            b.title = title;
            b.setAttribute("aria-label", title);
            b.innerHTML = label;
            b.style.cssText = `
                width: 36px; height: 32px; padding: 0; border-radius: 6px; cursor: pointer;
                border: 1px solid ${THEME.border}; background: ${THEME.bg3}; color: ${color};
                font-size: 16px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
                font-weight: 700;
            `;
            preventConflict(b);
            b.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onClick();
            });
            selBtnRow.appendChild(b);
            return b;
        };
        mkSelBtn("📋", magicT("一键复制"), "#ce93d8", () => {
            const set = shell._magicChipSelSet;
            if (!set || !set.size) return;
            const tags = parseMagicPromptTags(textarea.value);
            const txt = serializeMagicTagsAtIndices(tags, set);
            navigator.clipboard
                .writeText(txt)
                .then(() => showMagicChipToast(magicT("✅ 已复制到剪贴板")))
                .catch(() => showMagicChipToast(magicT("❌ 复制失败（请检查浏览器权限）")));
        });
        mkSelBtn("🚫", magicT("一键屏蔽（*）"), "#e57373", () => {
            const set = shell._magicChipSelSet;
            if (!set || !set.size) return;
            const next = parseMagicPromptTags(textarea.value);
            set.forEach((i) => {
                if (next[i] && !next[i].isNewline) next[i] = { ...next[i], disabled: true };
            });
            applyTagsAndRefresh(next);
            refreshChipSelVisual();
            positionSelPopup();
        });
        mkSelBtn("✓", magicT("一键启用"), "#81c784", () => {
            const set = shell._magicChipSelSet;
            if (!set || !set.size) return;
            const next = parseMagicPromptTags(textarea.value);
            set.forEach((i) => {
                if (next[i] && !next[i].isNewline) next[i] = { ...next[i], disabled: false };
            });
            applyTagsAndRefresh(next);
            refreshChipSelVisual();
            positionSelPopup();
        });
        mkSelBtn("✕", magicT("一键删除"), "#ef5350", () => {
            const set = shell._magicChipSelSet;
            if (!set || !set.size) return;
            const sorted = [...set].sort((a, b) => b - a);
            const next = parseMagicPromptTags(textarea.value);
            for (const i of sorted) next.splice(i, 1);
            clearChipSelection();
            applyTagsAndRefresh(next);
        });
        selPopup.appendChild(selBtnRow);
        shell.appendChild(selPopup);

        const hideDropLineEl = () => {
            dropLineEl.style.display = "none";
        };

        const showDropLineEl = (chipEl, insertAfter) => {
            const r = chipEl.getBoundingClientRect();
            dropLineEl.style.display = "block";
            dropLineEl.style.top = `${Math.round(r.top)}px`;
            dropLineEl.style.height = `${Math.round(r.height)}px`;
            if (insertAfter) {
                dropLineEl.style.left = `${Math.round(r.right + 3)}px`;
            } else {
                dropLineEl.style.left = `${Math.round(r.left - 6)}px`;
            }
            shell._magicDropInsertAfter = !!insertAfter;
        };

        function refreshChipSelVisual() {
            if (!shell._magicChipSelSet || !tagChipsRow) return;
            const set = shell._magicChipSelSet;
            tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                const idx = parseInt(el.dataset.magicTagIndex, 10);
                if (set.has(idx)) {
                    el.style.boxShadow = MAGIC_CHIP_SELECTED_GLOW;
                } else {
                    el.style.boxShadow = "";
                }
            });
        }

        /** 框选拖拽中：与最终选中相同蓝光，实时标示当前矩形覆盖到的芯片 */
        function updateRubberBandChipPreview(r) {
            if (!tagChipsRow || !r) return;
            tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                const er = el.getBoundingClientRect();
                const hit = !(
                    er.right < r.left ||
                    er.left > r.right ||
                    er.bottom < r.top ||
                    er.top > r.bottom
                );
                el.style.boxShadow = hit ? MAGIC_CHIP_SELECTED_GLOW : "";
            });
        }

        function clearRubberBandChipPreview() {
            if (!tagChipsRow) return;
            tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                el.style.boxShadow = "";
            });
        }

        function positionSelPopup() {
            if (!selPopup || !shell._magicChipSelSet || shell._magicChipSelSet.size === 0) {
                selPopup.style.display = "none";
                return;
            }
            const chips = [];
            shell._magicChipSelSet.forEach((idx) => {
                const el = tagChipsRow.querySelector(`[data-magic-tag-index="${idx}"]`);
                if (el) chips.push(el);
            });
            if (!chips.length) {
                selPopup.style.display = "none";
                return;
            }
            let minL = Infinity;
            let minT = Infinity;
            let maxR = -Infinity;
            let maxB = -Infinity;
            chips.forEach((el) => {
                const r = el.getBoundingClientRect();
                minL = Math.min(minL, r.left);
                minT = Math.min(minT, r.top);
                maxR = Math.max(maxR, r.right);
                maxB = Math.max(maxB, r.bottom);
            });
            const cx = (minL + maxR) / 2;
            selPopup.style.display = "block";
            selPopup.style.visibility = "hidden";
            selPopup.style.left = "0";
            selPopup.style.top = "0";
            const pw = selPopup.offsetWidth || 220;
            const ph = selPopup.offsetHeight || 72;
            selPopup.style.visibility = "visible";
            let left = cx - pw / 2;
            left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
            let top = minT - ph - 10;
            if (top < 8) top = maxB + 10;
            top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
            selPopup.style.left = `${Math.round(left)}px`;
            selPopup.style.top = `${Math.round(top)}px`;
            selPopup.style.transform = "none";
            selPopupHead.textContent = magicT("选中 ") + shell._magicChipSelSet.size + magicT(" 个标签");
        }

        function clearChipSelection() {
            blurChipTagInlineInputIfAny();
            if (shell._magicChipSelSet) {
                shell._magicChipSelSet.clear();
                shell._magicChipSelAnchor = null;
                selPopup.style.display = "none";
                refreshChipSelVisual();
            }
            if (shell._magicChipToolbarPinnedIndex != null) {
                clearPinnedToolbar();
            }
        }

        const attachChipDragHandlers = (chip, index) => {
            chip.addEventListener("dragstart", (e) => {
                if (chip.draggable === false) {
                    e.preventDefault();
                    return;
                }
                shell._magicChipToolbarPinnedIndex = null;
                cancelHideTagFloatBar();
                hideTagFloatBar();
                if (tagChipsRow) {
                    tagChipsRow.querySelectorAll("[data-magic-tag-index][data-magic-toolbar-pin='1']").forEach((el) => {
                        el.removeAttribute("data-magic-toolbar-pin");
                        el.style.outline = "";
                        el.style.outlineOffset = "";
                    });
                }
                if (shell._magicTagUiTimer) {
                    clearTimeout(shell._magicTagUiTimer);
                    shell._magicTagUiTimer = null;
                }
                let indices;
                if (shell._magicChipSelSet.has(index) && shell._magicChipSelSet.size > 1) {
                    indices = [...shell._magicChipSelSet].sort((a, b) => a - b);
                } else {
                    indices = [index];
                }
                shell._magicDragIndices = indices;
                try {
                    e.dataTransfer.setData("text/plain", `magic-tags:${indices.join(",")}`);
                } catch (_) {
                    /* ignore */
                }
                e.dataTransfer.effectAllowed = "move";
                chip.style.opacity = "0.45";
            });
            chip.addEventListener("dragend", () => {
                chip.style.opacity = "";
                tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                    el.style.opacity = "";
                });
                hideDropLineEl();
                setTimeout(() => {
                    shell._magicDragIndices = null;
                }, 0);
            });
            chip.addEventListener("dragenter", (e) => {
                e.preventDefault();
            });
            chip.addEventListener("dragover", (e) => {
                e.preventDefault();
                const moving = shell._magicDragIndices;
                if (!moving || !moving.length) return;
                const set = new Set(moving);
                if (set.has(index)) {
                    hideDropLineEl();
                    return;
                }
                const rect = chip.getBoundingClientRect();
                const insertAfter = e.clientX >= rect.left + rect.width / 2;
                showDropLineEl(chip, insertAfter);
                e.dataTransfer.dropEffect = "move";
            });
            chip.addEventListener("dragleave", (e) => {
                const rt = e.relatedTarget;
                if (
                    rt &&
                    (chip.contains(rt) ||
                        (tagChipsRow && tagChipsRow.contains(rt)) ||
                        (tagChipsHit && tagChipsHit.contains(rt)))
                ) {
                    return;
                }
                hideDropLineEl();
            });
            chip.addEventListener("drop", (e) => {
                e.preventDefault();
                hideDropLineEl();
                let fromList = shell._magicDragIndices;
                const td = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || "";
                if (td.startsWith("magic-tags:")) {
                    const parsed = td
                        .slice("magic-tags:".length)
                        .split(",")
                        .map((x) => parseInt(x, 10))
                        .filter((n) => !Number.isNaN(n));
                    if (parsed.length) fromList = parsed;
                }
                shell._magicDragIndices = null;
                if (!fromList || !fromList.length) return;
                const sorted = [...fromList].sort((a, b) => a - b);
                const set = new Set(sorted);
                if (set.has(index)) return;
                const tags = parseMagicPromptTags(textarea.value);
                const insertAfter = !!shell._magicDropInsertAfter;
                const next = magicReorderTagsByIndices(tags, sorted, index, insertAfter);
                clearChipSelection();
                applyTagsAndRefresh(next);
            });
        };

        const chipRowAc = new AbortController();
        shell._magicChipRowAbort = chipRowAc;
        tagChipsHit.addEventListener(
            "mousedown",
            (e) => {
                if (e.button !== 0) return;
                if (e.target.closest("[data-magic-tag-index]")) return;
                if (e.target.closest("[data-magic-tag-sel-popup]")) return;
                e.preventDefault();
                shell._magicTagChipsRubberArmed = true;
                if (shell._magicTagUiTimer) {
                    clearTimeout(shell._magicTagUiTimer);
                    shell._magicTagUiTimer = null;
                }
                clearPinnedToolbar();
                const x0 = e.clientX;
                const y0 = e.clientY;
                let moved = false;
                const rb = document.createElement("div");
                rb.setAttribute("data-magic-tag-rubber", "1");
                rb.style.cssText = `position:fixed;border:1px dashed #1890ff;background:rgba(24,144,255,0.14);z-index:100054;pointer-events:none;`;
                document.body.appendChild(rb);
                const norm = (ax, ay, bx, by) => {
                    const l = Math.min(ax, bx);
                    const t = Math.min(ay, by);
                    const w = Math.abs(bx - ax);
                    const h = Math.abs(by - ay);
                    return { l, t, w, h, left: l, top: t, right: l + w, bottom: t + h };
                };
                const onMove = (ev) => {
                    moved = moved || Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 3;
                    const r = norm(x0, y0, ev.clientX, ev.clientY);
                    rb.style.left = `${r.l}px`;
                    rb.style.top = `${r.t}px`;
                    rb.style.width = `${r.w}px`;
                    rb.style.height = `${r.h}px`;
                    if (moved) {
                        updateRubberBandChipPreview(r);
                    }
                };
                const onUp = (ev) => {
                    shell._magicTagChipsRubberArmed = false;
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    if (rb.parentNode) rb.parentNode.removeChild(rb);
                    clearRubberBandChipPreview();
                    if (!moved) {
                        clearChipSelection();
                        return;
                    }
                    const r = norm(x0, y0, ev.clientX, ev.clientY);
                    if (r.w < 5 && r.h < 5) {
                        clearChipSelection();
                        return;
                    }
                    const set = new Set();
                    tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                        const er = el.getBoundingClientRect();
                        if (!(er.right < r.left || er.left > r.right || er.bottom < r.top || er.top > r.bottom)) {
                            set.add(parseInt(el.dataset.magicTagIndex, 10));
                        }
                    });
                    if (set.size) {
                        shell._magicChipSelSet = set;
                        shell._magicChipSelAnchor = Math.min(...set);
                        refreshChipSelVisual();
                        positionSelPopup();
                    } else {
                        clearChipSelection();
                    }
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            },
            { signal: chipRowAc.signal },
        );

        function applyTagsAndRefresh(tags, preserveFloatIndex) {
            editorText = serializeMagicPromptTags(tags);
            textarea.value = editorText;
            if (preserveFloatIndex != null && preserveFloatIndex >= 0) {
                shell._magicRebuildPreserveIdx = preserveFloatIndex;
            }
            updateStatAndChips();
        }

        function updateStatAndChips() {
            editorText = textarea.value;
            const showStrip = magicPromptHasVisibleContent(editorText);
            tagStrip.style.display = showStrip ? "" : "none";
            const tags = showStrip ? parseMagicPromptTags(editorText) : [];
            const nWord = tags.filter((t) => !t.isNewline).length;
            const nNl = tags.filter((t) => t.isNewline).length;
            const ne = tags.filter((t) => !t.isNewline && !t.disabled).length;
            stat.textContent = `${magicT("字符数: ")}${editorText.length} | ${magicT("Tag: ")}${nWord}${magicT("（启用 ")}${ne}${magicT("）")}${
                nNl ? `${magicT(" · 换行 ")}${nNl}` : ""
            }`;
            if (!showStrip) {
                cancelHideTagFloatBar();
                hideTagFloatBar();
                shell._magicRebuildPreserveIdx = null;
                shell._magicChipToolbarPinnedIndex = null;
            } else {
                const preserveIdx = shell._magicRebuildPreserveIdx;
                shell._magicRebuildPreserveIdx = null;
                rebuildTagChips(tags, preserveIdx);
            }
            // 任意来源更新 textarea 后都写回节点（含 widgets_values / callback），否则 prompt 与下游仍用旧值
            if (activeTab === "edit" && textWidget && node) {
                syncMagicPromptTextWidget(
                    node,
                    textWidget,
                    magicEnsureTrailingCommaPerLine(editorText),
                );
            }
        }

        function rebuildTagChips(tags, preserveFloatIndex) {
            cancelHideTagFloatBar();
            hideTagFloatBar();
            tagChipsRow.innerHTML = "";
            if (!tags.length) {
                shell._magicChipToolbarPinnedIndex = null;
                clearChipSelection();
                const ph = document.createElement("div");
                ph.style.cssText = `font-size: 12px; color: ${THEME.text2}; font-style: italic;`;
                ph.textContent = magicT("解析结果为空");
                tagChipsRow.appendChild(ph);
                return;
            }

            let currentLine = null;
            const startTagLine = () => {
                currentLine = document.createElement("div");
                currentLine.setAttribute("data-magic-tag-line", "1");
                currentLine.style.cssText =
                    "display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px;min-height:0;";
                tagChipsRow.appendChild(currentLine);
            };

            const pendingCnHints = [];
            for (let index = 0; index < tags.length; index++) {
                const tagItem = tags[index];
                if (tagItem.isNewline) {
                    if (!currentLine) startTagLine();
                    const chip = document.createElement("div");
                    chip.draggable = true;
                    chip.dataset.magicNewlineChip = "1";
                    chip.dataset.magicTagIndex = String(index);
                    chip.title = magicT("换行（可删除；无权重条）");
                    chip.style.cssText = `
                        flex: 0 0 auto; width: 36px; min-height: 44px; cursor: grab;
                        background: ${THEME.bg3}; border: 1px solid ${THEME.border}; border-radius: 6px;
                        display: flex; flex-direction: column; align-items: center; justify-content: center;
                        font-size: 18px; color: #ccc; user-select: none; padding: 4px 0;
                        transition: box-shadow 0.14s ease, outline 0.14s ease;
                    `;
                    const sym = document.createElement("span");
                    sym.textContent = "↵";
                    sym.style.cssText = "line-height:1;opacity:0.9;";
                    const del = document.createElement("button");
                    del.type = "button";
                    del.dataset.del = "1";
                    del.textContent = "✕";
                    del.title = magicT("删除此换行");
                    del.style.cssText =
                        "margin-top:4px;border:none;background:transparent;color:#c62828;cursor:pointer;font-size:11px;line-height:1;padding:0;";
                    preventConflict(del);
                    del.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const next = parseMagicPromptTags(textarea.value);
                        next.splice(index, 1);
                        applyTagsAndRefresh(next);
                    });
                    chip.appendChild(sym);
                    chip.appendChild(del);
                    preventConflict(chip);
                    if (shell._magicChipSelSet && shell._magicChipSelSet.has(index)) {
                        chip.style.boxShadow = MAGIC_CHIP_SELECTED_GLOW;
                    }
                    chip.addEventListener("mouseenter", () => {
                        if (shell._magicTagChipsRubberArmed) return;
                        if (!shell._magicChipSelSet || !shell._magicChipSelSet.has(index)) {
                            chip.style.outline = "1px solid rgba(230, 230, 230, 0.42)";
                            chip.style.outlineOffset = "2px";
                        }
                    });
                    chip.addEventListener("mouseleave", () => {
                        chip.style.outline = "";
                        chip.style.outlineOffset = "";
                    });
                    attachChipDragHandlers(chip, index);
                    currentLine.appendChild(chip);
                    currentLine = null;
                    continue;
                }

                if (!currentLine) startTagLine();
                const chip = document.createElement("div");
                chip.draggable = true;
                chip.dataset.magicTagIndex = String(index);
                chip.style.cssText = `
                    flex: 0 0 auto; max-width: 220px; cursor: grab;
                    background: ${tagItem.disabled ? THEME.bg3 : "rgba(93, 64, 55, 0.72)"};
                    border: 1px solid ${THEME.border}; border-radius: 6px;
                    overflow: hidden; font-size: 12px; user-select: none;
                    transition: box-shadow 0.14s ease, outline 0.14s ease, filter 0.14s ease;
                    ${tagItem.disabled ? "opacity:0.58;" : ""}
                    ${
                        shell._magicChipSelSet && shell._magicChipSelSet.has(index)
                            ? `box-shadow:${MAGIC_CHIP_SELECTED_GLOW};`
                            : ""
                    }
                    ${
                        shell._magicChipToolbarPinnedIndex === index
                            ? `outline:${MAGIC_CHIP_TOOLBAR_PIN_OUTLINE};outline-offset:${MAGIC_CHIP_TOOLBAR_PIN_OFFSET};`
                            : ""
                    }
                `;
                if (shell._magicChipToolbarPinnedIndex === index) {
                    chip.setAttribute("data-magic-toolbar-pin", "1");
                }

                const top = document.createElement("div");
                top.setAttribute("data-magic-tag-top", "1");
                top.title = magicT("锁定后仅在此区域点击进入文字编辑");
                top.style.cssText =
                    "display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,0.25);cursor:text;";
                const tspan = document.createElement("span");
                tspan.textContent = tagItem.text || " ";
                tspan.style.cssText = `flex:1;min-width:0;word-break:break-word;font-size:12px;line-height:1.45;color:#f2f2f2;${
                    tagItem.disabled ? "text-decoration:line-through;" : ""
                }`;
                const del = document.createElement("button");
                del.type = "button";
                del.dataset.del = "1";
                del.textContent = "✕";
                del.title = magicT("删除");
                del.style.cssText =
                    "flex-shrink:0;border:none;background:transparent;color:#c62828;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;";
                preventConflict(del);
                del.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const next = parseMagicPromptTags(textarea.value);
                    next.splice(index, 1);
                    applyTagsAndRefresh(next);
                });
                top.appendChild(tspan);
                top.appendChild(del);

                const bottom = document.createElement("div");
                bottom.setAttribute("data-magic-tag-bottom", "1");
                bottom.title = magicT("双击此区域切换屏蔽（*）；锁定后单击下方取消锁定");
                bottom.style.cssText =
                    "display:flex;align-items:center;gap:5px;padding:5px 8px;color:#d8d8d8;font-size:11px;";
                const llmBtn = document.createElement("button");
                llmBtn.type = "button";
                llmBtn.dataset.magicCnLlm = "1";
                llmBtn.textContent = magicT("A/文");
                llmBtn.title = magicT("单独补全/刷新此 tag 的中文：默认先查 LLM 磁盘缓存（省 token）；在「设置 → 翻译」选「强制翻译」时才会无视缓存重请求。按点击顺序排队。");
                llmBtn.style.cssText = `
                    flex-shrink: 0; border: none; padding: 1px 4px; margin: 0;
                    border-radius: 4px; cursor: pointer; font-size: 11px; line-height: 1.25;
                    background: rgba(255,255,255,0.12); color: #e0e0e0;
                `;
                preventConflict(llmBtn);
                const sub = document.createElement("span");
                sub.setAttribute("data-magic-cn-hint", "1");
                sub.style.cssText =
                    "flex:1;min-width:0;word-break:break-word;font-size:11px;line-height:1.4;color:#ececec;";
                sub.textContent = "…";
                bottom.appendChild(llmBtn);
                bottom.appendChild(sub);

                chip.appendChild(top);
                chip.appendChild(bottom);
                preventConflict(chip);

                // 仅 stopPropagation：阻止透传到外层/textarea；勿 preventDefault，否则会取消 HTML5 drag，导致只能从未冒泡到芯片的 ✕ 上拖动。
                chip.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                });

                chip.addEventListener("mouseenter", () => {
                    if (shell._magicTagChipsRubberArmed) return;
                    const chipEl = tagChipsRow.querySelector(`[data-magic-tag-index="${index}"]`);
                    if (!chipEl) return;
                    if (shell._magicChipToolbarPinnedIndex === index) return;
                    if (!shell._magicChipSelSet || !shell._magicChipSelSet.has(index)) {
                        chipEl.style.outline = "1px solid rgba(230, 230, 230, 0.42)";
                        chipEl.style.outlineOffset = "2px";
                    }
                });
                chip.addEventListener("mouseleave", () => {
                    const chipEl = tagChipsRow && tagChipsRow.querySelector(`[data-magic-tag-index="${index}"]`);
                    if (!chipEl) return;
                    if (shell._magicChipToolbarPinnedIndex === index) {
                        chipEl.style.outline = MAGIC_CHIP_TOOLBAR_PIN_OUTLINE;
                        chipEl.style.outlineOffset = MAGIC_CHIP_TOOLBAR_PIN_OFFSET;
                    } else {
                        chipEl.style.outline = "";
                        chipEl.style.outlineOffset = "";
                    }
                });

                const startEdit = () => {
                    if (chip.querySelector("input")) return;
                    cancelHideTagFloatBar();
                    hideTagFloatBar();
                    chip.draggable = false;
                    const inp = document.createElement("input");
                    inp.type = "text";
                    inp.value = tagItem.text;
                    inp.style.cssText = `width:100%;box-sizing:border-box;padding:3px 5px;font-size:12px;background:${THEME.bg};color:${THEME.text};border:1px solid ${THEME.accent};border-radius:4px;`;
                    preventConflict(inp);
                    top.innerHTML = "";
                    top.appendChild(inp);
                    inp.focus();
                    inp.select();

                    const commitEdit = (vRaw) => {
                        const v = vRaw.trim();
                        const next = parseMagicPromptTags(textarea.value);
                        if (!next[index]) {
                            updateStatAndChips();
                            return;
                        }
                        if (!v) {
                            next.splice(index, 1);
                        } else {
                            next[index] = { ...next[index], text: v };
                        }
                        applyTagsAndRefresh(next);
                    };

                    const onBlur = () => {
                        setTimeout(() => {
                            commitEdit(inp.value);
                        }, 0);
                    };
                    inp.addEventListener("blur", onBlur);
                    inp.addEventListener("keydown", (ev) => {
                        if (ev.key === "Enter") {
                            ev.preventDefault();
                            inp.removeEventListener("blur", onBlur);
                            commitEdit(inp.value);
                        } else if (ev.key === "Escape") {
                            ev.preventDefault();
                            inp.removeEventListener("blur", onBlur);
                            updateStatAndChips();
                        }
                    });
                };

                const toggleDis = () => {
                    const next = parseMagicPromptTags(textarea.value);
                    if (next[index]) {
                        next[index] = { ...next[index], disabled: !next[index].disabled };
                        applyTagsAndRefresh(next);
                    }
                };

                chip.addEventListener("dblclick", (e) => {
                    if (e.target.closest("button[data-del]")) return;
                    // 仅下方区域双击切换屏蔽，避免上方英文区双击与行内编辑/选字冲突
                    if (!bottom.contains(e.target)) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (shell._magicTagUiTimer) {
                        clearTimeout(shell._magicTagUiTimer);
                        shell._magicTagUiTimer = null;
                    }
                    toggleDis();
                });

                chip.addEventListener("click", (e) => {
                    // detail===2 留给 dblclick（屏蔽，且仅下方区域会生效）
                    if (e.detail === 2) return;
                    if (e.target.closest("button[data-del]")) return;
                    if (e.target.closest("button[data-magic-cn-llm]")) return;
                    if (e.target.closest("input")) return;
                    e.stopPropagation();
                    if (shell._magicTagUiTimer) {
                        clearTimeout(shell._magicTagUiTimer);
                        shell._magicTagUiTimer = null;
                    }
                    const chipEl = tagChipsRow.querySelector(`[data-magic-tag-index="${index}"]`);
                    if (!chipEl) return;
                    const clickInTop = top.contains(e.target);
                    const clickInBottom = bottom.contains(e.target);
                    if (shell._magicChipToolbarPinnedIndex === index) {
                        if (clickInTop) {
                            startEdit();
                            return;
                        }
                        if (clickInBottom) {
                            clearPinnedToolbar();
                            refreshChipSelVisual();
                            return;
                        }
                        return;
                    }
                    clearChipSelection();
                    shell._magicChipToolbarPinnedIndex = index;
                    tagChipsRow.querySelectorAll("[data-magic-tag-index]").forEach((el) => {
                        const i = parseInt(el.dataset.magicTagIndex, 10);
                        el.removeAttribute("data-magic-toolbar-pin");
                        if (i === index) {
                            el.setAttribute("data-magic-toolbar-pin", "1");
                            el.style.outline = MAGIC_CHIP_TOOLBAR_PIN_OUTLINE;
                            el.style.outlineOffset = MAGIC_CHIP_TOOLBAR_PIN_OFFSET;
                        } else {
                            el.style.outline = "";
                            el.style.outlineOffset = "";
                        }
                    });
                    refreshChipSelVisual();
                    shell._magicTagFloatChip = chipEl;
                    floatBar.dataset.tagIndex = String(index);
                    const fk = shell._magicFavoriteEnKeys;
                    tagFloat.setFavOn(!!(fk && fk.has(magicTagEnKey(tagItem.text || ""))));
                    tagFloat.weightInp.value = String(findMagicTagInnerWeight(tagItem.text || ""));
                    cancelHideTagFloatBar();
                    positionTagFloatBar(chipEl);
                });

                attachChipDragHandlers(chip, index);

                currentLine.appendChild(chip);

                const coreRaw = magicCoreTagForCnLookup(tagItem.text);
                const coreKey = magicNormEnHint(coreRaw);
                if (coreKey) {
                    if (cnHintCache.has(coreKey)) {
                        sub.textContent = cnHintCache.get(coreKey) || "—";
                    } else {
                        // 记下待查词 → sub 元素，后续一次批量请求分发
                        pendingCnHints.push({ coreRaw, coreKey, sub });
                    }
                    llmBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        enqueueMagicChipSingleLlm(coreRaw, coreKey, sub);
                    });
                } else {
                    sub.textContent = "—";
                    llmBtn.disabled = true;
                    llmBtn.style.opacity = "0.35";
                    llmBtn.style.cursor = "not-allowed";
                    llmBtn.title = magicT("无法解析为有效 tag");
                }
            }

            // —— 批量请求缺失的中文提示词（一次查完，不再逐 chip 并发）——
            if (pendingCnHints.length) {
                // 收集已渲染但未缓存的 coreKey → sub
                const keyToSub = {};
                pendingCnHints.forEach(({ coreKey, sub }) => {
                    keyToSub[coreKey] = sub;
                });
                const queries = pendingCnHints.map((p) => p.coreRaw.slice(0, 80));
                (async () => {
                    try {
                        const res = await fetch(api.apiURL("/ma/prompt_autocomplete/batch"), {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ queries }),
                        });
                        const data = await res.json();
                        const results = data.results || {};
                        Object.entries(results).forEach(([key, info]) => {
                            const cn = (info && info.cn) || "";
                            cnHintCache.set(key, cn);
                            if (keyToSub[key] && keyToSub[key].isConnected) {
                                keyToSub[key].textContent = cn || "—";
                            }
                        });
                        // 没有匹配结果的 key 也缓存为空，避免重复请求
                        Object.keys(keyToSub).forEach((key) => {
                            if (!cnHintCache.has(key)) {
                                cnHintCache.set(key, "");
                                if (keyToSub[key] && keyToSub[key].isConnected) {
                                    keyToSub[key].textContent = "—";
                                }
                            }
                        });
                    } catch (_) {
                        Object.keys(keyToSub).forEach((key) => {
                            cnHintCache.set(key, "");
                        });
                    }
                })();
            }

            if (shell._magicChipSelSet && shell._magicChipSelSet.size > 0) {
                const maxI = tags.length - 1;
                [...shell._magicChipSelSet].forEach((i) => {
                    if (i < 0 || i > maxI) shell._magicChipSelSet.delete(i);
                });
                if (shell._magicChipSelSet.size === 0) {
                    selPopup.style.display = "none";
                } else {
                    refreshChipSelVisual();
                    requestAnimationFrame(() => positionSelPopup());
                }
            }

            const fkRestore = shell._magicFavoriteEnKeys;
            let restoreIdx = null;
            const pinI = shell._magicChipToolbarPinnedIndex;
            if (
                pinI != null &&
                pinI >= 0 &&
                pinI < tags.length &&
                floatBar.isConnected &&
                !tags[pinI].isNewline
            ) {
                restoreIdx = pinI;
            } else if (pinI != null) {
                shell._magicChipToolbarPinnedIndex = null;
            }
            if (
                restoreIdx == null &&
                preserveFloatIndex != null &&
                preserveFloatIndex >= 0 &&
                preserveFloatIndex < tags.length &&
                floatBar.isConnected &&
                !tags[preserveFloatIndex].isNewline
            ) {
                restoreIdx = preserveFloatIndex;
            }
            if (restoreIdx != null) {
                const chipEl = tagChipsRow.querySelector(
                    `[data-magic-tag-index="${restoreIdx}"]`,
                );
                if (chipEl) {
                    shell._magicTagFloatChip = chipEl;
                    floatBar.dataset.tagIndex = String(restoreIdx);
                    const ttxt = tags[restoreIdx].text || "";
                    tagFloat.setFavOn(!!(fkRestore && fkRestore.has(magicTagEnKey(ttxt))));
                    tagFloat.weightInp.value = String(
                        findMagicTagInnerWeight(ttxt),
                    );
                    cancelHideTagFloatBar();
                    positionTagFloatBar(chipEl);
                }
            }
        }

        const commitFloatBarWeight = () => {
            const idx = parseInt(floatBar.dataset.tagIndex, 10);
            if (Number.isNaN(idx)) return;
            const tags = parseMagicPromptTags(textarea.value);
            if (!tags[idx] || tags[idx].isNewline) return;
            const w = parseFloat(tagFloat.weightInp.value);
            if (!Number.isFinite(w)) return;
            if (!isMagicBracketComplete(tags[idx].text)) return;
            const nt = applyMagicTagWeight(tags[idx].text, w);
            tags[idx] = { ...tags[idx], text: nt };
            applyTagsAndRefresh(tags, idx);
        };
        tagFloat.weightInp.addEventListener("change", (e) => {
            e.stopPropagation();
            commitFloatBarWeight();
        });
        tagFloat.weightInp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commitFloatBarWeight();
                tagFloat.weightInp.blur();
            }
        });

        // 捕获阶段处理：子按钮上的 preventConflict 会 stopPropagation(click)，冒泡到不了 floatBar
        floatBar.addEventListener(
            "click",
            (e) => {
                const btn = e.target && e.target.closest && e.target.closest("button[data-bracket-act]");
                if (!btn || !floatBar.contains(btn)) return;
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(floatBar.dataset.tagIndex, 10);
                if (Number.isNaN(idx)) return;
                const open = btn.dataset.bracketOpen;
                const act = btn.dataset.bracketAct;
                if (!open || !act) return;
                const tags = parseMagicPromptTags(textarea.value);
                if (!tags[idx] || tags[idx].isNewline) return;
                let t = tags[idx].text;
                if (act === "add") t = magicWrapTagText(t, open);
                else t = magicRemoveTagBracketLayer(t, open);
                tags[idx] = { ...tags[idx], text: t };
                applyTagsAndRefresh(tags, idx);
            },
            false,
        );

        tagFloat.newlineBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(floatBar.dataset.tagIndex, 10);
            if (Number.isNaN(idx)) return;
            const tags = parseMagicPromptTags(textarea.value);
            if (!tags[idx] || tags[idx].isNewline) return;
            const newText = serializeMagicPromptTagsWithNewlineAfter(tags, idx);
            textarea.value = newText;
            shell._magicRebuildPreserveIdx = idx;
            updateStatAndChips();
        });

        const syncEditorFromTextarea = () => {
            clearChipSelection();
            updateStatAndChips();
        };

        // 工具栏
        const toolbar = document.createElement("div");
        toolbar.style.cssText = `
            display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;
        `;
        const tbCfg =
            shell._magicEditorSettings && shell._magicEditorSettings.editor_toolbar
                ? shell._magicEditorSettings.editor_toolbar
                : MAGIC_DEFAULT_EDITOR_TOOLBAR;
        const toolBtns = [
            { key: "format", label: magicT("💫 格式化"), action: "format" },
            { key: "dedup", label: magicT("🔄 去重"), action: "dedup" },
            { key: "clear_all", label: magicT("🗑️ 清空全部"), action: "clear" },
            {
                key: "clear_disabled",
                label: magicT("🚫 清空屏蔽"),
                action: "clear_disabled",
                title: magicT("删除所有以 * 屏蔽的 tag（保留未屏蔽内容）"),
            },
            { key: "copy", label: magicT("📋 复制"), action: "copy" },
        ];
        toolBtns.forEach((tb) => {
            if (tbCfg[tb.key] === false) return;
            const b = document.createElement("button");
            b.textContent = tb.label;
            if (tb.title) b.title = tb.title;
            b.style.cssText = `
                padding: 5px 12px; background: ${THEME.bg3}; border: 1px solid ${THEME.border};
                color: ${THEME.text}; border-radius: 5px; cursor: pointer; font-size: 12px;
            `;
            preventConflict(b);
            b.addEventListener("click", () => {
                if (tb.action === "format") {
                    void (async () => {
                        b.disabled = true;
                        const prevLabel = b.textContent;
                        try {
                            b.textContent = magicT("⏳ 格式化中…");
                            const fo =
                                shell._magicFormatOptions &&
                                typeof shell._magicFormatOptions === "object"
                                    ? shell._magicFormatOptions
                                    : magicMergeFormatOptions(null);
                            const res = await fetch(api.apiURL("/ma/format_prompt"), {
                                method: "POST",
                                credentials: "same-origin",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    text: editorText,
                                    format_options: fo,
                                }),
                            });
                            const tx = await res.text();
                            let j = null;
                            try {
                                j = JSON.parse(tx);
                            } catch (_) {
                                /* ignore */
                            }
                            if (!res.ok || (j && j.status === "error")) {
                                const msg =
                                    (j && (j.message || j.error)) ||
                                    (tx && tx.length < 400 ? tx : "") ||
                                    `HTTP ${res.status}`;
                                throw new Error(msg);
                            }
                            const cleaned =
                                j && j.text != null ? String(j.text) : "";
                            let afterMaid = magicEnsureTrailingCommaPerLine(cleaned);
                            /* 保留原「格式化」：去掉空片段、各 tag trim（与旧版 parse→serialize 一致） */
                            const tgs = parseMagicPromptTags(afterMaid)
                                .map((t) =>
                                    t.isNewline
                                        ? t
                                        : { ...t, text: (t.text || "").trim() },
                                )
                                .filter((t) => t.isNewline || (t.text && t.text.length));
                            editorText = serializeMagicPromptTags(tgs);
                            textarea.value = editorText;
                            syncEditorFromTextarea();
                            b.textContent = magicT("✅ 已完成");
                            setTimeout(() => {
                                b.textContent = prevLabel;
                            }, 1200);
                        } catch (e) {
                            console.warn("[MagicText] format_prompt", e);
                            alert(
                                (e && e.message) ||
                                    magicT("格式化失败：请确认已重启 ComfyUI，且扩展已加载。"),
                            );
                            b.textContent = prevLabel;
                        } finally {
                            b.disabled = false;
                        }
                    })();
                } else if (tb.action === "dedup") {
                    const tgs = parseMagicPromptTags(editorText);
                    const seen = new Set();
                    const out = [];
                    for (const t of tgs) {
                        if (t.isNewline) {
                            out.push(t);
                            continue;
                        }
                        const k = (t.text || "").trim().toLowerCase();
                        if (!k || seen.has(k)) continue;
                        seen.add(k);
                        out.push(t);
                    }
                    editorText = serializeMagicPromptTags(out);
                    textarea.value = editorText;
                } else if (tb.action === "clear") {
                    editorText = "";
                    textarea.value = "";
                } else if (tb.action === "clear_disabled") {
                    const tgs = parseMagicPromptTags(editorText).filter(
                        (t) => t.isNewline || !t.disabled,
                    );
                    editorText = serializeMagicPromptTags(tgs);
                    textarea.value = editorText;
                } else if (tb.action === "copy") {
                    navigator.clipboard.writeText(editorText).then(() => {
                        b.textContent = magicT("✅ 已复制!");
                        setTimeout(() => { b.textContent = tb.label; }, 1500);
                    });
                }
                syncEditorFromTextarea();
            });
            toolbar.appendChild(b);
        });
        const editTagsBtn = document.createElement("button");
        editTagsBtn.type = "button";
        editTagsBtn.textContent = magicT("🏷️ 编辑标签");
        editTagsBtn.title = magicT("打开标签编辑窗口");
        editTagsBtn.style.cssText = `
            padding: 5px 12px; background: ${THEME.bg3}; border: 1px solid ${THEME.border};
            color: ${THEME.text}; border-radius: 5px; cursor: pointer; font-size: 12px;
        `;
        preventConflict(editTagsBtn);
        editTagsBtn.addEventListener("click", () =>
            showMagicEditTagsModal(shell, {
                getTextarea: () => textarea,
                afterInsert: () => {
                    editorText = textarea.value;
                    syncEditorFromTextarea();
                },
                danbooruMode: !!shell._magicDanbooruAutocompleteActive,
            }),
        );
        if (tbCfg.edit_tags !== false) toolbar.appendChild(editTagsBtn);

        const translateInput = document.createElement("input");
        translateInput.type = "text";
        translateInput.setAttribute("data-magic-translate-input", "1");
        translateInput.placeholder = magicT("输入任意语言，Enter：短词→tag，长句→一句自然英文");
        translateInput.title = magicT("与「批量译 tag」不同：短并列概念可译成逗号分隔的英文 tag；完整长句译成一整句自然英文（少用逗号以免被拆成多个芯片）。插入后仅在与原文分段对齐或整句单段时写入翻译缓存。");
        translateInput.style.cssText = `
            box-sizing: border-box;
            flex: 0 0 auto;
            width: 200px;
            max-width: min(200px, 38vw);
            padding: 5px 10px;
            font-size: 12px;
            line-height: 1.35;
            background: ${THEME.bg};
            color: ${THEME.text};
            border: 1px solid ${THEME.border};
            border-radius: 5px;
            outline: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        `;
        translateInput.addEventListener("focus", () => {
            translateInput.style.borderColor = "rgba(96, 125, 139, 0.55)";
            translateInput.style.boxShadow = "0 0 0 2px rgba(96, 125, 139, 0.12)";
        });
        translateInput.addEventListener("blur", () => {
            translateInput.style.borderColor = THEME.border;
            translateInput.style.boxShadow = "none";
        });
        preventConflict(translateInput);
        translateInput.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const val = translateInput.value.trim();
            if (!val) return;
            void (async () => {
                translateInput.disabled = true;
                try {
                    const r = await fetch(api.apiURL("/ma/translate_line_llm"), {
                        method: "POST",
                        credentials: "same-origin",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: val }),
                    });
                    const j = await r.json();
                    if (j.status !== "success") {
                        throw new Error(j.message || `HTTP ${r.status}`);
                    }
                    const out = String(j.text || "").trim();
                    if (!out) throw new Error(magicT("模型未返回有效英文"));
                    magicSeedCnHintFromTranslateLine(val, out, cnHintCache);
                    insertMagicPromptAtCaret(textarea, out, () => {
                        editorText = textarea.value;
                        syncEditorFromTextarea();
                    });
                    translateInput.value = "";
                    let seeded = 0;
                    try {
                        const sr = await fetch(api.apiURL("/ma/llm_translation_cache/seed_from_line"), {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ source_zh: val, en_line: out }),
                        });
                        const sj = await sr.json();
                        if (sj.status === "success" && typeof sj.seeded === "number") {
                            seeded = sj.seeded;
                        }
                    } catch (seedErr) {
                        console.warn("[MagicText] seed_from_line", seedErr);
                    }
                    showMagicChipToast(
                        seeded > 0
                            ? magicT("✅ 已插入（") + (j.profile_used || "LLM") + magicT("）· 已写入翻译缓存 ") + seeded + magicT(" 条")
                            : magicT("✅ 已插入（") + (j.profile_used || "LLM") + magicT("）"),
                    );
                } catch (err) {
                    console.warn("[MagicText] translate_line_llm", err);
                    alert((err && err.message) || String(err));
                } finally {
                    translateInput.disabled = false;
                }
            })();
        });

        const translateBtn = document.createElement("button");
        translateBtn.type = "button";
        translateBtn.textContent = magicT("🌐 一键翻译所有Tag");
        translateBtn.title = magicT("找出词库未命中中文的芯片（A/文 为 —），一次性打包请求 LLM；也可点芯片左下角「A/文」按钮单条排队翻译（设置 → 翻译 中选模型）");
        translateBtn.style.cssText = `
            padding: 5px 12px; background: ${THEME.bg3}; border: 1px solid ${THEME.border};
            color: ${THEME.text}; border-radius: 5px; cursor: pointer; font-size: 12px;
        `;
        preventConflict(translateBtn);
        translateBtn.addEventListener("click", () => {
            void (async () => {
                if (translateBtn.disabled) return;
                const translateMode =
                    (shell._magicEditorSettings && shell._magicEditorSettings.translate_mode) || "normal";
                const forceTranslate = translateMode === "force";
                const toSend = forceTranslate
                    ? magicCollectAllTagsForLlmTranslate(textarea)
                    : magicCollectTagsMissingCnHint(textarea, cnHintCache);
                if (!toSend.length) {
                    showMagicChipToast(
                        forceTranslate ? magicT("当前没有可送 LLM 的 tag") : magicT("✅ 词库已覆盖，无需 AI 翻译"),
                    );
                    return;
                }
                const prevLabel = translateBtn.textContent;
                translateBtn.disabled = true;
                translateBtn.textContent = magicT("翻译 ") + toSend.length + magicT(" 条…");
                try {
                    const r = await fetch(api.apiURL("/ma/translate_tags_llm"), {
                        method: "POST",
                        credentials: "same-origin",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tags: toSend, send_all: !!forceTranslate }),
                    });
                    const j = await r.json();
                    if (j.status !== "success") {
                        throw new Error(j.message || `HTTP ${r.status}`);
                    }
                    magicApplyLlmTagTranslationsToCnCache(toSend, j.items || [], cnHintCache);
                    updateStatAndChips();
                    const n = (j.items && j.items.length) || 0;
                    const hits = j.cache_hits || 0;
                    const total = j.cache_total || 0;
                    const cacheLimit =
                        (shell._magicEditorSettings && shell._magicEditorSettings.llm_cache_max) || 150;
                    const llmBatch = j.llm_batch_size != null ? j.llm_batch_size : n;
                    let msg = magicT("✅ 已更新 ") + n + magicT(" 条中文");
                    if (j.profile_used) msg += "（" + j.profile_used + "）";
                    if (j.send_all) {
                        msg += magicT("【强制翻译】本次 LLM ") + llmBatch + magicT(" 条");
                        if (hits > 0) msg += magicT("（其中 ") + hits + magicT(" 条命中 LLM 缓存，已覆盖）");
                    } else if (hits > 0) {
                        msg += magicT(" | LLM 缓存命中 ") + hits + magicT(" 条（跳过 API）");
                    }
                    if (total > 0) msg += magicT(" | 缓存累计 ") + total + "/" + cacheLimit;
                    showMagicChipToast(msg);
                } catch (err) {
                    console.warn("[MagicText] translate_tags_llm", err);
                    alert((err && err.message) || String(err));
                } finally {
                    translateBtn.disabled = false;
                    translateBtn.textContent = prevLabel;
                }
            })();
        });
        if (tbCfg.translate_all !== false) toolbar.appendChild(translateBtn);
        if (tbCfg.translate_input !== false) toolbar.appendChild(translateInput);
        content.appendChild(toolbar);

        content.appendChild(textarea);
        content.appendChild(tagStrip);
        const acLim =
            shell._magicEditorSettings && shell._magicEditorSettings.prompt_autocomplete_limit != null
                ? shell._magicEditorSettings.prompt_autocomplete_limit
                : AUTOCOMPLETE_LIMIT;

        const applyEditorAutocomplete = (useDanbooru) => {
            /* 与内联补全是否挂载无关：编辑标签弹窗等共用「当前是否 Danbooru 数据源」 */
            shell._magicDanbooruAutocompleteActive = !!useDanbooru;
            const tbAc = magicMergeEditorToolbar(shell._magicEditorSettings && shell._magicEditorSettings.editor_toolbar);
            if (typeof shell._magicAcDispose === "function") {
                try {
                    shell._magicAcDispose();
                } catch (_) {
                    /* ignore */
                }
                shell._magicAcDispose = null;
            }
            if (tbAc.autocomplete_popup === false) return;
            attachMagicPromptAutocomplete(textarea, {
                onInput: syncEditorFromTextarea,
                panelMount: shell,
                scrollRoots: [content],
                limit: acLim,
                danbooruMode: !!useDanbooru,
            });
        };

        const danbooruConnBar = document.createElement("div");
        danbooruConnBar.style.cssText = `margin-top: 10px; font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 6px; background: ${THEME.bg3}; border: 1px solid ${THEME.border}; color: ${THEME.text2};`;

        const prefMode = magicNormalizeDanbooruMode(
            shell._magicEditorSettings && shell._magicEditorSettings.danbooru_mode,
        );
        if (prefMode === "local") {
            danbooruConnBar.textContent = magicT("补全来源：本地标签库");
            applyEditorAutocomplete(false);
        } else {
            if (shell._magicDanbooruConnChecked) {
                const cached = shell._magicDanbooruConnResult;
                if (cached && cached.ok) {
                    danbooruConnBar.style.color = THEME.success;
                    danbooruConnBar.style.borderColor = "rgba(76, 175, 80, 0.35)";
                    danbooruConnBar.textContent = magicT("✅ Danbooru 已连接，补全与标签搜索使用Danbooru数据");
                    applyEditorAutocomplete(true);
                } else {
                    danbooruConnBar.style.color = THEME.danger;
                    danbooruConnBar.style.borderColor = "rgba(244, 67, 54, 0.35)";
                    danbooruConnBar.textContent =
                        magicT("补全来源：本地标签库");
                    applyEditorAutocomplete(false);
                }
            } else {
                danbooruConnBar.textContent = magicT("正在检测 Danbooru 连接…");
                applyEditorAutocomplete(false);
                void (async () => {
                    const result = await magicDanbooruCheckConnection();
                    shell._magicDanbooruConnChecked = true;
                    shell._magicDanbooruConnResult = result;
                    if (!shell.isConnected || !document.body.contains(shell)) return;
                    if (result.ok) {
                        danbooruConnBar.style.color = THEME.success;
                        danbooruConnBar.style.borderColor = "rgba(76, 175, 80, 0.35)";
                        danbooruConnBar.textContent = magicT("✅ Danbooru 已连接，补全与标签搜索使用Danbooru数据");
                        applyEditorAutocomplete(true);
                    } else {
                        danbooruConnBar.style.color = THEME.danger;
                        danbooruConnBar.style.borderColor = "rgba(244, 67, 54, 0.35)";
                        danbooruConnBar.textContent =
                            magicT("❌ Danbooru 不可用：") +
                            (result.message || "?") +
                            magicT(" · 已切换为本地补全（设置已保存为本地）");
                        await magicPersistDanbooruModeOnly("local");
                        applyEditorAutocomplete(false);
                    }
                })();
            }
        }

        try {
            const debouncedPersistTa = debounce(
                () => persistMagicDialogSize(dialog, dlgCfg),
                TEXTAREA_RESIZE_SAVE_DEBOUNCE_MS,
            );
            const ro = new ResizeObserver(() => debouncedPersistTa());
            ro.observe(textarea);
            shell._magicTaResizeObserver = ro;
        } catch (_) { /* 无 ResizeObserver 时仍有关闭/拖窗体时保存 */ }

        content.appendChild(stat);

        // 提示
        const hint = document.createElement("div");
        hint.style.cssText = `margin-top: 12px; font-size: 11px; color: ${THEME.text2}; line-height: 1.5;`;
        const h1 = magicT("💡 提示：输入提示词，用英文逗号 ");
        const h2 = magicT(" 或换行分隔。");
        const h3 = magicT("主框为空（无换行、无有效字符）时下方 Tag 区会隐藏；换行在预览里显示为 ");
        const h4 = magicT("↵ 芯片");
        const h5 = magicT("。");
        const h6 = magicT("屏蔽段以 ");
        const h7 = magicT(" 写入，节点编码时");
        const h8 = magicT("会忽略输出这些tag到final_text与conditioning。");
        hint.innerHTML = `
            <b>${h1}</b><code style="background:${THEME.bg3};padding:2px 5px;border-radius:3px;">,</code>${h2}
            ${h3}<b>${h4}</b>${h5}
            ${h6}<code style="background:${THEME.bg3};padding:2px 5px;border-radius:3px;">*</code>${h7},${h8}
        `;
        content.appendChild(hint);
        content.appendChild(danbooruConnBar);

        updateStatAndChips();

        // 暴露给外部（后续翻译等功能直接操作）
        shell._magicTranslateInput = translateInput;
        shell._magicTranslateBtn = translateBtn;
    }

    // ---- 历史 Tab ----
    function renderHistoryTab() {
        content.style.alignItems = "stretch";
        let sub = "history";

        const topHint = document.createElement("div");
        topHint.style.cssText = `font-size: 12px; color: ${THEME.text2}; margin-bottom: 12px; line-height: 1.45;`;
        topHint.innerHTML = magicT("📜 工作流") + "<strong>" + magicT("完整执行成功") + "</strong>" + magicT("后，会将画布上所有「多功能提示词框」的文本写入本地；写入前与已有记录") + "<strong>" + magicT("按内容去重") + "</strong>（<code style=\"background:" + THEME.bg3 + ";padding:1px 4px;border-radius:3px;\">userdata/magic_prompt_history.json</code>）" + magicT("。");

        const subBar = document.createElement("div");
        subBar.style.cssText = `display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;`;

        const listMount = document.createElement("div");
        listMount.style.cssText = `display:flex; flex-direction:column; gap:10px; min-height:120px;`;

        const btnHist = document.createElement("button");
        btnHist.type = "button";
        btnHist.dataset.sub = "history";
        btnHist.textContent = magicT("📋 运行历史");
        const btnFav = document.createElement("button");
        btnFav.type = "button";
        btnFav.dataset.sub = "favorites";
        btnFav.textContent = magicT("⭐ 历史收藏");
        [btnHist, btnFav].forEach((b) => {
            b.style.cssText = `
                padding: 8px 16px; border-radius: 6px; border: 1px solid ${THEME.border};
                background: ${THEME.bg3}; color: ${THEME.text2}; font-size: 12px; cursor: pointer; font-weight: 600;
            `;
            preventConflict(b);
        });

        function refreshSubTabs() {
            [btnHist, btnFav].forEach((b) => {
                const on = b.dataset.sub === sub;
                b.style.background = on ? "rgba(156, 39, 176, 0.22)" : THEME.bg3;
                b.style.color = on ? "#fff" : THEME.text2;
                b.style.borderColor = on ? THEME.accent : THEME.border;
            });
        }

        btnHist.addEventListener("click", () => {
            sub = "history";
            refreshSubTabs();
            loadAndRenderList();
        });
        btnFav.addEventListener("click", () => {
            sub = "favorites";
            refreshSubTabs();
            loadAndRenderList();
        });

        function renderHistoryRow(it, isFav) {
            const row = document.createElement("div");
            row.style.cssText = `
                display:flex; align-items:stretch; gap:0;
                background:${THEME.bg3}; border:1px solid ${THEME.border}; border-radius:8px; overflow:hidden;
            `;
            const btnCol = document.createElement("div");
            btnCol.style.cssText = `
                flex-shrink:0; display:flex; flex-direction:column; justify-content:center; gap:4px;
                padding:8px; background:${THEME.bg2}; border-right:1px solid ${THEME.border};
            `;
            const mkIconBtn = (sym, title, onClick, color) => {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = sym;
                b.title = title;
                b.setAttribute("aria-label", title);
                b.style.cssText = `
                    width:34px; min-height:30px; border-radius:6px; border:1px solid ${THEME.border};
                    background:${THEME.bg}; color:${color || THEME.text}; font-size:14px; cursor:pointer; font-weight:700;
                `;
                preventConflict(b);
                b.addEventListener("click", (e) => {
                    e.stopPropagation();
                    onClick();
                });
                return b;
            };

            if (!isFav) {
                btnCol.appendChild(
                    mkIconBtn("⤵", magicT("追加到当前提示词末尾"), () => {
                        appendEditorTextFromHistorySnippet(it.text);
                    }, "#81c784"),
                );
                btnCol.appendChild(
                    mkIconBtn("▣", magicT("覆盖写入（替换编辑器全文）"), () => {
                        if (!confirm(magicT("确定用本条覆盖当前编辑器中的全部提示词？"))) return;
                        replaceEditorTextFromHistory(it.text);
                    }, THEME.accent),
                );
                btnCol.appendChild(
                    mkIconBtn("☆", magicT("加入历史收藏（可命名）"), () => {
                        const defName = (it.text || "").slice(0, 28).trim() || magicT("收藏");
                        const name = prompt(magicT("收藏名称"), defName);
                        if (name == null) return;
                        magicPostPromptHistory({
                            action: "add_favorite",
                            name: name.trim() || defName,
                            text: it.text,
                        })
                            .then(() => loadAndRenderList())
                            .catch((e) => alert((e && e.message) || String(e)));
                    }, "#FFC107"),
                );
                btnCol.appendChild(
                    mkIconBtn("🗑", magicT("从运行历史中删除"), () => {
                        if (!confirm(magicT("从运行历史中删除此项？"))) return;
                        magicPostPromptHistory({ action: "delete_history", id: it.id })
                            .then(() => loadAndRenderList())
                            .catch((e) => alert((e && e.message) || String(e)));
                    }, THEME.danger),
                );
            } else {
                btnCol.appendChild(
                    mkIconBtn("⤵", magicT("追加到当前提示词"), () => {
                        appendEditorTextFromHistorySnippet(it.text);
                    }, "#81c784"),
                );
                btnCol.appendChild(
                    mkIconBtn("▣", magicT("覆盖写入"), () => {
                        if (!confirm(magicT("确定覆盖当前编辑器？"))) return;
                        replaceEditorTextFromHistory(it.text);
                    }, THEME.accent),
                );
                btnCol.appendChild(
                    mkIconBtn("✎", magicT("编辑名称与 tag 正文"), () => {
                        openMagicHistoryFavoriteEditor(shell, it, () => loadAndRenderList());
                    }, "#64b5f6"),
                );
                btnCol.appendChild(
                    mkIconBtn("🗑", magicT("删除收藏"), () => {
                        if (!confirm(magicT("删除这条收藏？"))) return;
                        magicPostPromptHistory({ action: "delete_favorite", id: it.id })
                            .then(() => loadAndRenderList())
                            .catch((e) => alert((e && e.message) || String(e)));
                    }, THEME.danger),
                );
            }

            const body = document.createElement("div");
            body.style.cssText = `flex:1; min-width:0; padding:10px 12px; cursor:pointer;`;
            body.title = magicT("点击正文区域：追加到当前提示词末尾");
            preventConflict(body);
            const timeEl = document.createElement("div");
            timeEl.style.cssText = `font-size:11px;color:${THEME.text2};margin-bottom:6px;`;
            if (isFav) {
                const nm = document.createElement("b");
                nm.textContent = (it.name || magicT("未命名")).trim();
                nm.style.cssText = "color:#e1bee7;margin-right:8px;";
                timeEl.appendChild(nm);
                const ts = document.createElement("span");
                ts.textContent = magicFormatHistoryTime(it.ts);
                timeEl.appendChild(ts);
            } else {
                timeEl.textContent = magicFormatHistoryTime(it.ts);
            }
            const textEl = document.createElement("div");
            textEl.textContent = it.text || "";
            textEl.style.cssText = `font-size:12px;color:${THEME.text};line-height:1.45;word-break:break-word;font-family:ui-monospace,monospace;white-space:pre-wrap;max-height:140px;overflow:auto;`;

            body.appendChild(timeEl);
            body.appendChild(textEl);
            body.addEventListener("click", () => {
                appendEditorTextFromHistorySnippet(it.text);
            });

            row.appendChild(btnCol);
            row.appendChild(body);
            listMount.appendChild(row);
        }

        async function loadAndRenderList() {
            listMount.innerHTML = "";
            const loading = document.createElement("div");
            loading.textContent = magicT("加载中…");
            loading.style.cssText = `text-align:center;color:${THEME.text2};padding:24px;`;
            listMount.appendChild(loading);
            let data;
            try {
                data = await magicFetchPromptHistory();
            } catch (e) {
                listMount.innerHTML = "";
                const er = document.createElement("div");
                er.style.cssText = `color:#e57373;text-align:center;padding:20px;font-size:13px;`;
                er.textContent = (e && e.message) || magicT("加载失败，请确认已重启 ComfyUI。");
                listMount.appendChild(er);
                return;
            }
            listMount.innerHTML = "";
            if (sub === "history") {
                const items = data.history || [];
                if (!items.length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = `text-align:center;color:${THEME.text2};padding:40px 12px;font-size:13px;line-height:1.5;`;
                    empty.textContent = magicT("暂无记录。成功跑完一次工作流后，会自动保存画布上各提示词框内容。");
                    listMount.appendChild(empty);
                } else {
                    const cap = document.createElement("div");
                    cap.style.cssText = `font-size:11px;color:${THEME.text2};margin-bottom:2px;`;
                    cap.textContent = magicT("当前最多保留 ") + data.max_entries + magicT(" 条（超出丢弃最旧；可在「设置」修改并立即裁剪）。");
                    listMount.appendChild(cap);
                    items.forEach((it) => renderHistoryRow(it, false));
                }
            } else {
                const items = data.favorites || [];
                if (!items.length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = `text-align:center;color:${THEME.text2};padding:40px 12px;font-size:13px;line-height:1.5;`;
                    empty.textContent = magicT("暂无收藏。在「运行历史」左侧点击 ☆ 可加入此处，并可命名、编辑正文。");
                    listMount.appendChild(empty);
                } else {
                    items.forEach((it) => renderHistoryRow(it, true));
                }
            }
        }

        subBar.appendChild(btnHist);
        subBar.appendChild(btnFav);
        content.appendChild(topHint);
        content.appendChild(subBar);
        content.appendChild(listMount);
        refreshSubTabs();
        loadAndRenderList();
    }

    // ---- 设置 Tab ----
    function renderSettingsTab() {
        content.style.alignItems = "stretch";

        const intro = document.createElement("div");
        intro.style.cssText = `font-size: 12px; color: ${THEME.text2}; margin-bottom: 14px; line-height: 1.5;`;
        intro.textContent = magicT("以下选项写入 userdata/settings.txt（与弹窗尺寸等共用）。修改任意项后会自动保存；返回「编辑」Tab 可看到工具栏等变化。");
        content.appendChild(intro);

        const stRef = shell._magicEditorSettings;
        const tbLive = magicMergeEditorToolbar(stRef && stRef.editor_toolbar);

        const mkCollapsible = (titleText, subtitleText, defaultOpen) => {
            const wrap = document.createElement("div");
            wrap.style.cssText = `
                margin-bottom: 10px; border: 1px solid ${THEME.border}; border-radius: 8px;
                overflow: hidden; background: ${THEME.bg3};
            `;
            const head = document.createElement("button");
            head.type = "button";
            head.style.cssText = `
                width: 100%; display: flex; align-items: center; justify-content: space-between;
                gap: 10px; padding: 12px 14px; background: ${THEME.bg2}; border: none; cursor: pointer;
                color: ${THEME.text}; text-align: left; box-sizing: border-box;
            `;
            const headLeft = document.createElement("div");
            headLeft.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;";
            const hTitle = document.createElement("div");
            hTitle.textContent = titleText;
            hTitle.style.cssText = "font-size:14px;font-weight:600;";
            const hSub = document.createElement("div");
            hSub.textContent = subtitleText || "";
            hSub.style.cssText = `font-size:11px;color:${THEME.text2};font-weight:400;line-height:1.4;`;
            headLeft.appendChild(hTitle);
            if (subtitleText) headLeft.appendChild(hSub);
            const chev = document.createElement("span");
            let expanded = !!defaultOpen;
            chev.textContent = expanded ? "▼" : "▶";
            chev.style.cssText = `flex-shrink:0;color:${THEME.text2};font-size:12px;width:20px;text-align:center;`;
            head.appendChild(headLeft);
            head.appendChild(chev);
            const panel = document.createElement("div");
            panel.style.cssText = `
                padding: 14px; display: ${expanded ? "block" : "none"};
                background: ${THEME.bg}; border-top: 1px solid ${THEME.border};
            `;
            head.addEventListener("click", () => {
                expanded = !expanded;
                panel.style.display = expanded ? "block" : "none";
                chev.textContent = expanded ? "▼" : "▶";
            });
            preventConflict(head);
            wrap.appendChild(head);
            wrap.appendChild(panel);
            content.appendChild(wrap);
            return panel;
        };

        /* —— 1 · 编辑界面显示 —— */
        const panel1 = mkCollapsible(
            magicT("1 · 编辑界面显示设置"),
            magicT("控制「编辑」Tab 顶部工具栏与内联补全弹窗：默认全部开启，关闭后对应按钮、输入框或补全列表将隐藏。"),
            false,
        );
        const section1Checks = {};
        const section1Defs = [
            { key: "format", label: magicT("💫 格式化") },
            { key: "dedup", label: magicT("🔄 去重") },
            { key: "clear_all", label: magicT("🗑️ 清空全部") },
            { key: "clear_disabled", label: magicT("🚫 清空屏蔽") },
            { key: "copy", label: magicT("📋 复制") },
            { key: "edit_tags", label: magicT("🏷️ 编辑标签") },
            { key: "translate_all", label: magicT("🌐 一键翻译所有Tag") },
            { key: "translate_input", label: magicT("单行翻译输入框（按 Enter）") },
            {
                key: "autocomplete_popup",
                label: magicT("🔍 开启补全弹窗（打字时显示 Tag 候选列表）"),
                sub: magicT("关闭后编辑框输入时不弹出补全列表；词库搜索、标签编辑弹窗等独立补全功能不受影响。"),
            },
        ];
        section1Defs.forEach((def) => {
            const hasSub = !!def.sub;
            const row = document.createElement("label");
            row.style.cssText = `
                display: flex; align-items: ${hasSub ? "flex-start" : "center"}; gap: 10px; padding: 8px 6px; margin-bottom: 4px;
                border-radius: 6px; cursor: pointer; user-select: none;
            `;
            row.addEventListener("mouseenter", () => {
                row.style.background = THEME.hover;
            });
            row.addEventListener("mouseleave", () => {
                row.style.background = "transparent";
            });
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = tbLive[def.key] !== false;
            section1Checks[def.key] = cb;
            cb.style.cssText = `width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:#9C27B0;${
                hasSub ? "margin-top:2px;" : ""
            }`;
            preventConflict(cb);
            if (hasSub) {
                const right = document.createElement("div");
                right.style.cssText = "flex:1;min-width:0;";
                const span = document.createElement("div");
                span.textContent = def.label;
                span.style.cssText = `font-size: 13px; color: ${THEME.text}; font-weight: 600;`;
                const sub = document.createElement("div");
                sub.textContent = def.sub;
                sub.style.cssText = `font-size: 11px; color: ${THEME.text2}; margin-top: 2px; line-height: 1.35;`;
                right.appendChild(span);
                right.appendChild(sub);
                row.appendChild(cb);
                row.appendChild(right);
            } else {
                const span = document.createElement("span");
                span.textContent = def.label;
                span.style.cssText = `font-size: 13px; color: ${THEME.text};`;
                row.appendChild(cb);
                row.appendChild(span);
            }
            panel1.appendChild(row);
        });

        /* —— 2 · 格式化（各选项独立生效，不含修复分区语法）—— */
        const panel2 = mkCollapsible(
            magicT("2 · 格式化详细设置"),
            magicT("对应「编辑」Tab 的 💫 格式化按钮；调用后端 /ma/format_prompt。各选项独立生效，勾哪个跑哪个。「清理逗号」「修复括号」始终独立执行；高级步骤（下划线/权重/括号转义）按勾选各自处理；全部高级子项关闭时后端直接返回原文本。"),
            false,
        );
        const foLive = magicMergeFormatOptions(stRef && stRef.format_options);
        const fmtHint = document.createElement("div");
        fmtHint.style.cssText = `font-size: 11px; color: ${THEME.text2}; line-height: 1.5; margin-bottom: 12px;`;
        fmtHint.innerHTML = magicT("选项来自 ") + `<code style="background:${THEME.bg3};padding:1px 4px;border-radius:3px;">userdata/settings.txt</code>` + magicT(" 的 ") + "<b>format_options</b>" + magicT("。修改后自动写入；返回「编辑」再点格式化即生效。");
        panel2.appendChild(fmtHint);

        const fmtChecks = {};
        const fmtCheckDefs = [
            { key: "cleanup_commas", label: magicT("清理逗号（cleanup_commas）"), sub: magicT("删除首尾逗号、连续逗号") },
            { key: "cleanup_whitespace", label: magicT("清理空白（cleanup_whitespace）"), sub: magicT("首尾空白、重复空格、逗号旁多余空格") },
            { key: "remove_lora_tags", label: magicT("移除 LoRA 标签（remove_lora_tags）"), sub: magicT("删除 &lt;lora:…&gt;") },
            { key: "underscore_to_space", label: magicT("下划线转空格（underscore_to_space）"), sub: magicT("tag_name → tag name") },
            { key: "complete_weight_syntax", label: magicT("权重语法补全（complete_weight_syntax）"), sub: magicT("如 tag:1.2 → (tag:1.2)") },
            { key: "smart_bracket_escaping", label: magicT("智能括号转义（smart_bracket_escaping）"), sub: magicT("系列名括号 \\(\\) 与漏逗号分段处理") },
            { key: "standardize_commas", label: magicT("标准化逗号（standardize_commas）"), sub: magicT("英文逗号 + 空格连接各标签") },
        ];
        fmtCheckDefs.forEach((def) => {
            const row = document.createElement("label");
            row.style.cssText = `
                display: flex; align-items: flex-start; gap: 10px; padding: 8px 6px; margin-bottom: 4px;
                border-radius: 6px; cursor: pointer; user-select: none;
            `;
            row.addEventListener("mouseenter", () => {
                row.style.background = THEME.hover;
            });
            row.addEventListener("mouseleave", () => {
                row.style.background = "transparent";
            });
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = foLive[def.key] !== false;
            fmtChecks[def.key] = cb;
            cb.style.cssText = "width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;accent-color:#9C27B0;";
            preventConflict(cb);
            const right = document.createElement("div");
            const span = document.createElement("div");
            span.textContent = def.label;
            span.style.cssText = `font-size: 13px; color: ${THEME.text}; font-weight: 600;`;
            const sub = document.createElement("div");
            sub.textContent = def.sub || "";
            sub.style.cssText = `font-size: 11px; color: ${THEME.text2}; margin-top: 2px; line-height: 1.35;`;
            right.appendChild(span);
            if (def.sub) right.appendChild(sub);
            right.style.cssText = "flex:1;min-width:0;";
            row.appendChild(cb);
            row.appendChild(right);
            panel2.appendChild(row);
        });

        const mkSelectRow = (label, desc, selectEl) => {
            const wrap = document.createElement("div");
            wrap.style.cssText = `margin: 14px 6px 8px;`;
            const lbl = document.createElement("div");
            lbl.textContent = label;
            lbl.style.cssText = `font-size: 13px; color: ${THEME.text}; font-weight: 600; margin-bottom: 4px;`;
            const d = document.createElement("div");
            d.textContent = desc;
            d.style.cssText = `font-size: 11px; color: ${THEME.text2}; line-height: 1.45; margin-bottom: 8px;`;
            selectEl.style.cssText = `
                width: 100%; max-width: 360px; padding: 8px 10px; background: ${THEME.bg3};
                border: 1px solid ${THEME.border}; color: ${THEME.text}; border-radius: 6px;
                font-size: 13px; box-sizing: border-box;
            `;
            preventConflict(selectEl);
            wrap.appendChild(lbl);
            wrap.appendChild(d);
            wrap.appendChild(selectEl);
            panel2.appendChild(wrap);
        };

        const selNewlines = document.createElement("select");
        [
            { v: "false", t: magicT("否 — 保留换行") },
            { v: "space", t: magicT("空格 — \\n → 空格") },
            { v: "comma", t: magicT("逗号 — \\n → \", \"") },
        ].forEach((o) => {
            const op = document.createElement("option");
            op.value = o.v;
            op.textContent = o.t;
            selNewlines.appendChild(op);
        });
        selNewlines.value = foLive.cleanup_newlines || "false";
        mkSelectRow(
            magicT("清理换行（cleanup_newlines）"),
            magicT("含 COUPLE / MASK 等多区域语法时，后端只会把换行替换为空格，不会替换为逗号，以免破坏结构。"),
            selNewlines,
        );

        const selBrackets = document.createElement("select");
        [
            { v: "false", t: magicT("否") },
            { v: "parenthesis", t: magicT("圆括号 — 移除不配对的 ( )") },
            { v: "brackets", t: magicT("方括号 — 移除不配对的 [ ]") },
            { v: "both", t: magicT("两者") },
        ].forEach((o) => {
            const op = document.createElement("option");
            op.value = o.v;
            op.textContent = o.t;
            selBrackets.appendChild(op);
        });
        selBrackets.value = foLive.fix_brackets || "both";
        mkSelectRow(
            magicT("修复括号（fix_brackets）"),
            magicT("仅在未勾选任何高级子项时按原版逻辑执行；勾了高级子项时由智能格式化流程处理。"),
            selBrackets,
        );

        /* —— 3 · 翻译（LLM 与 MagicPromptReplace 共用 llm_settings.txt）—— */
        const panel3 = mkCollapsible(
            magicT("3 · 翻译功能设置"),
            magicT("选择翻译调用的 LLM 配置；「管理 LLM」与「多功能AI提示词替换」节点的配置中心写入同一文件 userdata/llm_settings.txt。"),
            false,
        );
        const p3intro = document.createElement("div");
        p3intro.style.cssText = `font-size: 12px; color: ${THEME.text2}; line-height: 1.55; margin-bottom: 12px;`;
        p3intro.innerHTML = magicT("当前翻译使用的配置名会写入 ") + `<code style="background:${THEME.bg3};padding:1px 4px;border-radius:3px;">settings.txt</code>` + magicT(" 的 ") + "<b>translate_llm_profile</b>" + magicT("；修改后即自动保存。LLM 的 Base URL / Key / Model 在「管理 LLM 配置」中编辑。");
        panel3.appendChild(p3intro);

        const p3row = document.createElement("div");
        p3row.style.cssText =
            "display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 10px;";
        const p3left = document.createElement("div");
        p3left.style.cssText = "flex: 1; min-width: 200px;";
        const p3lbl = document.createElement("div");
        p3lbl.textContent = magicT("翻译使用的 LLM 配置");
        p3lbl.style.cssText = `font-size: 13px; font-weight: 600; color: ${THEME.text}; margin-bottom: 6px;`;
        const selTranslateProfile = document.createElement("select");
        selTranslateProfile.setAttribute("data-magic-translate-llm-profile", "1");
        selTranslateProfile.style.cssText = `
            width: 100%; max-width: 400px; padding: 8px 10px; background: ${THEME.bg3};
            border: 1px solid ${THEME.border}; color: ${THEME.text}; border-radius: 6px;
            font-size: 13px; box-sizing: border-box;
        `;
        preventConflict(selTranslateProfile);
        p3left.appendChild(p3lbl);
        p3left.appendChild(selTranslateProfile);

        const btnManageLlm = document.createElement("button");
        btnManageLlm.type = "button";
        btnManageLlm.textContent = magicT("⚙️ 管理 LLM 配置…");
        btnManageLlm.title = magicT("打开与「多功能AI提示词替换 → 配置中心 → LLM服务」相同的编辑界面");
        btnManageLlm.style.cssText = `
            padding: 8px 16px; border-radius: 6px; border: 1px solid ${THEME.accent};
            background: rgba(156, 39, 176, 0.2); color: #e1bee7; font-size: 12px;
            font-weight: 600; cursor: pointer; flex-shrink: 0;
        `;
        preventConflict(btnManageLlm);

        const refillTranslateProfileOptions = async () => {
            try {
                const r = await fetch(api.apiURL("/ma/get_config"), { credentials: "same-origin" });
                const d = await r.json();
                const llm = d.llm && typeof d.llm === "object" ? d.llm : {};
                const keys = Object.keys(llm);
                const prev = selTranslateProfile.value;
                selTranslateProfile.innerHTML = "";
                if (!keys.length) {
                    const op = document.createElement("option");
                    op.value = "";
                    op.textContent = magicT("（暂无 LLM 配置，请先点「管理 LLM」添加）");
                    selTranslateProfile.appendChild(op);
                    return;
                }
                keys.forEach((k) => {
                    const op = document.createElement("option");
                    op.value = k;
                    op.textContent = k;
                    selTranslateProfile.appendChild(op);
                });
                const want =
                    (stRef && stRef.translate_llm_profile) ||
                    (shell._magicEditorSettings && shell._magicEditorSettings.translate_llm_profile) ||
                    "";
                if (want && keys.includes(want)) selTranslateProfile.value = want;
                else if (prev && keys.includes(prev)) selTranslateProfile.value = prev;
                else selTranslateProfile.value = keys[0];
            } catch (e) {
                console.warn("[MagicText] refillTranslateProfileOptions", e);
                selTranslateProfile.innerHTML = "";
                const op = document.createElement("option");
                op.value = "";
                op.textContent = magicT("（加载失败，请重启 ComfyUI）");
                selTranslateProfile.appendChild(op);
            }
        };

        p3row.appendChild(p3left);
        p3row.appendChild(btnManageLlm);
        panel3.appendChild(p3row);

        /* —— 翻译模式：互斥二选一 —— */
        const p3modeRow = document.createElement("div");
        p3modeRow.style.cssText = `
            margin-bottom: 16px; padding: 10px 14px;
            background: rgba(156,39,176,0.08); border-radius: 8px;
            border: 1px solid rgba(156,39,176,0.25);
        `;
        const p3modeTitle = document.createElement("div");
        p3modeTitle.style.cssText = `font-size: 12px; color: ${THEME.text2}; margin-bottom: 10px; font-weight: 600;`;
        p3modeTitle.textContent = magicT("翻译模式（二选一）");
        p3modeRow.appendChild(p3modeTitle);

        const mkRadio = (value, labelHtml, hintHtml, isDefault) => {
            const id = `magic-llm-mode-${value}`;
            const wrap = document.createElement("div");
            wrap.style.cssText = `
                display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; cursor: pointer;
            `;
            const rb = document.createElement("input");
            rb.type = "radio";
            rb.name = "magic-llm-mode";
            rb.value = value;
            rb.id = id;
            preventConflict(rb);
            const currentMode = (stRef && stRef.translate_mode) || "normal";
            rb.checked = currentMode === value;
            rb.style.cssText = "margin-top: 3px; flex-shrink: 0;";
            const lbl = document.createElement("label");
            lbl.htmlFor = id;
            lbl.style.cssText = `font-size: 13px; color: ${THEME.text}; cursor: pointer; line-height: 1.5;`;
            lbl.innerHTML = `<b>${labelHtml}</b><br><span style="font-size:11px;color:${THEME.text2};">${hintHtml}</span>`;
            wrap.appendChild(rb);
            wrap.appendChild(lbl);
            return { wrap, rb };
        };

        const normalRadio = mkRadio(
            "normal",
            magicT("📖 正常翻译模式（默认）"),
            magicT("仅翻译本地词库未命中的 tag，已命中词库的 chip 保留原样；LLM 缓存命中的 tag 也跳过 API，最省 token。结果 = 词库 + LLM 缓存。"),
        );
        const forceRadio = mkRadio(
            "force",
            magicT("⚡ 强制翻译模式"),
            magicT("忽略本地词库命中状态，所有 tag 都送 LLM 重译（已在 LLM 缓存的 tag 也会被覆盖）。翻译结果 = LLM 返回，适用于词典/缓存质量不佳需要整体重翻的情况。"),
        );
        p3modeRow.appendChild(normalRadio.wrap);
        p3modeRow.appendChild(forceRadio.wrap);

        const getTranslateMode = () =>
            normalRadio.rb.checked ? "normal" : "force";
        panel3.appendChild(p3modeRow);

        void refillTranslateProfileOptions();

        /* —— 4 · 补全与历史 —— */
        const panel4 = mkCollapsible(
            magicT("4 · 补全与历史等其他设置"),
            magicT("内联补全列表条数上限、运行历史保留条数。"),
            false,
        );

        const mkNumRow = (label, desc, inputRefHolder) => {
            const row = document.createElement("div");
            row.style.cssText = `
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                flex-wrap: wrap; margin-bottom: 14px;
            `;
            const left = document.createElement("div");
            const lbl = document.createElement("div");
            lbl.textContent = label;
            lbl.style.cssText = `font-size: 13px; color: ${THEME.text}; font-weight: 600; margin-bottom: 4px;`;
            const d = document.createElement("div");
            d.textContent = desc;
            d.style.cssText = `font-size: 11px; color: ${THEME.text2}; max-width: 400px; line-height: 1.45;`;
            left.appendChild(lbl);
            left.appendChild(d);
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = "1";
            inp.max = "500";
            inp.step = "1";
            inp.style.cssText = `
                width: 88px; padding: 8px 10px; background: ${THEME.bg3};
                border: 1px solid ${THEME.border}; color: ${THEME.text};
                border-radius: 6px; text-align: center; font-size: 14px; flex-shrink: 0;
            `;
            preventConflict(inp);
            inputRefHolder.inp = inp;
            row.appendChild(left);
            row.appendChild(inp);
            panel4.appendChild(row);
        };

        const acHolder = {};
        const histHolder = {};
        const cacheMaxHolder = {};
        mkNumRow(
            magicT("补全提示词显示条数"),
            magicT("编辑框内输入时，下拉补全最多展示的 tag 条数（1～500）。需返回「编辑」Tab 后对新开补全生效。"),
            acHolder,
        );
        mkNumRow(
            magicT("历史记录保留条数"),
            magicT("工作流成功结束后写入运行历史的上限；保存后立即按新值裁剪本地历史。"),
            histHolder,
        );

        /* —— 自定义数字行：缓存上限需支持到 2000 —— */
        {
            const row = document.createElement("div");
            row.style.cssText = `
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                flex-wrap: wrap; margin-bottom: 14px;
            `;
            const left = document.createElement("div");
            const lbl = document.createElement("div");
            lbl.textContent = magicT("LLM 翻译缓存条数");
            lbl.style.cssText = `font-size: 13px; color: ${THEME.text}; font-weight: 600; margin-bottom: 4px;`;
            const d = document.createElement("div");
            d.textContent = magicT("本地 LLM 翻译缓存最大条数（LRU，超出自动淘汰最旧的）。强制翻译模式下即使命中缓存也会全部重送 LLM（节省 token）。");
            d.style.cssText = `font-size: 11px; color: ${THEME.text2}; max-width: 400px; line-height: 1.45;`;
            left.appendChild(lbl);
            left.appendChild(d);
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = "10";
            inp.max = "2000";
            inp.step = "10";
            inp.style.cssText = `
                width: 88px; padding: 8px 10px; background: ${THEME.bg3};
                border: 1px solid ${THEME.border}; color: ${THEME.text};
                border-radius: 6px; text-align: center; font-size: 14px; flex-shrink: 0;
            `;
            preventConflict(inp);
            cacheMaxHolder.inp = inp;
            row.appendChild(left);
            row.appendChild(inp);
            panel4.appendChild(row);
        }

        acHolder.inp.value = String(
            stRef && stRef.prompt_autocomplete_limit != null
                ? magicClampAutocompleteLimit(stRef.prompt_autocomplete_limit)
                : AUTOCOMPLETE_LIMIT,
        );
        histHolder.inp.value = String(
            stRef && stRef.prompt_history_max != null
                ? Math.max(1, Math.min(500, Math.round(Number(stRef.prompt_history_max)) || 20))
                : 20,
        );
        cacheMaxHolder.inp.value = String(
            stRef && stRef.llm_cache_max != null
                ? Math.max(10, Math.min(2000, Math.round(Number(stRef.llm_cache_max)) || 150))
                : 150,
        );

        /* —— 5 · 标签和补全功能设置 —— */
        const panel5 = mkCollapsible(
            magicT("5 · 标签和补全功能设置"),
            magicT("选择补全数据来源：本地标签数据库使用预设库+用户标签组；远端 Danbooru 则实时从官方 API 获取（自带分类与热度）。"),
            false,
        );

        const p5modeRow = document.createElement("div");
        p5modeRow.style.cssText = `
            margin-bottom: 12px; padding: 10px 14px;
            background: rgba(156,39,176,0.08); border-radius: 8px;
            border: 1px solid rgba(156,39,176,0.25);
        `;
        const p5modeTitle = document.createElement("div");
        p5modeTitle.style.cssText = `font-size: 12px; color: ${THEME.text2}; margin-bottom: 10px; font-weight: 600;`;
        p5modeTitle.textContent = magicT("数据来源(🚨使用danbooru数据时，请当编辑界面下方显示连接成功再编辑tag，否则补全可能会显示bug。)");
        p5modeRow.appendChild(p5modeTitle);
        preventConflict(p5modeRow);

        const mkRadio5 = (value, labelHtml, hintHtml) => {
            const id = `magic-danbooru-mode-${value}`;
            const wrap = document.createElement("div");
            wrap.style.cssText = `
                display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; cursor: pointer;
            `;
            const rb = document.createElement("input");
            rb.type = "radio";
            rb.name = "magic-danbooru-mode";
            rb.value = value;
            rb.id = id;
            preventConflict(rb);
            const currentDanboo = magicNormalizeDanbooruMode(stRef && stRef.danbooru_mode);
            rb.checked = currentDanboo === value;
            rb.style.cssText = "margin-top: 3px; flex-shrink: 0;";
            const lbl = document.createElement("label");
            lbl.htmlFor = id;
            lbl.style.cssText = `font-size: 13px; color: ${THEME.text}; cursor: pointer; line-height: 1.5;`;
            lbl.innerHTML = `<b>${labelHtml}</b><br><span style="font-size:11px;color:${THEME.text2};">${hintHtml}</span>`;
            wrap.appendChild(rb);
            wrap.appendChild(lbl);
            return { wrap, rb };
        };

        const localRadio = mkRadio5(
            "local",
            magicT("📁 本地标签数据库"),
            magicT("使用预设库（tag预设库.txt）与用户标签组进行补全，中文释义来自本地词库。"),
        );
        const danbooRadio = mkRadio5(
            "danbooru",
            magicT("🌐 远端 Danbooru Tag 数据"),
            magicT("实时从 danbooru.donmai.us 获取 Tag，带分类（general/artist/copyright/character/meta）与热度排序；中文释义使用本地词库匹配。"),
        );
        p5modeRow.appendChild(localRadio.wrap);
        p5modeRow.appendChild(danbooRadio.wrap);

        const getDanbooruMode = () => {
            if (localRadio.rb.checked) return "local";
            if (danbooRadio.rb.checked) return "danbooru";
            return magicNormalizeDanbooruMode(stRef && stRef.danbooru_mode);
        };

        // Danbooru 连接状态提示
        const danbooStatusEl = document.createElement("div");
        danbooStatusEl.style.cssText = `
            font-size: 11px; color: ${THEME.text2}; padding: 6px 10px;
            background: ${THEME.bg3}; border-radius: 6px; margin-top: 6px;
            display: none;
        `;
        p5modeRow.appendChild(danbooStatusEl);

        // 切换到 danbooru：先落盘偏好并检测连接；失败则切回本地并保存（与下方 persist 监听器合并，避免重复 change）
        danbooRadio.rb.addEventListener("change", async () => {
            if (!danbooRadio.rb.checked) return;
            danbooStatusEl.style.display = "block";
            danbooStatusEl.style.color = THEME.text2;
            danbooStatusEl.textContent = magicT("正在检测连接…");
            persistEditorSettingsAuto();
            const result = await magicDanbooruCheckConnection();
            if (!danbooRadio.rb.checked) return;
            if (!result.ok) {
                danbooStatusEl.style.color = THEME.danger;
                danbooStatusEl.textContent =
                    magicT("❌ 连接失败：") +
                    (result.message || "?") +
                    " " +
                    magicT("（将自动切回本地模式）");
                setTimeout(() => {
                    localRadio.rb.checked = true;
                    persistEditorSettingsAuto();
                    danbooStatusEl.style.display = "none";
                }, 2200);
            } else {
                danbooStatusEl.style.color = THEME.success;
                danbooStatusEl.textContent = magicT("✅ 连接成功！已启用 Danbooru 远端补全。");
                setTimeout(() => {
                    danbooStatusEl.style.display = "none";
                }, 2000);
            }
        });

        panel5.appendChild(p5modeRow);

        const status = document.createElement("div");
        status.style.cssText = `font-size: 12px; color: ${THEME.text2}; margin: 16px 0 10px; min-height: 20px;`;
        content.appendChild(status);

        let statusClearTimer = null;
        let saveOkGen = 0;
        function showAutoSaveOk() {
            saveOkGen++;
            const g = saveOkGen;
            clearTimeout(statusClearTimer);
            status.textContent = magicT("✅ 已自动保存");
            status.style.color = THEME.success;
            statusClearTimer = setTimeout(() => {
                if (g === saveOkGen) status.textContent = "";
            }, 2000);
        }

        let settingsSaveSeq = 0;
        let numSaveDebounce = null;
        function persistEditorSettingsAuto() {
            const seq = ++settingsSaveSeq;
            const newTb = {};
            section1Defs.forEach((def) => {
                newTb[def.key] = !!section1Checks[def.key].checked;
            });
            const newFo = {
                cleanup_commas: !!fmtChecks.cleanup_commas.checked,
                cleanup_whitespace: !!fmtChecks.cleanup_whitespace.checked,
                remove_lora_tags: !!fmtChecks.remove_lora_tags.checked,
                cleanup_newlines: selNewlines.value || "false",
                fix_brackets: selBrackets.value || "both",
                underscore_to_space: !!fmtChecks.underscore_to_space.checked,
                complete_weight_syntax: !!fmtChecks.complete_weight_syntax.checked,
                smart_bracket_escaping: !!fmtChecks.smart_bracket_escaping.checked,
                standardize_commas: !!fmtChecks.standardize_commas.checked,
            };
            const mergedFo = magicMergeFormatOptions(newFo);
            const autoLim = magicClampAutocompleteLimit(acHolder.inp.value);
            let hm = parseInt(histHolder.inp.value, 10);
            if (!Number.isFinite(hm)) hm = 20;
            hm = Math.max(1, Math.min(500, hm));
            let cacheMax = parseInt(cacheMaxHolder.inp.value, 10);
            if (!Number.isFinite(cacheMax)) cacheMax = 150;
            cacheMax = Math.max(10, Math.min(2000, cacheMax));
            const translateMode = getTranslateMode();
            acHolder.inp.value = String(autoLim);
            histHolder.inp.value = String(hm);
            cacheMaxHolder.inp.value = String(cacheMax);

            const translateProf =
                selTranslateProfile && selTranslateProfile.value != null
                    ? String(selTranslateProfile.value)
                    : "";

            const body = {
                editor_toolbar: newTb,
                format_options: mergedFo,
                prompt_autocomplete_limit: autoLim,
                prompt_history_max: hm,
                translate_llm_profile: translateProf,
                translate_mode: translateMode,
                llm_cache_max: cacheMax,
                danbooru_mode: getDanbooruMode(),
            };

            return fetch("/ma/settings", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    if (seq !== settingsSaveSeq) return;
                    shell._magicEditorSettings.editor_toolbar = magicMergeEditorToolbar(newTb);
                    shell._magicEditorSettings.format_options = mergedFo;
                    shell._magicFormatOptions = { ...mergedFo };
                    shell._magicEditorSettings.prompt_autocomplete_limit = autoLim;
                    shell._magicEditorSettings.prompt_history_max = hm;
                    shell._magicEditorSettings.translate_llm_profile = translateProf;
                    shell._magicEditorSettings.translate_mode = translateMode;
                    shell._magicEditorSettings.llm_cache_max = cacheMax;
                    shell._magicEditorSettings.danbooru_mode = getDanbooruMode();
                    showAutoSaveOk();
                })
                .catch((e) => {
                    if (seq !== settingsSaveSeq) return;
                    status.textContent = magicT("自动保存失败：") + ((e && e.message) || e);
                    status.style.color = THEME.danger;
                });
        }

        function scheduleNumSettingsSave() {
            clearTimeout(numSaveDebounce);
            numSaveDebounce = setTimeout(() => {
                numSaveDebounce = null;
                persistEditorSettingsAuto();
            }, 450);
        }

        section1Defs.forEach((def) => {
            section1Checks[def.key].addEventListener("change", () => persistEditorSettingsAuto());
        });
        fmtCheckDefs.forEach((def) => {
            fmtChecks[def.key].addEventListener("change", () => persistEditorSettingsAuto());
        });
        selNewlines.addEventListener("change", () => persistEditorSettingsAuto());
        selBrackets.addEventListener("change", () => persistEditorSettingsAuto());
        selTranslateProfile.addEventListener("change", () => persistEditorSettingsAuto());
        normalRadio.rb.addEventListener("change", () => persistEditorSettingsAuto());
        forceRadio.rb.addEventListener("change", () => persistEditorSettingsAuto());
        localRadio.rb.addEventListener("change", () => persistEditorSettingsAuto());
        [acHolder.inp, histHolder.inp, cacheMaxHolder.inp].forEach((inp) => {
            inp.addEventListener("input", () => scheduleNumSettingsSave());
            inp.addEventListener("change", () => {
                clearTimeout(numSaveDebounce);
                numSaveDebounce = null;
                persistEditorSettingsAuto();
            });
        });

        btnManageLlm.addEventListener("click", () => {
            void openMagicLlmServiceModal({
                onLlmSaved: () => {
                    void refillTranslateProfileOptions().then(() => persistEditorSettingsAuto());
                },
            });
        });
    }

    // 初始渲染 + 默认激活编辑 tab
    renderContent();
    tabBar.querySelectorAll("button").forEach(b => {
        b.style.color = b.dataset.tab === "edit" ? "#fff" : THEME.text2;
        b.style.borderBottomColor = b.dataset.tab === "edit" ? THEME.accent : "transparent";
        b.style.background = b.dataset.tab === "edit" ? THEME.bg3 : "none";
    });

    document.body.appendChild(shell);
    if (typeof window.translateElementImmediately === "function") {
        try { window.translateElementImmediately(shell); } catch (_) { /* ignore */ }
    }
}
