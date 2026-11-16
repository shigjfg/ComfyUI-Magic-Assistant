import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import "./magic_ui_shared.js";

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
// Dialog drag utility
// ---------------------------------------------------------------------------
function makeDialogDraggable(dialogEl, headerEl) {
    let pos = { x: 0, y: 0 };
    let dragging = false;

    const header = headerEl || dialogEl.querySelector(".dialog-title-bar");
    if (!header) return;

    header.style.cursor = "move";
    header.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        const rect = dialogEl.getBoundingClientRect();
        dialogEl.style.position = "fixed";
        dialogEl.style.left = rect.left + "px";
        dialogEl.style.top = rect.top + "px";
        dialogEl.style.transform = "none";
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
        case "ready": return "#10b981";
        case "needs_patch": return "#f59e0b";
        case "missing_core_files": return "#f59e0b";
        case "missing_common": return "#f59e0b";
        case "missing_nunchaku": return "#ef4444";
        case "missing_transformer": return "#ef4444";
        case "diffusers_old": return "#ef4444";
        case "check_failed":
        case "api_error":
        case "fetch_error":
            return "#ef4444";
        default: return "#71717a";
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
                diffusers_ok: undefined,
                diffusers_version: undefined,
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
                diffusers_ok: raw.diffusers_ok,
                diffusers_version: raw.diffusers_version,
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
        diffusers_ok: undefined,
        diffusers_version: undefined,
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
            const diffusersOld = env?.diffusers_ok === false;
            const canClick = nunchakuOk && !diffusersOld;
            const showNunchakuInstallHint = !nunchakuOk;
            const showDiffusersOldHint = diffusersOld;
            const showOfficialPluginHint =
                nunchakuOk && !diffusersOld && (!transformerOk || !torchTransferOk || !env?.wrapper_installed || !commonOk);

            const dialog = document.createElement("div");
            dialog.className = "ma-modal-backdrop";

            const content = document.createElement("div");
            content.className = "ma-modal ma-modal-static-anim";
            content.style.cssText = `
                width: 560px; max-width: 95vw;
                max-height: 90vh;
            `;

            // Title bar
            const titleBar = document.createElement("div");
            titleBar.className = "ma-modal-header dialog-title-bar";
            titleBar.innerHTML = `
                <span class="ma-modal-title">
                    ${t("⚙️ Magic Klein 设置")}
                </span>
                <button id="__mk_close_btn" class="ma-modal-close">&times;</button>
            `;
            content.appendChild(titleBar);

            const body = document.createElement("div");
            body.className = "ma-modal-body";
            body.style.cssText = "padding:18px 20px; color:#f4f4f5; font-size:13px;";

            // ── Section 1: Environment status ──────────────────────────────────
            body.innerHTML += `
                <div style="margin-bottom:16px;">
                    <div class="ma-section-label">
                        ${t("📦 环境状态")}
                    </div>
                    <div class="ma-card" style="
                        border-left: 3px solid ${statusColor};
                    ">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                            <span class="mk-status-dot" style="
                                display:inline-block; width:8px; height:8px;
                                border-radius:50%; background:${statusColor};
                            "></span>
                            <span class="mk-status-text" style="font-weight:600; color:${statusColor}; font-size:13px;">
                                ${statusLine}
                            </span>
                        </div>
                        <div style="font-size:12px; color:#a1a1aa; line-height:1.75; font-family:var(--ma-font-mono);">
                            <div class="mk-check-row">${t("nunchaku 包:")}
                                ${env?.nunchaku_found
                                    ? `<span style="color:#10b981">✓</span> ${env?.nunchaku_base || ""}`
                                    : `<span style="color:#ef4444">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("transformer:")}
                                ${env?.transformer_available
                                    ? `<span style="color:#10b981">✓</span>`
                                    : `<span style="color:#ef4444">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("torch_transfer_utils:")}
                                ${env?.torch_transfer_utils_available
                                    ? `<span style="color:#10b981">✓</span>`
                                    : `<span style="color:#ef4444">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("wrappers/klein.py:")}
                                ${env?.wrapper_installed
                                    ? `<span style="color:#10b981">✓</span>`
                                    : `<span style="color:#ef4444">✗</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("lora/common/:")}
                                ${env?.common_available
                                    ? `<span style="color:#10b981">✓</span> <span style="color:#71717a;font-size:11px;">(${Object.keys(env?.common_files || {}).length}/3)</span>`
                                    : `<span style="color:#ef4444">✗</span> <span style="color:#71717a;font-size:11px;">(${Object.keys(env?.common_files || {}).length}/3)</span>`
                                }
                            </div>
                            <div class="mk-check-row">${t("diffusers:")}
                                ${(env?.diffusers_ok === true || env?.diffusers_ok === false)
                                    ? (env.diffusers_ok
                                        ? `<span style="color:#10b981">✓</span> <span style="color:#71717a;font-size:11px;">(${env.diffusers_version || ""})</span>`
                                        : `<span style="color:#ef4444">✗</span> <span style="color:#71717a;font-size:11px;">(${env.diffusers_version || "?"} → 需要 ≥0.37.0)</span>`)
                                    : `<span style="color:#71717a">?</span>`
                                }
                            </div>
                            ${env?.comfyui_python ? `
                            <div>${t("ComfyUI Python:")}
                                <span style="color:#71717a;">${env.comfyui_python}</span>
                            </div>` : ""}
                        </div>
                    </div>
                </div>
            `;

            // ── Section 2: Install wrapper ────────────────────────────────────
            const hintNunchakuHtml = t("__klein_hint_nunchaku__").replace(/\{\{URL\}\}/g, URL_NUNCHAKU_INSTALL);
            const hintOfficialHtml = t("__klein_hint_official__");

            const installSection = document.createElement("div");
            installSection.style.cssText = "margin-bottom:16px;";
            installSection.innerHTML = `
                <div class="ma-section-label">
                    ${t("🔧 嵌入到环境")}
                </div>
                <div class="ma-card">
                    <p style="margin:0 0 12px 0; color:#a1a1aa; font-size:12.5px; line-height:1.6;">
                        ${t("KLEIN_DOWNLOAD_DESC")}
                    </p>
                    <div style="display:flex; flex-wrap:wrap; align-items:flex-start; gap:14px;">
                        <button id="__mk_install_btn" class="ma-btn ma-btn-primary" ${canClick ? "" : "disabled"}
                        >${t("📥 下载并安装")}</button>
                        <div id="__mk_embed_side_hints" style="flex:1; min-width:220px; font-size:12px; line-height:1.6; color:#a1a1aa;">
                            ${showNunchakuInstallHint
                                ? `<div style="margin-bottom:8px;">${hintNunchakuHtml}</div>`
                                : ""}
                            ${showDiffusersOldHint
                                ? `<div style="color:#ef4444; margin-bottom:8px;">
                                    <strong>diffusers 版本过低</strong><br>
                                    请先更新 diffusers 再继续：<br>
                                    <code style="font-size:11px; color:#a1a1aa;">${env?.comfyui_python || "python"} -m pip install -U diffusers</code>
                                   </div>`
                                : ""}
                            ${showOfficialPluginHint
                                ? `<div>${hintOfficialHtml}</div>`
                                : ""}
                        </div>
                    </div>
                    <div id="__mk_install_result" style="margin-top:10px; font-size:12.5px; min-height:20px;"></div>
                </div>
            `;
            body.appendChild(installSection);

            // ── Section 3: Model info ─────────────────────────────────────────
            body.innerHTML += `
                <div>
                    <div class="ma-section-label">
                        ${t("🧠 支持的模型")}
                    </div>
                    <div class="ma-card" style="font-size:12.5px; line-height:1.75; color:#d4d4d8;">
                        <div>
                            <strong style="color:#818cf8;">${t("量化模型")}</strong><br>
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku"
                               target="_blank" rel="noopener noreferrer" style="color:#a5b4fc; text-decoration:none;">
                                tonera/FLUX.2-klein-9B-Nunchaku
                            </a>
                            <br><span style="color:#71717a; font-size:11.5px;">
                                ${t("KLEIN_MODEL_CAPTION")}
                            </span>
                        </div>
                        <div style="margin-top:12px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9b-kv-Nunchaku/tree/main"
                               target="_blank" rel="noopener noreferrer" style="color:#a5b4fc; text-decoration:none;">
                                tonera/FLUX.2-klein-9b-kv-Nunchaku
                            </a>
                            <br><span style="color:#71717a; font-size:11.5px;">
                                ${t("KLEIN_MODEL_CAPTION_KV")}
                            </span>
                        </div>
                        <div style="margin-top:12px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-4B-Nunchaku/tree/main"
                               target="_blank" rel="noopener noreferrer" style="color:#a5b4fc; text-decoration:none;">
                                tonera/FLUX.2-klein-4B-Nunchaku
                            </a>
                            <br><span style="color:#71717a; font-size:11.5px;">
                                ${t("KLEIN_MODEL_CAPTION_4B")}
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

                btn.disabled = true;
                const btnOrigText = btn.textContent;
                btn.textContent = t("⏳ 下载并安装中...");
                btn.style.opacity = "0.7";
                resultDiv.style.color = "#888";
                resultDiv.textContent = t("正在从 HuggingFace 下载文件...");

                try {
                    const resp = await api.fetchApi("/ma/klein/patch_env", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({force_update: true}),
                    });
                    const data = await resp.json();

                    if (data.success) {
                        resultDiv.style.color = "#10b981";
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
                                    rows[idx].innerHTML = rows[idx].innerHTML.replace("✗", "✓").replace("color:#ef4444", "color:#10b981");
                                }
                            };
                            if (data.env.nunchaku_found) markRow(0);
                            if (data.env.transformer_available) markRow(1);
                            if (data.env.torch_transfer_utils_available) markRow(2);
                            if (data.env.wrapper_installed) markRow(3);
                            if (data.env.common_available) markRow(4);
                        }
                    } else {
                        resultDiv.style.color = "#ef4444";
                        resultDiv.textContent = t("❌ 安装失败: ") + (data.message || data.error || "unknown error");
                    }
                } catch (e) {
                    resultDiv.style.color = "#ef4444";
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
            dialog.className = "ma-modal-backdrop";

            const content = document.createElement("div");
            content.className = "ma-modal ma-modal-static-anim";
            content.style.cssText = `
                width: 600px; max-width: 95vw;
                max-height: 90vh;
            `;

            const titleBar = document.createElement("div");
            titleBar.className = "ma-modal-header dialog-title-bar";
            titleBar.innerHTML = `
                <span class="ma-modal-title">
                    ${t("📖 Magic Klein 说明")}
                </span>
                <button id="__mk_info_close" class="ma-modal-close">&times;</button>
            `;
            content.appendChild(titleBar);

            const body = document.createElement("div");
            body.className = "ma-modal-body";
            body.style.cssText = "padding:18px 22px; color:#f4f4f5; font-size:13px; line-height:1.75;";

            body.innerHTML = `
                    <h3 style="color:#f4f4f5; font-size:15px; font-weight:600; margin:0 0 10px 0;">${t("🔮 Magic Nunchaku FLUX.2 Klein Loader")}</h3>
                    <p style="color:#a1a1aa; margin:0 0 16px 0;">
                        ${t("KLEIN_INFO_INTRO")}
                    </p>

                    <h4 style="color:#818cf8; font-size:13px; font-weight:600; margin:0 0 8px 0;">${t("支持的模型")}</h4>
                    <ul style="color:#d4d4d8; margin:0 0 16px 0; padding-left:20px;">
                        <li>
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku" target="_blank" rel="noopener noreferrer"
                               style="color:#a5b4fc; text-decoration:none;">tonera/FLUX.2-klein-9B-Nunchaku</a>
                            <br><span style="color:#71717a; font-size:12px;">${t("KLEIN_MODEL_LINE2")}</span>
                        </li>
                        <li style="margin-top:8px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-9b-kv-Nunchaku/tree/main" target="_blank" rel="noopener noreferrer"
                               style="color:#a5b4fc; text-decoration:none;">tonera/FLUX.2-klein-9b-kv-Nunchaku</a>
                            <br><span style="color:#71717a; font-size:12px;">${t("KLEIN_MODEL_LINE2_KV")}</span>
                        </li>
                        <li style="margin-top:8px;">
                            <a href="https://huggingface.co/tonera/FLUX.2-klein-4B-Nunchaku/tree/main" target="_blank" rel="noopener noreferrer"
                               style="color:#a5b4fc; text-decoration:none;">tonera/FLUX.2-klein-4B-Nunchaku</a>
                            <br><span style="color:#71717a; font-size:12px;">${t("KLEIN_MODEL_LINE2_4B")}</span>
                        </li>
                    </ul>

                    <h4 style="color:#818cf8; font-size:13px; font-weight:600; margin:0 0 8px 0;">${t("首次使用步骤")}</h4>
                    <ol style="color:#d4d4d8; margin:0 0 16px 0; padding-left:20px;">
                        <li>${t("KLEIN_STEP1")}</li>
                        <li>${t("KLEIN_STEP2")}</li>
                        <li>${t("KLEIN_STEP3")}</li>
                        <li>${t("KLEIN_STEP4")}</li>
                    </ol>

                    <h4 style="color:#818cf8; font-size:13px; font-weight:600; margin:0 0 8px 0;">${t("量化说明（来自 HuggingFace）")}</h4>
                    <div class="ma-card" style="padding:0; overflow:hidden;">
                        <table style="width:100%; border-collapse:collapse; color:#d4d4d8; font-size:12.5px;">
                            <tr style="background:#09090b; border-bottom:1px solid rgba(255,255,255,0.08);">
                                <th style="padding:8px 12px; text-align:left; color:#a1a1aa; font-weight:600;">${t("指标")}</th>
                                <th style="padding:8px 12px; text-align:right; color:#a1a1aa; font-weight:600;">Mean</th>
                                <th style="padding:8px 12px; text-align:right; color:#a1a1aa; font-weight:600;">Median</th>
                                <th style="padding:8px 12px; text-align:right; color:#a1a1aa; font-weight:600;">p90</th>
                            </tr>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:7px 12px;">PSNR</td><td style="padding:7px 12px; text-align:right;">17.56</td><td style="padding:7px 12px; text-align:right;">17.52</td><td style="padding:7px 12px; text-align:right;">20.62</td></tr>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:7px 12px;">SSIM</td><td style="padding:7px 12px; text-align:right;">0.735</td><td style="padding:7px 12px; text-align:right;">0.741</td><td style="padding:7px 12px; text-align:right;">0.837</td></tr>
                            <tr><td style="padding:7px 12px;">LPIPS</td><td style="padding:7px 12px; text-align:right;">0.212</td><td style="padding:7px 12px; text-align:right;">0.194</td><td style="padding:7px 12px; text-align:right;">0.300</td></tr>
                        </table>
                    </div>
                    <p style="color:#71717a; font-size:11.5px; margin-top:10px;">
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
