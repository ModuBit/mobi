---
name: openui
description: openui-lang deep reference for interactive UI blocks — load BEFORE writing rich composed pages (travel itineraries, guides, multi-section reports), charts, geographic maps (Map with AMap), SVG drawings (Svg shapes), sandboxed HtmlView pages, or whenever you are unsure how to combine components. SKILL.md carries the routing rules and a references index; exact signatures are also available on demand via the `openui_components` tool.
---

<!--
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 -->

<!-- ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts -->

# OpenUI Reference (index)

The system prompt already carries the component/function name catalog and the `openui_components` tool fetches exact signatures. Read the reference files below ONLY for what you actually need:

- `references/examples.md` — copyable openui-lang programs (official examples, composed-page and custom-component examples). Read this before writing a rich composed page.
- `references/signatures.md` — full signature reference (95 components grouped + 59 @-functions) for browsing whole families at once; prefer `openui_components` for a few names.
- `references/app-details.md` — full `--mobi-*` theme variable palette and the `MobiApp.issueNewTurn` bridge API for mode="app" HTML apps.

## Rules

- Form routing: lightweight interactions (comparisons, dashboards, forms, selection cards, step-by-step choices) go in the fenced openui-lang block.
- Form routing: interactions that need custom JavaScript logic, rich animation, or a complete mini-app experience must NOT go into openui-lang — write a self-contained single-file .html app with the Write tool (inline all CSS/JS, no network requests), iterate with Edit, and declare it with a `<mobi:artifact path="..." mode="app"/>` tag.
- Form routing: for a tiny one-off visual (a few lines of HTML/SVG with no real interactivity), a plain fenced html block is fine.
- Composed pages: when the content naturally splits into sections (a plan, guide, report, dashboard or comparison), not a single widget, load the `mobi:openui` skill FIRST, then compose ONE openui-lang block — headings, a visual such as Map or Chart when locations/numbers matter, and one Card per item. Do not answer in plain markdown or cram list items into a Table.
- When the user asks a plain question, wants an explanation, or the answer is simple text, respond in plain markdown with NO openui-lang code.
- Keep the prose around the UI concise. Do not duplicate the UI's content as markdown tables or lists.
- Component names are case-sensitive PascalCase — lowercase names are silently dropped and will not render.
- Charts & drawings (custom components): Chart("bar"|"line"|"area"|"pie"|"donut"|"scatter", rows, x?, series?) — series are column names like ["revenue"], NOT Series(...); derive rows with @GroupBy/@Each. Svg(shapes, viewBox, width?, height?) — shapes list first, e.g. `Svg([Rect(10, 10, 80, 40, "surface", "ink", 2), SvgText("Step", 20, 80, 12, "muted")], "0 0 240 120")`; shapes: Circle/Rect/Line/Path/Ellipse/G/SvgText(text, x, y, size?, fill?, anchor?, weight?); Polyline/Polygon take a "x1,y1 x2,y2" points string first. Colors: "ink"/"muted"/"faint"/"surface"/"info"/"success"/"warning"/"danger"/"purple"/"pink"/"chart1"…"chart6" or CSS colors; HtmlView only for a game or animation with a render loop.
- Action-state convention: each ACTION (a button that triggers the assistant to EXECUTE a task) gets its OWN reactive variable whose default value is exactly "idle" (values: idle / running / done / failed; any variable name works, `$actionState` is conventional); never share one variable between actions. Advance it with a Set step, e.g. `btn = Button(btnLabel, Action([Set($actionState, "running"), @ToAssistant("预订")]), "primary")`, and derive the label with a ternary: `btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")`. The host flips the same variable per action (idle → running → done/failed); failed = interrupted and retryable; use it only for execution-state UI. Derived values (labels/buttons) are PLAIN statements like `btnLabel` — never `$name`: `$` initializers are stored unevaluated and render empty.
- One-shot action convention: for forms submitted only once, bind form state to an empty reactive object (e.g. `$answers = {}` — the host restores submitted values on reload) and, driven by the action state variable, swap the button for text once submitted: `submitBtn = $actionState == "idle" ? Button("提交", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : ($actionState == "failed" ? Button("重试", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : TextContent("已提交 ✓", "small"))` — a submitted one-shot action never renders as a clickable button again (only a failed turn stays retryable). Gate ONLY on the action state variable — never introduce a separate boolean flag like `$submitted`: the host never writes it, so the button never locks. Inside a Form the second argument is a `Buttons([submitBtn])` wrapper, not a bare Button. Repeatable interactions need none of this.
- Multi-action panels: every action in one openui-lang block must have its own state variable (never share one between actions) — actions run independently, clicking one must not change another's label, and the host tracks each separately.
- When the user triggers an action from the UI, the follow-up message carries the UI state values as plain text — execute it with your normal tools and confirm briefly; do NOT regenerate the same UI block unless asked.
- For mode="app" HTML apps, style with the `--mobi-*` theme variables the host injects, and use `window.MobiApp.issueNewTurn(text)` only from explicit user actions — read the `mobi:openui` skill for the full palette and API before writing the app.
