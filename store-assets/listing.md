# Chrome Web Store 提交资料

## 基本字段

| 字段 | 内容 |
|------|------|
| 名称 | Hypothesisor |
| 摘要（≤132 字符） | 让 AI 读懂当前网页，一键在 Hypothesis 上生成高质量标注。BYO key，纯前端，开源。 |
| 类别 | Productivity |
| 语言 | 中文（简体）+ English |

## 详细描述（Detailed Description）

### 中文

Hypothesisor 是一个 Chrome 扩展，用大模型读完当前网页正文，按你选的「风格」生成高质量标注候选，勾选后一键发布到 Hypothesis 账户。

为什么做这个：
• 收藏夹吃灰，读完即忘
• 想做笔记又懒得划重点
• Hypothesis 标注体验很棒，但人工太慢

它能做什么：
✓ 7 种标注风格 — 非共识观点 / 数据 / 行动 / 金句 / 批判性 / 令人惊讶的事实 / 自定义描述
✓ 按正文长度自动加深分析 — 短文 3-5 条，长文 12-18 条，超长篇章 25-40 条
✓ 引用原文逐字校验 — 杜绝模型"改编"原文
✓ Markdown 排版 — 加粗点题 + 展开说明，与 Hypothesis 原生渲染一致
✓ 锚定与 Hypothesis 客户端字符级对齐 — TextPosition + TextQuote 双 selector

隐私：
• 不收集任何数据，没有服务器
• Token / API Key 只存在你浏览器的 chrome.storage.local
• 直连 BigModel + Hypothesis 两个 API，不经任何中转
• 完全开源（MIT），可自行审计：github.com/fxp/Hypothesisor

使用前需要：
1. Hypothesis Token（hypothes.is/account/developer 免费申请）
2. BigModel API Key（open.bigmodel.cn/usercenter/apikeys 自行申请，按 token 付费）

### English

Hypothesisor reads the current page with an LLM, generates high-quality annotation candidates in the style you pick, and posts the ones you keep to your Hypothesis account in one click.

Why:
• Bookmarks gather dust; we read and forget
• Annotation is the proven memory amplifier — but doing it by hand is slow
• Hypothesis is a great surface for annotations; we just need to lower the cost of producing them

Features:
✓ 7 annotation styles — non-consensus, data, actionable, gold sentences, critique, surprising facts, or a free-text custom prompt
✓ Depth scales with article length — 3-5 for shorts, 12-18 for long form, 25-40 for chapter-length pieces
✓ Quote validation against the live DOM — no fabricated "exact" quotes
✓ Markdown formatting — bold takeaway + explanation, same as Hypothesis native renderer
✓ Anchoring aligned with the Hypothesis client byte-for-byte (TextPosition + TextQuote selectors)

Privacy:
• No data collection. No server.
• Token / API key live only in chrome.storage.local on your machine.
• Direct calls to BigModel + Hypothesis APIs, no middleman.
• MIT-licensed, fully auditable: github.com/fxp/Hypothesisor

Required before use:
1. Hypothesis Token (free at hypothes.is/account/developer)
2. BigModel API Key (open.bigmodel.cn, pay per token)

## Permission Justifications（提交时必填）

| 权限 | 用途说明（粘到表单的对应字段） |
|------|--------------------------------|
| activeTab | Read the current page's text only when the user clicks the toolbar button, in order to feed it to the LLM for annotation generation. |
| scripting | Inject a content script (one-off, on click) to extract DOM text via TreeWalker and detect the canonical URL. |
| storage | Persist the user-supplied Hypothesis Token, BigModel API Key, and default mode/style preferences in chrome.storage.local. Nothing leaves the machine. |
| host_permissions: open.bigmodel.cn | Send page text + style prompt to BigModel's chat-completions endpoint to generate annotation candidates. |
| host_permissions: api.hypothes.is | POST the annotations the user explicitly chose to publish to their Hypothesis account. |

## Single Purpose 描述（单一用途字段）
Generate AI-assisted annotation candidates for the current web page and publish the user-selected ones to the user's Hypothesis account.

## Privacy Policy URL
https://fxp.github.io/Hypothesisor/privacy.html

## Homepage URL
https://fxp.github.io/Hypothesisor/

## Support URL
https://github.com/fxp/Hypothesisor/issues
