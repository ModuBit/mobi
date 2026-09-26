---
name: visualize
description: Proactively use this skill whenever the user asks for a chart, graph, data visualization, diagram, dashboard, interactive mockup, demo page, or any visual artifact in the conversation. Guides the choice between markdown tables, mermaid fences, and self-contained HTML artifacts, and how to declare the result with the :mobi-artifact directive so it renders inline in the chat stream.
---

# Visualize

Build visuals that live in the conversation. The user sees them inline in the chat stream — no inspector, no file hunting. Read this file in full before authoring; reread truncated ranges in smaller calls.

## 1. Choosing the form

Pick the smallest form that answers the request. Escalate only when the smaller form cannot carry the content:

- **Markdown table** — labeled rows and columns fully explain it. Return it directly in prose; no file, no directive.
- **Mermaid code fence** — labeled nodes and edges fully explain a static structure (flowcharts, sequence diagrams, class diagrams, state machines). Return a normal fenced block; no file, no directive.
- **HTML artifact + `:mobi-artifact` declaration** — dynamics, spatial motion, adjustable inputs, simulations, maps, UI mockups, dashboards, or anything the user must interact with to understand.
- **Plain file delivery** — the user asked for a deliverable file (a real page for their project, a dataset, an image for downstream use). Write the file where it belongs and declare it with the directive; do not redesign it as a conversation visual, and do not skip the declaration.

Do not create an HTML artifact merely because the request mentions data or charts — a table that answers the question beats a dashboard that decorates it. Conversely, when the user says "show me", "what happens if", or asks to explore parameters, a static form is not enough.

**Chart craft** (apply to any visual): pick the form the data's shape calls for; keep encodings honest (baselines at zero for bars, no truncated axes that exaggerate deltas); title the finding, not the axes ("Checkout drops 40% on mobile", not "Conversion rate by platform"); label directly on marks where possible; never invent data to fill a chart.

## 2. Mobi environment constraints

The declared HTML renders in a sandboxed iframe served by Mobi with a strict CSP. Design within it:

- **Self-contained single file.** One `.html` file owns everything it needs.
- **Scripts and styles**: inline, or load from any `https://` CDN (jsdelivr, unpkg, esm.sh, cdnjs, fonts CDN — all allowed).
- **Images and media**: embed as `data:` URIs, or reference files you also wrote into the same artifacts directory (same-origin relative paths work). Remote image URLs are blocked.
- **No network calls**: `fetch`, `XMLHttpRequest`, `WebSocket`, and form submissions to servers are cut off by CSP (`connect-src 'none'`) and will fail silently. All data goes inline in the file.
- **Size target: under 2 MB.** Aggregate, bin, downsample, or round precision for large datasets. Over the limit the visual degrades to a file card.
- **Both themes.** The iframe does not inherit Mobi's theme. Use `prefers-color-scheme` with `light-dark()` (or a media-query pair) for every color; never hardcode a light-only or dark-only palette. Verify both directions read clearly.
- **Full-width container.** The preview fills the chat column (desktop can reach ~1200px, phones full-width); design fluidly — columns stack gracefully on narrow viewports, no fixed pixel assumptions.
- Interactive controls use native elements (`button`, `input`, `select`); keep essential content available without hover (touch users).

## 3. Where files go

- Non-project deliverables ("draw me a picture", "make me a demo page") go to `<cwd>/.mobi/artifacts/<YYYY-MM>/` with a short, lowercase, ASCII-hyphenated filename (e.g. `checkout-funnel.html`, `latency-heatmap.png`).
- When you create that directory for the first time, also write a `.gitignore` inside it containing a single `*` line, so artifacts stay out of the user's version control.
- Project deliverables the user explicitly asked for (code, docs in their repo) go to their normal project paths — never into `.mobi/artifacts/`.
- Never use system temp directories; the conversation cannot read them.

## 4. Choosing the mode

- *(default)* — let Mobi decide by file type. Almost always right.
- `mode="wide"` — only for full-screen app mockups with their application shell, or when several compact panels must sit side by side to be comparable. Never widen a single chart, map, or timeline just because it is dense.
- `mode="card"` — complex HTML applications, multi-file projects, or anything that needs more room than an inline frame gives. The card opens the inspector pane.

## 5. Declaration discipline

- Declare only in the **final reply** of the turn — never in progress updates or commentary.
- One directive per file, on its own line: `:mobi-artifact{path="/absolute/path"}` with `mode` only when section 4 says so.
- The declared path must be the file you actually wrote, absolute. A declaration pointing at a missing file degrades to a card labeled "not found" — verify before declaring.
- Do not also paste the same path as a markdown link, code block, or bare path "for reference" — the directive is the one and only reference.
- Never mention the directive, this skill, CSP, or file locations to the user. The final reply explains what the visual shows, briefly; the visual is the deliverable.
