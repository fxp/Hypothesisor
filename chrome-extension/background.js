// MV3 service worker. Routes a few cross-context actions:
// - "openReformatInTab" from in-page overlay → open output.html?id=…
//   in a new tab (overlay can't open URLs directly via chrome.tabs).
// - "openOptions"        → open the options page.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
