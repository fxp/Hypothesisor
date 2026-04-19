import { extractTabText, callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";
import { initI18n, applyI18n, setLanguage, getCurrentLanguage, t } from "./lib/i18n.js";

await initI18n();
syncLangToggleLabel();

const $ = (id) => document.getElementById(id);
let state = { tab: null, content: "", annotations: [] };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.canonicalUrl = tab?.url || "";
  state.title = tab?.title || "";
  state.style = "";
  $("pageTitle").textContent = tab?.title || t("page_no_title");
  $("pageUrl").textContent = tab?.url || "";

  const s = await getSettings();
  $("mode").value = s.defaultMode;
  if (s.defaultStyle) {
    const preset = $("styleChips").querySelector(`.chip[data-style="${cssEscape(s.defaultStyle)}"]`);
    if (preset) selectChip(s.defaultStyle);
    else {
      selectChip("__custom__");
      $("styleCustom").value = s.defaultStyle;
    }
  } else {
    selectChip("");
  }
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

function selectChip(value) {
  state.style = value;
  for (const c of $("styleChips").querySelectorAll(".chip")) {
    c.classList.toggle("active", c.dataset.style === value);
  }
  $("styleCustom").hidden = value !== "__custom__";
  if (value === "__custom__") $("styleCustom").focus();
}

// Translate an Error with a machine-readable `code` into a user-friendly localized string.
function formatError(e) {
  if (!e) return "";
  const ctxLabel = e.ctx === "bigmodel" ? t("ctx_bigmodel") : e.ctx === "hypothesis" ? t("ctx_hypothesis") : "";
  switch (e.code) {
    case "MISSING_BIGMODEL_KEY":     return t("status_need_bigmodel");
    case "MISSING_HYPOTHESIS_TOKEN": return t("status_need_token");
    case "NOT_SCRIPTABLE":           return t("error_not_scriptable");
    case "EXTRACT_FAILED":           return t("error_extract_failed", e.detail || e.message);
    case "NETWORK":                  return t("error_network");
    case "CORS":                     return t("error_cors");
    case "LLM_EMPTY":                return t("error_llm_empty");
    case "LLM_NO_JSON":              return t("error_llm_no_json");
    case "LLM_JSON_PARSE":           return t("error_llm_json_parse", e.detail || "");
    case "QUOTE_NOT_FOUND":          return t("ann_quote_missing");
    case "HTTP_400":                 return t("error_http_400", ctxLabel, e.detail || "");
    case "HTTP_401":                 return t("error_http_401", ctxLabel);
    case "HTTP_403":                 return t("error_http_403", ctxLabel);
    case "HTTP_404":                 return t("error_http_404", ctxLabel);
    case "HTTP_429":                 return t("error_http_429", ctxLabel);
    default:
      if (typeof e.code === "string" && e.code.startsWith("HTTP_")) {
        const code = String(e.status || e.code.replace("HTTP_", ""));
        if (e.status >= 500) return t("error_http_5xx", ctxLabel, code, (e.detail || "").slice(0, 120));
        return t("error_http_generic", ctxLabel, code, (e.detail || "").slice(0, 120));
      }
      return e.message || String(e);
  }
}

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function syncLangToggleLabel() {
  // Button shows the language you'd switch TO, not the current one.
  $("langToggle").textContent = getCurrentLanguage() === "zh_CN" ? "EN" : "中";
}

$("langToggle").addEventListener("click", async () => {
  const next = getCurrentLanguage() === "zh_CN" ? "en" : "zh_CN";
  await setLanguage(next);
  syncLangToggleLabel();
  // Re-render dynamic content that doesn't carry data-i18n attributes.
  if (state.tab) $("pageTitle").textContent = state.tab.title || t("page_no_title");
  if (state.annotations.length) render();
});

$("styleChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) selectChip(chip.dataset.style);
});

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

function resolveStyle() {
  if (state.style === "__custom__") return $("styleCustom").value.trim() || null;
  return state.style || null;
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
      ? `<div class="meta">⚠️ ${escape(t("ann_quote_missing"))}</div>`
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
  const posted = state.annotations.filter((a) => a.posted).length;
  $("counts").textContent = t("counts_summary", String(selected.length), String(posted), String(state.annotations.length));
}

$("generate").addEventListener("click", async () => {
  if (!state.tab) return;
  $("generate").disabled = true;
  setStatus(t("status_fetching"));
  try {
    const extracted = await extractTabText(state.tab.id);
    state.content = extracted.text || "";
    state.canonicalUrl = extracted.url || state.tab.url;
    state.title = extracted.title || state.tab.title || "";
    if (!state.content || state.content.length < 100) {
      throw new Error(t("status_short_content"));
    }
    const settings = await getSettings();
    const { bigmodelKey, hypothesisToken } = settings;
    const missing = [];
    if (!bigmodelKey) missing.push(t("status_need_bigmodel"));
    if (!hypothesisToken) missing.push(t("status_need_token"));
    if (missing.length) {
      setStatus(missing.join("  ·  "), "error");
      return;
    }
    setStatus(t("status_calling_llm", String(state.content.length)));
    const raw = await callGLM({
      content: state.content,
      url: state.canonicalUrl,
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
    setStatus(t("status_generated", String(state.annotations.length), String(valid)), "success");
    render();
  } catch (e) {
    setStatus(t("status_failed", formatError(e)), "error");
  } finally {
    $("generate").disabled = false;
  }
});

$("publishAll").addEventListener("click", async () => {
  const { hypothesisToken } = await getSettings();
  if (!hypothesisToken) {
    setStatus(t("status_need_token_publish"), "error");
    return;
  }
  $("publishAll").disabled = true;
  const pending = state.annotations.filter((a) => a.selected && !a.invalid && !a.posted);
  for (const a of pending) {
    setStatus(t("status_publishing", a.quote.slice(0, 30)));
    try {
      const { url } = await postAnnotation({
        url: state.canonicalUrl,
        title: state.title,
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
      a.error = formatError(e);
    }
    render();
  }
  const ok = state.annotations.filter((a) => a.posted).length;
  setStatus(t("status_done", String(ok)), "success");
});

init();
