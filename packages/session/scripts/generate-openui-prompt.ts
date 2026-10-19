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
 * 2. `packages/cli/plugins/mobi/skills/openui/SKILL.md`——**全量目录**（82 官方组件 +
 *    13 自定义组件 + 59 函数签名），随 mobi 内置插件分发，模型写复杂 UI（图表/地图/
 *    日历/轮播/CardBlock 系/Svg 绘图/沙箱 HTML）前主动加载。
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

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import { defineComponent, generateSystemPrompt } from '@openuidev/react-lang'
import { openuiExamples } from '@openuidev/react-ui/genui-lib/prompt-options'
import {
    MOBI_THEME_PALETTE_VARS,
    openuiComponentSpecs,
    openuiFunctions,
    listFunctions,
    numberFunctions,
    textFunctions,
    colorFunctions,
    dateFunctions,
    dataFunctions,
} from '@mobi/shared'
import { projectPath } from '@mobi/node-core/projectPath'

/**
 * 自定义组件（票 03）在生成端的空实现：prompt 只用 name/props/description，
 * 不会渲染。实现（含 React）在 web 包，session 不能依赖 web——签名经 shared
 * 单源共享，这里用空桩把签名注册进同一 library，prompt 与运行时同源。
 */
const demoComponentStubs = openuiComponentSpecs.map((spec) => defineComponent({ ...spec, component: () => null }))

/**
 * 带 @函数目录与自定义组件签名的库实例（票 02/03）：定义来自 shared 单源
 * （与 web 渲染器同一批），extend 派生新库、base 不变——prompt 生成器与运行时
 * 看到的能力面由同一份定义决定，不会漂移。
 */
const library = openuiLibrary.extend!({
    components: { add: demoComponentStubs },
    functions: { add: openuiFunctions },
})

/**
 * 核心组件白名单（常驻 system prompt 的高频子集）：简单交互场景（表单/选择卡/
 * 按钮/对比卡/表格）自洽所需。分界原则——**布局/文本/表单件常驻**（小签名、高频），
 * **重签名与低频件进 skill**（CardBlock 系每个 ~1.1K chars、Charts/Calendar/
 * Carousel/Modal/Tabs/Accordion/DatePicker/Slider/EditableTable 等）。
 * 官方示例含 card-block 正确用法，模仿示例写 CardBlock 仍合法——签名细节在 skill。
 */
/**
 * 核心组件白名单（A 档=现状，常驻 system prompt 的高频子集）：简单交互场景（表单/选择卡/
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

/**
 * 热集（B/C 档对比实验，2026-10-19）：一行小签名、最高频的布局/文本/表单件——
 * 这些是「简单小部件零往返」的路径，模型写它们不该先查一次工具。
 * 与 CORE_COMPONENTS 的差异：重签名选择件（OptionCards/Chips/Switch 族/CheckBox 族/
 * Radio 族/MetricIndicatorInline）也退成名录，靠 openui_components 工具取签名。
 */
const HOT_COMPONENTS = [
    // 布局骨架
    'Stack', 'Col', 'Card', 'CardHeader', 'Separator',
    // 文本
    'Text', 'BoldText', 'TextContent', 'TextCallout', 'Callout', 'Icon', 'Tag', 'Label',
    // 表单与动作
    'Button', 'Buttons', 'Form', 'FormControl', 'Input', 'TextArea', 'Select', 'SelectItem',
    // 表格
    'Table',
] as const

/**
 * 两档共用的形态判据（常驻核心；全量版也带——skill 单独被读时判据不缺位）。
 * 结构为 { text, concise? }：text 进 skill 全量版；c 档（默认）取 concise ?? text——
 * 瘦身只删「官方 componentGroups.notes 已覆盖」或「低频深教」的部分，核心判据不缩水。
 */
interface PromptRule {
    text: string
    /** c 档（默认核心段）的瘦身版；缺省 = 原文不缩 */
    concise?: string
}

const SHARED_RULES: PromptRule[] = [
    // 三层判据：native 组件 / app 文件 / fenced 小片段（spec §Implementation「prompt 注入通道」）
    {
        text: 'Form routing: lightweight interactions (comparisons, dashboards, forms, selection cards, step-by-step choices) go in the fenced openui-lang block.',
    },
    // 地图已是原生组件（票 04），不再属于「必须走 .html app」的范畴——旧措辞把
    // maps 列在 app 路由里，模型据此放弃 openui-lang 里的 Map
    {
        text: 'Form routing: interactions that need custom JavaScript logic, rich animation, or a complete mini-app experience must NOT go into openui-lang — write a self-contained single-file .html app with the Write tool (inline all CSS/JS, no network requests), iterate with Edit, and declare it with the :mobi-artifact directive using mode="app".',
    },
    {
        text: 'Form routing: for a tiny one-off visual (a few lines of HTML/SVG with no real interactivity), a plain fenced html block is fine.',
    },
    // 富混排页面（2026-10-19 E2E 实锤）：判据按「内容结构」而非场景枚举——
    // 只要回答天然分节（计划/指南/报告/对比），就走整块编排，模型自行组合组件
    {
        text: 'Composed pages: when the content naturally splits into sections (a plan, guide, report, dashboard or comparison), not a single widget, load the `mobi:openui` skill FIRST, then compose ONE openui-lang block — headings, a visual such as Map or Chart when locations/numbers matter, and one Card per item. Do not answer in plain markdown or cram list items into a Table.',
    },
    {
        text: 'When the user asks a plain question, wants an explanation, or the answer is simple text, respond in plain markdown with NO openui-lang code.',
    },
    {
        text: 'Keep the prose around the UI concise. Do not duplicate the UI\'s content as markdown tables or lists.',
    },
    {
        text: 'Component names are case-sensitive PascalCase — lowercase names are silently dropped and will not render.',
    },
    // 自定义组件（票 03）：Chart / Svg 图元 / HtmlView 不在核心清单，签名在 skill；
    // 这里只教「什么时候用哪个媒介」，防止模型用 Table 硬凑图或滥用 HtmlView。
    // concise：官方 Charts notes 已教 LineChart 等官方图表语法，这里只留 mobi 特有
    // （Chart 自定义组件 series 语义 / Svg 参数顺序坑 / 图元颜色 token / HtmlView 判据）
    {
        text: 'Charts & drawings (custom components): Chart("bar"|"line"|"area"|"pie"|"donut"|"scatter", rows, x?, series?) — series are column names like ["revenue"], NOT Series(...); derive rows with @GroupBy/@Each. Svg(shapes, viewBox, width?, height?) — shapes list first, e.g. `Svg([Rect(10, 10, 80, 40, "surface", "ink", 2), SvgText("Step", 20, 80, 12, "muted")], "0 0 240 120")`; shapes: Circle/Rect/Line/Path/Ellipse/G/SvgText(text, x, y, size?, fill?, anchor?, weight?); Polyline/Polygon take a "x1,y1 x2,y2" points string first. Colors: "ink"/"muted"/"faint"/"surface"/"info"/"success"/"warning"/"danger"/"purple"/"pink"/"chart1"…"chart6" or CSS colors; HtmlView only for a game or animation with a render loop.',
        concise:
            'Custom Chart component: Chart(type, rows, x?, series?) — series are column names like ["revenue"], NOT Series(...); derive rows with @GroupBy/@Each. Svg takes the shapes list FIRST, then viewBox — e.g. `Svg([Rect(10, 10, 80, 40, "surface", "ink", 2), SvgText("Step", 20, 80, 12, "muted")], "0 0 240 120")`; Polyline/Polygon take a "x1,y1 x2,y2" points string first. Shape colors: ink/muted/faint/surface/info/success/warning/danger/chart1-6 or CSS. HtmlView only for a game or animation with a render loop.',
    },
    // 档③原地更新 + per-action 粒度（票 04/02/per-action 票 02-04）：每个操作一个
    // 专属状态变量（值域约定，名字自由），Set step 做本地即时反馈；host 按操作粒度
    // 回写（registry 身份 + 绑定表），多操作不共享变量——共享是串状态根因
    {
        text: 'Action-state convention: each ACTION (a button that triggers the assistant to EXECUTE a task) gets its OWN reactive variable whose default value is exactly "idle" (values: idle / running / done / failed; any variable name works, `$actionState` is conventional); never share one variable between actions. Advance it with a Set step, e.g. `btn = Button(btnLabel, Action([Set($actionState, "running"), @ToAssistant("预订")]), "primary")`, and derive the label with a ternary: `btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")`. The host flips the same variable per action (idle → running → done/failed); failed = interrupted and retryable; use it only for execution-state UI. Derived values (labels/buttons) are PLAIN statements like `btnLabel` — never `$name`: `$` initializers are stored unevaluated and render empty.',
    },
    // 一次性操作（票 02/per-action 票 03-04）：条件渲染绑操作状态变量——idle 才渲染
    // 按钮、failed 保持可重试、其余终态替换为文字（按钮原地消失，非灰化——DSL 无
    // disabled）；快照容器空对象声明供提交后恢复勾选态。E2E 实锤（2026-10-11）：模型
    // 会自创 `$submitted` 布尔开关当一次性闸（宿主只写值域变量，永不写它 → 按钮永不
    // 锁定），故显式否定该形态。concise：低频深教（一次性提交表单才用），核心段只留
    // 闸门语义与反例，完整代码模式在 skill
    {
        text: 'One-shot action convention: for forms submitted only once, bind form state to an empty reactive object (e.g. `$answers = {}` — the host restores submitted values on reload) and, driven by the action state variable, swap the button for text once submitted: `submitBtn = $actionState == "idle" ? Button("提交", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : ($actionState == "failed" ? Button("重试", Action([Set($actionState, "running"), @ToAssistant(summary)]), "primary") : TextContent("已提交 ✓", "small"))` — a submitted one-shot action never renders as a clickable button again (only a failed turn stays retryable). Gate ONLY on the action state variable — never introduce a separate boolean flag like `$submitted`: the host never writes it, so the button never locks. Inside a Form the second argument is a `Buttons([submitBtn])` wrapper, not a bare Button. Repeatable interactions need none of this.',
        concise:
            'One-shot actions (forms submitted only once): bind form state to an empty reactive object (`$answers = {}`), and driven by the action-state variable render idle → Button / failed → retry Button / else `TextContent("已提交 ✓", "small")`. Gate ONLY on the action-state variable — never a boolean flag like `$submitted` (the host never writes it, the button never locks). Inside a Form pass a `Buttons([...])` wrapper, never a bare Button. Full code pattern: `mobi:openui` skill.',
    },
    // 多操作面板（per-action 票 02 E2E 实锤句）：各操作独立——E2E 曾实测共享变量的
    // 双卡面板点 A 连带翻 B（串状态），故独立变量是硬约定
    {
        text: 'Multi-action panels: every action in one openui-lang block must have its own state variable (never share one between actions) — actions run independently, clicking one must not change another\'s label, and the host tracks each separately.',
    },
    {
        text: 'When the user triggers an action from the UI, the follow-up message carries the UI state values as plain text — execute it with your normal tools and confirm briefly; do NOT regenerate the same UI block unless asked.',
    },
]

/** 全量版规则文本（skill 用，不瘦身） */
const FULL_RULE_TEXTS = SHARED_RULES.map((r) => r.text)

/** c 档（默认核心段）规则文本：有 concise 用 concise */
const CONCISE_RULE_TEXTS = SHARED_RULES.map((r) => r.concise ?? r.text)

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
 * 自定义组件示例（票 03，只进 skill）：签名列表单独出现过一次仍被模型按直觉
 * 写成 `Svg(width, height, shapes)` / `SvgText(x, y, text)`（2026-10-19 E2E 实锤
 * 11 处语句被丢弃），故给一段可照抄的正确顺序示例——示例比签名行更能约束顺序。
 */
const CUSTOM_COMPONENT_EXAMPLE =
    'Custom component example (argument order matters): `root = Stack([chart, flow])` / `chart = Chart("bar", rows, "k", ["v"])` / `rows = [{"k": "Q1", "v": 420}]` / `flow = Svg([box, arrow, caption], "0 0 240 120")` / `box = Rect(10, 10, 80, 40, "surface", "ink", 2)` / `arrow = Line(90, 30, 130, 30, "muted", 2)` / `caption = SvgText("Step 1", 20, 80, 12, "muted")` — Svg takes the shapes list first, then viewBox (width/height optional); SvgText takes the text first, then x and y; Chart series are column names, not Series(...) objects.'

/**
 * 富混排页面示例（只进 skill）：行程/指南类请求的正确骨架——标题 + 带编号标注的
 * Map + 逐项 Card 列表 + 收尾提示。2026-10-19 E2E 实锤：只给签名时模型把行程塞进
 * Table（参数还写错）并退回 Markdown，给一段可照抄的复合布局最能约束形态。
 */
const COMPOSED_PAGE_EXAMPLE =
    'Composed page example (itinerary — one block, no markdown duplication): `root = Stack([title, sub, map, stops, tip])` / `title = TextContent("San Francisco in a Day", "large-heavy")` / `sub = TextContent("Three stops, all walkable", "small")` / `map = Map("122.4194,37.7749", 12, [{"position": "122.4194,37.7749", "label": "1"}, {"position": "122.4098,37.8087", "label": "2"}, {"position": "122.4187,37.8029", "label": "3"}], [{"points": ["122.4194,37.7749", "122.4098,37.8087", "122.4187,37.8029"], "color": "#ff6600", "weight": 4}])` / `stops = Stack([stop1, stop2, stop3])` / `stop1 = Card([TextContent("**9:00 · Ferry Building**"), TextContent("Market hall breakfast and bay views.")], "card")` / `stop2 = Card([TextContent("**11:30 · Fisherman\'s Wharf**"), TextContent("Sea lions and clam chowder.")], "card")` / `stop3 = Card([TextContent("**15:00 · Coit Tower**"), TextContent("City panorama, then walk down to North Beach.")], "card")` / `tip = Card([Callout("info", "Getting around", "Everything is within 25 minutes on foot.")])` — markers labels 1/2/3 render as numbered pins, matching the per-stop cards; keep 12 markers or fewer (use city zoom 11-13; the component swaps in a detailed overseas tile layer automatically).'

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

/** 描述首句（名录行用）：截到首个句号，压平空白；上限可调（组件名录 80 / 其他 120） */
function firstSentence(text: string, max = 120): string {
    const m = text.match(/^[\s\S]*?[.。](?=\s|$)/)
    return (m ? m[0] : text).replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * 名录（CC deferred tools 枚举表形态，2026-10-19）：`Name — 一句话用途`，无签名。
 * 模型看得见全部能力面（能自由组合），参数细节经 openui_components 工具按需拉取。
 * 描述截 80：名录职责是「知道有这个东西、干嘛的」，细节交给检索。
 */
function componentNameCatalog(
    components: Record<string, { description?: string }>,
    exclude: ReadonlySet<string>,
): string {
    return Object.entries(components)
        .filter(([name]) => !exclude.has(name))
        .map(([name, comp]) => `${name} — ${firstSentence(comp.description ?? '', 80)}`)
        .join('\n')
}

/**
 * 函数分组名录（2026-10-19）：59 行逐函数描述退成六类各一行——类名+类别一句话承担
 * 语义，函数名平铺。选函数靠类别描述，签名/精确语义靠 openui_components 检索。
 * category 映射来自 shared 的官方分类（与函数定义同一批数组，不会漂移）。
 */
const FUNCTION_CATEGORIES: ReadonlyArray<{ label: string; hint: string; names: readonly string[] }> = [
    { label: 'Lists', hint: 'build / transform / query arrays', names: listFunctions.map((f) => f.name) },
    { label: 'Numbers', hint: 'math and rounding', names: numberFunctions.map((f) => f.name) },
    { label: 'Text', hint: 'string formatting', names: textFunctions.map((f) => f.name) },
    { label: 'Colors', hint: 'color mixing / palettes', names: colorFunctions.map((f) => f.name) },
    { label: 'Dates', hint: 'date parsing and parts', names: dateFunctions.map((f) => f.name) },
    { label: 'Data', hint: 'group / aggregate / reshape rows', names: dataFunctions.map((f) => f.name) },
]

function functionNameCatalog(): string {
    return FUNCTION_CATEGORIES.map(
        (c) => `${c.label} (${c.hint}): ${c.names.map((n) => `@${n}`).join(', ')}`,
    ).join('\n')
}

/**
 * c 档 componentGroups 过滤：单组件深教 notes 下沉（低频组件的完整用法教学——
 * 名录一句话 + 检索已覆盖「知道有」，深教价值在 skill 全量版）。组合模式 notes
 * （跨组件怎么搭）保留——那是官方承载的组合教学本体。
 */
// notes 原文自带 "- " 列表前缀（官方生成器拼接），匹配带前缀
const DROPPED_NOTE_PREFIXES = ['- EditableTable', '- data is an array of { id, values }'] as const

function conciseComponentGroups(
    groups: NonNullable<ReturnType<typeof library.toSpec>['componentGroups']>,
): NonNullable<ReturnType<typeof library.toSpec>['componentGroups']> {
    return groups.map((g) => ({
        ...g,
        notes: (g.notes ?? []).filter((n) => !DROPPED_NOTE_PREFIXES.some((p) => n.startsWith(p))),
    }))
}

/** mode=app 细节指路（A/B/C 三档共用；变量表/bridge 全文在 skill） */
const APP_ROUTING_RULE =
    'For mode="app" HTML apps, style with the `--mobi-*` theme variables the host injects, and use `window.MobiApp.issueNewTurn(text)` only from explicit user actions — read the `mobi:openui` skill for the full palette and API before writing the app.'

/** A 档分层引导（票 08）：核心清单只覆盖简单场景；复杂组件先加载 skill 取全量目录，
 *  失败模式是「多一次工具调用」而非「静默丢语句」 */
const CORE_SUBSET_RULE =
    'The component reference in this prompt is a CORE SUBSET only. If the UI needs a component NOT documented above — charts, SVG drawings (Svg shapes), maps (Map), editable tables, calendars, date pickers, carousels, modals, tabs, accordions, sliders, entity lists, card blocks (Overview/Composite/Context/Visual/Snippet), or advanced image layouts — invoke the `mobi:openui` skill FIRST and read its full component catalog. Never guess a signature that is not documented above.'

/** B/C 档签名检索引导：名录看能力面，签名查工具，禁止瞎猜；skill 仍是全量兜底
 *  （组合教学/示例的家，未来组件与函数扩展的承载位） */
const TOOL_ROUTING_RULE =
    'On-demand signatures: the component catalog below lists components by NAME and PURPOSE only. Before using any component whose full signature is not printed in the reference above, call the `openui_components` tool with a comma-separated list of the exact names you plan to use — it returns their full signatures (and @-function signatures too). Load the tool via tool search if it is deferred. Never guess a signature; the `mobi:openui` skill also carries the full catalog with examples. Plain-string fields (titles, subtitles, labels) take text, not components.'

/** 核心段 prompt 选项（常驻 system prompt；判据 + skill 引导 + 核心示例 + 核心组件子集） */
export const OPENUI_CORE_PROMPT_OPTIONS = {
    inlineMode: true,
    // 官方静态示例对生成质量关键（票 02 实测缺示例时模型误用签名、10 条语句被丢弃），
    // 核心段带「纯核心组件」子集，其余示例随全量目录在 skill
    examples: pickCoreExamples(CORE_COMPONENTS),
    preamble:
        'You can embed interactive UI in your replies using openui-lang when it genuinely helps the user (comparisons, dashboards, forms, selection cards, parameter exploration, step-by-step choices).',
    additionalRules: [
        ...FULL_RULE_TEXTS,
        // mode=app 细节指路（变量表/bridge 全文在 skill；此处一句防盲写）
        APP_ROUTING_RULE,
        // 分层引导（票 08）：核心清单只覆盖简单场景；复杂组件先加载 skill 取全量目录，
        // 失败模式是「多一次工具调用」而非「静默丢语句」
        CORE_SUBSET_RULE,
    ],
}

/** 全量版 prompt 选项（进 openui skill；判据同核心防单读缺位，app 细则全文在此） */
const OPENUI_FULL_PROMPT_OPTIONS = {
    inlineMode: true,
    examples: openuiExamples,
    preamble: OPENUI_CORE_PROMPT_OPTIONS.preamble,
    additionalRules: [...FULL_RULE_TEXTS, ...APP_DETAIL_RULES, CUSTOM_COMPONENT_EXAMPLE, COMPOSED_PAGE_EXAMPLE],
} as const

/**
 * 核心段形态档位（2026-10-19 三档对比实验，E2E 6 探针×3 档实测后裁决落定 c）：
 * - a：票 08 现状——35 核心组件全签名 + 「不在清单先加载 skill」
 * - b：热集 ~22 全签名 + 其余 73 名录（已淘汰：体积最大 34,990 且无增益）
 * - c：**默认档**——组件零常驻签名 + 全量 95 名录 + openui_components 工具检索；
 *   函数 59 个暂保持全签名常驻（实验形态），目录膨胀到阈值再退名录（工具已支持）
 * 对比数据：c 29,530 chars（比 a 省 2.5K）、渲染率与冷组件正确性打平 a、抽样零告警。
 */
export type OpenUiPromptProfile = 'a' | 'b' | 'c'

/**
 * 生成核心段（system prompt 常驻）：全量 spec 的 components 按档位取子集，
 * 经同一 generateSystemPrompt assembler 重建——不是对全量文本的切割。
 * a 档输出与 OPENUI_CORE_PROMPT_OPTIONS 完全一致（同步测试全等比对锚点）。
 */
export function buildCorePrompt(profile: OpenUiPromptProfile = 'c'): string {
    const spec = library.toSpec()
    if (profile === 'a') {
        const components = subsetComponents(spec, CORE_COMPONENTS)
        return generateSystemPrompt({ ...spec, components, ...OPENUI_CORE_PROMPT_OPTIONS })
    }
    const hotSet = new Set<string>(profile === 'b' ? HOT_COMPONENTS : [])
    const names = profile === 'b' ? HOT_COMPONENTS : []
    const components = subsetComponents(spec, names)
    // c 档四项瘦身（2026-10-19 裁决 A+B+C+D）：
    // - functions: {} + 分组名录——59 行逐函数签名退成六类各一行
    // - componentGroups 过滤单组件深教 notes（组合模式 notes 保留）
    // - mobi 规则用 concise 版（官方 notes 已覆盖的部分不再重复）
    // - 组件名录描述截 80
    return generateSystemPrompt({
        ...spec,
        components,
        functions: {},
        componentGroups: conciseComponentGroups(spec.componentGroups ?? []),
        inlineMode: true,
        examples: pickCoreExamples(HOT_COMPONENTS),
        preamble: OPENUI_CORE_PROMPT_OPTIONS.preamble,
        additionalRules: [
            ...CONCISE_RULE_TEXTS,
            APP_ROUTING_RULE,
            TOOL_ROUTING_RULE,
            `Function catalog (@-prefixed, grouped by category, no signatures — fetch exact signatures via \`openui_components\`):\n${functionNameCatalog()}`,
            `Component catalog (NAME — purpose only, no signatures):\n${componentNameCatalog(spec.components, hotSet)}`,
        ],
    })
}

function subsetComponents<S extends { components: Record<string, unknown> }>(
    spec: S,
    names: readonly string[],
): S['components'] {
    return Object.fromEntries(
        names.filter((name) => name in spec.components)
            .map((name) => [name, spec.components[name as keyof S['components']]]),
    )
}

/** 检索工具数据源：全量组件目录（name/signature/description），openui_components MCP 工具消费 */
export interface OpenUiCatalogEntry {
    name: string
    signature: string
    description: string
}

export function buildComponentCatalog(): OpenUiCatalogEntry[] {
    const spec = library.toSpec()
    return Object.entries(spec.components).map(([name, comp]) => ({
        name,
        signature: (comp as { signature?: string }).signature ?? '',
        description: (comp as { description?: string }).description ?? '',
    }))
}

/** 检索工具数据源：全量函数目录（与组件同形，双检索共用一个工具） */
export function buildFunctionCatalog(): OpenUiCatalogEntry[] {
    const spec = library.toSpec()
    return Object.entries(spec.functions ?? {}).map(([name, fn]) => ({
        name,
        signature: (fn as { signature?: string }).signature ?? '',
        description: (fn as { description?: string }).description ?? '',
    }))
}

/** openui skill 的 frontmatter description（触发词与引导规则同口径） */
const SKILL_DESCRIPTION =
    'openui-lang deep reference for interactive UI blocks — load BEFORE writing rich composed pages (travel itineraries, guides, multi-section reports), charts, geographic maps (Map with AMap), SVG drawings (Svg shapes), sandboxed HtmlView pages, or whenever you are unsure how to combine components. SKILL.md carries the routing rules and a references index; exact signatures are also available on demand via the `openui_components` tool.'

/**
 * 生成 openui skill 全文（2026-10-19 拆分为索引 + references 渐进披露）：
 *
 * SKILL.md 只放「被加载就必须有的东西」——触发说明、全部规则（FULL_RULE_TEXTS + app
 * 指路）、references 文件索引。组件名录在 system prompt 常驻（不重复）；精确签名走
 * openui_components 工具（不重复）；全量签名/示例/app 细则按需 Read references/。
 * 加载成本从「一律 54K」降到「~7K + 按需 1 个 reference」。
 *
 * frontmatter 必须在文件最开头——CC 只解析首行起的 YAML；版权/生成提示注释因此放在
 * frontmatter 之后，否则整个 skill 不被识别（2026-10-19 E2E 实锤 Unknown skill）。
 */
export function buildSkillMarkdown(): string {
    return [
        '---',
        'name: openui',
        `description: ${SKILL_DESCRIPTION}`,
        '---',
        '',
        SKILL_FILE_HEADER.trimEnd(),
        '',
        '# OpenUI Reference (index)',
        '',
        'The system prompt already carries the component/function name catalog and the `openui_components` tool fetches exact signatures. Read the reference files below ONLY for what you actually need:',
        '',
        '- `references/examples.md` — copyable openui-lang programs (official examples, composed-page and custom-component examples). Read this before writing a rich composed page.',
        '- `references/signatures.md` — full signature reference (95 components grouped + 59 @-functions) for browsing whole families at once; prefer `openui_components` for a few names.',
        '- `references/app-details.md` — full `--mobi-*` theme variable palette and the `MobiApp.issueNewTurn` bridge API for mode="app" HTML apps.',
        '',
        '## Rules',
        '',
        ...FULL_RULE_TEXTS.map((rule) => `- ${rule}`),
        '- ' + APP_ROUTING_RULE,
        '',
    ].join('\n')
}

/** references/examples.md：可照抄示例（官方 6 例 + 自定义组件示例 + 组合页示例） */
export function buildSkillExamples(): string {
    return [
        SKILL_FILE_HEADER.trimEnd(),
        '',
        '# Copyable Examples',
        '',
        ...openuiExamples.map((ex) => `${ex}\n`),
        '## Custom component examples',
        '',
        CUSTOM_COMPONENT_EXAMPLE,
        '',
        COMPOSED_PAGE_EXAMPLE,
        '',
    ].join('\n')
}

/**
 * references/signatures.md：全量签名兜底。与 skill 全量 prompt 同一次生成的文本中
 * 同源切出「Component Signatures（含分组 notes）+ Built-in Functions」连续区间——
 * 切的是本脚本刚生成的字符串（非旧文件），升级 react-ui 后重跑即刷新。
 */
export function buildSkillSignatures(): string {
    const full = library.prompt(OPENUI_FULL_PROMPT_OPTIONS)
    const start = full.indexOf('## Component Signatures')
    const end = full.indexOf('## Action —')
    const body = start >= 0 && end > start ? full.slice(start, end).trimEnd() : ''
    return [
        SKILL_FILE_HEADER.trimEnd(),
        '',
        '# Full Signatures (95 components + 59 functions)',
        '',
        'For a few names prefer the `openui_components` tool; this file is for browsing whole families.',
        '',
        body,
        '',
    ].join('\n')
}

/** references/app-details.md：mode=app 细则全文（palette 变量表 + bridge API） */
export function buildSkillAppDetails(): string {
    return [
        SKILL_FILE_HEADER.trimEnd(),
        '',
        '# mode="app" HTML App Details',
        '',
        ...APP_DETAIL_RULES.map((rule) => `- ${rule}`),
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
// 层数路径在文件挪位时静默写错地方（票 08 实踩两次）。
// --profile=a|b 仅供对照实验改写核心段产物（skill 与 catalog 不变）；默认 c。
if (import.meta.main) {
    const profileArg = process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length)
    const profile: OpenUiPromptProfile =
        profileArg === 'a' || profileArg === 'b' ? profileArg : 'c'

    const scriptDir = dirname(fileURLToPath(import.meta.url))
    const coreOut = resolve(scriptDir, '../src/claude/utils/openuiCorePrompt.generated.ts')
    const core = buildCorePrompt(profile)
    writeFileSync(coreOut, `${tsHeader}export const OPENUI_CORE_PROMPT = ${JSON.stringify(core)}\n`)
    console.log(`profile=${profile} written ${coreOut} (${core.length} chars)`)

    // catalog 产物：openui_components MCP 工具的数据源（与 prompt 同一 library 单源；
    // 组件与函数两个目录共用一个工具做双检索）
    const catalogOut = resolve(scriptDir, '../src/claude/utils/openuiCatalog.generated.ts')
    const catalog = buildComponentCatalog()
    const functionCatalog = buildFunctionCatalog()
    writeFileSync(catalogOut, [
        tsHeader,
        '/**\n * ⚠️ 生成文件——勿手改。重生成：bun run packages/session/scripts/generate-openui-prompt.ts\n * 来源：@openuidev/react-ui openuiLibrary 全量 toSpec()（95 组件 + 59 函数），\n * 消费方：openui_components MCP 工具（签名按需检索，组件+函数双目录）\n */\n',
        `export interface OpenUiCatalogEntry {\n    name: string\n    signature: string\n    description: string\n}\n`,
        `export const OPENUI_COMPONENT_CATALOG: readonly OpenUiCatalogEntry[] = ${JSON.stringify(catalog, null, 2)}\n`,
        `export const OPENUI_FUNCTION_CATALOG: readonly OpenUiCatalogEntry[] = ${JSON.stringify(functionCatalog, null, 2)}\n`,
    ].join('\n'))
    console.log(`written ${catalogOut} (${catalog.length} components + ${functionCatalog.length} functions)`)

    const skillDir = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui')
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), buildSkillMarkdown())
    writeFileSync(join(skillDir, 'references', 'examples.md'), buildSkillExamples())
    writeFileSync(join(skillDir, 'references', 'signatures.md'), buildSkillSignatures())
    writeFileSync(join(skillDir, 'references', 'app-details.md'), buildSkillAppDetails())
    for (const f of ['SKILL.md', 'references/examples.md', 'references/signatures.md', 'references/app-details.md']) {
        const p = join(skillDir, f)
        console.log(`written ${p} (${readFileSync(p, 'utf8').length} chars)`)
    }
}
