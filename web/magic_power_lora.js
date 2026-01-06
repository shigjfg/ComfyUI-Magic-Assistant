import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MagicPowerLoraLoader";

// 全局LoRA图片缓存（类似参考代码的loraImages）
let loraImagesCache = {};

// 加载所有LoRA图片列表（类似参考代码的loadImageList）
async function loadLoraImageList() {
    try {
        const resp = await api.fetchApi("/ma/lora/images");
        loraImagesCache = await resp.json();
        console.log("[MagicPowerLora] LoRA图片列表已加载，共", Object.keys(loraImagesCache).length, "个LoRA");
    } catch (e) {
        console.error("[MagicPowerLora] 加载LoRA图片列表时出错:", e);
        loraImagesCache = {};
    }
}

// 初始化时加载图片列表
loadLoraImageList();

app.registerExtension({
    name: "Magic.Power.Lora",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
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

                this._stackWidget = stackWidget;
                this.size = [400, 600];

                this.createDOMInterface();
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

                // B. 拦截点击/拖拽 (防止移动画布)
                const stopProp = (e) => { e.stopPropagation(); };
                this.embeddedDiv.addEventListener("pointerdown", stopProp);
                this.embeddedDiv.addEventListener("pointermove", stopProp);
                this.embeddedDiv.addEventListener("pointerup", stopProp);
                this.embeddedDiv.addEventListener("mousedown", stopProp);
                this.embeddedDiv.addEventListener("mouseup", stopProp);
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

                // --- 底部按钮区 ---
                const footer = document.createElement("div");
                footer.className = "mpl-footer";
                
                const createBtn = (txt, cls, cb) => {
                    const b = document.createElement("button");
                    b.textContent = txt; b.className = cls; b.onclick = cb; return b;
                };
                footer.append(
                    createBtn("➕ 添加 Lora", "mpl-btn-add", () => this.showAddLoraModal()),
                    createBtn("📁+", "mpl-btn-icon", () => this.addFolder()),
                    createBtn("📂预设", "mpl-btn-icon", () => this.loadPresetModal())
                );
                this.embeddedDiv.appendChild(footer);

                // 使用 addDOMWidget 将 UI 添加到节点内部，自动跟随节点缩放
                this.addDOMWidget("mpl_ui", "div", this.embeddedDiv, { serialize: false });

                this.injectStyles();
                this.renderEmbeddedList();
                this.updateWidget(); 
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
                this.properties["lora_data_state"] = JSON.stringify(this.loraData);
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
                setTimeout(() => { this.createDOMInterface(); this.renderEmbeddedList(); }, 100);
                return r;
            };

            nodeType.prototype.onRemoved = function() {
                // 清理预览图和定时器
                if (this._previewTimeout) {
                    clearTimeout(this._previewTimeout);
                    this._previewTimeout = null;
                }
                if (this._previewDiv) {
                    this._previewDiv.remove();
                    this._previewDiv = null;
                }
                // 额外清理所有预览图（防止遗漏）
                const previews = document.querySelectorAll('.mpl-lora-preview');
                previews.forEach(preview => preview.remove());
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

            // 🌟 Tag编辑弹窗
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
                
                // 创建弹窗
                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    background: #2a2a2a;
                    border: 1px solid #555;
                    border-radius: 8px;
                    padding: 20px;
                    min-width: 500px;
                    max-width: 700px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.8);
                    z-index: 10002;
                `;
                
                // 标题
                const title = document.createElement("div");
                title.textContent = "编辑触发词";
                title.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    color: #eee;
                    margin-bottom: 15px;
                    border-bottom: 1px solid #444;
                    padding-bottom: 10px;
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
                
                // 创建弹窗
                const dialog = document.createElement("div");
                dialog.style.cssText = `
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
                `;
                
                const title = document.createElement("div");
                title.textContent = `编辑 LoRA 内容: ${lora.name.split(/[/\\]/).pop()}`;
                title.style.cssText = `
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    letter-spacing: 0.3px;
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
                `;
                
                // 标题
                const title = document.createElement("div");
                title.textContent = "爬取 LoRA 信息";
                title.style.cssText = `
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 2px solid #333;
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
                txtCheckbox.checked = true;
                txtCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadTxt.appendChild(txtCheckbox);
                downloadTxt.appendChild(document.createTextNode("触发词文件 (.txt)"));
                
                const downloadJson = document.createElement("label");
                downloadJson.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const jsonCheckbox = document.createElement("input");
                jsonCheckbox.type = "checkbox";
                jsonCheckbox.checked = true;
                jsonCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadJson.appendChild(jsonCheckbox);
                downloadJson.appendChild(document.createTextNode("模型介绍信息 (.json)"));
                
                const downloadImage = document.createElement("label");
                downloadImage.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; color: #eee;";
                const imageCheckbox = document.createElement("input");
                imageCheckbox.type = "checkbox";
                imageCheckbox.checked = true;
                imageCheckbox.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                downloadImage.appendChild(imageCheckbox);
                downloadImage.appendChild(document.createTextNode("预览图像"));
                
                const downloadLog = document.createElement("label");
                downloadLog.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer; color: #eee;";
                const logCheckbox = document.createElement("input");
                logCheckbox.type = "checkbox";
                logCheckbox.checked = true;
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
                sameDirRadio.checked = true;
                sameDirRadio.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                pathSameDir.appendChild(sameDirRadio);
                pathSameDir.appendChild(document.createTextNode("保存到 LoRA 同目录下"));
                
                const pathSubfolder = document.createElement("label");
                pathSubfolder.style.cssText = "display: flex; align-items: center; gap: 8px; cursor: pointer; color: #eee;";
                const subfolderRadio = document.createElement("input");
                subfolderRadio.type = "radio";
                subfolderRadio.name = "save_path";
                subfolderRadio.value = "subfolder";
                subfolderRadio.style.cssText = "width: 18px; height: 18px; cursor: pointer;";
                pathSubfolder.appendChild(subfolderRadio);
                pathSubfolder.appendChild(document.createTextNode("保存到 magicloradate 子文件夹"));
                
                pathContainer.appendChild(pathSameDir);
                pathContainer.appendChild(pathSubfolder);
                
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
                // 保留row的draggable用于移动到文件夹，但排序拖拽由排序条处理
                row.draggable = true;
                row.ondragstart = (e) => {
                    // 如果是从排序条开始的拖拽，不处理（由排序条自己处理）
                    if (e.target.classList.contains('mpl-sort-handle')) {
                        e.preventDefault();
                        return;
                    }
                    e.dataTransfer.setData("text/plain", JSON.stringify({ type, fIdx, lIdx }));
                    row.style.opacity = "0.3";
                };
                row.ondragend = () => { row.style.opacity = lora.enabled ? "1" : "0.5"; };
                
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
                    // 排除交互元素：checkbox、input、button
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || 
                        e.target.classList.contains('mpl-mini-btn') || 
                        e.target.classList.contains('mpl-mini-input')) {
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
                            this._previewDiv.innerHTML = '<div style="padding:20px;color:#888;text-align:center;">无预览图</div>';
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
                
                row.append(sortHandle, check, name, noteInput, weightContainer, tagBtn, editBtn, del);
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
                    dialog.style.cssText = "position:fixed;top:calc(50% - 400px);left:calc(50% - 400px);width:800px;height:800px;background:#25292d;border:1px solid #4a515a;z-index:9999;display:flex;flex-direction:column;border-radius:8px;box-shadow:0 8px 25px rgba(0,0,0,0.6);font-family: sans-serif;";
                    
                    dialog.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: false });
                    const stopEvent = (e) => { e.stopPropagation(); };
                    dialog.addEventListener("pointerdown", stopEvent);
                    dialog.addEventListener("pointermove", stopEvent);
                    dialog.addEventListener("pointerup", stopEvent);
                    dialog.addEventListener("mousedown", stopEvent);
                    dialog.addEventListener("keydown", stopEvent);

                    // 标题栏
                    const header = document.createElement("div");
                    header.style.cssText = "padding:10px 15px;border-bottom:1px solid #333;display:flex;gap:10px;align-items:center;background:#1a1a1a;border-radius:8px 8px 0 0;";
                    
                    const title = document.createElement("div");
                    title.textContent = "添加 Lora";
                    title.style.cssText = "color:#e0e0e0;font-weight:bold;font-size:14px;white-space:nowrap;";
                    
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
                    search.placeholder = "🔍 搜索...";
                    search.style.cssText = "width:200px;padding:6px 10px;background:#121212;color:#fff;border:1px solid #444;border-radius:4px;outline:none;font-size:13px;";
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
                    footerButtons.style.cssText = "display:flex;gap:10px;";
                    
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
                            
                            // 添加lora，使用读取到的tags
                            selectedFiles.forEach(fileName => {
                                this.loraData.loras.push({ 
                                    name: fileName, 
                                    weight: 1.0, 
                                    enabled: true, 
                                    tags: tagMap.get(fileName) || "", 
                                    note: "" 
                                });
                            });
                        } else {
                            // 不启用自动添加，直接添加lora
                            selectedFiles.forEach(fileName => {
                                this.loraData.loras.push({ 
                                    name: fileName, 
                                    weight: 1.0, 
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
                } catch(e) { alert("Error: "+e); }
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
                `;
                
                const title = document.createElement("div");
                title.textContent = "LoRA预设";
                title.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    color: #eee;
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
                
                // 加载预设列表
                await loadPresets();
            };

        }
    }
});