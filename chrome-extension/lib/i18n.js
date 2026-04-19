// User-toggleable i18n that bypasses chrome.i18n's UI-language lock.
// Loads _locales/<lang>/messages.json at runtime, persists the user's
// choice in chrome.storage.local, and re-renders the DOM on switch.
//
// Markup contract:
//   <h1 data-i18n="extName"></h1>
//   <input data-i18n-placeholder="popup_style_placeholder">
//   <a data-i18n-title="popup_settings_title">⚙</a>

const SUPPORTED = ["en", "zh_CN"];
const STORAGE_KEY = "uiLang";

let messages = {};
let currentLang = "en";

function pickFromBrowser() {
  const ui = (chrome.i18n.getUILanguage() || "en").toLowerCase();
  return ui.startsWith("zh") ? "zh_CN" : "en";
}

export async function initI18n() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  const lang = SUPPORTED.includes(stored) ? stored : pickFromBrowser();
  await setLanguage(lang, /* persist */ false);
}

export async function setLanguage(lang, persist = true) {
  if (!SUPPORTED.includes(lang)) lang = "en";
  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  const resp = await fetch(url);
  messages = await resp.json();
  currentLang = lang;
  if (persist) await chrome.storage.local.set({ [STORAGE_KEY]: lang });
  applyI18n();
}

export function getCurrentLanguage() {
  return currentLang;
}

export function getSupportedLanguages() {
  return SUPPORTED.slice();
}

// Resolve a message key with optional positional substitutions.
// Mirrors chrome.i18n.getMessage($N$ placeholders → $1, $2, ...).
export function t(key, ...subs) {
  const entry = messages[key];
  if (!entry) return key;
  let msg = entry.message || "";
  if (entry.placeholders) {
    for (const name in entry.placeholders) {
      const idxStr = String(entry.placeholders[name].content || "$0").slice(1);
      const idx = parseInt(idxStr, 10);
      const value = idx >= 1 && subs[idx - 1] != null ? String(subs[idx - 1]) : "";
      const re = new RegExp("\\$" + name + "\\$", "gi");
      msg = msg.replace(re, value);
    }
  }
  return msg;
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.setAttribute("placeholder", msg);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const msg = t(el.dataset.i18nTitle);
    if (msg) el.setAttribute("title", msg);
  }
  document.documentElement.setAttribute("lang", currentLang === "zh_CN" ? "zh-CN" : "en");
}
