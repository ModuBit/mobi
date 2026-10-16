---
name: visualize
description: Proactively use this skill whenever the user asks for a chart, graph, data visualization, diagram, dashboard, interactive mockup, demo page, or any visual artifact in the conversation. Guides the choice between markdown tables, mermaid fences, and self-contained HTML artifacts, and how to declare the result with the :mobi-artifact directive so it renders inline in the chat stream.
---

# Visualize

<!-- 维护者注（不面向模型）：本 skill 是 mode=app 规范的承载层——后续要约束 app 的
     样式（设计 token）、组件模式、性能上限等，都往 §2/§4 加章节，不改常驻 system
     prompt（wire 契约在 BASE，知识在此，分层见 generative-ui 票 09）。
     §6/§7 为 codex visualize 插件创作规范吸收（重写路线，license 合规不逐字拷贝），
     spec/tickets 在 .scratch/visualize-runtime/；票 04 交付运行时后此处再补
     「viz 档运行时」章节（fragment 契约 / 设计 token / 工具类 / 内置组件）。 -->

Build visuals that live in the conversation. The user sees them inline in the chat stream — no inspector, no file hunting. Read this file in full before authoring; reread truncated ranges in smaller calls.

## 1. Choosing the form

Pick the smallest form that answers the request. Escalate only when the smaller form cannot carry the content:

- **Markdown table** — labeled rows and columns fully explain it. Return it directly in prose; no file, no directive.
- **Mermaid code fence** — labeled nodes and edges fully explain a static structure (flowcharts, sequence diagrams, class diagrams, state machines). Return a normal fenced block; no file, no directive.
- **HTML artifact + `:mobi-artifact` declaration** — dynamics, spatial motion, adjustable inputs, simulations, maps, UI mockups, dashboards, or anything the user must interact with to understand.
- **Plain file delivery** — the user asked for a deliverable file (a real page for their project, a dataset, an image for downstream use). Write the file where it belongs and declare it with the directive; do not redesign it as a conversation visual, and do not skip the declaration.

Boundary rules:

- A request for a **new standalone file, website, app page, component, or change to existing project files** is not an in-conversation visualization request, even when the deliverable contains charts or interactive content. Build it as a project change.
- A request to **preview, explain, or explore a proposed interface in the conversation** is an in-conversation visualization request.
- Create a visual only when the user needs to see or explore it in the conversation and it materially improves the explanation. A request merely mentioning data, charts, or an interactive page does not by itself justify an HTML artifact — a table that answers the question beats a dashboard that decorates it. Conversely, when the user says "show me", "what happens if", or asks to explore parameters, a static form is not enough.

**Chart craft** (apply to any visual): pick the form the data's shape calls for; keep encodings honest (baselines at zero for bars, no truncated axes that exaggerate deltas); title the finding, not the axes ("Checkout drops 40% on mobile", not "Conversion rate by platform"); label directly on marks where possible; never invent data to fill a chart; pair color with shape or text so meaning never depends on color alone; add a legend only when multiple series cannot be labeled directly.

**Charts in canvas or JS libraries**: resolve theme-aware colors (CSS variables / `light-dark()`) to concrete values before passing them to APIs that cannot parse CSS — and redraw when the theme changes. Animate transitions between chart states so marks move to their new values; never use fade-only effects; honor `prefers-reduced-motion`; do not animate initial appearance or loop motion.

## 2. Mobi environment constraints

The declared HTML renders in a sandboxed iframe served by Mobi with a strict CSP. Design within it:

- **Self-contained single file.** One `.html` file owns everything it needs.
- **Scripts and styles**: inline, or load from any `https://` CDN (jsdelivr, unpkg, esm.sh, cdnjs, fonts CDN — all allowed). Pin library versions (e.g. `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`), never floating `@latest`.
- **Images and media**: embed as `data:` URIs, or reference files you also wrote into the same artifacts directory (same-origin relative paths work). Remote image URLs are blocked.
- **No network calls**: `fetch`, `XMLHttpRequest`, `WebSocket`, and form submissions to servers are cut off by CSP (`connect-src 'none'`) and will fail silently. All data goes inline in the file.
- **Size target: under 2 MB.** Aggregate, bin, downsample, or round precision for large datasets. Over the limit the visual degrades to a file card.
- **Both themes.** Two cases, do not mix them up:
  - `mode="app"` (section 4): the host injects a `--mobi-*` CSS variable palette that follows the user's light/dark theme — style with these variables (`background: var(--mobi-bg)`, `color: var(--mobi-fg)`, `border: var(--mobi-border)`, accent `var(--mobi-primary)`, `border-radius: var(--mobi-radius)`, fonts `var(--mobi-font-body)` / `var(--mobi-font-mono)`, plus `--mobi-fg-secondary` / `--mobi-fg-muted` / `--mobi-success` / `--mobi-warning` / `--mobi-danger` / `--mobi-bg-elevated`) instead of hard-coded colors. Text placed ON a colored block (primary/success/warning/danger button or chip background) must use `color: var(--mobi-on-primary)` — never hardcode white/black, the primary is light in dark theme. Do NOT write your own `prefers-color-scheme` media queries or `light-dark()` here — the injected variables already track the theme, and your CSS always wins over the injected base style.
  - Any other HTML artifact (no mode, `wide`, or `card`): the iframe does not inherit Mobi's theme and nothing is injected. Use `prefers-color-scheme` with `light-dark()` (or a media-query pair) for every color; never hardcode a light-only or dark-only palette.
  - Either way, verify both directions read clearly.
- **Full-width container.** The preview fills the chat column (desktop can reach ~1200px, phones full-width); design fluidly — columns stack gracefully on narrow viewports, no fixed pixel assumptions.
- Interactive controls use native elements (`button`, `input`, `select`); keep essential content available without hover (touch users).

## 3. Where files go

- Non-project deliverables ("draw me a picture", "make me a demo page") go to `<cwd>/.mobi/artifacts/<YYYY-MM>/` with a short, lowercase, ASCII-hyphenated filename (e.g. `checkout-funnel.html`, `latency-heatmap.png`). `<cwd>` is the session's working directory (cwd `/Users/you/myproject` → `/Users/you/myproject/.mobi/artifacts/…`) — NEVER the Mobi home `~/.mobi`.
- When you create that directory for the first time, also write a `.gitignore` inside it containing a single `*` line, so artifacts stay out of the user's version control.
- Project deliverables the user explicitly asked for (code, docs in their repo) go to their normal project paths — never into `.mobi/artifacts/`.
- Never use system temp directories; the conversation cannot read them.

## 4. Choosing the mode

- *(default)* — let Mobi decide by file type. Almost always right.
- `mode="app"` — interactive mini-apps the user operates inside the chat: planning boards, configurators, selectors, calculators. This is the only mode that opens the **host bridge**: the page gets the `--mobi-*` theme palette (section 2) plus `window.MobiApp.issueNewTurn(text)`. Call it ONLY from explicit user actions (e.g. a "continue with these choices" button onclick) to send the app's current state back to the conversation — the message arrives as if the user typed it. Keep the text a concise plain-language summary (under 200 chars recommended); never call it automatically, never expose raw JSON dumps. It also renders in a taller frame — good for full-page layouts.
- `mode="wide"` — only for full-screen app mockups with their application shell, or when several compact panels must sit side by side to be comparable. Never widen a single chart, map, or timeline just because it is dense.
- `mode="card"` — complex HTML applications, multi-file projects, or anything that needs more room than an inline frame gives. The card opens the inspector pane.

## 5. Declaration discipline

- Declare only in the **final reply** of the turn — never in progress updates or commentary.
- One directive per file, on its own line: `:mobi-artifact{path="/absolute/path"}` with `mode` only when section 4 says so.
- The declared path must be the file you actually wrote, absolute. A declaration pointing at a missing file degrades to a card labeled "not found" — verify before declaring.
- Do not also paste the same path as a markdown link, code block, or bare path "for reference" — the directive is the one and only reference.
- Never mention the directive, this skill, CSP, or file locations to the user. The final reply explains what the visual shows, briefly; the visual is the deliverable.
- The reply describes only what the visual helps the user see or decide — do not repeat data or structure already legible in the visual itself, and do not append a summary table duplicating it. Any necessary explanation goes in prose outside the visual, at most one short concluding sentence.

## 6. Composition by visual type

Choose the smallest composition that answers the request. Add only the controls the user asked for; never invent search, filter, or reset controls; one mechanism per state.

### Interactive explainer or simulation

- Compact controls or status, **one dominant visual**, and at most one single-line selected-state detail. Metric cards only when changing numbers are the point of the visual (at most 3); never pad with fact grids or qualitative scores.
- Crop empty space; fit the available width. For step-throughs, update a single current visual with the requested step controls only — no side-by-side steps, no parameter panels or formula cards unless asked.

### Charts and statistical plots

- Simple, directly-labeled values: hand-written inline SVG. Data-rich Cartesian or statistical plots: D3 from the pinned CDN.
- Derive axis domains from the full data with `d3.extent(...)` over all series, uncertainty, and reference values — never hard-code or eyeball a domain. Inset scale ranges for marker radii; keep every path inside the plot frame.
- Set each SVG `viewBox` from its container's measured width and redraw on `ResizeObserver` — never scale down a fixed-width viewBox. Reserve room for the longest formatted axis label; reduce ticks before shrinking text.
- Show units on axes. Put values and takeaways on marks, axes, or annotations; never add a KPI row or control panels unless explicitly requested.
- Sequences or parallel work: aligned lanes on one shared time axis; annotate totals and bottlenecks on the axis or lanes, not above the plot. Distributions or multi-metric comparisons: shared-scale facets shown simultaneously — never hide a requested dimension behind a toggle.
- Smooth over interaction details — keep reading exact values possible via labels or a tooltip.

### Maps

- Let the map dominate: at most one compact selection/detail area and only requested controls.
- Always project published GeoJSON/TopoJSON and sourced coordinates with `d3-geo` — never hard-code or hand-draw geographic outlines; schematic maps only when explicitly asked.
- Local points need a real basemap behind them (neighborhood/street geometry from published sources) — a blank field with a lone administrative outline is not a basemap. Verify the rendered geometry before replying; fix blank basemaps and unprojected points.

### Dense categorical grid

- One compact selected-item summary line, then a grid with **exactly one readable identifier per cell**, then one small legend. All other per-cell metadata goes into an accessible label, not badges or fact grids. Selection is the only interaction unless asked.

### Part-to-whole or time allocation

- Compact metrics plus **one stacked chart of category allocation per period**. Never substitute totals-only bars, and do not duplicate the same data as both a heatmap and a totals chart.

### UI mockups

- A mockup previewed or explored in the conversation is an in-conversation visualization; a request to build the real component is a project change.
- Use product and platform context already in the conversation; do not search the project for its design. Match the product's chrome, navigation, typography, colors, and content; when the design is unavailable, infer one from the platform and the request.
- Give product windows, cards, menus, and popovers opaque backgrounds; stack overlays above product content; only the surrounding conversation surface stays transparent.
- Put app-wide navigation in the app chrome and local controls in their component. Omit single-option pickers. Show realistic states, not invented dashboards, filler cards, or oversized icons.
- Follow the host theme (`--mobi-*` in `mode="app"`, otherwise `prefers-color-scheme`) unless the user asks for a fixed theme.

## 7. Layout and accessibility

- Use semantic HTML and native controls (`button`, `input`, `select`, `textarea`); never recreate a control from `div`s, and never add `tabindex` to non-interactive elements.
- `aria-live="polite"` for dynamic results and simulator updates; `role="alert"` only for validation errors the user must act on. Never announce every hover or animation frame.
- Keep text readable: never below 11 screen pixels; use tabular figures (`font-variant-numeric: tabular-nums`) on changing or aligned numbers.
- Coarse pointers (touch): effective targets about 44×44px without breaking narrow layouts — visible icons may stay small. Keep every essential action available without hover.
- Fill the available conversation width and reflow by stacking or wrapping at narrow widths; no overlap, no clipping, no fixed outer widths, no internal scrolling when the content could reflow instead. Charts shrink ticks and annotations at narrow widths rather than shrinking text.
- Do not override native focus styles; icons that carry meaning get accessible labels (`aria-label`), decorative ones `aria-hidden="true"`.
