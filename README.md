# ✨ Magic Assistant for ComfyUI

**A powerful 6-in-1 suite designed to simplify your workflow.**
**一个专注于“多功能集成”的强大 ComfyUI 助手插件。**

Our goal is to replace complex node chains with single, intelligent nodes.
我们的目标是用单个智能节点替代繁琐的“面条式”连线。

---

## 🧩 Node Features (节点功能详解)

### 1. 🎨 Magic Photopea Studio (Photopea 图像处理与图库) <span style="color:red; font-size:0.8em">NEW (v4.0)</span>
> **The ultimate asset manager & image editor inside ComfyUI.** / **ComfyUI 内置的终极素材管理与修图工具。**

* **ComfyUI Explorer**: A built-in gallery to manage all your input images with **Search**, **Sort**, and **Batch Delete**.
* **Seamless Editing**: One-click to send images to Photopea for editing (Photoshop-like experience) and save them back to the node instantly.
* **Smart Detection**: Automatically handles files in both the `input` root folder and the dedicated `magic_photopea` folder.
* **Dual Mode**: Switch between **View Mode** (for selecting images) and **Edit Mode** (for renaming and deleting assets).
* **图库管理**: 内置强大的素材管理器，支持对输入图片进行**搜索**、**排序**、**缩放预览**以及**批量删除**。
* **无缝修图**: 一键打开 Photopea (类PS体验) 进行编辑，保存后自动同步回节点，无需下载上传。
* **智能侦探**: 自动识别并管理 ComfyUI 根目录和插件专用目录下的所有图片素材。
* **双模式交互**: 支持“浏览模式”（快速选图）和“管理模式”（重命名、多选删除）无缝切换。

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

* **Photopea Network**: Since Photopea is a web-based service, please ensure you have internet access. If you have ad-blockers, you might see a warning message in the editor window (can be closed).
* **API Key**: For **AI Prompt Replace**, configure your API Key in `userdata/llm_settings.txt` after the first run.
* **File Deletion**: The **Photopea Studio** allows you to delete files from your disk. Please use the "Delete All" feature with caution!
* **Photopea 网络**: 由于 Photopea 是在线服务，请确保电脑已连接互联网。
* **API Key**: 使用 **AI 提示词替换** 功能前，请先运行一次，然后在生成的 `userdata/llm_settings.txt` 中填入 Key。
* **文件删除**: **Photopea Studio** 具有物理删除硬盘文件的权限，使用“全部删除”功能时请务必谨慎！

---

## 📬 Contact & Support

If you find this tool useful, please give it a Star 🌟!
如果有帮助，请给个 Star 支持一下！