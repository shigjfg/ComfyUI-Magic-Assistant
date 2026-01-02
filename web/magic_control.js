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

                this.fixedGroupTitles = new Set();

                const refreshBtn = this.widgets.find(w => w.name === "refresh");
                if(refreshBtn) {
                    refreshBtn.callback = () => { this.refreshGroupWidgets(app); };
                }

                setTimeout(() => {
                    if (app.graph) this.refreshGroupWidgets(app);
                }, 500);

                return r;
            };

            // ⚡️ 属性监听
            nodeType.prototype.onPropertyChanged = function(name, value) {
                if (name === "match_query" || name === "show_nav") {
                    setTimeout(() => { this.refreshGroupWidgets(app); }, 50);
                }
                return true;
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