import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "MagicPhotopeaNode";
const WIN_ID = "magic-photopea-window";
const GALLERY_ID = "magic-image-gallery";

// --- 0. 全局设置记忆 ---
const SETTINGS_KEY = "MagicPhotopea_GallerySettings";
const getSettings = () => {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        return (s && s.size) ? s : { size: 140, sort: "default" };
    } catch { return { size: 140, sort: "default" }; }
};
const saveSettings = (settings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

// --- 1. 监听 Python 消息 ---
api.addEventListener("magic_photopea_imported", ({ detail }) => {
    const { node_id, filename } = detail;
    const node = app.graph.getNodeById(node_id);
    if (node) refreshNodeImageWidget(node, filename);
});

app.registerExtension({
    name: "Magic.Photopea.Studio",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                this.addWidget("button", "🖼️ 打开图库 / Open Gallery", null, () => {
                    showGalleryModal(this);
                });

                this.addWidget("button", "🖌️ 打开编辑器 / Open Editor", null, () => {
                    showPhotopeaModal(this);
                });
                
                const widget = this.widgets.find(w => w.name === "image_selection");
                if (widget) {
                    const originalCallback = widget.callback;
                    widget.callback = (value) => {
                        if (originalCallback) originalCallback(value);
                        updateNodePreview(this, value);
                    };
                }
                return r;
            };
        }
    }
});

// ============================================================
// 🖼️ Part 1: Magic Gallery V4.0 (全能管理版)
// ============================================================
function showGalleryModal(node) {
    if (document.getElementById(GALLERY_ID)) return;

    const widget = node.widgets.find(w => w.name === "image_selection");
    if (!widget || !widget.options.values) {
        alert("没有找到图片列表！");
        return;
    }

    // 状态管理
    let fileList = [...widget.options.values].filter(f => f !== "canvas_empty.png");
    let currentSettings = getSettings();
    let isEditMode = false;
    let selectedFiles = new Set(); // 存储选中的文件名
    let fileLocations = {}; // 缓存文件位置: { "abc.png": "magic_photopea" }

    // --- DOM 结构 ---
    const modal = document.createElement("div");
    modal.id = GALLERY_ID;
    modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px);`;

    const container = document.createElement("div");
    container.style.cssText = `width: 90%; height: 90%; background: #1e1e1e; border-radius: 12px; border: 1px solid #444; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.6);`;

    // 顶部工具栏容器
    const header = document.createElement("div");
    header.style.cssText = "padding: 15px 20px; background: #252525; border-bottom: 1px solid #333; display: flex; gap: 15px; align-items: center; user-select: none; min-height: 60px;";

    // 内容网格
    const grid = document.createElement("div");
    grid.style.cssText = `flex: 1; overflow-y: auto; padding: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--card-size, 140px), 1fr)); gap: 15px; align-content: start;`;
    grid.style.setProperty('--card-size', currentSettings.size + "px");

    // --- 核心逻辑函数 ---

    // 1. 探测文件位置 (删除/重命名需要知道文件在哪)
    const detectFileLocation = async (filename) => {
        if (fileLocations[filename]) return fileLocations[filename];
        try {
            // 先试 magic_photopea
            const resp = await api.fetchApi(`/view?filename=${encodeURIComponent(filename)}&subfolder=magic_photopea&type=input`, { method: "HEAD" });
            if (resp.status === 200) {
                fileLocations[filename] = "magic_photopea";
                return "magic_photopea";
            }
        } catch {}
        // 否则默认为根目录
        fileLocations[filename] = "";
        return "";
    };

    // 2. 调用后端 API 删除文件
    const deleteFileAPI = async (filename) => {
        const subfolder = await detectFileLocation(filename);
        try {
            const resp = await api.fetchApi("/ma/delete_file", {
                method: "POST",
                body: JSON.stringify({ filename, subfolder })
            });
            const data = await resp.json();
            return data.status === "success";
        } catch (e) {
            console.error("Delete failed:", e);
            return false;
        }
    };

    // 3. 调用后端 API 重命名
    const renameFileAPI = async (oldName, newName) => {
        if (!newName || newName === oldName) return false;
        // 简单校验文件名
        if (newName.includes("/") || newName.includes("\\")) {
            alert("文件名不能包含路径符号！");
            return false;
        }
        
        // 保持后缀名一致 (防止小白改错后缀)
        const oldExt = oldName.split('.').pop();
        if (!newName.endsWith('.' + oldExt)) {
            newName += '.' + oldExt;
        }

        const subfolder = await detectFileLocation(oldName);
        try {
            const resp = await api.fetchApi("/ma/rename_file", {
                method: "POST",
                body: JSON.stringify({ old_name: oldName, new_name: newName, subfolder })
            });
            const data = await resp.json();
            if (data.status === "success") {
                // 更新 widget 列表
                const idx = widget.options.values.indexOf(oldName);
                if (idx !== -1) {
                    widget.options.values[idx] = newName;
                    if (widget.value === oldName) widget.value = newName;
                }
                return true;
            } else {
                alert("重命名失败: " + data.message);
                return false;
            }
        } catch (e) {
            alert("请求错误: " + e);
            return false;
        }
    };

    // 4. 渲染顶部 Header (根据模式切换)
    const renderHeader = () => {
        header.innerHTML = "";
        
        if (isEditMode) {
            // --- 编辑模式 Header ---
            header.style.background = "#3a2e2e"; // 微微泛红提示正在编辑

            const title = document.createElement("div");
            title.innerHTML = `<b>✏️ 编辑模式</b> <span style="font-size:12px;opacity:0.7">已选: <span id="sel-count">${selectedFiles.size}</span></span>`;
            title.style.cssText = "color: #ff9800; font-size: 16px; margin-right: auto;";
            
            // 批量删除按钮
            const delSelBtn = document.createElement("button");
            delSelBtn.innerHTML = "🗑️ 删除选中";
            delSelBtn.className = "mp-btn-danger";
            delSelBtn.onclick = async () => {
                if (selectedFiles.size === 0) return;
                if (!confirm(`确定要删除选中的 ${selectedFiles.size} 张图片吗？此操作不可恢复！`)) return;
                
                delSelBtn.textContent = "⏳ 删除中...";
                for (const file of selectedFiles) {
                    const success = await deleteFileAPI(file);
                    if (success) {
                        fileList = fileList.filter(f => f !== file);
                        widget.options.values = widget.options.values.filter(f => f !== file);
                    }
                }
                selectedFiles.clear();
                renderAll(); // 刷新界面
            };

            // 全删按钮
            const delAllBtn = document.createElement("button");
            delAllBtn.innerHTML = "🔥 全部删除";
            delAllBtn.className = "mp-btn-danger";
            delAllBtn.onclick = async () => {
                if (!confirm("⚠️ 高能预警 ⚠️\n\n确定要清空当前列表里的所有图片吗？\n硬盘上的文件将被永久删除！")) return;
                
                delAllBtn.textContent = "⏳...";
                // 复制一份列表防止遍历时修改
                const allToDelete = [...fileList];
                for (const file of allToDelete) {
                    const success = await deleteFileAPI(file);
                    if (success) {
                        fileList = fileList.filter(f => f !== file);
                        widget.options.values = widget.options.values.filter(f => f !== file);
                    }
                }
                selectedFiles.clear();
                renderAll();
            };

            // 完成按钮
            const doneBtn = document.createElement("button");
            doneBtn.innerHTML = "✅ 完成";
            doneBtn.className = "mp-btn-success";
            doneBtn.onclick = () => {
                isEditMode = false;
                selectedFiles.clear(); // 退出时清空选择
                renderAll();
            };

            header.appendChild(title);
            header.appendChild(delAllBtn);
            header.appendChild(delSelBtn);
            header.appendChild(doneBtn);

        } else {
            // --- 默认浏览模式 Header ---
            header.style.background = "#252525";

            const searchInput = document.createElement("input");
            searchInput.type = "text"; searchInput.placeholder = "🔍 搜索...";
            searchInput.className = "mp-input";
            searchInput.oninput = (e) => renderGrid(e.target.value);

            const sortSelect = document.createElement("select");
            sortSelect.className = "mp-select";
            sortSelect.innerHTML = `<option value="default">📅 默认</option><option value="oldest">📅 旧图</option><option value="name_asc">🔤 A-Z</option><option value="name_desc">🔤 Z-A</option>`;
            sortSelect.value = currentSettings.sort;
            sortSelect.onchange = (e) => {
                currentSettings.sort = e.target.value;
                saveSettings(currentSettings);
                renderGrid(searchInput.value);
            };

            // 缩放滑块
            const sliderContainer = document.createElement("div");
            sliderContainer.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:#888;";
            const sizeSlider = document.createElement("input");
            sizeSlider.type = "range"; sizeSlider.min = "80"; sizeSlider.max = "400"; sizeSlider.step = "10";
            sizeSlider.value = currentSettings.size;
            sizeSlider.style.width = "100px";
            sizeSlider.oninput = (e) => grid.style.setProperty('--card-size', e.target.value + "px");
            sizeSlider.onchange = (e) => { currentSettings.size = e.target.value; saveSettings(currentSettings); };
            sliderContainer.innerHTML = "🔍"; sliderContainer.appendChild(sizeSlider);

            // 编辑模式开关
            const editBtn = document.createElement("button");
            editBtn.innerHTML = "✏️ 编辑";
            editBtn.className = "mp-btn-primary";
            editBtn.onclick = () => { isEditMode = true; renderAll(); };

            const closeBtn = document.createElement("button");
            closeBtn.innerHTML = "✕";
            closeBtn.className = "mp-btn-close";
            closeBtn.onclick = () => modal.remove();

            header.appendChild(searchInput);
            header.appendChild(sortSelect);
            header.appendChild(sliderContainer);
            header.appendChild(editBtn);
            header.appendChild(closeBtn);
        }
    };

    // 5. 渲染网格 Card
    const renderGrid = (filterText = "") => {
        grid.innerHTML = "";
        const lowerFilter = filterText.toLowerCase();

        // 排序逻辑
        let displayFiles = fileList.filter(f => f.toLowerCase().includes(lowerFilter));
        const sortMode = currentSettings.sort;
        if (sortMode === "name_asc") displayFiles.sort((a, b) => a.localeCompare(b));
        else if (sortMode === "name_desc") displayFiles.sort((a, b) => b.localeCompare(a));
        else if (sortMode === "oldest") displayFiles = [...displayFiles].reverse();

        displayFiles.forEach(filename => {
            const card = document.createElement("div");
            const isSelected = selectedFiles.has(filename);
            
            // 卡片样式
            card.className = "mp-card";
            if (isEditMode) {
                card.style.cursor = "pointer";
                if (isSelected) card.classList.add("selected");
            } else {
                // 浏览模式下点击即选
                card.onclick = () => {
                    widget.value = filename;
                    if (widget.callback) widget.callback(filename);
                    modal.remove();
                };
            }

            // 编辑模式下的点击交互
            if (isEditMode) {
                card.onclick = (e) => {
                    // 如果点的是删除按钮或输入框，不触发选择
                    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
                    
                    if (selectedFiles.has(filename)) selectedFiles.delete(filename);
                    else selectedFiles.add(filename);
                    
                    // 局部更新 UI
                    const countSpan = document.getElementById("sel-count");
                    if (countSpan) countSpan.textContent = selectedFiles.size;
                    
                    if (selectedFiles.has(filename)) card.classList.add("selected");
                    else card.classList.remove("selected");
                };
            }

            // 图片容器
            const imgContainer = document.createElement("div");
            imgContainer.className = "mp-img-box";
            const img = document.createElement("img");
            img.loading = "lazy"; // 性能优化
            
            // 路径侦探
            const safeName = encodeURIComponent(filename);
            const loadImg = (sub) => {
                let url = `/view?filename=${safeName}&type=input`;
                if (sub) url += `&subfolder=${sub}`;
                img.src = api.apiURL(url);
            };
            img.onload = () => { 
                img.style.opacity = "1"; 
                // 记住成功加载的路径
                if(img.src.includes("magic_photopea")) fileLocations[filename] = "magic_photopea";
            };
            img.onerror = () => { 
                if (!img.dataset.retried) { 
                    img.dataset.retried = "true"; 
                    loadImg(null); // 试根目录
                } 
            };
            loadImg("magic_photopea");

            imgContainer.appendChild(img);
            card.appendChild(imgContainer);

            // 编辑模式：右上角删除小叉
            if (isEditMode) {
                const delBtn = document.createElement("button");
                delBtn.className = "mp-card-del";
                delBtn.innerHTML = "×";
                delBtn.title = "删除此图";
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm(`确定删除 ${filename} 吗？`)) return;
                    
                    const success = await deleteFileAPI(filename);
                    if (success) {
                        fileList = fileList.filter(f => f !== filename);
                        widget.options.values = widget.options.values.filter(f => f !== filename);
                        selectedFiles.delete(filename);
                        renderAll();
                    }
                };
                card.appendChild(delBtn);
            }

            // 文件名 (支持重命名)
            const label = document.createElement("div");
            label.className = "mp-label";
            label.textContent = filename;
            label.title = filename;

            if (isEditMode) {
                label.style.cursor = "text";
                label.onclick = (e) => {
                    e.stopPropagation();
                    // 变成输入框
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = filename;
                    input.className = "mp-rename-input";
                    
                    // 自动保存逻辑
                    const doRename = async () => {
                        const newName = input.value.trim();
                        if (newName && newName !== filename) {
                            const ok = await renameFileAPI(filename, newName);
                            if (ok) {
                                // 更新本地数据列表
                                const idx = fileList.indexOf(filename);
                                if (idx !== -1) fileList[idx] = newName;
                                if (selectedFiles.has(filename)) {
                                    selectedFiles.delete(filename);
                                    selectedFiles.add(newName);
                                }
                                renderAll();
                            } else {
                                label.textContent = filename; // 还原
                            }
                        } else {
                            label.textContent = filename; // 还原
                        }
                    };

                    input.onblur = doRename;
                    input.onkeydown = (ev) => { if(ev.key === 'Enter') input.blur(); };
                    
                    label.textContent = "";
                    label.appendChild(input);
                    input.focus();
                };
            }

            card.appendChild(label);
            grid.appendChild(card);
        });
    };

    // 6. 总渲染函数
    const renderAll = () => {
        renderHeader();
        // 查找当前的搜索词（如果是切换模式，保持搜索词不变）
        const input = header.querySelector("input[type=text]");
        renderGrid(input ? input.value : "");
    };

    // --- 注入 CSS 样式 (一次性注入) ---
    if (!document.getElementById("mp-styles")) {
        const style = document.createElement("style");
        style.id = "mp-styles";
        style.innerHTML = `
            .mp-card { background: #2a2a2a; border-radius: 8px; overflow: hidden; border: 2px solid transparent; display: flex; flex-direction: column; position: relative; transition: all 0.2s; }
            .mp-card:hover { transform: translateY(-3px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .mp-card.selected { border-color: #ff9800; background: #3e3025; }
            .mp-card.selected::after { content: "✔"; position: absolute; top: 5px; left: 5px; background: #ff9800; color: #000; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; }
            
            .mp-img-box { width: 100%; aspect-ratio: 1/1; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; background-image: radial-gradient(#333 1px, transparent 1px); background-size: 10px 10px; }
            .mp-img-box img { width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 0.3s; }
            
            .mp-label { padding: 8px; font-size: 11px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; background: #252525; height: 30px; line-height: 14px; }
            .mp-rename-input { width: 100%; background: #111; border: 1px solid #ff9800; color: #fff; font-size: 11px; padding: 2px; text-align: center; outline: none; }
            
            .mp-card-del { position: absolute; top: 2px; right: 2px; width: 24px; height: 24px; background: rgba(200, 0, 0, 0.8); color: white; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; font-size: 16px; }
            .mp-card:hover .mp-card-del { opacity: 1; }
            .mp-card-del:hover { background: red; }

            .mp-btn-primary { padding: 6px 16px; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; }
            .mp-btn-danger { padding: 6px 12px; background: #d32f2f; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; }
            .mp-btn-success { padding: 6px 16px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;}
            .mp-btn-close { margin-left: auto; width: 32px; height: 32px; background: #444; color: #fff; border: none; border-radius: 50%; cursor: pointer; }
            .mp-btn-close:hover { background: #d32f2f; }
            
            .mp-input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #111; color: #fff; outline: none; }
            .mp-select { padding: 8px; border-radius: 6px; background: #333; color: white; border: 1px solid #555; }
        `;
        document.head.appendChild(style);
    }

    renderAll();
    container.appendChild(header);
    container.appendChild(grid);
    modal.appendChild(container);
    document.body.appendChild(modal);
}

// ============================================================
// 🎨 Part 2: Photopea Editor (编辑器逻辑 - 整合路径探测)
// ============================================================
function showPhotopeaModal(node) {
    let win = document.getElementById(WIN_ID);
    if (win) win.remove();

    win = document.createElement("div");
    win.id = WIN_ID;
    win.dataset.currentNodeId = node.id;
    win.style.cssText = `position: fixed; top: 5%; left: 5%; width: 90%; height: 85%; min-width: 800px; min-height: 600px; background: #1e1e1e; border: 2px solid #444; box-shadow: 0 0 50px rgba(0,0,0,0.9); z-index: 9000; display: flex; flex-direction: column; border-radius: 8px; resize: both; overflow: hidden;`;

    // Header
    const header = document.createElement("div");
    header.style.cssText = "height: 36px; background: #2d2d2d; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid #333; user-select: none; flex-shrink: 0;";
    header.innerHTML = `<div><b>🎨 Magic Photopea Studio</b> <span style="font-size:11px;color:#888;">(v4.0 Manager)</span></div>`;
    
    const btnGroup = document.createElement("div"); btnGroup.style.display = "flex"; btnGroup.style.gap = "8px";
    const btnStyle = "background:none; border:none; color:#bbb; font-size:14px; cursor:pointer; padding:4px 8px; border-radius:4px;";
    
    const maxBtn = document.createElement("button"); maxBtn.textContent = "⬜"; maxBtn.style.cssText = btnStyle;
    maxBtn.onclick = () => {
        if (win.dataset.isMaximized !== "true") {
            win.dataset.prevStyle = win.style.cssText; win.dataset.isMaximized = "true";
            win.style.top = "0"; win.style.left = "0"; win.style.width = "100vw"; win.style.height = "100vh";
            win.style.resize = "none"; maxBtn.textContent = "❐";
        } else {
            win.style.cssText = win.dataset.prevStyle; win.dataset.isMaximized = "false"; maxBtn.textContent = "⬜";
        }
    };
    btnGroup.appendChild(maxBtn);

    const closeBtn = document.createElement("button"); closeBtn.textContent = "✕"; closeBtn.style.cssText = btnStyle; closeBtn.style.color = "#ff6b6b";
    closeBtn.onclick = () => win.style.display = "none";
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);
    win.appendChild(header);

    // Iframe
    const iframe = document.createElement("iframe");
    const ppConfig = { "files": [], "environment": { "theme": 2, "lang": "zh", "vmode": 0, "intro": false, "menus": [1,1,1,1,1,1,1,1,1] } };
    const hash = encodeURIComponent(JSON.stringify(ppConfig));
    iframe.src = `https://www.photopea.com#${hash}`;
    iframe.style.cssText = "flex: 1; border: none; background: #181818; width: 100%;";
    
    // Auto-Load
    iframe.onload = async () => {
        let filename = "";
        const widget = node.widgets.find(w => w.name === "image_selection");
        if (widget) filename = widget.value;

        if ((!filename || filename === "canvas_empty.png") && node.imgs && node.imgs.length > 0) {
             const src = node.imgs[0].src;
             const match = src.match(/filename=([^&]+)/);
             if (match) filename = decodeURIComponent(match[1]);
        }

        if (filename && filename !== "canvas_empty.png") {
            try {
                let blob = null;
                const safeName = encodeURIComponent(filename);

                try {
                    const resp1 = await api.fetchApi(`/view?filename=${safeName}&subfolder=magic_photopea&type=input`);
                    if (resp1.status === 200) blob = await resp1.blob();
                } catch(e) {}

                if (!blob) {
                    try {
                        const resp2 = await api.fetchApi(`/view?filename=${safeName}&type=input`);
                        if (resp2.status === 200) blob = await resp2.blob();
                    } catch(e) {}
                }

                if (blob) {
                    const buffer = await blob.arrayBuffer();
                    iframe.contentWindow.postMessage(buffer, "*");
                    setTimeout(() => iframe.contentWindow.postMessage(buffer, "*"), 800);
                }
            } catch (e) { console.error(e); }
        }
    };

    // Footer
    const footer = document.createElement("div");
    footer.style.cssText = "height: 50px; background: #252525; border-top: 1px solid #333; display: flex; align-items: center; justify-content: flex-end; padding: 0 15px; gap: 15px; flex-shrink: 0;";
    footer.innerHTML = `<button id="mp-save-btn" style="padding:8px 24px;background:linear-gradient(90deg,#4CAF50,#45a049);color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,0.3);">💾 保存并发送 (Save)</button>`;
    
    win.appendChild(iframe);
    win.appendChild(footer);
    document.body.appendChild(win);

    const saveBtn = footer.querySelector("#mp-save-btn");
    saveBtn.onclick = () => {
        saveBtn.disabled = true; saveBtn.textContent = "⏳ 传输中...";
        iframe.contentWindow.postMessage("activeDocument.saveToOE('png');", "*");
    };

    window.addEventListener("message", async function(e) {
        if (e.source !== iframe.contentWindow) return;
        if (e.data instanceof ArrayBuffer) {
            try {
                const blob = new Blob([e.data], { type: "image/png" });
                const file = new File([blob], `Photopea_${Date.now()}.png`, { type: "image/png" });
                const body = new FormData();
                body.append("image", file); body.append("subfolder", "magic_photopea"); body.append("type", "input");

                const resp = await api.fetchApi("/upload/image", { method: "POST", body });
                const result = await resp.json();

                const currentNode = app.graph.getNodeById(win.dataset.currentNodeId);
                if (currentNode) refreshNodeImageWidget(currentNode, result.name);

                setTimeout(() => { win.style.display = "none"; }, 500);
            } catch (err) { saveBtn.disabled = false; alert("Upload failed: " + err); }
        }
    });

    let isDragging = false; let startX, startY, startLeft, startTop;
    win.addEventListener("pointerdown", (e) => {
        if (["BUTTON","INPUT","IFRAME","SELECT"].includes(e.target.tagName)) return;
        if (win.dataset.isMaximized === "true") return;
        isDragging = true; startX = e.clientX; startY = e.clientY; startLeft = win.offsetLeft; startTop = win.offsetTop;
        win.setPointerCapture(e.pointerId);
    });
    win.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        win.style.left = (startLeft + (e.clientX - startX)) + "px"; win.style.top = (startTop + (e.clientY - startY)) + "px";
    });
    win.addEventListener("pointerup", (e) => { isDragging = false; win.releasePointerCapture(e.pointerId); });
}

// ============================================================
// 🛠️ Helpers
// ============================================================
function updateNodePreview(node, filename) {
    if (!filename || filename === "canvas_empty.png") return;
    const safeName = encodeURIComponent(filename);
    
    const tryLoad = (subfolder) => {
        const img = new Image();
        img.onload = () => { node.imgs = [img]; app.graph.setDirtyCanvas(true, true); };
        img.onerror = () => {
            if (subfolder === "magic_photopea") {
                const img2 = new Image();
                img2.onload = () => { node.imgs = [img2]; app.graph.setDirtyCanvas(true, true); };
                img2.src = api.apiURL(`/view?filename=${safeName}&type=input&t=${Date.now()}`);
            }
        };
        let url = `/view?filename=${safeName}&type=input&t=${Date.now()}`;
        if (subfolder) url += `&subfolder=${subfolder}`;
        img.src = api.apiURL(url);
    };
    tryLoad("magic_photopea");
}

async function refreshNodeImageWidget(node, newFileName) {
    const widget = node.widgets.find(w => w.name === "image_selection");
    if (!widget) return;
    if (!widget.options.values.includes(newFileName)) widget.options.values.unshift(newFileName);
    widget.value = newFileName;
    updateNodePreview(node, newFileName);
}