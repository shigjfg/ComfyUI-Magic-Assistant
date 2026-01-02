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
    header.style.cssText = "padding: 10px; background: #333; display: flex; justify-content: space-between; border-bottom: 1px solid #444; cursor: move; user-select: none;";
    header.innerHTML = `<b>📏 预设管理中心</b>`;
    
    let isDragging = false, startX, startY;
    header.onmousedown = (e) => { if(e.target.tagName!=="BUTTON"){isDragging=true;startX=e.clientX;startY=e.clientY;} };
    document.addEventListener("mousemove", (e)=>{if(isDragging){dialog.style.left=(parseFloat(dialog.style.left||window.innerWidth/2)+(e.clientX-startX))+"px";dialog.style.top=(parseFloat(dialog.style.top||window.innerHeight/2)+(e.clientY-startY))+"px";startX=e.clientX;startY=e.clientY;}});
    document.addEventListener("mouseup", ()=>{isDragging=false;});

    const closeBtn = document.createElement("button"); closeBtn.textContent="✕";
    closeBtn.style.cssText="background:none;border:none;color:#fff;cursor:pointer;";
    preventConflict(closeBtn); closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); dialog.appendChild(header);

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