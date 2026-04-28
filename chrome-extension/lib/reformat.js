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

const SYSTEM_PROMPT = `你是一个把网页内容重塑成「内容感知的交互式 Web App」的助手。读完下面的网页正文，按内容类型生成最合适的小应用。

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

export async function generateReformat({ content, url, title, format, customPrompt, apiKey, baseUrl, model }) {
  if (!apiKey) { const e = new Error("MISSING_BIGMODEL_KEY"); e.code = "MISSING_BIGMODEL_KEY"; throw e; }
  const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n\n[内容已截断…]" : content;
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
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (e) {
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
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) { const e = new Error("LLM_EMPTY"); e.code = "LLM_EMPTY"; throw e; }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) {
    const err = new Error("LLM_JSON_PARSE"); err.code = "LLM_JSON_PARSE"; err.detail = e.message; throw err;
  }
  return {
    appType: parsed.appType || "freeform",
    title: parsed.title || title || "(untitled)",
    summary: parsed.summary || "",
    html: typeof parsed.html === "string" ? parsed.html : "",
  };
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
