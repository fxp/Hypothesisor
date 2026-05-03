// Quality review for generated content. After Annotate / Reformat, run
// a single second-pass LLM call against a *cheap* model that scores the
// output 1-10 on a few rubrics and lists concrete issues. Cheaper +
// faster than regenerating, lets the UI surface a quality badge and
// give users a one-click "improve" path.

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
// Use the cheap/fast variant by default — review is a yes/no signal,
// no need for the same model that did generation.
const REVIEW_MODEL = "glm-4-flash";

const ANNOTATE_RUBRIC = `你是一个标注质量审核员。给定一组 Hypothesis 标注（每条含 quote / headline / detail / tags）和原文，请为整组打分并指出问题。

评分维度（1-10 分，10 = 卓越）：
- insightDensity：每条标注是否真正给出有信息密度的洞察，而不是复述原文
- relevance：是否切中文章的核心观点 / 数据 / 矛盾点，而不是边角内容
- accuracy：评论是否与 quote 实际意思一致（没有曲解、没有过度推论）
- formatCompliance：headline ≤20 字 / detail 40-80 字 / tags 2-3 个

仅输出 JSON：
{
  "overall": 1-10,
  "scores": { "insightDensity": n, "relevance": n, "accuracy": n, "formatCompliance": n },
  "issues": ["..."],
  "suggestions": "一句话告诉作者怎么改进（中文）"
}`;

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

export async function reviewAnnotateOutput({ content, annotations, apiKey, baseUrl, model }) {
  if (!apiKey) return null;
  const compact = annotations.slice(0, 12).map((a) => ({
    quote: (a.quote || "").slice(0, 200),
    comment: (a.comment || "").slice(0, 280),
    tags: a.tags,
  }));
  return runReview({
    apiKey, baseUrl, model,
    system: ANNOTATE_RUBRIC,
    user: buildUserPayload(content, { annotations: compact }),
  });
}

export async function reviewReformatOutput({ content, reformat, apiKey, baseUrl, model }) {
  if (!apiKey) return null;
  // Compact A2UI envelope to fit context cheaply.
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
    apiKey, baseUrl, model,
    system: REFORMAT_RUBRIC,
    user: buildUserPayload(content, {
      title: reformat.title, summary: reformat.summary,
      appType: reformat.appType, messages,
    }),
  });
}

function buildUserPayload(content, payload) {
  // Trim source content to keep review cost predictable. Reviewer only
  // needs enough context to spot fabrication / off-topic claims.
  const src = content.length > 12000 ? content.slice(0, 12000) + "\n\n[truncated…]" : content;
  return `=== 原文 ===\n${src}\n\n=== 待审核输出 ===\n${JSON.stringify(payload, null, 2)}`;
}

async function runReview({ apiKey, baseUrl, model, system, user }) {
  const base = ((baseUrl && baseUrl.trim()) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // Always use cheap model for review unless caller forces a specific one.
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
    });
  } catch (e) {
    return { error: "network", message: String(e?.message || e) };
  }
  if (!resp.ok) {
    return { error: "http_" + resp.status };
  }
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
