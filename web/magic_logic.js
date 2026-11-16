import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import "./magic_ui_shared.js";

const NODE_NAME = "MagicLogicCompute";

app.registerExtension({
    name: "Magic.Logic.Compute",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                this.logic_data = {};
                updateLogicDropdown(this);

                this.addWidget("button", "⚙️ 编辑逻辑 / Edit Logic", null, () => {
                    showLogicModal(this);
                });
                
                return r;
            };
        }
    }
});

async function updateLogicDropdown(node) {
    try {
        const response = await api.fetchApi("/ma/get_config");
        const data = await response.json();
        node.logic_data = data.logics || {};

        const widget = node.widgets.find(w => w.name === "operation");
        if (widget) {
            const keys = Object.keys(node.logic_data).sort((a,b) => {
                const aIsPre = /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(a);
                const bIsPre = /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(b);
                if(aIsPre && !bIsPre) return -1;
                if(!aIsPre && bIsPre) return 1;
                return a.localeCompare(b);
            });
            widget.options.values = keys;
            if (!keys.includes(widget.value)) widget.value = keys[0];
        }
    } catch (e) { console.error("Logic Update Error", e); }
}

async function saveLogicToServer(node) {
    try {
        const payload = { logics: node.logic_data };
        await api.fetchApi("/ma/save_config", {
            method: "POST", body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" }
        });
        const allNodes = app.graph.findNodesByType(NODE_NAME);
        allNodes.forEach(n => updateLogicDropdown(n));
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

// --- 逻辑编辑器弹窗 ---
function showLogicModal(node) {
    const dialog = document.createElement("div");
    dialog.className = "ma-modal";
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 960px; max-width: 94vw; height: 760px; max-height: 90vh;
        z-index: 10000;
    `;

    const header = document.createElement("div");
    header.className = "ma-modal-header";
    header.innerHTML = `<b class="ma-modal-title">🧠 逻辑编辑器 (Magic Script)</b>`;

    const closeBtn = document.createElement("button"); 
    closeBtn.textContent="✕";
    closeBtn.className="ma-modal-close";
    preventConflict(closeBtn); 
    closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); 
    dialog.appendChild(header);
    
    // 使用正确的拖拽函数
    makeDialogDraggable(dialog, header);

    const body = document.createElement("div");
    body.style.cssText = "flex: 1; display: flex; overflow: hidden; min-height: 0;";
    dialog.appendChild(body);

    const sidebar = document.createElement("div");
    sidebar.className = "ma-sidebar";
    sidebar.style.width = "220px";
    preventConflict(sidebar); body.appendChild(sidebar);

    const editor = document.createElement("div");
    editor.style.cssText = "flex: 1; padding: 18px; display: flex; flex-direction: column; gap: 12px; background: #111114; min-width: 0;";
    preventConflict(editor); body.appendChild(editor);

    const nameInput = document.createElement("input");
    nameInput.className = "ma-input";
    nameInput.placeholder = "逻辑名称 (例如: My Upscale)";
    preventConflict(nameInput); editor.appendChild(nameInput);

    // --- 📖 终极教程区域 ---
    const tutorialDiv = document.createElement("div");
    tutorialDiv.style.cssText = "background: #18181c; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; flex-shrink: 0;";
    preventConflict(tutorialDiv);
    
    const tutHeader = document.createElement("div");
    tutHeader.textContent = "📖 魔法脚本使用手册 (点击展开/收起)";
    tutHeader.style.cssText = "padding: 10px 14px; background: #141418; cursor: pointer; font-size: 12.5px; color: #818cf8; font-weight: 600; transition: background 0.14s;";
    tutHeader.onmouseenter = () => tutHeader.style.background = "#1c1c22";
    tutHeader.onmouseleave = () => tutHeader.style.background = "#141418";
    tutorialDiv.appendChild(tutHeader);

    const tutContent = document.createElement("div");
    tutContent.style.cssText = "padding: 15px 16px; font-size: 12.5px; color: #d4d4d8; display: none; line-height: 1.65; max-height: 320px; overflow-y: auto; background: #0d0d10; border-top: 1px solid rgba(255,255,255,0.06);";
    
    // 教程 HTML 内容
    tutContent.innerHTML = `
        <style>
            .hl { color: #fbbf24; background: #18181c; border: 1px solid rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-family: var(--ma-font-mono); font-size: 12px; }
            .var { color: #818cf8; font-weight: 600; font-family: var(--ma-font-mono); }
            .section { margin-top: 14px; margin-bottom: 6px; font-weight: 600; color: #f4f4f5; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px;}
            .comment { color: #71717a; font-style: italic; }
            .tag { display:inline-block; background:#18181c; border:1px solid rgba(255,255,255,0.12); color:#a1a1aa; padding:0 6px; border-radius:4px; font-size:11px; margin-right:6px;}
        </style>

        <div class="section" style="margin-top:0">1. 数据来源 (哪里来的 w 和 h?)</div>
        <div>本节点会自动检测左侧的连接，并把它们赋值给变量：</div>
        <div style="margin-top:5px">
            <span class="tag">image</span>连接图片时 <span class="var">w</span> = 图片宽度, <span class="var">h</span> = 图片高度<br>
            <span class="tag">latent</span>连接Latent时 <span class="var">w</span> = Latent宽x8, <span class="var">h</span> = Latent高x8 (自动换算为像素)<br>
            <span class="tag">无连接</span>如果都没连，<span class="var">w</span> = <span class="var">a</span>, <span class="var">h</span> = <span class="var">b</span> (此时变成了纯数字计算)
        </div>

        <div class="section">2. 输入参数 (Input Variables)</div>
        <div><span class="var">a</span> : 左侧输入节点 "a" 的数值 (常用于比较阈值)</div>
        <div><span class="var">b</span> : 左侧输入节点 "b" 的数值 (常用于倍率，如放大系数)</div>

        <div class="section">3. 常用函数 (Functions)</div>
        <div><span class="hl">abs(x)</span> : 绝对值。例: <code>abs(w/h - 1.5) < 0.05</code> (判断是否接近3:2)</div>
        <div><span class="hl">min(x, y)</span> : 取最小值。例: <code>min(w, 1024)</code> (限制不超过1024)</div>
        <div><span class="hl">max(x, y)</span> : 取最大值。</div>
        <div><span class="hl">round(x)</span> : 四舍五入取整。</div>

        <div class="section">4. 语法与布尔值 (Syntax & Boolean)</div>
        <div><b>基本格式：</b> <code class="hl">IF [条件] RETURN [宽], [高]</code> (若命中，Bool输出True)</div>
        <div><b>兜底格式：</b> <code class="hl">RETURN [宽], [高]</code> (若执行到这，Bool输出False)</div>
        <div><b>强制指定：</b> <code class="hl">RETURN w, h, False</code> (第三个参数控制Bool端口)</div>

        <div class="section">5. 经典案例库 (Copy & Paste)</div>
        
        <div><b>👉 案例 A：限制最大分辨率 (显存保护)</b></div>
        <div class="comment">如果宽度超过 2048，就强制变成 2048，否则保持原样。</div>
        <code>IF w > 2048 RETURN 2048, h</code><br>
        <code>RETURN w, h</code>

        <div style="margin-top:8px"><b>👉 案例 B：比较数字 (a 和 b)</b></div>
        <div class="comment">不连图片，直接比较 a 和 b。如果 a 大于 b，输出 a；否则输出 b。</div>
        <code>IF a > b RETURN a, a</code><br>
        <code>RETURN b, b</code>

        <div style="margin-top:8px"><b>👉 案例 C：复杂的 SDXL 放大</b></div>
        <div class="comment">如果是 2:3 比例且小于 1152，放大到 1152x1728。</div>
        <code>IF abs(w/h - 0.666) < 0.05 and w < 1152 RETURN 1152, 1728</code>
    `;
    tutorialDiv.appendChild(tutContent);
    editor.appendChild(tutorialDiv);

    tutHeader.onclick = () => {
        const isHidden = tutContent.style.display === "none";
        tutContent.style.display = isHidden ? "block" : "none";
        tutHeader.textContent = isHidden ? "📖 魔法脚本使用手册 (点击收起)" : "📖 魔法脚本使用手册 (点击展开/收起)";
    };

    const codeArea = document.createElement("textarea");
    codeArea.className = "ma-textarea ma-textarea-code";
    codeArea.placeholder = "在这里编写您的逻辑... (变量 w,h 会根据连接的图片自动获取)";
    codeArea.style.cssText = "flex: 1; padding: 12px; color: #34d399; resize: none;";
    preventConflict(codeArea); editor.appendChild(codeArea);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 10px; justify-content: flex-end; flex-shrink: 0;";
    
    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑️ 删除";
    delBtn.className = "ma-btn ma-btn-danger";
    delBtn.style.display = "none";
    preventConflict(delBtn);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 保存 / 新增";
    saveBtn.className = "ma-btn ma-btn-primary";
    preventConflict(saveBtn);

    btnRow.appendChild(delBtn); btnRow.appendChild(saveBtn); editor.appendChild(btnRow);

    const renderList = () => {
        sidebar.innerHTML = "";
        const keys = Object.keys(node.logic_data).sort();
        const addDiv = document.createElement("button");
        addDiv.type = "button";
        addDiv.textContent = "+ 新建逻辑";
        addDiv.className = "ma-btn ma-btn-primary";
        addDiv.style.cssText = "width: 100%; margin-bottom: 6px; justify-content: center;";
        addDiv.onclick = () => {
            nameInput.value = ""; codeArea.value = ""; 
            nameInput.disabled = false; delBtn.style.display = "none";
            sidebar.querySelectorAll(".ma-sidebar-item").forEach(el => el.classList.remove("active"));
        };
        sidebar.appendChild(addDiv);

        keys.forEach(key => {
            const item = document.createElement("button");
            item.type = "button";
            item.textContent = key;
            item.className = "ma-sidebar-item" + (nameInput.value === key ? " active" : "");
            item.style.cssText = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;";
            item.onclick = () => {
                nameInput.value = key;
                codeArea.value = node.logic_data[key];
                delBtn.style.display = "inline-flex";
                sidebar.querySelectorAll(".ma-sidebar-item").forEach(el => el.classList.remove("active"));
                item.classList.add("active");
            };
            sidebar.appendChild(item);
        });
    };

    saveBtn.onclick = () => {
        const name = nameInput.value.trim();
        const code = codeArea.value.trim();
        if (!name || !code) return alert("名称和代码不能为空");
        node.logic_data[name] = code;
        saveLogicToServer(node);
        renderList();
        alert("保存成功！");
    };

    delBtn.onclick = () => {
        const name = nameInput.value;
        if (confirm(`确定删除 "${name}" 吗?`)) {
            delete node.logic_data[name];
            saveLogicToServer(node);
            nameInput.value = ""; codeArea.value = "";
            renderList();
        }
    };

    renderList();
    document.body.appendChild(dialog);
}