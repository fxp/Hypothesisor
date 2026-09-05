#!/usr/bin/env node
// Local-only admin server for generating and editing walkthru-packs.
// Wraps walkthru-builder/build.mjs (generation) and git/wrangler (publish /
// delete) as child processes instead of reimplementing their logic, so
// this stays correct-by-construction as those evolve — it never talks to
// BigModel/OpenRouter/Volcengine/GitHub/R2 itself.
//
// Pack JSON lives in git (walkthru-worker/packs/), read back by the Worker
// from raw.githubusercontent.com — publishing is git commit+push, not an
// R2 upload. That publish happens in its own clone under
// GIT_CLONE_DIR (~/.walkthru-worker-git), NOT in this repo's own working
// tree: this repo lives inside an iCloud-synced folder, where git
// operations have been known to hit `mmap failed: Operation timed out`,
// and the working tree's own `main` may be locally diverged from
// origin/main anyway. The dedicated clone is hard-reset to origin/main
// before every publish/delete, so it never carries local drift and a
// push is always a clean fast-forward. Audio (TTS) clips are unrelated —
// they still go straight to R2's public bucket URL via wrangler.
//
// Trusted-local-operator tool, same security model as build.mjs: API
// keys live in your own shell env (BIGMODEL_API_KEY etc.) and are only
// ever read by the child processes this spawns, never by this server or
// sent to the browser. Binds to 127.0.0.1 only — do not expose this port.
//
// Usage:
//   cd walkthru-admin && node server.mjs
//   open http://127.0.0.1:5391

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILDER_DIR = path.join(REPO_ROOT, "walkthru-builder");
const WORKER_DIR = path.join(REPO_ROOT, "walkthru-worker");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5391;
const WORKER_URL = (process.env.WALKTHRU_WORKER_URL || "https://walkthru-worker.fxp007.workers.dev").replace(/\/+$/, "");
const GIT_REMOTE = process.env.WALKTHRU_GIT_REMOTE || "https://github.com/fxp/Hypothesisor.git";
const GIT_CLONE_DIR = process.env.WALKTHRU_GIT_CLONE_DIR || path.join(os.homedir(), ".walkthru-worker-git");

// ─── URL normalization + hash — MUST match chrome-extension-walkthru/lib/community.js and walkthru-builder/build.mjs exactly ──

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

// ─── small helpers ────────────────────────────────────────────────────

function readJsonBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("invalid JSON body: " + e.message)); }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" }[ext] || "application/octet-stream";
}
function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Runs a child process, streaming each stdout/stderr line to `onLine`,
// resolving with the exit code. Uses spawn (argv array, no shell) so
// user-supplied strings (URL, title, pasted text) can never be
// interpreted as shell syntax.
function runStreaming(cmd, args, opts, onLine) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, shell: false });
    const wire = (stream) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) onLine(line);
        }
      });
      stream.on("end", () => { if (buf) onLine(buf); });
    };
    wire(child.stdout);
    wire(child.stderr);
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (e) => { onLine(`[spawn error] ${e.message}`); resolve(1); });
  });
}
function runCollecting(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: false });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout: out, stderr: err }));
    child.on("error", (e) => reject(e));
  });
}

// Runs a sequence of git argv arrays in `cwd`, streaming each to `stream`,
// stopping at the first failure. Returns the exit code of whichever step
// failed, or 0 if all succeeded.
async function runGitSteps(stream, cwd, steps) {
  for (const args of steps) {
    stream.log(`$ git ${args.join(" ")}`);
    const code = await runStreaming("git", args, { cwd, env: process.env }, (line) => stream.log(line));
    if (code !== 0) return code;
  }
  return 0;
}

// Makes sure GIT_CLONE_DIR is a clean checkout at the tip of origin/main —
// clone it if missing, otherwise fetch + hard-reset. This clone is never
// used for anything but scripted publish/delete commits, so discarding any
// local state on every call is intentional, not data loss.
async function ensureGitClone(stream) {
  if (!fs.existsSync(path.join(GIT_CLONE_DIR, ".git"))) {
    stream.log(`cloning ${GIT_REMOTE} into ${GIT_CLONE_DIR} (first run only)...`);
    let code = await runStreaming("git", ["clone", GIT_REMOTE, GIT_CLONE_DIR], { env: process.env }, (line) => stream.log(line));
    if (code !== 0) throw new Error(`git clone failed with code ${code}`);

    // Carry over this repo's own commit identity (if it has a local
    // override) so commits from this clone attribute the same way,
    // instead of git falling back to an auto-detected user@hostname.
    for (const key of ["user.name", "user.email"]) {
      const got = await runCollecting("git", ["config", key], { cwd: REPO_ROOT, env: process.env });
      const value = got.stdout.trim();
      if (got.code === 0 && value) await runCollecting("git", ["config", key, value], { cwd: GIT_CLONE_DIR, env: process.env });
    }
    return;
  }
  const code = await runGitSteps(stream, GIT_CLONE_DIR, [
    ["fetch", "origin", "main"],
    ["reset", "--hard", "origin/main"],
  ]);
  if (code !== 0) throw new Error(`git sync failed with code ${code}`);
}

async function lookupPacks(pageUrl) {
  const resp = await fetch(`${WORKER_URL}/walkthroughs?url=${encodeURIComponent(pageUrl)}`, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`worker HTTP ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data.walkthroughs) ? data.walkthroughs : [];
}
async function nextContentVersion(pageUrl, variant) {
  try {
    const packs = await lookupPacks(pageUrl);
    const existing = packs.find((w) => w.variant === variant);
    return existing?.contentVersion ? existing.contentVersion + 1 : 1;
  } catch (_) {
    return 1;
  }
}

// ─── NDJSON streaming response helper — each line is one JSON event ───
function ndjsonRes(res) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Transfer-Encoding": "chunked", "Cache-Control": "no-cache" });
  return {
    log: (text) => res.write(JSON.stringify({ type: "log", text }) + "\n"),
    event: (obj) => res.write(JSON.stringify(obj) + "\n"),
    end: () => res.end(),
  };
}

// ─── routes ─────────────────────────────────────────────────────────

async function handleLookup(req, res, query) {
  const pageUrl = query.get("url");
  if (!pageUrl) return sendJson(res, 400, { error: "missing url" });
  try {
    const packs = await lookupPacks(pageUrl);
    sendJson(res, 200, { hash: urlHash(pageUrl), normalizedUrl: normalizeUrl(pageUrl), packs });
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
}

async function handleHash(req, res, query) {
  const pageUrl = query.get("url");
  if (!pageUrl) return sendJson(res, 400, { error: "missing url" });
  sendJson(res, 200, { hash: urlHash(pageUrl), normalizedUrl: normalizeUrl(pageUrl) });
}

// POST /api/generate — NDJSON stream of {type:"log"} lines, ending with
// {type:"done", hash, variant, outDir, pack} or {type:"error", message}.
async function handleGenerate(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const stream = ndjsonRes(res);

  const url = (body.url || "").trim();
  const title = (body.title || "").trim();
  const text = body.text || "";
  if (!url || !text || text.length < 200) {
    stream.event({ type: "error", message: "need a url and at least 200 chars of source text" });
    return stream.end();
  }

  const workDir = mkTempDir("walkthru-admin-gen-");
  const textFile = path.join(workDir, "article.txt");
  fs.writeFileSync(textFile, text, "utf8");

  const chapters = Number(body.chapters) > 1 ? Number(body.chapters) : 0;
  const variant = chapters ? "deep" : (body.variant || (body.depth === "quick" ? "quick" : "default"));

  const args = ["build.mjs", "--url", url, "--title", title, "--text-file", textFile, "--out", workDir];
  if (body.author) args.push("--author", body.author);
  if (body.model) args.push("--model", body.model);
  if (body.lang) args.push("--lang", body.lang);
  if (chapters) {
    args.push("--chapters", String(chapters));
  } else {
    if (body.variant) args.push("--variant", body.variant);
    if (body.variantLabel) args.push("--variant-label", body.variantLabel);
    if (body.depth === "quick") args.push("--depth", "quick");
  }
  if (body.tts) args.push("--tts");

  let imagesFile = null;
  if (Array.isArray(body.images) && body.images.length) {
    imagesFile = path.join(workDir, "images-file.json");
    const entries = [];
    body.images.forEach((img, i) => {
      if (!img.selector || !img.dataUrl) return;
      const m = /^data:image\/(\w+);base64,(.+)$/.exec(img.dataUrl);
      if (!m) return;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const imgPath = path.join(workDir, `img-${i}.${ext}`);
      fs.writeFileSync(imgPath, Buffer.from(m[2], "base64"));
      entries.push({ selector: img.selector, imagePath: imgPath, alt: img.alt || "", anchorQuote: img.anchorQuote || "" });
    });
    if (entries.length) fs.writeFileSync(imagesFile, JSON.stringify(entries, null, 2));
    else imagesFile = null;
  }
  if (imagesFile) args.push("--images-file", imagesFile);

  stream.log(`$ node ${args.join(" ")}`);
  const code = await runStreaming("node", args, { cwd: BUILDER_DIR, env: process.env }, (line) => stream.log(line));

  if (code !== 0) {
    stream.event({ type: "error", message: `build.mjs exited with code ${code}` });
    return stream.end();
  }

  const hash = urlHash(url);
  const outFile = path.join(workDir, `${hash}-${variant}.json`);
  if (!fs.existsSync(outFile)) {
    stream.event({ type: "error", message: `expected output file not found: ${outFile}` });
    return stream.end();
  }
  const pack = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const audioDir = path.join(workDir, `${hash}-${variant}-audio`);
  stream.event({
    type: "done",
    hash, variant, outDir: workDir,
    hasAudio: fs.existsSync(audioDir),
    pack,
  });
  stream.end();
}

// POST /api/publish — { hash, variant, pageUrl, pack, outDir? }
// Publishes by committing packs/<hash>/<variant>.json to git and pushing —
// walkthru-worker reads it back from raw.githubusercontent.com, there's no
// separate "upload" step for the JSON itself. outDir (if present, from a
// just-completed /api/generate) lets this also upload any narration audio
// clips build.mjs wrote locally to R2 (audio stays there, unrelated to git).
async function handlePublish(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const stream = ndjsonRes(res);
  const { hash, variant, pageUrl, pack, outDir } = body;
  if (!hash || !variant || !pack || !pageUrl) {
    stream.event({ type: "error", message: "missing hash/variant/pageUrl/pack" });
    return stream.end();
  }

  const contentVersion = await nextContentVersion(pageUrl, variant);
  const finalPack = { ...pack, contentVersion, publishedAt: new Date().toISOString() };

  try {
    await ensureGitClone(stream);
  } catch (e) {
    stream.event({ type: "error", message: e.message });
    return stream.end();
  }

  const packDir = path.join(GIT_CLONE_DIR, "walkthru-worker", "packs", hash);
  fs.mkdirSync(packDir, { recursive: true });
  const packFile = path.join(packDir, `${variant}.json`);
  const relPath = path.relative(GIT_CLONE_DIR, packFile);
  fs.writeFileSync(packFile, JSON.stringify(finalPack, null, 2) + "\n");

  const title = finalPack.sourceTitle || pageUrl;
  const commitMsg = `walkthru: publish ${hash.slice(0, 12)}/${variant} v${contentVersion} — ${title}`;
  const code = await runGitSteps(stream, GIT_CLONE_DIR, [
    ["add", relPath],
    ["commit", "-m", commitMsg],
    ["push", "origin", "main"],
  ]);
  if (code !== 0) {
    stream.event({ type: "error", message: `git publish failed with code ${code} (see log above)` });
    return stream.end();
  }

  if (outDir && fs.existsSync(path.join(outDir, `${hash}-${variant}-audio`))) {
    const audioDir = path.join(outDir, `${hash}-${variant}-audio`);
    const files = fs.readdirSync(audioDir).filter((f) => f.endsWith(".mp3"));
    for (const f of files) {
      stream.log(`publishing audio ${f} to R2...`);
      const clipCode = await runStreaming(
        "npx", ["wrangler", "r2", "object", "put", `walkthru-packs/packs/${hash}/${variant}/${f}`, "--file", path.join(audioDir, f), "--content-type", "audio/mpeg", "--remote"],
        { cwd: WORKER_DIR, env: process.env },
        (line) => stream.log(line)
      );
      if (clipCode !== 0) stream.log(`  (warning: ${f} failed to publish, continuing)`);
    }
  }

  stream.event({ type: "done", hash, variant, contentVersion, pack: finalPack });
  stream.end();
}

// DELETE /api/pack — { hash, variant }
async function handleDelete(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  const { hash, variant } = body;
  if (!hash || !variant) return sendJson(res, 400, { error: "missing hash/variant" });

  const stream = ndjsonRes(res);
  try {
    await ensureGitClone(stream);
  } catch (e) {
    stream.event({ type: "error", message: e.message });
    return stream.end();
  }

  const relPath = path.join("walkthru-worker", "packs", hash, `${variant}.json`);
  if (!fs.existsSync(path.join(GIT_CLONE_DIR, relPath))) {
    stream.event({ type: "error", message: `${relPath} doesn't exist in git — nothing to delete` });
    return stream.end();
  }

  const code = await runGitSteps(stream, GIT_CLONE_DIR, [
    ["rm", relPath],
    ["commit", "-m", `walkthru: delete ${hash.slice(0, 12)}/${variant}`],
    ["push", "origin", "main"],
  ]);
  if (code !== 0) {
    stream.event({ type: "error", message: `git delete failed with code ${code} (see log above)` });
    return stream.end();
  }
  stream.event({ type: "done" });
  stream.end();
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": mimeFor(filePath) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  const p = parsed.pathname;
  try {
    if (p === "/api/lookup" && req.method === "GET") return void handleLookup(req, res, parsed.searchParams);
    if (p === "/api/hash" && req.method === "GET") return void handleHash(req, res, parsed.searchParams);
    if (p === "/api/generate" && req.method === "POST") return void handleGenerate(req, res);
    if (p === "/api/publish" && req.method === "POST") return void handlePublish(req, res);
    if (p === "/api/pack" && req.method === "DELETE") return void handleDelete(req, res);
    if (!p.startsWith("/api/")) return serveStatic(req, res, p);
    sendJson(res, 404, { error: "no such route" });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`walkthru-admin listening on http://127.0.0.1:${PORT}  (127.0.0.1 only — not exposed on your LAN)`);
  console.log(`worker: ${WORKER_URL}`);
});
