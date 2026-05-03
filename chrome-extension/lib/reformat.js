// L3 — Generative App layer.
// Take page text and ask the LLM to produce a self-contained interactive
// Web App tailored to the content type (a travel guide turns into a map
// with markers, a financial product into a calculator, a recipe into a
// step timer, etc.). The output is a single HTML body string that we
// render inside a sandboxed iframe — vanilla HTML/CSS/JS only, no
// external libraries, no network calls beyond the iframe's own origin.

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4-plus";

const HINT_BY_FORMAT = {
  // Format chips are now "starting points" — the LLM will still pick
  // an app type that fits the content if the hint doesn't apply.
  tldr:      "倾向于做成「关键洞察卡片墙 + 1 段结论」的小 app。",
  qa:        "倾向于做成「可点击展开的问答列表」的小 app。",
  cards:     "倾向于做成「主题卡片 grid + 点击翻面看 detail」的小 app。",
  checklist: "倾向于做成「带勾选状态的可执行清单 + 进度条」的小 app。",
  custom:    null,  // user prompt is authoritative
};

const A2UI_SYSTEM_PROMPT = `你是一个把网页内容重塑成「rich, minimal, interactive 的核心观点呈现」的助手。读完正文，输出符合 Google A2UI v0.10 协议的声明式 UI 描述。

**目标永远是同一个**：把文章的**核心观点 / 关键事实 / 用户最该看的数据**，用最适合的可视化形态精炼地呈现出来。**少即是多** —— 比堆 10 张 Card 更好的是 3 个 KPI tile + 1 张图表 + 1 段 Highlight。

**至关重要的设计原则：尽可能产出"有结构、有数据可视化、可交互"的 surface，不要只堆 Card+Text 列表**——markdown 就能做到那个，A2UI 的价值在于：
- **多面板 dashboard 布局**（顶部 KPI tiles + 中间 chart + 侧边 details）
- **图表呈现数字**（BarChart / LineChart 替代纯文字）
- **对比表 + 时间线**（ComparisonTable / Timeline）
- **可交互控件改变 surface**（Tabs 切换视图 / Slider 改变计算器输入）

## 决策步骤
1. 扫描内容里有哪些**结构化抓手**：数字/比例 → 图表 + StatTile；时序事件 → Timeline；多选项对比 → ComparisonTable；多视角 → Tabs；数值参数 → Slider/TextField + 计算
2. **首选 dashboard 布局**：第一行 3-4 个 StatTile 横排 → 一个图表或对比 → 详情列表
3. 内容真的就是简短摘要时才回退到 Card + Text

## 可用 catalog 组件（24 种，超出渲染失败）

### Layout & 基础
- **Text** — { text, variant: "h1"|"h2"|"h3"|"body"|"caption" }；inline markdown：\\*\\*粗体\\*\\* / \\*斜体\\*
- **Column** / **Row** — { children: [id...], gap, justify, align, weight }
- **Card** — { child: id }
- **Divider** — { axis: "horizontal" | "vertical" }
- **Image** — { src, alt }
- **Icon** — { name: mail|check|clock|map|money|chart|warning|info|star|heart|search|arrow_right|arrow_left|chevron_down|chevron_up }

### 输入 & 交互
- **Button** — { child: textId, variant: "primary"|"secondary"|"borderless", action: { event: { name, context } } }
- **TextField** — { label, value: { path } }
- **CheckBox** — { label, value: { path } }
- **ChoicePicker** — { variant: "mutuallyExclusive"|"multi", options: [{label, value}], value: { path } }
- **Slider** — { label, min, max, step, value: { path } }
- **Tabs** — { tabs: [{ id, label, contentId }], value: { path: "/activeTab" } } — 根据 active id 显示对应 contentId

### 数据可视化（**优先用这些替代纯文字**）
- **StatTile** — { label, value, unit?, delta?, deltaDirection: "up"|"down"|"neutral", accent: "brand"|"good"|"warn"|"bad" } — 数字 KPI 卡片
- **BarChart** — { data: [{label, value}, ...], xLabel?, yLabel?, height? } — 柱状图
- **LineChart** — { data: [{label, value}, ...], xLabel?, yLabel?, height? } — 折线图
- **ProgressBar** — { value, max, label?, showValue? } — 进度/比例条

### 内容呈现
- **List** — { value: { path: "/items" } } — 简单条目列表
- **KeyValue** — { items: [{key, value}] } — 定义列表（适合产品规格、属性表）
- **Highlight** — { text, source?, accent: "brand"|"warn" } — 拉出引用 / 关键洞察
- **Timeline** — { items: [{when, title, detail}] } — 垂直时间线
- **ComparisonTable** — { columns: [{key, label, accent?}], rows: [{key1: ..., key2: { value, note?, accent? }, ...}] } — 对照表
- **MapView** — { background: "coast"|"island"|"city"|"blank", layers: [{id, label, color, icon}], points: [{name, x, y, layer, detail?, step?, tags?}], value?: { path } } — **旅游攻略 / 区域指南 / 多地点内容首选**。x/y 都是 0-100 的相对坐标（不是真实经纬度），按地理直觉摆位置即可。step（可选数字）让点之间画虚线路线。layer 决定颜色 + 图层切换分组。color 用 hex（如 "#dc2626"）。

## A2UI envelope 必须包含 3 条消息

\`\`\`
{
  "version": "v0.10",
  "appType": "dashboard|tldr|qa|cards|checklist|calculator|chart|timer|map|comparison|freeform",
  "title": "...",
  "summary": "...",
  "messages": [
    { "version": "v0.10", "createSurface": { "surfaceId": "main", "catalogId": "https://hypothesisor.fxp.dev/catalog/v0.4/extended" } },
    { "version": "v0.10", "updateComponents": { "surfaceId": "main", "components": [...] } },
    { "version": "v0.10", "updateDataModel": { "surfaceId": "main", "value": { ... } } }
  ]
}
\`\`\`

## 例 1：投资基金详情页 → dashboard with chart + KPIs + comparison

\`\`\`json
{
  "version": "v0.10", "appType": "dashboard",
  "title": "天天基金 003526 · 一图看清",
  "summary": "近 1 年回报 12.3%，回撤 -8%，规模 24 亿",
  "messages": [
    { "version": "v0.10", "createSurface": { "surfaceId": "main", "catalogId": "https://hypothesisor.fxp.dev/catalog/v0.4/extended" } },
    { "version": "v0.10", "updateComponents": { "surfaceId": "main", "components": [
      { "id": "root", "component": "Column", "children": ["kpis", "chart_card", "compare_card", "tags_card"], "gap": 16 },
      { "id": "kpis", "component": "Row", "children": ["k1","k2","k3","k4"], "gap": 12 },
      { "id": "k1", "component": "StatTile", "label": "近 1 年回报", "value": "12.3", "unit": "%", "delta": "vs 沪深300 +5.1%", "deltaDirection": "up", "accent": "good" },
      { "id": "k2", "component": "StatTile", "label": "最大回撤", "value": "-8.0", "unit": "%", "accent": "warn" },
      { "id": "k3", "component": "StatTile", "label": "规模", "value": "24", "unit": "亿元" },
      { "id": "k4", "component": "StatTile", "label": "管理费", "value": "1.5", "unit": "%/年" },
      { "id": "chart_card", "component": "Card", "child": "chart_col" },
      { "id": "chart_col", "component": "Column", "children": ["chart_h", "chart"] },
      { "id": "chart_h", "component": "Text", "text": "**月度收益分解**", "variant": "h3" },
      { "id": "chart", "component": "BarChart", "data": [{"label":"1月","value":2.1},{"label":"2月","value":-0.8},{"label":"3月","value":3.4},{"label":"4月","value":1.2}] },
      { "id": "compare_card", "component": "Card", "child": "compare_col" },
      { "id": "compare_col", "component": "Column", "children": ["cmp_h", "cmp"] },
      { "id": "cmp_h", "component": "Text", "text": "**vs 同类基金**", "variant": "h3" },
      { "id": "cmp", "component": "ComparisonTable",
        "columns": [{"key":"name","label":"基金"},{"key":"return","label":"年化","accent":true},{"key":"risk","label":"波动率"},{"key":"fee","label":"管理费"}],
        "rows": [
          {"name":"本基金","return":{"value":"12.3%","accent":true},"risk":"15%","fee":"1.5%"},
          {"name":"行业平均","return":"7.8%","risk":"18%","fee":"1.2%"}
        ]
      },
      { "id": "tags_card", "component": "Highlight", "text": "**风险提示**：基金有风险，过往业绩不代表未来。", "accent": "warn" }
    ]}},
    { "version": "v0.10", "updateDataModel": { "surfaceId": "main", "value": {} } }
  ]
}
\`\`\`

## 例 2：旅游攻略 → MapView + 图层 + 详情面板（**首选这种**）

适用所有"区域指南 / 多地点 / 行程"类内容。地图用 stylized SVG（不是真地理），按对原文里地理布局的直觉给 x/y（0-100）。layers 把景点 / 美食 / 住宿 等分组，用户可点 chip 切换可见性。

\`\`\`json
{
  "version": "v0.10", "appType": "map",
  "title": "垦丁 3 日深度玩 · 一图看懂",
  "summary": "55 个推荐地点 · 3 天行程 · 沿台 26 线南行",
  "messages": [
    { "version": "v0.10", "createSurface": { "surfaceId": "main", "catalogId": "https://hypothesisor.fxp.dev/catalog/v0.4/extended" } },
    { "version": "v0.10", "updateComponents": { "surfaceId": "main", "components": [
      { "id": "root", "component": "Column", "children": ["intro", "map", "stats_row", "tips"], "gap": 16 },
      { "id": "intro", "component": "Highlight", "text": "**最佳路线**：恒春古城 → 南湾 → 鹅銮鼻 → 龙磐 → 佳乐水。开车约 2 小时。", "accent": "brand" },
      { "id": "map", "component": "MapView",
        "background": "peninsula",
        "value": { "path": "/visibleLayers" },
        "layers": [
          { "id": "scenic", "label": "景点", "color": "#2563EB", "icon": "📍" },
          { "id": "food",   "label": "美食", "color": "#dc2626", "icon": "🍜" },
          { "id": "stay",   "label": "住宿", "color": "#15803d", "icon": "🏨" },
          { "id": "beach",  "label": "海滩", "color": "#0891b2", "icon": "🏖️" }
        ],
        "points": [
          { "name": "恒春古城", "x": 30, "y": 22, "layer": "scenic", "step": 1, "detail": "西门 → 南门 → 阿伯绿豆蒜，1.5 小时步行。", "tags": ["古城", "夜市"] },
          { "name": "南湾",     "x": 38, "y": 50, "layer": "beach",  "step": 2, "detail": "戏水首选，月牙湾 800m。停车场 NT$50。", "tags": ["游泳", "冲浪"] },
          { "name": "鹅銮鼻灯塔", "x": 68, "y": 88, "layer": "scenic", "step": 3, "detail": "台湾最南点 + 灯塔公园。门票 NT$60。", "tags": ["地标"] },
          { "name": "龙磐草原", "x": 80, "y": 70, "layer": "scenic", "step": 4, "detail": "看海岸悬崖 + 日出。日落同样佳。", "tags": ["日出"] },
          { "name": "佳乐水",   "x": 92, "y": 50, "layer": "scenic", "step": 5, "detail": "海蚀地形 + 瀑布。需买景区门票。", "tags": ["地质"] },
          { "name": "迪迪小吃", "x": 31, "y": 25, "layer": "food", "detail": "恒春必吃古早味卤肉饭。" },
          { "name": "夏都沙滩", "x": 36, "y": 45, "layer": "stay", "detail": "南湾旁五星，4500 起/晚。" }
        ]
      },
      { "id": "stats_row", "component": "Row", "children": ["s1","s2","s3"], "gap": 12 },
      { "id": "s1", "component": "StatTile", "label": "推荐天数", "value": "3", "unit": "天", "accent": "brand" },
      { "id": "s2", "component": "StatTile", "label": "人均预算", "value": "8000", "unit": "TWD" },
      { "id": "s3", "component": "StatTile", "label": "景点总数", "value": "55+" },
      { "id": "tips", "component": "Highlight", "text": "**注意**：4-9 月旺季住宿涨 30%，请提前 14 天订。", "accent": "warn" }
    ]}},
    { "version": "v0.10", "updateDataModel": { "surfaceId": "main", "value": { "visibleLayers": ["scenic","food","stay","beach"] } } }
  ]
}
\`\`\`

## 硬约束
1. components 是扁平 array，相互通过 id 引用
2. 必须有 id="root" 入口
3. **数字 / 列表项从原文提取**，不要瞎编
4. 字符串内换行写成 \\n
5. ASCII 双引号 "
6. **优先 dashboard / 多面板 / 图表**，少用单纯 Card+Text 堆叠

## A2UI envelope 必须包含 3 条消息

返回 JSON 对象：
\`\`\`
{
  "version": "v0.10",
  "appType": "tldr|qa|cards|checklist|calculator|chart|timer|map|comparison|freeform",
  "title": "...",       // 不在 A2UI 里，方便我们做 surface 标题
  "summary": "...",
  "messages": [
    { "version": "v0.10", "createSurface": { "surfaceId": "main", "catalogId": "https://a2ui.org/specification/v0_10/basic_catalog.json" } },
    { "version": "v0.10", "updateComponents": { "surfaceId": "main", "components": [...] } },
    { "version": "v0.10", "updateDataModel": { "surfaceId": "main", "value": { ... } } }
  ]
}
\`\`\`

## 组件硬约束
1. components 必须是**扁平 array**，相互通过 id 引用
2. 必须有一个 id 为 "root" 的组件作为入口
3. 数据从原文中提取（计算器默认值、清单条目、标题），**不要瞎编**
4. 字符串不要直接换行，需要换行写成 \\n
5. 引号用 ASCII "

## 例：理财产品 → 计算器

\`\`\`json
{
  "version": "v0.10",
  "appType": "calculator",
  "title": "活期理财收益估算",
  "summary": "输入金额，估算年化收益",
  "messages": [
    { "version": "v0.10", "createSurface": { "surfaceId": "main", "catalogId": "https://a2ui.org/specification/v0_10/basic_catalog.json" } },
    { "version": "v0.10", "updateComponents": { "surfaceId": "main", "components": [
      { "id": "root", "component": "Card", "child": "body" },
      { "id": "body", "component": "Column", "children": ["title", "rate_row", "input", "result_label", "result"], "gap": 12 },
      { "id": "title", "component": "Text", "text": "**年化 2.7%** · 灵活申赎", "variant": "h2" },
      { "id": "rate_row", "component": "Row", "children": ["rate_label", "rate_value"], "justify": "spaceBetween" },
      { "id": "rate_label", "component": "Text", "text": "七日年化", "variant": "caption" },
      { "id": "rate_value", "component": "Text", "text": "2.7%" },
      { "id": "input", "component": "TextField", "label": "本金（元）", "value": { "path": "/principal" } },
      { "id": "result_label", "component": "Text", "text": "预计一年后", "variant": "caption" },
      { "id": "result", "component": "Text", "text": { "path": "/computed_label" }, "variant": "h3" }
    ]}},
    { "version": "v0.10", "updateDataModel": { "surfaceId": "main", "value": { "principal": "10000", "computed_label": "约 270 元收益" } }}
  ]
}
\`\`\`

注意计算器例子里 \`computed_label\` 是预计算的 — A2UI 客户端不执行公式，所以你要在 updateDataModel 里直接给出当前值。后续用户修改输入会触发 client-side action（v0.4.x 后续支持）。

## JSON 输出硬约束
- 整体只输出一个 JSON 对象，不要 markdown 围栏
- 字符串内禁止真实换行，用 \\n
- 用 ASCII 双引号 "`;

// Legacy HTML prompt (kept for reference; rolled back to until A2UI is
// stable across more pages — for v0.4.0 we emit A2UI by default).
const HTML_SYSTEM_PROMPT = `你是一个把网页内容重塑成「内容感知的交互式 Web App」的助手。读完下面的网页正文，按内容类型生成最合适的小应用。

## 决策步骤
1. 识别内容类型（旅游/理财/食谱/教程/学术/新闻/数据报道/产品评测/比较/...）
2. 决定最有用的 app 形态：
   - 旅游攻略 → 内嵌 SVG 地图 + 标记点列表 + 行程时间线
   - 理财产品 → 关键数据卡 + 易被忽略的小字条款 + 收益计算器（用户可输入金额、年限）
   - 食谱 → 食材清单 + 步骤可点击勾选 + 每步骤可启动计时器
   - 数据报道 → 内嵌 SVG 柱状/折线图（用 <svg> 手画）+ 关键数据 highlight
   - 教程 → 步骤进度条 + 可勾选完成项 + 关键代码片段 copy 按钮
   - 比较类 → 对照表 + 高亮差异
   - 学术 → 核心论点 + 反对意见 + 引用列表
   - 新闻 → 时间线 + 关键人物 + 数字 highlight
   - 都不像 → 「关键观点 + 一段结论」的极简卡片
3. 用 vanilla HTML+CSS+JS 实现这个 app，所有数据来自正文。

## 严格的输出格式
返回 JSON 对象：
{
  "appType": "map" | "calculator" | "chart" | "timer" | "checklist" | "comparison" | "timeline" | "tldr" | "qa" | "cards" | "freeform",
  "title": "<app 主标题，用原文核心论断或主题，<24 字>",
  "summary": "<1-2 句话告诉用户这个 app 帮他做什么，<60 字>",
  "html": "<HTML 主体——完整的 <style> + 内容标签 + <script>，将放在 iframe 里渲染>"
}

## HTML 硬约束 —— 违反会导致渲染失败
1. **只用 vanilla**：不引用任何 CDN、不依赖 React/Vue/jQuery/Leaflet/Chart.js 等外部库。所有交互用纯 JS DOM API。
2. **完全 self-contained**：style 写在 <style> 里、JS 写在 <script> 里、不发任何 fetch / XHR、不引用外部图片。
3. **不要 <html>、<head>、<body> 标签** —— 只输出可以直接放在 body 里的内容（含 <style> 和 <script>）。
4. **数据来自正文**：地图标记的地名、计算器的默认数值、图表的数字、清单条目，**全部从原文里提取**。不要瞎编。
5. **图表用内联 SVG 手画**（柱状用 <rect>、折线用 <polyline>），不要画布 canvas（不易调试）。
6. **地图用 SVG 抽象示意图**（不是真实地理坐标）—— 标记点之间相对位置即可，加 emoji 图标 + 文字。
7. **样式高质量**：用现代字体栈、合理的 padding/spacing、light theme（白底深字）。色彩限制 #2563EB 主色 + 中性灰阶。
8. **交互必须真的能用**：计算器要能算、清单要能勾、计时器要能倒计时、卡片要能翻面或展开。
9. **不要嵌任何 API key / 用户隐私 / 危险代码**（eval、document.write、innerHTML 拼接用户输入）。
10. **HTML 里所有字符串值的换行写成 \\n**，引号用 ASCII 双引号 "。

## JSON 输出约束
- 整个回复只包含 JSON 对象，不要任何 markdown 代码块包裹、不要解释文字
- html 字段是单个长字符串，里面的 \\n 用真实的 \\n 转义
- 字符串内部禁止真实换行
`;

function reformatLanguageDirective(genLanguage) {
  switch (genLanguage) {
    case "bilingual":
      return "\n\n【输出语言】中英对照：surface 内的 Text 组件用中英两段（中文先，空行后接英文翻译），title/summary 也是中英对照。";
    case "zh":
      return "\n\n【输出语言】所有 Text / title / summary 必须中文，不要混入英文。";
    case "en":
      return "\n\n【Output language】All Text / title / summary fields must be English.";
    case "auto":
    case "":
    case undefined:
    case null:
      return "";
    default:
      return `\n\n【输出语言】${genLanguage}`;
  }
}

function buildUserPrompt({ url, title, content, format, customPrompt }) {
  const parts = [];
  parts.push(`URL: ${url}`);
  if (title) parts.push(`原页面标题: ${title}`);
  if (customPrompt) {
    parts.push(`\n【用户对最终 app 形态的偏好】\n${customPrompt}\n请优先满足这个偏好。`);
  } else if (format && HINT_BY_FORMAT[format]) {
    parts.push(`\n【可选 hint，但内容类型决定优先】\n${HINT_BY_FORMAT[format]}`);
  }
  parts.push(`\n网页正文：\n\n${content}`);
  return parts.join("\n");
}

export async function generateReformat({ content, url, title, format, customPrompt, apiKey, baseUrl, model, genLanguage, signal }) {
  if (!apiKey) { const e = new Error("MISSING_BIGMODEL_KEY"); e.code = "MISSING_BIGMODEL_KEY"; throw e; }
  // Cap input at 30K chars — long enough for full articles (typical
  // 5-10K), short enough to keep prompt eval fast. Larger contexts
  // were producing diminishing returns + much longer LLM latency.
  const truncated = content.length > 30000 ? content.slice(0, 30000) + "\n\n[内容已截断…]" : content;
  const base = ((baseUrl && baseUrl.trim()) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const modelName = (model && model.trim()) || DEFAULT_MODEL;
  const userPrompt = buildUserPrompt({ url, title, content: truncated, format, customPrompt });

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        // 12K output is plenty for typical A2UI envelopes (3-15 KB) and
        // generates noticeably faster than 16K. Truncated outputs are
        // rare and salvageable via tolerantParseAppJson.
        max_tokens: 12288,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: A2UI_SYSTEM_PROMPT + reformatLanguageDirective(genLanguage) },
          { role: "user", content: userPrompt },
        ],
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") { const a = new Error("TIMEOUT"); a.code = "TIMEOUT"; a.ctx = "bigmodel"; throw a; }
    const err = new Error(/Failed to fetch|NetworkError/i.test(String(e?.message)) ? "NETWORK" : "CORS");
    err.code = err.message; err.ctx = "bigmodel"; throw err;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`HTTP_${resp.status}`);
    err.code = `HTTP_${resp.status}`; err.status = resp.status; err.ctx = "bigmodel"; err.detail = text.slice(0, 300);
    throw err;
  }
  const data = await resp.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || "";
  const finishReason = choice?.finish_reason || "";
  if (!text) { const e = new Error("LLM_EMPTY"); e.code = "LLM_EMPTY"; throw e; }

  // The html field is the last + longest field. If finish_reason is
  // "length" the response was cut mid-string and JSON.parse will
  // reject. tolerantParseAppJson can usually recover the truncated
  // app — just close the unterminated string + braces and treat the
  // partial HTML as best-effort (the iframe will still render
  // whatever DOM is salvageable).
  const parsed = tolerantParseAppJson(text);
  if (!parsed) {
    const err = new Error("LLM_JSON_PARSE");
    err.code = "LLM_JSON_PARSE";
    err.detail = finishReason === "length"
      ? "Output exceeded max_tokens; try a simpler format or shorter article."
      : "Unrecoverable JSON shape from the model.";
    throw err;
  }
  return {
    appType: parsed.appType || "freeform",
    title: parsed.title || title || "(untitled)",
    summary: parsed.summary || "",
    // v0.4.0+ envelope. Older saved reformats keep their html field;
    // popup/output detects which to use.
    a2ui: Array.isArray(parsed.messages) ? parsed.messages : null,
    // Fallback: some prompts may still produce html (during transition)
    html: typeof parsed.html === "string" ? parsed.html : "",
    truncated: finishReason === "length" || parsed._recovered === true,
  };
}

// Salvage a model response that was truncated mid-string.
// Strategy:
//   1. Try strict JSON.parse — covers the happy path.
//   2. Walk the text as a JSON tokenizer: if we end while still inside
//      a string literal, close the string + any open arrays/objects,
//      then re-parse.
//   3. If even that fails, regex-extract appType / title / summary /
//      html as a last resort and synthesize an object.
function tolerantParseAppJson(text) {
  // Strip the model's optional ```json ... ``` fences.
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(stripped); } catch (_) {}

  // Try closing unterminated string + structure.
  const closed = autoCloseJson(stripped);
  if (closed !== stripped) {
    try { const obj = JSON.parse(closed); obj._recovered = true; return obj; } catch (_) {}
  }

  // Last-ditch field extraction.
  const grab = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i");
    const m = stripped.match(re);
    return m ? unescapeJsonString(m[1]) : "";
  };
  const appType = grab("appType");
  const title = grab("title");
  const summary = grab("summary");
  // For html, take everything after the last `"html"\s*:\s*"` until end
  // of string (best effort — html is the last + longest field).
  let html = "";
  const htmlOpen = stripped.match(/"html"\s*:\s*"/);
  if (htmlOpen) {
    const start = htmlOpen.index + htmlOpen[0].length;
    let buf = stripped.slice(start);
    // Cut at the last unescaped " followed by optional whitespace + }
    const closeMatch = buf.match(/(?:[^\\]|^)"\s*[,}]?\s*$/);
    if (closeMatch) buf = buf.slice(0, closeMatch.index + 1);
    // Drop a trailing closing quote/brace if present.
    buf = buf.replace(/"\s*[,}]?\s*$/, "");
    html = unescapeJsonString(buf);
  }
  if (html || appType || title) {
    return { appType, title, summary, html, _recovered: true };
  }
  return null;
}

function unescapeJsonString(s) {
  return String(s)
    .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Close any open string + arrays + objects so the result parses.
function autoCloseJson(s) {
  let inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
  }
  let tail = "";
  if (inStr) tail += '"';
  // Drop a trailing comma that would precede our auto-closed brace.
  let body = s.replace(/,\s*$/, "");
  while (stack.length) tail += stack.pop();
  return body + tail;
}

// ─── Render the iframe srcdoc that hosts the generated app ──────────

const IFRAME_BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 15px/1.6 -apple-system, "Helvetica Neue", system-ui, "PingFang SC", sans-serif;
    color: #0f172a; background: #ffffff;
    padding: 24px;
  }
  a { color: #2563EB; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export function buildIframeSrcdoc(reformat) {
  // Scrub any stray <html>/<body> tags the LLM may have wrapped around;
  // we want clean body-level content.
  const inner = (reformat.html || "")
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(reformat.title || "Hypothesisor")}</title>
<style>${IFRAME_BASE_CSS}</style>
</head>
<body>${inner}</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─── Storage of recent reformats (FIFO, capped at 20) ───────────────

const STORAGE_KEY = "reformats";
const CAP = 20;

export async function saveReformat(reformat) {
  const all = await loadAll();
  all.unshift(reformat);
  const trimmed = all.slice(0, CAP);
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
}

export async function loadReformat(id) {
  const all = await loadAll();
  return all.find((r) => r.id === id) || null;
}

export async function loadAll() {
  const got = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return got[STORAGE_KEY] || [];
}

export function newId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
