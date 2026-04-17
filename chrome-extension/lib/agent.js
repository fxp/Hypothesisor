// Core annotation pipeline — fetch page text, call GLM, validate quotes, post to Hypothesis.

const BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const BIGMODEL_MODEL = "glm-4-plus";

const ANNOTATION_PROMPTS = {
  academic: "你是一个学术论文分析助手。请阅读以下论文/文章内容，生成有价值的 Hypothesis 标注。\n\n每条标注应聚焦于：\n- 核心贡献或创新点\n- 关键实验结果或数据\n- 方法论的局限性\n- 重要的相关工作引用\n- 值得深入思考的声明",
  news: "你是一个新闻分析助手。请阅读以下新闻文章，生成 Hypothesis 标注。\n\n每条标注应聚焦于：\n- 需要核查的事实声明\n- 重要的数据或统计数字\n- 可能带有偏见的表述\n- 值得深入了解的背景\n- 文章的核心论点",
  tech: "你是一个技术文档分析助手。请阅读以下技术文档/教程，生成 Hypothesis 标注。\n\n每条标注应聚焦于：\n- 初学者常见陷阱\n- 最佳实践建议\n- 已弃用或过时的内容\n- 关键概念解释\n- 值得注意的代码示例",
  general: "你是一个智识阅读助手。请阅读以下文章，生成 Hypothesis 标注。\n\n每条标注应聚焦于：\n- 文章的核心论点\n- 有洞见或反直觉的观点\n- 值得记录的重要信息\n- 可以延伸思考的问题\n- 作者的隐含假设",
};

const STYLE_PROMPTS = {
  "non-consensus": "【标注风格：非共识观点】\n优先标注作者的反直觉结论、挑战常识的声明。每条评论明确「大多数人认为 X，但作者认为 Y，因为…」。标签包含 non-consensus 或 counterintuitive。",
  data: "【标注风格：具体数字与数据】\n优先标注百分比、金额、用户量、增长率、对比数据。每条评论分析数字含义与可信度。标签包含 data-point 或 statistics。",
  actionable: "【标注风格：可执行行动】\n优先标注具体操作步骤、可复用方法论。每条评论以「行动建议：……」开头。标签包含 actionable 或 how-to。",
  "gold-sentences": "【标注风格：金句收藏】\n优先标注表达精准的洞见、有画面感的比喻。每条评论解释为什么精彩。标签包含 quotable 或 insight。",
  critique: "【标注风格：批判性阅读】\n优先标注缺乏证据的强断言、混淆相关性与因果、以偏概全。每条评论指出逻辑问题。标签包含 critique 或 logical-gap。",
  surprise: "【标注风格：令人惊讶的事实】\n优先标注大多数读者不了解的细节、出人意料的研究发现。每条评论以「令人惊讶的是：」开头。标签包含 surprising 或 fun-fact。",
};

const FORMAT_SUFFIX = `
请返回 JSON 对象 {"annotations": [ ...标注数组 ]}。每条标注字段：
- "quote": 原文精确引用（10~60 字，逐字不改）
- "headline": 一句话点题（≤20 字，纯文本，不要加星号 / 引号 / 换行）
- "detail": 展开说明（40~80 字，一两句话，说清楚为什么重要 / 机制 / 含义）
- "tags": 2~3 个英文小写短标签

程序会自动把 headline 与 detail 拼成 Markdown（加粗点题 + 空行 + 展开），你只需填字段本身。

其他要求：
- 避免套话、过渡词、结尾式"总之…""这反映了…"
- 允许用 "A → B" 表达因果或对比，不用长句堆叠
- 不要复述引用，要加增量信息（数字、对比、隐含假设、延伸思考）

【quote 规范】
1. 必须是原文逐字引用，不可改动
2. 原文是英文则引用英文；中文则引中文
3. 不要引用标题、URL、导航元数据

【JSON 硬约束】
- 只输出 JSON 对象本体，不要代码块、不要解释文字
- 所有字符串字段都必须用 ASCII 双引号 " 包裹，不要裸值、不要花引号
- 字符串内禁止出现真实换行，如需换行写成 \\n
- 示例：{"annotations":[{"quote":"...","headline":"点题一句话","detail":"展开 40-80 字","tags":["a","b"]}]}`;

function computeDepth(n) {
  if (n < 4000)  return { lo: 3,  hi: 5,  label: "短文" };
  if (n < 12000) return { lo: 6,  hi: 10, label: "中等" };
  if (n < 30000) return { lo: 12, hi: 18, label: "长文" };
  if (n < 60000) return { lo: 18, hi: 28, label: "深度长文" };
  return           { lo: 25, hi: 40, label: "超长篇章" };
}

function buildSystemPrompt(mode, style, length) {
  let base = ANNOTATION_PROMPTS[mode] || ANNOTATION_PROMPTS.general;
  if (style) {
    const preset = STYLE_PROMPTS[style];
    if (preset) {
      base = base.split("\n\n每条标注应聚焦于：")[0] + "\n\n" + preset;
    } else {
      base += `\n\n【用户自定义标注偏好】\n${style}\n请严格按照上述偏好筛选和标注内容。`;
    }
  }
  const { lo, hi, label } = computeDepth(length);
  base += `\n\n【深度·${label}（${length} 字符）】本次生成 ${lo}~${hi} 条标注，覆盖不同章节，避免集中在开头；长文深入具体论据/数据/案例。`;
  return base + "\n" + FORMAT_SUFFIX;
}

export async function extractTabText(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const article = document.querySelector("article, main, [role='main']");
      const root = article || document.body;
      return (root.innerText || "").trim();
    },
  });
  return result || "";
}

export async function callGLM({ content, url, mode, style, apiKey }) {
  if (!apiKey) throw new Error("未配置 BigModel API Key，请在设置中填写");
  const length = content.length;
  const { lo, hi } = computeDepth(length);
  const maxTokens = hi >= 25 ? 8192 : hi >= 16 ? 6144 : 4096;
  const system = buildSystemPrompt(mode, style, length);
  const truncated = length > 60000 ? content.slice(0, 60000) + "\n\n[内容已截断...]" : content;

  const resp = await fetch(`${BIGMODEL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: BIGMODEL_MODEL,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `URL: ${url}\n\n文章内容：\n\n${truncated}` },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`BigModel ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseLLMJson(text);
  const list = Array.isArray(parsed) ? parsed : parsed.annotations || parsed.items || parsed.data || [];
  return list.map((a) => ({
    quote: a.quote || "",
    comment: a.comment || buildComment(a.headline, a.detail),
    tags: Array.isArray(a.tags) ? a.tags : [],
  }));
}

function buildComment(headline, detail) {
  const h = (headline || "").trim().replace(/^\*+|\*+$/g, "");
  const d = (detail || "").trim();
  if (!h && !d) return "";
  if (!h) return d;
  if (!d) return `**${h}**`;
  return `**${h}**\n\n${d}`;
}

function parseLLMJson(text) {
  // Try direct first
  try { return JSON.parse(text); } catch (_) {}
  // Extract first {...} or [...] block
  const block = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!block) throw new Error("LLM 未返回 JSON");
  try { return JSON.parse(block[0]); } catch (_) {}
  // Repair and retry
  try { return JSON.parse(repairJSON(block[0])); } catch (e) {
    throw new Error(`JSON 解析失败（已尝试修复）：${e.message}`);
  }
}

// Repair common LLM JSON issues:
//   - raw control chars (\n \r \t) inside string literals
//   - trailing commas before ] or }
//   - curly/smart quotes used as delimiters
function repairJSON(s) {
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (c.charCodeAt(0) < 0x20) out += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
      else out += c;
    } else {
      out += c;
    }
  }
  return out.replace(/,\s*([\]\}])/g, "$1");
}

export function validateQuote(content, quote) {
  if (!quote) return { found: false };
  let pos = content.indexOf(quote);
  if (pos >= 0) return { found: true, start: pos, end: pos + quote.length, exact: quote };
  pos = content.toLowerCase().indexOf(quote.toLowerCase());
  if (pos >= 0) return { found: true, start: pos, end: pos + quote.length, exact: content.slice(pos, pos + quote.length) };
  const short = quote.slice(0, 30);
  if (short.length >= 10) {
    pos = content.indexOf(short);
    if (pos >= 0) return { found: true, start: pos, end: pos + quote.length, exact: content.slice(pos, pos + quote.length) };
  }
  return { found: false };
}

function getContext(content, start, end, n = 32) {
  const prefix = content.slice(Math.max(0, start - n), start).replace(/\s+/g, " ").slice(-n);
  const suffix = content.slice(end, end + n).replace(/\s+/g, " ").slice(0, n);
  return { prefix, suffix };
}

export async function postAnnotation({ url, quote, comment, tags, content, token }) {
  const loc = validateQuote(content, quote);
  if (!loc.found) throw new Error("引用未在原文中找到");
  const { prefix, suffix } = getContext(content, loc.start, loc.end);
  const payload = {
    uri: url,
    text: comment,
    tags: tags || [],
    group: "__world__",
    permissions: {
      read: ["group:__world__"],
      update: ["acct:me@hypothes.is"],
      delete: ["acct:me@hypothes.is"],
      admin: ["acct:me@hypothes.is"],
    },
    target: [{
      source: url,
      selector: [{ type: "TextQuoteSelector", exact: loc.exact, prefix, suffix }],
    }],
    document: { title: [url] },
  };
  const resp = await fetch("https://api.hypothes.is/api/annotations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Hypothesis ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return { id: data.id, url: `https://hypothes.is/a/${data.id}` };
}

export async function getSettings() {
  return await chrome.storage.local.get({
    hypothesisToken: "",
    bigmodelKey: "",
    defaultMode: "general",
    defaultStyle: "",
  });
}

export async function saveSettings(s) {
  await chrome.storage.local.set(s);
}
