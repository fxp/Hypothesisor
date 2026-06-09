import { initI18n, applyI18n, t } from "./lib/i18n.js";
import { loadJob } from "./lib/jobs.js";

await initI18n();
applyI18n();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const jobId = params.get("job");

let job = null;

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMarkdown(s) {
  const paras = String(s).trim().split(/\n\s*\n/);
  return paras.map((p) => {
    const safe = escape(p.replace(/\n/g, " "));
    const withBold = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return `<p>${withBold}</p>`;
  }).join("");
}

async function refresh() {
  job = await loadJob(jobId);
  if (!job) {
    $("empty").hidden = false;
    return;
  }
  $("reviewTitle").textContent = job.sourceTitle || job.sourceHostname || "(untitled)";
  const valid = (job.annotations || []).filter((a) => !a.invalid).length;
  const posted = (job.annotations || []).filter((a) => a.posted).length;
  $("reviewMeta").innerHTML = `${escape(job.sourceHostname || "")} · ${valid} valid · ${posted} published · <a href="${escape(job.sourceUrl)}" target="_blank" rel="noopener">${escape(job.sourceUrl)}</a>`;
  $("openSource").href = job.sourceUrl || "#";
  document.title = `Review: ${job.sourceTitle || "annotations"}`;
  renderList();
}

function renderList() {
  const host = $("list");
  host.innerHTML = "";
  (job.annotations || []).forEach((a, i) => {
    const div = document.createElement("div");
    div.className = "ann" + (a.posted ? " posted" : "") + (a.invalid ? " invalid" : "");
    const check = a.invalid || a.posted
      ? ""
      : `<input type="checkbox" data-i="${i}" ${a.selected ? "checked" : ""}>`;
    const tags = (a.tags || []).map((tag) => `<span class="tag">${escape(tag)}</span>`).join("");
    const meta = a.posted
      ? `<div class="meta">✅ <a href="${escape(a.postedUrl)}" target="_blank">${escape(a.postedUrl)}</a></div>`
      : a.invalid
      ? `<div class="meta">⚠️ ${escape(t("ann_quote_missing"))}</div>`
      : a.error
      ? `<div class="meta" style="color:#BD1C2B">❌ ${escape(a.error)}</div>`
      : "";
    div.innerHTML = `
      <div class="row">${check}<div style="flex:1">
        <div><span class="quote">「${escape(a.quote || "")}」</span></div>
        <div class="comment">${renderMarkdown(a.comment || "")}</div>
        <div class="tags">${tags}</div>
        ${meta}
      </div></div>`;
    host.appendChild(div);
  });
  host.querySelectorAll("input[type=checkbox]").forEach((c) => {
    c.addEventListener("change", (e) => {
      const i = +e.target.dataset.i;
      job.annotations[i].selected = e.target.checked;
      updateCounts();
    });
  });
  updateCounts();
}

function updateCounts() {
  const sel = (job?.annotations || []).filter((a) => a.selected && !a.invalid && !a.posted).length;
  const posted = (job?.annotations || []).filter((a) => a.posted).length;
  const total = (job?.annotations || []).length;
  $("counts").textContent = t("counts_summary", String(sel), String(posted), String(total));
  $("publishBtn").disabled = sel === 0;
}

$("selectAll").addEventListener("click", () => {
  (job?.annotations || []).forEach((a) => { if (!a.invalid && !a.posted) a.selected = true; });
  renderList();
});
$("selectNone").addEventListener("click", () => {
  (job?.annotations || []).forEach((a) => { a.selected = false; });
  renderList();
});

$("publishBtn").addEventListener("click", async () => {
  const indices = (job?.annotations || []).map((a, i) => [a, i])
    .filter(([a]) => a.selected && !a.invalid && !a.posted)
    .map(([, i]) => i);
  if (indices.length === 0) return;
  $("publishBtn").disabled = true;
  $("status").textContent = t("status_publishing", "…");
  $("status").className = "status";
  const r = await chrome.runtime.sendMessage({ type: "publishAnnotations", jobId, indices });
  if (r?.error) {
    $("status").textContent = "Error: " + r.error;
    $("status").className = "status error";
  } else {
    $("status").textContent = t("status_done", String(indices.length));
    $("status").className = "status success";
  }
  await refresh();
});

// Live update — re-render whenever the job's annotations change (e.g.
// per-item posted status during publish).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.jobs) return;
  const updated = (changes.jobs.newValue || []).find((j) => j.id === jobId);
  if (updated) { job = updated; renderList(); }
});

refresh();
