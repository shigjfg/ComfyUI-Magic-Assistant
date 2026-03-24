import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MagicResolutionResize";
console.log("🔮 Magic Resize JS: Loaded! (Version 3.1 - Clean Mode)"); 

app.registerExtension({
    name: "Magic.Resolution.Resize",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                this.res_config = { presets: [], dimensions: [] };
                
                setupDynamicWidgets(this);
                setupAutoFill(this);

                this.addWidget("button", "⚙️ 管理预设 / Manage Presets", null, () => {
                    showResModal(this);
                });
                
                updateResDropdown(this);
                return r;
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                setTimeout(() => { setupDynamicWidgets(this); }, 100);
                return r;
            }
        }
    }
});

// --- 自动填充逻辑 ---
function setupAutoFill(node) {
    const dimWidget = node.widgets.find(w => w.name === "dim_preset");
    if (!dimWidget) return;

    const originalCallback = dimWidget.callback;
    dimWidget.callback = (value) => {
        if (originalCallback) originalCallback(value);
        const match = value.match(/(\d+)[xX×](\d+)/);
        if (match) {
            const w = parseInt(match[1]);
            const h = parseInt(match[2]);
            const wWidget = node.widgets.find(w => w.name === "width_px");
            const hWidget = node.widgets.find(w => w.name === "height_px");
            if (wWidget && hWidget) {
                wWidget.value = w;
                hWidget.value = h;
                node.setDirtyCanvas(true, true);
            }
        }
    };
}

// --- 动态显示/隐藏 (核心修改) ---
function setupDynamicWidgets(node) {
    const modeWidget = node.widgets.find(w => w.name === "mode");
    if (!modeWidget) return;

    const refreshWidgets = () => {
        const mode = modeWidget.value;
        
        const w_res = node.widgets.find(w => w.name === "resolution");
        const w_scale = node.widgets.find(w => w.name === "scale_ratio");
        const w_dim_preset = node.widgets.find(w => w.name === "dim_preset");
        const w_width = node.widgets.find(w => w.name === "width_px");
        const w_height = node.widgets.find(w => w.name === "height_px");
        const w_method = node.widgets.find(w => w.name === "method"); // 新增：获取算法控件

        const setVisible = (w, visible) => {
            if (!w) return;
            if (visible) {
                if (w.type === "hidden" && w.origType) {
                    w.type = w.origType;
                    w.computeSize = w.origComputeSize;
                }
            } else {
                if (w.type !== "hidden") {
                    w.origType = w.type;
                    w.origComputeSize = w.computeSize;
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                }
            }
        };

        // 逻辑判断
        if (mode.includes("Long Edge") || mode.includes("长边")) {
            // 模式1: 仅显示分辨率
            setVisible(w_res, true);
            setVisible(w_method, false); // 隐藏算法
            setVisible(w_scale, false);
            setVisible(w_dim_preset, false); setVisible(w_width, false); setVisible(w_height, false);
        } else if (mode.includes("Ratio") || mode.includes("比例")) {
            // 模式2: 显示比例 + 算法
            setVisible(w_res, false);
            setVisible(w_method, true);  // 显示算法
            setVisible(w_scale, true);
            setVisible(w_dim_preset, false); setVisible(w_width, false); setVisible(w_height, false);
        } else if (mode.includes("Dimensions") || mode.includes("尺寸")) {
            // 模式3: 显示尺寸控件 + 算法
            setVisible(w_res, false);
            setVisible(w_method, true);  // 显示算法
            setVisible(w_scale, false);
            setVisible(w_dim_preset, true); setVisible(w_width, true); setVisible(w_height, true);
        }
        
        node.setDirtyCanvas(true, true);
        node.setSize(node.computeSize());
    };

    modeWidget.callback = refreshWidgets;
    setTimeout(refreshWidgets, 50);
}

// --- 数据同步与弹窗 (保持不变) ---
async function updateResDropdown(node) {
    try {
        const response = await api.fetchApi("/ma/get_config");
        const data = await response.json();
        
        const presets = data.resolutions?.presets || [];
        const dims = data.resolutions?.dimensions || [];
        
        node.res_config.presets = presets;
        node.res_config.dimensions = dims;

        const w1 = node.widgets.find(w => w.name === "resolution");
        if (w1) w1.options.values = presets;

        const w2 = node.widgets.find(w => w.name === "dim_preset");
        if (w2) w2.options.values = dims;

    } catch (e) { console.error("MagicResize Update Error", e); }
}

async function saveResToServer(node) {
    try {
        const payload = { 
            resolutions: { 
                presets: node.res_config.presets,
                dimensions: node.res_config.dimensions
            } 
        };
        await api.fetchApi("/ma/save_config", {
            method: "POST", body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" }
        });
        const allResNodes = app.graph.findNodesByType("MagicResolution");
        const allResizeNodes = app.graph.findNodesByType("MagicResolutionResize");
        [...allResNodes, ...allResizeNodes].forEach(n => updateResDropdown(n));
    } catch (e) { alert("保存失败: " + e); }
}

function preventConflict(element) {
    element.addEventListener("pointerdown", (e) => e.stopPropagation());
    element.addEventListener("mousedown", (e) => e.stopPropagation());
    element.addEventListener("click", (e) => e.stopPropagation());
    element.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
}

function makeDialogDraggable(dialog, titleBar) {
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
        
        // 获取弹窗的当前位置（相对于视口）
        const rect = dialog.getBoundingClientRect();
        
        // 获取鼠标点击位置
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
        
        // 计算偏移量（鼠标位置相对于弹窗左上角的偏移）
        offsetX = mouseX - rect.left;
        offsetY = mouseY - rect.top;
        
        e.preventDefault();
    };
    
    const drag = (e) => {
        if (!isDragging) return;
        
        e.preventDefault();
        
        // 获取当前鼠标位置
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
        
        // 计算新位置（鼠标位置减去偏移量）
        let newX = mouseX - offsetX;
        let newY = mouseY - offsetY;
        
        // 限制拖拽范围，确保弹窗不会完全移出屏幕
        const minX = 0;
        const minY = 0;
        const maxX = window.innerWidth - dialog.offsetWidth;
        const maxY = window.innerHeight - dialog.offsetHeight;
        
        // 确保在屏幕范围内
        newX = Math.max(minX, Math.min(newX, maxX));
        newY = Math.max(minY, Math.min(newY, maxY));
        
        // 移除原有的定位方式（top/left/right/bottom），改用transform
        dialog.style.top = '';
        dialog.style.left = '';
        dialog.style.right = '';
        dialog.style.bottom = '';
        
        // 如果父元素是flex居中，需要移除flex定位
        const parent = dialog.parentElement;
        if (parent && parent.style.display === 'flex') {
            parent.style.display = 'block';
            parent.style.position = 'fixed';
            parent.style.top = '0';
            parent.style.left = '0';
            parent.style.width = '100%';
            parent.style.height = '100%';
        }
        
        // 确保dialog使用fixed定位
        dialog.style.position = 'fixed';
        
        // 应用transform
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
}

function showResModal(node) {
    const dialog = document.createElement("div");
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 450px; height: 600px; background: #222; color: #ddd;
        border: 1px solid #444; box-shadow: 0 0 20px rgba(0,0,0,0.8);
        z-index: 10000; display: flex; flex-direction: column; font-family: sans-serif;
        border-radius: 8px; overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = "padding: 10px; background: #333; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444; cursor: move; user-select: none;";
    header.innerHTML = `<b>📏 预设管理中心</b>`;

    const closeBtn = document.createElement("button"); 
    closeBtn.textContent="✕";
    closeBtn.style.cssText="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:0 10px;";
    preventConflict(closeBtn); 
    closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); 
    dialog.appendChild(header);
    
    // 使用正确的拖拽函数
    makeDialogDraggable(dialog, header);

    const tabContainer = document.createElement("div");
    tabContainer.style.cssText = "display: flex; background: #111;";
    const btnStyle = "flex: 1; padding: 10px; border: none; background: #111; color: #888; cursor: pointer; border-bottom: 2px solid transparent;";
    const activeStyle = "background: #2a2a2a; color: #fff; border-bottom: 2px solid #2196F3;";
    
    const tab1 = document.createElement("button"); tab1.textContent = "长边数值 (Long Edge)"; tab1.style.cssText = btnStyle;
    const tab2 = document.createElement("button"); tab2.textContent = "尺寸组合 (Dimensions)"; tab2.style.cssText = btnStyle;
    
    preventConflict(tab1); preventConflict(tab2);
    tabContainer.appendChild(tab1); tabContainer.appendChild(tab2);
    dialog.appendChild(tabContainer);

    const content = document.createElement("div");
    content.style.cssText = "flex: 1; padding: 15px; overflow-y: auto; background: #222;";
    preventConflict(content); dialog.appendChild(content);

    let currentTab = "preset";

    const renderContent = () => {
        content.innerHTML = "";
        
        const inputDiv = document.createElement("div");
        inputDiv.style.cssText = "display: flex; gap: 10px; margin-bottom: 20px;";
        
        const input = document.createElement("input");
        input.style.cssText = "flex: 1; padding: 8px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px;";
        
        if (currentTab === "preset") {
            input.type = "number"; input.placeholder = "输入数值 (e.g. 1280)";
        } else {
            input.type = "text"; input.placeholder = "输入名称 (e.g. SDXL_1024x1024)";
        }
        preventConflict(input);

        const addBtn = document.createElement("button");
        addBtn.textContent = "➕ 添加";
        addBtn.style.cssText = "padding: 8px 15px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;";
        preventConflict(addBtn);

        inputDiv.appendChild(input); inputDiv.appendChild(addBtn); content.appendChild(inputDiv);

        const listDiv = document.createElement("div");
        listDiv.style.cssText = "display: flex; flex-direction: column; gap: 5px;";
        
        const dataList = currentTab === "preset" ? node.res_config.presets : node.res_config.dimensions;
        const sorted = currentTab === "preset" ? [...dataList].sort((a,b)=>a-b) : [...dataList].sort();

        sorted.forEach(val => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #333; border-radius: 4px;";
            const label = document.createElement("span");
            label.textContent = currentTab === "preset" ? `${val} px` : val;
            label.style.cssText = "flex: 1; cursor: pointer; padding: 2px 5px; border-radius: 3px;";
            label.title = "双击编辑";
            preventConflict(label);

            let isEditing = false;

            const startEdit = () => {
                if (isEditing) return;
                isEditing = true;

                const input = document.createElement("input");
                input.type = currentTab === "preset" ? "number" : "text";
                input.value = currentTab === "preset" ? val : val;
                input.style.cssText = "flex: 1; padding: 4px 5px; background: #111; color: #fff; border: 1px solid #2196F3; border-radius: 3px; font-size: 13px;";

                const finishEdit = (save) => {
                    if (!isEditing) return;
                    isEditing = false;
                    if (save && input.value.trim()) {
                        const newVal = input.value.trim();
                        if (newVal !== String(val)) {
                            if (currentTab === "preset") {
                                const num = currentTab === "preset" ? parseInt(newVal) : newVal;
                                if (isNaN(num)) { row.innerHTML = ""; row.appendChild(label); row.appendChild(delBtn); return; }
                                node.res_config.presets = node.res_config.presets.filter(p => p !== val);
                                node.res_config.presets.push(num);
                            } else {
                                node.res_config.dimensions = node.res_config.dimensions.filter(p => p !== val);
                                node.res_config.dimensions.push(newVal);
                            }
                            saveResToServer(node);
                            renderContent();
                            return;
                        }
                    }
                    label.textContent = currentTab === "preset" ? `${val} px` : val;
                    row.innerHTML = "";
                    row.appendChild(label);
                    row.appendChild(delBtn);
                    attachEvents();
                };

                input.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") { e.preventDefault(); finishEdit(true); }
                    if (e.key === "Escape") { e.preventDefault(); finishEdit(false); }
                });
                input.addEventListener("blur", () => finishEdit(true));
                preventConflict(input);

                row.innerHTML = "";
                row.appendChild(input);
                row.style.justifyContent = "flex-start";
                row.style.gap = "8px";
                input.focus();
                input.select();
            };

            label.addEventListener("dblclick", startEdit);

            const delBtn = document.createElement("button"); delBtn.textContent = "🗑️";
            delBtn.style.cssText = "background: none; border: none; cursor: pointer; color: #f44336;";
            preventConflict(delBtn);

            delBtn.onclick = () => {
                if(confirm(`删除 ${val}?`)) {
                    if(currentTab === "preset") {
                        node.res_config.presets = node.res_config.presets.filter(p => p !== val);
                    } else {
                        node.res_config.dimensions = node.res_config.dimensions.filter(p => p !== val);
                    }
                    saveResToServer(node); renderContent();
                }
            };

            const attachEvents = () => {
                label.addEventListener("dblclick", startEdit);
            };
            attachEvents();

            row.appendChild(label); row.appendChild(delBtn); listDiv.appendChild(row);
        });
        content.appendChild(listDiv);

        addBtn.onclick = () => {
            const val = input.value;
            if(!val) return;
            if(currentTab === "preset") {
                const num = parseInt(val);
                if(node.res_config.presets.includes(num)) return alert("已存在");
                node.res_config.presets.push(num);
            } else {
                if(node.res_config.dimensions.includes(val)) return alert("已存在");
                if(!val.match(/x/i)) alert("建议格式: Name_WxH (例如: SD_512x512)");
                node.res_config.dimensions.push(val);
            }
            saveResToServer(node); input.value=""; renderContent();
        };
    };

    tab1.onclick = () => { currentTab = "preset"; tab1.style.cssText=btnStyle+activeStyle; tab2.style.cssText=btnStyle; renderContent(); };
    tab2.onclick = () => { currentTab = "dimension"; tab2.style.cssText=btnStyle+activeStyle; tab1.style.cssText=btnStyle; renderContent(); };
    
    tab1.click();
    document.body.appendChild(dialog);
}