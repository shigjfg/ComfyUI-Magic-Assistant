import { api } from "../../scripts/api.js";
import "./magic_ui_shared.js";
import {
    getStudioLang,
    studioT,
    formatParamLabel,
    createComposeState,
    initComposeBaseLayer,
    importFilesToCompose,
    renderComposeToDataUrl,
    renderComposeSidebar,
    mountComposeStage,
} from "./magic_local_compose.js";

const STUDIO_WIN_ID = "magic-local-studio-window";

export function ensureLocalStudioCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector("link[data-magic-local-studio-css]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./magic_local_studio.css", import.meta.url).href;
    link.setAttribute("data-magic-local-studio-css", "1");
    document.head.appendChild(link);
}

ensureLocalStudioCss();

// ============================================================
// Geometry & Resolution Math Helpers
// ============================================================

function gcd(a, b) {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) [x, y] = [y, x % y];
    return x || 1;
}

function lcm(a, b) {
    return (a * b) / gcd(a, b);
}

function reduceRatio(w, h) {
    const d = gcd(w, h);
    return { x: Math.max(1, Math.round(w / d)), y: Math.max(1, Math.round(h / d)) };
}

function formatRatioLabel(w, h) {
    if (!w || !h) return "-";
    const r = reduceRatio(w, h);
    if (r.x <= 32 && r.y <= 32) return `${r.x}:${r.y}`;
    const v = w / h;
    return v >= 1
        ? `~${(Math.round(v * 100) / 100).toFixed(2)}:1`
        : `~1:${(Math.round((1 / v) * 100) / 100).toFixed(2)}`;
}

function formatMP(w, h) {
    return ((w * h) / 1_000_000).toFixed(2);
}

function clampDim(v, min = 64, max = 8192) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function snapDim(v, step = 32) {
    const s = Math.max(1, Math.round(Number(step) || 1));
    return clampDim(Math.max(s, Math.round(Number(v) / s) * s));
}

function ratioStride(ratio, step) {
    const s = Math.max(1, Math.round(step));
    return lcm(s / gcd(s, ratio.x), s / gcd(s, ratio.y));
}

function ratioSizeForAxis(ratio, axis, target, step = 32) {
    const r = axis === "height" ? ratio.y : ratio.x;
    const kStep = ratioStride(ratio, step);
    const minK = Math.ceil(Math.max(64 / ratio.x, 64 / ratio.y) / kStep) * kStep;
    const maxK = Math.floor(Math.min(8192 / ratio.x, 8192 / ratio.y) / kStep) * kStep;
    if (minK > maxK) {
        const factor = Math.min(
            8192 / Math.max(ratio.x, ratio.y),
            Math.max(64 / Math.min(ratio.x, ratio.y), target / r)
        );
        return { width: snapDim(ratio.x * factor, step), height: snapDim(ratio.y * factor, step) };
    }
    const k = Math.max(minK, Math.min(maxK, Math.round(target / r / kStep) * kStep));
    return { width: ratio.x * k, height: ratio.y * k };
}

function applyRatioAtBudget(curW, curH, ratio, step = 32, portrait = curH > curW) {
    const flipped = portrait !== ratio.y > ratio.x && ratio.x !== ratio.y;
    const shaped = flipped ? { x: ratio.y, y: ratio.x } : { x: ratio.x, y: ratio.y };
    const area = Math.max(64 * 64, curW * curH);
    const idealW = Math.sqrt(area * (shaped.x / shaped.y));
    const kStep = ratioStride(shaped, step);
    const candidates = [
        ratioSizeForAxis(shaped, "width", idealW, step),
        ratioSizeForAxis(shaped, "width", idealW + kStep * shaped.x, step),
        ratioSizeForAxis(shaped, "width", Math.max(64, idealW - kStep * shaped.x), step),
    ];
    let best = candidates[0];
    let bestErr = Infinity;
    for (const c of candidates) {
        const err = Math.abs(c.width * c.height - area);
        if (err < bestErr) {
            bestErr = err;
            best = c;
        }
    }
    return best;
}

function buildRecommendedSizes(width, height, step = 32) {
    const ratio = reduceRatio(width, height);
    const budgets = [0.3, 0.6, 1.0, 1.5, 2.0, 2.8, 3.6, 4.5];
    const seen = new Set();
    const out = [];
    for (const mp of budgets) {
        const area = mp * 1_000_000;
        const idealW = Math.sqrt(area * (width / Math.max(1, height)));
        let sz;
        if (ratio.x <= 24 && ratio.y <= 24) {
            sz = ratioSizeForAxis(ratio, "width", idealW, step);
        } else {
            const w = snapDim(idealW, step);
            const h = snapDim(w * (height / Math.max(1, width)), step);
            sz = { width: w, height: h };
        }
        const key = `${sz.width}x${sz.height}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(sz);
        }
    }
    return out.slice(0, 8);
}

function rotatedBounds(srcW, srcH, deg) {
    const rad = (Math.abs(deg) * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    return {
        rotW: Math.max(1, Math.ceil(srcW * c + srcH * s)),
        rotH: Math.max(1, Math.ceil(srcW * s + srcH * c)),
    };
}

function alignAxisJS(size, padA, padB, multiple) {
    const m = Math.max(1, Math.round(multiple || 1));
    const total = padA + size + padB;
    const rem = total % m;
    if (m <= 1 || rem === 0) return { padA, padB, trimA: 0, out: total };
    if (padA > 0 || padB > 0) {
        const extra = m - rem;
        if (padA > 0 && padB > 0) {
            const addA = Math.floor(extra / 2);
            return { padA: padA + addA, padB: padB + (extra - addA), trimA: 0, out: total + extra };
        }
        if (padA > 0) return { padA: padA + extra, padB, trimA: 0, out: total + extra };
        return { padA, padB: padB + extra, trimA: 0, out: total + extra };
    }
    if (size > m) {
        return { padA: 0, padB: 0, trimA: Math.floor(rem / 2), out: size - rem };
    }
    return { padA: 0, padB: 0, trimA: 0, out: size };
}

function computeMPTarget(w, h, mp, step) {
    const s = Math.max(1, Math.round(step || 1));
    const scale = Math.sqrt((Math.max(0.05, mp) * 1_000_000) / Math.max(1, w * h));
    return {
        width: Math.max(s, Math.round((w * scale) / s) * s),
        height: Math.max(s, Math.round((h * scale) / s) * s),
    };
}

function parseRatioString(str, srcW, srcH) {
    if (!str || str === "free") return null;
    if (str === "source") return srcW && srcH ? srcW / srcH : null;
    const parts = String(str).split(":");
    if (parts.length !== 2) return null;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!a || !b) return null;
    return a / b;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
}

async function dataUrlToPngFile(dataUrl, prefix = "LocalStudio") {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return new File([blob], `${prefix}_${Date.now()}.png`, { type: "image/png" });
}

function getNodeSourceFilename(node) {
    let filename = "";
    const widget = node.widgets?.find((w) => w.name === "image");
    if (widget && widget.value) filename = widget.value;
    if ((!filename || filename === "canvas_empty.png") && node.imgs && node.imgs.length > 0) {
        const src = node.imgs[0].src || "";
        const match = src.match(/filename=([^&]+)/);
        if (match) filename = decodeURIComponent(match[1]);
    }
    return filename;
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ============================================================
// Main Entry: Magic Local Image Studio Modal
// ============================================================

export function showLocalStudioModal(node, onApplyFilename) {
    const t = studioT;
    let win = document.getElementById(STUDIO_WIN_ID);
    if (win) {
        win._maCleanup?.();
        win.remove();
    }

    const origFilename = getNodeSourceFilename(node);
    if (!origFilename || origFilename === "canvas_empty.png") {
        alert(t("请先在节点中选择或上传一张图片，再打开本地处理工作室！"));
        return;
    }

    const origUrl = api.apiURL(`/view?filename=${encodeURIComponent(origFilename)}&type=input&t=${Date.now()}`);

    const state = {
        mainTab: "basic", // "basic" | "compose" | "controlnet"
        basicSubTab: "crop_rotate_pad", // "crop_rotate_pad" | "resolution" | "rmbg" | "adjust"
        stageView: "editor", // "editor" | "result" | "source" | "swipe" | "compare"
        origFilename,
        origUrl,
        activeInputDataUrl: null,
        activeInputUrl: origUrl,
        activeImg: null,
        srcW: 512,
        srcH: 512,
        previewDataUrl: null,
        previewW: 0,
        previewH: 0,
        previewTag: "",
        previewElapsedMs: null,
        compareSplit: 0.5,
        compareHoverSlide: true,
        isRunning: false,
        errorMsg: "",
        crp: {
            rotation: 0,
            cropX: 0,
            cropY: 0,
            cropW: 512,
            cropH: 512,
            padL: 0,
            padT: 0,
            padR: 0,
            padB: 0,
            aspectPreset: "free",
            portrait: true,
            fitMode: "pad",
            lockRatio: false,
            canvasMultiple: 1,
            fillMode: "solid",
            fillColor: "#808080",
            feather: 0,
            resizeEnabled: false,
            megapixels: 1.0,
            resolutionSteps: 32,
            resizeMethod: "lanczos",
        },
        res: {
            width: 1024,
            height: 1024,
            step: 32,
            portrait: true,
            fitMode: "pad",
            fillMode: "solid",
            fillColor: "#808080",
            resizeMethod: "lanczos",
        },
        adj: {
            preset: "none",
            brightness: 1.0,
            contrast: 1.0,
            saturation: 1.0,
            hue: 0,
            temperature: 0,
            sharpness: 1.0,
            blur: 0,
            flipH: false,
            flipV: false,
            grayscale: false,
            invert: false,
        },
        compose: createComposeState(),
        rmbg: {
            loaded: false,
            loading: false,
            installed: false,
            displayName: "Remove Background (RMBG)",
            schema: [],
            values: {},
            outputType: "image",
            lastOutputs: null,
        },
        cn: {
            loaded: false,
            loading: false,
            auxInstalled: false,
            items: [],
            group: "all",
            search: "",
            selectedId: null,
            paramValues: {},
        },
    };

    const hasInteractiveEditor = () =>
        state.mainTab === "compose" ||
        (state.mainTab === "basic" &&
            (state.basicSubTab === "crop_rotate_pad" ||
                state.basicSubTab === "resolution" ||
                state.basicSubTab === "adjust"));

    // --- Jitter-free Window Shell ---
    const getViewportBounds = () => {
        const vw = Math.max(460, Math.floor(window.innerWidth));
        const vh = Math.max(380, Math.floor(window.innerHeight));
        const minW = Math.min(860, Math.max(460, vw - 16));
        const minH = Math.min(580, Math.max(380, vh - 16));
        return { vw, vh, minW, minH };
    };

    const { vw, vh, minW, minH } = getViewportBounds();
    const initW = Math.max(minW, Math.min(Math.floor(vw * 0.9), 1440, vw - 16));
    const initH = Math.max(minH, Math.min(Math.floor(vh * 0.88), 940, vh - 16));
    const initL = Math.max(0, Math.floor((vw - initW) / 2));
    const initT = Math.max(0, Math.floor((vh - initH) / 2));

    win = document.createElement("div");
    win.id = STUDIO_WIN_ID;
    win.setAttribute("data-magic-i18n", "manual");
    win.className = "mls-window ma-modal-static-anim";
    win.style.cssText = `top: ${initT}px; left: ${initL}px; width: ${initW}px; height: ${initH}px; min-width: ${minW}px; min-height: ${minH}px; max-width: 100vw; max-height: 100vh;`;

    let prevRect = null;
    const clampWindow = () => {
        if (win.dataset.isMaximized === "true") return;
        const b = getViewportBounds();
        win.style.minWidth = `${b.minW}px`;
        win.style.minHeight = `${b.minH}px`;
        const rect = win.getBoundingClientRect();
        const width = Math.max(b.minW, Math.min(Math.round(rect.width), b.vw));
        const height = Math.max(b.minH, Math.min(Math.round(rect.height), b.vh));
        const left = Math.round(Math.min(Math.max(0, b.vw - width), Math.max(0, rect.left)));
        const top = Math.round(Math.min(Math.max(0, b.vh - height), Math.max(0, rect.top)));
        win.style.width = `${width}px`;
        win.style.height = `${height}px`;
        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
    };

    const closeModal = () => {
        win._maCleanup?.();
        win.remove();
    };

    // --- Header ---
    const header = document.createElement("div");
    header.className = "mls-header";

    const brand = document.createElement("div");
    brand.className = "mls-brand";

    const mainTabs = document.createElement("div");
    mainTabs.className = "mls-main-tabs";

    const tabBasicBtn = document.createElement("button");
    tabBasicBtn.className = "mls-main-tab active";

    const tabComposeBtn = document.createElement("button");
    tabComposeBtn.className = "mls-main-tab";

    const tabCnBtn = document.createElement("button");
    tabCnBtn.className = "mls-main-tab";

    mainTabs.appendChild(tabBasicBtn);
    mainTabs.appendChild(tabComposeBtn);
    mainTabs.appendChild(tabCnBtn);

    const winActions = document.createElement("div");
    winActions.className = "mls-win-actions";

    const maxBtn = document.createElement("button");
    maxBtn.className = "ma-modal-close";
    maxBtn.textContent = "⬜";
    maxBtn.onclick = () => {
        if (win.dataset.isMaximized !== "true") {
            const r = win.getBoundingClientRect();
            prevRect = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
            win.dataset.isMaximized = "true";
            win.style.top = "0px";
            win.style.left = "0px";
            win.style.width = "100vw";
            win.style.height = "100vh";
            win.style.resize = "none";
            win.style.borderRadius = "0";
            win.style.border = "none";
            maxBtn.textContent = "❐";
        } else {
            win.dataset.isMaximized = "false";
            win.style.resize = "both";
            win.style.borderRadius = "";
            win.style.border = "";
            if (prevRect) {
                win.style.left = `${prevRect.left}px`;
                win.style.top = `${prevRect.top}px`;
                win.style.width = `${prevRect.width}px`;
                win.style.height = `${prevRect.height}px`;
            }
            clampWindow();
            maxBtn.textContent = "⬜";
        }
        requestAnimationFrame(() => redrawStageCanvas?.());
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "ma-modal-close";
    closeBtn.textContent = "✕";
    closeBtn.onclick = closeModal;

    winActions.appendChild(maxBtn);
    winActions.appendChild(closeBtn);
    header.appendChild(brand);
    header.appendChild(mainTabs);
    header.appendChild(winActions);

    // --- Split Body ---
    const body = document.createElement("div");
    body.className = "mls-body";

    const leftCol = document.createElement("div");
    leftCol.className = "mls-left";

    const subTabsBar = document.createElement("div");
    subTabsBar.className = "mls-subtabs";

    const leftScroll = document.createElement("div");
    leftScroll.className = "mls-left-scroll";

    const leftFooter = document.createElement("div");
    leftFooter.className = "mls-left-footer";

    leftCol.appendChild(subTabsBar);
    leftCol.appendChild(leftScroll);
    leftCol.appendChild(leftFooter);

    const rightCol = document.createElement("div");
    rightCol.className = "mls-right";

    const stageBar = document.createElement("div");
    stageBar.className = "mls-stage-bar";

    const stageViewport = document.createElement("div");
    stageViewport.className = "mls-stage-viewport";

    rightCol.appendChild(stageBar);
    rightCol.appendChild(stageViewport);

    body.appendChild(leftCol);
    body.appendChild(rightCol);

    // --- Footer ---
    const footer = document.createElement("div");
    footer.className = "mls-footer";

    const footerStatus = document.createElement("div");
    footerStatus.className = "mls-footer-status";

    const footerActions = document.createElement("div");
    footerActions.className = "mls-footer-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ma-btn ma-btn-ghost";
    cancelBtn.onclick = closeModal;

    const applyBtn = document.createElement("button");
    applyBtn.className = "ma-btn ma-btn-primary";
    applyBtn.style.padding = "8px 22px";
    applyBtn.disabled = true;

    const syncStaticChromeText = () => {
        brand.innerHTML = `<span class="mls-brand-icon">✨</span><span>${escapeHtml(t("Magic 本地图像处理"))}</span><span class="mls-brand-badge">${escapeHtml(t("工作室"))}</span>`;
        tabBasicBtn.textContent = t("✂️ 基础处理");
        tabComposeBtn.textContent = t("🧩 图像组合");
        tabCnBtn.textContent = t("🎯 ControlNet 预处理");
        maxBtn.title = t("最大化 / 还原");
        closeBtn.title = t("关闭");
        cancelBtn.textContent = t("取消");
        if (!applyBtn.dataset.applying) {
            applyBtn.textContent = t("💾 传回图片 (Apply)");
        }
    };
    syncStaticChromeText();

    footerActions.appendChild(cancelBtn);
    footerActions.appendChild(applyBtn);
    footer.appendChild(footerStatus);
    footer.appendChild(footerActions);

    win.appendChild(header);
    win.appendChild(body);
    win.appendChild(footer);
    document.body.appendChild(win);

    // --- Dragging & Resize ---
    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragW = 0, dragH = 0;

    header.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        if (win.dataset.isMaximized === "true") return;
        const r = win.getBoundingClientRect();
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = r.left;
        startTop = r.top;
        dragW = Math.round(r.width);
        dragH = Math.round(r.height);
        win.style.width = `${dragW}px`;
        win.style.height = `${dragH}px`;
        win.style.left = `${Math.round(startLeft)}px`;
        win.style.top = `${Math.round(startTop)}px`;
        e.preventDefault();
        header.setPointerCapture(e.pointerId);
    });
    header.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        const maxL = Math.max(0, window.innerWidth - dragW);
        const maxT = Math.max(0, window.innerHeight - dragH);
        win.style.left = `${Math.round(Math.min(maxL, Math.max(0, startLeft + e.clientX - startX)))}px`;
        win.style.top = `${Math.round(Math.min(maxT, Math.max(0, startTop + e.clientY - startY)))}px`;
    });
    const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (e?.pointerId != null && header.hasPointerCapture(e.pointerId)) {
            header.releasePointerCapture(e.pointerId);
        }
    };
    header.addEventListener("pointerup", stopDrag);
    header.addEventListener("pointercancel", stopDrag);
    header.addEventListener("lostpointercapture", stopDrag);

    let redrawStageCanvas = null;
    let syncLeftNumericInputs = null;

    const onWindowResize = () => {
        if (!isDragging) clampWindow();
        redrawStageCanvas?.();
    };
    window.addEventListener("resize", onWindowResize);

    const resizeObserver = new ResizeObserver(() => {
        redrawStageCanvas?.();
    });
    resizeObserver.observe(stageViewport);

    // --- Drag & Drop external images directly into the studio window (for Image Compose) ---
    let dragDepth = 0;
    let dropOverlayEl = null;
    const showDropOverlay = () => {
        if (dropOverlayEl) return;
        dropOverlayEl = document.createElement("div");
        dropOverlayEl.className = "mls-drop-overlay";
        dropOverlayEl.innerHTML = `<div>${escapeHtml(t("📥 松手即可插入为新图层"))}</div><span>${escapeHtml(t("支持 PNG / JPG / WebP，可一次拖入多张外部图像"))}</span>`;
        win.appendChild(dropOverlayEl);
    };
    const hideDropOverlay = () => {
        dragDepth = 0;
        if (dropOverlayEl) {
            dropOverlayEl.remove();
            dropOverlayEl = null;
        }
    };

    const hasDraggedFiles = (e) => {
        const types = e.dataTransfer?.types;
        if (!types) return false;
        return Array.from(types).includes("Files");
    };

    win.addEventListener("dragenter", (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        showDropOverlay();
    });
    win.addEventListener("dragover", (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    win.addEventListener("dragleave", (e) => {
        if (!dropOverlayEl) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideDropOverlay();
    });
    win.addEventListener("drop", async (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        hideDropOverlay();
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        if (!state.compose.initialized && state.activeImg) {
            initComposeBaseLayer(state.compose, state.activeImg, state.activeInputUrl);
        }
        try {
            const added = await importFilesToCompose(state.compose, files);
            if (added > 0) {
                state.mainTab = "compose";
                state.stageView = "editor";
                state.errorMsg = "";
                renderAll();
            }
        } catch (err) {
            state.errorMsg = t("拖入图像失败: ") + (err?.message || err);
            renderAll();
        }
    });

    // Ctrl+V paste image into Image Compose
    const onWindowPaste = async (e) => {
        if (state.mainTab !== "compose") return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const imageFiles = [];
        for (const item of items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
                const f = item.getAsFile();
                if (f) imageFiles.push(f);
            }
        }
        if (imageFiles.length === 0) return;
        e.preventDefault();
        try {
            const added = await importFilesToCompose(state.compose, imageFiles);
            if (added > 0) {
                state.stageView = "editor";
                renderAll();
            }
        } catch (err) {
            state.errorMsg = t("粘贴图像失败: ") + (err?.message || err);
            renderAll();
        }
    };
    window.addEventListener("paste", onWindowPaste);

    // Keyboard nudge & delete in Image Compose
    const onWindowKeydown = (e) => {
        if (state.mainTab !== "compose" || state.stageView !== "editor") return;
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const comp = state.compose;
        const idx = comp.layers.findIndex((l) => l.id === comp.selectedId);
        if (idx === -1) return;
        const layer = comp.layers[idx];
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") {
            layer.x -= step;
            e.preventDefault();
            redrawStageCanvas?.();
        } else if (e.key === "ArrowRight") {
            layer.x += step;
            e.preventDefault();
            redrawStageCanvas?.();
        } else if (e.key === "ArrowUp") {
            layer.y -= step;
            e.preventDefault();
            redrawStageCanvas?.();
        } else if (e.key === "ArrowDown") {
            layer.y += step;
            e.preventDefault();
            redrawStageCanvas?.();
        } else if ((e.key === "Delete" || e.key === "Backspace") && comp.layers.length > 1) {
            e.preventDefault();
            comp.layers.splice(idx, 1);
            comp.selectedId = comp.layers[Math.min(idx, comp.layers.length - 1)]?.id || null;
            renderAll();
        }
    };
    window.addEventListener("keydown", onWindowKeydown);

    const onLanguageChange = () => {
        syncStaticChromeText();
        renderAll();
    };
    window.addEventListener("magic-language-change", onLanguageChange);

    win._maCleanup = () => {
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("paste", onWindowPaste);
        window.removeEventListener("keydown", onWindowKeydown);
        window.removeEventListener("magic-language-change", onLanguageChange);
        resizeObserver.disconnect();
    };

    // ============================================================
    // Reset & Geometry Helpers
    // ============================================================
    function resetCropRotatePadToSource() {
        Object.assign(state.crp, {
            rotation: 0,
            cropX: 0,
            cropY: 0,
            cropW: state.srcW,
            cropH: state.srcH,
            padL: 0,
            padT: 0,
            padR: 0,
            padB: 0,
            aspectPreset: "free",
            portrait: state.srcH >= state.srcW,
            lockRatio: false,
        });
    }

    function resetResolutionToSource() {
        state.res.width = clampDim(state.srcW);
        state.res.height = clampDim(state.srcH);
        state.res.portrait = state.srcH >= state.srcW;
    }

    function resetColorAdjust() {
        Object.assign(state.adj, {
            preset: "none",
            brightness: 1.0,
            contrast: 1.0,
            saturation: 1.0,
            hue: 0,
            temperature: 0,
            sharpness: 1.0,
            blur: 0,
            flipH: false,
            flipV: false,
            grayscale: false,
            invert: false,
        });
    }

    function computeCropOutputDims() {
        const c = state.crp;
        const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);
        const cx = Math.max(0, Math.min(rotW - 1, Math.round(c.cropX)));
        const cy = Math.max(0, Math.min(rotH - 1, Math.round(c.cropY)));
        const cw = Math.max(1, Math.min(rotW - cx, Math.round(c.cropW || rotW)));
        const ch = Math.max(1, Math.min(rotH - cy, Math.round(c.cropH || rotH)));
        const ax = alignAxisJS(cw, Math.round(c.padL), Math.round(c.padR), c.canvasMultiple);
        const ay = alignAxisJS(ch, Math.round(c.padT), Math.round(c.padB), c.canvasMultiple);
        let outW = ax.out;
        let outH = ay.out;
        if (c.resizeEnabled) {
            const t = computeMPTarget(outW, outH, c.megapixels, c.resolutionSteps);
            outW = t.width;
            outH = t.height;
        }
        return { rotW, rotH, cx, cy, cw, ch, outW, outH };
    }

    function ensureEditorStageView() {
        if (hasInteractiveEditor() && state.stageView !== "editor") {
            state.stageView = "editor";
            renderRightStage();
        } else {
            redrawStageCanvas?.();
        }
    }

    // ============================================================
    // Backend API Runners
    // ============================================================
    async function runBasicPreview() {
        state.isRunning = true;
        state.errorMsg = "";
        renderRightStage();
        renderLeftFooter();

        try {
            let payload;
            if (state.basicSubTab === "resolution") {
                const r = state.res;
                payload = {
                    filename: state.origFilename,
                    image_data_url: state.activeInputDataUrl,
                    submode: "resolution",
                    target_width: r.width,
                    target_height: r.height,
                    fit_mode: r.fitMode,
                    fill_mode: r.fillMode,
                    fill_color: r.fillColor,
                    resize_method: r.resizeMethod,
                };
            } else if (state.basicSubTab === "adjust") {
                const a = state.adj;
                payload = {
                    filename: state.origFilename,
                    image_data_url: state.activeInputDataUrl,
                    submode: "adjust",
                    brightness: a.brightness,
                    contrast: a.contrast,
                    saturation: a.saturation,
                    hue: a.hue,
                    temperature: a.temperature,
                    sharpness: a.sharpness,
                    blur: a.blur,
                    flip_h: a.flipH,
                    flip_v: a.flipV,
                    grayscale: a.grayscale,
                    invert: a.invert,
                };
            } else {
                const c = state.crp;
                payload = {
                    filename: state.origFilename,
                    image_data_url: state.activeInputDataUrl,
                    submode: "crop_rotate_pad",
                    rotation_degrees: c.rotation,
                    crop_x: Math.round(c.cropX),
                    crop_y: Math.round(c.cropY),
                    crop_width: Math.round(c.cropW),
                    crop_height: Math.round(c.cropH),
                    pad_left: Math.round(c.padL),
                    pad_top: Math.round(c.padT),
                    pad_right: Math.round(c.padR),
                    pad_bottom: Math.round(c.padB),
                    canvas_multiple: c.canvasMultiple,
                    fill_mode: c.fillMode,
                    fill_color: c.fillColor,
                    feather: c.feather,
                    resize_enabled: c.resizeEnabled,
                    megapixels: c.megapixels,
                    resolution_steps: c.resolutionSteps,
                    resize_method: c.resizeMethod,
                };
            }

            const resp = await api.fetchApi("/ma/local_studio/basic", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            if (data.status !== "success") throw new Error(data.message || t("处理失败"));

            state.previewDataUrl = data.image;
            state.previewW = data.width;
            state.previewH = data.height;
            state.previewElapsedMs = data.elapsed_ms;
            state.previewTag =
                state.basicSubTab === "resolution"
                    ? t("画布分辨率")
                    : state.basicSubTab === "adjust"
                    ? t("调色与滤镜")
                    : t("裁剪/旋转/扩图");
            state.stageView = "result";
        } catch (err) {
            state.errorMsg = err?.message || String(err);
        } finally {
            state.isRunning = false;
            renderRightStage();
            renderLeftContent();
            renderLeftFooter();
        }
    }

    async function ensureRmbgInfo() {
        if (state.rmbg.loaded || state.rmbg.loading) return;
        state.rmbg.loading = true;
        renderLeftContent();
        try {
            const resp = await api.fetchApi("/ma/local_studio/rmbg_info");
            const data = await resp.json();
            state.rmbg.loaded = true;
            state.rmbg.installed = Boolean(data.installed);
            state.rmbg.displayName = data.display_name || t("去除背景 (RMBG)");
            state.rmbg.schema = data.params || [];
            for (const f of state.rmbg.schema) {
                if (!(f.name in state.rmbg.values)) state.rmbg.values[f.name] = f.default;
            }
        } catch (e) {
            state.rmbg.loaded = true;
            state.rmbg.installed = false;
            state.errorMsg = t("无法获取 RMBG 节点信息: ") + e;
        } finally {
            state.rmbg.loading = false;
            renderLeftContent();
            renderLeftFooter();
        }
    }

    async function runRmbgPreview() {
        if (!state.rmbg.installed) return;
        state.isRunning = true;
        state.errorMsg = "";
        renderRightStage();
        renderLeftFooter();

        try {
            const resp = await api.fetchApi("/ma/local_studio/rmbg_run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: state.origFilename,
                    image_data_url: state.activeInputDataUrl,
                    params: state.rmbg.values,
                    output_type: state.rmbg.outputType,
                }),
            });
            const data = await resp.json();
            if (data.status !== "success") throw new Error(data.message || t("RMBG 执行失败"));
            state.rmbg.lastOutputs = data.outputs || null;
            state.previewDataUrl = data.image;
            state.previewW = data.width;
            state.previewH = data.height;
            state.previewElapsedMs = data.elapsed_ms;
            const outLabel =
                state.rmbg.outputType === "mask"
                    ? t("遮罩")
                    : state.rmbg.outputType === "mask_image"
                    ? t("遮罩图像")
                    : t("去背图像");
            state.previewTag = `RMBG · ${outLabel}`;
            state.stageView = "result";
        } catch (err) {
            state.errorMsg = err?.message || String(err);
        } finally {
            state.isRunning = false;
            renderRightStage();
            renderLeftContent();
            renderLeftFooter();
        }
    }

    async function ensureControlNetList() {
        if (state.cn.loaded || state.cn.loading) return;
        state.cn.loading = true;
        renderLeftContent();
        try {
            const resp = await api.fetchApi("/ma/local_studio/controlnet_list");
            const data = await resp.json();
            state.cn.loaded = true;
            state.cn.auxInstalled = Boolean(data.aux_installed);
            state.cn.items = data.items || [];
            if (state.cn.items.length > 0 && !state.cn.selectedId) {
                state.cn.selectedId = state.cn.items[0].id;
            }
            for (const item of state.cn.items) {
                if (!state.cn.paramValues[item.id]) {
                    const defaults = {};
                    for (const f of item.params || []) defaults[f.name] = f.default;
                    state.cn.paramValues[item.id] = defaults;
                }
            }
        } catch (e) {
            state.cn.loaded = true;
            state.cn.auxInstalled = false;
            state.errorMsg = t("无法获取 ControlNet 预处理器列表: ") + e;
        } finally {
            state.cn.loading = false;
            renderLeftContent();
            renderLeftFooter();
        }
    }

    async function runControlNetPreview() {
        const item = state.cn.items.find((x) => x.id === state.cn.selectedId);
        if (!item) return;
        state.isRunning = true;
        state.errorMsg = "";
        renderRightStage();
        renderLeftFooter();

        try {
            const resp = await api.fetchApi("/ma/local_studio/controlnet_run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: state.origFilename,
                    image_data_url: state.activeInputDataUrl,
                    preprocessor: item.id,
                    params: state.cn.paramValues[item.id] || {},
                }),
            });
            const data = await resp.json();
            if (data.status !== "success") throw new Error(data.message || t("ControlNet 预处理失败"));
            state.previewDataUrl = data.image;
            state.previewW = data.width;
            state.previewH = data.height;
            state.previewElapsedMs = data.elapsed_ms;
            state.previewTag = getStudioLang() === "en" ? item.display_name || item.id : item.zh_name || item.display_name;
            state.stageView = "result";
        } catch (err) {
            state.errorMsg = err?.message || String(err);
        } finally {
            state.isRunning = false;
            renderRightStage();
            renderLeftContent();
            renderLeftFooter();
        }
    }

    function runComposePreview() {
        state.errorMsg = "";
        const t0 = performance.now();
        try {
            const out = renderComposeToDataUrl(state.compose);
            state.previewDataUrl = out.image;
            state.previewW = out.width;
            state.previewH = out.height;
            state.previewElapsedMs = Math.max(1, Math.round(performance.now() - t0));
            state.previewTag = `${t("图像组合")} (${state.compose.layers.filter((l) => l.visible).length} ${t("层")})`;
            state.stageView = "result";
        } catch (err) {
            state.errorMsg = t("合成预览失败: ") + (err?.message || err);
        }
        renderRightStage();
        renderLeftContent();
        renderLeftFooter();
    }

    applyBtn.onclick = async () => {
        if (!state.previewDataUrl || state.isRunning) return;
        applyBtn.disabled = true;
        applyBtn.dataset.applying = "1";
        applyBtn.textContent = t("⏳ 正在传回...");
        try {
            const tag =
                state.mainTab === "controlnet"
                    ? "ControlNet"
                    : state.mainTab === "compose"
                    ? "Compose"
                    : state.basicSubTab === "rmbg"
                    ? "RMBG"
                    : state.basicSubTab === "adjust"
                    ? "ColorAdjust"
                    : "LocalEdit";
            const file = await dataUrlToPngFile(state.previewDataUrl, tag);
            const form = new FormData();
            form.append("image", file);
            form.append("subfolder", "");
            form.append("type", "input");

            const resp = await api.fetchApi("/upload/image", { method: "POST", body: form });
            const result = await resp.json();
            if (!result || !result.name) throw new Error(t("处理失败"));
            onApplyFilename?.(result.name);
            closeModal();
        } catch (err) {
            applyBtn.disabled = false;
            delete applyBtn.dataset.applying;
            applyBtn.textContent = t("💾 传回图片 (Apply)");
            state.errorMsg = t("传回图片失败: ") + (err?.message || err);
            renderRightStage();
            renderLeftContent();
        }
    };

    // ============================================================
    // Interactive Right Stage #1: Crop / Rotate / Pad (Magic Original Visuals)
    // ============================================================
    function mountCropRotatePadStage() {
        const c = state.crp;
        const wrap = document.createElement("div");
        wrap.className = "mls-interactive-canvas-wrap";

        const canvas = document.createElement("canvas");
        canvas.className = "mls-interactive-canvas";
        wrap.appendChild(canvas);

        const hud = document.createElement("div");
        hud.className = "mls-stage-hud";
        wrap.appendChild(hud);
        stageViewport.appendChild(wrap);

        let hoverHandle = null;
        let activeHandle = null;
        let dragStart = null;

        const updateHud = () => {
            const d = computeCropOutputDims();
            const rotStr = Math.abs(c.rotation) >= 0.05 ? ` · ${t("旋转")} ${c.rotation.toFixed(1)}°` : "";
            hud.innerHTML = `
                <span>${state.srcW}×${state.srcH} → <b>${d.outW}×${d.outH}</b> <span style="color:#a1a1aa;">(${formatMP(d.outW, d.outH)} MP · ${formatRatioLabel(d.outW, d.outH)}${rotStr})</span></span>
                <span class="mls-hud-legend">
                    <span><i class="mls-dot" style="background:#f4f4f5;"></i>${escapeHtml(t("裁剪"))}</span>
                    <span><i class="mls-dot" style="background:#c084fc;"></i>${escapeHtml(t("扩图"))}</span>
                    <span><i class="mls-dot" style="background:#818cf8;"></i>${escapeHtml(t("旋转"))}</span>
                </span>
            `;
        };

        const getLayout = () => {
            const rect = wrap.getBoundingClientRect();
            const cw = Math.max(260, Math.floor(rect.width));
            const ch = Math.max(220, Math.floor(rect.height));
            const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);

            const cropX = Math.max(0, Math.min(rotW - 1, c.cropX));
            const cropY = Math.max(0, Math.min(rotH - 1, c.cropY));
            const cropW = Math.max(1, Math.min(rotW - cropX, c.cropW || rotW));
            const cropH = Math.max(1, Math.min(rotH - cropY, c.cropH || rotH));

            const outLeft = cropX - c.padL;
            const outTop = cropY - c.padT;
            const outRight = cropX + cropW + c.padR;
            const outBottom = cropY + cropH + c.padB;

            const minX = Math.min(0, outLeft);
            const minY = Math.min(0, outTop);
            const maxX = Math.max(rotW, outRight);
            const maxY = Math.max(rotH, outBottom);
            const spanW = Math.max(1, maxX - minX);
            const spanH = Math.max(1, maxY - minY);

            // Generous padding for centered rotation knob above & glass HUD below
            const padX = 58;
            const padTop = 60;
            const padBottom = 68;
            const availW = Math.max(80, cw - padX * 2);
            const availH = Math.max(80, ch - padTop - padBottom);
            const scale = Math.min(availW / spanW, availH / spanH);

            const ox = (cw - spanW * scale) / 2 - minX * scale;
            const oy = padTop + (availH - spanH * scale) / 2 - minY * scale;

            const toScreen = (ix, iy) => ({ x: ox + ix * scale, y: oy + iy * scale });
            return {
                cw, ch, scale, ox, oy, rotW, rotH,
                cropX, cropY, cropW, cropH,
                outLeft, outTop, outRight, outBottom,
                toScreen,
            };
        };

        const draw = () => {
            const L = getLayout();
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.round(L.cw * dpr) || canvas.height !== Math.round(L.ch * dpr)) {
                canvas.width = Math.round(L.cw * dpr);
                canvas.height = Math.round(L.ch * dpr);
            }
            const ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, L.cw, L.ch);

            const pTL = L.toScreen(L.outLeft, L.outTop);
            const pBR = L.toScreen(L.outRight, L.outBottom);
            const pW = pBR.x - pTL.x;
            const pH = pBR.y - pTL.y;

            const cTL = L.toScreen(L.cropX, L.cropY);
            const cBR = L.toScreen(L.cropX + L.cropW, L.cropY + L.cropH);
            const cW = cBR.x - cTL.x;
            const cH = cBR.y - cTL.y;

            const rTL = L.toScreen(0, 0);
            const rBR = L.toScreen(L.rotW, L.rotH);

            // 1. Outer padded canvas preview (soft fill + subtle diagonal hatch)
            ctx.save();
            ctx.beginPath();
            ctx.rect(pTL.x, pTL.y, pW, pH);
            ctx.clip();

            if (c.fillMode === "transparent") {
                ctx.fillStyle = "rgba(167, 139, 250, 0.08)";
                ctx.fillRect(pTL.x, pTL.y, pW, pH);
            } else {
                ctx.fillStyle = c.fillColor || "#808080";
                ctx.globalAlpha = 0.42;
                ctx.fillRect(pTL.x, pTL.y, pW, pH);
                ctx.globalAlpha = 1;
            }

            // Subtle diagonal lines in expanded area for visual clarity
            ctx.strokeStyle = "rgba(196, 181, 253, 0.14)";
            ctx.lineWidth = 1;
            const step = 14;
            for (let d = -pH; d < pW + pH; d += step) {
                ctx.beginPath();
                ctx.moveTo(pTL.x + d, pTL.y);
                ctx.lineTo(pTL.x + d - pH, pTL.y + pH);
                ctx.stroke();
            }
            ctx.restore();

            // 2. Rotated image
            if (state.activeImg) {
                const imgCenter = L.toScreen(L.rotW / 2, L.rotH / 2);
                ctx.save();
                ctx.translate(imgCenter.x, imgCenter.y);
                ctx.rotate((c.rotation * Math.PI) / 180);
                ctx.drawImage(
                    state.activeImg,
                    (-state.srcW * L.scale) / 2,
                    (-state.srcH * L.scale) / 2,
                    state.srcW * L.scale,
                    state.srcH * L.scale
                );
                ctx.restore();
            }

            // 3. Dim cropped-out region of source image
            ctx.save();
            ctx.fillStyle = "rgba(7, 7, 12, 0.64)";
            ctx.beginPath();
            ctx.rect(rTL.x, rTL.y, rBR.x - rTL.x, rBR.y - rTL.y);
            ctx.rect(cTL.x, cTL.y, cW, cH);
            ctx.fill("evenodd");
            ctx.restore();

            // 4. Lavender/Violet expanded boundary frame + modern pill handles
            const hasPad = c.padL > 0 || c.padT > 0 || c.padR > 0 || c.padB > 0;
            ctx.save();
            ctx.strokeStyle = hasPad ? "rgba(192, 132, 252, 0.9)" : "rgba(167, 139, 250, 0.45)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(pTL.x, pTL.y, pW, pH);
            ctx.setLineDash([]);

            const pMidX = (pTL.x + pBR.x) / 2;
            const pMidY = (pTL.y + pBR.y) / 2;

            const drawPadPill = (x, y, horiz, id, valuePx) => {
                const isHot = activeHandle === id || hoverHandle === id;
                const pw = horiz ? 34 : 7;
                const ph = horiz ? 7 : 34;
                ctx.save();
                if (isHot) {
                    ctx.shadowColor = "rgba(192, 132, 252, 0.7)";
                    ctx.shadowBlur = 10;
                }
                drawRoundedRect(ctx, x - pw / 2, y - ph / 2, pw, ph, 99);
                ctx.fillStyle = isHot ? "#e9d5ff" : "#c084fc";
                ctx.fill();
                ctx.strokeStyle = "#1e1033";
                ctx.lineWidth = 1.25;
                ctx.stroke();

                if (valuePx > 0 || isHot) {
                    ctx.shadowBlur = 0;
                    ctx.font = "600 10px ui-monospace, Consolas, monospace";
                    ctx.fillStyle = isHot ? "#f5d0fe" : "rgba(216, 180, 254, 0.85)";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const tx = horiz ? x : id === "pad-l" ? x - 20 : x + 20;
                    const ty = horiz ? (id === "pad-t" ? y - 14 : y + 14) : y;
                    if (valuePx > 0) ctx.fillText(`+${Math.round(valuePx)}`, tx, ty);
                }
                ctx.restore();
            };

            drawPadPill(pMidX, pTL.y - 12, true, "pad-t", c.padT);
            drawPadPill(pMidX, pBR.y + 12, true, "pad-b", c.padB);
            drawPadPill(pTL.x - 12, pMidY, false, "pad-l", c.padL);
            drawPadPill(pBR.x + 12, pMidY, false, "pad-r", c.padR);
            ctx.restore();

            // 5. Crisp Ice-White Crop Frame + Rule-of-Thirds Grid + Circular Corner Handles
            ctx.save();
            // Subtle rule-of-thirds photography grid inside crop frame
            ctx.strokeStyle = activeHandle?.startsWith("crop-") ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            for (let i = 1; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(cTL.x + (cW * i) / 3, cTL.y);
                ctx.lineTo(cTL.x + (cW * i) / 3, cBR.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cTL.x, cTL.y + (cH * i) / 3);
                ctx.lineTo(cBR.x, cTL.y + (cH * i) / 3);
                ctx.stroke();
            }

            // Crisp border
            ctx.strokeStyle = "#f4f4f5";
            ctx.lineWidth = 1.6;
            ctx.strokeRect(cTL.x, cTL.y, cW, cH);

            // Corner circular nodes
            const corners = [
                ["crop-nw", cTL.x, cTL.y],
                ["crop-ne", cBR.x, cTL.y],
                ["crop-sw", cTL.x, cBR.y],
                ["crop-se", cBR.x, cBR.y],
            ];
            for (const [id, hx, hy] of corners) {
                const isHot = activeHandle === id || hoverHandle === id;
                ctx.save();
                if (isHot) {
                    ctx.shadowColor = "rgba(129, 140, 248, 0.85)";
                    ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                ctx.arc(hx, hy, isHot ? 6.5 : 5.2, 0, Math.PI * 2);
                ctx.fillStyle = isHot ? "#818cf8" : "#ffffff";
                ctx.fill();
                ctx.strokeStyle = "#181825";
                ctx.lineWidth = 1.6;
                ctx.stroke();
                ctx.restore();
            }

            // Edge subtle mini-bars on crop box
            const drawEdgeTick = (id, x, y, horiz) => {
                const isHot = activeHandle === id || hoverHandle === id;
                const tw = horiz ? 18 : 4;
                const th = horiz ? 4 : 18;
                drawRoundedRect(ctx, x - tw / 2, y - th / 2, tw, th, 99);
                ctx.fillStyle = isHot ? "#818cf8" : "rgba(244, 244, 245, 0.9)";
                ctx.fill();
            };
            const cMidX = cTL.x + cW / 2;
            const cMidY = cTL.y + cH / 2;
            drawEdgeTick("crop-n", cMidX, cTL.y, true);
            drawEdgeTick("crop-s", cMidX, cBR.y, true);
            drawEdgeTick("crop-w", cTL.x, cMidY, false);
            drawEdgeTick("crop-e", cBR.x, cMidY, false);

            // 6. Centered Top Indigo-Violet Rotation Handle (original placement!)
            const rotAnchorY = Math.min(cTL.y, pTL.y - 12);
            const rotX = cMidX;
            const rotY = Math.max(22, rotAnchorY - 26);
            const rotHot = activeHandle === "rotate" || hoverHandle === "rotate";

            ctx.strokeStyle = "rgba(129, 140, 248, 0.65)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cMidX, cTL.y);
            ctx.lineTo(rotX, rotY + 11);
            ctx.stroke();

            ctx.save();
            if (rotHot) {
                ctx.shadowColor = "rgba(129, 140, 248, 0.8)";
                ctx.shadowBlur = 12;
            }
            const grad = ctx.createLinearGradient(rotX - 11, rotY - 11, rotX + 11, rotY + 11);
            grad.addColorStop(0, "#6366f1");
            grad.addColorStop(1, "#a855f7");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(rotX, rotY, rotHot ? 12 : 10.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↻", rotX, rotY + 0.5);

            if (rotHot || Math.abs(c.rotation) >= 0.05) {
                ctx.shadowBlur = 0;
                ctx.font = "600 11px ui-monospace, Consolas, monospace";
                ctx.fillStyle = "#c7d2fe";
                ctx.textAlign = "left";
                ctx.fillText(`${c.rotation.toFixed(1)}°`, rotX + 16, rotY + 0.5);
            }
            ctx.restore();
            ctx.restore();

            updateHud();
        };

        redrawStageCanvas = draw;

        const hitTest = (mx, my) => {
            const L = getLayout();
            const cTL = L.toScreen(L.cropX, L.cropY);
            const cBR = L.toScreen(L.cropX + L.cropW, L.cropY + L.cropH);
            const pTL = L.toScreen(L.outLeft, L.outTop);
            const pBR = L.toScreen(L.outRight, L.outBottom);
            const cMidX = (cTL.x + cBR.x) / 2;
            const cMidY = (cTL.y + cBR.y) / 2;
            const pMidX = (pTL.x + pBR.x) / 2;
            const pMidY = (pTL.y + pBR.y) / 2;
            const near = (x, y, r = 13) => Math.hypot(mx - x, my - y) <= r;

            const rotAnchorY = Math.min(cTL.y, pTL.y - 12);
            const rotX = cMidX;
            const rotY = Math.max(22, rotAnchorY - 26);
            if (near(rotX, rotY, 15)) return "rotate";

            // Pad pill handles (larger hit area along pill axis)
            if (Math.abs(mx - pMidX) <= 22 && Math.abs(my - (pTL.y - 12)) <= 12) return "pad-t";
            if (Math.abs(mx - pMidX) <= 22 && Math.abs(my - (pBR.y + 12)) <= 12) return "pad-b";
            if (Math.abs(mx - (pTL.x - 12)) <= 12 && Math.abs(my - pMidY) <= 22) return "pad-l";
            if (Math.abs(mx - (pBR.x + 12)) <= 12 && Math.abs(my - pMidY) <= 22) return "pad-r";

            if (near(cTL.x, cTL.y, 12)) return "crop-nw";
            if (near(cBR.x, cTL.y, 12)) return "crop-ne";
            if (near(cTL.x, cBR.y, 12)) return "crop-sw";
            if (near(cBR.x, cBR.y, 12)) return "crop-se";
            if (near(cMidX, cTL.y, 12)) return "crop-n";
            if (near(cMidX, cBR.y, 12)) return "crop-s";
            if (near(cTL.x, cMidY, 12)) return "crop-w";
            if (near(cBR.x, cMidY, 12)) return "crop-e";
            if (mx >= cTL.x && mx <= cBR.x && my >= cTL.y && my <= cBR.y) return "crop-move";
            return null;
        };

        const cursorFor = (h) => {
            if (!h) return "default";
            if (h === "rotate") return "grab";
            if (h === "crop-move") return "move";
            if (h === "pad-l" || h === "pad-r" || h === "crop-w" || h === "crop-e") return "ew-resize";
            if (h === "pad-t" || h === "pad-b" || h === "crop-n" || h === "crop-s") return "ns-resize";
            if (h === "crop-nw" || h === "crop-se") return "nwse-resize";
            return "nesw-resize";
        };

        canvas.addEventListener("pointerdown", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const h = hitTest(mx, my);
            if (!h) return;
            const L = getLayout();
            const center = L.toScreen(L.rotW / 2, L.rotH / 2);
            activeHandle = h;
            dragStart = {
                mx, my,
                scale: L.scale,
                rotW: L.rotW,
                rotH: L.rotH,
                center,
                rotation: c.rotation,
                cropX: c.cropX,
                cropY: c.cropY,
                cropW: c.cropW,
                cropH: c.cropH,
                padL: c.padL,
                padT: c.padT,
                padR: c.padR,
                padB: c.padB,
                startAngle: Math.atan2(my - center.y, mx - center.x),
            };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            draw();
        });

        canvas.addEventListener("pointermove", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            if (!activeHandle) {
                const h = hitTest(mx, my);
                if (h !== hoverHandle) {
                    hoverHandle = h;
                    canvas.style.cursor = cursorFor(h);
                    draw();
                }
                return;
            }
            const ds = dragStart;
            const dxImg = (mx - ds.mx) / ds.scale;
            const dyImg = (my - ds.my) / ds.scale;

            if (activeHandle === "rotate") {
                const curAngle = Math.atan2(my - ds.center.y, mx - ds.center.x);
                let deg = ds.rotation + ((curAngle - ds.startAngle) * 180) / Math.PI;
                deg = (((deg + 180) % 360) + 360) % 360 - 180;
                deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
                c.rotation = deg;
                const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);
                c.cropX = 0;
                c.cropY = 0;
                c.cropW = rotW;
                c.cropH = rotH;
                syncLeftNumericInputs?.();
                draw();
                return;
            }

            if (activeHandle === "pad-l") c.padL = Math.max(0, Math.min(4096, Math.round(ds.padL - dxImg)));
            else if (activeHandle === "pad-r") c.padR = Math.max(0, Math.min(4096, Math.round(ds.padR + dxImg)));
            else if (activeHandle === "pad-t") c.padT = Math.max(0, Math.min(4096, Math.round(ds.padT - dyImg)));
            else if (activeHandle === "pad-b") c.padB = Math.max(0, Math.min(4096, Math.round(ds.padB + dyImg)));
            else if (activeHandle === "crop-move") {
                c.cropX = Math.max(0, Math.min(ds.rotW - ds.cropW, Math.round(ds.cropX + dxImg)));
                c.cropY = Math.max(0, Math.min(ds.rotH - ds.cropH, Math.round(ds.cropY + dyImg)));
            } else if (activeHandle.startsWith("crop-")) {
                let x0 = ds.cropX;
                let y0 = ds.cropY;
                let x1 = ds.cropX + ds.cropW;
                let y1 = ds.cropY + ds.cropH;
                const minBox = 16;

                if (activeHandle.includes("w")) x0 = Math.max(0, Math.min(x1 - minBox, Math.round(ds.cropX + dxImg)));
                if (activeHandle.includes("e")) x1 = Math.min(ds.rotW, Math.max(x0 + minBox, Math.round(ds.cropX + ds.cropW + dxImg)));
                if (activeHandle.includes("n")) y0 = Math.max(0, Math.min(y1 - minBox, Math.round(ds.cropY + dyImg)));
                if (activeHandle.includes("s")) y1 = Math.min(ds.rotH, Math.max(y0 + minBox, Math.round(ds.cropY + ds.cropH + dyImg)));

                let nw = x1 - x0;
                let nh = y1 - y0;
                const lockedRatio = c.lockRatio
                    ? parseRatioString(c.aspectPreset, ds.rotW, ds.rotH) || ds.cropW / Math.max(1, ds.cropH)
                    : null;
                if (lockedRatio) {
                    if (activeHandle === "crop-n" || activeHandle === "crop-s") {
                        nw = Math.max(minBox, Math.min(ds.rotW, Math.round(nh * lockedRatio)));
                        x0 = Math.max(0, Math.min(ds.rotW - nw, Math.round((x0 + x1 - nw) / 2)));
                    } else {
                        nh = Math.max(minBox, Math.min(ds.rotH, Math.round(nw / lockedRatio)));
                        if (activeHandle.includes("n")) y0 = Math.max(0, y1 - nh);
                        else if (y0 + nh > ds.rotH) {
                            nh = ds.rotH - y0;
                            nw = Math.max(minBox, Math.round(nh * lockedRatio));
                        }
                    }
                }
                c.cropX = x0;
                c.cropY = y0;
                c.cropW = Math.max(minBox, Math.min(ds.rotW - x0, nw));
                c.cropH = Math.max(minBox, Math.min(ds.rotH - y0, nh));
            }

            syncLeftNumericInputs?.();
            draw();
        });

        const endDrag = (e) => {
            if (!activeHandle) return;
            activeHandle = null;
            if (e?.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
            draw();
        };
        canvas.addEventListener("pointerup", endDrag);
        canvas.addEventListener("pointercancel", endDrag);

        requestAnimationFrame(draw);
    }

    // ============================================================
    // Interactive Right Stage #2: Canvas Resolution & Iso-MP Curves
    // ============================================================
    function mountResolutionStage() {
        const r = state.res;
        const wrap = document.createElement("div");
        wrap.className = "mls-interactive-canvas-wrap";

        const canvas = document.createElement("canvas");
        canvas.className = "mls-interactive-canvas";
        wrap.appendChild(canvas);

        const hud = document.createElement("div");
        hud.className = "mls-stage-hud";
        wrap.appendChild(hud);
        stageViewport.appendChild(wrap);

        let hoverHandle = null;
        let activeHandle = null;
        let dragStart = null;

        const updateHud = () => {
            const fitLabels = { pad: t("扩图填充"), crop: t("居中裁切"), contain: t("等比适应"), stretch: t("拉伸填满") };
            hud.innerHTML = `
                <span>${escapeHtml(t("目标画布"))} <b>${r.width} × ${r.height}</b> · ${formatMP(r.width, r.height)} MP · ${formatRatioLabel(r.width, r.height)}</span>
                <span class="mls-hud-legend">
                    <span>${escapeHtml(t("步长"))} ÷${r.step}</span>
                    <span>${escapeHtml(t("模式："))}${escapeHtml(fitLabels[r.fitMode] || r.fitMode)}</span>
                    <span>${escapeHtml(t("拖拽边缘调整（Shift 锁比例）"))}</span>
                </span>
            `;
        };

        const getMetrics = () => {
            const rect = wrap.getBoundingClientRect();
            const cw = Math.max(260, Math.floor(rect.width));
            const ch = Math.max(220, Math.floor(rect.height));
            const maxSpanW = Math.max(2600, r.width * 1.32);
            const maxSpanH = Math.max(2200, r.height * 1.32);
            const scale = Math.min((cw - 96) / maxSpanW, (ch - 120) / maxSpanH);
            const cx = cw / 2;
            const cy = ch / 2 - 6;
            const boxW = r.width * scale;
            const boxH = r.height * scale;
            return {
                cw, ch, scale, cx, cy,
                left: cx - boxW / 2,
                top: cy - boxH / 2,
                right: cx + boxW / 2,
                bottom: cy + boxH / 2,
                boxW, boxH,
            };
        };

        const draw = () => {
            const M = getMetrics();
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.round(M.cw * dpr) || canvas.height !== Math.round(M.ch * dpr)) {
                canvas.width = Math.round(M.cw * dpr);
                canvas.height = Math.round(M.ch * dpr);
            }
            const ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, M.cw, M.ch);

            // Subtle starry dot grid
            ctx.fillStyle = "rgba(165, 180, 252, 0.08)";
            for (let gx = 20; gx < M.cw; gx += 22) {
                for (let gy = 20; gy < M.ch; gy += 22) {
                    ctx.fillRect(gx, gy, 1.3, 1.3);
                }
            }

            // Smooth Indigo/Violet Iso-MP reference curves
            const curves = [
                { mp: 0.5, label: "0.5 MP", color: "rgba(129, 140, 248, 0.16)" },
                { mp: 1.0, label: "1.0 MP", color: "rgba(129, 140, 248, 0.24)" },
                { mp: 2.0, label: "2.0 MP", color: "rgba(167, 139, 250, 0.22)" },
                { mp: 4.0, label: "4.0 MP", color: "rgba(192, 132, 252, 0.16)" },
            ];
            ctx.save();
            ctx.font = "500 10.5px ui-monospace, Consolas, monospace";
            ctx.textAlign = "right";
            for (const cv of curves) {
                const area = cv.mp * 1_000_000;
                ctx.strokeStyle = cv.color;
                ctx.lineWidth = 1;
                for (const sx of [-1, 1]) {
                    for (const sy of [-1, 1]) {
                        ctx.beginPath();
                        let started = false;
                        for (let pxW = 240; pxW <= 5600; pxW += 60) {
                            const pxH = area / pxW;
                            const x = M.cx + (sx * pxW * M.scale) / 2;
                            const y = M.cy + (sy * pxH * M.scale) / 2;
                            if (x < -10 || x > M.cw + 10 || y < -10 || y > M.ch + 10) continue;
                            if (!started) {
                                ctx.moveTo(x, y);
                                started = true;
                            } else {
                                ctx.lineTo(x, y);
                            }
                        }
                        ctx.stroke();
                    }
                }
                const labelW = Math.min((M.cw - 60) / M.scale, Math.sqrt(area) * 1.48);
                const labelH = area / Math.max(120, labelW);
                const ly = M.cy - (labelH * M.scale) / 2;
                if (ly > 36 && ly < M.ch - 60) {
                    ctx.fillStyle = "rgba(165, 180, 252, 0.5)";
                    ctx.fillText(cv.label, M.cw - 16, ly - 4);
                }
            }
            ctx.restore();

            // Target frame with soft Magic Indigo glow
            ctx.save();
            ctx.shadowColor = "rgba(99, 102, 241, 0.32)";
            ctx.shadowBlur = 24;
            ctx.fillStyle = "rgba(99, 102, 241, 0.12)";
            ctx.fillRect(M.left, M.top, M.boxW, M.boxH);
            ctx.restore();

            // Live source image preview inside target frame according to fitMode
            if (state.activeImg) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(M.left, M.top, M.boxW, M.boxH);
                ctx.clip();

                if (r.fitMode === "pad" && r.fillMode !== "transparent") {
                    ctx.fillStyle = r.fillColor || "#808080";
                    ctx.globalAlpha = 0.25;
                    ctx.fillRect(M.left, M.top, M.boxW, M.boxH);
                }

                ctx.globalAlpha = 0.72;
                if (r.fitMode === "stretch") {
                    ctx.drawImage(state.activeImg, M.left, M.top, M.boxW, M.boxH);
                } else if (r.fitMode === "crop") {
                    const s = Math.max(M.boxW / state.srcW, M.boxH / state.srcH);
                    const dw = state.srcW * s;
                    const dh = state.srcH * s;
                    ctx.drawImage(state.activeImg, M.cx - dw / 2, M.cy - dh / 2, dw, dh);
                } else {
                    const s = Math.min(M.boxW / state.srcW, M.boxH / state.srcH);
                    const dw = state.srcW * s;
                    const dh = state.srcH * s;
                    ctx.drawImage(state.activeImg, M.cx - dw / 2, M.cy - dh / 2, dw, dh);
                }
                ctx.restore();
            }

            // Crisp violet-indigo frame border
            ctx.save();
            const bGrad = ctx.createLinearGradient(M.left, M.top, M.right, M.bottom);
            bGrad.addColorStop(0, "#818cf8");
            bGrad.addColorStop(1, "#c084fc");
            ctx.strokeStyle = bGrad;
            ctx.lineWidth = 2;
            ctx.strokeRect(M.left, M.top, M.boxW, M.boxH);

            // Pill handles (E, W, N, S) + Circular corner handles (SE)
            const drawPill = (id, x, y, horiz) => {
                const isHot = activeHandle === id || hoverHandle === id;
                const pw = horiz ? 30 : 7;
                const ph = horiz ? 7 : 30;
                drawRoundedRect(ctx, x - pw / 2, y - ph / 2, pw, ph, 99);
                ctx.fillStyle = isHot ? "#ffffff" : "#a5b4fc";
                ctx.fill();
                ctx.strokeStyle = "#1e1b4b";
                ctx.lineWidth = 1.25;
                ctx.stroke();
            };
            drawPill("e", M.right, M.cy, false);
            drawPill("s", M.cx, M.bottom, true);

            const seHot = activeHandle === "se" || hoverHandle === "se";
            ctx.beginPath();
            ctx.arc(M.right, M.bottom, seHot ? 7 : 5.5, 0, Math.PI * 2);
            ctx.fillStyle = seHot ? "#ffffff" : "#c084fc";
            ctx.fill();
            ctx.strokeStyle = "#1e1b4b";
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Clean top-left & top-right corner readouts
            ctx.fillStyle = "#f4f4f5";
            ctx.font = "bold 16px ui-monospace, Consolas, monospace";
            ctx.textAlign = "left";
            ctx.fillText(`${r.width} × ${r.height}`, 18, 28);

            ctx.textAlign = "right";
            ctx.fillStyle = "#c4b5fd";
            ctx.font = "600 13px ui-monospace, Consolas, monospace";
            ctx.fillText(`${formatMP(r.width, r.height)} MP  ·  ${formatRatioLabel(r.width, r.height)}`, M.cw - 18, 28);
            ctx.restore();

            updateHud();
        };

        redrawStageCanvas = draw;

        const hitTest = (mx, my) => {
            const M = getMetrics();
            if (Math.hypot(mx - M.right, my - M.bottom) <= 14) return "se";
            if (Math.abs(mx - M.right) <= 13 && Math.abs(my - M.cy) <= 22) return "e";
            if (Math.abs(mx - M.cx) <= 22 && Math.abs(my - M.bottom) <= 13) return "s";
            return null;
        };

        canvas.addEventListener("pointerdown", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const h = hitTest(mx, my);
            if (!h) return;
            const M = getMetrics();
            activeHandle = h;
            dragStart = { mx, my, w: r.width, h: r.height, scale: M.scale };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            draw();
        });

        canvas.addEventListener("pointermove", (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            if (!activeHandle) {
                const h = hitTest(mx, my);
                if (h !== hoverHandle) {
                    hoverHandle = h;
                    canvas.style.cursor = h === "se" ? "nwse-resize" : h === "e" ? "ew-resize" : h === "s" ? "ns-resize" : "default";
                    draw();
                }
                return;
            }
            const ds = dragStart;
            const step = e.altKey ? 1 : r.step;
            const growW = ((mx - ds.mx) * 2) / ds.scale;
            const growH = ((my - ds.my) * 2) / ds.scale;

            if (e.shiftKey) {
                const ratio = ds.w / Math.max(1, ds.h);
                const nw = snapDim(ds.w + growW, step);
                r.width = nw;
                r.height = snapDim(nw / ratio, step);
            } else if (activeHandle === "se") {
                r.width = snapDim(ds.w + growW, step);
                r.height = snapDim(ds.h + growH, step);
            } else if (activeHandle === "e") {
                r.width = snapDim(ds.w + growW, step);
            } else if (activeHandle === "s") {
                r.height = snapDim(ds.h + growH, step);
            }
            r.portrait = r.height >= r.width;
            syncLeftNumericInputs?.();
            draw();
        });

        const endDrag = (e) => {
            if (!activeHandle) return;
            activeHandle = null;
            if (e?.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
            renderLeftContent();
            draw();
        };
        canvas.addEventListener("pointerup", endDrag);
        canvas.addEventListener("pointercancel", endDrag);

        requestAnimationFrame(draw);
    }

    // ============================================================
    // Interactive Right Stage #3: rgthree-style Swipe / Curtain Comparer
    // ============================================================
    function mountSwipeComparerStage() {
        const wrap = document.createElement("div");
        wrap.className = "mls-swipe-wrap";

        const box = document.createElement("div");
        box.className = "mls-swipe-box";
        box.style.setProperty("--mls-split", `${(state.compareSplit * 100).toFixed(2)}%`);

        const imgLeft = document.createElement("img");
        imgLeft.className = "mls-swipe-img mls-swipe-img-left";
        imgLeft.src = state.activeInputUrl;
        imgLeft.alt = "source";

        const imgRight = document.createElement("img");
        imgRight.className = "mls-swipe-img mls-swipe-img-right";
        imgRight.src = state.previewDataUrl;
        imgRight.alt = "result";

        const divider = document.createElement("div");
        divider.className = "mls-swipe-divider";
        divider.innerHTML = `<div class="mls-swipe-knob">⇄</div>`;

        const tagLeft = document.createElement("div");
        tagLeft.className = "mls-swipe-tag mls-swipe-tag-left";
        tagLeft.textContent = `${t("原图")} ${state.srcW}×${state.srcH}`;

        const tagRight = document.createElement("div");
        tagRight.className = "mls-swipe-tag mls-swipe-tag-right";
        tagRight.textContent = `${t("预览")} ${state.previewW}×${state.previewH}`;

        box.appendChild(imgLeft);
        box.appendChild(imgRight);
        box.appendChild(divider);
        box.appendChild(tagLeft);
        box.appendChild(tagRight);
        wrap.appendChild(box);

        // Floating HUD with split readout + Hover/Drag mode toggle (like rgthree Image Comparer)
        const hud = document.createElement("div");
        hud.className = "mls-stage-hud mls-swipe-hud";

        const pctSpan = document.createElement("span");
        const modeBtn = document.createElement("button");
        modeBtn.className = "mls-swipe-mode-btn";
        modeBtn.title = t("切换「悬停滑移」(rgthree 风格) 或「拖拽滑移」");

        const centerBtn = document.createElement("button");
        centerBtn.className = "mls-swipe-mode-btn";
        centerBtn.textContent = "50%";
        centerBtn.title = t("重置分割线到正中间");

        const updateSplitUI = () => {
            const pct = Math.max(0, Math.min(1, state.compareSplit));
            state.compareSplit = pct;
            const pctStr = `${(pct * 100).toFixed(2)}%`;
            box.style.setProperty("--mls-split", pctStr);
            pctSpan.innerHTML = `${escapeHtml(t("原图"))} <b>${Math.round(pct * 100)}%</b> ⇄ <b>${Math.round((1 - pct) * 100)}%</b> ${escapeHtml(t("预览"))}`;
            tagLeft.style.opacity = pct < 0.08 ? "0.2" : "1";
            tagRight.style.opacity = pct > 0.92 ? "0.2" : "1";
        };

        const updateModeBtn = () => {
            modeBtn.textContent = state.compareHoverSlide ? t("🖱️ 悬停滑移") : t("✋ 拖拽对比");
        };

        modeBtn.onclick = (e) => {
            e.stopPropagation();
            state.compareHoverSlide = !state.compareHoverSlide;
            updateModeBtn();
        };
        centerBtn.onclick = (e) => {
            e.stopPropagation();
            state.compareSplit = 0.5;
            updateSplitUI();
        };

        hud.appendChild(pctSpan);
        hud.appendChild(modeBtn);
        hud.appendChild(centerBtn);
        wrap.appendChild(hud);
        stageViewport.appendChild(wrap);

        // Fit swipe box cleanly to the target/source aspect ratio so edges align tightly
        const fitSwipeBox = () => {
            const wRect = wrap.getBoundingClientRect();
            const availW = Math.max(120, wRect.width - 48);
            const availH = Math.max(120, wRect.height - 82);
            const refW = Math.max(1, state.previewW || state.srcW || 512);
            const refH = Math.max(1, state.previewH || state.srcH || 512);
            const scale = Math.min(availW / refW, availH / refH);
            box.style.width = `${Math.max(80, Math.round(refW * scale))}px`;
            box.style.height = `${Math.max(80, Math.round(refH * scale))}px`;
        };
        redrawStageCanvas = fitSwipeBox;

        let swipeDragging = false;
        const setSplitFromClientX = (clientX) => {
            const r = box.getBoundingClientRect();
            if (r.width <= 0) return;
            state.compareSplit = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
            updateSplitUI();
        };

        box.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            swipeDragging = true;
            setSplitFromClientX(e.clientX);
            box.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        box.addEventListener("pointermove", (e) => {
            if (swipeDragging || state.compareHoverSlide) {
                setSplitFromClientX(e.clientX);
            }
        });
        const stopSwipe = (e) => {
            if (!swipeDragging) return;
            swipeDragging = false;
            if (e?.pointerId != null && box.hasPointerCapture(e.pointerId)) {
                box.releasePointerCapture(e.pointerId);
            }
        };
        box.addEventListener("pointerup", stopSwipe);
        box.addEventListener("pointercancel", stopSwipe);
        box.addEventListener("lostpointercapture", stopSwipe);

        updateModeBtn();
        updateSplitUI();
        requestAnimationFrame(fitSwipeBox);
    }

    // ============================================================
    // Interactive Right Stage #4: Real-time Color Grading & Filter Preview
    // ============================================================
    function mountColorAdjustStage() {
        const a = state.adj;
        const pad = document.createElement("div");
        pad.className = "mls-preview-pad";
        pad.style.position = "relative";

        const imgEl = document.createElement("img");
        imgEl.className = "mls-preview-img";
        imgEl.src = state.activeInputUrl;
        pad.appendChild(imgEl);

        const hud = document.createElement("div");
        hud.className = "mls-stage-hud";
        pad.appendChild(hud);
        stageViewport.appendChild(pad);

        const applyLiveStyle = () => {
            const filters = [
                `brightness(${a.brightness})`,
                `contrast(${a.contrast})`,
                `saturate(${a.saturation})`,
                `hue-rotate(${a.hue}deg)`,
            ];
            if (a.temperature > 0) filters.push(`sepia(${(a.temperature / 260).toFixed(2)})`);
            if (a.grayscale) filters.push("grayscale(1)");
            if (a.invert) filters.push("invert(1)");
            if (a.blur > 0) filters.push(`blur(${a.blur}px)`);
            imgEl.style.filter = filters.join(" ");
            imgEl.style.transform = `scale(${a.flipH ? -1 : 1}, ${a.flipV ? -1 : 1})`;

            const tags = [];
            if (Math.abs(a.brightness - 1) > 0.01) tags.push(`${t("亮度")} ${Math.round(a.brightness * 100)}%`);
            if (Math.abs(a.contrast - 1) > 0.01) tags.push(`${t("对比")} ${Math.round(a.contrast * 100)}%`);
            if (Math.abs(a.saturation - 1) > 0.01) tags.push(`${t("饱和")} ${Math.round(a.saturation * 100)}%`);
            if (Math.abs(a.hue) > 0) tags.push(`${t("色相")} ${a.hue}°`);
            if (Math.abs(a.temperature) > 0) tags.push(`${t("色温")} ${a.temperature > 0 ? "+" : ""}${a.temperature}`);
            if (Math.abs(a.sharpness - 1) > 0.01) tags.push(`${t("锐化")} ${a.sharpness.toFixed(1)}`);
            if (a.blur > 0) tags.push(`${t("模糊")} ${a.blur}px`);
            if (a.flipH) tags.push(t("水平翻转"));
            if (a.flipV) tags.push(t("垂直翻转"));
            if (a.grayscale) tags.push(t("灰度"));
            if (a.invert) tags.push(t("反色"));
            hud.innerHTML =
                tags.length > 0
                    ? `<span>${escapeHtml(t("实时调色预览："))}<b>${escapeHtml(tags.join(" · "))}</b></span>`
                    : `<span>${escapeHtml(t("实时调色预览 · 拖动左侧滑块即刻生效，满意后点「⚡ 生成预览」渲染高清结果"))}</span>`;
        };

        redrawStageCanvas = applyLiveStyle;
        applyLiveStyle();
    }

    // ============================================================
    // Right Main Stage Controller (Interactive Canvas / Result / Swipe / Compare)
    // ============================================================
    function renderRightStage() {
        redrawStageCanvas = null;
        stageBar.innerHTML = "";

        const canEdit = hasInteractiveEditor();
        if (!canEdit && state.stageView === "editor") {
            state.stageView = state.previewDataUrl ? "result" : "source";
        }

        // Left side of stage toolbar: info pills
        const info = document.createElement("div");
        info.className = "mls-preview-info";
        const srcPill = document.createElement("span");
        srcPill.className = "mls-badge-pill";
        srcPill.textContent = `${t("输入")} ${state.srcW}×${state.srcH}`;
        info.appendChild(srcPill);

        if (state.previewDataUrl) {
            const arrow = document.createElement("span");
            arrow.textContent = "→";
            info.appendChild(arrow);

            const resPill = document.createElement("span");
            resPill.className = "mls-badge-pill accent";
            resPill.textContent = `${t("预览")} ${state.previewW}×${state.previewH} (${formatMP(state.previewW, state.previewH)} MP)`;
            info.appendChild(resPill);

            if (state.previewElapsedMs != null) {
                const msSpan = document.createElement("span");
                msSpan.className = "mls-muted";
                msSpan.textContent = `${(state.previewElapsedMs / 1000).toFixed(2)}s`;
                info.appendChild(msSpan);
            }
        }

        // Right side of stage toolbar: view switcher + chain actions
        const barRight = document.createElement("div");
        barRight.className = "mls-row";

        const viewSeg = document.createElement("div");
        viewSeg.className = "mls-seg";

        const views = canEdit
            ? [
                  { id: "editor", label: t("🎛️ 交互画布") },
                  { id: "result", label: t("🖼️ 预览结果") },
                  { id: "swipe", label: t("🪞 滑动对比") },
                  { id: "compare", label: t("⚖️ 左右对比") },
              ]
            : [
                  { id: "result", label: t("🖼️ 预览结果") },
                  { id: "source", label: t("📄 当前输入") },
                  { id: "swipe", label: t("🪞 滑动对比") },
                  { id: "compare", label: t("⚖️ 左右对比") },
              ];

        for (const v of views) {
            const b = document.createElement("button");
            b.className = `mls-seg-btn ${state.stageView === v.id ? "active" : ""}`;
            b.textContent = v.label;
            b.onclick = () => {
                state.stageView = v.id;
                renderRightStage();
            };
            viewSeg.appendChild(b);
        }
        barRight.appendChild(viewSeg);

        if (state.previewDataUrl) {
            const chainBtn = document.createElement("button");
            chainBtn.className = "mls-chip";
            chainBtn.title = t("把当前预览结果设为新的输入图，继续叠加下一步处理");
            chainBtn.textContent = t("↪ 设为输入");
            chainBtn.onclick = async () => {
                try {
                    const img = await loadImageElement(state.previewDataUrl);
                    state.activeInputDataUrl = state.previewDataUrl;
                    state.activeInputUrl = state.previewDataUrl;
                    state.activeImg = img;
                    state.srcW = img.naturalWidth || state.previewW;
                    state.srcH = img.naturalHeight || state.previewH;
                    state.rmbg.lastOutputs = null;
                    resetCropRotatePadToSource();
                    resetResolutionToSource();
                    resetColorAdjust();
                    initComposeBaseLayer(state.compose, img, state.previewDataUrl);
                    if (hasInteractiveEditor()) state.stageView = "editor";
                    renderAll();
                } catch (e) {
                    console.error(e);
                }
            };
            barRight.appendChild(chainBtn);
        }

        if (state.activeInputDataUrl) {
            const revertBtn = document.createElement("button");
            revertBtn.className = "mls-chip";
            revertBtn.textContent = t("↩ 还原原图");
            revertBtn.onclick = async () => {
                try {
                    const img = await loadImageElement(state.origUrl);
                    state.activeInputDataUrl = null;
                    state.activeInputUrl = state.origUrl;
                    state.activeImg = img;
                    state.srcW = img.naturalWidth;
                    state.srcH = img.naturalHeight;
                    state.rmbg.lastOutputs = null;
                    resetCropRotatePadToSource();
                    resetResolutionToSource();
                    resetColorAdjust();
                    initComposeBaseLayer(state.compose, img, state.origUrl);
                    if (hasInteractiveEditor()) state.stageView = "editor";
                    renderAll();
                } catch (e) {
                    console.error(e);
                }
            };
            barRight.appendChild(revertBtn);
        }

        stageBar.appendChild(info);
        stageBar.appendChild(barRight);

        // Viewport Body
        stageViewport.innerHTML = "";
        if (canEdit && state.stageView === "editor") {
            if (state.mainTab === "compose") {
                mountComposeStage({
                    stageViewport,
                    state,
                    renderLeftContent,
                    setRedraw: (fn) => {
                        redrawStageCanvas = fn;
                    },
                    getSyncInputs: () => syncLeftNumericInputs,
                });
            } else if (state.basicSubTab === "crop_rotate_pad") {
                mountCropRotatePadStage();
            } else if (state.basicSubTab === "resolution") {
                mountResolutionStage();
            } else if (state.basicSubTab === "adjust") {
                mountColorAdjustStage();
            }
        } else if (state.stageView === "swipe" && state.previewDataUrl) {
            mountSwipeComparerStage();
        } else if (state.stageView === "compare" && state.previewDataUrl) {
            const cmp = document.createElement("div");
            cmp.className = "mls-compare-wrap";
            cmp.innerHTML = `
                <div class="mls-compare-pane">
                    <span class="mls-badge-pill">${escapeHtml(t("当前输入"))} (${state.srcW}×${state.srcH})</span>
                    <img src="${state.activeInputUrl}" alt="source" />
                </div>
                <div class="mls-compare-pane">
                    <span class="mls-badge-pill accent">${escapeHtml(t("预览结果"))} (${state.previewW}×${state.previewH})</span>
                    <img src="${state.previewDataUrl}" alt="result" />
                </div>
            `;
            stageViewport.appendChild(cmp);
        } else if (state.stageView === "source" || !state.previewDataUrl) {
            const pad = document.createElement("div");
            pad.className = "mls-preview-pad";
            if (state.activeInputUrl) {
                const imgEl = document.createElement("img");
                imgEl.className = "mls-preview-img";
                imgEl.style.maxHeight = state.previewDataUrl ? "100%" : "calc(100% - 28px)";
                imgEl.src = state.activeInputUrl;
                pad.appendChild(imgEl);
            }
            if (!state.previewDataUrl) {
                const hint = document.createElement("div");
                hint.className = "mls-muted";
                hint.textContent = t("在左侧调好参数后，点击「⚡ 生成预览」即可在此查看高清处理结果");
                pad.appendChild(hint);
            }
            stageViewport.appendChild(pad);
        } else {
            const pad = document.createElement("div");
            pad.className = "mls-preview-pad";
            const imgEl = document.createElement("img");
            imgEl.className = "mls-preview-img";
            imgEl.src = state.previewDataUrl;
            pad.appendChild(imgEl);
            stageViewport.appendChild(pad);
        }

        if (state.isRunning) {
            const overlay = document.createElement("div");
            overlay.className = "mls-preview-loading";
            overlay.innerHTML = `<div class="mls-spinner"></div><div>${escapeHtml(t("正在本地处理图像，请稍候..."))}</div>`;
            stageViewport.appendChild(overlay);
        }

        // Update modal footer status
        applyBtn.disabled = !state.previewDataUrl || state.isRunning;
        if (state.errorMsg) {
            footerStatus.innerHTML = `<span style="color:#f87171;">⚠️ ${escapeHtml(state.errorMsg)}</span>`;
        } else if (state.previewDataUrl) {
            footerStatus.innerHTML = `<span style="color:#a5b4fc;">${escapeHtml(t("✅ 已生成预览"))}</span><span>${escapeHtml(state.previewTag)} · ${state.previewW}×${state.previewH}</span>`;
        } else {
            footerStatus.innerHTML = `<span>${escapeHtml(t("📄 当前图片："))}<b>${escapeHtml(state.origFilename)}</b> (${state.srcW}×${state.srcH})</span>`;
        }
    }

    // ============================================================
    // Dynamic Parameter Form Renderer (ControlNet & RMBG)
    // ============================================================
    function renderDynamicParamList(schema, valuesObj, onChange) {
        const list = document.createElement("div");
        list.className = "mls-param-list";

        if (!schema || schema.length === 0) {
            const empty = document.createElement("div");
            empty.className = "mls-muted";
            empty.textContent = t("该节点没有额外参数，直接点击下方「⚡ 生成预览」即可。");
            list.appendChild(empty);
            return list;
        }

        for (const field of schema) {
            const row = document.createElement("div");
            row.className = "mls-param-row";

            const label = document.createElement("span");
            label.className = "mls-param-name";
            label.textContent = formatParamLabel(field);
            label.title = field.name;

            const ctrl = document.createElement("div");
            ctrl.className = "mls-param-ctrl";
            const curVal = valuesObj[field.name] !== undefined ? valuesObj[field.name] : field.default;

            if (field.type === "COMBO") {
                const sel = document.createElement("select");
                sel.className = "mls-select mls-input-wide";
                for (const optVal of field.choices || []) {
                    const opt = document.createElement("option");
                    opt.value = optVal;
                    opt.textContent = optVal;
                    sel.appendChild(opt);
                }
                sel.value = String(curVal);
                sel.onchange = () => {
                    valuesObj[field.name] = sel.value;
                    onChange?.();
                };
                ctrl.appendChild(sel);
            } else if (field.type === "BOOLEAN") {
                const lbl = document.createElement("label");
                lbl.className = "mls-toggle";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = Boolean(curVal);
                const txt = document.createElement("span");
                txt.className = "mls-muted";
                txt.textContent = cb.checked ? t("开启") : t("未开启");
                cb.onchange = () => {
                    valuesObj[field.name] = cb.checked;
                    txt.textContent = cb.checked ? t("开启") : t("未开启");
                    onChange?.();
                };
                lbl.appendChild(cb);
                lbl.appendChild(txt);
                ctrl.appendChild(lbl);
            } else if (field.type === "COLOR") {
                const picker = document.createElement("input");
                picker.type = "color";
                picker.className = "mls-color-swatch";
                picker.value = /^#[0-9a-fA-F]{6}$/.test(String(curVal)) ? String(curVal) : "#222222";
                const txt = document.createElement("input");
                txt.type = "text";
                txt.className = "mls-input";
                txt.style.width = "88px";
                txt.value = String(curVal || "#222222");
                picker.oninput = () => {
                    txt.value = picker.value;
                    valuesObj[field.name] = picker.value;
                    onChange?.();
                };
                txt.onchange = () => {
                    valuesObj[field.name] = txt.value.trim() || "#222222";
                    if (/^#[0-9a-fA-F]{6}$/.test(valuesObj[field.name])) picker.value = valuesObj[field.name];
                    onChange?.();
                };
                ctrl.appendChild(picker);
                ctrl.appendChild(txt);
            } else if (field.type === "INT" || field.type === "FLOAT") {
                const min = field.min ?? 0;
                const max = field.max ?? (field.type === "INT" ? 2048 : 10);
                const step = field.step ?? (field.type === "INT" ? 1 : 0.01);

                const num = document.createElement("input");
                num.type = "number";
                num.className = "mls-input mls-input-num";
                num.min = String(min);
                num.max = String(max);
                num.step = String(step);
                num.value = String(curVal);

                if (max - min <= 4096) {
                    const slider = document.createElement("input");
                    slider.type = "range";
                    slider.min = String(min);
                    slider.max = String(max);
                    slider.step = String(step);
                    slider.value = String(curVal);
                    slider.oninput = () => {
                        const v = field.type === "INT" ? parseInt(slider.value, 10) : parseFloat(slider.value);
                        num.value = String(v);
                        valuesObj[field.name] = v;
                        onChange?.();
                    };
                    num.onchange = () => {
                        const v = field.type === "INT" ? parseInt(num.value, 10) : parseFloat(num.value);
                        if (!Number.isFinite(v)) return;
                        const clamped = Math.max(min, Math.min(max, v));
                        num.value = String(clamped);
                        slider.value = String(clamped);
                        valuesObj[field.name] = clamped;
                        onChange?.();
                    };
                    ctrl.appendChild(slider);
                } else {
                    num.onchange = () => {
                        const v = field.type === "INT" ? parseInt(num.value, 10) : parseFloat(num.value);
                        if (!Number.isFinite(v)) return;
                        valuesObj[field.name] = v;
                        onChange?.();
                    };
                }
                ctrl.appendChild(num);
            } else {
                const txt = document.createElement("input");
                txt.type = "text";
                txt.className = "mls-input mls-input-wide";
                txt.value = String(curVal ?? "");
                txt.onchange = () => {
                    valuesObj[field.name] = txt.value;
                    onChange?.();
                };
                ctrl.appendChild(txt);
            }

            row.appendChild(label);
            row.appendChild(ctrl);
            list.appendChild(row);
        }

        return list;
    }

    // ============================================================
    // Left Parameter Sidebar: Sub 1A (Crop / Rotate / Pad)
    // ============================================================
    function renderCropRotatePadSidebar() {
        const c = state.crp;

        const applyAspectPreset = (presetKey) => {
            c.aspectPreset = presetKey;
            const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);
            if (presetKey === "free") {
                c.lockRatio = false;
                renderLeftContent();
                ensureEditorStageView();
                return;
            }
            let targetRatio;
            if (presetKey === "source") {
                targetRatio = rotW / Math.max(1, rotH);
            } else {
                const [a, b] = presetKey.split(":").map(Number);
                const lo = Math.min(a, b);
                const hi = Math.max(a, b);
                targetRatio = a === b ? 1 : c.portrait ? lo / hi : hi / lo;
            }

            if (c.fitMode === "crop") {
                c.padL = c.padT = c.padR = c.padB = 0;
                let nw = rotW;
                let nh = Math.round(rotW / targetRatio);
                if (nh > rotH) {
                    nh = rotH;
                    nw = Math.round(rotH * targetRatio);
                }
                c.cropW = Math.max(16, Math.min(rotW, nw));
                c.cropH = Math.max(16, Math.min(rotH, nh));
                c.cropX = Math.floor((rotW - c.cropW) / 2);
                c.cropY = Math.floor((rotH - c.cropH) / 2);
            } else {
                const cw = Math.max(16, c.cropW || rotW);
                const ch = Math.max(16, c.cropH || rotH);
                const curRatio = cw / ch;
                if (curRatio < targetRatio) {
                    const targetW = Math.ceil(ch * targetRatio);
                    const totalPadX = Math.max(0, targetW - cw);
                    c.padL = Math.floor(totalPadX / 2);
                    c.padR = totalPadX - c.padL;
                    c.padT = 0;
                    c.padB = 0;
                } else {
                    const targetH = Math.ceil(cw / targetRatio);
                    const totalPadY = Math.max(0, targetH - ch);
                    c.padT = Math.floor(totalPadY / 2);
                    c.padB = totalPadY - c.padT;
                    c.padL = 0;
                    c.padR = 0;
                }
            }
            renderLeftContent();
            ensureEditorStageView();
        };

        // Card 1: Ratio & Fit Mode
        const card1 = document.createElement("div");
        card1.className = "mls-panel";
        const c1Head = document.createElement("div");
        c1Head.className = "mls-panel-head";
        c1Head.innerHTML = `<span class="mls-panel-title">${escapeHtml(t("比例与适配模式"))}</span>`;

        const fitSeg = document.createElement("div");
        fitSeg.className = "mls-seg";
        [
            { id: "crop", label: t("裁剪") },
            { id: "pad", label: t("扩图") },
        ].forEach((m) => {
            const b = document.createElement("button");
            b.className = `mls-seg-btn ${c.fitMode === m.id ? "active" : ""}`;
            b.textContent = m.label;
            b.onclick = () => {
                c.fitMode = m.id;
                if (c.aspectPreset !== "free") applyAspectPreset(c.aspectPreset);
                else renderLeftContent();
            };
            fitSeg.appendChild(b);
        });
        c1Head.appendChild(fitSeg);
        card1.appendChild(c1Head);

        const chipsRow = document.createElement("div");
        chipsRow.className = "mls-chip-row";

        const orientBtn = document.createElement("button");
        orientBtn.className = "mls-chip";
        orientBtn.textContent = c.portrait ? t("▯ 竖") : t("▭ 横");
        orientBtn.onclick = () => {
            c.portrait = !c.portrait;
            if (c.aspectPreset !== "free" && c.aspectPreset !== "source" && c.aspectPreset !== "1:1") {
                applyAspectPreset(c.aspectPreset);
            } else {
                renderLeftContent();
            }
        };
        chipsRow.appendChild(orientBtn);

        const presets = [
            { id: "free", label: t("自由") },
            { id: "source", label: t("原图") },
            { id: "1:1", label: "1:1" },
            { id: "3:4", label: c.portrait ? "3:4" : "4:3" },
            { id: "2:3", label: c.portrait ? "2:3" : "3:2" },
            { id: "9:16", label: c.portrait ? "9:16" : "16:9" },
            { id: "9:21", label: c.portrait ? "9:21" : "21:9" },
        ];
        for (const p of presets) {
            const b = document.createElement("button");
            b.className = `mls-chip ${c.aspectPreset === p.id ? "active" : ""}`;
            b.textContent = p.label;
            b.onclick = () => applyAspectPreset(p.id);
            chipsRow.appendChild(b);
        }

        const lockBtn = document.createElement("button");
        lockBtn.className = `mls-chip ${c.lockRatio ? "active-violet" : ""}`;
        lockBtn.textContent = c.lockRatio ? t("🔒 已锁比例") : t("🔓 锁比例");
        lockBtn.onclick = () => {
            c.lockRatio = !c.lockRatio;
            renderLeftContent();
        };
        chipsRow.appendChild(lockBtn);
        card1.appendChild(chipsRow);
        leftScroll.appendChild(card1);

        // Card 2: Rotation & 4-side Padding
        const card2 = document.createElement("div");
        card2.className = "mls-panel";
        card2.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("旋转与外扩微调"))}</span><span class="mls-panel-sub">${escapeHtml(t("也可在右侧画布直接拖拽"))}</span></div>`;

        const rotRow = document.createElement("div");
        rotRow.className = "mls-row-between";
        rotRow.innerHTML = `<span class="mls-label">${escapeHtml(t("旋转角度"))}</span>`;
        const rotCtrls = document.createElement("div");
        rotCtrls.className = "mls-row";
        const rotInput = document.createElement("input");
        rotInput.type = "number";
        rotInput.className = "mls-input mls-input-num";
        rotInput.style.width = "64px";
        rotInput.min = "-180";
        rotInput.max = "180";
        rotInput.step = "0.5";
        rotInput.value = String(c.rotation);
        rotInput.onchange = () => {
            const v = parseFloat(rotInput.value);
            if (!Number.isFinite(v)) return;
            c.rotation = Math.max(-180, Math.min(180, v));
            const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);
            c.cropX = 0;
            c.cropY = 0;
            c.cropW = rotW;
            c.cropH = rotH;
            ensureEditorStageView();
        };
        rotCtrls.appendChild(rotInput);
        [
            { d: -90, t: "-90°" },
            { d: 0, t: "0°" },
            { d: 90, t: "+90°" },
        ].forEach((q) => {
            const qb = document.createElement("button");
            qb.className = "mls-chip";
            qb.textContent = q.t;
            qb.onclick = () => {
                c.rotation = q.d === 0 ? 0 : (((c.rotation + q.d + 180) % 360) + 360) % 360 - 180;
                const { rotW, rotH } = rotatedBounds(state.srcW, state.srcH, c.rotation);
                c.cropX = 0;
                c.cropY = 0;
                c.cropW = rotW;
                c.cropH = rotH;
                syncLeftNumericInputs?.();
                ensureEditorStageView();
            };
            rotCtrls.appendChild(qb);
        });
        rotRow.appendChild(rotCtrls);
        card2.appendChild(rotRow);

        const padHead = document.createElement("div");
        padHead.className = "mls-row-between";
        padHead.innerHTML = `<span class="mls-label">${escapeHtml(t("扩图边距 (px)"))}</span>`;
        const centerGroup = document.createElement("div");
        centerGroup.className = "mls-chip-row";

        const centerH = document.createElement("button");
        centerH.className = "mls-chip";
        centerH.textContent = t("水平居中");
        centerH.onclick = () => {
            const tot = c.padL + c.padR;
            c.padL = Math.floor(tot / 2);
            c.padR = tot - c.padL;
            syncLeftNumericInputs?.();
            ensureEditorStageView();
        };
        const centerV = document.createElement("button");
        centerV.className = "mls-chip";
        centerV.textContent = t("垂直居中");
        centerV.onclick = () => {
            const tot = c.padT + c.padB;
            c.padT = Math.floor(tot / 2);
            c.padB = tot - c.padT;
            syncLeftNumericInputs?.();
            ensureEditorStageView();
        };
        centerGroup.appendChild(centerH);
        centerGroup.appendChild(centerV);
        padHead.appendChild(centerGroup);
        card2.appendChild(padHead);

        const padGrid = document.createElement("div");
        padGrid.className = "mls-grid-4";
        const padInputs = {};
        [
            { key: "padL", label: t("左") },
            { key: "padT", label: t("上") },
            { key: "padR", label: t("右") },
            { key: "padB", label: t("下") },
        ].forEach((item) => {
            const f = document.createElement("div");
            f.className = "mls-mini-field";
            f.innerHTML = `<span>${item.label}</span>`;
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = "0";
            inp.max = "4096";
            inp.step = "8";
            inp.className = "mls-input";
            inp.value = String(Math.round(c[item.key]));
            inp.oninput = () => {
                c[item.key] = Math.max(0, Math.min(4096, parseInt(inp.value, 10) || 0));
                ensureEditorStageView();
            };
            padInputs[item.key] = inp;
            f.appendChild(inp);
            padGrid.appendChild(f);
        });
        card2.appendChild(padGrid);
        leftScroll.appendChild(card2);

        // Card 3: Fill, Feather, Alignment & MP Resize
        const card3 = document.createElement("div");
        card3.className = "mls-panel";
        card3.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("填充与输出规格"))}</span></div>`;

        const fillRow = document.createElement("div");
        fillRow.className = "mls-row";

        const fillSel = document.createElement("select");
        fillSel.className = "mls-select";
        fillSel.innerHTML = `
            <option value="solid">${escapeHtml(t("纯色填充"))}</option>
            <option value="edge">${escapeHtml(t("边缘拉伸"))}</option>
            <option value="mirror">${escapeHtml(t("镜像反射"))}</option>
            <option value="blur">${escapeHtml(t("模糊背景"))}</option>
            <option value="transparent">${escapeHtml(t("透明通道"))}</option>
        `;
        fillSel.value = c.fillMode;
        fillSel.onchange = () => {
            c.fillMode = fillSel.value;
            ensureEditorStageView();
        };

        const colorPicker = document.createElement("input");
        colorPicker.type = "color";
        colorPicker.className = "mls-color-swatch";
        colorPicker.value = c.fillColor;
        colorPicker.oninput = () => {
            c.fillColor = colorPicker.value;
            ensureEditorStageView();
        };

        const quickWrap = document.createElement("div");
        quickWrap.className = "mls-row";
        quickWrap.style.gap = "4px";
        for (const hex of ["#808080", "#000000", "#ffffff"]) {
            const sw = document.createElement("button");
            sw.className = "mls-quick-color";
            sw.style.background = hex;
            sw.title = hex;
            sw.onclick = () => {
                c.fillColor = hex;
                c.fillMode = "solid";
                fillSel.value = "solid";
                colorPicker.value = hex;
                ensureEditorStageView();
            };
            quickWrap.appendChild(sw);
        }

        fillRow.appendChild(fillSel);
        fillRow.appendChild(colorPicker);
        fillRow.appendChild(quickWrap);
        card3.appendChild(fillRow);

        const feAlignRow = document.createElement("div");
        feAlignRow.className = "mls-row-between";

        const featherWrap = document.createElement("div");
        featherWrap.className = "mls-row";
        featherWrap.innerHTML = `<span class="mls-muted">${escapeHtml(t("边缘羽化"))}</span>`;
        const featherInp = document.createElement("input");
        featherInp.type = "number";
        featherInp.className = "mls-input mls-input-num";
        featherInp.style.width = "58px";
        featherInp.min = "0";
        featherInp.max = "256";
        featherInp.value = String(c.feather);
        featherInp.onchange = () => {
            c.feather = Math.max(0, Math.min(256, parseInt(featherInp.value, 10) || 0));
        };
        featherWrap.appendChild(featherInp);
        featherWrap.insertAdjacentHTML("beforeend", `<span class="mls-muted">px</span>`);

        const alignWrap = document.createElement("div");
        alignWrap.className = "mls-row";
        alignWrap.innerHTML = `<span class="mls-muted">${escapeHtml(t("对齐"))}</span>`;
        const alignSel = document.createElement("select");
        alignSel.className = "mls-select";
        alignSel.innerHTML = `<option value="1">${escapeHtml(t("不对齐"))}</option><option value="8">÷8</option><option value="16">÷16</option><option value="32">÷32</option><option value="64">÷64</option>`;
        alignSel.value = String(c.canvasMultiple);
        alignSel.onchange = () => {
            c.canvasMultiple = parseInt(alignSel.value, 10) || 1;
            ensureEditorStageView();
        };
        alignWrap.appendChild(alignSel);

        feAlignRow.appendChild(featherWrap);
        feAlignRow.appendChild(alignWrap);
        card3.appendChild(feAlignRow);

        const mpToggleRow = document.createElement("div");
        mpToggleRow.className = "mls-row-between";
        const mpLbl = document.createElement("label");
        mpLbl.className = "mls-toggle";
        const mpCb = document.createElement("input");
        mpCb.type = "checkbox";
        mpCb.checked = c.resizeEnabled;
        mpCb.onchange = () => {
            c.resizeEnabled = mpCb.checked;
            renderLeftContent();
            ensureEditorStageView();
        };
        mpLbl.appendChild(mpCb);
        mpLbl.insertAdjacentHTML("beforeend", `<span class="mls-label">${escapeHtml(t("按像素预算缩放输出"))}</span>`);
        mpToggleRow.appendChild(mpLbl);
        card3.appendChild(mpToggleRow);

        if (c.resizeEnabled) {
            const mpDetail = document.createElement("div");
            mpDetail.className = "mls-row";
            const mpInp = document.createElement("input");
            mpInp.type = "number";
            mpInp.className = "mls-input mls-input-num";
            mpInp.style.width = "64px";
            mpInp.min = "0.1";
            mpInp.max = "16";
            mpInp.step = "0.1";
            mpInp.value = String(c.megapixels);
            mpInp.oninput = () => {
                c.megapixels = Math.max(0.1, Math.min(16, parseFloat(mpInp.value) || 1.0));
                ensureEditorStageView();
            };

            const stepSel = document.createElement("select");
            stepSel.className = "mls-select";
            stepSel.innerHTML = `<option value="8">÷8</option><option value="16">÷16</option><option value="32">÷32</option><option value="64">÷64</option>`;
            stepSel.value = String(c.resolutionSteps);
            stepSel.onchange = () => {
                c.resolutionSteps = parseInt(stepSel.value, 10) || 32;
                ensureEditorStageView();
            };

            const methSel = document.createElement("select");
            methSel.className = "mls-select";
            methSel.innerHTML = `<option value="lanczos">Lanczos</option><option value="bicubic">Bicubic</option><option value="bilinear">Bilinear</option><option value="area">Area</option><option value="nearest">Nearest</option>`;
            methSel.value = c.resizeMethod;
            methSel.onchange = () => {
                c.resizeMethod = methSel.value;
            };

            mpDetail.appendChild(mpInp);
            mpDetail.insertAdjacentHTML("beforeend", `<span class="mls-muted">MP</span>`);
            mpDetail.appendChild(stepSel);
            mpDetail.appendChild(methSel);
            card3.appendChild(mpDetail);
        }

        leftScroll.appendChild(card3);

        syncLeftNumericInputs = () => {
            rotInput.value = String(Math.round(c.rotation * 10) / 10);
            padInputs.padL.value = String(Math.round(c.padL));
            padInputs.padT.value = String(Math.round(c.padT));
            padInputs.padR.value = String(Math.round(c.padR));
            padInputs.padB.value = String(Math.round(c.padB));
        };
    }

    // ============================================================
    // Left Parameter Sidebar: Sub 1B (Canvas Resolution)
    // ============================================================
    function renderResolutionSidebar() {
        const r = state.res;

        // Card 1: Shape & Ratio
        const card1 = document.createElement("div");
        card1.className = "mls-panel";
        card1.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("比例预设"))}</span><span class="mls-panel-sub">${escapeHtml(r.portrait ? t("竖屏") : t("横屏"))}</span></div>`;

        const ratioRow = document.createElement("div");
        ratioRow.className = "mls-chip-row";

        const orientBtn = document.createElement("button");
        orientBtn.className = "mls-chip";
        orientBtn.textContent = r.portrait ? t("▯ 竖屏") : t("▭ 横屏");
        orientBtn.onclick = () => {
            r.portrait = !r.portrait;
            if ((r.portrait && r.width > r.height) || (!r.portrait && r.height > r.width)) {
                [r.width, r.height] = [r.height, r.width];
            }
            renderLeftContent();
            ensureEditorStageView();
        };
        ratioRow.appendChild(orientBtn);

        const ratios = [
            { x: 1, y: 1, label: "1:1" },
            { x: 3, y: 4, label: r.portrait ? "3:4" : "4:3" },
            { x: 2, y: 3, label: r.portrait ? "2:3" : "3:2" },
            { x: 9, y: 16, label: r.portrait ? "9:16" : "16:9" },
            { x: 4, y: 7, label: r.portrait ? "4:7" : "7:4" },
            { x: 1, y: 2, label: r.portrait ? "1:2" : "2:1" },
        ];
        const curReduced = reduceRatio(r.width, r.height);
        for (const rt of ratios) {
            const active =
                (curReduced.x === rt.x && curReduced.y === rt.y) ||
                (curReduced.x === rt.y && curReduced.y === rt.x);
            const b = document.createElement("button");
            b.className = `mls-chip ${active ? "active" : ""}`;
            b.textContent = rt.label;
            b.onclick = () => {
                const sz = applyRatioAtBudget(r.width, r.height, { x: rt.x, y: rt.y }, r.step, r.portrait);
                r.width = sz.width;
                r.height = sz.height;
                renderLeftContent();
                ensureEditorStageView();
            };
            ratioRow.appendChild(b);
        }
        card1.appendChild(ratioRow);
        leftScroll.appendChild(card1);

        // Card 2: Exact Dimensions & Budget
        const card2 = document.createElement("div");
        card2.className = "mls-panel";
        card2.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("宽高与像素预算"))}</span><span class="mls-panel-sub">${escapeHtml(t("步长"))} ÷${r.step}</span></div>`;

        const whRow = document.createElement("div");
        whRow.className = "mls-row";

        const wInp = document.createElement("input");
        wInp.type = "number";
        wInp.className = "mls-input mls-input-num";
        wInp.min = "64";
        wInp.max = "8192";
        wInp.step = String(r.step);
        wInp.value = String(r.width);
        wInp.onchange = () => {
            r.width = snapDim(wInp.value, r.step);
            r.portrait = r.height >= r.width;
            renderLeftContent();
            ensureEditorStageView();
        };

        const swapBtn = document.createElement("button");
        swapBtn.className = "mls-chip";
        swapBtn.textContent = "⇄";
        swapBtn.title = t("交换宽高");
        swapBtn.onclick = () => {
            [r.width, r.height] = [r.height, r.width];
            r.portrait = r.height >= r.width;
            renderLeftContent();
            ensureEditorStageView();
        };

        const hInp = document.createElement("input");
        hInp.type = "number";
        hInp.className = "mls-input mls-input-num";
        hInp.min = "64";
        hInp.max = "8192";
        hInp.step = String(r.step);
        hInp.value = String(r.height);
        hInp.onchange = () => {
            r.height = snapDim(hInp.value, r.step);
            r.portrait = r.height >= r.width;
            renderLeftContent();
            ensureEditorStageView();
        };

        whRow.appendChild(wInp);
        whRow.insertAdjacentHTML("beforeend", `<span class="mls-muted">W</span>`);
        whRow.appendChild(swapBtn);
        whRow.appendChild(hInp);
        whRow.insertAdjacentHTML("beforeend", `<span class="mls-muted">H</span>`);
        card2.appendChild(whRow);

        const mpStepRow = document.createElement("div");
        mpStepRow.className = "mls-row-between";

        const mpWrap = document.createElement("div");
        mpWrap.className = "mls-row";
        mpWrap.innerHTML = `<span class="mls-muted">${escapeHtml(t("像素预算"))}</span>`;
        const mpInp = document.createElement("input");
        mpInp.type = "number";
        mpInp.className = "mls-input mls-input-num";
        mpInp.style.width = "68px";
        mpInp.min = "0.1";
        mpInp.max = "16";
        mpInp.step = "0.1";
        mpInp.value = formatMP(r.width, r.height);
        mpInp.onchange = () => {
            const mp = Math.max(0.1, Math.min(16, parseFloat(mpInp.value) || 1.0));
            const target = computeMPTarget(r.width, r.height, mp, r.step);
            r.width = target.width;
            r.height = target.height;
            renderLeftContent();
            ensureEditorStageView();
        };
        mpWrap.appendChild(mpInp);
        mpWrap.insertAdjacentHTML("beforeend", `<span class="mls-muted">MP</span>`);

        const stepWrap = document.createElement("div");
        stepWrap.className = "mls-row";
        stepWrap.innerHTML = `<span class="mls-muted">${escapeHtml(t("步长"))}</span>`;
        const stepSel = document.createElement("select");
        stepSel.className = "mls-select";
        stepSel.innerHTML = `<option value="8">÷8</option><option value="16">÷16</option><option value="32">÷32</option><option value="64">÷64</option>`;
        stepSel.value = String(r.step);
        stepSel.onchange = () => {
            r.step = parseInt(stepSel.value, 10) || 32;
            r.width = snapDim(r.width, r.step);
            r.height = snapDim(r.height, r.step);
            renderLeftContent();
            ensureEditorStageView();
        };
        stepWrap.appendChild(stepSel);

        mpStepRow.appendChild(mpWrap);
        mpStepRow.appendChild(stepWrap);
        card2.appendChild(mpStepRow);

        // Recommended grid sizes
        const sizeGrid = document.createElement("div");
        sizeGrid.className = "mls-size-grid";
        for (const sz of buildRecommendedSizes(r.width, r.height, r.step)) {
            const b = document.createElement("button");
            b.className = `mls-size-btn ${sz.width === r.width && sz.height === r.height ? "active" : ""}`;
            b.textContent = `${sz.width} × ${sz.height}`;
            b.onclick = () => {
                r.width = sz.width;
                r.height = sz.height;
                renderLeftContent();
                ensureEditorStageView();
            };
            sizeGrid.appendChild(b);
        }
        card2.appendChild(sizeGrid);
        leftScroll.appendChild(card2);

        // Card 3: Image Fit Mode
        const card3 = document.createElement("div");
        card3.className = "mls-panel";
        card3.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("图像适配与填充"))}</span></div>`;

        const fitRow = document.createElement("div");
        fitRow.className = "mls-row";
        const fitSel = document.createElement("select");
        fitSel.className = "mls-select mls-input-wide";
        fitSel.innerHTML = `
            <option value="pad">${escapeHtml(t("扩图填充 (Pad)"))}</option>
            <option value="crop">${escapeHtml(t("居中裁切 (Crop)"))}</option>
            <option value="contain">${escapeHtml(t("等比适应 (Contain)"))}</option>
            <option value="stretch">${escapeHtml(t("拉伸填满 (Stretch)"))}</option>
        `;
        fitSel.value = r.fitMode;
        fitSel.onchange = () => {
            r.fitMode = fitSel.value;
            renderLeftContent();
            ensureEditorStageView();
        };

        const mSel = document.createElement("select");
        mSel.className = "mls-select";
        mSel.innerHTML = `<option value="lanczos">Lanczos</option><option value="bicubic">Bicubic</option><option value="bilinear">Bilinear</option><option value="area">Area</option><option value="nearest">Nearest</option>`;
        mSel.value = r.resizeMethod;
        mSel.onchange = () => {
            r.resizeMethod = mSel.value;
        };
        fitRow.appendChild(fitSel);
        fitRow.appendChild(mSel);
        card3.appendChild(fitRow);

        if (r.fitMode === "pad") {
            const fillRow = document.createElement("div");
            fillRow.className = "mls-row";
            const fSel = document.createElement("select");
            fSel.className = "mls-select mls-input-wide";
            fSel.innerHTML = `<option value="solid">${escapeHtml(t("纯色填充"))}</option><option value="edge">${escapeHtml(t("边缘拉伸"))}</option><option value="mirror">${escapeHtml(t("镜像反射"))}</option><option value="blur">${escapeHtml(t("模糊背景"))}</option><option value="transparent">${escapeHtml(t("透明通道"))}</option>`;
            fSel.value = r.fillMode;
            fSel.onchange = () => {
                r.fillMode = fSel.value;
                ensureEditorStageView();
            };
            const cp = document.createElement("input");
            cp.type = "color";
            cp.className = "mls-color-swatch";
            cp.value = r.fillColor;
            cp.oninput = () => {
                r.fillColor = cp.value;
                ensureEditorStageView();
            };
            fillRow.appendChild(fSel);
            fillRow.appendChild(cp);
            card3.appendChild(fillRow);
        }

        leftScroll.appendChild(card3);

        syncLeftNumericInputs = () => {
            wInp.value = String(r.width);
            hInp.value = String(r.height);
            mpInp.value = formatMP(r.width, r.height);
        };
    }

    // ============================================================
    // Left Parameter Sidebar: Sub 1C (RMBG)
    // ============================================================
    function renderRmbgSidebar() {
        syncLeftNumericInputs = null;
        if (!state.rmbg.loaded) ensureRmbgInfo();
        if (state.rmbg.loading) {
            leftScroll.innerHTML = `<div class="mls-panel" style="align-items:center;padding:28px;"><div class="mls-spinner"></div><div class="mls-muted">${escapeHtml(t("正在检测本地 RMBG 节点..."))}</div></div>`;
            return;
        }
        if (!state.rmbg.installed) {
            const box = document.createElement("div");
            box.className = "mls-missing-box";
            box.innerHTML = `
                <b>${escapeHtml(t("⚠️ 未检测到去除背景节点 (RMBG)"))}</b>
                <div>${escapeHtml(t("当前 ComfyUI 环境中未安装"))} <code>ComfyUI-RMBG</code> (<code>comfyui-rmbg</code>) ${escapeHtml(t("插件，无法调用去除背景功能。"))}</div>
                <div>${escapeHtml(t("请通过 ComfyUI Manager 安装"))} <code>ComfyUI-RMBG</code> ${escapeHtml(t("并重启 ComfyUI 后再试！"))}</div>
            `;
            leftScroll.appendChild(box);
            return;
        }

        const outCard = document.createElement("div");
        outCard.className = "mls-panel";
        outCard.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("选择输出类型"))}</span><span class="mls-panel-sub">${escapeHtml(t("调用原版 RMBG"))}</span></div>`;

        const outRow = document.createElement("div");
        outRow.className = "mls-chip-row";
        [
            { id: "image", label: t("🖼️ 图像") },
            { id: "mask", label: t("🎭 遮罩") },
            { id: "mask_image", label: t("⬛⬜ 遮罩图像") },
        ].forEach((opt) => {
            const b = document.createElement("button");
            b.className = `mls-chip ${state.rmbg.outputType === opt.id ? "active" : ""}`;
            b.style.flex = "1 1 auto";
            b.textContent = opt.label;
            b.onclick = () => {
                state.rmbg.outputType = opt.id;
                if (state.rmbg.lastOutputs && state.rmbg.lastOutputs[opt.id]) {
                    const hit = state.rmbg.lastOutputs[opt.id];
                    state.previewDataUrl = hit.image;
                    state.previewW = hit.width;
                    state.previewH = hit.height;
                    const lbl = opt.id === "mask" ? t("遮罩") : opt.id === "mask_image" ? t("遮罩图像") : t("去背图像");
                    state.previewTag = `RMBG · ${lbl}`;
                    state.stageView = "result";
                    renderRightStage();
                }
                renderLeftContent();
            };
            outRow.appendChild(b);
        });
        outCard.appendChild(outRow);
        leftScroll.appendChild(outCard);

        const paramCard = document.createElement("div");
        paramCard.className = "mls-panel";
        paramCard.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("RMBG 参数"))}</span><span class="mls-panel-sub">${escapeHtml(state.rmbg.displayName)}</span></div>`;
        paramCard.appendChild(renderDynamicParamList(state.rmbg.schema, state.rmbg.values));
        leftScroll.appendChild(paramCard);
    }

    // ============================================================
    // Left Parameter Sidebar: Main Tab 2 (ControlNet Aux)
    // ============================================================
    function renderControlNetSidebar() {
        syncLeftNumericInputs = null;
        if (!state.cn.loaded) ensureControlNetList();
        if (state.cn.loading) {
            leftScroll.innerHTML = `<div class="mls-panel" style="align-items:center;padding:28px;"><div class="mls-spinner"></div><div class="mls-muted">${escapeHtml(t("正在扫描 comfyui_controlnet_aux 节点..."))}</div></div>`;
            return;
        }
        if (!state.cn.auxInstalled || state.cn.items.length === 0) {
            const box = document.createElement("div");
            box.className = "mls-missing-box";
            box.innerHTML = `
                <b>${escapeHtml(t("⚠️ 未检测到 ControlNet 预处理器插件"))}</b>
                <div>${escapeHtml(t("当前 ComfyUI 环境中未安装"))} <code>comfyui_controlnet_aux</code>. ${escapeHtml(t("无法调用 Canny / Depth / OpenPose 等预处理节点。"))}</div>
                <div>${escapeHtml(t("请通过 ComfyUI Manager 安装"))} <code>comfyui_controlnet_aux</code> ${escapeHtml(t("并重启 ComfyUI 后再试！"))}</div>
            `;
            leftScroll.appendChild(box);
            return;
        }

        const isEn = getStudioLang() === "en";
        const selPanel = document.createElement("div");
        selPanel.className = "mls-panel";
        const searchInp = document.createElement("input");
        searchInp.type = "text";
        searchInp.className = "mls-input";
        searchInp.style.width = "100%";
        searchInp.placeholder = t("🔍 搜索预处理器（canny / depth / pose / lineart...）");
        searchInp.value = state.cn.search;
        searchInp.oninput = () => {
            state.cn.search = searchInp.value;
            renderCnCards();
        };
        selPanel.appendChild(searchInp);

        const listBox = document.createElement("div");
        listBox.className = "mls-cn-list";
        selPanel.appendChild(listBox);

        const renderCnCards = () => {
            listBox.innerHTML = "";
            const q = state.cn.search.trim().toLowerCase();
            const filtered = state.cn.items.filter((it) => {
                if (state.cn.group !== "all" && it.group !== state.cn.group) return false;
                if (!q) return true;
                return (
                    it.id.toLowerCase().includes(q) ||
                    (it.zh_name || "").toLowerCase().includes(q) ||
                    (it.display_name || "").toLowerCase().includes(q) ||
                    (it.desc || "").toLowerCase().includes(q)
                );
            });
            if (filtered.length === 0) {
                listBox.innerHTML = `<div class="mls-muted" style="padding:12px;text-align:center;">${escapeHtml(t("没有匹配的预处理器"))}</div>`;
                return;
            }
            for (const it of filtered) {
                const card = document.createElement("button");
                card.className = `mls-cn-card ${state.cn.selectedId === it.id ? "active" : ""}`;
                const titleText = isEn ? it.display_name || it.id : it.zh_name || it.display_name;
                const subText = isEn ? it.id : it.display_name;
                card.innerHTML = `
                    <div class="mls-cn-card-title">${escapeHtml(titleText)}</div>
                    <div class="mls-cn-card-sub">${escapeHtml(subText)}</div>
                `;
                card.onclick = () => {
                    state.cn.selectedId = it.id;
                    renderLeftContent();
                    renderLeftFooter();
                };
                listBox.appendChild(card);
            }
        };
        renderCnCards();
        leftScroll.appendChild(selPanel);

        const curItem = state.cn.items.find((x) => x.id === state.cn.selectedId) || state.cn.items[0];
        if (curItem) {
            state.cn.selectedId = curItem.id;
            const pVals = state.cn.paramValues[curItem.id] || (state.cn.paramValues[curItem.id] = {});
            const paramPanel = document.createElement("div");
            paramPanel.className = "mls-panel";
            const curTitle = isEn ? curItem.display_name || curItem.id : curItem.zh_name || curItem.display_name;
            paramPanel.innerHTML = `
                <div class="mls-panel-head">
                    <span class="mls-panel-title">${escapeHtml(curTitle)}</span>
                </div>
                ${!isEn && curItem.desc ? `<div class="mls-muted">${escapeHtml(curItem.desc)}</div>` : ""}
            `;
            paramPanel.appendChild(renderDynamicParamList(curItem.params || [], pVals));
            leftScroll.appendChild(paramPanel);
        }
    }

    // ============================================================
    // Left Parameter Sidebar: Sub 1D (Color Grading & Filters)
    // ============================================================
    function renderColorAdjustSidebar() {
        syncLeftNumericInputs = null;
        const a = state.adj;

        const presets = [
            { id: "none", label: t("原图"), vals: { brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0, temperature: 0, sharpness: 1.0, blur: 0, grayscale: false, invert: false } },
            { id: "vivid", label: t("通透提亮"), vals: { brightness: 1.08, contrast: 1.12, saturation: 1.18, hue: 0, temperature: 6, sharpness: 1.25, blur: 0, grayscale: false, invert: false } },
            { id: "cinema", label: t("电影冷调"), vals: { brightness: 0.96, contrast: 1.22, saturation: 0.88, hue: -4, temperature: -28, sharpness: 1.15, blur: 0, grayscale: false, invert: false } },
            { id: "warm", label: t("暖阳胶片"), vals: { brightness: 1.05, contrast: 1.08, saturation: 1.12, hue: 4, temperature: 36, sharpness: 1.0, blur: 0, grayscale: false, invert: false } },
            { id: "jp", label: t("日系清新"), vals: { brightness: 1.12, contrast: 0.92, saturation: 0.9, hue: 0, temperature: -12, sharpness: 1.05, blur: 0, grayscale: false, invert: false } },
            { id: "bw", label: t("高反差黑白"), vals: { brightness: 1.02, contrast: 1.35, saturation: 0.0, hue: 0, temperature: 0, sharpness: 1.3, blur: 0, grayscale: true, invert: false } },
        ];

        const pCard = document.createElement("div");
        pCard.className = "mls-panel";
        pCard.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("风格预设与快速变换"))}</span></div>`;

        const pRow = document.createElement("div");
        pRow.className = "mls-chip-row";
        for (const p of presets) {
            const b = document.createElement("button");
            b.className = `mls-chip ${a.preset === p.id ? "active" : ""}`;
            b.textContent = p.label;
            b.onclick = () => {
                a.preset = p.id;
                Object.assign(a, p.vals);
                renderLeftContent();
                ensureEditorStageView();
            };
            pRow.appendChild(b);
        }
        pCard.appendChild(pRow);

        const qRow = document.createElement("div");
        qRow.className = "mls-chip-row";
        [
            { key: "flipH", label: t("⇄ 水平翻转") },
            { key: "flipV", label: t("⇅ 垂直翻转") },
            { key: "grayscale", label: t("◐ 灰度") },
            { key: "invert", label: t("◑ 反色") },
        ].forEach((item) => {
            const b = document.createElement("button");
            b.className = `mls-chip ${a[item.key] ? "active-violet" : ""}`;
            b.textContent = item.label;
            b.onclick = () => {
                a[item.key] = !a[item.key];
                a.preset = "custom";
                renderLeftContent();
                ensureEditorStageView();
            };
            qRow.appendChild(b);
        });
        pCard.appendChild(qRow);
        leftScroll.appendChild(pCard);

        const sCard = document.createElement("div");
        sCard.className = "mls-panel";
        sCard.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("精细调色与滤镜"))}</span><span class="mls-panel-sub">${escapeHtml(t("右侧实时预览"))}</span></div>`;

        const list = document.createElement("div");
        list.className = "mls-param-list";
        const sliders = [
            { key: "brightness", label: t("亮度"), min: 0.2, max: 2.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
            { key: "contrast", label: t("对比度"), min: 0.2, max: 2.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
            { key: "saturation", label: t("饱和度"), min: 0.0, max: 2.5, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
            { key: "hue", label: t("色相偏移"), min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
            { key: "temperature", label: t("冷暖色温"), min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? "+" : ""}${v}` },
            { key: "sharpness", label: t("锐化强度"), min: 0.0, max: 3.0, step: 0.05, fmt: (v) => `${v.toFixed(2)}` },
            { key: "blur", label: t("高斯模糊"), min: 0, max: 24, step: 0.5, fmt: (v) => `${v}px` },
        ];
        for (const s of sliders) {
            const row = document.createElement("div");
            row.className = "mls-param-row";
            const nameEl = document.createElement("span");
            nameEl.className = "mls-param-name";
            nameEl.textContent = s.label;

            const ctrl = document.createElement("div");
            ctrl.className = "mls-param-ctrl";
            const range = document.createElement("input");
            range.type = "range";
            range.min = String(s.min);
            range.max = String(s.max);
            range.step = String(s.step);
            range.value = String(a[s.key]);

            const valBadge = document.createElement("span");
            valBadge.className = "mls-badge-pill";
            valBadge.style.minWidth = "52px";
            valBadge.style.textAlign = "center";
            valBadge.textContent = s.fmt(a[s.key]);

            range.oninput = () => {
                a[s.key] = parseFloat(range.value);
                a.preset = "custom";
                valBadge.textContent = s.fmt(a[s.key]);
                ensureEditorStageView();
            };

            ctrl.appendChild(range);
            ctrl.appendChild(valBadge);
            row.appendChild(nameEl);
            row.appendChild(ctrl);
            list.appendChild(row);
        }
        sCard.appendChild(list);
        leftScroll.appendChild(sCard);
    }

    // ============================================================
    // Sub-tabs, Left Content, Left Footer & Global Render
    // ============================================================
    function renderSubTabs() {
        subTabsBar.innerHTML = "";
        if (state.mainTab === "compose") {
            subTabsBar.style.display = "none";
            subTabsBar.classList.remove("mls-subtabs-grid2");
            return;
        }
        subTabsBar.style.display = "";
        subTabsBar.classList.toggle("mls-subtabs-grid2", state.mainTab === "basic");

        if (state.mainTab === "basic") {
            [
                { id: "crop_rotate_pad", label: t("📐 裁剪·扩图") },
                { id: "resolution", label: t("📏 分辨率") },
                { id: "rmbg", label: t("✨ 去除背景") },
                { id: "adjust", label: t("🎨 调色·滤镜") },
            ].forEach((s) => {
                const b = document.createElement("button");
                b.className = `mls-subtab ${state.basicSubTab === s.id ? "active" : ""}`;
                b.textContent = s.label;
                b.onclick = () => {
                    state.basicSubTab = s.id;
                    state.errorMsg = "";
                    state.stageView =
                        s.id === "crop_rotate_pad" || s.id === "resolution" || s.id === "adjust"
                            ? "editor"
                            : state.previewDataUrl
                            ? "result"
                            : "source";
                    renderAll();
                };
                subTabsBar.appendChild(b);
            });
        } else {
            [
                { id: "all", label: t("全部") },
                { id: "edge", label: t("线稿") },
                { id: "depth", label: t("深度") },
                { id: "pose", label: t("姿态") },
                { id: "other", label: t("其他") },
            ].forEach((g) => {
                const b = document.createElement("button");
                b.className = `mls-subtab ${state.cn.group === g.id ? "active" : ""}`;
                b.textContent = g.label;
                b.onclick = () => {
                    state.cn.group = g.id;
                    renderAll();
                };
                subTabsBar.appendChild(b);
            });
        }
    }

    function renderLeftContent() {
        leftScroll.innerHTML = "";
        if (state.errorMsg) {
            const errEl = document.createElement("div");
            errEl.className = "mls-error-banner";
            errEl.textContent = `⚠️ ${state.errorMsg}`;
            leftScroll.appendChild(errEl);
        }
        if (state.mainTab === "compose") {
            renderComposeSidebar({
                win,
                leftScroll,
                state,
                ensureRmbgInfo,
                renderLeftContent,
                renderRightStage,
                ensureEditorStageView,
                setSyncInputs: (fn) => {
                    syncLeftNumericInputs = fn;
                },
            });
        } else if (state.mainTab === "basic") {
            if (state.basicSubTab === "crop_rotate_pad") renderCropRotatePadSidebar();
            else if (state.basicSubTab === "resolution") renderResolutionSidebar();
            else if (state.basicSubTab === "adjust") renderColorAdjustSidebar();
            else renderRmbgSidebar();
        } else {
            renderControlNetSidebar();
        }
    }

    function renderLeftFooter() {
        leftFooter.innerHTML = "";

        const genBtn = document.createElement("button");
        genBtn.className = "mls-btn-generate";
        genBtn.textContent = state.isRunning
            ? t("⏳ 正在生成预览...")
            : state.mainTab === "compose"
            ? t("⚡ 合成并预览")
            : t("⚡ 生成预览");

        let canRun = !state.isRunning;
        if (state.mainTab === "basic" && state.basicSubTab === "rmbg" && !state.rmbg.installed) canRun = false;
        if (state.mainTab === "controlnet" && (!state.cn.auxInstalled || !state.cn.selectedId)) canRun = false;
        if (state.mainTab === "compose" && state.compose.layers.length === 0) canRun = false;
        genBtn.disabled = !canRun;

        genBtn.onclick = () => {
            if (state.mainTab === "compose") {
                runComposePreview();
            } else if (state.mainTab === "basic") {
                if (state.basicSubTab === "rmbg") runRmbgPreview();
                else runBasicPreview();
            } else {
                runControlNetPreview();
            }
        };
        leftFooter.appendChild(genBtn);

        if (hasInteractiveEditor()) {
            const resetBtn = document.createElement("button");
            resetBtn.className = "ma-btn";
            resetBtn.textContent = t("↺ 重置");
            resetBtn.onclick = () => {
                if (state.mainTab === "compose") {
                    if (state.activeImg) {
                        initComposeBaseLayer(state.compose, state.activeImg, state.activeInputUrl);
                    }
                } else if (state.basicSubTab === "crop_rotate_pad") {
                    resetCropRotatePadToSource();
                } else if (state.basicSubTab === "resolution") {
                    resetResolutionToSource();
                } else if (state.basicSubTab === "adjust") {
                    resetColorAdjust();
                }
                renderLeftContent();
                ensureEditorStageView();
            };
            leftFooter.appendChild(resetBtn);
        }
    }

    function renderAll() {
        tabBasicBtn.classList.toggle("active", state.mainTab === "basic");
        tabComposeBtn.classList.toggle("active", state.mainTab === "compose");
        tabCnBtn.classList.toggle("active", state.mainTab === "controlnet");
        renderSubTabs();
        renderLeftContent();
        renderLeftFooter();
        renderRightStage();
    }

    tabBasicBtn.onclick = () => {
        if (state.mainTab === "basic") return;
        state.mainTab = "basic";
        state.errorMsg = "";
        state.stageView = hasInteractiveEditor() ? "editor" : state.previewDataUrl ? "result" : "source";
        renderAll();
    };
    tabComposeBtn.onclick = () => {
        if (state.mainTab === "compose") return;
        state.mainTab = "compose";
        state.errorMsg = "";
        if (!state.compose.initialized && state.activeImg) {
            initComposeBaseLayer(state.compose, state.activeImg, state.activeInputUrl);
        }
        state.stageView = "editor";
        renderAll();
    };
    tabCnBtn.onclick = () => {
        if (state.mainTab === "controlnet") return;
        state.mainTab = "controlnet";
        state.errorMsg = "";
        state.stageView = state.previewDataUrl ? "result" : "source";
        renderAll();
    };

    renderAll();
    loadImageElement(origUrl)
        .then((img) => {
            state.activeImg = img;
            state.srcW = img.naturalWidth || 512;
            state.srcH = img.naturalHeight || 512;
            resetCropRotatePadToSource();
            resetResolutionToSource();
            initComposeBaseLayer(state.compose, img, origUrl);
            renderAll();
        })
        .catch((err) => {
            state.errorMsg = t("加载当前图片失败，请检查图片文件是否存在。");
            console.error(err);
            renderAll();
        });
}
