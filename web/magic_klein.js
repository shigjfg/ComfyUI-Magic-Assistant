import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MagicKleinLoader";

// ---------------------------------------------------------------------------
// i18n helpers
// ---------------------------------------------------------------------------
function getCurrentLanguage() {
    try {
        if (window.getCurrentLanguage) return window.getCurrentLanguage();
        return localStorage.getItem("magic_language_switcher_lang") || "zh";
    } catch (e) {
        return "zh";
    }
}

function translateText(text, lang) {
    try {
        if (window.translateText) return window.translateText(text, lang, "MagicKleinLoader");
        if (window.allTranslations?.MagicKleinLoader?.[text]?.[lang]) {
            return window.allTranslations.MagicKleinLoader[text][lang];
        }
    } catch (e) { /* ignore */ }
    return text;
}

function t(text) {
    return translateText(text, getCurrentLanguage());
}

// ---------------------------------------------------------------------------
// Dialog drag utility (from magic_cache.js)
// ---------------------------------------------------------------------------
function makeDialogDraggable(dialogEl, title) {
    let pos = { x: 0, y: 0 };
    let dragging = false;

    const header = dialogEl.querySelector(".dialog-title-bar");
    if (!header) return;

    header.style.cursor = "move";
    header.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        pos.x = e.clientX;
        pos.y = e.clientY;
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - pos.x;
        const dy = e.clientY - pos.y;
        pos.x = e.clientX;
        pos.y = e.clientY;
        dialogEl.style.left = (dialogEl.offsetLeft + dx) + "px";
        dialogEl.style.top = (dialogEl.offsetTop + dy) + "px";
    });

    document.addEventListener("mouseup", () => { dragging = false; });
}

// ---------------------------------------------------------------------------
// Status badge color
// ---------------------------------------------------------------------------
function statusBadgeColor(status) {
    switch (status) {
        case "ready": return "#4CAF50";
        case "needs_patch": return "#FF9800";
        case "missing_core_files": return "#FF9800";
        case "missing_common": return "#FF9800";
        case "missing_nunchaku": return "#f44336";
        case "missing_transformer": return "#f44336";
        case "check_failed":
        case "api_error":
        case "fetch_error":
            return "#f44336";
        default: return "#9E9E9E";
    }
}

/** Normalize API response so the dialog never shows 未知 with empty env. */
function normalizeEnvPayload(raw, httpStatus, errMsg) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if (raw.error && !raw.install_status) {
            return {
                nunchaku_found: false,
                wrapper_installed: false,
                transformer_available: false,
                torch_transfer_utils_available: false,
                common_available: false,
                common_files: {},
                needs_patch: false,
                install_status: "api_error",
                status_text: {
                    zh: `接口错误: ${raw.error}`,
                    en: `API error: ${raw.error}`,
                },
                suggestion: String(raw.error),
                error: raw.error,
            };
        }
        if (raw.install_status != null) {
            return {
                ...raw,
                common_available: raw.common_available ?? false,
                common_files: raw.common_files ?? {},
            };
        }
    }
    return {
        nunchaku_found: false,
        wrapper_installed: false,
        transformer_available: false,
        torch_transfer_utils_available: false,
        common_available: false,
        common_files: {},
        needs_patch: false,
        install_status: "fetch_error",
        status_text: {
            zh: errMsg || `无法连接检测接口 (HTTP ${httpStatus ?? "?"})`,
            en: errMsg || `Cannot reach check API (HTTP ${httpStatus ?? "?"})`,
        },
        suggestion: errMsg || "",
    };
}

// ---------------------------------------------------------------------------
// Register extension
// ---------------------------------------------------------------------------
app.registerExtension({
    name: "Magic.KleinLoader",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;

            if (!this.widgets) this.widgets = [];

            // Hidden widget to store settings JSON (for serialization)
            let settingsWidget = this.widgets.find(w => w.name === "_klein_settings");
            if (!settingsWidget) {
                settingsWidget = this.addWidget("text", "_klein_settings", '{}', () => {}, {});
            }
            settingsWidget.hidden = true;
            settingsWidget.computeSize = () => [0, 0];

            // Settings button
            this.addWidget("button", t("⚙️ 设置"), null, () => {
                this.showSettingsDialog();
            });

            // Info button
            this.addWidget("button", t("📖 说明"), null, () => {
                this.showInfoDialog();
            });

            // Let ComfyUI / LiteGraph size the node from widgets (no fixed 520×380 empty area)
            requestAnimationFrame(() => {
                try {
                    if (typeof this.computeSize === "function") {
                        const s = this.computeSize();
                        if (s && s[0] > 0 && s[1] > 0) this.setSize?.(s);
                    }
                } catch (e) { /* ignore */ }
            });

            // Load environment status on node creation
            this._loadEnvStatus();

            return r;
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;

            // Restore hidden widget
            let settingsWidget = this.widgets?.find(w => w.name === "_klein_settings");
            if (settingsWidget) {
                settingsWidget.hidden = true;
                settingsWidget.computeSize = () => [0, 0];
            }

            this._loadEnvStatus();
            return r;
        };

        // ---------------------------------------------------------------------------
        // Load environment status from API
        // ---------------------------------------------------------------------------
        nodeType.prototype._loadEnvStatus = async function () {
            try {
                const resp = await api.fetchApi("/ma/klein/check_env");
                const status = resp.status;
                const text = await resp.text();
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (je) {
                    data = null;
                }
                if (!resp.ok) {
                    const errDetail =
                        (data && data.error ? String(data.error) : null) ||
                        (text && text.slice ? text.slice(0, 300) : "") ||
                        `HTTP ${status}`;
                    this._envStatus = normalizeEnvPayload(data, status, errDetail);
                } else {
                    this._envStatus = normalizeEnvPayload(data, status, null);
                }
            } catch (e) {
                console.warn("[Magic Klein] Failed to load env status:", e);
                this._envStatus = normalizeEnvPayload(null, null, String(e));
            }
        };

        // ---------------------------------------------------------------------------
        // Settings dialog
        // ---------------------------------------------------------------------------
        nodeType.prototype.showSettingsDialog = async function () {
            // Fetch latest env status
            let env = this._envStatus;
            try {
                const resp = await api.fetchApi("/ma/klein/check_env");
                const status = resp.status;
                const text = await resp.text();
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (je) {
                    data = null;
                }
                if (!resp.ok) {
                    const errDetail =
                        (data && data.error ? String(data.error) : null) ||
                        (text && text.slice ? text.slice(0, 300) : "") ||
                        `HTTP ${status}`;
                    env = normalizeEnvPayload(data, status, errDetail);
                } else {
                    env = normalizeEnvPayload(data, status, null);
                }
                this._envStatus = env;
            } catch (e) {
                console.warn("[Magic Klein] Could not refresh env:", e);
                env = normalizeEnvPayload(null, null, String(e));
                this._envStatus = env;
            }

            const lang = getCurrentLanguage();
            const statusColor = statusBadgeColor(env?.install_status || "unknown");
            const statusLine =
                (lang === "zh"
                    ? (env?.status_text?.zh || env?.install_status)
                    : (env?.status_text?.en || env?.install_status)) || t("未知");

            const URL_NUNCHAKU_INSTALL =
                "https://nunchaku.tech/docs/nunchaku/installation/installation.html";
            const nunchakuOk = !!env?.nunchaku_found;
            const transformerOk = !!env?.transformer_available;
            const torchTransferOk = !!env?.torch_transfer_utils_available;
            const commonOk = !!env?.common_available;
            /**
             * needs_patch: 缺少文件，需要首次下载（force_update=false，仅写入缺失文件）
             * !needs_patch: 文件已存在，用户想重新下载（force_update=true，强制覆盖）
             */
            const needsPatch = !!env?.needs_patch;
            const canClick = nunchakuOk;
            const showNunchakuInstallHint = !nunchakuOk;
            const showOfficialPluginHint =
                nunchakuOk && (!transformerOk || !torchTransferOk || !env?.wrapper_installed || !commonOk);

            const dialog = document.createElement("div");
            dialog.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.75); z-index: 10000;
                display: flex; align-items: center; justify-content: center;
            `;

            const content = document.createElement("div");
            content.style.cssText = `
                background: #1e1e1e; border: 1px solid #3a3a3a;
                border-radius: 12px; width: 540px; max-width: 95vw;
                max-height: 90vh;
                padding: 0; font-family: system-ui, sans-serif;
                box-shadow: 0 8px 40px rgba(0,0,0,0.6);
                display: flex; flex-direction: column;
                overflow: hidden;
            `;

            // Title bar
            const titleBar = document.createElement("div");
            titleBar.className = "dialog-title-bar";
            titleBar.style.cssText = `
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                padding: 14px 20px; display: flex; align-items: center;
                justify-content: space-between; user-select: none;
                flex-shrink: 0;
            `;
            titleBar.innerHTML = `
                <span style="color:#fff; font-size:16px; font-weight:600; letter-spacing:0.5px;">
                    ${t("⚙️ Magic Klein 设置")}
                </span>
                <button id="__mk_close_btn" style="
                    background:none; border:none; color:#fff; font-size:22px;
                    cursor:pointer; line-height:1; padding:0 4px;
                ">&times;</button>
            `;
            content.appendChild(titleBar);

            const body = document.createElement("div");
            body.style.cssText = "flex:1; overflow-y:auto; padding:16px 20px; color:#e0e0e0; font-size:14px; min-height:0;";

            // ── Section 1: Environment status ──────────────────────────────────
            body.innerHTML += `
                <div style="margin-bottom:18px;">
                    <div style="font-size:13px; color:#aaa; margin-bottom:6px;">
                        ${t("📦 环境状态")}
                    </div>
                    <div style="
                        background:#252525; border-radius:8px; padding:14px;
                        border-left: 4px solid ${statusColor};
                    ">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span class="mk-status-dot" style="
                                display:inline-block; width:10px; height:10px;
                                border-radius:50%; background:${statusColor};
                            "></span>
                            <span class="mk-status-text" style="font-weight:600; color:${statusColor};">
                                ${statusLine}
                            </span>
                        </div>
                        <div style="font-size:12px; color:#888; line-height:1.7;">
                            <div class="mk-check-row">${t("nunchaku 包:")}
                                ${env?.nunchaku_found
                                    ? `<span style="color:#4CAF50">✓</span> ${env?.nunchaku_base || ""}`
                                    : `<span style="color:#f44336">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("transformer:")}
                                ${env?.transformer_available
                                    ? `<span style="color:#4CAF50">✓</span>`
                                    : `<span style="color:#f44336">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("torch_transfer_utils:")}
                                ${env?.torch_transfer_utils_available
                                    ? `<span style="color:#4CAF50">✓</span>`
                                    : `<span style="color:#f44336">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("wrappers/klein.py:")}
                                ${env?.wrapper_installed
                                    ? `<span style="color:#4CAF50">✓</span>`
                                    : `<span style="color:#f44336">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("lora/common/:")}
                                ${env?.common_available
                                    ? `<span style="color:#4CAF50">✓</span> <span style="color:#888;font-size:11px;">(${Object.keys(env?.common_files || {}).length}/3)</span>`
                                    : `<span style="color:#f44336">✗</span> <span style="color:#888;font-size:11px;">(${Object.keys(env?.common_files || {}).length}/3)</span>`
                                }
                            </div>
                            ${env?.comfyui_python ? `
                            <div>${t("ComfyUI Python:")}
                                <span style="color:#888;">${env.comfyui_python}</span>
                            </div>` : ""}
                        </div>
                    </div>
                </div>
            `;

            // ── Section 2: Install wrapper ────────────────────────────────────
            const btnStyleEnabled = `
                        background: linear-gradient(135deg, #6366f1, #8b5cf6);
                        color: #fff; border: none; border-radius: 6px;
                        padding: 9px 20px; font-size: 14px; cursor: pointer;
                        font-weight: 500; flex-shrink: 0;
                    `;
            const btnStyleDisabled = `
                        background: #3a3a3a;
                        color: #777; border: 1px solid #555; border-radius: 6px;
                        padding: 9px 20px; font-size: 14px; cursor: not-allowed;
                        font-weight: 500; flex-shrink: 0; opacity: 0.85;
                    `;

            const hintNunchakuHtml = t("__klein_hint_nunchaku__").replace(/\{\{URL\}\}/g, URL_NUNCHAKU_INSTALL);
            const hintOfficialHtml = t("__klein_hint_official__");

            const installSection = document.createElement("div");
            installSection.style.cssText = "margin-bottom:18px;";
            installSection.innerHTML = `
                <div style="font-size:13px; color:#aaa; margin-bottom:6px;">
                    ${t("🔧 嵌入到环境")}
                </div>
                <div style="background:#252525; border-radius:8px; padding:14px;">
                    <p style="margin:0 0 12px 0; color:#ccc; font-size:13px; line-height:1.6;">
                        ${t("KLEIN_DOWNLOAD_DESC")}
                    </p>
                    <div style="display:flex; flex-wrap:wrap; align-items:flex-start; gap:14px;">
                        <button id="__mk_install_btn" ${canClick ? "" : "disabled"}
                            style="${canClick ? btnStyleEnabled : btnStyleDisabled}"
                        >${needsPatch ? t("📥 下载并安装") : t("🔄 强制重新下载")}</button>
                        <div id="__mk_embed_side_hints" style="flex:1; min-width:220px; font-size:12px; line-height:1.6; color:#aaa;">
                            ${showNunchakuInstallHint
                                ? `<div style="margin-bottom:8px;">${hintNunchakuHtml}</div>`
                                : ""}
                            ${showOfficialPluginHint
                                ? `<div>${hintOfficialHtml}</div>`
                                : ""}
                        </div>
                    </div>
                    <div id="__mk_install_result" style="margin-top:10px; font-size:13px; min-height:20px;"></div>
                </div>
            `;
            body.appendChild(installSection);

            // ── Section 3: Model info ─────────────────────────────────────────
            body.innerHTML += `
                <div style="margin-bottom:18px;">
                    <div style="font-size:13px; color:#aaa; margin-bottom:6px;">
                        ${t("🧠 支持的模型")}
                    </div>
                    <div style="background:#252525; border-radius:8px; padding:14px; font-size:13px; line-height:1.8; color:#ccc;">
                        <div>
                            <strong style="color:#a78bfa;">${t("量化模型")}</strong><br>
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku"
                               target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">
                                tonera/FLUX.2-klein-9B-Nunchaku
                            </a>
                            <br><span style="color:#888;">
                                ${t("KLEIN_MODEL_CAPTION")}
                            </span>
                        </div>
                        <div style="margin-top:14px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9b-kv-Nunchaku/tree/main"
                               target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">
                                tonera/FLUX.2-klein-9b-kv-Nunchaku
                            </a>
                            <br><span style="color:#888;">
                                ${t("KLEIN_MODEL_CAPTION_KV")}
                            </span>
                        </div>
                    </div>
                </div>
            `;

            content.appendChild(body);
            dialog.appendChild(content);
            document.body.appendChild(dialog);

            makeDialogDraggable(content, titleBar);

            // Close button / backdrop click
            document.getElementById("__mk_close_btn").onclick = () => document.body.removeChild(dialog);
            dialog.onclick = (e) => { if (e.target === dialog) document.body.removeChild(dialog); };

            // Install button handler
            document.getElementById("__mk_install_btn").onclick = async () => {
                const btn = document.getElementById("__mk_install_btn");
                const resultDiv = document.getElementById("__mk_install_result");
                if (!canClick || btn.disabled) return;

                const forceUpdate = !needsPatch;
                btn.disabled = true;
                const btnOrigText = btn.textContent;
                btn.textContent = forceUpdate ? t("⏳ 强制更新中...") : t("⏳ 安装中...");
                btn.style.opacity = "0.7";
                resultDiv.style.color = "#888";
                resultDiv.textContent = forceUpdate
                    ? t("正在从 HuggingFace 下载最新文件...")
                    : t("正在下载并安装文件...");

                try {
                    const resp = await api.fetchApi("/ma/klein/patch_env", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({force_update: forceUpdate}),
                    });
                    const data = await resp.json();

                    if (data.success) {
                        resultDiv.style.color = "#4CAF50";
                        resultDiv.textContent = t("✅ 安装完成！") + " " + (data.message || "");

                        // Refresh status display
                        if (data.env) {
                            this._envStatus = data.env;
                            const newStatusColor = statusBadgeColor(data.env.install_status || "ready");
                            const curLang = getCurrentLanguage();
                            const newStatusText =
                                (curLang === "zh"
                                    ? (data.env.status_text?.zh || data.env.install_status)
                                    : (data.env.status_text?.en || data.env.install_status)) || t("未知");

                            const badge = content.querySelector(".mk-status-dot");
                            const text = content.querySelector(".mk-status-text");
                            if (badge) badge.style.background = newStatusColor;
                            if (text) { text.style.color = newStatusColor; text.textContent = newStatusText; }

                            const rows = content.querySelectorAll(".mk-check-row");
                            const markRow = (idx) => {
                                if (rows[idx]) {
                                    rows[idx].innerHTML = rows[idx].innerHTML.replace("✗", "✓").replace("color:#f44336", "color:#4CAF50");
                                }
                            };
                            if (data.env.nunchaku_found) markRow(0);
                            if (data.env.transformer_available) markRow(1);
                            if (data.env.torch_transfer_utils_available) markRow(2);
                            if (data.env.wrapper_installed) markRow(3);
                            if (data.env.common_available) markRow(4);
                        }
                    } else {
                        resultDiv.style.color = "#f44336";
                        resultDiv.textContent = t("❌ 安装失败: ") + (data.message || data.error || "unknown error");
                    }
                } catch (e) {
                    resultDiv.style.color = "#f44336";
                    resultDiv.textContent = t("❌ 请求失败: ") + String(e);
                }

                btn.disabled = false;
                btn.textContent = btnOrigText;
                btn.style.opacity = "1";
            };
        };

        // ---------------------------------------------------------------------------
        // Info dialog
        // ---------------------------------------------------------------------------
        nodeType.prototype.showInfoDialog = function () {
            const dialog = document.createElement("div");
            dialog.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.75); z-index: 10000;
                display: flex; align-items: center; justify-content: center;
            `;

            const content = document.createElement("div");
            content.style.cssText = `
                background: #1e1e1e; border: 1px solid #3a3a3a;
                border-radius: 12px; width: 580px; max-width: 95vw;
                max-height: 90vh;
                padding: 0; font-family: system-ui, sans-serif;
                box-shadow: 0 8px 40px rgba(0,0,0,0.6);
                display: flex; flex-direction: column;
                overflow: hidden;
            `;

            const titleBar = document.createElement("div");
            titleBar.className = "dialog-title-bar";
            titleBar.style.cssText = `
                background: linear-gradient(135deg, #7c3aed, #a78bfa);
                padding: 14px 20px; display: flex; align-items: center;
                justify-content: space-between; user-select: none;
                flex-shrink: 0;
            `;
            titleBar.innerHTML = `
                <span style="color:#fff; font-size:16px; font-weight:600;">
                    ${t("📖 Magic Klein 说明")}
                </span>
                <button id="__mk_info_close" style="
                    background:none; border:none; color:#fff; font-size:22px;
                    cursor:pointer; line-height:1; padding:0 4px;
                ">&times;</button>
            `;
            content.appendChild(titleBar);

            const body = document.createElement("div");
            body.style.cssText = "flex:1; overflow-y:auto; padding:16px 20px; color:#e0e0e0; font-size:14px; line-height:1.8; min-height:0;";

            body.innerHTML = `
                    <h3 style="color:#a78bfa; margin:0 0 12px 0;">${t("🔮 Magic Nunchaku FLUX.2 Klein Loader")}</h3>
                    <p style="color:#ccc; margin:0 0 16px 0;">
                        ${t("KLEIN_INFO_INTRO")}
                    </p>

                    <h4 style="color:#60a5fa; margin:0 0 8px 0;">${t("支持的模型")}</h4>
                    <ul style="color:#ccc; margin:0 0 16px 0; padding-left:20px;">
                        <li>
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku" target="_blank" rel="noopener noreferrer"
                               style="color:#60a5fa;">tonera/FLUX.2-klein-9B-Nunchaku</a>
                            <br><span style="color:#888;">${t("KLEIN_MODEL_LINE2")}</span>
                        </li>
                        <li style="margin-top:10px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9b-kv-Nunchaku/tree/main" target="_blank" rel="noopener noreferrer"
                               style="color:#60a5fa;">tonera/FLUX.2-klein-9b-kv-Nunchaku</a>
                            <br><span style="color:#888;">${t("KLEIN_MODEL_LINE2_KV")}</span>
                        </li>
                    </ul>

                    <h4 style="color:#60a5fa; margin:0 0 8px 0;">${t("首次使用步骤")}</h4>
                    <ol style="color:#ccc; margin:0 0 16px 0; padding-left:20px;">
                        <li>${t("KLEIN_STEP1")}</li>
                        <li>${t("KLEIN_STEP2")}</li>
                        <li>${t("KLEIN_STEP3")}</li>
                        <li>${t("KLEIN_STEP4")}</li>
                    </ol>

                    <h4 style="color:#60a5fa; margin:0 0 8px 0;">${t("量化说明（来自 HuggingFace）")}</h4>
                    <table style="width:100%; border-collapse:collapse; color:#ccc; font-size:13px;">
                        <tr style="background:#2a2a2a;">
                            <th style="padding:6px 10px; text-align:left; color:#888;">${t("指标")}</th>
                            <th style="padding:6px 10px; text-align:right; color:#888;">Mean</th>
                            <th style="padding:6px 10px; text-align:right; color:#888;">Median</th>
                            <th style="padding:6px 10px; text-align:right; color:#888;">p90</th>
                        </tr>
                        <tr><td style="padding:6px 10px;">PSNR</td><td style="padding:6px 10px; text-align:right;">17.56</td><td style="padding:6px 10px; text-align:right;">17.52</td><td style="padding:6px 10px; text-align:right;">20.62</td></tr>
                        <tr style="background:#252525;"><td style="padding:6px 10px;">SSIM</td><td style="padding:6px 10px; text-align:right;">0.735</td><td style="padding:6px 10px; text-align:right;">0.741</td><td style="padding:6px 10px; text-align:right;">0.837</td></tr>
                        <tr><td style="padding:6px 10px;">LPIPS</td><td style="padding:6px 10px; text-align:right;">0.212</td><td style="padding:6px 10px; text-align:right;">0.194</td><td style="padding:6px 10px; text-align:right;">0.300</td></tr>
                    </table>
                    <p style="color:#888; font-size:12px; margin-top:8px;">
                        ${t("KLEIN_LICENSE_NOTE")}
                    </p>
                `;

            content.appendChild(body);
            dialog.appendChild(content);
            document.body.appendChild(dialog);

            makeDialogDraggable(content, titleBar);

            document.getElementById("__mk_info_close").onclick = () => document.body.removeChild(dialog);
            dialog.onclick = (e) => { if (e.target === dialog) document.body.removeChild(dialog); };
        };
    },
});
