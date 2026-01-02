import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

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

// --- 逻辑编辑器弹窗 ---
function showLogicModal(node) {
    const dialog = document.createElement("div");
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 950px; height: 800px; background: #222; color: #ddd;
        border: 1px solid #444; box-shadow: 0 0 20px rgba(0,0,0,0.8);
        z-index: 10000; display: flex; flex-direction: column; font-family: monospace;
        border-radius: 8px; overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = "padding: 10px; background: #333; display: flex; justify-content: space-between; border-bottom: 1px solid #444; cursor: move; user-select: none;";
    header.innerHTML = `<b>🧠 逻辑编辑器 (Magic Script)</b>`;
    let isDragging = false, startX, startY;
    header.onmousedown = (e) => { if(e.target.tagName!=="BUTTON"){isDragging=true;startX=e.clientX;startY=e.clientY;} };
    document.addEventListener("mousemove", (e)=>{if(isDragging){dialog.style.left=(parseFloat(dialog.style.left||window.innerWidth/2)+(e.clientX-startX))+"px";dialog.style.top=(parseFloat(dialog.style.top||window.innerHeight/2)+(e.clientY-startY))+"px";startX=e.clientX;startY=e.clientY;}});
    document.addEventListener("mouseup", ()=>{isDragging=false;});

    const closeBtn = document.createElement("button"); closeBtn.textContent="✕";
    closeBtn.style.cssText="background:none;border:none;color:#fff;cursor:pointer;";
    preventConflict(closeBtn); closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); dialog.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "flex: 1; display: flex; overflow: hidden;";
    dialog.appendChild(body);

    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width: 220px; background: #1a1a1a; border-right: 1px solid #444; overflow-y: auto; padding: 10px;";
    preventConflict(sidebar); body.appendChild(sidebar);

    const editor = document.createElement("div");
    editor.style.cssText = "flex: 1; padding: 15px; display: flex; flex-direction: column; gap: 10px; background: #222;";
    preventConflict(editor); body.appendChild(editor);

    const nameInput = document.createElement("input");
    nameInput.placeholder = "逻辑名称 (例如: My Upscale)";
    nameInput.style.cssText = "padding: 8px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px;";
    preventConflict(nameInput); editor.appendChild(nameInput);

    // --- 📖 终极教程区域 ---
    const tutorialDiv = document.createElement("div");
    tutorialDiv.style.cssText = "background: #2a2a2a; border-radius: 4px; border: 1px solid #444; overflow: hidden;";
    preventConflict(tutorialDiv);
    
    const tutHeader = document.createElement("div");
    tutHeader.textContent = "📖 魔法脚本使用手册 (点击展开/收起)";
    tutHeader.style.cssText = "padding: 10px; background: #333; cursor: pointer; font-size: 13px; color: #4caf50; font-weight: bold;";
    tutorialDiv.appendChild(tutHeader);

    const tutContent = document.createElement("div");
    tutContent.style.cssText = "padding: 15px; font-size: 13px; color: #ccc; display: none; line-height: 1.6; max-height: 350px; overflow-y: auto; background: #1e1e1e;";
    
    // 教程 HTML 内容
    tutContent.innerHTML = `
        <style>
            .hl { color: #ff9800; background: #333; padding: 1px 4px; border-radius: 3px; font-family: monospace; }
            .var { color: #64b5f6; font-weight: bold; }
            .section { margin-top: 15px; margin-bottom: 5px; font-weight: bold; color: #fff; border-bottom: 1px solid #444; padding-bottom: 4px;}
            .comment { color: #777; font-style: italic; }
            .tag { display:inline-block; border:1px solid #555; padding:0 4px; border-radius:4px; font-size:12px; margin-right:5px;}
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
    codeArea.placeholder = "在这里编写您的逻辑... (变量 w,h 会根据连接的图片自动获取)";
    codeArea.style.cssText = "flex: 1; padding: 10px; background: #111; color: #0f0; border: 1px solid #444; border-radius: 4px; line-height: 1.5; font-family: monospace; font-size: 14px;";
    preventConflict(codeArea); editor.appendChild(codeArea);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 10px; justify-content: flex-end;";
    
    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑️ 删除";
    delBtn.style.cssText = "padding: 8px 15px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; display: none;";
    preventConflict(delBtn);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 保存 / 新增";
    saveBtn.style.cssText = "padding: 8px 15px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;";
    preventConflict(saveBtn);

    btnRow.appendChild(delBtn); btnRow.appendChild(saveBtn); editor.appendChild(btnRow);

    const renderList = () => {
        sidebar.innerHTML = "";
        const keys = Object.keys(node.logic_data).sort();
        const addDiv = document.createElement("div");
        addDiv.textContent = "+ 新建逻辑";
        addDiv.style.cssText = "padding: 8px; cursor: pointer; color: #2196F3; font-weight: bold; border-bottom: 1px solid #333; margin-bottom: 5px;";
        addDiv.onclick = () => {
            nameInput.value = ""; codeArea.value = ""; 
            nameInput.disabled = false; delBtn.style.display = "none";
        };
        sidebar.appendChild(addDiv);

        keys.forEach(key => {
            const item = document.createElement("div");
            item.textContent = key;
            item.style.cssText = "padding: 8px; cursor: pointer; color: #ddd; border-bottom: 1px solid #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
            item.onmouseover = () => item.style.background = "#333";
            item.onmouseout = () => item.style.background = "transparent";
            item.onclick = () => {
                nameInput.value = key;
                codeArea.value = node.logic_data[key];
                delBtn.style.display = "block";
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