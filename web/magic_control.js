import { app } from "../../scripts/app.js";

const NODE_NAME = "MagicUniversalSwitch";

app.registerExtension({
    name: "Magic.Control.Switch",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === NODE_NAME) {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                if (!this.properties) this.properties = {};
                if (this.properties["show_nav"] === undefined) this.properties["show_nav"] = true;
                if (!this.properties["match_query"]) this.properties["match_query"] = "";
                if (this.properties["auto_refresh"] === undefined) this.properties["auto_refresh"] = false;
                if (!this.properties["fixed_groups"]) this.properties["fixed_groups"] = [];

                // 从 properties 恢复固定状态
                this.fixedGroupTitles = new Set(this.properties["fixed_groups"] || []);

                // 添加刷新按钮（使用 button widget，点击即刷新）
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

            // ⚡️ 属性监听
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

            // 🔄 启动实时刷新
            nodeType.prototype.startAutoRefresh = function(app) {
                this.stopAutoRefresh(); // 先停止旧的定时器
                
                if (!this.properties["auto_refresh"]) {
                    return;
                }

                // 计算当前组的哈希值（用于检测变化）
                const updateGroupsHash = () => {
                    if (!app.graph || !app.graph._groups) return "";
                    const groups = app.graph._groups || [];
                    // 不仅检查组的基本信息，还检查组内节点的状态
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

                // 每 500ms 检查一次组的变化
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

            // 🛑 停止实时刷新
            nodeType.prototype.stopAutoRefresh = function() {
                if (this._autoRefreshTimer) {
                    clearInterval(this._autoRefreshTimer);
                    this._autoRefreshTimer = null;
                }
            };

            // 🧹 清理定时器（节点删除时）
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                this.stopAutoRefresh();
                if (onRemoved) onRemoved.apply(this, arguments);
            };

            // 🔄 节点配置恢复时，恢复实时刷新状态和固定状态
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                
                // 恢复固定状态
                if (this.properties && this.properties["fixed_groups"]) {
                    this.fixedGroupTitles = new Set(this.properties["fixed_groups"]);
                } else {
                    this.fixedGroupTitles = new Set();
                    this.properties["fixed_groups"] = [];
                }
                
                // 恢复实时刷新状态
                if (this.properties && this.properties["auto_refresh"]) {
                    setTimeout(() => {
                        if (app.graph) {
                            this.startAutoRefresh(app);
                        }
                    }, 100);
                } else {
                    this.stopAutoRefresh();
                }
                
                // 刷新列表以显示恢复的固定状态
                setTimeout(() => {
                    if (app.graph) {
                        this.refreshGroupWidgets(app);
                    }
                }, 200);
                
                return r;
            };

            // 🔄 刷新列表
            nodeType.prototype.refreshGroupWidgets = function(app) {
                const query = this.properties["match_query"] || "";
                let regex = null;
                if (query && query.trim() !== "") {
                    try { regex = new RegExp(query, "i"); } catch(e) {}
                }

                if (this.widgets) {
                    this.widgets = this.widgets.filter(w => w.type !== "MAGIC_TOGGLE");
                }

                const groups = app.graph._groups || [];
                
                // 清理已删除组的固定状态（保持数据一致性）
                const existingGroupTitles = new Set(groups.map(g => g.title).filter(t => t));
                const fixedGroupsToKeep = Array.from(this.fixedGroupTitles).filter(title => existingGroupTitles.has(title));
                this.fixedGroupTitles = new Set(fixedGroupsToKeep);
                this.properties["fixed_groups"] = fixedGroupsToKeep;
                
                const nameCounts = {};

                groups.forEach(g => {
                    if(!g.title) return;
                    if(regex && !regex.test(g.title)) return;

                    let name = g.title;
                    if(nameCounts[name]) {
                        nameCounts[name]++;
                        name = `${name} #${nameCounts[name]}`;
                    } else {
                        nameCounts[name] = 1;
                    }

                    const isActive = this.isGroupActive(g, app);
                    const isFixed = this.fixedGroupTitles.has(g.title);
                    
                    const displayName = `📦 ${name}`;

                    this.addMagicWidget(displayName, isActive, isFixed, g, app);
                });

                const size = this.computeSize();
                if (size[0] < 280) size[0] = 280; 
                this.setSize(size);
                
                app.graph.setDirtyCanvas(true, true);
            };

            // 🛠️ 创建自定义控件 (颜值升级版)
            nodeType.prototype.addMagicWidget = function(name, value, isFixed, group, app) {
                const widget = {
                    type: "MAGIC_TOGGLE", 
                    name: name,
                    value: value,
                    _targetGroup: group,
                    _isFixed: isFixed, 
                    options: { on: "yes", off: "no" },
                    y: 0,
                    
                    // 🎨 1. 自定义绘制
                    draw: function(ctx, node, widgetWidth, y, widgetHeight) {
                        const showNav = node.properties["show_nav"] !== false;
                        
                        const navWidth = 30;  
                        const pinWidth = 30;  
                        const rightReserved = (showNav ? navWidth : 0) + pinWidth; 
                        const usableWidth = widgetWidth - 20; 
                        
                        // A. 背景 (主体) - 🎨 改色：深蓝灰 vs 深黑
                        ctx.fillStyle = this.value ? "#34495e" : "#222"; 
                        ctx.fillRect(10, y, usableWidth, widgetHeight);

                        // B. 文字
                        ctx.fillStyle = this.value ? "#ECF0F1" : "#95A5A6"; // 🎨 改色：亮白 vs 灰
                        ctx.font = "12px Arial";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        let text = this.name;
                        const maxTextLen = Math.floor((widgetWidth - rightReserved - 60) / 7); 
                        if (text.length > maxTextLen) text = text.substring(0, maxTextLen) + "...";
                        ctx.fillText(text, 16, y + widgetHeight * 0.5);

                        // C. 开关圆点
                        const toggleX = 10 + usableWidth - rightReserved - 15;
                        const toggleY = y + widgetHeight * 0.5;
                        
                        ctx.beginPath();
                        ctx.arc(toggleX, toggleY, 6, 0, Math.PI * 2);
                        // 🎨 改色：翡翠绿 vs 暗灰
                        ctx.fillStyle = this.value ? "#2ecc71" : "#444"; 
                        ctx.fill();
                        ctx.stroke();

                        // --- 📌 固定功能区 ---
                        const pinLineX = 10 + usableWidth - rightReserved;
                        ctx.beginPath();
                        ctx.moveTo(pinLineX, y + 4);
                        ctx.lineTo(pinLineX, y + widgetHeight - 4);
                        ctx.strokeStyle = "#444"; // 分割线颜色
                        ctx.stroke();

                        const pinCenterX = pinLineX + (pinWidth / 2);
                        const pinCenterY = y + widgetHeight * 0.5;
                        
                        if (this._isFixed) {
                            ctx.fillStyle = "#f1c40f"; // 🎨 改色：扁平金
                            ctx.fillRect(pinCenterX - 4, pinCenterY - 4, 8, 8);
                        } else {
                            ctx.strokeStyle = "#7f8c8d"; // 🎨 改色：低调灰
                            ctx.lineWidth = 1;
                            ctx.strokeRect(pinCenterX - 4, pinCenterY - 4, 8, 8);
                        }

                        // --- ➤ 导航功能区 ---
                        if (showNav) {
                            const navLineX = 10 + usableWidth - navWidth;
                            ctx.beginPath();
                            ctx.moveTo(navLineX, y + 4);
                            ctx.lineTo(navLineX, y + widgetHeight - 4);
                            ctx.strokeStyle = "#444";
                            ctx.stroke();

                            const navCenterX = navLineX + (navWidth / 2);
                            const navCenterY = y + widgetHeight * 0.5;
                            
                            // 🎨 改色：柔和银灰 (不再是刺眼的青色)
                            ctx.fillStyle = "#bdc3c7"; 
                            ctx.beginPath();
                            // 稍微缩小一点点箭头，更精致
                            ctx.moveTo(navCenterX - 3, navCenterY - 5);
                            ctx.lineTo(navCenterX + 5, navCenterY);
                            ctx.lineTo(navCenterX - 3, navCenterY + 5);
                            ctx.fill();
                        }
                    },

                    // 🖱️ 2. 自定义点击事件 (完全保留功能，一行未动)
                    mouse: function(event, pos, node) {
                        if (event.type == "pointerdown") {
                            const width = node.size[0];
                            const showNav = node.properties["show_nav"] !== false;
                            
                            const navWidth = 30;
                            const pinWidth = 30;
                            const rightMargin = 10;
                            
                            const navBoundary = width - rightMargin - navWidth; 
                            const actualPinBoundary = width - rightMargin - (showNav ? navWidth : 0) - pinWidth;

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
                                // 保存固定状态到 properties（用于工作流保存）
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

            // ⚙️ 逻辑函数 (完全保留)
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

            nodeType.prototype.getGroupNodes = function(group, app) {
                const nodes = [];
                if(!group.pos || !group.size) return nodes;
                const gx = group.pos[0], gy = group.pos[1], gw = group.size[0], gh = group.size[1];
                
                app.graph._nodes.forEach(n => {
                    if(!n.pos) return;
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
    }
});