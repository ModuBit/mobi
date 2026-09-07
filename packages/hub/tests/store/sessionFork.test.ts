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

import { describe, test, expect } from 'bun:test'

import { MetadataSchema } from '@mobi/shared'

import { Store } from '../../src/store'
import { isTurnStartContent } from '../../src/store/sessionFork'

// ============ 消息内容构造器（真实信封形态，见 contextBoundary.test.ts / web turnBoundary）============

/** 普通 user 信封（webapp 排队轨道来源） */
const userMsg = (text: string) => ({
    role: 'user',
    content: [{ type: 'text', text }],
    meta: { sentFrom: 'webapp' },
})

/** 普通 assistant 输出信封（非边界、非锚点） */
const assistantMsg = () => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'assistant', message: { content: [] } } },
})

/** agent result 信封（fork 锚点形态） */
const agentResult = () => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'result', subtype: 'success' } },
})

/** system:compact_boundary 输出信封（subtype 可换成 microcompact_boundary 作反例） */
const compactBoundary = (subtype: string = 'compact_boundary') => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'system', subtype } },
})

/** context-cleared 事件信封 */
const contextCleared = () => ({
    role: 'agent',
    content: { id: 'evt-1', type: 'event', data: { type: 'context-cleared' } },
})

/** 侧链行（Task 子代理消息，isSidechain 标记在 content.data 内） */
const sidechainMsg = (parentToolUseId: string) => ({
    role: 'agent',
    parentToolUseId,
    content: { type: 'output', data: { isSidechain: true, type: 'assistant', message: { content: [] } } },
})

/** 标准两轮 transcript：seq 1-5，锚点 = seq 5，锚点所在 turn 起点 = seq 3 */
function seedStandardTranscript(store: Store, sid: string) {
    store.messages.addMessage(sid, userMsg('第一个问题'), 'l1')                       // seq 1
    store.messages.addMessage(sid, assistantMsg())                                   // seq 2
    store.messages.addMessage(sid, userMsg('第二个问题'), 'l2')                       // seq 3
    store.messages.addMessage(sid, sidechainMsg('tool-1'))                           // seq 4
    return store.messages.addMessage(                                                // seq 5（锚点）
        sid, agentResult(), null, 'persistent',
        { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
    )
}

/** 建带 native id / runtimeState 的 parent 会话 */
function makeParent() {
    const store = new Store(':memory:')
    const parent = store.sessions.getOrCreateSession(
        'fork-parent',
        { path: '/tmp/proj', host: 'h-1', nativeSessionId: 'parent-native-1' },
        null,
        'default',
        { model: 'opus', effort: 'high', outputStyle: 'default', permissionMode: 'default' },
    )
    return { store, parent }
}

/** 以标准 transcript + 预置参数执行一次 fork（turn 起点 = seq 3） */
function forkStandard(store: Store, parent: { id: string }, anchorNativeId = 'anchor-native') {
    const anchor = store.messages.getMessagesByNativeId(parent.id, anchorNativeId)[0]
    return store.sessionFork.forkSessionAtAnchor({
        parent: store.sessions.getSession(parent.id)!,
        anchor,
        turnStartSeq: 3,
        forkNativeId: 'fork-native-1',
        parentNativeId: 'parent-native-1',
    })
}

// ============ isTurnStartContent：turn 起点判定（与 web turnBoundary.isTurnStart 同语义）============

describe('isTurnStartContent：turn 起点判定', () => {
    test('user 信封 → true', () => {
        expect(isTurnStartContent(userMsg('hi'))).toBe(true)
    })

    test('compact_boundary → true', () => {
        expect(isTurnStartContent(compactBoundary())).toBe(true)
    })

    test('context-cleared 事件 → true', () => {
        expect(isTurnStartContent(contextCleared())).toBe(true)
    })

    test('microcompact_boundary 不是 turn 起点（微压缩不换上下文）', () => {
        expect(isTurnStartContent(compactBoundary('microcompact_boundary'))).toBe(false)
    })

    test('普通 assistant / 侧链 / custom 信封 → false', () => {
        expect(isTurnStartContent(assistantMsg())).toBe(false)
        expect(isTurnStartContent(agentResult())).toBe(false)
        expect(isTurnStartContent(sidechainMsg('tool-1'))).toBe(false)
        expect(isTurnStartContent({ role: 'custom', content: [] })).toBe(false)
    })

    test('裸 string / null → false（不抛错）', () => {
        expect(isTurnStartContent('plain')).toBe(false)
        expect(isTurnStartContent(null)).toBe(false)
    })
})

// ============ findTurnStartSeq：向 seq 下方找最近 turn 起点 ============

describe('sessionFork.findTurnStartSeq：向 seq 下方找最近 turn 起点', () => {
    test('命中最近的 user 行（锚点所在 turn 起点）', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)
        expect(store.sessionFork.findTurnStartSeq(parent.id, 5)).toBe(3)
    })

    test('turn 起点是 compact_boundary 的场景：命中边界行', () => {
        const { store, parent } = makeParent()
        store.messages.addMessage(parent.id, userMsg('第一轮'), 'l1')                     // seq 1
        store.messages.addMessage(parent.id, compactBoundary())                          // seq 2
        store.messages.addMessage(parent.id, assistantMsg())                             // seq 3（非起点）
        expect(store.sessionFork.findTurnStartSeq(parent.id, 3)).toBe(2)
    })

    test('主链 user 信封才可作 turn 起点：侧链行不参与判定', () => {
        const { store, parent } = makeParent()
        store.messages.addMessage(parent.id, userMsg('主链'), 'l1')                       // seq 1
        store.messages.addMessage(parent.id, sidechainMsg('tool-1'))                     // seq 2
        expect(store.sessionFork.findTurnStartSeq(parent.id, 2)).toBe(1)
    })

    test('软删行不参与判定', () => {
        const { store, parent } = makeParent()
        store.messages.addMessage(parent.id, userMsg('将被截断'), 'l1')                   // seq 1
        store.messages.addMessage(parent.id, userMsg('存活'), 'l2')                       // seq 2
        store.messages.softDeleteMessagesFrom(parent.id, 1, 1)
        expect(store.sessionFork.findTurnStartSeq(parent.id, 2)).toBe(2)
    })

    test('找不到 turn 起点 → null（理论不可达，防御分支）', () => {
        const { store, parent } = makeParent()
        store.messages.addMessage(parent.id, assistantMsg())                             // seq 1，非起点
        expect(store.sessionFork.findTurnStartSeq(parent.id, 1)).toBeNull()
    })
})

// ============ forkSessionAtAnchor：建 fork 行 + 复制锚点 turn + 溯源消息 ============

describe('sessionFork.forkSessionAtAnchor：建行 + turn 复制 + 溯源消息', () => {
    test('复制范围 = [turn起点..锚点] 含侧链行；更早 turn 不复制；溯源消息 seq 最先', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        expect(result.sessionId).not.toBe(parent.id)
        const forkMessages = store.messages.getMessages(result.sessionId, 200)
        // 溯源 + seq3 user + seq4 侧链 + seq5 锚点 = 4 行
        expect(forkMessages).toHaveLength(4)
        expect(forkMessages.map(m => m.seq)).toEqual([1, 2, 3, 4])
        // seq 1 = 溯源消息；其余按原序对应 parent 的 seq 3/4/5
        const texts = forkMessages.map(m => JSON.stringify(m.content))
        expect(texts[1]).toContain('第二个问题')
        expect(texts[2]).toContain('isSidechain')
        expect(texts[3]).toContain('result')
    })

    test('溯源消息：role custom、动作链接 text block（ADR 0003）、category persistent、无 localId', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        const provenance = store.messages.getMessages(result.sessionId, 200)[0]
        expect(provenance.seq).toBe(1)
        expect(provenance.category).toBe('persistent')
        expect(provenance.localId).toBeNull()
        expect(provenance.lifecycle).toBeNull()
        const content = provenance.content as { role: string; content: Array<Record<string, unknown>> }
        expect(content.role).toBe('custom')
        expect(content.content).toHaveLength(1)
        // 标题冻结自 parent（name 缺省 → path 基名 'proj'）；parent 改名后文案不跟随
        expect(content.content[0]).toEqual({
            type: 'text',
            text: `fork 自会话 [proj](mobi://session/open?id=${parent.id})`,
        })
    })

    test('溯源标题优先 metadata.name（冻结文案的身份字段语义）', () => {
        const store = new Store(':memory:')
        const parent = store.sessions.getOrCreateSession(
            'fork-parent-2',
            { path: '/tmp/proj', host: 'h-1', name: '自定义名', nativeSessionId: 'parent-native-1' },
            null,
            'default',
            { model: 'opus', effort: 'high', outputStyle: 'default', permissionMode: 'default' },
        )
        store.messages.addMessage(parent.id, userMsg('hi'), 'l1')
        const anchor = store.messages.addMessage(
            parent.id, agentResult(), null, 'persistent',
            { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
        )
        const anchorRow = store.messages.getMessagesByNativeId(parent.id, 'anchor-native')[0]

        const result = store.sessionFork.forkSessionAtAnchor({
            parent: store.sessions.getSession(parent.id)!,
            anchor: anchorRow,
            turnStartSeq: 1,
            forkNativeId: 'fork-native-2',
            parentNativeId: 'parent-native-1',
        })
        void anchor

        const content = store.messages.getMessages(result.sessionId, 200)[0].content as { content: Array<{ text: string }> }
        expect(content.content[0].text).toContain('[自定义名](mobi://session/open?id=')
    })

    test('fork 行 metadata：nativeSessionId=预生成 id、forkFrom 三字段、forkedFrom 溯源；MetadataSchema 不裁掉', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        const raw = store.sessions.getSession(result.sessionId)!.metadata as Record<string, unknown>
        expect(raw.nativeSessionId).toBe('fork-native-1')
        expect(raw.forkFrom).toEqual({
            parentSessionId: parent.id,
            parentNativeId: 'parent-native-1',
            anchorNativeId: 'anchor-native',
        })
        expect(raw.forkedFrom).toEqual({ sessionId: parent.id })
        // 回归守卫（ticket 02 先例）：字段未在 shared MetadataSchema 声明会被 sessionCache zod strip 裁掉
        const parsed = MetadataSchema.safeParse(raw)
        expect(parsed.success).toBe(true)
        expect(parsed.data?.forkFrom).toEqual({
            parentSessionId: parent.id,
            parentNativeId: 'parent-native-1',
            anchorNativeId: 'anchor-native',
        })
        expect(parsed.data?.forkedFrom).toEqual({ sessionId: parent.id })
    })

    test('fork 行 tag 非空——CLI bootstrapSession 按 nativeSessionId 查行后复用 tag 绑定（E2E P0 回归）', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        const forkRow = store.sessions.getSession(result.sessionId)!
        expect(forkRow.tag).toBeTruthy()
        // tag 唯一：不与 parent 复用（两行独立绑定，互不串扰）
        expect(forkRow.tag).not.toBe(store.sessions.getSession(parent.id)!.tag)
    })

    test('复制行：session_id 改写、local_id 保留、native 事实原样保留（rewind 锚点可用）', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        const forkMessages = store.messages.getMessages(result.sessionId, 200)
        for (const msg of forkMessages.slice(1)) {
            expect(msg.sessionId).toBe(result.sessionId)
        }
        // user 行 local_id 保留（fork 链上 uuid 有效，去重无冲突）
        expect(forkMessages[1].localId).toBe('l2')
        // 锚点行 native 事实原样保留（nativeSessionId = parent 链值）
        expect(forkMessages[3].metadata).toEqual({ nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' })
    })

    test('lifecycle 重置中性值：已推进（pushed）的复制行 lifecycle/lifecycleAt 置 null', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)
        store.messages.markMessagesPushed(parent.id, ['l2'], Date.now())

        const result = forkStandard(store, parent)

        const forkMessages = store.messages.getMessages(result.sessionId, 200)
        expect(forkMessages[1].localId).toBe('l2')
        expect(forkMessages[1].lifecycle).toBeNull()
        expect(forkMessages[1].lifecycleAt).toBeNull()
    })

    test('配置快照继承：runtimeState 原样继承，namespace 沿用 parent', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)

        const result = forkStandard(store, parent)

        const forkSession = store.sessions.getSession(result.sessionId)!
        expect(forkSession.runtimeState).toEqual(store.sessions.getSession(parent.id)!.runtimeState)
        expect(forkSession.namespace).toBe('default')
    })

    test('turn 起点是 compact_boundary 的场景：边界行本身被复制为 turn 首行', () => {
        const { store, parent } = makeParent()
        store.messages.addMessage(parent.id, userMsg('第一轮'), 'l1')                     // seq 1
        store.messages.addMessage(parent.id, compactBoundary())                          // seq 2（turn 起点）
        store.messages.addMessage(parent.id, userMsg('第二轮'), 'l2')                     // seq 3
        const anchor = store.messages.addMessage(                                        // seq 4（锚点）
            parent.id, agentResult(), null, 'persistent',
            { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
        )

        const result = store.sessionFork.forkSessionAtAnchor({
            parent: store.sessions.getSession(parent.id)!,
            anchor,
            turnStartSeq: 2,
            forkNativeId: 'fork-native-1',
            parentNativeId: 'parent-native-1',
        })

        const forkMessages = store.messages.getMessages(result.sessionId, 200)
        // 溯源 + 边界行 + user + 锚点 = 4 行；seq2 即 compact_boundary 行
        expect(forkMessages).toHaveLength(4)
        expect(JSON.stringify(forkMessages[1].content)).toContain('compact_boundary')
    })

    test('软删行（rewind 截断）不复制', () => {
        const { store, parent } = makeParent()
        seedStandardTranscript(store, parent.id)
        store.messages.softDeleteMessagesFrom(parent.id, 4, 4) // 侧链行被 rewind 截断
        store.messages.addMessage(                             // seq 6 新锚点
            parent.id, agentResult(), null, 'persistent',
            { nativeId: 'anchor-native-2', nativeSessionId: 'parent-native-1' },
        )

        const result = forkStandard(store, parent, 'anchor-native-2')

        const forkMessages = store.messages.getMessages(result.sessionId, 200)
        // 溯源 + user(seq3) + assistant(seq5) + 锚点(seq6) = 4 行；软删侧链行（seq4）被排除
        expect(forkMessages).toHaveLength(4)
        expect(JSON.stringify(forkMessages.map(m => m.content))).not.toContain('isSidechain')
    })
})
