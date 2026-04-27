import { initI18n, applyI18n, t } from "./lib/i18n.js";
import { loadReformat } from "./lib/reformat.js";

await initI18n();
applyI18n();

const params = new URLSearchParams(location.search);
const id = params.get("id");

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderBlock(b) {
  switch (b.kind) {
    case "heading": {
      const lvl = Math.min(3, Math.max(1, b.level || 2));
      return `<h${lvl}>${escapeHtml(b.text || "")}</h${lvl}>`;
    }
    case "paragraph":
      return `<p>${escapeHtml(b.text || "")}</p>`;
    case "list": {
      const tag = b.style === "number" ? "ol" : "ul";
      const cls = b.style === "check" ? ` class="checklist"` : "";
      const items = (b.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      return `<${tag}${cls}>${items}</${tag}>`;
    }
    case "qa": {
      const items = (b.items || []).map((i) =>
        `<div class="qa-item"><p class="qa-q">${escapeHtml(i.q || "")}</p><p class="qa-a">${escapeHtml(i.a || "")}</p></div>`
      ).join("");
      return `<div class="qa">${items}</div>`;
    }
    case "card":
      return `<div class="card"><h4 class="card-title">${escapeHtml(b.title || "")}</h4><p class="card-body">${escapeHtml(b.body || "")}</p></div>`;
    case "quote":
      return `<blockquote class="pullquote">${escapeHtml(b.text || "")}</blockquote>`;
    default:
      return "";
  }
}

function renderBlocks(blocks) {
  // Group consecutive cards into a single grid container.
  const out = [];
  let cardBuf = [];
  function flushCards() {
    if (cardBuf.length) {
      out.push(`<div class="cards">${cardBuf.join("")}</div>`);
      cardBuf = [];
    }
  }
  for (const b of blocks) {
    if (b.kind === "card") cardBuf.push(renderBlock(b));
    else { flushCards(); out.push(renderBlock(b)); }
  }
  flushCards();
  return out.join("");
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
  meta.textContent = `${r.format.toUpperCase()} · ${fmtRelative(r.createdAt)} · ${new URL(r.sourceUrl).hostname}`;
  $("openSource").href = r.sourceUrl;
  $("regenerate").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "regenerateReformat", id }).catch(() => {});
    chrome.action?.openPopup?.().catch(() => {});
  });
  $("loading").hidden = true;
  $("content").hidden = false;
  $("content").innerHTML = `
    <h1>${escapeHtml(r.title)}</h1>
    <p class="lead">${escapeHtml(r.sourceTitle || "")} · <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(new URL(r.sourceUrl).hostname)}</a></p>
    ${renderBlocks(r.blocks || [])}
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
