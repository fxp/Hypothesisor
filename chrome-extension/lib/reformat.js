// L3 — Generative App layer.
// Take page text + a format preset, return a structured block list the
// output page renders as a brand-styled standalone view.

const BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const BIGMODEL_MODEL = "glm-4-plus";

const FORMAT_INSTRUCTIONS = {
  tldr: `输出一个 TL;DR 总览：
- 1 个 heading (level 1)，标题用原文中心论点的简短复述
- 1 段 paragraph，1-2 句话铺背景
- 1 个 bullet list，3-5 条要点，每条 ≤30 字
- 1 个 paragraph 作为结论（"所以…"）
不要废话，每条要点必须是文章的实质论断或事实，不要笼统。`,

  qa: `输出一份 Q&A：
- 1 个 heading 作为标题
- 1 段 paragraph，介绍这篇文章解答了什么
- 1 个 qa 块，包含 5-7 对问答；问题用读者真实会问的话写，回答 2-4 句直接给结论
- 最后 1 段 paragraph，作为延伸思考`,

  cards: `输出一组主题卡片：
- 1 个 heading 作为整体标题
- 6-12 个 card 块，每张卡有标题（≤15 字）和正文（40-80 字）
- 每张卡聚焦一个独立子主题或论点，避免重复
- 卡之间不要搞强行排序，按重要性优先`,

  checklist: `输出一份行动清单：
- 1 个 heading
- 1 段 paragraph 说明这份清单的适用场景
- 1 个 list（style="check"），每条是可执行的动作（祈使句开头），≤25 字
- 如有顺序约束，用第二个 list（style="number"）单独列必须按顺序的步骤
- 1 段 paragraph 作为风险提示或注意事项（可选）`,

  custom: null,  // user supplies a freeform description
};

const SCHEMA_RULES = `
返回 JSON 对象 {"title":"<总标题>","blocks":[...]}。每个 block 形如：
- {"kind":"heading","level":1|2|3,"text":"..."}
- {"kind":"paragraph","text":"..."}
- {"kind":"list","style":"bullet"|"number"|"check","items":["...","..."]}
- {"kind":"qa","items":[{"q":"...","a":"..."}]}
- {"kind":"card","title":"...","body":"..."}
- {"kind":"quote","text":"...原文引用..."}

硬约束：
- 字符串中的换行写成 \\n，不要直接换行
- 用 ASCII 双引号 "
- text 字段保留原文意思但用清晰的中文/英文（与文章语种保持一致）
- 不要瞎编原文里没有的事实
- quote 块如果使用，必须是原文逐字引用`;

function buildPrompt(format, customPrompt) {
  const intro = `你是一个网页内容重塑助手。读完下面的网页正文，按指定格式生成结构化输出。`;
  const formatBlock = format === "custom"
    ? `【用户自定义格式】\n${customPrompt}\n请把上文当成对最终输出形态的描述，自由选用 schema 中的 block 类型组合实现。`
    : FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS.tldr;
  return `${intro}\n\n${formatBlock}\n\n${SCHEMA_RULES}`;
}

export async function generateReformat({ content, url, title, format, customPrompt, apiKey }) {
  if (!apiKey) { const e = new Error("MISSING_BIGMODEL_KEY"); e.code = "MISSING_BIGMODEL_KEY"; throw e; }
  const truncated = content.length > 60000 ? content.slice(0, 60000) + "\n\n[内容已截断…]" : content;
  const system = buildPrompt(format, customPrompt);
  let resp;
  try {
    resp = await fetch(`${BIGMODEL_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: BIGMODEL_MODEL,
        max_tokens: 6144,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `URL: ${url}\nTitle: ${title}\n\n正文：\n\n${truncated}` },
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
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  return {
    title: parsed.title || title || "(untitled)",
    blocks: blocks.filter((b) => b && typeof b.kind === "string"),
  };
}

// ─── Storage of recent reformats (FIFO, capped at 20) ──────────────

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
