import { applyI18n, t } from "./lib/i18n.js";

applyI18n();

// Render the BigModel hint (which contains an inline link) at runtime
// so the URL stays clickable while the surrounding text is localized.
const hintHost = document.getElementById("bigmodelHint");
if (hintHost) {
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

const FIELDS = ["hypothesisToken", "bigmodelKey", "defaultMode", "defaultStyle"];

async function load() {
  const s = await chrome.storage.local.get({
    hypothesisToken: "",
    bigmodelKey: "",
    defaultMode: "general",
    defaultStyle: "",
  });
  for (const k of FIELDS) document.getElementById(k).value = s[k];
}

document.getElementById("save").addEventListener("click", async () => {
  const patch = {};
  for (const k of FIELDS) patch[k] = document.getElementById(k).value.trim();
  await chrome.storage.local.set(patch);
  const status = document.getElementById("status");
  status.textContent = t("options_saved");
  setTimeout(() => (status.textContent = ""), 1500);
});

load();
