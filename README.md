# ✨ Magic Assistant for ComfyUI

**A powerful 5-in-1 suite designed to simplify your workflow.**
**一个专注于“多功能集成”的强大 ComfyUI 助手插件。**

Our goal is to replace complex node chains with single, intelligent nodes.
我们的目标是用单个智能节点替代繁琐的“面条式”连线。

---

## 🧩 Node Features (节点功能详解)

### 1. 🤖 Magic Multi-Function AI Prompt Replace (AI 提示词替换)
> **Your intelligent prompt engineer.** / **您的专属提示词工程师。**

* **LLM Powered**: seamlessly integrates with OpenAI-compatible APIs to rewrite or optimize your prompts.
* **Role-Play & Rules**: Built-in system prompts allow the AI to act as a "Prompt Expert", "Translator", or any custom role you define.
* **One-Click Presets**: Comes with handy rules (e.g., "Fix Grammar", "Convert to Tags") stored locally. No need to type system instructions every time.
* **AI 驱动**: 无缝对接 OpenAI 格式接口，智能润色或重写提示词。
* **角色扮演与规则**: 内置多种系统预设，让 AI 化身“提示词专家”或“翻译官”。
* **本地预设**: 支持保存和一键调用常用规则，无需每次重复输入指令。

### 2. 🧠 Magic Programmable Logic & Calc (可编程逻辑计算)
> **The ultimate solution for logic & math.** / **逻辑与数学运算的终极方案。**

* **Exclusive "Magic Script"**: Write pseudo-code directly in the node! (e.g., `IF w > 1024 RETURN 1024, h`).
* **Auto Variables**: Automatically detects input image/latent width (`w`) and height (`h`).
* **Complex Made Simple**: Handles math (`+ - * /`), comparisons (`> < =`), and logic (`AND/OR`) in **ONE** node.
* **Replace Wiring Hell**: No more chaining 10 nodes just to compare two numbers or switch resolutions.
* **独家“魔法脚本”**: 直接在节点内编写伪代码！支持 `IF...RETURN` 逻辑。
* **智能变量**: 自动识别输入图片或 Latent 的宽 (`w`) 高 (`h`)。
* **化繁为简**: 一个节点搞定所有数学运算、大小比较和布尔逻辑。
* **告别连线地狱**: 再也不用为了比较两个数字连一堆复杂的比较器和切换器了。

### 3. 📏 Magic Multi-Function Image Resize (多功能图像缩放)
> **Smart resize for SDXL & SD1.5.** / **专为 SDXL 和 SD1.5 设计的智能缩放。**

* **Smart "Long Edge" Mode**: Just set the target size (e.g., 1024), and it automatically calculates the other side to maintain the aspect ratio. Perfect for batch processing mixed images.
* **Multiple Methods**: Supports all standard resizing methods (nearest, bilinear, bicubic, lanczos, etc.).
* **Presets**: Built-in resolutions for SD1.5, SDXL, 2K, and 4K.
* **长边机制**: 只需设定长边数值（如 1024），自动计算短边以保持比例。完美处理混合尺寸的批量图。
* **多种算法**: 支持所有主流缩放插值算法。
* **常用预设**: 内置 SD1.5、SDXL 以及 2K/4K 等常用分辨率。

### 4. 🎛️ Magic Multi-Group Switch (万能禁用/忽略多框)
> **Workflow controller & debugger.** / **工作流的指挥官与调试器。**

* **Group Management**: Quickly enable/disable/bypass multiple groups of nodes.
* **One-Click Toggle**: Switch entire workflows on or off with a single boolean input.
* **Optimization**: Great for debugging large workflows or switching between different generation paths.
* **群组管理**: 快速启用、禁用或绕过指定节点组。
* **一键开关**: 通过简单的布尔值输入，控制整条工作流的通断。
* **调试利器**: 非常适合管理庞大的工作流，或在不同的生成路径间快速切换。

### 5. 📝 Magic Prompt Box (魔法提示词框)
> **Simple but effective text concatenation.** / **简单高效的文本组合。**

* **Dynamic Input**: Features a `prepend_text` interface to automatically merge incoming text to the front.
* **Auto Formatting**: Automatically handles comma separation (`, `) for concatenated text.
* **Integrated Output**: Outputs both String and CLIP Conditioning directly.
* **动态拼接**: 带有前置接口，自动将外部输入的文本合并到最前方。
* **自动格式化**: 自动处理逗号分隔，无需手动添加连接符。
* **直接输出**: 同时支持输出纯文本字符串和 CLIP 编码后的条件。

---

## 📦 Installation (安装)

1.  Clone this repo into `custom_nodes` folder:
    (将仓库克隆到 custom_nodes 目录下)
    ```bash
    cd ComfyUI/custom_nodes/
    git clone [https://github.com/shigjfg/ComfyUI-Magic-Assistant.git](https://github.com/shigjfg/ComfyUI-Magic-Assistant.git)
    ```

2.  Install dependencies:
    (安装依赖库)
    ```bash
    pip install -r requirements.txt
    ```

3.  Restart ComfyUI.
    (重启 ComfyUI)

## ⚠️ Note (注意)

* **API Key**: If you use the **AI Prompt Replace** feature, please configure your API Key in `savedata/llm_settings.txt` after the first run.
* **Presets**: Default logic rules and replacement presets are stored in the `savedata` folder.
* **API Key**: 如果使用 **AI 提示词替换** 功能，请在首次运行后，去 `savedata/llm_settings.txt` 文件中填入您的 Key。
* **预设文件**: 默认的逻辑规则和替换预设都保存在 `savedata` 文件夹中，您可以自由编辑。