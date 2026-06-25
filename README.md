# ✨ Magic Assistant for ComfyUI

**A powerful 10-in-1 suite designed to simplify your workflow.**
**一个专注于"多功能集成"的强大 ComfyUI 助手插件。**

> 💬 **Join our Discord community for support, feature requests, and latest updates!**
> 💬 **加入我们的 Discord 社区，获取技术支持、功能请求！**

[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/H9YFdJAs4R)

---

## 📝 Version Update Introduction / 版本更新介绍

> Latest Update / 最新更新：**2026-06-25**

> **V1.3.8 版本介绍 / Version Introduction** 2026-06-25
>
> 1. **🐛 修复（重要）**: 修复 Klein 节点模型检测的路径方法，防止无法检测到 transform 和 klein 的问题
>    * Fixed the model detection path method in Klein node to prevent inability to detect transform and klein
>
> 2. **🐛 修复**: 修复 magic_preset_tags 找不到而导致预设标签无法使用的问题
>    * Fixed the issue where magic_preset_tags could not be found, causing preset tags to be unusable
>
> 3. **✨ 新增**: Magic Nunchaku FLUX.2 Klein Loader - diffusers 版本检测
>    * 新增 diffusers 版本检测，在环境状态中显示当前 diffusers 版本号，方便排查环境问题
>    * Added diffusers version detection in environment status
>
> 4. **✨ 优化**: 合并 PR #8，支持从子文件夹加载 Nunchaku Klein 模型，重构了模型文件获取逻辑
>    * Merged PR #8: Added support for loading Nunchaku Klein models from subfolders, refactored model file retrieval logic
>    * Thanks to Tom-M-Git for the contribution!

> **V1.3.7 版本介绍 / Version Introduction** 2026-06-02
>
> 1. **🐛 修复（重要）**: 修复强力 LoRA 加载器模式切换的各种问题，大幅提升稳定性
>    * 修复打开旧工作流时，INT8 模式、SDNQ 模式、Klein 模式等设置丢失或错乱的问题
>    * 修复模式切换后实际未生效的问题，现已确保所有模式切换正确应用
>    * 新增旧版本工作流设置自动修复功能，兼容并修复历史遗留的配置错误
>    * Fixed settings lost or corrupted when opening old workflows (INT8/SDNQ/Klein modes)
>    * Fixed mode switching not taking effect; all mode changes now apply correctly
>    * Added auto-fix for legacy workflow settings to ensure backward compatibility
>
> **V1.3.6 版本介绍 / Version Introduction** 2026-06-01
>
> 1. **🐛 修复（重要）**: 修复 Klein 模式下，强力 LoRA 加载器只能应用单个 LoRA，而无法应用所有 LoRA 的问题，请一定要更新本版本！
>    * **Bugfix (Important)**: Fixed an issue in Klein mode where Magic Power LoRA Loader could only apply a single LoRA instead of applying all LoRAs. Please make sure to update to this version!
>
> 2. **🐛 修复**: 修复部分当使用悬浮球进行中英文转换时，UI 的文本没有正确翻译的问题
>    * **Bugfix**: Fixed an issue where some UI texts were not translated correctly when switching Chinese/English via the floating button

<details>
<summary>Click to view more previous updates / 点击查看往期更多更新内容</summary>

> **V1.3.5 版本介绍 / Version Introduction** 2026-06-01
>
> 1. **✨ 新增功能**: Magic Nunchaku FLUX.2 Klein Loader - LoRA 支持 ⭐
>    * Klein 模型现已支持使用 LoRA！需要配合强力 LoRA 加载器使用
>    * 在强力 LoRA 加载器设置中开启 Klein 模式即可正确使用 LoRA
>    * 使用前请重新进行环境嵌入（点击节点上的 ⚙️ 设置 → 嵌入到环境 → 下载并安装）
>    * Klein LoRA 支持通过 Nunchaku 原生 API 直接修改量化权重，效果更好
>    * Klein LoRA now supports using LoRA! Works with Magic Power LoRA Loader
>    * Enable Klein mode in Magic Power LoRA Loader settings to use LoRA correctly
>    * Please re-embed the environment before using (Settings → Embed to Environment → Download & Install)
>    * Klein LoRA support via Nunchaku native API for direct quantized weight modification
>    <img width="818" height="976" alt="Image" src="https://github.com/user-attachments/assets/70d3f098-b72a-4c1f-96d5-85bfbc924f95" />
>    <img width="1895" height="926" alt="Image" src="https://github.com/user-attachments/assets/2dc0c1c6-ce1d-4130-bec4-185b77167545" />

> 2. **🔧 更新**: Magic Nunchaku FLUX.2 Klein Loader - 环境嵌入功能重构 ⭐
>    * 新版环境嵌入直接从 HuggingFace 下载源文件，确保文件完整且始终为最新版本
>    * 自动将下载的文件放入 Nunchaku 的 python 文件中
>    * 相比旧版本拥有更好的兼容性，文件自动更新无需手动管理
>    * 如果出现嵌入失败的问题，请通过 Issues 反馈
>    * New environment embedding downloads source files directly from HuggingFace
>    * Automatically places downloaded files into Nunchaku's python files
>    * Better compatibility than the old version; files auto-update without manual management
>    * If embedding fails, please report via Issues
>    <img width="753" height="1018" alt="Image" src="https://github.com/user-attachments/assets/6da72b72-db8e-4514-87a1-c8d1827166d1" />

> 3. **🐛 修复**: Magic Power LoRA Loader - 弹窗拖拽问题修复
>    * 修复了强力 LoRA 加载器设置弹窗和预设弹窗的拖拽问题
>    * 现在可以正常拖拽弹窗，提升使用体验
>    * Fixed drag issues in settings dialog and preset dialog
>    * Dialogs can now be dragged normally for better user experience

> **V1.3.4 版本介绍 / Version Introduction** 2026-05-20

> 1. **🔧 更新**: Magic 提示词编辑器 - 编辑标签页重构为 3 个独立界面
>    * 将原有的编辑标签功能拆分为「收藏标签」「自建标签」「预设标签」三个独立 Tab 界面
>    * 新增默认标签分类支持，方便用户按分类快速查找和管理预设标签
>    * 界面更加清晰整洁，标签管理效率大幅提升
>    * Refactored the tag editing feature into 3 independent tab interfaces: "Favorite Tags", "Custom Tags", and "Preset Tags"
>    * Added default tag category support for easier browsing and management of preset tags
>    * Cleaner interface design with significantly improved tag management efficiency
>    <img width="574" height="479" alt="Image" src="https://github.com/user-attachments/assets/0af41144-763b-444a-adfb-25015a797676" />
>    <img width="564" height="466" alt="Image" src="https://github.com/user-attachments/assets/b347ac00-9f35-4ed5-9034-59eaa2e4430a" />
>    <img width="575" height="478" alt="Image" src="https://github.com/user-attachments/assets/31e39612-1e52-4a96-a6f0-c7253312701e" />

> 2. **🐛 修复**: SDNQ 节点懒加载机制优化
>    * 修复了不使用 SDNQ 时环境仍强制检测 SDNQ 的问题
>    * SDNQ 相关节点现在采用真正的懒加载模式，仅在需要时才导入依赖
>    * 未安装 SDNQ 时插件可正常加载，其他所有功能不受影响
>    * Optimized SDNQ node lazy loading mechanism
>    * Fixed the issue where the environment would force-check SDNQ even when not using it
>    * SDNQ nodes now use true lazy loading - dependencies are only imported when needed
>    * When SDNQ is not installed, the plugin loads normally and all other features work without issues

> 3. **⚡ 优化**: Magic Power LoRA Loader - 性能与稳定性优化
>    * 优化了 LoRA 缓存机制，减少重复加载提升性能
>    * 改进了 SDNQ 模式下的 LoRA 应用逻辑，错误处理更完善
>    * 优化了预览图加载流程，内存占用更少
>    * Performance and stability optimizations for Magic Power LoRA Loader
>    * Optimized LoRA caching mechanism to reduce duplicate loading and improve performance
>    * Improved SDNQ mode LoRA application logic with better error handling
>    * Optimized preview image loading process with reduced memory footprint

> **V1.3.3 版本介绍 / Version Introduction** 2026-04-10

> 1. **🐛 修复**: Magic Nunchaku FLUX.2 Klein Loader - 修复 klein 节点嵌入环境的问题
>    * 修复了 nunchaku-flux2-klein 节点中环境嵌入的已知问题
>    * 增强了环境检测和嵌入的稳定性，提升使用体验
>    * Fixed environment embedding issues in the nunchaku-flux2-klein node
>    * Enhanced environment detection and embedding stability for better user experience

> **V1.3.2 版本介绍 / Version Introduction** 2026-04-07

> 1. **🔍 新增**: Magic Power LoRA Loader - LoRA 检测功能
>    * LoRA 添加窗口新增 LoRA 检测功能，可以根据路径选择全部 LoRA 进行 LoRA 的查重和检测更新
>    * Added LoRA detection functionality in the LoRA adding window; can detect duplicates and check for updates based on paths or select all LoRAs
>
>    <img width="535" height="473" alt="Image" src="https://github.com/user-attachments/assets/c2d5a67a-3654-423e-8cac-7ca95370950a" />

> 2. **🐛 修复**: 修复提示词编辑弹窗 tag 预览区的已知 bug
>    * Fixed known bugs in the tag preview area of the prompt editor popup

> 3. **🔧 更新**: Magic Nunchaku FLUX.2 Klein Loader - 新增 klein9bkv 量化支持
>    * Nunchaku 插件更新支持 klein9bkv 量化，下载地址依然是同个作者的量化
>    * 使用时不需要重新插入环境文件，亲测环境文件是一样的，如果是初次使用则需要插入
>    * Updated nunchaku plugin to support klein9bkv quantization
>    * The download link remains the same author's quantization
>    * No need to re-embed the environment file (same as previous); first-time users still need to embed

> **V1.3.1 版本介绍 / Version Introduction** 2026-04-04

> 1. **🔍 新增**: Tag 编辑弹窗 - 收藏/自建提示词的搜索
>    * 在标签编辑弹窗中新增了收藏标签组和自建标签组的搜索功能，方便快速查找
>    * Added search functionality for favorite tag groups and custom tag groups in the tag editing popup
>
>    <img width="473" height="383" alt="Image" src="https://github.com/user-attachments/assets/09c154d1-e5c4-4e83-a13a-3e415a4110a8" />

> 2. **🐛 修复**: 修复部分节点的已知 bug
>    * Fixed known bugs in some nodes
>
> 3. **🔧 优化**: Magic Nunchaku FLUX.2 Klein Loader - 环境嵌入优化
>    * 修复了 nunchaku-flux2-klein 节点中环境嵌入的问题
>    * 增强了环境检测的机制，提升使用体验
>    * Fixed environment embedding issues in the nunchaku-flux2-klein node
>    * Enhanced environment detection mechanism for better user experience

> **V1.3.0 版本介绍 / Version Introduction** 2026-04-02

> 1. **🐛 修复**: Tag 预览悬浮功能条 Bug 修复
>    * 修复了编辑提示器节点中 tag 预览悬浮功能条的已知问题，提升使用体验
>    * Fixed known bugs in the tag preview floating toolbar in the prompt editor

> 2. **✨ 新增节点**: Magic Nunchaku FLUX.2 Klein Loader ⭐
>    * 新增 nunchaku-flux2-klein9b 模型加载节点，完全兼容 ComfyUI 工作流
>    * 使用极其简单，只需将原有的 unet 加载器替换为本节点即可！
>    * 注意：**本节点暂时不适配 LoRA，请等待后续支持**
>    * 速度提升是至今所有 klein9b 量化模型的 3-4 倍
>    * 强烈推荐 30 系显卡和 40 系显卡用户使用
>    * 本节点技术基于 [tonera/FLUX.2-klein-9B-Nunchaku](https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku) 实现
>    * New Magic Nunchaku FLUX.2 Klein Loader node for nunchaku-flux2-klein9b models
>    * Simple to use: just replace your unet loader with this node
>    * **Note: LoRA is not yet supported for this node. Please wait for future support.**
>    * Speed improvement: 3-4x faster than any previous klein9b quantized model
>    * Strongly recommended for RTX 30 series and RTX 40 series users
>    * Based on [tonera/FLUX.2-klein-9B-Nunchaku](https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku)

>    <img width="563" height="416" alt="Image" src="https://github.com/user-attachments/assets/95a003b5-4e10-45b5-842d-498d9a045ea4" />

> **V1.2.9 版本介绍 / Version Introduction** 2026-03-30

> 1. **🔧 优化**: 屏蔽符号改为 `*`，防止用 `!` 进行组合的 tag 失效
>    * 将屏蔽符号从 `!` 更改为 `*`，避免与用户使用 `!` 进行 tag 组合时产生冲突
>    * Changed mask symbol from `!` to `*` to prevent conflicts with user combinations using `!`
>
> 2. **🐛 修复**: Tag 预览器 bug 修复
>    * 修复了 tag 预览器的绝大部分已知 bug，提升使用体验
>    * Fixed most known bugs in the tag preview for better user experience

> **V1.2.8 版本介绍 / Version Introduction** 2026-03-26

> 1. **🔍 新增 danbooru 数据模式**: 在设置下改为 danbooru 数据后，补全功能和标签搜索功能将会去使用 danbooru 的标签
>    * 在补全模式下将会调用 danbooru 预设库的数据，如果预设数据搜索不到可以到标签编辑下搜索
>    * 可以实时连接 danbooru 数据进行爬取，自带中英文对照
>    * 在 danbooru 模式下会显示这个 tag 的分类（可自定义设置分类显示结果）、热度，并按照一定逻辑排列 tag 组
>    * 💡 提示：当切换成 danbooru 模式后每次打开编辑界面都会实时检测是否连接成功，当连接成功后才会替换补全功能和标签搜索，否则沿用本地模式
>    * Added danbooru data mode: when enabled in settings, autocomplete and tag search use danbooru tags
>    * Autocomplete uses danbooru preset library; search Edit Tags for data not in presets
>    * Real-time danbooru web data with built-in Chinese/English translations
>    * Danbooru mode displays tag category (customizable), popularity, and organizes tags logically
>    * 💡 Note: When switching to danbooru mode, each open checks for live connection; only replaces functions if connected, otherwise falls back to local mode
>
>     <img width="2177" height="1014" alt="Image" src="https://github.com/user-attachments/assets/bfd0c233-9b01-40ec-a1e3-81e47d0f9e2a" />

> 2. **🎛️ 显示设置优化**: 在显示设置中可以关闭或者开启补全功能了
>    * Added ability to enable/disable autocomplete in display settings

> 3. **📝 本地预设翻译补全**: 补全了本地预设的大部分中文翻译，以及修改了部分翻译
>    * Completed most Chinese translations for local presets and fixed some existing translations

> 4. **⚡ 搜索优化**: 优化了搜索匹配的一些小问题
>    * Optimized search matching logic

> ⚠️ **注意**: 更新后请删除节点目录 `/userdata` 下的 `settings.txt` 文件，因为新版的提示词编辑弹窗设置进行了修改，原版的 settings 文件不可用。不用担心，这个 settings 文件只保存的是关于你是否开启功能和选择的 AI 之类的简单数据。初次使用节点的用户不受影响。
> ⚠️ **Note**: After updating, please delete the `settings.txt` file in `/userdata` under the node directory, because the new version modified the prompt editor popup settings. Don't worry — this file only saves simple data like whether you enabled certain features or which AI you selected. New users are not affected.

> **V1.2.6 版本介绍 / Version Introduction** 2026-03-25

> 1. **🎨 交互优化**: Tag 编辑弹窗 - Tag 预览区重构 ⭐
>    * 优化了提示词编辑框节点中编辑弹窗下 tag 区的使用体验
>    * 增加了框选时的实时高亮效果
>    * 优化了权重/括号工具栏的定位逻辑，放大了 tag 预览区的显示效果
>    * 调整了 tag 芯片之间的间距，视觉效果更舒适
>    * 修复了增减括号功能不可用的问题
>    * 优化交互模式：改为**点击锁定 tag 进行修改**（不再依赖悬停出工具条）
>    * 锁定后**点击上方英文文本区域**可直接进入行内编辑
>    * **双击切换屏蔽/恢复 tag**改为**仅在下方翻译区域**触发，避免与上方编辑冲突
>    * 修复conditioning的问题
>    * Optimized the Tag Preview area in the editing popup: added real-time highlight for rubber-band select, improved float bar positioning, enlarged chip display, adjusted chip spacing, and fixed bracket add/remove buttons
>    * New interaction: click to lock a tag (toolbar stays fixed on that chip only; no hover conflicts)
>    * When locked, click the top English text area to inline edit; double-click the bottom Chinese area to toggle disable, avoiding conflict with text editing above
>    * Fix the conditioning issue.
>   
>    <img width="1375" height="1037" alt="Image" src="https://github.com/user-attachments/assets/3af2f79d-56bd-4b31-863c-94480e5ac9f2" />

> **V1.2.5 版本介绍 / Version Introduction** 2026-03-24

> 1. **📝 大更新**: 多功能提示框（MagicPromptBox）- Tag 编辑弹窗 ⭐
>    * 新增编辑按钮，点击编辑按钮可以打开一个 tag 编辑弹窗，在编辑弹窗中可以自由地编辑 tag，功能丰富，支持中英文双语切换
>    * New edit button opens a tag editing dialog with rich features and full Chinese/English bilingual support
>
>    **功能亮点 / Features**:
>    * 内置 22 万+ 大量 tag，可搜索应有尽有，支持收藏喜欢的 tag 或新建 tag
>    * Built-in 220,000+ tags with search; supports favoriting and creating custom tags
>    * 编辑 tag 时可选择自动补全，补全数据来自本地数据库 + 新建 tag 数据集
>    * Tag autocomplete when editing, using local database + custom tag dataset
>    * 下方 tag 框同步编辑，支持修改权重、加括号、删除、排列、禁用、翻译成中文等操作
>    * Tag box for synchronized editing: modify weight, add parentheses, delete, sort, disable, translate to Chinese, etc.
>    * 丰富功能满足绝大多数使用需求：提示词规格化、移除重复提示词、清空提示词、一键复制、一键文本翻译
>    * Rich functions: prompt normalization, remove duplicates, clear prompts, one-click copy, one-click text translation
>    * 历史界面可查看之前运行的 tag 组，支持删除、编辑、收藏或一键重新使用
>    * History view shows previous tag groups; supports delete, edit, favorite, or reuse with one click
>    * 设置界面可配置多项功能满足不同需求
>    * Settings panel for configuring various options to suit different needs
>
>    <img width="1340" height="1066" alt="Image" src="https://github.com/user-attachments/assets/2f74db1d-845d-4223-a392-c5fa3aea2044" />
>    <img width="996" height="1004" alt="Image" src="https://github.com/user-attachments/assets/eaf4fe8e-6295-4e0b-a019-809cc81ad44f" />
>    <img width="1344" height="1057" alt="Image" src="https://github.com/user-attachments/assets/146cad7f-a3e4-4774-87fb-8038643b51b5" />
>    <img width="1321" height="1076" alt="Image" src="https://github.com/user-attachments/assets/c4f309ff-be6a-48d4-aad8-6e2e2a1c3b18" />
>    <img width="874" height="692" alt="Image" src="https://github.com/user-attachments/assets/1af06565-e1f1-46d1-a895-7b422a1b20a8" />

> 2. **🧹 优化**: MagicPhotopeaNode - 清空缓存优化
>    * 优化了 MagicPhotopeaNode 的清空缓存功能，现在清空缓存时会清空的更彻底
>    * Optimized cache clearing in MagicPhotopeaNode; now clears more thoroughly

> 3. **⚡ 新增功能**: Magic Cache - 全局缓存清理
>    * 新增全局清理功能，每次使用时都会自动清理一遍加速缓存，防止内存溢出
>    * Added global cache cleanup; automatically clears acceleration cache on each use to prevent memory overflow

> 4. **📦 SDNQ 节点优化**: 使用体验全面升级
>    * SDNQ 节点使用优化，重新上传了工作流和使用预览图，详情请到 SDNQ 节点介绍处查看
>    * SDNQ nodes usage optimized; re-uploaded workflows and preview images, see SDNQ node introduction for details

> 5. **🔧 优化**: MagicResolutionResize 和 MagicResolution - 分辨率预设管理
>    * 分辨率预设管理新增双击分辨率名字后直接修改分辨率功能
>    * 修复了新增组合分辨率后会清空长边预设的问题
>    * Added double-click to edit preset resolution names directly in preset management
>    * Fixed issue where adding composite resolutions would clear long-edge presets

> 6. **🎛️ 优化**: 万能禁用/忽略多框节点 - 组排序功能
>    * 新增组之间的排序功能，点击组最右边的三条杠即可拖拽组进行排序
>    * Added drag-and-drop sorting between groups; click the three-bar handle on the right side of a group to reorder

> 7. **✨ 新增功能**: MagicPromptReplace 节点 - 文本接入
>    * 新增文本接入功能，可以自行选择是接入文本框还是接入文本点
>    * Added text input option; can choose between text box input or text point input

> **V1.2.4 版本介绍 / Version Introduction** 2026-02-28

> 1. **✨ 优化**: Magic SDNQ Loader & Sampler - 模型加载和采样器优化
>    * 继续优化了 SDNQ 模型加载和采样器，新增了一些参数且对节点 UI 进行了重新排版
>    * 请重新加载节点使用，工作流图片也已更新，请到节点介绍处自取
>    * Continued optimization of SDNQ model loading and sampler, added new parameters and redesigned node UI layout
>    * Please reload nodes to use; workflow images have been updated, see node introduction section

> 2. **🔄 更新**: Magic Power LoRA Loader - 自适应模式
>    * 强力 LoRA 加载器在设置中更新了自适应模式
>    * 当开启这个模式后会自动检测模型的类型后切换为相应的模式，不再需要每次切换模型的时候手动切换模式了
>    * Magic Power LoRA Loader now includes adaptive mode in settings
>    * When enabled, automatically detects model type and switches to the appropriate mode, no need to manually switch modes when changing models

> 3. **⚡ 新增功能**: Magic Cache - 智能缓存加速节点 / Intelligent Caching Acceleration Node
>    * 新增 Magic Cache 节点，通过智能缓存技术大幅加速图片生成速度
>    * 支持三种优化模式：TeaCache、FBCache 和 Both 模式（推荐），可根据需求灵活选择
>    * TeaCache 模式：监测生成过程变化，变化小时复用上一步结果，适合早期步骤，约 2 倍加速
>    * FBCache 模式：在指定步数范围内重用前一步特征，适合中间步骤（20%-85%），效果最佳
>    * Both 模式：同时使用两种缓存技术，提供最快的推理速度
>    * 简单易用的设置界面，支持一键调整缓存参数，无需修改复杂代码
>    * 广泛支持多种主流模型：FLUX、FLUX-Kontext、FLUX-Klein、PuLID-FLUX、SDXL、SD1.5、Anima 等
>    * 本节点新增支持：flux2klein、最新 Anima 模型、SDXL 模型（FBCache 原项目不支持）
>    * 通常可实现 1.5 倍到 3 倍的生成加速，同时保持图片质量
>    * 智能缓存机制，自动跳过重复计算，在合适的时候复用缓存结果，节省时间
>    * 支持选择缓存设备（CUDA 或 CPU），可根据设备情况灵活配置
>    * 项目源代码来自 [Comfy-WaveSpeed](https://github.com/chengzeyi/Comfy-WaveSpeed) 和 [ComfyUI-TeaCache](https://github.com/welltop-cn/ComfyUI-TeaCache)
>    * New Magic Cache node that significantly accelerates image generation through intelligent caching
>    * Three optimization modes: TeaCache, FBCache, and Both (recommended)
>    * TeaCache: Monitors generation process changes, reuses previous step results when changes are small, suitable for early steps, ~2x speedup
>    * FBCache: Reuses previous step features within specified step range, best for middle steps (20%-85%)
>    * Both mode: Combines both caching techniques for fastest inference speed
>    * Easy-to-use settings interface, one-click parameter adjustment without code modification
>    * Wide model support: FLUX, FLUX-Kontext, FLUX-Klein, PuLID-FLUX, SDXL, SD1.5, Anima, etc.
>    * New support: flux2klein, latest Anima models, SDXL models (FBCache original project didn't support)
>    * Typically achieves 1.5x to 3x generation speedup while maintaining image quality
>    * Smart caching mechanism automatically skips redundant calculations and reuses cached results when appropriate
>    * Supports cache device selection (CUDA or CPU) for flexible configuration
>    * Source code from [Comfy-WaveSpeed](https://github.com/chengzeyi/Comfy-WaveSpeed) and [ComfyUI-TeaCache](https://github.com/welltop-cn/ComfyUI-TeaCache)

> **V1.2.3 版本介绍 / Version Introduction** 2026-02-12

> 1. **🛠️ 问题修复**: Magic SDNQ K Sampler - 图片生成更稳定
>    * 修复了文生图/图生图时可能出现的报错问题
>    * 现在各种模型的生成过程更加稳定可靠
>    * Fixed an error that could occur during image generation, making the process more stable

> 2. **✨ 新增功能**: Magic SDNQ K Sampler - 更好的局部重绘支持
>    * 优化了局部重绘的混合算法
>    * 3D 打包模型（如 Flux/Flux2）使用像素级混合，效果更自然
>    * 4D 模型（如 SDXL）使用潜在空间混合，速度更快
>    * 即使遇到意外情况，系统会自动选择最合适的处理方式
>    * Enhanced inpainting with optimized blending algorithms for different model types; 3D models use pixel blending for better quality, 4D models use latent blending for speed; automatic fallback ensures stability

> 3. **⚡ 性能优化**: Magic SDNQ K Sampler - 代码更简洁高效
>    * 精简了内部代码逻辑
>    * 减少了不必要的内存占用
>    * 让系统运行更加流畅
>    * Streamlined internal code for better performance and lower memory usage

> **V1.2.2 版本介绍 / Version Introduction** 2026-02-11
>
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
>
> 2. **Bug Fix / 错误修复**: Magic SDNQ K Sampler - 修复文生图图片过小的 bug
>    * 修复了文生图模式下输出图片尺寸过小的问题
>    * Fixed issue where generated images were too small in text-to-image mode
>
> 3. **Optimization / 优化**: Magic SDNQ K Sampler - VAE 加载日志顺序优化
>    * 调整了 VAE 加载日志的输出顺序，使其出现在 pipeline 加载信息之后、采样信息之前
>    * Optimized VAE loading log sequence to appear after pipeline loading info and before sampling info


> **V1.2.1 版本介绍 / Version Introduction** 2026-02-11
>
> 1. **Optimization / 优化**: 代码优化与 bug 修复
>    * 与官方 K 采样器对齐的显存管理、全模型（文生图/图生图/图编辑）输出尺寸补偿等逻辑优化与修复
>    * Code and bug fixes including VRAM handling alignment with official KSampler and output size compensation for all modes (txt2img, img2img, image edit)
>
> 2. **New Feature / 新增功能**: SDNQ K 采样器局部重绘适配
>    * 支持所有 SDNQ 模型（含 Flux2Klein）；使用 ComfyUI 的 InpaintModelConditioning + SetLatentNoiseMask 准备数据
>    * 4D latent 模型（如 SDXL/GLM）采用 latent 空间混合；3D packed 模型（如 Flux/Flux2/QwenImage/Chroma）采用像素空间 composite
>    * SDNQ node introduction includes an example inpainting workflow (download image to import into ComfyUI)
>    * Inpainting support for all SDNQ models; use InpaintModelConditioning + SetLatentNoiseMask; 4D models use latent blending, 3D packed models use pixel-space composite
>
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
>    * 必须同时连接 CLIP 与 VAE 才启用"仅加载本体"；只连其一将报错；两者都不连则整包加载
>    * 当前仅 FLUX / FLUX.2 支持该模式；其他模型（如 Qwen、Z-Image）连接外接 CLIP/VAE 时会提示不支持
>    * FLUX and FLUX.2 (including Flux2Klein) can use external CLIP + VAE and load only the transformer body from SDNQ for lower VRAM and faster generation
>    * Both CLIP and VAE must be connected to enable body-only loading; connect neither for full-package load
>    * Only FLUX/FLUX.2 support this mode; other model types will show an error if external CLIP/VAE are connected

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
> **Your all-in-one Danbooru-style prompt editor with 220k+ tag library.** / **内置 22 万+ Tag 的全能 Danbooru 风格提示词编辑器。**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

**Reference / 参考来源**: Inspired by [WeiLin-Comfyui-Tools](https://github.com/weilin9999/WeiLin-Comfyui-Tools) and [ComfyUI-Danbooru-Gallery](https://github.com/Aaalice233/ComfyUI-Danbooru-Gallery) and [comfyui-danbooru-autocomplete](https://github.com/Schabe-Antimonfeld/comfyui-danbooru-autocomplete) and [danbooru-tag-pipeline](https://github.com/SuzumiyaAkizuki/danbooru-tag-pipeline).

#### 节点概览 / Node Overview

点击节点底部的 **「📝 编辑提示词」** 按钮，打开 **Magic 提示词编辑器** 弹窗。节点支持 `prepend_text` 前置文本接口、`clip` 输入，直接输出 `final_text`、`conditioning` 和 `clip`。以 `*` 开头的段为「屏蔽」：保留在节点内但不参与编码与输出。

Click the **"📝 编辑提示词"** button at the bottom of the node to open the **Magic Prompt Editor** modal. The node supports `prepend_text` input, `clip` input, and outputs `final_text`, `conditioning`, and `clip`. Segments starting with `*` are "masked": kept in the node but excluded from encoding and output.

#### 编辑 Tab / Edit Tab

* **工具栏**: 格式化、去重、清空全部、清空屏蔽、复制、编辑标签、一键翻译所有 Tag
* **主编辑区**: 支持任意语言输入；Enter 可将短词转为 tag；**WeiLin 风格补全**：输入时显示下拉列表，左侧英文 tag、右侧中文释义，浮层跟随光标；切换 Danbooru 模式后补全列表显示 tag **分类**与**热度**，按热度排序
* **Tag 卡片区**: 将文本解析为可拖拽卡片，支持修改权重、加 `()` / `[]` / `{}` 括号、删除、排序、双击翻译区域屏蔽、翻译成中文
* **单行翻译**: 输入中文或短概念，按 Enter 调用 LLM 译为英文 tag 并插入

* **Toolbar**: Format, Deduplicate, Clear All, Clear Masked, Copy, Edit Tags, One-click Translate All Tags
* **Main Editor**: Input any language; Enter converts short words to tags; **WeiLin-style autocomplete**: dropdown with EN tag + CN description, follows cursor; Danbooru mode shows tag **category** and **popularity**, sorted by popularity
* **Tag Chips**: Parsed into draggable cards; adjust weight, add `()` / `[]` / `{}`, delete, sort, double-click translate area to mask, translate to Chinese
* **Inline Translate**: Type Chinese or concepts, press Enter to LLM-translate to English tags and insert

#### 编辑标签 / Edit Tags Modal

编辑标签功能已重构为 **3 个独立 Tab 界面**，界面更加清晰整洁：

* **收藏标签 Tab**: 管理收藏的标签组，支持搜索和一键添加到当前提示词
* **自建标签 Tab**: 管理用户自定义的标签组，支持新建、编辑、删除和搜索
* **预设标签 Tab**: 浏览内置的 22 万+ 预设标签，支持**默认标签分类**筛选（如通用、画师、版权、角色等），方便按分类快速查找

* **标签搜索**: 中英文双向搜索（不区分大小写），支持**收藏标签组搜索**和**自建标签组搜索**；自建标签组优先显示；支持一键添加 tag 到当前提示词
* **数据源**: 预设库（22 万+ 条 `中文,英文tag`）+ 用户自建标签组 + 收藏标签组
* **Danbooru 数据搜索**: 切换 Danbooru 模式后，搜索结果实时连接 Danbooru 远端，返回英文 tag / 中文释义 / 分类 / 热度；本地 danbooru预设库 提供毫秒级本地搜索兜底，自带中英文对照；支持分类过滤与分页加载

* **Tag Group Management**: Organized into **3 independent tabs** — Favorite Tags, Custom Tags, and Preset Tags
* **Preset Tags Tab**: Browse 220k+ built-in tags with **default category filtering** (General, Artist, Copyright, Character, etc.) for faster searching
* **Tag Search**: Bilingual search (case-insensitive); supports **favorite tag group search** and **custom tag group search**; custom groups prioritized; one-click add to prompt
* **Data Sources**: Preset library (220k+ entries) + user-created tag groups + favorite tag groups
* **Danbooru Data Search**: After switching to Danbooru mode, search connects to Danbooru remote in real-time, returning EN tag / CN description / category / popularity; local danbooru预设库 provides millisecond-level local search fallback with built-in Chinese/English mapping; supports category filtering and pagination

#### 历史 Tab / History Tab

* **运行历史**: 工作流**完整执行成功**后，自动将画布上所有「多功能提示词框」的文本写入 `userdata/magic_prompt_history.json`，按内容去重
* **历史收藏**: 从运行历史中点击 ☆ 加入收藏，可命名、编辑正文，方便复用
* **操作**: 删除、编辑、收藏、一键应用到当前节点

* **Run History**: After workflow **completes successfully**, all Magic Prompt Box texts are saved to `userdata/magic_prompt_history.json` with content deduplication
* **History Favorites**: Click ☆ on run history items to add to favorites; name and edit content for reuse
* **Actions**: Delete, edit, favorite, apply to current node with one click

#### 设置 Tab / Settings Tab

* **编辑界面显示**: 可勾选隐藏工具栏中的各项按钮，精简界面；可**关闭/开启补全弹窗**（关闭后编辑框输入时不弹出补全列表，词库搜索、标签编辑等独立功能不受影响）
* **Danbooru 数据模式**: 切换补全与标签搜索的数据来源为「本地标签库」或「Danbooru 远端」；切换 Danbooru 模式后每次打开编辑界面会实时检测连接状态，连接成功才替换补全功能，否则自动回退并保存为本地模式
* **格式化详细设置**: 对应 💫 格式化按钮，调用 `/ma/format_prompt`。清理逗号、修复括号始终执行；高级选项：下划线、权重语法、括号转义等可独立开启
* **翻译功能**: 与「管理 LLM」「多功能AI提示词替换」共用 `userdata/llm_settings.txt`；支持正常/强制翻译模式
* **补全与历史**: 补全列表条数上限、运行历史保留条数、LLM 翻译缓存条数

* **Editor Display**: Toggle visibility of toolbar buttons; **enable/disable autocomplete popup** (closing it hides the dropdown while typing in the editor; tag search and Edit Tags autocomplete are unaffected)
* **Danbooru Data Mode**: Switch data source for autocomplete and tag search between "Local Tag Library" and "Danbooru Remote"; switching to Danbooru mode checks connection on every open; only replaces functions if connected, otherwise falls back and saves as local mode
* **Format Options**: Clean commas, fix brackets (always); advanced: underscores, weight syntax, bracket escaping
* **Translation**: Shares `userdata/llm_settings.txt` with Manage LLM and AI Prompt Replace; normal/force translate modes
* **Completion & History**: Autocomplete limit, history max entries, LLM cache size

#### 核心功能速览 / Feature Summary

| 功能 / Feature | 说明 / Description |
|----------------|-------------------|
| **动态拼接** | `prepend_text` 接口自动合并外部文本到最前方 |
| **直接输出** | 同时输出 `final_text`、`conditioning`、`clip`，可选接 CLIP 编码 |
| **22 万+ Tag** | 内置预设库，支持中英文搜索与补全 |
| **编辑标签** | 新建/收藏标签组，搜索并一键添加 tag |
| **格式化 / 去重** | 清理逗号、修复括号、移除重复 tag |
| **LLM 翻译** | 一键翻译所有 Tag，或单行翻译输入；共享 LLM 配置 |
| **运行历史** | 工作流成功后自动保存，支持收藏与复用 |
| **屏蔽机制** | 以 `*` 开头的段不参与输出，便于临时禁用 |
| **Danbooru 模式** | 切换为 Danbooru 远端数据，补全显示分类与热度，实时连接检测 |
| **补全开关** | 可在设置中关闭/开启编辑区补全弹窗 |

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
* **LoRA Detection**: New LoRA detection feature in the LoRA adding window; can detect duplicates and check for updates based on paths or select all LoRAs.
* **INT8 Mode Support**: Supports INT8 quantized model LoRA loading compatible with [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8). Supports latest Flux Klein 9B INT8 models (e.g., [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)). Two loading modes: Static (Stochastic) and Dynamic. Static mode provides higher precision with stochastic rounding, suitable for single or few LoRAs. Dynamic mode enables runtime composition of multiple LoRAs, ideal for frequent switching scenarios.
* **SDNQ Model Support**: Added LoRA loading support for SDNQ quantized models. Switch to SDNQ mode in node settings to use with SDNQ models from [Magic SDNQ Loader](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器).
* **Klein Model Support**: Added LoRA loading support for Klein models (Nunchaku FLUX.2 Klein). Switch to Klein mode in node settings to enable LoRA support for Klein models. Enable adaptive mode for automatic model type detection.
* **LoRA Chain Feature**: Chain multiple Magic Power LoRA Loaders together using `lora串接受` (lora chain input) and `lora串输出` (lora chain output) ports. Loaders that output `lora串` don't load LoRAs themselves; they only pass their configured LoRA list to the next loader. Only the chain-end loader (the one that doesn't output `lora串`) loads all LoRAs (its own + received from upstream). Chain-end loaders must connect model and clip; intermediate loaders don't require model/clip connections. Perfect for SDNQ mode global model unload/reload workflows. Bypassed nodes correctly pass through lora chains.
* **可视化化管理**: 精美的图库界面，浏览和管理所有 LoRA，告别下拉菜单的繁琐操作。
* **文件夹分类**: 将 LoRA 整理到自定义文件夹中，实现更好的分类管理。
* **拖拽排序**: 直观的拖拽排序界面，支持根据鼠标位置向上或向下插入，轻松调整 LoRA 和文件夹的顺序。
* **预览图显示**: 自动检测并显示每个 LoRA 的预览图片。
* **标签系统**: 为 LoRA 添加自定义标签，方便搜索和筛选。
* **批量操作**: 一键启用/禁用多个 LoRA，调整权重，高效管理整个 LoRA 集合。
* **智能预览检测**: 自动在 `magicloradate` 子目录或 LoRA 文件同目录查找预览图。
* **文件夹开关**: 文件夹开关按钮，一键启用/禁用文件夹下所有 lora。
* **自动权重**: 添加 lora 时自动读取 .log 文件中的 preferred weight 并设置权重。
* **设置缓存**: 爬取设置自动保存和恢复，方便重复使用。
* **LoRA 检测功能**: LoRA 添加窗口新增 LoRA 检测功能，可以根据路径选择全部 LoRA 进行 LoRA 的查重和检测更新。
* **INT8 模式支持**: 支持 INT8 量化模型的 LoRA 加载，兼容 [ComfyUI-Flux2-INT8](https://github.com/BobJohnson24/ComfyUI-Flux2-INT8)。支持最新的 Flux Klein 9B INT8 模型（如 [FLUX.2-klein-9B-INT8-Comfy](https://huggingface.co/bertbobson/FLUX.2-klein-9B-INT8-Comfy)）。包含静态模式（Stochastic）和动态模式（Dynamic）两种加载方式。静态模式使用随机舍入保持更高精度，适合单个或少量 LoRA。动态模式支持运行时组合多个 LoRA，适合需要频繁切换的场景。
* **SDNQ 模型支持**: 新增对 SDNQ 量化模型的 LoRA 加载支持。在节点设置中切换为 SDNQ 模式即可与 [Magic SDNQ Loader](#9-magic-sdnq-loader--magic-sdnq-k-sampler-sdnq-模型加载器与-k-采样器) 配合使用。
* **Klein 模型支持**: 新增对 Klein 模型（Nunchaku FLUX.2 Klein）的 LoRA 加载支持。在节点设置中切换为 Klein 模式即可启用 Klein 模型的 LoRA 支持。开启自适应模式可自动检测模型类型。
* **LoRA 串连功能**: 通过 `lora串接受` 和 `lora串输出` 端口，支持多个强力 LoRA 加载器之间串连。输出了 `lora串` 的加载器不加载 LoRA，仅将自己配置的 LoRA 列表传递给下一个加载器。直到最后一个不输出 `lora串` 的加载器（链末端）才加载所有自身以及接收到的 LoRA。链末端加载器必须连接 model 和 clip；中间加载器可以不连接 model/clip。可搭配 SDNQ 模式用于模型全局卸载再加载使用。支持 bypass（忽略）节点时正确透传 lora 串。

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

### 9. ⚡ Magic Cache (缓存加速节点)
> **Speed up image generation with intelligent caching.** / **智能缓存加速，让图片生成更快。**
>
><details>
><summary>Click to expand detailed features / 点击展开详细功能介绍</summary>
>
>* **Three Optimization Modes**: Choose from TeaCache, FBCache, or Both modes to accelerate your image generation. Both mode combines both techniques for maximum speed.
>* **Easy Configuration**: Simple settings dialog to adjust cache parameters without diving into complex code.
>* **Wide Model Support**: Works with FLUX, SDXL, SD1.5, Anima, and many other popular models.
>* **Performance Boost**: Typically achieves 1.5x to 3x faster generation speed while maintaining image quality.
>* **Smart Caching**: Automatically skips redundant calculations by reusing cached results when appropriate.
>* **三种优化模式**: 可选择 TeaCache、FBCache 或 Both 模式来加速图片生成。Both 模式同时使用两种技术，速度最快。
>* **简单配置**: 通过设置弹窗轻松调整缓存参数，无需修改复杂代码。
>* **广泛支持**: 支持 FLUX、SDXL、SD1.5、Anima 等多种主流模型。
>* **性能提升**: 通常可实现 1.5 倍到 3 倍的生成加速，同时保持图片质量。
>* **智能缓存**: 自动跳过重复计算，在合适的时候复用缓存结果，节省时间。
>
>#### 三种模式说明 / Three Modes Explained
>
>**☕ TeaCache 模式**：通过监测生成过程中的变化，当变化很小时直接复用上一步的结果，跳过不必要的计算。适合早期步骤，通常能实现约 2 倍加速。
>
>**⚡ FBCache 模式**：在指定的生成步数范围内，重用前一步的特征表示，跳过重复的特征计算。特别适合中间步骤（如 20%-85% 范围），效果最佳。
>
>**🚀 Both 模式（推荐）**：同时使用两种缓存技术，先经过 TeaCache 的时间步判断，再经过 FBCache 的特征块判断。相比单独使用任意一种方法，通常能提供更快的推理速度。
>
>#### 使用方法 / How to Use
>
>1. 将 Magic Cache 节点连接到您的模型输出
>2. 在节点上选择缓存模式（TeaCache / FBCache / Both）
>3. 点击「⚙️ 设置」按钮调整参数（可选，默认参数通常已足够）
>4. 点击「📖 说明」查看详细的使用说明和参数解释
>5. 连接输出到您的采样器，开始享受更快的生成速度
>
>#### 支持的模型 / Supported Models
>
>**TeaCache 支持**：FLUX、FLUX-Kontext、FLUX-Klein、PuLID-FLUX、HiDream-I1、Lumina-Image-2.0、HunyuanVideo、LTX-Video、CogVideoX、Wan2.1、SDXL、SD1.5 等。
>
>**FBCache 支持**：UNetModel（SDXL、SD3.5 等）、Flux、LTXV、HunyuanVideo、Anima 等基于 Transformer 块的模型。
>
>**本节点新增支持**：flux2klein、最新 Anima 模型、SDXL 模型（FBCache 原项目不支持）。
>
>#### 性能参考 / Performance Reference
>
>在合适的参数设置下，Magic Cache 通常可以实现：
>* TeaCache：约 **1.5x - 3x** 加速（FLUX 模型推荐 `rel_l1_thresh=0.4`，约 2x 加速）
>* FBCache：在中间步骤（20%-85% 范围）效果最佳
>* Both 模式：相比单独使用，通常提供**更快的推理速度**
>
>具体加速效果取决于模型类型、参数设置和生成内容。如果发现图片质量下降，可以适当降低阈值参数。
>
>#### 注意事项 / Notes
>
>* 首次使用建议先测试默认参数，确认效果后再根据需求调整
>* 如果图像质量下降，可以适当降低缓存阈值参数
>* 两种模式的步数范围可以设置不同，实现更精细的控制
>* 缓存会占用一定的显存或内存，可根据设备情况选择缓存设备（CUDA 或 CPU）
>
</details>

### 10. 🔮 Magic Nunchaku FLUX.2 Klein Loader (Nunchaku Klein 模型加载器)
> **Nunchaku flux2-klein9b model loader with LoRA support.** / **nunchaku-flux2-klein9b 模型加载器，现已支持 LoRA！**

<details>
<summary>Click to expand detailed features / 点击展开详细功能介绍</summary>

#### 节点简介 / Node Introduction

本节点源技术来自 [tonera/FLUX.2-klein-9B-Nunchaku](https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku) 库的原作者，本人只是将作者未实现于 ComfyUI 的部分进行实现，因为我们仍未知道官方 nunchaku 什么时候才会更新。

This node is based on the original author's implementation from [tonera/FLUX.2-klein-9B-Nunchaku](https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku). The author only implemented what was not yet available in ComfyUI, as we still don't know when the official nunchaku will be updated.

#### 特性 / Features

* **简单易用**: 只需将原有的 unet 加载器替换为本节点即可，无需复杂的配置
* **LoRA 支持**: 本节点现已支持 LoRA！需要配合强力 LoRA 加载器使用
* **极速性能**: 速度提升是至今所有 klein9b 量化模型的 3-4 倍
* **显存友好**: 推荐 30 系显卡和 40 系显卡用户使用
* **klein9bkv 量化支持**: 支持 klein9bkv 量化
* **环境嵌入重构**: 新版环境嵌入直接从 HuggingFace 下载源文件，拥有更好的兼容性

* **Easy to use**: Simply replace your unet loader with this node, no complex configuration needed
* **LoRA Support**: This node now supports LoRA! Works with Magic Power LoRA Loader
* **Fast performance**: 3-4x faster than any previous klein9b quantized model
* **VRAM friendly**: Recommended for RTX 30 series and RTX 40 series users
* **klein9bkv quantization support**: Supports klein9bkv quantization
* **Environment embedding refactored**: New version downloads source files directly from HuggingFace with better compatibility

#### LoRA 使用方法 / LoRA Usage

本节点现在支持使用 LoRA！使用方法如下：

1. 将 Klein 节点连接到强力 LoRA 加载器
2. 在强力 LoRA 加载器设置中开启 **Klein 模式**
3. 添加你想要使用的 LoRA
4. 正常运行工作流即可！

This node now supports LoRA! Usage:

1. Connect Klein node to Magic Power LoRA Loader
2. Enable **Klein mode** in Magic Power LoRA Loader settings
3. Add the LoRA you want to use
4. Run your workflow as usual!

<img width="818" height="976" alt="Image" src="https://github.com/user-attachments/assets/99d73a31-a730-4e90-acd5-8ef8674b213e" />
<img width="1895" height="926" alt="Image" src="https://github.com/user-attachments/assets/55b62c7b-9645-4219-832f-2c70450e1e5e" />

#### 模型下载 / Model Download

> **下载地址/Download Link 1（klein9b）**: https://huggingface.co/tonera/FLUX.2-klein-9B-Nunchaku/tree/main
>
> **下载地址/Download Link 2（klein9bkv）**: https://huggingface.co/tonera/FLUX.2-klein-9b-kv-Nunchaku/tree/main
>
> 两个链接均为同作者量化，环境文件通用，无需重复嵌入。
> 
> Both links are quantized by the same author and share the same environment files; no repeated embedding is required.

#### 首次使用 / First Time Setup

1. 使用本节点前，请先下载并安装 nunchaku-flux2-klein9b 模型
2. 首次使用时，点击设置会检测你是否已经安装了 wheel
3. 如果检测到已安装，点击下方的"下载并安装"即可正常使用
4. **重要**：如果之前已嵌入过环境，也请重新进行环境嵌入以获取最新支持

1. Download and install nunchaku-flux2-klein9b model before using this node
2. On first use, click Settings to check if wheel is installed
3. If wheel is detected as installed, click "Download & Install" below to start using
4. **Important**: If you've embedded before, please re-embed to get the latest support

<img width="427" height="473" alt="Image" src="https://github.com/user-attachments/assets/13e61a9a-cc27-4c22-a0f1-025c925bdfed" />

#### 测试效果 / Test Results

测试用工作流下载地址：https://drive.google.com/file/d/1BHjxeiC-a55vqnftYk2SK7Wvbgx6gMNv/view?usp=drive_link

以下是测试效果：双图编辑模式，速度快且效果极好。

Test workflow download: https://drive.google.com/file/d/1BHjxeiC-a55vqnftYk2SK7Wvbgx6gMNv/view?usp=drive_link

Test results: Two-Image Edit Mode, fast speed with excellent quality.

<img width="2260" height="1256" alt="Image" src="https://github.com/user-attachments/assets/4752f1ad-4190-4da8-82c6-e68c6abccf8f" />

#### 使用建议 / Usage Tips

* 首次使用请先安装 wheel 环境
* **LoRA 使用**：配合强力 LoRA 加载器，开启 Klein 模式即可使用 LoRA
* 使用前请重新进行环境嵌入（⚙️ 设置 → 嵌入到环境 → 下载并安装）
* 推荐显卡：RTX 30 系列、RTX 40 系列

* First time users should install wheel environment first
* **LoRA Usage**: Works with Magic Power LoRA Loader; enable Klein mode to use LoRA
* Please re-embed the environment before using (⚙️ Settings → Embed to Environment → Download & Install)
* Recommended GPUs: RTX 30 series, RTX 40 series

</details>

### 11. 📦 Magic SDNQ Loader & 🎲 Magic SDNQ K Sampler (SDNQ 模型加载器与 K 采样器)
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

**外接 CLIP/VAE 示例工作流 / Example Workflow (External CLIP + VAE)**（节点更新，且配合新节点 Magic Cache 的示例 / Node updated, with Magic Cache example）

Google Drive 下载地址 / Download: https://drive.google.com/file/d/1CYR_ZsdSFRHFkz_KwOkN7yv6Wjfckf0h/view?usp=drive_link

（可直接下载图片导入 ComfyUI / Download image and import into ComfyUI）

<img width="4286" height="2709" alt="SDNQ External CLIP VAE Workflow" src="https://github.com/user-attachments/assets/2906a45e-6ee6-4282-ba9e-835265adee38" />

**运行结果 / Result**（RTX 3060 本次采样约 40.88s / RTX 3060, ~40.88s per sample）

<img width="2557" height="1079" alt="SDNQ External CLIP VAE Result" src="https://github.com/user-attachments/assets/20fc5510-29d2-4260-b6ae-1681ad68347a" />

**性能参考 / Performance**: 在不超过 1024×1536 分辨率下，单图编辑或文生图时，采样可快至约 10–20 秒，速度与效率较高。配合 Magic Cache 节点使用后可以再提速 1.5 倍-2 倍的速度。如果不想要 Magic Cache 节点加速可以忽略该节点。其他模型（如 Qwen、Z-Image）的外接 CLIP/VAE 支持将在后续版本考虑。

At 1024×1536 or below, single image editing or text-to-image can complete in about 10–20 seconds. Using Magic Cache node can further speed up by 1.5x to 2x. You can bypass the Magic Cache node if you don't want the acceleration. Support for external CLIP/VAE on other model types (e.g. Qwen, Z-Image) may be added in future versions.

#### 局部重绘+普通文生图切换使用工作流事例 / Inpainting + Text-to-Image Switch Workflow Example

（节点更新，且配合新节点 Magic Cache 的示例 / Node updated, with Magic Cache example）

Google Drive 下载地址 / Download: https://drive.google.com/file/d/10XsVq6m_HR5KjHcQP4jDt0h-GhqbacnN/view?usp=drive_link

可直接下载图片导入 ComfyUI 使用。You can download the image and import into ComfyUI.

<img width="5998" height="2825" alt="SDNQ Inpainting + Text-to-Image Switch Workflow" src="https://github.com/user-attachments/assets/4e0b8b34-8deb-4b30-b965-254daf01c904" />

**运行结果 / Result**

<img width="2559" height="1078" alt="SDNQ Inpainting Result" src="https://github.com/user-attachments/assets/faa247bd-0a73-41b2-ba42-ac551d5edca2" />

**性能说明 / Performance Note**: 配合 Magic Cache 节点使用后可以再提速 1.5 倍-2 倍的速度。如果不想要 Magic Cache 节点加速可以忽略该节点。

**Performance Note**: Using Magic Cache node can further speed up by 1.5x to 2x. You can bypass the Magic Cache node if you don't want the acceleration.

#### ⚠️ 注意事项 / Notes

* **✅ 懒加载机制 / Lazy Loading**: SDNQ 相关节点采用真正的懒加载模式，仅在需要时导入依赖。未安装 SDNQ 时插件可正常加载，其他所有功能不受影响。
* **Lazy Loading**: SDNQ nodes use true lazy loading - dependencies are only imported when needed. When SDNQ is not installed, the plugin loads normally without errors.
* **✅ 局部重绘 / Inpainting**：SDNQ K 采样器已适配局部重绘，支持所有 SDNQ 模型（含 Flux2Klein）。使用 ComfyUI 的 **InpaintModelConditioning** + **SetLatentNoiseMask** 准备数据即可；4D latent 模型采用 latent 空间混合，3D packed 模型（如 Flux/Flux2）采用像素空间 composite。下方附有局部重绘示例工作流。
* **Inpainting supported**: Use **InpaintModelConditioning** + **SetLatentNoiseMask**; 4D models use latent blending, 3D packed models use pixel-space composite. Example workflow below.
* **🎲 采样模式切换 / Sampler mode**: 可选「仅 SDNQ」或「SDNQ + KSampler」。在「SDNQ + KSampler」模式下，根据接入模型自动选择采样方式（SDNQ 模型走 SDNQ 逻辑，其他模型走官方 KSampler），可当作通用 K 采样器使用。
* **Sampler mode**: "SDNQ" (SDNQ only) or "SDNQ + KSampler" (auto-detect; non-SDNQ models use official KSampler).
* **当前仅支持图像**：因配置限制，暂未适配视频模型，仅支持图像生成和图像编辑模型。视频模型适配将在后续版本考虑。
* **Image models only**: Video model support is not yet implemented; currently supports image generation and image editing models only.

> **⚠️ 注意 / Note**: 原本的简易文生图和图片编辑工作流图片已无法下载，请使用上方更新的工作流图片。旧的工作流图片已移除。
> 
> **⚠️ Note**: The original simple text-to-image and image editing workflow images are no longer available for download. Please use the updated workflow images above. Old workflow images have been removed.

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
