#!/usr/bin/env python3
"""Regenerate walkthru-builder/PUBLISHED.md.

Re-scrapes the given Buzzwords episode pages for MUST-tagged must-read links,
checks walkthru-worker for existing packs on each URL, and rewrites
PUBLISHED.md as the single record of what's covered.

Usage:
    python3 census.py [episode ...]   # defaults to 100 101 — add new episode
                                       # numbers here as they ship
"""
import sys, re, json, subprocess, urllib.parse, pathlib

EPISODES = [int(a) for a in sys.argv[1:]] or [100, 101]
WORKER = "https://walkthru-worker.fxp007.workers.dev"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Domains that host primary-source PDFs / social posts rather than articles —
# these are deliberately never generated for (see /walkthru-generate skill).
PDF_DOMAINS = ("storage.courtlistener.com", "musicbusinessworldwide.com/files",
               "intelligence.house.gov/wp-content", "fsb.org/uploads")
X_DOMAINS = ("x.com/", "twitter.com/")


def fetch(url):
    return subprocess.run(["curl", "-sL", url, "-A", UA],
                           capture_output=True, text=True, check=True).stdout


def extract_must(html, ep):
    """Find every <span class="pod" id="pod-N">MUST</span> and walk backward
    to the nearest preceding <a href> — that's the item's source link. Can't
    just match "<a>...</a><span>MUST</span>" directly: most items wrap the
    <a> in a <strong> and/or stack src-badge spans in between."""
    items = []
    for m in re.finditer(r'<span class="pod" id="pod-(\d+)">MUST</span>', html):
        pod = int(m.group(1))
        window = html[max(0, m.start() - 1500):m.start()]
        hrefs = list(re.finditer(r'<a href="([^"]+)"[^>]*>([^<]*)</a>', window))
        if not hrefs:
            items.append({"ep": ep, "pod": pod, "url": None, "linktext": None})
            continue
        last = hrefs[-1]
        items.append({"ep": ep, "pod": pod, "url": last.group(1), "linktext": last.group(2)})
    return items


def lookup(url):
    enc = urllib.parse.quote(url, safe="")
    api = f"{WORKER}/walkthroughs?url={enc}"
    try:
        out = subprocess.run(["curl", "-s", "--max-time", "15", api],
                              capture_output=True, text=True, check=True).stdout
        packs = json.loads(out).get("walkthroughs", [])
    except Exception:
        packs = []
    variants, hash_ = [], None
    for p in packs:
        pid = p.get("id", "")
        hash_ = (pid.rsplit("-", 1)[0] if "-" in pid else None) or hash_
        variants.append({
            "label": p.get("variantLabel"),
            "steps": len(p.get("steps", [])),
            "sourceTitle": p.get("sourceTitle"),
        })
    return hash_, variants


def note_for_unpublished(url):
    if any(d in url for d in PDF_DOMAINS):
        return "原始 PDF/法律文书，非文章型信源"
    if any(d in url for d in X_DOMAINS):
        return "社交媒体帖，非文章型信源"
    return "未生成，可直接跑 `/walkthru-generate <url>` 补上"


def main():
    rows = []
    for ep in EPISODES:
        html = fetch(f"https://xiaopingfeng.com/buzzwords/{ep}")
        for it in extract_must(html, ep):
            if not it["url"]:
                continue
            hash_, variants = lookup(it["url"])
            rows.append({**it, "hash": hash_, "variants": variants})

    total = len(rows)
    published = sum(1 for r in rows if r["variants"])
    lines = [
        "# Walkthru 已发布讲解一览\n",
        "记录 xiaopingfeng.com/buzzwords 每期必读文章（页面上带 `MUST` 标记的条目）在",
        "`walkthru-worker`（Cloudflare Worker + R2）上当前发布的讲解版本，一个地方看全量覆盖情况。\n",
        "**维护方式：** 每次用 `/walkthru-generate` skill 生成并发布新讲解后，运行",
        f"`python3 walkthru-builder/census.py {' '.join(str(e) for e in EPISODES)}` 重新核对整表并覆盖本文件——",
        "不要手工编辑每一行，跑一遍脚本最快也最不容易漏。新一期上线后把期号加进上面命令。\n",
        f"**已覆盖/总数：** {published}/{total} 条 MUST 已有讲解\n",
    ]

    for ep in EPISODES:
        lines.append(f"\n## EP.{ep}\n")
        lines.append("| Pod | 标题 | URL | 已发布版本 | Hash | 备注 |")
        lines.append("|---|---|---|---|---|---|")
        for r in rows:
            if r["ep"] != ep:
                continue
            title = (r["variants"][0]["sourceTitle"] if r["variants"] else r["linktext"]) or ""
            title = title.replace("|", "\\|")
            url = r["url"]
            if r["variants"]:
                vstr = "; ".join(f"{v['label']}（{v['steps']}步）" for v in r["variants"])
                note = ""
            else:
                vstr, note = "—", note_for_unpublished(url)
            lines.append(f"| pod-{r['pod']:02d} | {title} | [{url}]({url}) | {vstr} | `{r['hash'] or ''}` | {note} |")

    out_path = pathlib.Path(__file__).parent / "PUBLISHED.md"
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out_path} — {published}/{total} covered")


if __name__ == "__main__":
    main()
