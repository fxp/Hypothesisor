# Dryer 项目分析与吸收

> 短一句：Dryer 和 Hypothesisor v0.2.0 (Reformat) 是同一个产品愿景的两个独立实现。  
> Dryer 在交互形态、prompt 设计、API 抽象层有几个明显领先的选择，本文记录值得直接借鉴的部分并据此推进 Hypothesisor v0.2.1。

## Dryer 的核心架构

```
popup (textarea + 5 preset chips)
    │  chrome.tabs.sendMessage("dryer_activate", userPrompt)
    ▼
content-script (pre-injected at document_idle on <all_urls>)
    │  extract page content (article/main/role=main + ad-strip)
    │  Shadow DOM modal: backdrop + centered panel
    │  show loading spinner
    │  chrome.runtime.sendMessage("process", {text, userPrompt})
    ▼
service-worker
    │  fetch BigModel (OpenAI-compat) with user-configured baseUrl + model
    │  systemPrompt: "按用户偏好改写 → 输出 Markdown"
    │  return {result: markdown_string} | {error: code}
    ▼
content-script
    │  mdToHtml(markdown) → render in panel
    │  ESC / click-outside / × → dismiss panel, page untouched
```

## 与 Hypothesisor v0.2.0 的对照

| 维度 | Hypothesisor v0.2.0 | Dryer | 优劣 |
|------|---------------------|-------|------|
| 输出落地 | 新标签页 (`output.html?id=…`) | 当前页 Shadow DOM 全屏覆盖层 | **Dryer 更原生**——"原页面丝毫不变"是更精简的心智 |
| 用户输入 | 8 个预置 chip + 隐藏的 Custom 输入框 | textarea 永远可见 + 5 个 chip 当快捷填充 | **Dryer 更开放**——L3 的灵魂是"用户描述形态"，把 textarea 推前 |
| LLM 输出 | 强结构化 JSON block schema | 自由 Markdown，自定义 70 行渲染器 | 各有优劣：JSON 可二次处理，Markdown 上限高（表格、代码、引用） |
| LLM 端点 | BigModel 写死 | base URL + model **用户可配置**，实质支持任意 OpenAI-compat | **Dryer 大胜**——免费/付费/本地 (Ollama) 全开，去掉单一供应商风险 |
| 模型默认 | glm-4-plus | glm-4-flash | Dryer 选了便宜的——重塑场景质量边际收益低 |
| 内容上限 | 60K 字符 | 8K 字符 | 我方更适合长文，但 8K 对 reformat 已够用 |
| 错误分类 | 同样的 code → i18n key 映射 | 9 个 error code → 中文友好提示 | 思路一致，规模略大于我方的 NETWORK/CORS/HTTP_4xx/5xx |
| 内容脚本 | `chrome.scripting.executeScript` 即点即注入 | `<all_urls>` 预注入 at document_idle | **Dryer 无 "请刷新页面" 摩擦**；代价是每页加载一段空闲脚本 |
| 偏好存储 | `chrome.storage.local` | `chrome.storage.sync` (跨设备) | Dryer 跨设备体验更好（非密钥偏好可以） |
| 演示哲学 | "AI 帮你读完，标注 / 重塑给你看" | "脱水"——蔬菜脱水后体积变小、营养留下 | Dryer 的隐喻更具体易传播 |

## 决定吸收的（v0.2.1 改动清单）

### 1. ⭐⭐⭐ 用户可配置 LLM 端点 + 模型
Dryer 的 `baseUrl` 和 `model` 可在 options 页填，默认 BigModel + glm-4-plus（我们）/ glm-4-flash（他们），**任何 OpenAI-compatible 接口**都能用。直接放开。

**收益：** 砍掉 BigModel 单一供应商绑定，DeepSeek / Moonshot / SiliconFlow / 阿里云通义 / Ollama 本地全部即插即用。市场接受度提升明显。

### 2. ⭐⭐⭐ Reformat tab 内嵌 textarea 当主输入
现状：Reformat 默认显示 5 个 format chip，"Custom" 是其中一个，点了才出现输入框。

改为：textarea 永远在 chip 下方可见。chip 点击仅是**填充示例文案**，textarea 用户可任意改。提交时如有 textarea 内容就用 textarea，否则用 chip 默认 prompt（针对 4 个非 custom preset）。

**收益：** L3 的灵魂是"用户描述形态"。把它推到第一层。同时保留 4 个 quick-fill 让用户起步零摩擦。

### 3. ⭐⭐⭐ Reformat 输出**两种渲染选择**
现状：永远开新标签页。

改为：popup 加一个小切换 "📄 新标签页 / 🖼 当前页覆盖层"。当前页模式用 Dryer 同款 Shadow DOM 模态：背景模糊 + 居中面板 + ESC/点击外部关闭。

**收益：** 阅读流被打断的成本最小化。学术长文用新标签页，看一段微信文章/X 推文用覆盖层。

### 4. ⭐⭐ 跨设备同步偏好
非密钥的偏好（默认 mode/style/format/render-mode/UI 语言）从 `storage.local` 迁到 `storage.sync`。Token 和 API Key **保持 local**（避免上传到 Google 服务器，符合"BYO key 留本地"承诺）。

### 5. ⭐⭐ 预置 prompt 词条表借鉴
Dryer 的 5 个 preset 落地：核心观点 / 数据图表 / 极简摘要 / 结构大纲 / 翻译英文。和我们的 5 个 format（TL;DR / Q&A / Cards / Checklist / Custom）对照，可以再加 2-3 个：

- **「翻译」** preset → 复用 Custom 通道，prompt = "翻译为英文（中文原文）/ 翻译为中文（英文原文），保留原结构和专有名词"
- **「数据透视」** preset → prompt = "找出文章里所有数字、统计、对比，整理成表格 + 1 段解读"

这两个能覆盖 Dryer 的"数据图表"和"翻译英文"用例。Q&A / Cards / Checklist 我们已经更细分，不动。

## 不吸收的（明确决定）

- **预注入 content script** — 我们的 `chrome.scripting.executeScript` 即用即注入更轻量，"请刷新页面"摩擦可以通过其他方式（programmatic injection on first install）以后再优化
- **8K 内容上限** — 我们的 depth tier 已经按长度自适应，砍到 8K 是退步
- **"脱水"品牌词** — 已有自己的 L1/L2/L3 战略叙事

## 实施顺序（一个 commit 完成 v0.2.1）

1. options.js + options.html: 加 `bigmodelBaseUrl` 和 `bigmodelModel` 字段
2. lib/agent.js + lib/reformat.js: 调用 fetch 时读这两个字段，默认 fallback
3. popup.html: Reformat tab 重构 — chips 上移、textarea 下移并默认可见
4. popup.html / popup.js / popup.css: 加 render-mode 切换（new tab / inline）
5. lib/overlay.js (新): 导出 `showInPageOverlay(tabId, reformat)` — 用 chrome.scripting 注入 Shadow DOM 模态，渲染 block 列表（复用 output.js 的 renderBlock 逻辑）
6. 偏好读写从 storage.local 迁 storage.sync (key/token 保持 local)
7. 增 2 个 format presets: `translate` / `data-pivot`
8. 删 Dryer/ 目录
9. bump 0.2.1，重打 ZIP

预计 ~500 行净增改。
