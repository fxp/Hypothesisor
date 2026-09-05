#!/usr/bin/env node
// Offline walkthrough builder — the extension has no generation of its
// own; this is where a walkthru-pack actually gets made. Run it, review
// the output file, publish by committing it into walkthru-worker/packs/
// and pushing (walkthru-worker reads packs back from
// raw.githubusercontent.com) — easiest via walkthru-admin's 发布 button.
//
// Usage:
//   BIGMODEL_API_KEY=... node build.mjs \
//     --url https://example.com/article \
//     --title "Article Title" \
//     --text-file ./article.txt \
//     [--author "Xiaoping"] [--variant default] [--variant-label "标准版"] \
//     [--depth quick|full] [--chapters N] \
//     [--model glm-4-plus] [--base-url https://open.bigmodel.cn/api/paas/v4] \
//     [--key-env BIGMODEL_API_KEY] [--lang zh|en|bilingual|auto] [--out ./out] \
//     [--tts] [--tts-key-env VOLCENGINE_API_KEY] \
//     [--tts-base-url https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional] \
//     [--tts-resource-id seed-tts-2.0] [--tts-speaker zh_female_xiaohe_uranus_bigtts] \
//     [--r2-public-base https://pub-cd6c0de855c94946bb5ba4f14c160d9c.r2.dev]
//
// API keys are read from environment variables (never pass them as CLI
// flags or paste them into this script). Text generation works with any
// OpenAI-compatible chat/completions endpoint: BigModel, DeepSeek,
// OpenRouter, etc. --tts synthesizes narration audio via Volcengine
// Doubao (off by default — costs extra API calls); audio files publish
// alongside the pack JSON, referenced by intro/outro/step audioUrl
// fields pointing at public R2.dev URLs.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ─── CLI args ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function requireArg(name) {
  if (!args[name]) { console.error(`missing required --${name}`); process.exit(1); }
  return args[name];
}

const url = requireArg("url");
const title = args.title || "";
const textFile = requireArg("text-file");
const author = args.author || "";
// --depth controls how much ground a walkthrough covers, independent of
// --variant (which just controls the publish path/label). "quick" caps
// step count and essay length to a small fixed budget regardless of
// article length, for a fast skim; "full" (default) keeps the existing
// length-adaptive behavior unchanged.
const depth = args.depth === "quick" ? "quick" : "full";
const variant = args.variant || (depth === "quick" ? "quick" : "default");
// Product surface is two tiers: 标准版 (this single-pass path) and 完整版
// (the --chapters "deep" path, see mainChaptered below). "精简版"/quick
// was retired as an offered choice — the --depth quick machinery stays
// available as a raw CLI capability (harmless, just not used) rather than
// being ripped out.
const variantLabel = args["variant-label"]
  || (variant === "quick" ? "精简版" : variant === "default" ? "标准版" : variant);
const model = args.model || "glm-4-plus";
const baseUrl = (args["base-url"] || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
const keyEnv = args["key-env"] || "BIGMODEL_API_KEY";
const apiKey = process.env[keyEnv];
const genLanguage = args.lang || "zh";
const outDir = args.out || "./out";
// --chapters N splits the source into ~N natural chapters (LLM-segmented,
// not a mechanical char split) so each slice gets its own length-appropriate
// step budget instead of forcing the whole article through one step-count
// cap — a 100k-char article capped at 16 steps only ever covers its first
// third or so. The chapters are an internal generation device only: their
// steps get merged back into ONE continuous walkthrough (variant "deep"),
// in full-document order, so the reading experience is "the whole article,
// properly deep, start to finish" — not a pile of N separately-playable
// chapter cards. --variant/--variant-label are ignored in this mode.
const chapters = args.chapters ? Math.max(0, parseInt(args.chapters, 10) || 0) : 0;

// ─── TTS (Volcengine Doubao seed-tts-2.0) — narration audio, off by default ──
const ttsEnabled = !!args.tts;
const ttsKeyEnv = args["tts-key-env"] || "VOLCENGINE_API_KEY";
const ttsApiKey = process.env[ttsKeyEnv];
const ttsBaseUrl = (args["tts-base-url"] || "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional").replace(/\/+$/, "");
const ttsResourceId = args["tts-resource-id"] || "seed-tts-2.0";
const ttsSpeaker = args["tts-speaker"] || "zh_female_xiaohe_uranus_bigtts";

// ─── Image annotation (vision model) ────────────────────────────────
// --images-file points at a JSON array of {selector, imagePath, alt,
// anchorQuote} — selector is a CSS selector the extension will re-locate
// on the live page (document.querySelector), imagePath is a local
// screenshot of that element (build.mjs has no browser of its own to take
// one). anchorQuote is optional but strongly recommended: a short verbatim
// snippet of text from right next to the image in the source (e.g. its
// caption or the paragraph just before it) — used to slot the image step
// into its correct position in the walkthrough's reading order instead of
// appending every image after all the text steps. Without it (or if it
// can't be found verbatim), the image step falls back to the end.
const imagesFile = args["images-file"] || "";
const visionModel = args["vision-model"] || "z-ai/glm-5.3-flash";
const visionBaseUrl = (args["vision-base-url"] || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const visionKeyEnv = args["vision-key-env"] || "OPENROUTER_API_KEY";
const visionApiKey = process.env[visionKeyEnv];
// Public R2.dev base the extension fetches audio files from directly (no
// Worker involvement needed — audio is a static file, same as the pack JSON).
const r2PublicBase = (args["r2-public-base"] || "https://pub-cd6c0de855c94946bb5ba4f14c160d9c.r2.dev").replace(/\/+$/, "");

if (!apiKey) {
  console.error(`no API key in $${keyEnv} — export it in your own shell first, e.g.:\n  export ${keyEnv}=...\nnever pass it as a --flag (shell history) or paste it into this file.`);
  process.exit(1);
}
if (ttsEnabled && !ttsApiKey) {
  console.error(`--tts was passed but no API key in $${ttsKeyEnv} — export it in your own shell first, e.g.:\n  export ${ttsKeyEnv}=...`);
  process.exit(1);
}
if (imagesFile && !visionApiKey) {
  console.error(`--images-file was passed but no API key in $${visionKeyEnv} — export it in your own shell first, e.g.:\n  export ${visionKeyEnv}=...`);
  process.exit(1);
}

const content = fs.readFileSync(textFile, "utf8");
if (content.length < 200) { console.error("source text is too short (<200 chars) — check --text-file"); process.exit(1); }

// ─── URL normalization + hash — MUST match chrome-extension-walkthru/lib/community.js exactly ──

const UTM_PREFIX = /^utm_/i;
const NOISE_NAME = /^(session|sess|sid|token|trace|traceid|request_?id|nonce|timestamp|ts|cache|cachebust|cb|rnd|rand|guid|uuid|v|ver|_)$/i;
const TRACKING_PARAMS = new Set([
  "gclid", "fbclid", "msclkid", "dclid", "twclid", "igshid", "yclid", "icid",
  "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi",
  "ref", "referrer", "source", "spm", "from", "si", "feature",
  "click_id", "clickid", "aff_id", "affid", "partner", "cmpid", "ncid", "wt_mc", "ito",
]);
function normalizeUrl(u) {
  let parsed;
  try { parsed = new URL(u); } catch (_) { return u; }
  parsed.hash = "";
  const kept = [];
  for (const [k, v] of new URLSearchParams(parsed.search)) {
    if (UTM_PREFIX.test(k) || NOISE_NAME.test(k) || TRACKING_PARAMS.has(k.toLowerCase())) continue;
    kept.push([k, v]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  const qs = new URLSearchParams(kept).toString();
  parsed.search = qs ? `?${qs}` : "";
  return parsed.toString();
}
function urlHash(u) {
  return crypto.createHash("sha256").update(normalizeUrl(u)).digest("hex");
}

// ─── Quote validation — ported from chrome-extension-walkthru/lib/agent.js ──

function validateQuote(sourceContent, quote) {
  if (!quote) return { found: false };
  let pos = sourceContent.indexOf(quote);
  if (pos >= 0) return { found: true, start: pos, end: pos + quote.length };
  pos = sourceContent.toLowerCase().indexOf(quote.toLowerCase());
  if (pos >= 0) return { found: true, start: pos, end: pos + quote.length };
  return validateQuoteNormalized(sourceContent, quote);
}
function buildNormalized(sourceContent) {
  const out = [];
  const map = [];
  let i = 0;
  const n = sourceContent.length;
  while (i < n) {
    const c = sourceContent[i];
    if (c === "!" && sourceContent[i + 1] === "[") {
      const close = sourceContent.indexOf("](", i + 2);
      const end = close >= 0 ? sourceContent.indexOf(")", close + 2) : -1;
      if (close >= 0 && end >= 0) { i = end + 1; continue; }
    }
    if (c === "[") {
      const close = sourceContent.indexOf("](", i + 1);
      const end = close >= 0 ? sourceContent.indexOf(")", close + 2) : -1;
      if (close >= 0 && end >= 0) {
        const inner = sourceContent.slice(i + 1, close);
        for (let k = 0; k < inner.length; k++) { out.push(normChar(inner[k])); map.push(i + 1 + k); }
        i = end + 1;
        continue;
      }
    }
    if (c === "*" || c === "_" || c === "`") { i++; continue; }
    out.push(normChar(c));
    map.push(i);
    i++;
  }
  const collapsed = [];
  const collapsedMap = [];
  let prevWs = false;
  for (let k = 0; k < out.length; k++) {
    const c = out[k];
    const isWs = /\s/.test(c);
    if (isWs && prevWs) continue;
    collapsed.push(isWs ? " " : c);
    collapsedMap.push(map[k]);
    prevWs = isWs;
  }
  return { text: collapsed.join(""), map: collapsedMap };
}
function normChar(c) {
  const code = c.charCodeAt(0);
  if (code === 0x2018 || code === 0x2019 || code === 0x201A || code === 0x201B) return "'";
  if (code === 0x201C || code === 0x201D || code === 0x201E || code === 0x201F) return '"';
  if (code === 0x2013 || code === 0x2014 || code === 0x2212) return "-";
  if (code === 0x00A0 || code === 0x202F || code === 0x2009) return " ";
  return c;
}
function validateQuoteNormalized(sourceContent, quote) {
  const { text: nContent, map } = buildNormalized(sourceContent);
  const nQuoteFull = buildNormalized(quote).text.trim();
  if (!nQuoteFull) return { found: false };
  let pos = nContent.indexOf(nQuoteFull);
  if (pos < 0) pos = nContent.toLowerCase().indexOf(nQuoteFull.toLowerCase());
  if (pos < 0) return { found: false };
  const start = map[pos];
  const lastIdx = pos + nQuoteFull.length - 1;
  const end = (map[lastIdx] ?? map[map.length - 1]) + 1;
  if (start == null || end == null || end <= start) return { found: false };
  return { found: true, start, end };
}
function dropOverlapping(steps) {
  const out = [];
  let prevEnd = -1;
  for (const s of steps) {
    if (s.start < prevEnd) continue;
    out.push(s);
    prevEnd = s.end;
  }
  return out;
}

// ─── LLM JSON parsing — ported from chrome-extension-walkthru/lib/agent.js ──

function parseLLMJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const block = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!block) throw new Error("no JSON block in response");
  try { return JSON.parse(block[0]); } catch (_) {}
  return JSON.parse(repairJSON(block[0]));
}
function repairJSON(s) {
  s = s.replace(/[""]/g, '"').replace(/['']/g, "'");
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (c.charCodeAt(0) < 0x20) out += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
      else out += c;
    } else out += c;
  }
  return out.replace(/,\s*([\]\}])/g, "$1");
}

// ─── Prompt — ported verbatim from chrome-extension-walkthru/lib/walkthrough.js ──

const KINDS = ["context", "claim", "evidence", "insight", "caveat", "conclusion"];

const SYSTEM_PROMPT = `你是一位耐心的领读人。你的任务不是"标注"或"总结"，而是**站在读者旁边，把这篇文章当一个故事讲给他听**——像老师上课一样，念到关键处就停下来，指着那一句解释"这里在说什么、为什么重要"，而且上一句和下一句之间要有因果或转折，能连成一条线，不是一堆互不相关的读书笔记。

工作方式：
1. 通读全文，理解论证结构（背景 → 论点 → 证据/数据 → 反驳或局限 → 结论），同时找出其中的因果链、转折点、递进关系——这些"关节"就是整个讲解的骨架，也是选片段的主要依据。
2. 挑选若干个"值得停下来讲一讲"的关键片段，按它们在原文中出现的顺序组织成一次讲解（不要打乱顺序、不要跳来跳去）。
3. **核心要求：讲成一条连贯的故事线，不是孤立的批注堆砌**。每一步的 narration 都要承接上一步——用因果、转折、递进把两步之间的逻辑关系点出来，读者应该感觉自己在跟着一条线往下走，而不是在看一组各自独立的知识卡片。具体做法：
   - narration 可以（不必每次都用同一句式，避免重复）用一个简短的承接语开头，比如"这就带来一个问题——""于是……""但作者马上话锋一转：""这解释了为什么……""紧接着的反驳是……""问题是……"，把它和上一步的关系点出来
   - 语气像口头讲解，不是书面总结——可以说"注意这里""这句话的潜台词是"，但不要出现"大家好""接下来"这类主持腔
   - **把整条讲解线当"起承转合"来构思**：开头几步是"起"（context 建立背景）和"承"（claim/evidence 展开论点、举证），中段要有明显的"转"（insight/caveat 类型最适合——反直觉的洞见、局限、反驳，给主线制造一次真正的转折，不是走个过场），收尾几步是"合"（conclusion 收束、和前面呼应）。不要让所有片段都是同一节奏的平铺直叙，读者应该能感觉到论证在推进、在转弯、最后落地。
   - 自我检查：把所有 narration 连起来读一遍，应该像听人讲一段完整的故事（有铺垫、有转折、有落点），而不是把每条单独拎出来也能懂的独立摘要——如果单独拎出来完全不影响理解，说明连贯性不够，需要重写
4. **开场白（intro）要同时做两件事**：① 用一两句话交代这篇文章大致讲了什么、覆盖哪几个层面或阶段——让读者先有一个全文的整体轮廓，不是要读完才知道；② 在此基础上**抛出一条贯穿全文的线索或矛盾**（一个反直觉的现象、一个悬而未决的问题、一个看似矛盾的说法），后面每一步都是在推进或回应这条线索——不是写成"本文介绍了……"这种干巴巴的摘要句，要让读者带着这条线索、带着一个具体的疑问往下读。收尾（outro）要**呼应 intro 抛出的那条线索**，给出最终答案或核心收获，让整段讲解有始有终、闭环，而不是另起一个话题。
5. 除了逐步的讲解，还要写一篇**完整的导读文章（essay）**——把 intro 抛出的线索、每一步之间的因果起伏、outro 的收获，用连贯的段落写成一篇有始有终的导读，而不是分点罗列。读者读完这篇 essay，应该等于完整读懂了这篇文章的论证脉络，不需要再回头看原文。可以在其中用 \\*\\*加粗\\*\\* 标出你在 step 里高亮过的关键词/数字，让读者一眼看出这篇 essay 和上面的逐步讲解是同一条线，但正文必须是连续段落（不是列表、不是分点、不是标题+要点的结构）。

【quote 规范 —— 与标注功能相同的严格要求】
1. **逐字引用**：必须是原文一段连续字符的精确复制，不改一个字、不省略、不拼接。
2. **保留所有 Markdown 标记**（\\*\\*粗体\\*\\*、[text](url)、行内代码等）与原始引号/破折号字符，不要"清理"。
3. 原文英文则引英文，中文则引中文；不引标题/URL/导航元数据。
4. 长度 15~90 字之间，长到能被唯一定位，短到能被高亮成一句话。
5. **如果讲解的意思在原文里没有连续对应的句子，就换一个真的能逐字找到的片段**，不要发明。

【每个 step 的字段】
- "quote": 原文精确引用
- "title": 极短的小标题（≤14 字，像幻灯片标题，不加标点）
- "narration": 讲解词（1~3 句话，40~120 字，口语化、有信息增量、承接上一步，不复述 quote）
- "kind": 这个片段在故事线里的角色，从 [${KINDS.join("|")}] 里选一个
  - context：背景/前提（故事的起点、铺垫）
  - claim：核心论点/主张（抛出问题或转折）
  - evidence：数据/例证/引用（支撑或回应上一步）
  - insight：反直觉的洞见或隐含假设（往往是叙事的转折点）
  - caveat：局限/风险/需要警惕的地方（给主线泼冷水、制造张力）
  - conclusion：阶段性小结（收束一段小论证，为下一步做铺垫）

【输出 JSON —— 严格遵守】
{
  "intro": "开场白，60~150 字，先给全文轮廓，再抛出贯穿全文的线索或矛盾",
  "essay": "完整导读文章，分 3~6 段，段落之间用 \\n\\n 分隔，字数见下方【篇幅】要求",
  "steps": [ { "quote": "...", "title": "...", "narration": "...", "kind": "..." }, ... ],
  "outro": "收尾，30~80 字，读完的核心收获或可以怎么用"
}

- 只输出 JSON 对象本体，不要代码块、不要解释文字
- 所有字符串字段用 ASCII 双引号 " 包裹
- 字符串内禁止真实换行，需要换行写 \\n`;

function computeStepCount(n, stepDepth) {
  // Quick: a fast skim, capped regardless of how long the source is —
  // the point is "the 3-4 things worth knowing", not full coverage.
  // (Retired as an offered product tier — see the variantLabel comment
  // above — but the mechanics stay intact.)
  if (stepDepth === "quick") return { lo: 3, hi: 4, label: "精简版" };
  // Chapter: the 完整版/deep pipeline's per-chapter calls. Each chapter is
  // already a small, focused slice specifically so it can be covered
  // exhaustively — "尽量详细" means picking every distinct point worth a
  // stop, not the sparser highlight-reel budget below (which was tuned
  // for a single whole-article pass trying to stay skimmable). Roughly
  // 1 step per 1200-1500 chars instead of the ~2500-3500 chars/step the
  // "长文"/"深度长文" tiers below use.
  if (stepDepth === "chapter") {
    if (n < 3000) return { lo: 3, hi: 6, label: "章节" };
    if (n < 8000) return { lo: 6, hi: 10, label: "章节" };
    if (n < 15000) return { lo: 9, hi: 14, label: "章节" };
    if (n < 25000) return { lo: 12, hi: 18, label: "章节" };
    return { lo: 14, hi: 20, label: "章节" };
  }
  if (n < 4000) return { lo: 3, hi: 5, label: "短文" };
  if (n < 12000) return { lo: 5, hi: 8, label: "中等" };
  if (n < 30000) return { lo: 7, hi: 11, label: "长文" };
  if (n < 60000) return { lo: 9, hi: 14, label: "深度长文" };
  return { lo: 10, hi: 16, label: "超长篇章" };
}
function computeEssayLength(n, stepDepth) {
  if (stepDepth === "quick") return { lo: 150, hi: 300 };
  if (n < 4000) return { lo: 300, hi: 500 };
  if (n < 12000) return { lo: 500, hi: 800 };
  if (n < 30000) return { lo: 800, hi: 1200 };
  if (n < 60000) return { lo: 1000, hi: 1500 };
  return { lo: 1200, hi: 1800 };
}
function looksCJK(sourceContent) {
  const sample = sourceContent.slice(0, 3000);
  const cjk = (sample.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const letters = (sample.match(/[a-zA-Z一-鿿぀-ヿ가-힯]/g) || []).length;
  if (letters < 20) return false;
  return cjk / letters > 0.15;
}
function languageDirective(lang, sourceContent) {
  switch (lang) {
    case "bilingual": return "\n\n【输出语言】中英对照：intro / outro / title / narration / essay 都先写中文一段，空行后写英文翻译一段。quote 永远是原文逐字。";
    case "zh": return "\n\n【输出语言】简体中文 — intro / title / narration / outro / essay 必须中文，不混入英文（原文 quote 除外）。";
    case "en": return "\n\n【输出语言】English only — intro / title / narration / outro / essay must be English. Quote stays in the source language verbatim.";
    case "auto":
      return looksCJK(sourceContent || "")
        ? "\n\n【输出语言】简体中文 — intro / title / narration / outro / essay 必须中文，不混入英文（原文 quote 除外）。"
        : "\n\n【输出语言】English only — the source article is not Chinese. intro / title / narration / outro / essay must ALL be written in English — do NOT default to Chinese. Quote stays in the source language verbatim.";
    default: return `\n\n【输出语言】${lang}`;
  }
}
function buildSystemPrompt(length, lang, sourceContent, stepDepth, chapterNote) {
  const { lo, hi, label } = computeStepCount(length, stepDepth);
  const essay = computeEssayLength(length, stepDepth);
  let base = SYSTEM_PROMPT;
  base += `\n\n【篇幅·${label}（${length} 字符）】挑选 ${lo}~${hi} 个片段，覆盖全文不同章节，不要都挤在开头。essay 写 ${essay.lo}~${essay.hi} 字，宁可写完整也不要为了凑数硬拉长。`;
  if (stepDepth === "quick") base += `\n只挑最关键的 ${lo}~${hi} 个片段——这是快速版，目标是"读完这几句就抓住全文核心"，不是覆盖每个章节。`;
  if (stepDepth === "chapter") base += `\n这是"完整版"的一部分，要尽量详细——这一段范围本来就不大，把里面每一个独立的数据点、结论、案例、反例都当作单独的片段挑出来讲，不要为了控制篇幅而合并或跳过次要细节。`;
  if (chapterNote) base += `\n\n${chapterNote}`;
  base += languageDirective(lang, sourceContent);
  return base;
}

// ─── Generation ─────────────────────────────────────────────────────

async function generate(sourceContent, sourceTitle, chapterNote, stepDepth = depth) {
  const length = sourceContent.length;
  const { hi } = computeStepCount(length, stepDepth);
  const maxTokens = hi >= 18 ? 12288 : hi >= 14 ? 10240 : hi >= 11 ? 8192 : hi >= 8 ? 6144 : 4096;
  const system = buildSystemPrompt(length, genLanguage, sourceContent, stepDepth, chapterNote);
  const truncated = length > 60000 ? sourceContent.slice(0, 60000) + "\n\n[内容已截断...]" : sourceContent;

  console.log(`calling ${model} (${baseUrl}) — ${length} chars source, budget ${maxTokens} tokens...`);
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `URL: ${url}\n标题: ${sourceTitle}\n\n文章内容：\n\n${truncated}` },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("LLM_EMPTY — model returned no content");
  const parsed = parseLLMJson(text);

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const validated = dropOverlapping(
    rawSteps
      .map((s) => {
        const quote = (s.quote || "").trim();
        const loc = validateQuote(sourceContent, quote);
        if (!loc.found) { console.warn(`  dropped step (quote not found verbatim): "${quote.slice(0, 40)}..."`); return null; }
        const narration = (s.narration || "").trim();
        // The model occasionally drops the title field on longer
        // generations (title still required by the prompt, just empty in
        // practice) — falling back to a narration excerpt beats shipping
        // a step whose card renders with a blank title bar.
        const title = (s.title || "").trim() || narration.slice(0, 14);
        return {
          quote,
          title,
          narration,
          kind: KINDS.includes(s.kind) ? s.kind : "insight",
          start: loc.start, end: loc.end,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start)
  );
  // Offsets were computed against THIS run's own extraction and a
  // recipient's DOM must be re-validated fresh anyway — but callers need
  // them a little longer, to interleave image steps by position (see
  // mergeStepsByPosition below). They get stripped right before a pack is
  // actually written, same effect as before, just later.
  return {
    intro: (parsed.intro || "").trim(),
    essay: (parsed.essay || "").trim(),
    outro: (parsed.outro || "").trim(),
    steps: validated,
  };
}

// ─── Chapter segmentation ───────────────────────────────────────────
// LLM-driven, not a mechanical char split: asks for natural section
// boundaries plus a verbatim startQuote per chapter, then locates each
// boundary in the real source via the same quote-matching used for steps
// (so a chapter is always an exact contiguous slice of the original text,
// never a paraphrase or a mid-sentence cut).

const CHAPTER_SYSTEM_PROMPT = `你是一个长文编辑，需要把一篇长文切成若干个逻辑连贯的自然章节，供后续分别给每一章单独生成导读。每一章之后会被独立地喂给一个步数有上限的生成器，所以**篇幅均衡比话题纯粹更重要**——一章如果太长，这一章自己也会重蹈"半篇文章讲不完"的覆辙，切了等于没切。

要求：
1. 每个章节应该是原文里连续的一段，按原文顺序排列，覆盖全文——不要遗漏开头或结尾的内容。
2. **每章篇幅应大致相当**（目标：没有任何一章的字符数超过全文总长的 40%）。如果某个主题本身内容很多（比如一长串并列的子话题、案例、组件），必须按其内部的自然子分段（比如"每个子话题/组件是一个独立小节"）进一步拆成多个章节，不要因为"话题上属于同一个大类"就合并成一整章。反过来，也不要为了凑够章节数把内容单薄的相邻小节强行拆开。
3. 给每章一个简短标题（≤16字，能概括这一章讲的是什么，不要用"第一部分"这种空洞标题）。
4. 给每章提供 "startQuote"：**该章节开头那句话的逐字前 10~20 个词/字**，必须是原文连续字符的精确复制（不改字、不省略、不翻译、不清理格式），用来在原文中定位这一章的起点。第一章的 startQuote 必须取自全文最开头。

只输出严格 JSON，不要代码块、不要解释文字：
{"chapters": [{"title": "...", "startQuote": "..."}, ...]}`;

async function segmentChapters(sourceContent, targetChapters, articleTitle) {
  const truncated = sourceContent.length > 60000 ? sourceContent.slice(0, 60000) + "\n\n[内容已截断...]" : sourceContent;
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CHAPTER_SYSTEM_PROMPT + `\n\n目标章节数：大约 ${targetChapters} 章（可以略多或略少，以原文的自然分段为准，不要硬凑）。` },
        { role: "user", content: `文章标题: ${articleTitle}\n\n文章内容：\n\n${truncated}` },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`chapter segmentation HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("chapter segmentation returned no content");
  const parsed = parseLLMJson(text);
  const raw = Array.isArray(parsed.chapters) ? parsed.chapters : [];

  const located = raw
    .map((c) => {
      const q = (c.startQuote || "").trim();
      const loc = validateQuote(sourceContent, q);
      if (!loc.found) { console.warn(`  chapter "${c.title}" startQuote not found verbatim — dropped`); return null; }
      return { title: (c.title || "").trim() || "章节", start: loc.start };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (!located.length) throw new Error("no chapter boundaries could be located in source text");
  located[0].start = 0; // never lose the opening paragraph to a near-miss match

  return located
    .map((c, i) => {
      const end = i + 1 < located.length ? located[i + 1].start : sourceContent.length;
      return { title: c.title, text: sourceContent.slice(c.start, end).trim() };
    })
    .filter((c) => c.text.length >= 200); // drop degenerate slivers from bad boundaries
}

// Belt-and-suspenders on top of the "keep chapters balanced" prompt
// instruction above: a modest model won't always honor it, and one
// oversized chapter (e.g. a catalog of many sub-topics the model judged
// "one topic") just reproduces the original whole-article problem one
// level down. Anything still over the cap gets recursively re-segmented
// once — its own natural sub-sections become chapters in their own right.
async function expandOversizedSegments(segments, articleTitle, cap = 35000) {
  const out = [];
  for (const seg of segments) {
    if (seg.text.length <= cap) { out.push(seg); continue; }
    const subCount = Math.max(2, Math.ceil(seg.text.length / cap));
    console.log(`  chapter "${seg.title}" is ${seg.text.length} chars (over the ${cap}-char balance cap) — splitting further into ~${subCount} sub-chapters...`);
    try {
      const subs = await segmentChapters(seg.text, subCount, `${articleTitle} — ${seg.title}`);
      if (subs.length < 2) { out.push(seg); continue; } // sub-segmentation didn't actually help — keep as one chapter
      subs.forEach((s) => out.push({ title: `${seg.title}·${s.title}`, text: s.text }));
    } catch (e) {
      console.warn(`  sub-segmentation of "${seg.title}" failed (${e.message}) — keeping it as one oversized chapter`);
      out.push(seg);
    }
  }
  return out;
}

// ─── TTS ─────────────────────────────────────────────────────────────
// Despite hitting the "unidirectional" (non-SSE) HTTP endpoint, the
// response body is newline-delimited JSON, not one JSON object — a
// sequence of {data: <base64 chunk>} frames (one per audio segment),
// then a {data: null, sentence: {...}} timing frame, then a terminal
// {code: 20000000} frame. Concatenate the base64 TEXT across all chunks
// before decoding — decoding each chunk separately would fail whenever
// a chunk boundary doesn't land on a base64 4-byte boundary. A short
// 2-character test string happened to produce exactly one chunk, which
// is what let the wrong single-JSON-object assumption pass initially.
// Auth is the new-console ARK-style pair (X-Api-Key + X-Api-Resource-Id).
async function synthesizeAudio(text) {
  const resp = await fetch(ttsBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": ttsApiKey,
      "X-Api-Resource-Id": ttsResourceId,
    },
    body: JSON.stringify({
      user: { uid: "walkthru-builder" },
      req_params: {
        text,
        speaker: ttsSpeaker,
        audio_params: { format: "mp3", sample_rate: 24000 },
      },
    }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}: ${body.slice(0, 300)}`);

  let base64Audio = "";
  let sawTerminal = false;
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let frame;
    try { frame = JSON.parse(line); } catch (_) { continue; }
    if (frame.code && frame.code !== 0 && frame.code !== 20000000) {
      throw new Error(`TTS error ${frame.code}: ${frame.message || "(no message)"}`);
    }
    if (frame.code === 20000000) sawTerminal = true;
    if (typeof frame.data === "string" && frame.data) base64Audio += frame.data;
  }
  if (!base64Audio) throw new Error(`TTS response had no audio data across ${body.split("\n").filter(Boolean).length} frame(s): ${body.slice(0, 300)}`);
  if (!sawTerminal) console.warn("  (warning: no terminal success frame seen — audio may be incomplete)");
  return Buffer.from(base64Audio, "base64");
}

// ─── Image annotation ───────────────────────────────────────────────
// Vision call per candidate image: is it worth calling out, what's in
// it, and — since "标注图中重要的部分" was explicitly asked for — which
// sub-region matters most, as a normalized [x0,y0,x1,y1] box the
// extension draws a highlight rectangle over on top of the live element.
const IMAGE_KINDS = ["context", "claim", "evidence", "insight", "caveat", "conclusion"];

const IMAGE_PROMPT = `你在帮读者读一篇文章，现在看到文章里的一张图/图表。请判断这张图是否值得在讲解中专门停下来讲一讲（比如信息密度高的示意图、数据图表；跳过纯装饰性的图标或无实质内容的插图）。

如果值得讲，请用中文回答，严格输出以下 JSON（不要代码块、不要多余文字）：
{
  "worthIncluding": true,
  "title": "极短小标题（≤14字）",
  "narration": "讲解词，1~3句话，说明这张图在讲什么、为什么重要，口语化",
  "kind": "从 [${IMAGE_KINDS.join("|")}] 里选一个",
  "region": {
    "box": [x_min, y_min, x_max, y_max],
    "explanation": "为什么这个区域是图里最值得看的部分（1句话）"
  }
}
如果图里没有明显的"最重要子区域"（比如整张图信息均匀分布），region 可以省略，只输出 worthIncluding/title/narration/kind。
如果这张图不值得讲，只输出 {"worthIncluding": false}。

box 坐标全部是 0~1 之间的归一化值，(0,0) 是图片左上角，(1,1) 是右下角。`;

async function analyzeImage(imagePath, alt) {
  const bytes = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).replace(".", "") || "png";
  const dataUrl = `data:image/${ext};base64,${bytes.toString("base64")}`;
  const resp = await fetch(`${visionBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${visionApiKey}` },
    body: JSON.stringify({
      model: visionModel,
      // The structured-JSON prompt below (vs. a one-line question) makes
      // this model reason substantially longer before answering — 500
      // tokens let reasoning eat the whole budget and leave zero room
      // for the actual `content`, confirmed by a real call returning
      // reasoning text but an empty content field.
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: IMAGE_PROMPT + (alt ? `\n\n图片的 alt 文本（供参考）："${alt}"` : "") },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) throw new Error(`vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error(`vision model returned no content (finish_reason: ${data.choices?.[0]?.finish_reason}, raw: ${JSON.stringify(data).slice(0, 300)})`);
  return parseLLMJson(text);
}

// Runs vision analysis on every candidate and keeps only the ones judged
// worth including — independent of chapters/position, so this runs once
// regardless of which publish path (single-pack or chaptered) is active.
async function resolveImageSteps(imagesFilePath) {
  const candidates = JSON.parse(fs.readFileSync(imagesFilePath, "utf8"));
  console.log(`\nanalyzing ${candidates.length} candidate image(s)...`);
  const resolved = [];
  for (const c of candidates) {
    let analysis;
    try {
      analysis = await analyzeImage(c.imagePath, c.alt || "");
    } catch (e) {
      console.warn(`  ${c.imagePath}: vision call FAILED — ${e.message}`);
      continue;
    }
    if (!analysis.worthIncluding) {
      console.log(`  ${c.imagePath}: skipped (model judged not worth including)`);
      continue;
    }
    resolved.push({
      imagePath: c.imagePath,
      anchorQuote: (c.anchorQuote || "").trim(),
      step: {
        type: "image",
        imageSelector: c.selector,
        title: (analysis.title || "").trim(),
        narration: (analysis.narration || "").trim(),
        kind: IMAGE_KINDS.includes(analysis.kind) ? analysis.kind : "evidence",
        region: analysis.region?.box ? { box: analysis.region.box, explanation: analysis.region.explanation || "" } : undefined,
      },
    });
    console.log(`  ${c.imagePath}: added — "${analysis.title}"`);
  }
  return resolved;
}

// Interleaves resolved image steps into a position-sorted text-step
// sequence by locating each image's anchorQuote in the same source text
// the text steps were validated against — this is what puts a chart step
// right after the paragraph it illustrates instead of every image piling
// up after all the text steps regardless of where they actually sit in
// the article. No anchorQuote (or one that can't be found verbatim) sorts
// last, degrading gracefully to the old "append at the end" behavior
// rather than dropping the image or throwing.
function mergeStepsByPosition(textSteps, imageResolved, sourceContent) {
  const withPos = [
    ...textSteps.map((s) => ({ ...s, _pos: s.start })),
    ...imageResolved.map((r) => {
      let pos = Infinity;
      if (r.anchorQuote) {
        const loc = validateQuote(sourceContent, r.anchorQuote);
        if (loc.found) pos = loc.start;
        else console.warn(`  ${r.imagePath}: anchorQuote not found verbatim here — appending at the end instead of its natural position`);
      } else {
        console.warn(`  ${r.imagePath}: no anchorQuote given — appending at the end instead of its natural position`);
      }
      return { ...r.step, _pos: pos };
    }),
  ];
  withPos.sort((a, b) => a._pos - b._pos);
  return withPos.map(({ _pos, start, end, ...rest }) => rest);
}

// Chapter-mode only: decides which chapter each image "lives in" by
// testing its anchorQuote against each chapter's own text slice (chapters
// are non-overlapping, so at most one should ever match). Images with no
// match anywhere (missing anchorQuote, or the snippet doesn't appear
// verbatim in any chapter) come back as unassigned rather than silently
// dropped — the caller decides where those land.
function assignImagesToChapters(segments, imageResolved) {
  const perChapter = segments.map(() => []);
  const unassigned = [];
  for (const r of imageResolved) {
    const idx = r.anchorQuote ? segments.findIndex((seg) => validateQuote(seg.text, r.anchorQuote).found) : -1;
    if (idx === -1) unassigned.push(r);
    else perChapter[idx].push(r);
  }
  return { perChapter, unassigned };
}

// ─── Version ──────────────────────────────────────────────────────────
// Always writes contentVersion: 1 — this function used to auto-increment
// by querying the live Worker for whatever's already published, but that
// queries raw.githubusercontent.com for a hash that's about to be
// published moments later, and something in that chain (Cloudflare's or
// GitHub/Fastly's own edge) holds onto the resulting 404 for close to a
// minute, making a freshly-published pack look missing right after
// publish. walkthru-admin's own publish step now computes the real next
// version from its local git clone instead (see server.mjs) and
// overwrites this value, so it's correct there regardless. Republishing
// an existing hash/variant straight from this CLI (bypassing
// walkthru-admin) needs the version bumped by hand.
async function nextContentVersion(_hash, _variantKey) {
  return 1;
}

// Shared by both the single-pack and per-chapter paths — synthesizes one
// clip per intro/outro/step, attaches its public R2.dev URL to the pack,
// and returns the wrangler publish commands for the audio files.
async function synthesizePackAudio(pack, hash, variantKey) {
  console.log(`  synthesizing narration audio (${ttsResourceId}, speaker ${ttsSpeaker})...`);
  const audioDir = path.join(outDir, `${hash}-${variantKey}-audio`);
  fs.mkdirSync(audioDir, { recursive: true });
  const publishCmds = [];

  const clips = [
    { key: "intro", text: pack.intro },
    { key: "outro", text: pack.outro },
    ...pack.steps.map((s, i) => ({ key: `step-${i}`, text: s.narration })),
  ].filter((c) => c.text);

  for (const clip of clips) {
    const audioPath = path.join(audioDir, `${clip.key}.mp3`);
    try {
      const bytes = await synthesizeAudio(clip.text);
      fs.writeFileSync(audioPath, bytes);
      const publicUrl = `${r2PublicBase}/packs/${hash}/${variantKey}/${clip.key}.mp3`;
      if (clip.key === "intro") pack.introAudioUrl = publicUrl;
      else if (clip.key === "outro") pack.outroAudioUrl = publicUrl;
      else pack.steps[Number(clip.key.split("-")[1])].audioUrl = publicUrl;
      publishCmds.push(`  wrangler r2 object put walkthru-packs/packs/${hash}/${variantKey}/${clip.key}.mp3 --file ${audioPath} --content-type audio/mpeg --remote`);
      console.log(`    ${clip.key}: ${bytes.length} bytes`);
    } catch (e) {
      console.warn(`    ${clip.key}: FAILED — ${e.message} (walkthrough still published without audio for this clip)`);
    }
  }
  return publishCmds;
}

// ─── Main ───────────────────────────────────────────────────────────

async function buildAndWritePack({ hash, variantKey, variantLabelText, sourceTitleText, generated }) {
  const contentVersion = await nextContentVersion(hash, variantKey);
  const pack = {
    format: "walkthru-pack",
    version: 1,
    id: `${hash}-${variantKey}`,
    variant: variantKey,
    variantLabel: variantLabelText,
    contentVersion,
    publishedAt: new Date().toISOString(),
    sourceUrl: url,
    sourceTitle: sourceTitleText,
    author,
    intro: generated.intro,
    essay: generated.essay,
    outro: generated.outro,
    steps: generated.steps,
  };

  const publishCmds = [];
  if (ttsEnabled) publishCmds.push(...await synthesizePackAudio(pack, hash, variantKey));

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${hash}-${variantKey}.json`);
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2));
  // Pack JSON is published by committing it into walkthru-worker/packs/ and
  // pushing — the Worker reads it back from raw.githubusercontent.com, no
  // upload step. Do this in a plain clone, not this iCloud-synced tree (git
  // there has hit mmap timeouts before, see walkthru-admin/server.mjs) —
  // easiest is just walkthru-admin's 发布 button, which handles that clone
  // for you; this line is the manual equivalent if you're not using it.
  publishCmds.unshift(`  cp ${outPath} <clone-of-repo>/walkthru-worker/packs/${hash}/${variantKey}.json && git -C <clone-of-repo> add -A && git -C <clone-of-repo> commit -m "walkthru: publish ${hash.slice(0, 12)}/${variantKey}" && git -C <clone-of-repo> push`);
  console.log(`  wrote ${outPath}`);
  return publishCmds;
}

async function mainChaptered() {
  const hash = urlHash(url);
  console.log(`hash: ${hash} | deep-dive mode: ~${chapters} internal chapters, published as one continuous walkthrough`);

  console.log("segmenting into natural chapters...");
  const rawSegments = await segmentChapters(content, chapters, title);
  console.log(`located ${rawSegments.length} chapter(s), balancing oversized ones...`);
  const segments = await expandOversizedSegments(rawSegments, title);
  console.log(`${segments.length} internal chapter(s):`);
  segments.forEach((s, i) => console.log(`  ${i + 1}. ${s.title} (${s.text.length} chars)`));

  let perChapterImages = segments.map(() => []);
  let unassignedImages = [];
  if (imagesFile) {
    const imageResolved = await resolveImageSteps(imagesFile);
    const assigned = assignImagesToChapters(segments, imageResolved);
    perChapterImages = assigned.perChapter;
    unassignedImages = assigned.unassigned;
    if (unassignedImages.length) {
      console.warn(`  ${unassignedImages.length} image(s) didn't match any chapter's text — appending at the very end`);
    }
  }

  // Each chapter's own intro/essay/outro is scoped to its slice and gets
  // discarded — only its steps (merged with any images that land in it)
  // feed the final pack. A single whole-article intro/essay/outro gets
  // generated separately below, once all the steps are known.
  const allSteps = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    console.log(`\n=== chapter ${i + 1}/${segments.length}: ${seg.title} ===`);
    const chapterNote = `注意：以下内容是长文《${title}》的第 ${i + 1}/${segments.length} 部分——"${seg.title}"，不是全文。这次调用只会用到你输出的 steps（会和其他部分的 steps 拼成一次完整的全文讲解），本次的 intro/essay/outro 不会被使用，不用花心思让它们看起来像在总结整篇文章。`;

    let generated;
    try {
      generated = await generate(seg.text, `${title} — ${seg.title}`, chapterNote, "chapter");
    } catch (e) {
      console.warn(`  chapter ${i + 1} generation FAILED: ${e.message} — skipping`);
      continue;
    }
    if (!generated.steps.length) { console.warn(`  chapter ${i + 1}: no valid steps survived quote validation — skipping`); continue; }
    console.log(`  generated ${generated.steps.length} text step(s), ${generated.essay.length} char essay`);

    const images = i === segments.length - 1 ? [...perChapterImages[i], ...unassignedImages] : perChapterImages[i];
    allSteps.push(...mergeStepsByPosition(generated.steps, images, seg.text));
  }

  if (!allSteps.length) throw new Error("no chapter produced any valid steps — nothing to publish");
  console.log(`\ncombined ${allSteps.length} steps across ${segments.length} chapters, in full-document order`);

  console.log("\ngenerating whole-article overview (intro/essay/outro)...");
  const overall = await generate(content, title, undefined);
  console.log(`  ${overall.essay.length} char essay`);

  const variantKey = "deep";
  const variantLabelText = "完整版";
  const generatedForPack = { intro: overall.intro, essay: overall.essay, outro: overall.outro, steps: allSteps };

  console.log(`\nvariant: ${variantKey}`);
  const publishCmds = await buildAndWritePack({
    hash, variantKey, variantLabelText, sourceTitleText: title, generated: generatedForPack,
  });
  console.log(`\npublish with:\n${publishCmds.join("\n")}`);
}

async function main() {
  if (chapters > 1) return mainChaptered();

  const hash = urlHash(url);
  const generated = await generate(content, title, undefined);
  if (!generated.steps.length) throw new Error("no valid steps survived quote validation — nothing to publish");
  console.log(`generated ${generated.steps.length} steps, ${generated.essay.length} char essay`);

  generated.steps = imagesFile
    ? mergeStepsByPosition(generated.steps, await resolveImageSteps(imagesFile), content)
    : generated.steps.map(({ start, end, ...rest }) => rest);

  console.log(`hash: ${hash} | variant: ${variant}`);
  const publishCmds = await buildAndWritePack({
    hash, variantKey: variant, variantLabelText: variantLabel,
    sourceTitleText: title, generated,
  });
  console.log(`\npublish with:\n${publishCmds.join("\n")}`);
}

main().catch((e) => { console.error("FAILED:", e.message || e); process.exit(1); });
