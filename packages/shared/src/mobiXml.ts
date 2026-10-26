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
 * 指令族 XML 命名空间协议（spec .scratch/mobi-xml-namespace）：`<mobi:name attrs/>`
 * 形态的族通用原语 + artifact 成员语义。
 *
 * 分层：本模块只管「族」这一层——命名空间常量、单标签正形、扫描/去重/流式截断的
 * 通用实现；成员语义（quote 的 index、artifact 的 path/mode）由本模块（artifact）
 * 与 quoteProtocol（quote）各自绑定。旧 `:mobi-*` DSL 的读兼容留在 web 注册表
 * （domain/chat/directives），与本模块互不感知。
 *
 * 全部纯函数、单 pass 正则、零 IO，浏览器与节点两侧同源可用。
 */

/**
 * 指令族 XML 命名空间：所有内联指令的 XML 标签带此前缀——与模型正文里自然产出的
 * 泛 XML/HTML 标签碰撞免疫（泛型名如 `<quote>` 在讨论 XML 本身时会误命中）；
 * 命名空间前缀（xsl:/fb: 形态）训练语料海量，模型不陌生。
 */
export const MOBI_XML_NS = 'mobi:'
/** 族标签开前缀 `<mobi:`——新形态热路径守卫的单闸字面量（禁手抄） */
export const MOBI_XML_OPEN = `<${MOBI_XML_NS}`

/**
 * 单标签完整正形（无 g 标志的源串）：自闭合 `<tag …/>` 或完整回显 `<tag …>…</tag>`。
 *  attrs 段不含 `>`；attrs 必须懒量词（`[^>]*?`）：贪婪会把自闭合尾部的 `/` 吃进
 *  attrs、随后以开放标签分支懒吞到下一个闭合标签——同文本后随回显形态时自闭合命中
 *  被整体污染（2026-10-26 E2E 实锤）。懒量词让 `/>` 分支优先在自闭合处命中。
 */
export function xmlTagShape(tag: string): string {
    return `<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`
}

/**
 * 多标签合并的 tokenizer 正形（外层整组包裹——marked 扩展 `^` 锚定派生用）。
 *  两个 alternation 陷阱都在此封死（票 01 实锤）：`<` 必须逐分支携带（括在组外
 *  第二分支成裸标签名）；`^` 只锚定第一分支，必须外层整组包裹。
 */
export function buildXmlTokenShape(tagNames: readonly string[]): string {
    return `(?:${tagNames.map(t => `(?:${xmlTagShape(t)})`).join('|')})`
}

/** attrs 值允许的引号：直引号 + 中文弯引号（模型中文语境输出易带弯引号，容错而非降级）。
 *  值不含引号字符，协议不定义转义。 */
const XML_ATTR_RE = /([a-zA-Z][\w-]*)\s*=\s*["“”]([^"“”]*)["“”]/g

/**
 * attrs 串 → 键值表（`key="val"` 空格分隔；值不含引号，协议不定义转义；同名后者覆盖）。
 * 引号容错集与键名字符集是协议级决策，XML 族与 web 旧 directive 族共用本实现，
 * 禁止再抄一份。
 */
export function parseTagAttrs(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    for (const m of raw.matchAll(XML_ATTR_RE)) {
        attrs[m[1]!] = m[2]!
    }
    return attrs
}

/** 族通用标签命中：tagName（不含尖括号）+ 已解析 attrs + 原文与位置 */
export interface XmlTagHit {
    tagName: string
    attrs: Record<string, string>
    /** 命中原文（自闭合标签或完整标签对），消费方整体摘除/替换 */
    raw: string
    start: number
    end: number
}

/** 执行态正则缓存（key = pattern 串，扫描正则记忆化） */
const DERIVED_RES = new Map<string, RegExp>()

function derivedRe(key: string, build: () => RegExp): RegExp {
    let re = DERIVED_RES.get(key)
    if (!re) {
        re = build()
        DERIVED_RES.set(key, re)
    }
    return re
}

/** 各标签的执行态共享扫描正则（g 标志，每次使用前重置 lastIndex；按标签名缓存） */
function tagScanRe(tag: string): RegExp {
    return derivedRe(tag, () => new RegExp(xmlTagShape(tag), 'g'))
}

/** tagNames → opens 派生缓存：调用方传模块级常量清单时热路径零重复派生（流式
 *  每帧调用；临时数组作 key 不命中缓存，仅省一次 map，行为不变） */
const OPENS_CACHE = new WeakMap<readonly string[], readonly string[]>()

export function opensOf(tagNames: readonly string[]): readonly string[] {
    let opens = OPENS_CACHE.get(tagNames)
    if (opens === undefined) {
        opens = tagNames.map(t => `<${t}`)
        OPENS_CACHE.set(tagNames, opens)
    }
    return opens
}

/** 文本含任一指定标签形态的快速守卫（去重/保护区/截断共用热路径闸） */
export function hasXmlTagOpen(text: string, opens: readonly string[]): boolean {
    return opens.some(open => text.includes(open))
}

/**
 * 族通用扫描：文本 → 标签命中序列（按出现顺序，跨标签归并）。
 *
 * 只认正形（自闭合 / 完整回显带闭合标签收口）：流式半截（无 `>` 或未收口）不产出
 * 命中——半截由流式截断扣住（{@link truncateIncompleteXmlTagTail}），闭合帧一次性
 * 完整进入渲染。参数合法性（quote 的 index、artifact 的 path）不在本层判定，由
 * 消费方按成员语义过滤或降级。守卫唯一归属此处（无标签一次扫描早退）。
 *
 * echo 形态 body 内的同族标签（如 `<mobi:quote>见 <mobi:artifact/> </mobi:quote>`）
 * 不产出独立命中——被外层区间包含的命中按嵌套丢弃（回显内容不是独立指令，外层
 * 整体消费：去重摘除外层时区间一并摘除，内层不再登记去重键产幻影）。
 */
export function scanXmlTagHits(text: string, tagNames: readonly string[]): XmlTagHit[] {
    if (!hasXmlTagOpen(text, opensOf(tagNames))) return []
    const hits: XmlTagHit[] = []
    for (const tag of tagNames) {
        const re = tagScanRe(tag)
        re.lastIndex = 0
        for (let m = re.exec(text); m; m = re.exec(text)) {
            hits.push({ tagName: tag, attrs: parseTagAttrs(m[1] ?? ''), raw: m[0], start: m.index, end: m.index + m[0].length })
        }
    }
    // 跨标签命中按原文位置归并；被前一个命中区间包含的（echo body 内嵌）丢弃
    hits.sort((a, b) => a.start - b.start)
    const merged: XmlTagHit[] = []
    for (const hit of hits) {
        const last = merged[merged.length - 1]
        if (last !== undefined && hit.start < last.end) continue
        merged.push(hit)
    }
    return merged
}

/** word 字符（`\b` 语义单源：标签名后随 word 字符即形近词，不算标签开） */
const WORD_CHAR_RE = /[A-Za-z0-9_]/

/**
 * 全部合法标签开起点（升序；`\b` 语义——`<mobi:artifactx` 形近词不算）。从尾部
 * lastIndexOf 反向收集，零 match 分配；i 归 0 即终止——`lastIndexOf(open, -1)` 被
 * 钳到 0 会反复命中自身死循环（code-review 实锤：`<quoted` 在串首时挂起流式渲染）。
 */
function tagOpenPositions(text: string, opens: readonly string[]): number[] {
    const positions: number[] = []
    for (const open of opens) {
        let i = text.lastIndexOf(open)
        while (i !== -1) {
            if (!WORD_CHAR_RE.test(text[i + open.length] ?? '')) positions.push(i)
            i = i > 0 ? text.lastIndexOf(open, i - 1) : -1
        }
    }
    return positions.sort((a, b) => a - b)
}

/**
 * 流式原子揭示（族通用）：drip 半截的开标签尾巴扣住不进渲染（x-markdown 的流式
 * recognizer 不覆盖自定义扩展，半截 Text commit 后闭合不重识别）。仅扣串尾，闭合帧
 * 一次性完整进入渲染；模型真输出无闭合字面量时流结束诚实呈现（静态路径不截断）。
 *
 * 两类尾巴：1. 开标签未到 `>`（`<mobi:artifact path="`）；2. 开标签 `>` 已到、对应
 * 闭合标签未到（回显形态半截）。从**最早的**标签开起逐个检查收口，第一个未完整
 * 收口的起点整段扣住（其后内容都在流式未来里，一并扣住）——echo body 内后随的
 * 完整标签不能让更早的未闭合 echo 放行（否则半截开标签按 Text commit 裸奔）。
 * 闭合判定按**该起点的标签名**查闭合对（族混排下不拿别族闭合对误判完整）。
 */
export function truncateIncompleteXmlTagTail(text: string, opens: readonly string[]): string {
    for (const start of tagOpenPositions(text, opens)) {
        const rest = text.slice(start)
        // 自闭合完整形态（开标签含尾斜杠已到 `>`）：完整即揭示
        if (/^<[\w:.-]+\b[^>]*\/>/.test(rest)) continue
        const tagMatch = rest.match(/^<([\w:.-]+)/)
        // 对应闭合对已到（回显形态收口）：完整即揭示
        if (tagMatch && rest.includes(`</${tagMatch[1]}>`)) continue
        return text.slice(0, start)
    }
    return text
}

/**
 * 族通用去重：keyOf 路由各成员的去重键（null = 不参与去重，原样保留——非法命中
 * 或成员不设键），同键只保留首次出现，其余从文本整体摘除；输入变化时输出保持
 * 前缀稳定（后来的重复只会让尾部更短）——与流式渲染的 append-only 假设兼容。
 *
 * **键的全局唯一性归 keyOf**：同族多标签混排时（quote 的 index="1" 与 artifact 的
 * path="1"），keyOf 必须产出互不冲突的键（如按成员语义前缀）；跨标签同义合并
 * （quote 的 `<quote/>` 与 `<mobi:quote/>` 同 index 是同一引用）也由 keyOf 收敛到
 * 同键表达——通用层不替任何一方做命名空间决策。
 *
 * protectedRanges：调用方标出的「协议无权改写」区间（如 markdown 代码围栏/行内
 * 代码——代码示例里的标签是内容不是协议）。完全落在保护区内的命中透明处理：
 * 不摘除、不占去重键（其后的区外同键命中仍按首个处理）。
 */
export function dedupeXmlTagText(
    text: string,
    tagNames: readonly string[],
    keyOf: (hit: XmlTagHit) => string | null,
    protectedRanges?: readonly Readonly<{ start: number; end: number }>[],
): string {
    const seen = new Set<string>()
    let out = ''
    let cursor = 0
    let removedAny = false
    for (const hit of scanXmlTagHits(text, tagNames)) {
        if (protectedRanges?.some(r => hit.start >= r.start && hit.end <= r.end)) continue
        const key = keyOf(hit)
        if (key === null) continue
        if (seen.has(key)) {
            out += text.slice(cursor, hit.start)
            cursor = hit.end
            removedAny = true
            continue
        }
        seen.add(key)
    }
    // 无剔除则原样返回（避免无谓的字符串重建，历史消息每帧渲染都走这里）
    if (!removedAny) return text
    return out + text.slice(cursor)
}

// ---------------------------------------------------------------------------
// artifact 成员语义（spec .scratch/mobi-xml-namespace 票 02）
// ---------------------------------------------------------------------------

/** artifact 现行标签名（带命名空间，写路径唯一形态；旧 DSL `:mobi-artifact{}` 读
 *  兼容在 web 注册表，无旧 XML 形态） */
export const ARTIFACT_TAG_NS = `${MOBI_XML_NS}artifact`

/** artifact 标签形态清单（单形态，读兼容矩阵在 web DSL 侧） */
export const ARTIFACT_TAG_NAMES: readonly string[] = [ARTIFACT_TAG_NS]

/**
 * 展示意愿 mode：`card` 强制产物卡；`wide` 仅 HTML 放宽容器；`app` = 沙箱交互 app
 * （宿主注入主题变量 + 回灌桥）；`viz` / `viz-wide` = 可视化 fragment 档（宿主注入
 * --viz-* token/工具类/交互运行时，蕴含 app 档，`viz-wide` 再叠加 wide）；
 * 缺省 = auto（web 按类型定渲染形态）。
 */
export type ArtifactMode = 'card' | 'wide' | 'app' | 'viz' | 'viz-wide'

export const ARTIFACT_MODES: readonly string[] = ['card', 'wide', 'app', 'viz', 'viz-wide']

/** artifact 声明的类型化参数。mode 非法值按缺省 auto 处理（模型输出容错优先，
 *  不因拼写降级整条声明） */
export interface ArtifactTagParams {
    path: string
    mode?: ArtifactMode
}

/**
 * artifact 参数语义单源：path 必填（非空白字符串），mode 仅接受枚举值（非法归
 * undefined = auto）。XML 形态与旧 DSL `:mobi-artifact{}` 两语法共用本判定，
 * 非法（缺 path / 空 path）返回 null，消费方按原文诚实降级。
 */
export function parseArtifactTagAttrs(attrs: Record<string, string>): ArtifactTagParams | null {
    const { path, mode } = attrs
    if (path === undefined || path.trim() === '') return null
    return { path, mode: mode !== undefined && ARTIFACT_MODES.includes(mode) ? mode as ArtifactMode : undefined }
}

/** artifact 去重键 = path（同一产物一条消息只保留首次声明）；非法 → null 不参与去重 */
export function artifactDedupeKey(attrs: Record<string, string>): string | null {
    return parseArtifactTagAttrs(attrs)?.path ?? null
}
