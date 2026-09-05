# walkthru-admin

Local web UI for generating and editing walkthru-packs — the missing piece
between `walkthru-builder/` (a CLI you have to remember flags for) and
`walkthru-worker/` (read-only, no write API of its own).

It doesn't reimplement generation or publishing. It wraps:
- `node build.mjs ...` (in `../walkthru-builder`) for generation
- `git add/commit/push` for publish/delete — pack content lives in git
  (`walkthru-worker/packs/`), and `walkthru-worker` reads it back from
  raw.githubusercontent.com, not from a database. Audio (TTS) clips are the
  one exception: they still go to R2's public bucket URL via
  `wrangler r2 object put`, since they're binary and unrelated to git.
- `GET /walkthroughs?url=` on the deployed Worker for browsing/looking up

as child processes, so it can never drift from how those actually behave.

Publish/delete run in their own clone at `~/.walkthru-worker-git`
(auto-created on first use), **not** in this repo's own working tree — that
tree lives inside an iCloud-synced folder, where git has been known to hit
`mmap failed: Operation timed out`, and its `main` branch may be locally
diverged from `origin/main` for unrelated reasons anyway. The dedicated
clone gets hard-reset to `origin/main` before every publish/delete, so it
never carries drift and every push is a clean fast-forward. Override the
remote/clone location with `WALKTHRU_GIT_REMOTE` / `WALKTHRU_GIT_CLONE_DIR`
if needed.

## Run it

```bash
cd walkthru-admin
node server.mjs
```

Then open http://127.0.0.1:5391 — binds to loopback only, never exposed on
your LAN. Needs the same environment variables `build.mjs` needs
(`BIGMODEL_API_KEY`, and `VOLCENGINE_API_KEY`/`OPENROUTER_API_KEY` if you use
TTS/image annotation) already exported in the shell you launch it from —
this server never sees or stores API keys itself, it just inherits your
shell's env when it spawns `node build.mjs`.

## What it does

1. **查找已发布** — enter a page URL, see every published variant (标准版/
   完整版/whatever), with step counts and content versions. 编辑 loads a
   pack into the editor below; 删除 removes it (git rm + commit + push).
2. **生成新版本** — paste the article's source text (no browser automation
   here — copy it from wherever you read the article), pick 标准版 or
   完整版 (chapters), optionally attach images (file + CSS selector +
   anchor quote for placement), optionally enable TTS. Streams `build.mjs`'s
   own log output live while it runs.
3. **编辑 / 发布** — intro/essay/outro as text, steps as reorderable cards
   (title/narration/kind editable; a text step's `quote` is shown read-only
   — editing it would break the live-page highlight since it has to match
   the source verbatim; "+ 添加一步" adds a new step with an editable quote
   instead — paste it verbatim from the source or it'll be skipped at play
   time). 发布 commits+pushes with an auto-bumped `contentVersion`;
   删除这个版本 does the same as a `git rm`.

## What it deliberately doesn't do

- No auth — this is a single-operator local tool, same trust model as
  running `build.mjs` yourself. Don't put it behind a public port.
- No browser automation to fetch article text or screenshot images —
  keeps this dependency-free; paste text and image files by hand, same as
  the CLI already requires via `--text-file`/`--images-file`.
- No visual box editor for an image step's highlighted sub-region — edit
  the explanation text, but re-run generation if the box itself is wrong.
