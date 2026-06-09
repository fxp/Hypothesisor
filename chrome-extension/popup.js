import { extractTabText, callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";
import { initI18n, applyI18n, setLanguage, getCurrentLanguage, t } from "./lib/i18n.js";
import { loadAllJobs } from "./lib/jobs.js";

// $ and syncLangToggleLabel must be defined BEFORE top-level await so
// the label helper can access them when init resumes. const in TDZ
// before its textual line → referencing $ from syncLangToggleLabel
// would throw a ReferenceError and abort the whole module, preventing
// every event listener below from attaching.
const $ = (id) => document.getElementById(id);
let state = { tab: null, content: "", annotations: [] };

function syncLangToggleLabel() {
  $("langToggle").textContent = getCurrentLanguage() === "zh_CN" ? "EN" : "中";
}

await initI18n();
syncLangToggleLabel();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.canonicalUrl = tab?.url || "";
  state.title = tab?.title || "";
  state.style = "";
  state.mode = "general";
  $("pageTitle").textContent = tab?.title || t("page_no_title");
  $("pageUrl").textContent = tab?.url || "";

  const s = await getSettings();
  selectMode(s.defaultMode || "general");
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
  await refreshJobs();
}

// ── Jobs panel ────────────────────────────────────────────────────
// Live timer for running-job elapsed/remaining display. The SW only
// writes to storage on state transitions, so we tick locally to keep
// the progress bar advancing every second.
let _jobsTick = null;
let _activeJobsCache = [];
function startJobsTick() {
  if (_jobsTick) return;
  _jobsTick = setInterval(() => {
    if (!_activeJobsCache.length) { stopJobsTick(); return; }
    for (const job of _activeJobsCache) {
      const node = document.querySelector(`.job-item[data-job-id="${job.id}"]`);
      if (node) paintJobProgress(node, job);
    }
  }, 1000);
}
function stopJobsTick() {
  if (_jobsTick) { clearInterval(_jobsTick); _jobsTick = null; }
}

async function refreshJobs() {
  const all = await loadAllJobs();
  // Annotate-only build: ignore any straggler reformat jobs from a
  // pre-split install — they'd render with no badge/score and would
  // confuse the user.
  const mine = all.filter((j) => j.type === "annotate");
  const sorted = mine.slice().sort((a, b) => {
    const aActive = isActive(a) ? 0 : 1;
    const bActive = isActive(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
  const list = sorted.slice(0, 8);
  $("jobsPanel").hidden = list.length === 0;
  const host = $("jobsList");
  host.innerHTML = "";
  for (const job of list) host.appendChild(renderJobItem(job));
  _activeJobsCache = list.filter(isActive);
  if (_activeJobsCache.length) startJobsTick(); else stopJobsTick();
}

function isActive(job) {
  return job.status === "pending" || job.status === "running" || job.status === "validating";
}

function renderJobItem(job) {
  const item = document.createElement("div");
  const statusClass = job.status === "error" ? "error" : isActive(job) ? "running" : "";
  const actionable = job.status === "done" || job.status === "error";
  item.className = `job-item annotate ${statusClass} ${actionable ? "actionable" : ""}`.trim();
  item.dataset.jobId = job.id;

  const title = job.sourceTitle || job.sourceHostname || "(untitled)";
  const subtitle = subtitleFor(job);
  const time = fmtRelativeMin(job.updatedAt || job.createdAt || Date.now());

  const score = job.review?.overall;
  const scoreBadge = score
    ? `<span class="ji-score ji-score--${scoreClass(score)}" title="${escape(reviewSummaryText(job.review))}">${score}/10</span>`
    : "";
  item.innerHTML = `
    <span class="ji-icon">✨</span>
    <span class="ji-body">
      <span class="ji-title"></span>
      <span class="ji-status"></span>
    </span>
    ${scoreBadge}
    <span class="ji-time">${escape(time)}</span>
  `;
  item.querySelector(".ji-title").textContent = title;
  item.querySelector(".ji-status").textContent = subtitle;

  if (isActive(job)) {
    const sp = document.createElement("span");
    sp.className = "ji-spinner";
    item.insertBefore(sp, item.querySelector(".ji-time"));
    const prog = document.createElement("div");
    prog.className = "ji-progress";
    prog.innerHTML = `<div class="ji-progress-bar"><div class="ji-progress-fill"></div></div><span class="ji-progress-text"></span>`;
    item.appendChild(prog);
    paintJobProgress(item, job);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "ji-cancel";
    x.title = t("jobs_cancel_title", "Cancel");
    x.textContent = "×";
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      x.disabled = true;
      try { await chrome.runtime.sendMessage({ type: "cancelJob", jobId: job.id }); } catch (_) {}
      refreshJobs();
    });
    item.appendChild(x);
  }

  if (actionable && job.status === "done") {
    item.addEventListener("click", () => openJob(job));
  }
  return item;
}

function paintJobProgress(item, job) {
  const fill = item.querySelector(".ji-progress-fill");
  const text = item.querySelector(".ji-progress-text");
  if (!fill || !text) return;
  const startedAt = job.startedAt || job.createdAt || Date.now();
  const budget = Math.max(1000, job.timeoutMs || 300000);
  const elapsed = Date.now() - startedAt;
  const pct = Math.min(100, Math.max(0, (elapsed / budget) * 100));
  fill.style.width = pct.toFixed(1) + "%";
  if (elapsed >= budget) {
    text.textContent = t("jobs_progress_overdue", fmtClockSec(elapsed));
    fill.classList.add("overdue");
  } else {
    text.textContent = t("jobs_progress_elapsed", fmtClockSec(elapsed), fmtClockSec(budget));
    fill.classList.remove("overdue");
  }
}
function fmtClockSec(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function subtitleFor(job) {
  if (job.status === "error") return job.statusText || "error";
  if (isActive(job)) return job.statusText || "Working…";
  const total = (job.annotations || []).length;
  const valid = (job.annotations || []).filter((a) => !a.invalid).length;
  const posted = (job.annotations || []).filter((a) => a.posted).length;
  return posted > 0
    ? t("jobs_subtitle_annotate_posted", String(posted), String(valid))
    : t("jobs_subtitle_annotate_done", String(valid), String(total));
}

function openJob(job) {
  // Reopen the source page so the Hypothesis client can overlay the
  // posted annotations. The user can also retrieve them at
  // https://hypothes.is/users/<their-account>.
  if (job.sourceUrl) chrome.tabs.create({ url: job.sourceUrl });
}

function scoreClass(score) {
  if (score >= 8) return "good";
  if (score >= 6) return "ok";
  return "warn";
}

function reviewSummaryText(review) {
  if (!review) return "";
  const lines = [`Quality: ${review.overall}/10`];
  if (review.suggestions) lines.push(review.suggestions);
  if (review.issues?.length) lines.push("Issues: " + review.issues.slice(0, 3).join(" · "));
  return lines.join("\n");
}

function fmtRelativeMin(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return "now";
  if (sec < 3600) return Math.round(sec / 60) + "m";
  if (sec < 86400) return Math.round(sec / 3600) + "h";
  return Math.round(sec / 86400) + "d";
}

function selectMode(value) {
  state.mode = value;
  for (const p of $("modePills").querySelectorAll(".pill")) {
    p.classList.toggle("active", p.dataset.mode === value);
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

$("langToggle").addEventListener("click", async () => {
  const next = getCurrentLanguage() === "zh_CN" ? "en" : "zh_CN";
  await setLanguage(next);
  syncLangToggleLabel();
  if (state.tab) $("pageTitle").textContent = state.tab.title || t("page_no_title");
  if (state.annotations.length) render();
  refreshJobs();
});

$("styleChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) selectChip(chip.dataset.style);
});

$("modePills").addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (pill) selectMode(pill.dataset.mode);
});

$("successToastClose").addEventListener("click", () => hideSuccessToast());

function showSuccessToast(count) {
  $("successToastTitle").textContent = t("success_published_title", String(count));
  $("successToastBody").textContent = t("success_published_body");
  $("successToastLink").href = state.canonicalUrl || state.tab?.url || "#";
  $("successToast").hidden = false;
}
function hideSuccessToast() { $("successToast").hidden = true; }

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
  hideSuccessToast();
  $("generate").disabled = true;
  setStatus(t("status_fetching"));
  try {
    const extracted = await extractTabText(state.tab.id);
    state.content = extracted.text || "";
    state.canonicalUrl = extracted.url || state.tab.url;
    state.title = extracted.title || state.tab.title || "";
    if (!state.content || state.content.length < 100) throw new Error(t("status_short_content"));
    const { bigmodelKey, hypothesisToken } = await getSettings();

    const missing = [];
    if (!bigmodelKey) missing.push(t("status_need_bigmodel"));
    if (!hypothesisToken) missing.push(t("status_need_token"));
    if (missing.length) { setStatus(missing.join("  ·  "), "error"); return; }

    const spec = {
      type: "annotate",
      tabId: state.tab.id,
      canonicalUrl: state.canonicalUrl,
      title: state.title,
      content: state.content,
      mode: state.mode,
      style: resolveStyle(),
    };
    const { jobId, error } = await chrome.runtime.sendMessage({ type: "startJob", spec });
    if (error) throw new Error(error);
    state.activeJobId = jobId;
    setStatus(t("status_calling_llm", String(state.content.length)));
  } catch (e) {
    setStatus(t("status_failed", formatError(e)), "error");
  } finally {
    $("generate").disabled = false;
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.jobs) return;
  refreshJobs();
  const job = (changes.jobs.newValue || []).find((j) => j.id === state.activeJobId);
  if (!job) return;
  await onJobUpdate(job);
});

async function onJobUpdate(job) {
  if (job.status === "running" || job.status === "validating" || job.status === "pending") {
    setStatus(job.statusText || "Working…");
    return;
  }
  if (job.status === "error") {
    setStatus(t("status_failed", job.statusText || "error"), "error");
    return;
  }
  // status === "done"
  state.annotations = (job.annotations || []).map((a) => ({ ...a }));
  const valid = state.annotations.filter((a) => !a.invalid).length;
  const posted = state.annotations.filter((a) => a.posted).length;
  if (posted > 0) {
    // Auto-publish path completed — celebrate.
    setStatus(t("status_done", String(posted)), "success");
    showSuccessToast(posted);
  } else {
    setStatus(t("status_generated", String(state.annotations.length), String(valid)), "success");
  }
  render();
}

$("publishAll").addEventListener("click", async () => {
  const { hypothesisToken } = await getSettings();
  if (!hypothesisToken) { setStatus(t("status_need_token_publish"), "error"); return; }
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
      a.posted = true; a.postedUrl = url; a.selected = false; a.error = null;
    } catch (e) {
      a.error = formatError(e);
    }
    render();
  }
  const ok = state.annotations.filter((a) => a.posted).length;
  setStatus(t("status_done", String(ok)), "success");
  if (ok > 0) showSuccessToast(ok);
});

init();
