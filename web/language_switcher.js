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
    "INT8 LoRA 模式": { zh: "INT8 LoRA 模式", en: "INT8 LoRA Mode" },
    "选择 INT8 量化模型的 LoRA 加载方式。如果模型不是 INT8 量化模型，建议使用默认模式。": { zh: "选择 INT8 量化模型的 LoRA 加载方式。如果模型不是 INT8 量化模型，建议使用默认模式。", en: "Select INT8 quantized model LoRA loading method. If the model is not INT8 quantized, it is recommended to use the default mode." },
    "默认模式（标准 LoRA）": { zh: "默认模式（标准 LoRA）", en: "Default Mode (Standard LoRA)" },
    "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型": { zh: "使用 ComfyUI 标准 LoRA 加载方式，适用于所有模型类型", en: "Use ComfyUI standard LoRA loading method, suitable for all model types" },
    "INT8 静态模式（Stochastic）": { zh: "INT8 静态模式（Stochastic）", en: "INT8 Static Mode (Stochastic)" },
    "使用随机舍入的 INT8 LoRA 适配器，适合单个或少量 LoRA，精度更高": { zh: "使用随机舍入的 INT8 LoRA 适配器，适合单个或少量 LoRA，精度更高", en: "Use stochastic rounding INT8 LoRA adapter, suitable for single or few LoRAs with higher precision" },
    "INT8 动态模式（Dynamic）": { zh: "INT8 动态模式（Dynamic）", en: "INT8 Dynamic Mode (Dynamic)" },
    "运行时动态组合多个 LoRA，适合需要频繁切换或组合多个 LoRA 的场景": { zh: "运行时动态组合多个 LoRA，适合需要频繁切换或组合多个 LoRA 的场景", en: "Dynamically compose multiple LoRAs at runtime, suitable for scenarios requiring frequent switching or combining multiple LoRAs" }
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

// 所有翻译映射（按节点分类）
const allTranslations = {
    "MagicPowerLoraLoader": loraLoaderTranslations,
    "MagicLogicCompute": logicComputeTranslations,
    "MagicPhotopeaNode": photopeaTranslations,
    "MagicResolutionResize": resizeTranslations,
    "MagicResolution": resizeTranslations,
    "MagicPromptReplace": promptReplaceTranslations
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
                                    } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                              parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                              parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                              parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                              parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                        detectedNodeType = "MagicPromptReplace";
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
                            } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                      parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                      parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                      parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                      parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                detectedNodeType = "MagicPromptReplace";
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
            'Photopea', 'Magic Photopea', 'Magic Gallery'
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
                                } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                          parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                          parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                          parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                          parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                    detectedNodeType = "MagicPromptReplace";
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
                                } else if (parentText.includes('配置中心') || parentText.includes('Settings') ||
                                          parentText.includes('Magic Assistant 配置中心') || parentText.includes('Magic Assistant Settings Center') ||
                                          parentText.includes('规则编辑器') || parentText.includes('Rule Editor') ||
                                          parentText.includes('LLM服务') || parentText.includes('LLM Service') ||
                                          parentText.includes('Magic Prompt') || parentText.includes('Magic Assistant')) {
                                    detectedNodeType = "MagicPromptReplace";
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
                        parent.textContent.includes('Download')
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
