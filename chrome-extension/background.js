// MV3 service worker — runs Annotate jobs detached from the popup. The
// popup posts a {type:"startJob", spec} message, receives a jobId
// immediately, and is free to close. The worker continues the fetch
// (which keeps it alive), updates the job record in chrome.storage.local
// on each step, and fires a chrome.notification when the job finishes.
//
// Annotate-only. The page-reformat path lives in a separate extension
// (chrome-extension-reformat / Reframe).

import { callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";
import { newJobId, saveJob, loadJob, loadAllJobs } from "./lib/jobs.js";
import { reviewAnnotateOutput } from "./lib/review.js";

// ─── Startup sweep + migrations ─────────────────────────────────────
sweepStaleJobs().catch(() => {});
migrateSettings().catch(() => {});
chrome.runtime.onStartup?.addListener(() => sweepStaleJobs().catch(() => {}));
chrome.runtime.onInstalled?.addListener(() => { sweepStaleJobs().catch(() => {}); migrateSettings().catch(() => {}); });

// One-shot migration: bilingual was once the default genLanguage. It
// doubles output tokens (each annotation gets a Chinese + English copy)
// and was the #1 cause of slow annotates. Flip stored "bilingual" to
// "auto" once. Tracked by a sentinel so we never touch a deliberate
// re-set.
async function migrateSettings() {
  const SENTINEL = "mig_v0.4.9_bilingual_default";
  const got = await chrome.storage.local.get([SENTINEL, "genLanguage"]);
  if (got[SENTINEL]) return;
  if (got.genLanguage === "bilingual") {
    await chrome.storage.local.set({ genLanguage: "auto" });
  }
  await chrome.storage.local.set({ [SENTINEL]: 1 });
}

async function sweepStaleJobs() {
  // At SW module-init time the new worker is not running anything yet
  // (startJob hasn't been called). Any job in a non-terminal state
  // belonged to a previous, now-dead SW. Reap unconditionally — we'd
  // never recover an in-flight fetch across an SW restart anyway.
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

// ─── Message routing ────────────────────────────────────────────────

// Track AbortControllers for in-flight jobs so cancelJob can abort
// fetches immediately instead of waiting for the per-job timeout.
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
  if (msg?.type === "publishAnnotations") {
    publishAnnotations(msg.jobId, msg.indices).then(
      (r) => sendResponse(r),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
    return true;
  }
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

// ─── Job runner ─────────────────────────────────────────────────────

async function startJob(spec) {
  const id = newJobId();
  const job = {
    id,
    type: "annotate",
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
  // Don't await — return id immediately so popup can close.
  runJob(job).catch(async (err) => {
    await saveJob({ ...(await loadJob(id)), status: "error", statusText: classifyError(err), finishedAt: Date.now() });
    fireNotification(id, "error", await loadJob(id));
  });
  return id;
}

async function runJob(job) {
  const settings = await getSettings();
  // Per-job wall-clock budget. Single AbortController shared across every
  // fetch in this job (LLM call, review pass, postAnnotation) so one
  // setTimeout aborts everything. Default 300 s (5 min).
  const timeoutMs = Math.max(30000, Math.min(3600000, Number(settings.genTimeoutMs) || 300000));
  const startedAt = Date.now();
  await update(job.id, {
    status: "running",
    statusText: "Generating annotations…",
    startedAt,
    timeoutMs,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  jobAborters.set(job.id, ctrl);
  try {
    return await runJobInner(job, settings, ctrl.signal);
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

async function runJobInner(job, settings, signal) {
  if (!settings.bigmodelKey) throw withCode("MISSING_BIGMODEL_KEY");
  if (!settings.hypothesisToken) throw withCode("MISSING_HYPOTHESIS_TOKEN");

  const hb1 = startStageHeartbeat(job.id, "Calling GLM — generating annotation candidates…");
  let raw;
  try {
    raw = await callGLM({
      content: job.spec.content, url: job.spec.canonicalUrl,
      mode: job.spec.mode, style: job.spec.style,
      apiKey: settings.bigmodelKey, baseUrl: settings.bigmodelBaseUrl, model: settings.bigmodelModel,
      genLanguage: settings.genLanguage,
      signal,
    });
  } finally {
    clearInterval(hb1);
  }
  await update(job.id, { status: "validating", statusText: `Validating ${raw.length} quotes against page text…` });
  const annotations = raw.map((a) => {
    const q = (a.quote || "").trim();
    const ok = validateQuote(job.spec.content, q).found;
    return {
      quote: q,
      comment: (a.comment || "").trim(),
      tags: Array.isArray(a.tags) ? a.tags : [],
      selected: ok,
      invalid: !ok,
    };
  });
  const valid = annotations.filter((a) => !a.invalid).length;

  // Auto-publish (default): post every quote-validated candidate
  // straight to Hypothesis. Job stays "running" through the publish loop
  // so the popup keeps showing the spinner + per-item statusText. Users
  // can opt out via settings.autoPublish = false.
  const wantsAutoPublish = settings.autoPublish !== false && valid > 0 && !!settings.hypothesisToken;
  if (wantsAutoPublish) {
    await update(job.id, {
      status: "running",
      statusText: `Publishing ${valid} annotation${valid === 1 ? "" : "s"}…`,
      annotations,
    });
    const validIndices = annotations.map((a, i) => (a.invalid ? -1 : i)).filter((i) => i >= 0);
    await runPublishLoop(job.id, validIndices, settings, signal, annotations);
    const finalJob = await loadJob(job.id);
    const finalList = finalJob.annotations || annotations;
    const posted = finalList.filter((x) => x.posted).length;
    await update(job.id, {
      status: "done",
      statusText: `Posted ${posted} / ${valid}`,
      finishedAt: Date.now(),
    });
    fireNotification(job.id, "annotate-published", await loadJob(job.id));
  } else {
    // Manual mode: surface the candidates and wait for the popup's
    // "Publish selected" click.
    await update(job.id, {
      status: "done",
      statusText: `${annotations.length} candidates · ${valid} with valid quotes`,
      annotations,
      finishedAt: Date.now(),
    });
    fireNotification(job.id, "annotate-done", await loadJob(job.id));
  }

  // Quality review (cheap, async — doesn't block notification).
  if (settings.reviewQuality !== false) {
    reviewAnnotateOutput({
      content: job.spec.content, annotations,
      apiKey: settings.bigmodelKey,
      baseUrl: settings.bigmodelBaseUrl,
      signal,
    }).then((review) => review && update(job.id, { review }))
      .catch(() => {});
  }
}

async function publishAnnotations(jobId, indices) {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const settings = await getSettings();
  if (!settings.hypothesisToken) throw withCode("MISSING_HYPOTHESIS_TOKEN");
  const list = (job.annotations || []).slice();
  await runPublishLoop(jobId, indices, settings, /* signal */ undefined, list);
  const finalJob = await loadJob(jobId);
  const finalList = finalJob.annotations || list;
  const posted = finalList.filter((x) => x.posted).length;
  await update(jobId, { statusText: `Posted ${posted} / ${finalList.filter((x) => !x.invalid).length}` });
  return { ok: true };
}

// Shared posting loop used by both auto-publish (inside runJobInner) and
// the manual "Publish selected" path. Iterates targets, writes per-item
// statusText, persists each result back into the job record.
async function runPublishLoop(jobId, indices, settings, signal, list) {
  const job = await loadJob(jobId);
  const targets = indices.filter((i) => list[i] && !list[i].invalid && !list[i].posted);
  let done = 0;
  for (const i of targets) {
    if (signal?.aborted) break;
    const a = list[i];
    await update(jobId, {
      statusText: `Posting ${done + 1}/${targets.length}: «${truncate(a.quote, 40)}»…`,
    });
    try {
      const r = await postAnnotation({
        url: job.spec.canonicalUrl, title: job.spec.title,
        quote: a.quote, comment: a.comment, tags: a.tags,
        content: job.spec.content, token: settings.hypothesisToken,
        signal,
      });
      a.posted = true; a.postedUrl = r.url; a.error = null;
    } catch (e) {
      a.error = classifyError(e);
    }
    list[i] = a;
    done++;
    await update(jobId, { annotations: list });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

async function update(jobId, patch) {
  const job = await loadJob(jobId);
  if (!job) return;
  await saveJob({ ...job, ...patch, updatedAt: Date.now() });
}

// Push a rolling statusText while a long-running fetch is in flight so
// the popup can show "still working" instead of a frozen label. Call
// BEFORE the long await, clearInterval() in a `finally` after.
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
    title = "Hypothesisor — failed";
    message = `${job.sourceTitle || job.sourceHostname}: ${job.statusText}`;
  } else if (kind === "annotate-done") {
    const valid = (job.annotations || []).filter((a) => !a.invalid).length;
    title = "Annotations ready";
    message = `${valid} candidates from "${truncate(job.sourceTitle || job.sourceHostname, 60)}". Click to review and publish.`;
  } else if (kind === "annotate-published") {
    const list = job.annotations || [];
    const posted = list.filter((a) => a.posted).length;
    const valid = list.filter((a) => !a.invalid).length;
    title = "Annotations published";
    message = `${posted} / ${valid} posted to Hypothesis from "${truncate(job.sourceTitle || job.sourceHostname, 60)}". Click to view on the page.`;
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
  // Open the source page so the Hypothesis client can overlay the
  // posted annotations. Users without the Hypothesis browser extension
  // can find their account view at https://hypothes.is/users/<account>.
  if (job.sourceUrl) chrome.tabs.create({ url: job.sourceUrl });
  chrome.notifications.clear(jobId);
});

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
