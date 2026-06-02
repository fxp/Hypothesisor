import { initI18n, applyI18n, setLanguage, getCurrentLanguage, t } from "./lib/i18n.js";

await initI18n();

function syncLangToggleLabel() {
  document.getElementById("langToggle").textContent =
    getCurrentLanguage() === "zh_CN" ? "EN" : "中";
}
syncLangToggleLabel();

document.getElementById("langToggle").addEventListener("click", async () => {
  const next = getCurrentLanguage() === "zh_CN" ? "en" : "zh_CN";
  await setLanguage(next);
  renderBigmodelHint();
  syncLangToggleLabel();
});

// The BigModel hint contains an inline link, so it's built imperatively
// (rather than via data-i18n) to keep the URL clickable while text localizes.
const hintHost = document.getElementById("bigmodelHint");
function renderBigmodelHint() {
  if (!hintHost) return;
  hintHost.textContent = "";
  const url = "https://open.bigmodel.cn/usercenter/apikeys";
  const tpl = t("options_hint_bigmodel", `__URL__`);
  const [pre, post = ""] = tpl.split("__URL__");
  hintHost.append(pre);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.textContent = "open.bigmodel.cn/usercenter/apikeys";
  hintHost.appendChild(a);
  hintHost.append(post);
}
renderBigmodelHint();

const FIELDS = ["hypothesisToken", "bigmodelKey", "bigmodelBaseUrl", "bigmodelModel", "defaultMode", "defaultStyle", "genLanguage"];
const BOOL_FIELDS = ["reviewQuality"];

async function load() {
  const s = await chrome.storage.local.get({
    hypothesisToken: "", bigmodelKey: "", bigmodelBaseUrl: "", bigmodelModel: "",
    defaultMode: "general", defaultStyle: "", genLanguage: "auto", reviewQuality: true,
    genTimeoutMs: 180000,
  });
  for (const k of FIELDS) document.getElementById(k).value = s[k];
  for (const k of BOOL_FIELDS) document.getElementById(k).checked = !!s[k];
  document.getElementById("genTimeoutSec").value = Math.round((Number(s.genTimeoutMs) || 180000) / 1000);
}

document.getElementById("save").addEventListener("click", async () => {
  const patch = {};
  for (const k of FIELDS) {
    const el = document.getElementById(k);
    patch[k] = (el.tagName === "SELECT") ? el.value : el.value.trim();
  }
  for (const k of BOOL_FIELDS) patch[k] = document.getElementById(k).checked;
  // Per-job time budget — clamp to [30s, 3600s], persist as ms.
  const sec = Math.max(30, Math.min(3600, Number(document.getElementById("genTimeoutSec").value) || 180));
  patch.genTimeoutMs = sec * 1000;
  await chrome.storage.local.set(patch);
  const status = document.getElementById("status");
  status.textContent = t("options_saved");
  setTimeout(() => (status.textContent = ""), 1500);
});

load();
