# Chrome Web Store 提交指引

> 我已经把所有素材备齐到 `store-assets/` 和仓库根目录的 ZIP。剩下的步骤必须由你在 Google 账号下手动操作（Chrome Web Store 没有可以替你点 submit 的 API）。

## 你需要做的

### 1. 注册开发者（一次性 $5）
打开 https://chrome.google.com/webstore/devconsole/ → Google 账号登录 → 接受协议 → 用 Google Pay 付 $5 注册费（终生有效，可以发任意数量的扩展）。

### 2. 上传 ZIP
- 控制台点 "Add new item"
- 上传：`hypothesisor-v0.1.8.zip`（在仓库根目录，约 30KB）

### 3. 填写 Store Listing
（所有文案见 `store-assets/listing.md`，可以直接复制粘贴）

| 字段 | 来源 |
|------|------|
| Description | listing.md → "详细描述" 中文 + 英文双语都贴上去 |
| Category | Productivity |
| Language | 中文（简体）+ English |
| Screenshots（至少 1 张，最多 5 张，1280×800） | `store-assets/screenshot-1/2/3.png` |
| Small promo tile（440×280，必填） | `store-assets/promo-tile-440x280.png` |
| Marquee promo tile（1400×560，可选但推荐） | `store-assets/marquee-1400x560.png` |
| Icon（128×128） | 已在 ZIP 内，CWS 自动读取 |

### 4. Privacy practices 标签
- 单一用途：粘 listing.md → "Single Purpose 描述"
- 数据使用披露 → 全部勾"None"，因为我们不收集任何数据
- Privacy Policy URL：`https://fxp.github.io/Hypothesisor/privacy.html`
- Permission justifications：listing.md → "Permission Justifications" 表格逐条粘

### 5. Distribution
- Visibility：**Public**（或先 Unlisted 内测）
- Regions：All regions
- Pricing：Free

### 6. 点 "Submit for review"
审核通常 **1-3 个工作日**，少数情况一两周。审核失败邮件会告诉你哪条不合规，按提示改了重提即可。

---

## 提前避坑

1. **隐私政策 URL 必须可访问**。Pages 已经构建好 `privacy.html`，确认 https://fxp.github.io/Hypothesisor/privacy.html 能打开再提交。
2. **截图里不要有任何用户真实 Token / API Key**。我从 demo.mp4 截的图已经过滤过，但你可以再扫一眼。
3. **Description 里不要带 GitHub 以外的外链**（容易触发审核警告）。listing.md 里只有 hypothes.is 和 bigmodel.cn，OK。
4. **CWS 不允许 BYO key 模式直接收费扩展提供商付费**——我们是免费扩展且 key 是用户自己申请的，明确说明，没问题。

---

## 一切就绪的清单

- [x] `hypothesisor-v0.1.8.zip` — 仓库根目录
- [x] `store-assets/promo-tile-440x280.png`
- [x] `store-assets/marquee-1400x560.png`
- [x] `store-assets/screenshot-1.png` ~ `screenshot-3.png`
- [x] `store-assets/listing.md` — 所有文案
- [x] `docs/privacy.html` — 已 push，Pages 上线后访问 `https://fxp.github.io/Hypothesisor/privacy.html`

照着 listing.md 复制粘贴 + 上传素材 + 点 Submit，整个流程 15-20 分钟。
