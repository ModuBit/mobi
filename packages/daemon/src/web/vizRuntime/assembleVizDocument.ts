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
 * viz 档文档组装与 fragment 校验（spec .scratch/visualize-runtime 票 02）。
 *
 * 模型写的可视化文件是 **HTML fragment**（无 doctype/html/head/body 的正文片段），
 * 本模块在 daemon serve-file 侧把它包成完整沙箱文档：token/工具类样式内联进 head、
 * fragment 原文进 body、交互运行时（tooltip/tabs/carousel/lucide）随后执行。
 * 主题与回灌桥由 web 侧 SandboxHtmlFrame 注入（复用 app 档机制），daemon 不感知。
 *
 * 校验拒绝完整文档标记（`<!doctype` / `<html|head|body>`）：viz 档的契约就是
 * fragment——喂完整 HTML 进来说明模型/调用方搞错了档位，静默包一层会产生
 * 双重 body 的怪物，不如拒绝得清楚。
 */

import { escapeXmlText } from '@mobi/node-core/utils/xmlEscape'
import { VIZ_TOKENS_CSS, VIZ_KIT_CSS } from './vizStyles'
import { VIZ_CALENDAR_SCRIPT } from './vizCalendar'
import {
    VIZ_RUNTIME_JS,
    VIZ_FLOATING_UI_SCRIPTS,
    VIZ_LUCIDE_SCRIPT,
    VIZ_STATE_BRIDGE_JS,
} from './vizRuntimeScript'

/** viz fragment 上限（与 codex 同值；HTML 产物 inline 上限 2MB 之内再收一档） */
export const VIZ_FRAGMENT_MAX_BYTES = 1_000_000

/** 完整文档标记：doctype 或 html/head/body 开标签（大小写不敏感） */
const DOCUMENT_MARKUP = /<!doctype\s|<\s*(?:html|head|body)(?:\s|>)/i

/** 日历组件按需注入挂钩（票 04）：fragment 提及 viz-calendar 才注入（无谓的 ~10KB 不进产物） */
const VIZ_CALENDAR_PATTERN = /viz-calendar/i

/** fragment 校验结果：ok=false 时 error 面向用户（错误页直显） */
export type FragmentValidation = { ok: true } | { ok: false; error: string }

/** 超限错误文案单源：serve 侧预检（读全文之前拒绝）与 validateVizFragment 共用，改文案/改上限只动一处 */
export function vizOversizeError(byteLength: number): string {
    return `Fragment exceeds the 1 MB limit (${byteLength} bytes). Aggregate or downsample the data.`
}

export function validateVizFragment(content: string, byteLength: number): FragmentValidation {
    if (byteLength > VIZ_FRAGMENT_MAX_BYTES) {
        return { ok: false, error: vizOversizeError(byteLength) }
    }
    if (content.trim() === '') {
        return { ok: false, error: 'Fragment is empty.' }
    }
    if (DOCUMENT_MARKUP.test(content)) {
        return { ok: false, error: 'This file looks like a complete HTML document. The viz mode expects a fragment: no <!doctype>, <html>, <head> or <body> tags.' }
    }
    return { ok: true }
}

/** 把校验通过的 fragment 包成完整沙箱文档（样式/运行时全部内联，无同源二次请求） */
export function assembleVizDocument(fragment: string, title = 'Visualization'): string {
    const calendarScript = VIZ_CALENDAR_PATTERN.test(fragment) ? `\n<script>${VIZ_CALENDAR_SCRIPT}</script>` : ''
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeXmlText(title)}</title>
<style>${VIZ_TOKENS_CSS}
${VIZ_KIT_CSS}</style>
${VIZ_FLOATING_UI_SCRIPTS}
</head>
<body>
<script>${VIZ_STATE_BRIDGE_JS}</script>${calendarScript}
${fragment}
${VIZ_LUCIDE_SCRIPT}
<script>${VIZ_RUNTIME_JS}</script>
</body>
</html>`
}

/** 校验失败的错误页（iframe 内可读；不暴露路径等宿主细节） */
export function vizFragmentErrorDocument(message: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2329; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #eceef2; background: #141418; } }
</style>
</head>
<body>
<div role="alert" style="border:1px dashed #d48806;border-radius:8px;padding:12px 14px;color:#d48806">${escapeXmlText(message)}</div>
</body>
</html>`
}
