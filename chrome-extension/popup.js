import { extractTabText, callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";

const $ = (id) => document.getElementById(id);
let state = { tab: null, content: "", annotations: [] };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  $("pageTitle").textContent = tab?.title || "（无标题）";
  $("pageUrl").textContent = tab?.url || "";

  const s = await getSettings();
  $("mode").value = s.defaultMode;
  if (s.defaultStyle) {
    if ($("style").querySelector(`option[value="${s.defaultStyle}"]`)) {
      $("style").value = s.defaultStyle;
    } else {
      $("style").value = "__custom__";
      $("styleCustom").hidden = false;
      $("styleCustom").value = s.defaultStyle;
    }
  }
}

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

$("style").addEventListener("change", () => {
  $("styleCustom").hidden = $("style").value !== "__custom__";
});

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

function resolveStyle() {
  const v = $("style").value;
  if (v === "__custom__") return $("styleCustom").value.trim() || null;
  return v || null;
}

function render() {
  const container = $("results");
  container.innerHTML = "";
  state.annotations.forEach((a, i) => {
    const div = document.createElement("div");
    div.className = "ann" + (a.posted ? " posted" : "") + (a.invalid ? " invalid" : "");
    const check = a.invalid || a.posted
      ? ""
      : `<input type="checkbox" data-i="${i}" ${a.selected ? "checked" : ""}>`;
    const tags = (a.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
    const meta = a.posted
      ? `<div class="meta">✅ <a href="${a.postedUrl}" target="_blank">${a.postedUrl}</a></div>`
      : a.invalid
      ? `<div class="meta">⚠️ 引用未在当前页面正文中找到，已跳过</div>`
      : a.error
      ? `<div class="meta" style="color:#BD1C2B">❌ ${a.error}</div>`
      : "";
    div.innerHTML = `
      <div class="row">${check}<div style="flex:1">
        <div class="quote">「${escape(a.quote || "")}」</div>
        <div class="comment">${renderMarkdown(a.comment || "")}</div>
        <div class="tags">${tags}</div>
        ${meta}
      </div></div>`;
    container.appendChild(div);
  });
  container.querySelectorAll("input[type=checkbox]").forEach((c) => {
    c.addEventListener("change", (e) => {
      state.annotations[+e.target.dataset.i].selected = e.target.checked;
      updatePublishButton();
    });
  });
  updatePublishButton();
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Render a small subset of Markdown safely: **bold**, *italic*, paragraphs from blank lines.
function renderMarkdown(s) {
  const paras = String(s).trim().split(/\n\s*\n/);
  return paras
    .map((p) => {
      const safe = escape(p.replace(/\n/g, " "));
      const withBold = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      const withItalic = withBold.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
      return `<p>${withItalic}</p>`;
    })
    .join("");
}

function updatePublishButton() {
  const selectable = state.annotations.filter((a) => !a.invalid && !a.posted);
  const selected = selectable.filter((a) => a.selected);
  $("publishAll").disabled = selected.length === 0;
  $("counts").textContent = `${selected.length} 选中 · ${state.annotations.filter((a) => a.posted).length} 已发布 · ${state.annotations.length} 生成`;
}

$("generate").addEventListener("click", async () => {
  if (!state.tab) return;
  $("generate").disabled = true;
  setStatus("抓取页面正文…");
  try {
    state.content = await extractTabText(state.tab.id);
    if (!state.content || state.content.length < 100) {
      throw new Error("页面正文过短或无法读取");
    }
    const { bigmodelKey, hypothesisToken } = await getSettings();
    if (!bigmodelKey) {
      setStatus("请先在设置中填入 BigModel API Key", "error");
      return;
    }
    if (!hypothesisToken) {
      setStatus("请先在设置中填入 Hypothesis Token", "error");
      return;
    }
    setStatus(`正文 ${state.content.length} 字符，调用 GLM 生成标注…`);
    const raw = await callGLM({
      content: state.content,
      url: state.tab.url,
      mode: $("mode").value,
      style: resolveStyle(),
      apiKey: bigmodelKey,
    });
    state.annotations = raw.map((a) => {
      const q = (a.quote || "").trim();
      const ok = validateQuote(state.content, q).found;
      return {
        quote: q,
        comment: (a.comment || "").trim(),
        tags: Array.isArray(a.tags) ? a.tags : [],
        selected: ok,
        invalid: !ok,
      };
    });
    const valid = state.annotations.filter((a) => !a.invalid).length;
    setStatus(`生成 ${state.annotations.length} 条，${valid} 条引用有效`, "success");
    render();
  } catch (e) {
    setStatus("失败：" + e.message, "error");
  } finally {
    $("generate").disabled = false;
  }
});

$("publishAll").addEventListener("click", async () => {
  const { hypothesisToken } = await getSettings();
  if (!hypothesisToken) {
    setStatus("请先在设置中配置 Hypothesis Token", "error");
    return;
  }
  $("publishAll").disabled = true;
  const pending = state.annotations.filter((a) => a.selected && !a.invalid && !a.posted);
  for (const a of pending) {
    setStatus(`发布中：「${a.quote.slice(0, 30)}…」`);
    try {
      const { url } = await postAnnotation({
        url: state.tab.url,
        quote: a.quote,
        comment: a.comment,
        tags: a.tags,
        content: state.content,
        token: hypothesisToken,
      });
      a.posted = true;
      a.postedUrl = url;
      a.selected = false;
      a.error = null;
    } catch (e) {
      a.error = e.message;
    }
    render();
  }
  const ok = state.annotations.filter((a) => a.posted).length;
  setStatus(`完成：已发布 ${ok} 条`, "success");
});

init();
