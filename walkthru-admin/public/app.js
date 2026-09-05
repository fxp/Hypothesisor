const $ = (id) => document.getElementById(id);
const KINDS = ["context", "claim", "evidence", "insight", "caveat", "conclusion"];
const KIND_LABELS = { context: "背景", claim: "论点", evidence: "证据", insight: "洞见", caveat: "警惕", conclusion: "小结" };

// state.pack mirrors what will be published: {intro, essay, outro, steps, sourceTitle, sourceUrl, author, variant, variantLabel, ...}
let state = { pageUrl: "", hash: "", variant: "", outDir: null, pack: null, isNew: false };

// ─── lookup ───────────────────────────────────────────────────────────

$("lookupBtn").addEventListener("click", doLookup);
$("lookupUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") doLookup(); });

async function doLookup() {
  const url = $("lookupUrl").value.trim();
  if (!url) return;
  $("genTitle").dataset.autofillUrl = url;
  const hashResp = await fetchJson(`/api/hash?url=${encodeURIComponent(url)}`);
  $("hashLine").hidden = false;
  $("hashLine").textContent = `hash: ${hashResp.hash}  |  normalized: ${hashResp.normalizedUrl}`;

  const results = $("lookupResults");
  results.innerHTML = "";
  $("lookupEmpty").hidden = true;

  let data;
  try {
    data = await fetchJson(`/api/lookup?url=${encodeURIComponent(url)}`);
  } catch (e) {
    results.innerHTML = `<div class="muted">查找失败：${escapeHtml(e.message)}</div>`;
    return;
  }
  if (!data.packs.length) { $("lookupEmpty").hidden = false; return; }

  for (const pack of data.packs) {
    const card = document.createElement("div");
    card.className = "pack-card";
    const stepsCount = Array.isArray(pack.steps) ? pack.steps.length : 0;
    card.innerHTML = `
      <div class="pack-info">
        <div class="pack-label">${escapeHtml(pack.variantLabel || pack.variant)} <span class="muted small">(${escapeHtml(pack.variant)})</span></div>
        <div class="pack-meta">${stepsCount} 步 · v${pack.contentVersion || 1} · ${escapeHtml(pack.sourceTitle || "")}</div>
      </div>
      <button type="button" class="btn small edit-btn">编辑</button>
      <button type="button" class="btn small danger delete-btn">删除</button>
    `;
    card.querySelector(".edit-btn").addEventListener("click", () => loadIntoEditor(url, pack, null));
    card.querySelector(".delete-btn").addEventListener("click", () => deletePack(pack.variant, card));
    results.appendChild(card);
  }
}

async function deletePack(variant, cardEl) {
  if (!confirm(`确定删除 variant "${variant}" 吗？这个操作不可逆。`)) return;
  try {
    const resp = await fetch("/api/pack", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: state.hash || (await fetchJson(`/api/hash?url=${encodeURIComponent($("lookupUrl").value.trim())}`)).hash, variant }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    cardEl.remove();
  } catch (e) {
    alert("删除失败：" + e.message);
  }
}

// ─── image row builder (generate panel) ────────────────────────────────

$("addImageBtn").addEventListener("click", addImageRow);

function addImageRow() {
  const row = document.createElement("div");
  row.className = "image-row";
  row.innerHTML = `
    <img class="thumb" alt="" />
    <input type="file" accept="image/*" class="img-file" />
    <input type="text" class="img-selector" placeholder="CSS selector，例如 img[src*=&quot;abc123&quot;]" />
    <input type="text" class="img-alt" placeholder="图片说明（给视觉模型看的参考文字，可留空）" />
    <input type="text" class="img-anchor" placeholder="图片附近的一段原文（用来定位插入位置，强烈建议填）" />
    <div class="image-row-actions"><button type="button" class="btn small danger remove-img-btn">移除这张图</button></div>
  `;
  row.querySelector(".remove-img-btn").addEventListener("click", () => row.remove());
  const fileInput = row.querySelector(".img-file");
  const thumb = row.querySelector(".thumb");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { thumb.src = reader.result; row.dataset.dataUrl = reader.result; };
    reader.readAsDataURL(file);
  });
  $("imagesList").appendChild(row);
}

function collectImages() {
  return Array.from($("imagesList").querySelectorAll(".image-row")).map((row) => ({
    dataUrl: row.dataset.dataUrl || "",
    selector: row.querySelector(".img-selector").value.trim(),
    alt: row.querySelector(".img-alt").value.trim(),
    anchorQuote: row.querySelector(".img-anchor").value.trim(),
  })).filter((img) => img.dataUrl && img.selector);
}

// ─── generate ───────────────────────────────────────────────────────

$("genText").addEventListener("input", () => {
  $("genTextLen").textContent = `${$("genText").value.length} 字符`;
});
$("genMode").addEventListener("change", () => {
  $("chaptersField").style.display = $("genMode").value === "deep" ? "" : "none";
});
$("chaptersField").style.display = "none";

$("generateBtn").addEventListener("click", doGenerate);

async function doGenerate() {
  const url = $("lookupUrl").value.trim();
  const title = $("genTitle").value.trim();
  const text = $("genText").value;
  if (!url) { alert("先在上面填文章 URL"); return; }
  if (text.length < 200) { alert("正文太短（至少 200 字符）"); return; }

  const mode = $("genMode").value;
  const body = {
    url, title, text,
    author: $("genAuthor").value.trim(),
    lang: $("genLang").value,
    tts: $("genTts").checked,
    images: collectImages(),
  };
  if (mode === "deep") body.chapters = Number($("genChapters").value) || 4;

  const logEl = $("genLog");
  logEl.hidden = false;
  logEl.textContent = "";
  $("generateBtn").disabled = true;

  try {
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await streamNdjson(resp, (evt) => {
      if (evt.type === "log") {
        logEl.textContent += evt.text + "\n";
        logEl.scrollTop = logEl.scrollHeight;
      } else if (evt.type === "done") {
        logEl.textContent += "\n✅ 生成完成\n";
        loadIntoEditor(url, evt.pack, evt.outDir);
      } else if (evt.type === "error") {
        logEl.textContent += "\n❌ " + evt.message + "\n";
      }
    });
  } catch (e) {
    logEl.textContent += "\n❌ " + e.message + "\n";
  } finally {
    $("generateBtn").disabled = false;
  }
}

// ─── editor ───────────────────────────────────────────────────────────

function loadIntoEditor(pageUrl, pack, outDir) {
  state = { pageUrl, hash: null, variant: pack.variant, outDir, pack: JSON.parse(JSON.stringify(pack)) };
  fetchJson(`/api/hash?url=${encodeURIComponent(pageUrl)}`).then((h) => { state.hash = h.hash; });

  $("editorPanel").hidden = false;
  $("editorMeta").textContent = `${pack.sourceTitle || pageUrl}  ·  variant: ${pack.variant}  (${pack.variantLabel || ""})`;
  $("editIntro").value = pack.intro || "";
  $("editEssay").value = pack.essay || "";
  $("editOutro").value = pack.outro || "";
  $("deleteBtn").hidden = false;
  renderSteps();
  $("editorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSteps() {
  const host = $("stepsList");
  host.innerHTML = "";
  state.pack.steps.forEach((step, i) => host.appendChild(renderStepCard(step, i)));
}

function renderStepCard(step, i) {
  const isImage = step.type === "image";
  const isNew = !!step.__isNew;
  const card = document.createElement("div");
  card.className = "step-card";
  card.innerHTML = `
    <div class="step-head">
      <span class="step-index">#${i + 1}</span>
      <span class="step-kind ${isImage ? "image" : ""}">${isImage ? "图片" : ""}${isNew ? " 新增" : ""}</span>
      <div class="step-actions">
        <button type="button" class="btn small up-btn" title="上移">↑</button>
        <button type="button" class="btn small down-btn" title="下移">↓</button>
        <button type="button" class="btn small danger del-btn" title="删除">删除</button>
      </div>
    </div>
    <select class="kind-select"></select>
    <input type="text" class="title-input" placeholder="小标题" value="${escapeAttr(step.title || "")}" />
    <textarea class="narration-input" rows="2" placeholder="讲解词">${escapeHtml(step.narration || "")}</textarea>
    ${isImage
      ? `<div class="step-quote">selector: ${escapeHtml(step.imageSelector || "")}${step.region ? `<br/>region: [${step.region.box?.join(", ") || "—"}]` : ""}</div>
         ${step.region ? `<input type="text" class="region-exp-input" placeholder="子区域说明" value="${escapeAttr(step.region.explanation || "")}" />` : ""}`
      : isNew
        ? `<div class="muted small" style="margin-top:6px">quote 必须是原文里的一段连续原文——一字不差，否则播放时定位不到会被跳过。</div>
           <textarea class="quote-input" rows="2" placeholder="从原文里逐字粘贴一段话">${escapeHtml(step.quote || "")}</textarea>`
        : `<div class="step-quote">quote（只读，改了会导致定位失败）：${escapeHtml(step.quote || "")}</div>`}
  `;
  const kindSelect = card.querySelector(".kind-select");
  for (const k of KINDS) {
    const opt = document.createElement("option");
    opt.value = k; opt.textContent = `${KIND_LABELS[k]} (${k})`;
    if (k === step.kind) opt.selected = true;
    kindSelect.appendChild(opt);
  }
  kindSelect.addEventListener("change", () => { step.kind = kindSelect.value; });
  card.querySelector(".title-input").addEventListener("input", (e) => { step.title = e.target.value; });
  card.querySelector(".narration-input").addEventListener("input", (e) => { step.narration = e.target.value; });
  const regionInput = card.querySelector(".region-exp-input");
  if (regionInput) regionInput.addEventListener("input", (e) => { step.region.explanation = e.target.value; });
  const quoteInput = card.querySelector(".quote-input");
  if (quoteInput) quoteInput.addEventListener("input", (e) => { step.quote = e.target.value; });

  card.querySelector(".up-btn").addEventListener("click", () => moveStep(i, -1));
  card.querySelector(".down-btn").addEventListener("click", () => moveStep(i, 1));
  card.querySelector(".del-btn").addEventListener("click", () => {
    if (!confirm("删除这一步？")) return;
    state.pack.steps.splice(i, 1);
    renderSteps();
  });
  return card;
}

function moveStep(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.pack.steps.length) return;
  const steps = state.pack.steps;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  renderSteps();
}

$("addStepBtn").addEventListener("click", () => {
  state.pack.steps.push({ kind: "claim", title: "", narration: "", quote: "", __isNew: true });
  renderSteps();
  $("stepsList").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// ─── publish / delete ─────────────────────────────────────────────────

$("publishBtn").addEventListener("click", doPublish);
$("deleteBtn").addEventListener("click", async () => {
  if (!state.hash) { alert("hash 还没算出来，稍等一下再试"); return; }
  if (!confirm(`确定删除 variant "${state.variant}" 吗？这个操作不可逆，会直接 git push 一个删除 commit。`)) return;

  const logEl = $("pubLog");
  logEl.hidden = false;
  logEl.textContent = "";
  $("deleteBtn").disabled = true;

  try {
    const resp = await fetch("/api/pack", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: state.hash, variant: state.variant }),
    });
    let ok = false;
    await streamNdjson(resp, (evt) => {
      if (evt.type === "log") { logEl.textContent += evt.text + "\n"; logEl.scrollTop = logEl.scrollHeight; }
      else if (evt.type === "done") { ok = true; logEl.textContent += "\n✅ 已删除\n"; }
      else if (evt.type === "error") { logEl.textContent += "\n❌ " + evt.message + "\n"; }
    });
    if (ok) {
      $("editorPanel").hidden = true;
      doLookup();
    }
  } catch (e) {
    logEl.textContent += "\n❌ " + e.message + "\n";
  } finally {
    $("deleteBtn").disabled = false;
  }
});

async function doPublish() {
  state.pack.intro = $("editIntro").value;
  state.pack.essay = $("editEssay").value;
  state.pack.outro = $("editOutro").value;

  const emptyQuoteStep = state.pack.steps.find((s) => s.type !== "image" && !(s.quote || "").trim());
  if (emptyQuoteStep) {
    alert("有一步的 quote 是空的——文字类步骤必须有一段从原文逐字粘贴的 quote，否则播放时会被跳过。");
    return;
  }

  if (!state.hash) {
    const h = await fetchJson(`/api/hash?url=${encodeURIComponent(state.pageUrl)}`);
    state.hash = h.hash;
  }

  const logEl = $("pubLog");
  logEl.hidden = false;
  logEl.textContent = "";
  $("publishBtn").disabled = true;

  // __isNew is a UI-only rendering hint (lets a freshly-added step show an
  // editable quote box) — never persist it into the published pack.
  const publishPack = { ...state.pack, steps: state.pack.steps.map(({ __isNew, ...s }) => s) };

  try {
    const resp = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: state.hash, variant: state.variant, pageUrl: state.pageUrl, pack: publishPack, outDir: state.outDir }),
    });
    await streamNdjson(resp, (evt) => {
      if (evt.type === "log") { logEl.textContent += evt.text + "\n"; logEl.scrollTop = logEl.scrollHeight; }
      else if (evt.type === "done") { logEl.textContent += `\n✅ 已发布 v${evt.contentVersion}\n`; }
      else if (evt.type === "error") { logEl.textContent += "\n❌ " + evt.message + "\n"; }
    });
  } catch (e) {
    logEl.textContent += "\n❌ " + e.message + "\n";
  } finally {
    $("publishBtn").disabled = false;
  }
}

// ─── utils ────────────────────────────────────────────────────────────

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

async function streamNdjson(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); } catch (_) { /* ignore malformed line */ }
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf)); } catch (_) {} }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
