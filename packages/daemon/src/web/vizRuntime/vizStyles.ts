/*
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
 */

/**
 * viz 档运行时样式（spec .scratch/visualize-runtime 票 02）。
 *
 * 组成：token 层（`--viz-*`）+ 工具类层（`.card`、`.btn`、`.form-control` 等）。随组装内联进
 * serve-file `viz=1` 响应，模型侧 fragment 只消费语义类名，不重复写主题双档。
 *
 * 双档机制：token 值优先取宿主注入的 `--mobi-*`（web SandboxHtmlFrame 对 viz 档
 * 复用 app 档主题注入，用户切换主题即时生效）；注入前的首帧由 `light-dark()` 兜底
 * 跟随系统偏好。契约：**新增 token 必须双档都可得**（--mobi-* 注入或 light-dark
 * 双值），只给单档算缺陷。
 *
 * License 合规：语义分层与类名体系借鉴 OpenAI codex visualize 插件的结构，
 * 实现全部自研、色值取自 mobi 的 antd 系配色（不逐字拷贝其 CSS）。
 */

/** token + base 层：命名空间隔离的调色板/字体/圆角，fragment 不该重定义它们 */
export const VIZ_TOKENS_CSS = `
:root { color-scheme: light dark; }
:root {
  --viz-bg: var(--mobi-bg, light-dark(#ffffff, #141418));
  --viz-bg-elevated: var(--mobi-bg-elevated, light-dark(#f5f6f8, #1f2228));
  --viz-fg: var(--mobi-fg, light-dark(#1f2329, #eceef2));
  --viz-fg-secondary: var(--mobi-fg-secondary, light-dark(#4b5261, #b8bfcc));
  --viz-fg-muted: var(--mobi-fg-muted, light-dark(#8a91a0, #7f8795));
  --viz-border: var(--mobi-border, light-dark(#e4e6eb, #33363d));
  --viz-border-muted: var(--mobi-border-muted, light-dark(#eeeff2, #2a2d33));
  --viz-primary: var(--mobi-primary, light-dark(#1677ff, #4096ff));
  --viz-on-primary: var(--mobi-on-primary, light-dark(#ffffff, #101418));
  --viz-success: var(--mobi-success, light-dark(#389e0d, #95de64));
  --viz-warning: var(--mobi-warning, light-dark(#d48806, #ffc53d));
  --viz-danger: var(--mobi-danger, light-dark(#ff4d4f, #ff7875));
  --viz-radius: var(--mobi-radius, 10px);
  --viz-font-body: var(--mobi-font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --viz-font-mono: var(--mobi-font-mono, ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace);
  /* 语义色（日历 tone 等离散分类用；与系列色同源） */
  --viz-blue: var(--viz-primary);
  --viz-green: var(--viz-success);
  --viz-red: var(--viz-danger);
  --viz-orange: var(--viz-series-2);
  --viz-purple: var(--viz-series-4);
  --viz-yellow: var(--viz-series-6);
  /* 系列色：系列 1 = primary；2-6 为双档成对的分类色（浅档沉稳/深档提亮） */
  --viz-series-1: var(--viz-primary);
  --viz-series-2: light-dark(#fa8c16, #ffa940);
  --viz-series-3: light-dark(#52c41a, #95de64);
  --viz-series-4: light-dark(#722ed1, #b37feb);
  --viz-series-5: light-dark(#13c2c2, #5cdbd3);
  --viz-series-6: light-dark(#fadb14, #ffd666);
}
* { box-sizing: border-box; }
:where(body) {
  margin: 0;
  padding: 4px;
  color: var(--viz-fg);
  background: transparent;
  font-family: var(--viz-font-body);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
:where(a) { color: var(--viz-primary); }
:where(h1, h2, h3, h4, h5, h6, p) { margin-block: 0; }
:where(h1) { font-size: 1.5em; }
:where(h2) { font-size: 1.25em; }
:where(h3) { font-size: 1.125em; }
:where(code) {
  padding: 1px 5px;
  border-radius: calc(var(--viz-radius) * 0.4);
  background: color-mix(in srgb, var(--viz-fg) 8%, transparent);
  font-family: var(--viz-font-mono);
  font-size: 0.92em;
}
:where(svg) { display: block; max-width: 100%; height: auto; }
`

/**
 * 工具类层：fragment 用的语义类。样式全部吃 `--viz-*` token，
 * 不写死颜色/圆角；触控目标 ≥44px（media pointer:coarse）。
 */
export const VIZ_KIT_CSS = `
/* ── 表面 ── */
.card {
  min-width: 0;
  padding: 12px;
  overflow-wrap: break-word;
  border-radius: var(--viz-radius);
  color: var(--viz-fg);
  background: color-mix(in srgb, var(--viz-fg) 4%, var(--viz-bg));
}
.viz-stat { display: flex; flex-direction: column; gap: 2px; }
.viz-stat-value { font-size: 1.35em; font-weight: 500; line-height: 1.25; }
.viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(max(170px, 30%), 1fr));
  gap: 10px;
}
.viz-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.viz-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.viz-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: calc(var(--viz-radius) * 0.5);
  color: var(--viz-fg-secondary);
  background: color-mix(in srgb, var(--viz-fg) 6%, transparent);
  font-size: 12px;
  line-height: 1.4;
}
.viz-dotted-background {
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--viz-fg) 16%, transparent) 1px,
    transparent 1px
  );
  background-position: center;
  background-size: 16px 16px;
}

/* ── 按钮（默认 = 次级；primary 一个组一个；ghost 低强调） ── */
.btn, .nav-link {
  appearance: button;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
  margin: 0;
  padding: 0 12px;
  min-height: 32px;
  border: 1px solid var(--viz-border);
  border-radius: 9999px;
  color: var(--viz-fg);
  background: color-mix(in srgb, var(--viz-fg) 5%, transparent);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
  cursor: var(--viz-cursor, pointer);
}
.btn:not(:disabled):hover, .nav-link:not(:disabled):not([aria-disabled="true"]):hover {
  background: color-mix(in srgb, var(--viz-fg) 10%, transparent);
}
.btn:disabled, .nav-link:disabled { opacity: 0.45; cursor: not-allowed; }
.btn:focus-visible, .nav-link:focus-visible {
  outline: 2px solid var(--viz-primary);
  outline-offset: 2px;
}
.btn-primary {
  border-color: transparent;
  color: var(--viz-on-primary);
  background: var(--viz-primary);
}
.btn-primary:not(:disabled):hover { background: color-mix(in srgb, var(--viz-primary) 85%, var(--viz-fg)); }
.btn-primary .text-muted { color: color-mix(in srgb, var(--viz-on-primary) 70%, transparent); }
.btn-ghost {
  border-color: transparent;
  color: var(--viz-fg-secondary);
  background: transparent;
}
.btn-ghost:not(:disabled):hover {
  background: color-mix(in srgb, var(--viz-fg) 8%, transparent);
}
.btn-block { display: flex; width: 100%; }
/* 选中/按压态（aria-pressed 等）统一用 primary 配色 */
.btn:not(.btn-primary):is([aria-pressed="true"], [aria-selected="true"], .is-selected) {
  border-color: transparent;
  color: var(--viz-on-primary);
  background: var(--viz-primary);
}
/* 磁贴：密集网格里的可选块，选中用描边而非实底（保分类底色可读） */
.btn.viz-tile {
  display: block;
  width: 100%;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: start;
}
.btn.viz-tile:is([aria-pressed="true"], [aria-selected="true"], .is-selected) {
  color: var(--viz-fg);
  background: color-mix(in srgb, var(--viz-fg) 5%, transparent);
  box-shadow: inset 0 0 0 2px var(--viz-primary);
}

/* ── pills tabs（交互行为由运行时接管，fragment 只写标记结构） ── */
.nav { display: flex; min-width: 0; align-items: center; gap: 4px; flex-wrap: wrap; }
.nav-pills .nav-link {
  border-color: transparent;
  color: var(--viz-fg-secondary);
  background: transparent;
}
.nav-pills .nav-link.active {
  color: var(--viz-fg);
  background: color-mix(in srgb, var(--viz-fg) 10%, transparent);
}

/* ── 表单（原生控件 + 样式壳；触控档 44px） ── */
.form-label { display: block; margin-bottom: 6px; color: var(--viz-fg); }
.form-control, .form-select {
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--viz-border);
  border-radius: calc(var(--viz-radius) * 0.75);
  color: var(--viz-fg);
  background: var(--viz-bg-elevated);
  font: inherit;
  font-size: 14px;
}
.form-control:focus-visible, .form-select:focus-visible {
  outline: 2px solid var(--viz-primary);
  outline-offset: 0;
  border-color: var(--viz-primary);
}
.form-control::placeholder { color: var(--viz-fg-muted); }
textarea.form-control { min-height: 88px; resize: vertical; }
.form-select {
  appearance: none;
  padding-right: 28px;
  background-image: linear-gradient(45deg, transparent 50%, var(--viz-fg-muted) 50%),
    linear-gradient(135deg, var(--viz-fg-muted) 50%, transparent 50%);
  background-position: calc(100% - 16px) 13px, calc(100% - 11px) 13px;
  background-size: 5px 5px;
  background-repeat: no-repeat;
}
.form-check { display: flex; min-height: 32px; align-items: center; gap: 6px; }
.form-check-input { width: 15px; height: 15px; margin: 0; accent-color: var(--viz-primary); }
.form-check-label { color: var(--viz-fg); cursor: var(--viz-cursor, pointer); }
.form-switch .form-check-input {
  width: 32px;
  height: 18px;
  border: 0;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--viz-fg) 15%, transparent);
  appearance: none;
  position: relative;
  transition: background-color 0.2s;
}
.form-switch .form-check-input::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: var(--viz-bg);
  transition: transform 0.2s;
}
.form-switch .form-check-input:checked { background: var(--viz-primary); }
.form-switch .form-check-input:checked::before { transform: translateX(14px); }
.form-range { width: 100%; margin: 6px 0; accent-color: var(--viz-primary); }
.form-range:focus-visible { outline: 2px solid var(--viz-primary); outline-offset: 2px; }
.form-control[aria-invalid="true"] { border-color: var(--viz-danger); }

/* ── 表格（弱分隔线；窄屏横向滚不裁切） ── */
.table-responsive { width: 100%; overflow-x: auto; }
.table {
  width: 100%;
  font: inherit;
  font-size: 13px;
  text-align: start;
  border-collapse: collapse;
}
.table :is(th, td) {
  padding: 8px 12px 8px 0;
  border-bottom: 1px solid var(--viz-border-muted);
  overflow-wrap: anywhere;
  text-align: start;
  vertical-align: top;
}
.table thead th { border-bottom-color: var(--viz-border); color: var(--viz-fg-secondary); font-weight: 500; }
.table tbody tr:last-child :is(th, td) { border-bottom: 0; }
.table-sm :is(th, td) { padding: 5px 10px 5px 0; }
.table .text-end { text-align: end; font-variant-numeric: tabular-nums; }
.table .text-center { text-align: center; }

/* ── 进度条 ── */
.progress {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--viz-fg) 10%, transparent);
}
.progress-bar { height: 100%; background: var(--viz-series-1); }

/* ── 文本工具 ── */
.text-muted { color: var(--viz-fg-muted); }
.text-small { font-size: 12px; line-height: 1.45; }
.text-nowrap { white-space: nowrap; }
.tabular-nums { font-variant-numeric: tabular-nums; }
.text-destructive { color: var(--viz-danger); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
hr {
  height: 1px;
  margin: 8px 0;
  border: 0;
  background: var(--viz-border);
}

/* ── tooltip（由运行时创建；此处只管皮） ── */
.tooltip {
  position: fixed;
  z-index: 50;
  top: 0;
  left: 0;
  max-width: min(20rem, calc(100vw - 12px));
  padding: 5px 10px;
  border: 1px solid var(--viz-border);
  border-radius: calc(var(--viz-radius) * 0.75);
  color: var(--viz-fg);
  background: var(--viz-bg-elevated);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--viz-fg) 18%, transparent);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
  user-select: none;
}

/* ── variant carousel（结构由 fragment 写，控件由运行时注入） ── */
.viz-carousel { position: relative; min-width: 0; }
.viz-carousel > [data-variant][hidden] { display: none !important; }
.viz-carousel:has(> .viz-carousel-controls) { padding-bottom: 56px; }
.viz-carousel-controls {
  position: absolute;
  z-index: 2;
  bottom: 8px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0;
  max-width: calc(100% - 64px);
  padding: 0;
  border: 1px solid var(--viz-border);
  border-radius: 14px;
  color: var(--viz-fg);
  background: var(--viz-bg);
  font-size: 13px;
  transform: translateX(-50%);
}
.viz-carousel-controls button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  border-radius: 12px;
  cursor: var(--viz-cursor, pointer);
}
.viz-carousel-controls > button { width: 30px; padding: 0; }
.viz-carousel-controls button:hover { background: color-mix(in srgb, var(--viz-fg) 8%, transparent); }
.viz-carousel-controls button:focus-visible { outline: 2px solid var(--viz-primary); outline-offset: 1px; }
.viz-carousel-count { padding: 0 4px 0 10px; color: var(--viz-fg-muted); white-space: nowrap; }
.viz-carousel-name {
  min-width: 0;
  max-width: 30vw;
  padding: 0 10px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.viz-carousel-options {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  left: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--viz-border);
  border-radius: calc(var(--viz-radius) * 0.9);
  background: var(--viz-bg-elevated);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--viz-fg) 20%, transparent);
}
.viz-carousel-options button {
  justify-content: flex-start;
  width: 100%;
  text-align: start;
  white-space: normal;
}
.viz-carousel-options > [aria-current="true"],
.viz-carousel-options > button:hover { background: color-mix(in srgb, var(--viz-fg) 10%, transparent); }

/* ── 触控档：粗指针目标 ≥44px（可见尺寸可小，命中面积达标） ── */
@media (pointer: coarse) {
  .btn, .nav-link, .form-control, .form-select { min-height: 44px; min-width: 44px; }
  .form-control, .form-select { font-size: 16px; }
  .form-check { min-height: 44px; }
  .form-range { height: 44px; }
  .viz-carousel:has(> .viz-carousel-controls) { padding-bottom: 72px; }
}
@media (prefers-reduced-motion: reduce) {
  .form-switch .form-check-input,
  .form-switch .form-check-input::before { transition: none; }
}
`
