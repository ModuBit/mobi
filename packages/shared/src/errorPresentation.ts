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
 * 错误分类与呈现决策（error-presentation spec）。
 *
 * 纯逻辑、零 React、零 IO——web 只负责把 CC 的错误消息归一化成 {@link ErrorInput}
 * 并把 {@link presentError} 的结果画出来；daemon 将来做错误遥测可复用同一套分类。
 *
 * 判据顺序：结构化字段优先（resultSubtype / 断网标记 / HTTP status / errorType），
 * 文本规则只作兜底；证据经 {@link ErrorEvidence} 回传，便于排查分类是否正确。
 */

// ============================================================================
// 类型
// ============================================================================

export type ErrorCategory =
    | 'quota_exhausted'
    | 'rate_limit'
    | 'overloaded'
    | 'server_error'
    | 'context_length'
    | 'network'
    | 'auth'
    | 'permission_denied'
    | 'org_policy_denied'
    | 'org_disabled'
    | 'usage_policy'
    | 'image_dimension'
    | 'image_invalid'
    | 'request_too_large'
    | 'model_not_found'
    | 'output_token_limit'
    | 'max_turns'
    | 'billing'
    | 'invalid_request'
    | 'unknown'

/** 分类输入：归一化后的错误事实（缺省字段表示该路证据不存在） */
export type ErrorInput = {
    /** HTTP 状态码（来自 error.status / errorStatus） */
    status?: number | null
    /** 供应商错误码（如 1310） */
    code?: string | null
    /** 错误类型（如 rate_limit_error / overloaded_error） */
    errorType?: string | null
    /** 面向人的错误文本（formatted / message） */
    message?: string | null
    /** CC 标记的网络不可用 */
    isNetworkDown?: boolean | null
    /** result 的 stop reason 或 subtype（如 error_max_turns / max_tokens） */
    stopReason?: string | null
    /** result 消息的 subtype（error_max_turns / error_during_execution） */
    resultSubtype?: string | null
    /** 错误来源（request_retry / request / result） */
    source?: string | null
}

export type ErrorEvidence = {
    matchedBy: 'resultSubtype' | 'status' | 'errorType' | 'code' | 'text' | 'stopReason' | 'flag' | 'none'
    value: string
}

export type ClassifiedError = {
    category: ErrorCategory
    evidence: ErrorEvidence
}

/**
 * 归一化后的错误事件载荷（web `AgentEvent` 的 `error` 变体、未来 daemon 遥测共用）。
 *
 * 字段直接来自 CLI 载荷：`attempt/maxRetries/retryInMs` 来自 api_retry 或 api_error，
 * `status/code/errorType` 来自嵌套 error 对象；分类结果随事件落盘，渲染端无需重判。
 */
export type NormalizedErrorEvent = {
    attempt: number
    maxRetries: number
    status?: number
    code?: string
    errorType?: string
    message: string
    isNetworkDown: boolean
    source?: string
    retryInMs?: number
    category: ErrorCategory
    evidence: ErrorEvidence
    raw: unknown
}

/** 决策上下文：会话此刻**能做什么**（不是错误本身的事实） */
export type ErrorContext = {
    /** 能否回退到更早位置 */
    canRewind: boolean
    /** 能否发送消息（会话活跃 + 输入可用） */
    canSend: boolean
    /** 会话生命周期状态 */
    sessionState: 'active' | 'dormant' | 'ended'
    /** 上下文满相关：压缩是否在跑 / 是否已尝试过 */
    compact?: { pending: boolean; tried: boolean }
    /** 是否存在可切换的备选模型 */
    hasFallbackModel: boolean
    /** 是否处于工作区（可新建会话） */
    hasWorkspace: boolean
    /** 本轮（当前错误之前）是否已有助手产出——有则重发旧消息会重跑整轮工作 */
    turnHasAssistantOutput: boolean
}

export type ErrorAction =
    | 'retry'
    | 'rewind'
    | 'compact'
    | 'resume'
    | 'switchModel'
    | 'newSession'
    | 'reauth'
    | 'copyDetails'

export type ErrorPresentation = {
    category: ErrorCategory
    severity: 'warning' | 'error'
    /** i18n 标题键 */
    titleKey: string
    /** i18n 正文键（恒为基础文案） */
    bodyKey: string
    /** 附加说明键（不可回退 / 输入不可用 / 压缩已试过），无则省略 */
    noteKey?: string
    /** 是否把错误原文直接铺在卡片里（否则只收进详情） */
    inlineRaw: boolean
    /** 有序动作集，第一项为主按钮 */
    actions: ErrorAction[]
}

// ============================================================================
// 分类
// ============================================================================

/** 文本规则表：顺序即优先级；每项返回命中的类别或 null */
const TEXT_RULES: Array<{ category: ErrorCategory; pattern: RegExp }> = [
    { category: 'context_length', pattern: /prompt is too long|context (?:window|length)|too long to continue|exceeds? the (?:maximum )?context/i },
    { category: 'image_dimension', pattern: /image (?:is )?(?:too large|over \d+ ?px)|dimensions? exceed/i },
    { category: 'image_invalid', pattern: /image (?:could ?n[o']t be (?:read|processed)|is invalid)|unsupported image/i },
    { category: 'request_too_large', pattern: /request (?:is )?too large|payload too large|attachment is too large/i },
    { category: 'org_policy_denied', pattern: /organization[’']?s? policy|blocked by your organization/i },
    { category: 'org_disabled', pattern: /organization[’']?s? access has been disabled|organization (?:is )?disabled/i },
    { category: 'usage_policy', pattern: /usage polic|safeguard|flagged this message/i },
    { category: 'model_not_found', pattern: /model (?:is )?not (?:found|available)|unknown model|is unknown to|supported (?:api )?model names?|model_not_found/i },
    { category: 'billing', pattern: /credit balance|billing|payment required|insufficient (?:credit|funds)|balance is too low|余额不足|欠费/i },
    { category: 'output_token_limit', pattern: /max(?:imum)? output tokens|output (?:token )?limit|response exceeded/i },
    { category: 'auth', pattern: /invalid (?:x-)?api[- ]?key|authentication (?:failed|error)|oauth|sign ?in (?:again|required)|unauthorized/i },
    { category: 'network', pattern: /enotfound|econnreset|econnrefused|socket hang up|fetch failed|network (?:error|down)|connection (?:error|reset|refused)/i },
    { category: 'quota_exhausted', pattern: /usage limit|quota|额度|限额|已达(?:到|上限)|reset (?:at|on)|will reset/i },
]

/** errorType 映射（文本规则兜不住时的粗分类；rate_limit_error 交给 429/文本细分） */
const ERROR_TYPE_MAP: Record<string, ErrorCategory> = {
    overloaded_error: 'overloaded',
    authentication_error: 'auth',
    permission_error: 'permission_denied',
    // not_found_error 不映射：404 可能是会话/文件/路由不存在，只有「模型」语义才归 model_not_found
    request_too_large: 'request_too_large',
    invalid_request_error: 'invalid_request',
    api_error: 'server_error',
}

function textOf(input: ErrorInput): string {
    return `${input.message ?? ''}`
}

function matchText(input: ErrorInput): { category: ErrorCategory; pattern: RegExp } | null {
    const text = textOf(input)
    if (!text) return null
    for (const rule of TEXT_RULES) {
        if (rule.pattern.test(text)) return { category: rule.category, pattern: rule.pattern }
    }
    return null
}

/** 分类命中结果的单点构造（避免 15 处手写同形状字面量） */
function hit(category: ErrorCategory, matchedBy: ErrorEvidence['matchedBy'], value: string): ClassifiedError {
    return { category, evidence: { matchedBy, value } }
}

/**
 * 分类一条错误。
 *
 * 顺序：resultSubtype / stopReason / 断网标记 → 粗粒度 HTTP 状态（401/403/529/5xx/413）
 * → 文本规则 → errorType 映射 → 429 / 400 → unknown。
 *
 * errorType 排在文本之后是有意为之：CC 用 `invalid_request_error` 承载上下文满、图片、
 * 内容策略等具体原因，若先按类型映射会把它们全部压成 invalid_request。
 */
export function classifyError(input: ErrorInput): ClassifiedError {
    const status = typeof input.status === 'number' ? input.status : null
    const resultSubtype = input.resultSubtype ?? null
    const stopReason = input.stopReason ?? null

    if (resultSubtype === 'error_max_turns') return hit('max_turns', 'resultSubtype', resultSubtype)
    if (stopReason === 'max_tokens') return hit('output_token_limit', 'stopReason', stopReason)
    if (input.isNetworkDown === true) return hit('network', 'flag', 'isNetworkDown')
    if (status === 401) return hit('auth', 'status', '401')
    if (status === 403) {
        const text = matchText(input)
        if (text?.category === 'org_policy_denied' || text?.category === 'org_disabled') {
            return hit(text.category, 'text', text.pattern.source)
        }
        return hit('permission_denied', 'status', '403')
    }
    if (status === 529) return hit('overloaded', 'status', '529')
    if (status !== null && status >= 500) return hit('server_error', 'status', String(status))
    if (status === 413) return hit('request_too_large', 'status', '413')

    const text = matchText(input)
    if (text) return hit(text.category, 'text', text.pattern.source)

    const mapped = input.errorType ? ERROR_TYPE_MAP[input.errorType] : undefined
    if (mapped) return hit(mapped, 'errorType', input.errorType!)

    // 429 是瞬时限流；额度耗尽的 429 已被上面的文本规则先命中
    if (status === 429) return hit('rate_limit', 'status', '429')
    if (input.errorType === 'rate_limit_error') return hit('rate_limit', 'errorType', input.errorType)
    if (status === 400) return hit('invalid_request', 'status', '400')
    return hit('unknown', 'none', input.code ?? input.errorType ?? '')
}

// ============================================================================
// 呈现决策
// ============================================================================

/** 每类的默认动作集（不含上下文裁剪） */
const CATEGORY_ACTIONS: Record<ErrorCategory, ErrorAction[]> = {
    quota_exhausted: ['retry', 'newSession', 'copyDetails'],
    rate_limit: ['retry', 'copyDetails'],
    overloaded: ['retry', 'copyDetails'],
    server_error: ['retry', 'copyDetails'],
    context_length: ['compact', 'rewind', 'newSession'],
    network: ['retry', 'newSession', 'copyDetails'],
    auth: ['reauth', 'copyDetails'],
    permission_denied: ['newSession', 'copyDetails'],
    org_policy_denied: ['copyDetails'],
    org_disabled: ['copyDetails'],
    usage_policy: ['rewind', 'newSession', 'copyDetails'],
    image_dimension: ['rewind', 'newSession', 'copyDetails'],
    image_invalid: ['rewind', 'newSession', 'copyDetails'],
    request_too_large: ['rewind', 'newSession', 'copyDetails'],
    model_not_found: ['switchModel', 'newSession', 'copyDetails'],
    // 输出上限 / 轮次到顶：继续的入口就是输入框本身，重发旧消息只会重复上一轮
    output_token_limit: ['copyDetails'],
    max_turns: ['copyDetails'],
    billing: ['newSession', 'copyDetails'],
    invalid_request: ['newSession', 'copyDetails'],
    unknown: ['retry', 'copyDetails'],
}

/** 需要「能发消息」才有意义的动作 */
const NEEDS_SEND: ReadonlySet<ErrorAction> = new Set(['retry', 'compact'])

/** 需要「能回退」才有意义的动作 */
const NEEDS_REWIND: ReadonlySet<ErrorAction> = new Set(['rewind'])

/**
 * 原文直接铺在卡片里的类别；其余类别原文只收进「详情」。
 * （此前是 keep/describe/drop 三态，但 describe 与 drop 在渲染端行为完全相同。）
 */
const INLINE_RAW: ReadonlySet<ErrorCategory> = new Set([
    'quota_exhausted', 'billing', 'invalid_request', 'unknown',
])

/** 警告级（可恢复、不打断会话） */
const WARNING_CATEGORIES: ReadonlySet<ErrorCategory> = new Set(['rate_limit', 'overloaded', 'network'])

/** 类别 → 严重度：警告级可用黄色提示，其余按错误渲染 */
export function errorSeverity(category: ErrorCategory): 'warning' | 'error' {
    return WARNING_CATEGORIES.has(category) ? 'warning' : 'error'
}

function titleKey(category: ErrorCategory): string {
    return `chat.error.title.${category}`
}

function noteKey(category: ErrorCategory, context: ErrorContext): string | undefined {
    // 休眠/结束会话的动作已被收窄为「唤醒」，回退/输入相关说明此时是噪音
    if (context.sessionState !== 'active') return undefined
    if (category === 'context_length' && context.compact?.tried) {
        return 'chat.error.note.compactTried'
    }
    if (!context.canRewind && CATEGORY_ACTIONS[category].includes('rewind')) {
        return 'chat.error.note.rewindUnavailable'
    }
    if (!context.canSend) {
        return 'chat.error.note.composerUnavailable'
    }
    return undefined
}

/**
 * 由类别 + 上下文产出呈现决策。
 *
 * 动作裁剪规则：
 * - 会话非 active → 主按钮改为唤醒会话，基础动作只保留详情
 * - 不能发送 → 去掉 retry / compact
 * - 不能回退 → 去掉 rewind，正文走 noRewind 变体
 * - 无工作区 → 去掉 newSession
 * - 无备选模型 → 去掉 switchModel
 */
export function presentError(category: ErrorCategory, context: ErrorContext): ErrorPresentation {
    const base = CATEGORY_ACTIONS[category]

    let actions: ErrorAction[]
    if (context.sessionState !== 'active') {
        actions = ['resume', ...base.filter((action) => action === 'copyDetails')]
    } else {
        actions = base.filter((action) => {
            if (NEEDS_SEND.has(action) && !context.canSend) return false
            if (NEEDS_REWIND.has(action) && !context.canRewind) return false
            if (action === 'newSession' && !context.hasWorkspace) return false
            if (action === 'switchModel' && !context.hasFallbackModel) return false
            // 本轮已有产出：重发旧消息会重跑整轮工作，重试只有“本轮无产出”时才成立
            if (action === 'retry' && context.turnHasAssistantOutput) return false
            return true
        })
    }
    // 动作被全部裁掉时至少保留详情入口
    if (actions.length === 0) actions = ['copyDetails']

    const note = noteKey(category, context)
    return {
        category,
        severity: errorSeverity(category),
        titleKey: titleKey(category),
        bodyKey: `chat.error.body.${category}`,
        ...(note ? { noteKey: note } : {}),
        inlineRaw: INLINE_RAW.has(category),
        actions,
    }
}

// ============================================================================
// 额度重置时间
// ============================================================================

/** ISO 8601 或 CC 原生 `YYYY-MM-DD HH:mm:ss`（无时区，按本地时间理解） */
const TIMESTAMP = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/

/** 文本里带「重置/恢复」语义的短语，用于确认它附近的 ISO 时间就是重置时间 */
const RESET_PHRASE = /reset|resets|reset at|refresh|renews|恢复|重置|刷新/i

/**
 * 从错误文本中解析额度重置时间。
 *
 * 只认文本里真实出现的时间戳，且要求附近有重置语义；
 * 解析不到返回 null——调用方应退回展示原文，绝不编造时间。
 *
 * 返回可直接交给 `new Date()` 的串：CC 网关给的是 `2026-10-21 10:02:11` 这种本地时间，
 * 统一把空格换成 `T` 以避开各浏览器对非 ISO 格式的解析差异（仍按本地时间处理）。
 */
export function extractResetAt(message: string | null | undefined): string | null {
    if (!message) return null
    const match = TIMESTAMP.exec(message)
    if (!match) return null
    const index = match.index
    const window = message.slice(Math.max(0, index - 80), index + match[1]!.length + 80)
    if (!RESET_PHRASE.test(window)) return null
    return match[1]!.replace(' ', 'T')
}

/**
 * 从错误原文中提取请求 ID（形如 req_0123abcd…），供详情区单独复制。
 * 找不到返回 null。
 */
export function extractRequestId(text: string | null | undefined): string | null {
    if (!text) return null
    const match = /\breq_[A-Za-z0-9]{8,}\b/.exec(text)
    return match ? match[0] : null
}

// ============================================================================
// 上下文满状态机
// ============================================================================

/**
 * 状态机输入：只关心「上下文满错误」与压缩生命周期（调用方先按分类过滤）。
 * `turn-end` 是本轮结束标记（出现新的用户输入），其后的压缩属于别的轮次，不再影响本锚点。
 */
export type ContextFullEvent = { type: 'error' | 'compact-started' | 'compact' | 'turn-end' }

export type ContextFullState = {
    /** 压缩正在进行 */
    pending: boolean
    /** 压缩已跑过，且之后又出现上下文满 */
    tried: boolean
    /** 锚点之后是否已经消耗过一次压缩 */
    spent: boolean
}

/**
 * 派生上下文满状态（不落库、可从聊天块任意重算）。
 *
 * 序列语义：
 * - 锚点之后出现 compact-started 且其后无 compact → pending
 * - 锚点之后有 compact → spent；若其后又出现上下文满错误 → tried
 * - 遇到 turn-end → 本轮结束，后续事件不再计入（另起一轮的 /compact 不该让历史卡片变 pending）
 */
export function deriveContextFullState(events: ContextFullEvent[], anchorIndex: number): ContextFullState {
    let pending = false
    let spent = false
    let tried = false
    for (let i = anchorIndex + 1; i < events.length; i++) {
        const type = events[i]!.type
        if (type === 'turn-end') break
        if (type === 'compact-started') {
            pending = true
            tried = false
        } else if (type === 'compact') {
            pending = false
            spent = true
            tried = false
        } else if (type === 'error') {
            if (spent) tried = true
        }
    }
    return { pending, tried, spent }
}
