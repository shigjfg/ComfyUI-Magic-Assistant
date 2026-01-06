import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MagicResolution";
console.log("🔮 Magic Resolution JS: Loaded!");

app.registerExtension({
    name: "Magic.Resolution",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                if (!this.res_config) {
                    this.res_config = { dimensions: [] };
                }
                
                // 只在首次创建时设置
                if (!this._magicResolutionSetup) {
                    this._magicResolutionSetup = true;
                    setupAutoFill(this);
                    setupSwapButton(this);

                    this.addWidget("button", "⚙️ 管理预设 / Manage Presets", null, () => {
                        showResModal(this);
                    });
                }
                
                updateResDropdown(this);
                return r;
            };

            const originalOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const r = originalOnConfigure ? originalOnConfigure.apply(this, arguments) : undefined;
                // 不再在 onConfigure 中重复调用 setupAutoFill
                return r;
            }
        }
    }
});

// --- 预设导入逻辑（简化版）---
function setupAutoFill(node) {
    const dimWidget = node.widgets.find(w => w.name === "dim_preset");
    if (!dimWidget) return;
    
    // 防止重复设置
    if (dimWidget._autoFillSetup) return;
    dimWidget._autoFillSetup = true;

    const originalCallback = dimWidget.callback;
    dimWidget.callback = (value) => {
        // 防止递归调用
        if (dimWidget._inCallback) return;
        dimWidget._inCallback = true;
        
        try {
            if (originalCallback) {
                originalCallback(value);
            }
            
            // 简单解析预设值，直接导入到输入框
            const match = value.match(/(\d+)[xX×](\d+)/);
            if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                
                const wWidget = node.widgets.find(w => w.name === "width_px");
                const hWidget = node.widgets.find(w => w.name === "height_px");
                if (wWidget && hWidget) {
                    // 临时禁用 callback 避免递归
                    const wCallback = wWidget.callback;
                    const hCallback = hWidget.callback;
                    wWidget.callback = null;
                    hWidget.callback = null;
                    wWidget.value = w;
                    hWidget.value = h;
                    wWidget.callback = wCallback;
                    hWidget.callback = hCallback;
                    node.setDirtyCanvas(true, true);
                }
            }
        } finally {
            dimWidget._inCallback = false;
        }
    };
}

// --- 交换宽高按钮（一次性按钮）---
function setupSwapButton(node) {
    // 防止重复添加
    if (node._swapButtonAdded) return;
    node._swapButtonAdded = true;
    
    // 创建交换按钮
    node.addWidget("button", "🔄 交换宽高 / Swap W/H", null, () => {
        swapWidthHeight(node);
    });
}

// 交换宽高值的函数
function swapWidthHeight(node) {
    const wWidget = node.widgets.find(w => w.name === "width_px");
    const hWidget = node.widgets.find(w => w.name === "height_px");
    
    if (wWidget && hWidget) {
        const temp = wWidget.value;
        // 临时禁用 callback 避免递归
        const wCallback = wWidget.callback;
        const hCallback = hWidget.callback;
        wWidget.callback = null;
        hWidget.callback = null;
        wWidget.value = hWidget.value;
        hWidget.value = temp;
        wWidget.callback = wCallback;
        hWidget.callback = hCallback;
        node.setDirtyCanvas(true, true);
    }
}

// 移除箭头按钮功能，避免 DOM 操作导致的递归问题
// 用户可以通过直接输入或下拉菜单来修改值

// --- 数据同步与弹窗 ---
async function updateResDropdown(node) {
    try {
        const response = await api.fetchApi("/ma/get_config");
        const data = await response.json();
        
        const dims = data.resolutions?.dimensions || [];
        
        node.res_config.dimensions = dims;

        const w = node.widgets.find(w => w.name === "dim_preset");
        if (w) w.options.values = dims;

    } catch (e) { console.error("MagicResolution Update Error", e); }
}

async function saveResToServer(node) {
    try {
        const payload = { 
            resolutions: { 
                presets: node.res_config.presets || [],
                dimensions: node.res_config.dimensions
            } 
        };
        await api.fetchApi("/ma/save_config", {
            method: "POST", body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" }
        });
        const allNodes = app.graph.findNodesByType(NODE_NAME);
        allNodes.forEach(n => updateResDropdown(n));
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

    const content = document.createElement("div");
    content.style.cssText = "flex: 1; padding: 15px; overflow-y: auto; background: #222;";
    preventConflict(content); 
    dialog.appendChild(content);

    const renderContent = () => {
        content.innerHTML = "";
        
        const inputDiv = document.createElement("div");
        inputDiv.style.cssText = "display: flex; gap: 10px; margin-bottom: 20px;";
        
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "输入名称 (e.g. SDXL_1024x1024)";
        input.style.cssText = "flex: 1; padding: 8px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px;";
        preventConflict(input);

        const addBtn = document.createElement("button");
        addBtn.textContent = "➕ 添加";
        addBtn.style.cssText = "padding: 8px 15px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;";
        preventConflict(addBtn);

        inputDiv.appendChild(input); 
        inputDiv.appendChild(addBtn); 
        content.appendChild(inputDiv);

        const listDiv = document.createElement("div");
        listDiv.style.cssText = "display: flex; flex-direction: column; gap: 5px;";
        
        const dataList = node.res_config.dimensions || [];
        const sorted = [...dataList].sort();

        sorted.forEach(val => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #333; border-radius: 4px;";
            const label = document.createElement("span"); 
            label.textContent = val;
            
            const delBtn = document.createElement("button"); 
            delBtn.textContent = "🗑️";
            delBtn.style.cssText = "background: none; border: none; cursor: pointer; color: #f44336;";
            preventConflict(delBtn);
            
            delBtn.onclick = () => {
                if(confirm(`删除 ${val}?`)) {
                    node.res_config.dimensions = node.res_config.dimensions.filter(p => p !== val);
                    saveResToServer(node); 
                    renderContent();
                }
            };
            row.appendChild(label); 
            row.appendChild(delBtn); 
            listDiv.appendChild(row);
        });
        content.appendChild(listDiv);

        addBtn.onclick = () => {
            const val = input.value.trim();
            if(!val) return;
            if(node.res_config.dimensions.includes(val)) return alert("已存在");
            if(!val.match(/x/i)) alert("建议格式: Name_WxH (例如: SD_512x512)");
            node.res_config.dimensions.push(val);
            saveResToServer(node); 
            input.value=""; 
            renderContent();
        };
    };

    renderContent();
    document.body.appendChild(dialog);
}

