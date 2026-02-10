# ✨ Magic Assistant for ComfyUI

**A powerful 10-in-1 suite designed to simplify your workflow.**
**一个专注于"多功能集成"的强大 ComfyUI 助手插件。**

Our goal is to replace complex node chains with single, intelligent nodes.
我们的目标是用单个智能节点替代繁琐的"面条式"连线。

---

## 📝 Version Update Introduction / 版本更新介绍

> Latest Update / 最新更新：2026-02-11

> **V1.2.2 版本介绍 / Version Introduction** 2026-02-11

> 1. **New Feature / 新增功能**: Magic Power LoRA Loader - LoRA 串连功能
>    * 新增 `lora串接受` 和 `lora串输出` 端口，支持多个强力 LoRA 加载器之间串连
>    * 输出了 `lora串` 的 LoRA 加载器不加载 LoRA，仅将自己配置的 LoRA 列表传递给下一个加载器
>    * 直到最后一个不输出 `lora串` 的加载器（链末端）才加载所有自身以及接收到的 LoRA
>    * 可搭配 SDNQ 模式用于模型全局卸载再加载使用（非 SDNQ 模式也可以根据自己的需求使用）
>    * 输出了 `lora串` 的 LoRA 加载器可以不连接 model 和 clip 了
>    * 修复了 bypass（忽略）节点时 lora 串无法正确透传的问题
>    * 使用自定义类型 MAGIC_LORA_CHAIN 替代 STRING，确保 ComfyUI 正确处理连接依赖和 bypass 透传
>    * Added `lora串接受` (lora chain input) and `lora串输出` (lora chain output) ports for chaining multiple Magic Power LoRA Loaders
>    * LoRA loaders that output `lora串` don't load LoRAs; they only pass their configured LoRA list to the next loader
>    * Only the last loader (chain end) that doesn't output `lora串` loads all LoRAs (its own + received)
>    * Can be used with SDNQ mode for global model unload/reload (also works in non-SDNQ mode)
>    * LoRA loaders that output `lora串` don't require model/clip connections
>    * Fixed issue where bypassed nodes couldn't correctly pass through lora chains
>    * Uses custom type MAGIC_LORA_CHAIN instead of STRING for proper ComfyUI connection handling and bypass passthrough

> 2. **Bug Fix / 错误修复**: Magic SDNQ K Sampler - 修复文生图图片过小的 bug
>    * 修复了文生图模式下输出图片尺寸过小的问题
>    * Fixed issue where generated images were too small in text-to-image mode

> 3. **Optimization / 优化**: Magic SDNQ K Sampler - VAE 加载日志顺序优化
>    * 调整了 VAE 加载日志的输出顺序，使其出现在 pipeline 加载信息之后、采样信息之前
>    * Optimized VAE loading log sequence to appear after pipeline loading info and before sampling info

> **V1.2.1 版本介绍 / Version Introduction** 2026-02-11

> 1. **Optimization / 优化**: 代码优化与 bug 修复
>    * 与官方 K 采样器对齐的显存管理、全模型（文生图/图生图/图编辑）输出尺寸补偿等逻辑优化与修复
>    * Code and bug fixes including VRAM handling alignment with official KSampler and output size compensation for all modes (txt2img, img2img, image edit)

> 2. **New Feature / 新增功能**: SDNQ K 采样器局部重绘适配
>    * 支持所有 SDNQ 模型（含 Flux2Klein）；使用 ComfyUI 的 InpaintModelConditioning + SetLatentNoiseMask 准备数据
>    * 4D latent 模型（如 SDXL/GLM）采用 latent 空间混合；3D packed 模型（如 Flux/Flux2/QwenImage/Chroma）采用像素空间 composite
>    * SDNQ node introduction includes an example inpainting workflow (download image to import into ComfyUI)
>    * Inpainting support for all SDNQ models; use InpaintModelConditioning + SetLatentNoiseMask; 4D models use latent blending, 3D packed models use pixel-space composite

> 3. **New Feature / 新增功能**: SDNQ K 采样器模式切换（SDNQ / SDNQ + KSampler）
>    * 可切换「仅 SDNQ」与「SDNQ + KSampler」两种模式。「仅 SDNQ」下接入非 SDNQ 模型会报错；「SDNQ + KSampler」下根据接入模型自动选择采样方式
>    * 在「SDNQ + KSampler」模式下，SDNQ 模型走 SDNQ 逻辑，其他模型（如 CheckpointLoader）走 ComfyUI 官方 KSampler，即可当作通用 K 采样器使用
>    * Sampler mode switch: "SDNQ" (SDNQ models only) or "SDNQ + KSampler" (auto-detect; non-SDNQ models use official KSampler)

> **V1.2.0 版本介绍 / Version Introduction** 2026-02-11

> 1. **Optimization / 优化**: Magic SDNQ K Sampler - VRAM 处理逻辑与官方 K 采样器对齐
>    * 采样前接入 ComfyUI 的 load_models_gpu / free_memory，与其他模型统一显存管理
>    * 在 12GB 等显存下可先卸载其他已加载模型、再加载 SDNQ 进行采样，减少爆显存
>    * SDNQ K Sampler now uses ComfyUI's load_models_gpu/free_memory for consistent VRAM control with official KSampler
>    * On 12GB VRAM, other models can be offloaded before SDNQ sampling to reduce OOM

> 2. **New Feature / 新增功能**: Magic SDNQ Loader - FLUX 系列支持外接 CLIP/VAE（仅加载本体）
>    * FLUX、FLUX.2（含 Flux2Klein）模型可**同时**连接外部的 CLIP 和 VAE，仅加载 SDNQ 目录下的 transformer 本体，省显存、可提升生成速度
>    * 必须同时连接 CLIP 与 VAE 才启用“仅加载本体”；只连其一将报错；两者都不连则整包加载
>    * 当前仅 FLUX / FLUX.2 支持该模式；其他模型（如 Qwen、Z-Image）连接外接 CLIP/VAE 时会提示不支持
>    * FLUX and FLUX.2 (including Flux2Klein) can use external CLIP + VAE and load only the transformer body from SDNQ for lower VRAM and faster generation
>    * Both CLIP and VAE must be connected to enable body-only loading; connect neither for full-package load
>    * Only FLUX/FLUX.2 support this mode; other model types will show an error if external CLIP/VAE are connected

<details>
<summary>Click to view more previous updates / 点击查看往期更多更新内容</summary>

> **V1.1.9 版本介绍 / Version Introduction** 2026-02-08

> 1. **New Feature / 新增功能**: Magic SDNQ Loader & Sampler - SDNQ 独立模型加载节点与采样器
>    * 独立的 SDNQ 模型加载节点和采样器节点，采样方式与 LoRA 加载方式贴近 ComfyUI 官方
>    * SDNQ 模型自带 model、clip、vae，可灵活搭配其他节点
>    * 强力 LoRA 加载器新增 SDNQ 模式，在设置中切换即可支持 SDNQ 模型
>    * 按照 SDNQ 技术源仓库教程配置环境后即可使用
>    * SDNQ 的详细功能和工作流请参阅 [节点介绍](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器)
>    * Standalone SDNQ model loader and sampler nodes, sampling and LoRA loading similar to official ComfyUI
>    * SDNQ models include model, clip, vae; can be combined with other nodes
>    * Magic Power LoRA Loader adds SDNQ mode; switch in settings to support SDNQ models
>    * Follow SDNQ technical source repo tutorial for environment setup
>    * For detailed SDNQ features and workflow, see [Node Introduction](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器)

> 2. **Update / 更新**: Magic Power LoRA Loader - 节点最小尺寸限制
>    * 设置节点最小宽高为 470×300，防止加载时权重修改按钮不可见或 UI 溢出
>    * Set minimum node size to 470×300 to prevent weight control being hidden or UI overflow

> **V1.1.6 版本介绍 / Version Introduction** 2026-01-31

> 1. **Update / 更新**: Magic Multi-Group Switch - 万能禁用/忽略多框节点优化 / Node Group Control Optimization
>    * Changed update button to click-to-refresh functionality / 修改更新按钮为点击刷新功能
>    * Added real-time node group update option in property panel / 在属性面板也可以开启实时更新节点组功能
>    * Added automatic saving of node group pinning information / 新增自动保存节点组固定信息功能
>    * Node group pinning persists after reopening workflows / 节点组固定信息会在重开工作流后保持，无需重新固定
>    * Improved user experience for managing node groups / 优化节点组管理体验
>    * 修改更新按钮为点击刷新功能
>    * 在属性面板也可以开启实时更新节点组功能
>    * 新增自动保存节点组固定信息功能，重开工作流后无需重新固定
>    * 优化节点组管理体验

> 2. **New Feature / 新增功能**: Magic Power LoRA Loader - SDNQ Model Support / SDNQ 模型支持
>    * Added LoRA loading support for SDNQ quantized models / 新增对 SDNQ 量化模型的 LoRA 加载支持
>    * Compatible with [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) repository / 兼容 [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) 主分支仓库
>    * Supports SDNQ quantized models from [HuggingFace SDNQ Collection](https://huggingface.co/collections/Disty0/sdnq) / 支持来自 [HuggingFace SDNQ 集合](https://huggingface.co/collections/Disty0/sdnq) 的 SDNQ 量化模型
>    * 新增对 SDNQ 量化模型的 LoRA 加载支持
>    * 兼容 [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) 主分支仓库
>    * 支持来自 [HuggingFace SDNQ 集合](https://huggingface.co/collections/Disty0/sdnq) 的 SDNQ 量化模型

> **V1.1.7 版本介绍 / Version Introduction** 2026-01-31

> 1. **Bug Fix / 错误修复**: Magic Power LoRA Loader - LoRA Loading Fix / LoRA 加载修复
>    * Fixed duplicate LoRA loading issue when selecting INT8 or SDNQ modes / 修复了选择 INT8 或 SDNQ 模式时 LoRA 重复加载的问题
>    * Improved mode selection logic to ensure only one loading method is executed / 改进了模式选择逻辑，确保只执行一种加载方法
>    * Enhanced SDNQ mode fallback mechanism for better error handling / 增强了 SDNQ 模式的回退机制，提供更好的错误处理
>    * LoRA mode selection only applies to individual nodes, different Magic Power LoRA Loader nodes can use different modes as needed / LoRA 模式选择只作用于单一节点，不同的强力lora加载节点可以按照需求使用不同模式
>    * 修复了选择 INT8 或 SDNQ 模式时 LoRA 重复加载的问题
>    * 改进了模式选择逻辑，确保只执行一种加载方法
>    * 增强了 SDNQ 模式的回退机制，提供更好的错误处理
>    * LoRA 模式选择只作用于单一节点，不同的强力lora加载节点可以按照需求使用不同模式

> **V1.1.5 版本介绍 / Version Introduction** 2026-01-29

> 1. **New Feature / 新增功能**: Magic Power LoRA Loader - INT8 Mode Support / INT8 模式支持
>    * Added INT8 quantized model LoRA loading support compatible with [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8) / 新增 INT8 量化模型 LoRA 加载支持，兼容 [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8)
>    * Supports latest Flux Klein 9B INT8 models (e.g., [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)) / 支持最新的 Flux Klein 9B INT8 模型（如 [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)）
>    * Two loading modes: Static (Stochastic) and Dynamic / 两种加载模式：静态模式（Stochastic）和动态模式（Dynamic）
>    * Static mode uses stochastic rounding for higher precision, suitable for single or few LoRAs / 静态模式使用随机舍入保持更高精度，适合单个或少量 LoRA
>    * Dynamic mode enables runtime composition of multiple LoRAs, ideal for frequent switching scenarios / 动态模式支持运行时组合多个 LoRA，适合需要频繁切换的场景
>    * Settings button added to configure INT8 mode / 新增设置按钮，可配置 INT8 模式
>    * Automatic fallback to standard mode if INT8 loading fails / 如果 INT8 加载失败，自动回退到标准模式
>    * All INT8 LoRA functionality integrated into the node, no external dependencies required / 所有 INT8 LoRA 功能已整合到节点中，无需外部依赖
>    * 新增 INT8 量化模型 LoRA 加载支持，兼容 [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8)
>    * 支持最新的 Flux Klein 9B INT8 模型（如 [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)）
>    * 两种加载模式：静态模式（Stochastic）和动态模式（Dynamic）
>    * 静态模式使用随机舍入保持更高精度，适合单个或少量 LoRA
>    * 动态模式支持运行时组合多个 LoRA，适合需要频繁切换的场景
>    * 新增设置按钮，可配置 INT8 模式
>    * 如果 INT8 加载失败，自动回退到标准模式
>    * 所有 INT8 LoRA 功能已整合到节点中，无需外部依赖

> **V1.1.4 版本介绍 / Version Introduction** 2026-01-14

> 1. **Update / 更新**: Magic Power LoRA Loader - 强力lora加载器模型支持扩展 / Extended Model Support
>    * Renamed from "Magic Power SDXL LoRA Loader" to "Magic Power LoRA Loader" / 原"强力SDXL Lora加载器"改名为"强力Lora加载器"
>    * Now supports LoRA loading for multiple large models including ZImage, Qwen, Flux, and more / 现已支持 ZImage、Qwen、Flux 等多种大模型的 LoRA 加载
>    * Note: Nunchaku quantized models are not yet fully supported / 注意：尚未支持所有由 Nunchaku 量化的模型
>    * 原"强力SDXL Lora加载器"改名为"强力Lora加载器"
>    * 现已支持 ZImage、Qwen、Flux 等多种大模型的 LoRA 加载
>    * 注意：尚未支持所有由 Nunchaku 量化的模型

> 2. **New Feature / 新增功能**: Language Switcher Floating Ball - 语言切换悬浮球 / Bilingual UI Support
>    * Added a floating language switcher without modifying any original node code or functionality / 在不改任何原节点代码和功能的情况下新增了双语切换悬浮球
>    * Bilingual translation for all known UI texts and button labels (Chinese & English) / 已将所有已知的会影响使用的文本和按钮文本进行了中英文翻译
>    * Real-time language switching for some node windows and UIs / 部分节点的窗口和 UI 可以实时切换语言
>    * If language doesn't change after switching, please reopen the node's function window (e.g., Settings Center) / 如果切换后发现语言没有改变，请重新打开节点的功能窗口（如配置中心）
>    * Note: This is a test feature and may be improved in future versions / 注意：当前语言功能为测试版本，后续版本可能会进行优化改进
>    * 在不改任何原节点代码和功能的情况下新增了双语切换悬浮球
>    * 已将所有已知的会影响使用的文本和按钮文本进行了中英文翻译（部分特殊文本可能无法翻译）
>    * 部分节点的窗口和 UI 可以实时切换语言
>    * 如果切换后发现语言没有改变，请重新打开节点的功能窗口（如配置中心）
>    * 注意：当前语言功能为测试版本，后续版本可能会进行优化改进

> **V1.1.3 版本介绍 / Version Introduction** 2026-01-07

> 1. **New Node / 新增节点**: Magic Resolution Output - 分辨率输出器
>    * Outputs width (INT), height (INT), and latent (LATENT) / 输出宽(INT)、高(INT)和潜在空间(LATENT)
>    * Preset resolution dropdown, shares dimensions data with Magic Multi-Function Image Resize / 预设分辨率下拉菜单，与多功能图像缩放节点共享分辨率数据
>    * One-click swap button to exchange width and height values / 一键交换按钮，快速交换宽高值
>    * Batch size management for latent output / 潜在空间输出支持批次管理
>    * Preset management window for custom resolutions / 预设管理窗口，支持自定义分辨率
>    * Simplified logic: preset directly fills input fields, swap button exchanges values, output uses current input values / 简化逻辑：预设直接填充输入框，交换按钮交换值，输出使用当前输入值
>    * 输出宽(INT)、高(INT)和潜在空间(LATENT)
>    * 预设分辨率下拉菜单，与多功能图像缩放节点共享分辨率数据
>    * 一键交换按钮，快速交换宽高值
>    * 潜在空间输出支持批次管理
>    * 预设管理窗口，支持自定义分辨率
>    * 简化逻辑：预设直接填充输入框，交换按钮交换值，输出使用当前输入值

> **V1.1.2 版本介绍 / Version Introduction** 2026-01-06

> 1. **New Feature / 新增功能**: Built-in Update Checker / 内置更新检测器
>    * Automatically checks for updates when ComfyUI starts / 启动时自动检测更新
>    * Bilingual update notification popup (Chinese & English) / 中英文双语更新提示弹窗
>    * Displays update information from GitHub README / 显示 GitHub README 中的更新信息
>    * "Ignore this version" option to skip specific version notifications / "忽略此版本"选项，可跳过特定版本提醒
>    * "GitHub Repository" button to open GitHub repository / "GitHub 地址"按钮，可打开 GitHub 仓库
>    * Smart version ignoring: only ignores the selected version, will notify again for newer versions / 智能忽略：仅忽略所选版本，新版本仍会提醒

> **V1.1.1 版本介绍 / Version Introduction** 2026-01-06
>
> 1. **Optimization / 优化**: Fixed dialog drag logic, supports full-direction dragging, resolves drag offset issues / 修复弹窗拖拽逻辑，支持全方向拖动，解决拖拽偏移问题
>
> 2. **New Feature / 新增功能**: Folder toggle button to enable/disable all loras in a folder / 文件夹开关按钮，一键启用/禁用文件夹下所有 lora
>
> 3. **New Feature / 新增功能**: Auto-read preferred weight from .log files when adding loras / 添加 lora 时自动读取 .log 文件中的 preferred weight 并设置权重
>
> 4. **New Feature / 新增功能**: Settings cache for crawl lora info window, auto-save and load user preferences / 爬取 lora 信息窗口支持设置缓存，自动保存和加载用户习惯设置
>
> 5. **Optimization / 优化**: Improved lora row drag logic, only allows dragging on blank area and sort button to avoid misoperation / 改进 lora 行拖拽逻辑，只在空白区域和排序按钮允许拖拽，避免误操作
>
> 6. **Optimization / 优化**: All dialogs support draggable functionality, improving user experience / 所有弹窗支持可拖拽功能，提升用户体验

> **V1.1.0 版本介绍 / Version Introduction** 2026-01-06
>
> 1. **新增节点**: Magic Power LoRA Loader - 强力lora加载器
>    * 可视化图库界面，告别下拉菜单的繁琐操作
>    * 支持文件夹分类管理，更好的组织 LoRA 集合
>    * 拖拽排序功能，支持向上/向下插入，轻松调整顺序
>    * 自动预览图检测和显示
>    * 标签系统，方便搜索和筛选
>    * 批量操作，一键启用/禁用多个 LoRA
>    * 智能预览图检测，支持 `magicloradate` 子目录
>
> 2. **优化**: 修复排序特效显示问题，优化拖拽排序逻辑
>    * 修复了排序时特效不显示的问题
>    * 优化了拖拽排序的插入逻辑，支持根据鼠标位置向上或向下插入
>    * 修复了 lora 排序和文件夹排序之间的特效干扰问题

> **V1.0.1 版本介绍** 2026-01-05
>
> 1. **修复**: 修复 Photopea 节点的所有已知 BUG 和错误
>
> 2. **新增功能**: Gallery Pin 功能，可以固定常用图片
>
> 3. **优化**: 将存储位置移动到根目录，提升性能

> **V1.0.0 版本介绍** 2026-01-04
>
> 1. **重构**: 重置版本号为 1.0.0，作为正式发布版本
>
> 2. **修复**: 修复遮罩编辑器黑图问题
>
> 3. **新增功能**: 添加清空缓存按钮
>
> 4. **优化**: 清理图库列表，隐藏临时文件

</details>

---

## 🧩 Node Features / 节点功能详解

### 1. 🎨 Magic Photopea Node (Photopea 图像处理与加载图像)
> **The image manager & image editor inside ComfyUI.** / **ComfyUI 图片管理与修图工具。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Input File Manager**: A visual gallery to manage **your uploaded images** and **saved history** in the `input` folder. No more digging through dropdown lists!
* **Seamless Editing**: One-click to send any user image to Photopea for editing (Photoshop-like experience) and save it back instantly.
* **Dual Path Support**: Automatically detects and manages files in both the root `input/` folder (uploads) and the `magic_photopea/` folder (edits).
* **Batch Management**: Features **Multi-Select**, **Batch Delete**, and **Rename** to keep your input directory clean and organized.
* **输入文件管理**: 一个可视化的文件管理器，专门用于管理**您自己上传的图片**以及**修图保存的历史记录**。彻底告别在下拉菜单里"盲找"文件的痛苦。
* **无缝修图**: 一键将您导入的图片发送到 Photopea (类PS体验) 进行编辑，保存后自动同步，无需下载上传。
* **双路径支持**: 智能识别并管理 `input/` 根目录（用户上传）和 `magic_photopea/` 目录（编辑存档）下的所有文件。
* **批量管理**: 提供**多选删除**、**批量清理**和**重命名**功能，帮您把杂乱的 input 文件夹整理得井井有条。
* **Fixed**: Compatibility with official Mask Editor (right-click -> Save to node now works perfectly).
* **Improved**: Gallery now hides temporary `clipspace` files for a cleaner view.
* **New**: Added "🧹 Clear Cache" button to remove temporary mask files.
* **修复**: 完美兼容官方遮罩编辑器（右键绘画保存即生效）。
* **优化**: 图库列表自动过滤 clipspace 临时文件，更加清爽。
* **新增**: "🧹 清空缓存"按钮，一键清理遮罩临时文件。

</details>

### 2. 🤖 Magic Multi-Function AI Prompt Replace (AI 提示词替换)
> **Your intelligent prompt engineer.** / **您的专属提示词工程师。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **LLM Powered**: Seamlessly integrates with OpenAI-compatible APIs to rewrite or optimize your prompts.
* **Role-Play & Rules**: Built-in system prompts allow the AI to act as a "Prompt Expert", "Translator", or any custom role you define.
* **One-Click Presets**: Comes with handy rules (e.g., "Fix Grammar", "Convert to Tags") stored locally.
* **AI 驱动**: 无缝对接 OpenAI 格式接口，智能润色或重写提示词。
* **角色扮演**: 内置多种预设，让 AI 化身"提示词专家"或"翻译官"。
* **本地预设**: 支持保存和一键调用常用规则。

</details>

### 3. 🧠 Magic Programmable Logic & Calc (Tutorial) (可编程逻辑计算 - 带教程版)
> **The ultimate solution for logic & math.** / **逻辑与数学运算的终极方案。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Exclusive "Magic Script"**: Write pseudo-code directly in the node! (e.g., `IF w > 1024 RETURN 1024, h`).
* **Auto Variables**: Automatically detects input image/latent width (`w`) and height (`h`).
* **Complex Made Simple**: Handles math (`+ - * /`), comparisons (`> < =`), and logic (`AND/OR`) in **ONE** node.
* **独家"魔法脚本"**: 直接在节点内编写伪代码！支持 `IF...RETURN` 逻辑。
* **智能变量**: 自动识别输入图片或 Latent 的宽 (`w`) 高 (`h`)。
* **化繁为简**: 一个节点搞定所有数学运算、大小比较和布尔逻辑。

</details>

### 4. 📏 Magic Multi-Function Image Resize (多功能图像缩放)
> **Smart resize for SDXL & SD1.5.** / **专为 SDXL 和 SD1.5 设计的智能缩放。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Smart "Long Edge" Mode**: Set the target size (e.g., 1024), and it automatically calculates the other side to maintain the aspect ratio.
* **Multiple Methods**: Supports all standard resizing methods (nearest, bilinear, bicubic, lanczos, etc.).
* **Presets**: Built-in resolutions for SD1.5, SDXL, 2K, and 4K.
* **长边机制**: 设定长边数值（如 1024），自动计算短边以保持比例。
* **多种算法**: 支持所有主流缩放插值算法。
* **常用预设**: 内置 SD1.5、SDXL 以及 2K/4K 等常用分辨率。

</details>

### 5. 🎛️ Magic Multi-Group Switch (万能禁用/忽略多框)
> **Workflow controller & debugger.** / **工作流的指挥官与调试器。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Group Management**: Quickly enable/disable/bypass multiple groups of nodes.
* **One-Click Toggle**: Switch entire workflows on or off with a single boolean input.
* **Click-to-Refresh**: Update button changed to click-to-refresh functionality for better control.
* **Real-time Updates**: Option to enable real-time node group updates in property panel.
* **Auto-Save Pinning**: Node group pinning information is automatically saved and persists after reopening workflows.
* **群组管理**: 快速启用、禁用或绕过指定节点组。
* **一键开关**: 通过简单的布尔值输入，控制整条工作流的通断。
* **点击刷新**: 更新按钮改为点击刷新功能，提供更好的控制体验。
* **实时更新**: 在属性面板可以开启实时更新节点组功能。
* **自动保存固定**: 节点组固定信息会自动保存，重开工作流后无需重新固定。

</details>

### 6. 📝 Magic Multi-Function Prompt Box (多功能提示词框)
> **Simple but effective text concatenation.** / **简单高效的文本组合。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Dynamic Input**: Features a `prepend_text` interface to automatically merge incoming text.
* **Auto Formatting**: Automatically handles comma separation (`, `).
* **Integrated Output**: Outputs both String and CLIP Conditioning directly.
* **动态拼接**: 带有前置接口，自动将外部输入的文本合并到最前方。
* **自动格式化**: 自动处理逗号分隔，无需手动添加连接符。
* **直接输出**: 同时支持输出纯文本字符串和 CLIP 编码后的条件。

</details>

### 7. 🚀 Magic Power LoRA Loader (强力lora加载器)
> **Visual LoRA manager with drag-and-drop sorting.** / **可视化 LoRA 管理器，支持拖拽排序。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Visual Management**: Beautiful gallery interface to browse and manage all your LoRAs. No more scrolling through long dropdown lists!
* **Folder Organization**: Organize LoRAs into custom folders for better categorization and management.
* **Drag & Drop Sorting**: Intuitive drag-and-drop interface to reorder LoRAs and folders. Supports both upward and downward insertion based on mouse position.
* **Preview Images**: Automatic preview image detection and display for each LoRA.
* **Tag System**: Add custom tags to LoRAs for easy searching and filtering.
* **Batch Operations**: Enable/disable multiple LoRAs at once, adjust weights, and manage your entire LoRA collection efficiently.
* **Smart Preview Detection**: Automatically finds preview images in `magicloradate` subdirectory or same directory as LoRA files.
* **Folder Toggle**: One-click toggle button to enable/disable all LoRAs in a folder.
* **Auto Weight from Log**: Automatically reads preferred weight from .log files when adding LoRAs.
* **Settings Cache**: Crawl settings are automatically saved and restored for convenient reuse.
* **INT8 Mode Support**: Supports INT8 quantized model LoRA loading compatible with [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8). Supports latest Flux Klein 9B INT8 models (e.g., [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)). Two loading modes: Static (Stochastic) and Dynamic. Static mode provides higher precision with stochastic rounding, suitable for single or few LoRAs. Dynamic mode enables runtime composition of multiple LoRAs, ideal for frequent switching scenarios.
* **SDNQ Model Support**: Added LoRA loading support for SDNQ quantized models. Switch to SDNQ mode in node settings to use with SDNQ models from [Magic SDNQ Loader](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器).
* **可视化管理**: 精美的图库界面，浏览和管理所有 LoRA，告别下拉菜单的繁琐操作。
* **文件夹分类**: 将 LoRA 整理到自定义文件夹中，实现更好的分类管理。
* **拖拽排序**: 直观的拖拽排序界面，支持根据鼠标位置向上或向下插入，轻松调整 LoRA 和文件夹的顺序。
* **预览图显示**: 自动检测并显示每个 LoRA 的预览图片。
* **标签系统**: 为 LoRA 添加自定义标签，方便搜索和筛选。
* **批量操作**: 一键启用/禁用多个 LoRA，调整权重，高效管理整个 LoRA 集合。
* **智能预览检测**: 自动在 `magicloradate` 子目录或 LoRA 文件同目录查找预览图。
* **文件夹开关**: 文件夹开关按钮，一键启用/禁用文件夹下所有 lora。
* **自动权重**: 添加 lora 时自动读取 .log 文件中的 preferred weight 并设置权重。
* **设置缓存**: 爬取设置自动保存和恢复，方便重复使用。
* **INT8 模式支持**: 支持 INT8 量化模型的 LoRA 加载，兼容 [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8)。支持最新的 Flux Klein 9B INT8 模型（如 [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)）。包含静态模式（Stochastic）和动态模式（Dynamic）两种加载方式。静态模式使用随机舍入保持更高精度，适合单个或少量 LoRA。动态模式支持运行时组合多个 LoRA，适合需要频繁切换的场景。
* **SDNQ 模型支持**: 新增对 SDNQ 量化模型的 LoRA 加载支持。在节点设置中切换为 SDNQ 模式即可与 [Magic SDNQ Loader](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器) 配合使用。

</details>

### 8. 📐 Magic Resolution Output (分辨率输出器)
> **Simple resolution output with presets and batch support.** / **简单的分辨率输出，支持预设和批次管理。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

* **Triple Output**: Outputs width (INT), height (INT), and latent (LATENT) simultaneously / 同时输出宽(INT)、高(INT)和潜在空间(LATENT)
* **Preset System**: Dropdown menu with predefined resolutions, shares dimensions data with Magic Multi-Function Image Resize / 预设分辨率下拉菜单，与多功能图像缩放节点共享分辨率数据
* **One-Click Swap**: Simple button to exchange width and height values instantly / 一键交换按钮，快速交换宽高值
* **Batch Management**: Supports batch size control for latent output / 潜在空间输出支持批次管理
* **Preset Management**: Custom preset management window to add/delete resolutions / 预设管理窗口，支持添加/删除自定义分辨率
* **Simplified Logic**: Preset directly fills input fields, swap button exchanges values, output uses current input values / 简化逻辑：预设直接填充输入框，交换按钮交换值，输出使用当前输入值
* **三重输出**: 同时输出宽(INT)、高(INT)和潜在空间(LATENT)
* **预设系统**: 预设分辨率下拉菜单，与多功能图像缩放节点共享分辨率数据
* **一键交换**: 简单的交换按钮，快速交换宽高值
* **批次管理**: 潜在空间输出支持批次管理
* **预设管理**: 自定义预设管理窗口，支持添加/删除分辨率
* **简化逻辑**: 预设直接填充输入框，交换按钮交换值，输出使用当前输入值

</details>

### 9. 📦 Magic SDNQ Loader & 🎲 Magic SDNQ K Sampler (SDNQ 模型加载器与 K 采样器)
> **Standalone SDNQ model loading and sampling, ComfyUI-style workflow.** / **独立的 SDNQ 模型加载与采样，贴近 ComfyUI 官方工作流。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

#### SDNQ 相关仓库说明 / SDNQ Repository Reference

* **ComfyUI SDNQ 主分支仓库**（本插件 SDNQ 功能基于此）：[comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) —— 首个实现 ComfyUI 使用 SDNQ 的节点，持续更新中。副分支 comfyui-sdnq-splited 为 fork 已停止更新；sdnq 为 SDNQ 技术源仓库，三者勿混淆。
* **ComfyUI SDNQ main branch** (this plugin is based on): [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) — First ComfyUI SDNQ node implementation, actively maintained. Fork comfyui-sdnq-splited is no longer updated; sdnq is the technical source. Do not confuse the three.

#### 为什么选择本插件的 SDNQ 方案？/ Why This Approach?

本插件基于 [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) 主分支的代码实现 SDNQ 功能。采用**独立的模型加载节点 + 采样器节点**设计，采样方式与 LoRA 加载方式贴近 ComfyUI 官方，更符合 ComfyUI 用户的使用习惯。SDNQ 模型本身自带 model、clip、vae，天然适合拆分为独立加载节点和采样器节点。同时，**强力 LoRA 加载器**已适配 SDNQ 模型，只需在设置中将 LoRA 加载模式切换为 SDNQ 即可。本插件的 SDNQ 支持**所有已适配的模型**，不限于单一架构。按照下方安装说明配置好 SDNQ 环境后，即可用本插件节点更简单便捷地使用 SDNQ 模型。

This plugin implements SDNQ based on the [comfyui-sdnq](https://github.com/EnragedAntelope/comfyui-sdnq) main branch code. It uses **standalone model loader + sampler nodes**, with sampling and LoRA loading similar to official ComfyUI. SDNQ models include model, clip, and vae, so they fit naturally into separate loader and sampler nodes. **Magic Power LoRA Loader** supports SDNQ; switch to SDNQ mode in settings. This plugin's SDNQ supports **all adapted models**, not limited to a single architecture. After configuring the environment per the installation guide below, you can use SDNQ models easily.

#### 使用本插件运行 SDNQ 的优势 / Advantages

* **模型与采样器独立**：无 LoRA 数量限制，可自由搭配其他节点进行复杂操作
* **支持丰富工作流**：图生图、文生图、深度图控制、姿态图控制等
* **采样逻辑接近官方**：仿照官方 KSampler 的生成逻辑
* **实时进度与预览**：可实时显示采样进度和预览图，与官方 K 采样器几乎一致
* **Standalone model & sampler**: No LoRA limit; freely combine with other nodes
* **Rich workflows**: Img2img, txt2img, depth control, pose control, etc.
* **Official-like sampling**: Logic follows official KSampler
* **Real-time progress & preview**: Displays sampling progress and preview like official KSampler

#### 外接 CLIP/VAE（仅加载本体）/ External CLIP & VAE (Body-Only Loading)

FLUX 系列模型（包括 FLUX.1、FLUX.2 及最新的 Flux2Klein）支持**同时连接**外部的 CLIP 和 VAE：加载时仅从 SDNQ 目录加载 transformer 本体（约 5GB），使用您连接的 CLIP 与 VAE。这样既能节省显存，也可能获得更好的效果，并提高生成速度。**注意**：必须**同时**连接 CLIP 与 VAE 才会启用“仅加载本体”；只连其中一个会报错；两者都不连则按整包加载。

FLUX models (including FLUX.1, FLUX.2, and Flux2Klein) support **connecting both** external CLIP and VAE: only the transformer body (~5GB) is loaded from the SDNQ folder, using your connected CLIP and VAE. This saves VRAM, may improve quality, and speeds up generation. **Note**: You must connect **both** CLIP and VAE to enable body-only loading; connecting only one will raise an error; connecting neither loads the full package.

**外接 CLIP/VAE 示例工作流 / Example Workflow (External CLIP + VAE)**（可直接下载图片导入 ComfyUI / Download image and import into ComfyUI）

<img width="4286" height="2709" alt="SDNQ External CLIP VAE Workflow" src="https://github.com/user-attachments/assets/853a2ef1-a64d-42d9-84d1-8d11a027e2a1" />

**运行结果 / Result**（RTX 3060 本次采样约 40.88s / RTX 3060, ~40.88s per sample）

<img width="2048" height="1058" alt="SDNQ External CLIP VAE Result" src="https://github.com/user-attachments/assets/04a22e66-397b-47a9-b8c2-8359b4cfcb5a" />

**性能参考 / Performance**: 在不超过 1024×1536 分辨率下，单图编辑或文生图时，采样可快至约 10–20 秒，速度与效率较高。其他模型（如 Qwen、Z-Image）的外接 CLIP/VAE 支持将在后续版本考虑。

At 1024×1536 or below, single image editing or text-to-image can complete in about 10–20 seconds. Support for external CLIP/VAE on other model types (e.g. Qwen, Z-Image) may be added in future versions.

#### 局部重绘工作流事例 / Inpainting Example Workflow

可直接下载图片导入 ComfyUI 使用。You can download the image and import into ComfyUI.

<img width="4995" height="2281" alt="SDNQ Inpainting Workflow" src="https://github.com/user-attachments/assets/8bec05e9-4de1-4674-ba47-fbc5cef2060c" />

**运行结果 / Result**

<img width="2544" height="1060" alt="SDNQ Inpainting Result" src="https://github.com/user-attachments/assets/2ca3b26f-eefe-48e2-95c3-d75d4025f0f9" />

#### ⚠️ 注意事项 / Notes

* **✅ 局部重绘 / Inpainting**：SDNQ K 采样器已适配局部重绘，支持所有 SDNQ 模型（含 Flux2Klein）。使用 ComfyUI 的 **InpaintModelConditioning** + **SetLatentNoiseMask** 准备数据即可；4D latent 模型采用 latent 空间混合，3D packed 模型（如 Flux/Flux2）采用像素空间 composite。下方附有局部重绘示例工作流。
* **Inpainting supported**: Use **InpaintModelConditioning** + **SetLatentNoiseMask**; 4D models use latent blending, 3D packed models use pixel-space composite. Example workflow below.
* **🎲 采样模式切换 / Sampler mode**: 可选「仅 SDNQ」或「SDNQ + KSampler」。在「SDNQ + KSampler」模式下，根据接入模型自动选择采样方式（SDNQ 模型走 SDNQ 逻辑，其他模型走官方 KSampler），可当作通用 K 采样器使用。
* **Sampler mode**: "SDNQ" (SDNQ only) or "SDNQ + KSampler" (auto-detect; non-SDNQ models use official KSampler).
* **当前仅支持图像**：因配置限制，暂未适配视频模型，仅支持图像生成和图像编辑模型。视频模型适配将在后续版本考虑。
* **Image models only**: Video model support is not yet implemented; currently supports image generation and image editing models only.

#### 简易文生图工作流参考 / Simple Text-to-Image Workflow

可直接下载图片导入 ComfyUI 使用。You can download and import into ComfyUI.

<img width="3398" height="2395" alt="SDNQ Text-to-Image Workflow" src="https://github.com/user-attachments/assets/7fa5b931-adde-4765-ab8c-2270c218bf9f" />

**效果预览 / Result Preview**

<img width="1437" height="898" alt="SDNQ Text-to-Image Result" src="https://github.com/user-attachments/assets/94e1d2f3-fc18-4527-9b15-a48a17b0bc55" />

#### 简易图片编辑工作流参考 / Simple Image Editing Workflow

可直接下载图片导入 ComfyUI 使用。You can download and import into ComfyUI.

<img width="3870" height="2709" alt="SDNQ Image Editing Workflow" src="https://github.com/user-attachments/assets/173acf73-d075-4abd-b229-28bd23c60c97" />

**效果预览 / Result Preview**

<img width="2154" height="1078" alt="SDNQ Image Editing Result" src="https://github.com/user-attachments/assets/7cadf12c-3aac-45af-805a-ac40aefbdd21" />

</details>

---

## 📦 Installation / 安装

1.  **Clone the repository / 克隆仓库**:
    ```bash
    cd ComfyUI/custom_nodes/
    git clone https://github.com/shigjfg/ComfyUI-Magic-Assistant.git
    ```

2.  **Install dependencies / 安装依赖**:
    ```bash
    cd ComfyUI-Magic-Assistant
    pip install -r requirements.txt
    ```

3.  **Restart ComfyUI / 重启 ComfyUI**.

**使用 SDNQ 节点 / Using SDNQ Nodes**

若使用 Magic SDNQ Loader 与 Magic SDNQ K Sampler，请按照 [SDNQ 技术源仓库](https://github.com/Disty0/sdnq) 的教程配置环境，并安装 `requirements-sdnq.txt` 中的依赖。

To use Magic SDNQ Loader and Magic SDNQ K Sampler, follow the [SDNQ technical source](https://github.com/Disty0/sdnq) tutorial for environment setup and install dependencies from `requirements-sdnq.txt`.

---

## ⚠️ Notes / 注意事项

* **Photopea Network**: Since Photopea is a web-based service, please ensure you have internet access.
* **User Files Only**: The "Gallery" manages files in your `ComfyUI/input/` directory. It does not contain built-in stock images.
* **File Deletion**: The **Photopea Studio** allows you to delete files from your disk. Please use the "Delete All" feature with caution!
* **Photopea 网络**: 由于 Photopea 是在线服务，请确保电脑已连接互联网。
* **仅限用户文件**: “图库”仅显示您 `ComfyUI/input/` 目录下的文件，不包含任何内置素材。
* **文件删除**: **Photopea Studio** 具有物理删除硬盘文件的权限，使用“全部删除”功能时请务必谨慎！

---

## 📬 Contact & Support / 联系与支持

If you find this tool useful, please give it a Star 🌟!
如果有帮助，请给个 Star 支持一下！
