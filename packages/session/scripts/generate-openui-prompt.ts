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
 * openui catalog prompt 生成脚本（票 02）：
 * 用 web 渲染同款的官方 openuiLibrary 生成 system prompt 附加段，落
 * src/claude/utils/openuiCatalogPrompt.generated.ts——session 运行时零
 * React 依赖（react-ui 仅作为 devDep 供本脚本与同步测试使用）。
 *
 * 触发重新生成：升级 @openuidev/react-ui（锁版本）或调整下方判据措辞后运行
 * `bun run packages/session/scripts/generate-openui-prompt.ts`。
 *
 * 已趟平的坑（PoC 实测，见 .scratch/generative-ui/poc/openuiLib.ts 注释）：
 * - prompt 入口是 library.prompt()（generateSystemPrompt 不调 toSpec）
 * - 官方 inlineMode 段自带围栏教学（```openui-lang 标签）与「纯问题不出码」
 *   约束，additionalRules 只补 mobi 特有的三层形态判据，不与官方措辞打架
 * - 生成结果跨进程确定（无实例 id 泄漏），同步测试可做全等比对
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import { openuiExamples } from '@openuidev/react-ui/genui-lib/prompt-options'

/** prompt 选项（形态判据的单一来源；契约测试与同步测试共用） */
export const OPENUI_PROMPT_OPTIONS = {
    inlineMode: true,
    // 官方静态示例（含 card-block 正确用法）——E2E 实测不传时模型误用
    // OverviewCardItem 签名（icon 传 string、缺必填 top），10 条语句被丢弃
    examples: openuiExamples,
    preamble:
        'You can embed interactive UI in your replies using openui-lang when it genuinely helps the user (comparisons, dashboards, forms, selection cards, parameter exploration, step-by-step choices).',
    additionalRules: [
        // 三层判据：native 组件 / app 文件 / fenced 小片段（spec §Implementation「prompt 注入通道」）
        'Form routing: lightweight interactions (comparisons, dashboards, forms, selection/ordering cards, parameter exploration) go in the fenced openui-lang block.',
        'Form routing: interactions that need custom JavaScript logic, maps, rich animation, or a complete mini-app experience must NOT be forced into openui-lang — instead write a self-contained single-file .html app with the Write tool (inline all CSS/JS, no network requests), iterate with Edit rather than rewriting, and declare it with the :mobi-artifact directive using mode="app" so it renders inline.',
        'Form routing: for a tiny one-off visual (a few lines of HTML/SVG with no real interactivity), a plain fenced html block is fine.',
        'When the user asks a plain question, wants an explanation, or the answer is simple text, respond in plain markdown with NO openui-lang code.',
        'Keep the prose around the UI concise. Do not duplicate the UI\'s content as markdown tables or lists.',
        'Component names are case-sensitive PascalCase — lowercase names are silently dropped and will not render.',
        // 档③原地更新（票 04）：执行类按钮（下单/预订/保存/提交后执行动作）的状态绑定约定。
        // $actionState 值域与 web 侧注入词汇共享（idle/running/done/failed），host 在
        // turn 进行/完成时改写该变量原地翻转按钮，UI 源码（markdown content）不变。
        // 派生用嵌套三元（表达式层 Ternary + == 实证支持；组件层无 Switch）
        'Action-state convention: for buttons that trigger the assistant to EXECUTE a task (order / book / save / run), declare a reactive variable `$actionState = "idle"` and derive the button label with a ternary, e.g. `btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")` then `btn = Button(btnLabel, "primary")`. The host flips $actionState (idle → running → done/failed) in place as the action\'s turn progresses — never use $actionState for anything other than execution-state UI, and always keep the idle case as a clickable button label.',
        'When the user triggers an action from the UI, the follow-up message will carry the UI state values as plain text — treat it as the user\'s instruction to execute, use your normal tools (with the usual permission flow), and confirm the outcome briefly in prose; do NOT regenerate the same UI block unless asked.',
    ],
} as const

const header = `/*
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
 * ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts
 * 来源：@openuidev/react-ui openuiLibrary.prompt()（选项单一来源在脚本 OPENUI_PROMPT_OPTIONS）
 */

export const OPENUI_CATALOG_PROMPT = `

// 仅直接执行时写盘（测试 import 本模块拿 OPENUI_PROMPT_OPTIONS 时不落盘）
if (import.meta.main) {
    const prompt = openuiLibrary.prompt(OPENUI_PROMPT_OPTIONS)
    const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/claude/utils/openuiCatalogPrompt.generated.ts')
    writeFileSync(outPath, header + JSON.stringify(prompt) + '\n')
    console.log(`written ${outPath} (${prompt.length} chars)`)
}
