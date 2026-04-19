# Hypothesisor 发布计划

## 时间线（建议两周节奏）

| 阶段 | 时间 | 动作 |
|------|------|------|
| **W-1** | T-7 → T-3 | 1) CWS 提交审核（用 v0.1.4 ZIP）<br>2) 落地页定稿（含 a16z 案例 section）<br>3) demo 视频复检 |
| **CWS 通过 → 开放下载** | T-0 | 1) 朋友圈首发<br>2) 关键 AI/产品群分享<br>3) GitHub repo 加 Web Store badge |
| **首日 +1** | T+1 | 1) 小红书图文版<br>2) Twitter / X 英文版<br>3) Hypothesis 社区论坛分享 |
| **第一周复盘** | T+7 | 看安装数 / 留存（CWS 控制台）→ 决定是否做 PH / HN 启动 |
| **第二周** | T+14 | Product Hunt 排期 + Hacker News Show HN（如第一周数据 ≥ 100 安装） |

---

## 关键素材（已就位）

| 素材 | 路径 | 用途 |
|------|------|------|
| 扩展 ZIP | `hypothesisor-v0.1.4.zip` | CWS 上传 |
| 落地页 | `docs/index.html` → fxp.github.io/Hypothesisor | 首推链接 |
| 隐私政策 | `docs/privacy.html` | CWS 必填 |
| Logo | `chrome-extension/icons/icon-128.png` | 各处头像 |
| 演示视频 | `docs/demo.mp4` (3.9 MB · 47 秒 · 1440p) | 落地页嵌入 + 推文附件 |
| Promo tile | `store-assets/promo-tile-440x280.png` | CWS 必填 |
| Marquee | `store-assets/marquee-1400x560.png` | CWS 推荐位 |
| 应用截图 | `store-assets/screenshot-{1,2,3}.png` | CWS 列表 |
| **案例 showcase**（新） | `store-assets/case-a16z.png` | **真实战绩图，放在落地页 + 推文** |
| 案例文档 | `store-assets/case-study-a16z.md` | 详细 18 条标注链接 |
| 提交手册 | `store-assets/CHEATSHEET.md` | CWS 表单逐项填写 |

---

## 多平台文案（已包含 a16z 案例的社会证明）

### 1. 朋友圈（短）

> 写了个 Chrome 扩展 **Hypothesisor** 🎯
> AI 读完整页 → 生成 5-40 条高质量标注 → 一键发布到 Hypothesis ✨
>
> 实测一篇 a16z 长文（31K 字符），30 秒生成 18 条全部通过校验上线。
>
> 开源 BYO key | 👉 fxp.github.io/Hypothesisor

### 2. 群聊版（中等长度）

> 分享个刚做好的开源 Chrome 扩展 —— **Hypothesisor** 🧠
>
> 一句话：在任意网页点扩展按钮，GLM 读完全文按你选的风格（金句/批判/数据/惊喜事实/自定义…）生成 5-40 条高质量标注，勾选发到 Hypothesis。
>
> **实测案例**：a16z《Your Data Agents Need Context》(31K 字符) → 21 候选 → 18 通过校验 → 18/18 上线，约 30 秒。装 Hypothesis 浏览器插件回到原文，18 条中文洞察直接叠在英文正文上。
>
> 完整案例：fxp.github.io/Hypothesisor/case-a16z (待补)
>
> GitHub：https://github.com/fxp/Hypothesisor

### 3. 小红书（hook 驱动）

> **🚀 我让 AI 帮我读完了 a16z 的 31000 字长文，生成了 18 条精华中文标注**
>
> 做了个 Chrome 扩展叫 Hypothesisor，解决我自己的真实痛点👇
>
> ❌ 收藏夹吃灰、读过就忘
> ❌ 想做笔记又懒得划重点
> ❌ Hypothesis 标注体验很棒，但人工太慢
>
> ✅ 打开网页 → 点扩展 → 选风格 → 一键生成
> ✅ AI 找出文章里的非共识观点 / 金句 / 数据 / 惊喜事实
> ✅ 勾选想要的，一键发布到 Hypothesis
> ✅ 装 Hypothesis 浏览器插件，标注自动叠在原网页上
>
> **实测**：a16z《Your Data Agents Need Context》→ 30 秒生成 18 条全部上线 ✓
>
> **亮点**
> 🔹 7 种标注风格 + 任意自定义
> 🔹 按正文长度自动加深（短文 3 条 / 超长篇章 40 条）
> 🔹 引用逐字校验，不瞎编
> 🔹 纯客户端，Token 只存本地
> 🔹 开源 MIT
>
> 🔗 github.com/fxp/Hypothesisor
>
> #AI工具 #ChatGPT替代 #效率工具 #chrome插件 #阅读方法论 #深度阅读 #独立开发 #开源项目

### 4. Twitter / X（英文，附 case-a16z.png）

> Built **Hypothesisor** — Chrome extension that reads any webpage with an LLM and posts high-quality annotations to your Hypothesis account in one click.
>
> Just ran it on a16z's "Your Data Agents Need Context" (31K chars):
> ✓ 21 candidates generated
> ✓ 18 passed quote validation
> ✓ 18/18 published to Hypothesis
> ✓ ~30 seconds total
>
> 7 styles · BYO key · client-side · open source
>
> github.com/fxp/Hypothesisor
>
> [attach: store-assets/case-a16z.png]

### 5. Hacker News（Show HN，英文）

> **Show HN: Hypothesisor – Chrome extension that AI-annotates any webpage to Hypothesis**
>
> I wanted to make Hypothesis (web.hypothes.is) annotation feel as cheap as bookmarking. Hypothesisor reads the active tab with GLM-4-plus, generates 5–40 annotation candidates in a style you pick (non-consensus / data / actionable / gold sentences / critique / surprising facts / custom), validates every quote against the live DOM, and posts the ones you keep to your Hypothesis account.
>
> What I think is interesting:
> - Anchoring matches the official Hypothesis client byte-for-byte: TreeWalker over Text nodes, no whitespace normalization, both TextQuoteSelector and TextPositionSelector emitted, canonical URL via <link rel=canonical> first, only fragment stripped (mirrors their html-metadata.ts cascade).
> - Depth scales with article length (3-5 short / 12-18 long / 25-40 chapter) so the LLM doesn't underannotate long pieces.
> - JSON output protected with response_format json_object plus a stream-state-aware repair pass for edge cases.
> - BYO key (Hypothesis Token + BigModel API Key) — no backend, nothing leaves the device except the calls to those two APIs.
>
> Real example: a16z's "Your Data Agents Need Context" (31K chars) → 21 candidates → 18 quote-validated → 18/18 published in ~30s.
>
> Source: https://github.com/fxp/Hypothesisor
> Landing: https://fxp.github.io/Hypothesisor/
>
> Curious which extraction / anchoring details I missed.

### 6. Hypothesis 论坛（已有用户社区，英文）

> Hi all — built a Chrome extension called Hypothesisor that uses an LLM to draft high-quality annotation candidates for the active tab and posts the ones you keep to your Hypothesis account. Aligned with the client's anchoring (TreeWalker, raw whitespace, both selectors, canonical URL from <link rel=canonical>) so my annotations show up properly when you reopen the page with your Hypothesis browser extension.
>
> Recent test: 18/18 annotations on a16z's "Your Data Agents Need Context" anchored on first try.
>
> Source / install: https://github.com/fxp/Hypothesisor — feedback very welcome, especially from people who've debugged anchoring before.

---

## 启动数据观测

CWS 控制台（`chrome.google.com/webstore/devconsole`）每天看：
- **Installs & uninstalls**：净留存（install - uninstall）才是真信号
- **Impressions**：搜索曝光，受 keywords 影响
- **Ratings**：3 颗星以下立刻看评论，5 颗星以下别推 PH

GitHub Insights：
- Stars 曲线
- Issue 第一份提问的速度（≤ 24h 是好信号）

如果首周净安装 < 50：先打磨/找种子用户面对面用，**别上 PH**（差转化数据上去后期更难翻）。
首周净安装 ≥ 100 + 留存 ≥ 60% → PH 排上日历，HN Show HN 同步发。

---

## 提交 / 发布检查表

提交 CWS 前：
- [ ] 装本地 v0.1.4 打开任意 https 网页测试一遍完整流程
- [ ] 隐私政策 URL 可访问：https://fxp.github.io/Hypothesisor/privacy.html
- [ ] CHEATSHEET.md 所有字段已对齐
- [ ] 截图无敏感数据（已用 a16z 公开文章渲染）

CWS 通过后：
- [ ] 把上架链接补到 README、docs/index.html 顶部 CTA、所有社媒文案
- [ ] GitHub repo About 区域加 "Available on Chrome Web Store" badge
- [ ] 落地页 case section 嵌入 case-a16z.png + 链到完整案例
