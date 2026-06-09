// Quality review for Reformat output. After generation, run a cheap
// second-pass LLM scoring against rubrics specific to the A2UI envelope
// (fidelity to source / appType fit / usability / format compliance).
// Cheaper than regenerating, lets the UI surface a quality badge and
// drives the retry loop in background.js.

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const REVIEW_MODEL = "glm-4-flash";

const REFORMAT_RUBRIC = `你是一个交互式 Web App 质量审核员。给定一个用 Google A2UI v0.10 协议描述的 reformat 输出（envelope JSON）和原文，请评分并指出问题。

评分维度（1-10）：
- contentFidelity：surface 内呈现的事实数据是否真的来自原文（数字、列表项、引文）
- appTypeFit：选的 app 形态（calculator/timer/chart/...）是否真的最适合这种内容
- usability：组件树读起来是否清晰、信息层级合理、没有冗余
- formatCompliance：A2UI 结构合法（root 存在 / id 引用闭合 / 数据绑定路径在 dataModel 里能找到）

仅输出 JSON：
{
  "overall": 1-10,
  "scores": { "contentFidelity": n, "appTypeFit": n, "usability": n, "formatCompliance": n },
  "issues": ["..."],
  "suggestions": "一句话告诉作者怎么改进（中文）"
}`;

export async function reviewReformatOutput({ content, reformat, apiKey, baseUrl, model, signal }) {
  if (!apiKey) return null;
  const messages = (reformat.a2ui || []).map((m) => {
    if (m.updateComponents?.components) {
      return {
        ...m,
        updateComponents: {
          ...m.updateComponents,
          components: m.updateComponents.components.map((c) => ({
            id: c.id, component: c.component,
            children: c.children, child: c.child,
            ...(c.text != null ? { text: typeof c.text === "string" ? c.text.slice(0, 160) : c.text } : {}),
            ...(c.label != null ? { label: c.label } : {}),
            ...(c.value != null ? { value: c.value } : {}),
          })),
        },
      };
    }
    return m;
  });
  return runReview({
    apiKey, baseUrl, model, signal,
    system: REFORMAT_RUBRIC,
    user: buildUserPayload(content, {
      title: reformat.title, summary: reformat.summary,
      appType: reformat.appType, messages,
    }),
  });
}

function buildUserPayload(content, payload) {
  const src = content.length > 12000 ? content.slice(0, 12000) + "\n\n[truncated…]" : content;
  return `=== 原文 ===\n${src}\n\n=== 待审核输出 ===\n${JSON.stringify(payload, null, 2)}`;
}

async function runReview({ apiKey, baseUrl, model, system, user, signal }) {
  const base = ((baseUrl && baseUrl.trim()) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const reviewModel = (model && model.trim() && model.toLowerCase().includes("review")) ? model.trim() : REVIEW_MODEL;
  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: reviewModel,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user },
        ],
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return { error: "timeout" };
    return { error: "network", message: String(e?.message || e) };
  }
  if (!resp.ok) return { error: "http_" + resp.status };
  const data = await resp.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { error: "empty" };
  try {
    const parsed = JSON.parse(text);
    return {
      overall: clampScore(parsed.overall),
      scores: parsed.scores || {},
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8) : [],
      suggestions: String(parsed.suggestions || "").slice(0, 600),
      reviewModel,
    };
  } catch (_) {
    return { error: "parse" };
  }
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(1, Math.min(10, Math.round(v)));
}
