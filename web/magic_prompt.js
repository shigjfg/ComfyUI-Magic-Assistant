import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { refreshMagicPromptReplaceNodes } from "./magic_llm_shared.js";

// 必须与 __init__.py 和 nodes.py 中的类名完全一致
const NODE_NAME = "MagicPromptReplace";

app.registerExtension({
    name: "Magic.Assistant", // 插件注册名
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            const reorderOriginalPromptInput = function (node) {
                const list = node.inputs;
                if (!list || !list.length) return;
                const ix = list.findIndex((i) => i.name === "original_prompt_in");
                if (ix <= 0) return;
                const [inp] = list.splice(ix, 1);
                list.unshift(inp);
                // 显示名与 Python 侧语义一致：外接点表示「原始提示词」
                if (inp) {
                    if (Object.prototype.hasOwnProperty.call(inp, "localized_name")) {
                        inp.localized_name = "original_prompt";
                    }
                    if (Object.prototype.hasOwnProperty.call(inp, "label")) {
                        inp.label = "original_prompt";
                    }
                }
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // 将 optional 的 original_prompt_in 插槽移到最上方（默认会在所有 required 之后）
                const scheduleReorder = () => {
                    queueMicrotask(() => reorderOriginalPromptInput(this));
                    setTimeout(() => reorderOriginalPromptInput(this), 0);
                };
                scheduleReorder();

                const onConfigure = this.onConfigure;
                this.onConfigure = function (info) {
                    const cr = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                    scheduleReorder.call(this);
                    return cr;
                };

                // 添加设置按钮
                this.addWidget("button", "⚙️ 配置中心 / Settings", null, () => {
                    showSettingsModal(this);
                });

                // 初始化配置对象 (改名为 ma_config)
                this.ma_config = { rules: {}, llm: {} };
                updateNodeDropdowns(this);
                return r;
            };
        }
    }
});

// 更新下拉菜单
async function updateNodeDropdowns(node) {
    try {
        // API 路径改为 /ma/
        const response = await api.fetchApi("/ma/get_config");
        const data = await response.json();
        node.ma_config.rules = data.rules;
        node.ma_config.llm = data.llm;

        // 1. 更新 Rule 下拉
        const ruleNames = Object.values(data.rules).map(r => r.name);
        const ruleWidget = node.widgets.find(w => w.name === "rule_name");
        if (ruleWidget) {
            ruleWidget.options.values = ruleNames.length ? ruleNames : ["No Rules"];
            // 保持当前选项，除非它被删除了
            if (!ruleNames.includes(ruleWidget.value)) ruleWidget.value = ruleNames[0] || "";
        }

        // 2. 更新 LLM 下拉
        const llmNames = Object.keys(data.llm);
        const llmWidget = node.widgets.find(w => w.name === "llm_profile");
        if (llmWidget) {
            llmWidget.options.values = llmNames.length ? llmNames : ["No Profiles"];
            if (!llmNames.includes(llmWidget.value)) llmWidget.value = llmNames[0] || "";
        }

        node.setDirtyCanvas(true, true); 
    } catch (e) {
        console.error("MagicAssistant Update Error", e);
    }
}

// 保存配置到服务器（与 magic_llm_shared 共用刷新逻辑，保证与多功能提示词框的 LLM 列表同步）
async function saveConfigToServer(data) {
    try {
        const response = await api.fetchApi("/ma/save_config", {
            method: "POST",
            body: JSON.stringify(data),
            headers: { "Content-Type": "application/json" }
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        await refreshMagicPromptReplaceNodes();
        return true;
    } catch (e) {
        console.error("[MagicPromptReplace] 保存配置失败", e);
        alert("保存失败 / Save Failed: " + e);
        return false;
    }
}

// 防止点击穿透
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

// 显示设置窗口
function showSettingsModal(node) {
    const dialog = document.createElement("div");
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 650px; height: 550px; background: #222; color: #ddd;
        border: 1px solid #444; box-shadow: 0 0 20px rgba(0,0,0,0.8);
        z-index: 10000; display: flex; flex-direction: column; font-family: sans-serif;
        border-radius: 8px; overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = "padding: 12px; background: #333; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444; cursor: move; user-select: none;";
    header.innerHTML = `<b>🔮 Magic Assistant 配置中心</b>`;

    const closeBtn = document.createElement("button"); 
    closeBtn.textContent="✕"; 
    closeBtn.style.cssText="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:0 10px;";
    preventConflict(closeBtn); 
    closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); 
    dialog.appendChild(header);
    
    // 使用正确的拖拽函数
    makeDialogDraggable(dialog, header);

    const body = document.createElement("div"); body.style.cssText="flex:1;display:flex;overflow:hidden;"; dialog.appendChild(body);

    // Sidebar
    const sidebar = document.createElement("div"); sidebar.style.cssText="width:140px;background:#1a1a1a;border-right:1px solid #333;display:flex;flex-direction:column;";
    const btnStyle = "padding:12px;text-align:left;background:none;border:none;color:#bbb;cursor:pointer;border-bottom:1px solid #333;";
    const activeStyle = btnStyle + "background:#2a2a2a;color:#fff;font-weight:bold;border-left:3px solid #9C27B0;"; // 紫色主题
    
    const tabRule = document.createElement("button"); tabRule.textContent="📋 规则编辑器"; tabRule.style.cssText=activeStyle;
    const tabLLM = document.createElement("button"); tabLLM.textContent="🤖 LLM服务"; tabLLM.style.cssText=btnStyle;
    preventConflict(tabRule); preventConflict(tabLLM);
    sidebar.appendChild(tabRule); sidebar.appendChild(tabLLM); body.appendChild(sidebar);

    const content = document.createElement("div"); content.style.cssText="flex:1;padding:20px;overflow-y:auto;background:#222;";
    preventConflict(content); body.appendChild(content);

    // --- TAB 1: Rules ---
    let curRuleId = Object.keys(node.ma_config.rules)[0];
    const renderRuleTab = () => {
        content.innerHTML = "";
        
        const selDiv = document.createElement("div"); selDiv.innerHTML=`<label style="color:#888;font-size:12px;">编辑规则 (Edit Rule):</label>`;
        const select = document.createElement("select"); select.style.cssText="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;margin-bottom:15px;border-radius:4px;";
        preventConflict(select);
        const refreshList = () => {
            select.innerHTML = "";
            Object.keys(node.ma_config.rules).forEach(k => {
                const opt = document.createElement("option"); opt.value=k; opt.textContent=node.ma_config.rules[k].name;
                if(k===curRuleId) opt.selected=true; select.appendChild(opt);
            });
        };
        refreshList();
        select.onchange=(e)=>{ curRuleId=e.target.value; loadVals(); };
        selDiv.appendChild(select); content.appendChild(selDiv);

        const createInp = (lbl, isArea) => {
            const div = document.createElement("div"); div.style.marginBottom="10px";
            div.innerHTML=`<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">${lbl}</label>`;
            const inp = isArea?document.createElement("textarea"):document.createElement("input");
            inp.style.cssText="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;";
            if(isArea) inp.rows=4; preventConflict(inp);
            div.appendChild(inp); content.appendChild(div); return inp;
        };
        const nameInp = createInp("名称 (Name)", false);
        const sysInp = createInp("System Prompt", true);
        const guideInp = createInp("Guide", true);

        const btnDiv = document.createElement("div"); btnDiv.style.cssText="display:flex;gap:10px;margin-top:20px;";
        const mkBtn=(txt,col,cb)=>{
            const b=document.createElement("button"); b.textContent=txt; b.style.cssText=`flex:1;padding:10px;background:${col};color:white;border:none;border-radius:4px;cursor:pointer;`;
            preventConflict(b); b.onclick=cb; btnDiv.appendChild(b);
        };
        mkBtn("➕ 新建", "#2196F3", ()=>{
            const id="rule_"+Date.now(); node.ma_config.rules[id]={name:"New Rule",system:"",guide:""};
            curRuleId=id; saveConfigToServer(node.ma_config); refreshList(); loadVals();
        });
        mkBtn("💾 保存", "#4CAF50", ()=>{
            node.ma_config.rules[curRuleId]={name:nameInp.value,system:sysInp.value,guide:guideInp.value};
            saveConfigToServer(node.ma_config); refreshList(); alert("Saved!");
        });
        mkBtn("🗑️ 删除", "#f44336", ()=>{
            if(Object.keys(node.ma_config.rules).length<=1)return alert("Keep at least one!");
            delete node.ma_config.rules[curRuleId]; curRuleId=Object.keys(node.ma_config.rules)[0];
            saveConfigToServer(node.ma_config); refreshList(); loadVals();
        });
        content.appendChild(btnDiv);

        const loadVals = () => {
            const r = node.ma_config.rules[curRuleId];
            if(r){ nameInp.value=r.name; sysInp.value=r.system; guideInp.value=r.guide; }
        };
        if(curRuleId) loadVals();
    };

    // --- TAB 2: LLM ---
    let curLLMName = Object.keys(node.ma_config.llm)[0] || "";
    const renderLLMTab = () => {
        content.innerHTML = "";
        
        const selDiv = document.createElement("div"); selDiv.innerHTML=`<label style="color:#888;font-size:12px;">选择配置 (Select Profile):</label>`;
        const select = document.createElement("select"); select.style.cssText="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;margin-bottom:15px;border-radius:4px;";
        preventConflict(select);
        
        const refreshList = () => {
            select.innerHTML = "";
            const keys = Object.keys(node.ma_config.llm);
            if(keys.length===0) { node.ma_config.llm["Default"]={base_url:"",api_key:"",model:"",connect_timeout:15,read_timeout:180,max_retries:1}; keys.push("Default"); }
            if(!curLLMName || !node.ma_config.llm[curLLMName]) curLLMName = keys[0];
            keys.forEach(k => {
                const opt = document.createElement("option"); opt.value=k; opt.textContent=k;
                if(k===curLLMName) opt.selected=true; select.appendChild(opt);
            });
        };
        refreshList();
        select.onchange=(e)=>{ curLLMName=e.target.value; loadVals(); };
        selDiv.appendChild(select); content.appendChild(selDiv);

        const nameDiv = document.createElement("div"); nameDiv.style.marginBottom="10px";
        nameDiv.innerHTML=`<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">配置名称 (Profile Name):</label>`;
        const nameInp = document.createElement("input"); nameInp.style.cssText="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
        preventConflict(nameInp); nameDiv.appendChild(nameInp); content.appendChild(nameDiv);

        // Quick URLs
        const quickDiv = document.createElement("div"); quickDiv.style.cssText="display:flex;gap:5px;margin-bottom:10px;";
        const addQuick = (name, url) => {
            const b=document.createElement("button"); b.textContent=name; b.style.cssText="padding:5px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:15px;cursor:pointer;font-size:11px;";
            preventConflict(b); b.onclick=()=>{ urlInp.value=url; }; quickDiv.appendChild(b);
        };
        addQuick("OpenAI", "https://api.openai.com/v1");
        addQuick("DeepSeek", "https://api.deepseek.com/v1");
        addQuick("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/");
        addQuick("SiliconFlow", "https://api.siliconflow.cn/v1");
        content.appendChild(quickDiv);

        const createInp = (lbl, type="text") => {
            const div = document.createElement("div"); div.style.marginBottom="10px";
            div.innerHTML=`<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">${lbl}</label>`;
            const inp = document.createElement("input"); inp.type=type;
            inp.style.cssText="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
            preventConflict(inp); div.appendChild(inp); content.appendChild(div); return inp;
        };
        const urlInp = createInp("Base URL");
        const keyInp = createInp("API Key", "password");

        const requestOptionsTitle = document.createElement("div");
        requestOptionsTitle.textContent = "请求容错 / Request Resilience";
        requestOptionsTitle.style.cssText = "margin:14px 0 8px;color:#bbb;font-size:12px;font-weight:bold;border-top:1px solid #444;padding-top:12px;";
        content.appendChild(requestOptionsTitle);
        const timeoutRow = document.createElement("div");
        timeoutRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;";
        const createNumberInp = (label, min, max, fallback, title) => {
            const wrap = document.createElement("label");
            wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;color:#888;font-size:11px;";
            wrap.textContent = label;
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = String(min);
            inp.max = String(max);
            inp.value = String(fallback);
            inp.title = title;
            inp.style.cssText = "width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;";
            preventConflict(inp);
            wrap.appendChild(inp);
            timeoutRow.appendChild(wrap);
            return inp;
        };
        const connectTimeoutInp = createNumberInp("连接超时(秒)", 3, 120, 15, "DNS/TCP/TLS 建立连接的最长等待时间");
        const readTimeoutInp = createNumberInp("读取超时(秒)", 30, 600, 180, "连接成功后等待模型生成响应的最长时间");
        const maxRetriesInp = createNumberInp("重试次数", 0, 3, 1, "读取超时、临时 HTTP 错误或空响应时的最多重试次数");
        content.appendChild(timeoutRow);
        const requestHint = document.createElement("div");
        requestHint.textContent = "建议：慢速模型读取超时设为 180–300 秒；重试会增加最长等待时间和可能的计费次数。";
        requestHint.style.cssText = "color:#777;font-size:11px;line-height:1.5;margin-top:-4px;margin-bottom:10px;";
        content.appendChild(requestHint);
        
        const modelDiv = document.createElement("div"); modelDiv.style.marginBottom="10px";
        modelDiv.innerHTML=`<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">Model Name</label>`;
        const mRow = document.createElement("div"); mRow.style.cssText="display:flex;gap:5px;";
        const modelInp = document.createElement("input"); modelInp.style.cssText="flex:1;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
        modelInp.setAttribute("list", "ma_llm_models"); preventConflict(modelInp);
        
        const dl = document.createElement("datalist"); dl.id="ma_llm_models";
        const searchBtn = document.createElement("button"); searchBtn.textContent="🔍"; searchBtn.style.cssText="padding:0 12px;cursor:pointer;background:#333;color:#fff;border:1px solid #555;border-radius:4px;";
        preventConflict(searchBtn);
        
        mRow.appendChild(modelInp); mRow.appendChild(searchBtn); mRow.appendChild(dl); modelDiv.appendChild(mRow); content.appendChild(modelDiv);

        const btnDiv = document.createElement("div"); btnDiv.style.cssText="display:flex;gap:10px;margin-top:20px;";
        const mkBtn=(txt,col,cb)=>{
            const b=document.createElement("button"); b.textContent=txt; b.style.cssText=`flex:1;padding:10px;background:${col};color:white;border:none;border-radius:4px;cursor:pointer;`;
            preventConflict(b); b.onclick=cb; btnDiv.appendChild(b);
        };
        
        mkBtn("➕ 新建配置", "#2196F3", ()=>{
            const newName = "New Profile " + (Object.keys(node.ma_config.llm).length+1);
            node.ma_config.llm[newName] = { base_url:"", api_key:"", model:"", connect_timeout:15, read_timeout:180, max_retries:1 };
            curLLMName = newName; saveConfigToServer(node.ma_config); refreshList(); loadVals();
        });
        mkBtn("💾 保存当前", "#4CAF50", ()=>{
            const oldName = curLLMName; const newName = nameInp.value || "Untitled";
            if (oldName !== newName) { delete node.ma_config.llm[oldName]; curLLMName = newName; }
            node.ma_config.llm[newName] = {
                base_url: urlInp.value,
                api_key: keyInp.value,
                model: modelInp.value,
                connect_timeout: Math.max(3, Math.min(120, Number(connectTimeoutInp.value) || 15)),
                read_timeout: Math.max(30, Math.min(600, Number(readTimeoutInp.value) || 180)),
                max_retries: Math.max(0, Math.min(3, Number(maxRetriesInp.value) || 0))
            };
            saveConfigToServer(node.ma_config); refreshList(); alert("Saved!");
        });
        mkBtn("🗑️ 删除", "#f44336", ()=>{
            if(Object.keys(node.ma_config.llm).length<=1) return alert("Keep at least one!");
            if(!confirm(`Delete ${curLLMName}?`)) return;
            delete node.ma_config.llm[curLLMName]; curLLMName=Object.keys(node.ma_config.llm)[0];
            saveConfigToServer(node.ma_config); refreshList(); loadVals();
        });
        content.appendChild(btnDiv);

        const loadVals = () => {
            const d = node.ma_config.llm[curLLMName];
            if(d){
                nameInp.value=curLLMName;
                urlInp.value=d.base_url;
                keyInp.value=d.api_key;
                modelInp.value=d.model;
                connectTimeoutInp.value=d.connect_timeout ?? 15;
                readTimeoutInp.value=d.read_timeout ?? 180;
                maxRetriesInp.value=d.max_retries ?? 1;
            }
        };
        if(curLLMName) loadVals();

        searchBtn.onclick = async () => {
            const url = urlInp.value.replace(/\/$/, ""); const key = keyInp.value;
            if(!url||!key) return alert("Fill URL & Key");
            searchBtn.textContent="...";
            try{
                let ep = url; if(!url.includes("/v1")&&!url.includes("silicon")&&!url.includes("deepseek")) ep+="/v1";
                const res = await fetch(`${ep}/models`, {headers:{"Authorization":`Bearer ${key}`}});
                const data = await res.json();
                dl.innerHTML="";
                if(data.data && Array.isArray(data.data)){
                    data.data.forEach(m=>{ const o=document.createElement("option"); o.value=m.id; dl.appendChild(o); });
                    alert(`Found ${data.data.length} models!`);
                } else alert("Connected, but format unknown.");
            }catch(e){ alert("Error: "+e); }
            searchBtn.textContent="🔍";
        };
    };

    tabRule.onclick = () => { tabRule.style.cssText = activeStyle; tabLLM.style.cssText = btnStyle; renderRuleTab(); };
    tabLLM.onclick = () => { tabLLM.style.cssText = activeStyle; tabRule.style.cssText = btnStyle; renderLLMTab(); };

    document.body.appendChild(dialog);
    renderRuleTab();
}