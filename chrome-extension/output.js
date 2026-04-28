import { initI18n, applyI18n, t } from "./lib/i18n.js";
import { loadReformat, buildIframeSrcdoc } from "./lib/reformat.js";

await initI18n();
applyI18n();

const params = new URLSearchParams(location.search);
const id = params.get("id");

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtRelative(ts) {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return t("just_now") || "just now";
  if (diffSec < 3600) return Math.round(diffSec / 60) + " min ago";
  if (diffSec < 86400) return Math.round(diffSec / 3600) + " h ago";
  return new Date(ts).toLocaleDateString();
}

async function main() {
  if (!id) { showEmpty(); return; }
  const r = await loadReformat(id);
  if (!r) { showEmpty(); return; }

  document.title = `${r.title || "Reformat"} · Hypothesisor`;
  const meta = $("topbarMeta");
  meta.textContent = `${(r.appType || r.format || "app").toUpperCase()} · ${fmtRelative(r.createdAt)} · ${new URL(r.sourceUrl).hostname}`;
  $("openSource").href = r.sourceUrl;
  $("regenerate").addEventListener("click", () => {
    chrome.action?.openPopup?.().catch(() => {});
  });

  $("loading").hidden = true;
  $("content").hidden = false;

  // v0.2.2+ writes a `html` field; older saves stored a `blocks` list.
  if (typeof r.html === "string" && r.html.length > 0) {
    renderAsIframe(r);
  } else if (Array.isArray(r.blocks)) {
    renderAsBlocks(r);
  } else {
    showEmpty();
  }
}

function renderAsIframe(r) {
  const host = $("content");
  host.innerHTML = `
    <header class="page-meta">
      <h1>${escapeHtml(r.title)}</h1>
      ${r.summary ? `<p class="summary">${escapeHtml(r.summary)}</p>` : ""}
      <p class="lead">${escapeHtml(r.sourceTitle || "")} · <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(new URL(r.sourceUrl).hostname)}</a></p>
    </header>
    <div class="frame-wrap"></div>
  `;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", r.title || "");
  frame.srcdoc = buildIframeSrcdoc(r);
  host.querySelector(".frame-wrap").appendChild(frame);
}

function renderAsBlocks(r) {
  // Legacy renderer for reformats saved before v0.2.2 (block-list schema).
  const host = $("content");
  function block(b) {
    switch (b.kind) {
      case "heading": {
        const lvl = Math.min(3, Math.max(1, b.level || 2));
        return `<h${lvl}>${escapeHtml(b.text || "")}</h${lvl}>`;
      }
      case "paragraph": return `<p>${escapeHtml(b.text || "")}</p>`;
      case "list": {
        const tag = b.style === "number" ? "ol" : "ul";
        const cls = b.style === "check" ? ` class="checklist"` : "";
        return `<${tag}${cls}>${(b.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</${tag}>`;
      }
      case "qa": {
        return `<div class="qa">${(b.items || []).map((i) =>
          `<div class="qa-item"><p class="qa-q">${escapeHtml(i.q || "")}</p><p class="qa-a">${escapeHtml(i.a || "")}</p></div>`
        ).join("")}</div>`;
      }
      case "card":
        return `<div class="card"><h4 class="card-title">${escapeHtml(b.title || "")}</h4><p class="card-body">${escapeHtml(b.body || "")}</p></div>`;
      case "quote":
        return `<blockquote class="pullquote">${escapeHtml(b.text || "")}</blockquote>`;
      default: return "";
    }
  }
  host.innerHTML = `
    <h1>${escapeHtml(r.title)}</h1>
    <p class="lead">${escapeHtml(r.sourceTitle || "")} · <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(new URL(r.sourceUrl).hostname)}</a></p>
    ${(r.blocks || []).map(block).join("")}
  `;
}

function showEmpty() {
  $("loading").hidden = true;
  $("empty").hidden = false;
}

main().catch((e) => {
  console.error(e);
  $("loading").hidden = true;
  $("empty").hidden = false;
  $("empty").textContent = "Error: " + (e.message || String(e));
});
