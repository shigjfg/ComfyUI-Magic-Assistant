/**
 * 与 magic_prompt.js 共用：LLM 配置读写 userdata/llm_settings.txt（POST /ma/save_config）。
 * 多功能提示词框（magic_text.js）通过本模块打开同一套「LLM 服务」编辑界面。
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

export const MAGIC_PROMPT_REPLACE_TYPE = "MagicPromptReplace";

export function preventConflictLlm(element) {
    element.addEventListener("pointerdown", (e) => e.stopPropagation());
    element.addEventListener("mousedown", (e) => e.stopPropagation());
    element.addEventListener("click", (e) => e.stopPropagation());
    element.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
}

/**
 * 刷新画布上所有 MagicPromptReplace 节点的规则/LLM 下拉（与配置中心保存后一致）。
 */
export async function refreshMagicPromptReplaceNodes() {
    try {
        const response = await api.fetchApi("/ma/get_config");
        const data = await response.json();
        const allNodes = app.graph.findNodesByType(MAGIC_PROMPT_REPLACE_TYPE);
        for (const node of allNodes) {
            if (!node.ma_config) node.ma_config = { rules: {}, llm: {} };
            node.ma_config.rules = data.rules;
            node.ma_config.llm = data.llm;

            const ruleNames = Object.values(data.rules || {}).map((r) => r.name);
            const ruleWidget = node.widgets?.find((w) => w.name === "rule_name");
            if (ruleWidget) {
                ruleWidget.options.values = ruleNames.length ? ruleNames : ["No Rules"];
                if (!ruleNames.includes(ruleWidget.value)) ruleWidget.value = ruleNames[0] || "";
            }

            const llmNames = Object.keys(data.llm || {});
            const llmWidget = node.widgets?.find((w) => w.name === "llm_profile");
            if (llmWidget) {
                llmWidget.options.values = llmNames.length ? llmNames : ["No Profiles"];
                if (!llmNames.includes(llmWidget.value)) llmWidget.value = llmNames[0] || "";
            }
            node.setDirtyCanvas?.(true, true);
        }
    } catch (e) {
        console.error("[magic_llm_shared] refreshMagicPromptReplaceNodes", e);
    }
}

/**
 * POST /ma/save_config（可只传 { llm } / { rules } 等片段）并刷新替换节点下拉。
 */
export async function saveMagicConfigPartial(partial) {
    await api.fetchApi("/ma/save_config", {
        method: "POST",
        body: JSON.stringify(partial),
        headers: { "Content-Type": "application/json" },
    });
    await refreshMagicPromptReplaceNodes();
}

/**
 * 仅 LLM 标签页：与 magic_prompt.js 配置中心内「🤖 LLM服务」逻辑一致。
 * @param {HTMLElement} content
 * @param {object} ma_config — 至少含 llm: Record<string, {base_url, api_key, model}>
 * @param {() => Promise<void>|void} onAfterSave — 每次成功保存到服务器后
 */
export function mountMagicLlmEditorTab(content, ma_config, onAfterSave) {
    let curLLMName = Object.keys(ma_config.llm || {})[0] || "";

    const renderLLMTab = () => {
        content.innerHTML = "";

        const selDiv = document.createElement("div");
        selDiv.innerHTML = `<label style="color:#888;font-size:12px;">选择配置 (Select Profile):</label>`;
        const select = document.createElement("select");
        select.style.cssText =
            "width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;margin-bottom:15px;border-radius:4px;";
        preventConflictLlm(select);

        const refreshList = () => {
            select.innerHTML = "";
            const keys = Object.keys(ma_config.llm);
            if (keys.length === 0) {
                ma_config.llm.Default = { base_url: "", api_key: "", model: "" };
                keys.push("Default");
            }
            if (!curLLMName || !ma_config.llm[curLLMName]) curLLMName = keys[0];
            keys.forEach((k) => {
                const opt = document.createElement("option");
                opt.value = k;
                opt.textContent = k;
                if (k === curLLMName) opt.selected = true;
                select.appendChild(opt);
            });
        };
        refreshList();
        select.onchange = (e) => {
            curLLMName = e.target.value;
            loadVals();
        };
        selDiv.appendChild(select);
        content.appendChild(selDiv);

        const nameDiv = document.createElement("div");
        nameDiv.style.marginBottom = "10px";
        nameDiv.innerHTML = `<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">配置名称 (Profile Name):</label>`;
        const nameInp = document.createElement("input");
        nameInp.style.cssText =
            "width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
        preventConflictLlm(nameInp);
        nameDiv.appendChild(nameInp);
        content.appendChild(nameDiv);

        const quickDiv = document.createElement("div");
        quickDiv.style.cssText = "display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap;";
        const addQuick = (name, url) => {
            const b = document.createElement("button");
            b.textContent = name;
            b.style.cssText =
                "padding:5px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:15px;cursor:pointer;font-size:11px;";
            preventConflictLlm(b);
            b.onclick = () => {
                urlInp.value = url;
            };
            quickDiv.appendChild(b);
        };
        addQuick("OpenAI", "https://api.openai.com/v1");
        addQuick("DeepSeek", "https://api.deepseek.com/v1");
        addQuick("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/");
        addQuick("SiliconFlow", "https://api.siliconflow.cn/v1");
        content.appendChild(quickDiv);

        const createInp = (lbl, type = "text") => {
            const div = document.createElement("div");
            div.style.marginBottom = "10px";
            div.innerHTML = `<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">${lbl}</label>`;
            const inp = document.createElement("input");
            inp.type = type;
            inp.style.cssText =
                "width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
            preventConflictLlm(inp);
            div.appendChild(inp);
            content.appendChild(div);
            return inp;
        };
        const urlInp = createInp("Base URL");
        const keyInp = createInp("API Key", "password");

        const modelDiv = document.createElement("div");
        modelDiv.style.marginBottom = "10px";
        modelDiv.innerHTML = `<label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">Model Name</label>`;
        const mRow = document.createElement("div");
        mRow.style.cssText = "display:flex;gap:5px;";
        const modelInp = document.createElement("input");
        modelInp.style.cssText =
            "flex:1;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;";
        modelInp.setAttribute("list", "ma_llm_models_shared");
        preventConflictLlm(modelInp);

        const dl = document.createElement("datalist");
        dl.id = "ma_llm_models_shared";
        const searchBtn = document.createElement("button");
        searchBtn.textContent = "🔍";
        searchBtn.style.cssText =
            "padding:0 12px;cursor:pointer;background:#333;color:#fff;border:1px solid #555;border-radius:4px;";
        preventConflictLlm(searchBtn);

        mRow.appendChild(modelInp);
        mRow.appendChild(searchBtn);
        mRow.appendChild(dl);
        modelDiv.appendChild(mRow);
        content.appendChild(modelDiv);

        const btnDiv = document.createElement("div");
        btnDiv.style.cssText = "display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;";
        const mkBtn = (txt, col, cb) => {
            const b = document.createElement("button");
            b.textContent = txt;
            b.style.cssText = `flex:1;min-width:100px;padding:10px;background:${col};color:white;border:none;border-radius:4px;cursor:pointer;`;
            preventConflictLlm(b);
            b.onclick = cb;
            btnDiv.appendChild(b);
        };

        mkBtn("➕ 新建配置", "#2196F3", () => {
            const newName = "New Profile " + (Object.keys(ma_config.llm).length + 1);
            ma_config.llm[newName] = { base_url: "", api_key: "", model: "" };
            curLLMName = newName;
            void (async () => {
                try {
                    await saveMagicConfigPartial({ llm: ma_config.llm });
                    refreshList();
                    loadVals();
                    if (onAfterSave) await onAfterSave();
                } catch (e) {
                    alert("保存失败: " + e);
                }
            })();
        });
        mkBtn("💾 保存当前", "#4CAF50", () => {
            void (async () => {
                try {
                    const oldName = curLLMName;
                    const newName = nameInp.value || "Untitled";
                    if (oldName !== newName) {
                        delete ma_config.llm[oldName];
                        curLLMName = newName;
                    }
                    ma_config.llm[newName] = {
                        base_url: urlInp.value,
                        api_key: keyInp.value,
                        model: modelInp.value,
                    };
                    await saveMagicConfigPartial({ llm: ma_config.llm });
                    refreshList();
                    alert("已保存到 userdata/llm_settings.txt");
                    if (onAfterSave) await onAfterSave();
                } catch (e) {
                    alert("保存失败: " + e);
                }
            })();
        });
        mkBtn("🗑️ 删除", "#f44336", () => {
            if (Object.keys(ma_config.llm).length <= 1) return alert("至少保留一个配置！");
            if (!confirm(`删除配置「${curLLMName}」？`)) return;
            void (async () => {
                try {
                    delete ma_config.llm[curLLMName];
                    curLLMName = Object.keys(ma_config.llm)[0];
                    await saveMagicConfigPartial({ llm: ma_config.llm });
                    renderLLMTab();
                    if (onAfterSave) await onAfterSave();
                } catch (e) {
                    alert("保存失败: " + e);
                }
            })();
        });
        content.appendChild(btnDiv);

        const loadVals = () => {
            const d = ma_config.llm[curLLMName];
            if (d) {
                nameInp.value = curLLMName;
                urlInp.value = d.base_url || "";
                keyInp.value = d.api_key || "";
                modelInp.value = d.model || "";
            }
        };
        if (curLLMName) loadVals();

        searchBtn.onclick = async () => {
            const url = urlInp.value.replace(/\/$/, "");
            const key = keyInp.value;
            if (!url || !key) return alert("请填写 Base URL 与 API Key");
            searchBtn.textContent = "...";
            try {
                let ep = url;
                if (!url.includes("/v1") && !url.includes("silicon") && !url.includes("deepseek")) ep += "/v1";
                const res = await fetch(`${ep}/models`, { headers: { Authorization: `Bearer ${key}` } });
                const data = await res.json();
                dl.innerHTML = "";
                if (data.data && Array.isArray(data.data)) {
                    data.data.forEach((m) => {
                        const o = document.createElement("option");
                        o.value = m.id;
                        dl.appendChild(o);
                    });
                    alert(`找到 ${data.data.length} 个模型`);
                } else alert("已连接，但返回格式无法解析。");
            } catch (e) {
                alert("错误: " + e);
            }
            searchBtn.textContent = "🔍";
        };
    };

    renderLLMTab();
}

/**
 * 独立弹窗：仅编辑 LLM 列表（与配置中心「LLM服务」页相同数据源）。
 * @param {object} [opts]
 * @param {function} [opts.onLlmSaved]
 */
export async function openMagicLlmServiceModal(opts = {}) {
    const onLlmSaved = typeof opts.onLlmSaved === "function" ? opts.onLlmSaved : null;
    let data;
    try {
        const response = await api.fetchApi("/ma/get_config");
        data = await response.json();
    } catch (e) {
        alert("无法加载配置：" + e);
        return;
    }
    const ma_config = { llm: JSON.parse(JSON.stringify(data.llm || {})) };

    const dialog = document.createElement("div");
    dialog.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(92vw, 560px); height: min(85vh, 540px);
        background: #222; color: #ddd; border: 1px solid #444;
        box-shadow: 0 16px 48px rgba(0,0,0,0.75); z-index: 100090;
        display: flex; flex-direction: column; font-family: sans-serif;
        border-radius: 8px; overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText =
        "padding: 12px 14px; background: #333; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444;";
    const ht = document.createElement("span");
    ht.innerHTML = "<b>🤖 LLM 服务</b> <span style='opacity:0.85;font-weight:400;font-size:12px'>（与「多功能AI提示词替换」共用 llm_settings.txt）</span>";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
        "background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:0 10px;";
    preventConflictLlm(closeBtn);
    const close = () => {
        try {
            dialog.remove();
        } catch (_) {}
    };
    closeBtn.onclick = close;
    header.appendChild(ht);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const content = document.createElement("div");
    content.style.cssText = "flex:1;padding:16px;overflow-y:auto;background:#222;min-height:0;";
    preventConflictLlm(content);
    dialog.appendChild(content);

    mountMagicLlmEditorTab(content, ma_config, async () => {
        if (onLlmSaved) await onLlmSaved();
    });

    document.body.appendChild(dialog);
}
