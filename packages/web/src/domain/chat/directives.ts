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
 * 内联指令通用管线：模型在回复正文输出的 `:mobi-<name>{key="val" ...}` 指令的
 * 语法、扫描、去重与注册表单源（自 quote 专属实现通用化而来）。
 *
 * 分工：本模块只管「指令」这一语法层——某指令的语义（参数含义、发射时机、CLI 协议
 * 文案）留在各 per-type 模块（如 quoteDirectives），渲染组件路由在 ui/shared 的
 * quoteDirectiveComponents（MobiDirective）。新增一个内联指令 = domain 注册一项 + ui 路由表加一行。
 *
 * 流式半截 directive（未闭合）不命中扫描——x-markdown 的不完整语法占位负责流式期间
 * 的视觉过渡，闭合后自然成钮（沿袭 quote 专属实现的行为契约）。
 */

/** 指令前缀：per-type 字面量（如 shared QUOTE_DIRECTIVE）必须以此开头（namespace 防线） */
export const DIRECTIVE_PREFIX = ':mobi-'

/**
 * 前缀容错 lead（2026-10-10 生产实锤，c568aa0b 会话）：模型偶发把单半角冒号写岔——
 * markdown 围栏风格 `:::`、全角冒号 `：`、冒号后带空格（`: ：mobi-quote`），语法
 * 记岔时 directive 不被解析、整串原文裸奔进聊天流。`mobi-<name>{...}` 字面量不可能
 * 出现在正常散文，窄归一吞掉变体前缀——同 attrs 弯引号「容错而非降级」哲学。
 * 只容错 1-3 个冒号与冒号之间/之后的空格、制表符（不吃换行防跨行误吞，也不吃
 * 指令前的普通分隔空格——raw 边界与正形保持一致，既有去重/截断行为不变）。
 */
export const DIRECTIVE_LEAD = '(?:[:：][ \t]*){1,3}'

/**
 * 通用完整形态：`[:：]…mobi-<name>{<attrs>}`——name 小写字母开头可含数字连字符，
 * attrs 为不含花括号的任意串（`key="val"` 空格分隔，见 parseDirectiveAttrs）。
 * 去重/解析与 markdown 扩展（directivePlugin）的 tokenizer 由它派生，对同一
 * directive 的判定同源，语法变更只改这一处。
 */
export const DIRECTIVE_SHAPE = `${DIRECTIVE_LEAD}mobi-([a-z][a-z0-9-]*)\\{([^{}]*)\\}`

const DIRECTIVE_RE = new RegExp(DIRECTIVE_SHAPE, 'g')

/** lead + 指令名的快速判定（dedupe 热路径 / tokenizer start 用） */
const DIRECTIVE_LEAD_RE = new RegExp(`${DIRECTIVE_LEAD}mobi-`)

/** 下一个指令（含变体前缀）在 src 中的起点；无命中返回 -1（marked start 约定） */
export function findDirectiveStart(src: string): number {
    // 冒号前置守卫：lead 首字符必为冒号，无冒号文本（流式 markdown 的绝大多数）
    // 免整串正则扫描——tokenizer 的 start 钩子对每段剩余 src 调用，成倍放大
    if (!src.includes(':') && !src.includes('：')) return -1
    const m = src.match(DIRECTIVE_LEAD_RE)
    return m?.index ?? -1
}

/** attrs 值允许的引号：直引号 + 中文弯引号（模型在中文语境输出易带弯引号，容错而非降级） */
const ATTR_QUOTE = '["“”]'
const ATTR_VALUE = '[^"“”]*'

/** attrs 串 → 键值表（`key="val"` 空格分隔；值不含引号，协议不定义转义；同名后者覆盖） */
export function parseDirectiveAttrs(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    for (const m of raw.matchAll(new RegExp(`([a-zA-Z][\\w-]*)\\s*=\\s*${ATTR_QUOTE}(${ATTR_VALUE})${ATTR_QUOTE}`, 'g'))) {
        attrs[m[1]!] = m[2]!
    }
    return attrs
}

/** 单个 directive 命中：指令名 + attrs + 原文位置 */
export interface DirectiveHit {
    name: string
    attrs: Record<string, string>
    /** 命中原文（`:mobi-x{...}` 完整串） */
    raw: string
    start: number
    end: number
}

/** 扫描全部命中（未注册指令同样命中，由消费方按注册表路由或降级；按出现顺序） */
export function parseDirectiveHits(text: string): DirectiveHit[] {
    const hits: DirectiveHit[] = []
    DIRECTIVE_RE.lastIndex = 0
    for (let m = DIRECTIVE_RE.exec(text); m; m = DIRECTIVE_RE.exec(text)) {
        hits.push({
            name: m[1]!,
            attrs: parseDirectiveAttrs(m[2] ?? ''),
            raw: m[0],
            start: m.index,
            end: m.index + m[0].length,
        })
    }
    return hits
}

/**
 * 指令定义（注册表项）：per-type 语义层声明「参数怎么读、重复怎么判」。
 * P 为该指令的类型化参数形态（如 quote 的索引串）。
 */
export interface DirectiveDefinition<P> {
    /** 指令完整字面量（如 shared QUOTE_DIRECTIVE），必须以 DIRECTIVE_PREFIX 开头 */
    directive: string
    /** attrs → 类型化参数；非法（伪造/缺字段）返回 null，消费方按原文诚实降级 */
    parse: (attrs: Record<string, string>) => P | null
    /** 去重键（可选）：提供者参与重复剔除——同键命中只保留首个 */
    dedupeKey?: (params: P) => string
}

/** 注册表内部形态（抹平泛型：parse 返回 unknown，dedupeKey 单点 cast） */
interface RegisteredDirective {
    parse: (attrs: Record<string, string>) => unknown
    dedupeKey?: (params: unknown) => string
}

const registry = new Map<string, RegisteredDirective>()

/** 注册指令（模块加载期调用）；前缀不符立即抛错——per-type 字面量与 PREFIX 拼写漂移的防线 */
export function registerDirective<P>(definition: DirectiveDefinition<P>): void {
    if (!definition.directive.startsWith(DIRECTIVE_PREFIX)) {
        throw new Error(`directive "${definition.directive}" 必须以 ${DIRECTIVE_PREFIX} 开头`)
    }
    registry.set(definition.directive.slice(DIRECTIVE_PREFIX.length), {
        parse: definition.parse,
        dedupeKey: definition.dedupeKey
            ? (params) => definition.dedupeKey!(params as P)
            : undefined,
    })
}

/** 通用重复剔除：注册了 dedupeKey 的指令按「指令名+键」去重，同键只保留首次出现，
 *  其余从文本移除；未注册指令与无 dedupeKey 的命中原样保留。输入变化时输出保持
 *  前缀稳定（后来的重复只会让尾部更短）——与流式渲染的 append-only 假设兼容，
 *  不会引发已揭示内容的重淡入。 */
export function dedupeDirectiveText(text: string): string {
    // 快速路径单源：findDirectiveStart 的 -1 返回即「无指令」（冒号守卫 + lead 正则
    // 都在其中），此处不再手抄一份同义守卫
    if (findDirectiveStart(text) === -1) return text
    const seen = new Set<string>()
    let out = ''
    let cursor = 0
    let removedAny = false
    for (const hit of parseDirectiveHits(text)) {
        const def = registry.get(hit.name)
        const params = def ? def.parse(hit.attrs) : null
        const key = def && params !== null && def.dedupeKey
            ? `${hit.name}\0${def.dedupeKey(params)}`
            : null
        if (key !== null) {
            if (seen.has(key)) {
                out += text.slice(cursor, hit.start)
                cursor = hit.end
                removedAny = true
                continue
            }
            seen.add(key)
        }
    }
    // 无剔除则原样返回（避免无谓的字符串重建，历史消息每帧渲染都走这里）
    if (!removedAny) return text
    return out + text.slice(cursor)
}

/**
 * 未闭合 directive 尾巴：`:mobi-<name>` 后要么直接到串尾、要么 `{` 已出现但
 * attrs 未闭合——两者都只在**串尾**命中，正文里带后随文字的 `:mobi-x` 字样
 * （讨论语法本身）不受影响。
 */
const INCOMPLETE_DIRECTIVE_TAIL_RE = new RegExp(`${DIRECTIVE_LEAD}mobi-[a-z][a-z0-9-]*(?:\\{[^{}]*$|$)`)

/**
 * drip 原子揭示截断：把流式揭示前缀里「尚未闭合的 directive 尾巴」扣住不进渲染。
 *
 * 为何需要：x-markdown 的流式 recognizer 只覆盖 link/emphasis/code 等内建语法
 * （半截有占位、闭合重识别），自定义 marked 扩展（`:mobi-*{...}`）半截字符一旦
 * 按 Text commit，闭合后不重识别——真机表现为流式期间指令裸文本、刷新后才成钮
 * （2026-09-28）。把半截尾巴扣在 drip 层，闭合帧一次性完整进入 parse，与内建
 * 语法的 pending 语义对齐。
 *
 * 只在 drip 流式路径调用（静态渲染恒透传完整文本）：模型真输出无闭合的
 * `:mobi-x{` 字面量时，揭示期间尾部暂扣、流结束静态帧诚实呈现原文。
 * 输出随 display 前缀增长单调不减（截断点只随新字符闭合或不动），与
 * append-only 假设兼容。
 */
export function truncateIncompleteDirectiveTail(text: string): string {
    const m = text.match(INCOMPLETE_DIRECTIVE_TAIL_RE)
    return m ? text.slice(0, m.index) : text
}
