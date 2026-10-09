import { app } from "../../scripts/app.js";

const NODE_NAME = "MagicMaskEdit";
const HIDDEN_WIDGET = "hidden";
let dialogId = 0;

const LANGUAGE_STORAGE_KEY = "magic_assistant_language";
const TEXT = {
    zh: {
        title: "设置与模板", subtitle: "局部裁切 · 编辑 · 无缝回贴", settingsButton: "⚙ 设置与模板",
        close: "关闭设置", cancel: "取消", apply: "应用设置", modeLabel: "工作模式",
        crop: "裁切", merge: "回贴", source: "原图", editModel: "编辑模型",
        cropHint: "用原图遮罩定位区域，保留上下文并等比缩放。", mergeHint: "连接编辑图与裁切实例的 crop_info，恢复到原图位置。",
        connectionHint: "两个实例即可完成流程 · crop_info 从裁切连接到回贴",
        preset: "常用模板", presetHint: "选择后可继续调整", currentSettings: "当前设置",
        basicCrop: "裁切与尺寸", basicMerge: "回贴与融合", advanced: "高级设置",
        draftHint: "修改在应用后生效", linked: "由连接提供", linkedHint: "带连接的参数由上游节点控制，模板不会覆盖。",
        modeWarning: "切换模式后，请按新坐标重新连接遮罩。", modeSwitchNotice: "模式已切换：请重新连接遮罩。",
        advancedCount: "{count} 项", pixels: "px", ratio: "×", normalized: "0–1",
        mode: "工作模式", resize_mode: "缩放方式", target_width: "目标宽度", longestSide: "长边长度", target_height: "目标高度",
        padding: "上下文边距", mask_threshold: "检测阈值", empty_mask_mode: "空遮罩处理", upscale_method: "插值方法",
        crop_shape: "裁切形状", scale_factor: "缩放倍率", scale_policy: "缩放限制", size_multiple: "尺寸对齐",
        blend_mode: "融合范围", feather: "边缘羽化", blend_opacity: "融合强度", mask_mode: "模型遮罩",
        input_layout: "编辑图坐标", batch_order: "候选图排列",
        "help.resize_mode": "保持比例；目标尺寸仅限定范围。", "help.target_width": "输出范围；不足时按尺寸对齐补边。",
        "help.target_height": "与宽度一起限定输出范围。", "help.padding": "在遮罩周围保留原图上下文。",
        "help.mask_threshold": "高于此值的像素用于定位裁切区域。", "help.empty_mask_mode": "没有有效遮罩时如何处理。",
        "help.upscale_method": "自动按放大或缩小选择合适插值。", "help.crop_shape": "靠近边缘时，裁切框向图内移动。",
        "help.scale_factor": "以裁切内容尺寸为基准缩放。", "help.scale_policy": "需要保留细节时，可限制缩小。",
        "help.size_multiple": "只补边对齐，不拉伸图像。", "help.blend_mode": "决定编辑结果回贴到哪些区域。",
        "help.feather": "按原图像素向融合区域内渐变。", "help.blend_opacity": "0 保留原图，1 完整应用编辑。",
        "help.mask_mode": "二值模式保留缩小后的细小选区。", "help.input_layout": "编辑图与外接融合遮罩必须使用同一坐标。",
        "help.batch_order": "多张候选图与源图的对应顺序。",
        "option.target": "目标尺寸", "option.longest_side": "按长边", "option.scale": "按倍率", "option.none": "保持原尺寸",
        "option.preserve": "保留原图", "option.full_image": "编辑整张原图", "option.auto": "自动",
        "option.nearest-exact": "最近邻（精确）", "option.bilinear": "双线性", "option.area": "区域平均",
        "option.bicubic": "双三次", "option.lanczos": "Lanczos", "option.bislerp": "球面插值",
        "option.target_ratio": "目标宽高比", "option.square": "正方形", "option.tight": "紧贴遮罩",
        "option.both": "允许放大与缩小", "option.upscale_only": "仅放大", "option.downscale_only": "仅缩小",
        "option.mask": "仅遮罩区域", "option.crop": "整个裁切区域", "option.binary": "二值遮罩", "option.soft": "软遮罩",
        "option.canvas": "完整画布（含补边）", "option.content": "裁切内容（已去补边）",
        "option.repeat_batch": "整批重复 · A B A B", "option.repeat_each": "逐张重复 · A A B B",
        "preset.0": "裁切 · 正方形 1024", "preset.1": "裁切 · 横向 1536 × 1024", "preset.2": "裁切 · 长边 1024",
        "preset.3": "裁切 · 紧贴遮罩 × 2", "preset.4": "裁切 · 保持原尺寸", "preset.5": "回贴 · 仅遮罩区域",
        "preset.6": "回贴 · 整个裁切区域", "preset.7": "整图编辑 · 无需遮罩",
        sourceMask: "源遮罩", editedImage: "编辑图", blendMask: "融合遮罩", info: "裁切信息", fullImage: "整图",
        cropImage: "裁图", cropMask: "裁图遮罩", blendRegion: "融合范围", empty: "遮罩为空", legacy: "旧版透传",
        legacyTooltip: "兼容旧工作流的透传输出。新工作流请直接连接裁切实例对应的输出。",
        sourceTooltip: "原始完整图像；源遮罩使用此图的坐标。",
        editTooltip: "编辑后的裁图。完整画布包含补边；裁切内容表示已去补边的图像。",
        sourceMaskTooltip: "可选：原图坐标的源遮罩。单张遮罩可以广播到原图批次。",
        blendMaskTooltip: "可选：覆盖默认融合遮罩。须与编辑图使用相同坐标；不能直接连接原图遮罩。",
        infoInputTooltip: "连接裁切实例的 crop_info，携带本次原图、源遮罩及裁切和缩放坐标。",
        fullImageTooltip: "按原图坐标恢复的完整回贴图像。", cropImageTooltip: "供编辑模型使用的裁图画布，含尺寸对齐和批次补边。",
        blendRegionTooltip: "原图坐标的实际融合强度，包含羽化与融合强度。",
        cropMaskTooltip: "供编辑模型使用的遮罩，与完整裁图画布对齐，补边处为零。",
        infoOutputTooltip: "保存原图、源遮罩及裁切和缩放坐标；连接另一个回贴实例。",
        emptyTooltip: "整个批次都没有有效源遮罩。整图编辑模式下仍可能为 true，不能据此跳过编辑。",
    },
    en: {
        title: "Settings & presets", subtitle: "Local crop · Edit · Seamless merge", settingsButton: "⚙ Settings & presets",
        close: "Close settings", cancel: "Cancel", apply: "Apply settings", modeLabel: "Mode",
        crop: "Crop", merge: "Merge", source: "Source", editModel: "Edit model",
        cropHint: "Locate the source mask, keep context, and resize proportionally.", mergeHint: "Connect the edited crop and crop_info to restore the original position.",
        connectionHint: "Use two instances · Connect crop_info from Crop to Merge",
        preset: "Quick preset", presetHint: "Fine-tune after choosing", currentSettings: "Current settings",
        basicCrop: "Crop & size", basicMerge: "Merge & blend", advanced: "Advanced settings",
        draftHint: "Changes take effect when applied", linked: "Linked", linkedHint: "Linked parameters are controlled upstream and are not overwritten by presets.",
        modeWarning: "After changing mode, reconnect the mask in the new coordinate space.", modeSwitchNotice: "Mode changed: reconnect the mask.",
        advancedCount: "{count} options", pixels: "px", ratio: "×", normalized: "0–1",
        mode: "Mode", resize_mode: "Resize", target_width: "Target width", longestSide: "Longest side", target_height: "Target height",
        padding: "Context padding", mask_threshold: "Detection threshold", empty_mask_mode: "Empty mask", upscale_method: "Interpolation",
        crop_shape: "Crop shape", scale_factor: "Scale factor", scale_policy: "Scale policy", size_multiple: "Size alignment",
        blend_mode: "Blend region", feather: "Edge feather", blend_opacity: "Blend opacity", mask_mode: "Model mask",
        input_layout: "Edited input layout", batch_order: "Candidate order",
        "help.resize_mode": "Keep the aspect ratio; target size is a bounding box.", "help.target_width": "Output bounds; alignment may add padding.",
        "help.target_height": "Sets the output bounds together with width.", "help.padding": "Keep source-image context around the mask.",
        "help.mask_threshold": "Pixels above this value define the crop bounds.", "help.empty_mask_mode": "What to do when no valid mask is detected.",
        "help.upscale_method": "Auto chooses interpolation for enlargement or reduction.", "help.crop_shape": "Near image edges, the crop moves inward.",
        "help.scale_factor": "Scale relative to the cropped content dimensions.", "help.scale_policy": "Limit downscaling when preserving detail matters.",
        "help.size_multiple": "Pad to this multiple without stretching the image.", "help.blend_mode": "Choose where the edited result is merged.",
        "help.feather": "Fade inward, measured in original-image pixels.", "help.blend_opacity": "0 keeps the source; 1 fully applies the edit.",
        "help.mask_mode": "Binary preserves tiny selections after reduction.", "help.input_layout": "The edit and an optional blend mask must use the same coordinates.",
        "help.batch_order": "Match multiple candidates to their source images.",
        "option.target": "Target size", "option.longest_side": "Longest side", "option.scale": "Scale factor", "option.none": "Original size",
        "option.preserve": "Preserve source", "option.full_image": "Edit full image", "option.auto": "Auto",
        "option.nearest-exact": "Nearest (exact)", "option.bilinear": "Bilinear", "option.area": "Area",
        "option.bicubic": "Bicubic", "option.lanczos": "Lanczos", "option.bislerp": "Bislerp",
        "option.target_ratio": "Target aspect ratio", "option.square": "Square", "option.tight": "Tight mask bounds",
        "option.both": "Allow upscaling & downscaling", "option.upscale_only": "Upscale only", "option.downscale_only": "Downscale only",
        "option.mask": "Mask only", "option.crop": "Entire crop", "option.binary": "Binary mask", "option.soft": "Soft mask",
        "option.canvas": "Full canvas (with padding)", "option.content": "Content (padding removed)",
        "option.repeat_batch": "Repeat batch · A B A B", "option.repeat_each": "Repeat each · A A B B",
        "preset.0": "Crop · Square 1024", "preset.1": "Crop · Landscape 1536 × 1024", "preset.2": "Crop · Longest side 1024",
        "preset.3": "Crop · Tight bounds × 2", "preset.4": "Crop · Original size", "preset.5": "Merge · Mask only",
        "preset.6": "Merge · Entire crop", "preset.7": "Full image edit · No mask needed",
        sourceMask: "Source mask", editedImage: "Edited crop", blendMask: "Blend mask", info: "Crop info", fullImage: "Full image",
        cropImage: "Crop", cropMask: "Crop mask", blendRegion: "Blend region", empty: "Mask empty", legacy: "Legacy passthrough",
        legacyTooltip: "Compatibility output for older workflows. In new workflows, connect the matching output of the Crop instance directly.",
        sourceTooltip: "Original full image. The source mask uses this image's coordinates.",
        editTooltip: "Edited crop. Full canvas includes padding; Content means padding has been removed.",
        sourceMaskTooltip: "Optional source mask in original-image coordinates. One mask can be broadcast to an image batch.",
        blendMaskTooltip: "Optional override for the blend mask. Use the same coordinates as the edit; do not connect the original-image mask directly.",
        infoInputTooltip: "Connect crop_info from the Crop instance. It carries the source image, mask, crop bounds, and resize coordinates.",
        fullImageTooltip: "Complete merged image restored in original-image coordinates.", cropImageTooltip: "Crop canvas for the edit model, including size alignment and batch padding.",
        blendRegionTooltip: "Actual blend strength in original-image coordinates, including feathering and opacity.",
        cropMaskTooltip: "Mask for the edit model, aligned with the full crop canvas. Padded areas are zero.",
        infoOutputTooltip: "Stores the source image, mask, crop bounds, and resize coordinates. Connect to a Merge instance.",
        emptyTooltip: "No source mask in the batch passes the threshold. This may still be true for full-image editing; do not use it alone to skip editing.",
    },
};

function normalizeLanguage(language) {
    return typeof language === "string" && language.toLowerCase().startsWith("en") ? "en" : "zh";
}

function getLanguage() {
    try {
        if (typeof window.getCurrentLanguage === "function") {
            const language = window.getCurrentLanguage();
            if (language) return normalizeLanguage(language);
        }
    } catch { /* The switcher may still be initializing; try its persisted preference. */ }
    try { return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)); }
    catch { return "zh"; }
}

function text(key, language = getLanguage(), parameters = {}) {
    return (TEXT[normalizeLanguage(language)][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => parameters[name] ?? "");
}

function installStyles() {
    if (document.querySelector("link[data-magic-mask-edit-style]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./magic_mask_edit.css", import.meta.url).href;
    link.setAttribute("data-magic-mask-edit-style", "");
    document.head.append(link);
}

installStyles();

const FIELDS = [
    { name: "mode", values: ["crop", "merge"] },
    { name: "resize_mode", values: ["target", "longest_side", "scale", "none"] },
    { name: "target_width", min: 1, max: 16384, step: 1, unit: "pixels" },
    { name: "target_height", min: 1, max: 16384, step: 1, unit: "pixels" },
    { name: "padding", min: 0, max: 4096, step: 1, unit: "pixels" },
    { name: "mask_threshold", min: 0, max: 1, step: 0.001, unit: "normalized" },
    { name: "empty_mask_mode", values: ["preserve", "full_image"] },
    { name: "upscale_method", values: ["auto", "nearest-exact", "bilinear", "area", "bicubic", "lanczos", "bislerp"] },
    { name: "crop_shape", values: ["target_ratio", "square", "tight"] },
    { name: "scale_factor", min: 0.01, max: 16, step: 0.05, unit: "ratio" },
    { name: "scale_policy", values: ["both", "upscale_only", "downscale_only"] },
    { name: "size_multiple", min: 1, max: 256, step: 1, unit: "pixels" },
    { name: "blend_mode", values: ["mask", "crop"] },
    { name: "feather", min: 0, max: 256, step: 1, unit: "pixels" },
    { name: "blend_opacity", min: 0, max: 1, step: 0.01, unit: "normalized" },
    { name: "mask_mode", values: ["binary", "soft"] },
    { name: "input_layout", values: ["canvas", "content"] },
    { name: "batch_order", values: ["repeat_batch", "repeat_each"] },
];

const PRESETS = [
    { values: { mode: "crop", resize_mode: "target", crop_shape: "square", target_width: 1024, target_height: 1024, scale_policy: "both", size_multiple: 8, empty_mask_mode: "preserve" } },
    { values: { mode: "crop", resize_mode: "target", crop_shape: "target_ratio", target_width: 1536, target_height: 1024, scale_policy: "both", size_multiple: 8, empty_mask_mode: "preserve" } },
    { values: { mode: "crop", resize_mode: "longest_side", crop_shape: "tight", target_width: 1024, scale_policy: "both", size_multiple: 8, empty_mask_mode: "preserve" } },
    { values: { mode: "crop", resize_mode: "scale", crop_shape: "tight", scale_factor: 2, scale_policy: "upscale_only", size_multiple: 8, empty_mask_mode: "preserve" } },
    { values: { mode: "crop", resize_mode: "none", crop_shape: "tight", size_multiple: 1, empty_mask_mode: "preserve" } },
    { values: { mode: "merge", blend_mode: "mask", feather: 16, blend_opacity: 1 } },
    { values: { mode: "merge", blend_mode: "crop", feather: 16, blend_opacity: 1 } },
    { values: { mode: "crop", resize_mode: "longest_side", crop_shape: "tight", target_width: 1024, scale_policy: "both", size_multiple: 8, empty_mask_mode: "full_image" } },
];

function getWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function visibleFields(values) {
    if (values.mode === "merge") return new Set(["mode", "upscale_method", "blend_mode", "feather", "blend_opacity", "input_layout", "batch_order"]);
    const visible = new Set(["mode", "resize_mode", "padding", "mask_threshold", "empty_mask_mode", "crop_shape", "mask_mode"]);
    if (values.resize_mode !== "none") {
        visible.add("upscale_method");
        visible.add("scale_policy");
        visible.add("size_multiple");
    }
    if (values.resize_mode === "target" || values.resize_mode === "longest_side" || values.crop_shape === "target_ratio") visible.add("target_width");
    if (values.resize_mode === "target" || values.crop_shape === "target_ratio") visible.add("target_height");
    if (values.resize_mode === "scale") visible.add("scale_factor");
    return visible;
}

function mainFields(values) {
    const primary = values.mode === "merge"
        ? ["mode", "blend_mode", "feather"]
        : ["mode", "crop_shape", "padding", "resize_mode", "target_width", "target_height", "scale_factor"];
    const active = visibleFields(values);
    return new Set(primary.filter((name) => active.has(name)));
}

function readValues(node) {
    return Object.fromEntries(FIELDS.map(({ name }) => [name, getWidget(node, name)?.value]));
}

function inputIndex(node, name) {
    return node.inputs?.findIndex((slot) => slot.name === name || slot.widget?.name === name) ?? -1;
}

function graphLink(graph, id) {
    if (id === null || id === undefined) return null;
    return graph?.getLink?.(id) ?? graph?.links?.get?.(id) ?? graph?.links?.[id] ?? null;
}

function inputLink(node, name) {
    // LiteGraph constructs nodes before graph.add; modern getInputLink requires an attached graph.
    if (!node.graph) return null;
    const index = inputIndex(node, name);
    if (index < 0) return null;
    return node.getInputLink?.(index) ?? graphLink(node.graph, node.inputs[index].link);
}

function isLinked(node, name) {
    const index = inputIndex(node, name);
    return index >= 0 && (inputLink(node, name) !== null || node.inputs[index].link != null);
}

function withGraphChange(node, operation) {
    node.graph?.beforeChange?.();
    try { return operation(); }
    finally { node.graph?.afterChange?.(); }
}

function cropSource(node) {
    const visited = new Set([node.id]);
    let link = inputLink(node, "crop_info");
    while (link) {
        const source = node.graph?.getNodeById?.(link.origin_id);
        if (!source || visited.has(source.id)) return null;
        visited.add(source.id);
        if (link.origin_slot !== 2 || source.outputs?.[2]?.type !== "CROP_INFO") return null;
        if (source.type === "MagicMaskCropResize" ||
            (source.type === NODE_NAME && getWidget(source, "mode")?.value === "crop")) {
            return source.outputs?.[3]?.type === "BOOLEAN" ? source : null;
        }
        if (source.type !== NODE_NAME || getWidget(source, "mode")?.value !== "merge") return null;
        link = inputLink(source, "crop_info");
    }
    return null;
}

function migrateAuxiliaryOutputs(node) {
    const source = cropSource(node);
    if (!source) return;
    for (const index of [2, 3]) {
        for (const id of [...(node.outputs?.[index]?.links ?? [])]) {
            const link = graphLink(node.graph, id);
            const target = link && node.graph?.getNodeById?.(link.target_id);
            if (!target || target === source || target === node) continue;
            source.connect?.(index, target, link.target_slot);
        }
    }
}

function syncPorts(node, userChange = false) {
    const values = readValues(node);
    const merge = values.mode === "merge";
    if (userChange && node._magicMaskEditMode !== values.mode && isLinked(node, "mask")) {
        node.disconnectInput?.(inputIndex(node, "mask"));
        node._magicMaskEditNotice = text("modeSwitchNotice");
    }
    node._magicMaskEditMode = values.mode;
    const infoIndex = inputIndex(node, "crop_info");
    if (merge && infoIndex < 0) node.addInput?.("crop_info", "CROP_INFO");
    else if (!merge && infoIndex >= 0) node.removeInput?.(infoIndex);
    if (merge) {
        migrateAuxiliaryOutputs(node);
        // Only remove trailing slots: output 0/1 and connected compatibility slots retain their indices.
        for (let index = (node.outputs?.length ?? 0) - 1; index >= 2; index--) {
            const slot = node.outputs[index];
            if (slot.links?.length || index < node.outputs.length - 1) {
                slot._magicMaskEditLegacy = true;
            } else node.removeOutput?.(index);
        }
    } else {
        const outputs = [["image", "IMAGE"], ["mask", "MASK"], ["crop_info", "CROP_INFO"], ["mask_empty", "BOOLEAN"]];
        for (let index = node.outputs?.length ?? 0; index < outputs.length; index++) node.addOutput?.(...outputs[index]);
        for (const slot of node.outputs ?? []) delete slot._magicMaskEditLegacy;
    }
    updateNodeText(node);
}

function localizeStatus(status, language) {
    if (normalizeLanguage(language) !== "en") return status;
    return status
        .replace(/保留原图，跳过编辑分支/g, "Source preserved; edit branch skipped")
        .replace(/回贴保留原图/g, "Source preserved on merge")
        .replace(/整图编辑/g, "Full image edit")
        .replace(/空遮罩：/g, "Empty mask: ")
        .replace(/裁切/g, "Crop").replace(/回贴/g, "Merge")
        .replace(/框 /g, "Bounds ").replace(/(\d+) 张/g, "$1 images").replace(/羽化 /g, "Feather ");
}

// Text refresh is intentionally separate from syncPorts: changing language must never edit links.
function updateNodeText(node, language = getLanguage()) {
    const merge = getWidget(node, "mode")?.value === "merge";
    for (const field of FIELDS) {
        const widget = getWidget(node, field.name);
        if (widget) widget.label = text(field.name, language);
    }
    const settings = node.widgets?.find((widget) => widget._magicMaskEditSettings);
    if (settings) settings.name = text("settingsButton", language);
    const image = node.inputs?.[inputIndex(node, "image")];
    const mask = node.inputs?.[inputIndex(node, "mask")];
    if (image) {
        image.label = text(merge ? "editedImage" : "source", language);
        image.tooltip = text(merge ? "editTooltip" : "sourceTooltip", language);
    }
    if (mask) {
        mask.label = text(merge ? "blendMask" : "sourceMask", language);
        mask.tooltip = text(merge ? "blendMaskTooltip" : "sourceMaskTooltip", language);
    }
    const info = node.inputs?.[inputIndex(node, "crop_info")];
    if (info) {
        info.label = text("info", language);
        info.tooltip = text("infoInputTooltip", language);
    }
    if (node.outputs?.[0]) {
        node.outputs[0].label = text(merge ? "fullImage" : "cropImage", language);
        node.outputs[0].tooltip = text(merge ? "fullImageTooltip" : "cropImageTooltip", language);
    }
    if (node.outputs?.[1]) {
        node.outputs[1].label = text(merge ? "blendRegion" : "cropMask", language);
        node.outputs[1].tooltip = text(merge ? "blendRegionTooltip" : "cropMaskTooltip", language);
    }
    if (!merge && node.outputs?.[2]) {
        node.outputs[2].label = text("info", language);
        node.outputs[2].tooltip = text("infoOutputTooltip", language);
    }
    if (!merge && node.outputs?.[3]) {
        node.outputs[3].label = text("empty", language);
        node.outputs[3].tooltip = text("emptyTooltip", language);
    }
    for (const [index, slot] of (node.outputs ?? []).entries()) {
        if (!slot._magicMaskEditLegacy) continue;
        slot.label = `${text(index === 2 ? "info" : "empty", language)} · ${text("legacy", language)}`;
        slot.tooltip = text("legacyTooltip", language);
    }
    if (node._magicMaskEditNotice) node._magicMaskEditNotice = text("modeSwitchNotice", language);
    if (node._magicMaskEditStatusRaw) node._magicMaskEditStatus = localizeStatus(node._magicMaskEditStatusRaw, language);
    node.setDirtyCanvas?.(true, true);
}

function setWidgetVisible(widget, visible) {
    if (!widget) return;
    if (widget.type?.startsWith("converted-widget")) return;
    if (!widget._magicMaskEditDisplay) {
        widget._magicMaskEditDisplay = { type: widget.type, computeSize: widget.computeSize, hidden: widget.hidden };
    }
    const original = widget._magicMaskEditDisplay;
    widget.type = visible ? original.type : HIDDEN_WIDGET;
    widget.hidden = visible ? original.hidden : true;
    widget.computeSize = visible ? original.computeSize : () => [0, -4];
}

function refreshWidgets(node, resize = true) {
    const visible = mainFields(readValues(node));
    for (const field of FIELDS) setWidgetVisible(getWidget(node, field.name), visible.has(field.name) || isLinked(node, field.name));
    if (resize && node.computeSize && node.setSize) {
        const size = node.computeSize();
        size[0] = Math.max(node.size?.[0] || 0, size[0], 300);
        node.setSize(size);
    }
    node.setDirtyCanvas?.(true, true);
}

function setupNode(node) {
    for (const name of ["mode", "resize_mode", "crop_shape"]) {
        const widget = getWidget(node, name);
        if (!widget || widget._magicMaskEditCallback) continue;
        const callback = widget.callback;
        widget._magicMaskEditCallback = true;
        widget.callback = function (...args) {
            const result = callback?.apply(this, args);
            if (name === "mode" && !app.configuringGraph && node._magicMaskEditMode !== widget.value) {
                withGraphChange(node, () => syncPorts(node, true));
            }
            refreshWidgets(node);
            return result;
        };
    }
    if (!node.widgets?.some((widget) => widget._magicMaskEditSettings)) {
        const button = node.addWidget("button", text("settingsButton"), null, () => showSettings(node));
        button._magicMaskEditSettings = true;
        button.serialize = false;
        button.options = { ...button.options, serialize: false };
    }
    if (!node._magicMaskEditLocaleListener) {
        node._magicMaskEditLocaleListener = (event) => {
            if (event.type === "storage" && event.key !== LANGUAGE_STORAGE_KEY) return;
            const language = normalizeLanguage(event.detail?.language ?? (event.type === "storage" ? event.newValue : getLanguage()));
            updateNodeText(node, language);
            node._magicMaskEditModalLanguageUpdate?.(language);
        };
        window.addEventListener("magic-language-change", node._magicMaskEditLocaleListener);
        window.addEventListener("storage", node._magicMaskEditLocaleListener);
    }
    updateNodeText(node);
    refreshWidgets(node, false);
}

function element(tag, content, className) {
    const result = document.createElement(tag);
    if (content !== undefined) result.textContent = content;
    if (className) result.className = className;
    return result;
}

function showSettings(node) {
    node._magicMaskEditModalClose?.();
    const previousFocus = document.activeElement;
    const id = ++dialogId;
    let language = getLanguage();
    const bindings = [];
    const bind = (target, key, attribute) => {
        bindings.push(() => {
            const value = typeof key === "function" ? key(language) : text(key, language);
            if (attribute) target.setAttribute(attribute, value);
            else target.textContent = value;
        });
        return target;
    };
    const translated = (tag, key, className) => bind(element(tag, undefined, className), key);
    const overlay = element("div", undefined, "magic-mask-edit-overlay");
    // The shared language switcher must not guess translations for this self-localized panel.
    overlay.setAttribute("data-magic-i18n", "manual");
    const panel = element("form", undefined, "magic-mask-edit-dialog");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", `magic-mask-edit-title-${id}`);
    const header = element("header", undefined, "magic-mask-edit-header");
    const brand = element("div", undefined, "magic-mask-edit-brand");
    const icon = element("span", "✂", "magic-mask-edit-brand-icon");
    icon.setAttribute("aria-hidden", "true");
    const heading = element("div", undefined, "magic-mask-edit-heading");
    const title = element("h2", undefined, "magic-mask-edit-title");
    bind(title, (locale) => `Magic Mask Edit · ${text("title", locale)}`);
    title.id = `magic-mask-edit-title-${id}`;
    heading.append(title, translated("p", "subtitle", "magic-mask-edit-subtitle"));
    brand.append(icon, heading);
    const closeButton = element("button", "×", "magic-mask-edit-close");
    closeButton.type = "button";
    bind(closeButton, "close", "aria-label");
    bind(closeButton, "close", "title");
    header.append(brand, closeButton);
    panel.append(header);
    const body = element("div", undefined, "magic-mask-edit-body");
    const modeSection = element("section", undefined, "magic-mask-edit-mode-section");
    const modeLabel = translated("div", "modeLabel", "magic-mask-edit-eyebrow");
    const modeButtons = element("div", undefined, "magic-mask-edit-mode-buttons");
    modeButtons.setAttribute("role", "group");
    bind(modeButtons, "modeLabel", "aria-label");
    const buttons = new Map();
    for (const mode of ["crop", "merge"]) {
        const button = element("button", undefined, "magic-mask-edit-mode-button");
        button.type = "button";
        button.setAttribute("data-mode", mode);
        const symbol = element("span", mode === "crop" ? "✂" : "↗", "magic-mask-edit-mode-icon");
        symbol.setAttribute("aria-hidden", "true");
        button.append(symbol, translated("span", mode));
        bind(button, mode, "aria-label");
        buttons.set(mode, button);
        modeButtons.append(button);
    }
    const modeHint = element("p", undefined, "magic-mask-edit-mode-hint");
    modeSection.append(modeLabel, modeButtons, modeHint);
    body.append(modeSection);

    const flow = element("div", undefined, "magic-mask-edit-flow");
    for (const [index, key] of ["source", "crop", "editModel", "merge"].entries()) {
        if (index) {
            const arrow = element("span", "→", "magic-mask-edit-flow-arrow");
            arrow.setAttribute("aria-hidden", "true");
            flow.append(arrow);
        }
        const step = translated("span", key, "magic-mask-edit-flow-step");
        if (key === "crop" || key === "merge") step.setAttribute("data-step", key);
        flow.append(step);
    }
    const guide = element("div", undefined, "magic-mask-edit-guide");
    guide.append(flow, translated("p", "connectionHint", "magic-mask-edit-flow-help"));
    body.append(guide);

    const presetSection = element("section", undefined, "magic-mask-edit-preset-section");
    const presetHeading = element("div", undefined, "magic-mask-edit-section-heading");
    const presetLabel = translated("label", "preset");
    presetLabel.htmlFor = `magic-mask-edit-${id}-preset`;
    presetHeading.append(presetLabel, translated("span", "presetHint", "magic-mask-edit-quiet"));
    const preset = element("select", undefined, "magic-mask-edit-control magic-mask-edit-preset");
    preset.id = presetLabel.htmlFor;
    preset.setAttribute("data-control", "preset");
    bind(preset, "preset", "aria-label");
    const currentOption = translated("option", "currentSettings");
    currentOption.value = "";
    preset.append(currentOption);
    PRESETS.forEach((item, index) => {
        const option = translated("option", `preset.${index}`);
        option.value = String(index);
        preset.append(option);
    });
    presetSection.append(presetHeading, preset);
    body.append(presetSection);

    const basicSection = element("section", undefined, "magic-mask-edit-section magic-mask-edit-basic");
    const basicTitle = element("h3", undefined, "magic-mask-edit-section-title");
    const basicGrid = element("div", undefined, "magic-mask-edit-grid");
    basicSection.append(basicTitle, basicGrid);
    const advanced = element("details", undefined, "magic-mask-edit-section magic-mask-edit-advanced");
    const advancedSummary = element("summary", undefined, "magic-mask-edit-advanced-summary");
    const advancedCount = element("span", undefined, "magic-mask-edit-count");
    const chevron = element("span", "⌄", "magic-mask-edit-chevron");
    chevron.setAttribute("aria-hidden", "true");
    advancedSummary.append(translated("span", "advanced"), advancedCount, chevron);
    const advancedGrid = element("div", undefined, "magic-mask-edit-grid magic-mask-edit-advanced-grid");
    advanced.append(advancedSummary, advancedGrid);
    body.append(basicSection, advanced);

    const notices = element("div", undefined, "magic-mask-edit-notices");
    const linkedHint = translated("p", "linkedHint", "magic-mask-edit-linked-hint");
    const modeWarning = translated("p", "modeWarning", "magic-mask-edit-mode-warning");
    notices.append(linkedHint, modeWarning);
    body.append(notices);

    const controls = new Map();
    const rows = new Map();
    const current = readValues(node);
    const basicFields = new Set(["resize_mode", "target_width", "target_height", "padding", "crop_shape", "scale_factor", "blend_mode", "feather", "blend_opacity"]);
    for (const field of FIELDS) {
        const widget = getWidget(node, field.name);
        if (!widget) continue;
        const row = element("div", undefined, "magic-mask-edit-field");
        row.setAttribute("data-field", field.name);
        if (["resize_mode", "blend_mode"].includes(field.name)) row.classList.add("magic-mask-edit-wide");
        const label = element("label", undefined, "magic-mask-edit-field-label");
        label.htmlFor = `magic-mask-edit-${id}-${field.name}`;
        bind(label, (locale) => {
            const key = field.name === "target_width" && controls.get("resize_mode")?.value === "longest_side" ? "longestSide" : field.name;
            return text(key, locale) + (isLinked(node, field.name) ? ` · ${text("linked", locale)}` : "");
        });
        const input = element(field.values ? "select" : "input", undefined, "magic-mask-edit-control");
        input.id = label.htmlFor;
        input.name = field.name;
        input.setAttribute("data-control", field.name);
        if (field.values) {
            for (const value of field.values) {
                const key = field.name === "mode" ? value : `option.${value}`;
                const option = translated("option", key);
                option.value = value;
                input.append(option);
            }
        } else {
            input.type = "number";
            input.min = widget.options?.min ?? field.min;
            input.max = widget.options?.max ?? field.max;
            // Comfy's float step is a spinner increment; HTML bases validity on min.
            // min=.01 + step=.05 would reject the normal 1x and 2x scale values.
            input.step = field.name === "scale_factor" ? "any" : field.step;
            input.required = true;
        }
        input.value = current[field.name];
        const controlWrap = element("div", undefined, "magic-mask-edit-control-wrap");
        controlWrap.append(input);
        if (field.unit) {
            input.classList.add("magic-mask-edit-with-unit");
            const unit = translated("span", field.unit, "magic-mask-edit-unit");
            unit.setAttribute("aria-hidden", "true");
            controlWrap.append(unit);
        }
        row.append(label, controlWrap);
        if (field.name !== "mode") {
            const helper = translated("p", `help.${field.name}`, "magic-mask-edit-field-help");
            helper.id = `${input.id}-help`;
            input.setAttribute("aria-describedby", helper.id);
            row.append(helper);
        } else {
            row.hidden = true;
            input.tabIndex = -1;
            input.setAttribute("aria-hidden", "true");
        }
        controls.set(field.name, input);
        rows.set(field.name, row);
        (field.name === "mode" ? modeSection : basicFields.has(field.name) ? basicGrid : advancedGrid).append(row);
    }
    const updateLanguage = (nextLanguage = language) => {
        language = normalizeLanguage(nextLanguage);
        panel.setAttribute("lang", language === "en" ? "en" : "zh-CN");
        for (const refresh of bindings) refresh();
        const merge = controls.get("mode")?.value === "merge";
        modeHint.textContent = text(merge ? "mergeHint" : "cropHint", language);
        basicTitle.textContent = text(merge ? "basicMerge" : "basicCrop", language);
        const count = [...rows].filter(([name, row]) => name !== "mode" && !basicFields.has(name) && !row.hidden).length;
        advancedCount.textContent = text("advancedCount", language, { count });
    };
    const updateForm = () => {
        const values = Object.fromEntries([...controls].map(([name, input]) => [name, input.value]));
        const visible = visibleFields(values);
        for (const [name, row] of rows) {
            const active = visible.has(name);
            row.hidden = !active || name === "mode";
            row.classList.toggle("magic-mask-edit-linked", isLinked(node, name));
            controls.get(name).disabled = !active || isLinked(node, name);
        }
        for (const [mode, button] of buttons) {
            button.setAttribute("aria-pressed", String(values.mode === mode));
            button.disabled = isLinked(node, "mode");
        }
        for (const step of flow.querySelectorAll("[data-step]")) step.classList.toggle("magic-mask-edit-current-step", step.getAttribute("data-step") === values.mode);
        linkedHint.hidden = ![...controls.keys()].some((name) => visible.has(name) && isLinked(node, name));
        modeWarning.hidden = values.mode === current.mode || !isLinked(node, "mask");
        updateLanguage();
    };
    for (const name of ["mode", "resize_mode", "crop_shape"]) controls.get(name)?.addEventListener("change", updateForm);
    for (const [mode, button] of buttons) button.addEventListener("click", () => {
        const input = controls.get("mode");
        if (!input || input.disabled) return;
        input.value = mode;
        updateForm();
    });
    preset.addEventListener("change", () => {
        if (preset.value === "") return;
        const selected = PRESETS[Number(preset.value)];
        if (!selected) return;
        for (const [name, value] of Object.entries(selected.values)) {
            const input = controls.get(name);
            if (input && !isLinked(node, name)) input.value = value;
        }
        updateForm();
    });
    updateForm();
    panel.append(body);
    const footer = element("footer", undefined, "magic-mask-edit-footer");
    const footerHint = translated("span", "draftHint", "magic-mask-edit-footer-hint");
    const actions = element("div", undefined, "magic-mask-edit-actions");
    const cancel = translated("button", "cancel", "magic-mask-edit-button magic-mask-edit-cancel");
    cancel.type = "button";
    const apply = translated("button", "apply", "magic-mask-edit-button magic-mask-edit-apply");
    apply.type = "submit";
    actions.append(cancel, apply);
    footer.append(footerHint, actions);
    panel.append(footer);
    overlay.append(panel);
    updateLanguage();

    const close = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (node._magicMaskEditModalClose === close) delete node._magicMaskEditModalClose;
        if (node._magicMaskEditModalLanguageUpdate === updateLanguage) delete node._magicMaskEditModalLanguageUpdate;
        if (node._magicMaskEditModalRefresh === updateForm) delete node._magicMaskEditModalRefresh;
        if (previousFocus?.isConnected) previousFocus.focus?.();
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === "Tab") {
            const focusable = [...panel.querySelectorAll("button,input,select,summary")].filter((item) => item.offsetParent !== null && !item.disabled && item.tabIndex !== -1);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    };
    closeButton.addEventListener("click", close);
    cancel.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        if (event.target === overlay) close();
    });
    panel.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!panel.reportValidity()) return;
        withGraphChange(node, () => {
            for (const [name, input] of controls) {
                const widget = getWidget(node, name);
                if (!widget || isLinked(node, name)) continue;
                if (input.type === "number") {
                    const value = input.valueAsNumber;
                    // Hidden fields may contain an abandoned invalid draft; keep their previous value.
                    if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) continue;
                    widget.value = value;
                } else widget.value = input.value;
            }
            syncPorts(node, true);
            refreshWidgets(node);
        });
        close();
    });
    node._magicMaskEditModalClose = close;
    node._magicMaskEditModalLanguageUpdate = updateLanguage;
    node._magicMaskEditModalRefresh = updateForm;
    document.addEventListener("keydown", onKeyDown, true);
    document.body.append(overlay);
    buttons.get(current.mode)?.focus();
}

app.registerExtension({
    name: "Magic.MaskEdit",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (...args) {
            const size = computeSize.apply(this, args);
            return [size[0], size[1] + 18];
        };
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = created?.apply(this, args);
            setupNode(this);
            this._magicMaskEditMode = getWidget(this, "mode")?.value;
            if (!app.configuringGraph) syncPorts(this);
            refreshWidgets(this);
            return result;
        };
        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const result = configured?.apply(this, args);
            setupNode(this);
            // Link endpoints are not fully available until the entire graph is restored.
            this._magicMaskEditMode = getWidget(this, "mode")?.value;
            refreshWidgets(this);
            return result;
        };
        const graphConfigured = nodeType.prototype.onGraphConfigured;
        nodeType.prototype.onGraphConfigured = function (...args) {
            const result = graphConfigured?.apply(this, args);
            withGraphChange(this, () => syncPorts(this));
            refreshWidgets(this);
            return result;
        };
        const connectionsChanged = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (...args) {
            const result = connectionsChanged?.apply(this, args);
            if (args[0] === 1 && args[2] && this.inputs?.[args[1]]?.name === "mask") delete this._magicMaskEditNotice;
            if (!app.configuringGraph) refreshWidgets(this);
            this._magicMaskEditModalRefresh?.();
            return result;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message, ...args) {
            const result = executed?.call(this, message, ...args);
            const status = message?.mask_edit_status;
            if (status) {
                delete this._magicMaskEditNotice;
                this._magicMaskEditStatusRaw = Array.isArray(status) ? status.join(" · ") : String(status);
                this._magicMaskEditStatus = localizeStatus(this._magicMaskEditStatusRaw, getLanguage());
                this.setDirtyCanvas?.(true, true);
            }
            return result;
        };
        const draw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (context, ...args) {
            const result = draw?.call(this, context, ...args);
            if (!this.flags?.collapsed && (this._magicMaskEditStatus || this._magicMaskEditNotice)) {
                context.save();
                context.font = "11px sans-serif";
                context.fillStyle = "#b7d5ec";
                let status = this._magicMaskEditNotice || this._magicMaskEditStatus;
                while (status.length && context.measureText(status).width > this.size[0] - 20) status = status.slice(0, -1);
                context.fillText(status, 10, this.size[1] - 6);
                context.restore();
            }
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function (...args) {
            this._magicMaskEditModalClose?.();
            if (this._magicMaskEditLocaleListener) {
                window.removeEventListener("magic-language-change", this._magicMaskEditLocaleListener);
                window.removeEventListener("storage", this._magicMaskEditLocaleListener);
                delete this._magicMaskEditLocaleListener;
            }
            return removed?.apply(this, args);
        };
    },
});
