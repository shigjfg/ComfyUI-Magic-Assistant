import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import "./magic_ui_shared.js";

/**
 * Magic Assistant Update Checker
 * 自动检测更新并显示更新提示弹窗
 */

const STORAGE_KEY_IGNORED_VERSIONS = "magic_assistant_ignored_versions";
const STORAGE_KEY_ABOUT_SHOWN = "magic_assistant_about_shown";

// 获取忽略的版本列表
function getIgnoredVersions() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_IGNORED_VERSIONS);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

// 保存忽略的版本
function saveIgnoredVersion(version) {
    try {
        const ignored = getIgnoredVersions();
        if (!ignored.includes(version)) {
            ignored.push(version);
            localStorage.setItem(STORAGE_KEY_IGNORED_VERSIONS, JSON.stringify(ignored));
        }
    } catch (e) {
        console.error("Failed to save ignored version:", e);
    }
}

// 检查版本是否被忽略
function isVersionIgnored(version) {
    return getIgnoredVersions().includes(version);
}

// 解析 README 中的更新信息（Markdown 转 HTML）
function parseUpdateInfo(markdownText) {
    if (!markdownText) return "";
    
    let html = markdownText;
    
    // 转换标题
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // 转换粗体
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 转换列表
    html = html.replace(/^[\s]*[-*+]\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // 转换代码块
    html = html.replace(/```[\s\S]*?```/g, '<pre><code>$&</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 转换链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // 转换换行
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

// 显示更新弹窗
function showUpdateModal(updateData) {
    const { current_version, latest_version, update_info } = updateData;
    
    // 检查是否已忽略此版本
    if (isVersionIgnored(latest_version)) {
        return;
    }
    
    // 创建弹窗
    const overlay = document.createElement("div");
    overlay.className = "ma-modal-backdrop";
    
    const dialog = document.createElement("div");
    dialog.className = "ma-modal ma-modal-static-anim";
    dialog.style.cssText = `
        max-width: 680px;
        max-height: 82vh;
        width: 90%;
    `;
    
    // 标题栏（可拖拽）
    const titleBar = document.createElement("div");
    titleBar.className = "ma-modal-header";
    
    const title = document.createElement("div");
    title.className = "ma-modal-title";
    title.innerHTML = `
        <span>🔮</span>
        <span>Magic Assistant Update Available / 有新版本可用</span>
    `;
    
    const closeBtn = document.createElement("button");
    closeBtn.className = "ma-modal-close";
    closeBtn.innerHTML = "✕";
    closeBtn.onclick = () => {
        document.body.removeChild(overlay);
    };
    
    titleBar.appendChild(title);
    titleBar.appendChild(closeBtn);
    
    // 内容区域
    const content = document.createElement("div");
    content.className = "ma-modal-body";
    content.style.cssText = `
        padding: 20px;
        color: #d4d4d8;
        line-height: 1.65;
    `;
    
    // 版本信息
    const versionInfo = document.createElement("div");
    versionInfo.className = "ma-card";
    versionInfo.style.cssText = `
        margin-bottom: 18px;
        border-left: 3px solid #6366f1;
    `;
    versionInfo.innerHTML = `
        <div style="margin-bottom: 6px;">
            <strong style="color:#a1a1aa;">Current Version / 当前版本:</strong> <span style="color: #34d399; font-family: var(--ma-font-mono); font-weight: 600;">v${current_version}</span>
        </div>
        <div>
            <strong style="color:#a1a1aa;">Latest Version / 最新版本:</strong> <span style="color: #fbbf24; font-family: var(--ma-font-mono); font-weight: 600;">v${latest_version}</span>
        </div>
    `;
    content.appendChild(versionInfo);
    
    // 更新信息
    if (update_info) {
        const updateSection = document.createElement("div");
        updateSection.style.cssText = "margin-bottom: 8px;";
        updateSection.innerHTML = `
            <h3 style="color: #f4f4f5; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Update Information / 更新内容:</h3>
            <div style="background: #09090b; border: 1px solid rgba(255,255,255,0.08); padding: 16px; border-radius: 8px; max-height: 300px; overflow-y: auto; font-size: 12.5px;">
                ${parseUpdateInfo(update_info)}
            </div>
        `;
        content.appendChild(updateSection);
    }
    
    // 底部按钮区域
    const footer = document.createElement("div");
    footer.className = "ma-modal-footer";
    footer.style.justifyContent = "space-between";
    
    // 忽略版本复选框
    const ignoreCheckboxContainer = document.createElement("label");
    ignoreCheckboxContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        color: #a1a1aa;
        cursor: pointer;
        font-size: 12.5px;
    `;
    const ignoreCheckbox = document.createElement("input");
    ignoreCheckbox.type = "checkbox";
    ignoreCheckbox.style.cssText = "width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1;";
    ignoreCheckboxContainer.appendChild(ignoreCheckbox);
    ignoreCheckboxContainer.appendChild(document.createTextNode("Ignore this version / 忽略此版本"));
    
    // 按钮组
    const buttonGroup = document.createElement("div");
    buttonGroup.style.cssText = "display: flex; gap: 10px;";
    
    // GitHub 地址按钮
    const githubBtn = document.createElement("button");
    githubBtn.textContent = "GitHub 地址 / GitHub Repository";
    githubBtn.className = "ma-btn ma-btn-primary";
    githubBtn.onclick = () => {
        window.open("https://github.com/shigjfg/ComfyUI-Magic-Assistant", "_blank");
    };
    
    // 关闭按钮
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "自行在manager中手动更新 / Update manually in Manager";
    cancelBtn.className = "ma-btn";
    cancelBtn.onclick = () => {
        // 如果勾选了忽略，保存忽略的版本
        if (ignoreCheckbox.checked) {
            saveIgnoredVersion(latest_version);
        }
        document.body.removeChild(overlay);
    };
    
    buttonGroup.appendChild(githubBtn);
    buttonGroup.appendChild(cancelBtn);
    
    footer.appendChild(ignoreCheckboxContainer);
    footer.appendChild(buttonGroup);
    
    dialog.appendChild(titleBar);
    dialog.appendChild(content);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    
    // 拖拽功能
    let isDragging = false;
    let offsetX, offsetY;
    
    titleBar.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn || e.target.closest("button")) return;
        isDragging = true;
        const dialogRect = dialog.getBoundingClientRect();
        offsetX = e.clientX - dialogRect.left;
        offsetY = e.clientY - dialogRect.top;
        dialog.style.position = 'fixed';
        dialog.style.margin = '0';
    });
    
    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        e.preventDefault();
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;
        
        const maxX = window.innerWidth - dialog.offsetWidth;
        const maxY = window.innerHeight - dialog.offsetHeight;
        
        newLeft = Math.max(0, Math.min(newLeft, maxX));
        newTop = Math.max(0, Math.min(newTop, maxY));
        
        dialog.style.left = `${newLeft}px`;
        dialog.style.top = `${newTop}px`;
        dialog.style.transform = 'none';
    });
    
    document.addEventListener("mouseup", () => {
        isDragging = false;
    });
    
    document.body.appendChild(overlay);
    
    // 点击遮罩层关闭
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            if (ignoreCheckbox.checked) {
                saveIgnoredVersion(latest_version);
            }
            document.body.removeChild(overlay);
        }
    });
}

// 检查更新
async function checkForUpdates(testMode = false) {
    try {
        const url = testMode ? "/ma/check_update?test=true" : "/ma/check_update";
        const response = await api.fetchApi(url);
        const data = await response.json();
        
        if (data.has_update && data.latest_version) {
            // 检查是否已忽略此版本（测试模式下跳过忽略检查）
            if (testMode || !isVersionIgnored(data.latest_version)) {
                // 测试模式下立即显示，正常模式延迟显示
                const delay = testMode ? 0 : 2000;
                setTimeout(() => {
                    showUpdateModal(data);
                }, delay);
            }
        } else if (testMode) {
            // 测试模式下，即使没有更新也显示一个提示
            console.log("🔮 Update Checker Test: No update available (this is expected in test mode)");
            alert("测试模式：当前模拟版本 1.1.4 应该会触发更新提示。如果没看到弹窗，请检查控制台。");
        }
    } catch (error) {
        console.error("Failed to check for updates:", error);
        if (testMode) {
            alert(`测试失败: ${error.message}`);
        }
    }
}

// 测试函数：手动触发更新检测（测试模式）
function testUpdateChecker() {
    console.log("🔮 Update Checker: Manual test triggered");
    checkForUpdates(true);
}

// 注册扩展
app.registerExtension({
    name: "Magic.Assistant.UpdateChecker",
    async setup() {
        // 等待 ComfyUI 完全加载后检查更新
        setTimeout(() => {
            checkForUpdates();
        }, 3000);
        
        // 添加快捷键测试功能：Ctrl+Shift+U 触发测试模式
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === "U") {
                e.preventDefault();
                console.log("🔮 Update Checker: Test mode triggered by Ctrl+Shift+U");
                testUpdateChecker();
            }
        });
        
        // 将测试函数暴露到全局，方便在控制台调用
        window.testUpdateChecker = testUpdateChecker;
        console.log("🔮 Magic Assistant Update Checker: Loaded!");
        console.log("💡 Test Mode: Press Ctrl+Shift+U or call window.testUpdateChecker() in console");
    }
});

