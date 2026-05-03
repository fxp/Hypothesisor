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

const SUPPORTED = new Set([
  "Text", "Column", "Row", "Card", "List", "Divider",
  "Button", "TextField", "CheckBox",
  "Icon", "Image",
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

// Inline-only markdown subset: **bold**, *italic*, `code`. Intentionally
// no links / images / HTML — keeps Text content fully data-driven.
function renderInlineMarkdown(s) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// Default theme stylesheet — applied inside the surface's Shadow DOM.
export const DEFAULT_STYLESHEET = `
  *, *::before, *::after { box-sizing: border-box; }
  :host, .a2ui-root {
    font: 15px/1.6 -apple-system, "Helvetica Neue", system-ui, "PingFang SC", sans-serif;
    color: #0f172a;
    --brand: var(--a2ui-brand, #2563EB);
    --line: #e2e8f0;
    --mute: #64748b;
    --bg-soft: #f8fafc;
  }
  .a2ui-text         { font-size: 15px; color: #334155; }
  .a2ui-text--h1     { font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; margin: 4px 0 4px; }
  .a2ui-text--h2     { font-size: 19px; font-weight: 700; color: #0f172a; margin: 12px 0 4px; }
  .a2ui-text--h3     { font-size: 16px; font-weight: 600; color: #1e293b; margin: 8px 0 4px; }
  .a2ui-text--caption{ font-size: 12px; color: var(--mute); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
  .a2ui-text--body   { font-size: 15px; color: #334155; }
  .a2ui-column { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .a2ui-row    { display: flex; flex-direction: row;    gap: 10px; min-width: 0; }
  .a2ui-card {
    background: #fff; border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 18px;
  }
  .a2ui-list { display: flex; flex-direction: column; gap: 6px; }
  .a2ui-list-item {
    padding: 8px 12px; background: var(--bg-soft); border-radius: 6px;
    color: #1e293b; font-size: 14.5px;
  }
  .a2ui-divider { border: none; border-top: 1px solid var(--line); margin: 6px 0; }
  .a2ui-divider--v { border-top: none; border-left: 1px solid var(--line); width: 1px; height: auto; margin: 0 6px; }
  .a2ui-btn {
    font: inherit; font-size: 14px; font-weight: 600;
    padding: 9px 16px; border: 1px solid var(--line); border-radius: 8px;
    background: white; color: #0f172a; cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .a2ui-btn:hover { background: var(--bg-soft); border-color: #cbd5e1; }
  .a2ui-btn--primary {
    background: var(--brand); color: white; border-color: var(--brand);
  }
  .a2ui-btn--primary:hover { filter: brightness(0.95); }
  .a2ui-textfield { display: flex; flex-direction: column; gap: 4px; }
  .a2ui-textfield-label { font-size: 12px; font-weight: 600; color: var(--mute); }
  .a2ui-textfield input {
    font: inherit; font-size: 14px; padding: 9px 11px;
    border: 1px solid var(--line); border-radius: 8px; background: white; color: #0f172a;
  }
  .a2ui-textfield input:focus {
    outline: none; border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
  }
  .a2ui-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .a2ui-checkbox input { width: 16px; height: 16px; cursor: pointer; }
  .a2ui-icon  { font-size: 18px; line-height: 1; }
  .a2ui-image { max-width: 100%; height: auto; border-radius: 6px; }
  .a2ui-placeholder {
    padding: 8px 12px; background: #fef3c7; color: #854d0e;
    border-radius: 6px; font-size: 12.5px; font-family: monospace;
  }
  .a2ui-text strong { font-weight: 700; color: #0f172a; }
  .a2ui-text em     { font-style: italic; }
  .a2ui-text code   { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.92em; background: var(--bg-soft); padding: 1px 5px; border-radius: 4px; }
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
