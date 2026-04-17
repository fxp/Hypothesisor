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
  status.textContent = "已保存";
  setTimeout(() => (status.textContent = ""), 1500);
});

load();
