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
 * 渲染链路诊断埋点（tool_use 卡片「等 tool_result 才渲染」问题专项）
 *
 * 背景：thinking → text → tool_use 组合时，工具卡片偶发不渲染 running 态、
 * 必须等 tool_result 才出现（反复修复多次仍复发）。此埋点记录每条工具调用
 * 经过渲染链路的每个决策点，bug 出现后靠数据定位「卡在哪一环」：
 *
 *     CLI snapshot ──SSE──▶ normalizeDecryptedMessage ──▶ reduceChatBlocks ──▶ ToolCallBlock 渲染
 *             ① snapshot 到达       ② 建/更新 tool-call block         ③ 卡片渲染（state/permission）
 *
 * 启用（默认关，全构建可用）：
 * - URL 加 `?diag=1`（任意页面）
 * - 或 localStorage 置 `mobi-diag-enabled=1`（下次加载生效）
 * 关闭：`?diag=0`，或控制台执行 `window.__mobiDiag.disable()`
 *
 * 数据获取（bug 后回来读）：
 * - `window.__mobiDiag.dump()` → 完整数据（含自动生成的 JSON，控制台 `copy()` 可复制）
 * - `window.__mobiDiag.clear()` → 清空
 *
 * 数据保留：内存环形缓冲（最近约 300 条）+ localStorage 镜像（刷新/关页不丢，
 * 下次开启时自动合并回内存）。localStorage 单键写入带容量上限，防撑爆存储。
 */

const LS_ENABLED_KEY = 'mobi-diag-enabled'
const LS_DATA_KEY = 'mobi-diag-data'
/** 内存环形缓冲容量：事件条数上限（工具调用多时会累计） */
const MEM_CAPACITY = 300
/** localStorage 镜像容量上限（字符数），超限截断旧数据，防撑爆 */
const LS_MAX_CHARS = 60_000

export interface DiagSnapshotEvent {
    kind: 'snapshot'
    /** 消息是否 snapshot（true）/ full（false） */
    snapshot: boolean
    /** messageId（Anthropic message.id） */
    messageId: string | null
    /** 本地消息 id */
    localId: string | null
    /** role：user / agent */
    role: string
    content: unknown
}

export interface DiagToolEvent {
    kind: 'tool'
    /** tool_use_id（工具调用唯一标识） */
    toolUseId: string
    /** 工具名，如 Write / Read / Agent（未识别时可能为空） */
    name: string
    /** 事件阶段：snapshot 建块 / 完整消息 / 权限 / 状态变更 */
    stage: 'created' | 'full' | 'permission' | 'state'
    state: string
    permission: unknown
    /** 块来源：snapshot（占位）/ full / permission-only */
    source: string
}

export type DiagEvent = DiagSnapshotEvent | DiagToolEvent

/** 单条工具调用的状态史（按 tool_use_id 聚合） */
export interface DiagToolTrace {
    toolUseId: string
    name: string
    events: string[]
    firstSeen: number
    lastSeen: number
}

export interface DiagDump {
    enabled: boolean
    version: string
    createdAt: number
    events: DiagEvent[]
    tools: DiagToolTrace[]
}

const VERSION = '2'
const seenToolIds = new Set<string>()
/** 已记录过 created 的 toolUseId：reducer 全量重跑时同一工具会被反复「新建」，
 *  但只有首次是真实建块，后续重跑去重，避免历史重放刷屏 */
const recordedCreatedIds = new Set<string>()
/** 每个工具最后一次记录的 state 事件键 (toolUseId, state, permission值)：
 *  仅记录「值真正变化」的状态迁移，同值重放跳过（历史工具被 reducer 重建时 permission 值不变） */
const lastStateKeyPerTool = new Map<string, string>()
let enabled = false
let events: DiagEvent[] = []
let tools: DiagToolTrace[] = []
let lastSyncToLS = 0

/**
 * localStorage 安全访问器。
 * vitest/jsdom 环境下 window.localStorage 为 undefined（Node 22+ 的 localStorage 是实验性的，
 * 需 --localstorage-file 才启用；jsdom 4.x 也不暴露 window.localStorage），故必须判空降级——
 * 诊断埋点是可观测性设施，任何环境缺失 localStorage 都应静默降级为「仅内存缓冲」，绝不抛错。
 */
function getStore(): Storage | null {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
    } catch {
        return null
    }
}

/** 截断过长的字符串/值（防止 input 大 JSON 撑爆缓冲） */
function truncate(value: unknown): unknown {
    if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value
    if (Array.isArray(value)) return value.slice(0, 10).map(truncate)
    if (value && typeof value === 'object') {
        const obj: Record<string, unknown> = {}
        const entries = Object.entries(value as Record<string, unknown>)
        for (const [k, v] of entries.slice(0, 10)) obj[k] = truncate(v)
        return obj
    }
    return value
}

function compactEvent(ev: DiagEvent): DiagEvent {
    if (ev.kind === 'snapshot') return { ...ev, content: truncate(ev.content) }
    return ev
}

function push(event: DiagEvent): void {
    if (!enabled) return
    events.push(compactEvent(event))
    if (events.length > MEM_CAPACITY) events.splice(0, events.length - MEM_CAPACITY)
    // 节流镜像到 localStorage（最多每 1s 一次，减少写入）
    const now = Date.now()
    if (now - lastSyncToLS > 1000) {
        lastSyncToLS = now
        syncToLS()
    }
}

/** 生成浏览器可读的 JSON 字符串（供 copy / 落盘） */
function serialize(): string {
    const d: DiagDump = {
        enabled,
        version: VERSION,
        createdAt: Date.now(),
        events,
        tools: tools.map(t => ({ ...t, events: t.events.slice(-20) })),
    }
    return JSON.stringify(d)
}

/** 镜像到 localStorage（带容量上限） */
function syncToLS(): void {
    try {
        const store = getStore()
        if (!store) return
        let s = serialize()
        // 超限：从事件头部丢弃最旧事件重新序列化，直到不超限。硬切字符串会从 mid-string 截断
        // 破坏 JSON，restoreFromLS 的 JSON.parse 抛错走 catch → 整个诊断现场丢失（「刷新不丢」
        // 的既定目标被静默破坏）。逐事件丢弃与内存环形缓冲语义一致，JSON 始终合法。
        while (s.length > LS_MAX_CHARS && events.length > 0) {
            events.splice(0, 1)
            s = serialize()
        }
        // 极端：全部事件丢弃后仍超限（单事件/工具轨迹超限，truncate 已限字段、现实中不可达），
        // 放弃镜像避免写入损坏数据
        if (s.length > LS_MAX_CHARS) return
        store.setItem(LS_DATA_KEY, s)
    } catch {
        // localStorage 满 / 隐私模式：静默失败，内存数据不受影响
    }
}

/** 从 localStorage 读回上次的镜像（刷新后仍可读） */
function restoreFromLS(): void {
    try {
        const store = getStore()
        if (!store) return
        const s = store.getItem(LS_DATA_KEY)
        if (!s) return
        // 版本不匹配的旧镜像直接忽略：旧版本事件结构可能缺字段/含未知 stage，
        // 直接合并会污染新版本的去重状态（seenToolIds / recordedCreatedIds / lastStateKeyPerTool）。
        // 版本升级时旧镜像失去价值，静默丢弃即可。
        const parsed = JSON.parse(s) as Partial<DiagDump>
        if (parsed.version !== VERSION) return
        if (!Array.isArray(parsed.events) || !Array.isArray(parsed.tools)) return
        // 结构校验：仅接受合法的事件/轨迹，损坏条目跳过，避免污染去重状态
        const validEvents = parsed.events.filter(isValidDiagEvent)
        const validTools = parsed.tools.filter(isValidDiagTrace)
        if (validEvents.length === 0 && validTools.length === 0) return
        events = validEvents
        tools = validTools
        for (const t of validTools) {
            seenToolIds.add(t.toolUseId)
            if (t.events.some(e => e.startsWith('created:'))) recordedCreatedIds.add(t.toolUseId)
            // 从恢复的轨迹里重建 state 去重键：取最后一条 state 事件，剥掉 `state:` 前缀，
            // 与 recordTool 的 stateTraceLine 键格式对齐，restore 后去重继续生效
            const lastState = [...t.events].reverse().find(e => e.startsWith('state:'))
            if (lastState) lastStateKeyPerTool.set(t.toolUseId, lastState.slice('state:'.length))
        }
    } catch {
        // 数据损坏：忽略并继续
    }
}

/** 校验单个事件的版本兼容结构：缺失必填字段/类型不符的条目视为损坏，跳过不合并 */
function isValidDiagEvent(ev: unknown): ev is DiagEvent {
    if (!ev || typeof ev !== 'object') return false
    const e = ev as Record<string, unknown>
    if (e.kind === 'snapshot') {
        return typeof e.snapshot === 'boolean' && typeof e.role === 'string'
    }
    if (e.kind === 'tool') {
        return typeof e.toolUseId === 'string'
            && typeof e.name === 'string'
            && (e.stage === 'created' || e.stage === 'full' || e.stage === 'permission' || e.stage === 'state')
            && typeof e.state === 'string'
            && typeof e.source === 'string'
    }
    return false
}

/** 校验单个工具轨迹的版本兼容结构 */
function isValidDiagTrace(t: unknown): t is DiagToolTrace {
    if (!t || typeof t !== 'object') return false
    const o = t as Record<string, unknown>
    return typeof o.toolUseId === 'string'
        && typeof o.name === 'string'
        && Array.isArray(o.events)
        && o.events.every((e): e is string => typeof e === 'string')
}

/** 开启诊断（幂等）。refresh 为 true 时保留旧现场（fromLocalStorage 合并）；为 false 时从空开始 */
export function enableDiag(opts: { restore?: boolean } = {}): void {
    if (enabled) return
    if (typeof window === 'undefined') return
    enabled = true
    if (opts.restore) restoreFromLS()
    else events = []
    getStore()?.setItem(LS_ENABLED_KEY, '1')
}

/** 关闭诊断并清理数据 */
export function disableDiag(): void {
    enabled = false
    events = []
    tools = []
    seenToolIds.clear()
    recordedCreatedIds.clear()
    lastStateKeyPerTool.clear()
    try {
        getStore()?.removeItem(LS_ENABLED_KEY)
        getStore()?.removeItem(LS_DATA_KEY)
    } catch {
        // 忽略
    }
}

/** 判断诊断是否开启 */
export function isDiagEnabled(): boolean {
    return enabled
}

/** 记录 snapshot / 完整消息经过 normalize 的事件 */
export function recordSnapshot(ev: DiagSnapshotEvent): void {
    push(ev)
}

/** 生成 state 事件的轨迹行（trace 事件历史与 lastStateKeyPerTool 共用同一格式，restore 才能对齐去重键） */
function stateTraceLine(state: string, permission: unknown): string {
    return `${state}${permission ? ` (${JSON.stringify(permission).slice(0, 80)})` : ''}`
}

/** 记录 tool-call block 建/更新的状态事件 */
export function recordTool(ev: DiagToolEvent): void {
    if (!enabled) return
    // created 事件按 toolUseId 去重：只有首次算「建块」，reducer 全量重跑不再重复记录
    if (ev.stage === 'created') {
        if (recordedCreatedIds.has(ev.toolUseId)) return
        recordedCreatedIds.add(ev.toolUseId)
    }
    // state 事件按 (state, permission 值) 去重：reducer 每次重跑都重建 block 与
    // permission 对象，只有「值真正变化」才算状态迁移（如 pending→approved），
    // 历史工具被重放时同值跳过，避免把固定 permission 误报成变化。
    // 去重键与轨迹行共用同一格式（stateTraceLine），restore 才能重建对齐。
    if (ev.stage === 'state') {
        const line = stateTraceLine(ev.state, ev.permission)
        if (lastStateKeyPerTool.get(ev.toolUseId) === line) return
        lastStateKeyPerTool.set(ev.toolUseId, line)
    }
    push(ev)
    let tr = tools.find(t => t.toolUseId === ev.toolUseId)
    if (!tr) {
        tr = { toolUseId: ev.toolUseId, name: ev.name, events: [], firstSeen: Date.now(), lastSeen: Date.now() }
        tools.push(tr)
        seenToolIds.add(ev.toolUseId)
    }
    tr.lastSeen = Date.now()
    tr.events.push(`${ev.stage}:${stateTraceLine(ev.state, ev.permission)}`)
}

/** 读取诊断数据（供 window.__mobiDiag.dump() 与测试） */
export function dumpDiag(): DiagDump {
    return {
        enabled,
        version: VERSION,
        createdAt: Date.now(),
        events: [...events],
        tools: tools.map(t => ({ ...t, events: [...t.events] })),
    }
}

/** 初始化：幂等，多入口调用安全。在 main 启动与 normalize 首次调用时各调一次 */
export function initDiag(): void {
    if (typeof window === 'undefined') return
    // localStorage 标记开启 → 本次加载自动开启（带现场合并）
    if (getStore()?.getItem(LS_ENABLED_KEY) === '1' && !enabled) {
        enableDiag({ restore: true })
    }
    // URL 参数 ?diag=1 → 开启；?diag=0 → 强制关闭（仅本次会话，不删除用户已开启的持久化偏好）
    const q = new URLSearchParams(window.location.search)
    if (q.get('diag') === '1') enableDiag({ restore: true })
    else if (q.get('diag') === '0') {
        // 只关本次运行的内存态，不触碰 localStorage 的 mobi-diag-enabled 标记：
        // 否则会静默覆盖用户此前「已开启」的持久化偏好，之后刷新诊断不再自动开启。
        enabled = false
        events = []
        tools = []
        seenToolIds.clear()
        recordedCreatedIds.clear()
        lastStateKeyPerTool.clear()
    }
    // 暴露全局接口（幂等）
    if (!(window as unknown as Record<string, unknown>).__mobiDiag) {
        ;(window as unknown as Record<string, unknown>).__mobiDiag = {
            dump: () => JSON.parse(serialize()),
            clear: () => {
                events = []
                tools = []
                seenToolIds.clear()
                recordedCreatedIds.clear()
                lastStateKeyPerTool.clear()
                try {
                    getStore()?.removeItem(LS_DATA_KEY)
                } catch {
                    // 忽略
                }
            },
            enable: () => enableDiag({ restore: true }),
            disable: () => disableDiag(),
        }
    }
    // 页面关闭前强制镜像一次：节流后可能还有最多 1s 的缓冲未落盘，刷新后靠这次兜底
    window.addEventListener('beforeunload', () => syncToLS())
}
