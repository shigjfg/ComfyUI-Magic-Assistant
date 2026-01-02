import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// 必须与 __init__.py 和 nodes.py 中的类名完全一致
const NODE_NAME = "MagicPromptReplace";

app.registerExtension({
    name: "Magic.Assistant", // 插件注册名
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
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

// 保存配置到服务器
async function saveConfigToServer(data) {
    try {
        await api.fetchApi("/ma/save_config", {
            method: "POST",
            body: JSON.stringify(data),
            headers: { "Content-Type": "application/json" }
        });
        // 刷新所有同类节点
        const allNodes = app.graph.findNodesByType(NODE_NAME);
        allNodes.forEach(n => updateNodeDropdowns(n));
    } catch (e) {
        alert("保存失败 / Save Failed: " + e);
    }
}

// 防止点击穿透
function preventConflict(element) {
    element.addEventListener("pointerdown", (e) => e.stopPropagation());
    element.addEventListener("mousedown", (e) => e.stopPropagation());
    element.addEventListener("click", (e) => e.stopPropagation());
    element.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
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
    header.style.cssText = "padding: 12px; background: #333; display: flex; justify-content: space-between; border-bottom: 1px solid #444; cursor: move; user-select: none;";
    header.innerHTML = `<b>🔮 Magic Assistant 配置中心</b>`;
    
    let isDragging = false, startX, startY;
    header.onmousedown = (e) => {
        if(e.button!==0) return; isDragging=true; startX=e.clientX; startY=e.clientY;
        const rect=dialog.getBoundingClientRect(); dialog.style.left=rect.left+"px"; dialog.style.top=rect.top+"px"; dialog.style.transform="none";
        document.body.style.userSelect="none";
        document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
    };
    function onMove(e){ if(isDragging){ dialog.style.left=(parseFloat(dialog.style.left)+e.clientX-startX)+"px"; dialog.style.top=(parseFloat(dialog.style.top)+e.clientY-startY)+"px"; startX=e.clientX; startY=e.clientY; }}
    function onUp(){ isDragging=false; document.body.style.userSelect=""; document.removeEventListener("mousemove",onMove); document.removeEventListener("mouseup",onUp); }

    const closeBtn = document.createElement("button"); closeBtn.textContent="✕"; closeBtn.style.cssText="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;";
    preventConflict(closeBtn); closeBtn.onclick=()=>document.body.removeChild(dialog);
    header.appendChild(closeBtn); dialog.appendChild(header);

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
            if(keys.length===0) { node.ma_config.llm["Default"]={base_url:"",api_key:"",model:""}; keys.push("Default"); }
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
            node.ma_config.llm[newName] = { base_url:"", api_key:"", model:"" };
            curLLMName = newName; saveConfigToServer(node.ma_config); refreshList(); loadVals();
        });
        mkBtn("💾 保存当前", "#4CAF50", ()=>{
            const oldName = curLLMName; const newName = nameInp.value || "Untitled";
            if (oldName !== newName) { delete node.ma_config.llm[oldName]; curLLMName = newName; }
            node.ma_config.llm[newName] = { base_url: urlInp.value, api_key: keyInp.value, model: modelInp.value };
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
            if(d){ nameInp.value=curLLMName; urlInp.value=d.base_url; keyInp.value=d.api_key; modelInp.value=d.model; }
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