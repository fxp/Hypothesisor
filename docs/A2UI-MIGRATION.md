# v0.4.0 — Adopt Google's A2UI protocol for L3 Reformat output

> 草案 · 2026-05 · target: v0.4.0

## Why

Hypothesisor v0.2.x → v0.3.x 把 L3 Reformat 实现为「LLM 生成自包含 HTML+CSS+JS → iframe sandbox 渲染」。可用，但有三个根本问题：

1. **安全靠 iframe sandbox + CSP 双层防御**。`sandbox="allow-scripts"` 给了 LLM 生成的 JS 完整执行权限（仅在隔离 origin 内），但任何 `eval` / 长字符串 / 不可信链接都靠 prompt 约束 —— 不是真正的"不可执行"。
2. **每次输出风格随机**。LLM 重新写 CSS、重新挑配色，没有一致性。
3. **数据绑定脆弱**。计算器、清单类 app 全靠 LLM 手写 `addEventListener` + DOM 操作，常出错。

[Google 的 A2UI v0.10 协议](https://github.com/google/A2UI) 在 2026 春季稳定发布，正好解决这三个：
- **声明式数据**：UI 是 JSON 组件树，**不是代码**。客户端从 catalog 里挑实际渲染的 widget。
- **三层分离**：UI 结构 / 数据模型 / 客户端渲染各自独立，主题/样式由客户端集中控制。
- **数据绑定**：组件用 `{path: "/foo/bar"}` 引用 data model，输入框双向绑定自动化。

## 协议核心（v0.10）

### Server → Client envelope

每条消息恰含一个 key：
- `createSurface` — 开新 surface，绑定 catalogId + 主题
- `updateComponents` — 推送/更新组件树（adjacency list，必须有 `id: "root"`）
- `updateDataModel` — 用 JSON Pointer 路径更新 data model
- `deleteSurface` — 销毁
- `actionResponse` — 响应客户端 action 调用

### 单个组件结构

```json
{
  "id": "user_name",          // 唯一 ID，被 children 引用
  "component": "Text",        // catalog 里的类型名
  "text": "John Doe",         // 组件特有属性
  "children": ["..."]         // 容器组件特有
}
```

### 数据绑定

```json
{ "id": "email", "component": "TextField",
  "value": { "path": "/contact/email" } }
```

`updateDataModel` 写入 `/contact/email`，组件自动重渲染。

### Basic catalog（17 组件）

`Text` `Image` `Icon` `Video` `AudioPlayer` `Row` `Column` `List` `Card` `Tabs` `Modal` `Divider` `Button` `TextField` `CheckBox` `ChoicePicker` `Slider` `DateTimeInput`

## Hypothesisor 的实现选择

### v0.4.0 MVP catalog 子集（10 个 + 后续扩展）

覆盖 90% reformat 场景的最小集合：

| 组件 | 用例 |
|------|------|
| `Text` | 段落、标题、说明（支持简单 Markdown） |
| `Column` / `Row` | 布局容器 |
| `Card` | 卡片化分组 |
| `Divider` | 分隔 |
| `Button` | 操作（事件触发） |
| `TextField` | 表单输入（数字/文本） |
| `CheckBox` | 清单 |
| `Icon` | 用 emoji 实现，不引图标库 |
| `Image` | 渲染原文里的图（需要 src，谨慎） |
| `List` | 重复模板（食材列表、Q&A 项） |

延后到 v0.4.1+：`Tabs`、`Modal`、`ChoicePicker`、`Slider`、`DateTimeInput`、`Video`、`AudioPlayer`。

### 我们的 catalogId

`https://hypothesisor.fxp.dev/catalog/v0.10/basic`（我们暂用 Google basic catalog 的子集）。 v0.4.1 后可以加自己的 `Highlight`、`PullQuote`、`StatTile` 等 reading-specific 组件。

### 渲染模型

废弃 iframe + `srcdoc`。改为**直接在 Shadow DOM 里渲染**：
- A2UI 数据是 schema-validated JSON，没有任何代码执行可能 → 比 iframe sandbox 更安全
- Shadow DOM 隔离样式，不影响宿主页
- Button 的 `action.event.name` 通过 `chrome.runtime.sendMessage` 回到 service worker（与现有 `openReformatInTab` / `publishAnnotations` 同样的消息总线）

### LLM prompt 改造

旧（v0.2-0.3）：
```
返回 JSON {"appType","title","summary","html"} 其中 html 是 vanilla HTML+JS body
```

新（v0.4.0）：
```
返回 A2UI v0.10 envelope，按内容类型选 catalog 组件搭出最合适的 surface。
{"version":"v0.10","createSurface":{...},"updateComponents":{...},"updateDataModel":{...}}
```

### 计算器 / 表单类 app 怎么写？

用 A2UI 的 data model + bindings：
```json
{"id": "principal", "component": "TextField",
 "label": "本金", "value": {"path": "/calc/principal"}}
{"id": "result", "component": "Text",
 "text": {"path": "/calc/computed"}}
```

挑战：A2UI 的纯组件模型**不直接支持公式计算**。两种解决：
- **方案 A — Custom Functions**（A2UI 协议有 `functions` 扩展）：catalog 里声明 `compound_interest(p, r, n)` 这种纯函数，LLM 在 binding 里调用。需要客户端实现这些函数。
- **方案 B — Client-side action**：Button 的 action.event 触发，本地 JS 算后通过 `updateDataModel` 写回（在我们的扩展 popup 上下文内运行）。

v0.4.0 用方案 B（实现成本低），公式由 LLM 在 prompt 里嵌成 client-side handler 描述，扩展运行时解释。

## 迁移路径

| 版本 | 改动 |
|------|------|
| **v0.4.0** | A2UI 渲染器（10 组件子集） + reformat 改 prompt + 替换 iframe → Shadow DOM 直渲；老 reformat 的 html 字段仍能渲染（兼容） |
| v0.4.1 | 补完 catalog（Tabs/Modal/Slider/ChoicePicker/DateTimeInput） |
| v0.4.2 | 自定义 reading-specific 组件（PullQuote, StatTile, Highlight）+ 我们自己的 catalog |
| v0.5.0 | 用 A2UI 实现「持续对话式生成」—— 用户在 surface 里输入/点击 → 触发 action → service worker 调 LLM 增量更新 → updateComponents/DataModel 流式追加 |

## 兼容性

旧 reformat record 仍带 `html` 字段（iframe 渲染），新的带 `a2ui` 字段（envelope JSON）。`output.js` 检测哪个字段存在，分别走老/新渲染器。**用户已生成的 reformats 不会失效**。

## 风险

1. **A2UI v0.10 是相对新的协议**，2026 春季才稳定，生态的 Lit/React/Flutter renderer 都还在迭代 —— 我们自写 vanilla JS 渲染器要紧跟 spec 变更
2. **LLM 输出 A2UI 的稳定性**：模型可能不熟悉这个 schema，需要在 system prompt 里粘贴足够的 catalog 类型表 + 示例
3. **表达上限下降**：原 freeform HTML 模式能让 LLM 写一个 SVG 地图，A2UI 子集没有 Map 组件 —— 可以保留 `RawHtml` 逃生口（用 sandbox iframe）作为 fallback
