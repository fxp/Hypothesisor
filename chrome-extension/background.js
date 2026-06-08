// MV3 service worker — runs Annotate and Reformat jobs detached from
// the popup. The popup posts a {type:"startJob", spec} message,
// receives a jobId immediately, and is free to close. The worker
// continues the fetch (which keeps it alive), updates the job record
// in chrome.storage.local on each step, and fires a chrome.notification
// when the job finishes.

import { callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";
import { generateReformat, saveReformat, newId as newReformatId } from "./lib/reformat.js";
import { newJobId, saveJob, loadJob, loadAllJobs } from "./lib/jobs.js";
import { reviewAnnotateOutput, reviewReformatOutput } from "./lib/review.js";

// ─── Startup sweep ──────────────────────────────────────────────────
// MV3 service workers are killed at Chrome's discretion. When the SW
// dies mid-job, any AbortController/setTimeout we set up for the
// per-job time budget dies with it, but the job's status entry in
// chrome.storage stays "running" — and without a fresh run no timer
// will ever fire. So whenever this worker module loads (cold start,
// extension reload, etc.) sweep for orphaned jobs older than the
// configured budget and mark them errored. Run on every SW boot.
sweepStaleJobs().catch(() => {});
migrateSettings().catch(() => {});
chrome.runtime.onStartup?.addListener(() => sweepStaleJobs().catch(() => {}));
chrome.runtime.onInstalled?.addListener(() => { sweepStaleJobs().catch(() => {}); migrateSettings().catch(() => {}); });

// One-shot migration: "bilingual" used to be the default genLanguage. It
// doubles output tokens (each annotation gets a Chinese + English copy)
// and was the #1 cause of slow annotates. Anyone who never visited the
// settings page has it stored by default, not by choice. Flip them to
// "auto" once on next SW boot. Tracked by a sentinel flag so we never
// touch the setting again — if they re-set it to bilingual deliberately
// later, we leave it alone.
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
  // (startJob hasn't been called). So any job in a non-terminal state
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

// ─── Job runner ─────────────────────────────────────────────────────

async function startJob(spec) {
  const id = newJobId();
  const job = {
    id,
    type: spec.type,                    // "annotate" | "reformat"
    status: "pending",
    statusText: "Queued",
    sourceUrl: spec.canonicalUrl,
    sourceTitle: spec.title,
    sourceHostname: safeHost(spec.canonicalUrl),
    tabId: spec.tabId,
    spec,                               // mode/style/format/customPrompt + content
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
  // fetch in this job (LLM call, review pass, postAnnotation, retry) so
  // one setTimeout aborts everything. Default 300 s (5 min) — long-form
  // articles with json_object decoding routinely take 60-180 s on a fast
  // day, and 180 s budget left zero headroom for slow days.
  const timeoutMs = Math.max(30000, Math.min(3600000, Number(settings.genTimeoutMs) || 300000));
  const startedAt = Date.now();
  // Persist startedAt + timeoutMs on the job so the popup can render a
  // live elapsed/budget progress bar even after SW death/restart.
  await update(job.id, {
    status: "running",
    statusText: job.type === "annotate" ? "Generating annotations…" : "Generating Web App…",
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
  // Abort the fetch if we're still running it in this SW.
  const ctrl = jobAborters.get(jobId);
  if (ctrl) ctrl.abort();
  jobAborters.delete(jobId);
  // Mark errored in storage so the popup updates immediately even if
  // the job was orphaned by an earlier SW death.
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

  if (job.type === "annotate") {
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
    await update(job.id, {
      status: "done",
      statusText: `${annotations.length} candidates · ${valid} with valid quotes`,
      annotations,
      finishedAt: Date.now(),
    });
    fireNotification(job.id, "annotate-done", await loadJob(job.id));
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
  } else {
    if (!settings.bigmodelKey) throw withCode("MISSING_BIGMODEL_KEY");
    // Generate-review-retry loop. Up to 3 attempts; retry only when
    // review.overall < threshold and feedback exists. Each retry feeds
    // the previous review's issues + suggestions back into the prompt
    // as `customPrompt` augmentation. We keep the highest-scoring
    // attempt as the final answer.
    // 2 attempts is the speed/quality sweet spot — first pass + at most
    // one refinement. Going to 3 doubled wall-clock time for marginal
    // quality gains. User can hit "Reformat" again if they want more.
    const MAX_ATTEMPTS = 2;
    const MIN_SCORE = 8;
    let bestResult = null;
    let bestReview = null;
    let lastReviewFeedback = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Don't start a fresh attempt we won't have time to finish (10 s buffer).
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
      // If review is disabled, take the first attempt and skip the loop.
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
        // Reviewer failed — take this attempt and stop retrying.
        bestResult = r; bestReview = review; break;
      }
      if (!bestResult || (review.overall || 0) > (bestReview?.overall || 0)) {
        bestResult = r; bestReview = review;
      }
      if (review.overall >= MIN_SCORE || attempt === MAX_ATTEMPTS) break;
      // Build feedback for the next attempt.
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
}

async function publishAnnotations(jobId, indices) {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const settings = await getSettings();
  if (!settings.hypothesisToken) throw withCode("MISSING_HYPOTHESIS_TOKEN");

  const list = (job.annotations || []).slice();
  const targets = indices.filter((i) => list[i] && !list[i].invalid && !list[i].posted);

  let done = 0;
  for (const i of targets) {
    const a = list[i];
    await update(job.id, {
      statusText: `Posting ${done + 1}/${targets.length}: «${truncate(a.quote, 40)}»…`,
    });
    try {
      const r = await postAnnotation({
        url: job.spec.canonicalUrl, title: job.spec.title,
        quote: a.quote, comment: a.comment, tags: a.tags,
        content: job.spec.content, token: settings.hypothesisToken,
      });
      a.posted = true; a.postedUrl = r.url; a.error = null;
    } catch (e) {
      a.error = classifyError(e);
    }
    list[i] = a;
    done++;
    await update(job.id, { annotations: list });
  }
  // Final summary tagged onto whichever status the job already has.
  const posted = list.filter((x) => x.posted).length;
  await update(job.id, { statusText: `Posted ${posted} / ${list.filter((x) => !x.invalid).length}` });
  return { ok: true };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function update(jobId, patch) {
  const job = await loadJob(jobId);
  if (!job) return;
  await saveJob({ ...job, ...patch, updatedAt: Date.now() });
}

// Push a rolling statusText while a long-running fetch is in flight so
// the popup can show "still working" instead of a frozen label.
//
// Pattern: caller invokes this BEFORE the long await, gets back an
// interval id, then clearInterval() in a `finally` after the await.
// The first immediate update happens synchronously (await-able) so the
// new label appears even if the fetch resolves under 8 s.
function startStageHeartbeat(jobId, label) {
  const startedAt = Date.now();
  update(jobId, { statusText: label });   // immediate
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
  } else {
    title = "Web App ready";
    message = `"${truncate(job.reformatTitle || job.sourceTitle || job.sourceHostname, 60)}". Click to open.`;
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
  if (job.type === "reformat" && job.reformatId) {
    // Try to inject overlay on the original tab if it still exists & matches.
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
  } else if (job.type === "annotate") {
    chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?job=${encodeURIComponent(jobId)}`) });
  }
  chrome.notifications.clear(jobId);
});

async function injectOverlayOnTab(tabId, reformatId) {
  // Loaded from background context — import lazily to keep startup fast.
  const { showInPageOverlay } = await import(chrome.runtime.getURL("lib/overlay.js"));
  const { loadReformat, buildIframeSrcdoc } = await import(chrome.runtime.getURL("lib/reformat.js"));
  const r = await loadReformat(reformatId);
  if (!r) throw new Error("Reformat not found");
  const srcdoc = buildIframeSrcdoc(r);
  await showInPageOverlay(tabId, r, srcdoc, { openInTab: "Open in new tab", close: "Close" });
}

function classifyError(e) {
  if (!e) return "Unknown error";
  if (e.code === "TIMEOUT") {
    // Friendly message for the wall-clock per-job budget abort.
    return "Timed out — try increasing the time budget in Options.";
  }
  if (e.name === "AbortError") return "Timed out — try increasing the time budget in Options.";
  if (e.code) return e.code + (e.detail ? ": " + String(e.detail).slice(0, 120) : "");
  return e.message || String(e);
}

function withCode(code) { const e = new Error(code); e.code = code; return e; }
function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function safeHost(url) { try { return new URL(url).hostname; } catch (_) { return ""; } }
