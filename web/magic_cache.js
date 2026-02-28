import { app } from "../../scripts/app.js";

const NODE_NAME = "MagicCache";

// 翻译辅助函数（访问语言切换器的函数）
// 由于语言切换器会自动更新DOM，这里主要用于初始创建时的翻译
function getCurrentLanguage() {
    try {
        // 优先使用全局函数（如果语言切换器已加载）
        if (typeof window !== 'undefined' && window.getCurrentLanguage) {
            return window.getCurrentLanguage();
        }
        // 回退：从 localStorage 读取
        const stored = localStorage.getItem("magic_language_switcher_lang");
        return stored || "zh";
    } catch (e) {
        return "zh";
    }
}

// 翻译函数（访问全局的翻译函数或直接访问翻译映射）
function translateText(text, lang, nodeType = "MagicCache") {
    try {
        // 优先使用全局函数（如果语言切换器已加载）
        if (typeof window !== 'undefined' && window.translateText) {
            return window.translateText(text, lang, nodeType);
        }
        // 回退：直接访问翻译映射
        if (typeof window !== 'undefined' && window.allTranslations) {
            const allTranslations = window.allTranslations;
            if (allTranslations[nodeType]) {
                const nodeTranslations = allTranslations[nodeType];
                if (nodeTranslations[text] && nodeTranslations[text][lang]) {
                    return nodeTranslations[text][lang];
                }
            }
        }
        // 如果翻译不可用，返回原文本（语言切换器会自动更新）
        return text;
    } catch (e) {
        return text;
    }
}

// 获取翻译后的文本（使用当前语言）
function t(text) {
    const lang = getCurrentLanguage();
    return translateText(text, lang, "MagicCache");
}

app.registerExtension({
    name: "Magic.Cache",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {

            // 同步 widget.value 到 widgets_values（有些 ComfyUI/LiteGraph 流程在序列化/生成 prompt 时依赖 widgets_values）
            function syncWidget(node, widget, value) {
                if (!node || !widget) return;
                widget.value = value;
                if (widget.callback) {
                    widget.callback(value);
                }
                try {
                    const idx = node.widgets?.indexOf?.(widget);
                    if (idx != null && idx >= 0) {
                        node.widgets_values = node.widgets_values || [];
                        node.widgets_values[idx] = value;
                    }
                } catch (e) {
                    // ignore
                }
            }
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // 初始化节点属性
                if (!this.properties) this.properties = {};
                if (!this.widgets) this.widgets = [];
                if (!this.properties["cache_mode"]) this.properties["cache_mode"] = "Both";
                
                // TeaCache参数
                if (!this.properties["teacache_params"]) {
                    this.properties["teacache_params"] = {
                        model_type: "flux",
                        rel_l1_thresh: 0.4,
                        start_percent: 0.0,
                        end_percent: 1.0,
                        cache_device: "cuda"
                    };
                }
                
                // FBCache参数
                if (!this.properties["fbcache_params"]) {
                    this.properties["fbcache_params"] = {
                        object_to_patch: "diffusion_model",
                        residual_diff_threshold: 0.0,
                        start: 0.0,
                        end: 1.0,
                        max_consecutive_cache_hits: -1
                    };
                }
                
                // 初始化隐藏 widget（传值给后端用）
                const teacacheParamsJson = JSON.stringify(this.properties["teacache_params"]);
                const fbcacheParamsJson = JSON.stringify(this.properties["fbcache_params"]);
                
                let cacheModeWidget = this.widgets.find?.(w => w.name === "cache_mode");
                let teacacheWidget = this.widgets.find?.(w => w.name === "teacache_params_json");
                let fbcacheWidget = this.widgets.find?.(w => w.name === "fbcache_params_json");
                
                if (!cacheModeWidget) {
                    cacheModeWidget = this.addWidget("text", "cache_mode", this.properties["cache_mode"], () => {});
                }
                if (!teacacheWidget) {
                    teacacheWidget = this.addWidget("text", "teacache_params_json", teacacheParamsJson, () => {});
                }
                if (!fbcacheWidget) {
                    fbcacheWidget = this.addWidget("text", "fbcache_params_json", fbcacheParamsJson, () => {});
                }
                // 确保 widgets_values 也同步（避免只更新 widget.value 但 prompt 仍用旧值）
                syncWidget(this, cacheModeWidget, this.properties["cache_mode"]);
                syncWidget(this, teacacheWidget, teacacheParamsJson);
                syncWidget(this, fbcacheWidget, fbcacheParamsJson);
                // 真正隐藏这三个 widget，不在节点上占空间
                [cacheModeWidget, teacacheWidget, fbcacheWidget].forEach(w => {
                    if (!w) return;
                    w.hidden = true;
                    w.computeSize = () => [0, 0];
                });
                
                // 模式选择下拉框（用户可见）
                const modes = ["TeaCache", "FBCache", "Both"];
                let modeCombo = this.widgets.find?.(w => w.name === "模式" || w.name === t("模式"));
                if (!modeCombo) {
                    modeCombo = this.addWidget(
                        "combo",
                        t("模式"),
                        this.properties["cache_mode"],
                        (value) => {
                            this.properties["cache_mode"] = value;
                            syncWidget(this, cacheModeWidget, value);
                            this.setSize(this.computeSize());
                            app.graph.setDirtyCanvas(true, true);
                        },
                        { values: modes }
                    );
                } else {
                    // 旧节点恢复时同步一下默认值
                    modeCombo.options = modeCombo.options || {};
                    modeCombo.options.values = modes;
                    modeCombo.value = this.properties["cache_mode"];
                    // 更新标签文本
                    modeCombo.name = t("模式");
                }
                
                // 创建设置按钮
                this.addWidget("button", t("⚙️ 设置"), null, () => {
                    this.showSettingsDialog();
                });
                
                // 创建说明按钮
                this.addWidget("button", t("📖 说明"), null, () => {
                    this.showHelpDialog();
                });
                
                return r;
            };
            
            // 显示设置弹窗
            nodeType.prototype.showSettingsDialog = function() {
                // 创建弹窗容器
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                const content = document.createElement("div");
                content.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #2d2d2d;
                    border-radius: 8px;
                    padding: 20px;
                    max-width: 800px;
                    max-height: 90vh;
                    overflow-y: auto;
                    color: #fff;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                `;
                
                // 标题
                const title = document.createElement("h2");
                title.textContent = t("⚡ Magic Cache 设置");
                title.style.cssText = "margin: 0 0 20px 0; color: #4CAF50; cursor: move; user-select: none;";
                content.appendChild(title);
                
                // TeaCache设置区域
                const teacacheSection = this.createSettingsSection(content, t("TeaCache 设置"), this.properties["teacache_params"], [
                    { key: "model_type", label: t("模型类型"), type: "select", options: ["flux", "flux-kontext", "flux-klein-9b", "flux-klein-4b", "flux-klein-9b-sdnq", "flux-klein-4b-sdnq", "anima", "sdxl", "sd15", "ltxv", "lumina_2", "hunyuan_video", "hidream_i1_full", "hidream_i1_dev", "hidream_i1_fast", "wan2.1_t2v_1.3B", "wan2.1_t2v_14B", "wan2.1_i2v_480p_14B", "wan2.1_i2v_720p_14B", "wan2.1_t2v_1.3B_ret_mode", "wan2.1_t2v_14B_ret_mode", "wan2.1_i2v_480p_14B_ret_mode", "wan2.1_i2v_720p_14B_ret_mode"] },
                    { key: "rel_l1_thresh", label: t("缓存强度阈值"), type: "number", min: 0.0, max: 10.0, step: 0.01 },
                    { key: "start_percent", label: t("开始百分比"), type: "number", min: 0.0, max: 1.0, step: 0.01 },
                    { key: "end_percent", label: t("结束百分比"), type: "number", min: 0.0, max: 1.0, step: 0.01 },
                    { key: "cache_device", label: t("缓存设备"), type: "select", options: ["cuda", "cpu"] }
                ]);
                
                // FBCache设置区域
                const fbcacheSection = this.createSettingsSection(content, t("FBCache 设置"), this.properties["fbcache_params"], [
                    { key: "object_to_patch", label: t("对象名称"), type: "text" },
                    { key: "residual_diff_threshold", label: t("残差差异阈值"), type: "number", min: 0.0, max: 1.0, step: 0.001 },
                    { key: "start", label: t("开始百分比"), type: "number", min: 0.0, max: 1.0, step: 0.01 },
                    { key: "end", label: t("结束百分比"), type: "number", min: 0.0, max: 1.0, step: 0.01 },
                    { key: "max_consecutive_cache_hits", label: t("最大连续缓存命中"), type: "number", min: -1, step: 1 }
                ]);
                
                // 按钮区域
                const buttonContainer = document.createElement("div");
                buttonContainer.style.cssText = "margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;";
                
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = t("取消");
                cancelBtn.style.cssText = "padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 4px; cursor: pointer;";
                cancelBtn.onclick = () => {
                    document.body.removeChild(dialog);
                };
                
                const saveBtn = document.createElement("button");
                saveBtn.textContent = t("保存");
                saveBtn.style.cssText = "padding: 8px 16px; background: #4CAF50; color: #fff; border: none; border-radius: 4px; cursor: pointer;";
                saveBtn.onclick = () => {
                    // 保存TeaCache参数
                    const teacacheInputs = teacacheSection.querySelectorAll("input, select");
                    teacacheInputs.forEach(input => {
                        const key = input.dataset.key;
                        if (key) {
                            if (input.type === "number") {
                                this.properties["teacache_params"][key] = parseFloat(input.value);
                            } else {
                                this.properties["teacache_params"][key] = input.value;
                            }
                        }
                    });
                    
                    // 保存FBCache参数
                    const fbcacheInputs = fbcacheSection.querySelectorAll("input, select");
                    fbcacheInputs.forEach(input => {
                        const key = input.dataset.key;
                        if (key) {
                            if (input.type === "number") {
                                this.properties["fbcache_params"][key] = parseFloat(input.value);
                            } else {
                                this.properties["fbcache_params"][key] = input.value;
                            }
                        }
                    });
                    
                    // 将更新后的参数同步到隐藏的 widget，以便 Python 后端读取
                    const teacacheParamsJson = JSON.stringify(this.properties["teacache_params"]);
                    const fbcacheParamsJson = JSON.stringify(this.properties["fbcache_params"]);
                    
                    // 查找并更新对应的 widget
                    const teacacheWidget = this.widgets.find?.(w => w.name === "teacache_params_json");
                    const fbcacheWidget = this.widgets.find?.(w => w.name === "fbcache_params_json");
                    
                    if (teacacheWidget) {
                        syncWidget(this, teacacheWidget, teacacheParamsJson);
                        console.log("✅ TeaCache params updated:", teacacheParamsJson);
                    } else {
                        console.warn("⚠️ TeaCache widget not found!");
                    }
                    
                    if (fbcacheWidget) {
                        syncWidget(this, fbcacheWidget, fbcacheParamsJson);
                        console.log("✅ FBCache params updated:", fbcacheParamsJson);
                    } else {
                        console.warn("⚠️ FBCache widget not found!");
                    }

                    // 标记节点为已修改，确保值被保存
                    this.setDirty?.(true);
                    // 触发画布更新，确保序列化
                    app.graph.setDirtyCanvas(true, true);
                    
                    // 强制触发节点序列化（通过修改节点尺寸来触发）
                    const currentSize = this.size;
                    this.setSize([currentSize[0] + 0.01, currentSize[1]]);
                    setTimeout(() => {
                        this.setSize(currentSize);
                    }, 10);
                    
                    document.body.removeChild(dialog);
                };
                
                buttonContainer.appendChild(cancelBtn);
                buttonContainer.appendChild(saveBtn);
                content.appendChild(buttonContainer);
                
                dialog.appendChild(content);
                document.body.appendChild(dialog);
                
                // 启用拖拽功能
                makeDialogDraggable(content, title);
                
                // 点击背景关闭
                dialog.onclick = (e) => {
                    if (e.target === dialog) {
                        document.body.removeChild(dialog);
                    }
                };
            };
            
            // 创建设置区域
            nodeType.prototype.createSettingsSection = function(parent, title, params, fields) {
                const section = document.createElement("div");
                section.style.cssText = "margin-bottom: 20px; padding: 15px; background: #1e1e1e; border-radius: 4px;";
                
                const sectionTitle = document.createElement("h3");
                sectionTitle.textContent = title;
                sectionTitle.style.cssText = "margin: 0 0 15px 0; color: #4CAF50; font-size: 16px;";
                section.appendChild(sectionTitle);
                
                fields.forEach(field => {
                    const row = document.createElement("div");
                    row.style.cssText = "margin-bottom: 10px; display: flex; align-items: center; gap: 10px;";
                    
                    const label = document.createElement("label");
                    label.textContent = field.label + ":";
                    label.style.cssText = "min-width: 150px; color: #ccc;";
                    row.appendChild(label);
                    
                    let input;
                    if (field.type === "select") {
                        input = document.createElement("select");
                        field.options.forEach(opt => {
                            const option = document.createElement("option");
                            option.value = opt;
                            option.textContent = opt;
                            if (params[field.key] === opt) option.selected = true;
                            input.appendChild(option);
                        });
                    } else if (field.type === "number") {
                        input = document.createElement("input");
                        input.type = "number";
                        input.min = field.min;
                        input.max = field.max;
                        input.step = field.step;
                        input.value = params[field.key];
                    } else {
                        input = document.createElement("input");
                        input.type = "text";
                        input.value = params[field.key];
                    }
                    
                    input.dataset.key = field.key;
                    input.style.cssText = "flex: 1; padding: 6px; background: #333; color: #fff; border: 1px solid #555; border-radius: 4px;";
                    row.appendChild(input);
                    
                    section.appendChild(row);
                });
                
                parent.appendChild(section);
                return section;
            };
            
            // 节点配置恢复
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                
                if (!this.widgets) this.widgets = [];
                
                // 恢复模式下拉框的值
                if (this.properties && this.properties["cache_mode"]) {
                    const modeCombo = this.widgets.find?.(w => w.name === "模式");
                    if (modeCombo) {
                        modeCombo.value = this.properties["cache_mode"];
                    }
                }
                
                // 初始化hidden widget
                const teacacheParamsJson = JSON.stringify(this.properties["teacache_params"]);
                const fbcacheParamsJson = JSON.stringify(this.properties["fbcache_params"]);
                
                let cacheModeWidget = this.widgets.find?.(w => w.name === "cache_mode");
                let teacacheWidget = this.widgets.find?.(w => w.name === "teacache_params_json");
                let fbcacheWidget = this.widgets.find?.(w => w.name === "fbcache_params_json");
                
                if (!cacheModeWidget) {
                    cacheModeWidget = this.addWidget("text", "cache_mode", this.properties["cache_mode"], () => {});
                } else {
                    // 如果 widget 已存在，同步更新值
                    syncWidget(this, cacheModeWidget, this.properties["cache_mode"]);
                }
                
                if (!teacacheWidget) {
                    teacacheWidget = this.addWidget("text", "teacache_params_json", teacacheParamsJson, () => {});
                } else {
                    // 如果 widget 已存在，同步更新值
                    syncWidget(this, teacacheWidget, teacacheParamsJson);
                }
                
                if (!fbcacheWidget) {
                    fbcacheWidget = this.addWidget("text", "fbcache_params_json", fbcacheParamsJson, () => {});
                } else {
                    // 如果 widget 已存在，同步更新值
                    syncWidget(this, fbcacheWidget, fbcacheParamsJson);
                }

                // 保持隐藏
                [cacheModeWidget, teacacheWidget, fbcacheWidget].forEach(w => {
                    if (!w) return;
                    w.hidden = true;
                    w.computeSize = () => [0, 0];
                });
                
                return r;
            };
            
            // 显示说明弹窗
            nodeType.prototype.showHelpDialog = function() {
                // 创建弹窗容器
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                const content = document.createElement("div");
                content.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #2d2d2d;
                    border-radius: 8px;
                    width: 900px;
                    max-width: 90vw;
                    height: 600px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    color: #fff;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                `;
                
                // 标题栏
                const title = document.createElement("div");
                title.style.cssText = `
                    padding: 15px 20px;
                    background: #1e1e1e;
                    border-bottom: 1px solid #444;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    user-select: none;
                `;
                title.innerHTML = `<b style="color: #4CAF50; font-size: 18px;">${t("📖 Magic Cache 使用说明")}</b>`;
                
                const closeBtn = document.createElement("button");
                closeBtn.textContent = "✕";
                closeBtn.style.cssText = `
                    background: none;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    font-size: 20px;
                    padding: 0 10px;
                    line-height: 1;
                `;
                closeBtn.onclick = () => document.body.removeChild(dialog);
                title.appendChild(closeBtn);
                content.appendChild(title);
                
                // 主体内容区域（左右布局）
                const body = document.createElement("div");
                body.style.cssText = `
                    flex: 1;
                    display: flex;
                    overflow: hidden;
                `;
                
                // 左侧切换面板
                const sidebar = document.createElement("div");
                sidebar.style.cssText = `
                    width: 200px;
                    background: #1a1a1a;
                    border-right: 1px solid #444;
                    display: flex;
                    flex-direction: column;
                    padding: 10px 0;
                `;
                
                // 说明内容区域
                const mainContent = document.createElement("div");
                mainContent.style.cssText = `
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                    background: #2d2d2d;
                `;
                
                // 当前选中的模式
                let currentMode = "TeaCache";
                
                // 创建切换按钮
                const createTabButton = (mode, label) => {
                    const btn = document.createElement("button");
                    btn.textContent = label;
                    btn.style.cssText = `
                        width: 100%;
                        padding: 12px 20px;
                        text-align: left;
                        background: ${currentMode === mode ? "#2a2a2a" : "transparent"};
                        border: none;
                        border-left: 3px solid ${currentMode === mode ? "#4CAF50" : "transparent"};
                        color: ${currentMode === mode ? "#4CAF50" : "#bbb"};
                        cursor: pointer;
                        font-weight: ${currentMode === mode ? "bold" : "normal"};
                        transition: all 0.2s;
                    `;
                    btn.onmouseover = () => {
                        if (currentMode !== mode) {
                            btn.style.background = "#222";
                        }
                    };
                    btn.onmouseout = () => {
                        if (currentMode !== mode) {
                            btn.style.background = "transparent";
                        }
                    };
                    btn.onclick = () => {
                        currentMode = mode;
                        updateContent();
                        // 更新所有按钮样式
                        sidebar.querySelectorAll("button").forEach((b, idx) => {
                            const btnMode = idx === 0 ? "TeaCache" : idx === 1 ? "FBCache" : "Both";
                            b.style.background = currentMode === btnMode ? "#2a2a2a" : "transparent";
                            b.style.borderLeft = currentMode === btnMode ? "3px solid #4CAF50" : "3px solid transparent";
                            b.style.color = currentMode === btnMode ? "#4CAF50" : "#bbb";
                            b.style.fontWeight = currentMode === btnMode ? "bold" : "normal";
                        });
                    };
                    return btn;
                };
                
                sidebar.appendChild(createTabButton("TeaCache", t("☕ TeaCache 模式")));
                sidebar.appendChild(createTabButton("FBCache", t("⚡ FBCache 模式")));
                sidebar.appendChild(createTabButton("Both", t("🚀 Both 模式（组合）")));
                
                body.appendChild(sidebar);
                body.appendChild(mainContent);
                content.appendChild(body);
                
                // 更新内容函数
                const updateContent = () => {
                    let html = "";
                    
                    if (currentMode === "TeaCache") {
                        html = `
                            <div style="line-height: 1.8;">
                                <h2 style="color: #4CAF50; margin-top: 0; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
                                    ${t("☕ TeaCache 模式说明")}
                                </h2>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("工作原理")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("TeaCache 通过监测相邻时间步的输出差异，当差异低于设定阈值时，跳过计算并复用前一步的缓存结果，从而实现推理加速。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("核心机制")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li>${t("监测相邻时间步的输出波动（相对 L1 距离）")}</li>
                                    <li>${t("当波动低于")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">rel_l1_thresh</code> ${t("阈值时，跳过计算")}</li>
                                    <li>${t("复用前一步的缓存结果，减少计算量")}</li>
                                    <li>${t("早期步骤稳定性高，更适合缓存复用")}</li>
                                </ul>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("主要参数")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li><strong>rel_l1_thresh</strong>：${t("相对 L1 阈值，控制缓存激进程度（值越大越激进，速度越快但可能影响质量）")}</li>
                                    <li><strong>start_percent / end_percent</strong>：${t("缓存应用的步数范围（0.0-1.0）")}</li>
                                    <li><strong>cache_device</strong>：${t("缓存存储设备（cuda 更快但占用显存，cpu 不占显存但稍慢）")}</li>
                                    <li><strong>model_type</strong>：${t("模型类型，需与使用的模型匹配")}</li>
                                </ul>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("性能表现")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("通常可实现")} <strong style="color: #4CAF50;">1.5x - 3x</strong> ${t("的推理加速，具体取决于模型类型和参数设置。")}
                                    ${t("对于 FLUX 模型，推荐")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">rel_l1_thresh=0.4</code>${t("，可实现约 2x 加速。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("支持的模型")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("FLUX、PuLID-FLUX、FLUX-Kontext、HiDream-I1、Lumina-Image-2.0、HunyuanVideo、LTX-Video、CogVideoX、Wan2.1、SDXL、SD1.5 等。")}
                                </p>
                                
                                <div style="margin-top: 15px; padding: 12px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #ff9800;">
                                    <p style="margin: 0 0 8px 0; color: #ff9800; font-weight: bold; font-size: 14px;">
                                        ${t("✨ 本节点新增支持（已修改源项目代码）：")}
                                    </p>
                                    <ul style="margin: 0; padding-left: 20px; color: #ddd; font-size: 14px;">
                                        <li><strong style="color: #4CAF50;">${t("flux2klein")}</strong> - ${t("已支持")}</li>
                                        <li><strong style="color: #4CAF50;">${t("最新 Anima 模型")}</strong> - ${t("已支持")}</li>
                                        <li><strong style="color: #4CAF50;">${t("SDXL 模型")}</strong> - ${t(" - 已支持（原项目不支持）")}</li>
                                    </ul>
                                </div>
                                
                                <div style="margin-top: 30px; padding: 15px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #4CAF50;">
                                    <p style="margin: 0; color: #bbb; font-size: 14px;">
                                        <strong style="color: #4CAF50;">${t("原作者：")}</strong>
                                        <a href="https://github.com/welltop-cn/ComfyUI-TeaCache" target="_blank" 
                                           style="color: #6ab7ff; text-decoration: none;">
                                            https://github.com/welltop-cn/ComfyUI-TeaCache
                                        </a>
                                    </p>
                                </div>
                            </div>
                        `;
                    } else if (currentMode === "FBCache") {
                        html = `
                            <div style="line-height: 1.8;">
                                <h2 style="color: #4CAF50; margin-top: 0; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
                                    ${t("⚡ FBCache 模式说明")}
                                </h2>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("工作原理")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("FBCache（Feature Block Cache）通过在指定步数范围内重用前一步的特征表示，跳过重复的特征计算，从而加速推理过程。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("核心机制")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li>${t("在")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">start</code> ${t("到")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">end</code> ${t("步数范围内启用特征缓存")}</li>
                                    <li>${t("通过")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">residual_diff_threshold</code> ${t("控制特征重用灵敏度")}</li>
                                    <li>${t("当残差差异低于阈值时，重用前一步的特征块")}</li>
                                    <li>${t("支持限制最大连续缓存命中次数（")}<code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">max_consecutive_cache_hits</code>${t("）")}</li>
                                </ul>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("主要参数")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li><strong>residual_diff_threshold</strong>：${t("残差差异阈值，控制特征重用灵敏度（值越大越激进）")}</li>
                                    <li><strong>start / end</strong>：${t("缓存应用的步数范围（0.0-1.0）")}</li>
                                    <li><strong>max_consecutive_cache_hits</strong>：${t("最大连续缓存命中次数（-1 表示无限制）")}</li>
                                    <li><strong>object_to_patch</strong>：${t("要打补丁的对象名称（通常为 \"diffusion_model\"）")}</li>
                                </ul>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("性能表现")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("在合适的参数设置下，FBCache 可以实现显著的推理加速，特别是在中间步骤（如 20%-85% 范围）效果最佳。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("支持的模型")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("支持 UNetModel（SDXL、SD3.5 等）、Flux、LTXV、HunyuanVideo、Anima 等基于 Transformer 块的模型。")}
                                </p>
                                
                                <div style="margin-top: 15px; padding: 12px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #ff9800;">
                                    <p style="margin: 0 0 8px 0; color: #ff9800; font-weight: bold; font-size: 14px;">
                                        ${t("✨ 本节点新增支持（已修改源项目代码）：")}
                                    </p>
                                    <ul style="margin: 0; padding-left: 20px; color: #ddd; font-size: 14px;">
                                        <li><strong style="color: #4CAF50;">${t("flux2klein")}</strong> - ${t("已支持")}</li>
                                        <li><strong style="color: #4CAF50;">${t("最新 Anima 模型")}</strong> - ${t("已支持")}</li>
                                    </ul>
                                </div>
                                
                                <div style="margin-top: 30px; padding: 15px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #4CAF50;">
                                    <p style="margin: 0; color: #bbb; font-size: 14px;">
                                        <strong style="color: #4CAF50;">${t("原作者：")}</strong>
                                        <a href="https://github.com/chengzeyi/Comfy-WaveSpeed" target="_blank" 
                                           style="color: #6ab7ff; text-decoration: none;">
                                            https://github.com/chengzeyi/Comfy-WaveSpeed
                                        </a>
                                    </p>
                                </div>
                            </div>
                        `;
                    } else if (currentMode === "Both") {
                        html = `
                            <div style="line-height: 1.8;">
                                <h2 style="color: #4CAF50; margin-top: 0; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
                                    ${t("🚀 Both 模式（组合模式）说明")}
                                </h2>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("工作原理")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("Both 模式同时启用 TeaCache 和 FBCache 两种缓存优化技术，通过组合使用实现更快的推理速度。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("核心机制")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li>${t("两层缓存逻辑按顺序组合执行")}</li>
                                    <li>${t("TeaCache 包装在 FBCache 外层，形成嵌套结构：")}<code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">TeaCache(FBCache(原始UNet))</code></li>
                                    <li>${t("在设定的步数范围内，两种缓存优化同时生效")}</li>
                                    <li>${t("TeaCache 负责时间步级别的缓存跳过，FBCache 负责特征块级别的缓存重用")}</li>
                                </ul>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("执行流程")}</h3>
                                <ol style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li>${t("首先应用 FBCache，在模型上设置特征块缓存逻辑")}</li>
                                    <li>${t("然后应用 TeaCache，将时间步缓存逻辑包装在外层")}</li>
                                    <li>${t("推理时，先经过 TeaCache 的时间步判断，再经过 FBCache 的特征块判断")}</li>
                                    <li>${t("两层缓存都会在各自设定的范围内生效")}</li>
                                </ol>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("性能表现")}</h3>
                                <p style="color: #ddd; margin: 10px 0;">
                                    ${t("相比单独使用任意一种方法，组合模式通常提供")}<strong style="color: #4CAF50;">${t("更快的推理速度")}</strong>。
                                    ${t("两种优化技术互补，可以在保持较好视觉质量的前提下实现更高的加速比。")}
                                </p>
                                
                                <h3 style="color: #6ab7ff; margin-top: 20px;">${t("参数设置建议")}</h3>
                                <ul style="color: #ddd; margin: 10px 0; padding-left: 20px;">
                                    <li>TeaCache ${t("的")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">rel_l1_thresh</code> ${t("和")} FBCache ${t("的")} <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 3px;">residual_diff_threshold</code> ${t("可以分别调整")}</li>
                                    <li>${t("建议先单独测试两种模式的效果，再组合使用")}</li>
                                    <li>${t("如果图像质量下降，可以适当降低阈值参数")}</li>
                                    <li>${t("两种模式的步数范围（start/end）可以设置不同，实现更精细的控制")}</li>
                                </ul>
                                
                                <div style="margin-top: 30px; padding: 15px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #ff9800;">
                                    <p style="margin: 0; color: #bbb; font-size: 14px;">
                                        <strong style="color: #ff9800;">${t("✨ 新功能：")}</strong>${t("这是 Magic Cache 节点的新增功能，将两种缓存优化技术整合在一起，方便用户一键启用组合优化。")}
                                    </p>
                                </div>
                                
                                <div style="margin-top: 20px; padding: 15px; background: #1a1a1a; border-radius: 5px; border-left: 4px solid #4CAF50;">
                                    <p style="margin: 0; color: #bbb; font-size: 14px;">
                                        <strong style="color: #4CAF50;">${t("参考来源：")}</strong><br>
                                        TeaCache: <a href="https://github.com/welltop-cn/ComfyUI-TeaCache" target="_blank" 
                                           style="color: #6ab7ff; text-decoration: none;">
                                            https://github.com/welltop-cn/ComfyUI-TeaCache
                                        </a><br>
                                        FBCache: <a href="https://github.com/chengzeyi/Comfy-WaveSpeed" target="_blank" 
                                           style="color: #6ab7ff; text-decoration: none;">
                                            https://github.com/chengzeyi/Comfy-WaveSpeed
                                        </a>
                                    </p>
                                </div>
                            </div>
                        `;
                    }
                    
                    mainContent.innerHTML = html;
                };
                
                // 初始化内容
                updateContent();
                
                dialog.appendChild(content);
                document.body.appendChild(dialog);
                
                // 启用拖拽功能
                makeDialogDraggable(content, title);
                
                // 点击背景关闭
                dialog.onclick = (e) => {
                    if (e.target === dialog) {
                        document.body.removeChild(dialog);
                    }
                };
            };
        }
    }
});

// 参考 Magic Resize 的通用拖拽函数
function makeDialogDraggable(dialog, titleBar) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    if (!titleBar) return;

    titleBar.style.cursor = "move";
    titleBar.style.userSelect = "none";

    const dragStart = (e) => {
        // 避免在点击按钮 / 输入框时触发拖拽
        if (
            e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.tagName === "BUTTON" ||
            e.target.closest("button")
        ) {
            return;
        }

        const rect = dialog.getBoundingClientRect();
        
        // 如果当前是居中状态（使用 translate(-50%, -50%)），切换到绝对定位
        const currentTransform = dialog.style.transform || "";
        if (currentTransform.includes("-50%")) {
            // 计算当前实际位置（居中时的位置）
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const currentX = centerX - rect.width / 2;
            const currentY = centerY - rect.height / 2;
            
            // 切换到绝对定位模式
            dialog.style.top = currentY + "px";
            dialog.style.left = currentX + "px";
            dialog.style.transform = "";
        }

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

        // 使用 fixed + top/left 定位
        dialog.style.position = "fixed";
        dialog.style.top = newY + "px";
        dialog.style.left = newX + "px";
        dialog.style.right = "";
        dialog.style.bottom = "";
        dialog.style.transform = "";
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
}
