// A2UI v0.10 — minimal client renderer.
// Reference: https://github.com/google/A2UI/blob/main/specification/v0_10/docs/a2ui_protocol.md
//
// We implement a subset of the basic catalog (Text, Column, Row, Card,
// Button, TextField, CheckBox, Divider, Image, Icon, List) — enough to
// host the L3 reformat outputs without arbitrary code execution.
//
// Trust model: A2UI is declarative data, not code. The component tree is
// validated against the catalog whitelist at render time; unknown
// components render as a neutral placeholder. Inputs / clicks fire
// local-only events through a handler the host wires up.

export const CATALOG_ID = "https://a2ui.org/specification/v0_10/basic_catalog.json";
export const PROTOCOL_VERSION = "v0.10";

// Basic catalog (v0.10) we implement + Hypothesisor's extended set.
// Extended components live under our own catalogId namespace
// (https://hypothesisor.fxp.dev/catalog/v0.4/extended). They cover the
// rich-content cases the basic catalog doesn't: stat tiles, charts,
// comparison tables, timelines — the things that actually show off
// what A2UI buys you over markdown.
const SUPPORTED = new Set([
  // basic catalog v0.10
  "Text", "Column", "Row", "Card", "List", "Divider",
  "Button", "TextField", "CheckBox", "ChoicePicker", "Slider",
  "Tabs", "Icon", "Image",
  // Hypothesisor extended
  "StatTile", "KeyValue", "Highlight", "ProgressBar",
  "BarChart", "LineChart", "Timeline", "ComparisonTable",
  "MapView",
]);

// ─── State container ────────────────────────────────────────────────

export class A2uiSurface {
  constructor(root, { onAction, theme } = {}) {
    this.root = root;                     // host element (Shadow DOM root)
    this.components = new Map();          // id → component spec
    this.dataModel = {};                  // path-keyed data
    this.theme = theme || {};
    this.onAction = onAction || (() => {});
    this.surfaceId = null;
    this.catalogId = null;
    this._componentEls = new Map();       // id → DOM element
  }

  // Apply a server→client envelope message.
  apply(msg) {
    if (msg.createSurface) {
      this.surfaceId = msg.createSurface.surfaceId;
      this.catalogId = msg.createSurface.catalogId;
      if (msg.createSurface.theme) Object.assign(this.theme, msg.createSurface.theme);
    } else if (msg.updateComponents) {
      const comps = msg.updateComponents.components || [];
      for (const c of comps) this.components.set(c.id, c);
      this.render();
    } else if (msg.updateDataModel) {
      const path = msg.updateDataModel.path || "/";
      const value = msg.updateDataModel.value;
      if (path === "/" || path === "") {
        this.dataModel = value === undefined ? {} : value;
      } else {
        this._setByPath(path, value);
      }
      this.render();
    } else if (msg.deleteSurface) {
      this.components.clear();
      this.dataModel = {};
      this._componentEls.clear();
      this.root.innerHTML = "";
    }
  }

  // Apply an array of envelopes (typical full-stream replay).
  applyAll(msgs) {
    for (const m of msgs) this.apply(m);
  }

  render() {
    if (!this.components.has("root")) return;
    this.root.innerHTML = "";
    this._componentEls.clear();
    const tree = this._renderById("root");
    if (tree) this.root.appendChild(tree);
  }

  // ─── Internals ────────────────────────────────────────────────────

  _resolve(value) {
    // If value is a {path} binding, resolve through the data model.
    if (value && typeof value === "object" && typeof value.path === "string") {
      return this._getByPath(value.path);
    }
    return value;
  }

  _getByPath(path) {
    if (!path || path === "/") return this.dataModel;
    const parts = path.replace(/^\//, "").split("/");
    let cur = this.dataModel;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[decodeJsonPointer(p)];
    }
    return cur;
  }

  _setByPath(path, val) {
    if (!path || path === "/") { this.dataModel = val == null ? {} : val; return; }
    const parts = path.replace(/^\//, "").split("/").map(decodeJsonPointer);
    let cur = this.dataModel;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    if (val === undefined) delete cur[parts[parts.length - 1]];
    else cur[parts[parts.length - 1]] = val;
  }

  _renderById(id) {
    const spec = this.components.get(id);
    if (!spec) return placeholder(`?${id}`);
    if (!SUPPORTED.has(spec.component)) return placeholder(`unsupported: ${spec.component}`);
    const el = this._renderComponent(spec);
    this._componentEls.set(id, el);
    return el;
  }

  _renderComponent(spec) {
    const r = this._resolve.bind(this);
    switch (spec.component) {
      case "Text": {
        const el = document.createElement("div");
        el.className = "a2ui-text" + (spec.variant ? " a2ui-text--" + spec.variant : "");
        const txt = String(r(spec.text) ?? "");
        el.innerHTML = renderInlineMarkdown(txt);
        return el;
      }
      case "Column": case "Row": {
        const el = document.createElement("div");
        el.className = spec.component === "Row" ? "a2ui-row" : "a2ui-column";
        if (spec.justify) el.style.justifyContent = mapJustify(spec.justify);
        if (spec.align)   el.style.alignItems = mapAlign(spec.align);
        if (spec.gap)     el.style.gap = px(spec.gap);
        for (const cid of spec.children || []) {
          const child = this._renderById(cid);
          if (child) {
            if (spec.weight != null) child.style.flex = String(spec.weight);
            el.appendChild(child);
          }
        }
        return el;
      }
      case "Card": {
        const el = document.createElement("div");
        el.className = "a2ui-card";
        if (spec.child) {
          const child = this._renderById(spec.child);
          if (child) el.appendChild(child);
        }
        return el;
      }
      case "List": {
        // List spreads a child template over an array binding.
        const el = document.createElement("div");
        el.className = "a2ui-list";
        const items = r(spec.value) || [];
        const tpl = spec.itemTemplate; // can be a child id or a sub-tree
        if (Array.isArray(items)) {
          items.forEach((item, idx) => {
            const tplId = typeof tpl === "string" ? tpl : null;
            if (tplId && this.components.has(tplId)) {
              // Render template once per item; we don't yet support
              // per-item path scoping fully — simple case: items are
              // primitives we render as Text rows.
              const row = document.createElement("div");
              row.className = "a2ui-list-item";
              row.textContent = typeof item === "string" ? item : JSON.stringify(item);
              el.appendChild(row);
            } else {
              const row = document.createElement("div");
              row.className = "a2ui-list-item";
              row.textContent = typeof item === "string" ? item : JSON.stringify(item);
              el.appendChild(row);
            }
          });
        }
        return el;
      }
      case "Divider": {
        const el = document.createElement("hr");
        el.className = "a2ui-divider" + (spec.axis === "vertical" ? " a2ui-divider--v" : "");
        return el;
      }
      case "Button": {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "a2ui-btn" + (spec.variant ? " a2ui-btn--" + spec.variant : "");
        if (spec.child) {
          const c = this._renderById(spec.child);
          if (c) el.appendChild(c);
        } else if (spec.label) {
          el.textContent = String(r(spec.label));
        }
        if (spec.action) {
          el.addEventListener("click", () => this._fireAction(spec, "click"));
        }
        return el;
      }
      case "TextField": {
        const wrap = document.createElement("label");
        wrap.className = "a2ui-textfield";
        if (spec.label) {
          const lab = document.createElement("span");
          lab.className = "a2ui-textfield-label";
          lab.textContent = String(r(spec.label));
          wrap.appendChild(lab);
        }
        const inp = document.createElement("input");
        inp.type = spec.variant === "longText" ? "text" : "text";
        const cur = r(spec.value);
        inp.value = cur == null ? "" : String(cur);
        inp.addEventListener("input", () => {
          if (spec.value && spec.value.path) {
            this._setByPath(spec.value.path, inp.value);
            this._reactiveRender();
          }
          if (spec.action) this._fireAction(spec, "change", inp.value);
        });
        wrap.appendChild(inp);
        return wrap;
      }
      case "CheckBox": {
        const wrap = document.createElement("label");
        wrap.className = "a2ui-checkbox";
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = !!r(spec.value);
        inp.addEventListener("change", () => {
          if (spec.value && spec.value.path) {
            this._setByPath(spec.value.path, inp.checked);
            this._reactiveRender();
          }
          if (spec.action) this._fireAction(spec, "change", inp.checked);
        });
        wrap.appendChild(inp);
        if (spec.label) {
          const lab = document.createElement("span");
          lab.textContent = String(r(spec.label));
          wrap.appendChild(lab);
        }
        return wrap;
      }
      case "Icon": {
        const el = document.createElement("span");
        el.className = "a2ui-icon";
        el.setAttribute("role", "img");
        el.textContent = mapIcon(spec.name) || "•";
        return el;
      }
      case "Image": {
        const el = document.createElement("img");
        el.className = "a2ui-image";
        el.src = String(r(spec.src) || "");
        el.alt = String(r(spec.alt) || "");
        el.loading = "lazy";
        return el;
      }

      case "ChoicePicker": {
        const wrap = document.createElement("div");
        wrap.className = "a2ui-choice" + (spec.variant === "mutuallyExclusive" ? " a2ui-choice--single" : " a2ui-choice--multi");
        const cur = r(spec.value);
        const isSel = (v) => spec.variant === "mutuallyExclusive" ? cur === v : Array.isArray(cur) && cur.includes(v);
        for (const opt of spec.options || []) {
          const ch = document.createElement("button");
          ch.type = "button";
          ch.className = "a2ui-choice-chip" + (isSel(opt.value) ? " active" : "");
          ch.textContent = opt.label || opt.value;
          ch.addEventListener("click", () => {
            if (!spec.value || !spec.value.path) return;
            if (spec.variant === "mutuallyExclusive") {
              this._setByPath(spec.value.path, opt.value);
            } else {
              const arr = Array.isArray(cur) ? cur.slice() : [];
              const i = arr.indexOf(opt.value);
              if (i >= 0) arr.splice(i, 1); else arr.push(opt.value);
              this._setByPath(spec.value.path, arr);
            }
            this._reactiveRender();
            if (spec.action) this._fireAction(spec, "change", opt.value);
          });
          wrap.appendChild(ch);
        }
        return wrap;
      }

      case "Slider": {
        const wrap = document.createElement("label");
        wrap.className = "a2ui-slider";
        if (spec.label) {
          const lab = document.createElement("span");
          lab.className = "a2ui-slider-label";
          const cur = r(spec.value);
          lab.textContent = `${r(spec.label)}: ${cur ?? spec.min ?? 0}`;
          wrap.appendChild(lab);
        }
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = String(spec.min ?? 0);
        inp.max = String(spec.max ?? 100);
        inp.step = String(spec.step ?? 1);
        inp.value = String(r(spec.value) ?? spec.min ?? 0);
        inp.addEventListener("input", () => {
          if (spec.value && spec.value.path) {
            this._setByPath(spec.value.path, Number(inp.value));
            this._reactiveRender();
          }
          if (spec.action) this._fireAction(spec, "change", Number(inp.value));
        });
        wrap.appendChild(inp);
        return wrap;
      }

      case "Tabs": {
        const wrap = document.createElement("div");
        wrap.className = "a2ui-tabs";
        const tabs = spec.tabs || [];
        const activePath = spec.value && spec.value.path;
        let active = (activePath ? r(spec.value) : null) ?? (tabs[0] && tabs[0].id);
        const bar = document.createElement("div");
        bar.className = "a2ui-tabs-bar";
        const pane = document.createElement("div");
        pane.className = "a2ui-tabs-pane";
        for (const tab of tabs) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "a2ui-tab" + (tab.id === active ? " active" : "");
          btn.textContent = tab.label || tab.id;
          btn.addEventListener("click", () => {
            if (activePath) { this._setByPath(activePath, tab.id); this._reactiveRender(); }
          });
          bar.appendChild(btn);
        }
        const activeTab = tabs.find((t) => t.id === active) || tabs[0];
        if (activeTab && activeTab.contentId) {
          const c = this._renderById(activeTab.contentId);
          if (c) pane.appendChild(c);
        }
        wrap.appendChild(bar);
        wrap.appendChild(pane);
        return wrap;
      }

      // ─── Hypothesisor extended catalog ──────────────────────────

      case "StatTile": {
        const el = document.createElement("div");
        el.className = "a2ui-stat" + (spec.accent ? ` a2ui-stat--${spec.accent}` : "");
        const label = String(r(spec.label) ?? "");
        const value = String(r(spec.value) ?? "");
        const unit = String(r(spec.unit) ?? "");
        const delta = spec.delta != null ? String(r(spec.delta)) : null;
        const dir = spec.deltaDirection;
        el.innerHTML = `
          <div class="a2ui-stat-label"></div>
          <div class="a2ui-stat-value-row">
            <span class="a2ui-stat-value"></span>
            ${unit ? `<span class="a2ui-stat-unit"></span>` : ""}
          </div>
          ${delta != null ? `<div class="a2ui-stat-delta a2ui-stat-delta--${dir || "neutral"}"></div>` : ""}
        `;
        el.querySelector(".a2ui-stat-label").textContent = label;
        el.querySelector(".a2ui-stat-value").textContent = value;
        if (unit) el.querySelector(".a2ui-stat-unit").textContent = unit;
        if (delta != null) {
          const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
          el.querySelector(".a2ui-stat-delta").textContent = `${arrow} ${delta}`;
        }
        return el;
      }

      case "KeyValue": {
        const el = document.createElement("dl");
        el.className = "a2ui-kv";
        const items = r(spec.items) || [];
        for (const it of items) {
          const dt = document.createElement("dt");
          dt.textContent = String(it.key ?? it.label ?? "");
          const dd = document.createElement("dd");
          dd.textContent = String(it.value ?? "");
          el.appendChild(dt);
          el.appendChild(dd);
        }
        return el;
      }

      case "Highlight": {
        const el = document.createElement("blockquote");
        el.className = "a2ui-highlight" + (spec.accent ? ` a2ui-highlight--${spec.accent}` : "");
        const text = document.createElement("p");
        text.className = "a2ui-highlight-text";
        text.innerHTML = renderInlineMarkdown(String(r(spec.text) ?? ""));
        el.appendChild(text);
        if (spec.source) {
          const src = document.createElement("cite");
          src.className = "a2ui-highlight-source";
          src.textContent = "— " + String(r(spec.source));
          el.appendChild(src);
        }
        return el;
      }

      case "ProgressBar": {
        const wrap = document.createElement("div");
        wrap.className = "a2ui-progress";
        if (spec.label) {
          const lab = document.createElement("div");
          lab.className = "a2ui-progress-label";
          lab.textContent = String(r(spec.label));
          wrap.appendChild(lab);
        }
        const max = Number(r(spec.max) ?? 100);
        const val = Math.max(0, Math.min(max, Number(r(spec.value) ?? 0)));
        const pct = max > 0 ? (val / max) * 100 : 0;
        const track = document.createElement("div");
        track.className = "a2ui-progress-track";
        const bar = document.createElement("div");
        bar.className = "a2ui-progress-fill";
        bar.style.width = pct.toFixed(1) + "%";
        track.appendChild(bar);
        wrap.appendChild(track);
        if (spec.showValue !== false) {
          const v = document.createElement("div");
          v.className = "a2ui-progress-value";
          v.textContent = `${val} / ${max}`;
          wrap.appendChild(v);
        }
        return wrap;
      }

      case "BarChart": {
        const data = r(spec.data) || [];
        return renderBarChart(data, {
          xLabel: r(spec.xLabel),
          yLabel: r(spec.yLabel),
          height: Number(spec.height) || 220,
          colorAccent: spec.colorAccent,
        });
      }

      case "LineChart": {
        const data = r(spec.data) || [];
        return renderLineChart(data, {
          xLabel: r(spec.xLabel),
          yLabel: r(spec.yLabel),
          height: Number(spec.height) || 220,
        });
      }

      case "Timeline": {
        const wrap = document.createElement("ol");
        wrap.className = "a2ui-timeline";
        const items = r(spec.items) || [];
        for (const it of items) {
          const li = document.createElement("li");
          li.className = "a2ui-timeline-item";
          li.innerHTML = `
            <span class="a2ui-timeline-dot"></span>
            <div class="a2ui-timeline-body">
              <div class="a2ui-timeline-when"></div>
              <div class="a2ui-timeline-title"></div>
              <div class="a2ui-timeline-detail"></div>
            </div>`;
          li.querySelector(".a2ui-timeline-when").textContent = String(it.when ?? "");
          li.querySelector(".a2ui-timeline-title").textContent = String(it.title ?? "");
          li.querySelector(".a2ui-timeline-detail").innerHTML = renderInlineMarkdown(String(it.detail ?? ""));
          wrap.appendChild(li);
        }
        return wrap;
      }

      case "MapView": {
        // Stylized SVG map with toggleable point layers. Coordinates
        // are 0-100 (% of canvas), so the LLM doesn't need real geo.
        const layers = (spec.layers || []).map((l) => ({ ...l }));
        const points = (spec.points || []);
        const visiblePath = spec.value && spec.value.path;
        // Visible layer ids: from data model if bound, else all visible.
        let visible = visiblePath ? r(spec.value) : null;
        if (!Array.isArray(visible)) visible = layers.map((l) => l.id);

        const wrap = document.createElement("div");
        wrap.className = "a2ui-map";

        // Layer toggle bar
        const bar = document.createElement("div");
        bar.className = "a2ui-map-layers";
        for (const l of layers) {
          const chip = document.createElement("button");
          chip.type = "button";
          const on = visible.includes(l.id);
          chip.className = "a2ui-map-layer" + (on ? " active" : "");
          chip.style.setProperty("--layer-color", l.color || "var(--a2ui-color-primary)");
          chip.innerHTML = `<span class="a2ui-map-layer-dot"></span><span class="a2ui-map-layer-icon">${escapeAttr(l.icon || "")}</span><span class="a2ui-map-layer-label"></span><span class="a2ui-map-layer-count"></span>`;
          chip.querySelector(".a2ui-map-layer-label").textContent = l.label || l.id;
          chip.querySelector(".a2ui-map-layer-count").textContent =
            "(" + points.filter((p) => p.layer === l.id).length + ")";
          chip.addEventListener("click", () => {
            const cur = (visiblePath ? r(spec.value) : null) || layers.map((x) => x.id);
            const next = cur.includes(l.id) ? cur.filter((x) => x !== l.id) : [...cur, l.id];
            if (visiblePath) {
              this._setByPath(visiblePath, next);
              this._reactiveRender();
            } else {
              chip.classList.toggle("active");
              wrap.querySelectorAll(`[data-layer="${l.id}"]`).forEach((n) => {
                n.style.display = next.includes(l.id) ? "" : "none";
              });
            }
          });
          bar.appendChild(chip);
        }
        wrap.appendChild(bar);

        // Map + side panel
        const main = document.createElement("div");
        main.className = "a2ui-map-main";
        const svgWrap = document.createElement("div");
        svgWrap.className = "a2ui-map-svg-wrap";
        const W = 600, H = 380;
        const svg = mkSvg("svg", { viewBox: `0 0 ${W} ${H}`, class: "a2ui-map-svg" });
        svg.style.width = "100%";
        svg.style.height = "auto";
        svg.appendChild(buildMapBackground(spec.background, W, H));

        // Optional route polyline (if points have a `step` index, draw lines in step order)
        const stepped = points.filter((p) => Number.isFinite(p.step)).sort((a, b) => a.step - b.step);
        if (stepped.length >= 2) {
          const path = stepped.map((p, i) => (i === 0 ? "M" : "L") + (p.x / 100 * W).toFixed(1) + " " + (p.y / 100 * H).toFixed(1)).join(" ");
          svg.appendChild(mkSvg("path", { d: path, class: "a2ui-map-route" }));
        }

        // Point markers
        points.forEach((p, i) => {
          const layer = layers.find((l) => l.id === p.layer) || {};
          const cx = (p.x / 100) * W;
          const cy = (p.y / 100) * H;
          const g = mkSvg("g", { class: "a2ui-map-point", "data-layer": p.layer || "", "data-i": String(i) });
          g.style.cursor = "pointer";
          if (!visible.includes(p.layer)) g.style.display = "none";
          g.appendChild(mkSvg("circle", { cx, cy, r: 14, class: "a2ui-map-point-bg", fill: layer.color || "var(--a2ui-color-primary)", "fill-opacity": "0.18" }));
          g.appendChild(mkSvg("circle", { cx, cy, r: 7, class: "a2ui-map-point-dot", fill: layer.color || "var(--a2ui-color-primary)" }));
          g.appendChild(mkSvg("text", { x: cx, y: cy + 24, "text-anchor": "middle", class: "a2ui-map-point-label" }, p.name || ""));
          if (Number.isFinite(p.step)) {
            g.appendChild(mkSvg("text", { x: cx, y: cy + 4, "text-anchor": "middle", class: "a2ui-map-point-step" }, String(p.step)));
          }
          g.addEventListener("click", () => {
            const all = wrap.querySelectorAll(".a2ui-map-point.selected");
            all.forEach((n) => n.classList.remove("selected"));
            g.classList.add("selected");
            renderDetailFor(p);
          });
          svg.appendChild(g);
        });
        svgWrap.appendChild(svg);

        const detail = document.createElement("div");
        detail.className = "a2ui-map-detail";
        function renderDetailFor(p) {
          const layer = layers.find((l) => l.id === p?.layer) || {};
          if (!p) {
            detail.innerHTML = `<div class="a2ui-map-detail-empty">点击地图上的标记查看详情</div>`;
            return;
          }
          detail.innerHTML = `
            <div class="a2ui-map-detail-header">
              <span class="a2ui-map-detail-icon" style="color:${escapeAttr(layer.color || "var(--a2ui-color-primary)")}">${escapeAttr(layer.icon || "📍")}</span>
              <div>
                <div class="a2ui-map-detail-name"></div>
                <div class="a2ui-map-detail-layer"></div>
              </div>
            </div>
            ${p.detail ? `<div class="a2ui-map-detail-body"></div>` : ""}
            ${p.tags ? `<div class="a2ui-map-detail-tags">${p.tags.map(t => `<span class="a2ui-map-detail-tag"></span>`).join("")}</div>` : ""}
          `;
          detail.querySelector(".a2ui-map-detail-name").textContent = p.name || "";
          detail.querySelector(".a2ui-map-detail-layer").textContent = layer.label || p.layer || "";
          if (p.detail) detail.querySelector(".a2ui-map-detail-body").innerHTML = renderInlineMarkdown(String(p.detail));
          if (p.tags) {
            detail.querySelectorAll(".a2ui-map-detail-tag").forEach((el, i) => { el.textContent = String(p.tags[i]); });
          }
        }
        renderDetailFor(points[0] || null);
        if (points[0]) {
          // mark first as selected initially
          const firstNode = svg.querySelector(`.a2ui-map-point[data-i="0"]`);
          firstNode && firstNode.classList.add("selected");
        }
        main.appendChild(svgWrap);
        main.appendChild(detail);
        wrap.appendChild(main);
        return wrap;
      }

      case "ComparisonTable": {
        const cols = spec.columns || [];
        const rows = r(spec.rows) || [];
        const tbl = document.createElement("table");
        tbl.className = "a2ui-cmp";
        const thead = document.createElement("thead");
        const trH = document.createElement("tr");
        for (const c of cols) {
          const th = document.createElement("th");
          th.textContent = String(c.label ?? c.key ?? "");
          if (c.accent) th.classList.add("a2ui-cmp-accent");
          trH.appendChild(th);
        }
        thead.appendChild(trH);
        tbl.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const row of rows) {
          const tr = document.createElement("tr");
          for (const c of cols) {
            const td = document.createElement("td");
            const v = row[c.key];
            if (v && typeof v === "object" && (v.value !== undefined || v.note !== undefined)) {
              td.innerHTML = `
                <div class="a2ui-cmp-cell-value"></div>
                ${v.note ? `<div class="a2ui-cmp-cell-note"></div>` : ""}
              `;
              td.querySelector(".a2ui-cmp-cell-value").textContent = String(v.value ?? "");
              if (v.note) td.querySelector(".a2ui-cmp-cell-note").textContent = String(v.note);
              if (v.accent) td.classList.add("a2ui-cmp-accent");
            } else {
              td.textContent = String(v ?? "");
            }
            if (c.accent) td.classList.add("a2ui-cmp-accent");
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);
        return tbl;
      }

      default:
        return placeholder(`unsupported: ${spec.component}`);
    }
  }

  _fireAction(spec, kind, value) {
    const evt = spec.action?.event;
    if (!evt) return;
    const ctx = {};
    for (const [k, v] of Object.entries(evt.context || {})) ctx[k] = this._resolve(v);
    this.onAction({ name: evt.name, context: ctx, kind, value, surfaceId: this.surfaceId });
  }

  // After a write to data model, only re-render bindings cheaply by
  // re-walking the tree. (A more sophisticated impl would track which
  // components depend on which path; this is fine for popup-sized UIs.)
  _reactiveRender() {
    this.render();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function decodeJsonPointer(p) {
  return p.replace(/~1/g, "/").replace(/~0/g, "~");
}

function placeholder(label) {
  const el = document.createElement("div");
  el.className = "a2ui-placeholder";
  el.textContent = label;
  return el;
}

function mapJustify(j) {
  return ({
    start: "flex-start", end: "flex-end", center: "center",
    spaceBetween: "space-between", spaceAround: "space-around", spaceEvenly: "space-evenly",
  })[j] || "flex-start";
}

function mapAlign(a) {
  return ({
    start: "flex-start", end: "flex-end", center: "center",
    stretch: "stretch", baseline: "baseline",
  })[a] || "stretch";
}

function px(v) {
  if (typeof v === "number") return v + "px";
  return String(v || "");
}

// Tiny icon name → emoji map. Catalog icons are rendered as emoji glyphs
// to avoid bundling an icon font.
function mapIcon(name) {
  const m = {
    mail: "✉️", check: "✓", warning: "⚠️", info: "ℹ️", error: "✗",
    star: "⭐", heart: "❤️", clock: "⏱", map: "🗺️", money: "💰",
    chart: "📊", search: "🔍", arrow_right: "→", arrow_left: "←",
    chevron_down: "▾", chevron_up: "▴",
  };
  return m[name] || "";
}

// ─── SVG chart renderers (extended catalog) ─────────────────────────

function renderBarChart(data, opts) {
  const arr = Array.isArray(data) ? data.filter((d) => d && d.label != null) : [];
  const w = 600, h = opts.height || 220, padL = 56, padR = 16, padT = 10, padB = 36;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...arr.map((d) => Number(d.value) || 0));
  const barW = arr.length ? Math.max(8, chartW / arr.length - 8) : 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "a2ui-chart a2ui-chart--bar");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = h + "px";
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (chartH * i) / 4;
    const v = (max * i) / 4;
    svg.appendChild(mkSvg("line", { x1: padL, x2: padL + chartW, y1: y, y2: y, class: "a2ui-chart-grid" }));
    svg.appendChild(mkSvg("text", { x: padL - 8, y: y + 4, "text-anchor": "end", class: "a2ui-chart-tick" }, fmtTick(v)));
  }
  arr.forEach((d, i) => {
    const x = padL + i * (chartW / arr.length) + (chartW / arr.length - barW) / 2;
    const v = Number(d.value) || 0;
    const bh = (v / max) * chartH;
    const y = padT + chartH - bh;
    svg.appendChild(mkSvg("rect", { x, y, width: barW, height: bh, rx: 4, class: "a2ui-chart-bar" }));
    svg.appendChild(mkSvg("text", { x: x + barW / 2, y: padT + chartH + 18, "text-anchor": "middle", class: "a2ui-chart-xlabel" }, String(d.label)));
    svg.appendChild(mkSvg("text", { x: x + barW / 2, y: y - 5, "text-anchor": "middle", class: "a2ui-chart-value" }, fmtTick(v)));
  });
  return svg;
}

function renderLineChart(data, opts) {
  const arr = Array.isArray(data) ? data.filter((d) => d && d.label != null) : [];
  const w = 600, h = opts.height || 220, padL = 56, padR = 16, padT = 10, padB = 36;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...arr.map((d) => Number(d.value) || 0));
  const min = Math.min(0, ...arr.map((d) => Number(d.value) || 0));
  const range = max - min || 1;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "a2ui-chart a2ui-chart--line");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.width = "100%";
  svg.style.height = h + "px";
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (chartH * i) / 4;
    const v = min + (range * i) / 4;
    svg.appendChild(mkSvg("line", { x1: padL, x2: padL + chartW, y1: y, y2: y, class: "a2ui-chart-grid" }));
    svg.appendChild(mkSvg("text", { x: padL - 8, y: y + 4, "text-anchor": "end", class: "a2ui-chart-tick" }, fmtTick(v)));
  }
  if (arr.length > 1) {
    const pts = arr.map((d, i) => {
      const x = padL + (i / (arr.length - 1)) * chartW;
      const v = Number(d.value) || 0;
      const y = padT + chartH - ((v - min) / range) * chartH;
      return [x, y];
    });
    const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = `${path} L ${pts[pts.length-1][0].toFixed(1)} ${(padT + chartH).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(padT + chartH).toFixed(1)} Z`;
    svg.appendChild(mkSvg("path", { d: area, class: "a2ui-chart-area" }));
    svg.appendChild(mkSvg("path", { d: path, class: "a2ui-chart-line" }));
    pts.forEach(([x, y], i) => {
      svg.appendChild(mkSvg("circle", { cx: x, cy: y, r: 3.5, class: "a2ui-chart-dot" }));
      svg.appendChild(mkSvg("text", { x, y: padT + chartH + 18, "text-anchor": "middle", class: "a2ui-chart-xlabel" }, String(arr[i].label)));
    });
  }
  return svg;
}

function buildMapBackground(kind, W, H) {
  const g = mkSvg("g", { class: "a2ui-map-bg" });
  // Light parchment base for any preset.
  g.appendChild(mkSvg("rect", { x: 0, y: 0, width: W, height: H, fill: "#fbf7f0", rx: 12 }));
  if (kind === "coast" || kind === "peninsula") {
    // Hint at sea on right + bottom (great for coastal travel guides).
    g.appendChild(mkSvg("path", {
      d: `M ${W} 0 L ${W} ${H} L 0 ${H} Q ${W * 0.55} ${H * 0.65} ${W * 0.7} ${H * 0.35} Q ${W * 0.85} ${H * 0.15} ${W} 0 Z`,
      fill: "#cfe6ee", opacity: "0.55",
    }));
    g.appendChild(mkSvg("text", { x: W - 24, y: H - 16, "text-anchor": "end", class: "a2ui-map-bg-label" }, "🌊"));
  } else if (kind === "island") {
    g.appendChild(mkSvg("rect", { x: 0, y: 0, width: W, height: H, fill: "#cfe6ee" }));
    g.appendChild(mkSvg("ellipse", { cx: W / 2, cy: H / 2, rx: W * 0.42, ry: H * 0.42, fill: "#fbf7f0" }));
  } else if (kind === "city") {
    // Subtle grid suggesting blocks.
    for (let x = W / 6; x < W; x += W / 6) g.appendChild(mkSvg("line", { x1: x, x2: x, y1: 0, y2: H, stroke: "#e9e1d4", "stroke-width": "1" }));
    for (let y = H / 4; y < H; y += H / 4) g.appendChild(mkSvg("line", { x1: 0, x2: W, y1: y, y2: y, stroke: "#e9e1d4", "stroke-width": "1" }));
  }
  // Subtle border
  g.appendChild(mkSvg("rect", { x: 0.5, y: 0.5, width: W - 1, height: H - 1, fill: "none", stroke: "#e2dccb", "stroke-width": "1", rx: 12 }));
  return g;
}

function escapeAttr(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function mkSvg(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = String(text);
  return el;
}

function fmtTick(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

// Inline-only markdown subset: **bold**, *italic*, `code`. Intentionally
// no links / images / HTML — keeps Text content fully data-driven.
function renderInlineMarkdown(s) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// Default stylesheet — uses the same CSS custom-property tokens
// (`--a2ui-*`) as Google's official @a2ui/lit renderer so themes built
// for either implementation render visually consistent. Token names
// match https://github.com/google/A2UI/tree/main/renderers/lit
// (Card.ts, Button.ts, etc.). Hosts can override any token at the
// surface root (e.g. style="--a2ui-color-primary: #ff0066").
export const DEFAULT_STYLESHEET = `
  *, *::before, *::after { box-sizing: border-box; }
  :host, .a2ui-root {
    /* Design tokens — aligned with @a2ui/lit's variable names */
    --a2ui-color-primary:        #2563EB;
    --a2ui-color-primary-hover:  #1d4fc4;
    --a2ui-color-on-primary:     #ffffff;
    --a2ui-color-surface:        #ffffff;
    --a2ui-color-on-surface:     #0f172a;
    --a2ui-color-secondary:      #f8fafc;
    --a2ui-color-secondary-hover:#e2e8f0;
    --a2ui-color-on-secondary:   #1e293b;
    --a2ui-color-border:         #e2e8f0;
    --a2ui-color-border-strong:  #cbd5e1;
    --a2ui-color-mute:           #64748b;
    --a2ui-color-highlight:      #fef9c3;
    --a2ui-spacing-xs:           4px;
    --a2ui-spacing-s:            8px;
    --a2ui-spacing-m:            12px;
    --a2ui-spacing-l:            16px;
    --a2ui-spacing-xl:           24px;
    --a2ui-border-width:         1px;
    --a2ui-border-radius:        8px;
    --a2ui-card-border-radius:   10px;
    --a2ui-font-family:          -apple-system, "Helvetica Neue", system-ui, "PingFang SC", sans-serif;
    --a2ui-font-size-xs:         12px;
    --a2ui-font-size-s:          13px;
    --a2ui-font-size-m:          15px;
    --a2ui-font-size-l:          17px;
    --a2ui-font-size-xl:         19px;
    --a2ui-font-size-xxl:        26px;
    --a2ui-button-box-shadow:    0 1px 2px rgba(15,23,42,0.06);
    --a2ui-card-box-shadow:      0 1px 3px rgba(15,23,42,0.06);

    font-family: var(--a2ui-font-family);
    font-size: var(--a2ui-font-size-m);
    line-height: 1.6;
    color: var(--a2ui-color-on-surface);
  }

  .a2ui-text { font-size: var(--a2ui-font-size-m); color: var(--a2ui-color-on-secondary); }
  .a2ui-text--h1 {
    font-size: var(--a2ui-font-size-xxl); font-weight: 700; color: var(--a2ui-color-on-surface);
    letter-spacing: -0.3px; margin: var(--a2ui-spacing-xs) 0;
  }
  .a2ui-text--h2 {
    font-size: var(--a2ui-font-size-xl); font-weight: 700; color: var(--a2ui-color-on-surface);
    margin: var(--a2ui-spacing-m) 0 var(--a2ui-spacing-xs);
  }
  .a2ui-text--h3 {
    font-size: var(--a2ui-font-size-l); font-weight: 600; color: var(--a2ui-color-on-secondary);
    margin: var(--a2ui-spacing-s) 0 var(--a2ui-spacing-xs);
  }
  .a2ui-text--caption {
    font-size: var(--a2ui-font-size-xs); color: var(--a2ui-color-mute);
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
  }
  .a2ui-text--body { font-size: var(--a2ui-font-size-m); color: var(--a2ui-color-on-secondary); }

  .a2ui-column { display: flex; flex-direction: column; gap: var(--a2ui-spacing-m); min-width: 0; }
  .a2ui-row    { display: flex; flex-direction: row;    gap: var(--a2ui-spacing-m); min-width: 0; }

  .a2ui-card {
    background: var(--a2ui-color-surface);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-card-border-radius);
    padding: var(--a2ui-spacing-l) calc(var(--a2ui-spacing-l) + 2px);
    box-shadow: var(--a2ui-card-box-shadow);
  }

  .a2ui-list { display: flex; flex-direction: column; gap: var(--a2ui-spacing-s); }
  .a2ui-list-item {
    padding: var(--a2ui-spacing-s) var(--a2ui-spacing-m);
    background: var(--a2ui-color-secondary);
    border-radius: var(--a2ui-spacing-s);
    color: var(--a2ui-color-on-secondary);
    font-size: 14.5px;
  }

  .a2ui-divider {
    border: none; border-top: var(--a2ui-border-width) solid var(--a2ui-color-border);
    margin: var(--a2ui-spacing-s) 0;
  }
  .a2ui-divider--v {
    border-top: none; border-left: var(--a2ui-border-width) solid var(--a2ui-color-border);
    width: 1px; height: auto; margin: 0 var(--a2ui-spacing-s);
  }

  .a2ui-btn {
    font: inherit; font-size: 14px; font-weight: 500;
    padding: 9px var(--a2ui-spacing-l);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-border-radius);
    background: var(--a2ui-color-surface);
    color: var(--a2ui-color-on-secondary);
    box-shadow: var(--a2ui-button-box-shadow);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, transform 0.05s;
  }
  .a2ui-btn:hover  { background: var(--a2ui-color-secondary-hover); border-color: var(--a2ui-color-border-strong); }
  .a2ui-btn:active { transform: translateY(1px); }
  .a2ui-btn--primary {
    background: var(--a2ui-color-primary); color: var(--a2ui-color-on-primary);
    border-color: var(--a2ui-color-primary); font-weight: 600;
  }
  .a2ui-btn--primary:hover { background: var(--a2ui-color-primary-hover); border-color: var(--a2ui-color-primary-hover); }
  .a2ui-btn--borderless    { background: transparent; border-color: transparent; color: var(--a2ui-color-primary); padding: 0; box-shadow: none; }

  .a2ui-textfield { display: flex; flex-direction: column; gap: var(--a2ui-spacing-xs); }
  .a2ui-textfield-label {
    font-size: var(--a2ui-font-size-xs); font-weight: 600;
    color: var(--a2ui-color-mute); letter-spacing: 0.2px;
  }
  .a2ui-textfield input {
    font: inherit; font-size: 14px;
    padding: 9px var(--a2ui-spacing-m);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-border-radius);
    background: var(--a2ui-color-surface);
    color: var(--a2ui-color-on-surface);
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .a2ui-textfield input:focus {
    outline: none; border-color: var(--a2ui-color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--a2ui-color-primary) 18%, transparent);
  }

  .a2ui-checkbox { display: flex; align-items: center; gap: var(--a2ui-spacing-s); cursor: pointer; }
  .a2ui-checkbox input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--a2ui-color-primary); }

  .a2ui-icon  { font-size: 18px; line-height: 1; }
  .a2ui-image { max-width: 100%; height: auto; border-radius: var(--a2ui-spacing-s); }

  .a2ui-placeholder {
    padding: var(--a2ui-spacing-s) var(--a2ui-spacing-m);
    background: var(--a2ui-color-highlight); color: #854d0e;
    border-radius: var(--a2ui-spacing-s);
    font-size: 12.5px; font-family: ui-monospace, monospace;
  }

  .a2ui-text strong { font-weight: 700; color: var(--a2ui-color-on-surface); }
  .a2ui-text em     { font-style: italic; }
  .a2ui-text code   {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.92em; background: var(--a2ui-color-secondary);
    padding: 1px 5px; border-radius: 4px;
  }

  /* ─── ChoicePicker ───────────────────────────────────────── */
  .a2ui-choice { display: flex; flex-wrap: wrap; gap: 6px; }
  .a2ui-choice-chip {
    font: inherit; font-size: 12.5px; font-weight: 500;
    padding: 6px 12px; border-radius: 999px; cursor: pointer;
    background: var(--a2ui-color-surface);
    color: var(--a2ui-color-on-secondary);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .a2ui-choice-chip:hover { background: var(--a2ui-color-secondary); border-color: var(--a2ui-color-border-strong); }
  .a2ui-choice-chip.active {
    background: var(--a2ui-color-primary); color: var(--a2ui-color-on-primary);
    border-color: var(--a2ui-color-primary);
  }

  /* ─── Slider ─────────────────────────────────────────────── */
  .a2ui-slider { display: flex; flex-direction: column; gap: var(--a2ui-spacing-xs); }
  .a2ui-slider-label {
    font-size: var(--a2ui-font-size-xs); font-weight: 600;
    color: var(--a2ui-color-mute); letter-spacing: 0.2px;
  }
  .a2ui-slider input[type=range] {
    width: 100%; accent-color: var(--a2ui-color-primary);
  }

  /* ─── Tabs ───────────────────────────────────────────────── */
  .a2ui-tabs { display: flex; flex-direction: column; gap: var(--a2ui-spacing-m); }
  .a2ui-tabs-bar {
    display: flex; gap: 4px; border-bottom: var(--a2ui-border-width) solid var(--a2ui-color-border);
  }
  .a2ui-tab {
    font: inherit; font-size: 13.5px; font-weight: 500;
    padding: 9px 14px; border: none; border-bottom: 2px solid transparent;
    background: transparent; color: var(--a2ui-color-mute);
    cursor: pointer; margin-bottom: -1px;
    transition: color 0.12s, border-color 0.12s;
  }
  .a2ui-tab:hover { color: var(--a2ui-color-on-surface); }
  .a2ui-tab.active {
    color: var(--a2ui-color-primary);
    border-bottom-color: var(--a2ui-color-primary);
    font-weight: 600;
  }
  .a2ui-tabs-pane { padding: 4px 0; }

  /* ─── StatTile ───────────────────────────────────────────── */
  .a2ui-stat {
    background: var(--a2ui-color-surface);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-card-border-radius);
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 4px;
    min-width: 0;
  }
  .a2ui-stat--brand { border-color: var(--a2ui-color-primary); background: color-mix(in srgb, var(--a2ui-color-primary) 4%, transparent); }
  .a2ui-stat--good  { border-color: #15803d; background: rgba(21, 128, 61, 0.05); }
  .a2ui-stat--warn  { border-color: #b45309; background: rgba(217, 119, 6, 0.05); }
  .a2ui-stat--bad   { border-color: #BD1C2B; background: rgba(189, 28, 43, 0.05); }
  .a2ui-stat-label {
    font-size: var(--a2ui-font-size-xs); font-weight: 600;
    color: var(--a2ui-color-mute); text-transform: uppercase; letter-spacing: 0.4px;
  }
  .a2ui-stat-value-row { display: flex; align-items: baseline; gap: 6px; }
  .a2ui-stat-value {
    font-size: 26px; font-weight: 700; color: var(--a2ui-color-on-surface);
    letter-spacing: -0.4px; line-height: 1.1;
  }
  .a2ui-stat-unit { font-size: 13px; color: var(--a2ui-color-mute); font-weight: 500; }
  .a2ui-stat-delta { font-size: 12px; font-weight: 600; }
  .a2ui-stat-delta--up      { color: #15803d; }
  .a2ui-stat-delta--down    { color: #BD1C2B; }
  .a2ui-stat-delta--neutral { color: var(--a2ui-color-mute); }

  /* ─── KeyValue ───────────────────────────────────────────── */
  .a2ui-kv {
    display: grid; grid-template-columns: max-content 1fr;
    column-gap: 16px; row-gap: 8px;
    margin: 0; padding: 12px 14px;
    background: var(--a2ui-color-secondary); border-radius: var(--a2ui-border-radius);
  }
  .a2ui-kv dt {
    font-size: 12.5px; font-weight: 600; color: var(--a2ui-color-mute);
    align-self: start; padding-top: 1px;
  }
  .a2ui-kv dd {
    margin: 0; font-size: 14px; color: var(--a2ui-color-on-surface);
  }

  /* ─── Highlight ──────────────────────────────────────────── */
  .a2ui-highlight {
    margin: 0; padding: 14px 18px;
    border-left: 3px solid var(--a2ui-color-primary);
    background: var(--a2ui-color-highlight);
    border-radius: 0 8px 8px 0;
  }
  .a2ui-highlight--brand { border-left-color: var(--a2ui-color-primary); background: color-mix(in srgb, var(--a2ui-color-primary) 8%, white); }
  .a2ui-highlight--warn  { border-left-color: #b45309; background: #fef3c7; }
  .a2ui-highlight-text   { font: 15px/1.55 Georgia, "Times New Roman", "Songti SC", serif; color: var(--a2ui-color-on-surface); margin: 0 0 6px; }
  .a2ui-highlight-source { font-size: 12.5px; color: var(--a2ui-color-mute); font-style: normal; }

  /* ─── ProgressBar ────────────────────────────────────────── */
  .a2ui-progress { display: flex; flex-direction: column; gap: 4px; }
  .a2ui-progress-label { font-size: var(--a2ui-font-size-xs); font-weight: 600; color: var(--a2ui-color-mute); }
  .a2ui-progress-track {
    height: 8px; border-radius: 999px; overflow: hidden;
    background: var(--a2ui-color-secondary);
  }
  .a2ui-progress-fill {
    height: 100%; border-radius: 999px;
    background: var(--a2ui-color-primary);
    transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .a2ui-progress-value { font-size: 11.5px; color: var(--a2ui-color-mute); align-self: flex-end; }

  /* ─── Charts (BarChart / LineChart) ──────────────────────── */
  .a2ui-chart      { display: block; }
  .a2ui-chart-grid { stroke: var(--a2ui-color-border); stroke-width: 1; opacity: 0.6; }
  .a2ui-chart-tick { fill: var(--a2ui-color-mute); font-size: 11px; font-family: var(--a2ui-font-family); }
  .a2ui-chart-bar  { fill: var(--a2ui-color-primary); opacity: 0.85; }
  .a2ui-chart-bar:hover { opacity: 1; }
  .a2ui-chart-value{ fill: var(--a2ui-color-on-surface); font-size: 11px; font-weight: 600; font-family: var(--a2ui-font-family); }
  .a2ui-chart-xlabel { fill: var(--a2ui-color-mute); font-size: 11px; font-family: var(--a2ui-font-family); }
  .a2ui-chart-line { fill: none; stroke: var(--a2ui-color-primary); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .a2ui-chart-area { fill: var(--a2ui-color-primary); opacity: 0.12; }
  .a2ui-chart-dot  { fill: var(--a2ui-color-surface); stroke: var(--a2ui-color-primary); stroke-width: 2; }

  /* ─── Timeline ───────────────────────────────────────────── */
  .a2ui-timeline {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .a2ui-timeline-item {
    display: grid; grid-template-columns: 24px 1fr; gap: 10px;
    padding: 6px 0 14px; position: relative;
  }
  .a2ui-timeline-item:not(:last-child)::before {
    content: ""; position: absolute;
    left: 11px; top: 22px; bottom: -4px; width: 2px;
    background: var(--a2ui-color-border);
  }
  .a2ui-timeline-dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--a2ui-color-primary);
    border: 3px solid var(--a2ui-color-surface);
    box-shadow: 0 0 0 1px var(--a2ui-color-primary);
    margin-top: 6px; margin-left: 5px;
  }
  .a2ui-timeline-when {
    font-size: 11.5px; font-weight: 600; color: var(--a2ui-color-mute);
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .a2ui-timeline-title { font-size: 14.5px; font-weight: 600; color: var(--a2ui-color-on-surface); margin-top: 2px; }
  .a2ui-timeline-detail { font-size: 13.5px; color: var(--a2ui-color-on-secondary); margin-top: 4px; line-height: 1.55; }

  /* ─── ComparisonTable ────────────────────────────────────── */
  .a2ui-cmp {
    width: 100%; border-collapse: collapse;
    background: var(--a2ui-color-surface);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-card-border-radius);
    overflow: hidden;
  }
  .a2ui-cmp th, .a2ui-cmp td {
    padding: 10px 14px; text-align: left;
    border-bottom: var(--a2ui-border-width) solid var(--a2ui-color-border);
    font-size: 13.5px; vertical-align: top;
  }
  .a2ui-cmp th {
    background: var(--a2ui-color-secondary);
    font-weight: 700; color: var(--a2ui-color-on-surface);
    font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.4px;
  }
  .a2ui-cmp tr:last-child td { border-bottom: none; }
  .a2ui-cmp .a2ui-cmp-accent {
    background: color-mix(in srgb, var(--a2ui-color-primary) 6%, transparent);
    color: var(--a2ui-color-on-surface); font-weight: 600;
  }
  .a2ui-cmp-cell-value { font-weight: 600; color: var(--a2ui-color-on-surface); }
  .a2ui-cmp-cell-note  { font-size: 11.5px; color: var(--a2ui-color-mute); margin-top: 2px; }

  /* ─── MapView ────────────────────────────────────────────── */
  .a2ui-map { display: flex; flex-direction: column; gap: var(--a2ui-spacing-m); }
  .a2ui-map-layers { display: flex; flex-wrap: wrap; gap: 6px; }
  .a2ui-map-layer {
    font: inherit; font-size: 12.5px; font-weight: 500;
    padding: 5px 11px; border-radius: 999px; cursor: pointer;
    background: var(--a2ui-color-surface);
    color: var(--a2ui-color-mute);
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    display: inline-flex; align-items: center; gap: 6px;
    transition: background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s;
    opacity: 0.55;
  }
  .a2ui-map-layer.active {
    background: color-mix(in srgb, var(--layer-color, var(--a2ui-color-primary)) 8%, transparent);
    color: var(--a2ui-color-on-surface);
    border-color: var(--layer-color, var(--a2ui-color-primary));
    opacity: 1;
  }
  .a2ui-map-layer-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--layer-color, var(--a2ui-color-primary)); }
  .a2ui-map-layer-icon { font-size: 14px; line-height: 1; }
  .a2ui-map-layer-count { font-size: 11px; color: var(--a2ui-color-mute); }
  .a2ui-map-main {
    display: grid; grid-template-columns: 1fr 240px; gap: var(--a2ui-spacing-m);
    align-items: start;
  }
  @media (max-width: 720px) { .a2ui-map-main { grid-template-columns: 1fr; } }
  .a2ui-map-svg-wrap {
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-card-border-radius);
    overflow: hidden; background: white;
  }
  .a2ui-map-route {
    fill: none; stroke: var(--a2ui-color-primary);
    stroke-width: 2; stroke-dasharray: 6 6; opacity: 0.55;
    stroke-linecap: round;
  }
  .a2ui-map-point .a2ui-map-point-bg { transition: r 0.15s; }
  .a2ui-map-point.selected .a2ui-map-point-bg { r: 18; fill-opacity: 0.32; }
  .a2ui-map-point.selected .a2ui-map-point-dot { r: 9; }
  .a2ui-map-point-label {
    fill: var(--a2ui-color-on-surface); font-size: 11.5px; font-weight: 600;
    font-family: var(--a2ui-font-family); pointer-events: none;
    paint-order: stroke; stroke: white; stroke-width: 4;
  }
  .a2ui-map-point-step {
    fill: white; font-size: 10px; font-weight: 700;
    font-family: var(--a2ui-font-family); pointer-events: none;
  }
  .a2ui-map-bg-label { font-size: 16px; opacity: 0.5; }
  .a2ui-map-detail {
    border: var(--a2ui-border-width) solid var(--a2ui-color-border);
    border-radius: var(--a2ui-card-border-radius);
    padding: 14px; min-height: 120px; background: var(--a2ui-color-surface);
    display: flex; flex-direction: column; gap: 10px;
  }
  .a2ui-map-detail-empty { color: var(--a2ui-color-mute); font-size: 13px; }
  .a2ui-map-detail-header { display: flex; align-items: flex-start; gap: 10px; }
  .a2ui-map-detail-icon { font-size: 22px; line-height: 1; flex-shrink: 0; }
  .a2ui-map-detail-name { font-size: 14.5px; font-weight: 700; color: var(--a2ui-color-on-surface); }
  .a2ui-map-detail-layer { font-size: 11.5px; color: var(--a2ui-color-mute); margin-top: 2px; }
  .a2ui-map-detail-body { font-size: 13px; color: var(--a2ui-color-on-secondary); line-height: 1.55; }
  .a2ui-map-detail-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .a2ui-map-detail-tag {
    background: var(--a2ui-color-secondary); color: var(--a2ui-color-on-secondary);
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
  }
`;

// ─── Convenience: render a stream into a Shadow DOM host ────────────

export function mountSurface(host, messages, opts = {}) {
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = DEFAULT_STYLESHEET + (opts.extraCss || "");
  shadow.innerHTML = "";
  shadow.appendChild(style);
  const root = document.createElement("div");
  root.className = "a2ui-root";
  shadow.appendChild(root);
  const surface = new A2uiSurface(root, opts);
  surface.applyAll(messages);
  return surface;
}
