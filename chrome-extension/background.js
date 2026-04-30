// MV3 service worker — runs Annotate and Reformat jobs detached from
// the popup. The popup posts a {type:"startJob", spec} message,
// receives a jobId immediately, and is free to close. The worker
// continues the fetch (which keeps it alive), updates the job record
// in chrome.storage.local on each step, and fires a chrome.notification
// when the job finishes.

import { callGLM, validateQuote, postAnnotation, getSettings } from "./lib/agent.js";
import { generateReformat, saveReformat, newId as newReformatId } from "./lib/reformat.js";
import { newJobId, saveJob, loadJob } from "./lib/jobs.js";

// ─── Message routing ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "startJob") {
    startJob(msg.spec).then(
      (jobId) => sendResponse({ jobId }),
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
  await update(job.id, { status: "running", statusText: job.type === "annotate" ? "Generating annotations…" : "Generating Web App…" });
  const settings = await getSettings();

  if (job.type === "annotate") {
    if (!settings.bigmodelKey) throw withCode("MISSING_BIGMODEL_KEY");
    if (!settings.hypothesisToken) throw withCode("MISSING_HYPOTHESIS_TOKEN");
    const raw = await callGLM({
      content: job.spec.content, url: job.spec.canonicalUrl,
      mode: job.spec.mode, style: job.spec.style,
      apiKey: settings.bigmodelKey, baseUrl: settings.bigmodelBaseUrl, model: settings.bigmodelModel,
    });
    await update(job.id, { status: "validating", statusText: "Validating quotes…" });
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
  } else {
    if (!settings.bigmodelKey) throw withCode("MISSING_BIGMODEL_KEY");
    const result = await generateReformat({
      content: job.spec.content, url: job.spec.canonicalUrl, title: job.spec.title,
      format: job.spec.format, customPrompt: job.spec.customPrompt,
      apiKey: settings.bigmodelKey, baseUrl: settings.bigmodelBaseUrl, model: settings.bigmodelModel,
    });
    const reformatId = newReformatId();
    const reformat = {
      id: reformatId, createdAt: Date.now(),
      sourceUrl: job.spec.canonicalUrl, sourceTitle: job.spec.title,
      format: job.spec.format, customPrompt: job.spec.customPrompt || undefined,
      title: result.title, summary: result.summary,
      appType: result.appType, html: result.html,
    };
    await saveReformat(reformat);
    await update(job.id, {
      status: "done",
      statusText: "Web App ready",
      reformatId,
      reformatTitle: result.title,
      reformatAppType: result.appType,
      truncated: result.truncated || false,
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

  for (const i of targets) {
    const a = list[i];
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
    await update(job.id, { annotations: list });
  }
  return { ok: true };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function update(jobId, patch) {
  const job = await loadJob(jobId);
  if (!job) return;
  await saveJob({ ...job, ...patch, updatedAt: Date.now() });
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
  if (e.code) return e.code + (e.detail ? ": " + String(e.detail).slice(0, 120) : "");
  return e.message || String(e);
}

function withCode(code) { const e = new Error(code); e.code = code; return e; }
function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function safeHost(url) { try { return new URL(url).hostname; } catch (_) { return ""; } }
