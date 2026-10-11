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
 * openui catalog prompt 生成脚本（票 02 建立，票 08 分层重构）：
 *
 * 一个生成器、两个产物（同源，重跑刷新）：
 * 1. `src/claude/utils/openuiCorePrompt.generated.ts`——**核心段**，常驻 system prompt：
 *    语法骨架 + 三层形态判据 + 高频核心组件（CORE_COMPONENTS 白名单）+ 官方示例
 *    + 「组件不在清单先加载 openui skill」引导。多数不出 UI 的会话只背这一段
 *    （生产实测 167 会话仅 1 个出过 openui，全量 38K 常驻不划算）。
 * 2. `packages/cli/plugins/mobi/skills/openui/SKILL.md`——**全量目录**（52 组件签名），
 *    随 mobi 内置插件分发，模型写复杂 UI（图表/日历/轮播/CardBlock 系）前主动加载。
 *
 * 触发重新生成：升级 @openuidev/react-ui（锁版本）或调整判据措辞后运行
 * `bun run packages/session/scripts/generate-openui-prompt.ts`。
 *
 * 已趟平的坑（PoC 实测，见 .scratch/generative-ui/poc/openuiLib.ts 注释）：
 * - prompt 入口是 library.prompt()（generateSystemPrompt 不调 toSpec）；分层用
 *   toSpec().components 子集 + generateSystemPrompt 重建（探针实证：全量子集 ==
 *   library.prompt()，同一底层 assembler，无文本切割脆弱性）
 * - 官方 inlineMode 段自带围栏教学（```openui-lang 标签）与「纯问题不出码」约束，
 *   additionalRules 只补 mobi 特有判据，不与官方措辞打架
 * - 生成结果跨进程确定（无实例 id 泄漏），同步测试可做全等比对
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import { generateSystemPrompt } from '@openuidev/react-lang'
import { openuiExamples } from '@openuidev/react-ui/genui-lib/prompt-options'
import { projectPath } from '@mobi/node-core/projectPath'
import { MOBI_THEME_PALETTE_VARS } from '@mobi/shared'

/**
 * 核心组件白名单（常驻 system prompt 的高频子集）：简单交互场景（表单/选择卡/
 * 按钮/对比卡/表格）自洽所需。分界原则——**布局/文本/表单件常驻**（小签名、高频），
 * **重签名与低频件进 skill**（CardBlock 系每个 ~1.1K chars、Charts/Calendar/
 * Carousel/Modal/Tabs/Accordion/DatePicker/Slider/EditableTable 等）。
 * 官方示例含 card-block 正确用法，模仿示例写 CardBlock 仍合法——签名细节在 skill。
 */
const CORE_COMPONENTS = [
    // 布局骨架
    'Stack', 'Col', 'Card', 'CardHeader', 'Separator',
    // 文本
    'Text', 'BoldText', 'TextContent', 'TextCallout', 'Callout', 'Icon', 'Tag', 'Label',
    // 表单与选择（点单/表单场景核心）
    'Button', 'Buttons', 'OptionCards', 'OptionCard', 'Chips', 'ChipItem',
    'CheckBoxGroup', 'CheckBoxItem', 'RadioGroup', 'RadioItem', 'SwitchGroup', 'SwitchItem',
    'Form', 'FormControl', 'Input', 'TextArea', 'Select', 'SelectItem',
    // 展示
    'Table', 'MetricIndicatorInline',
] as const

/** 两档共用的形态判据（常驻核心；全量版也带——skill 单独被读时判据不缺位） */
const SHARED_RULES = [
    // 三层判据：native 组件 / app 文件 / fenced 小片段（spec §Implementation「prompt 注入通道」）
    'Form routing: lightweight interactions (comparisons, dashboards, forms, selection/ordering cards, parameter exploration) go in the fenced openui-lang block.',
    'Form routing: interactions that need custom JavaScript logic, maps, rich animation, or a complete mini-app experience must NOT be forced into openui-lang — instead write a self-contained single-file .html app with the Write tool (inline all CSS/JS, no network requests), iterate with Edit rather than rewriting, and declare it with the :mobi-artifact directive using mode="app" so it renders inline.',
    'Form routing: for a tiny one-off visual (a few lines of HTML/SVG with no real interactivity), a plain fenced html block is fine.',
    'When the user asks a plain question, wants an explanation, or the answer is simple text, respond in plain markdown with NO openui-lang code.',
    'Keep the prose around the UI concise. Do not duplicate the UI\'s content as markdown tables or lists.',
    'Component names are case-sensitive PascalCase — lowercase names are silently dropped and will not render.',
    // 档③原地更新 + per-action 粒度（票 04/02/per-action 票 02-04）：每个操作一个
    // 专属状态变量（值域约定，名字自由），Set step 做本地即时反馈；host 按操作粒度
    // 回写（registry 身份 + 绑定表），多操作不共享变量——共享是串状态根因
    'Action-state convention: each ACTION (a button that triggers the assistant to EXECUTE a task) gets its OWN reactive variable whose default value is exactly "idle" (the host recognizes state variables by this value vocabulary: idle / running / done / failed — any variable name works, `$actionState` is the conventional choice); never share one variable between actions. Advance it with a Set step for instant local feedback, e.g. `btn = Button(btnLabel, Action([Set($actionState, "running"), @ToAssistant("预订")]), "primary")`, and derive the label with a ternary, e.g. `btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")`. The host flips the same variable in place per action as that action\'s turn progresses (idle → running → done/failed); failed means the turn was interrupted and the action may be retried — never use these state variables for anything other than execution-state UI.',
    // 一次性操作（票 02/per-action 票 03-04）：条件渲染绑操作状态变量——idle 才渲染
    // 按钮、failed 保持可重试、其余终态替换为文字（按钮原地消失，非灰化——DSL 无
    // disabled）；快照容器空对象声明供提交后恢复勾选态
    'One-shot action convention: for forms that should be submitted only once, bind the form state to a reactive object declared empty (e.g. `$answers = {}` — the host restores the submitted values on reload) and swap the button for plain text once submitted, driven by the action state variable: `$submitBtn = $actionState == "idle" ? Button("提交", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : ($actionState == "failed" ? Button("重试", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : TextContent("已提交 ✓", "small"))` — a submitted one-shot action never renders as a clickable button again (only a failed turn stays retryable). Repeatable interactions (menus, explorers) need none of this.',
    // 多操作面板（per-action 票 02 E2E 实锤句）：各操作独立——E2E 曾实测共享变量的
    // 双卡面板点 A 连带翻 B（串状态），故独立变量是硬约定
    'Multi-action panels: every action in one openui-lang block must have its own state variable (never share one between actions) — actions run independently, clicking one must not change another\'s label, and the host tracks each separately (two quick-stat cards each flip only its own 执行中… → 已完成 ✓).',
    'When the user triggers an action from the UI, the follow-up message will carry the UI state values as plain text — treat it as the user\'s instruction to execute, use your normal tools (with the usual permission flow), and confirm the outcome briefly in prose; do NOT regenerate the same UI block unless asked.',
]

/**
 * 档②调色板教学句（票 05/06）——只在全量版（skill）常驻；核心段判据保留路由、细节
 * 一句指路。变量清单从 shared MOBI_THEME_PALETTE_VARS 拼出——与 web 侧注入 CSS
 * 同一 pivot（架构评审候选 3），教学不可能列出宿主不注入的变量（模型照抄即坏 app）。
 * 前段固定句法（background/color/borders/accent/radius/fonts 带用法示例），其余变量
 * 以 plus 列表收尾。
 */
function appPaletteRule(): string {
    const rest = MOBI_THEME_PALETTE_VARS.filter(
        (v) => !['--mobi-bg', '--mobi-fg', '--mobi-border', '--mobi-primary', '--mobi-radius', '--mobi-font-body', '--mobi-font-mono'].includes(v),
    )
    return `For mode="app" HTML apps: the host injects a \`--mobi-*\` CSS variable palette (and a low-specificity base style) that follows the user's light/dark theme \u2014 style your app with these variables (background: var(--mobi-bg), color: var(--mobi-fg), borders: var(--mobi-border), accent: var(--mobi-primary), radius: var(--mobi-radius), fonts var(--mobi-font-body)/var(--mobi-font-mono), plus ${rest.join('/')}) instead of hard-coded colors, so the app adapts to both themes automatically; text placed on a colored block (e.g. a primary button or chip) takes \`color: var(--mobi-on-primary)\` \u2014 never hardcode white/black, the accent is light-toned in dark theme; your own CSS always wins over the injected base.`
}
const APP_DETAIL_RULES = [
    appPaletteRule(),
    // 档② app bridge（票 06）：app → 宿主回灌。宿主注入 window.MobiApp.issueNewTurn(text)
    'For mode="app" HTML apps: the host also injects `window.MobiApp.issueNewTurn(text)` — call it ONLY from explicit user actions (e.g. a "continue with these choices" button onclick) to send the app\'s current state back to the conversation; the message arrives as if the user typed it. Keep the text a concise plain-language summary of the chosen state (recommended under 200 chars), never call it automatically, and do NOT expose raw JSON dumps.',
]

/**
 * 核心段示例：程序化挑选「只使用核心清单组件」的官方示例（Action/@ToAssistant 是
 * 语法构造不算组件）——升级 react-ui 后示例内容变化时筛选自适应，不按索引硬编码。
 * 大示例（card-block/editabletable/charts）与核心清单不一致，下沉全量版。
 */
function pickCoreExamples(coreNames: readonly string[]): string[] {
    const core = new Set<string>(coreNames)
    return openuiExamples.filter((ex) => {
        const comps = [...new Set(ex.match(/\b[A-Z][a-zA-Z]+\(/g)?.map((s) => s.slice(0, -1)) ?? [])]
        return comps.every((c) => core.has(c))
    })
}

/** 核心段 prompt 选项（常驻 system prompt；判据 + skill 引导 + 核心示例 + 核心组件子集） */
export const OPENUI_CORE_PROMPT_OPTIONS = {
    inlineMode: true,
    // 官方静态示例对生成质量关键（票 02 实测缺示例时模型误用签名、10 条语句被丢弃），
    // 核心段带「纯核心组件」子集，其余示例随全量目录在 skill
    examples: pickCoreExamples(CORE_COMPONENTS),
    preamble:
        'You can embed interactive UI in your replies using openui-lang when it genuinely helps the user (comparisons, dashboards, forms, selection cards, parameter exploration, step-by-step choices).',
    additionalRules: [
        ...SHARED_RULES,
        // mode=app 细节指路（变量表/bridge 全文在 skill；此处一句防盲写）
        'For mode="app" HTML apps, style with the `--mobi-*` theme variables the host injects, and use `window.MobiApp.issueNewTurn(text)` only from explicit user actions — read the `openui` skill for the full palette and API before writing the app.',
        // 分层引导（票 08）：核心清单只覆盖简单场景；复杂组件先加载 skill 取全量目录，
        // 失败模式是「多一次工具调用」而非「静默丢语句」
        'The component reference in this prompt is a CORE SUBSET only. If the UI you are about to write needs any component NOT documented above — charts, tables with editing, calendars, date pickers, carousels, modals, tabs, accordions, sliders, entity lists, card blocks (Overview/Composite/Context/Visual/Snippet), or advanced image layouts — invoke the `openui` skill FIRST and read its full component catalog before writing the code. Never guess a signature that is not documented above.',
    ],
}

/** 全量版 prompt 选项（进 openui skill；判据同核心防单读缺位，app 细则全文在此） */
const OPENUI_FULL_PROMPT_OPTIONS = {
    inlineMode: true,
    examples: openuiExamples,
    preamble: OPENUI_CORE_PROMPT_OPTIONS.preamble,
    additionalRules: [...SHARED_RULES, ...APP_DETAIL_RULES],
} as const

/**
 * 生成核心段（system prompt 常驻）：全量 spec 的 components 按 CORE_COMPONENTS 取子集，
 * 经同一 generateSystemPrompt assembler 重建——不是对全量文本的切割。
 */
export function buildCorePrompt(): string {
    const spec = openuiLibrary.toSpec()
    const components = Object.fromEntries(
        CORE_COMPONENTS.filter((name) => name in spec.components)
            .map((name) => [name, spec.components[name as keyof typeof spec.components]]),
    )
    return generateSystemPrompt({
        ...spec,
        components,
        ...OPENUI_CORE_PROMPT_OPTIONS,
    })
}

/** openui skill 的 frontmatter description（触发词与引导规则同口径） */
const SKILL_DESCRIPTION =
    'Full openui-lang component catalog (52 components with exact signatures) for interactive UI blocks. Load this skill BEFORE writing any openui-lang code that needs components beyond the core subset documented in the system prompt — charts, editable tables, calendars, date pickers, carousels, modals, tabs, accordions, sliders, entity lists, card blocks (Overview/Composite/Context/Visual/Snippet), image layouts — or whenever you are unsure of a component signature.'

/** 生成 openui skill 全文（frontmatter + 全量 catalog） */
export function buildSkillMarkdown(): string {
    return [
        '---',
        'name: openui',
        `description: ${SKILL_DESCRIPTION}`,
        '---',
        '',
        '# OpenUI Component Catalog (full)',
        '',
        openuiLibrary.prompt(OPENUI_FULL_PROMPT_OPTIONS),
        '',
    ].join('\n')
}

const tsHeader = `/*
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
 * 来源：@openuidev/react-ui openuiLibrary（核心子集经 generateSystemPrompt 重建；
 * 选项单一来源在脚本 OPENUI_CORE_PROMPT_OPTIONS；全量目录在 openui skill）
 */
`

/** skill 文件的版权头（同步测试复现文件全文用） */
export const SKILL_FILE_HEADER = `<!--
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
`

// 仅直接执行时写盘（测试 import 本模块拿选项时不落盘）。
// 跨包产物路径锚定：SKILL.md 属主是 cli 安装根（projectPath），不数上级目录层数——
// 层数路径在文件挪位时静默写错地方（票 08 实踩两次）
if (import.meta.main) {
    const scriptDir = dirname(fileURLToPath(import.meta.url))
    const coreOut = resolve(scriptDir, '../src/claude/utils/openuiCorePrompt.generated.ts')
    const core = buildCorePrompt()
    writeFileSync(coreOut, `${tsHeader}export const OPENUI_CORE_PROMPT = ${JSON.stringify(core)}\n`)
    console.log(`written ${coreOut} (${core.length} chars)`)

    const skillOut = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui', 'SKILL.md')
    const skill = buildSkillMarkdown()
    writeFileSync(skillOut, `${SKILL_FILE_HEADER}${skill}`)
    console.log(`written ${skillOut} (${skill.length} chars)`)
}
