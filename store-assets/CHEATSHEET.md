# CWS 提交 · 一页填表 cheat sheet

按 Chrome Web Store 开发者控制台从上到下的字段顺序排好，每一项都可以直接复制粘贴。

---

## 账户信息（首次注册需要）

| 字段 | 内容 |
|------|------|
| Developer name | `fxp`（或你想公开的署名） |
| Contact email | `fxp007@gmail.com` |
| Email verified? | 注册时点确认链接 |
| Trader status | 选 **Non-trader**（个人开发者，未在欧盟商业销售） |

---

## ① Package 标签

**上传文件：** `hypothesisor-v0.1.0.zip`（仓库根目录，约 16 KB）

---

## ② Store listing 标签

### Item name
```
Hypothesisor
```

### Summary（≤ 132 字符）
```
让 AI 读懂当前网页，一键在 Hypothesis 上生成高质量标注。BYO key，纯前端，开源。
```

### Detailed description

中英文都贴进同一个框（CWS 不强制单语言）：

```
Hypothesisor 是一个 Chrome 扩展，用大模型读完当前网页正文，按你选的「风格」生成高质量标注候选，勾选后一键发布到 Hypothesis 账户。

为什么做这个：
• 收藏夹吃灰，读完即忘
• 想做笔记又懒得划重点
• Hypothesis 标注体验很棒，但人工太慢

它能做什么：
✓ 7 种标注风格 — 非共识观点 / 数据 / 行动 / 金句 / 批判性 / 令人惊讶的事实 / 自定义描述
✓ 按正文长度自动加深分析 — 短文 3-5 条，长文 12-18 条，超长篇章 25-40 条
✓ 引用原文逐字校验 — 杜绝模型"改编"原文
✓ Markdown 排版 — 加粗点题 + 展开说明
✓ 锚定与 Hypothesis 客户端字符级对齐 — TextPosition + TextQuote 双 selector

隐私：
• 不收集任何数据，没有服务器
• Token / API Key 只存在你浏览器的 chrome.storage.local
• 直连 BigModel + Hypothesis 两个 API，不经任何中转
• 完全开源（MIT），可自行审计：github.com/fxp/Hypothesisor

使用前需要：
1. Hypothesis Token（hypothes.is/account/developer 免费申请）
2. BigModel API Key（open.bigmodel.cn/usercenter/apikeys 自行申请，按 token 付费）

————————————

Hypothesisor reads the current page with an LLM, generates high-quality annotation candidates in the style you pick, and posts the ones you keep to your Hypothesis account in one click.

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
```

### Category
```
Productivity
```

### Language
```
English（主），Chinese (Simplified)
```

### Screenshots（1-5 张，1280×800）
上传：
- `store-assets/screenshot-1.png` — caption: 选风格 · 一键生成
- `store-assets/screenshot-2.png` — caption: 候选列表 · 勾选发布
- `store-assets/screenshot-3.png` — caption: Hypothesis 网页内嵌显示

### Small promo tile（440×280，必填）
上传：`store-assets/promo-tile-440x280.png`

### Marquee promo tile（1400×560，推荐）
上传：`store-assets/marquee-1400x560.png`

### Official URL
```
https://fxp.github.io/Hypothesisor/
```

### Support URL
```
https://github.com/fxp/Hypothesisor/issues
```

---

## ③ Privacy practices 标签

### Single purpose（单一用途，必填）
```
Generate AI-assisted annotation candidates for the current web page using a large language model and publish the user-selected candidates to the user's own Hypothesis account.
```

### Permission justifications

| 权限 | 粘到对应输入框的英文说明 |
|------|--------------------------|
| `activeTab` | Required to read the active tab's text only when the user explicitly clicks the toolbar button, to feed it to the LLM for annotation generation. |
| `scripting` | Required to inject a one-off content script (on click) that extracts DOM text via TreeWalker and detects the page's canonical URL. |
| `storage` | Required to persist the user-supplied Hypothesis Token, BigModel API Key, and default mode/style preferences in chrome.storage.local. Nothing is transmitted off the device. |
| Host: `open.bigmodel.cn` | Required to send the page text and the user's chosen style prompt to BigModel's chat-completions endpoint, in order to generate annotation candidates. |
| Host: `api.hypothes.is` | Required to POST the annotations the user explicitly chose to publish to their own Hypothesis account. |
| Remote code use | Select **No**. We do not load or execute remote code. |

### Data usage 披露表（每行如何选）

| Data type | 是否处理？ | 怎么填 |
|-----------|-----------|--------|
| Personally identifiable info | No | 不勾 |
| Health info | No | 不勾 |
| Financial & payment info | No | 不勾 |
| **Authentication info** | **Yes** | 勾选；用途选 **App functionality**；说明：`User-supplied Hypothesis Token and BigModel API Key are stored locally and used only as Authorization headers when calling those two APIs respectively.` |
| Personal communications | No | 不勾 |
| Location | No | 不勾 |
| **Web history** | **Yes** | 勾选；用途 **App functionality**；说明：`The active tab's URL is used as the annotation target URI when posting to Hypothesis.` |
| User activity | No | 不勾 |
| **Website content** | **Yes** | 勾选；用途 **App functionality**；说明：`Active tab text is sent to BigModel solely to generate annotation candidates the user can review and selectively publish.` |

### 三条 affirmations（都勾）

- ☑ I do not sell or transfer user data to third parties, except for the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
```
https://fxp.github.io/Hypothesisor/privacy.html
```

⚠️ 提交前打开这个链接确认能访问（Pages 构建需要 1-2 分钟）。

---

## ④ Distribution 标签

| 字段 | 选什么 |
|------|--------|
| Visibility | **Public**（或先 **Unlisted** 内测，链接分享） |
| Regions | **All regions** |
| Pricing | **Free** |
| In-app payments | None |

---

## ⑤ 提交 · Submit for review

点 **"Submit for review"**。

- 第一次提交通常 1-3 个工作日审完
- 通过后扩展页面会出现在搜索结果，并给你一个公开链接 `chrome.google.com/webstore/detail/<your-item-id>`
- 如果被拒，邮件会指出违规条款，按提示改 manifest 或描述，重提即可（不另外收费）

---

## 提交前最后核对清单

- [ ] 已在 https://chrome.google.com/webstore/devconsole 注册并付 $5
- [ ] `hypothesisor-v0.1.0.zip` 在仓库根目录可用
- [ ] https://fxp.github.io/Hypothesisor/ 可访问（落地页）
- [ ] https://fxp.github.io/Hypothesisor/privacy.html 可访问（隐私政策）
- [ ] 5 张图素材在 `store-assets/` 全部就位
- [ ] 描述、单一用途、权限说明、数据披露**全都从本文件复制**，不要手敲免得遗漏

按这个 cheat sheet 走，从开浏览器到点 Submit 大约 15 分钟。
