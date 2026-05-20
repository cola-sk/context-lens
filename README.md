# ContextLens Chrome 浏览器插件

ContextLens 是一款兼具极佳视觉美感与卓越性能的 Chrome 浏览器插件。它允许您在任意网页上划词选中任意文本，即时在右侧的磨砂玻璃悬浮侧边栏中与 AI 大模型进行交互。插件会自动抓取选中区域的深层 DOM 上下文（如完整的 enclosing 代码块、结构化表格和上下相邻段落）以及可选的精简版整篇网页正文，帮助 AI 提供极具洞察力的深度解答。

---

## ✨ 核心特性

- **🚀 即时选词唤醒**：在网页上选中任何文本，光标旁会立即浮现精美的「Lens」按钮，点击即可瞬间载入侧边栏并触发对话。
- **📱 常驻系统侧边栏**：利用 Chrome 原生的 Side Panel API 运作。切换标签页或浏览其他页面时，对话上下文依然完好保留。
- **🔌 广泛的多模型支持**：无缝直连各大主流官方 API 与本地开发环境：
  - **Google Gemini API** (例如：`gemini-2.5-flash`, `gemini-2.5-pro` 等官方模型)
  - **OpenAI API** (例如：`gpt-4o-mini`, `gpt-4o`, `o1-mini` 等)
  - **Anthropic Claude API** (例如：`claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest` 等)
  - **自定义 / 本地 API (Custom / Local APIs)** (兼容 OpenAI 规范的本地/第三方接口，如 Ollama, LM Studio, vLLM 等)
- **🔄 本地模型智能同步**：专为本地/第三方开发者设计。在 Custom API 模式下提供 `🔄 Sync` 同步按钮，支持一键轮询探测可用模型，将枯燥的手动输入转化为下拉列表，同时支持流畅的手动输入退回。
- **💡 智能全页上下文融合**：提供一键勾选的「附加完整文章上下文」复选框，借助高效的 HTML 语义解析器过滤广告、导航等网页噪音，将整篇干净的 Markdown 正文作为大模型的辅助认知 background。
- **🔮 极客范磨砂玻璃设计**：基于现代 CSS Grid/Flex 与 Glassmorphism 设计规范，拥有丝滑的折叠动画、代码高亮渲染、Loader 微动效和状态呼吸灯。
- **🔒 安全与隐私至上**：您的所有 API 密钥直接存储在您本人的本地浏览器存储中（`chrome.storage.local`），完全不经过任何中间服务器，点对点直连大模型端点。

---

## 🚀 安装指南

本插件基于 Chrome **Manifest V3** 规范开发，您可以直接以「已解压的扩展程序」形式进行本地加载开发：

1. 克隆或下载本项目文件夹到您的本地路径。
2. 打开 Google Chrome 浏览器，在地址栏输入并访问 `chrome://extensions/`。
3. 勾选右上角的 **开发者模式 (Developer mode)** 开关。
4. 点击左上角的 **加载已解压的扩展程序 (Load unpacked)** 按钮。
5. 选择包含本项目的根文件夹（即包含 `manifest.json` 的 `ContextLens` 目录）。
6. (推荐) 在 Chrome 工具栏的拼图图标中，将 **ContextLens** 插件固定 (Pin)，以获得最便捷的呼出体验。

---

## ⚙️ 智能 AI 配置

在首次开始体验前，您只需进行简单的 AI 服务端点配置：

1. 点击工具栏的 ContextLens 图标或选中网页文本触发打开右侧 Side Panel。
2. 点击侧边栏顶部的 **设置 (齿轮)** 按钮，或者点击欢迎卡片上的 **Configure AI Settings**。
3. 在弹出的 AI Configuration 抽屉中选择您的 **AI Provider**：
   - **如果您选择官方 API (Gemini, OpenAI, Claude)**：
     - 输入您的官方 API Key。
     - 从下拉列表中选择您偏好的主打模型。
   - **如果您选择本地 / 第三方 API (如 Ollama, LM Studio 等)**：
     - 将 Provider 切换为 **Custom / Local API**。
     - 在 **Custom Endpoint Base URL** 输入框中填写本地端点基准地址（例如 Ollama 默认为 `http://localhost:11434`，LM Studio 默认为 `http://localhost:1234/v1`）。
     - 点击旁边的 **`🔄 Sync`** 同步按钮。插件会自动轮询各个可用端点，并在成功获取本地模型后瞬间将输入框转为下拉选择框，您可以非常优雅地直接点选需要的本地模型（如 `llama3`, `qwen2.5:7b`）。
     - (可选) 如果列表未囊括您的特殊模型，您随时可以下拉选择最底部的 `✍️ Type Manually...` 退回至纯文本框手动输入 model name。
4. 点击底部的 **Save Configuration** 提交保存。看到侧边栏最底部的连接状态呼吸灯转为绿色的 **Online** 状态，即代表配置成功！

---

## 💡 使用方法

ContextLens 提供了两种高度流畅的选词分析模式：

### 方式一：浮动 Lens 图标（推荐体验）
1. 在网页上鼠标划词选中任何一段代码、数据表格或段落。
2. 选区右下方会立即动态浮现一个精致的 `🔮 Lens` 按钮。
3. 点击该按钮，右侧 Side Panel 会自动打开并载入该文本的深度 DOM 关联。**此时插件不会立即发送，而是将其作为卡片展示在输入框上方。**
4. 如果需要将该段文字所属的**整篇网页正文精简版**作为辅助背景，请勾选 context 卡片下方的 `💡 附加完整文章上下文`。
5. 在侧边栏底部的文本输入框中输入您的个性化诉求（如：“解释这行代码”、“总结这组数据”），回车或点击发送即可展开深度对话。

### 方式二：右键上下文菜单
1. 选中网页上的文本。
2. 右键单击该文本，在弹出的右键菜单中选择 **Ask ContextLens**。
3. 侧边栏会自动展露，载入相同的选中语境，您可以继续进行追问或勾选全页分析。

如果您想结束当前问题或者想要更换选词，只需点击选区卡片右上角的 **Clear** 按钮即可清空当前的网页上下文。

---

## 🛠️ 项目文件结构

- `manifest.json`：Chrome 插件的核心配置文件，声明了侧边栏权限、会话存储及内容注入规则。
- `background.js`：插件服务工作线程 (Service Worker)，负责接收划词右键指令、控制侧边栏生命周期并传递会话数据。
- `content.js` & `content.css`：注入到目标网页的脚本与样式，负责拦截鼠标鼠标划词、寻找最近标题/包裹代码块/表格等深度 DOM 上下文，以及生成浮动 Lens 按钮。
- `sidepanel/`：侧边栏的专属核心 UI 组件：
  - `sidepanel.html`：包含主页、配置抽屉、精美折叠风琴折（Context Insights Accordion）的静态布局。
  - `sidepanel.css`：基于 CSS Grid/Flex 的暗色磨砂玻璃美学规范。
  - `sidepanel.js`：驱动多端点统一流式交互（SSE / EventStream 转换）、状态持久化、本地大模型拉取同步和 prompt 高阶装配的核心逻辑。
- `generate_icons.py`：快捷生成开发测试所需的图标集。
