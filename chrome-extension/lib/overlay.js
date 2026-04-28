// L3 in-page overlay: inject a Shadow-DOM modal into the active tab
// and host the generated Web App inside a sandboxed iframe. Closing
// the overlay leaves the underlying page completely untouched.

// `chrome.scripting.executeScript` cannot reach outer-scope variables,
// so we serialize the reformat payload + i18n strings as `args` and
// reconstruct everything inside the injected function.

export async function showInPageOverlay(tabId, reformat, srcdoc, labels) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: injectOverlay,
    args: [{ reformat, srcdoc, labels }],
  });
}

// Runs in the page context. Must be self-contained.
function injectOverlay(payload) {
  const { reformat, srcdoc, labels } = payload;

  // Remove any prior overlay first.
  document.getElementById("hypothesisor-overlay-root")?.remove();

  const host = document.createElement("div");
  host.id = "hypothesisor-overlay-root";
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: auto;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, 0.62);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: ho-fade-in 180ms ease-out;
    }
    .panel {
      position: fixed; inset: 24px;
      display: flex; flex-direction: column;
      background: #ffffff; border-radius: 14px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
      animation: ho-slide 240ms cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      font: 14px/1.5 -apple-system, "Helvetica Neue", system-ui, "PingFang SC", sans-serif;
      color: #0f172a;
    }
    @media (min-width: 1100px) {
      .panel { inset: 36px max(36px, calc((100vw - 1100px) / 2)); }
    }
    .topbar {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 20px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      flex-shrink: 0;
    }
    .brand-chip {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: #2563EB; color: white;
      font-weight: 800; font-size: 14px; letter-spacing: -0.5px;
      flex-shrink: 0;
    }
    .titles { flex: 1; min-width: 0; }
    .title-line {
      font-size: 14px; font-weight: 600; color: #0f172a;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .summary-line {
      font-size: 12.5px; color: #64748b; margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .app-type {
      display: inline-flex; align-items: center; padding: 3px 9px;
      background: rgba(37, 99, 235, 0.1); color: #2563EB;
      border-radius: 999px; font-size: 11px; font-weight: 700;
      letter-spacing: 0.4px; text-transform: uppercase;
      margin-right: 8px; flex-shrink: 0;
    }
    .actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .icon-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; cursor: pointer;
      color: #64748b; border-radius: 7px;
      font-size: 16px; line-height: 1;
      transition: background 0.15s, color 0.15s;
      font-family: inherit;
    }
    .icon-btn:hover { background: #e2e8f0; color: #0f172a; }
    .frame-wrap { flex: 1; background: white; }
    iframe {
      width: 100%; height: 100%;
      border: none; background: white;
    }
    @keyframes ho-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ho-slide   { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  shadow.appendChild(styleEl);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const panel = document.createElement("div");
  panel.className = "panel";

  const safeTitle = String(reformat.title || "").slice(0, 200);
  const safeSummary = String(reformat.summary || "").slice(0, 240);
  const safeAppType = String(reformat.appType || "app").slice(0, 24).toUpperCase();

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div class="brand-chip">h.</div>
    <div class="titles">
      <div class="title-line"><span class="app-type"></span><span class="title-text"></span></div>
      <div class="summary-line"></div>
    </div>
    <div class="actions">
      <button class="icon-btn" data-action="open-tab" title="${escapeAttr(labels.openInTab)}">↗</button>
      <button class="icon-btn" data-action="close" title="${escapeAttr(labels.close)}">✕</button>
    </div>
  `;
  topbar.querySelector(".app-type").textContent = safeAppType;
  topbar.querySelector(".title-text").textContent = safeTitle;
  topbar.querySelector(".summary-line").textContent = safeSummary;

  const frameWrap = document.createElement("div");
  frameWrap.className = "frame-wrap";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("title", safeTitle);
  iframe.srcdoc = srcdoc;
  frameWrap.appendChild(iframe);

  panel.appendChild(topbar);
  panel.appendChild(frameWrap);

  shadow.appendChild(backdrop);
  shadow.appendChild(panel);

  function close() { host.remove(); document.removeEventListener("keydown", onKey, true); }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

  backdrop.addEventListener("click", close);
  topbar.querySelector('[data-action="close"]').addEventListener("click", close);
  topbar.querySelector('[data-action="open-tab"]').addEventListener("click", () => {
    // Ask the extension to open this reformat in a new tab.
    chrome.runtime?.sendMessage?.({ type: "openReformatInTab", id: reformat.id }).catch(() => {});
    close();
  });
  document.addEventListener("keydown", onKey, true);

  function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
}
