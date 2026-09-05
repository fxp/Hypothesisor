// Read-only lookup service in front of the walkthru packs checked into this
// repo at walkthru-worker/packs/. GET /walkthroughs?url=<page url> ->
// {walkthroughs:[...]} for every existing packs/${urlHash}/${variant}.json —
// one URL can have both a 标准版 and a 完整版, hence a list.
//
// Content lives in git (walkthru-worker/packs/), not R2 — publishing is
// `git commit && git push` to main (see walkthru-admin/server.mjs), and this
// Worker reads it back from raw.githubusercontent.com. That trades R2's
// write-then-instantly-visible property for free version history/diff/
// revert on every pack, at the cost of GitHub's own edge cache lag (a few
// minutes) on top of the short edge cache this Worker adds below. Audio
// clips (TTS) are unrelated to this and still live on R2's public bucket
// URL — build.mjs writes audioUrl as a direct pub-*.r2.dev link, this
// Worker never touches audio.
//
// normalizeUrl/urlHash below MUST stay byte-for-byte identical to
// chrome-extension-walkthru/lib/community.js — the extension no longer
// hashes client-side for lookups (it just passes the raw canonical url),
// but essay.js's export-hint still shows the hash it expects the file to
// be named, and that has to agree with what this Worker computes.

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/fxp/Hypothesisor/main/walkthru-worker/packs";
// Only two variants are ever published (see walkthru-builder/build.mjs) —
// there's no directory listing on raw.githubusercontent.com like R2's
// list({prefix}) gave us, so each lookup just probes both by name.
const KNOWN_VARIANTS = ["default", "deep"];
const EDGE_CACHE_TTL_SECONDS = 60;

const UTM_PREFIX = /^utm_/i;
const NOISE_NAME = /^(session|sess|sid|token|trace|traceid|request_?id|nonce|timestamp|ts|cache|cachebust|cb|rnd|rand|guid|uuid|v|ver|_)$/i;
const TRACKING_PARAMS = new Set([
  "gclid", "fbclid", "msclkid", "dclid", "twclid", "igshid", "yclid", "icid",
  "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi",
  "ref", "referrer", "source", "spm", "from", "si", "feature",
  "click_id", "clickid", "aff_id", "affid", "partner", "cmpid", "ncid", "wt_mc", "ito",
]);

function normalizeUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return url; }
  u.hash = "";
  const kept = [];
  for (const [k, v] of new URLSearchParams(u.search)) {
    if (UTM_PREFIX.test(k) || NOISE_NAME.test(k) || TRACKING_PARAMS.has(k.toLowerCase())) continue;
    kept.push([k, v]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  const qs = new URLSearchParams(kept).toString();
  u.search = qs ? `?${qs}` : "";
  return u.toString();
}

async function urlHash(url) {
  const bytes = new TextEncoder().encode(normalizeUrl(url));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extraHeaders },
  });
}

// Fetches one variant's pack JSON from GitHub. `cf.cacheTtl`/`cacheEverything`
// tells Cloudflare's own subrequest cache to hold the response at the edge
// for EDGE_CACHE_TTL_SECONDS regardless of GitHub's own cache headers, so
// repeat lookups for the same hash don't re-hit GitHub every time. Returns
// null on 404 or any error — a missing variant is a normal, expected
// outcome (most hashes only publish one of the two known variants).
async function fetchVariant(hash, variant) {
  const rawUrl = `${GITHUB_RAW_BASE}/${hash}/${variant}.json`;
  let resp;
  try {
    resp = await fetch(rawUrl, { cf: { cacheTtl: EDGE_CACHE_TTL_SECONDS, cacheEverything: true } });
  } catch (_) {
    return null;
  }
  if (resp.status !== 200) return null;
  try { return await resp.json(); } catch (_) { return null; }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname !== "/walkthroughs") {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const pageUrl = url.searchParams.get("url");
    if (!pageUrl) return json({ error: "missing_url_param" }, 400);

    let hash;
    try { hash = await urlHash(pageUrl); } catch (_) {
      return json({ walkthroughs: [] });
    }

    const results = await Promise.all(KNOWN_VARIANTS.map((v) => fetchVariant(hash, v)));
    const walkthroughs = results.filter(Boolean);
    // numeric:true makes this a natural sort — "ch2" before "ch10" — which
    // plain localeCompare gets wrong (lexicographic: ch1, ch10, ch11, ch2, ...),
    // breaking chapter reading order once a --chapters build passes 9 chapters.
    walkthroughs.sort((a, b) => String(a.variant || "").localeCompare(String(b.variant || ""), undefined, { numeric: true }));

    return json({ walkthroughs }, 200, { "Cache-Control": "public, max-age=60" });
  },
};
