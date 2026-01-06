# ✨ Magic Assistant for ComfyUI

**A powerful 7-in-1 suite designed to simplify your workflow.**
**一个专注于"多功能集成"的强大 ComfyUI 助手插件。**

Our goal is to replace complex node chains with single, intelligent nodes.
我们的目标是用单个智能节点替代繁琐的“面条式”连线。

---

## 🧩 Node Features (节点功能详解)

### 1. 🎨 Magic Photopea Studio (Photopea 图像处理与加载图像) <span style="color:red; font-size:0.8em"></span>
> **The image manager & image editor inside ComfyUI.** / **ComfyUI 图片管理与修图工具。**

* **Input File Manager**: A visual gallery to manage **your uploaded images** and **saved history** in the `input` folder. No more digging through dropdown lists!
* **Seamless Editing**: One-click to send any user image to Photopea for editing (Photoshop-like experience) and save it back instantly.
* **Dual Path Support**: Automatically detects and manages files in both the root `input/` folder (uploads) and the `magic_photopea/` folder (edits).
* **Batch Management**: Features **Multi-Select**, **Batch Delete**, and **Rename** to keep your input directory clean and organized.
* **输入文件管理**: 一个可视化的文件管理器，专门用于管理**您自己上传的图片**以及**修图保存的历史记录**。彻底告别在下拉菜单里“盲找”文件的痛苦。
* **无缝修图**: 一键将您导入的图片发送到 Photopea (类PS体验) 进行编辑，保存后自动同步，无需下载上传。
* **双路径支持**: 智能识别并管理 `input/` 根目录（用户上传）和 `magic_photopea/` 目录（编辑存档）下的所有文件。
* **批量管理**: 提供**多选删除**、**批量清理**和**重命名**功能，帮您把杂乱的 input 文件夹整理得井井有条。
* **Fixed**: Compatibility with official Mask Editor (right-click -> Save to node now works perfectly).
* **Improved**: Gallery now hides temporary `clipspace` files for a cleaner view.
* **New**: Added "🧹 Clear Cache" button to remove temporary mask files.
* **修复**: 完美兼容官方遮罩编辑器（右键绘画保存即生效）。
* **优化**: 图库列表自动过滤 clipspace 临时文件，更加清爽。
* **新增**: “🧹 清空缓存”按钮，一键清理遮罩临时文件。

### 2. 🤖 Magic Multi-Function AI Prompt Replace (AI 提示词替换)
> **Your intelligent prompt engineer.** / **您的专属提示词工程师。**

* **LLM Powered**: Seamlessly integrates with OpenAI-compatible APIs to rewrite or optimize your prompts.
* **Role-Play & Rules**: Built-in system prompts allow the AI to act as a "Prompt Expert", "Translator", or any custom role you define.
* **One-Click Presets**: Comes with handy rules (e.g., "Fix Grammar", "Convert to Tags") stored locally.
* **AI 驱动**: 无缝对接 OpenAI 格式接口，智能润色或重写提示词。
* **角色扮演**: 内置多种预设，让 AI 化身“提示词专家”或“翻译官”。
* **本地预设**: 支持保存和一键调用常用规则。

### 3. 🧠 Magic Programmable Logic & Calc (可编程逻辑计算)
> **The ultimate solution for logic & math.** / **逻辑与数学运算的终极方案。**

* **Exclusive "Magic Script"**: Write pseudo-code directly in the node! (e.g., `IF w > 1024 RETURN 1024, h`).
* **Auto Variables**: Automatically detects input image/latent width (`w`) and height (`h`).
* **Complex Made Simple**: Handles math (`+ - * /`), comparisons (`> < =`), and logic (`AND/OR`) in **ONE** node.
* **独家“魔法脚本”**: 直接在节点内编写伪代码！支持 `IF...RETURN` 逻辑。
* **智能变量**: 自动识别输入图片或 Latent 的宽 (`w`) 高 (`h`)。
* **化繁为简**: 一个节点搞定所有数学运算、大小比较和布尔逻辑。

### 4. 📏 Magic Multi-Function Image Resize (多功能图像缩放)
> **Smart resize for SDXL & SD1.5.** / **专为 SDXL 和 SD1.5 设计的智能缩放。**

* **Smart "Long Edge" Mode**: Set the target size (e.g., 1024), and it automatically calculates the other side to maintain the aspect ratio.
* **Multiple Methods**: Supports all standard resizing methods (nearest, bilinear, bicubic, lanczos, etc.).
* **Presets**: Built-in resolutions for SD1.5, SDXL, 2K, and 4K.
* **长边机制**: 设定长边数值（如 1024），自动计算短边以保持比例。
* **多种算法**: 支持所有主流缩放插值算法。
* **常用预设**: 内置 SD1.5、SDXL 以及 2K/4K 等常用分辨率。

### 5. 🎛️ Magic Multi-Group Switch (万能禁用/忽略多框)
> **Workflow controller & debugger.** / **工作流的指挥官与调试器。**

* **Group Management**: Quickly enable/disable/bypass multiple groups of nodes.
* **One-Click Toggle**: Switch entire workflows on or off with a single boolean input.
* **群组管理**: 快速启用、禁用或绕过指定节点组。
* **一键开关**: 通过简单的布尔值输入，控制整条工作流的通断。

### 6. 📝 Magic Prompt Box (魔法提示词框)
> **Simple but effective text concatenation.** / **简单高效的文本组合。**

* **Dynamic Input**: Features a `prepend_text` interface to automatically merge incoming text.
* **Auto Formatting**: Automatically handles comma separation (`, `).
* **Integrated Output**: Outputs both String and CLIP Conditioning directly.
* **动态拼接**: 带有前置接口，自动将外部输入的文本合并到最前方。
* **自动格式化**: 自动处理逗号分隔，无需手动添加连接符。
* **直接输出**: 同时支持输出纯文本字符串和 CLIP 编码后的条件。

### 7. 🚀 Magic Power SDXL LoRA Loader (强力SDXL LoRA加载器)
> **Visual LoRA manager with drag-and-drop sorting.** / **可视化 LoRA 管理器，支持拖拽排序。**

* **Visual Management**: Beautiful gallery interface to browse and manage all your LoRAs. No more scrolling through long dropdown lists!
* **Folder Organization**: Organize LoRAs into custom folders for better categorization and management.
* **Drag & Drop Sorting**: Intuitive drag-and-drop interface to reorder LoRAs and folders. Supports both upward and downward insertion based on mouse position.
* **Preview Images**: Automatic preview image detection and display for each LoRA.
* **Tag System**: Add custom tags to LoRAs for easy searching and filtering.
* **Batch Operations**: Enable/disable multiple LoRAs at once, adjust weights, and manage your entire LoRA collection efficiently.
* **Smart Preview Detection**: Automatically finds preview images in `magicloradate` subdirectory or same directory as LoRA files.
* **可视化管理**: 精美的图库界面，浏览和管理所有 LoRA，告别下拉菜单的繁琐操作。
* **文件夹分类**: 将 LoRA 整理到自定义文件夹中，实现更好的分类管理。
* **拖拽排序**: 直观的拖拽排序界面，支持根据鼠标位置向上或向下插入，轻松调整 LoRA 和文件夹的顺序。
* **预览图显示**: 自动检测并显示每个 LoRA 的预览图片。
* **标签系统**: 为 LoRA 添加自定义标签，方便搜索和筛选。
* **批量操作**: 一键启用/禁用多个 LoRA，调整权重，高效管理整个 LoRA 集合。
* **智能预览检测**: 自动在 `magicloradate` 子目录或 LoRA 文件同目录查找预览图。

---

## 📝 版本更新介绍

> 最新更新：2026-01-06

> **V1.1.0 版本介绍** 2026-01-06
>
> 1. **新增节点**: Magic Power SDXL LoRA Loader - 强力SDXL LoRA加载器
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

<details>
<summary>点击查看往期更多更新内容</summary>

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

## 📦 Installation (安装)

1.  **Clone the repository** (克隆仓库):
    ```bash
    cd ComfyUI/custom_nodes/
    git clone [https://github.com/shigjfg/ComfyUI-Magic-Assistant.git](https://github.com/shigjfg/ComfyUI-Magic-Assistant.git)
    ```

2.  **Install dependencies** (安装依赖):
    ```bash
    cd ComfyUI-Magic-Assistant
    pip install -r requirements.txt
    ```

3.  **Restart ComfyUI** (重启 ComfyUI).

---

## ⚠️ Notes (注意事项)

* **Photopea Network**: Since Photopea is a web-based service, please ensure you have internet access.
* **User Files Only**: The "Gallery" manages files in your `ComfyUI/input/` directory. It does not contain built-in stock images.
* **File Deletion**: The **Photopea Studio** allows you to delete files from your disk. Please use the "Delete All" feature with caution!
* **Photopea 网络**: 由于 Photopea 是在线服务，请确保电脑已连接互联网。
* **仅限用户文件**: “图库”仅显示您 `ComfyUI/input/` 目录下的文件，不包含任何内置素材。
* **文件删除**: **Photopea Studio** 具有物理删除硬盘文件的权限，使用“全部删除”功能时请务必谨慎！

---

## 📬 Contact & Support

If you find this tool useful, please give it a Star 🌟!
如果有帮助，请给个 Star 支持一下！