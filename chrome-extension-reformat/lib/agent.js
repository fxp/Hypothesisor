// Reframe-only agent module. Just the page-extraction + settings
// helpers used by popup.js. (lib/reformat.js carries its own LLM
// client, so we don't re-export callGLM here.)

// Extract page text in DOM order. Reused later by reformat.js to feed
// the LLM source content; popup.js calls it once on Generate.
export async function extractTabText(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        function flatten(root) {
          const it = root.ownerDocument.createNodeIterator(root, NodeFilter.SHOW_TEXT);
          let out = "";
          let n;
          while ((n = it.nextNode())) out += n.data;
          return out;
        }
        const article = document.querySelector("article, main, [role='main']");
        const text = flatten(article || document.body);
        const canonicalLink = document.querySelector("link[rel=canonical]")?.href;
        const ogUrl = document.querySelector("meta[property='og:url']")?.getAttribute("content");
        let canonical = canonicalLink || ogUrl || "";
        if (!canonical) {
          const u = new URL(location.href);
          u.hash = "";
          canonical = u.toString();
        }
        return { text, url: canonical, title: document.title || "" };
      },
    });
  } catch (e) {
    // chrome:// / file:// / extension pages / Chrome Web Store — executeScript refuses outright.
    const err = new Error("NOT_SCRIPTABLE");
    err.code = "NOT_SCRIPTABLE";
    err.detail = String(e?.message || e);
    throw err;
  }
  const [{ result } = {}] = results || [];
  return result || { text: "", url: "", title: "" };
}

export async function getSettings() {
  return await chrome.storage.local.get({
    bigmodelKey: "",
    bigmodelBaseUrl: "",
    bigmodelModel: "",
    genLanguage: "auto",     // single-language by default — bilingual doubles output tokens
    reviewQuality: true,     // run a second-pass cheap-model quality scorer after generation
    genTimeoutMs: 300000,    // 5 min per job (default; user-tunable)
  });
}

export async function saveSettings(s) {
  await chrome.storage.local.set(s);
}
