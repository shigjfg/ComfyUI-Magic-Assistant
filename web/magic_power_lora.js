import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

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

function mplNormalizeLoraName(name) {
    return String(name || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function mplCollectConfiguredLoraNames(node) {
    const names = [];
    const collect = (items) => (items || []).forEach(item => {
        if (item && item.enabled !== false && item.name) names.push(String(item.name));
    });
    collect(node?.loraData?.loras);
    (node?.loraData?.folders || []).forEach(folder => collect(folder?.loras));

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
            loraNamesOptionsCache = Array.isArray(data?.files) ? data.files : [];
            loraNamesCache = new Set(loraNamesOptionsCache.map(mplNormalizeLoraName));
            mplRefreshMissingLoraStates();
            (app?.graph?._nodes || []).forEach(mplSyncModelValidationWidgets);
            mplRefreshOfficialMissingModels();
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
                    };
                    this.layoutSettings = (saved && typeof saved === "object")
                        ? Object.assign({}, defaults, saved)
                        : defaults;
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
                        // ComfyUI's DOM widget layout keeps an optional fixed
                        // width. Clear the stale first-layout width so the
                        // embedded UI always follows the actual node width.
                        if (this._mplDomWidget) {
                            this._mplDomWidget.width = size[0];
                        }
                    }
                };

                this.createDOMInterface();
                // addDOMWidget registers its resize hook after this node's
                // hook. Calling it once here keeps the DOM widget aligned
                // when a saved workflow restores a different node size.
                this._mplSyncDOMLayout?.();
                return r;
            };

            // 🌟 1. 创建 DOM 界面（使用 addDOMWidget，自动跟随节点缩放）
            nodeType.prototype.createDOMInterface = function() {
                if(this.embeddedDiv) return;

                this.embeddedDiv = document.createElement("div");
                this.embeddedDiv.className = "mpl-embedded-container";
                
                // 🛑 核心修复：全域事件拦截 🛑
                // 必须配合 CSS 中的 pointer-events: auto 才能生效
                
                // A. 拦截滚轮 (防止缩放画布)
                this.embeddedDiv.addEventListener("wheel", (e) => { 
                    e.stopPropagation(); 
                    // 如果列表滚到底了，也不要传给画布
                }, { passive: false });

                // B. 拦截点击 (防止移动画布)
                // 注意：pointermove 和 pointerup 不能 stopPropagation，否则会阻止 document 上的滑块拖动监听器
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
                        if (data.type === 'folder') {
                            // 检查索引有效性
                            if (data.fIdx >= 0 && data.fIdx < this.loraData.folders.length) {
                            const srcFolder = this.loraData.folders[data.fIdx];
                                if (data.lIdx >= 0 && data.lIdx < srcFolder.loras.length) {
                                    // 深拷贝避免引用问题
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

                this.embeddedDiv.appendChild(this.listContainer);

                // --- Klein 模式提示 Banner（检测到 Klein 模型但未启用对应模式时显示）---
                this._kleinBannerEl = null;
                this._updateKleinBanner();

                // --- 底部按钮区 ---
                const footer = document.createElement("div");
                footer.className = "mpl-footer";
                
                const createBtn = (txt, cls, cb) => {
                    const b = document.createElement("button");
                    b.textContent = txt; b.className = cls; b.onclick = cb; return b;
                };
                footer.append(
                    createBtn("➕ 添加 Lora", "mpl-btn-add", () => this.showAddLoraModal()),
                    createBtn("⚙️设置", "mpl-btn-icon", () => this.showSettingsModal()),
                    createBtn("📁+", "mpl-btn-icon", () => this.addFolder()),
                    createBtn("📂预设", "mpl-btn-icon", () => this.loadPresetModal())
                );
                this.embeddedDiv.appendChild(footer);

                // 使用 addDOMWidget 将 UI 添加到节点内部，自动跟随节点缩放
                this._mplDomWidget = this.addDOMWidget("mpl_ui", "div", this.embeddedDiv, {
                    serialize: false,
                    hideOnZoom: false,
                });

                this.injectStyles();
                this.renderEmbeddedList();
                this.updateWidget(); 
            };

            nodeType.prototype._mplSyncDOMLayout = function() {
                if (!this.embeddedDiv) return;
                this.embeddedDiv.style.width = "100%";
                this.embeddedDiv.style.maxWidth = "none";
                this.embeddedDiv.style.boxSizing = "border-box";
                if (this._mplDomWidget && this.size?.[0]) {
                    this._mplDomWidget.width = this.size[0];
                }
                // The frontend positions DOM widgets from node.size during
                // the resize callback; saved workflows do not always invoke
                // that callback after configure().
                if (this._mplDomWidget?.options?.afterResize) {
                    this._mplDomWidget.options.afterResize.call(this._mplDomWidget, this);
                }
                this.onResize?.(this.size);
                this.setDirtyCanvas?.(true, true);
            };

            // 🌟 2. 使用 addDOMWidget 后，不需要手动计算位置和大小，UI会自动跟随节点缩放

            // 🌟 3. 注入 CSS (修复的重点)
            nodeType.prototype.injectStyles = function() {
                if(document.getElementById("mpl-styles")) return;
                const s = document.createElement("style");
                s.id = "mpl-styles";
                s.innerHTML = `
                    /* 🛑 关键修改：pointer-events 必须为 auto，否则鼠标事件会直接穿透到底下的画布 */
                    .mpl-embedded-container { 
                        display: flex; 
                        flex-direction: column; 
                        background: #2a2a2a; 
                        border-radius: 0 0 8px 8px; 
                        border: 1px solid #444; 
                        border-top: 1px solid #555; 
                        pointer-events: auto;  /* 👈 改这里：之前是 none，导致无法拦截事件 */
                        overflow: hidden; 
                        box-sizing: border-box; 
                        font-family: sans-serif; 
                        font-size: 12px; 
                        width: 100%;
                        min-height: 200px;
                    }
                    .mpl-list-scroll { flex: 1; overflow-y: auto; padding: 5px; background: #222; pointer-events: auto; }
                    .mpl-footer { height: 36px; background: #2e2e2e; border-top: 1px solid #333; display: flex; align-items: center; padding: 0 5px; gap: 5px; pointer-events: auto; }
                    .mpl-folder-row { background: #383838; margin-bottom: 4px; border-radius: 4px; overflow: hidden; border: 1px solid #444; }
                    .mpl-folder-row.drag-over { border: 2px dashed #2196F3; }
                    .mpl-folder-header { 
                        padding: 4px 6px; 
                        color: #eee; 
                        cursor: pointer; 
                        display: flex; 
                        align-items: center; 
                        font-weight: bold; 
                        background: #404040; 
                        font-size: 13px;
                        min-height: 28px;
                    }
                    .mpl-folder-title { margin-left: 5px; border-bottom: 1px dashed transparent; flex: 1; }
                    .mpl-folder-title:hover { color: #64b5f6; border-color: #666; }
                    .mpl-folder-controls { 
                        display: flex; 
                        align-items: center; 
                        gap: 4px; 
                        margin-left: auto; 
                    }
                    .mpl-lora-row { display: flex; align-items: center; gap: 5px; padding: 4px; background: #2b2b2b; border-bottom: 1px solid #333; cursor: pointer; }
                    .mpl-lora-row.root-item { background: #222; border: 1px solid #333; margin-bottom: 2px; }
                    .mpl-sort-handle { 
                        width: 16px; 
                        height: 16px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        cursor: move; 
                        color: #888; 
                        font-size: 14px; 
                        user-select: none; 
                        margin-right: 4px;
                        transition: color 0.2s;
                    }
                    .mpl-sort-handle:hover { color: #ccc; }
                    .mpl-lora-name { flex: 1; min-width: 100px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #ccc; }
                    .mpl-note-input { flex: 1; min-width: 80px; padding: 4px 8px; background: #1a1a1a; border: 1px solid #555; border-radius: 3px; color: #fff; font-size: 12px; }
                    .mpl-weight-container { display: flex; align-items: center; background: #333; border-radius: 3px; border: 1px solid #555; overflow: hidden; }
                    .mpl-weight-display { min-width: 50px; padding: 4px 8px; text-align: center; color: #fff; font-size: 12px; user-select: none; background: #2a2a2a; cursor: pointer; }
                    .mpl-weight-display:hover { background: #333; }
                    .mpl-btn-add { flex: 1; background: #2196F3; border: none; color: white; border-radius: 3px; height: 26px; cursor: pointer; font-size: 12px; }
                    .mpl-btn-icon { 
                        min-width: 40px; 
                        height: 26px; 
                        background: #333; 
                        border: 1px solid #555; 
                        color: #ccc; 
                        border-radius: 3px; 
                        cursor: pointer; 
                        font-size: 12px;
                        padding: 0 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .mpl-btn-icon:hover {
                        background: #444;
                        border-color: #666;
                        color: white;
                    }
                    .mpl-mini-input { width: 40px; background: #1a1a1a; border: 1px solid #555; color: white; text-align: center; border-radius: 3px; }
                    .mpl-mini-btn { 
                        background: #333; 
                        border: 1px solid #555; 
                        cursor: pointer; 
                        color: #ccc; 
                        padding: 4px 8px; 
                        border-radius: 4px;
                        font-size: 14px;
                        width: 28px;
                        height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.2s;
                    }
                    .mpl-mini-btn:hover { 
                        background: #444; 
                        color: white; 
                        border-color: #666;
                    }
                    .mpl-mini-btn.del:hover { 
                        background: #f44336; 
                        color: white; 
                        border-color: #f44336;
                    }
                    .mpl-mini-btn.edit { 
                        background: #2196F3; 
                        color: white; 
                        border-color: #2196F3;
                    }
                    .mpl-mini-btn.edit:hover { 
                        background: #42A5F5; 
                        border-color: #42A5F5;
                    }
                    .mpl-mini-btn.tag { 
                        background: #333; 
                        color: #888;
                    }
                    .mpl-mini-btn.tag.active { 
                        color: #4CAF50; 
                    }
                    .mpl-mini-btn.tag:hover { 
                        color: #4CAF50; 
                    }
                    .mpl-lora-preview { display: none; }
                    .mpl-spinner { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:20px; height:20px; border:2px solid #333; border-top:2px solid #fff; border-radius:50%; animation:mpl-spin 1s linear infinite; }
                    @keyframes mpl-spin { 0% { transform:translate(-50%,-50%) rotate(0deg); } 100% { transform:translate(-50%,-50%) rotate(360deg); } }
                `;
                document.head.appendChild(s);
            };

            // --- 数据处理与渲染逻辑 ---
            nodeType.prototype.updateWidget = function() {
                if (!this._stackWidget) {
                    this._stackWidget = this.widgets?.find(w => w.name === "lora_stack");
                }
                if (this._stackWidget) {
                    const stack = [];
                    if(this.loraData.folders) {
                        this.loraData.folders.forEach(f => {
                            f.loras.forEach(l => { if(l.enabled) stack.push(l); });
                        });
                    }
                    if(this.loraData.loras) {
                        this.loraData.loras.forEach(l => { if(l.enabled) stack.push(l); });
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
                this.properties["sdnq_mode"] = this.sdnqMode || "none";
                this.properties["klein_mode"] = this.kleinMode || "auto";
                this.properties["anima_mode"] = this.animaMode || "none";
                // 与隐藏 widget、设置弹窗一致：始终用严格布尔，避免 "false" 字符串导致 !adaptiveMode 误判
                this.adaptiveMode = adaptiveBool;
                this.properties["adaptive_mode"] = adaptiveBool;
                // Re-run ComfyUI's official missing-model pipeline immediately
                // after any LoRA list/widget change.
                mplSyncModelValidationWidgets(this);
                mplRefreshOfficialMissingModels();
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(w) {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                
                // 确保lora_stack widget保持隐藏（参考zml代码的方式）
                if (this.widgets) {
                    const stackWidget = this.widgets.find(w => w.name === "lora_stack");
                    if (stackWidget) {
                        stackWidget.hidden = true;
                        stackWidget.computeSize = () => [0, 0];
                    }
                    // 移除 lora_stack 的输入端口（防止用户误连接）
                    const stackInputIdx = this.inputs?.findIndex(i => i.name === "lora_stack");
                    if (stackInputIdx >= 0) {
                        this.removeInput(stackInputIdx);
                    }
                    // 兼容旧工作流的 int8_mode widget（占位隐藏，节点已忽略其值）
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
                // 恢复 Klein 模式设置
                if (this.properties["klein_mode"] !== undefined) {
                    this.kleinMode = String(this.properties["klein_mode"] || "auto");
                } else {
                    this.kleinMode = "auto";
                    this.properties["klein_mode"] = "auto";
                }
                // 恢复 Anima 2.9B 模式设置（优先隐藏 widget 的 widgets_values，其次 properties）
                const animaWidgetVal = (this.widgets?.find(w => w.name === "anima_mode") || this._animaModeWidget)?.value;
                if (animaWidgetVal !== undefined && animaWidgetVal !== "") {
                    this.animaMode = String(animaWidgetVal);
                } else if (this.properties["anima_mode"] !== undefined) {
                    this.animaMode = String(this.properties["anima_mode"] || "none");
                } else {
                    this.animaMode = "none";
                }
                this.properties["anima_mode"] = this.animaMode;

                // 恢复布局设置（从 properties 读取，确保刷新浏览器后仍生效）
                const layoutDefaults = {
                    weightStyle: "arrows",
                    sliderStep: 0.05,
                    sliderMin: -2,
                    sliderMax: 2,
                    sliderWidth: 110,
                    showWeightValue: true,
                    snapToZero: true,
                };
                if (this.properties["layout_settings"] && typeof this.properties["layout_settings"] === "object") {
                    this.layoutSettings = Object.assign({}, layoutDefaults, this.properties["layout_settings"]);
                } else {
                    this.layoutSettings = Object.assign({}, layoutDefaults);
                }
                
                if (this.properties["lora_data_state"]) {
                    try { 
                        this.loraData = JSON.parse(this.properties["lora_data_state"]);
                        // 确保所有lora都有必需字段
                        if (this.loraData.loras) {
                            this.loraData.loras.forEach(l => { 
                                if (!l.note) l.note = "";
                                if (!l.triggerWords) l.triggerWords = "";
                                if (!l.jsonInfo) l.jsonInfo = "";
                                if (!l.logInfo) l.logInfo = "";
                            });
                        }
                        if (this.loraData.folders) {
                            this.loraData.folders.forEach(f => {
                                if (f.loras) {
                                    f.loras.forEach(l => { 
                                        if (!l.note) l.note = "";
                                        if (!l.triggerWords) l.triggerWords = "";
                                        if (!l.jsonInfo) l.jsonInfo = "";
                                        if (!l.logInfo) l.logInfo = "";
                                    });
                                }
                            });
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
                // 兼容旧工作流：旧的 int8_mode widget（widgets_values[3]）保留占位，但其值已被忽略
                // （ComfyUI 官方 model_patcher.py 现在直接处理 INT8/FP8 等量化权重，无需自定义模式）
                if (this.widgets_values && this.widgets_values.length > 3 && this.widgets_values[3] !== undefined && this.widgets_values[3] !== "") {
                    // 不读取 this.widgets_values[3]，仅覆盖占位 widget 的值，确保不污染后续索引
                    if (this._int8ModeWidget) this._int8ModeWidget.value = "none";
                }

                // 从 widgets_values 恢复 SDNQ 模式（如果存在）
                if (this.widgets_values && this.widgets_values.length > 4 && this.widgets_values[4] !== undefined && this.widgets_values[4] !== "") {
                    this.sdnqMode = this.widgets_values[4];
                    this.properties["sdnq_mode"] = this.sdnqMode;
                }

                // 只从 widgets_values 恢复自适应模式（如果存在）
                const wAdaptive = this.widgets_values?.[5];
                const wAdaptiveHasValue = wAdaptive !== undefined && wAdaptive !== "";
                if (this.widgets_values && this.widgets_values.length > 5 && wAdaptiveHasValue) {
                    this.adaptiveMode = wAdaptive === "true" || wAdaptive === true;
                    this.properties["adaptive_mode"] = this.adaptiveMode;
                }

                // 从 widgets_values 恢复 Klein 模式（如果存在）
                const wKlein = this.widgets_values?.[6];
                const wKleinHasValue = wKlein !== undefined && wKlein !== "";
                if (this.widgets_values && this.widgets_values.length > 6 && wKleinHasValue) {
                    this.kleinMode = this.widgets_values[6];
                    this.properties["klein_mode"] = this.kleinMode;
                }

                // 归一化/自动修复旧工作流的模式字段（旧版本可能写入 true/false 等无效值）
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

                // 自动修复旧工作流：某些旧版本会把 adaptive_mode 错误保存成 true
                // 修复条件：properties 里是 true，但 widgets_values[5] 为空/false（说明不是用户显式选的自适应）
                if ((this.properties["adaptive_mode"] === true || this.properties["adaptive_mode"] === "true")
                    && (!wAdaptiveHasValue || wAdaptive === "false" || wAdaptive === false)) {
                    this.adaptiveMode = false;
                    this.properties["adaptive_mode"] = false;
                    if (this._adaptiveModeWidget) this._adaptiveModeWidget.value = "false";
                }

                // 最后统一同步一次，确保 properties / 隐藏 widget 一致并写回工作流
                this.updateWidget?.();
                this._mplSyncDOMLayout?.();
                
                setTimeout(() => {
                    this.createDOMInterface();
                    this.renderEmbeddedList();
                    this._updateKleinBanner?.();
                    mplUpdateMissingLoraState(this);
                    mplSyncModelValidationWidgets(this);
                    this._mplSyncDOMLayout?.();
                    void loadLoraNameList();
                }, 100);
                return r;
            };

            const onNodeRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                const r = onNodeRemoved ? onNodeRemoved.apply(this, arguments) : undefined;
                // 清理预览图和定时器
                if (this._previewTimeout) {
                    clearTimeout(this._previewTimeout);
                    this._previewTimeout = null;
                }
                if (this._previewDiv) {
                    this._previewDiv.remove();
                    this._previewDiv = null;
                }
                // Removing a node can resolve its missing-LoRA error without
                // touching any widget, so rescan the error record immediately.
                setTimeout(() => mplRefreshOfficialMissingModels(), 0);
                // 额外清理所有预览图（防止遗漏）
                const previews = document.querySelectorAll('.mpl-lora-preview');
                previews.forEach(preview => preview.remove());
                return r;
            };

            nodeType.prototype.renderEmbeddedList = function() {
                if(!this.listContainer) return;
                
                // 清理所有预览图，避免重复显示
                const previews = document.querySelectorAll('.mpl-lora-preview');
                previews.forEach(preview => preview.remove());
                
                const container = this.listContainer;
                container.innerHTML = "";

                this.loraData.folders.forEach((folder, fIdx) => {
                    const fDiv = document.createElement("div");
                    fDiv.className = "mpl-folder-row";
                    fDiv.ondragover = (e) => { 
                        e.preventDefault(); 
                        // 检查是否是排序拖拽（通过节点级别的变量或自定义数据格式）
                        const isSortDrag = e.dataTransfer.types.includes("application/x-sort-drag") || this._currentSortDrag;
                        
                        if (isSortDrag) {
                            // 从节点级别读取拖拽信息（最可靠的方法）
                            const dragInfo = this._currentSortDrag;
                            if (!dragInfo) return;
                            
                            // 检查是否是lora排序（lora排序有sourceLIdx字段，文件夹排序没有）
                            if (dragInfo.sourceLIdx !== undefined) {
                                // 这是lora排序，不是文件夹排序，不显示特效
                                return;
                            }
                            
                            // 只显示文件夹排序到文件夹的特效
                            if (dragInfo.sourceType === 'folder') {
                                // 排序拖拽：添加视觉反馈（使用橙色以区分移动操作）
                                // 先移除drag-over类，避免蓝色边框覆盖
                                fDiv.classList.remove("drag-over");
                                const rect = fDiv.getBoundingClientRect();
                                const mouseY = e.clientY - rect.top;
                                const isTopHalf = mouseY < rect.height / 2;
                                
                                if (isTopHalf) {
                                    fDiv.style.borderTop = "2px dashed #FF9800";
                                    fDiv.style.borderBottom = "none";
                                } else {
                                    fDiv.style.borderBottom = "2px dashed #FF9800";
                                    fDiv.style.borderTop = "none";
                                }
                                return; // 排序拖拽不显示文件夹的drag-over效果
                            }
                            // 如果是lora排序到文件夹，不显示特效，直接返回
                            return;
                        }
                        
                        // 非排序拖拽：显示文件夹的drag-over效果（蓝色虚线）
                        // 先清除橙色边框
                        fDiv.style.borderTop = "none";
                        fDiv.style.borderBottom = "none";
                        fDiv.classList.add("drag-over"); 
                    };
                    fDiv.ondragleave = () => { 
                        fDiv.classList.remove("drag-over");
                        fDiv.style.borderTop = "none";
                        fDiv.style.borderBottom = "";
                        // 清除拖拽信息（如果拖拽离开）
                        // 注意：这里不清除_currentSortDrag，因为可能只是暂时离开，ondragend会清除
                    };
                    fDiv.ondrop = (e) => {
                        e.preventDefault(); 
                        fDiv.classList.remove("drag-over");
                        fDiv.style.borderTop = "none";
                        fDiv.style.borderBottom = "";
                        
                        try {
                            const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                            // 清除拖拽信息
                            this._currentSortDrag = null;
                            
                            // 如果是排序拖拽
                            if (data.type === 'sort') {
                                // 文件夹排序到文件夹（只允许文件夹之间排序）
                                if (data.sourceType === 'folder') {
                                    const sourceFIdx = data.sourceFIdx;
                                    const targetFIdx = fIdx;
                                    
                                    if (sourceFIdx === targetFIdx) return;
                                    
                                    // 获取要移动的文件夹（深拷贝）
                                    const movedFolder = JSON.parse(JSON.stringify(this.loraData.folders[sourceFIdx]));
                                    
                                // 计算鼠标位置，判断是向上还是向下插入
                                const rect = fDiv.getBoundingClientRect();
                                const mouseY = e.clientY - rect.top;
                                const isTopHalf = mouseY < rect.height / 2;
                                
                                // 计算目标插入位置
                                let insertIdx;
                                if (sourceFIdx < targetFIdx) {
                                    // 向下移动：如果插入到上半部分，插入到targetIdx；如果插入到下半部分，插入到targetIdx+1
                                    insertIdx = isTopHalf ? targetFIdx : targetFIdx + 1;
                                } else {
                                    // 向上移动：如果插入到上半部分，插入到targetIdx；如果插入到下半部分，插入到targetIdx+1
                                    insertIdx = isTopHalf ? targetFIdx : targetFIdx + 1;
                                }
                                
                                // 先删除源文件夹
                                this.loraData.folders.splice(sourceFIdx, 1);
                                
                                // 如果删除后目标索引发生变化，需要调整
                                if (sourceFIdx < targetFIdx) {
                                    // 源在目标之前，删除后目标索引已经减1
                                    if (!isTopHalf) {
                                        insertIdx = targetFIdx; // 向下插入，目标索引已减1
                                    } else {
                                        insertIdx = targetFIdx - 1; // 向上插入
                                    }
                                } else {
                                    // 源在目标之后，删除后目标索引不变
                                    insertIdx = isTopHalf ? targetFIdx : targetFIdx + 1;
                                }
                                
                                // 确保索引有效
                                insertIdx = Math.max(0, Math.min(insertIdx, this.loraData.folders.length));
                                
                                // 插入到目标位置
                                this.loraData.folders.splice(insertIdx, 0, movedFolder);
                                    
                                    this.renderEmbeddedList();
                                    this.updateWidget();
                                    return;
                                }
                                
                                // 不允许lora排序到文件夹，直接返回
                                return;
                            }
                            
                            // 原有的拖拽到文件夹逻辑（移动lora到文件夹内）
                            let movedItem = null;
                            
                            // 先获取要移动的项（深拷贝），然后再删除
                            if (data.type === 'root') {
                                // 检查索引有效性
                                if (data.lIdx >= 0 && data.lIdx < this.loraData.loras.length) {
                                    movedItem = JSON.parse(JSON.stringify(this.loraData.loras[data.lIdx]));
                                this.loraData.loras.splice(data.lIdx, 1);
                                }
                            } else if (data.type === 'folder') {
                                // 检查源文件夹索引是否有效
                                if (data.fIdx >= 0 && data.fIdx < this.loraData.folders.length) {
                                const srcFolder = this.loraData.folders[data.fIdx];
                                    // 如果移动到不同文件夹
                                    if (data.fIdx !== fIdx) {
                                        // 检查lora索引有效性
                                        if (data.lIdx >= 0 && data.lIdx < srcFolder.loras.length) {
                                            // 深拷贝避免引用问题
                                            movedItem = JSON.parse(JSON.stringify(srcFolder.loras[data.lIdx]));
                                srcFolder.loras.splice(data.lIdx, 1);
                            }
                                    }
                                    // 如果是同一文件夹，不做任何操作（避免自己移动到自己）
                                }
                            }
                            
                            // 如果成功获取到要移动的项，添加到目标文件夹
                            if (movedItem) {
                                folder.loras.push(movedItem);
                                folder.collapsed = false; 
                                this.renderEmbeddedList();
                                this.updateWidget(); 
                            }
                        } catch(err) {
                            console.error("拖拽到文件夹错误:", err);
                        }
                    };

                    const header = document.createElement("div");
                    header.className = "mpl-folder-header";
                    
                    // 文件夹排序条（汉堡菜单图标）
                    const folderSortHandle = document.createElement("div");
                    folderSortHandle.className = "mpl-sort-handle";
                    folderSortHandle.innerHTML = "☰";
                    folderSortHandle.draggable = true;
                    folderSortHandle.style.cssText = `
                        width: 16px;
                        height: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: move;
                        color: #888;
                        font-size: 14px;
                        user-select: none;
                        margin-right: 4px;
                    `;
                    folderSortHandle.onmouseenter = () => {
                        folderSortHandle.style.color = "#ccc";
                    };
                    folderSortHandle.onmouseleave = () => {
                        folderSortHandle.style.color = "#888";
                    };
                    // 拖拽开始：标记这是文件夹排序拖拽
                    folderSortHandle.ondragstart = (e) => {
                        e.stopPropagation();
                        const dragInfo = { 
                            type: 'sort', 
                            sourceType: 'folder', 
                            sourceFIdx: fIdx
                        };
                        e.dataTransfer.setData("text/plain", JSON.stringify(dragInfo));
                        // 设置effectAllowed以便在ondragover中识别
                        e.dataTransfer.effectAllowed = "move";
                        // 使用自定义属性标记这是排序拖拽，并标识源类型
                        e.dataTransfer.setData("application/x-sort-drag", "true");
                        e.dataTransfer.setData("application/x-sort-source-type", "folder");
                        // 存储到节点级别，以便在ondragover中读取
                        this._currentSortDrag = dragInfo;
                        fDiv.style.opacity = "0.3";
                    };
                    folderSortHandle.ondragend = () => {
                        fDiv.style.opacity = "1";
                        // 清除拖拽信息
                        this._currentSortDrag = null;
                    };
                    folderSortHandle.addEventListener("pointerdown", (e)=>e.stopPropagation());
                    folderSortHandle.addEventListener("mousedown", (e)=>e.stopPropagation());
                    
                    const collapseIcon = document.createElement("span");
                    collapseIcon.style.cssText = "display:inline-block;width:16px;text-align:center;font-size:10px;cursor:pointer;";
                    collapseIcon.textContent = folder.collapsed ? '▶' : '▼';
                    collapseIcon.onclick = (e) => {
                        e.stopPropagation();
                        folder.collapsed = !folder.collapsed;
                        this.renderEmbeddedList();
                    };
                    
                    // 文件夹开关按钮（一键开关文件夹下所有lora）
                    const folderToggle = document.createElement("input");
                    folderToggle.type = "checkbox";
                    // 检查文件夹下是否有lora，以及是否全部启用
                    const hasLoras = folder.loras && folder.loras.length > 0;
                    const allEnabled = hasLoras && folder.loras.every(l => l.enabled !== false);
                    folderToggle.checked = allEnabled;
                    folderToggle.style.cssText = `
                        width: 16px;
                        height: 16px;
                        cursor: pointer;
                        margin-right: 4px;
                        margin-left: 4px;
                    `;
                    folderToggle.onchange = (e) => {
                        e.stopPropagation();
                        const newState = folderToggle.checked;
                        // 切换文件夹下所有lora的enabled状态
                        if (folder.loras && folder.loras.length > 0) {
                            folder.loras.forEach(lora => {
                                lora.enabled = newState;
                            });
                            this.renderEmbeddedList();
                            this.updateWidget();
                        }
                    };
                    folderToggle.addEventListener("pointerdown", (e)=>e.stopPropagation());
                    folderToggle.addEventListener("mousedown", (e)=>e.stopPropagation());
                    folderToggle.addEventListener("click", (e)=>e.stopPropagation());
                    
                    const title = document.createElement("span");
                    title.className = "mpl-folder-title";
                    title.textContent = folder.name;
                    // 单击标题重命名
                    title.onclick = (e) => {
                        e.stopPropagation();
                        const newName = prompt("Rename:", folder.name);
                        if(newName) { folder.name = newName; this.renderEmbeddedList(); this.updateWidget(); }
                    };
                    
                    header.appendChild(folderSortHandle);
                    header.appendChild(collapseIcon);
                    header.appendChild(folderToggle);
                    header.appendChild(title);

                    const controls = document.createElement("div");
                    controls.className = "mpl-folder-controls";
                    
                    const saveBtn = document.createElement("button");
                    saveBtn.className = "mpl-mini-btn save";
                    saveBtn.innerHTML = "💾";
                    saveBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        this.saveFolderPreset(folder); 
                    };
                    saveBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                    
                    const delBtn = document.createElement("button");
                    delBtn.className = "mpl-mini-btn del";
                    delBtn.innerHTML = "🗑️";
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        if(confirm("Delete folder?")) {
                            // 立即清理所有预览图（防止残留）
                            if (this._previewTimeout) {
                                clearTimeout(this._previewTimeout);
                                this._previewTimeout = null;
                            }
                            if (this._previewDiv) {
                                this._previewDiv.remove();
                                this._previewDiv = null;
                            }
                            // 清理所有可能的预览图（防止遗漏）
                            const allPreviews = document.querySelectorAll('.mpl-lora-preview');
                            allPreviews.forEach(preview => preview.remove());
                            
                            this.loraData.folders.splice(fIdx, 1);
                            this.renderEmbeddedList();
                            this.updateWidget();
                        }
                    };
                    delBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                    
                    controls.append(saveBtn, delBtn);
                    header.appendChild(controls);
                    
                    header.onclick = (e) => {
                        // 如果点击的是header本身（不是标题、不是折叠图标、不是按钮），则切换折叠状态
                        // 标题、折叠图标和按钮都有自己的点击处理，会阻止冒泡
                        const target = e.target;
                        if (target === header) {
                            folder.collapsed = !folder.collapsed;
                            this.renderEmbeddedList();
                        }
                    };
                    fDiv.appendChild(header);

                    if (!folder.collapsed) {
                        folder.loras.forEach((lora, lIdx) => {
                            const row = this.createLoraRow(lora, 'folder', fIdx, lIdx);
                            row.querySelector(".del").onclick = () => {
                                // 立即清理所有预览图（防止残留）
                                if (this._previewTimeout) {
                                    clearTimeout(this._previewTimeout);
                                    this._previewTimeout = null;
                                }
                                if (this._previewDiv) {
                                    this._previewDiv.remove();
                                    this._previewDiv = null;
                                }
                                // 清理所有可能的预览图（防止遗漏）
                                const allPreviews = document.querySelectorAll('.mpl-lora-preview');
                                allPreviews.forEach(preview => preview.remove());
                                
                                folder.loras.splice(lIdx, 1);
                                this.renderEmbeddedList();
                                this.updateWidget();
                            };
                            fDiv.appendChild(row);
                        });
                    }
                    container.appendChild(fDiv);
                });

                if (this.loraData.loras.length > 0) {
                    if (this.loraData.folders.length > 0) {
                        const hr = document.createElement("div"); hr.style.cssText = "height:1px;background:#444;margin:5px 0;";
                        container.appendChild(hr);
                    }
                    this.loraData.loras.forEach((lora, lIdx) => {
                        const row = this.createLoraRow(lora, 'root', -1, lIdx);
                        row.classList.add("root-item");
                        row.querySelector(".del").onclick = () => {
                            // 立即清理所有预览图（防止残留）
                            if (this._previewTimeout) {
                                clearTimeout(this._previewTimeout);
                                this._previewTimeout = null;
                            }
                            if (this._previewDiv) {
                                this._previewDiv.remove();
                                this._previewDiv = null;
                            }
                            // 清理所有可能的预览图（防止遗漏）
                            const allPreviews = document.querySelectorAll('.mpl-lora-preview');
                            allPreviews.forEach(preview => preview.remove());
                            
                            this.loraData.loras.splice(lIdx, 1);
                            this.renderEmbeddedList();
                            this.updateWidget();
                        };
                        container.appendChild(row);
                    });
                }
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

                    // 一比一参考 magic_resolution.js：清除 top/left/right/bottom，用 transform 定位
                    dialog.style.top = '';
                    dialog.style.left = '';
                    dialog.style.right = '';
                    dialog.style.bottom = '';

                    // 如果父元素是 flex 居中，需要改父样式
                    const parent = dialog.parentElement;
                    if (parent && parent.style.display === 'flex') {
                        parent.style.display = 'block';
                        parent.style.position = 'fixed';
                        parent.style.top = '0';
                        parent.style.left = '0';
                        parent.style.width = '100%';
                        parent.style.height = '100%';
                    }

                    // 确保 dialog 使用 fixed 定位
                    dialog.style.position = 'fixed';

                    // 用 transform 移动
                    dialog.style.transform = `translate(${newX}px, ${newY}px)`;
                };

                const dragEnd = () => {
                    isDragging = false;
                };

                titleBar.addEventListener("mousedown", dragStart);
                titleBar.addEventListener("touchstart", dragStart);
                document.addEventListener("mousemove", drag);
                document.addEventListener("touchmove", drag);
                document.addEventListener("mouseup", dragEnd);
                document.addEventListener("touchend", dragEnd);
            };

            // --- Klein 模式提示 Banner ---
            nodeType.prototype._updateKleinBanner = function() {
                const container = this.embeddedDiv;
                if (!container) return;

                // 移除旧 banner
                if (this._kleinBannerEl) {
                    this._kleinBannerEl.remove();
                    this._kleinBannerEl = null;
                }

                // 读取当前 klein_mode 设置
                const kleinMode = this.kleinMode
                    ?? this.properties?.klein_mode
                    ?? this._kleinModeWidget?.value
                    ?? "auto";
                const isKleinActive = String(kleinMode).toLowerCase() === "klein";

                // Klein 模式下不需要提示
                if (isKleinActive) return;

                // 检测是否使用了 Klein Loader（通过检查本节点的 model 输入是否连接了 MagicKleinLoader）
                const isKleinModelConnected = this.inputs?.some(input => {
                    if (!input.link) return false;
                    const link = app.graph.links?.[input.link];
                    if (!link) return false;
                    const originNode = app.graph.getNodeById(link.origin_id);
                    return originNode?.type === "MagicKleinLoader";
                });

                if (!isKleinModelConnected) return;

                // 构建 Banner
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

                // 前往设置按钮
                banner.querySelector("button").onclick = () => {
                    this.showSettingsModal();
                };

                // 插入到 listContainer 之前
                const listContainer = this.listContainer;
                if (listContainer && listContainer.parentNode === container) {
                    container.insertBefore(banner, listContainer);
                } else {
                    const footer = container.querySelector(".mpl-footer");
                    if (footer) container.insertBefore(banner, footer);
                }

                this._kleinBannerEl = banner;
            };

            nodeType.prototype.showTagEditModal = function(lora) {
                // 创建遮罩层
                const overlay = document.createElement("div");
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 10001;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                // 创建弹窗（一比一参考 magic_resolution.js：fixed + translate 居中）
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #2a2a2a;
                    border: 1px solid #555;
                    border-radius: 8px;
                    padding: 20px;
                    min-width: 500px;
                    max-width: 700px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.8);
                    z-index: 10002;
                `;
                
                // 标题栏（可拖拽）
                const title = document.createElement("div");
                title.textContent = "编辑触发词";
                title.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    color: #eee;
                    margin-bottom: 15px;
                    border-bottom: 1px solid #444;
                    padding-bottom: 10px;
                    cursor: move;
                    user-select: none;
                `;
                
                // 输入框容器
                const inputContainer = document.createElement("div");
                inputContainer.style.cssText = "margin-bottom: 15px;";
                
                const label = document.createElement("label");
                label.textContent = "使用触发词时需要将tags_output连接出去，可以连到文本框、clip框等等";
                label.style.cssText = "display: block; color: #ccc; margin-bottom: 5px; font-size: 14px;";
                
                const textarea = document.createElement("textarea");
                textarea.value = lora.tags || "";
                textarea.style.cssText = `
                    width: 100%;
                    min-height: 100px;
                    padding: 8px;
                    background: #1a1a1a;
                    border: 1px solid #555;
                    border-radius: 4px;
                    color: #fff;
                    font-size: 13px;
                    font-family: sans-serif;
                    resize: vertical;
                    box-sizing: border-box;
                `;
                textarea.placeholder = "输入标签，用逗号分隔...";
                
                inputContainer.appendChild(label);
                inputContainer.appendChild(textarea);
                
                // 按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.style.cssText = `
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                    margin-top: 15px;
                `;
                
                // 获取现成tag按钮
                const fetchBtn = document.createElement("button");
                fetchBtn.textContent = "🔍 获取现成tag";
                fetchBtn.style.cssText = `
                    padding: 8px 16px;
                    background: #4CAF50;
                    border: none;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                `;
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
                            alert("没有获取到现成的tag");
                        }
                    } catch (error) {
                        console.error("读取txt文件时出错:", error);
                        alert("没有获取到现成的tag");
                    }
                };
                fetchBtn.onmouseenter = () => fetchBtn.style.background = "#5CBF60";
                fetchBtn.onmouseleave = () => fetchBtn.style.background = "#4CAF50";
                
                // 确定按钮
                const confirmBtn = document.createElement("button");
                confirmBtn.textContent = "确定";
                confirmBtn.style.cssText = `
                    padding: 8px 16px;
                    background: #2196F3;
                    border: none;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                `;
                confirmBtn.onclick = () => {
                    lora.tags = textarea.value.trim();
                    this.renderEmbeddedList();
                    this.updateWidget();
                    document.body.removeChild(overlay);
                };
                confirmBtn.onmouseenter = () => confirmBtn.style.background = "#42A5F5";
                confirmBtn.onmouseleave = () => confirmBtn.style.background = "#2196F3";
                
                // 取消按钮
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.style.cssText = `
                    padding: 8px 16px;
                    background: #666;
                    border: none;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                `;
                cancelBtn.onclick = () => {
                    document.body.removeChild(overlay);
                };
                cancelBtn.onmouseenter = () => cancelBtn.style.background = "#777";
                cancelBtn.onmouseleave = () => cancelBtn.style.background = "#666";
                
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
                    // 并行读取三个文件
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
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 10001;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                // 创建弹窗（一比一参考 magic_resolution.js：fixed + translate 居中）
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #1e1e1e;
                    border: 1px solid #3a3a3a;
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 700px;
                    max-width: 1000px;
                    width: 85%;
                    max-height: 85vh;
                    box-shadow: 0 12px 40px rgba(0,0,0,0.9);
                    z-index: 10002;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                `;
                
                // 标题栏
                const header = document.createElement("div");
                header.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 2px solid #333;
                    cursor: move;
                    user-select: none;
                `;
                
                const title = document.createElement("div");
                title.textContent = `编辑 LoRA 内容: ${lora.name.split(/[/\\]/).pop()}`;
                title.style.cssText = `
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    letter-spacing: 0.3px;
                    flex: 1;
                `;
                
                const deleteBtn = document.createElement("button");
                deleteBtn.textContent = "删除";
                deleteBtn.style.cssText = `
                    padding: 8px 16px;
                    background: #f44336;
                    border: none;
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                deleteBtn.onclick = async () => {
                    if (confirm("确定要删除这个 LoRA 及其所有相关文件吗？此操作不可恢复！")) {
                        try {
                            const response = await api.fetchApi('/ma/lora/delete_lora_complete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lora_name: lora.name })
                            });
                            const result = await response.json();
                            
                            if (result.status === 'success') {
                                const deletedLoraName = lora.name;
                                
                                // 立即清理所有预览图（防止残留）
                                if (this._previewTimeout) {
                                    clearTimeout(this._previewTimeout);
                                    this._previewTimeout = null;
                                }
                                if (this._previewDiv) {
                                    this._previewDiv.remove();
                                    this._previewDiv = null;
                                }
                                // 清理所有可能的预览图（防止遗漏）
                                const allPreviews = document.querySelectorAll('.mpl-lora-preview');
                                allPreviews.forEach(preview => preview.remove());
                                
                                // 从节点数据中移除
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
                                
                                // 刷新全局图片列表缓存（类似爬取成功后的逻辑）
                                await loadLoraImageList();
                                
                                // 刷新缓存（重新渲染列表）
                                this.renderEmbeddedList();
                                this.updateWidget();
                                
                                // 刷新所有显示该lora图片的地方（虽然已删除，但需要清理缓存）
                                this.refreshLoraImageCache(deletedLoraName);
                                
                                // 如果"添加Lora"窗口打开，重新获取文件列表并渲染
                                if (this._addLoraModal && this._addLoraModal.parentElement && this._refreshFileListFunc) {
                                    // 调用refreshFileList函数重新获取文件列表并渲染
                                    await this._refreshFileListFunc();
                                } else if (this._addLoraModal && this._addLoraModal.parentElement && this._renderContentFunc) {
                                    // 如果没有refreshFileList，至少调用renderContent
                                    this._renderContentFunc();
                                }
                                
                                document.body.removeChild(overlay);
                                alert(result.message || "删除成功");
                            } else {
                                alert(result.message || "删除失败");
                            }
                        } catch (error) {
                            console.error("删除LoRA时出错:", error);
                            alert("删除失败: " + error.message);
                        }
                    }
                };
                deleteBtn.onmouseenter = () => deleteBtn.style.background = "#d32f2f";
                deleteBtn.onmouseleave = () => deleteBtn.style.background = "#f44336";
                
                header.appendChild(title);
                header.appendChild(deleteBtn);
                
                // Tab容器
                const tabContainer = document.createElement("div");
                tabContainer.style.cssText = `
                    display: flex;
                    gap: 8px;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #2a2a2a;
                    padding-bottom: 2px;
                `;
                
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
                    tabBtn.style.cssText = `
                        padding: 10px 20px;
                        background: ${currentTab === tab.id ? '#2a2a2a' : 'transparent'};
                        border: none;
                        border-bottom: 3px solid ${currentTab === tab.id ? '#2196F3' : 'transparent'};
                        color: ${currentTab === tab.id ? '#fff' : '#888'};
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: ${currentTab === tab.id ? '500' : '400'};
                        border-radius: 6px 6px 0 0;
                        transition: all 0.3s;
                        position: relative;
                        top: 2px;
                    `;
                    tabBtn.onclick = () => {
                        currentTab = tab.id;
                        tabs.forEach(t => {
                            const btn = tabButtons[t.id];
                            btn.style.background = currentTab === t.id ? '#2a2a2a' : 'transparent';
                            btn.style.color = currentTab === t.id ? '#fff' : '#888';
                            btn.style.borderBottomColor = currentTab === t.id ? '#2196F3' : 'transparent';
                            btn.style.fontWeight = currentTab === t.id ? '500' : '400';
                        });
                        // 切换内容区域
                        contentAreas.forEach((area, idx) => {
                            area.style.display = tabs[idx].id === currentTab ? 'flex' : 'none';
                        });
                    };
                    tabButtons[tab.id] = tabBtn;
                    tabContainer.appendChild(tabBtn);
                });
                
                // 内容区域容器
                const contentWrapper = document.createElement("div");
                contentWrapper.style.cssText = `
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 300px;
                    overflow: hidden;
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
                    
                    // 文本编辑区域
                    const textarea = document.createElement("textarea");
                    textarea.style.cssText = `
                        flex: 1;
                        width: 100%;
                        min-height: 350px;
                        padding: 16px;
                        background: #151515;
                        border: 1px solid #3a3a3a;
                        border-radius: 8px;
                        color: #e0e0e0;
                        font-size: 14px;
                        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                        resize: both;
                        box-sizing: border-box;
                        line-height: 1.6;
                        transition: border-color 0.2s;
                    `;
                    textarea.onfocus = () => {
                        textarea.style.borderColor = '#2196F3';
                    };
                    textarea.onblur = () => {
                        textarea.style.borderColor = '#3a3a3a';
                    };
                    
                    // 初始化内容：只使用本地文件内容，不读取内存中的lora对象
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
                buttonContainer.style.cssText = `
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 2px solid #2a2a2a;
                `;
                
                // 取消按钮
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.style.cssText = `
                    padding: 10px 24px;
                    background: #3a3a3a;
                    border: 1px solid #555;
                    color: #fff;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                cancelBtn.onclick = () => {
                    document.body.removeChild(overlay);
                };
                cancelBtn.onmouseenter = () => {
                    cancelBtn.style.background = "#f44336";
                    cancelBtn.style.borderColor = "#f44336";
                };
                cancelBtn.onmouseleave = () => {
                    cancelBtn.style.background = "#3a3a3a";
                    cancelBtn.style.borderColor = "#555";
                };
                
                // 保存按钮
                const saveBtn = document.createElement("button");
                saveBtn.textContent = "保存";
                saveBtn.style.cssText = `
                    padding: 10px 24px;
                    background: #4CAF50;
                    border: none;
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                // 保存位置选择对话框
                const showSaveTargetDialog = () => new Promise((resolve) => {
                    const saveOverlay = document.createElement("div");
                    saveOverlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10005; display: flex; align-items: center; justify-content: center;";
                    
                    const saveDialog = document.createElement("div");
                    saveDialog.style.cssText = "background: #1a1a1a; border: 1px solid #4a4a4a; border-radius: 8px; padding: 24px; width: 420px; z-index: 10006; color: #f0f0f0; box-shadow: 0 4px 16px rgba(0,0,0,0.8);";
                    
                    const title = document.createElement("p");
                    title.textContent = "选择保存位置";
                    title.style.cssText = "margin: 0 0 12px; color: #fff; font-weight: bold; font-size: 16px;";
                    
                    const tips = document.createElement("p");
                    tips.textContent = "请选择要将修改内容保存到哪里。您也可以选择同时保存到两个位置。";
                    tips.style.cssText = "margin: 0 0 16px; color: #ccc; line-height: 1.5; font-size: 13px;";
                    
                    const targetContainer = document.createElement("div");
                    targetContainer.style.cssText = "margin: 8px 0 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;";
                    
                    const targetLabel = document.createElement("span");
                    targetLabel.textContent = "保存位置";
                    targetLabel.style.cssText = "color: #ccc; font-size: 13px;";
                    
                    const sameLabel = document.createElement("label");
                    sameLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer;";
                    const inputSame = document.createElement("input");
                    inputSame.type = "radio";
                    inputSame.name = "save-target";
                    inputSame.value = "same";
                    inputSame.checked = true;
                    const sameText = document.createTextNode("同层级");
                    sameLabel.appendChild(inputSame);
                    sameLabel.appendChild(sameText);
                    
                    const magicLabel = document.createElement("label");
                    magicLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer;";
                    const inputMagic = document.createElement("input");
                    inputMagic.type = "radio";
                    inputMagic.name = "save-target";
                    inputMagic.value = "magicloradate";
                    const magicText = document.createTextNode("magicloradate子目录");
                    magicLabel.appendChild(inputMagic);
                    magicLabel.appendChild(magicText);
                    
                    const bothLabel = document.createElement("label");
                    bothLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer;";
                    const inputBoth = document.createElement("input");
                    inputBoth.type = "radio";
                    inputBoth.name = "save-target";
                    inputBoth.value = "both";
                    const bothText = document.createTextNode("同时保存");
                    bothLabel.appendChild(inputBoth);
                    bothLabel.appendChild(bothText);
                    
                    targetContainer.appendChild(targetLabel);
                    targetContainer.appendChild(sameLabel);
                    targetContainer.appendChild(magicLabel);
                    targetContainer.appendChild(bothLabel);
                    
                    const buttons = document.createElement("div");
                    buttons.style.cssText = "display: flex; gap: 12px; justify-content: flex-end;";
                    
                    const okBtn = document.createElement("button");
                    okBtn.textContent = "确定";
                    okBtn.style.cssText = "padding: 8px 16px; background: #4CAF50; border: none; color: #fff; border-radius: 4px; cursor: pointer;";
                    
                    const cancelBtn2 = document.createElement("button");
                    cancelBtn2.textContent = "取消";
                    cancelBtn2.style.cssText = "padding: 8px 16px; background: #666; border: none; color: #fff; border-radius: 4px; cursor: pointer;";
                    
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
                        // 智能保存策略：先探测可读性
                        const probeRes = await api.fetchApi('/ma/lora/probe_save_targets', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lora_name: loraName })
                        });
                        const probe = await probeRes.json();
                        
                        // 解析探测结果
                        const magicDirExists = !!probe.magicloradate_dir_exists;
                        const magicReadable = !!probe.magicloradate_has_readable;
                        const sameReadable = !!probe.same_has_readable;
                        
                        // 依据情况决定保存目标
                        let targets = [];
                        let needChoice = false;
                        
                        if (magicDirExists && magicReadable && !sameReadable) {
                            targets = ["magicloradate"]; // 情形1：存在magicloradate且可读，无同层级可读
                        } else if (magicDirExists && !magicReadable && !sameReadable) {
                            needChoice = true; // 情形3：存在magicloradate但不可读，无同层级可读
                        } else if (!magicDirExists && sameReadable) {
                            targets = ["same"]; // 情形4：不存在magicloradate，有同层级可读
                        } else if (!magicDirExists && !sameReadable) {
                            needChoice = true; // 情形5：不存在magicloradate，且无同层级可读
                        } else if (magicReadable && sameReadable) {
                            targets = ["magicloradate", "same"]; // 情形6：同时存在可读magicloradate与同层级
                        } else if (magicDirExists && sameReadable && !magicReadable) {
                            targets = ["same"]; // magicloradate目录存在但不可读，同层级可读
                        }
                        
                        // 当不确定时弹出选择弹窗
                        if (needChoice || targets.length === 0) {
                            const userTarget = await showSaveTargetDialog();
                            if (!userTarget) {
                                return; // 用户取消
                            }
                            if (userTarget === "both") {
                                targets = ["magicloradate", "same"];
                            } else {
                                targets = [userTarget];
                            }
                        }
                        
                        // 获取所有tab的内容
                        const txtArea = contentAreas[0].querySelector('textarea');
                        const jsonArea = contentAreas[1].querySelector('textarea');
                        const logArea = contentAreas[2].querySelector('textarea');
                        
                        // 执行保存（可能双写）
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
                            alert(`LoRA '${loraName.split(/[/\\]/).pop()}' 的内容已保存到 ${targetText}！`);
                            
                            // 更新lora对象的内容
                            lora.triggerWords = txtArea.value;
                            lora.jsonInfo = jsonArea.value;
                            lora.logInfo = logArea.value;
                            
                            // 如果lora还没有添加到节点中（从"添加Lora"窗口编辑的），先添加它
                            if (filePath && (fIdx === -1 || !this.loraData.loras.find(l => l.name === filePath))) {
                                // 检查是否在文件夹中
                                let foundInFolder = false;
                                for (let fi = 0; fi < this.loraData.folders.length; fi++) {
                                    const folder = this.loraData.folders[fi];
                                    if (folder.loras.find(l => l.name === filePath)) {
                                        foundInFolder = true;
                                        break;
                                    }
                                }
                                
                                // 如果不在任何地方，添加到根loras
                                if (!foundInFolder) {
                                    // 确保lora对象有所有必需的字段
                                    if (!lora.enabled) lora.enabled = true;
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
                            alert(`部分或全部保存失败：\n${msgs}`);
                        }
                    } catch (error) {
                        console.error("保存LoRA内容时出错:", error);
                        alert(`保存时发生错误：${error.message}`);
                    }
                };
                saveBtn.onmouseenter = () => {
                    saveBtn.style.background = "#5CBF60";
                    saveBtn.style.transform = "translateY(-1px)";
                    saveBtn.style.boxShadow = "0 4px 12px rgba(76, 175, 80, 0.3)";
                };
                saveBtn.onmouseleave = () => {
                    saveBtn.style.background = "#4CAF50";
                    saveBtn.style.transform = "translateY(0)";
                    saveBtn.style.boxShadow = "none";
                };
                
                // 爬取信息按钮
                const fetchBtn = document.createElement("button");
                fetchBtn.textContent = "爬取信息";
                fetchBtn.style.cssText = `
                    padding: 10px 24px;
                    background: #2196F3;
                    border: none;
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                fetchBtn.onclick = () => {
                    this.showFetchModal(lora, contentAreas, overlay);
                };
                fetchBtn.onmouseenter = () => {
                    fetchBtn.style.background = "#42A5F5";
                    fetchBtn.style.transform = "translateY(-1px)";
                    fetchBtn.style.boxShadow = "0 4px 12px rgba(33, 150, 243, 0.3)";
                };
                fetchBtn.onmouseleave = () => {
                    fetchBtn.style.background = "#2196F3";
                    fetchBtn.style.transform = "translateY(0)";
                    fetchBtn.style.boxShadow = "none";
                };
                
                buttonContainer.appendChild(cancelBtn);
                buttonContainer.appendChild(fetchBtn);
                buttonContainer.appendChild(saveBtn);
                
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
                dialog.appendChild(header);
                dialog.appendChild(tabContainer);
                dialog.appendChild(contentWrapper);
                dialog.appendChild(buttonContainer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                
                // 使弹窗可拖拽
                this.makeDialogDraggable(dialog, header);
                
                // 自动聚焦到当前tab的文本区域
                setTimeout(() => {
                    const currentArea = contentAreas.find(a => a.dataset.tab === currentTab);
                    if (currentArea) {
                        const textarea = currentArea.querySelector('textarea');
                        if (textarea) textarea.focus();
                    }
                }, 100);
            };

            nodeType.prototype.showFetchModal = function(lora, contentAreas, parentOverlay) {
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
                fetchOverlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    z-index: 10003;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                // 创建弹窗
                const fetchDialog = document.createElement("div");
                fetchDialog.style.cssText = `
                    background: #1e1e1e;
                    border: 1px solid #3a3a3a;
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 500px;
                    max-width: 600px;
                    width: 90%;
                    box-shadow: 0 12px 40px rgba(0,0,0,0.9);
                    z-index: 10004;
                    position: relative;
                `;
                
                // 标题栏（可拖拽）
                const title = document.createElement("div");
                title.textContent = "爬取 LoRA 信息";
                title.style.cssText = `
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 2px solid #333;
                    cursor: move;
                    user-select: none;
                `;
                
                // 下载选项
                const optionsContainer = document.createElement("div");
                optionsContainer.style.cssText = "margin-bottom: 20px;";
                
                const optionsTitle = document.createElement("div");
                optionsTitle.textContent = "下载选项";
                optionsTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 500;
                    color: #ccc;
                    margin-bottom: 12px;
                `;
                optionsContainer.appendChild(optionsTitle);
                
                const downloadTxt = document.createElement("label");
                downloadTxt.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const txtCheckbox = document.createElement("input");
                txtCheckbox.type = "checkbox";
                txtCheckbox.checked = savedSettings.download_txt !== false; // 默认true
                txtCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadTxt.appendChild(txtCheckbox);
                downloadTxt.appendChild(document.createTextNode("触发词文件 (.txt)"));
                
                const downloadJson = document.createElement("label");
                downloadJson.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const jsonCheckbox = document.createElement("input");
                jsonCheckbox.type = "checkbox";
                jsonCheckbox.checked = savedSettings.download_json !== false; // 默认true
                jsonCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadJson.appendChild(jsonCheckbox);
                downloadJson.appendChild(document.createTextNode("模型介绍信息 (.json)"));
                
                const downloadImage = document.createElement("label");
                downloadImage.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const imageCheckbox = document.createElement("input");
                imageCheckbox.type = "checkbox";
                imageCheckbox.checked = savedSettings.download_image !== false; // 默认true
                imageCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadImage.appendChild(imageCheckbox);
                downloadImage.appendChild(document.createTextNode("预览图像"));
                
                const downloadLog = document.createElement("label");
                downloadLog.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer; color: #eee;";
                const logCheckbox = document.createElement("input");
                logCheckbox.type = "checkbox";
                logCheckbox.checked = savedSettings.download_log !== false; // 默认true
                logCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadLog.appendChild(logCheckbox);
                downloadLog.appendChild(document.createTextNode("默认权重下载 (.log)"));
                
                optionsContainer.appendChild(downloadTxt);
                optionsContainer.appendChild(downloadJson);
                optionsContainer.appendChild(downloadImage);
                optionsContainer.appendChild(downloadLog);
                
                // 保存路径选择
                const pathContainer = document.createElement("div");
                pathContainer.style.cssText = "margin-bottom: 20px;";
                
                const pathTitle = document.createElement("div");
                pathTitle.textContent = "保存路径";
                pathTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 500;
                    color: #ccc;
                    margin-bottom: 12px;
                `;
                pathContainer.appendChild(pathTitle);
                
                const pathSameDir = document.createElement("label");
                pathSameDir.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const sameDirRadio = document.createElement("input");
                sameDirRadio.type = "radio";
                sameDirRadio.name = "save_path";
                sameDirRadio.value = "same_dir";
                sameDirRadio.checked = savedSettings.save_path !== "subfolder"; // 默认same_dir
                sameDirRadio.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                pathSameDir.appendChild(sameDirRadio);
                pathSameDir.appendChild(document.createTextNode("保存到 LoRA 同目录下"));
                
                const pathSubfolder = document.createElement("label");
                pathSubfolder.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; color: #eee;";
                const subfolderRadio = document.createElement("input");
                subfolderRadio.type = "radio";
                subfolderRadio.name = "save_path";
                subfolderRadio.value = "subfolder";
                subfolderRadio.checked = savedSettings.save_path === "subfolder";
                subfolderRadio.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
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
                buttonContainer.style.cssText = `
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 2px solid #2a2a2a;
                `;
                
                // 取消按钮
                const cancelFetchBtn = document.createElement("button");
                cancelFetchBtn.textContent = "取消";
                cancelFetchBtn.style.cssText = `
                    padding: 10px 24px;
                    background: #3a3a3a;
                    border: 1px solid #555;
                    color: #fff;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                cancelFetchBtn.onclick = () => {
                    document.body.removeChild(fetchOverlay);
                };
                cancelFetchBtn.onmouseenter = () => {
                    cancelFetchBtn.style.background = "#555";
                };
                cancelFetchBtn.onmouseleave = () => {
                    cancelFetchBtn.style.background = "#3a3a3a";
                };
                
                // 爬取按钮
                const fetchConfirmBtn = document.createElement("button");
                fetchConfirmBtn.textContent = "开始爬取";
                fetchConfirmBtn.style.cssText = `
                    padding: 10px 24px;
                    background: #4CAF50;
                    border: none;
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                `;
                fetchConfirmBtn.onclick = async () => {
                    fetchConfirmBtn.disabled = true;
                    fetchConfirmBtn.textContent = "爬取中...";
                    
                    try {
                        const options = {
                            download_txt: txtCheckbox.checked,
                            download_json: jsonCheckbox.checked,
                            download_image: imageCheckbox.checked,
                            download_log: logCheckbox.checked
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
                                save_path_mode: savePathMode
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.status === 'success') {
                            // 更新编辑框内容
                            if (result.data.triggerWords) {
                                const txtArea = contentAreas[0].querySelector('textarea');
                                if (txtArea) txtArea.value = result.data.triggerWords;
                                lora.triggerWords = result.data.triggerWords;
                            }
                            if (result.data.jsonInfo) {
                                const jsonArea = contentAreas[1].querySelector('textarea');
                                if (jsonArea) jsonArea.value = result.data.jsonInfo;
                                lora.jsonInfo = result.data.jsonInfo;
                            }
                            if (result.data.logInfo) {
                                const logArea = contentAreas[2].querySelector('textarea');
                                if (logArea) logArea.value = result.data.logInfo;
                                lora.logInfo = result.data.logInfo;
                            }
                            
                            // 刷新全局图片列表缓存（类似参考代码的loadImageList）
                            await loadLoraImageList();
                            
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
                            
                            document.body.removeChild(fetchOverlay);
                            alert(result.message || "爬取成功！内容已自动填入编辑框。");
                        } else {
                            alert(result.message || "爬取失败");
                            fetchConfirmBtn.disabled = false;
                            fetchConfirmBtn.textContent = "开始爬取";
                        }
                    } catch (error) {
                        console.error("爬取元数据时出错:", error);
                        alert("爬取失败: " + error.message);
                        fetchConfirmBtn.disabled = false;
                        fetchConfirmBtn.textContent = "开始爬取";
                    }
                };
                fetchConfirmBtn.onmouseenter = () => {
                    if (!fetchConfirmBtn.disabled) {
                        fetchConfirmBtn.style.background = "#5CBF60";
                    }
                };
                fetchConfirmBtn.onmouseleave = () => {
                    if (!fetchConfirmBtn.disabled) {
                        fetchConfirmBtn.style.background = "#4CAF50";
                    }
                };
                
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
                        document.body.removeChild(fetchOverlay);
                    }
                };
                
                // ESC键关闭
                const handleEsc = (e) => {
                    if (e.key === "Escape") {
                        document.body.removeChild(fetchOverlay);
                        document.removeEventListener("keydown", handleEsc);
                    }
                };
                document.addEventListener("keydown", handleEsc);
                
                // 组装弹窗
                fetchDialog.appendChild(title);
                fetchDialog.appendChild(optionsContainer);
                fetchDialog.appendChild(pathContainer);
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
                // 确保lora对象有所有必需字段
                if (lora.enabled === undefined) lora.enabled = true;
                if (lora.weight === undefined || lora.weight === null) lora.weight = 1.0;
                if (!lora.tags) lora.tags = "";
                if (!lora.note) lora.note = "";
                if (!lora.triggerWords) lora.triggerWords = "";
                if (!lora.jsonInfo) lora.jsonInfo = "";
                if (!lora.logInfo) lora.logInfo = "";
                if (!lora.name) lora.name = "";
                
                const row = document.createElement("div");
                row.className = "mpl-lora-row";
                row.style.opacity = lora.enabled ? "1" : "0.5";
                // 移除row的draggable，改为在空白区域和排序按钮上才允许拖拽
                row.draggable = false;
                
                // 创建一个可拖拽的空白区域（在name和noteInput之间）
                const dragArea = document.createElement("div");
                dragArea.className = "mpl-drag-area";
                dragArea.style.cssText = `
                    flex: 1;
                    min-width: 20px;
                    cursor: move;
                    user-select: none;
                `;
                dragArea.draggable = true;
                dragArea.ondragstart = (e) => {
                    e.dataTransfer.setData("text/plain", JSON.stringify({ type, fIdx, lIdx }));
                    row.style.opacity = "0.3";
                };
                dragArea.ondragend = () => { 
                    row.style.opacity = lora.enabled ? "1" : "0.5"; 
                };
                
                // 添加拖拽排序功能：拖拽到目标lora上方时插入
                row.ondragover = (e) => {
                    e.preventDefault();
                    // 检查是否是排序拖拽（通过节点级别的变量或自定义数据格式）
                    const isSortDrag = e.dataTransfer.types.includes("application/x-sort-drag") || this._currentSortDrag;
                    
                    if (isSortDrag) {
                        // 从节点级别读取拖拽信息（最可靠的方法）
                        const dragInfo = this._currentSortDrag;
                        if (!dragInfo) return;
                        
                        // 只显示lora排序到lora的特效（同一类型）
                        if ((dragInfo.sourceType === 'root' && type === 'root') || 
                            (dragInfo.sourceType === 'folder' && type === 'folder')) {
                            // 如果是文件夹内的lora，还需要检查是否是同一个文件夹
                            if (dragInfo.sourceType === 'folder' && type === 'folder') {
                                if (dragInfo.sourceFIdx !== fIdx) {
                                    // 不同文件夹的lora之间不排序，不显示特效
                                    return;
                                }
                            }
                            // 排序拖拽：添加视觉反馈（使用橙色以区分移动操作）
                            // 计算鼠标位置，判断是插入到上方还是下方
                            const rect = row.getBoundingClientRect();
                            const mouseY = e.clientY - rect.top;
                            const isTopHalf = mouseY < rect.height / 2;
                            
                            // 添加橙色虚线边框特效
                            if (isTopHalf) {
                                row.style.borderTop = "2px dashed #FF9800";
                                row.style.borderBottom = "none";
                            } else {
                                row.style.borderBottom = "2px dashed #FF9800";
                                row.style.borderTop = "none";
                            }
                            return;
                        }
                        // 如果是文件夹排序到lora，不显示特效，直接返回
                        return;
                    }
                    
                    // 非排序拖拽：不显示特效（移动操作由文件夹的ondrop处理）
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                };
                
                row.ondragleave = () => {
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                    // 清除拖拽信息（如果拖拽离开）
                    // 注意：这里不清除_currentSortDrag，因为可能只是暂时离开，ondragend会清除
                };
                
                row.ondrop = (e) => {
                    e.preventDefault();
                    row.style.borderTop = "none";
                    row.style.borderBottom = "";
                    
                    try {
                        const dragData = e.dataTransfer.getData("text/plain");
                        if (!dragData) {
                            // 清除拖拽信息
                            this._currentSortDrag = null;
                            return;
                        }
                        
                        const data = JSON.parse(dragData);
                        // 清除拖拽信息
                        this._currentSortDrag = null;
                        
                        // 如果是排序拖拽
                        if (data.type === 'sort') {
                            // lora排序到lora（同一列表内）
                            if (data.sourceType === type && 
                                (type === 'root' || (type === 'folder' && data.sourceFIdx === fIdx))) {
                                
                                const loras = type === 'folder' ? this.loraData.folders[fIdx].loras : this.loraData.loras;
                                const sourceIdx = data.sourceLIdx;
                                const targetIdx = lIdx;
                                
                                // 如果源和目标相同，不处理
                                if (sourceIdx === targetIdx) return;
                                
                                // 获取要移动的项（深拷贝）
                                const movedItem = JSON.parse(JSON.stringify(loras[sourceIdx]));
                                
                                // 计算鼠标位置，判断是向上还是向下插入
                                const rect = row.getBoundingClientRect();
                                const mouseY = e.clientY - rect.top;
                                const isTopHalf = mouseY < rect.height / 2;
                                
                                // 计算目标插入位置
                                let insertIdx;
                                if (sourceIdx < targetIdx) {
                                    // 向下移动：如果插入到上半部分，插入到targetIdx；如果插入到下半部分，插入到targetIdx+1
                                    insertIdx = isTopHalf ? targetIdx : targetIdx + 1;
                                } else {
                                    // 向上移动：如果插入到上半部分，插入到targetIdx；如果插入到下半部分，插入到targetIdx+1
                                    insertIdx = isTopHalf ? targetIdx : targetIdx + 1;
                                }
                                
                                // 先删除源项
                                loras.splice(sourceIdx, 1);
                                
                                // 如果删除后目标索引发生变化，需要调整
                                if (sourceIdx < targetIdx) {
                                    // 源在目标之前，删除后目标索引已经减1
                                    if (!isTopHalf) {
                                        insertIdx = targetIdx; // 向下插入，目标索引已减1
                                    } else {
                                        insertIdx = targetIdx - 1; // 向上插入
                                    }
                                } else {
                                    // 源在目标之后，删除后目标索引不变
                                    insertIdx = isTopHalf ? targetIdx : targetIdx + 1;
                                }
                                
                                // 确保索引有效
                                insertIdx = Math.max(0, Math.min(insertIdx, loras.length));
                                
                                // 插入到目标位置
                                loras.splice(insertIdx, 0, movedItem);
                                
                                this.renderEmbeddedList();
                                this.updateWidget();
                                return;
                            }
                            
                            // 不允许文件夹和lora之间互相排序，只允许同类型之间排序
                            return; // 排序拖拽处理完毕，不继续处理
                        }
                        
                        // 原有的拖拽到文件夹逻辑保持不变
                        // （这里会被文件夹的ondrop处理，所以不需要在这里处理）
                    } catch(err) {
                        console.error("拖拽排序错误:", err);
                    }
                };

                const check = document.createElement("input");
                check.type = "checkbox"; check.checked = lora.enabled;
                check.onchange = () => { lora.enabled = check.checked; row.style.opacity = lora.enabled ? "1" : "0.5"; this.renderEmbeddedList(); this.updateWidget(); };
                check.addEventListener("pointerdown", (e)=>e.stopPropagation());
                check.addEventListener("mousedown", (e)=>e.stopPropagation());
                check.addEventListener("click", (e)=>e.stopPropagation());

                // 添加点击事件：点击lora行本身也能切换enabled状态
                row.onclick = (e) => {
                    // 排除交互元素：checkbox、input、button、备注框、权重控件
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' ||
                        e.target.classList.contains('mpl-mini-btn') ||
                        e.target.classList.contains('mpl-mini-input') ||
                        e.target === noteInput || e.target.closest('.mpl-mini-input') ||
                        e.target === weightContainer || e.target.closest('.mpl-weight-container')) {
                        return;
                    }
                    // 切换enabled状态
                    lora.enabled = !lora.enabled;
                    check.checked = lora.enabled;
                    row.style.opacity = lora.enabled ? "1" : "0.5";
                    this.renderEmbeddedList();
                    this.updateWidget();
                };

                // 添加鼠标悬停事件：显示缩略图预览
                // 使用节点级别的预览图管理，避免重复创建
                if (!this._previewTimeout) this._previewTimeout = null;
                if (!this._previewDiv) this._previewDiv = null;
                
                row.onmouseenter = (e) => {
                    // 先清理之前的预览图和定时器
                    if (this._previewTimeout) {
                        clearTimeout(this._previewTimeout);
                        this._previewTimeout = null;
                    }
                    if (this._previewDiv) {
                        this._previewDiv.remove();
                        this._previewDiv = null;
                    }
                    
                    // 延迟显示，避免快速移动时频繁创建
                    this._previewTimeout = setTimeout(() => {
                        // 再次检查，确保没有其他预览图
                        const existingPreviews = document.querySelectorAll('.mpl-lora-preview');
                        existingPreviews.forEach(p => p.remove());
                        
                        this._previewDiv = document.createElement("div");
                        this._previewDiv.className = "mpl-lora-preview";
                        this._previewDiv.style.cssText = `
                            position: fixed;
                            z-index: 10000;
                            background: #2a2a2a;
                            border: 2px solid #555;
                            border-radius: 4px;
                            padding: 8px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
                            pointer-events: none;
                            max-width: 300px;
                            max-height: 300px;
                        `;
                        
                        const img = document.createElement("img");
                        img.style.cssText = `
                            max-width: 300px;
                            max-height: 300px;
                            object-fit: contain;
                            display: block;
                        `;
                        
                        // 使用API获取预览图
                        const safeName = encodeURIComponent(lora.name);
                        img.src = api.apiURL(`/ma/lora/image?name=${safeName}`);
                        img.onerror = () => {
                            this._previewDiv.innerHTML = `<div style="padding:20px;color:#888;text-align:center;">${mplT("无预览图")}</div>`;
                        };
                        
                        this._previewDiv.appendChild(img);
                        document.body.appendChild(this._previewDiv);
                        
                        // 定位预览图在鼠标右侧，确保不超出屏幕边界
                        const rect = row.getBoundingClientRect();
                        const previewWidth = 300;
                        const previewHeight = 300;
                        const margin = 10;
                        
                        let left = rect.right + margin;
                        let top = rect.top;
                        
                        // 如果右侧空间不足，显示在左侧
                        if (left + previewWidth > window.innerWidth) {
                            left = rect.left - previewWidth - margin;
                        }
                        
                        // 如果下方空间不足，向上调整
                        if (top + previewHeight > window.innerHeight) {
                            top = window.innerHeight - previewHeight - margin;
                        }
                        
                        // 确保不超出左边界和上边界
                        left = Math.max(margin, left);
                        top = Math.max(margin, top);
                        
                        this._previewDiv.style.left = `${left}px`;
                        this._previewDiv.style.top = `${top}px`;
                        this._previewDiv.style.display = 'block';
                    }, 300); // 300ms延迟
                };
                
                row.onmouseleave = () => {
                    // 清理定时器
                    if (this._previewTimeout) {
                        clearTimeout(this._previewTimeout);
                        this._previewTimeout = null;
                    }
                    // 删除预览图元素
                    if (this._previewDiv) {
                        this._previewDiv.remove();
                        this._previewDiv = null;
                    }
                };
                
                row.onmousemove = (e) => {
                    // 鼠标移动时更新预览图位置，确保不超出屏幕边界
                    if (this._previewDiv && this._previewDiv.style.display !== 'none') {
                        const rect = row.getBoundingClientRect();
                        const previewWidth = 300;
                        const previewHeight = 300;
                        const margin = 10;
                        
                        let left = rect.right + margin;
                        let top = rect.top;
                        
                        // 如果右侧空间不足，显示在左侧
                        if (left + previewWidth > window.innerWidth) {
                            left = rect.left - previewWidth - margin;
                        }
                        
                        // 如果下方空间不足，向上调整
                        if (top + previewHeight > window.innerHeight) {
                            top = window.innerHeight - previewHeight - margin;
                        }
                        
                        // 确保不超出左边界和上边界
                        left = Math.max(margin, left);
                        top = Math.max(margin, top);
                        
                        this._previewDiv.style.left = `${left}px`;
                        this._previewDiv.style.top = `${top}px`;
                    }
                };

                // 排序条（汉堡菜单图标）- 作为拖拽手柄
                const sortHandle = document.createElement("div");
                sortHandle.className = "mpl-sort-handle";
                sortHandle.innerHTML = "☰";
                sortHandle.draggable = true;
                sortHandle.style.cssText = `
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: move;
                    color: #888;
                    font-size: 14px;
                    user-select: none;
                    margin-right: 4px;
                `;
                sortHandle.onmouseenter = () => {
                    sortHandle.style.color = "#ccc";
                };
                sortHandle.onmouseleave = () => {
                    sortHandle.style.color = "#888";
                };
                // 拖拽开始：标记这是排序拖拽
                sortHandle.ondragstart = (e) => {
                    e.stopPropagation();
                    const dragInfo = { 
                        type: 'sort', 
                        sourceType: type, 
                        sourceFIdx: fIdx, 
                        sourceLIdx: lIdx 
                    };
                    e.dataTransfer.setData("text/plain", JSON.stringify(dragInfo));
                    // 设置effectAllowed以便在ondragover中识别
                    e.dataTransfer.effectAllowed = "move";
                    // 使用自定义属性标记这是排序拖拽，并标识源类型
                    e.dataTransfer.setData("application/x-sort-drag", "true");
                    e.dataTransfer.setData("application/x-sort-source-type", type);
                    // 存储到节点级别，以便在ondragover中读取
                    this._currentSortDrag = dragInfo;
                    row.style.opacity = "0.3";
                };
                sortHandle.ondragend = () => {
                    row.style.opacity = lora.enabled ? "1" : "0.5";
                    // 清除拖拽信息
                    this._currentSortDrag = null;
                };
                sortHandle.addEventListener("pointerdown", (e)=>e.stopPropagation());
                sortHandle.addEventListener("mousedown", (e)=>e.stopPropagation());

                const name = document.createElement("div");
                name.className = "mpl-lora-name";
                // 提取文件名（隐藏路径），保留完整路径在title中
                const displayName = lora.name.split(/[/\\]/).pop() || lora.name;
                name.textContent = displayName;
                name.title = lora.name; // 鼠标悬停时显示完整路径
                // name区域也可以拖拽
                name.draggable = true;
                name.style.cursor = "move";
                name.ondragstart = (e) => {
                    e.dataTransfer.setData("text/plain", JSON.stringify({ type, fIdx, lIdx }));
                    row.style.opacity = "0.3";
                };
                name.ondragend = () => { 
                    row.style.opacity = lora.enabled ? "1" : "0.5"; 
                };

                // 备注输入框
                if (!lora.note) lora.note = "";
                const noteInput = document.createElement("input");
                noteInput.type = "text";
                noteInput.className = "mpl-note-input";
                noteInput.value = lora.note || "";
                noteInput.placeholder = "备注...";
                noteInput.style.cssText = `
                    flex: 1;
                    min-width: 80px;
                    padding: 4px 8px;
                    background: #1a1a1a;
                    border: 1px solid #555;
                    border-radius: 3px;
                    color: #fff;
                    font-size: 12px;
                `;
                noteInput.onchange = () => {
                    lora.note = noteInput.value;
                    this.updateWidget();
                };
                noteInput.onblur = () => {
                    lora.note = noteInput.value;
                    this.updateWidget();
                };
                noteInput.addEventListener("keydown", (e)=>e.stopPropagation());
                noteInput.addEventListener("pointerdown", (e)=>e.stopPropagation());
                noteInput.addEventListener("mousedown", (e)=>e.stopPropagation());

                // 权重调节器（带左右箭头按钮）
                const weightContainer = document.createElement("div");
                weightContainer.className = "mpl-weight-container";
                weightContainer.style.cssText = `
                    display: flex;
                    align-items: center;
                    background: #333;
                    border-radius: 3px;
                    border: 1px solid #555;
                    overflow: hidden;
                `;
                
                // 左箭头按钮（减少）
                const decreaseBtn = document.createElement("button");
                decreaseBtn.innerHTML = "◀";
                decreaseBtn.style.cssText = `
                    width: 18px;
                    height: 18px;
                    background: #444;
                    border: none;
                    color: #ccc;
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
                    this.updateWidget();
                };
                decreaseBtn.onmouseenter = () => decreaseBtn.style.background = "#555";
                decreaseBtn.onmouseleave = () => decreaseBtn.style.background = "#444";
                decreaseBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                // 权重显示
                const weightDisplay = document.createElement("div");
                weightDisplay.className = "mpl-weight-display";
                weightDisplay.textContent = parseFloat(lora.weight).toFixed(2);
                weightDisplay.style.cssText = `
                    min-width: 45px;
                    padding: 2px 6px;
                    text-align: center;
                    color: #fff;
                    font-size: 11px;
                    user-select: none;
                    background: #2a2a2a;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                weightDisplay.onclick = (e) => {
                    e.stopPropagation();
                    const newVal = prompt("输入权重:", lora.weight);
                    if (newVal !== null) {
                        const numVal = parseFloat(newVal);
                        if (!isNaN(numVal)) {
                            lora.weight = Math.max(-10, Math.min(10, numVal));
                            weightDisplay.textContent = lora.weight.toFixed(2);
                            this.updateWidget();
                        }
                    }
                };
                
                // 右箭头按钮（增加）
                const increaseBtn = document.createElement("button");
                increaseBtn.innerHTML = "▶";
                increaseBtn.style.cssText = `
                    width: 18px;
                    height: 18px;
                    background: #444;
                    border: none;
                    color: #ccc;
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
                    this.updateWidget();
                };
                increaseBtn.onmouseenter = () => increaseBtn.style.background = "#555";
                increaseBtn.onmouseleave = () => increaseBtn.style.background = "#444";
                increaseBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                weightContainer.appendChild(decreaseBtn);
                weightContainer.appendChild(weightDisplay);
                weightContainer.appendChild(increaseBtn);

                // ========== 滑条模式（追加在箭头模式之后） ==========
                const layoutCfg = this.layoutSettings || { weightStyle: "arrows" };
                if (layoutCfg.weightStyle === "slider") {
                    // 清空箭头模式的子元素
                    while (weightContainer.firstChild) weightContainer.removeChild(weightContainer.firstChild);

                    const sliderMin = layoutCfg.sliderMin ?? -2;
                    const sliderMax = layoutCfg.sliderMax ?? 2;
                    const sliderWidth = layoutCfg.sliderWidth ?? 110;
                    const sliderStep = layoutCfg.sliderStep ?? 0.05;
                    const showValue = layoutCfg.showWeightValue !== false;
                    const snapToZero = layoutCfg.snapToZero !== false;

                    // 给 weightContainer 设置固定宽度，防止被 row 的 flex 布局挤压
                    weightContainer.style.flexShrink = "0";
                    weightContainer.style.width = (sliderWidth + (showValue ? 46 : 0)) + "px";

                    // 滑条更新函数
                    const applySliderWeight = (newVal) => {
                        const clamped = Math.max(sliderMin, Math.min(sliderMax, newVal));
                        lora.weight = parseFloat(clamped.toFixed(2));
                        updateSliderUI();
                        this.updateWidget();
                    };

                    // 滑条轨道
                    const track = document.createElement("div");
                    track.style.cssText = `
                        position: relative;
                        flex: 1 1 0;
                        min-width: 0;
                        height: 22px;
                        background: #2a2a2a;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        padding: 0 6px;
                        box-sizing: border-box;
                    `;

                    const zeroLine = document.createElement("div");
                    zeroLine.style.cssText = `
                        position: absolute;
                        left: 50%;
                        top: 4px;
                        bottom: 4px;
                        width: 1px;
                        background: #555;
                        pointer-events: none;
                    `;
                    track.appendChild(zeroLine);

                    const fill = document.createElement("div");
                    fill.style.cssText = `
                        position: absolute;
                        top: 9px;
                        height: 4px;
                        background: #2196F3;
                        border-radius: 2px;
                        pointer-events: none;
                    `;
                    track.appendChild(fill);

                    const thumb = document.createElement("div");
                    thumb.style.cssText = `
                        position: absolute;
                        top: 50%;
                        width: 10px;
                        height: 14px;
                        background: #fff;
                        border: 1px solid #2196F3;
                        border-radius: 2px;
                        transform: translate(-50%, -50%);
                        cursor: grab;
                        pointer-events: none;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                    `;
                    track.appendChild(thumb);

                    const valueDisplay = document.createElement("div");
                    valueDisplay.className = "mpl-weight-display";
                    valueDisplay.textContent = parseFloat(lora.weight).toFixed(2);
                    valueDisplay.style.cssText = `
                        min-width: 38px;
                        padding: 2px 4px;
                        text-align: center;
                        color: #fff;
                        font-size: 11px;
                        user-select: none;
                        background: #1a1a1a;
                        height: 22px;
                        display: ${showValue ? "flex" : "none"};
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        border-left: 1px solid #444;
                        flex-shrink: 0;
                    `;
                    valueDisplay.onclick = (e) => {
                        e.stopPropagation();
                        const newVal = prompt("输入权重:", lora.weight);
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
                        thumb.style.left = pct + "%";
                        if (lora.weight >= 0) {
                            fill.style.left = "50%";
                            fill.style.width = (pct - 50) + "%";
                            fill.style.background = "#2196F3";
                        } else {
                            fill.style.left = pct + "%";
                            fill.style.width = (50 - pct) + "%";
                            fill.style.background = "#f44336";
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

                const tagBtn = document.createElement("button");
                tagBtn.className = `mpl-mini-btn tag ${lora.tags ? 'active' : ''}`;
                tagBtn.textContent = "🏷️";
                tagBtn.onclick = () => {
                    this.showTagEditModal(lora);
                };
                tagBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                // 编辑按钮（蓝色背景，铅笔图标）
                const editBtn = document.createElement("button");
                editBtn.className = "mpl-mini-btn edit";
                editBtn.innerHTML = "✎";
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showLoraEditModal(lora, type, fIdx, lIdx);
                };
                editBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                const del = document.createElement("button");
                del.className = "mpl-mini-btn del";
                del.textContent = "×";
                del.addEventListener("pointerdown", (e)=>e.stopPropagation());
                
                // 阻止在交互元素上拖拽
                const preventDrag = (e) => {
                    e.stopPropagation();
                    if (e.target === check || e.target === noteInput || 
                        e.target === weightContainer || e.target.closest('.mpl-weight-container') ||
                        e.target === tagBtn || e.target === editBtn || e.target === del ||
                        e.target === decreaseBtn || e.target === increaseBtn || e.target === weightDisplay) {
                        e.preventDefault();
                        return false;
                    }
                };
                
                // 为交互元素添加阻止拖拽的事件
                check.addEventListener("dragstart", preventDrag);
                noteInput.addEventListener("dragstart", preventDrag);
                weightContainer.addEventListener("dragstart", preventDrag);
                tagBtn.addEventListener("dragstart", preventDrag);
                editBtn.addEventListener("dragstart", preventDrag);
                del.addEventListener("dragstart", preventDrag);
                
                row.append(sortHandle, check, name, dragArea, noteInput, weightContainer, tagBtn, editBtn, del);
                return row;
            };

            nodeType.prototype.addFolder = function() {
                // 获取所有现有文件夹名称
                const existingNames = this.loraData.folders.map(f => f.name);
                
                // 查找所有以"空白文件夹"开头的文件夹，提取编号
                const blankFolderPattern = /^空白文件夹(\d+)$/;
                const blankFolderNumbers = existingNames
                    .map(name => {
                        const match = name.match(blankFolderPattern);
                        return match ? parseInt(match[1], 10) : null;
                    })
                    .filter(num => num !== null)
                    .sort((a, b) => a - b);
                
                // 确定新文件夹的编号
                let newNumber = 1;
                if (blankFolderNumbers.length > 0) {
                    // 找到连续编号中的最大编号
                    let maxNumber = blankFolderNumbers[blankFolderNumbers.length - 1];
                    // 检查是否有缺失的编号（比如有1,2,4，缺失3）
                    for (let i = 1; i <= maxNumber; i++) {
                        if (!blankFolderNumbers.includes(i)) {
                            newNumber = i;
                            break;
                        }
                    }
                    // 如果没有缺失的编号，使用最大编号+1
                    if (newNumber === 1 && blankFolderNumbers.includes(1)) {
                        newNumber = maxNumber + 1;
                    }
                }
                
                // 创建新文件夹名称
                const newFolderName = `空白文件夹${newNumber}`;
                
                // 确保不会重名（双重检查）
                if (!existingNames.includes(newFolderName)) {
                    this.loraData.folders.push({ name: newFolderName, loras: [], collapsed: false });
                    this.renderEmbeddedList();
                    this.updateWidget();
                } else {
                    // 如果意外重名，尝试下一个编号
                    let fallbackNumber = newNumber + 1;
                    while (existingNames.includes(`空白文件夹${fallbackNumber}`)) {
                        fallbackNumber++;
                    }
                    this.loraData.folders.push({ name: `空白文件夹${fallbackNumber}`, loras: [], collapsed: false });
                    this.renderEmbeddedList();
                    this.updateWidget();
                }
            };

            nodeType.prototype.showAddLoraModal = async function() {
                try {
                    // 刷新全局图片列表缓存（类似参考代码的loadImageList）
                    await loadLoraImageList();
                    
                    // 生成时间戳来强制刷新所有图片缓存
                    const cacheTimestamp = new Date().getTime();
                    
                    const resp = await api.fetchApi("/ma/lora/list");
                    const data = await resp.json();
                    const allFiles = data.files || [];
                    
                    // 构建文件夹树结构
                    const folderTree = {};
                    const rootFiles = [];
                    
                    allFiles.forEach(file => {
                        const parts = file.split(/[/\\]/);
                        if (parts.length === 1) {
                            rootFiles.push(file);
                        } else {
                            // 构建文件夹路径
                            let current = folderTree;
                            for (let i = 0; i < parts.length - 1; i++) {
                                const folderName = parts[i];
                                if (!current[folderName]) {
                                    current[folderName] = { files: [], folders: {} };
                                }
                                if (i === parts.length - 2) {
                                    // 最后一个文件夹，添加文件
                                    current[folderName].files.push(file);
                                } else {
                                    // 继续深入到子文件夹
                                    if (!current[folderName].folders) {
                                        current[folderName].folders = {};
                                    }
                                    current = current[folderName].folders;
                                }
                            }
                        }
                    });
                    
                    // 当前路径状态
                    let currentPath = [];
                    let selectedFiles = new Set();
                    let autoAddTag = false;
                    let showAllMode = false; // 全部模式：显示所有lora，不按路径分类
                    
                    const dialog = document.createElement("div");
                    // 初始居中定位，拖拽后会改为transform定位
                    const centerX = window.innerWidth / 2 - 400;
                    const centerY = window.innerHeight / 2 - 400;
                    dialog.style.cssText = `position:fixed;top:${centerY}px;left:${centerX}px;width:800px;height:800px;background:#25292d;border:1px solid #4a515a;z-index:9999;display:flex;flex-direction:column;border-radius:8px;box-shadow:0 8px 25px rgba(0,0,0,0.6);font-family: sans-serif;`;
                    
                    dialog.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: false });
                    const stopEvent = (e) => { e.stopPropagation(); };
                    dialog.addEventListener("pointerdown", stopEvent);
                    dialog.addEventListener("pointermove", stopEvent);
                    dialog.addEventListener("pointerup", stopEvent);
                    dialog.addEventListener("mousedown", stopEvent);
                    dialog.addEventListener("keydown", stopEvent);

                    // 标题栏
                    const header = document.createElement("div");
                    header.style.cssText = "padding:10px 15px;border-bottom:1px solid #333;display:flex;gap:10px;align-items:center;background:#1a1a1a;border-radius:8px 8px 0 0;cursor:move;user-select:none;";
                    
                    const title = document.createElement("div");
                    title.textContent = "添加 Lora";
                    title.style.cssText = "color:#e0e0e0;font-weight:bold;font-size:14px;white-space:nowrap;flex:1;";
                    
                    header.appendChild(title);
                    dialog.appendChild(header);
                    
                    // 路径导航栏
                    const pathBar = document.createElement("div");
                    pathBar.style.cssText = "padding:8px 15px;border-bottom:1px solid #333;background:#222;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
                    
                    const allTab = document.createElement("div");
                    allTab.textContent = "全部";
                    allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                    allTab.onclick = () => {
                        if (showAllMode) {
                            // 取消全部模式，回到路径选择模式
                            showAllMode = false;
                            allTab.textContent = "全部";
                            allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                            currentPath = [];
                            renderContent();
                        } else {
                            // 进入全部模式，显示所有lora
                            showAllMode = true;
                            allTab.textContent = "取消全部";
                            allTab.style.cssText = "padding:4px 8px;background:#f44336;border:1px solid #f44336;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;";
                            renderContent();
                        }
                    };
                    pathBar.appendChild(allTab);
                    
                    const pathDisplay = document.createElement("div");
                    pathDisplay.style.cssText = "color:#888;font-size:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;";
                    
                    const updatePathDisplay = () => {
                        pathDisplay.innerHTML = "";
                        if (showAllMode) {
                            // 全部模式下不显示路径
                            return;
                        }
                        if (currentPath.length === 0) {
                            const rootSpan = document.createElement("span");
                            rootSpan.textContent = "根目录";
                            rootSpan.style.cssText = "color:#4CAF50;cursor:pointer;text-decoration:underline;";
                            rootSpan.onclick = () => {
                                if (showAllMode) {
                                    showAllMode = false;
                                    allTab.textContent = "全部";
                                    allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                                }
                                currentPath = [];
                                renderContent();
                            };
                            rootSpan.onmouseenter = () => rootSpan.style.color = "#5CBF60";
                            rootSpan.onmouseleave = () => rootSpan.style.color = "#4CAF50";
                            pathDisplay.appendChild(rootSpan);
                        } else {
                            // 添加"根目录"作为第一个可点击项
                            const rootSpan = document.createElement("span");
                            rootSpan.textContent = "根目录";
                            rootSpan.style.cssText = "color:#4CAF50;cursor:pointer;text-decoration:underline;";
                            rootSpan.onclick = () => {
                                if (showAllMode) {
                                    showAllMode = false;
                                    allTab.textContent = "全部";
                                    allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                                }
                                currentPath = [];
                                renderContent();
                            };
                            rootSpan.onmouseenter = () => rootSpan.style.color = "#5CBF60";
                            rootSpan.onmouseleave = () => rootSpan.style.color = "#4CAF50";
                            pathDisplay.appendChild(rootSpan);
                            
                            const separator1 = document.createElement("span");
                            separator1.textContent = " > ";
                            separator1.style.cssText = "color:#666;";
                            pathDisplay.appendChild(separator1);
                            
                            currentPath.forEach((folderName, index) => {
                                const pathItem = document.createElement("span");
                                pathItem.textContent = folderName;
                                pathItem.style.cssText = "color:#4CAF50;cursor:pointer;text-decoration:underline;";
                                pathItem.onclick = () => {
                                    if (showAllMode) {
                                        showAllMode = false;
                                        allTab.textContent = "全部";
                                        allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                                    }
                                    currentPath = currentPath.slice(0, index + 1);
                                    renderContent();
                                };
                                pathItem.onmouseenter = () => pathItem.style.color = "#5CBF60";
                                pathItem.onmouseleave = () => pathItem.style.color = "#4CAF50";
                                pathDisplay.appendChild(pathItem);
                                
                                if (index < currentPath.length - 1) {
                                    const separator = document.createElement("span");
                                    separator.textContent = " > ";
                                    separator.style.cssText = "color:#666;";
                                    pathDisplay.appendChild(separator);
                                }
                            });
                        }
                    };
                    
                    updatePathDisplay();
                    pathBar.appendChild(pathDisplay);
                    
                    dialog.appendChild(pathBar);
                    
                    // 搜索和工具栏
                    const toolbar = document.createElement("div");
                    toolbar.style.cssText = "padding:10px 15px;border-bottom:1px solid #333;background:#1a1a1a;display:flex;gap:10px;align-items:center;";
                    
                    // 搜索框（缩小）
                    const search = document.createElement("input");
                    search.placeholder = "🔍 搜索当前目录...（如需全部搜索请打开“全部”开关）";
                    search.style.cssText = "width:400px;padding:6px 10px;background:#121212;color:#fff;border:1px solid #444;border-radius:4px;outline:none;font-size:13px;";
                    search.addEventListener("keydown", (e) => { e.stopPropagation(); });
                    search.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
                    
                    // 自动添加tag开关
                    const autoTagContainer = document.createElement("div");
                    autoTagContainer.style.cssText = "display:flex;align-items:center;gap:8px;";
                    
                    const autoTagLabel = document.createElement("span");
                    autoTagLabel.textContent = "自动添加已获取的触发词";
                    autoTagLabel.style.cssText = "color:#ccc;font-size:12px;";
                    
                    const autoTagToggle = document.createElement("label");
                    autoTagToggle.style.cssText = `
                        position: relative;
                        display: inline-block;
                        width: 44px;
                        height: 24px;
                        cursor: pointer;
                    `;
                    
                    const toggleInput = document.createElement("input");
                    toggleInput.type = "checkbox";
                    toggleInput.style.cssText = "opacity:0;width:0;height:0;";
                    toggleInput.checked = autoAddTag;
                    
                    const toggleSlider = document.createElement("span");
                    toggleSlider.style.cssText = `
                        position: absolute;
                        cursor: pointer;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background-color: #444;
                        transition: .4s;
                        border-radius: 24px;
                    `;
                    
                    const toggleKnob = document.createElement("span");
                    toggleKnob.style.cssText = `
                        position: absolute;
                        content: "";
                        height: 18px;
                        width: 18px;
                        left: 3px;
                        bottom: 3px;
                        background-color: white;
                        transition: .4s;
                        border-radius: 50%;
                    `;
                    
                    if (autoAddTag) {
                        toggleSlider.style.backgroundColor = "#4CAF50";
                        toggleKnob.style.transform = "translateX(20px)";
                    }
                    
                    toggleInput.onchange = (e) => {
                        autoAddTag = e.target.checked;
                        if (autoAddTag) {
                            toggleSlider.style.backgroundColor = "#4CAF50";
                            toggleKnob.style.transform = "translateX(20px)";
                        } else {
                            toggleSlider.style.backgroundColor = "#444";
                            toggleKnob.style.transform = "translateX(0)";
                        }
                    };
                    
                    toggleSlider.appendChild(toggleKnob);
                    autoTagToggle.appendChild(toggleInput);
                    autoTagToggle.appendChild(toggleSlider);
                    
                    autoTagContainer.appendChild(autoTagLabel);
                    autoTagContainer.appendChild(autoTagToggle);
                    
                    toolbar.appendChild(search);
                    toolbar.appendChild(autoTagContainer);
                    dialog.appendChild(toolbar);
                    
                    // 内容区域
                    const content = document.createElement("div");
                    content.style.cssText = "flex:1;overflow-y:auto;padding:10px;background:#1f1f1f;display:grid;grid-template-columns:repeat(auto-fill, minmax(110px, 1fr));grid-auto-rows:165px;gap:8px;align-content:start;overscroll-behavior: contain;";
                    dialog.appendChild(content);
                    
                    // 底部状态栏
                    const footer = document.createElement("div");
                    footer.style.cssText = "padding:10px 15px;border-top:1px solid #333;background:#1a1a1a;display:flex;align-items:center;justify-content:space-between;border-radius:0 0 8px 8px;";
                    
                    const selectedCount = document.createElement("div");
                    selectedCount.style.cssText = "color:#ccc;font-size:13px;";
                    selectedCount.textContent = "已选择 0 个 LoRA";
                    
                    const footerButtons = document.createElement("div");
                    footerButtons.style.cssText = "display:flex;gap:10px;align-items:center;";
                    
                    const detectBtn = document.createElement("button");
                    detectBtn.type = "button";
                    detectBtn.textContent = "🚨 LoRA 检测";
                    detectBtn.title = "检测重复文件（哈希）与 LoRA 更新（Civitai）";
                    detectBtn.style.cssText = "padding:8px 16px;background:#455a64;border:1px solid #607d8b;color:#eceff1;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap;";
                    detectBtn.onmouseenter = () => { detectBtn.style.background = "#546e7a"; detectBtn.style.borderColor = "#78909c"; };
                    detectBtn.onmouseleave = () => { detectBtn.style.background = "#455a64"; detectBtn.style.borderColor = "#607d8b"; };
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
                    addBtn.textContent = "添加选中 LoRA";
                    addBtn.style.cssText = "padding:8px 16px;background:#4CAF50;border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px;";
                    addBtn.onmouseenter = () => addBtn.style.background = "#5CBF60";
                    addBtn.onmouseleave = () => addBtn.style.background = "#4CAF50";
                    
                    const closeBtn = document.createElement("button");
                    closeBtn.textContent = "关闭";
                    closeBtn.style.cssText = "padding:8px 16px;background:#666;border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px;";
                    closeBtn.onmouseenter = () => closeBtn.style.background = "#777";
                    closeBtn.onmouseleave = () => closeBtn.style.background = "#666";
                    
                    footerButtons.appendChild(detectBtn);
                    footerButtons.appendChild(addBtn);
                    footerButtons.appendChild(closeBtn);
                    footer.appendChild(selectedCount);
                    footer.appendChild(footerButtons);
                    dialog.appendChild(footer);
                    
                    // 创建Lora卡片
                    const createLoraCard = (f) => {
                            const card = document.createElement("div");
                            const isSelected = selectedFiles.has(f);
                            card.style.cssText = `
                                width:100%;
                                height:100%;
                                background:${isSelected ? '#2a3a2a' : '#2a2a2a'};
                                border-radius:6px;
                                overflow:hidden;
                                cursor:pointer;
                                border:${isSelected ? '3px solid #4CAF50' : '2px solid #444'};
                                transition:all 0.3s;
                                position:relative;
                                display:flex;
                                flex-direction:column;
                                box-shadow:${isSelected ? '0 0 16px rgba(76, 175, 80, 0.4)' : 'none'};
                                transform:${isSelected ? 'scale(0.98)' : 'scale(1)'};
                            `;
                            card.title = f;
                            card.dataset.selected = isSelected;
                        
                        // 点击卡片切换选中状态
                        card.onclick = (e) => {
                            // 如果点击的是编辑按钮，不切换选中状态
                            if (e.target.closest('button') && e.target.closest('button').innerHTML === "✎") {
                                return;
                            }
                            e.stopPropagation();
                            const wasSelected = selectedFiles.has(f);
                            if (wasSelected) {
                                selectedFiles.delete(f);
                            } else {
                                selectedFiles.add(f);
                            }
                            // 更新卡片样式
                            const nowSelected = selectedFiles.has(f);
                            card.dataset.selected = nowSelected;
                            card.style.background = nowSelected ? '#2a3a2a' : '#2a2a2a';
                            card.style.border = nowSelected ? '3px solid #4CAF50' : '2px solid #444';
                            card.style.boxShadow = nowSelected ? '0 0 16px rgba(76, 175, 80, 0.4)' : 'none';
                            card.style.transform = nowSelected ? 'scale(0.98)' : 'scale(1)';
                            updateSelectedCount();
                        };
                        
                        card.onmouseover = () => { 
                            if (!selectedFiles.has(f)) {
                                card.style.borderColor = "#4CAF50"; 
                                card.style.boxShadow = "0 0 12px rgba(76, 175, 80, 0.3)"; 
                            } else {
                                card.style.boxShadow = "0 0 20px rgba(76, 175, 80, 0.5)";
                            }
                        };
                        card.onmouseout = () => { 
                            const isSelected = selectedFiles.has(f);
                            card.style.borderColor = isSelected ? "#4CAF50" : "#444"; 
                            card.style.boxShadow = isSelected ? "0 0 16px rgba(76, 175, 80, 0.4)" : "none"; 
                        };
                            
                            const imgBox = document.createElement("div");
                            imgBox.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#111;z-index:0;";
                            
                            const img = document.createElement("img");
                            img.style.cssText = "width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;display:block;";
                            img.loading = "lazy";
                        const spinner = document.createElement("div"); 
                        spinner.className = "mpl-spinner"; 
                        imgBox.appendChild(spinner);
                            const safeName = encodeURIComponent(f);
                            // 添加时间戳来强制刷新缓存
                            img.src = api.apiURL(`/ma/lora/image?name=${safeName}&t=${cacheTimestamp}`);
                            img.onload = () => { img.style.opacity = "1"; spinner.remove(); };
                            img.onerror = () => {
                                img.style.display = "none"; spinner.remove();
                            const fallback = document.createElement("div"); 
                            fallback.innerHTML = "No Image";
                                fallback.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#444;font-size:12px;background:#252525;";
                                imgBox.appendChild(fallback);
                            };
                            imgBox.appendChild(img);
                            
                            const nameBox = document.createElement("div");
                            nameBox.style.cssText = "position:absolute;bottom:0;left:0;width:100%;padding:4px 6px;font-size:11px;color:#eee;background:rgba(0,0,0,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;z-index:1;text-align:center;backdrop-filter:blur(2px);";
                        nameBox.textContent = f.split(/[/\\]/).pop().replace(/\.(safetensors|pt|ckpt)$/, "");

                        // 编辑按钮（右上角，蓝色方形，铅笔图标）
                        const editBtn = document.createElement("button");
                        editBtn.innerHTML = "✎";
                        editBtn.style.cssText = `
                            position: absolute;
                            top: 4px;
                            right: 4px;
                            width: 24px;
                            height: 24px;
                            background: #2196F3;
                            border: none;
                            border-radius: 4px;
                            color: white;
                            cursor: pointer;
                            font-size: 14px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            z-index: 10;
                            padding: 0;
                            line-height: 1;
                        `;
                        editBtn.onclick = (e) => {
                            e.stopPropagation();
                            // 创建临时lora对象用于编辑
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
                            // 检查是否已经在节点中
                            let existingLora = null;
                            let existingType = null;
                            let existingFIdx = -1;
                            let existingLIdx = -1;
                            
                            // 在根loras中查找
                            for (let i = 0; i < this.loraData.loras.length; i++) {
                                if (this.loraData.loras[i].name === f) {
                                    existingLora = this.loraData.loras[i];
                                    existingType = 'root';
                                    existingLIdx = i;
                                    break;
                                }
                            }
                            
                            // 在文件夹中查找
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
                            
                            // 如果找到了，使用现有的lora；否则使用临时的
                            const loraToEdit = existingLora || tempLora;
                            
                            // 打开编辑弹窗
                            this.showLoraEditModal(
                                loraToEdit, 
                                existingType || 'root', 
                                existingFIdx, 
                                existingLIdx,
                                f  // 传递文件路径，用于判断是否需要添加
                            );
                        };
                        editBtn.onmouseenter = () => editBtn.style.background = "#42A5F5";
                        editBtn.onmouseleave = () => editBtn.style.background = "#2196F3";
                        editBtn.addEventListener("pointerdown", (e)=>e.stopPropagation());

                            card.appendChild(imgBox);
                            card.appendChild(nameBox);
                        card.appendChild(editBtn);
                        return card;
                    };
                    
                    // 获取当前路径下的文件和文件夹
                    const getCurrentFolder = () => {
                        if (currentPath.length === 0) {
                            return { files: rootFiles, folders: folderTree };
                        }
                        let current = folderTree;
                        for (let i = 0; i < currentPath.length; i++) {
                            const folderName = currentPath[i];
                            if (current[folderName]) {
                                if (i === currentPath.length - 1) {
                                    // 到达目标文件夹
                                    return { files: current[folderName].files || [], folders: current[folderName].folders || {} };
                                } else {
                                    // 继续深入
                                    current = current[folderName].folders || {};
                                }
                            } else {
                                return { files: [], folders: {} };
                            }
                        }
                        return { files: [], folders: {} };
                    };
                    
                    // 渲染内容
                    const renderContent = () => {
                        content.innerHTML = "";
                        const filter = search.value.toLowerCase();
                        
                        // 更新路径显示
                        updatePathDisplay();
                        
                        // 全部模式：显示所有lora文件
                        if (showAllMode) {
                            allFiles.forEach(f => {
                                if (filter && !f.toLowerCase().includes(filter)) return;
                                
                                const card = createLoraCard(f);
                                content.appendChild(card);
                            });
                            return;
                        }
                        
                        // 路径选择模式：显示当前路径下的文件夹和文件
                        const current = getCurrentFolder();
                        const folders = Object.keys(current.folders || {});
                        const files = current.files || [];
                        
                        // 显示文件夹
                        folders.forEach(folderName => {
                            const folderCard = document.createElement("div");
                            folderCard.style.cssText = "width:100%;height:100%;background:#2a2a2a;border-radius:4px;overflow:hidden;cursor:pointer;border:1px solid #444;transition:0.2s;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;";
                            
                            const folderIcon = document.createElement("div");
                            folderIcon.textContent = "📁";
                            folderIcon.style.cssText = "font-size:48px;margin-bottom:8px;";
                            
                            const folderNameEl = document.createElement("div");
                            folderNameEl.textContent = folderName;
                            folderNameEl.style.cssText = "color:#eee;font-size:11px;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;";
                            
                            folderCard.appendChild(folderIcon);
                            folderCard.appendChild(folderNameEl);
                            folderCard.onclick = () => {
                                if (showAllMode) {
                                    showAllMode = false;
                                    allTab.textContent = "全部";
                                    allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                                }
                                currentPath.push(folderName);
                                renderContent();
                            };
                            folderCard.onmouseover = () => { folderCard.style.borderColor = "#4CAF50"; };
                            folderCard.onmouseout = () => { folderCard.style.borderColor = "#444"; };
                            
                            content.appendChild(folderCard);
                        });
                        
                        // 显示文件
                        files.forEach(f => {
                            if (filter && !f.toLowerCase().includes(filter)) return;
                            
                            const card = createLoraCard(f);
                            content.appendChild(card);
                        });
                    };
                    
                    // 刷新文件列表的函数（用于删除后刷新）
                    const refreshFileList = async () => {
                        try {
                            // 重新获取文件列表
                            const resp = await api.fetchApi("/ma/lora/list");
                            const data = await resp.json();
                            const newAllFiles = data.files || [];
                            
                            // 重新构建文件夹树结构
                            const newFolderTree = {};
                            const newRootFiles = [];
                            
                            newAllFiles.forEach(file => {
                                const parts = file.split(/[/\\]/);
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
                            
                            // 更新变量
                            allFiles.length = 0;
                            allFiles.push(...newAllFiles);
                            Object.keys(folderTree).forEach(key => delete folderTree[key]);
                            Object.assign(folderTree, newFolderTree);
                            rootFiles.length = 0;
                            rootFiles.push(...newRootFiles);
                            
                            // 重新渲染
                            renderContent();
                        } catch (e) {
                            console.error("刷新文件列表时出错:", e);
                        }
                    };
                    
                    // 保存renderContent函数引用，以便在爬取成功后可以调用
                    this._renderContentFunc = renderContent;
                    // 保存refreshFileList函数引用，以便在删除后可以调用
                    this._refreshFileListFunc = refreshFileList;
                    this._addLoraModal = dialog;
                    
                    // 更新选中数量
                    const updateSelectedCount = () => {
                        selectedCount.textContent = `已选择 ${selectedFiles.size} 个 LoRA`;
                    };
                    
                    // 搜索功能
                    search.oninput = () => {
                        renderContent();
                    };
                    
                    // 添加按钮
                    addBtn.onclick = async () => {
                        // 辅助函数：从.log文件中解析preferred weight
                        const parsePreferredWeight = (logContent) => {
                            if (!logContent || !logContent.trim()) return null;
                            try {
                                // 首先尝试作为JSON解析
                                try {
                                    const jsonData = JSON.parse(logContent);
                                    // 查找 preferred weight 字段（支持多种可能的字段名）
                                    const preferredWeight = jsonData["preferred weight"] || 
                                                          jsonData["preferredWeight"] || 
                                                          jsonData["preferred_weight"] ||
                                                          jsonData["weight"];
                                    
                                    if (preferredWeight !== undefined && !isNaN(parseFloat(preferredWeight))) {
                                        const weightValue = parseFloat(preferredWeight);
                                        // 确保权重值在合理范围内 (-10 到 10)
                                        if (weightValue >= -10 && weightValue <= 10) {
                                            return weightValue;
                                        }
                                    }
                                } catch (jsonError) {
                                    // 如果不是JSON格式，尝试使用正则表达式匹配
                                    const weightPattern = /preferred\s+weight[:\s=]+([+-]?\d*\.?\d+)/i;
                                    const match = logContent.match(weightPattern);
                                    if (match && match[1]) {
                                        const weight = parseFloat(match[1]);
                                        if (!isNaN(weight)) {
                                            // 限制权重范围在-10到10之间
                                            return Math.max(-10, Math.min(10, weight));
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error("解析preferred weight时出错:", e);
                            }
                            return null;
                        };
                        
                        // 并行读取所有选中lora的.log文件，获取preferred weight
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
                        
                        // 创建weight映射，方便查找
                        const weightMap = new Map();
                        weightResults.forEach(({ fileName, preferredWeight }) => {
                            weightMap.set(fileName, preferredWeight);
                        });
                        
                        // 如果启用了自动添加触发词，需要先读取所有选中lora的.txt文件
                        if (autoAddTag) {
                            // 并行读取所有选中lora的.txt文件
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
                            
                            // 创建tag映射，方便查找
                            const tagMap = new Map();
                            tagResults.forEach(({ fileName, tags }) => {
                                tagMap.set(fileName, tags);
                            });
                            
                            // 添加lora，使用读取到的tags和preferred weight
                            selectedFiles.forEach(fileName => {
                                const preferredWeight = weightMap.get(fileName);
                                this.loraData.loras.push({ 
                                    name: fileName, 
                                    weight: preferredWeight !== null ? preferredWeight : 1.0, 
                                    enabled: true, 
                                    tags: tagMap.get(fileName) || "", 
                                    note: "" 
                                });
                            });
                        } else {
                            // 不启用自动添加，直接添加lora，但使用preferred weight
                            selectedFiles.forEach(fileName => {
                                const preferredWeight = weightMap.get(fileName);
                                this.loraData.loras.push({ 
                                    name: fileName, 
                                    weight: preferredWeight !== null ? preferredWeight : 1.0, 
                                    enabled: true, 
                                    tags: "", 
                                    note: "" 
                                });
                            });
                        }
                        
                                this.renderEmbeddedList();
                                this.updateWidget();
                                document.body.removeChild(dialog);
                            };
                    
                    // 关闭按钮
                    closeBtn.onclick = () => {
                        document.body.removeChild(dialog);
                    };
                    
                    // ESC键关闭
                    const handleEsc = (e) => {
                        if (e.key === "Escape") {
                            document.body.removeChild(dialog);
                            document.removeEventListener("keydown", handleEsc);
                        }
                    };
                    document.addEventListener("keydown", handleEsc);
                    
                    // 初始渲染
                    renderContent();
                    document.body.appendChild(dialog);
                    
                    // 使弹窗可拖拽
                    this.makeDialogDraggable(dialog, header);
                } catch(e) { alert("Error: "+e); }
            };

            nodeType.prototype.showLoraDetectModal = async function(opts) {
                opts = opts || {};
                let currentPath = Array.isArray(opts.initialPath) ? opts.initialPath.slice() : [];
                let showAllMode = !!opts.initialShowAll;
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

                    // 直接挂 body，不用 overlay（参考 magic_resolution.js 的做法）
                    const dialog = document.createElement("div");
                    dialog.style.cssText = `
                        position: fixed;
                        top: 50%; left: 50%;
                        transform: translate(-50%, -50%);
                        width: min(720px, 96vw);
                        max-height: 88vh;
                        background: #25292d;
                        border: 1px solid #4a515a;
                        border-radius: 8px;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.75);
                        display: flex;
                        flex-direction: column;
                        font-family: sans-serif;
                        color: #e0e0e0;
                        z-index: 10050;
                        overflow: hidden;
                    `;

                    const header = document.createElement("div");
                    header.style.cssText = "padding:12px 16px;border-bottom:1px solid #333;background:#1a1a1a;border-radius:8px 8px 0 0;cursor:move;user-select:none;display:flex;justify-content:space-between;align-items:center;";
                    const title = document.createElement("div");
                    title.textContent = "LoRA 检测（重复 + 更新）";
                    title.style.cssText = "font-weight:bold;font-size:15px;";
                    const closeX = document.createElement("button");
                    closeX.textContent = "✕";
                    closeX.style.cssText = "background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;padding:0 8px;";
                    header.appendChild(title);
                    header.appendChild(closeX);

                    const pathBar = document.createElement("div");
                    pathBar.style.cssText = "padding:8px 16px;border-bottom:1px solid #333;background:#222;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
                    const allTab = document.createElement("div");
                    allTab.textContent = "全部";
                    allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                    const pathDisplay = document.createElement("div");
                    pathDisplay.style.cssText = "color:#888;font-size:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;flex:1;";

                    const scopeHint = document.createElement("div");
                    scopeHint.style.cssText = "padding:8px 16px;background:#1e2428;font-size:12px;color:#90caf9;border-bottom:1px solid #333;";

                    const folderRow = document.createElement("div");
                    folderRow.style.cssText = "padding:8px 16px;border-bottom:1px solid #333;background:#1a1a1a;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-height:100px;overflow-y:auto;";

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
                        if (showAllMode) {
                            scopeHint.textContent = "检测范围：全部 LoRA 文件（可能较慢）";
                            allTab.textContent = "取消全部";
                            allTab.style.cssText = "padding:4px 8px;background:#f44336;border:1px solid #f44336;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;";
                            pathDisplay.innerHTML = "";
                            folderRow.innerHTML = "<span style='color:#888;font-size:12px;'>全部模式下可点击下方「开始检测」扫描所有目录。</span>";
                            return;
                        }
                        allTab.textContent = "全部";
                        allTab.style.cssText = "padding:4px 8px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
                        if (currentPath.length === 0) {
                            scopeHint.textContent = "检测范围：根目录 — 仅 loras 根下的文件（不包含子文件夹内文件）。进入子文件夹可检测该文件夹及其下所有子目录。";
                        } else {
                            scopeHint.textContent = "检测范围：文件夹「" + currentPath.join("/") + "」及其所有子目录内的 LoRA。";
                        }
                        pathDisplay.innerHTML = "";
                        const rootSpan = document.createElement("span");
                        rootSpan.textContent = "根目录";
                        rootSpan.style.cssText = "color:#4CAF50;cursor:pointer;text-decoration:underline;";
                        rootSpan.onclick = () => { showAllMode = false; currentPath = []; updateScopeUI(); };
                        pathDisplay.appendChild(rootSpan);
                        currentPath.forEach((folderName, index) => {
                            const sep = document.createElement("span");
                            sep.textContent = " > ";
                            sep.style.color = "#666";
                            pathDisplay.appendChild(sep);
                            const sp = document.createElement("span");
                            sp.textContent = folderName;
                            sp.style.cssText = "color:#4CAF50;cursor:pointer;text-decoration:underline;";
                            sp.onclick = () => { currentPath = currentPath.slice(0, index + 1); updateScopeUI(); };
                            pathDisplay.appendChild(sp);
                        });
                        folderRow.innerHTML = "";
                        const subs = mplGetSubfolderNames(folderTree, currentPath);
                        if (!subs.length) {
                            const t = document.createElement("span");
                            t.style.cssText = "color:#666;font-size:12px;";
                            t.textContent = "当前层级无子文件夹，可直接开始检测。";
                            folderRow.appendChild(t);
                        } else {
                            subs.forEach(name => {
                                const b = document.createElement("button");
                                b.type = "button";
                                b.textContent = "📁 " + name;
                                b.style.cssText = "padding:4px 10px;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;font-size:12px;";
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
                    bodyScroll.style.cssText = "flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:14px;min-height:220px;";

                    const mkSectionTitle = (txt, color) => {
                        const d = document.createElement("div");
                        d.textContent = txt;
                        d.style.cssText = "font-size:13px;font-weight:600;color:" + (color || "#fff") + ";margin-bottom:4px;";
                        return d;
                    };
                    const dupBox = document.createElement("div");
                    dupBox.style.cssText = "min-height:72px;padding:10px;background:#1f2428;border-radius:6px;border:1px solid #444;";
                    dupBox.innerHTML = "<div style='color:#888;font-size:12px;'>点击右下角「开始检测」后显示：内容完全相同（SHA256 一致）的重复 LoRA。</div>";
                    const updBox = document.createElement("div");
                    updBox.style.cssText = "min-height:72px;padding:10px;background:#1f2428;border-radius:6px;border:1px solid #444;";
                    updBox.innerHTML = "<div style='color:#888;font-size:12px;'>点击右下角「检测 LoRA 更新」后，通过 SHA256 查询 Civitai，匹配到则对比本地版本与 Civitai 最新版本号，显示有更新的 LoRA。</div>";

                    bodyScroll.appendChild(mkSectionTitle("① 重复 LoRA（哈希相同）", "#ef9a9a"));
                    bodyScroll.appendChild(dupBox);
                    bodyScroll.appendChild(mkSectionTitle("② LoRA 更新（Civitai）", "#81c784"));
                    bodyScroll.appendChild(updBox);

                    const footer = document.createElement("div");
                    footer.style.cssText = "padding:12px 16px;border-top:1px solid #333;background:#1a1a1a;border-radius:0 0 8px 8px;display:flex;justify-content:flex-end;align-items:center;gap:10px;";

                    const dupBtn = document.createElement("button");
                    dupBtn.type = "button";
                    dupBtn.textContent = "🔍 检测重复 LoRA";
                    dupBtn.style.cssText = "padding:8px 16px;background:#d32f2f;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";

                    const updBtn = document.createElement("button");
                    updBtn.type = "button";
                    updBtn.textContent = "🌐 检测 LoRA 更新";
                    updBtn.style.cssText = "padding:8px 16px;background:#1976D2;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";

                    const allBtn = document.createElement("button");
                    allBtn.type = "button";
                    allBtn.textContent = "🚀 全部检测";
                    allBtn.style.cssText = "padding:8px 16px;background:#4CAF50;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";

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
                            dupBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>检测失败：" + (data && data.error ? data.error : "未知错误") + "</div>";
                            return;
                        }
                        const summary = "<div style='color:#888;font-size:11px;margin-bottom:8px;'>本次扫描：范围内 " + data.scoped_count + " 个 LoRA 路径，已读取 " + data.scanned + " 个文件。</div>";
                        dupBox.innerHTML = summary;
                        if (!data.duplicates || !data.duplicates.length) {
                            dupBox.innerHTML += "<div style='color:#a5d6a7;font-size:12px;'>未发现内容完全相同的重复文件。</div>";
                        } else {
                            data.duplicates.forEach(g => {
                                const div = document.createElement("div");
                                div.style.cssText = "margin-bottom:10px;padding:8px;background:#332a2a;border-radius:6px;border-left:3px solid #f44336;";
                                const h = document.createElement("div");
                                h.style.cssText = "color:#ffab91;font-size:11px;margin-bottom:6px;word-break:break-all;";
                                h.textContent = "相同 SHA256 · " + (g.hash || "").slice(0, 24) + "…";
                                div.appendChild(h);
                                (g.files || []).forEach(f => {
                                    const row = document.createElement("div");
                                    row.style.cssText = "color:#ccc;font-size:11px;padding:2px 0;word-break:break-all;";
                                    row.textContent = (f.path || "") + "  ·  " + fmtTime(f.mtime) + "  ·  " + fmtSize(f.size);
                                    div.appendChild(row);
                                });
                                dupBox.appendChild(div);
                            });
                        }
                    };

                    const renderUpdResults = (data) => {
                        if (!data || !data.ok) {
                            updBox.innerHTML = "<div style='color:#f44336;font-size:12px;'>检测失败：" + (data && data.error ? data.error : "未知错误") + "</div>";
                            return;
                        }
                        const summary = "<div style='color:#888;font-size:11px;margin-bottom:8px;'>本次扫描：范围内 " + data.scoped_count + " 个 LoRA 路径，已读取 " + data.scanned + " 个文件，查询 Civitai 中…</div>";
                        updBox.innerHTML = summary;
                        if (!data.updates || !data.updates.length) {
                            updBox.innerHTML += "<div style='color:#a5d6a7;font-size:12px;'>所有 LoRA 都已是 Civitai 上的最新版本，或无法在 Civitai 找到匹配记录。</div>";
                        } else {
                            data.updates.forEach(u => {
                                const div = document.createElement("div");
                                div.style.cssText = "margin-bottom:10px;padding:8px;background:#2a332a;border-radius:6px;border-left:3px solid #4CAF50;";
                                const t = document.createElement("div");
                                t.style.cssText = "color:#a5d6a7;font-size:11px;margin-bottom:4px;word-break:break-all;";
                                const lat = (u.latest_label && String(u.latest_label).trim()) ? String(u.latest_label).trim() : ("v" + u.latest_version);
                                const locv = (u.local_label && String(u.local_label).trim()) ? String(u.local_label).trim() : ("v" + u.local_version);
                                t.textContent = (u.model_name || u.path) + "  ·  Civitai 最新: " + lat;
                                div.appendChild(t);
                                const loc = document.createElement("div");
                                loc.style.cssText = "color:#fff;font-size:11px;margin-bottom:2px;";
                                let locText = "本地版本: " + locv + "  ·  文件: " + u.path;
                                if (u.local_base_model) locText += "  ·  Base: " + u.local_base_model;
                                loc.textContent = locText;
                                div.appendChild(loc);
                                div.appendChild(loc);
                                if (u.model_url) {
                                    const lnk = document.createElement("a");
                                    lnk.href = u.model_url;
                                    lnk.target = "_blank";
                                    lnk.style.cssText = "color:#90caf9;font-size:11px;";
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
                    alert("LoRA 检测: " + e);
                }
            };

            nodeType.prototype.saveFolderPreset = async function(folder) {
                const name = prompt("Save Preset As:", folder.name);
                if(!name) return;
                try {
                    await api.fetchApi("/ma/lora/save_preset", {
                        method: "POST", body: JSON.stringify({ name, content: { folders: [folder] } })
                    });
                    alert("Saved!");
                } catch(e) { alert(e); }
            };

            nodeType.prototype.showSettingsModal = function() {
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
                
                // 创建遮罩层
                const overlay = document.createElement("div");
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 10001;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;

                // 创建弹窗（一比一参考 magic_resolution.js：fixed + translate(-50%,-50%) 居中）
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #2a2a2a;
                    border: 1px solid #555;
                    border-radius: 8px;
                    padding: 0;
                    width: 580px;
                    max-width: 96vw;
                    max-height: 85vh;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.8);
                    z-index: 10002;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                `;

                // 标题栏（可拖拽）
                const title = document.createElement("div");
                title.textContent = "设置";
                title.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    color: #eee;
                    padding: 12px 20px;
                    border-bottom: 1px solid #444;
                    cursor: move;
                    user-select: none;
                    background: #252525;
                    flex-shrink: 0;
                `;

                // Tab 切换栏
                const tabBar = document.createElement("div");
                tabBar.style.cssText = `
                    display: flex;
                    background: #1f1f1f;
                    border-bottom: 1px solid #444;
                    flex-shrink: 0;
                `;
                const tabButtons = {};
                const tabContents = {};
                const tabDefs = [
                    { id: "mode", label: "模式切换" },
                    { id: "layout", label: "布局样式" },
                ];
                let currentTab = "mode";
                tabDefs.forEach((tab) => {
                    const btn = document.createElement("button");
                    btn.textContent = tab.label;
                    btn.dataset.tab = tab.id;
                    const active = currentTab === tab.id;
                    btn.style.cssText = `
                        flex: 1;
                        padding: 10px 16px;
                        background: ${active ? "#2a2a2a" : "transparent"};
                        border: none;
                        border-bottom: 3px solid ${active ? "#2196F3" : "transparent"};
                        color: ${active ? "#fff" : "#888"};
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: ${active ? "500" : "400"};
                        transition: all 0.15s;
                    `;
                    btn.onmouseenter = () => {
                        if (currentTab !== tab.id) btn.style.color = "#ccc";
                    };
                    btn.onmouseleave = () => {
                        if (currentTab !== tab.id) btn.style.color = "#888";
                    };
                    btn.onclick = () => {
                        currentTab = tab.id;
                        tabDefs.forEach((t) => {
                            const b = tabButtons[t.id];
                            const c = tabContents[t.id];
                            const isActive = t.id === currentTab;
                            b.style.background = isActive ? "#2a2a2a" : "transparent";
                            b.style.borderBottomColor = isActive ? "#2196F3" : "transparent";
                            b.style.color = isActive ? "#fff" : "#888";
                            b.style.fontWeight = isActive ? "500" : "400";
                            c.style.display = isActive ? "block" : "none";
                        });
                    };
                    tabButtons[tab.id] = btn;
                    tabBar.appendChild(btn);
                });

                // 内容区域（可滚动）
                const content = document.createElement("div");
                content.style.cssText = "flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 0;";

                // 按钮容器
                const buttonContainer = document.createElement("div");
                buttonContainer.style.cssText = "display: flex; gap: 10px; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid #444; flex-shrink: 0; background: #252525;";

                // 设置项容器
                const settingsContainer = document.createElement("div");
                settingsContainer.style.cssText = "display: flex; flex-direction: column; gap: 20px;";
                
                // ========== LoRA 加载模式 ==========
                const defaultSection = document.createElement("div");
                defaultSection.style.cssText = "display: flex; flex-direction: column; gap: 12px; margin-bottom: 10px;";

                const defaultTitle = document.createElement("div");
                defaultTitle.textContent = "LoRA 加载模式";
                defaultTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 8px;
                `;

                const defaultModeContainer = document.createElement("div");
                defaultModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

                // 自适应模式（单选按钮，排在最前面）
                const adaptiveMode = document.createElement("label");
                adaptiveMode.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                const radioAdaptive = document.createElement("input");
                radioAdaptive.type = "radio";
                radioAdaptive.name = "global_mode";
                radioAdaptive.value = "adaptive";
                radioAdaptive.checked = primaryMode === "adaptive";
                radioAdaptive.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                const labelAdaptive = document.createElement("div");
                labelAdaptive.style.cssText = "flex: 1;";
                const labelAdaptiveTitle = document.createElement("div");
                labelAdaptiveTitle.textContent = "自适应模式";
                labelAdaptiveTitle.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                const labelAdaptiveDesc = document.createElement("div");
                labelAdaptiveDesc.textContent = "自动检测模型类型并选择合适的加载模式（Klein→Nunchaku 原生 API，SDNQ→SDNQ，普通→标准；INT8/FP8 等量化模型走标准模式，由 ComfyUI 官方 model_patcher 自动处理）";
                labelAdaptiveDesc.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
                labelAdaptive.appendChild(labelAdaptiveTitle);
                labelAdaptive.appendChild(labelAdaptiveDesc);
                adaptiveMode.appendChild(radioAdaptive);
                adaptiveMode.appendChild(labelAdaptive);
                defaultModeContainer.appendChild(adaptiveMode);

                // 默认模式（标准 LoRA）
                const defaultMode = document.createElement("label");
                defaultMode.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                const radioDefault = document.createElement("input");
                radioDefault.type = "radio";
                radioDefault.name = "global_mode";
                radioDefault.value = "default";
                radioDefault.checked = primaryMode === "default";
                radioDefault.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                const labelDefault = document.createElement("div");
                labelDefault.style.cssText = "flex: 1;";
                const labelDefaultTitle = document.createElement("div");
                labelDefaultTitle.textContent = "默认模式（标准 LoRA）";
                labelDefaultTitle.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                const labelDefaultDesc = document.createElement("div");
                labelDefaultDesc.textContent = "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型（官方 model_patcher.py 已原生支持 INT8/FP8/INT4 等量化权重的 LoRA 应用）";
                labelDefaultDesc.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
                labelDefault.appendChild(labelDefaultTitle);
                labelDefault.appendChild(labelDefaultDesc);
                defaultMode.appendChild(radioDefault);
                defaultMode.appendChild(labelDefault);
                defaultModeContainer.appendChild(defaultMode);

                // 模式选中状态更新
                const updateModeSelection = () => {
                    // 自适应模式
                    if (radioAdaptive.checked) {
                        adaptiveMode.style.borderColor = "#4CAF50";
                        adaptiveMode.style.background = "#2a3a2a";
                    } else {
                        adaptiveMode.style.borderColor = "transparent";
                        adaptiveMode.style.background = "#333";
                    }
                    // 默认模式
                    if (radioDefault.checked) {
                        defaultMode.style.borderColor = "#2196F3";
                        defaultMode.style.background = "#2a3a4a";
                    } else {
                        defaultMode.style.borderColor = "transparent";
                        defaultMode.style.background = "#333";
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
                kleinSection.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

                const kleinTitle = document.createElement("div");
                kleinTitle.textContent = "tonera-Klein-Nunchaku LoRA 模式";
                kleinTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 8px;
                `;

                const kleinDesc = document.createElement("div");
                kleinDesc.textContent = "专用于 tonera/FLUX.2-klein-9B-Nunchaku 量化模型的原生 LoRA 加载（普通 Klein 模型请用默认模式）";
                kleinDesc.style.cssText = `
                    font-size: 12px;
                    color: #aaa;
                    margin-bottom: 12px;
                    line-height: 1.5;
                `;

                const kleinModeContainer = document.createElement("div");
                kleinModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

                // tonera-Klein-Nunchaku 模式（选中时激活）
                const kleinModeKlein = document.createElement("label");
                kleinModeKlein.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                const radioKleinKlein = document.createElement("input");
                radioKleinKlein.type = "radio";
                radioKleinKlein.name = "klein_mode";
                radioKleinKlein.value = "klein";
                radioKleinKlein.checked = primaryMode === "klein";
                radioKleinKlein.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                const labelKleinKlein = document.createElement("div");
                labelKleinKlein.style.cssText = "flex: 1;";
                const labelKleinKleinTitle = document.createElement("div");
                labelKleinKleinTitle.textContent = "tonera-Klein-Nunchaku 模式";
                labelKleinKleinTitle.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                const labelKleinKleinDesc = document.createElement("div");
                labelKleinKleinDesc.textContent = "使用 Nunchaku 原生 LoRA API（update_lora_params）加载 tonera FLUX.2-klein-9B-Nunchaku 专用 LoRA";
                labelKleinKleinDesc.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
                labelKleinKlein.appendChild(labelKleinKleinTitle);
                labelKleinKlein.appendChild(labelKleinKleinDesc);
                kleinModeKlein.appendChild(radioKleinKlein);
                kleinModeKlein.appendChild(labelKleinKlein);

                // Klein 模式选中状态更新
                const updateKleinSelection = () => {
                    [kleinModeKlein].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "#2196F3";
                            mode.style.background = "#2a3a4a";
                        } else {
                            mode.style.borderColor = "transparent";
                            mode.style.background = "#333";
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
                sdnqSection.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

                const sdnqTitle = document.createElement("div");
                sdnqTitle.textContent = "SDNQ LoRA 模式";
                sdnqTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 8px;
                `;

                const sdnqDesc = document.createElement("div");
                sdnqDesc.textContent = "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式";
                sdnqDesc.style.cssText = `
                    font-size: 12px;
                    color: #aaa;
                    margin-bottom: 12px;
                    line-height: 1.5;
                `;

                // SDNQ 模式选择容器
                const sdnqModeContainer = document.createElement("div");
                sdnqModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

                // SDNQ 模式
                const sdnqModeSdnq = document.createElement("label");
                sdnqModeSdnq.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                const radioSdnqSdnq = document.createElement("input");
                radioSdnqSdnq.type = "radio";
                radioSdnqSdnq.name = "sdnq_mode";
                radioSdnqSdnq.value = "sdnq";
                radioSdnqSdnq.checked = primaryMode === "sdnq";
                radioSdnqSdnq.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                const labelSdnqSdnq = document.createElement("div");
                labelSdnqSdnq.style.cssText = "flex: 1;";
                const labelSdnqSdnqTitle = document.createElement("div");
                labelSdnqSdnqTitle.textContent = "SDNQ 模式";
                labelSdnqSdnqTitle.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                const labelSdnqSdnqDesc = document.createElement("div");
                labelSdnqSdnqDesc.textContent = "使用 diffusers PEFT adapter 系统加载 LoRA，支持多个 LoRA 并行应用，适用于 SDNQ 量化模型（DiffusionPipeline）";
                labelSdnqSdnqDesc.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
                labelSdnqSdnq.appendChild(labelSdnqSdnqTitle);
                labelSdnqSdnq.appendChild(labelSdnqSdnqDesc);
                sdnqModeSdnq.appendChild(radioSdnqSdnq);
                sdnqModeSdnq.appendChild(labelSdnqSdnq);

                // SDNQ 模式选中状态更新
                const updateSdnqSelection = () => {
                    [sdnqModeSdnq].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "#2196F3";
                            mode.style.background = "#2a3a4a";
                        } else {
                            mode.style.borderColor = "transparent";
                            mode.style.background = "#333";
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
                animaSection.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

                const animaTitle = document.createElement("div");
                animaTitle.textContent = "Anima 2.9B LoRA 模式";
                animaTitle.style.cssText = `
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 8px;
                `;

                const animaDesc = document.createElement("div");
                animaDesc.textContent = "专用于 Anima 2.9B（40 层）模型加载旧版 28 层 Anima LoRA：标准加载路径下自动在内存中暂存重映射（28→40 层），不写盘、不改原文件、不新增文件";
                animaDesc.style.cssText = `
                    font-size: 12px;
                    color: #aaa;
                    margin-bottom: 12px;
                    line-height: 1.5;
                `;

                const animaModeContainer = document.createElement("div");
                animaModeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

                // Anima 2.9B 模式（选中时激活，与 Klein/SDNQ 互斥）
                const animaModeAnima = document.createElement("label");
                animaModeAnima.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                const radioAnima = document.createElement("input");
                radioAnima.type = "radio";
                radioAnima.name = "anima_mode";
                radioAnima.value = "anima";
                radioAnima.checked = currentAnimaMode === "anima";
                radioAnima.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                const labelAnima = document.createElement("div");
                labelAnima.style.cssText = "flex: 1;";
                const labelAnimaTitle = document.createElement("div");
                labelAnimaTitle.textContent = "Anima 2.9B 模式";
                labelAnimaTitle.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                const labelAnimaDesc = document.createElement("div");
                labelAnimaDesc.textContent = "标准加载路径下自动把 28 层 Anima LoRA 重映射为 40 层（仅对 Anima LoRA 生效，其他 LoRA 原样加载）";
                labelAnimaDesc.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
                labelAnima.appendChild(labelAnimaTitle);
                labelAnima.appendChild(labelAnimaDesc);
                animaModeAnima.appendChild(radioAnima);
                animaModeAnima.appendChild(labelAnima);

                // Anima 模式选中状态更新
                const updateAnimaSelection = () => {
                    [animaModeAnima].forEach(mode => {
                        const radio = mode.querySelector('input[type="radio"]');
                        if (radio.checked) {
                            mode.style.borderColor = "#9C27B0";
                            mode.style.background = "#3a2a3a";
                        } else {
                            mode.style.borderColor = "transparent";
                            mode.style.background = "#333";
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
                modeTabContent.style.cssText = "display: block;";
                modeTabContent.appendChild(settingsContainer);
                tabContents["mode"] = modeTabContent;

                // ========== 布局样式 Tab 内容 ==========
                const layoutTabContent = document.createElement("div");
                layoutTabContent.style.cssText = "display: none;";
                tabContents["layout"] = layoutTabContent;

                const layoutContainer = document.createElement("div");
                layoutContainer.style.cssText = "display: flex; flex-direction: column; gap: 18px;";

                const layoutTitle = document.createElement("div");
                layoutTitle.textContent = "权重控件样式";
                layoutTitle.style.cssText = "font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px;";
                const layoutDesc = document.createElement("div");
                layoutDesc.textContent = "选择 LoRA 列表中权重调节控件的样式。滑条模式下可直接拖动调整权重，数值仍可点击编辑。";
                layoutDesc.style.cssText = "font-size: 12px; color: #aaa; margin-bottom: 12px; line-height: 1.5;";

                const styleSection = document.createElement("div");
                styleSection.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

                const buildStyleOption = (value, label, desc) => {
                    const wrap = document.createElement("label");
                    wrap.style.cssText = "display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px; background: #333; border-radius: 4px; border: 2px solid transparent;";
                    const radio = document.createElement("input");
                    radio.type = "radio";
                    radio.name = "mpl_weight_style";
                    radio.value = value;
                    radio.checked = (this.layoutSettings?.weightStyle || "arrows") === value;
                    radio.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                    const info = document.createElement("div");
                    info.style.cssText = "flex: 1;";
                    const t = document.createElement("div");
                    t.textContent = label;
                    t.style.cssText = "color: #eee; font-size: 13px; font-weight: 500;";
                    const d = document.createElement("div");
                    d.textContent = desc;
                    d.style.cssText = "color: #888; font-size: 11px; margin-top: 2px;";
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
                sliderParamsSection.style.cssText = "display: flex; flex-direction: column; gap: 12px; padding: 12px; background: #2a2a2a; border-radius: 4px; border: 1px solid #444;";

                const sliderParamsTitle = document.createElement("div");
                sliderParamsTitle.textContent = "滑条参数";
                sliderParamsTitle.style.cssText = "color: #fff; font-size: 13px; font-weight: 500; margin-bottom: 4px;";
                sliderParamsSection.appendChild(sliderParamsTitle);

                const buildNumberRow = (labelText, key, min, max, step) => {
                    const row = document.createElement("div");
                    row.style.cssText = "display: flex; align-items: center; gap: 10px;";
                    const lab = document.createElement("div");
                    lab.textContent = labelText;
                    lab.style.cssText = "color: #ccc; font-size: 12px; min-width: 80px;";
                    const input = document.createElement("input");
                    input.type = "number";
                    input.min = String(min);
                    input.max = String(max);
                    input.step = String(step);
                    input.value = String(this.layoutSettings?.[key] ?? 0);
                    input.style.cssText = "flex: 1; padding: 4px 8px; background: #1a1a1a; border: 1px solid #555; border-radius: 3px; color: #fff; font-size: 12px;";
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

                const buildCheckboxRow = (labelText, key) => {
                    const row = document.createElement("label");
                    row.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 0;";
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = this.layoutSettings?.[key] ?? true;
                    cb.style.cssText = "width: 16px; height: 16px; cursor: pointer;";
                    const lab = document.createElement("div");
                    lab.textContent = labelText;
                    lab.style.cssText = "color: #ccc; font-size: 12px;";
                    row.appendChild(cb);
                    row.appendChild(lab);
                    return { row, cb };
                };
                const showValueRow = buildCheckboxRow("滑条旁显示当前数值", "showWeightValue");
                const snapRow = buildCheckboxRow("拖动时吸附 0（±0.02 范围内）", "snapToZero");
                sliderParamsSection.appendChild(showValueRow.row);
                sliderParamsSection.appendChild(snapRow.row);

                const updateStyleSelection = () => {
                    [styleArrows, styleSlider].forEach((s) => {
                        if (s.radio.checked) {
                            s.wrap.style.borderColor = "#2196F3";
                            s.wrap.style.background = "#2a3a4a";
                        } else {
                            s.wrap.style.borderColor = "transparent";
                            s.wrap.style.background = "#333";
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
                layoutTabContent.appendChild(layoutContainer);

                content.appendChild(modeTabContent);
                content.appendChild(layoutTabContent);

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

                // 确定按钮
                const confirmBtn = document.createElement("button");
                confirmBtn.textContent = "确定";
                confirmBtn.style.cssText = "padding:8px 16px;background:#2196F3;border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px;";
                confirmBtn.onclick = () => {
                    const isAdaptiveSelected = radioAdaptive.checked;
                    const isDefaultSelected = radioDefault.checked;
                    const scope = overlay;
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
                    };
                    if (newLayout.sliderMin >= newLayout.sliderMax) {
                        newLayout.sliderMax = newLayout.sliderMin + 0.1;
                    }
                    this.layoutSettings = newLayout;
                    this.properties["layout_settings"] = newLayout;

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
                    document.body.removeChild(overlay);
                };

                // 取消按钮
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "取消";
                cancelBtn.style.cssText = "padding:8px 16px;background:#666;border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px;";
                cancelBtn.onclick = () => document.body.removeChild(overlay);

                // 组装弹窗
                buttonContainer.appendChild(cancelBtn);
                buttonContainer.appendChild(confirmBtn);
                dialog.appendChild(title);
                dialog.appendChild(tabBar);
                dialog.appendChild(content);
                dialog.appendChild(buttonContainer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                // 使弹窗可拖拽
                this.makeDialogDraggable(dialog, title);
            };

            nodeType.prototype.loadPresetModal = async function() {
                // 创建遮罩层
                const overlay = document.createElement("div");
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 10001;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                // 创建弹窗
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    background: #2a2a2a;
                    border: 1px solid #555;
                    border-radius: 8px;
                    min-width: 500px;
                    max-width: 700px;
                    max-height: 600px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.8);
                    z-index: 10002;
                    display: flex;
                    flex-direction: column;
                `;
                
                // 标题栏
                const header = document.createElement("div");
                header.style.cssText = `
                    padding: 15px 20px;
                    border-bottom: 1px solid #444;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: #1a1a1a;
                    border-radius: 8px 8px 0 0;
                    cursor: move;
                    user-select: none;
                `;
                
                const title = document.createElement("div");
                title.textContent = "LoRA预设";
                title.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    color: #eee;
                    flex: 1;
                `;
                
                const headerButtons = document.createElement("div");
                headerButtons.style.cssText = "display: flex; gap: 10px;";
                
                // 刷新按钮
                const refreshBtn = document.createElement("button");
                refreshBtn.textContent = "刷新";
                refreshBtn.style.cssText = `
                    padding: 6px 12px;
                    background: #444;
                    border: 1px solid #555;
                    color: #ccc;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                `;
                refreshBtn.onmouseenter = () => refreshBtn.style.background = "#555";
                refreshBtn.onmouseleave = () => refreshBtn.style.background = "#444";
                
                // 关闭按钮
                const closeBtn = document.createElement("button");
                closeBtn.textContent = "✕";
                closeBtn.style.cssText = `
                    width: 28px;
                    height: 28px;
                    background: #444;
                    border: 1px solid #555;
                    color: #ccc;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                `;
                closeBtn.onmouseenter = () => closeBtn.style.background = "#555";
                closeBtn.onmouseleave = () => closeBtn.style.background = "#444";
                
                headerButtons.appendChild(refreshBtn);
                headerButtons.appendChild(closeBtn);
                header.appendChild(title);
                header.appendChild(headerButtons);
                
                // 内容区域
                const content = document.createElement("div");
                content.style.cssText = `
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                    min-height: 200px;
                `;
                
                // 加载预设列表的函数
                const loadPresets = async () => {
                    try {
                        content.innerHTML = ""; // 清空内容
                        
                    const r = await api.fetchApi(`/ma/lora/get_presets?t=${Date.now()}`);
                    const d = await r.json();
                        const presets = d.presets || {};
                        const keys = Object.keys(presets);
                        
                        if (!keys.length) {
                            const emptyMsg = document.createElement("div");
                            emptyMsg.textContent = "暂无预设";
                            emptyMsg.style.cssText = `
                                text-align: center;
                                color: #888;
                                padding: 40px;
                                font-size: 14px;
                            `;
                            content.appendChild(emptyMsg);
                            return;
                        }
                        
                        // 创建预设列表
                        keys.forEach(presetName => {
                            const presetData = presets[presetName];
                            
                            // 计算LoRA数量
                            let loraCount = 0;
                            if (presetData.folders) {
                                presetData.folders.forEach(folder => {
                                    if (folder.loras) {
                                        loraCount += folder.loras.length;
                                    }
                                });
                            }
                            
                            const item = document.createElement("div");
                            item.style.cssText = `
                        display: flex; 
                                align-items: center;
                                gap: 10px;
                                padding: 10px;
                                background: #333;
                                border-radius: 4px;
                                margin-bottom: 8px;
                        border: 1px solid #444; 
                            `;
                            
                            // 文件夹图标
                            const folderIcon = document.createElement("span");
                            folderIcon.textContent = "📁";
                            folderIcon.style.cssText = "font-size: 18px;";
                            
                            // 预设信息
                            const info = document.createElement("div");
                            info.style.cssText = "flex: 1;";
                            
                            const nameText = document.createElement("div");
                            nameText.textContent = `${presetName} (${loraCount}个LoRA)`;
                            nameText.style.cssText = `
                                color: #eee;
                                font-size: 14px;
                                margin-bottom: 2px;
                            `;
                            
                            info.appendChild(nameText);
                            
                            // 按钮容器
                            const buttons = document.createElement("div");
                            buttons.style.cssText = "display: flex; gap: 8px;";
                            
                            // 发送到节点按钮
                            const sendBtn = document.createElement("button");
                            sendBtn.textContent = "发送到节点";
                            sendBtn.style.cssText = `
                                padding: 6px 12px;
                                background: #4CAF50;
                                border: none;
                                color: white;
                                border-radius: 4px;
                                cursor: pointer;
                        font-size: 12px; 
                            `;
                            sendBtn.onmouseenter = () => sendBtn.style.background = "#5CBF60";
                            sendBtn.onmouseleave = () => sendBtn.style.background = "#4CAF50";
                            sendBtn.onclick = () => {
                                if (presetData.folders) {
                                    this.loraData.folders.push(...presetData.folders);
                                    this.renderEmbeddedList();
                                    this.updateWidget();
                                }
                                document.body.removeChild(overlay);
                            };
                            
                            // 删除按钮
                            const deleteBtn = document.createElement("button");
                            deleteBtn.textContent = "删除";
                            deleteBtn.style.cssText = `
                                padding: 6px 12px;
                                background: #f44336;
                                border: none;
                                color: white;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 12px;
                            `;
                            deleteBtn.onmouseenter = () => deleteBtn.style.background = "#f55";
                            deleteBtn.onmouseleave = () => deleteBtn.style.background = "#f44336";
                            deleteBtn.onclick = async () => {
                                if (confirm(`确定要删除预设 "${presetName}" 吗？`)) {
                                    try {
                                        await api.fetchApi("/ma/lora/delete_preset", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ name: presetName })
                                        });
                                        // 重新加载列表
                                        await loadPresets();
                                    } catch (e) {
                                        alert("删除失败: " + e);
                                    }
                                }
                            };
                            
                            buttons.appendChild(sendBtn);
                            buttons.appendChild(deleteBtn);
                            
                            item.appendChild(folderIcon);
                            item.appendChild(info);
                            item.appendChild(buttons);
                            content.appendChild(item);
                        });
                    } catch (e) {
                        const errorMsg = document.createElement("div");
                        errorMsg.textContent = "加载预设失败: " + e;
                        errorMsg.style.cssText = `
                            text-align: center;
                            color: #f44336;
                            padding: 20px;
                            font-size: 14px;
                        `;
                        content.appendChild(errorMsg);
                    }
                };
                
                // 刷新按钮点击事件
                refreshBtn.onclick = () => {
                    loadPresets();
                };
                
                // 关闭按钮点击事件
                const closeModal = () => {
                    document.body.removeChild(overlay);
                };
                closeBtn.onclick = closeModal;
                
                // 点击遮罩层关闭
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        closeModal();
                    }
                };
                
                // ESC键关闭
                const handleEsc = (e) => {
                    if (e.key === "Escape") {
                        closeModal();
                        document.removeEventListener("keydown", handleEsc);
                    }
                };
                document.addEventListener("keydown", handleEsc);
                
                // 阻止事件冒泡
                const stopProp = (e) => { e.stopPropagation(); };
                dialog.addEventListener("pointerdown", stopProp);
                dialog.addEventListener("pointermove", stopProp);
                dialog.addEventListener("pointerup", stopProp);
                dialog.addEventListener("mousedown", stopProp);
                dialog.addEventListener("wheel", stopProp, { passive: false });
                
                // 组装弹窗
                dialog.appendChild(header);
                dialog.appendChild(content);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                
                // 使弹窗可拖拽
                this.makeDialogDraggable(dialog, header);
                
                // 加载预设列表
                await loadPresets();
            };

        }
    },
    // 注入「lora串输出已连接」：根据 prompt 中是否有其他节点引用本节点的 lora串输出 判定链末端（未连接=末端）
    init(app) {
        const LORA_OUTPUT_INDEX = 4; // RETURN_NAMES: model, clip, lora_preview, tags_output, lora串输出
        const originalQueuePrompt = api.queuePrompt;
        api.queuePrompt = async function (index, prompt, ...args) {
            if (prompt && prompt.output && typeof prompt.output === "object") {
                const output = prompt.output;
                const loraOutputConnectedIds = new Set();
                // 从 prompt.output 已有的 inputs 中找出哪些节点的 lora串输出 已被连接
                for (const nodeId of Object.keys(output)) {
                    const node = output[nodeId];
                    const inputs = node && node.inputs;
                    if (!inputs) continue;
                    for (const key of Object.keys(inputs)) {
                        const val = inputs[key];
                        if (Array.isArray(val) && val.length >= 2 && val[1] === LORA_OUTPUT_INDEX) {
                            loraOutputConnectedIds.add(String(val[0]));
                        }
                    }
                }
                // 注入「lora串输出已连接」（链末端判定）
                for (const nodeId of Object.keys(output)) {
                    const node = output[nodeId];
                    if (node && node.class_type === NODE_NAME) {
                        if (!node.inputs) node.inputs = {};
                        node.inputs["lora串输出已连接"] = loraOutputConnectedIds.has(String(nodeId));
                    }
                }
            }
            return originalQueuePrompt.apply(api, [index, prompt, ...args]);
        };
    }
});
