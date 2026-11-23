import { api } from "../../scripts/api.js";

// ============================================================
// Shared i18n helper (reads web/language_switcher.js)
// ============================================================

export function getStudioLang() {
    try {
        if (typeof window !== "undefined" && typeof window.getCurrentLanguage === "function") {
            return window.getCurrentLanguage() || "zh";
        }
        return localStorage.getItem("magic_assistant_language") || "zh";
    } catch {
        return "zh";
    }
}

export function studioT(key) {
    if (key == null || key === "") return key;
    try {
        const lang = getStudioLang();
        if (typeof window !== "undefined" && typeof window.translateText === "function") {
            return window.translateText(key, lang, "MagicPhotopeaNode");
        }
        return key;
    } catch {
        return key;
    }
}

export function formatParamLabel(field) {
    if (getStudioLang() === "en") {
        const raw = String(field.name || field.label || "");
        return raw
            .replace(/_/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());
    }
    return field.label || field.name;
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function loadImg(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

function imageElementToDataUrl(img) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, img.naturalWidth || img.width);
    c.height = Math.max(1, img.naturalHeight || img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
}

const BLEND_MODES = [
    { id: "source-over", labelKey: "正常 (Normal)" },
    { id: "multiply", labelKey: "正片叠底 (Multiply)" },
    { id: "screen", labelKey: "滤色 (Screen)" },
    { id: "overlay", labelKey: "叠加 (Overlay)" },
    { id: "darken", labelKey: "变暗 (Darken)" },
    { id: "lighten", labelKey: "变亮 (Lighten)" },
    { id: "soft-light", labelKey: "柔光 (Soft Light)" },
];

export function createComposeState() {
    return {
        initialized: false,
        canvasW: 512,
        canvasH: 512,
        bgMode: "transparent", // "transparent" | "solid"
        bgColor: "#000000",
        layers: [], // bottom -> top (index 0 is bottommost)
        selectedId: null,
        nextSeq: 1,
        rmbgModel: "RMBG-2.0",
        busyLayerId: null,
    };
}

export function initComposeBaseLayer(compose, img, srcUrl, name = "") {
    const w = img?.naturalWidth || 512;
    const h = img?.naturalHeight || 512;
    compose.canvasW = w;
    compose.canvasH = h;
    compose.layers = [
        {
            id: `layer_base_${compose.nextSeq++}`,
            name: name || studioT("底图"),
            isBase: true,
            img,
            srcUrl,
            origImg: img,
            origUrl: srcUrl,
            rmbgApplied: false,
            w,
            h,
            x: w / 2,
            y: h / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            flipH: false,
            flipV: false,
            opacity: 1,
            blendMode: "source-over",
            visible: true,
        },
    ];
    compose.selectedId = compose.layers[0].id;
    compose.initialized = true;
}

export async function addComposeLayerFromUrl(compose, srcUrl, name = "") {
    const img = await loadImg(srcUrl);
    const iw = Math.max(1, img.naturalWidth || 256);
    const ih = Math.max(1, img.naturalHeight || 256);
    const maxW = compose.canvasW * 0.72;
    const maxH = compose.canvasH * 0.72;
    const fitScale = Math.min(1, maxW / iw, maxH / ih);
    const scale = Math.max(0.08, Math.round(fitScale * 100) / 100);

    const layer = {
        id: `layer_${Date.now()}_${compose.nextSeq++}`,
        name: name || `${studioT("导入图层")} ${compose.layers.length + 1}`,
        isBase: false,
        img,
        srcUrl,
        origImg: img,
        origUrl: srcUrl,
        rmbgApplied: false,
        w: iw,
        h: ih,
        x: compose.canvasW / 2,
        y: compose.canvasH / 2,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        flipH: false,
        flipV: false,
        opacity: 1,
        blendMode: "source-over",
        visible: true,
    };
    compose.layers.push(layer);
    compose.selectedId = layer.id;
    return layer;
}

export async function importFilesToCompose(compose, fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
    if (files.length === 0) return 0;
    let added = 0;
    for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const cleanName = (file.name || studioT("外部图像")).replace(/\.[^.]+$/, "");
        await addComposeLayerFromUrl(compose, dataUrl, cleanName);
        added++;
    }
    return added;
}

export function renderComposeToDataUrl(compose) {
    const w = Math.max(16, Math.round(compose.canvasW || 512));
    const h = Math.max(16, Math.round(compose.canvasH || 512));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (compose.bgMode === "solid") {
        ctx.fillStyle = compose.bgColor || "#000000";
        ctx.fillRect(0, 0, w, h);
    }

    for (const layer of compose.layers) {
        if (!layer.visible || !layer.img) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
        ctx.globalCompositeOperation = layer.blendMode || "source-over";
        ctx.translate(layer.x, layer.y);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.scale(
            (layer.flipH ? -1 : 1) * layer.scaleX,
            (layer.flipV ? -1 : 1) * layer.scaleY
        );
        ctx.drawImage(layer.img, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
        ctx.restore();
    }

    return {
        image: off.toDataURL("image/png"),
        width: w,
        height: h,
    };
}

// ============================================================
// Gallery Picker Mini-Modal (import from ComfyUI input/ folder)
// ============================================================
async function openInputGalleryPicker(winEl, onPickUrl) {
    const t = studioT;
    const backdrop = document.createElement("div");
    backdrop.className = "mls-picker-backdrop";

    const box = document.createElement("div");
    box.className = "mls-picker-box";
    box.innerHTML = `
        <div class="mls-picker-head">
            <span style="font-weight:600;color:#f4f4f5;">${escapeHtml(t("🖼️ 从 ComfyUI 图库 (input/) 插入图层"))}</span>
            <button class="ma-modal-close" type="button">✕</button>
        </div>
        <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <input type="text" class="mls-input" style="width:100%;" placeholder="${escapeHtml(t("🔍 搜索图片文件名..."))}" />
        </div>
        <div class="mls-picker-grid"><div class="mls-muted" style="grid-column:1/-1;text-align:center;padding:24px;">${escapeHtml(t("正在加载图库..."))}</div></div>
    `;

    backdrop.appendChild(box);
    winEl.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.onclick = (e) => {
        if (e.target === backdrop) close();
    };
    box.querySelector(".ma-modal-close").onclick = close;

    const searchInp = box.querySelector("input");
    const grid = box.querySelector(".mls-picker-grid");
    let files = [];

    const render = () => {
        const q = searchInp.value.trim().toLowerCase();
        const list = files.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 120);
        grid.innerHTML = "";
        if (list.length === 0) {
            grid.innerHTML = `<div class="mls-muted" style="grid-column:1/-1;text-align:center;padding:24px;">${escapeHtml(t("没有找到图片"))}</div>`;
            return;
        }
        for (const fname of list) {
            const card = document.createElement("div");
            card.className = "mls-picker-card";
            const url = api.apiURL(`/view?filename=${encodeURIComponent(fname)}&type=input`);
            card.innerHTML = `<img loading="lazy" src="${url}" alt="" /><div title="${escapeHtml(fname)}">${escapeHtml(fname)}</div>`;
            card.onclick = () => {
                onPickUrl(url, fname.replace(/\.[^.]+$/, ""));
                close();
            };
            grid.appendChild(card);
        }
    };

    searchInp.oninput = render;
    try {
        const resp = await api.fetchApi("/ma/get_file_list");
        const data = await resp.json();
        files = data.files || [];
        render();
    } catch {
        grid.innerHTML = `<div class="mls-muted" style="grid-column:1/-1;text-align:center;padding:24px;">${escapeHtml(t("加载图库列表失败"))}</div>`;
    }
}

// ============================================================
// Left Sidebar for Image Composition
// ============================================================
export function renderComposeSidebar(ctxObj) {
    const t = studioT;
    const {
        win,
        leftScroll,
        state,
        ensureRmbgInfo,
        renderLeftContent,
        renderRightStage,
        ensureEditorStageView,
        setSyncInputs,
    } = ctxObj;

    const comp = state.compose;
    const selectedLayer = comp.layers.find((l) => l.id === comp.selectedId) || null;
    const displayLayerName = (l) => (l.isBase && (l.name === "底图" || l.name === "Base") ? t("底图") : l.name);

    // 1. Import & Layer Stack Panel
    const stackPanel = document.createElement("div");
    stackPanel.className = "mls-panel";
    stackPanel.innerHTML = `
        <div class="mls-panel-head">
            <span class="mls-panel-title">${escapeHtml(t("图层管理"))} (${comp.layers.length})</span>
            <span class="mls-panel-sub">${escapeHtml(t("支持直接拖入 / Ctrl+V"))}</span>
        </div>
    `;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    fileInput.onchange = async () => {
        if (!fileInput.files?.length) return;
        try {
            await importFilesToCompose(comp, fileInput.files);
            fileInput.value = "";
            renderLeftContent();
            ensureEditorStageView();
        } catch (err) {
            state.errorMsg = t("导入图像失败: ") + (err?.message || err);
            renderLeftContent();
        }
    };
    stackPanel.appendChild(fileInput);

    const toolbar = document.createElement("div");
    toolbar.className = "mls-layer-toolbar";

    const importFileBtn = document.createElement("button");
    importFileBtn.className = "mls-chip active";
    importFileBtn.textContent = t("📁 导入外部图像");
    importFileBtn.title = t("从电脑文件夹选择一张或多张图片作为新图层导入");
    importFileBtn.onclick = () => fileInput.click();

    const importGalleryBtn = document.createElement("button");
    importGalleryBtn.className = "mls-chip";
    importGalleryBtn.textContent = t("🖼️ 从图库选图");
    importGalleryBtn.title = t("从 ComfyUI input 图库中挑选图片插入为新图层");
    importGalleryBtn.onclick = () => {
        openInputGalleryPicker(win, async (url, name) => {
            try {
                await addComposeLayerFromUrl(comp, url, name);
                renderLeftContent();
                ensureEditorStageView();
            } catch (err) {
                state.errorMsg = t("从图库导入失败: ") + (err?.message || err);
                renderLeftContent();
            }
        });
    };

    toolbar.appendChild(importFileBtn);
    toolbar.appendChild(importGalleryBtn);
    stackPanel.appendChild(toolbar);

    const listEl = document.createElement("div");
    listEl.className = "mls-layer-list";

    for (let i = comp.layers.length - 1; i >= 0; i--) {
        const layer = comp.layers[i];
        const isTop = i === comp.layers.length - 1;
        const isBottom = i === 0;
        const isSel = layer.id === comp.selectedId;
        const lName = displayLayerName(layer);

        const item = document.createElement("div");
        item.className = `mls-layer-item ${isSel ? "active" : ""} ${layer.visible ? "" : "hidden-layer"}`;
        item.onclick = () => {
            comp.selectedId = layer.id;
            renderLeftContent();
            ensureEditorStageView();
        };

        const thumb = document.createElement("div");
        thumb.className = "mls-layer-thumb";
        thumb.innerHTML = `<img src="${layer.srcUrl}" alt="" />`;

        const meta = document.createElement("div");
        meta.className = "mls-layer-meta";
        meta.innerHTML = `
            <div class="mls-layer-name" title="${escapeHtml(lName)}">${escapeHtml(lName)}</div>
            <div class="mls-layer-sub">
                ${layer.isBase ? `<span class="mls-layer-badge">${escapeHtml(t("底图"))}</span>` : ""}
                ${layer.rmbgApplied ? `<span class="mls-layer-badge">${escapeHtml(t("已抠图"))}</span>` : ""}
                <span>${layer.w}×${layer.h}</span>
            </div>
        `;

        const actions = document.createElement("div");
        actions.className = "mls-layer-actions";

        const eyeBtn = document.createElement("button");
        eyeBtn.className = "mls-icon-btn";
        eyeBtn.title = layer.visible ? t("隐藏图层") : t("显示图层");
        eyeBtn.textContent = layer.visible ? "👁️" : "🙈";
        eyeBtn.onclick = (e) => {
            e.stopPropagation();
            layer.visible = !layer.visible;
            renderLeftContent();
            ensureEditorStageView();
        };

        const upBtn = document.createElement("button");
        upBtn.className = "mls-icon-btn";
        upBtn.title = t("上移一层");
        upBtn.textContent = "↑";
        upBtn.disabled = isTop;
        upBtn.onclick = (e) => {
            e.stopPropagation();
            if (i < comp.layers.length - 1) {
                [comp.layers[i], comp.layers[i + 1]] = [comp.layers[i + 1], comp.layers[i]];
                renderLeftContent();
                ensureEditorStageView();
            }
        };

        const downBtn = document.createElement("button");
        downBtn.className = "mls-icon-btn";
        downBtn.title = t("下移一层");
        downBtn.textContent = "↓";
        downBtn.disabled = isBottom;
        downBtn.onclick = (e) => {
            e.stopPropagation();
            if (i > 0) {
                [comp.layers[i], comp.layers[i - 1]] = [comp.layers[i - 1], comp.layers[i]];
                renderLeftContent();
                ensureEditorStageView();
            }
        };

        const dupBtn = document.createElement("button");
        dupBtn.className = "mls-icon-btn";
        dupBtn.title = t("复制此图层");
        dupBtn.textContent = "⧉";
        dupBtn.onclick = (e) => {
            e.stopPropagation();
            const copy = {
                ...layer,
                id: `layer_${Date.now()}_${comp.nextSeq++}`,
                name: `${lName} ${t("副本")}`,
                isBase: false,
                x: layer.x + 24,
                y: layer.y + 24,
            };
            comp.layers.splice(i + 1, 0, copy);
            comp.selectedId = copy.id;
            renderLeftContent();
            ensureEditorStageView();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "mls-icon-btn danger";
        delBtn.title = comp.layers.length <= 1 ? t("至少保留一个图层") : t("删除图层");
        delBtn.textContent = "✕";
        delBtn.disabled = comp.layers.length <= 1;
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (comp.layers.length <= 1) return;
            comp.layers.splice(i, 1);
            if (comp.selectedId === layer.id) {
                comp.selectedId = comp.layers[Math.min(i, comp.layers.length - 1)]?.id || null;
            }
            renderLeftContent();
            ensureEditorStageView();
        };

        actions.appendChild(eyeBtn);
        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(dupBtn);
        actions.appendChild(delBtn);

        item.appendChild(thumb);
        item.appendChild(meta);
        item.appendChild(actions);
        listEl.appendChild(item);
    }

    stackPanel.appendChild(listEl);
    leftScroll.appendChild(stackPanel);

    // 2. Selected Layer Properties + One-Click RMBG Cutout
    let syncLayerInputs = null;
    if (selectedLayer) {
        const selName = displayLayerName(selectedLayer);
        const propPanel = document.createElement("div");
        propPanel.className = "mls-panel";
        propPanel.innerHTML = `
            <div class="mls-panel-head">
                <span class="mls-panel-title">${escapeHtml(t("选中图层："))}${escapeHtml(selName)}</span>
                <span class="mls-panel-sub">${Math.round(selectedLayer.w * selectedLayer.scaleX)}×${Math.round(selectedLayer.h * selectedLayer.scaleY)}</span>
            </div>
        `;

        const cutoutRow = document.createElement("div");
        cutoutRow.className = "mls-row";

        const rmbgBtn = document.createElement("button");
        rmbgBtn.className = "mls-rmbg-layer-btn";
        rmbgBtn.style.flex = "1 1 0%";
        const isBusy = comp.busyLayerId === selectedLayer.id;
        rmbgBtn.disabled = isBusy || state.isRunning;
        rmbgBtn.textContent = isBusy ? t("⏳ 正在抠图 (RMBG)...") : t("✨ 一键抠图 (RMBG 去背景)");
        rmbgBtn.onclick = async () => {
            if (!state.rmbg.loaded) await ensureRmbgInfo();
            if (!state.rmbg.installed) {
                state.errorMsg = t("未检测到去除背景节点 (RMBG)，请先通过 ComfyUI Manager 安装 ComfyUI-RMBG 并重启 ComfyUI！");
                renderLeftContent();
                renderRightStage();
                return;
            }
            comp.busyLayerId = selectedLayer.id;
            state.errorMsg = "";
            renderLeftContent();
            try {
                const layerDataUrl = imageElementToDataUrl(selectedLayer.origImg || selectedLayer.img);
                const params = {
                    ...(state.rmbg.values || {}),
                    model: comp.rmbgModel || state.rmbg.values?.model || "RMBG-2.0",
                    background: "Alpha",
                };
                const resp = await api.fetchApi("/ma/local_studio/rmbg_run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        image_data_url: layerDataUrl,
                        params,
                        output_type: "image",
                    }),
                });
                const data = await resp.json();
                if (data.status !== "success") throw new Error(data.message || t("RMBG 执行失败"));
                const cutImg = await loadImg(data.image);
                selectedLayer.img = cutImg;
                selectedLayer.srcUrl = data.image;
                selectedLayer.rmbgApplied = true;
            } catch (err) {
                state.errorMsg = t("图层抠图失败: ") + (err?.message || err);
            } finally {
                comp.busyLayerId = null;
                renderLeftContent();
                ensureEditorStageView();
            }
        };
        cutoutRow.appendChild(rmbgBtn);

        if (selectedLayer.rmbgApplied && selectedLayer.origImg) {
            const restoreBtn = document.createElement("button");
            restoreBtn.className = "mls-chip";
            restoreBtn.title = t("还原该图层抠图前的原始图像");
            restoreBtn.textContent = t("↩ 还原");
            restoreBtn.onclick = () => {
                selectedLayer.img = selectedLayer.origImg;
                selectedLayer.srcUrl = selectedLayer.origUrl;
                selectedLayer.rmbgApplied = false;
                renderLeftContent();
                ensureEditorStageView();
            };
            cutoutRow.appendChild(restoreBtn);
        }
        propPanel.appendChild(cutoutRow);

        const quickRow = document.createElement("div");
        quickRow.className = "mls-chip-row";
        [
            {
                t: t("居中"),
                fn: () => {
                    selectedLayer.x = comp.canvasW / 2;
                    selectedLayer.y = comp.canvasH / 2;
                },
            },
            {
                t: t("铺满画布"),
                fn: () => {
                    const s = Math.max(comp.canvasW / selectedLayer.w, comp.canvasH / selectedLayer.h);
                    selectedLayer.scaleX = s;
                    selectedLayer.scaleY = s;
                    selectedLayer.x = comp.canvasW / 2;
                    selectedLayer.y = comp.canvasH / 2;
                },
            },
            {
                t: t("适应画布"),
                fn: () => {
                    const s = Math.min(comp.canvasW / selectedLayer.w, comp.canvasH / selectedLayer.h);
                    selectedLayer.scaleX = s;
                    selectedLayer.scaleY = s;
                    selectedLayer.x = comp.canvasW / 2;
                    selectedLayer.y = comp.canvasH / 2;
                },
            },
            {
                t: "100%",
                fn: () => {
                    selectedLayer.scaleX = 1;
                    selectedLayer.scaleY = 1;
                },
            },
            {
                t: t("⇄ 水平翻"),
                fn: () => {
                    selectedLayer.flipH = !selectedLayer.flipH;
                },
            },
            {
                t: t("⇅ 垂直翻"),
                fn: () => {
                    selectedLayer.flipV = !selectedLayer.flipV;
                },
            },
        ].forEach((act) => {
            const b = document.createElement("button");
            b.className = "mls-chip";
            b.textContent = act.t;
            b.onclick = () => {
                act.fn();
                renderLeftContent();
                ensureEditorStageView();
            };
            quickRow.appendChild(b);
        });
        propPanel.appendChild(quickRow);

        const scaleRow = document.createElement("div");
        scaleRow.className = "mls-param-row";
        scaleRow.innerHTML = `<span class="mls-param-name">${escapeHtml(t("缩放比例"))}</span>`;
        const scaleCtrl = document.createElement("div");
        scaleCtrl.className = "mls-param-ctrl";
        const scaleSlider = document.createElement("input");
        scaleSlider.type = "range";
        scaleSlider.min = "5";
        scaleSlider.max = "400";
        scaleSlider.step = "1";
        scaleSlider.value = String(Math.round(selectedLayer.scaleX * 100));
        const scaleNum = document.createElement("input");
        scaleNum.type = "number";
        scaleNum.className = "mls-input mls-input-num";
        scaleNum.style.width = "64px";
        scaleNum.min = "5";
        scaleNum.max = "500";
        scaleNum.value = String(Math.round(selectedLayer.scaleX * 100));
        const setScalePct = (pct) => {
            const ratio = selectedLayer.scaleY / Math.max(0.001, selectedLayer.scaleX);
            const sx = Math.max(0.05, Math.min(5, pct / 100));
            selectedLayer.scaleX = sx;
            selectedLayer.scaleY = Math.max(0.05, Math.min(5, sx * ratio));
            scaleSlider.value = String(Math.round(sx * 100));
            scaleNum.value = String(Math.round(sx * 100));
            ensureEditorStageView();
        };
        scaleSlider.oninput = () => setScalePct(parseFloat(scaleSlider.value) || 100);
        scaleNum.onchange = () => setScalePct(parseFloat(scaleNum.value) || 100);
        scaleCtrl.appendChild(scaleSlider);
        scaleCtrl.appendChild(scaleNum);
        scaleCtrl.insertAdjacentHTML("beforeend", `<span class="mls-muted">%</span>`);
        scaleRow.appendChild(scaleCtrl);
        propPanel.appendChild(scaleRow);

        const rotRow = document.createElement("div");
        rotRow.className = "mls-param-row";
        rotRow.innerHTML = `<span class="mls-param-name">${escapeHtml(t("旋转角度"))}</span>`;
        const rotCtrl = document.createElement("div");
        rotCtrl.className = "mls-param-ctrl";
        const rotSlider = document.createElement("input");
        rotSlider.type = "range";
        rotSlider.min = "-180";
        rotSlider.max = "180";
        rotSlider.step = "1";
        rotSlider.value = String(Math.round(selectedLayer.rotation));
        const rotNum = document.createElement("input");
        rotNum.type = "number";
        rotNum.className = "mls-input mls-input-num";
        rotNum.style.width = "64px";
        rotNum.min = "-180";
        rotNum.max = "180";
        rotNum.step = "0.5";
        rotNum.value = String(Math.round(selectedLayer.rotation * 10) / 10);
        const setRot = (deg) => {
            selectedLayer.rotation = Math.max(-180, Math.min(180, deg));
            rotSlider.value = String(Math.round(selectedLayer.rotation));
            rotNum.value = String(Math.round(selectedLayer.rotation * 10) / 10);
            ensureEditorStageView();
        };
        rotSlider.oninput = () => setRot(parseFloat(rotSlider.value) || 0);
        rotNum.onchange = () => setRot(parseFloat(rotNum.value) || 0);
        rotCtrl.appendChild(rotSlider);
        rotCtrl.appendChild(rotNum);
        rotCtrl.insertAdjacentHTML("beforeend", `<span class="mls-muted">°</span>`);
        rotRow.appendChild(rotCtrl);
        propPanel.appendChild(rotRow);

        const opRow = document.createElement("div");
        opRow.className = "mls-param-row";
        opRow.innerHTML = `<span class="mls-param-name">${escapeHtml(t("不透明度"))}</span>`;
        const opCtrl = document.createElement("div");
        opCtrl.className = "mls-param-ctrl";
        const opSlider = document.createElement("input");
        opSlider.type = "range";
        opSlider.min = "0";
        opSlider.max = "100";
        opSlider.step = "1";
        opSlider.value = String(Math.round(selectedLayer.opacity * 100));
        const opNum = document.createElement("input");
        opNum.type = "number";
        opNum.className = "mls-input mls-input-num";
        opNum.style.width = "64px";
        opNum.min = "0";
        opNum.max = "100";
        opNum.value = String(Math.round(selectedLayer.opacity * 100));
        const setOp = (pct) => {
            const p = Math.max(0, Math.min(100, pct));
            selectedLayer.opacity = p / 100;
            opSlider.value = String(Math.round(p));
            opNum.value = String(Math.round(p));
            ensureEditorStageView();
        };
        opSlider.oninput = () => setOp(parseFloat(opSlider.value) || 0);
        opNum.onchange = () => setOp(parseFloat(opNum.value) || 0);
        opCtrl.appendChild(opSlider);
        opCtrl.appendChild(opNum);
        opCtrl.insertAdjacentHTML("beforeend", `<span class="mls-muted">%</span>`);
        opRow.appendChild(opCtrl);
        propPanel.appendChild(opRow);

        const blendRow = document.createElement("div");
        blendRow.className = "mls-param-row";
        blendRow.innerHTML = `<span class="mls-param-name">${escapeHtml(t("混合模式"))}</span>`;
        const blendCtrl = document.createElement("div");
        blendCtrl.className = "mls-param-ctrl";
        const blendSel = document.createElement("select");
        blendSel.className = "mls-select mls-input-wide";
        for (const bm of BLEND_MODES) {
            const opt = document.createElement("option");
            opt.value = bm.id;
            opt.textContent = t(bm.labelKey);
            blendSel.appendChild(opt);
        }
        blendSel.value = selectedLayer.blendMode || "source-over";
        blendSel.onchange = () => {
            selectedLayer.blendMode = blendSel.value;
            ensureEditorStageView();
        };
        blendCtrl.appendChild(blendSel);
        blendRow.appendChild(blendCtrl);
        propPanel.appendChild(blendRow);

        leftScroll.appendChild(propPanel);

        syncLayerInputs = () => {
            scaleSlider.value = String(Math.round(selectedLayer.scaleX * 100));
            scaleNum.value = String(Math.round(selectedLayer.scaleX * 100));
            rotSlider.value = String(Math.round(selectedLayer.rotation));
            rotNum.value = String(Math.round(selectedLayer.rotation * 10) / 10);
        };
    }

    // 3. Canvas Size & Background Panel
    const canvasPanel = document.createElement("div");
    canvasPanel.className = "mls-panel";
    canvasPanel.innerHTML = `<div class="mls-panel-head"><span class="mls-panel-title">${escapeHtml(t("画布尺寸与底色"))}</span><span class="mls-panel-sub">${comp.canvasW}×${comp.canvasH}</span></div>`;

    const whRow = document.createElement("div");
    whRow.className = "mls-row";
    const cwInp = document.createElement("input");
    cwInp.type = "number";
    cwInp.className = "mls-input mls-input-num";
    cwInp.min = "64";
    cwInp.max = "8192";
    cwInp.step = "16";
    cwInp.value = String(comp.canvasW);
    cwInp.onchange = () => {
        comp.canvasW = Math.max(64, Math.min(8192, parseInt(cwInp.value, 10) || comp.canvasW));
        renderLeftContent();
        ensureEditorStageView();
    };
    const chInp = document.createElement("input");
    chInp.type = "number";
    chInp.className = "mls-input mls-input-num";
    chInp.min = "64";
    chInp.max = "8192";
    chInp.step = "16";
    chInp.value = String(comp.canvasH);
    chInp.onchange = () => {
        comp.canvasH = Math.max(64, Math.min(8192, parseInt(chInp.value, 10) || comp.canvasH));
        renderLeftContent();
        ensureEditorStageView();
    };
    const fitBaseBtn = document.createElement("button");
    fitBaseBtn.className = "mls-chip";
    fitBaseBtn.textContent = t("匹配底图");
    fitBaseBtn.onclick = () => {
        comp.canvasW = state.srcW;
        comp.canvasH = state.srcH;
        renderLeftContent();
        ensureEditorStageView();
    };
    whRow.appendChild(cwInp);
    whRow.insertAdjacentHTML("beforeend", `<span class="mls-muted">×</span>`);
    whRow.appendChild(chInp);
    whRow.appendChild(fitBaseBtn);
    canvasPanel.appendChild(whRow);

    const bgRow = document.createElement("div");
    bgRow.className = "mls-row";
    const bgSel = document.createElement("select");
    bgSel.className = "mls-select mls-input-wide";
    bgSel.innerHTML = `<option value="transparent">${escapeHtml(t("透明画布背景"))}</option><option value="solid">${escapeHtml(t("纯色画布背景"))}</option>`;
    bgSel.value = comp.bgMode;
    bgSel.onchange = () => {
        comp.bgMode = bgSel.value;
        renderLeftContent();
        ensureEditorStageView();
    };
    bgRow.appendChild(bgSel);
    if (comp.bgMode === "solid") {
        const bgColor = document.createElement("input");
        bgColor.type = "color";
        bgColor.className = "mls-color-swatch";
        bgColor.value = comp.bgColor;
        bgColor.oninput = () => {
            comp.bgColor = bgColor.value;
            ensureEditorStageView();
        };
        bgRow.appendChild(bgColor);
    }
    canvasPanel.appendChild(bgRow);
    leftScroll.appendChild(canvasPanel);

    setSyncInputs(syncLayerInputs);
}

// ============================================================
// Interactive Right Stage for Multi-Layer Composition
// ============================================================
export function mountComposeStage(ctxObj) {
    const t = studioT;
    const {
        stageViewport,
        state,
        renderLeftContent,
        setRedraw,
        getSyncInputs,
    } = ctxObj;

    const comp = state.compose;
    const wrap = document.createElement("div");
    wrap.className = "mls-interactive-canvas-wrap";

    const canvas = document.createElement("canvas");
    canvas.className = "mls-interactive-canvas";
    wrap.appendChild(canvas);

    const hud = document.createElement("div");
    hud.className = "mls-stage-hud";
    wrap.appendChild(hud);
    stageViewport.appendChild(wrap);

    let activeAction = null;
    let hoverAction = null;
    let dragStart = null;
    let snapGuides = { vx: false, hy: false };

    const updateHud = () => {
        const sel = comp.layers.find((l) => l.id === comp.selectedId);
        const selName = sel ? (sel.isBase && (sel.name === "底图" || sel.name === "Base") ? t("底图") : sel.name) : "";
        const selInfo = sel
            ? `${escapeHtml(t("已选"))} <b>${escapeHtml(selName)}</b> (${Math.round(sel.scaleX * 100)}% · ${sel.rotation.toFixed(1)}°)`
            : escapeHtml(t("点击画布选择图层"));
        hud.innerHTML = `
            <span>${escapeHtml(t("画布"))} <b>${comp.canvasW}×${comp.canvasH}</b> · ${comp.layers.length} ${escapeHtml(t("个图层"))}</span>
            <span class="mls-hud-legend">
                <span>${selInfo}</span>
                <span>${escapeHtml(t("可直接拖入外部图片"))}</span>
            </span>
        `;
    };

    const getMetrics = () => {
        const rect = wrap.getBoundingClientRect();
        const cw = Math.max(260, Math.floor(rect.width));
        const ch = Math.max(220, Math.floor(rect.height));
        const padX = 56;
        const padTop = 58;
        const padBottom = 68;
        const availW = Math.max(80, cw - padX * 2);
        const availH = Math.max(80, ch - padTop - padBottom);
        const scale = Math.min(availW / Math.max(1, comp.canvasW), availH / Math.max(1, comp.canvasH));
        const ox = (cw - comp.canvasW * scale) / 2;
        const oy = padTop + (availH - comp.canvasH * scale) / 2;
        const toScreen = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });
        const toCanvas = (sx, sy) => ({ x: (sx - ox) / scale, y: (sy - oy) / scale });
        return { cw, ch, scale, ox, oy, toScreen, toCanvas };
    };

    const layerLocalToScreen = (L, layer, lx, ly) => {
        const rad = (layer.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const sx = lx * layer.scaleX;
        const sy = ly * layer.scaleY;
        const wx = layer.x + sx * cos - sy * sin;
        const wy = layer.y + sx * sin + sy * cos;
        return L.toScreen(wx, wy);
    };

    const worldToLayerLocal = (layer, wx, wy) => {
        const dx = wx - layer.x;
        const dy = wy - layer.y;
        const rad = (-layer.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        return {
            x: rx / Math.max(0.001, layer.scaleX),
            y: ry / Math.max(0.001, layer.scaleY),
        };
    };

    const getLayerControlPoints = (L, layer) => {
        const hw = layer.w / 2;
        const hh = layer.h / 2;
        const nw = layerLocalToScreen(L, layer, -hw, -hh);
        const ne = layerLocalToScreen(L, layer, hw, -hh);
        const se = layerLocalToScreen(L, layer, hw, hh);
        const sw = layerLocalToScreen(L, layer, -hw, hh);
        const n = layerLocalToScreen(L, layer, 0, -hh);
        const s = layerLocalToScreen(L, layer, 0, hh);
        const w = layerLocalToScreen(L, layer, -hw, 0);
        const e = layerLocalToScreen(L, layer, hw, 0);
        const center = L.toScreen(layer.x, layer.y);

        const rad = (layer.rotation * Math.PI) / 180;
        const rotX = n.x + Math.sin(rad) * 28;
        const rotY = n.y - Math.cos(rad) * 28;
        return { nw, ne, se, sw, n, s, w, e, center, rot: { x: rotX, y: rotY } };
    };

    const draw = () => {
        const L = getMetrics();
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(L.cw * dpr) || canvas.height !== Math.round(L.ch * dpr)) {
            canvas.width = Math.round(L.cw * dpr);
            canvas.height = Math.round(L.ch * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, L.cw, L.ch);

        const boxW = comp.canvasW * L.scale;
        const boxH = comp.canvasH * L.scale;

        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
        ctx.shadowBlur = 28;
        ctx.fillStyle = "#101018";
        ctx.fillRect(L.ox, L.oy, boxW, boxH);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(L.ox, L.oy, boxW, boxH);
        ctx.clip();

        if (comp.bgMode === "solid") {
            ctx.fillStyle = comp.bgColor || "#000000";
            ctx.fillRect(L.ox, L.oy, boxW, boxH);
        } else {
            const tile = 14;
            ctx.fillStyle = "#12121b";
            ctx.fillRect(L.ox, L.oy, boxW, boxH);
            ctx.fillStyle = "#1a1a26";
            for (let y = 0; y < boxH; y += tile) {
                for (let x = 0; x < boxW; x += tile) {
                    if (((Math.floor(x / tile) + Math.floor(y / tile)) & 1) === 0) {
                        ctx.fillRect(L.ox + x, L.oy + y, tile, tile);
                    }
                }
            }
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        for (const layer of comp.layers) {
            if (!layer.visible || !layer.img) continue;
            const cPos = L.toScreen(layer.x, layer.y);
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
            ctx.globalCompositeOperation = layer.blendMode || "source-over";
            ctx.translate(cPos.x, cPos.y);
            ctx.rotate((layer.rotation * Math.PI) / 180);
            ctx.scale(
                (layer.flipH ? -1 : 1) * layer.scaleX * L.scale,
                (layer.flipV ? -1 : 1) * layer.scaleY * L.scale
            );
            ctx.drawImage(layer.img, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
            ctx.restore();
        }

        if (snapGuides.vx || snapGuides.hy) {
            ctx.save();
            ctx.strokeStyle = "rgba(192, 132, 252, 0.8)";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 4]);
            if (snapGuides.vx) {
                ctx.beginPath();
                ctx.moveTo(L.ox + boxW / 2, L.oy);
                ctx.lineTo(L.ox + boxW / 2, L.oy + boxH);
                ctx.stroke();
            }
            if (snapGuides.hy) {
                ctx.beginPath();
                ctx.moveTo(L.ox, L.oy + boxH / 2);
                ctx.lineTo(L.ox + boxW, L.oy + boxH / 2);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
        ctx.lineWidth = 1;
        ctx.strokeRect(L.ox + 0.5, L.oy + 0.5, boxW - 1, boxH - 1);
        ctx.restore();

        const sel = comp.layers.find((l) => l.id === comp.selectedId);
        if (sel && sel.visible) {
            const pts = getLayerControlPoints(L, sel);
            ctx.save();

            ctx.strokeStyle = "#a5b4fc";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(pts.nw.x, pts.nw.y);
            ctx.lineTo(pts.ne.x, pts.ne.y);
            ctx.lineTo(pts.se.x, pts.se.y);
            ctx.lineTo(pts.sw.x, pts.sw.y);
            ctx.closePath();
            ctx.stroke();

            ctx.strokeStyle = "rgba(165, 180, 252, 0.7)";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(pts.n.x, pts.n.y);
            ctx.lineTo(pts.rot.x, pts.rot.y);
            ctx.stroke();

            const rotHot = activeAction === "rotate" || hoverAction === "rotate";
            ctx.save();
            if (rotHot) {
                ctx.shadowColor = "rgba(129, 140, 248, 0.85)";
                ctx.shadowBlur = 12;
            }
            const rGrad = ctx.createLinearGradient(pts.rot.x - 10, pts.rot.y - 10, pts.rot.x + 10, pts.rot.y + 10);
            rGrad.addColorStop(0, "#6366f1");
            rGrad.addColorStop(1, "#a855f7");
            ctx.fillStyle = rGrad;
            ctx.beginPath();
            ctx.arc(pts.rot.x, pts.rot.y, rotHot ? 11.5 : 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↻", pts.rot.x, pts.rot.y + 0.5);
            ctx.restore();

            for (const [id, pt] of [
                ["scale-nw", pts.nw],
                ["scale-ne", pts.ne],
                ["scale-se", pts.se],
                ["scale-sw", pts.sw],
            ]) {
                const hot = activeAction === id || hoverAction === id;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, hot ? 6.5 : 5, 0, Math.PI * 2);
                ctx.fillStyle = hot ? "#c084fc" : "#ffffff";
                ctx.fill();
                ctx.strokeStyle = "#1e1b4b";
                ctx.lineWidth = 1.6;
                ctx.stroke();
            }

            for (const [id, pt] of [
                ["scale-n", pts.n],
                ["scale-s", pts.s],
                ["scale-w", pts.w],
                ["scale-e", pts.e],
            ]) {
                const hot = activeAction === id || hoverAction === id;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, hot ? 5 : 3.8, 0, Math.PI * 2);
                ctx.fillStyle = hot ? "#818cf8" : "#e0e7ff";
                ctx.fill();
                ctx.strokeStyle = "#1e1b4b";
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            ctx.restore();
        }

        updateHud();
    };

    setRedraw(draw);

    const hitTestSelectedHandles = (L, mx, my) => {
        const sel = comp.layers.find((l) => l.id === comp.selectedId);
        if (!sel || !sel.visible) return null;
        const pts = getLayerControlPoints(L, sel);
        const near = (p, r = 12) => Math.hypot(mx - p.x, my - p.y) <= r;
        if (near(pts.rot, 14)) return "rotate";
        if (near(pts.nw, 12)) return "scale-nw";
        if (near(pts.ne, 12)) return "scale-ne";
        if (near(pts.se, 12)) return "scale-se";
        if (near(pts.sw, 12)) return "scale-sw";
        if (near(pts.n, 10)) return "scale-n";
        if (near(pts.s, 10)) return "scale-s";
        if (near(pts.w, 10)) return "scale-w";
        if (near(pts.e, 10)) return "scale-e";
        return null;
    };

    const hitTestLayerBody = (L, mx, my) => {
        const world = L.toCanvas(mx, my);
        for (let i = comp.layers.length - 1; i >= 0; i--) {
            const layer = comp.layers[i];
            if (!layer.visible) continue;
            const loc = worldToLayerLocal(layer, world.x, world.y);
            if (Math.abs(loc.x) <= layer.w / 2 && Math.abs(loc.y) <= layer.h / 2) {
                return layer;
            }
        }
        return null;
    };

    const cursorForAction = (act) => {
        if (!act) return "default";
        if (act === "rotate") return "grab";
        if (act === "move") return "move";
        if (act === "scale-nw" || act === "scale-se") return "nwse-resize";
        if (act === "scale-ne" || act === "scale-sw") return "nesw-resize";
        if (act === "scale-n" || act === "scale-s") return "ns-resize";
        return "ew-resize";
    };

    canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const L = getMetrics();

        let action = hitTestSelectedHandles(L, mx, my);
        let targetLayer = comp.layers.find((l) => l.id === comp.selectedId);

        if (!action) {
            const hitLayer = hitTestLayerBody(L, mx, my);
            if (!hitLayer) return;
            targetLayer = hitLayer;
            if (comp.selectedId !== hitLayer.id) {
                comp.selectedId = hitLayer.id;
                renderLeftContent();
            }
            action = "move";
        }

        const centerScr = L.toScreen(targetLayer.x, targetLayer.y);
        activeAction = action;
        dragStart = {
            mx,
            my,
            scale: L.scale,
            layer: targetLayer,
            x: targetLayer.x,
            y: targetLayer.y,
            scaleX: targetLayer.scaleX,
            scaleY: targetLayer.scaleY,
            rotation: targetLayer.rotation,
            centerScr,
            startDist: Math.max(8, Math.hypot(mx - centerScr.x, my - centerScr.y)),
            startAngle: Math.atan2(my - centerScr.y, mx - centerScr.x),
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        draw();
    });

    canvas.addEventListener("pointermove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const L = getMetrics();

        if (!activeAction) {
            const h = hitTestSelectedHandles(L, mx, my) || (hitTestLayerBody(L, mx, my) ? "move" : null);
            if (h !== hoverAction) {
                hoverAction = h;
                canvas.style.cursor = cursorForAction(h);
                draw();
            }
            return;
        }

        const ds = dragStart;
        const layer = ds.layer;
        snapGuides = { vx: false, hy: false };

        if (activeAction === "move") {
            let nx = ds.x + (mx - ds.mx) / ds.scale;
            let ny = ds.y + (my - ds.my) / ds.scale;
            if (!e.altKey) {
                const snapTol = 8 / ds.scale;
                if (Math.abs(nx - comp.canvasW / 2) <= snapTol) {
                    nx = comp.canvasW / 2;
                    snapGuides.vx = true;
                }
                if (Math.abs(ny - comp.canvasH / 2) <= snapTol) {
                    ny = comp.canvasH / 2;
                    snapGuides.hy = true;
                }
            }
            layer.x = Math.round(nx);
            layer.y = Math.round(ny);
        } else if (activeAction === "rotate") {
            const curAngle = Math.atan2(my - ds.centerScr.y, mx - ds.centerScr.x);
            let deg = ds.rotation + ((curAngle - ds.startAngle) * 180) / Math.PI;
            deg = (((deg + 180) % 360) + 360) % 360 - 180;
            layer.rotation = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
        } else if (activeAction.startsWith("scale-")) {
            if (
                activeAction === "scale-nw" ||
                activeAction === "scale-ne" ||
                activeAction === "scale-se" ||
                activeAction === "scale-sw"
            ) {
                const curDist = Math.max(4, Math.hypot(mx - ds.centerScr.x, my - ds.centerScr.y));
                const factor = curDist / ds.startDist;
                layer.scaleX = Math.max(0.05, Math.min(8, ds.scaleX * factor));
                layer.scaleY = Math.max(0.05, Math.min(8, ds.scaleY * factor));
            } else {
                const world = L.toCanvas(mx, my);
                const dx = world.x - layer.x;
                const dy = world.y - layer.y;
                const rad = (-layer.rotation * Math.PI) / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                if (activeAction === "scale-w" || activeAction === "scale-e") {
                    layer.scaleX = Math.max(0.05, Math.min(8, (Math.abs(rx) * 2) / Math.max(1, layer.w)));
                } else {
                    layer.scaleY = Math.max(0.05, Math.min(8, (Math.abs(ry) * 2) / Math.max(1, layer.h)));
                }
            }
        }

        getSyncInputs()?.();
        draw();
    });

    const endDrag = (e) => {
        if (!activeAction) return;
        activeAction = null;
        snapGuides = { vx: false, hy: false };
        if (e?.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
        }
        draw();
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    requestAnimationFrame(draw);
}
