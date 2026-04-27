# Level 3 演进路线

## Three Layers of Web Consumption

| Level | 用户看到的 | 代表产品 | Hypothesisor 角色 |
|-------|-----------|---------|------------------|
| **L1 · Raw Web** | 网页本来的样子 | 浏览器原生 | — |
| **L2 · Annotation Layer** | 原文 + AI 在上面叠加的高亮、笔记、洞察 | Hypothes.is、本扩展现状 | ✅ 已交付 |
| **L3 · Generative App** | AI 把一篇或多篇网页**重塑**成用户最想要的形态（执行摘要、Q&A、卡片、对照表、检查清单、定制 app） | Google Disco、Arc Browse for Me、Perplexity Pages | 🚧 现在开始 |

L1 解决"内容在哪里"，L2 解决"作者说了什么/我该划哪句重点"，L3 解决"我**想用**这些内容做什么"——相同字数的源材料，在 L3 可以变成 5 个不同的产物。

## Hypothesisor 在 L3 阶段的形态

不是另起炉灶，而是**在同一个扩展里加一条平行的路径**：

```
┌──── Page text extracted (TreeWalker, byte-aligned) ────┐
│                                                         │
│   ┌─ Annotate ───┐         ┌─ Reformat ──────────┐    │
│   │ (L2，已有)   │         │ (L3，本次新增)       │    │
│   │              │         │                      │    │
│   │ GLM → 高质量 │         │ GLM → 结构化 JSON   │    │
│   │ 标注 → POST  │         │ → 在新标签页渲染    │    │
│   │ Hypothesis   │         │ → 本地缓存可重访    │    │
│   └──────────────┘         └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

两条路径**共享正文抽取、错误处理、i18n、key 配置**。从用户视角，popup 顶部多一组 tab：

```
┌─────────────────────────────────┐
│ h.  Hypothesisor       中  ⚙  │
├─────────────────────────────────┤
│ Page title · URL                │
├─────────────────────────────────┤
│  [✨ Annotate]  [🪄 Reformat]   │  ← 模式切换
├─────────────────────────────────┤
│  MODE / STYLE 控件（共用）       │
├─────────────────────────────────┤
│  [大按钮：执行]                 │  ← 标签随 tab 变
└─────────────────────────────────┘
```

## L3 第一版（v0.2.0 MVP）：单页重塑

### 5 个 format presets（覆盖 80% 真实需求）

| Preset | Emoji | LLM 输出 | 适合什么文章 |
|--------|-------|---------|--------------|
| **TL;DR** | 📝 | 3-5 条要点 + 1 句结论 | 长文、新闻 |
| **Q&A** | 💬 | 5-7 个问答对（先问，再答） | 教学、技术文档 |
| **Cards** | 🃏 | 6-12 张主题卡（标题 + 1 段） | 综述、blog |
| **Checklist** | ✅ | 行动项目清单（带说明） | 教程、how-to |
| **Custom** | ✏️ | 用户用自然语言描述格式 | 任何 |

每种 preset 对应一段精调好的 system prompt，要求模型输出统一的 block 列表 schema，由扩展自己的渲染层落地为带 brand 风格的 HTML 页。

### 数据模型

```ts
type Reformat = {
  id: string;            // uuid
  createdAt: number;     // ms
  sourceUrl: string;
  sourceTitle: string;
  format: "tldr" | "qa" | "cards" | "checklist" | "custom";
  customPrompt?: string;
  blocks: Block[];
};

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; style: "bullet" | "number" | "check"; items: string[] }
  | { kind: "qa"; items: Array<{ q: string; a: string }> }
  | { kind: "card"; title: string; body: string }
  | { kind: "quote"; text: string };
```

不同 preset 只是引导模型产出**不同的 block 序列**——渲染层通用。这样未来要加 preset 不用改 UI，加一句 prompt 就行。

### 输出落地

- 生成后用 `chrome.tabs.create({ url: "output.html?id=<reformat-id>" })` 开新标签页
- `output.html` 读 `chrome.storage.local["reformats"][id]` 渲染
- 缓存最近 20 条 reformat（FIFO）→ 用户可以在 popup 里重访
- 输出页带"打开原文"和"重新生成"两个 CTA

### 不做的事

- 不做多页合成（v0.3 再说）
- 不做实时编辑（v0.3 再说）
- 不做导出 PDF/Markdown（v0.2.1 再加）
- 不上传到任何云端（保持纯前端 BYO key 的产品口径）

## L3 后续路线（v0.3+）

| 版本 | 能力 |
|------|------|
| **v0.2.0** | ✅ 单页 reformat（5 presets + 自定义） |
| v0.2.1 | 导出（Markdown / PDF）+ 分享链接 |
| v0.2.2 | Reformat 历史 + 跨设备同步（可选 Hypothesis group 作为载体） |
| **v0.3.0** | **多页合成** — 选择当前窗口的多个 tab，AI 输出一份对照/综述 |
| v0.3.1 | Persona 视角（同一文章 "给工程师看" / "给投资人看"） |
| **v0.4.0** | **Custom App 模式** — 用户描述 app 形态（"一份会议议程"），AI 把多个网页内容塞进去 |

每一步都让用户对网页内容的**主导权**更大一寸。

## Naming

不改名。Hypothesisor 本来就是 "Hypothesis-or" 的双关 → "or 别的什么"，给后续扩展留了空间。"Annotate" 和 "Reformat" 是同一颗大脑（GLM 读懂网页），两种产物。

## Success Metric（v0.2.0 上线 4 周）

- Reformat 调用量 / Annotate 调用量 ≥ 0.5（说明用户接受了平行的产品定位）
- 5 个 preset 至少 4 个有 ≥ 10% 渗透（说明 preset 选得不离谱）
- Custom prompt 占比 ≥ 15%（说明 L3 的开放性是真需求，未来值得投入）
