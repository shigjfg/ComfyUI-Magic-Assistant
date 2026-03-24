import { app } from "../../scripts/app.js";

const NODE_NAME = "MagicUniversalSwitch";

/** LiteGraph 的 app.canvas 不是 DOM，没有 addEventListener；必须用底层 canvas 或 window */
function getCanvasDomElement(canvas) {
    if (!canvas) return null;
    return canvas.canvas ?? canvas.canvasEl ?? canvas.element ?? null;
}

/** 事件坐标 → 画布/图坐标（兼容不同 ComfyUI / LiteGraph 版本） */
function eventToGraphPoint(app, e) {
    try {
        if (app.canvas?.ds?.convertEventToCanvas) {
            const p = app.canvas.ds.convertEventToCanvas(e);
            if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                return p;
            }
        }
    } catch (_) { /* ignore */ }
    try {
        if (typeof app.canvas?.convertEventToCanvasOffset === "function") {
            const p = app.canvas.convertEventToCanvasOffset(e);
            if (Array.isArray(p) && p.length >= 2) return p;
        }
    } catch (_) { /* ignore */ }
    const el = getCanvasDomElement(app.canvas);
    if (!el || e.clientX == null || e.clientY == null) return [0, 0];
    const rect = el.getBoundingClientRect();
    const bx = e.clientX - rect.left;
    const by = e.clientY - rect.top;
    const ds = app.canvas?.ds;
    if (ds && typeof ds.scale === "number" && Array.isArray(ds.offset)) {
        return [bx / ds.scale - ds.offset[0], by / ds.scale - ds.offset[1]];
    }
    return [bx, by];
}

function isPointerOrMouseDown(event) {
    const t = (event && event.type) || "";
    return t === "pointerdown" || t === "mousedown" || t === "touchstart";
}

app.registerExtension({
    name: "Magic.Control.Switch",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        /* ──────────────────────────── 拖拽排序状态 ──────────────────────────── */
        // dragState 挂在 node 实例上，结构如下：
        // {
        //   active: bool,          // 是否正在拖拽
        //   dragIndex: int,         // 被拖拽的 widget 在 widgets 列表中的下标
        //   dragY: float,          // 拖拽项的 canvas-Y（起始位置，用于跟随鼠标）
        //   insertIndex: int,      // 目标插入位置
        //   insertAbove: bool,     // true = 插上方，false = 插下方
        //   startPos: {x,y},       // 拖拽开始时鼠标的 canvas 坐标
        // }

        /* ──────────────────────────── 节点创建 ──────────────────────────── */
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (!this.properties) this.properties = {};
            if (this.properties["show_nav"] === undefined) this.properties["show_nav"] = true;
            if (!this.properties["match_query"]) this.properties["match_query"] = "";
            if (this.properties["auto_refresh"] === undefined) this.properties["auto_refresh"] = false;
            if (!this.properties["fixed_groups"]) this.properties["fixed_groups"] = [];
            // 拖拽排序：自定义显示顺序（组标题数组）
            if (!this.properties["group_sort_order"]) this.properties["group_sort_order"] = [];

            // 从 properties 恢复固定状态
            this.fixedGroupTitles = new Set(this.properties["fixed_groups"] || []);

            // 拖拽排序：初始化拖拽状态
            this.dragState = null;

            // 添加刷新按钮
            this.addWidget("button", "♻️ 刷新列表 (Refresh)", null, () => {
                this.refreshGroupWidgets(app);
            });

            // 实时刷新定时器
            this._autoRefreshTimer = null;
            this._lastGroupsHash = null;

            setTimeout(() => {
                if (app.graph) {
                    this.refreshGroupWidgets(app);
                    this.startAutoRefresh(app);
                }
            }, 500);

            return r;
        };

        /* ──────────────────────────── 属性监听 ──────────────────────────── */
        nodeType.prototype.onPropertyChanged = function(name, value) {
            if (name === "match_query" || name === "show_nav") {
                setTimeout(() => { this.refreshGroupWidgets(app); }, 50);
            } else if (name === "auto_refresh") {
                if (value) {
                    this.startAutoRefresh(app);
                } else {
                    this.stopAutoRefresh();
                }
            }
            return true;
        };

        /* ──────────────────────────── 自动刷新 ──────────────────────────── */
        nodeType.prototype.startAutoRefresh = function(app) {
            this.stopAutoRefresh();

            if (!this.properties["auto_refresh"]) return;

            const updateGroupsHash = () => {
                if (!app.graph || !app.graph._groups) return "";
                const groups = app.graph._groups || [];
                const hashData = groups.map(g => {
                    const nodes = this.getGroupNodes(g, app);
                    const nodeStates = nodes.map(n => ({
                        id: n.id,
                        mode: n.mode || 0
                    }));
                    return {
                        title: g.title,
                        pos: g.pos,
                        size: g.size,
                        nodes: nodeStates
                    };
                });
                return JSON.stringify(hashData);
            };

            this._lastGroupsHash = updateGroupsHash();

            this._autoRefreshTimer = setInterval(() => {
                if (!app.graph || !this.properties["auto_refresh"]) {
                    this.stopAutoRefresh();
                    return;
                }
                const currentHash = updateGroupsHash();
                if (currentHash !== this._lastGroupsHash) {
                    this._lastGroupsHash = currentHash;
                    this.refreshGroupWidgets(app);
                }
            }, 500);
        };

        nodeType.prototype.stopAutoRefresh = function() {
            if (this._autoRefreshTimer) {
                clearInterval(this._autoRefreshTimer);
                this._autoRefreshTimer = null;
            }
        };

        /* ──────────────────────────── 节点删除清理 ──────────────────────────── */
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            this.stopAutoRefresh();
            if (this._dragUnbind) this._dragUnbind();
            if (onRemoved) onRemoved.apply(this, arguments);
        };

        /* ──────────────────────────── 配置恢复 ──────────────────────────── */
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;

            if (this.properties && this.properties["fixed_groups"]) {
                this.fixedGroupTitles = new Set(this.properties["fixed_groups"]);
            } else {
                this.fixedGroupTitles = new Set();
                this.properties["fixed_groups"] = [];
            }

            // 恢复排序顺序
            if (!this.properties["group_sort_order"]) {
                this.properties["group_sort_order"] = [];
            }

            if (this.properties && this.properties["auto_refresh"]) {
                setTimeout(() => {
                    if (app.graph) this.startAutoRefresh(app);
                }, 100);
            } else {
                this.stopAutoRefresh();
            }

            setTimeout(() => {
                if (app.graph) this.refreshGroupWidgets(app);
            }, 200);

            return r;
        };

        /* ──────────────────────────── 核心：刷新列表 ──────────────────────────── */
        nodeType.prototype.refreshGroupWidgets = function(app) {
            const query = this.properties["match_query"] || "";
            let regex = null;
            if (query && query.trim() !== "") {
                try { regex = new RegExp(query, "i"); } catch(e) {}
            }

            if (this.widgets) {
                this.widgets = this.widgets.filter(w => w.type !== "MAGIC_TOGGLE");
            }

            const allGroups = app.graph._groups || [];

            // 清理孤立固定状态
            const existingGroupTitles = new Set(allGroups.map(g => g.title).filter(t => t));
            const fixedGroupsToKeep = Array.from(this.fixedGroupTitles)
                .filter(title => existingGroupTitles.has(title));
            this.fixedGroupTitles = new Set(fixedGroupsToKeep);
            this.properties["fixed_groups"] = fixedGroupsToKeep;

            // ── 自定义排序：优先按 group_sort_order 排列 ──
            const sortOrder = this.properties["group_sort_order"] || [];
            const sortMap = new Map(sortOrder.map((title, idx) => [title, idx]));

            // 过滤 + 排序
            let filteredGroups = allGroups.filter(g => {
                if (!g.title) return false;
                if (regex && !regex.test(g.title)) return false;
                return true;
            });

            filteredGroups.sort((a, b) => {
                const ia = sortMap.get(a.title) ?? Infinity;
                const ib = sortMap.get(b.title) ?? Infinity;
                if (ia !== ib) return ia - ib;
                // 未排过序的，保持原有相对顺序
                return 0;
            });

            // 去重命名处理
            const nameCounts = {};
            filteredGroups.forEach(g => {
                let name = g.title;
                if (nameCounts[name]) {
                    nameCounts[name]++;
                    name = `${name} #${nameCounts[name]}`;
                } else {
                    nameCounts[name] = 1;
                }
                // displayName 在 widget 内部通过 this.name 访问原始标题（不含 #N）
                // 但去重标题直接用 g.title 用于唯一标识
            });

            // 重新计数：只对原标题计数
            const origNameCounts = {};
            filteredGroups.forEach(g => {
                const orig = g.title;
                origNameCounts[orig] = (origNameCounts[orig] || 0) + 1;
            });

            filteredGroups.forEach(g => {
                const orig = g.title;
                const count = origNameCounts[orig];
                let displayName = `📦 ${orig}`;
                if (count > 1) {
                    // 分配序号（同组内按位置）
                    if (!g._displaySeq) g._displaySeq = (g._displaySeq || 0);
                }
                const isActive = this.isGroupActive(g, app);
                const isFixed = this.fixedGroupTitles.has(g.title);
                this.addMagicWidget(displayName, isActive, isFixed, g, app, origNameCounts, origNameCounts[orig] > 1);
            });

            const size = this.computeSize();
            if (size[0] < 280) size[0] = 280;
            this.setSize(size);

            app.graph.setDirtyCanvas(true, true);
        };

        /* ──────────────────────────── 自定义控件工厂 ──────────────────────────── */
        // gripWidth: 左侧拖拽手柄宽度
        const GRIP_WIDTH = 24;
        const NAV_WIDTH = 30;
        const PIN_WIDTH = 30;
        const WIDGET_HEIGHT = 28;
        const DRAG_INSERT_LINE_COLOR = "#2ecc71"; // 绿色 = 插上方
        const DRAG_INSERT_LINE_COLOR2 = "#e67e22"; // 橙色 = 插下方

        nodeType.prototype.addMagicWidget = function(name, value, isFixed, group, app, nameCounts, needsSuffix) {
            const node = this;

            const widget = {
                type: "MAGIC_TOGGLE",
                name: name,       // 显示名称（含 📦 前缀）
                _groupTitle: group.title, // 组原始标题（唯一标识）
                _targetGroup: group,
                value: value,
                _isFixed: isFixed,
                options: { on: "yes", off: "no" },
                y: 0,

                /* ── 绘制 ── */
                draw: function(ctx, node, widgetWidth, y, widgetHeight) {
                    const showNav = node.properties["show_nav"] !== false;
                    const rightReserved = (showNav ? NAV_WIDTH : 0) + PIN_WIDTH;
                    const usableWidth = widgetWidth - 20;

                    // 必须用「仅 MAGIC_TOGGLE」列表下标；node.widgets 里还有 control_mode / 按钮等，混用会导致每行都画插入线
                    const magicListForIdx = node.widgets.filter(w => w.type === "MAGIC_TOGGLE");
                    const myMagicIdx = magicListForIdx.indexOf(this);

                    // 背景
                    const isDragging = node.dragState && node.dragState.active &&
                        node.dragState.dragIndex === myMagicIdx;
                    ctx.fillStyle = isDragging
                        ? "#3d566e"  // 拖拽中略微高亮
                        : (this.value ? "#34495e" : "#222");
                    ctx.fillRect(10, y, usableWidth, widgetHeight);

                    // 拖拽中：被拖项下沉半透明
                    if (isDragging) {
                        ctx.fillStyle = "rgba(52, 73, 94, 0.4)";
                        ctx.fillRect(10, y, usableWidth, widgetHeight);
                    }

                    // ── 左侧拖拽手柄（三条杠）──
                    const gripX = 12;
                    const gripY = y + widgetHeight * 0.5;
                    const lineColor = isDragging ? "#ecf0f1" : "#7f8c8d";
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = 2;
                    ctx.lineCap = "round";
                    [-5, 0, 5].forEach(offset => {
                        ctx.beginPath();
                        ctx.moveTo(gripX,      gripY + offset);
                        ctx.lineTo(gripX + 10,  gripY + offset);
                        ctx.stroke();
                    });

                    // 文字（向左让出手柄区域）
                    ctx.fillStyle = this.value ? "#ECF0F1" : "#95A5A6";
                    ctx.font = "12px Arial";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    let text = this.name;
                    const leftReserve = GRIP_WIDTH + 10;
                    const maxTextLen = Math.floor((widgetWidth - rightReserved - leftReserve - 40) / 7);
                    if (text.length > maxTextLen) text = text.substring(0, maxTextLen) + "...";
                    ctx.fillText(text, leftReserve + 6, y + widgetHeight * 0.5);

                    // 开关圆点
                    const toggleX = 10 + usableWidth - rightReserved - 15;
                    const toggleY = y + widgetHeight * 0.5;
                    ctx.beginPath();
                    ctx.arc(toggleX, toggleY, 6, 0, Math.PI * 2);
                    ctx.fillStyle = this.value ? "#2ecc71" : "#444";
                    ctx.fill();
                    ctx.stroke();

                    // 固定区
                    const pinLineX = 10 + usableWidth - rightReserved;
                    ctx.beginPath();
                    ctx.moveTo(pinLineX, y + 4);
                    ctx.lineTo(pinLineX, y + widgetHeight - 4);
                    ctx.strokeStyle = "#444";
                    ctx.stroke();

                    const pinCenterX = pinLineX + (PIN_WIDTH / 2);
                    const pinCenterY = y + widgetHeight * 0.5;
                    if (this._isFixed) {
                        ctx.fillStyle = "#f1c40f";
                        ctx.fillRect(pinCenterX - 4, pinCenterY - 4, 8, 8);
                    } else {
                        ctx.strokeStyle = "#7f8c8d";
                        ctx.lineWidth = 1;
                        ctx.strokeRect(pinCenterX - 4, pinCenterY - 4, 8, 8);
                    }

                    // 导航区
                    if (showNav) {
                        const navLineX = 10 + usableWidth - NAV_WIDTH;
                        ctx.beginPath();
                        ctx.moveTo(navLineX, y + 4);
                        ctx.lineTo(navLineX, y + widgetHeight - 4);
                        ctx.strokeStyle = "#444";
                        ctx.stroke();

                        const navCenterX = navLineX + (NAV_WIDTH / 2);
                        const navCenterY = y + widgetHeight * 0.5;
                        ctx.fillStyle = "#bdc3c7";
                        ctx.beginPath();
                        ctx.moveTo(navCenterX - 3, navCenterY - 5);
                        ctx.lineTo(navCenterX + 5, navCenterY);
                        ctx.lineTo(navCenterX - 3, navCenterY + 5);
                        ctx.fill();
                    }

                    /* ── 拖拽排序：只画一条插入线（insertSlot = 0..n 表示「第几行上方」的缝；n = 最后一行下方）── */
                    if (node.dragState && node.dragState.active && myMagicIdx >= 0) {
                        const slot = node.dragState.insertSlot;
                        const dragIdx = node.dragState.dragIndex;
                        const n = magicListForIdx.length;
                        if (slot != null && !(slot === dragIdx || slot === dragIdx + 1)) {
                            let lineY = null;
                            let lineColor = DRAG_INSERT_LINE_COLOR;
                            if (slot === myMagicIdx) {
                                lineY = y - 2;
                                lineColor = DRAG_INSERT_LINE_COLOR;
                            } else if (slot === n && myMagicIdx === n - 1) {
                                lineY = y + widgetHeight + 2;
                                lineColor = DRAG_INSERT_LINE_COLOR2;
                            }
                            if (lineY != null) {
                                ctx.save();
                                ctx.strokeStyle = lineColor;
                                ctx.lineWidth = 2;
                                ctx.setLineDash([6, 4]);
                                ctx.lineCap = "butt";
                                ctx.shadowBlur = 0;
                                ctx.beginPath();
                                ctx.moveTo(10, lineY);
                                ctx.lineTo(widgetWidth - 10, lineY);
                                ctx.stroke();
                                ctx.restore();
                                const ax = widgetWidth - 22;
                                ctx.fillStyle = lineColor;
                                ctx.beginPath();
                                if (slot === n) {
                                    ctx.moveTo(ax, lineY - 5);
                                    ctx.lineTo(ax - 5, lineY);
                                    ctx.lineTo(ax + 5, lineY);
                                } else {
                                    ctx.moveTo(ax, lineY + 5);
                                    ctx.lineTo(ax - 5, lineY);
                                    ctx.lineTo(ax + 5, lineY);
                                }
                                ctx.fill();
                            }
                        }
                    }
                },

                /* ── 点击事件 ── */
                mouse: function(event, pos, node) {
                    // LiteGraph 各版本可能是 pointerdown / mousedown
                    if (isPointerOrMouseDown(event)) {
                        const width = node.size[0];
                        const showNav = node.properties["show_nav"] !== false;

                        const navBoundary = width - 10 - NAV_WIDTH;
                        const actualPinBoundary = width - 10 - (showNav ? NAV_WIDTH : 0) - PIN_WIDTH;

                        // 0️⃣ 拖拽手柄区域（最左侧，略放宽避免点不到）
                        const gripHit = Math.min(GRIP_WIDTH + 20, Math.max(40, width * 0.14));
                        if (pos[0] <= gripHit) {
                            node._startDrag(this, event, app, pos);
                            return true;
                        }

                        // A. 导航
                        if (showNav && pos[0] > navBoundary) {
                            const group = this._targetGroup;
                            app.canvas.centerOnNode(group);
                            const ratio = Math.min(
                                app.canvas.canvas.width / group.size[0],
                                app.canvas.canvas.height / group.size[1]
                            );
                            app.canvas.setZoom(ratio * 0.85);
                            app.canvas.setDirty(true, true);
                            return true;
                        }

                        // B. 固定
                        if (pos[0] > actualPinBoundary && (!showNav || pos[0] <= navBoundary)) {
                            this._isFixed = !this._isFixed;
                            if (this._isFixed) {
                                node.fixedGroupTitles.add(this._targetGroup.title);
                            } else {
                                node.fixedGroupTitles.delete(this._targetGroup.title);
                            }
                            node.properties["fixed_groups"] = Array.from(node.fixedGroupTitles);
                            app.graph.setDirtyCanvas(true, true);
                            return true;
                        }

                        // C. 开关
                        this.value = !this.value;
                        node.handleToggle(this._targetGroup, this, this.value, app);
                    }
                    return true;
                }
            };

            this.widgets.push(widget);
        };

        /* ══════════════════════════════════════════════════════════════════════
         *  拖拽排序核心逻辑
         * ══════════════════════════════════════════════════════════════════════ */

        // 拖拽状态：insertSlot ∈ [0, n] 表示「在当前列表中，插入缝隙在第 slot 行之前」；slot === n 表示最后一行之后
        nodeType.prototype._createDragState = function(dragIndex, startPos) {
            return {
                active: true,
                dragIndex: dragIndex,
                insertSlot: null, // 首次 move 前不画线
                startPos: { x: startPos[0], y: startPos[1] }
            };
        };

        // 开始拖拽
        nodeType.prototype._startDrag = function(widget, event, app, pos) {
            const node = this;

            // 找到被拖拽的 widget 在列表中的下标
            const magicWidgets = node.widgets.filter(w => w.type === "MAGIC_TOGGLE");
            const dragIndex = magicWidgets.indexOf(widget);
            if (dragIndex < 0) return;

            // 初始化拖拽状态
            node.dragState = node._createDragState(dragIndex, pos);

            const onDragMove = function(e) {
                if (!node.dragState || !node.dragState.active) return;

                const canvasPos = eventToGraphPoint(app, e);
                const curY = canvasPos[1];

                const magicList = node.widgets.filter(w => w.type === "MAGIC_TOGGLE");
                const n = magicList.length;

                // 根据鼠标 Y 落在哪一行的「上半/下半」决定插入缝隙 insertSlot（0..n）
                let insertSlot = n;
                for (let i = 0; i < n; i++) {
                    const w = magicList[i];
                    const top = node.pos[1] + (w.y || 0);
                    const mid = top + WIDGET_HEIGHT / 2;
                    if (curY < mid) {
                        insertSlot = i;
                        break;
                    }
                }

                const prev = node.dragState.insertSlot;
                if (prev !== insertSlot) {
                    node.dragState.insertSlot = insertSlot;
                    app.graph.setDirtyCanvas(true, false);
                }
            };

            const unbindDragListeners = function() {
                if (node._dragListenerTargets) {
                    for (const { target, type, fn, cap } of node._dragListenerTargets) {
                        try {
                            target.removeEventListener(type, fn, cap);
                        } catch (_) { /* ignore */ }
                    }
                    node._dragListenerTargets = null;
                }
                node._dragUnbind = null;
            };
            node._dragUnbind = unbindDragListeners;

            const onDragEnd = function(e) {
                if (!node.dragState || !node.dragState.active) {
                    unbindDragListeners();
                    return;
                }

                const dragIdx = node.dragState.dragIndex;
                const slot = node.dragState.insertSlot;

                node.dragState.active = false;

                if (slot != null) {
                    node._applySortBySlot(dragIdx, slot, app);
                }

                node.dragState = null;
                app.graph.setDirtyCanvas(true, true);

                unbindDragListeners();
            };

            if (event.stopPropagation) event.stopPropagation();
            if (event.preventDefault) event.preventDefault();

            // 必须在 window/document 或真实 canvas DOM 上监听：LGraphCanvas 实例没有 addEventListener
            const cap = true;
            const targets = [];
            const add = (target, type, fn) => {
                if (!target || typeof target.addEventListener !== "function") return;
                target.addEventListener(type, fn, cap);
                targets.push({ target, type, fn, cap });
            };
            // 不要同时绑 pointer + mouse，否则会重复触发
            const hasPointer = typeof window.PointerEvent === "function";
            if (hasPointer) {
                add(window, "pointermove", onDragMove);
                add(window, "pointerup", onDragEnd);
                add(window, "pointercancel", onDragEnd);
            } else {
                add(window, "mousemove", onDragMove);
                add(window, "mouseup", onDragEnd);
                add(document, "touchend", onDragEnd);
                add(document, "touchcancel", onDragEnd);
            }
            const domCanvas = getCanvasDomElement(app.canvas);
            if (hasPointer && domCanvas) {
                add(domCanvas, "lostpointercapture", onDragEnd);
            }

            node._dragListenerTargets = targets;

            if (event.pointerId != null && domCanvas?.setPointerCapture) {
                try {
                    domCanvas.setPointerCapture(event.pointerId);
                } catch (_) { /* ignore */ }
            }

            app.graph.setDirtyCanvas(true, false);
        };

        // insertSlot：移除前列表缝隙下标 0..n；与 dragIndex / dragIndex+1 重合表示原位，不改动
        nodeType.prototype._applySortBySlot = function(dragIndex, insertSlot, app) {
            const magicWidgets = this.widgets.filter(w => w.type === "MAGIC_TOGGLE");
            const n = magicWidgets.length;
            if (dragIndex < 0 || dragIndex >= n) return;
            if (insertSlot == null || insertSlot < 0 || insertSlot > n) return;
            if (insertSlot === dragIndex || insertSlot === dragIndex + 1) return;

            const titles = magicWidgets.map(w => w._groupTitle);
            const [dragged] = titles.splice(dragIndex, 1);
            let pos = insertSlot;
            if (dragIndex < insertSlot) pos = insertSlot - 1;
            titles.splice(pos, 0, dragged);

            this.properties["group_sort_order"] = titles;
            this.refreshGroupWidgets(app);
        };

        /* ──────────────────────────── 开关逻辑 ──────────────────────────── */
        nodeType.prototype.handleToggle = function(group, widget, isTurningOn, app) {
            const modeStr = this.widgets.find(w => w.name === "control_mode").value;
            const offMode = modeStr.includes("Bypass") ? 4 : 2;
            const onMode = 0;

            const nodes = this.getGroupNodes(group, app);
            nodes.forEach(n => n.mode = isTurningOn ? onMode : offMode);

            if (isTurningOn) {
                const maxActive = this.widgets.find(w => w.name === "max_active")?.value || 1;
                const activeWidgets = this.widgets.filter(w => w.type === "MAGIC_TOGGLE" && w.value === true);

                if (activeWidgets.length > maxActive) {
                    let toCloseCount = activeWidgets.length - maxActive;
                    const candidates = activeWidgets.filter(w => w !== widget && w._isFixed !== true);

                    for (const w of candidates) {
                        if (toCloseCount <= 0) break;
                        w.value = false;
                        if (w._targetGroup) {
                            const wNodes = this.getGroupNodes(w._targetGroup, app);
                            wNodes.forEach(n => n.mode = offMode);
                        }
                        toCloseCount--;
                    }
                }
            }
            app.graph.setDirtyCanvas(true, true);
        };

        /* ──────────────────────────── 辅助函数 ──────────────────────────── */
        nodeType.prototype.getGroupNodes = function(group, app) {
            const nodes = [];
            if (!group.pos || !group.size) return nodes;
            const gx = group.pos[0], gy = group.pos[1], gw = group.size[0], gh = group.size[1];

            app.graph._nodes.forEach(n => {
                if (!n.pos) return;
                const p = 10;
                if (n.pos[0] >= gx - p && n.pos[0] < gx + gw + p &&
                    n.pos[1] >= gy - p && n.pos[1] < gy + gh + p) {
                    nodes.push(n);
                }
            });
            return nodes;
        };

        nodeType.prototype.isGroupActive = function(group, app) {
            const nodes = this.getGroupNodes(group, app);
            return nodes.some(n => n.mode === 0);
        };
    }
});