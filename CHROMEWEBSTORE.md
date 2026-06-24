# Chrome Web Store Listing — ContextLens

> 上次更新日期：2026-05-22
> 插件版本：1.0.0

本文档是 ContextLens 浏览器插件发布到 Chrome Web Store（谷歌浏览器应用商店）的**单一定源 (Single Source of Truth) 配置文件**。在提交插件进行审核时，你可以直接从本文档中复制所需的元数据、权限说明和隐私权声明。

---

## 商店详情 (Store Listing)

### 插件名称 (Extension Name) [REQUIRED]
*注意：必须与 `manifest.json` 中的 "name" 保持完全一致，最大 75 个字符。*
```
ContextLens
```

### 简短描述 (Short Description) [REQUIRED]
*最大 132 个字符。在搜索结果和插件卡片中显示。*
```
在网页划选文本，在右侧玻璃侧边栏与 Gemini/OpenAI/Claude/本地大模型及开发者 AI Agent 无缝对话。
```

### 详细描述 (Detailed Description) [REQUIRED]
*最大 16,000 个字符。谷歌商店不允许直接展示 Markdown 标签，请使用换行和分隔符进行排版。*
```
ContextLens 是一款为深度阅读、学术研究及日常浏览量身定制的 AI 智能网页助手。

它能在任何网页上提供优雅、流畅的交互体验，让你在阅读网页内容的同时，无需频繁切换标签页，即可立刻与最顶尖的 AI 大模型展开基于当前上下文的智能对话。

【核心功能点】
1. 划词即答：在网页上划选任何段落、代码、词汇或句子，轻点悬浮的 Lens 按钮或通过右键菜单，即可将上下文发送到侧边栏进行实时分析。

2. 超广泛的 AI 模型支持：
   ✓ Google Gemini API（gemini-2.5-flash, gemini-2.5-pro 等官方模型）
   ✓ OpenAI API（gpt-4o, gpt-4o-mini, o1-mini 等）
   ✓ Anthropic Claude API（claude-3-5-sonnet-latest, claude-3-5-haiku-latest 等）
   ✓ 本地自定义 API（兼容 OpenAI 规范的 Ollama, LM Studio, vLLM 等）
   ✓ 本地开发者 AI Agent（Claude Code, Codex Agent, Antigravity Agent 等，通过本地 Node.js 网桥自动启动）

3. 智能本地模型同步：在本地 / 自定义 API 模式下，点击「🔄 Sync」按钮，插件会自动轮询本地端点（如 Ollama）并瞬间将枯燥的手动输入转化为流畅的下拉列表选择，一键切换本地模型（如 llama3, qwen2.5 等）。如需特殊模型，支持退回至纯文本手动输入。

4. 网页上下文智能提取：可勾选"附加完整文章上下文"，插件会自动对网页进行全文精简并去除广告、导航等噪音，将干净的 Markdown 正文作为大模型的辅助背景，让模型完美掌握整篇文章或代码的语境。

5. 来源追溯与增强：发送提问时自动附带当前网页的地址和标题，方便 AI 大模型在必要时建议拉取或精确定位信息出处。

6. 标签页完全隔离：右侧侧边栏独立在当前 Tab 生效，在多标签切换时能够自动隐藏和恢复状态，侧边栏的对话历史、选中文本及上下文完全隔离，绝不干扰你其他页面的浏览。

7. 现代极简设计：采用令人惊叹的 Light Glassmorphism（浅色毛玻璃 / 亚克力）设计系统与流畅的折叠动画，完美融入现代操作系统审美，享受丝滑的视觉体验。

8. 键盘快捷键与输入优化：支持使用 Ctrl + Enter（或 macOS 上的 Cmd + Enter）快速发送内容，同时保留 Enter 回车换行的原生输入体验，让写作流畅自如。

9. 完全隐私本地化：您的 API 密钥、配置、对话历史均 100% 存储在您个人设备的本地浏览器沙箱中，绝不上传任何中转服务器。数据只会通过 HTTPS 加密通道直接发送至您选择的 AI 服务商的官方 API 端点。

10. 运行中可中断：当模型正在生成回复时，发送按钮会自动切换为红色方块中断按钮。点击后可立即终止请求（包括首包等待阶段与流式阶段）。

11. URL 规则弹窗编辑：新增和编辑自动切换规则统一采用弹窗表单，避免页面底部堆叠编辑区，配置更集中。

12. 中英文双语界面：侧边栏右上角支持中文 / English 一键切换，覆盖主要静态文案与动态状态提示。

【快速开始】
1. 点击右上角插件图标，或在任一网页上划选文本并点击悬浮的 "Lens" 按钮以打开右侧侧边栏。
2. 在侧边栏的"设置"（齿轮图标）中配置 AI 服务：
   • 官方 API 模式：填入您的 Gemini / OpenAI / Claude API 密钥并选择模型。
   • 本地模型模式：将 Provider 切换为"Custom / Local API"，输入本地端点（如 http://localhost:11434），点击"🔄 Sync"一键拉取本地模型列表。
   • 本地 Agent 模式：选择"Claude Code Agent"、"Codex Agent"等，插件会自动通过本地网桥启动对应的开发者 AI 工具。
3. 点击"Save Configuration"。看到侧边栏下部连接状态呼吸灯转为绿色"Online"即配置成功。
4. 在任意网页划选文本，点击悬浮的"Lens"按钮或右键菜单"Ask ContextLens"，在侧边栏下部输入框与 AI 进行对话。
5. 如果需要分析整篇长文或代码库背景，请勾选"💡 附加完整文章上下文"以发送更充足的上下文信息。

【隐私与安全保障】
ContextLens 坚守用户隐私至上的原则，不收集任何个人数据：
- 无账户依赖：您无须注册任何账户，也不会收集您的邮箱、姓名或个人身份信息。
- 100% 本地存储：您的 API 密钥、配置、对话历史及上下文均存储在浏览器本地的安全沙箱（chrome.storage.local）中，绝不上传任何中转服务器。
- 点对点直连：AI 请求通过 HTTPS 加密通道直接发送至官方 API 端点（Google、OpenAI、Anthropic）或您自行配置的本地端点，中间没有任何中间代理或监控。
- 本地 Agent 隔离：本地开发者 Agent（如 Claude Code）运行在您个人设备上，完全不经网络，数据永不离开您的电脑。
```

### 类别 (Category) [REQUIRED]
```
Productivity (生产力工具) 或 Developer Tools (开发者工具)
```

### 单一用途声明 (Single Purpose) [REQUIRED]
*一句话概述。必须清晰、垂直、易于理解。*
```
在网页侧边栏中提供基于划选文本上下文的多模型 AI 智能问答与网页分析服务。
```

### 主语言 (Primary Language) [REQUIRED]
```
中文 (简体) / Chinese (Simplified)
```

---

## 视觉资源 (Graphics & Assets)

| 资源类型 | 尺寸要求 | 状态 | 文件路径 / 说明 |
| :--- | :--- | :--- | :--- |
| **商店图标 (Store Icon)** [REQUIRED] | 128×128 像素 PNG | ✅ 已就绪 | `icons/icon-128.png` |
| **截图 1 (Screenshot 1)** [REQUIRED] | 1280×800 像素 | ⬜ 未创建 | 展示网页划词后，悬浮按钮被点击，弹出右侧侧边栏的界面。 |
| **截图 2 (Screenshot 2)** [RECOMMENDED] | 1280×800 像素 | ⬜ 未创建 | 展示“设置面板”，说明如何配置 Gemini / OpenAI / Ollama 等模型。 |
| **截图 3 (Screenshot 3)** [RECOMMENDED] | 1280×800 像素 | ⬜ 未创建 | 展示勾选“附加完整文章上下文”后，在折叠面板内展现的精简后全文上下文视图。 |
| **小宣传图 (Small Promo Tile)** | 440×280 像素 | ⬜ 未创建 | 谷歌商店精选推荐位使用，需高对比度 Logo 和背景。 |

---

## 权限合理性说明 (Permissions Justification)

*谷歌商店审核团队会对权限进行非常严格的审查。请务必在提交界面为每一个请求的权限填写以下“人话解释”。不要填写“功能需要”，否则会导致直接打回。*

| 声明权限 | 类型 | 合理使用理由 (Justification in English & Chinese) |
| :--- | :--- | :--- |
| `sidePanel` | permissions | **中文：** 用于在浏览器右侧打开一个独立而美观的侧边栏，以便在不覆盖或遮挡原网页内容的前提下，为用户提供沉浸式的 AI 问答交互界面。<br>**English:** Used to display a sleek, non-intrusive assistant sidebar on the right side of the browser, enabling users to interact with AI without overlapping or obscuring the main webpage content. |
| `storage` | permissions | **中文：** 用于在用户浏览器本地（100% 离线安全）持久化存储用户的 AI API 密钥、首选大模型名称、接口请求 URL 等配置，以及临时保存当前标签页的对话历史。<br>**English:** Used to securely save user API configurations (providers, keys, base URLs) and persist tab chat history locally on the user's device using `chrome.storage.local`. |
| `contextMenus` | permissions | **中文：** 用于在网页右键菜单中增加“附加所选文本到 ContextLens”快捷项，允许用户在关闭悬浮窗或进行深度阅读时，通过右键快速拉起侧边栏并传送选中的文本。<br>**English:** Used to add a right-click context menu option ("附加所选文本到 ContextLens") so users can quickly send highlighted text and trigger the side panel helper. |
| `tabs` | permissions | **中文：** 用于获取当前活动标签页的 URL 地址和网页标题。这些信息会在请求时作为参考传递给 AI 模型，便于 AI 结合来源网站提供准确、有深度且带引用链接的回答，并用于处理不同 Tab 页侧边栏状态的隔离与自动隐藏。<br>**English:** Used to read the active tab's URL and title to provide source web references to the AI models for context-rich analysis, and to manage strict tab-isolated sidebar states. |
| `scripting` | permissions | **中文：** 当用户主动劾选"附加完整文章上下文"时，用于向当前活动网页中动态注入轻量级 HTML 语义解析脚本，提取网页核心正文并自动去除广告、导航等噪音，精简后提供给侧边栏内的 AI 进行长文或代码库背景分析。<br>**English:** Used to dynamically execute a lightweight HTML semantic parser on the active page to extract and denoise main article or codebase context only when the user explicitly requests full-page analysis. |
| `<all_urls>` | host_permissions | **中文：** 允许插件在用户浏览的任何公开网页上正常检测划词动作、展示悬浮的 Lens 按钮，并在用户明确请求时提取选中范围或当前网页的正文作为大模型的背景上下文。<br>**English:** Required to allow the extension to monitor user text selections and inject the floating trigger button on any public webpage the user is actively reading, and to extract text context upon user command. |

---

## 隐私与数据安全 (Privacy & Data Use)

### 数据收集声明 (Data Collection)
*ContextLens 坚守完全本地化、无监控的原则。以下是应在 CWS 隐私表单中填写的选项：*

* **是否收集个人或敏感数据？**：**否 (No)**

### 隐私合规承诺 (Data Use Certification)
在提交时，您必须勾选并确认以下三项政策承诺：
- [x] **不转售数据**：本插件绝不将收集的数据或提取的信息出售给任何第三方。
- [x] **单一目的使用**：本插件获取的一切数据（均在本地处理）仅用于提供 AI 网页上下文解读和智能对话这一核心功能，绝不挪作他用。
- [x] **不进行信用评估或借贷**：绝不将收集的信息用于评估用户的信用记录、借贷资质或用于商业营销。

---

## 隐私政策模板 (Privacy Policy Template)

*谷歌 Web Store 要求所有请求 `<all_urls>` 主机权限和 `tabs` 等敏感权限的插件必须在互联网上公开挂载一个“隐私政策链接”。*
***建议做法**：您可以将以下文本复制并发布到您的 GitHub Pages、GitHub Gist、Notion 公开页面或您个人网站的 `/privacy-policy.html` 路径，并将生成的网址填写到谷歌后台的 **Privacy Policy URL** 框中。*

```markdown
# ContextLens - 隐私政策 (Privacy Policy)

**生效日期：2026年5月20日**

ContextLens（以下简称“我们”或“本插件”）非常重视您的个人隐私。本隐私政策旨在向您说明本插件不收集、不存储、不传输任何超出核心功能所需的个人数据的承诺。

## 1. 我们收集的数据
**我们坚决不收集任何您的敏感个人数据或隐私信息。** 
- **个人身份信息**：本插件不需要您注册账户，因此不收集您的姓名、电子邮箱、手机号等任何个人身份信息。
- **浏览历史与网页数据**：本插件绝不记录您的浏览历史、访问过的网址或网页数据。我们只在您**主动划选网页文本**并**触发 AI 问答**时，才会将您选中的文本在浏览器本地提取并展现。
- **API 密钥与设置**：您在设置面板中填写的 Google Gemini、OpenAI、Claude 或自定义大模型的 API 密钥和自定义 URL，均属于您的私人机密数据。

## 2. 数据的存储方式
- **100% 本地存储**：您的所有 API 密钥、自定义模型配置、以及在侧边栏内的对话历史记录，均通过 Chrome 的本地安全沙箱存储（`chrome.storage.local`）直接保存在您的个人电脑设备中。
- **无中转服务器**：本插件没有建立任何云端中转服务器。这意味着，您的密钥和聊天记录绝不会被上传到除您指定的大模型官方接口之外的任何服务器上。

## 3. 数据的传输与共享
- **直接发送给 AI 服务商**：当您在聊天框中提问时，您的对话内容、划选的网页上下文及 API 密钥将通过安全的 HTTPS 加密通道，**直接**发送给您在设置中选择的第三方 AI 服务商（例如 Google, OpenAI, Anthropic 等）的官方 API 端点。
- **不共享给任何其他第三方**：除上述您主动选择的官方 AI API 服务商之外，我们绝不会以任何形式将您的数据出售、共享、出租或披露给任何组织或个人。
- **第三方隐私政策**：在向第三方 AI 服务商发送请求时，数据的使用和存储将受到这些服务商各自隐私政策的约束，建议您查阅相应服务商的官方隐私说明。

## 4. 权限使用说明
本插件申请的浏览器权限具有明确、狭窄的用途，且完全服务于您的交互体验：
- `sidePanel`：用于提供侧边栏对话界面。
- `storage`：用于保存您的本地 API 密钥及偏好设置。
- `contextMenus`：用于提供右键发送文本的快捷方式。
- `tabs`：仅用于读取当前页面的 URL 及标题，以便 AI 理解您所读文章的来源背景。
- `scripting` 与 `<all_urls>`：仅在您勾选“附加完整文章上下文”并发送时，用于在您当前浏览的网页上提取核心文本内容。

## 5. 您的权利与控制
- 您可以随时在侧边栏的“设置”中清空或更改 API 密钥。
- 卸载本插件将立即且永久地删除保存在您本地设备中的所有配置、密钥及对话历史，无法恢复。

## 6. 政策更新
我们可能会根据插件功能的升级或浏览器平台政策的变化，不定期更新本隐私政策。任何更新都将在此页面公布。

## 7. 联系我们
如果您对本隐私政策有任何疑问、意见或建议，请通过以下方式与我们联系：
- 项目开源地址 / 提交 Issue：[请在此填写您的 GitHub 项目地址或反馈邮箱]
```

---

## 开发者信息 (Developer Info)

* **开发者公开名称 (Publisher Name)**：[填写您的姓名或团队名称]
* **开发者联系邮箱 (Contact Email)**：[填写一个日常能收到邮件的邮箱，谷歌会发送关键的审核通知]
* **支持与意见反馈网址 (Support URL)**：建议填写您的项目 GitHub Issues 地址，或一个反馈表单。

---

## 版本发布历史 (Version History)

| 版本号 | 发布日期 | 更新内容 | 审核状态 |
| :--- | :--- | :--- | :--- |
| **1.0.0** | 2026-05-22 | - 首次公开发布版本<br>- 支持划词自动展示 Lens 悬浮按钮及右键菜单拉起侧边栏<br>- 支持 Gemini API, OpenAI, Claude API 及自定义 / 本地大模型 (Ollama, LM Studio 等)<br>- 支持本地开发者 AI Agent (Claude Code, Codex Agent, Antigravity Agent 等)<br>- 支持本地模型智能同步：点击「🔄 Sync」一键拉取本地模型列表<br>- 支持附加完整网页正文、代码上下文及 URL 引用功能<br>- 支持 Ctrl + Enter 快捷发送，Enter 回车折行输入<br>- 支持请求进行中红色方块中断按钮（可立即停止）<br>- 支持 URL 自动切换规则弹窗新增 / 编辑<br>- 支持侧边栏中文 / English 双语切换<br>- 拥有精致的毛玻璃浅色设计界面<br>- 完全隐私本地化：数据不经任何中转服务器 | 🚨 准备提交审核 |
