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

import { z } from 'zod'

/**
 * mobi URI 内部操作协议（ADR 0003）：`mobi://<资源域>/<动作>?<params>`。
 * URI 是内部动作的唯一权威编码，承载形态是 Markdown 链接 `[文案](mobi://…)`；
 * 注册表（参数约束 + 风险等级）在本包，执行器分发表在 web。
 * 词汇见 packages/shared/CONTEXT.md「内部操作协议」节。
 */

/** mobi URI 的 scheme（解析时大小写不敏感，按 URI 惯例归一小写） */
export const MOBI_URI_SCHEME = 'mobi'

/** 动作风险等级（注册时声明，非运行时判定；高危动作永不注册=结构上不存在）。
 * navigate/open 类点击即执行；send 类内容可见点击即确认。 */
export type ActionRisk = 'navigate' | 'send'

/** 单个动作的注册项：参数约束与风险等级是协议定义的一部分 */
export interface ActionDefinition<P extends z.ZodType = z.ZodType> {
    /** 参数 schema（query 键值 → 强类型载荷） */
    params: P
    risk: ActionRisk
}

/**
 * 动作注册表：`资源域/动作` → 定义的唯一权威映射。
 * 未注册的组合在结构上不存在——不存在该动作，而非被禁止的动作。
 * 新动作（message/send 等）只在此注册新键，协议本体不动。
 */
export const ACTION_REGISTRY = {
    'session/open': {
        params: z.object({ id: z.string().min(1) }),
        risk: 'navigate',
    },
    /**
     * 在 inspector pane 打开文件（ADR 0003 第二期第一个动作）：
     * - path：相对会话 cwd 的路径，或 `/` 开头的绝对路径（POSIX 惯例，透传给
     *   read-file 读取链，`resolve(cwd, path)` 天然双支持）。实际可达范围由服务端
     *   读取策略约束（当前 = 严格 cwd 子树）——协议只承诺透传，边界演进不动参数。
     * - name：tab 显示名，缺省取 path 基名。
     * - expand：是否检测并展开 inspector（false = 只更新 tab 不抢屏），缺省 true。
     */
    'file/open': {
        params: z.object({
            path: z.string().min(1),
            name: z.string().optional(),
            // query 键值恒为 string（解析侧），构造侧传 boolean：union 双形态后 transform
            // 成 boolean 输出。不用 z.coerce.boolean()（Boolean('false') === true 的经典坑）
            expand: z.union([z.boolean(), z.enum(['true', 'false'])])
                .optional()
                .transform((v) => v !== 'false' && v !== false),
        }),
        risk: 'navigate',
    },
} as const satisfies Record<string, ActionDefinition>

/** 已注册动作的注册键 */
export type ActionKey = keyof typeof ACTION_REGISTRY & string

/** 已注册动作经校验后的解析产物 */
export type RegisteredAction<K extends ActionKey = ActionKey> = {
    key: K
    domain: string
    action: string
    params: z.infer<(typeof ACTION_REGISTRY)[K]['params']>
    risk: (typeof ACTION_REGISTRY)[K]['risk']
}

/** URI host（资源域）合法字符：小写字母/数字/连字符（RFC host 的保守子集） */
const DOMAIN_RE = /^[a-z0-9-]+$/

/** 动作名合法字符：同资源域（小写单词，不加连字符以外符号） */
const ACTION_RE = /^[a-z0-9-]+$/

/**
 * 解析 mobi URI 为动作，返回三态：RegisteredAction（已注册且参数过校验）/
 * UnregisteredAction（语法合法但 domain/action 未注册，{ key: null } 判别式）/ null（畸形）。
 *
 * 畸形桶包含「已注册但参数校验失败」——web 消费端对 null 与 { key: null } 统一 toast
 * 「不支持的操作」（spec Q10-A，见 parseActionUri 内注释）；未来若需细分「参数无法识别」
 * 文案，须引入第四态而非复用 { key: null }（那会把注册动作误分类为未注册）。
 */
export type UnregisteredAction = { key: null; domain: string; action: string }

export function parseActionUri(raw: string): RegisteredAction | UnregisteredAction | null {
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        return null
    }
    if (url.protocol.toLowerCase() !== `${MOBI_URI_SCHEME}:`) return null

    // 语法收紧（spec §3）：host 就是资源域本身——端口/userinfo 是仿冒形似 URI 的藏身处
    // （mobi://session:6379/open 的 hostname 会静默剥离端口），一律拒绝
    if (url.port !== '' || url.username !== '' || url.password !== '') return null

    const domain = url.hostname.toLowerCase()
    // path 必须恰好 `/动作`——尾斜杠（/open/）与多段同样拒绝，杜绝归一化放行
    const action = url.pathname.slice(1)
    if (action === '' || action.includes('/')) return null
    if (!DOMAIN_RE.test(domain) || !ACTION_RE.test(action)) return null

    const key = `${domain}/${action}`
    const definition = (ACTION_REGISTRY as Record<string, ActionDefinition>)[key]
    if (!definition) return { key: null, domain, action }
    // web 消费端对「未注册 {key:null}」与「畸形 null」统一 toast「不支持的操作」（spec Q10-A）；
    // 三态返回保留给未来细分文案

    // query 键值 → 校验；未知键由 zod object 默认剥离，值经 schema 校验
    const rawParams: Record<string, string> = {}
    url.searchParams.forEach((value, name) => { rawParams[name] = value })
    const parsed = definition.params.safeParse(rawParams)
    if (!parsed.success) return null

    return {
        key,
        domain,
        action,
        params: parsed.data as RegisteredAction['params'],
        risk: definition.risk,
    } as RegisteredAction
}

/**
 * 构造 mobi URI（写入侧：hub 注入消息、测试；渲染层点击时构造同走此处）。
 * 参数值经 encodeURIComponent；undefined/null 参数（可选字段缺省）整键剔除，
 * 不落 `undefined` 字面量；已注册键才可构造——写入侧不允许产出未注册动作。
 * 入参用 z.input（transform 前形态：expand 可传 boolean 或省略），解析侧输出才是
 * z.output 的 transform 后类型——两侧类型由同一 schema 关联，不重复声明。
 */
export function buildActionUri<K extends ActionKey>(key: K, params: z.input<(typeof ACTION_REGISTRY)[K]['params']>): string {
    if (!(key in ACTION_REGISTRY)) throw new Error(`未注册的 mobi 动作: ${key}`)
    const [domain, action] = key.split('/')
    const search = new URLSearchParams(
        Object.entries(params as Record<string, unknown>)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([name, value]): [string, string] => [name, String(value)]),
    )
    return `${MOBI_URI_SCHEME}://${domain}/${action}?${search.toString()}`
}

/**
 * 存量 ref block → 动作链接文本（ADR 0003 迁移，hub 消费）。
 * title 由调用方解析后传入（查不到目标传降级文案）；未注册的 targetType 返回 null（保守不改写）。
 */
export function refBlockToActionText(ref: { targetType: string; id: string }, title: string): string | null {
    if (ref.targetType !== 'session') return null
    return sessionOpenLink(ref.id, title)
}

/** md 动作链接文案转义：链接文本里的 `\` `[` `]` 会破坏 md 链接结构，写入侧必须先转义 */
export function escapeActionLinkTitle(title: string): string {
    return title.replace(/([\\[\]])/g, '\\$1')
}

/** 构造 session/open 的 md 动作链接（写入侧唯一入口：文案冻结语义，转义由这里兜住） */
export function sessionOpenLink(id: string, title: string): string {
    return `[${escapeActionLinkTitle(title)}](${buildActionUri('session/open', { id })})`
}
