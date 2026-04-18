// Tiny DOM i18n helper.
// Walk elements with data-i18n="key" attributes and replace text /
// placeholder / title accordingly. Use:
//   <h1 data-i18n="options_h1"></h1>
//   <input data-i18n-placeholder="popup_style_placeholder">
//   <a data-i18n-title="popup_settings_title">⚙</a>

export const t = (key, ...subs) => chrome.i18n.getMessage(key, subs);

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
  // Translate <html lang> for accessibility / TTS readers.
  const uiLang = chrome.i18n.getUILanguage();
  if (uiLang) document.documentElement.setAttribute("lang", uiLang);
}
