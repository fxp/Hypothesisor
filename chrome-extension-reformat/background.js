// MV3 service worker — runs Reformat (L3) jobs detached from the popup.
// The popup posts a {type:"startJob", spec} message, receives a jobId
// immediately, and is free to close. The worker continues the fetch
// (which keeps it alive), updates the job record in chrome.storage.local
// on each step, and fires a chrome.notification when the job finishes.

import { getSettings } from "./lib/agent.js";
import { generateReformat, saveReformat, newId as newReformatId, loadReformat, buildIframeSrcdoc } from "./lib/reformat.js";
import { newJobId, saveJob, loadJob, loadAllJobs } from "./lib/jobs.js";
import { reviewReformatOutput } from "./lib/review.js";

sweepStaleJobs().catch(() => {});
chrome.runtime.onStartup?.addListener(() => sweepStaleJobs().catch(() => {}));
chrome.runtime.onInstalled?.addListener(() => sweepStaleJobs().catch(() => {}));

async function sweepStaleJobs() {
  const now = Date.now();
  const all = await loadAllJobs();
  for (const j of all) {
    if (j.status !== "running" && j.status !== "validating" && j.status !== "pending") continue;
    const startedAt = j.createdAt || j.updatedAt || now;
    const ageMs = now - startedAt;
    await saveJob({
      ...j,
      status: "error",
      statusText: `Interrupted — service worker restarted before completion (${Math.round(ageMs / 60000)} min)`,
      finishedAt: now,
    });
  }
}

const jobAborters = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "startJob") {
    startJob(msg.spec).then(
      (jobId) => sendResponse({ jobId }),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
    return true;
  }
  if (msg?.type === "cancelJob" && msg.jobId) {
    cancelJob(msg.jobId).then(
      (r) => sendResponse(r),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
    return true;
  }
  if (msg?.type === "openReformatInTab" && msg.id) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`output.html?id=${encodeURIComponent(msg.id)}`) });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

async function startJob(spec) {
  const id = newJobId();
  const job = {
    id,
    type: "reformat",
    status: "pending",
    statusText: "Queued",
    sourceUrl: spec.canonicalUrl,
    sourceTitle: spec.title,
    sourceHostname: safeHost(spec.canonicalUrl),
    tabId: spec.tabId,
    spec,
    createdAt: Date.now(),
  };
  await saveJob(job);
  runJob(job).catch(async (err) => {
    await saveJob({ ...(await loadJob(id)), status: "error", statusText: classifyError(err), finishedAt: Date.now() });
    fireNotification(id, "error", await loadJob(id));
  });
  return id;
}

async function runJob(job) {
  const settings = await getSettings();
  const timeoutMs = Math.max(30000, Math.min(3600000, Number(settings.genTimeoutMs) || 300000));
  const startedAt = Date.now();
  await update(job.id, {
    status: "running",
    statusText: "Generating Web App…",
    startedAt,
    timeoutMs,
  });
  const ctrl = new AbortController();
  const deadline = startedAt + timeoutMs;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  jobAborters.set(job.id, ctrl);
  try {
    return await runJobInner(job, settings, ctrl.signal, deadline);
  } finally {
    clearTimeout(timer);
    jobAborters.delete(job.id);
  }
}

async function cancelJob(jobId) {
  const ctrl = jobAborters.get(jobId);
  if (ctrl) ctrl.abort();
  jobAborters.delete(jobId);
  const job = await loadJob(jobId);
  if (!job) return { ok: false, reason: "not_found" };
  if (job.status === "done" || job.status === "error") return { ok: true, alreadyTerminal: true };
  await saveJob({
    ...job,
    status: "error",
    statusText: "Cancelled by user",
    finishedAt: Date.now(),
  });
  return { ok: true };
}

async function runJobInner(job, settings, signal, deadline) {
  if (!settings.bigmodelKey) throw withCode("MISSING_BIGMODEL_KEY");

  // Generate-review-retry loop. Up to 2 attempts; retry only when
  // review.overall < threshold and feedback exists.
  const MAX_ATTEMPTS = 2;
  const MIN_SCORE = 8;
  let bestResult = null;
  let bestReview = null;
  let lastReviewFeedback = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() > deadline - 10000) break;
    await update(job.id, { status: "running", attempt });
    const genLabel = attempt === 1
      ? "Calling GLM — generating Web App…"
      : `Refining attempt ${attempt}/${MAX_ATTEMPTS} — calling GLM…`;
    const hbGen = startStageHeartbeat(job.id, genLabel);
    const augmentedHint = attempt === 1
      ? job.spec.customPrompt
      : (job.spec.customPrompt ? job.spec.customPrompt + "\n\n" : "") + lastReviewFeedback;
    let r;
    try {
      r = await generateReformat({
        content: job.spec.content, url: job.spec.canonicalUrl, title: job.spec.title,
        customPrompt: augmentedHint,
        apiKey: settings.bigmodelKey, baseUrl: settings.bigmodelBaseUrl, model: settings.bigmodelModel,
        genLanguage: settings.genLanguage,
        signal,
      });
    } finally {
      clearInterval(hbGen);
    }
    if (settings.reviewQuality === false) {
      bestResult = r; bestReview = null; break;
    }
    await update(job.id, { status: "validating" });
    const hbRev = startStageHeartbeat(job.id, `Reviewing quality (attempt ${attempt}/${MAX_ATTEMPTS})…`);
    const tempReformat = {
      title: r.title, summary: r.summary, appType: r.appType,
      a2ui: r.a2ui, html: r.html,
    };
    let review = null;
    try {
      review = await reviewReformatOutput({
        content: job.spec.content, reformat: tempReformat,
        apiKey: settings.bigmodelKey, baseUrl: settings.bigmodelBaseUrl,
        signal,
      });
    } catch (_) {}
    clearInterval(hbRev);
    if (!review || review.error) {
      bestResult = r; bestReview = review; break;
    }
    if (!bestResult || (review.overall || 0) > (bestReview?.overall || 0)) {
      bestResult = r; bestReview = review;
    }
    if (review.overall >= MIN_SCORE || attempt === MAX_ATTEMPTS) break;
    const issues = (review.issues || []).slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n");
    lastReviewFeedback =
      `【上一轮质量评审 ${review.overall}/10，请改进以下问题再生成】\n` +
      (issues ? issues + "\n" : "") +
      (review.suggestions ? `\n建议：${review.suggestions}` : "");
  }

  const reformatId = newReformatId();
  const reformat = {
    id: reformatId, createdAt: Date.now(),
    sourceUrl: job.spec.canonicalUrl, sourceTitle: job.spec.title,
    customPrompt: job.spec.customPrompt || undefined,
    title: bestResult.title, summary: bestResult.summary,
    appType: bestResult.appType,
    a2ui: bestResult.a2ui, html: bestResult.html,
    truncated: bestResult.truncated,
    review: bestReview || undefined,
  };
  await saveReformat(reformat);
  await update(job.id, {
    status: "done",
    statusText: bestReview ? `Web App ready · quality ${bestReview.overall}/10` : "Web App ready",
    reformatId,
    reformatTitle: bestResult.title,
    reformatAppType: bestResult.appType,
    truncated: bestResult.truncated || false,
    review: bestReview || undefined,
    finishedAt: Date.now(),
  });
  fireNotification(job.id, "reformat-done", await loadJob(job.id));
}

async function update(jobId, patch) {
  const job = await loadJob(jobId);
  if (!job) return;
  await saveJob({ ...job, ...patch, updatedAt: Date.now() });
}

function startStageHeartbeat(jobId, label) {
  const startedAt = Date.now();
  update(jobId, { statusText: label });
  return setInterval(async () => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    let suffix = "";
    if (sec >= 120) suffix = ` · ${sec}s — long article, GLM still working`;
    else if (sec >= 60) suffix = ` · ${sec}s — still working, hang tight`;
    else if (sec >= 20) suffix = ` · ${sec}s elapsed`;
    await update(jobId, { statusText: label + suffix });
  }, 8000);
}

function fireNotification(jobId, kind, job) {
  if (!job) return;
  let title, message;
  if (kind === "error") {
    title = "Reframe — failed";
    message = `${job.sourceTitle || job.sourceHostname}: ${job.statusText}`;
  } else if (kind === "reformat-done") {
    title = "Web App ready";
    message = `"${truncate(job.reformatTitle || job.sourceTitle || job.sourceHostname, 60)}". Click to open.`;
  } else {
    return;
  }
  chrome.notifications.create(jobId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (jobId) => {
  const job = await loadJob(jobId);
  if (!job) return;
  if (job.reformatId) {
    let injected = false;
    try {
      if (job.tabId) {
        const tab = await chrome.tabs.get(job.tabId).catch(() => null);
        if (tab && tab.url === job.sourceUrl) {
          await chrome.tabs.update(job.tabId, { active: true });
          await injectOverlayOnTab(job.tabId, job.reformatId);
          injected = true;
        }
      }
    } catch (_) {}
    if (!injected) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`output.html?id=${encodeURIComponent(job.reformatId)}`) });
    }
  }
  chrome.notifications.clear(jobId);
});

async function injectOverlayOnTab(tabId, reformatId) {
  const { showInPageOverlay } = await import(chrome.runtime.getURL("lib/overlay.js"));
  const r = await loadReformat(reformatId);
  if (!r) throw new Error("Reformat not found");
  const srcdoc = buildIframeSrcdoc(r);
  await showInPageOverlay(tabId, r, srcdoc, { openInTab: "Open in new tab", close: "Close" });
}

function classifyError(e) {
  if (!e) return "Unknown error";
  if (e.code === "TIMEOUT") return "Timed out — try increasing the time budget in Options.";
  if (e.name === "AbortError") return "Timed out — try increasing the time budget in Options.";
  if (e.code) return e.code + (e.detail ? ": " + String(e.detail).slice(0, 120) : "");
  return e.message || String(e);
}

function withCode(code) { const e = new Error(code); e.code = code; return e; }
function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function safeHost(url) { try { return new URL(url).hostname; } catch (_) { return ""; } }
