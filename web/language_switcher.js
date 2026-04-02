import { app } from "../../scripts/app.js";

/**
 * Magic Assistant Language Switcher
 * 语言切换悬浮球 - 支持中英文切换
 * 
 * 这是一个翻译外挂系统，不修改节点源文件
 * 通过拦截DOM操作和文本设置来实现动态翻译
 */

const STORAGE_KEY_LANGUAGE = "magic_assistant_language";
const DEFAULT_LANGUAGE = "zh"; // "zh" 中文, "en" 英文

// 节点翻译映射表 - Magic Power LoRA Loader
const loraLoaderTranslations = {
    // 底部按钮
    "➕ 添加 Lora": { zh: "➕ 添加 Lora", en: "➕ Add Lora" },
    "⚙️设置": { zh: "⚙️设置", en: "⚙️Settings" },
    "📁+": { zh: "📁+", en: "📁+" },
    "📂预设": { zh: "📂预设", en: "📂Preset" },
    
    // 编辑触发词弹窗
    "编辑触发词": { zh: "编辑触发词", en: "Edit Trigger Words" },
    "使用触发词时需要将tags_output连接出去，可以连到文本框、clip框等等": { zh: "使用触发词时需要将tags_output连接出去，可以连到文本框、clip框等等", en: "When using trigger words, connect tags_output to text boxes, clip boxes, etc." },
    "输入标签，用逗号分隔...": { zh: "输入标签，用逗号分隔...", en: "Enter tags, separated by commas..." },
    "🔍 获取现成tag": { zh: "🔍 获取现成tag", en: "🔍 Fetch Existing Tags" },
    "确定": { zh: "确定", en: "Confirm" },
    "确认": { zh: "确认", en: "Confirm" },
    "取消": { zh: "取消", en: "Cancel" },
    "没有获取到现成的tag": { zh: "没有获取到现成的tag", en: "No existing tags found" },
    
    // 编辑LoRA内容弹窗
    "编辑 LoRA 内容:": { zh: "编辑 LoRA 内容:", en: "Edit LoRA Content:" },
    "删除": { zh: "删除", en: "Delete" },
    "保存": { zh: "保存", en: "Save" },
    "确定要删除这个 LoRA 及其所有相关文件吗？此操作不可恢复！": { zh: "确定要删除这个 LoRA 及其所有相关文件吗？此操作不可恢复！", en: "Are you sure you want to delete this LoRA and all related files? This action cannot be undone!" },
    "删除成功": { zh: "删除成功", en: "Delete successful" },
    "删除失败": { zh: "删除失败", en: "Delete failed" },
    "无预览图": { zh: "无预览图", en: "No Preview Image" },
    
    // Tab标签
    "触发词文件(txt)": { zh: "触发词文件(txt)", en: "Trigger Words File (txt)" },
    "官网介绍文档(json)": { zh: "官网介绍文档(json)", en: "Official Info Document (json)" },
    "介绍文件(log)": { zh: "介绍文件(log)", en: "Info File (log)" },
    
    // 保存位置对话框
    "选择保存位置": { zh: "选择保存位置", en: "Select Save Location" },
    "请选择要将修改内容保存到哪里。您也可以选择同时保存到两个位置。": { zh: "请选择要将修改内容保存到哪里。您也可以选择同时保存到两个位置。", en: "Please select where to save the modified content. You can also choose to save to both locations." },
    "保存位置": { zh: "保存位置", en: "Save Location" },
    "同层级": { zh: "同层级", en: "Same Directory" },
    "magicloradate子目录": { zh: "magicloradate子目录", en: "magicloradate Subdirectory" },
    "同时保存": { zh: "同时保存", en: "Save to Both" },
    
    // 爬取信息弹窗
    "爬取 LoRA 信息": { zh: "爬取 LoRA 信息", en: "Fetch LoRA Information" },
    "爬取信息": { zh: "爬取信息", en: "Fetch Info" },
    "下载选项": { zh: "下载选项", en: "Download Options" },
    "触发词文件 (.txt)": { zh: "触发词文件 (.txt)", en: "Trigger Words File (.txt)" },
    "模型介绍信息 (.json)": { zh: "模型介绍信息 (.json)", en: "Model Info (.json)" },
    "预览图像": { zh: "预览图像", en: "Preview Image" },
    "默认权重下载 (.log)": { zh: "默认权重下载 (.log)", en: "Default Weight (.log)" },
    "保存路径": { zh: "保存路径", en: "Save Path" },
    "保存到 LoRA 同目录下": { zh: "保存到 LoRA 同目录下", en: "Save to LoRA Directory" },
    "保存到 magicloradate 子文件夹": { zh: "保存到 magicloradate 子文件夹", en: "Save to magicloradate Subfolder" },
    "开始爬取": { zh: "开始爬取", en: "Start Fetching" },
    "爬取中...": { zh: "爬取中...", en: "Fetching..." },
    "爬取成功！内容已自动填入编辑框。": { zh: "爬取成功！内容已自动填入编辑框。", en: "Fetch successful! Content has been automatically filled into the editor." },
    "爬取失败": { zh: "爬取失败", en: "Fetch failed" },
    
    // 添加Lora弹窗
    "添加 Lora": { zh: "添加 Lora", en: "Add Lora" },
    "全部": { zh: "全部", en: "All" },
    "取消全部": { zh: "取消全部", en: "Cancel All" },
    "根目录": { zh: "根目录", en: "Root Directory" },
    "🔍 搜索当前目录...（如需全部搜索请打开“全部”开关）": { zh: "🔍 搜索当前目录...（如需全部搜索请打开“全部”开关）", en: "🔍 Search current directory... (Open 'All' switch for full search)" },
    "自动添加已获取的触发词": { zh: "自动添加已获取的触发词", en: "Auto-add fetched trigger words" },
    "已选择 0 个 LoRA": { zh: "已选择 0 个 LoRA", en: "0 LoRAs selected" },
    "已选择": { zh: "已选择", en: "selected" },
    "个 LoRA": { zh: "个 LoRA", en: " LoRAs" },
    "添加选中 LoRA": { zh: "添加选中 LoRA", en: "Add Selected LoRAs" },
    "关闭": { zh: "关闭", en: "Close" },
    "No Image": { zh: "无图片", en: "No Image" },
    
    // 预设弹窗
    "LoRA预设": { zh: "LoRA预设", en: "LoRA Presets" },
    "刷新": { zh: "刷新", en: "Refresh" },
    "暂无预设": { zh: "暂无预设", en: "No presets available" },
    "个LoRA": { zh: "个LoRA", en: " LoRAs" },
    "发送到节点": { zh: "发送到节点", en: "Send to Node" },
    "确定要删除预设": { zh: "确定要删除预设", en: "Are you sure you want to delete preset" },
    "确定要删除预设 \"": { zh: "确定要删除预设 \"", en: "Are you sure you want to delete preset \"" },
    "\" 吗？": { zh: "\" 吗？", en: "\"?" },
    "吗？": { zh: "吗？", en: "?" },
    "加载预设失败: ": { zh: "加载预设失败: ", en: "Failed to load presets: " },
    
    // 其他提示
    "Rename:": { zh: "重命名:", en: "Rename:" },
    "Delete folder?": { zh: "删除文件夹?", en: "Delete folder?" },
    "Save Preset As:": { zh: "保存预设为:", en: "Save Preset As:" },
    "Saved!": { zh: "已保存!", en: "Saved!" },
    "备注...": { zh: "备注...", en: "Note..." },
    "输入权重:": { zh: "输入权重:", en: "Enter weight:" },
    "Error: ": { zh: "错误: ", en: "Error: " },
    "删除失败: ": { zh: "删除失败: ", en: "Deletion failed: " },
    "爬取失败: ": { zh: "爬取失败: ", en: "Fetch failed: " },
    "Upload failed: ": { zh: "上传失败: ", en: "Upload failed: " },
    "保存时发生错误：": { zh: "保存时发生错误：", en: "Error occurred while saving: " },
    " 的内容已保存到 ": { zh: " 的内容已保存到 ", en: "'s content saved to " },
    "！": { zh: "！", en: "!" },
    "部分或全部保存失败：": { zh: "部分或全部保存失败：", en: "Some or all saves failed: " },
    "\n": { zh: "\n", en: "\n" },
    
    // 保存成功消息
    "的内容已保存到": { zh: "的内容已保存到", en: " content saved to" },
    "！": { zh: "！", en: "!" },
    "文件保存成功": { zh: "文件保存成功", en: "File saved successfully" },
    "已保存到": { zh: "已保存到", en: "Saved to" },
    "和": { zh: "和", en: "and" },
    "部分或全部保存失败：": { zh: "部分或全部保存失败：", en: "Some or all saves failed: " },
    "保存时发生错误：": { zh: "保存时发生错误：", en: "Error occurred while saving: " },
    
    // 爬取相关消息
    "无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）": { zh: "无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）", en: "Unable to fetch LoRA information from Civitai (may not be uploaded or hash mismatch)" },
    "已从Civitai获取到": { zh: "已从Civitai获取到", en: "Fetched from Civitai" },
    "的信息": { zh: "的信息", en: " information" },
    "触发词已保存": { zh: "触发词已保存", en: "Trigger words saved" },
    "触发词保存失败:": { zh: "触发词保存失败:", en: "Failed to save trigger words: " },
    "介绍信息已保存": { zh: "介绍信息已保存", en: "Info saved" },
    "介绍信息保存失败:": { zh: "介绍信息保存失败:", en: "Failed to save info: " },
    "预览图像已保存": { zh: "预览图像已保存", en: "Preview image saved" },
    "预览图像保存失败": { zh: "预览图像保存失败", en: "Failed to save preview image" },
    "默认权重已保存:": { zh: "默认权重已保存:", en: "Default weight saved: " },
    "默认权重保存失败:": { zh: "默认权重保存失败:", en: "Failed to save default weight: " },
    "未找到匹配的权重信息": { zh: "未找到匹配的权重信息", en: "No matching weight information found" },
    
    // 设置弹窗
    "设置": { zh: "设置", en: "Settings" },
    "LoRA 加载模式": { zh: "LoRA 加载模式", en: "LoRA Loading Mode" },
    "自适应模式": { zh: "自适应模式", en: "Adaptive Mode" },
    "自动检测模型类型并选择合适的加载模式（SDNQ→SDNQ，INT8→动态，普通→标准）": { zh: "自动检测模型类型并选择合适的加载模式（SDNQ→SDNQ，INT8→动态，普通→标准）", en: "Automatically detect model type and select appropriate loading mode (SDNQ→SDNQ, INT8→Dynamic, Normal→Standard)" },
    "INT8 LoRA 模式": { zh: "INT8 LoRA 模式", en: "INT8 LoRA Mode" },
    "选择 INT8 量化模型的 LoRA 加载方式": { zh: "选择 INT8 量化模型的 LoRA 加载方式", en: "Select INT8 quantized model LoRA loading method" },
    "选择 INT8 量化模型的 LoRA 加载方式。如果模型不是 INT8 量化模型，建议使用默认模式。": { zh: "选择 INT8 量化模型的 LoRA 加载方式。如果模型不是 INT8 量化模型，建议使用默认模式。", en: "Select INT8 quantized model LoRA loading method. If the model is not INT8 quantized, it is recommended to use the default mode." },
    "默认模式（标准 LoRA）": { zh: "默认模式（标准 LoRA）", en: "Default Mode (Standard LoRA)" },
    "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型": { zh: "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型", en: "Use ComfyUI standard LoRA loading method, suitable for all model types" },
    "INT8 静态模式（Stochastic）": { zh: "INT8 静态模式（Stochastic）", en: "INT8 Static Mode (Stochastic)" },
    "使用随机舍入的 INT8 LoRA 适配器，适合单个或少量 LoRA，精度更高": { zh: "使用随机舍入的 INT8 LoRA 适配器，适合单个或少量 LoRA，精度更高", en: "Use stochastic rounding INT8 LoRA adapter, suitable for single or few LoRAs with higher precision" },
    "INT8 动态模式（Dynamic）": { zh: "INT8 动态模式（Dynamic）", en: "INT8 Dynamic Mode (Dynamic)" },
    "运行时动态组合多个 LoRA，适合需要频繁切换或组合多个 LoRA 的场景": { zh: "运行时动态组合多个 LoRA，适合需要频繁切换或组合多个 LoRA 的场景", en: "Dynamically compose multiple LoRAs at runtime, suitable for scenarios requiring frequent switching or combining multiple LoRAs" },
    
    // SDNQ 模式设置
    "SDNQ LoRA 模式": { zh: "SDNQ LoRA 模式", en: "SDNQ LoRA Mode" },
    "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式": { zh: "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式", en: "Select SDNQ quantized model (DiffusionPipeline) LoRA loading method" },
    "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式。如果模型不是 SDNQ 模型，建议使用默认模式。": { zh: "选择 SDNQ 量化模型（DiffusionPipeline）的 LoRA 加载方式。如果模型不是 SDNQ 模型，建议使用默认模式。", en: "Select SDNQ quantized model (DiffusionPipeline) LoRA loading method. If the model is not SDNQ, it is recommended to use the default mode." },
    "SDNQ 模式": { zh: "SDNQ 模式", en: "SDNQ Mode" },
    "使用 diffusers PEFT adapter 系统加载 LoRA，支持多个 LoRA 并行应用，适用于 SDNQ 量化模型（DiffusionPipeline）": { zh: "使用 diffusers PEFT adapter 系统加载 LoRA，支持多个 LoRA 并行应用，适用于 SDNQ 量化模型（DiffusionPipeline）", en: "Use diffusers PEFT adapter system to load LoRAs, supports parallel application of multiple LoRAs, suitable for SDNQ quantized models (DiffusionPipeline)" },

    // LoRA 串连功能相关
    "lora串接受 收到了无效数据，请确保连接自「强力 LoRA 加载器」的 lora串输出，不要接入其他文本或节点。": { zh: "lora串接受 收到了无效数据，请确保连接自「强力 LoRA 加载器」的 lora串输出，不要接入其他文本或节点。", en: "lora串接受 received invalid data. Please ensure it is connected from the lora串输出 of a Magic Power LoRA Loader, not from other text or nodes." },
    "lora串接受 收到了非 LoRA 串格式的数据，请确保连接自「强力 LoRA 加载器」的 lora串输出。": { zh: "lora串接受 收到了非 LoRA 串格式的数据，请确保连接自「强力 LoRA 加载器」的 lora串输出。", en: "lora串接受 received data that is not in LoRA chain format. Please ensure it is connected from the lora串输出 of a Magic Power LoRA Loader." },
    "链末端节点（未将 lora串输出 接到其他加载器的节点）必须连接 model 和 clip。": { zh: "链末端节点（未将 lora串输出 接到其他加载器的节点）必须连接 model 和 clip。", en: "Chain-end node (node that does not connect lora串输出 to other loaders) must connect model and clip." }
};

// 节点翻译映射表 - Magic SDNQ Loader & Sampler
const sdnqTranslations = {
    // SDNQ Loader
    "--Custom Model--": { zh: "--自定义模型--", en: "--Custom Model--" },
    "gpu=全显存(24GB+), balanced=CPU卸载(12-16GB), lowvram=顺序卸载(8GB)": { zh: "gpu=全显存(24GB+), balanced=CPU卸载(12-16GB), lowvram=顺序卸载(8GB)", en: "gpu=full VRAM (24GB+), balanced=CPU offload (12-16GB), lowvram=sequential offload (8GB)" },
    "模型未缓存时自动从 HuggingFace 下载": { zh: "模型未缓存时自动从 HuggingFace 下载", en: "Auto-download from HuggingFace when model not cached" },
    "启用 xFormers 注意力优化。未安装时会自动回退到 SDPA，不会报错": { zh: "启用 xFormers 注意力优化。未安装时会自动回退到 SDPA，不会报错", en: "Enable xFormers attention. Falls back to SDPA if not installed" },
    "大图时 VAE 分块处理省显存": { zh: "大图时 VAE 分块处理省显存", en: "VAE tiling for large images to save VRAM" },
    "连接后仅加载模型本体(~5GB)，使用此外部 CLIP，省显存": { zh: "连接后仅加载模型本体(~5GB)，使用此外部 CLIP，省显存", en: "When connected: load only transformer (~5GB) and use this external CLIP to save VRAM" },
    "连接后仅加载模型本体(~5GB)，使用此外部 VAE，省显存": { zh: "连接后仅加载模型本体(~5GB)，使用此外部 VAE，省显存", en: "When connected: load only transformer (~5GB) and use this external VAE to save VRAM" },
    "请同时连接外接 CLIP 和 VAE（仅加载本体、省显存），或两者都不连（整包加载）。不能只连其中一个。": { zh: "请同时连接外接 CLIP 和 VAE（仅加载本体、省显存），或两者都不连（整包加载）。不能只连其中一个。", en: "Connect both external CLIP and VAE (body-only, save VRAM), or connect neither (full load). Do not connect only one." },
    "xFormers 注意力 (10-45% 加速)。未安装时回退到 SDPA": { zh: "xFormers 注意力 (10-45% 加速)。未安装时回退到 SDPA", en: "xFormers attention (10-45% faster). Falls back to SDPA if not installed" },
    "torch.compile 加速 (1.8-3x)。使用 max-autotune-no-cudagraphs 避免 cudaMallocAsync 报错。首次运行需编译约 30-60 秒": { zh: "torch.compile 加速 (1.8-3x)。使用 max-autotune-no-cudagraphs 避免 cudaMallocAsync 报错。首次运行需编译约 30-60 秒", en: "torch.compile speedup (1.8-3x). Uses max-autotune-no-cudagraphs to avoid cudaMallocAsync errors. First run compiles ~30-60s" },
    "「仅加载本体」模式不支持当前模型": { zh: "「仅加载本体」模式不支持当前模型", en: "Body-only mode is not supported for this model" },
    "仅以下类型支持外接 CLIP/VAE：FLUX.2（如 Flux2Klein）、FLUX.1（如 FluxPipeline）。": { zh: "仅以下类型支持外接 CLIP/VAE：FLUX.2（如 Flux2Klein）、FLUX.1（如 FluxPipeline）。", en: "Only these types support external CLIP/VAE: FLUX.2 (e.g. Flux2Klein), FLUX.1 (e.g. FluxPipeline)." },
    "请断开 CLIP/VAE 连接以整包加载，或更换为上述模型后再使用外接 CLIP/VAE。": { zh: "请断开 CLIP/VAE 连接以整包加载，或更换为上述模型后再使用外接 CLIP/VAE。", en: "Disconnect CLIP/VAE for full-package load, or switch to one of the above models to use external CLIP/VAE." },
    // SDNQ Sampler
    "来自 Magic SDNQ Loader、LoRA Loader 或其他模型加载器": { zh: "来自 Magic SDNQ Loader、LoRA Loader 或其他模型加载器", en: "From Magic SDNQ Loader, LoRA Loader, or other model loaders" },
    "正面条件": { zh: "正面条件", en: "Positive conditioning" },
    "负面条件": { zh: "负面条件", en: "Negative conditioning" },
    "空 latent": { zh: "空 latent", en: "Empty latent" },
    "SDNQ 模式的调度器。FLUX/SD3/Qwen 用 FlowMatch; SDXL/SD1.5 用 DPMSolver/Euler": { zh: "SDNQ 模式的调度器。FLUX/SD3/Qwen 用 FlowMatch; SDXL/SD1.5 用 DPMSolver/Euler", en: "SDNQ scheduler. FLUX/SD3/Qwen: FlowMatch; SDXL/SD1.5: DPMSolver/Euler" },
    "降噪": { zh: "降噪", en: "Denoise" },
    "预览方式": { zh: "预览方式", en: "Preview" },
    "auto=自动, latent2rgb=快, taesd=慢但更清晰, none=不预览": { zh: "auto=自动, latent2rgb=快, taesd=慢但更清晰, none=不预览", en: "auto=auto, latent2rgb=fast, taesd=slower but clearer, none=no preview" },
    "采样模式": { zh: "采样模式", en: "Sample Mode" },
    "SDNQ + KSampler": { zh: "SDNQ + KSampler", en: "SDNQ + K Sampler" },
    "SDNQ=仅支持 SDNQ 模型; SDNQ + KSampler=同时兼容其他模型（自动判定）": { zh: "SDNQ=仅支持 SDNQ 模型; SDNQ + KSampler=同时兼容其他模型（自动判定）", en: "SDNQ=SDNQ models only; SDNQ + KSampler=also supports other models (auto-detect)" },
    "sampler_name": { zh: "采样器名称", en: "Sampler Name" },
    "comfy_scheduler": { zh: "官方调度器", en: "Comfy Scheduler" },
    "官方 KSampler 的采样器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）": { zh: "官方 KSampler 的采样器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）", en: "KSampler sampler (only used for non-SDNQ models in SDNQ + KSampler mode)" },
    "官方 KSampler 的调度器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）": { zh: "官方 KSampler 的调度器（仅 SDNQ + KSampler 模式下对非 SDNQ 模型生效）", en: "KSampler scheduler (only used for non-SDNQ models in SDNQ + KSampler mode)" },
    
    // SDNQ Loader 新增文本
    "首次编译需30-60秒但后续快2-3倍。12GB显存建议关闭以避免OOM": { zh: "首次编译需30-60秒但后续快2-3倍。12GB显存建议关闭以避免OOM", en: "First compilation takes 30-60s but 2-3x faster afterwards. 12GB VRAM users should disable to avoid OOM" },
    
    // SDNQ Sampler 新增文本
    "分块计算注意力，减少峰值显存但会变慢。none=禁用(快), auto=自动, 1/2=一半一半算(最省显存)": { zh: "分块计算注意力，减少峰值显存但会变慢。none=禁用(快), auto=自动, 1/2=一半一半算(最省显存)", en: "Chunk attention computation to reduce peak VRAM but slower. none=disabled (fast), auto=auto, 1/2=half-by-half (most VRAM efficient)" },
    "分块处理 KV Cache。disable=正常(快), 32=最省显存, 64=平衡, 128=较快": { zh: "分块处理 KV Cache。disable=正常(快), 32=最省显存, 64=平衡, 128=较快", en: "Chunk KV Cache processing. disable=normal (fast), 32=most VRAM efficient, 64=balanced, 128=faster" },
    "当前采样模式为「SDNQ」，但接入的不是 SDNQ 模型。\n请使用 Magic SDNQ Loader 加载模型，或将采样模式切换为「SDNQ + KSampler」以兼容其他模型。": { zh: "当前采样模式为「SDNQ」，但接入的不是 SDNQ 模型。\n请使用 Magic SDNQ Loader 加载模型，或将采样模式切换为「SDNQ + KSampler」以兼容其他模型。", en: "Current sampling mode is 'SDNQ', but the connected model is not an SDNQ model.\nPlease use Magic SDNQ Loader to load the model, or switch sampling mode to 'SDNQ + KSampler' to support other models." },
    "请连接 CLIP 文本编码到 positive 输入": { zh: "请连接 CLIP 文本编码到 positive 输入", en: "Please connect CLIP text encoding to positive input" },
    "⚠️ 分辨率较大，生成耗时较长，可尝试降低分辨率以加快速度": { zh: "⚠️ 分辨率较大，生成耗时较长，可尝试降低分辨率以加快速度", en: "⚠️ Large resolution, generation will take longer. Try reducing resolution to speed up" },
    "⚠️ 编译期间显存需求翻倍，如遇 OOM 请关闭 torch.compile": { zh: "⚠️ 编译期间显存需求翻倍，如遇 OOM 请关闭 torch.compile", en: "⚠️ VRAM requirement doubles during compilation. If OOM occurs, disable torch.compile" },
    "💡 OOM 排查建议:": { zh: "💡 OOM 排查建议:", en: "💡 OOM Troubleshooting:" },
    "1) 降低分辨率 (1024→768 或 512)": { zh: "1) 降低分辨率 (1024→768 或 512)", en: "1) Reduce resolution (1024→768 or 512)" },
    "清理显存并重试...": { zh: "清理显存并重试...", en: "Clearing VRAM and retrying..." },
    "❌ 重试后仍然 OOM": { zh: "❌ 重试后仍然 OOM", en: "❌ Still OOM after retry" },
    "💡 请尝试降低分辨率": { zh: "💡 请尝试降低分辨率", en: "💡 Please try reducing resolution" },
    "SDNQ 采样 OOM (Out of Memory)": { zh: "SDNQ 采样 OOM (Out of Memory)", en: "SDNQ Sampling OOM (Out of Memory)" },
    "✓ 重试成功（torch.compile 编译已完成）": { zh: "✓ 重试成功（torch.compile 编译已完成）", en: "✓ Retry successful (torch.compile compilation completed)" },
    "✓ 重试成功（显存已清理）": { zh: "✓ 重试成功（显存已清理）", en: "✓ Retry successful (VRAM cleared)" }
};

// 节点翻译映射表 - Magic Logic Compute
const logicComputeTranslations = {
    // 按钮文本
    "⚙️ 编辑逻辑 / Edit Logic": { zh: "⚙️ 编辑逻辑 / Edit Logic", en: "⚙️ Edit Logic" },
    "🗑️ 删除": { zh: "🗑️ 删除", en: "🗑️ Delete" },
    "💾 保存 / 新增": { zh: "💾 保存 / 新增", en: "💾 Save / New" },
    "+ 新建逻辑": { zh: "+ 新建逻辑", en: "+ New Logic" },
    
    // 弹窗标题
    "🧠 逻辑编辑器 (Magic Script)": { zh: "🧠 逻辑编辑器 (Magic Script)", en: "🧠 Logic Editor (Magic Script)" },
    
    // 输入框placeholder
    "逻辑名称 (例如: My Upscale)": { zh: "逻辑名称 (例如: My Upscale)", en: "Logic Name (e.g.: My Upscale)" },
    "在这里编写您的逻辑... (变量 w,h 会根据连接的图片自动获取)": { zh: "在这里编写您的逻辑... (变量 w,h 会根据连接的图片自动获取)", en: "Write your logic here... (Variables w, h will be automatically obtained from connected images)" },
    
    // 教程标题
    "📖 魔法脚本使用手册 (点击展开/收起)": { zh: "📖 魔法脚本使用手册 (点击展开/收起)", en: "📖 Magic Script Manual (Click to expand/collapse)" },
    "📖 魔法脚本使用手册 (点击收起)": { zh: "📖 魔法脚本使用手册 (点击收起)", en: "📖 Magic Script Manual (Click to collapse)" },
    
    // 提示信息
    "名称和代码不能为空": { zh: "名称和代码不能为空", en: "Name and code cannot be empty" },
    "保存成功！": { zh: "保存成功！", en: "Saved successfully!" },
    "确定删除 \"": { zh: "确定删除 \"", en: "Are you sure you want to delete \"" },
    "\" 吗?": { zh: "\" 吗?", en: "\"?" },
    "保存失败: ": { zh: "保存失败: ", en: "Save failed: " },
    
    // 教程内容（主要部分）
    "1. 数据来源 (哪里来的 w 和 h?)": { zh: "1. 数据来源 (哪里来的 w 和 h?)", en: "1. Data Source (Where do w and h come from?)" },
    "本节点会自动检测左侧的连接，并把它们赋值给变量：": { zh: "本节点会自动检测左侧的连接，并把它们赋值给变量：", en: "This node automatically detects connections on the left and assigns them to variables:" },
    "连接图片时": { zh: "连接图片时", en: "When image is connected" },
    "连接图片时 ": { zh: "连接图片时 ", en: "When image is connected " },
    " = 图片宽度": { zh: " = 图片宽度", en: " = image width" },
    " = 图片高度": { zh: " = 图片高度", en: " = image height" },
    "连接Latent时": { zh: "连接Latent时", en: "When latent is connected" },
    "连接Latent时 ": { zh: "连接Latent时 ", en: "When latent is connected " },
    " = Latent宽x8": { zh: " = Latent宽x8", en: " = Latent width × 8" },
    " = Latent高x8": { zh: " = Latent高x8", en: " = Latent height × 8" },
    " (自动换算为像素)": { zh: " (自动换算为像素)", en: " (automatically converted to pixels)" },
    "无连接": { zh: "无连接", en: "No connection" },
    "无连接 ": { zh: "无连接 ", en: "No connection " },
    "如果都没连": { zh: "如果都没连", en: "If nothing is connected" },
    "如果都没连，": { zh: "如果都没连，", en: "If nothing is connected, " },
    " (此时变成了纯数字计算)": { zh: " (此时变成了纯数字计算)", en: " (becomes pure number calculation)" },
    
    "2. 输入参数 (Input Variables)": { zh: "2. 输入参数 (Input Variables)", en: "2. Input Parameters (Input Variables)" },
    // 注意：JavaScript字符串中的 \" 是转义字符，实际匹配的文本是：左侧输入节点 "a" 的数值（没有反斜杠）
    " : 左侧输入节点 \"a\" 的数值 (常用于比较阈值)": { zh: " : 左侧输入节点 \"a\" 的数值 (常用于比较阈值)", en: " : Value from input node \"a\" (often used for comparison threshold)" },
    " : 左侧输入节点 \"b\" 的数值 (常用于倍率，如放大系数)": { zh: " : 左侧输入节点 \"b\" 的数值 (常用于倍率，如放大系数)", en: " : Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    "左侧输入节点 \"a\" 的数值 (常用于比较阈值)": { zh: "左侧输入节点 \"a\" 的数值 (常用于比较阈值)", en: "Value from input node \"a\" (often used for comparison threshold)" },
    "左侧输入节点 \"b\" 的数值 (常用于倍率，如放大系数)": { zh: "左侧输入节点 \"b\" 的数值 (常用于倍率，如放大系数)", en: "Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    // 添加不带空格的变体（实际文本：左侧输入节点"a"的数值，没有反斜杠）
    "左侧输入节点\"a\"的数值(常用于比较阈值)": { zh: "左侧输入节点\"a\"的数值(常用于比较阈值)", en: "Value from input node \"a\" (often used for comparison threshold)" },
    "左侧输入节点\"b\"的数值(常用于倍率,如放大系数)": { zh: "左侧输入节点\"b\"的数值(常用于倍率,如放大系数)", en: "Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    // 添加带前导空格的变体（HTML中span标签后的文本节点）
    " : 左侧输入节点\"a\"的数值(常用于比较阈值)": { zh: " : 左侧输入节点\"a\"的数值(常用于比较阈值)", en: " : Value from input node \"a\" (often used for comparison threshold)" },
    " : 左侧输入节点\"b\"的数值(常用于倍率,如放大系数)": { zh: " : 左侧输入节点\"b\"的数值(常用于倍率,如放大系数)", en: " : Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    // 添加更多变体（可能引号被规范化）
    " : 左侧输入节点 'a' 的数值 (常用于比较阈值)": { zh: " : 左侧输入节点 'a' 的数值 (常用于比较阈值)", en: " : Value from input node \"a\" (often used for comparison threshold)" },
    " : 左侧输入节点 'b' 的数值 (常用于倍率，如放大系数)": { zh: " : 左侧输入节点 'b' 的数值 (常用于倍率，如放大系数)", en: " : Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    "左侧输入节点 'a' 的数值 (常用于比较阈值)": { zh: "左侧输入节点 'a' 的数值 (常用于比较阈值)", en: "Value from input node \"a\" (often used for comparison threshold)" },
    "左侧输入节点 'b' 的数值 (常用于倍率，如放大系数)": { zh: "左侧输入节点 'b' 的数值 (常用于倍率，如放大系数)", en: "Value from input node \"b\" (often used for multiplier, e.g., upscale factor)" },
    
    "3. 常用函数 (Functions)": { zh: "3. 常用函数 (Functions)", en: "3. Common Functions (Functions)" },
    " : 绝对值。例: ": { zh: " : 绝对值。例: ", en: " : Absolute value. Example: " },
    "绝对值。例: ": { zh: "绝对值。例: ", en: "Absolute value. Example: " },
    " (判断是否接近3:2)": { zh: " (判断是否接近3:2)", en: " (check if close to 3:2)" },
    "绝对值。例: abs(w/h - 1.5) < 0.05 (判断是否接近3:2)": { zh: "绝对值。例: abs(w/h - 1.5) < 0.05 (判断是否接近3:2)", en: "Absolute value. Example: abs(w/h - 1.5) < 0.05 (check if close to 3:2)" },
    " : 取最小值。例: ": { zh: " : 取最小值。例: ", en: " : Get minimum value. Example: " },
    "取最小值。例: ": { zh: "取最小值。例: ", en: "Get minimum value. Example: " },
    " (限制不超过1024)": { zh: " (限制不超过1024)", en: " (limit not exceeding 1024)" },
    "取最小值。例: min(w, 1024) (限制不超过1024)": { zh: "取最小值。例: min(w, 1024) (限制不超过1024)", en: "Get minimum value. Example: min(w, 1024) (limit not exceeding 1024)" },
    " : 取最大值。": { zh: " : 取最大值。", en: " : Get maximum value." },
    "取最大值。": { zh: "取最大值。", en: "Get maximum value." },
    " : 四舍五入取整。": { zh: " : 四舍五入取整。", en: " : Round to nearest integer." },
    "四舍五入取整。": { zh: "四舍五入取整。", en: "Round to nearest integer." },
    
    "4. 语法与布尔值 (Syntax & Boolean)": { zh: "4. 语法与布尔值 (Syntax & Boolean)", en: "4. Syntax & Boolean (Syntax & Boolean)" },
    "基本格式：": { zh: "基本格式：", en: "Basic format: " },
    " (若命中，Bool输出True)": { zh: " (若命中，Bool输出True)", en: " (if matched, Bool outputs True)" },
    "(若命中，Bool输出True)": { zh: "(若命中，Bool输出True)", en: "(if matched, Bool outputs True)" },
    "(若命中,Bool输出True)": { zh: "(若命中,Bool输出True)", en: "(if matched, Bool outputs True)" },
    "(若命中, Bool输出True)": { zh: "(若命中, Bool输出True)", en: "(if matched, Bool outputs True)" },
    "若命中，Bool输出True": { zh: "若命中，Bool输出True", en: "if matched, Bool outputs True" },
    "若命中, Bool输出True": { zh: "若命中, Bool输出True", en: "if matched, Bool outputs True" },
    // 添加更多变体（可能文本节点被分割）
    "若命中": { zh: "若命中", en: "if matched" },
    "Bool输出True": { zh: "Bool输出True", en: "Bool outputs True" },
    "兜底格式：": { zh: "兜底格式：", en: "Fallback format: " },
    " (若执行到这，Bool输出False)": { zh: " (若执行到这，Bool输出False)", en: " (if executed here, Bool outputs False)" },
    "(若执行到这，Bool输出False)": { zh: "(若执行到这，Bool输出False)", en: "(if executed here, Bool outputs False)" },
    "(若执行到这,Bool输出False)": { zh: "(若执行到这,Bool输出False)", en: "(if executed here, Bool outputs False)" },
    "(若执行到这, Bool输出False)": { zh: "(若执行到这, Bool输出False)", en: "(if executed here, Bool outputs False)" },
    "若执行到这，Bool输出False": { zh: "若执行到这，Bool输出False", en: "if executed here, Bool outputs False" },
    "若执行到这, Bool输出False": { zh: "若执行到这, Bool输出False", en: "if executed here, Bool outputs False" },
    // 添加更多变体（可能文本节点被分割）
    "若执行到这": { zh: "若执行到这", en: "if executed here" },
    "Bool输出False": { zh: "Bool输出False", en: "Bool outputs False" },
    "强制指定：": { zh: "强制指定：", en: "Force specify: " },
    " (第三个参数控制Bool端口)": { zh: " (第三个参数控制Bool端口)", en: " (third parameter controls Bool port)" },
    "(第三个参数控制Bool端口)": { zh: "(第三个参数控制Bool端口)", en: "(third parameter controls Bool port)" },
    "第三个参数控制Bool端口": { zh: "第三个参数控制Bool端口", en: "third parameter controls Bool port" },
    
    "5. 经典案例库 (Copy & Paste)": { zh: "5. 经典案例库 (Copy & Paste)", en: "5. Classic Examples (Copy & Paste)" },
    "👉 案例 A：限制最大分辨率 (显存保护)": { zh: "👉 案例 A：限制最大分辨率 (显存保护)", en: "👉 Example A: Limit Maximum Resolution (VRAM Protection)" },
    "如果宽度超过 2048，就强制变成 2048，否则保持原样。": { zh: "如果宽度超过 2048，就强制变成 2048，否则保持原样。", en: "If width exceeds 2048, force it to 2048, otherwise keep original." },
    "👉 案例 B：比较数字 (a 和 b)": { zh: "👉 案例 B：比较数字 (a 和 b)", en: "👉 Example B: Compare Numbers (a and b)" },
    "👉 案例 B：比较数字 (a and b)": { zh: "👉 案例 B：比较数字 (a and b)", en: "👉 Example B: Compare Numbers (a and b)" },
    "不连图片，直接比较 a 和 b。如果 a 大于 b，输出 a；否则输出 b。": { zh: "不连图片，直接比较 a 和 b。如果 a 大于 b，输出 a；否则输出 b。", en: "Without connecting images, directly compare a and b. If a > b, output a; otherwise output b." },
    "不连图片，直接比较 a and b。如果 a 大于 b，输出 a；否则输出 b。": { zh: "不连图片，直接比较 a and b。如果 a 大于 b，输出 a；否则输出 b。", en: "Without connecting images, directly compare a and b. If a > b, output a; otherwise output b." },
    // 添加标点符号变体（逗号vs中文逗号，分号vs中文分号）
    "不连图片,直接比较 a and b。如果a 大于b,输出a;否则输出b。": { zh: "不连图片,直接比较 a and b。如果a 大于b,输出a;否则输出b。", en: "Without connecting images, directly compare a and b. If a > b, output a; otherwise output b." },
    "案例B: 比较数字(a and b)": { zh: "案例B: 比较数字(a and b)", en: "Example B: Compare Numbers (a and b)" },
    "👉 案例B: 比较数字(a and b)": { zh: "👉 案例B: 比较数字(a and b)", en: "👉 Example B: Compare Numbers (a and b)" },
    "案例 B：比较数字 (a 和 b)": { zh: "案例 B：比较数字 (a 和 b)", en: "Example B: Compare Numbers (a and b)" },
    "案例 B：比较数字 (a and b)": { zh: "案例 B：比较数字 (a and b)", en: "Example B: Compare Numbers (a and b)" },
    "案例 B:比较数字(a and b)": { zh: "案例 B:比较数字(a and b)", en: "Example B: Compare Numbers (a and b)" },
    "👉 案例 C：复杂的 SDXL 放大": { zh: "👉 案例 C：复杂的 SDXL 放大", en: "👉 Example C: Complex SDXL Upscale" },
    "如果是 2:3 比例且小于 1152，放大到 1152x1728。": { zh: "如果是 2:3 比例且小于 1152，放大到 1152x1728。", en: "If it's 2:3 ratio and less than 1152, upscale to 1152x1728." },
    
    // 教程中的组合文本（需要部分匹配）
    "连接图片时 w = 图片宽度, h = 图片高度": { zh: "连接图片时 w = 图片宽度, h = 图片高度", en: "When image is connected, w = image width, h = image height" },
    "连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)": { zh: "连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)", en: "When latent is connected, w = Latent width × 8, h = Latent height × 8 (automatically converted to pixels)" },
    "如果都没连，w = a, h = b (此时变成了纯数字计算)": { zh: "如果都没连，w = a, h = b (此时变成了纯数字计算)", en: "If nothing is connected, w = a, h = b (becomes pure number calculation)" },
    
    // 添加包含标签文本的完整匹配（div的完整textContent可能包含span标签内的文本）
    "image连接图片时 w = 图片宽度, h = 图片高度": { zh: "image连接图片时 w = 图片宽度, h = 图片高度", en: "When image is connected, w = image width, h = image height" },
    "连接图片时 w = 图片宽度, h = 图片高度": { zh: "连接图片时 w = 图片宽度, h = 图片高度", en: "When image is connected, w = image width, h = image height" },
    "连接图片时": { zh: "连接图片时", en: "When image is connected" },
    "latent连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)": { zh: "latent连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)", en: "When latent is connected, w = Latent width × 8, h = Latent height × 8 (automatically converted to pixels)" },
    "连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)": { zh: "连接Latent时 w = Latent宽x8, h = Latent高x8 (自动换算为像素)", en: "When latent is connected, w = Latent width × 8, h = Latent height × 8 (automatically converted to pixels)" },
    "连接Latent时": { zh: "连接Latent时", en: "When latent is connected" },
    "无连接如果都没连，w = a, h = b (此时变成了纯数字计算)": { zh: "无连接如果都没连，w = a, h = b (此时变成了纯数字计算)", en: "If nothing is connected, w = a, h = b (becomes pure number calculation)" },
    "如果都没连，w = a, h = b (此时变成了纯数字计算)": { zh: "如果都没连，w = a, h = b (此时变成了纯数字计算)", en: "If nothing is connected, w = a, h = b (becomes pure number calculation)" },
    "如果都没连": { zh: "如果都没连", en: "If nothing is connected" },
    "w": { zh: "w", en: "w" },
    "h": { zh: "h", en: "h" },
    "a": { zh: "a", en: "a" },
    "b": { zh: "b", en: "b" },
    "图片宽度": { zh: "图片宽度", en: "image width" },
    "图片高度": { zh: "图片高度", en: "image height" },
    "Latent宽x8": { zh: "Latent宽x8", en: "Latent width × 8" },
    "Latent高x8": { zh: "Latent高x8", en: "Latent height × 8" },
    "显存保护": { zh: "显存保护", en: "VRAM Protection" }
};

// 节点翻译映射表 - Magic Photopea Node
const photopeaTranslations = {
    // 按钮文本
    "🖼️ 打开图库 / Open Gallery": { zh: "🖼️ 打开图库 / Open Gallery", en: "🖼️ Open Gallery" },
    "🖌️ 打开编辑器 / Open Editor": { zh: "🖌️ 打开编辑器 / Open Editor", en: "🖌️ Open Editor" },
    
    // 错误提示
    "没有找到图片列表！(Component 'image' missing)": { zh: "没有找到图片列表！(Component 'image' missing)", en: "Image list not found! (Component 'image' missing)" },
    
    // 编辑模式按钮
    "❌ 取消全选": { zh: "❌ 取消全选", en: "❌ Deselect All" },
    "✅ 全选 (排除固定)": { zh: "✅ 全选 (排除固定)", en: "✅ Select All (Exclude Pinned)" },
    "🗑️ 删除选中": { zh: "🗑️ 删除选中", en: "🗑️ Delete Selected" },
    "退出编辑": { zh: "退出编辑", en: "Exit Edit Mode" },
    "待删:": { zh: "待删:", en: "To Delete:" },
    "张": { zh: "张", en: " images" },
    
    // 确认对话框
    "⚠️ 高能预警\n\n确定要永久删除这": { zh: "⚠️ 高能预警\n\n确定要永久删除这", en: "⚠️ Warning\n\nAre you sure you want to permanently delete these" },
    "张图片吗？\n(固定的图片很安全，不会被删除)": { zh: "张图片吗？\n(固定的图片很安全，不会被删除)", en: " images?\n(Pinned images are safe and will not be deleted)" },
    "正在删除...": { zh: "正在删除...", en: "Deleting..." },
    "确定删除": { zh: "确定删除", en: "Are you sure you want to delete" },
    "吗？": { zh: "吗？", en: "?" },
    
    // 搜索和排序
    "🔍 搜索...": { zh: "🔍 搜索...", en: "🔍 Search..." },
    "📅 默认": { zh: "📅 默认", en: "📅 Default" },
    "📅 旧图在前": { zh: "📅 旧图在前", en: "📅 Oldest First" },
    "🔤 A-Z": { zh: "🔤 A-Z", en: "🔤 A-Z" },
    "缩放": { zh: "缩放", en: "Scale" },
    
    // 管理按钮
    "✏️ 批量管理": { zh: "✏️ 批量管理", en: "✏️ Batch Manage" },
    "🧹 清空缓存": { zh: "🧹 清空缓存", en: "🧹 Clear Cache" },
    "确定要清空 clipspace 缓存吗？": { zh: "确定要清空 clipspace 缓存吗？", en: "Are you sure you want to clear clipspace cache?" },
    "✅ 清理完成！": { zh: "✅ 清理完成！", en: "✅ Cleanup completed!" },
    
    // 固定功能
    "取消固定": { zh: "取消固定", en: "Unpin" },
    "固定此图": { zh: "固定此图", en: "Pin this image" },
    
    // 重命名
    "重命名失败或文件名已存在": { zh: "重命名失败或文件名已存在", en: "Rename failed or filename already exists" },
    
    // 保存按钮
    "💾 保存并发送 (Save)": { zh: "💾 保存并发送 (Save)", en: "💾 Save and Send" },
    "⏳ 传输中...": { zh: "⏳ 传输中...", en: "⏳ Transferring..." }
};

// 节点翻译映射表 - Magic Resolution Resize & Magic Resolution
const resizeTranslations = {
    // 按钮文本
    "⚙️ 管理预设 / Manage Presets": { zh: "⚙️ 管理预设 / Manage Presets", en: "⚙️ Manage Presets" },
    "🔄 交换宽高 / Swap W/H": { zh: "🔄 交换宽高 / Swap W/H", en: "🔄 Swap W/H" },
    
    // 弹窗标题
    "📏 预设管理中心": { zh: "📏 预设管理中心", en: "📏 Preset Management Center" },
    
    // Tab标签
    "长边数值 (Long Edge)": { zh: "长边数值 (Long Edge)", en: "Long Edge Values" },
    "尺寸组合 (Dimensions)": { zh: "尺寸组合 (Dimensions)", en: "Dimension Presets" },
    
    // 输入框placeholder
    "输入数值 (e.g. 1280)": { zh: "输入数值 (e.g. 1280)", en: "Enter value (e.g. 1280)" },
    "输入名称 (e.g. SDXL_1024x1024)": { zh: "输入名称 (e.g. SDXL_1024x1024)", en: "Enter name (e.g. SDXL_1024x1024)" },
    
    // 按钮和提示
    "➕ 添加": { zh: "➕ 添加", en: "➕ Add" },
    "已存在": { zh: "已存在", en: "Already exists" },
    "建议格式: Name_WxH (例如: SD_512x512)": { zh: "建议格式: Name_WxH (例如: SD_512x512)", en: "Suggested format: Name_WxH (e.g. SD_512x512)" },
    "保存失败: ": { zh: "保存失败: ", en: "Save failed: " },
    
    // 模式选项（来自Python）
    "✨ 长边预设 (Long Edge)": { zh: "✨ 长边预设 (Long Edge)", en: "✨ Long Edge Preset" },
    "🔢 按比例 (Ratio)": { zh: "🔢 按比例 (Ratio)", en: "🔢 By Ratio" },
    "📐 指定尺寸 (Dimensions)": { zh: "📐 指定尺寸 (Dimensions)", en: "📐 Specify Dimensions" }
};

// 节点翻译映射表 - Magic Prompt Replace
const promptReplaceTranslations = {
    // 按钮文本
    "⚙️ 配置中心 / Settings": { zh: "⚙️ 配置中心 / Settings", en: "⚙️ Settings" },
    
    // 弹窗标题
    "🔮 Magic Assistant 配置中心": { zh: "🔮 Magic Assistant 配置中心", en: "🔮 Magic Assistant Settings Center" },
    
    // Tab标签
    "📋 规则编辑器": { zh: "📋 规则编辑器", en: "📋 Rule Editor" },
    "🤖 LLM服务": { zh: "🤖 LLM服务", en: "🤖 LLM Service" },
    
    // 规则编辑器
    "编辑规则 (Edit Rule):": { zh: "编辑规则 (Edit Rule):", en: "Edit Rule:" },
    "名称 (Name)": { zh: "名称 (Name)", en: "Name" },
    "➕ 新建": { zh: "➕ 新建", en: "➕ New" },
    "💾 保存": { zh: "💾 保存", en: "💾 Save" },
    "🗑️ 删除": { zh: "🗑️ 删除", en: "🗑️ Delete" },
    "Keep at least one!": { zh: "至少保留一个！", en: "Keep at least one!" },
    "至少保留一个！": { zh: "至少保留一个！", en: "Keep at least one!" },
    "Saved!": { zh: "已保存！", en: "Saved!" },
    "已保存！": { zh: "已保存！", en: "Saved!" },
    
    // LLM服务
    "选择配置 (Select Profile):": { zh: "选择配置 (Select Profile):", en: "Select Profile:" },
    "配置名称 (Profile Name):": { zh: "配置名称 (Profile Name):", en: "Profile Name:" },
    "➕ 新建配置": { zh: "➕ 新建配置", en: "➕ New Profile" },
    "💾 保存当前": { zh: "💾 保存当前", en: "💾 Save Current" },
    "Fill URL & Key": { zh: "请填写URL和Key", en: "Fill URL & Key" },
    "请填写URL和Key": { zh: "请填写URL和Key", en: "Fill URL & Key" },
    "Found": { zh: "找到", en: "Found" },
    "models!": { zh: "个模型！", en: " models!" },
    "找到": { zh: "找到", en: "Found" },
    "个模型！": { zh: "个模型！", en: " models!" },
    "Connected, but format unknown.": { zh: "已连接，但格式未知。", en: "Connected, but format unknown." },
    "已连接，但格式未知。": { zh: "已连接，但格式未知。", en: "Connected, but format unknown." },
    "Error: ": { zh: "错误: ", en: "Error: " },
    "错误: ": { zh: "错误: ", en: "Error: " },
    "保存失败 / Save Failed: ": { zh: "保存失败 / Save Failed: ", en: "Save Failed: " },
    
    // 输入框placeholder（来自Python）
    "原始提示词 (Original)": { zh: "原始提示词 (Original)", en: "Original Prompt" },
    "新内容 (New Content)": { zh: "新内容 (New Content)", en: "New Content" }
};

// 节点翻译映射表 - Magic Cache
const cacheTranslations = {
    // 新增支持提示框
    "✨ 本节点新增支持（已修改源项目代码）：": { zh: "✨ 本节点新增支持（已修改源项目代码）：", en: "✨ New Support Added (Source Code Modified):" },
    "flux2klein": { zh: "flux2klein", en: "flux2klein" },
    "最新 Anima 模型": { zh: "最新 Anima 模型", en: "Latest Anima Model" },
    "SDXL 模型": { zh: "SDXL 模型", en: "SDXL Model" },
    "已支持": { zh: "已支持", en: "Supported" },
    "原项目不支持": { zh: "原项目不支持", en: "Not supported in original project" },
    " - 已支持": { zh: " - 已支持", en: " - Supported" },
    " - 已支持（原项目不支持）": { zh: " - 已支持（原项目不支持）", en: " - Supported (Not supported in original project)" },
    
    // 按钮和控件
    "⚙️ 设置": { zh: "⚙️ 设置", en: "⚙️ Settings" },
    "📖 说明": { zh: "📖 说明", en: "📖 Help" },
    "模式": { zh: "模式", en: "Mode" },
    "取消": { zh: "取消", en: "Cancel" },
    "保存": { zh: "保存", en: "Save" },
    
    // 设置弹窗
    "⚡ Magic Cache 设置": { zh: "⚡ Magic Cache 设置", en: "⚡ Magic Cache Settings" },
    "TeaCache 设置": { zh: "TeaCache 设置", en: "TeaCache Settings" },
    "FBCache 设置": { zh: "FBCache 设置", en: "FBCache Settings" },
    "模型类型": { zh: "模型类型", en: "Model Type" },
    "缓存强度阈值": { zh: "缓存强度阈值", en: "Cache Strength Threshold" },
    "开始百分比": { zh: "开始百分比", en: "Start Percentage" },
    "结束百分比": { zh: "结束百分比", en: "End Percentage" },
    "缓存设备": { zh: "缓存设备", en: "Cache Device" },
    "对象名称": { zh: "对象名称", en: "Object Name" },
    "残差差异阈值": { zh: "残差差异阈值", en: "Residual Difference Threshold" },
    "最大连续缓存命中": { zh: "最大连续缓存命中", en: "Max Consecutive Cache Hits" },
    
    // 说明弹窗
    "📖 Magic Cache 使用说明": { zh: "📖 Magic Cache 使用说明", en: "📖 Magic Cache User Guide" },
    "☕ TeaCache 模式说明": { zh: "☕ TeaCache 模式说明", en: "☕ TeaCache Mode Guide" },
    "⚡ FBCache 模式说明": { zh: "⚡ FBCache 模式说明", en: "⚡ FBCache Mode Guide" },
    "🚀 Both 模式（组合模式）说明": { zh: "🚀 Both 模式（组合模式）说明", en: "🚀 Both Mode (Combined) Guide" },
    "工作原理": { zh: "工作原理", en: "How It Works" },
    "核心机制": { zh: "核心机制", en: "Core Mechanism" },
    "主要参数": { zh: "主要参数", en: "Main Parameters" },
    "性能表现": { zh: "性能表现", en: "Performance" },
    "支持的模型": { zh: "支持的模型", en: "Supported Models" },
    "执行流程": { zh: "执行流程", en: "Execution Flow" },
    "参数设置建议": { zh: "参数设置建议", en: "Parameter Settings Recommendations" },
    "原作者：": { zh: "原作者：", en: "Original Author: " },
    "参考来源：": { zh: "参考来源：", en: "References: " },
    "✨ 新功能：": { zh: "✨ 新功能：", en: "✨ New Feature: " },
    
    // TeaCache 说明内容
    "TeaCache 通过监测相邻时间步的输出差异，当差异低于设定阈值时，跳过计算并复用前一步的缓存结果，从而实现推理加速。": { zh: "TeaCache 通过监测相邻时间步的输出差异，当差异低于设定阈值时，跳过计算并复用前一步的缓存结果，从而实现推理加速。", en: "TeaCache monitors output differences between adjacent time steps. When the difference is below the set threshold, it skips computation and reuses the cached result from the previous step, achieving inference acceleration." },
    "监测相邻时间步的输出波动（相对 L1 距离）": { zh: "监测相邻时间步的输出波动（相对 L1 距离）", en: "Monitor output fluctuations between adjacent time steps (relative L1 distance)" },
    "当波动低于": { zh: "当波动低于", en: "When fluctuation is below" },
    "阈值时，跳过计算": { zh: "阈值时，跳过计算", en: " threshold, skip computation" },
    "复用前一步的缓存结果，减少计算量": { zh: "复用前一步的缓存结果，减少计算量", en: "Reuse cached result from previous step, reducing computation" },
    "早期步骤稳定性高，更适合缓存复用": { zh: "早期步骤稳定性高，更适合缓存复用", en: "Early steps are more stable, better suited for cache reuse" },
    "相对 L1 阈值，控制缓存激进程度（值越大越激进，速度越快但可能影响质量）": { zh: "相对 L1 阈值，控制缓存激进程度（值越大越激进，速度越快但可能影响质量）", en: "Relative L1 threshold, controls cache aggressiveness (higher value = more aggressive, faster but may affect quality)" },
    "缓存应用的步数范围（0.0-1.0）": { zh: "缓存应用的步数范围（0.0-1.0）", en: "Step range for cache application (0.0-1.0)" },
    "缓存存储设备（cuda 更快但占用显存，cpu 不占显存但稍慢）": { zh: "缓存存储设备（cuda 更快但占用显存，cpu 不占显存但稍慢）", en: "Cache storage device (cuda is faster but uses VRAM, cpu doesn't use VRAM but is slower)" },
    "模型类型，需与使用的模型匹配": { zh: "模型类型，需与使用的模型匹配", en: "Model type, must match the model being used" },
    "通常可实现": { zh: "通常可实现", en: "Typically achieves" },
    "的推理加速，具体取决于模型类型和参数设置。": { zh: "的推理加速，具体取决于模型类型和参数设置。", en: " inference acceleration, depending on model type and parameter settings." },
    "对于 FLUX 模型，推荐": { zh: "对于 FLUX 模型，推荐", en: "For FLUX models, recommended" },
    "，可实现约 2x 加速。": { zh: "，可实现约 2x 加速。", en: ", can achieve approximately 2x acceleration." },
    "FLUX、PuLID-FLUX、FLUX-Kontext、HiDream-I1、Lumina-Image-2.0、HunyuanVideo、LTX-Video、CogVideoX、Wan2.1、SDXL、SD1.5 等。": { zh: "FLUX、PuLID-FLUX、FLUX-Kontext、HiDream-I1、Lumina-Image-2.0、HunyuanVideo、LTX-Video、CogVideoX、Wan2.1、SDXL、SD1.5 等。", en: "FLUX, PuLID-FLUX, FLUX-Kontext, HiDream-I1, Lumina-Image-2.0, HunyuanVideo, LTX-Video, CogVideoX, Wan2.1, SDXL, SD1.5, etc." },
    
    // FBCache 说明内容
    "FBCache（Feature Block Cache）通过在指定步数范围内重用前一步的特征表示，跳过重复的特征计算，从而加速推理过程。": { zh: "FBCache（Feature Block Cache）通过在指定步数范围内重用前一步的特征表示，跳过重复的特征计算，从而加速推理过程。", en: "FBCache (Feature Block Cache) reuses feature representations from the previous step within a specified step range, skipping redundant feature computations to accelerate inference." },
    "在": { zh: "在", en: "Within" },
    "到": { zh: "到", en: " to " },
    "步数范围内启用特征缓存": { zh: "步数范围内启用特征缓存", en: " step range, enable feature caching" },
    "通过": { zh: "通过", en: "Control feature reuse sensitivity via" },
    "控制特征重用灵敏度": { zh: "控制特征重用灵敏度", en: "" },
    "当残差差异低于阈值时，重用前一步的特征块": { zh: "当残差差异低于阈值时，重用前一步的特征块", en: "When residual difference is below threshold, reuse feature blocks from previous step" },
    "支持限制最大连续缓存命中次数（": { zh: "支持限制最大连续缓存命中次数（", en: "Supports limiting maximum consecutive cache hits (" },
    "）": { zh: "）", en: ")" },
    "残差差异阈值，控制特征重用灵敏度（值越大越激进）": { zh: "残差差异阈值，控制特征重用灵敏度（值越大越激进）", en: "Residual difference threshold, controls feature reuse sensitivity (higher value = more aggressive)" },
    "最大连续缓存命中次数（-1 表示无限制）": { zh: "最大连续缓存命中次数（-1 表示无限制）", en: "Maximum consecutive cache hits (-1 means unlimited)" },
    "要打补丁的对象名称（通常为 \"diffusion_model\"）": { zh: "要打补丁的对象名称（通常为 \"diffusion_model\"）", en: "Object name to patch (usually \"diffusion_model\")" },
    "在合适的参数设置下，FBCache 可以实现显著的推理加速，特别是在中间步骤（如 20%-85% 范围）效果最佳。": { zh: "在合适的参数设置下，FBCache 可以实现显著的推理加速，特别是在中间步骤（如 20%-85% 范围）效果最佳。", en: "With appropriate parameter settings, FBCache can achieve significant inference acceleration, especially effective in middle steps (e.g., 20%-85% range)." },
    "支持 UNetModel（SDXL、SD3.5 等）、Flux、LTXV、HunyuanVideo、Anima 等基于 Transformer 块的模型。": { zh: "支持 UNetModel（SDXL、SD3.5 等）、Flux、LTXV、HunyuanVideo、Anima 等基于 Transformer 块的模型。", en: "Supports UNetModel (SDXL, SD3.5, etc.), Flux, LTXV, HunyuanVideo, Anima, and other Transformer-based models." },
    
    // Both 模式说明内容
    "Both 模式同时启用 TeaCache 和 FBCache 两种缓存优化技术，通过组合使用实现更快的推理速度。": { zh: "Both 模式同时启用 TeaCache 和 FBCache 两种缓存优化技术，通过组合使用实现更快的推理速度。", en: "Both mode simultaneously enables TeaCache and FBCache caching optimizations, achieving faster inference through combined usage." },
    "两层缓存逻辑按顺序组合执行": { zh: "两层缓存逻辑按顺序组合执行", en: "Two-layer cache logic executed in sequence" },
    "TeaCache 包装在 FBCache 外层，形成嵌套结构：": { zh: "TeaCache 包装在 FBCache 外层，形成嵌套结构：", en: "TeaCache wraps FBCache, forming nested structure: " },
    "在设定的步数范围内，两种缓存优化同时生效": { zh: "在设定的步数范围内，两种缓存优化同时生效", en: "Both cache optimizations are active within the set step range" },
    "TeaCache 负责时间步级别的缓存跳过，FBCache 负责特征块级别的缓存重用": { zh: "TeaCache 负责时间步级别的缓存跳过，FBCache 负责特征块级别的缓存重用", en: "TeaCache handles time-step level cache skipping, FBCache handles feature-block level cache reuse" },
    "首先应用 FBCache，在模型上设置特征块缓存逻辑": { zh: "首先应用 FBCache，在模型上设置特征块缓存逻辑", en: "First apply FBCache, setting feature block cache logic on the model" },
    "然后应用 TeaCache，将时间步缓存逻辑包装在外层": { zh: "然后应用 TeaCache，将时间步缓存逻辑包装在外层", en: "Then apply TeaCache, wrapping time-step cache logic on the outer layer" },
    "推理时，先经过 TeaCache 的时间步判断，再经过 FBCache 的特征块判断": { zh: "推理时，先经过 TeaCache 的时间步判断，再经过 FBCache 的特征块判断", en: "During inference, first pass through TeaCache's time-step judgment, then FBCache's feature-block judgment" },
    "两层缓存都会在各自设定的范围内生效": { zh: "两层缓存都会在各自设定的范围内生效", en: "Both cache layers are active within their respective set ranges" },
    "相比单独使用任意一种方法，组合模式通常提供": { zh: "相比单独使用任意一种方法，组合模式通常提供", en: "Compared to using either method alone, combined mode typically provides" },
    "更快的推理速度": { zh: "更快的推理速度", en: " faster inference speed" },
    "两种优化技术互补，可以在保持较好视觉质量的前提下实现更高的加速比。": { zh: "两种优化技术互补，可以在保持较好视觉质量的前提下实现更高的加速比。", en: "The two optimization techniques complement each other, achieving higher acceleration ratios while maintaining good visual quality." },
    "和": { zh: "和", en: " and " },
    "可以分别调整": { zh: "可以分别调整", en: " can be adjusted separately" },
    "建议先单独测试两种模式的效果，再组合使用": { zh: "建议先单独测试两种模式的效果，再组合使用", en: "Recommend testing each mode separately first, then combine" },
    "如果图像质量下降，可以适当降低阈值参数": { zh: "如果图像质量下降，可以适当降低阈值参数", en: "If image quality degrades, appropriately reduce threshold parameters" },
    "两种模式的步数范围（start/end）可以设置不同，实现更精细的控制": { zh: "两种模式的步数范围（start/end）可以设置不同，实现更精细的控制", en: "Step ranges (start/end) for both modes can be set differently for finer control" },
    "这是 Magic Cache 节点的新增功能，将两种缓存优化技术整合在一起，方便用户一键启用组合优化。": { zh: "这是 Magic Cache 节点的新增功能，将两种缓存优化技术整合在一起，方便用户一键启用组合优化。", en: "This is a new feature of the Magic Cache node, integrating both cache optimization techniques for one-click combined optimization." },
    
    // 侧边栏按钮
    "☕ TeaCache 模式": { zh: "☕ TeaCache 模式", en: "☕ TeaCache Mode" },
    "⚡ FBCache 模式": { zh: "⚡ FBCache 模式", en: "⚡ FBCache Mode" },
    "🚀 Both 模式（组合）": { zh: "🚀 Both 模式（组合）", en: "🚀 Both Mode (Combined)" }
};

// 节点翻译映射表 - Magic Prompt Box (提示词编辑器)
const magicPromptBoxTranslations = {
    // 主编辑按钮
    "✏️ 编辑提示词": { zh: "✏️ 编辑提示词", en: "✏️ Edit Prompt" },
    "🔮 Magic 提示词编辑器": { zh: "🔮 Magic 提示词编辑器", en: "🔮 Magic Prompt Editor" },
    "✕ 关闭编辑器": { zh: "✕ 关闭编辑器", en: "✕ Close Editor" },

    // Tab标签
    "✒️ 编辑": { zh: "✒️ 编辑", en: "✒️ Edit" },
    "📜 历史": { zh: "📜 历史", en: "📜 History" },
    "⚙️ 设置": { zh: "⚙️ 设置", en: "⚙️ Settings" },

    // 编辑工具栏按钮
    "💫 格式化": { zh: "💫 格式化", en: "💫 Format" },
    "🔄 去重": { zh: "🔄 去重", en: "🔄 Dedup" },
    "🗑️ 清空全部": { zh: "🗑️ 清空全部", en: "🗑️ Clear All" },
    "🚫 清空屏蔽": { zh: "🚫 清空屏蔽", en: "🚫 Clear Disabled" },
    "删除所有以 * 屏蔽的 tag（保留未屏蔽内容）": { zh: "删除所有以 * 屏蔽的 tag（保留未屏蔽内容）", en: "Remove all *-disabled tags (keep enabled content)" },
    "📋 复制": { zh: "📋 复制", en: "📋 Copy" },
    "🏷️ 编辑标签": { zh: "🏷️ 编辑标签", en: "🏷️ Edit Tags" },
    "🌐 一键翻译所有Tag": { zh: "🌐 一键翻译所有Tag", en: "🌐 Translate All Tags" },
    "打开标签编辑窗口": { zh: "打开标签编辑窗口", en: "Open tag edit window" },
    "与「批量译 tag」不同：短并列概念可译成逗号分隔的英文 tag；完整长句译成一整句自然英文（少用逗号以免被拆成多个芯片）。插入后仅在与原文分段对齐或整句单段时写入翻译缓存。": { zh: "与「批量译 tag」不同：短并列概念可译成逗号分隔的英文 tag；完整长句译成一整句自然英文（少用逗号以免被拆成多个芯片）。插入后仅在与原文分段对齐或整句单段时写入翻译缓存。", en: "Unlike batch translate: short concepts → comma-separated tags; long sentences → one natural English sentence (fewer commas = fewer chips). Translation cache written only when aligned with source segments." },
    "找出词库未命中中文的芯片（A/文 为 —），一次性打包请求 LLM；也可点芯片左下角「A/文」按钮单条排队翻译（设置 → 翻译 中选模型）": { zh: "找出词库未命中中文的芯片（A/文 为 —），一次性打包请求 LLM；也可点芯片左下角「A/文」按钮单条排队翻译（设置 → 翻译 中选模型）", en: "Find chips without Chinese (A/CN shows —), batch request LLM; or click A/CN on each chip to queue single translations (select model in Settings → Translation)" },

    // 编辑提示
    "输入任意语言，Enter：短词→tag，长句→一句自然英文": { zh: "输入任意语言，Enter：短词→tag，长句→一句自然英文", en: "Enter any language, Enter: short phrases→tag, long sentences→natural English" },

    // Tag预览区
    "Tag 预览": { zh: "Tag 预览", en: "Tag Preview" },
    " · 主框有内容才显示 · ↵ 换行芯片 · 单击 tag：锁定并显示权重条（点上方英文区才进入行内编辑；点下方中文区取消锁定） · 仅下方区域双击：屏蔽（*），避免与上方编辑冲突 · 点主输入框或空白处取消锁定 · 在芯片外侧留白或四周边距处拖拽：框选（过程中不弹工具条，实时蓝框预览） · 悬停芯片浅描边 · 框选后可整组拖拽（蓝线示落点）": { zh: " · 主框有内容才显示 · ↵ 换行芯片 · 单击 tag：锁定并显示权重条（点上方英文区才进入行内编辑；点下方中文区取消锁定） · 仅下方区域双击：屏蔽（*），避免与上方编辑冲突 · 点主输入框或空白处取消锁定 · 在芯片外侧留白或四周边距处拖拽：框选（过程中不弹工具条，实时蓝框预览） · 悬停芯片浅描边 · 框选后可整组拖拽（蓝线示落点）", en: " · Shows when main box has content · ↵ Newline chip · Click tag: lock & show weight bar (click top English area → inline edit; click bottom Chinese area → unlock) · Double-click bottom area only: toggle disable (*), avoids conflict with edit above · Click main input or blank: unlock · Drag on blank or margins: rubber-band select (no toolbar, live blue preview) · Hover chip: faint outline · Selected group draggable (blue line shows drop point)" },
    "锁定后仅在此区域点击进入文字编辑": { zh: "锁定后仅在此区域点击进入文字编辑", en: "Click here to edit text after locking" },
    "双击此区域切换屏蔽（*）；锁定后单击下方取消锁定": { zh: "双击此区域切换屏蔽（*）；锁定后单击下方取消锁定", en: "Double-click to toggle disable (*); click here when locked to unlock" },
    "解析结果为空": { zh: "解析结果为空", en: "No tags to parse" },
    "字符数: ": { zh: "字符数: ", en: "Chars: " },
    "Tag: ": { zh: "Tag: ", en: "Tag: " },
    "（启用 ": { zh: "（启用 ", en: "(Active " },
    "）": { zh: "）", en: ")" },
    " · 换行 ": { zh: " · 换行 ", en: " · Newline " },

    // Tag悬浮工具栏
    "权重": { zh: "权重", en: "Weight" },
    "收藏": { zh: "收藏", en: "Favorite" },
    "收藏 / 取消收藏（与「编辑标签」中收藏区同步）": { zh: "收藏 / 取消收藏（与「编辑标签」中收藏区同步）", en: "Add/Remove favorite (syncs with favorites in Edit Tags)" },
    "圆括号（WebUI 加权常用）": { zh: "圆括号（WebUI 加权常用）", en: "Parentheses (common for weighting in WebUI)" },
    "方括号": { zh: "方括号", en: "Square brackets" },
    "花括号": { zh: "花括号", en: "Curly brackets" },
    "外包一层 ": { zh: "外包一层 ", en: "Wrap with " },
    "去掉最外层 ": { zh: "去掉最外层 ", en: "Remove outer " },
    "换行": { zh: "换行", en: "Newline" },
    "在此 Tag 后换行（下一段用换行与当前段分开）": { zh: "在此 Tag 后换行（下一段用换行与当前段分开）", en: "Insert newline after this tag (next segment separated by newline)" },

    // Tag悬浮提示
    "Tag 权重（改后失焦或按回车生效；1 可去掉权重标记，参考 WeiLin）": { zh: "Tag 权重（改后失焦或按回车生效；1 可去掉权重标记，参考 WeiLin）", en: "Tag weight (takes effect on blur or Enter; 1 removes weight marker, ref WeiLin)" },
    "删除": { zh: "删除", en: "Delete" },
    "无法解析为有效 tag": { zh: "无法解析为有效 tag", en: "Cannot parse as valid tag" },
    "A/文": { zh: "A/文", en: "A/CN" },
    "单独补全/刷新此 tag 的中文：默认先查 LLM 磁盘缓存（省 token）；在「设置 → 翻译」选「强制翻译」时才会无视缓存重请求。按点击顺序排队。": { zh: "单独补全/刷新此 tag 的中文：默认先查 LLM 磁盘缓存（省 token）；在「设置 → 翻译」选「强制翻译」时才会无视缓存重请求。按点击顺序排队。", en: "Add/refresh Chinese for this tag: defaults to LLM disk cache (saves tokens); only ignores cache with 'Force Translate' in Settings. Queued in order of clicks." },

    // 换行芯片
    "换行（可删除；无权重条）": { zh: "换行（可删除；无权重条）", en: "Newline (can delete; no weight bar)" },
    "删除此换行": { zh: "删除此换行", en: "Delete this newline" },

    // 选中弹窗
    "选中 0 个标签": { zh: "选中 0 个标签", en: "0 tags selected" },
    "选中 ": { zh: "选中 ", en: "" },
    " 个标签": { zh: " 个标签", en: " tags selected" },
    "一键复制": { zh: "一键复制", en: "Copy All" },
    "一键屏蔽（*）": { zh: "一键屏蔽（*）", en: "Disable All (*)" },
    "一键启用": { zh: "一键启用", en: "Enable All" },
    "一键删除": { zh: "一键删除", en: "Delete All" },

    // Toast消息
    "✅ 已复制到剪贴板": { zh: "✅ 已复制到剪贴板", en: "✅ Copied to clipboard" },
    "❌ 复制失败（请检查浏览器权限）": { zh: "❌ 复制失败（请检查浏览器权限）", en: "❌ Copy failed (check browser permissions)" },
    "已排队 ": { zh: "已排队 ", en: "Queued " },
    " 条（按顺序翻译）": { zh: " 条（按顺序翻译）", en: " items (translating in order)" },
    "✅ 已命中 LLM 缓存（未请求 API）": { zh: "✅ 已命中 LLM 缓存（未请求 API）", en: "✅ LLM cache hit (no API request)" },
    "❌ ": { zh: "❌ ", en: "❌ " },
    "✅ 已插入（": { zh: "✅ 已插入（", en: "✅ Inserted (" },
    "）· 已写入翻译缓存 ": { zh: "）· 已写入翻译缓存 ", en: ") · Translation cache written " },
    " 条": { zh: " 条", en: " items" },
    "✅ 词库已覆盖，无需 AI 翻译": { zh: "✅ 词库已覆盖，无需 AI 翻译", en: "✅ Lexicon covered, no AI translation needed" },
    "当前没有可送 LLM 的 tag": { zh: "当前没有可送 LLM 的 tag", en: "No tags to send to LLM" },
    "翻译 ": { zh: "翻译 ", en: "Translating " },
    " 条…": { zh: " 条…", en: " items..." },
    "✅ 已更新 ": { zh: "✅ 已更新 ", en: "✅ Updated " },
    " 条中文": { zh: " 条中文", en: " Chinese translations" },
    "【强制翻译】本次 LLM ": { zh: "【强制翻译】本次 LLM ", en: "[Force Translate] LLM " },
    " 条": { zh: " 条", en: " items" },
    "（其中 ": { zh: "（其中 ", en: "(of which " },
    " 条命中 LLM 缓存，已覆盖）": { zh: " 条命中 LLM 缓存，已覆盖）", en: " items hit LLM cache, overwritten)" },
    " | LLM 缓存命中 ": { zh: " | LLM 缓存命中 ", en: " | LLM cache hits " },
    " 条（跳过 API）": { zh: " 条（跳过 API）", en: " items (API skipped)" },
    " | 缓存累计 ": { zh: " | 缓存累计 ", en: " | Cache total " },
    "/": { zh: "/", en: "/" },
    "✅ 已自动保存": { zh: "✅ 已自动保存", en: "✅ Auto-saved" },
    "自动保存失败：": { zh: "自动保存失败：", en: "Auto-save failed: " },

    // 格式化按钮状态
    "⏳ 格式化中…": { zh: "⏳ 格式化中…", en: "⏳ Formatting..." },
    "✅ 已完成": { zh: "✅ 已完成", en: "✅ Done" },
    "✅ 已复制!": { zh: "✅ 已复制!", en: "✅ Copied!" },
    "格式化失败：请确认已重启 ComfyUI，且扩展已加载。": { zh: "格式化失败：请确认已重启 ComfyUI，且扩展已加载。", en: "Format failed: Make sure to restart ComfyUI and the extension is loaded." },

    // 编辑提示
    "💡 提示：输入提示词，用英文逗号 ": { zh: "💡 提示：输入提示词，用英文逗号 ", en: "💡 Hint: Enter prompts, separate with comma " },
    " 或换行分隔。": { zh: " 或换行分隔。", en: " or newline." },
    "主框为空（无换行、无有效字符）时下方 Tag 区会隐藏；换行在预览里显示为 ": { zh: "主框为空（无换行、无有效字符）时下方 Tag 区会隐藏；换行在预览里显示为 ", en: "Tag area hides when main box is empty (no newline/valid chars); newlines show as " },
    " 芯片。": { zh: " 芯片。", en: " chips." },
    "↵ 芯片": { zh: "↵ 芯片", en: "↵ chip" },
    " 写入，节点编码时": { zh: " 写入，节点编码时", en: " written, during node encoding" },
    "会忽略输出这些tag到final_text与conditioning。": { zh: "会忽略输出这些tag到final_text与conditioning。", en: "will ignore outputting these tags to final_text and conditioning." },

    // 补全面板
    "英文 tag": { zh: "英文 tag", en: "English tag" },
    "中文": { zh: "中文", en: "Chinese" },
    "关闭补全": { zh: "关闭补全", en: "Close autocomplete" },
    "单次最多 ": { zh: "单次最多 ", en: "Max " },
    " 条 · 自建标签组优先 · 词太短时预设结果多，可打全名缩小范围": { zh: " 条 · 自建标签组优先 · 词太短时预设结果多，可打全名缩小范围", en: " items · Custom tagsets prioritized · Short queries return many results, type full name to narrow" },
    "没有找到包含 \"": { zh: "没有找到包含 \"", en: "No results for \"" },
    "\" 的 tag": { zh: "\" 的 tag", en: "\"" },
    "已显示 ": { zh: "已显示 ", en: "Showing " },
    " 条（已达上限），可能还有更多 · 自建标签已优先 · 请输入更长关键词或至编辑标签处搜索": { zh: " 条（已达上限），可能还有更多 · 自建标签已优先 · 请输入更长关键词或至编辑标签处搜索", en: " items (at limit), more may exist · Custom tagsets prioritized · Try longer keywords or search in Edit Tags" },
    "用户": { zh: "用户", en: "User" },
    "标签组「": { zh: "标签组「", en: "Tagset \"" },
    "」· 添加为整段": { zh: "」· 添加为整段", en: "\"\n· Add as full segment" },
    "来自「": { zh: "来自「", en: "From \"" },
    "」": { zh: "」", en: "\"" },

    // 补全面板 - Danbooru 中文搜索支持
    "本地结果已显示，正在加载 Danbooru 热度排序…": { zh: "本地结果已显示，正在加载 Danbooru 热度排序…", en: "Local results shown, loading Danbooru热度 sort…" },
    "本地中文匹配结果已显示，正在加载 Danbooru 补充热度…": { zh: "本地中文匹配结果已显示，正在加载 Danbooru 补充热度…", en: "Local Chinese matches shown, loading Danbooru补充热度…" },
    "中文已翻译为英文，从 Danbooru 获取热度排序": { zh: "中文已翻译为英文，从 Danbooru 获取热度排序", en: "Chinese translated to English, fetching Danbooru热度 sort" },
    "Danbooru 无对应热度数据，显示本地中文匹配结果": { zh: "Danbooru 无对应热度数据，显示本地中文匹配结果", en: "Danbooru has no 热度 data, showing local Chinese matches" },
    "Danbooru 获取为空，显示本地结果": { zh: "Danbooru 获取为空，显示本地结果", en: "Danbooru returned empty, showing local results" },
    "Danbooru 无结果": { zh: "Danbooru 无结果", en: "Danbooru: no results" },
    "Danbooru 获取失败": { zh: "Danbooru 获取失败", en: "Danbooru fetch failed" },
    "正在从 Danbooru 加载…": { zh: "正在从 Danbooru 加载…", en: "Loading from Danbooru…" },
    "正在查询 danbooru预设库…": { zh: "正在查询 danbooru预设库…", en: "Searching danbooru preset library…" },
    "本地预设库 · 毫秒级加载 · 分类+热度来自 danbooru预设库": {
        zh: "本地预设库 · 毫秒级加载 · 分类+热度来自 danbooru预设库",
        en: "Local preset · instant load · category & count from danbooru preset file",
    },
    "预设库无匹配，尝试更长关键词": {
        zh: "预设库无匹配，尝试更长关键词",
        en: "No preset match; try a longer or more specific keyword",
    },
    "danbooru预设库中无匹配，请扩充 savedata/danbooru预设库.txt，或使用「编辑标签」搜索远端": {
        zh: "danbooru预设库中无匹配，请扩充 savedata/danbooru预设库.txt，或使用「编辑标签」搜索远端",
        en: "No match in danbooru preset; expand savedata/danbooru preset file, or use Edit Tags for remote search",
    },
    "danbooru预设库加载失败，请重启 ComfyUI 或检查 savedata/danbooru预设库.txt": {
        zh: "danbooru预设库加载失败，请重启 ComfyUI 或检查 savedata/danbooru预设库.txt",
        en: "Failed to load danbooru preset; restart ComfyUI or check savedata/danbooru preset file",
    },
    "Danbooru 无匹配，正在加载本地词库…": { zh: "Danbooru 无匹配，正在加载本地词库…", en: "No Danbooru match, loading local lexicon…" },
    "Danbooru 无匹配，以下为本地词库结果": { zh: "Danbooru 无匹配，以下为本地词库结果", en: "No Danbooru match; showing local lexicon results" },
    "Danbooru 与本地词库均无匹配": { zh: "Danbooru 与本地词库均无匹配", en: "No match on Danbooru or local lexicon" },
    "本地词库加载失败": { zh: "本地词库加载失败", en: "Local lexicon failed to load" },
    "Danbooru 失败，以下为本地词库": { zh: "Danbooru 失败，以下为本地词库", en: "Danbooru failed; showing local lexicon" },
    "Danbooru 失败且无本地匹配": { zh: "Danbooru 失败且无本地匹配", en: "Danbooru failed and no local match" },
    "Danbooru 失败，本地词库不可用": { zh: "Danbooru 失败，本地词库不可用", en: "Danbooru failed; local lexicon unavailable" },
    "中文已翻译为英文，获取 Danbooru 热度排序中…": { zh: "中文已翻译为英文，获取 Danbooru 热度排序中…", en: "Chinese translated, fetching Danbooru热度…" },
    "「」→「」已翻译为英文，从 Danbooru 获取热度排序": { zh: "「」→「」已翻译为英文，从 Danbooru 获取热度排序", en: "「」→「」translated, fetching Danbooru热度 sort" },
    "本地词库未找到「」→「」的对应英文，Danbooru 无法直接搜索中文": { zh: "本地词库未找到「」→「」的对应英文，Danbooru 无法直接搜索中文", en: "No English match for「」→「」in local lexicon, Danbooru cannot search Chinese directly" },
    "编辑标签弹窗搜索 - Danbooru 中文提示": { zh: "中文「」→「」→「」已翻译为英文，从 Danbooru 获取热度排序", en: "Chinese「」→「」→「」translated, fetching Danbooru热度 sort" },

    // 编辑标签弹窗
    "🏷️ 编辑标签": { zh: "🏷️ 编辑标签", en: "🏷️ Edit Tags" },
    "关闭": { zh: "关闭", en: "Close" },
    "➕ 新建标签组": { zh: "➕ 新建标签组", en: "➕ New Tagset" },
    "中文名称": { zh: "中文名称", en: "Chinese Name" },
    "可选，如：我的画质组": { zh: "可选，如：我的画质组", en: "Optional, e.g.: My Quality Group" },
    "英文 tag 组合（逗号分隔，可多枚）": { zh: "英文 tag 组合（逗号分隔，可多枚）", en: "English tag combo (comma-separated, multiple allowed)" },
    "如：masterpiece, best quality, absurdres": { zh: "如：masterpiece, best quality, absurdres", en: "e.g.: masterpiece, best quality, absurdres" },
    "保存到本地": { zh: "保存到本地", en: "Save to local" },
    "保存修改": { zh: "保存修改", en: "Save changes" },
    "取消": { zh: "取消", en: "Cancel" },
    "➖ 收起新建表单": { zh: "➖ 收起新建表单", en: "➖ Collapse form" },
    "新建标签": { zh: "新建标签", en: "New Tags" },
    "收藏的标签": { zh: "收藏的标签", en: "Favorite Tags" },
    "暂无标签，后续可在此管理。": { zh: "暂无标签，后续可在此管理。", en: "No tags yet, manage them here later." },
    " 组": { zh: " 组", en: " groups" },
    "点击卡片（除右上角按钮）将英文 tag 整组插入到主编辑区（不关闭本窗口）": { zh: "点击卡片（除右上角按钮）将英文 tag 整组插入到主编辑区（不关闭本窗口）", en: "Click card (except top-right button) to insert all English tags into editor (window stays open)" },
    "未命名": { zh: "未命名", en: "Unnamed" },
    "修改中文名与英文 tag 组合": { zh: "修改中文名与英文 tag 组合", en: "Edit Chinese name and English tag combo" },
    "删除此标签组": { zh: "删除此标签组", en: "Delete this tagset" },
    "确定删除标签组「": { zh: "确定删除标签组「", en: "Confirm delete tagset \"" },
    "」？\n删除后不可恢复。": { zh: "」？\n删除后不可恢复。", en: "\"?\nCannot be undone." },
    "删除失败。请检查 userdata 是否可写或是否已重启 ComfyUI。": { zh: "删除失败。请检查 userdata 是否可写或是否已重启 ComfyUI。", en: "Delete failed. Check if userdata is writable or restart ComfyUI." },
    "从收藏中删除": { zh: "从收藏中删除", en: "Remove from favorites" },
    "收藏": { zh: "收藏", en: "Favorite" },
    "确定从收藏中删除「": { zh: "确定从收藏中删除「", en: "Confirm remove from favorites \"" },
    "」？": { zh: "」？", en: "\"" },
    "请填写英文 tag 组合。": { zh: "请填写英文 tag 组合。", en: "Please fill in English tag combo." },
    "保存失败。请检查：1) 已重启 ComfyUI；2) 插件目录下 userdata 可写；3) 浏览器 Network 里 POST /ma/tag_sets 的状态码。": { zh: "保存失败。请检查：1) 已重启 ComfyUI；2) 插件目录下 userdata 可写；3) 浏览器 Network 里 POST /ma/tag_sets 的状态码。", en: "Save failed. Check: 1) ComfyUI restarted; 2) userdata writable; 3) POST /ma/tag_sets status in browser Network." },

    // 标签搜索
    "标签搜索": { zh: "标签搜索", en: "Tag Search" },
    "输入英文 tag 或中文关键词…": { zh: "输入英文 tag 或中文关键词…", en: "Enter English tag or Chinese keyword..." },
    "搜索": { zh: "搜索", en: "Search" },
    "Tag": { zh: "Tag", en: "Tag" },
    "中文": { zh: "中文", en: "Chinese" },
    "操作": { zh: "操作", en: "Actions" },
    "匹配方式与提示词补全相同：英文 ": { zh: "匹配方式与提示词补全相同：英文 ", en: "Match mode same as autocomplete: English " },
    "（不区分大小写），中文 ": { zh: "（不区分大小写），中文 ", en: " (case-insensitive), Chinese " },
    "。": { zh: "。", en: "." },
    "显示全部": { zh: "显示全部", en: "Show all" },
    "包含": { zh: "包含", en: "contains" },
    "匹配结果（无条数上限）；自建标签组优先列出。关键词过短时结果可能很多，建议打全名缩小范围。": { zh: "匹配结果（无条数上限）；自建标签组优先列出。关键词过短时结果可能很多，建议打全名缩小范围。", en: " matches (no limit); custom tagsets prioritized. Short keywords return many results, type full name to narrow." },
    "无结果，请更换关键词。": { zh: "无结果，请更换关键词。", en: "No results, try different keywords." },
    "添加": { zh: "添加", en: "Add" },
    "搜索中…": { zh: "搜索中…", en: "Searching..." },
    "请输入关键词后点击搜索。": { zh: "请输入关键词后点击搜索。", en: "Enter keywords then click Search." },
    "搜索失败，请稍后重试。": { zh: "搜索失败，请稍后重试。", en: "Search failed, try again later." },
    "【Danbooru 远端】英文：多页取回后排序——有本地中文释义的优先于无中文，再按热度。中文搜索：词库译成英文根后向 Danbooru 按英文名匹配；「中文」列须命中你的词，且查询不少于 3 字时排除「更长前缀复合释义」（如搜「健身房」不显示释义为「健身房淋浴」的 tag）。「中文」列来自本地词库。若出现与前排相似的英文名，多为远端另一条独立 tag（含错拼），无预设译名时「中文」为—。": {
        zh: "【Danbooru 远端】英文：多页取回后排序——有本地中文释义的优先于无中文，再按热度。中文搜索：词库译成英文根后向 Danbooru 按英文名匹配；「中文」列须命中你的词，且查询不少于 3 字时排除「更长前缀复合释义」（如搜「健身房」不显示释义为「健身房淋浴」的 tag）。「中文」列来自本地词库。若出现与前排相似的英文名，多为远端另一条独立 tag（含错拼），无预设译名时「中文」为—。",
        en: "[Danbooru remote] English: multi-page fetch then sort—local Chinese gloss first, then heat. Chinese: roots from lexicon then Danbooru English match; gloss must match your text, and for queries of 3+ Han chars, longer glosses that are mere prefixes (e.g. 健身房 vs 健身房淋浴) are excluded. Chinese column is local lexicon. Similar English names are often separate Danbooru tags (typos); no preset gloss shows —.",
    },
    "（每页最多 100 条，向下滚动加载更多；关键词过短建议打更完整的词。）": {
        zh: "（每页最多 100 条，向下滚动加载更多；关键词过短建议打更完整的词。）",
        en: " (Up to 100 per page, scroll to load more; use longer keywords if results are too broad.)",
    },

    // 历史记录
    "📜 工作流": { zh: "📜 工作流", en: "📜 Workflow" },
    "完整执行成功": { zh: "完整执行成功", en: "completed successfully" },
    "后，会将画布上所有「多功能提示词框」的文本写入本地；写入前与已有记录": { zh: "后，会将画布上所有「多功能提示词框」的文本写入本地；写入前与已有记录", en: "after completion, will write all 'Magic Prompt Box' texts on canvas to local; dedupes by content against existing records" },
    "按内容去重": { zh: "按内容去重", en: "deduplicates by content" },
    "。": { zh: "。", en: "." },
    "📋 运行历史": { zh: "📋 运行历史", en: "📋 Run History" },
    "⭐ 历史收藏": { zh: "⭐ 历史收藏", en: "⭐ Favorites" },
    "追加到当前提示词末尾": { zh: "追加到当前提示词末尾", en: "Append to current prompt end" },
    "点击正文区域：追加到当前提示词末尾": { zh: "点击正文区域：追加到当前提示词末尾", en: "Click content area: append to current prompt end" },
    "标签组「": { zh: "标签组「", en: "Tagset \"" },
    "」· 点击插入整段英文": { zh: "」· 点击插入整段英文", en: "\" · Click to insert full segment" },
    "自定义": { zh: "自定义", en: "Custom" },
    "追加到当前提示词": { zh: "追加到当前提示词", en: "Append to current prompt" },
    "覆盖写入（替换编辑器全文）": { zh: "覆盖写入（替换编辑器全文）", en: "Overwrite (replace all editor content)" },
    "覆盖写入": { zh: "覆盖写入", en: "Overwrite" },
    "加入历史收藏（可命名）": { zh: "加入历史收藏（可命名）", en: "Add to favorites (can name)" },
    "收藏名称": { zh: "收藏名称", en: "Favorite name" },
    "从运行历史中删除": { zh: "从运行历史中删除", en: "Delete from run history" },
    "编辑名称与 tag 正文": { zh: "编辑名称与 tag 正文", en: "Edit name and tag content" },
    "删除收藏": { zh: "删除收藏", en: "Delete favorite" },
    "确定用本条覆盖当前编辑器中的全部提示词？": { zh: "确定用本条覆盖当前编辑器中的全部提示词？", en: "Confirm overwriting all editor content with this item?" },
    "从运行历史中删除此项？": { zh: "从运行历史中删除此项？", en: "Delete this item from run history?" },
    "确定覆盖当前编辑器？": { zh: "确定覆盖当前编辑器？", en: "Confirm overwriting current editor?" },
    "删除这条收藏？": { zh: "删除这条收藏？", en: "Delete this favorite?" },
    "加载中…": { zh: "加载中…", en: "Loading..." },
    "加载失败，请确认已重启 ComfyUI。": { zh: "加载失败，请确认已重启 ComfyUI。", en: "Load failed, make sure to restart ComfyUI." },
    "暂无记录。成功跑完一次工作流后，会自动保存画布上各提示词框内容。": { zh: "暂无记录。成功跑完一次工作流后，会自动保存画布上各提示词框内容。", en: "No records yet. After a successful workflow run, all prompt box contents on canvas will be auto-saved." },
    "当前最多保留 ": { zh: "当前最多保留 ", en: "Currently keeping max " },
    " 条（超出丢弃最旧；可在「设置」修改并立即裁剪）。": { zh: " 条（超出丢弃最旧；可在「设置」修改并立即裁剪）。", en: " items (oldest dropped when exceeded; modify in Settings to cut immediately)." },
    "暂无收藏。在「运行历史」左侧点击 ☆ 可加入此处，并可命名、编辑正文。": { zh: "暂无收藏。在「运行历史」左侧点击 ☆ 可加入此处，并可命名、编辑正文。", en: "No favorites yet. Click ☆ on the left in Run History to add here, can name and edit content." },
    "正文不能为空。": { zh: "正文不能为空。", en: "Content cannot be empty." },

    // 收藏编辑器
    "✎ 编辑收藏": { zh: "✎ 编辑收藏", en: "✎ Edit Favorite" },
    "名称": { zh: "名称", en: "Name" },
    "英文 tag（逗号或换行分隔）": { zh: "英文 tag（逗号或换行分隔）", en: "English tags (comma or newline separated)" },
    "未命名收藏": { zh: "未命名收藏", en: "Unnamed Favorite" },
    "保存": { zh: "保存", en: "Save" },

    // 时间格式化
    "刚刚": { zh: "刚刚", en: "Just now" },
    " 分钟前": { zh: " 分钟前", en: " min ago" },
    " 小时前": { zh: " 小时前", en: " hr ago" },
    " 天前": { zh: " 天前", en: " days ago" },

    // 设置 Tab
    "以下选项写入 userdata/settings.txt（与弹窗尺寸等共用）。修改任意项后会自动保存；返回「编辑」Tab 可看到工具栏等变化。": { zh: "以下选项写入 userdata/settings.txt（与弹窗尺寸等共用）。修改任意项后会自动保存；返回「编辑」Tab 可看到工具栏等变化。", en: "Options written to userdata/settings.txt (shared with dialog size etc). Auto-saves on any change; return to Edit Tab to see toolbar changes." },

    // 设置项标题
    "1 · 编辑界面显示设置": { zh: "1 · 编辑界面显示设置", en: "1 · Editor Display Settings" },
    "控制「编辑」Tab 顶部工具栏：默认全部显示，关闭后对应按钮或输入框将隐藏。": { zh: "控制「编辑」Tab 顶部工具栏：默认全部显示，关闭后对应按钮或输入框将隐藏。", en: "Controls Edit Tab top toolbar: all shown by default, hidden when toggled off." },
    "控制「编辑」Tab 顶部工具栏与内联补全弹窗：默认全部开启，关闭后对应按钮、输入框或补全列表将隐藏。": { zh: "控制「编辑」Tab 顶部工具栏与内联补全弹窗：默认全部开启，关闭后对应按钮、输入框或补全列表将隐藏。", en: "Controls Edit Tab toolbar and inline autocomplete popup: all on by default; toggling off hides the matching buttons, inputs, or completion list." },
    "单行翻译输入框（按 Enter）": { zh: "单行翻译输入框（按 Enter）", en: "Single-line translate input (Press Enter)" },

    // 格式化设置
    "2 · 格式化详细设置": { zh: "2 · 格式化详细设置", en: "2 · Format Detailed Settings" },
    "对应「编辑」Tab 的 💫 格式化按钮；调用后端 /ma/format_prompt。各选项独立生效，勾哪个跑哪个。「清理逗号」「修复括号」始终独立执行；高级步骤（下划线/权重/括号转义）按勾选各自处理；全部高级子项关闭时后端直接返回原文本。": { zh: "对应「编辑」Tab 的 💫 格式化按钮；调用后端 /ma/format_prompt。各选项独立生效，勾哪个跑哪个。「清理逗号」「修复括号」始终独立执行；高级步骤（下划线/权重/括号转义）按勾选各自处理；全部高级子项关闭时后端直接返回原文本。", en: "Corresponds to Edit Tab 💫 Format button; calls backend /ma/format_prompt. Each option runs independently. 'Cleanup commas' and 'Fix brackets' always run; advanced steps (underscore/weight/bracket escaping) run per selection; all advanced off = backend returns original." },
    "选项来自 ": { zh: "选项来自 ", en: "Options from " },
    " 的 ": { zh: " 的 ", en: "'s " },
    "。修改后自动写入；返回「编辑」再点格式化即生效。": { zh: "。修改后自动写入；返回「编辑」再点格式化即生效。", en: ". Auto-written on change; return to Edit and click Format to apply." },
    "清理逗号（cleanup_commas）": { zh: "清理逗号（cleanup_commas）", en: "Cleanup commas (cleanup_commas)" },
    "删除首尾逗号、连续逗号": { zh: "删除首尾逗号、连续逗号", en: "Remove leading/trailing/duplicate commas" },
    "清理空白（cleanup_whitespace）": { zh: "清理空白（cleanup_whitespace）", en: "Cleanup whitespace (cleanup_whitespace)" },
    "首尾空白、重复空格、逗号旁多余空格": { zh: "首尾空白、重复空格、逗号旁多余空格", en: "Leading/trailing spaces, duplicate spaces, extra spaces around commas" },
    "移除 LoRA 标签（remove_lora_tags）": { zh: "移除 LoRA 标签（remove_lora_tags）", en: "Remove LoRA tags (remove_lora_tags)" },
    "删除 &lt;lora:…&gt;": { zh: "删除 &lt;lora:…&gt;", en: "Delete &lt;lora:…&gt;" },
    "下划线转空格（underscore_to_space）": { zh: "下划线转空格（underscore_to_space）", en: "Underscore to space (underscore_to_space)" },
    "tag_name → tag name": { zh: "tag_name → tag name", en: "tag_name → tag name" },
    "权重语法补全（complete_weight_syntax）": { zh: "权重语法补全（complete_weight_syntax）", en: "Weight syntax completion (complete_weight_syntax)" },
    "如 tag:1.2 → (tag:1.2)": { zh: "如 tag:1.2 → (tag:1.2)", en: "e.g. tag:1.2 → (tag:1.2)" },
    "智能括号转义（smart_bracket_escaping）": { zh: "智能括号转义（smart_bracket_escaping）", en: "Smart bracket escaping (smart_bracket_escaping)" },
    "系列名括号 \\(\\) 与漏逗号分段处理": { zh: "系列名括号 \\(\\) 与漏逗号分段处理", en: "Series name brackets \\(\\) and missing comma segmentation" },
    "标准化逗号（standardize_commas）": { zh: "标准化逗号（standardize_commas）", en: "Standardize commas (standardize_commas)" },
    "英文逗号 + 空格连接各标签": { zh: "英文逗号 + 空格连接各标签", en: "Connect tags with English comma + space" },
    "清理换行（cleanup_newlines）": { zh: "清理换行（cleanup_newlines）", en: "Cleanup newlines (cleanup_newlines)" },
    "含 COUPLE / MASK 等多区域语法时，后端只会把换行替换为空格，不会替换为逗号，以免破坏结构。": { zh: "含 COUPLE / MASK 等多区域语法时，后端只会把换行替换为空格，不会替换为逗号，以免破坏结构。", en: "With COUPLE/MASK multi-zone syntax, backend replaces newlines with space only, not commas, to avoid breaking structure." },
    "修复括号（fix_brackets）": { zh: "修复括号（fix_brackets）", en: "Fix brackets (fix_brackets)" },
    "仅在未勾选任何高级子项时按原版逻辑执行；勾了高级子项时由智能格式化流程处理。": { zh: "仅在未勾选任何高级子项时按原版逻辑执行；勾了高级子项时由智能格式化流程处理。", en: "Only executes original logic when no advanced items checked; smart format handles when advanced items are checked." },

    // 换行下拉选项
    "否 — 保留换行": { zh: "否 — 保留换行", en: "No — Keep newlines" },
    "空格 — \\n → 空格": { zh: "空格 — \\n → 空格", en: "Space — \\n → Space" },
    "逗号 — \\n → \", \"": { zh: "逗号 — \\n → \", \"", en: "Comma — \\n → \", \"" },
    "否": { zh: "否", en: "No" },
    "圆括号 — 移除不配对的 ( )": { zh: "圆括号 — 移除不配对的 ( )", en: "Parentheses — Remove unpaired ( )" },
    "方括号 — 移除不配对的 [ ]": { zh: "方括号 — 移除不配对的 [ ]", en: "Square brackets — Remove unpaired [ ]" },
    "两者": { zh: "两者", en: "Both" },

    // 翻译设置
    "3 · 翻译功能设置": { zh: "3 · 翻译功能设置", en: "3 · Translation Settings" },
    "选择翻译调用的 LLM 配置；「管理 LLM」与「多功能AI提示词替换」节点的配置中心写入同一文件 userdata/llm_settings.txt。": { zh: "选择翻译调用的 LLM 配置；「管理 LLM」与「多功能AI提示词替换」节点的配置中心写入同一文件 userdata/llm_settings.txt。", en: "Select LLM config for translation; 'Manage LLM' and 'Magic Prompt Replace' settings center write to same file userdata/llm_settings.txt." },
    "当前翻译使用的配置名会写入 ": { zh: "当前翻译使用的配置名会写入 ", en: "Current translation config name will be written to " },
    " 的 ": { zh: " 的 ", en: "'s " },
    "；修改后即自动保存。LLM 的 Base URL / Key / Model 在「管理 LLM 配置」中编辑。": { zh: "；修改后即自动保存。LLM 的 Base URL / Key / Model 在「管理 LLM 配置」中编辑。", en: "; auto-saved on change. LLM Base URL/Key/Model edited in 'Manage LLM Config'." },
    "翻译使用的 LLM 配置": { zh: "翻译使用的 LLM 配置", en: "LLM config for translation" },
    "⚙️ 管理 LLM 配置…": { zh: "⚙️ 管理 LLM 配置…", en: "⚙️ Manage LLM Config..." },
    "打开与「多功能AI提示词替换 → 配置中心 → LLM服务」相同的编辑界面": { zh: "打开与「多功能AI提示词替换 → 配置中心 → LLM服务」相同的编辑界面", en: "Open same editor as 'Magic Prompt Replace → Settings Center → LLM Service'" },
    "（暂无 LLM 配置，请先点「管理 LLM」添加）": { zh: "（暂无 LLM 配置，请先点「管理 LLM」添加）", en: "(No LLM config yet, click 'Manage LLM' to add)" },
    "（加载失败，请重启 ComfyUI）": { zh: "（加载失败，请重启 ComfyUI）", en: "(Load failed, restart ComfyUI)" },
    "翻译模式（二选一）": { zh: "翻译模式（二选一）", en: "Translation mode (choose one)" },
    "📖 正常翻译模式（默认）": { zh: "📖 正常翻译模式（默认）", en: "📖 Normal translation mode (default)" },
    "仅翻译本地词库未命中的 tag，已命中词库的 chip 保留原样；LLM 缓存命中的 tag 也跳过 API，最省 token。结果 = 词库 + LLM 缓存。": { zh: "仅翻译本地词库未命中的 tag，已命中词库的 chip 保留原样；LLM 缓存命中的 tag 也跳过 API，最省 token。结果 = 词库 + LLM 缓存。", en: "Only translates tags not in local lexicon; chips hit in lexicon stay unchanged; tags hit in LLM cache skip API, most token-efficient. Result = Lexicon + LLM cache." },
    "⚡ 强制翻译模式": { zh: "⚡ 强制翻译模式", en: "⚡ Force translate mode" },
    "忽略本地词库命中状态，所有 tag 都送 LLM 重译（已在 LLM 缓存的 tag 也会被覆盖）。翻译结果 = LLM 返回，适用于词典/缓存质量不佳需要整体重翻的情况。": { zh: "忽略本地词库命中状态，所有 tag 都送 LLM 重译（已在 LLM 缓存的 tag 也会被覆盖）。翻译结果 = LLM 返回，适用于词典/缓存质量不佳需要整体重翻的情况。", en: "Ignores local lexicon hit status, all tags sent to LLM (even tags in LLM cache overwritten). Result = LLM output. Use when lexicon/cache quality is poor and full re-translate needed." },

    // 其他设置
    "4 · 补全与历史等其他设置": { zh: "4 · 补全与历史等其他设置", en: "4 · Autocomplete & History & Other Settings" },
    "内联补全列表条数上限、运行历史保留条数。": { zh: "内联补全列表条数上限、运行历史保留条数。", en: "Inline autocomplete list limit, run history retention." },
    "补全提示词显示条数": { zh: "补全提示词显示条数", en: "Autocomplete display count" },
    "编辑框内输入时，下拉补全最多展示的 tag 条数（1～500）。需返回「编辑」Tab 后对新开补全生效。": { zh: "编辑框内输入时，下拉补全最多展示的 tag 条数（1～500）。需返回「编辑」Tab 后对新开补全生效。", en: "Max tag count shown in autocomplete dropdown when typing in editor (1~500). Return to Edit Tab for new autocomplete to take effect." },
    "历史记录保留条数": { zh: "历史记录保留条数", en: "History retention count" },
    "工作流成功结束后写入运行历史的上限；保存后立即按新值裁剪本地历史。": { zh: "工作流成功结束后写入运行历史的上限；保存后立即按新值裁剪本地历史。", en: "Run history upper limit after successful workflow; immediately trims local history to new value on save." },
    "LLM 翻译缓存条数": { zh: "LLM 翻译缓存条数", en: "LLM translation cache count" },
    "本地 LLM 翻译缓存最大条数（LRU，超出自动淘汰最旧的）。强制翻译模式下即使命中缓存也会全部重送 LLM（节省 token）。": { zh: "本地 LLM 翻译缓存最大条数（LRU，超出自动淘汰最旧的）。强制翻译模式下即使命中缓存也会全部重送 LLM（节省 token）。", en: "Max local LLM translation cache items (LRU, oldest evicted when exceeded). In force translate mode, all items resent to LLM even if cached (saves tokens)." },
    "🔍 开启补全弹窗（打字时显示 Tag 候选列表）": { zh: "🔍 开启补全弹窗（打字时显示 Tag 候选列表）", en: "🔍 Enable autocomplete popup (show tag suggestions while typing)" },
    "关闭后编辑框输入时不弹出补全列表；词库搜索、标签编辑弹窗等独立补全功能不受影响。": { zh: "关闭后编辑框输入时不弹出补全列表；词库搜索、标签编辑弹窗等独立补全功能不受影响。", en: "After turning off, no autocomplete popup while typing in editor; tag library search, Edit Tags modal and other independent autocomplete features are unaffected." },

    // 设置项 5 — 标签和补全功能设置（新增）
    "5 · 标签和补全功能设置": { zh: "5 · 标签和补全功能设置", en: "5 · Tag & Autocomplete Settings" },
    "选择补全数据来源：本地标签数据库使用预设库+用户标签组；远端 Danbooru 则实时从官方 API 获取（自带分类与热度）。": {
        zh: "选择补全数据来源：本地标签数据库使用预设库+用户标签组；远端 Danbooru 则实时从官方 API 获取（自带分类与热度）。",
        en: "Choose autocomplete data source: local tag DB uses preset library + user tagsets; remote Danbooru fetches live from official API (with category & heat).",
    },
    "数据来源(🚨使用danbooru数据时，请当编辑界面下方显示连接成功再编辑tag，否则补全可能会显示bug。)": {
        zh: "数据来源(🚨使用danbooru数据时，请当编辑界面下方显示连接成功再编辑tag，否则补全可能会显示bug。)",
        en: "Data Source (🚨When using danbooru data, wait until the connection success message appears below the editor, then edit tags. Otherwise autocomplete may show bugs.)",
    },
    "📁 本地标签数据库": { zh: "📁 本地标签数据库", en: "📁 Local Tag Database" },
    "使用预设库（tag预设库.txt）与用户标签组进行补全，中文释义来自本地词库。": {
        zh: "使用预设库（tag预设库.txt）与用户标签组进行补全，中文释义来自本地词库。",
        en: "Uses preset library (tag预设库.txt) and user tagsets for autocomplete; Chinese glossary from local lexicon.",
    },
    "🌐 远端 Danbooru Tag 数据": { zh: "🌐 远端 Danbooru Tag 数据", en: "🌐 Remote Danbooru Tag Data" },
    "实时从 danbooru.donmai.us 获取 Tag，带分类（general/artist/copyright/character/meta）与热度排序；中文释义使用本地词库匹配。": {
        zh: "实时从 danbooru.donmai.us 获取 Tag，带分类（general/artist/copyright/character/meta）与热度排序；中文释义使用本地词库匹配。",
        en: "Fetches tags live from danbooru.donmai.us, with category (general/artist/copyright/character/meta) and popularity sort; Chinese glossary matched from local lexicon.",
    },
    "正在检测连接…": { zh: "正在检测连接…", en: "Checking connection..." },
    "❌ 连接失败：": { zh: "❌ 连接失败：", en: "❌ Connection failed:" },
    "（将自动切回本地模式）": { zh: "（将自动切回本地模式）", en: "(Will automatically switch back to local mode)" },
    "✅ 连接成功！已启用 Danbooru 远端补全。": { zh: "✅ 连接成功！已启用 Danbooru 远端补全。", en: "✅ Connection successful! Remote Danbooru autocomplete enabled." },

    // 补全选项卡标题（设置项 1 副标题补充）
    "💫 格式化": { zh: "💫 格式化", en: "💫 Format" },
    "🔄 去重": { zh: "🔄 去重", en: "🔄 Dedupe" },
    "🗑️ 清空全部": { zh: "🗑️ 清空全部", en: "🗑️ Clear All" },
    "🚫 清空屏蔽": { zh: "🚫 清空屏蔽", en: "🚫 Clear Disabled" },
    "📋 复制": { zh: "📋 复制", en: "📋 Copy" },
    "🏷️ 编辑标签": { zh: "🏷️ 编辑标签", en: "🏷️ Edit Tags" },
    "🌐 一键翻译所有Tag": { zh: "🌐 一键翻译所有Tag", en: "🌐 Translate All Tags" },

    // Danbooru 连接状态条（编辑区底部）
    "补全来源：本地标签库": { zh: "补全来源：本地标签库", en: "Source: Local Tag Library" },
    "✅ Danbooru 已连接，补全与标签搜索使用Danbooru数据": {
        zh: "✅ Danbooru 已连接，补全与标签搜索使用Danbooru数据",
        en: "✅ Danbooru connected; autocomplete & tag search use Danbooru data",
    },
    "❌ Danbooru 不可用：": { zh: "❌ Danbooru 不可用：", en: "❌ Danbooru unavailable:" },
    "✅ 已自动保存": { zh: "✅ 已自动保存", en: "✅ Auto-saved" },
    "自动保存失败：": { zh: "自动保存失败：", en: "Auto-save failed:" },

    // 拖动提示
    "拖动缩放窗体": { zh: "拖动缩放窗体", en: "Drag to resize window" },

    // 后端错误
    "HTTP ": { zh: "HTTP ", en: "HTTP " },
    "（请确认已重启 ComfyUI 且扩展已加载）": { zh: "（请确认已重启 ComfyUI 且扩展已加载）", en: "(Make sure to restart ComfyUI and extension is loaded)" },
    "模型未返回有效英文": { zh: "模型未返回有效英文", en: "Model returned no valid English" },

    // 其他通用
    "—": { zh: "—", en: "—" },
    "...": { zh: "...", en: "..." },
    "未找到匹配的权重信息": { zh: "未找到匹配的权重信息", en: "No matching weight info found" }
};

// 节点翻译映射表 - Magic Klein Loader (FLUX.2 Klein)
const magicKleinLoaderTranslations = {
    "⚙️ 设置": { zh: "⚙️ 设置", en: "⚙️ Settings" },
    "📖 说明": { zh: "📖 说明", en: "📖 Help" },
    "未知": { zh: "未知", en: "Unknown" },
    "unknown": { zh: "未知", en: "unknown" },

    "⚙️ Magic Klein 设置": { zh: "⚙️ Magic Klein 设置", en: "⚙️ Magic Klein Settings" },
    "📦 环境状态": { zh: "📦 环境状态", en: "📦 Environment Status" },
    "nunchaku 包:": { zh: "nunchaku 包:", en: "nunchaku package:" },
    "transformer:": { zh: "transformer:", en: "transformer:" },
    "torch_transfer_utils:": { zh: "torch_transfer_utils:", en: "torch_transfer_utils:" },
    "wrappers/klein.py:": { zh: "wrappers/klein.py:", en: "wrappers/klein.py:" },
    "ComfyUI Python:": { zh: "ComfyUI Python:", en: "ComfyUI Python:" },

    "🔧 嵌入到环境": { zh: "🔧 嵌入到环境", en: "🔧 Install to Environment" },
    "KLEIN_EMBED_DESC": {
        zh: "独立安装包（pip）不包含 <code style='color:#a78bfa'>wrappers/klein.py</code>（ComfyUI 适配层），在已安装 nunchaku 且含 FLUX.2 运行库时，可点击下方按钮写入。",
        en: "The standalone pip package does not include <code style='color:#a78bfa'>wrappers/klein.py</code> (ComfyUI bridge). After nunchaku + FLUX.2 runtime are present, use the button below.",
    },
    "🔧 嵌入到 nunchaku 环境": { zh: "🔧 嵌入到 nunchaku 环境", en: "🔧 Install to nunchaku Environment" },
    "🔧 重新嵌入到 nunchaku 环境": { zh: "🔧 重新嵌入到 nunchaku 环境", en: "🔧 Re-install to nunchaku Environment" },
    "⏳ 安装中...": { zh: "⏳ 安装中...", en: "⏳ Installing..." },
    "正在写入文件...": { zh: "正在写入文件...", en: "Writing files..." },
    "✅ 安装成功！wrappers/klein.py 已写入。": {
        zh: "✅ 安装成功！wrappers/klein.py 已写入。",
        en: "✅ Done! wrappers/klein.py has been written.",
    },
    "❌ 安装失败: ": { zh: "❌ 安装失败: ", en: "❌ Failed: " },
    "❌ 请求失败: ": { zh: "❌ 请求失败: ", en: "❌ Request failed: " },

    "__klein_hint_nunchaku__": {
        zh: '请先安装 <strong>nunchaku</strong> 到 ComfyUI 正在使用的 Python（便携版一般为 <code style="color:#a78bfa;">python_embeded</code>）。官方安装文档：<a href="{{URL}}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">{{URL}}</a>',
        en: 'Install the <strong>nunchaku</strong> package into the same Python ComfyUI uses (portable: <code style="color:#a78bfa;">python_embeded</code>). Official guide: <a href="{{URL}}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">installation docs</a>',
    },
    "__klein_hint_official__": {
        zh: '若缺少 <code style="color:#a78bfa;">transformer_flux2</code> 或需对照环境，可参考官方 ComfyUI 插件仓库：<a href="{{GITHUB}}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">ComfyUI-nunchaku (GitHub)</a>',
        en: 'If <code style="color:#a78bfa;">transformer_flux2</code> is missing or you want to compare setups, see the official plugin: <a href="{{GITHUB}}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;">ComfyUI-nunchaku on GitHub</a>',
    },

    "🧠 支持的模型": { zh: "🧠 支持的模型", en: "🧠 Supported Models" },
    "量化模型": { zh: "量化模型", en: "Quantized Model" },
    "KLEIN_MODEL_CAPTION": {
        zh: "量化者：tonera | 量化方式：FP4/INT4（SVDQuant/Nunchaku）",
        en: "Quantized by: tonera | Method: FP4/INT4 (SVDQuant/Nunchaku)",
    },

    "📖 Magic Klein 说明": { zh: "📖 Magic Klein 说明", en: "📖 Magic Klein Documentation" },
    "🔮 Magic Nunchaku FLUX.2 Klein Loader": {
        zh: "🔮 Magic Nunchaku FLUX.2 Klein Loader",
        en: "🔮 Magic Nunchaku FLUX.2 Klein Loader",
    },
    "KLEIN_INFO_INTRO": {
        zh: "独立于官方 ComfyUI-nunchaku 的节点，用于加载 <strong>FLUX.2 Klein</strong> 量化模型。即使删除官方节点或卸载 pip 包，本节点仍可通过嵌入方式使用。",
        en: "A standalone node for loading <strong>FLUX.2 Klein</strong> quantized models, independent of the official ComfyUI-nunchaku node. It still works via embedding even if the official node or pip package is removed.",
    },
    "支持的模型": { zh: "支持的模型", en: "Supported Models" },
    "KLEIN_MODEL_LINE2": {
        zh: "量化方式：FP4/INT4（由 tonera 使用 SVDQuant/Nunchaku 量化）",
        en: "Quantization: FP4/INT4 by tonera using SVDQuant/Nunchaku",
    },
    "首次使用步骤": { zh: "首次使用步骤", en: "First-Time Setup" },
    "KLEIN_STEP1": {
        zh: "下载量化后的 safetensors 文件（如 <code style=\"color:#a78bfa;\">svdq-fp4_r32-FLUX.2-klein-9B-Nunchaku.safetensors</code>）",
        en: "Download the quantized safetensors file (e.g. <code style=\"color:#a78bfa;\">svdq-fp4_r32-FLUX.2-klein-9B-Nunchaku.safetensors</code>)",
    },
    "KLEIN_STEP2": {
        zh: "放入 ComfyUI 的 <code style=\"color:#a78bfa;\">models/diffusion_models/</code> 目录",
        en: "Place it in ComfyUI's <code style=\"color:#a78bfa;\">models/diffusion_models/</code> folder",
    },
    "KLEIN_STEP3": {
        zh: "点击节点上的 <strong>⚙️ 设置</strong> → <strong>嵌入到 nunchaku 环境</strong>",
        en: "Click <strong>⚙️ Settings</strong> on this node → <strong>Install to nunchaku Environment</strong>",
    },
    "KLEIN_STEP4": { zh: "重新加载 ComfyUI 即可正常使用", en: "Reload ComfyUI and use normally" },
    "量化说明（来自 HuggingFace）": { zh: "量化说明（来自 HuggingFace）", en: "Quantization Quality (from HuggingFace)" },
    "指标": { zh: "指标", en: "Metric" },
    "KLEIN_LICENSE_NOTE": {
        zh: "License: FLUX Non-Commercial License（详见 HuggingFace 页面）",
        en: "License: FLUX Non-Commercial License (see HuggingFace model page)",
    },
};

// 所有翻译映射（按节点分类）
const allTranslations = {
    "MagicPowerLoraLoader": loraLoaderTranslations,
    "MagicLogicCompute": logicComputeTranslations,
    "MagicPhotopeaNode": photopeaTranslations,
    "MagicResolutionResize": resizeTranslations,
    "MagicResolution": resizeTranslations,
    "MagicPromptReplace": promptReplaceTranslations,
    "MagicSDNQLoader": sdnqTranslations,
    "MagicSDNQSampler": sdnqTranslations,
    "MagicCache": cacheTranslations,
    "MagicPromptBox": magicPromptBoxTranslations,
    "MagicKleinLoader": magicKleinLoaderTranslations
};

// 翻译缓存（避免重复查找）
const translationCache = new Map();

// 获取翻译文本
function getTranslation(key, lang, nodeType = null) {
    // 先检查缓存
    const cacheKey = `${key}_${lang}_${nodeType || ''}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }
    
    // 查找翻译
    let translation = key; // 默认返回原文
    
    // 首先尝试直接匹配
    if (nodeType && allTranslations[nodeType]) {
        const nodeTranslations = allTranslations[nodeType];
        if (nodeTranslations[key] && nodeTranslations[key][lang]) {
            translation = nodeTranslations[key][lang];
        }
    } else {
        // 如果没有指定节点类型，遍历所有翻译表
        for (const nodeTypeKey in allTranslations) {
            const nodeTranslations = allTranslations[nodeTypeKey];
            if (nodeTranslations[key] && nodeTranslations[key][lang]) {
                translation = nodeTranslations[key][lang];
                break;
            }
        }
    }
    
    // 如果直接匹配失败，尝试反向查找（从英文找中文，或从中文找英文）
    if (translation === key) {
        const targetLang = lang === "zh" ? "en" : "zh";
        if (nodeType && allTranslations[nodeType]) {
            const nodeTranslations = allTranslations[nodeType];
            // 遍历所有键，找到目标语言匹配的，然后返回当前语言的翻译
            for (const translationKey in nodeTranslations) {
                if (nodeTranslations[translationKey][targetLang] === key) {
                    translation = nodeTranslations[translationKey][lang];
                    break;
                }
            }
        } else {
            // 遍历所有翻译表
            for (const nodeTypeKey in allTranslations) {
                const nodeTranslations = allTranslations[nodeTypeKey];
                for (const translationKey in nodeTranslations) {
                    if (nodeTranslations[translationKey][targetLang] === key) {
                        translation = nodeTranslations[translationKey][lang];
                        break;
                    }
                }
                if (translation !== key) break;
            }
        }
    }
    
    // 缓存结果
    translationCache.set(cacheKey, translation);
    return translation;
}

// 翻译文本（智能匹配，支持动态文本）
function translateText(text, lang, nodeType = null) {
    if (!text || typeof text !== 'string') return text;
    
    const textTrimmed = text.trim();
    
    // 安全检查：跳过URL、路径、文件名、IP地址等不应该翻译的内容
    if (textTrimmed.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|file:\/\/|127\.0\.0\.1|localhost)/i) ||
        textTrimmed.match(/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/i) ||
        textTrimmed.match(/^\/[a-zA-Z]/) && textTrimmed.length < 50) { // 看起来像路径
        return text; // 不翻译URL和路径
    }
    
    // 精确匹配（先尝试trim后的文本）
    let translated = getTranslation(textTrimmed, lang, nodeType);
    if (translated !== textTrimmed) return translated;
    
    // 如果trim后匹配失败，尝试规范化空格后再匹配（将多个空格/换行符替换为单个空格）
    const normalizedText = textTrimmed.replace(/\s+/g, ' ').trim();
    if (normalizedText !== textTrimmed) {
        translated = getTranslation(normalizedText, lang, nodeType);
        if (translated !== normalizedText) return translated;
    }
    
    // 尝试规范化引号（将各种引号统一为标准引号，用于匹配）
    const normalizedQuotes = textTrimmed
        .replace(/[""]/g, '"')  // 将各种引号统一为双引号
        .replace(/['']/g, "'")  // 将各种单引号统一为单引号
        .replace(/\s+/g, ' ')
        .trim();
    if (normalizedQuotes !== textTrimmed && normalizedQuotes !== normalizedText) {
        translated = getTranslation(normalizedQuotes, lang, nodeType);
        if (translated !== normalizedQuotes) return translated;
    }
    
    // 尝试规范化标点符号（将英文逗号/分号替换为中文逗号/分号，用于匹配）
    const normalizedPunctuation = textTrimmed
        .replace(/,/g, '，')
        .replace(/;/g, '；')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalizedPunctuation !== textTrimmed && normalizedPunctuation !== normalizedText && normalizedPunctuation !== normalizedQuotes) {
        translated = getTranslation(normalizedPunctuation, lang, nodeType);
        if (translated !== normalizedPunctuation) return translated;
    }
    
    // 尝试去掉所有空格（用于匹配不带空格的变体）
    const noSpacesText = textTrimmed.replace(/\s+/g, '');
    if (noSpacesText !== textTrimmed && noSpacesText.length > 0) {
        translated = getTranslation(noSpacesText, lang, nodeType);
        if (translated !== noSpacesText) {
            // 如果匹配成功，需要恢复空格结构（简单处理：在标点符号后添加空格）
            return translated.replace(/([，。；：])/g, '$1 ').trim();
        }
    }
    
    // 处理动态文本（如"已选择 5 个 LoRA"）
    // 匹配模式：已选择 + 数字 + 个 LoRA
    const dynamicMatch = text.match(/^已选择\s*(\d+)\s*个\s*LoRA$/i);
    if (dynamicMatch) {
        const count = dynamicMatch[1];
        if (lang === "en") {
            return `${count} LoRAs selected`;
        }
        // 中文保持原样
        return text;
    }
    
    // 处理"已选择 X 个 LoRA"（带空格变体）
    const dynamicMatch2 = text.match(/^已选择\s+(\d+)\s+个\s+LoRA$/i);
    if (dynamicMatch2) {
        const count = dynamicMatch2[1];
        if (lang === "en") {
            return `${count} LoRAs selected`;
        }
        return text;
    }
    
    // 处理动态alert文本：`LoRA 'xxx' 的内容已保存到 xxx！`
    const saveSuccessMatch = text.match(/^LoRA\s+'([^']+)'\s+的内容已保存到\s+(.+?)\s*！$/);
    if (saveSuccessMatch) {
        const loraName = saveSuccessMatch[1];
        const target = saveSuccessMatch[2];
        if (lang === "en") {
            // 翻译target部分
            const targetTranslated = translateText(target, lang, nodeType);
            return `LoRA '${loraName}'${getTranslation(" 的内容已保存到 ", lang, nodeType)}${targetTranslated}${getTranslation("！", lang, nodeType)}`;
        }
        return text;
    }
    
    // 处理Photopea动态文本：`🗑️ 删除选中 (${count})`
    const deleteSelectedMatch = text.match(/^🗑️\s*删除选中\s*\((\d+)\)$/);
    if (deleteSelectedMatch) {
        const count = deleteSelectedMatch[1];
        if (lang === "en") {
            return `🗑️ Delete Selected (${count})`;
        }
        return text;
    }
    
    // 处理Photopea动态文本：`待删: ${count} 张`
    const toDeleteMatch = text.match(/^待删:\s*(\d+)\s*张$/);
    if (toDeleteMatch) {
        const count = toDeleteMatch[1];
        if (lang === "en") {
            return `To Delete: ${count} images`;
        }
        return text;
    }
    
    // 处理Photopea动态文本：`确定要永久删除这 ${count} 张图片吗？`
    const deleteConfirmMatch = text.match(/^⚠️\s*高能预警\s*\n\n确定要永久删除这\s*(\d+)\s*张图片吗？\s*\n\(固定的图片很安全，不会被删除\)$/);
    if (deleteConfirmMatch) {
        const count = deleteConfirmMatch[1];
        if (lang === "en") {
            return `⚠️ Warning\n\nAre you sure you want to permanently delete these ${count} images?\n(Pinned images are safe and will not be deleted)`;
        }
        return text;
    }
    
    // 处理Photopea动态文本：`确定删除 ${filename} 吗？`
    const deleteFileMatch = text.match(/^确定删除\s+(.+?)\s*吗？$/);
    if (deleteFileMatch) {
        const filename = deleteFileMatch[1];
        if (lang === "en") {
            return `Are you sure you want to delete ${filename}?`;
        }
        return text;
    }
    
    // 处理Resize/Resolution动态文本：`删除 ${val}?`
    const deleteValMatch = text.match(/^删除\s+(.+?)\s*\?$/);
    if (deleteValMatch) {
        const val = deleteValMatch[1];
        if (lang === "en") {
            return `Delete ${val}?`;
        }
        return text;
    }
    
    // 处理Prompt Replace动态文本：`Delete ${name}?`
    const deleteProfileMatch = text.match(/^Delete\s+(.+?)\s*\?$/);
    if (deleteProfileMatch && nodeType === "MagicPromptReplace") {
        const name = deleteProfileMatch[1];
        if (lang === "zh") {
            return `删除 ${name}?`;
        }
        return text;
    }
    
    // 处理Prompt Replace动态文本：`Found ${count} models!`
    const foundModelsMatch = text.match(/^Found\s+(\d+)\s+models!$/);
    if (foundModelsMatch) {
        const count = foundModelsMatch[1];
        if (lang === "zh") {
            return `找到 ${count} 个模型！`;
        }
        return text;
    }
    
    // 处理预设名称动态文本：`确定要删除预设 "xxx" 吗？`
    const deletePresetMatch = text.match(/^确定要删除预设\s+"([^"]+)"\s*吗？$/);
    if (deletePresetMatch) {
        const presetName = deletePresetMatch[1];
        if (lang === "en") {
            return `Are you sure you want to delete preset "${presetName}"?`;
        }
        return text;
    }
    
    // 尝试部分匹配（处理动态文本，如"编辑 LoRA 内容: xxx"）
    // 按长度从长到短排序，优先匹配更长的文本
    const searchTranslations = nodeType && allTranslations[nodeType] ? allTranslations[nodeType] : {};
    const sortedKeys = Object.keys(searchTranslations).sort((a, b) => b.length - a.length);
    
    for (const key of sortedKeys) {
        if (text.includes(key)) {
            const nodeTranslations = searchTranslations;
            if (nodeTranslations[key] && nodeTranslations[key][lang]) {
                translated = text.replace(key, nodeTranslations[key][lang]);
                if (translated !== text) return translated;
            }
        }
    }
    
    // 全局搜索（也按长度排序）
    for (const nodeTypeKey in allTranslations) {
        const nodeTranslations = allTranslations[nodeTypeKey];
        const sortedGlobalKeys = Object.keys(nodeTranslations).sort((a, b) => b.length - a.length);
        for (const key of sortedGlobalKeys) {
            if (text.includes(key)) {
                if (nodeTranslations[key] && nodeTranslations[key][lang]) {
                    translated = text.replace(key, nodeTranslations[key][lang]);
                    if (translated !== text) return translated;
                }
            }
        }
    }
    
    return text;
}

// 获取当前语言
function getCurrentLanguage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_LANGUAGE);
        return stored || DEFAULT_LANGUAGE;
    } catch (e) {
        return DEFAULT_LANGUAGE;
    }
}

// 保存语言设置
function saveLanguage(lang) {
    try {
        localStorage.setItem(STORAGE_KEY_LANGUAGE, lang);
    } catch (e) {
        console.error("Failed to save language:", e);
    }
}

// 创建悬浮球
function createLanguageSwitcher() {
    // 检查是否已存在
    if (document.getElementById("magic-language-switcher")) {
        console.log("[Language Switcher] Switcher already exists");
        return;
    }

    console.log("[Language Switcher] Creating new switcher...");
    const currentLang = getCurrentLanguage();
    
    // 创建悬浮球容器
    const switcher = document.createElement("div");
    switcher.id = "magic-language-switcher";
    switcher.style.cssText = `
        position: fixed;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
        cursor: move;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        transition: all 0.3s ease;
        user-select: none;
        opacity: 0.7;
        top: 100px;
        right: 100px;
    `;

    // 文字
    const text = document.createElement("div");
    text.textContent = "Language";
    text.style.cssText = `
        color: white;
        font-size: 11px;
        font-weight: bold;
        text-align: center;
        pointer-events: none;
        font-family: sans-serif;
    `;
    switcher.appendChild(text);

    // 拖动状态
    let isDragging = false;
    let isHovering = false;
    let offsetX = 0;
    let offsetY = 0;
    let clickStartTime = 0;
    let clickStartPos = { x: 0, y: 0 };
    let hasMoved = false;
    let animationFrameId = null;

    // 更新菜单位置（跟随悬浮球）
    function updateMenuPosition() {
        const menu = document.getElementById("magic-language-menu");
        if (!menu) return;
        
        const rect = switcher.getBoundingClientRect();
        let menuLeft = rect.left + rect.width + 10;
        let menuTop = rect.top;
        
        // 先设置位置，再检查是否超出屏幕
        menu.style.left = menuLeft + "px";
        menu.style.top = menuTop + "px";
        
        // 确保菜单不超出屏幕（需要先设置位置才能获取正确的尺寸）
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            let finalLeft = menuLeft;
            let finalTop = menuTop;
            
            if (menuLeft + menuRect.width > window.innerWidth) {
                finalLeft = rect.left - menuRect.width - 10;
            }
            if (menuTop + menuRect.height > window.innerHeight) {
                finalTop = window.innerHeight - menuRect.height - 10;
            }
            
            menu.style.left = finalLeft + "px";
            menu.style.top = finalTop + "px";
        });
    }

    // 优化拖动性能 - 使用requestAnimationFrame
    function updatePosition(e) {
        if (!isDragging) return;
        
        cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(() => {
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;
            
            // 限制在窗口内
            const maxX = window.innerWidth - switcher.offsetWidth;
            const maxY = window.innerHeight - switcher.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            switcher.style.left = newX + "px";
            switcher.style.top = newY + "px";
            
            // 如果菜单打开，更新菜单位置
            updateMenuPosition();
        });
    }

    // 鼠标按下
    switcher.addEventListener("mousedown", (e) => {
        clickStartTime = Date.now();
        clickStartPos = { x: e.clientX, y: e.clientY };
        hasMoved = false;
        
        isDragging = true;
        const rect = switcher.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        // 拖动时发光效果
        switcher.style.opacity = "1";
        switcher.style.boxShadow = "0 0 30px rgba(102, 126, 234, 0.8), 0 0 60px rgba(118, 75, 162, 0.6)";
        switcher.style.transform = "scale(1.1)";
        switcher.style.transition = "none"; // 拖动时禁用过渡动画
        e.preventDefault();
    });

    // 鼠标移动 - 优化性能
    const handleMouseMove = (e) => {
        if (isDragging) {
            // 检查是否移动了
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - clickStartPos.x, 2) + 
                Math.pow(e.clientY - clickStartPos.y, 2)
            );
            if (moveDistance > 3) {
                hasMoved = true;
            }
            
            updatePosition(e);
        }
    };

    document.addEventListener("mousemove", handleMouseMove);

    // 鼠标释放
    document.addEventListener("mouseup", (e) => {
        if (isDragging) {
            isDragging = false;
            cancelAnimationFrame(animationFrameId);
            
            // 恢复过渡动画
            switcher.style.transition = "all 0.3s ease";
            
            // 检查是否是点击（不是拖动）
            const clickDuration = Date.now() - clickStartTime;
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - clickStartPos.x, 2) + 
                Math.pow(e.clientY - clickStartPos.y, 2)
            );
            
            // 如果是点击（时间短且移动距离小），显示菜单
            if (!hasMoved && clickDuration < 300 && moveDistance < 5) {
                e.stopPropagation();
                showLanguageMenu(switcher);
            }
            
            // 恢复普通状态
            if (!isHovering) {
                switcher.style.opacity = "0.7";
                switcher.style.boxShadow = "0 4px 15px rgba(102, 126, 234, 0.4)";
            }
            switcher.style.transform = "scale(1)";
            
            // 保存位置
            saveSwitcherPosition(switcher.style.left, switcher.style.top);
        }
    });

    // 鼠标悬停
    switcher.addEventListener("mouseenter", () => {
        isHovering = true;
        if (!isDragging) {
            switcher.style.opacity = "0.9";
            switcher.style.boxShadow = "0 6px 20px rgba(102, 126, 234, 0.6)";
        }
    });

    switcher.addEventListener("mouseleave", () => {
        isHovering = false;
        if (!isDragging) {
            switcher.style.opacity = "0.7";
            switcher.style.boxShadow = "0 4px 15px rgba(102, 126, 234, 0.4)";
        }
    });

    // 加载保存的位置
    loadSwitcherPosition(switcher);

    // 确保body存在后再添加
    if (document.body) {
        document.body.appendChild(switcher);
        console.log("[Language Switcher] Switcher appended to body");
    } else {
        console.error("[Language Switcher] document.body is not available, retrying...");
        setTimeout(() => {
            if (document.body) {
                document.body.appendChild(switcher);
                console.log("[Language Switcher] Switcher appended to body (retry)");
            } else {
                console.error("[Language Switcher] Failed to append switcher - body still not available");
            }
        }, 100);
    }
    
    // 初始化应用语言
    updateLanguage(currentLang);
}

// 显示语言选择菜单
function showLanguageMenu(switcher) {
    // 如果菜单已存在，先移除
    const existingMenu = document.getElementById("magic-language-menu");
    if (existingMenu) {
        existingMenu.remove();
        return;
    }

    const currentLang = getCurrentLanguage();
    const rect = switcher.getBoundingClientRect();
    
    // 创建菜单
    const menu = document.createElement("div");
    menu.id = "magic-language-menu";
    menu.style.cssText = `
        position: fixed;
        left: ${rect.left + rect.width + 10}px;
        top: ${rect.top}px;
        background: #2a2a2a;
        border: 1px solid #555;
        border-radius: 8px;
        padding: 8px 0;
        min-width: 150px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.8);
        z-index: 10000;
        font-family: sans-serif;
    `;

    // 菜单标题
    const title = document.createElement("div");
    title.textContent = "魔法助手语言设置 / Magic Assistant Language Settings";
    title.style.cssText = `
        padding: 8px 16px;
        color: #ccc;
        font-size: 12px;
        border-bottom: 1px solid #444;
        margin-bottom: 4px;
    `;
    menu.appendChild(title);

    // 中文选项
    const zhOption = document.createElement("div");
    zhOption.textContent = "中文 (Chinese)";
    zhOption.style.cssText = `
        padding: 10px 16px;
        color: ${currentLang === "zh" ? "#4CAF50" : "#fff"};
        font-size: 14px;
        cursor: pointer;
        background: ${currentLang === "zh" ? "#1a3a1a" : "transparent"};
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    if (currentLang === "zh") {
        const check = document.createElement("span");
        check.textContent = "✓";
        check.style.cssText = "color: #4CAF50; font-weight: bold;";
        zhOption.insertBefore(check, zhOption.firstChild);
    }
    
    zhOption.addEventListener("mouseenter", () => {
        if (currentLang !== "zh") {
            zhOption.style.background = "#333";
        }
    });
    zhOption.addEventListener("mouseleave", () => {
        if (currentLang !== "zh") {
            zhOption.style.background = "transparent";
        }
    });
    zhOption.addEventListener("click", () => {
        if (currentLang !== "zh") {
            saveLanguage("zh");
            updateLanguage("zh");
            menu.remove();
            if (switcher._languageMenu) {
                switcher._languageMenu = null;
            }
        }
    });
    menu.appendChild(zhOption);

    // 英文选项
    const enOption = document.createElement("div");
    enOption.textContent = "English (英文)";
    enOption.style.cssText = `
        padding: 10px 16px;
        color: ${currentLang === "en" ? "#4CAF50" : "#fff"};
        font-size: 14px;
        cursor: pointer;
        background: ${currentLang === "en" ? "#1a3a1a" : "transparent"};
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    if (currentLang === "en") {
        const check = document.createElement("span");
        check.textContent = "✓";
        check.style.cssText = "color: #4CAF50; font-weight: bold;";
        enOption.insertBefore(check, enOption.firstChild);
    }
    
    enOption.addEventListener("mouseenter", () => {
        if (currentLang !== "en") {
            enOption.style.background = "#333";
        }
    });
    enOption.addEventListener("mouseleave", () => {
        if (currentLang !== "en") {
            enOption.style.background = "transparent";
        }
    });
    enOption.addEventListener("click", () => {
        if (currentLang !== "en") {
            saveLanguage("en");
            updateLanguage("en");
            menu.remove();
            if (switcher._languageMenu) {
                switcher._languageMenu = null;
            }
        }
    });
    menu.appendChild(enOption);

    // 调整菜单位置，确保不超出屏幕
    document.body.appendChild(menu);
    
    // 初始位置调整
    const menuRect = menu.getBoundingClientRect();
    let menuLeft = rect.left + rect.width + 10;
    let menuTop = rect.top;
    
    if (menuLeft + menuRect.width > window.innerWidth) {
        menuLeft = rect.left - menuRect.width - 10;
    }
    if (menuTop + menuRect.height > window.innerHeight) {
        menuTop = window.innerHeight - menuRect.height - 10;
    }
    
    menu.style.left = menuLeft + "px";
    menu.style.top = menuTop + "px";
    
    // 将菜单引用保存到悬浮球，方便拖动时更新
    switcher._languageMenu = menu;

    // 点击外部关闭菜单
    const closeMenu = (e) => {
        if (!menu.contains(e.target) && e.target !== switcher && !switcher.contains(e.target)) {
            menu.remove();
            if (switcher._languageMenu) {
                switcher._languageMenu = null;
            }
            document.removeEventListener("click", closeMenu);
        }
    };
    
    // 延迟添加事件监听，避免立即触发
    setTimeout(() => {
        document.addEventListener("click", closeMenu);
    }, 100);
}

// 保存悬浮球位置
function saveSwitcherPosition(left, top) {
    try {
        localStorage.setItem("magic_language_switcher_pos", JSON.stringify({ left, top }));
    } catch (e) {
        console.error("Failed to save switcher position:", e);
    }
}

// 加载悬浮球位置
function loadSwitcherPosition(switcher) {
    try {
        const stored = localStorage.getItem("magic_language_switcher_pos");
        if (stored) {
            const pos = JSON.parse(stored);
            if (pos.left && pos.top) {
                switcher.style.left = pos.left;
                switcher.style.top = pos.top;
            }
        }
    } catch (e) {
        console.error("Failed to load switcher position:", e);
    }
}

// 节点翻译映射表
const nodeTranslations = {
    // 节点1: Magic Photopea Node
    "MagicPhotopeaNode": {
        zh: "🎨 Photopea图像处理 Photopea Processing & Load Image",
        en: "🎨 Photopea Image Processing & Load Image"
    },
    // 节点2: Magic Prompt Replace
    "MagicPromptReplace": {
        zh: "✨ 多功能AI提示词替换 Magic Multi-Function AI Prompt Replace",
        en: "✨ Magic Multi-Function AI Prompt Replace"
    },
    // 节点3: Magic Logic Compute
    "MagicLogicCompute": {
        zh: "🧠 可自己编辑算法的逻辑计算 (带教程版) Magic Programmable Logic & Calc (Tutorial)",
        en: "🧠 Magic Programmable Logic & Calc (Tutorial)"
    },
    // 节点4: Magic Resolution Resize
    "MagicResolutionResize": {
        zh: "📏 多功能图像缩放 Magic Multi-Function Image Resize",
        en: "📏 Magic Multi-Function Image Resize"
    },
    // 节点5: Magic Universal Switch
    "MagicUniversalSwitch": {
        zh: "🎛️ 万能禁用/忽略多框 Magic Multi-Group Switch",
        en: "🎛️ Magic Multi-Group Switch"
    },
    // 节点6: Magic Prompt Box
    "MagicPromptBox": {
        zh: "📝 多功能提示词框 Magic Multi-Function Prompt Box",
        en: "📝 Magic Multi-Function Prompt Box"
    },
    // 节点7: Magic Power LoRA Loader
    "MagicPowerLoraLoader": {
        zh: "🚀 强力lora加载器 Magic Power LoRA Loader",
        en: "🚀 Magic Power LoRA Loader"
    },
    // 节点8: Magic Resolution
    "MagicResolution": {
        zh: "📐 分辨率输出器 Magic Resolution Output",
        en: "📐 Magic Resolution Output"
    },
    // 节点9: Magic SDNQ Loader
    "MagicSDNQLoader": {
        zh: "📦 SDNQ模型加载器 Magic SDNQ Model Loader",
        en: "📦 Magic SDNQ Model Loader"
    },
    // 节点10: Magic SDNQ K Sampler
    "MagicSDNQSampler": {
        zh: "🎲 SDNQ K采样器 Magic SDNQ K Sampler",
        en: "🎲 Magic SDNQ K Sampler"
    }
};

// 更新单个节点的显示名称 - 已禁用，因为节点名是双语的且用户可以自定义
function updateNodeTitle(node, lang) {
    // 不再翻译节点名字，因为：
    // 1. 节点名一开始就是双语都有的
    // 2. 节点名字用户可以自定义，翻译会导致显示错误
    return;
}

// 更新所有节点的显示名称
function updateLanguage(lang) {
    // 更新所有UI文本（不包括节点标题，因为节点名是双语的且用户可以自定义）
    updateAllUITexts(lang);
    
    // 清除翻译缓存（强制重新翻译）
    translationCache.clear();
    
    // 触发重绘
    if (app && app.graph && app.graph.setDirtyCanvas) {
        app.graph.setDirtyCanvas(true, true);
    }
}

// 监听节点创建事件，自动应用当前语言
let nodeCreatedHandler = null;
function setupNodeLanguageListener() {
    if (nodeCreatedHandler) return;
    
    // 等待 app.graph 可用
    if (!app || !app.graph) {
        setTimeout(() => setupNodeLanguageListener(), 500);
        return;
    }
    
    try {
        const originalOnNodeCreated = app.graph.onNodeCreated;
        app.graph.onNodeCreated = function(node) {
            const result = originalOnNodeCreated ? originalOnNodeCreated.call(this, node) : undefined;
            
            // 延迟更新，确保节点完全创建
            setTimeout(() => {
                try {
                    const currentLang = getCurrentLanguage();
                    updateNodeTitle(node, currentLang);
                } catch (e) {
                    console.error("[Language Switcher] Error updating node title:", e);
                }
            }, 100);
            
            return result;
        };
        
        nodeCreatedHandler = true;
    } catch (e) {
        console.error("[Language Switcher] Error setting up node language listener:", e);
    }
}

// 翻译拦截系统 - 使用MutationObserver监听DOM变化
let translationObserver = null;
let translationInterceptorActive = false;
const TRANSLATED_MARKER = 'data-magic-translated'; // 翻译标记，避免重复翻译

// 拦截原生对话框
let nativeDialogIntercepted = false;
const originalAlert = window.alert;
const originalConfirm = window.confirm;
const originalPrompt = window.prompt;

function interceptNativeDialogs() {
    if (nativeDialogIntercepted) return;
    nativeDialogIntercepted = true;
    
    // 拦截 alert
    window.alert = function(message) {
        const currentLang = getCurrentLanguage();
        const translated = translateText(String(message), currentLang, "MagicPowerLoraLoader");
        return originalAlert.call(this, translated);
    };
    
    // 拦截 confirm
    window.confirm = function(message) {
        const currentLang = getCurrentLanguage();
        const translated = translateText(String(message), currentLang, "MagicPowerLoraLoader");
        return originalConfirm.call(this, translated);
    };
    
    // 拦截 prompt
    window.prompt = function(message, defaultText) {
        const currentLang = getCurrentLanguage();
        const translated = translateText(String(message), currentLang, "MagicPowerLoraLoader");
        return originalPrompt.call(this, translated, defaultText);
    };
}

// 立即翻译元素（供外部调用）
function translateElementImmediately(element) {
    if (!element) return;
    const currentLang = getCurrentLanguage();
    
    // 清除翻译标记，强制重新翻译
    if (element.hasAttribute && element.hasAttribute(TRANSLATED_MARKER)) {
        element.removeAttribute(TRANSLATED_MARKER);
    }
    
    // 立即翻译（nodeType会自动检测）
    translateElementRecursive(element, currentLang);
    
    // 如果元素有子元素，也翻译它们
    if (element.querySelectorAll) {
        const allChildren = element.querySelectorAll('*');
        allChildren.forEach(child => {
            if (child.hasAttribute && child.hasAttribute(TRANSLATED_MARKER)) {
                child.removeAttribute(TRANSLATED_MARKER);
            }
            translateElementRecursive(child, currentLang);
        });
    }
}

// 拦截 appendChild 方法，在弹窗添加到DOM后立即翻译
function interceptAppendChild() {
    if (window._appendChildIntercepted) return;
    window._appendChildIntercepted = true;
    
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(child) {
        const result = originalAppendChild.call(this, child);
        
        // 检查是否是添加到body的固定定位元素（通常是弹窗）
        if (this === document.body && child && child.nodeType === Node.ELEMENT_NODE) {
            // 立即检查样式（如果已设置）
            const checkAndTranslate = () => {
                try {
                    const style = window.getComputedStyle(child);
                    if (style.position === 'fixed' || style.position === 'absolute') {
                        // 检查是否包含LoRA相关文本
                        if (isLoraNodeElement(child)) {
                            translateElementImmediately(child);
                            
                            // 特别处理LABEL元素（checkbox/radio标签）
                            // 立即翻译一次，然后延迟再翻译一次（确保捕获所有label）
                            const translateLabels = () => {
                                const labels = child.querySelectorAll('label');
                                labels.forEach(label => {
                                    const currentLang = getCurrentLanguage();
                                    let detectedNodeType = "MagicPowerLoraLoader";
                                    const parentText = label.textContent || '';
                                    if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor') ||
                                        parentText.includes('脚本') || parentText.includes('Script') || parentText.includes('Magic Script')) {
                                        detectedNodeType = "MagicLogicCompute";
                                    } else if (parentText.includes('打开图库') || parentText.includes('Open Gallery') || 
                                              parentText.includes('打开编辑器') || parentText.includes('Open Editor') ||
                                              parentText.includes('Photopea') || parentText.includes('Magic Gallery') ||
                                              parentText.includes('批量管理') || parentText.includes('Batch Manage')) {
                                        detectedNodeType = "MagicPhotopeaNode";
                                    } else if (parentText.includes('管理预设') || parentText.includes('Manage Presets') ||
                                              parentText.includes('预设管理中心') || parentText.includes('Preset Management Center') ||
                                              parentText.includes('长边数值') || parentText.includes('Long Edge Values') ||
                                              parentText.includes('尺寸组合') || parentText.includes('Dimension Presets') ||
                                              parentText.includes('交换宽高') || parentText.includes('Swap W/H') ||
                                              parentText.includes('Magic Resize') || parentText.includes('Magic Resolution')) {
                                        detectedNodeType = "MagicResolutionResize";
                                    } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                                        detectedNodeType = "MagicKleinLoader";
                                    } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                              parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                              parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                              parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                              parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                        detectedNodeType = "MagicPromptReplace";
                                    } else if (parentText.includes('SDNQ') || parentText.includes('降噪') || parentText.includes('预览方式') ||
                                              parentText.includes('SDNQ Model') || parentText.includes('SDNQ Sampler')) {
                                        detectedNodeType = parentText.includes('Sampler') || parentText.includes('采样') ? "MagicSDNQSampler" : "MagicSDNQLoader";
                                    } else if (parentText.includes('Magic Cache') || parentText.includes('TeaCache') || parentText.includes('FBCache') ||
                                              parentText.includes('本节点新增支持') || parentText.includes('已修改源项目代码')) {
                                        detectedNodeType = "MagicCache";
                                    } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                                              parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('Tag Preview') ||
                                              parentText.includes('标签搜索') || parentText.includes('Tag Search') || parentText.includes('运行历史') ||
                                              parentText.includes('历史收藏') || parentText.includes('格式化') || parentText.includes('去重') ||
                                              parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                                        detectedNodeType = "MagicPromptBox";
                                    }
                                    
                                    Array.from(label.childNodes).forEach(node => {
                                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                                            const nodeText = node.textContent.trim();
                                            if (!nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                                                !nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                                                const translated = translateText(nodeText, currentLang, detectedNodeType);
                                                if (translated !== nodeText) {
                                                    node.textContent = translated;
                                                    label.setAttribute(TRANSLATED_MARKER, currentLang);
                                                }
                                            }
                                        }
                                    });
                                });
                            };
                            
                            // 立即翻译一次
                            translateLabels();
                            
                            // 延迟再翻译一次，确保捕获所有动态创建的label（如"模型介绍信息"、"预览图像"、"默认权重下载"）
                            setTimeout(translateLabels, 50);
                            setTimeout(translateLabels, 150);
                        }
                    }
                } catch (e) {
                    // 如果样式还没设置，延迟检查
                    setTimeout(checkAndTranslate, 10);
                }
            };
            
            // 立即检查一次
            checkAndTranslate();
            
            // 也延迟检查一次，确保元素完全创建
            setTimeout(checkAndTranslate, 50);
        }
        
        // 检查是否是文本节点被添加到LABEL元素（弹窗中的checkbox/radio标签）
        if (child && child.nodeType === Node.TEXT_NODE && this.nodeType === Node.ELEMENT_NODE) {
            if (this.tagName === 'LABEL') {
                // 检查是否是LoRA或Logic节点相关的元素
                // 检查父元素是否是弹窗或包含LoRA相关文本
                let isRelevant = false;
                if (isLoraNodeElement(this)) {
                    isRelevant = true;
                } else {
                    // 检查父元素（向上查找）
                    let parent = this.parentElement;
                    let depth = 0;
                    while (parent && depth < 5) {
                        if (isLoraNodeElement(parent)) {
                            isRelevant = true;
                            break;
                        }
                        const style = window.getComputedStyle(parent);
                        if (style.position === 'fixed' || style.position === 'absolute') {
                            // 可能是弹窗，检查内容
                            if (parent.textContent && (
                                parent.textContent.includes('LoRA') || 
                                parent.textContent.includes('Lora') ||
                                parent.textContent.includes('Fetch') ||
                                parent.textContent.includes('爬取') ||
                                parent.textContent.includes('下载') ||
                                parent.textContent.includes('Download') ||
                                parent.textContent.includes('模型介绍信息') ||
                                parent.textContent.includes('预览图像') ||
                                parent.textContent.includes('默认权重下载') ||
                                parent.textContent.includes('Model Info') ||
                                parent.textContent.includes('Preview Image') ||
                                parent.textContent.includes('Default Weight')
                            )) {
                                isRelevant = true;
                                break;
                            }
                        }
                        parent = parent.parentElement;
                        depth++;
                    }
                }
                
                if (isRelevant) {
                    // 立即翻译，不延迟
                    const currentLang = getCurrentLanguage();
                    if (currentLang === "en") {
                        const nodeText = child.textContent.trim();
                        if (nodeText && /[\u4e00-\u9fa5]/.test(nodeText)) {
                            // 确定节点类型
                            let detectedNodeType = "MagicPowerLoraLoader";
                            const parentText = this.textContent || '';
                            if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor') ||
                                parentText.includes('脚本') || parentText.includes('Script') || parentText.includes('Magic Script')) {
                                detectedNodeType = "MagicLogicCompute";
                            } else if (parentText.includes('打开图库') || parentText.includes('Open Gallery') || 
                                      parentText.includes('打开编辑器') || parentText.includes('Open Editor') ||
                                      parentText.includes('Photopea') || parentText.includes('Magic Gallery') ||
                                      parentText.includes('批量管理') || parentText.includes('Batch Manage')) {
                                detectedNodeType = "MagicPhotopeaNode";
                            } else if (parentText.includes('管理预设') || parentText.includes('Manage Presets') ||
                                      parentText.includes('预设管理中心') || parentText.includes('Preset Management Center') ||
                                      parentText.includes('长边数值') || parentText.includes('Long Edge Values') ||
                                      parentText.includes('尺寸组合') || parentText.includes('Dimension Presets') ||
                                      parentText.includes('交换宽高') || parentText.includes('Swap W/H') ||
                                      parentText.includes('Magic Resize') || parentText.includes('Magic Resolution')) {
                                detectedNodeType = "MagicResolutionResize";
                            } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                                detectedNodeType = "MagicKleinLoader";
                            } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                      parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                      parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                      parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                      parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                detectedNodeType = "MagicPromptReplace";
                            } else if (parentText.includes('SDNQ') || parentText.includes('降噪') || parentText.includes('预览方式') ||
                                      parentText.includes('SDNQ Model') || parentText.includes('SDNQ Sampler')) {
                                detectedNodeType = parentText.includes('Sampler') || parentText.includes('采样') ? "MagicSDNQSampler" : "MagicSDNQLoader";
                            } else if (parentText.includes('Magic Cache') || parentText.includes('TeaCache') || parentText.includes('FBCache') ||
                                      parentText.includes('本节点新增支持') || parentText.includes('已修改源项目代码')) {
                                detectedNodeType = "MagicCache";
                            } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                                      parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('Tag Preview') ||
                                      parentText.includes('标签搜索') || parentText.includes('Tag Search') || parentText.includes('运行历史') ||
                                      parentText.includes('历史收藏') || parentText.includes('格式化') || parentText.includes('去重') ||
                                      parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                                detectedNodeType = "MagicPromptBox";
                            }
                            
                            // 跳过URL和路径
                            if (!nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                                !nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                                const translated = translateText(nodeText, currentLang, detectedNodeType);
                                if (translated !== nodeText) {
                                    child.textContent = translated;
                                    this.setAttribute(TRANSLATED_MARKER, currentLang);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return result;
    };
}

function setupTranslationInterceptor() {
    if (translationInterceptorActive) return;
    translationInterceptorActive = true;
    
    // 拦截原生对话框
    interceptNativeDialogs();
    
    // 拦截 appendChild，在弹窗添加时立即翻译
    interceptAppendChild();
    
    // 使用MutationObserver监听DOM变化
    translationObserver = new MutationObserver((mutations) => {
        const currentLang = getCurrentLanguage();
        const batch = [];
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 检查是否是固定定位的弹窗
                        const style = window.getComputedStyle(node);
                        if ((style.position === 'fixed' || style.position === 'absolute') && 
                            isLoraNodeElement(node)) {
                            // 弹窗立即翻译
                            batch.push(() => translateElementImmediately(node));
                        } else {
                            // 普通元素延迟翻译
                            batch.push(() => translateElementRecursive(node, currentLang));
                        }
                    } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                        const parent = node.parentElement;
                        if (parent && isLoraNodeElement(parent)) {
                            // 检查是否已翻译
                            if (!parent.hasAttribute(TRANSLATED_MARKER)) {
                                batch.push(() => {
                                    const translated = translateText(node.textContent, currentLang, "MagicPowerLoraLoader");
                                    if (translated !== node.textContent) {
                                        node.textContent = translated;
                                    }
                                });
                            }
                        }
                    }
                });
            } else if (mutation.type === 'characterData') {
                // 文本节点内容变化
                const node = mutation.target;
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    const parent = node.parentElement;
                    if (parent && isLoraNodeElement(parent)) {
                        // 检查是否已翻译
                        if (!parent.hasAttribute(TRANSLATED_MARKER)) {
                            batch.push(() => {
                                const translated = translateText(node.textContent, currentLang, "MagicPowerLoraLoader");
                                if (translated !== node.textContent) {
                                    node.textContent = translated;
                                }
                            });
                        }
                    }
                }
            } else if (mutation.type === 'attributes') {
                // 属性变化（textContent, placeholder, title等）
                const target = mutation.target;
                if (target && isLoraNodeElement(target)) {
                    if (mutation.attributeName === 'textContent' || 
                        mutation.attributeName === 'placeholder' || 
                        mutation.attributeName === 'title') {
                        // 检查是否已翻译
                        if (!target.hasAttribute(TRANSLATED_MARKER)) {
                            batch.push(() => {
                                // 确定节点类型
                                let nodeType = "MagicPowerLoraLoader";
                                const text = target.textContent || '';
                                if (text.includes('逻辑') || text.includes('Logic') || text.includes('编辑器') || text.includes('Editor')) {
                                    nodeType = "MagicLogicCompute";
                                } else if (text.includes('SDNQ') || text.includes('降噪') || text.includes('预览方式') || text.includes('正面条件') || text.includes('负面条件')) {
                                    nodeType = text.includes('Sampler') || text.includes('采样') ? "MagicSDNQSampler" : "MagicSDNQLoader";
                                } else if (text.includes('Magic Klein') || text.includes('Klein Loader') || text.includes('FLUX.2 Klein')) {
                                    nodeType = "MagicKleinLoader";
                                } else if (text.includes('Magic Cache') || text.includes('TeaCache') || text.includes('FBCache') ||
                                          text.includes('本节点新增支持') || text.includes('已修改源项目代码')) {
                                    nodeType = "MagicCache";
                                } else if (text.includes('Magic 提示词编辑器') || text.includes('Magic Prompt Editor') ||
                                          text.includes('编辑提示词') || text.includes('Tag 预览') || text.includes('Tag Preview') ||
                                          text.includes('标签搜索') || text.includes('Tag Search') || text.includes('运行历史') ||
                                          text.includes('历史收藏') || text.includes('格式化') || text.includes('去重') ||
                                          text.includes('编辑标签') || text.includes('Edit Tags')) {
                                    nodeType = "MagicPromptBox";
                                }
                                
                                if (target.textContent) {
                                    const textContent = target.textContent.trim();
                                    // 跳过URL和路径，避免触发资源加载
                                    if (!textContent.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                                        !textContent.match(/\.(css|js|json)(\?|$)/i)) {
                                        const translated = translateText(textContent, currentLang, nodeType);
                                        if (translated !== textContent) {
                                            target.textContent = translated;
                                        }
                                    }
                                }
                                if (target.placeholder) {
                                    const translated = translateText(target.placeholder, currentLang, nodeType);
                                    if (translated !== target.placeholder) {
                                        target.placeholder = translated;
                                    }
                                }
                                if (target.title) {
                                    const translated = translateText(target.title, currentLang, nodeType);
                                    if (translated !== target.title) {
                                        target.title = translated;
                                    }
                                }
                            });
                        }
                    }
                }
            }
        });
        
        // 批量处理，使用 requestAnimationFrame 优化性能
        if (batch.length > 0) {
            requestAnimationFrame(() => {
                batch.forEach(fn => {
                    try {
                        fn();
                    } catch (e) {
                        console.error("[Language Switcher] Translation error:", e);
                    }
                });
            });
        }
    });
    
    // 开始观察整个文档
    if (document.body) {
        translationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['textContent', 'placeholder', 'title']
        });
    } else {
        // 如果body还没创建，等待
        setTimeout(() => {
            if (document.body) {
                translationObserver.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: ['textContent', 'placeholder', 'title']
                });
            }
        }, 1000);
    }
}

// 检查元素是否属于需要翻译的节点（LoRA或Logic等）
function isLoraNodeElement(element) {
    if (!element) return false;
    
    // 检查元素本身是否有 mpl- 类名（LoRA节点）
    if (element.classList) {
        const hasMplClass = Array.from(element.classList).some(cls => cls.startsWith('mpl-'));
        if (hasMplClass) return true;
    }
    
    // 检查是否在 mpl- 容器内（LoRA节点）
    if (element.closest) {
        const closestMpl = element.closest('.mpl-embedded-container, [class*="mpl-"]');
        if (closestMpl) return true;
    }
    
    // 检查弹窗：查找包含LoRA或Logic相关文本的弹窗
    // 先检查元素本身及其父元素的文本内容
    const checkText = (el) => {
        if (!el) return false;
        const text = el.textContent || '';
        const keywords = [
            // LoRA相关
            'LoRA', 'Lora', '预设', '触发词', '添加', '刷新', '爬取', '保存', '删除',
            'Edit Trigger Words', 'Add Lora', 'Edit LoRA', 'Fetch Info', 'Save', 'Delete',
            // Logic相关
            '逻辑', 'Logic', '编辑器', 'Editor', '脚本', 'Script', '魔法脚本', 'Magic Script',
            '编辑逻辑', 'Edit Logic', '新建逻辑', 'New Logic', '逻辑名称', 'Logic Name',
            '使用手册', 'Manual', '数据来源', 'Data Source', '输入参数', 'Input Variables',
            '常用函数', 'Functions', '语法', 'Syntax', '布尔值', 'Boolean', '案例库', 'Examples',
            // Photopea相关
            '打开图库', 'Open Gallery', '打开编辑器', 'Open Editor', '图库', 'Gallery',
            '批量管理', 'Batch Manage', '清空缓存', 'Clear Cache', '固定', 'Pin', '取消固定', 'Unpin',
            '删除选中', 'Delete Selected', '退出编辑', 'Exit Edit Mode', '保存并发送', 'Save and Send',
            'Photopea', 'Magic Photopea', 'Magic Gallery',
            // SDNQ 相关
            'SDNQ', 'SDNQ K Sampler', 'SDNQ K采样器', 'SDNQ模型', 'SDNQ采样', '降噪', '预览方式', '采样模式', 'Magic SDNQ', '正面条件', '负面条件',
            // Cache 相关
            'Magic Cache', 'TeaCache', 'FBCache', '本节点新增支持', '已修改源项目代码', 'flux2klein', '最新 Anima 模型', 'SDXL 模型', '原项目不支持',
            'Magic Klein', 'Klein Loader', 'FLUX.2 Klein', '嵌入到 nunchaku', 'nunchaku 环境',
            // MagicPromptBox 相关
            'Magic 提示词编辑器', 'Magic Prompt Editor', '编辑提示词', 'Edit Prompt', 'Tag 预览', 'Tag Preview',
            '标签搜索', 'Tag Search', '编辑标签', 'Edit Tags', '运行历史', 'Run History',
            '历史收藏', 'Favorites', '格式化', 'Format', '去重', 'Dedup',
            '一键翻译', 'Translate All', '翻译所有Tag', 'Translate Tags',
            '提示词', 'Prompt'
        ];
        return keywords.some(keyword => text.includes(keyword));
    };
    
    // 检查元素本身
    if (checkText(element)) return true;
    
    // 检查父元素（向上查找最多10层）
    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 10) {
        // 检查是否是固定定位的弹窗
        const style = window.getComputedStyle(parent);
        if (style.position === 'fixed' || style.position === 'absolute') {
            // 检查弹窗内容是否包含LoRA相关文本
            if (checkText(parent)) return true;
        }
        parent = parent.parentElement;
        depth++;
    }
    
    // 检查是否在body的直接子元素中（弹窗通常是body的直接子元素）
    if (element.parentElement === document.body || 
        (element.closest && element.closest('body > div'))) {
        if (checkText(element) || checkText(element.parentElement)) {
            return true;
        }
    }
    
    return false;
}

// 递归翻译元素及其子元素
function translateElementRecursive(element, lang, nodeType = null) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    
    // 检查是否属于需要翻译的节点（LoRA或Logic等）
    const isTranslatableNode = isLoraNodeElement(element);
    
    if (isTranslatableNode) {
        // 检查是否已翻译（避免重复翻译）
        const translatedLang = element.getAttribute(TRANSLATED_MARKER);
        if (translatedLang === lang) {
            return; // 已经用当前语言翻译过了
        }
        
        // 确定节点类型（用于翻译查找）
        if (!nodeType) {
            const text = element.textContent || '';
            // 检查是否是Logic节点
            if (text.includes('逻辑') || text.includes('Logic') || text.includes('编辑器') || text.includes('Editor') || 
                text.includes('脚本') || text.includes('Script') || text.includes('Magic Script')) {
                nodeType = "MagicLogicCompute";
            } else if (text.includes('SDNQ') || text.includes('降噪') || text.includes('预览方式') || text.includes('正面条件') || text.includes('负面条件')) {
                nodeType = text.includes('Sampler') || text.includes('采样') ? "MagicSDNQSampler" : "MagicSDNQLoader";
            } else if (text.includes('Magic Klein') || text.includes('Klein Loader') || text.includes('FLUX.2 Klein')) {
                nodeType = "MagicKleinLoader";
            } else if (text.includes('Magic Cache') || text.includes('TeaCache') || text.includes('FBCache') ||
                      text.includes('本节点新增支持') || text.includes('已修改源项目代码')) {
                nodeType = "MagicCache";
            } else if (text.includes('Magic 提示词编辑器') || text.includes('Magic Prompt Editor') ||
                      text.includes('编辑提示词') || text.includes('Tag 预览') || text.includes('Tag Preview') ||
                      text.includes('标签搜索') || text.includes('Tag Search') || text.includes('运行历史') ||
                      text.includes('Run History') || text.includes('历史收藏') || text.includes('Favorites') ||
                      text.includes('格式化') || text.includes('Format') || text.includes('去重') ||
                      text.includes('一键翻译') || text.includes('Translate All') || text.includes('翻译所有') ||
                      text.includes('编辑标签') || text.includes('Edit Tags')) {
                nodeType = "MagicPromptBox";
            } else {
                // 默认是LoRA节点
                nodeType = "MagicPowerLoraLoader";
            }
        }
        
        // 翻译按钮文本（优先处理按钮，无论是否有子元素）
        if (element.tagName === 'BUTTON') {
            // 获取按钮的文本内容（包括所有文本节点）
            let buttonText = '';
            if (element.childNodes.length > 0) {
                buttonText = Array.from(element.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent)
                    .join('')
                    .trim();
            }
            if (!buttonText && element.textContent) {
                buttonText = element.textContent.trim();
            }
            
            if (buttonText) {
                const translated = translateText(buttonText, lang, nodeType);
                if (translated !== buttonText) {
                    // 清除所有文本节点
                    Array.from(element.childNodes).forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            node.remove();
                        }
                    });
                    // 设置新文本
                    element.textContent = translated;
                    element.setAttribute(TRANSLATED_MARKER, lang);
                }
            }
        }
        
        // 翻译textContent（只处理叶子节点，避免重复翻译，但跳过label因为已经单独处理）
        if (element.tagName !== 'LABEL' && 
            element.children.length === 0 && 
            element.textContent && 
            element.textContent.trim()) {
            const translated = translateText(element.textContent, lang, nodeType);
            if (translated !== element.textContent) {
                element.textContent = translated;
                element.setAttribute(TRANSLATED_MARKER, lang);
            }
        }
        
        // 翻译placeholder
        if (element.placeholder) {
            const translated = translateText(element.placeholder, lang, nodeType);
            if (translated !== element.placeholder) {
                element.placeholder = translated;
                element.setAttribute(TRANSLATED_MARKER, lang);
            }
        }
        
        // 翻译title
        if (element.title) {
            const translated = translateText(element.title, lang, nodeType);
            if (translated !== element.title) {
                element.title = translated;
                element.setAttribute(TRANSLATED_MARKER, lang);
            }
        }
        
        // 翻译innerHTML（用于包含HTML的内容，如教程区域）
        // 注意：只处理安全的HTML内容，避免影响包含脚本、样式表、链接等关键元素
        // 只处理特定节点类型的innerHTML（如教程区域），避免影响ComfyUI核心元素
        if (element.innerHTML && element.innerHTML.includes('<')) {
            // 安全检查1：跳过包含脚本、样式表、链接等关键元素的元素
            const unsafePatterns = [
                /<script/i,
                /<link/i,
                /<style/i,
                /href\s*=/i,
                /src\s*=/i
            ];
            
            const hasUnsafeContent = unsafePatterns.some(pattern => pattern.test(element.innerHTML));
            if (hasUnsafeContent) {
                // 包含不安全内容，跳过innerHTML翻译
                return;
            }
            
            // 安全检查2：只处理我们明确知道需要翻译的元素（如教程区域）
            // 通过检查父元素、类名、文本内容来判断是否是安全的翻译目标
            const isSafeToTranslate = element.closest && (
                element.closest('[class*="tutorial"]') ||
                element.closest('[id*="tutorial"]') ||
                element.classList.contains('tutorial') ||
                (element.id && element.id.includes('tutorial')) ||
                // 检查是否包含教程相关的关键词（包括更多关键词）
                (element.textContent && (
                    element.textContent.includes('数据来源') ||
                    element.textContent.includes('输入参数') ||
                    element.textContent.includes('常用函数') ||
                    element.textContent.includes('语法与布尔值') ||
                    element.textContent.includes('案例库') ||
                    element.textContent.includes('经典案例库') ||
                    element.textContent.includes('魔法脚本使用手册') ||
                    element.textContent.includes('连接图片时') ||
                    element.textContent.includes('连接Latent时') ||
                    element.textContent.includes('如果都没连') ||
                    element.textContent.includes('绝对值') ||
                    element.textContent.includes('取最小值') ||
                    element.textContent.includes('取最大值') ||
                    element.textContent.includes('四舍五入') ||
                    element.textContent.includes('Data Source') ||
                    element.textContent.includes('Input Variables') ||
                    element.textContent.includes('Functions') ||
                    element.textContent.includes('Syntax') ||
                    element.textContent.includes('Examples') ||
                    element.textContent.includes('Magic Script Manual') ||
                    element.textContent.includes('When image is connected') ||
                    element.textContent.includes('When latent is connected') ||
                    element.textContent.includes('Absolute value') ||
                    element.textContent.includes('Get minimum value') ||
                    element.textContent.includes('Get maximum value')
                ))
            );
            
            if (!isSafeToTranslate) {
                // 不是教程区域，跳过innerHTML翻译，避免影响ComfyUI核心功能
                return;
            }
            
            try {
                // 重写教程翻译逻辑：直接处理每个div，逐个翻译文本节点
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = element.innerHTML;
                
                let hasTranslation = false;
                const nodeType = "MagicLogicCompute";
                
                // 获取所有div元素（排除code内的）
                const allDivs = tempDiv.querySelectorAll('div:not(code div)');
                
                allDivs.forEach(div => {
                    // 跳过code标签内的div
                    if (div.closest('code')) return;
                    
                    // 获取div内的所有文本节点（排除code内的）
                    const walker = document.createTreeWalker(
                        div,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                // 跳过code内的文本
                                if (node.parentElement && (node.parentElement.tagName === 'CODE' || node.parentElement.closest('code'))) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        },
                        false
                    );
                    
                    const textNodes = [];
                    let textNode;
                    while (textNode = walker.nextNode()) {
                        const text = textNode.textContent.trim();
                        if (text && /[\u4e00-\u9fa5]/.test(text)) {
                            textNodes.push(textNode);
                        }
                    }
                    
                    if (textNodes.length === 0) return;
                    
                    // 策略1：尝试翻译整个div的完整文本（去除HTML标签）
                    const divFullText = div.textContent.trim();
                    const divFullTextNormalized = divFullText.replace(/\s+/g, ' ').trim();
                    let divTranslated = translateText(divFullTextNormalized, lang, nodeType);
                    
                        // 如果整个div翻译成功，尝试智能地将翻译结果分配回各个文本节点
                        if (divTranslated !== divFullTextNormalized && divTranslated !== divFullText) {
                            // 对于包含span标签的div（如 "a : 左侧输入节点..."），需要特殊处理
                            // 提取span后的文本部分并翻译
                            const spanElements = div.querySelectorAll('span.var');
                            if (spanElements.length > 0) {
                                // 找到span后的文本节点
                                spanElements.forEach(span => {
                                    let nextSibling = span.nextSibling;
                                    while (nextSibling) {
                                    if (nextSibling.nodeType === Node.TEXT_NODE) {
                                        const originalText = nextSibling.textContent;
                                        // 规范化空白字符（将多个空格/换行符统一为单个空格，但保留前导空格）
                                        const normalizedText = originalText.replace(/[\r\n\t]+/g, ' ').replace(/[ \u00A0]+/g, ' ');
                                        const textContent = normalizedText.trim();
                                        
                                        if (textContent && /[\u4e00-\u9fa5]/.test(textContent)) {
                                            // 直接使用getTranslation尝试匹配，避免translateText的trim问题
                                            // 先尝试完整原始文本（包含前导空格和冒号）
                                            let translated = getTranslation(normalizedText, lang, nodeType);
                                            
                                            // 如果完整文本匹配失败，尝试trim后的文本
                                            if (translated === normalizedText && normalizedText !== textContent) {
                                                translated = getTranslation(textContent, lang, nodeType);
                                                
                                                // 如果trim后也失败，尝试规范化引号后再匹配
                                                if (translated === textContent) {
                                                    const normalizedQuotes = normalizedText.replace(/[""]/g, '"').replace(/['']/g, "'");
                                                    if (normalizedQuotes !== normalizedText) {
                                                        translated = getTranslation(normalizedQuotes, lang, nodeType);
                                                        if (translated === normalizedQuotes) {
                                                            translated = getTranslation(normalizedQuotes.trim(), lang, nodeType);
                                                        }
                                                    }
                                                }
                                                
                                                // 如果还是失败，尝试只保留前导空格（trimStart）
                                                if (translated === textContent || translated === normalizedText) {
                                                    const textWithLeadingSpace = normalizedText.trimStart();
                                                    if (textWithLeadingSpace !== textContent) {
                                                        translated = getTranslation(textWithLeadingSpace, lang, nodeType);
                                                    }
                                                }
                                            } else if (translated === normalizedText) {
                                                // 如果完整文本匹配失败，尝试规范化引号
                                                const normalizedQuotes = normalizedText.replace(/[""]/g, '"').replace(/['']/g, "'");
                                                if (normalizedQuotes !== normalizedText) {
                                                    translated = getTranslation(normalizedQuotes, lang, nodeType);
                                                    if (translated === normalizedQuotes) {
                                                        translated = getTranslation(normalizedQuotes.trim(), lang, nodeType);
                                                    }
                                                }
                                            }
                                            
                                            // 如果直接匹配失败，使用translateText（它会尝试更多变体）
                                            if (translated === textContent || translated === normalizedText) {
                                                translated = translateText(normalizedText, lang, nodeType);
                                                
                                                // 如果translateText也失败，尝试去掉引号后再翻译
                                                if ((translated === textContent || translated === normalizedText) && /[""']/.test(textContent)) {
                                                    const noQuotes = textContent.replace(/[""']/g, '').trim();
                                                    if (noQuotes !== textContent && noQuotes) {
                                                        const noQuotesTranslated = translateText(noQuotes, lang, nodeType);
                                                        if (noQuotesTranslated !== noQuotes) {
                                                            // 重新添加引号（使用标准双引号）
                                                            translated = noQuotesTranslated.replace(/(节点\s+)([ab])(\s+的数值)/, '$1"$2"$3');
                                                        }
                                                    }
                                                }
                                            }
                                            
                                            // 如果翻译成功，应用翻译
                                            if (translated !== textContent && translated !== normalizedText) {
                                                // 如果原始文本有前导/尾随空格，需要保留
                                                if (normalizedText !== textContent) {
                                                    const leadingSpaces = normalizedText.match(/^\s*/)[0];
                                                    const trailingSpaces = normalizedText.match(/\s*$/)[0];
                                                    // 如果翻译后的文本已经包含了前导空格（如 " : ..."），则直接使用
                                                    if (translated.trimStart() !== translated && translated.startsWith(' ')) {
                                                        nextSibling.textContent = translated + trailingSpaces;
                                                    } else {
                                                        nextSibling.textContent = leadingSpaces + translated + trailingSpaces;
                                                    }
                                                } else {
                                                    nextSibling.textContent = translated;
                                                }
                                                hasTranslation = true;
                                            }
                                        }
                                        break;
                                    }
                                        nextSibling = nextSibling.nextSibling;
                                    }
                                });
                            }
                        }
                    
                    // 策略2：逐个翻译文本节点
                    textNodes.forEach(node => {
                        const originalText = node.textContent;
                        const text = originalText.trim();
                        
                        if (!text || !/[\u4e00-\u9fa5]/.test(text)) return;
                        
                        // 跳过URL和路径
                        if (text.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|file:\/\/|127\.0\.0\.1|localhost)/i) ||
                            text.match(/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/i)) {
                            return;
                        }
                        
                        // 尝试多种格式的翻译
                        let translated = translateText(text, lang, nodeType);
                        
                        // 如果trim后失败，尝试包含空格（保留原始格式，包括前导空格）
                        if (translated === text && originalText !== text) {
                            // 先尝试trim后的文本（已经尝试过了）
                            // 再尝试包含前导空格的文本
                            const textWithLeadingSpace = originalText.trimStart();
                            if (textWithLeadingSpace !== text) {
                                translated = translateText(textWithLeadingSpace, lang, nodeType);
                                if (translated !== textWithLeadingSpace) {
                                    const trailingSpaces = originalText.match(/\s*$/)[0];
                                    node.textContent = originalText.match(/^\s*/)[0] + translated + trailingSpaces;
                                    hasTranslation = true;
                                    return;
                                }
                            }
                            // 尝试完整原始文本
                            translated = translateText(originalText, lang, nodeType);
                            if (translated !== originalText) {
                                node.textContent = translated;
                                hasTranslation = true;
                                return;
                            }
                        }
                        
                        // 如果还是失败，尝试去掉所有空格
                        if (translated === text || translated === originalText) {
                            const noSpaces = text.replace(/\s+/g, '');
                            if (noSpaces !== text) {
                                const noSpacesTranslated = translateText(noSpaces, lang, nodeType);
                                if (noSpacesTranslated !== noSpaces) {
                                    translated = noSpacesTranslated;
                                }
                            }
                        }
                        
                        // 如果还是失败，尝试去掉括号
                        if (translated === text || translated === originalText) {
                            const noBrackets = text.replace(/[()]/g, '').trim();
                            if (noBrackets !== text && noBrackets) {
                                const noBracketsTranslated = translateText(noBrackets, lang, nodeType);
                                if (noBracketsTranslated !== noBrackets) {
                                    // 如果翻译成功，需要重新添加括号和空格
                                    const leadingSpaces = originalText.match(/^\s*/)[0];
                                    const trailingSpaces = originalText.match(/\s*$/)[0];
                                    const hasLeadingBracket = originalText.trim().startsWith('(');
                                    const hasTrailingBracket = originalText.trim().endsWith(')');
                                    let finalTranslated = noBracketsTranslated;
                                    if (hasLeadingBracket) finalTranslated = '(' + finalTranslated;
                                    if (hasTrailingBracket) finalTranslated = finalTranslated + ')';
                                    translated = leadingSpaces + finalTranslated + trailingSpaces;
                                }
                            }
                        }
                        
                        // 如果翻译成功，应用翻译
                        if (translated !== text && translated !== originalText) {
                            const leadingSpaces = originalText.match(/^\s*/)[0];
                            const trailingSpaces = originalText.match(/\s*$/)[0];
                            node.textContent = leadingSpaces + translated + trailingSpaces;
                            hasTranslation = true;
                        }
                    });
                    
                    // 策略3：如果还有未翻译的中文文本节点，尝试合并翻译
                    const remainingChineseNodes = textNodes.filter(node => {
                        const text = node.textContent.trim();
                        return text && /[\u4e00-\u9fa5]/.test(text);
                    });
                    
                    if (remainingChineseNodes.length > 1) {
                        // 合并所有中文文本节点
                        const mergedText = remainingChineseNodes.map(node => node.textContent).join('');
                        const mergedTextNormalized = mergedText.replace(/\s+/g, ' ').trim();
                        let mergedTranslated = translateText(mergedTextNormalized, lang, nodeType);
                        
                        if (mergedTranslated === mergedTextNormalized) {
                            mergedTranslated = translateText(mergedText.trim(), lang, nodeType);
                        }
                        
                        if (mergedTranslated !== mergedText && mergedTranslated !== mergedTextNormalized && mergedTranslated !== mergedText.trim()) {
                            // 将翻译结果分配到第一个节点
                            remainingChineseNodes.forEach((node, idx) => {
                                if (idx === 0) {
                                    const originalText = node.textContent;
                                    const leadingSpaces = originalText.match(/^\s*/)[0];
                                    const trailingSpaces = originalText.match(/\s*$/)[0];
                                    node.textContent = leadingSpaces + mergedTranslated + trailingSpaces;
                                } else {
                                    node.textContent = '';
                                }
                            });
                            hasTranslation = true;
                        }
                    }
                });
                
                if (hasTranslation) {
                    element.innerHTML = tempDiv.innerHTML;
                    element.setAttribute(TRANSLATED_MARKER, lang);
                } else {
                    // 如果翻译失败，尝试更激进的方法：直接替换所有中文文本节点
                    // 遍历所有文本节点，逐个尝试翻译
                    const allTextNodes = [];
                    const walker = document.createTreeWalker(
                        tempDiv,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                // 跳过code内的文本
                                if (node.parentElement && (node.parentElement.tagName === 'CODE' || node.parentElement.closest('code'))) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        },
                        false
                    );
                    let textNode;
                    while (textNode = walker.nextNode()) {
                        const text = textNode.textContent.trim();
                        if (text && /[\u4e00-\u9fa5]/.test(text)) {
                            // 跳过URL和路径
                            if (text.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|file:\/\/|127\.0\.0\.1|localhost)/i) ||
                                text.match(/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/i)) {
                                continue;
                            }
                            allTextNodes.push(textNode);
                        }
                    }
                    
                    // 逐个尝试翻译（先尝试trim后的文本，再尝试包含空格的文本）
                    allTextNodes.forEach(node => {
                        const originalText = node.textContent;
                        const text = originalText.trim();
                        
                        if (!text || !/[\u4e00-\u9fa5]/.test(text)) {
                            return; // 跳过不包含中文的文本
                        }
                        
                        // 跳过URL和路径
                        if (text.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|file:\/\/|127\.0\.0\.1|localhost)/i) ||
                            text.match(/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/i)) {
                            return;
                        }
                        
                        // 先尝试trim后的文本
                        let translated = translateText(text, lang, nodeType || "MagicLogicCompute");
                        
                        // 如果trim后翻译失败，尝试包含前后空格的文本
                        if (translated === text && originalText !== text) {
                            translated = translateText(originalText, lang, nodeType || "MagicLogicCompute");
                            if (translated !== originalText) {
                                node.textContent = translated;
                                hasTranslation = true;
                                return;
                            }
                        }
                        
                        if (translated !== text) {
                            const leadingSpaces = originalText.match(/^\s*/)[0];
                            const trailingSpaces = originalText.match(/\s*$/)[0];
                            node.textContent = leadingSpaces + translated + trailingSpaces;
                            hasTranslation = true;
                        }
                    });
                    
                    if (hasTranslation) {
                        element.innerHTML = tempDiv.innerHTML;
                        element.setAttribute(TRANSLATED_MARKER, lang);
                    }
                }
            } catch (e) {
                // 如果翻译innerHTML出错，跳过，避免影响功能
                console.warn("[Language Switcher] Error translating innerHTML:", e);
            }
        }
        
        // 翻译label文本（特殊处理：label可能包含checkbox/radio，只翻译文本节点）
        if (element.tagName === 'LABEL') {
            // 检查是否包含input元素（checkbox或radio）
            const hasInput = element.querySelector('input[type="checkbox"], input[type="radio"]');
            
            if (hasInput) {
                // 如果label包含checkbox/radio，只翻译文本节点，不要使用textContent
                // 清除翻译标记，强制重新翻译
                const translatedLang = element.getAttribute(TRANSLATED_MARKER);
                if (translatedLang !== lang) {
                    Array.from(element.childNodes).forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            // 确定节点类型（使用传入的nodeType，如果没有则自动检测）
                            let detectedNodeType = nodeType || "MagicPowerLoraLoader";
                            if (!nodeType) {
                                const parentText = element.textContent || '';
                                if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor') ||
                                    parentText.includes('脚本') || parentText.includes('Script') || parentText.includes('Magic Script')) {
                                    detectedNodeType = "MagicLogicCompute";
                                } else if (parentText.includes('打开图库') || parentText.includes('Open Gallery') || 
                                          parentText.includes('打开编辑器') || parentText.includes('Open Editor') ||
                                          parentText.includes('Photopea') || parentText.includes('Magic Gallery') ||
                                          parentText.includes('批量管理') || parentText.includes('Batch Manage')) {
                                    detectedNodeType = "MagicPhotopeaNode";
                                } else if (parentText.includes('管理预设') || parentText.includes('Manage Presets') ||
                                          parentText.includes('预设管理中心') || parentText.includes('Preset Management Center') ||
                                          parentText.includes('长边数值') || parentText.includes('Long Edge Values') ||
                                          parentText.includes('尺寸组合') || parentText.includes('Dimension Presets') ||
                                          parentText.includes('交换宽高') || parentText.includes('Swap W/H') ||
                                          parentText.includes('Magic Resize') || parentText.includes('Magic Resolution')) {
                                    detectedNodeType = "MagicResolutionResize";
                                } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                                    detectedNodeType = "MagicKleinLoader";
                                } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                          parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                          parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                          parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                          parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                    detectedNodeType = "MagicPromptReplace";
                                } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                                          parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('Tag Preview') ||
                                          parentText.includes('标签搜索') || parentText.includes('Tag Search') || parentText.includes('运行历史') ||
                                          parentText.includes('历史收藏') || parentText.includes('格式化') || parentText.includes('去重') ||
                                          parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                                    detectedNodeType = "MagicPromptBox";
                                }
                            }
                            
                            const nodeText = node.textContent.trim();
                            // 跳过URL和路径
                            if (!nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                                !nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                                const translated = translateText(nodeText, lang, detectedNodeType);
                                if (translated !== nodeText) {
                                    node.textContent = translated;
                                    element.setAttribute(TRANSLATED_MARKER, lang);
                                }
                            }
                        }
                    });
                }
            } else if (element.textContent && element.textContent.trim()) {
                // 如果label不包含input，可以安全地使用textContent
                const translated = translateText(element.textContent, lang, nodeType);
                if (translated !== element.textContent) {
                    element.textContent = translated;
                    element.setAttribute(TRANSLATED_MARKER, lang);
                }
            }
        }
        
        // 翻译div、span等容器元素的文本（如果它们直接包含文本）
        // 但跳过可能包含URL或路径的文本
        if ((element.tagName === 'DIV' || element.tagName === 'SPAN') && 
            element.children.length === 0 && 
            element.textContent && 
            element.textContent.trim()) {
            const text = element.textContent.trim();
            // 跳过看起来像URL或路径的文本
            if (!text.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i)) {
                const translated = translateText(text, lang, nodeType);
                if (translated !== text) {
                    element.textContent = translated;
                    element.setAttribute(TRANSLATED_MARKER, lang);
                }
            }
        }
    }
    
    // 递归处理子元素
    Array.from(element.children).forEach(child => {
        translateElementRecursive(child, lang, nodeType);
    });
    
    // 处理文本节点（跳过label内的文本节点，因为label已经单独处理）
    Array.from(element.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            const parent = node.parentElement;
            if (parent && isLoraNodeElement(parent)) {
                // 如果父元素是label且包含input，需要特殊处理
                if (parent.tagName === 'LABEL' && parent.querySelector('input[type="checkbox"], input[type="radio"]')) {
                    // label内的文本节点需要翻译，但已经在上面的label处理中处理过了
                    // 这里再次检查，确保翻译标记正确
                    const translatedLang = parent.getAttribute(TRANSLATED_MARKER);
                    if (translatedLang !== lang) {
                        const nodeText = node.textContent.trim();
                        if (nodeText) {
                            // 确定节点类型（使用传入的nodeType，如果没有则自动检测）
                            let detectedNodeType = nodeType || "MagicPowerLoraLoader";
                            if (!nodeType) {
                                const parentText = parent.textContent || '';
                                if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor') ||
                                    parentText.includes('脚本') || parentText.includes('Script') || parentText.includes('Magic Script')) {
                                    detectedNodeType = "MagicLogicCompute";
                                } else if (parentText.includes('打开图库') || parentText.includes('Open Gallery') || 
                                          parentText.includes('打开编辑器') || parentText.includes('Open Editor') ||
                                          parentText.includes('Photopea') || parentText.includes('Magic Gallery') ||
                                          parentText.includes('批量管理') || parentText.includes('Batch Manage')) {
                                    detectedNodeType = "MagicPhotopeaNode";
                                } else if (parentText.includes('管理预设') || parentText.includes('Manage Presets') ||
                                          parentText.includes('预设管理中心') || parentText.includes('Preset Management Center') ||
                                          parentText.includes('长边数值') || parentText.includes('Long Edge Values') ||
                                          parentText.includes('尺寸组合') || parentText.includes('Dimension Presets') ||
                                          parentText.includes('交换宽高') || parentText.includes('Swap W/H') ||
                                          parentText.includes('Magic Resize') || parentText.includes('Magic Resolution')) {
                                    detectedNodeType = "MagicResolutionResize";
                                } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                                    detectedNodeType = "MagicKleinLoader";
                                } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                          parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                          parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                          parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                          parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                    detectedNodeType = "MagicPromptReplace";
                                } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                                          parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('Tag Preview') ||
                                          parentText.includes('标签搜索') || parentText.includes('Tag Search') || parentText.includes('运行历史') ||
                                          parentText.includes('历史收藏') || parentText.includes('格式化') || parentText.includes('去重') ||
                                          parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                                    detectedNodeType = "MagicPromptBox";
                                }
                            }
                            
                            // 跳过看起来像URL或路径的文本
                            if (!nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                                !nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                                const translated = translateText(nodeText, lang, detectedNodeType);
                                if (translated !== nodeText) {
                                    node.textContent = translated;
                                    parent.setAttribute(TRANSLATED_MARKER, lang);
                                }
                            }
                        }
                    }
                    return;
                }
                
                // 确定节点类型（使用传入的nodeType，如果没有则自动检测）
                let detectedNodeType = nodeType || "MagicPowerLoraLoader";
                if (!nodeType) {
                    const parentText = parent.textContent || '';
                    if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor')) {
                        detectedNodeType = "MagicLogicCompute";
                    } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                        detectedNodeType = "MagicKleinLoader";
                    } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                              parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('标签搜索') ||
                              parentText.includes('运行历史') || parentText.includes('历史收藏') || parentText.includes('格式化') ||
                              parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                        detectedNodeType = "MagicPromptBox";
                    }
                }
                
                const nodeText = node.textContent.trim();
                // 跳过看起来像URL或路径的文本
                if (nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) ||
                    nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                    return;
                }
                
                // 检查是否已翻译
                const translatedLang = parent.getAttribute(TRANSLATED_MARKER);
                if (translatedLang !== lang) {
                    const translated = translateText(nodeText, lang, detectedNodeType);
                    if (translated !== nodeText) {
                        node.textContent = translated;
                        parent.setAttribute(TRANSLATED_MARKER, lang);
                    }
                }
            }
        }
    });
}

// 更新所有UI文本
function updateAllUITexts(lang) {
    // 清除所有翻译标记，强制重新翻译
    document.querySelectorAll(`[${TRANSLATED_MARKER}]`).forEach(el => {
        el.removeAttribute(TRANSLATED_MARKER);
    });
    
    // 不再更新节点标题（节点名是双语的且用户可以自定义）
    
    // 优先处理按钮（按钮文本切换最重要）
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(button => {
        const buttonText = button.textContent?.trim() || '';
        if (!buttonText) return;
        
        // 检查按钮是否属于LoRA或Logic节点
        const isLoraButton = isLoraNodeElement(button);
        
        if (isLoraButton) {
            button.removeAttribute(TRANSLATED_MARKER);
            // 自动检测节点类型
            let nodeType = "MagicPowerLoraLoader";
            const parentText = button.closest('*')?.textContent || '';
            if (buttonText.includes('逻辑') || buttonText.includes('Logic') || buttonText.includes('编辑器') || buttonText.includes('Editor') ||
                parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor')) {
                nodeType = "MagicLogicCompute";
            } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                nodeType = "MagicKleinLoader";
            } else if (buttonText.includes('Magic 提示词编辑器') || buttonText.includes('Magic Prompt Editor') ||
                buttonText.includes('编辑提示词') || buttonText.includes('Tag 预览') || buttonText.includes('标签搜索') ||
                buttonText.includes('运行历史') || buttonText.includes('历史收藏') || buttonText.includes('格式化') ||
                buttonText.includes('编辑标签') || buttonText.includes('Edit Tags')) {
                nodeType = "MagicPromptBox";
            }
            
            // 尝试翻译按钮文本
            const translated = translateText(buttonText, lang, nodeType);
            if (translated !== buttonText) {
                button.textContent = translated;
                button.setAttribute(TRANSLATED_MARKER, lang);
            }
        }
    });
    
    // 查找所有可能的LoRA节点元素
    const allElements = document.querySelectorAll('*');
    const loraElements = Array.from(allElements).filter(el => isLoraNodeElement(el));
    
    // 翻译所有找到的元素
    loraElements.forEach(element => {
        element.removeAttribute(TRANSLATED_MARKER); // 清除标记，强制重新翻译
        translateElementRecursive(element, lang);
    });
    
    // 更新所有弹窗和模态框（包括固定定位的元素）
    const dialogs = document.querySelectorAll('div[style*="position: fixed"], div[style*="position:absolute"]');
    dialogs.forEach(dialog => {
        if (isLoraNodeElement(dialog)) {
            dialog.removeAttribute(TRANSLATED_MARKER);
            translateElementRecursive(dialog, lang);
        }
    });
    
    // 特别处理输入框的 placeholder
    const inputs = document.querySelectorAll('input[placeholder], textarea[placeholder]');
    inputs.forEach(input => {
        if (isLoraNodeElement(input) && input.placeholder) {
            input.removeAttribute(TRANSLATED_MARKER);
            // 自动检测节点类型
            let nodeType = "MagicPowerLoraLoader";
            const inputText = input.placeholder || '';
            const parentText = input.closest('*')?.textContent || '';
            if (inputText.includes('逻辑') || inputText.includes('Logic') || inputText.includes('编辑器') || inputText.includes('Editor') ||
                parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor')) {
                nodeType = "MagicLogicCompute";
            } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                nodeType = "MagicKleinLoader";
            } else if (inputText.includes('Magic 提示词编辑器') || inputText.includes('Magic Prompt Editor') ||
                inputText.includes('编辑提示词') || inputText.includes('Tag 预览') || inputText.includes('标签搜索') ||
                inputText.includes('运行历史') || inputText.includes('历史收藏') || inputText.includes('格式化') ||
                inputText.includes('编辑标签') || parentText.includes('Magic 提示词编辑器') || parentText.includes('编辑标签')) {
                nodeType = "MagicPromptBox";
            }
            const translated = translateText(input.placeholder, lang, nodeType);
            if (translated !== input.placeholder) {
                input.placeholder = translated;
                input.setAttribute(TRANSLATED_MARKER, lang);
            }
        }
    });
    
    // 特别处理LABEL元素（checkbox/radio标签）
    const labels = document.querySelectorAll('label');
    labels.forEach(label => {
        // 检查是否是相关元素
        let isRelevant = false;
        if (isLoraNodeElement(label)) {
            isRelevant = true;
        } else {
            // 检查父元素
            let parent = label.parentElement;
            let depth = 0;
            while (parent && depth < 5) {
                if (isLoraNodeElement(parent)) {
                    isRelevant = true;
                    break;
                }
                const style = window.getComputedStyle(parent);
                if (style.position === 'fixed' || style.position === 'absolute') {
                    if (parent.textContent && (
                        parent.textContent.includes('LoRA') || 
                        parent.textContent.includes('Lora') ||
                        parent.textContent.includes('Fetch') ||
                        parent.textContent.includes('爬取') ||
                        parent.textContent.includes('下载') ||
                        parent.textContent.includes('Download') ||
                        parent.textContent.includes('SDNQ') ||
                        parent.textContent.includes('降噪') ||
                        parent.textContent.includes('预览方式') ||
                        parent.textContent.includes('Magic Cache') ||
                        parent.textContent.includes('TeaCache') ||
                        parent.textContent.includes('FBCache') ||
                        parent.textContent.includes('Magic Klein')
                    )) {
                        isRelevant = true;
                        break;
                    }
                }
                parent = parent.parentElement;
                depth++;
            }
        }
        
        if (isRelevant) {
            label.removeAttribute(TRANSLATED_MARKER);
            // 确定节点类型
            let detectedNodeType = "MagicPowerLoraLoader";
            const parentText = label.textContent || '';
            if (parentText.includes('逻辑') || parentText.includes('Logic') || parentText.includes('编辑器') || parentText.includes('Editor')) {
                detectedNodeType = "MagicLogicCompute";
            } else if (parentText.includes('SDNQ') || parentText.includes('降噪') || parentText.includes('预览方式') || parentText.includes('正面条件') || parentText.includes('负面条件')) {
                detectedNodeType = parentText.includes('Sampler') || parentText.includes('采样') ? "MagicSDNQSampler" : "MagicSDNQLoader";
            } else if (parentText.includes('Magic Klein') || parentText.includes('Klein Loader') || parentText.includes('FLUX.2 Klein')) {
                detectedNodeType = "MagicKleinLoader";
            } else if (parentText.includes('Magic Cache') || parentText.includes('TeaCache') || parentText.includes('FBCache') ||
                      parentText.includes('本节点新增支持') || parentText.includes('已修改源项目代码')) {
                detectedNodeType = "MagicCache";
            } else if (parentText.includes('Magic 提示词编辑器') || parentText.includes('Magic Prompt Editor') ||
                      parentText.includes('编辑提示词') || parentText.includes('Tag 预览') || parentText.includes('Tag Preview') ||
                      parentText.includes('标签搜索') || parentText.includes('Tag Search') || parentText.includes('运行历史') ||
                      parentText.includes('历史收藏') || parentText.includes('格式化') || parentText.includes('去重') ||
                      parentText.includes('编辑标签') || parentText.includes('Edit Tags')) {
                detectedNodeType = "MagicPromptBox";
            }
            
            // 翻译label内的文本节点
            Array.from(label.childNodes).forEach(node => {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    const nodeText = node.textContent.trim();
                    if (!nodeText.match(/^(https?:\/\/|\.css|\.js|api\/|userdata\/|127\.0\.0\.1|localhost|\/)/i) &&
                        !nodeText.match(/\.(css|js|json)(\?|$)/i)) {
                        const translated = translateText(nodeText, lang, detectedNodeType);
                        if (translated !== nodeText) {
                            node.textContent = translated;
                            label.setAttribute(TRANSLATED_MARKER, lang);
                        }
                    }
                }
            });
        }
    });
    
    // 原生对话框拦截器已经在 setupTranslationInterceptor 中设置，无需重复设置
}

// 初始化
app.registerExtension({
    name: "Magic.Language.Switcher",
    async setup() {
        try {
            // 将翻译函数暴露到全局，供其他节点使用
            if (typeof window !== 'undefined') {
                window.getCurrentLanguage = getCurrentLanguage;
                window.translateText = translateText;
                window.translateElementImmediately = translateElementImmediately;
                window.allTranslations = allTranslations;
            }
            console.log("[Language Switcher] Extension setup started");
            // 等待ComfyUI完全加载后再创建悬浮球
            setTimeout(() => {
                try {
                    console.log("[Language Switcher] Creating switcher...");
                    createLanguageSwitcher();
                    const switcher = document.getElementById("magic-language-switcher");
                    if (switcher) {
                        console.log("[Language Switcher] Switcher created successfully");
                    } else {
                        console.error("[Language Switcher] Switcher creation failed - element not found");
                    }
                    setupNodeLanguageListener();
                    // 延迟初始化翻译拦截系统，避免影响悬浮球显示
                    setTimeout(() => {
                        try {
                            setupTranslationInterceptor();
                            const currentLang = getCurrentLanguage();
                            updateLanguage(currentLang);
                            // 延迟更新UI文本，确保DOM已创建
                            setTimeout(() => {
                                try {
                                    updateAllUITexts(currentLang);
                                } catch (e) {
                                    console.error("[Language Switcher] Error updating UI texts:", e);
                                }
                            }, 2000);
                        } catch (e) {
                            console.error("[Language Switcher] Error setting up translation interceptor:", e);
                        }
                    }, 500);
                } catch (e) {
                    console.error("[Language Switcher] Error creating switcher:", e);
                }
            }, 1000);
        } catch (e) {
            console.error("[Language Switcher] Setup error:", e);
        }
    }
});
