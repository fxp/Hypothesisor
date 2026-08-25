import { extractTabText, getSettings } from "./lib/agent.js";
import { initI18n, setLanguage, getCurrentLanguage, t } from "./lib/i18n.js";
import { loadAllJobs } from "./lib/jobs.js";

const $ = (id) => document.getElementById(id);
let state = { tab: null, content: "", activeJobId: null };

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
  $("pageTitle").textContent = tab?.title || t("page_no_title");
  $("pageUrl").textContent = tab?.url || "";

  const s = await getSettings();
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
  const mine = all.filter((j) => j.type === "annotate");
  const sorted = mine.slice().sort((a, b) => {
    const aActive = isActive(a) ? 0 : 1;
    const bActive = isActive(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
  const list = sorted.slice(0, 6);
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
  item.className = `job-item annotate ${statusClass}`.trim();
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

  // Clicking a finished job's row opens its source page so the user
  // can see the annotations layered on by the Hypothesis client.
  if (job.status === "done" && job.sourceUrl) {
    item.classList.add("actionable");
    item.addEventListener("click", () => chrome.tabs.create({ url: job.sourceUrl }));
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
  const list = job.annotations || [];
  const valid = list.filter((a) => !a.invalid).length;
  const posted = list.filter((a) => a.posted).length;
  return posted > 0
    ? t("jobs_subtitle_annotate_posted", String(posted), String(valid))
    : t("jobs_subtitle_annotate_done", String(valid), String(list.length));
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
  refreshJobs();
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

$("generate").addEventListener("click", async () => {
  if (!state.tab) return;
  $("generate").disabled = true;
  setStatus(t("status_fetching"));
  try {
    const extracted = await extractTabText(state.tab.id);
    state.content = extracted.text || "";
    state.canonicalUrl = extracted.url || state.tab.url;
    state.title = extracted.title || state.tab.title || "";
    if (!state.content || state.content.length < 100) throw new Error(t("status_short_content"));
    const { bigmodelKey, hypothesisToken, defaultMode } = await getSettings();

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
      mode: defaultMode || "general",
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
  if (isActive(job)) {
    setStatus(job.statusText || "Working…");
    return;
  }
  if (job.status === "error") {
    setStatus(t("status_failed", job.statusText || "error"), "error");
    return;
  }
  // status === "done" — jump the user back to the source page (with a
  // reload so the Hypothesis client picks up the fresh annotations)
  // and close the popup. If the tab has been closed or navigated, open
  // a fresh one on the source URL.
  const posted = (job.annotations || []).filter((a) => a.posted).length;
  setStatus(t("status_done", String(posted)), "success");
  const url = job.sourceUrl || state.canonicalUrl;
  try {
    if (state.tab?.id) {
      // Refocus + reload the original tab so the overlay is up to date.
      await chrome.tabs.update(state.tab.id, { active: true });
      await chrome.tabs.reload(state.tab.id);
    } else if (url) {
      await chrome.tabs.create({ url });
    }
  } catch (_) {
    if (url) chrome.tabs.create({ url });
  }
  // Small delay so the user sees the "Done" status flash before close.
  setTimeout(() => window.close(), 400);
}

init();
