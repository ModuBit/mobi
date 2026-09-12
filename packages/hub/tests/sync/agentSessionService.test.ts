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
import { AgentSessionService } from '../../src/sync/agentSessionService'
import type { ProjectAssignability } from '../../src/sync/agentSessionService'
import { AGENT_SESSIONS_DEFAULT_LIMIT, AGENT_SESSIONS_MAX_LIMIT } from '@mobi/shared'
import type { AgentMessageDelivery } from '@mobi/shared'
import type { Machine } from '../../src/sync/machineCache'
import type { Session } from '@mobi/shared/types'

/** 构造最小 Machine（只填服务真正读的字段） */
function makeMachine(overrides: Partial<Machine> & { id: string }): Machine {
    return {
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 100,
        active: true,
        activeAt: 200,
        metadata: { host: 'host-a', platform: 'darwin', mobiCliVersion: '1.0.0' },
        metadataVersion: 0,
        runnerState: null,
        runnerStateVersion: 0,
        ...overrides,
    }
}

/** 构造最小 Session（只填服务真正读的字段） */
function makeSession(overrides: Partial<Session> & { id: string }): Session {
    return {
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 100,
        active: true,
        activeAt: 200,
        metadata: { path: '/tmp/x', host: 'host-a', name: 'Session A' },
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        running: false,
        runningAt: 0,
        projectId: null,
        pinned: false,
        ...overrides,
    }
}

function makeService(
    machines: Machine[],
    sessions: Session[] = [],
    overrides?: {
        spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string }
        projectAssignability?: ProjectAssignability
        /** 让 pushAgentMessage 抛这个错（模拟三种 RPC 内部错误） */
        pushFailure?: string
        /** 让 storeAgentMessage 抛这个错（模拟落库故障） */
        storeFailure?: string
    },
) {
    const seenNamespaces: string[] = []
    const seenSessionNamespaces: string[] = []
    const spawnCalls: Array<{ machineId: string; directory: string; options: unknown }> = []
    const pushed: Array<{ sessionId: string; delivery: AgentMessageDelivery }> = []
    const stored: Array<{ sessionId: string; delivery: AgentMessageDelivery }> = []
    const service = new AgentSessionService({
        getOnlineMachinesByNamespace: (namespace) => {
            seenNamespaces.push(namespace)
            return machines
        },
        getSessionsByNamespace: (namespace) => {
            seenSessionNamespaces.push(namespace)
            return sessions
        },
        getMachineByNamespace: (machineId, namespace) =>
            machines.find((m) => m.id === machineId && m.namespace === namespace),
        getSessionByNamespace: (sessionId, namespace) =>
            sessions.find((s) => s.id === sessionId && s.namespace === namespace),
        checkProjectAssignable: () => overrides?.projectAssignability ?? 'ok',
        spawnSession: async (machineId, directory, options) => {
            spawnCalls.push({ machineId, directory, options })
            return overrides?.spawnResult ?? { type: 'success', sessionId: 'new-session-id' }
        },
        pushAgentMessage: async (sessionId, delivery) => {
            if (overrides?.pushFailure) {
                throw new Error(overrides.pushFailure)
            }
            pushed.push({ sessionId, delivery })
        },
        storeAgentMessage: async (sessionId, delivery) => {
            if (overrides?.storeFailure) {
                throw new Error(overrides.storeFailure)
            }
            stored.push({ sessionId, delivery })
        },
    })
    return { service, seenNamespaces, seenSessionNamespaces, spawnCalls, pushed, stored }
}

describe('AgentSessionService.listMachines', () => {
    test('把 namespace 透传给在线机器查询，不做二次过滤', () => {
        const { service, seenNamespaces } = makeService([makeMachine({ id: 'm1' })])
        service.listMachines('ns-42')
        // 在线过滤是查询方的职责（machineCache）；服务不重复实现一遍规则
        expect(seenNamespaces).toEqual(['ns-42'])
    })

    test('映射为 agent 视角摘要：id / 名称 / 主机名 / 心跳时刻', () => {
        const { service } = makeService([
            makeMachine({
                id: 'm1',
                activeAt: 1700,
                metadata: { host: 'host-a', platform: 'darwin', mobiCliVersion: '1.0.0', displayName: 'Mac Mini' },
            }),
        ])

        expect(service.listMachines('ns')).toEqual([
            { machineId: 'm1', name: 'Mac Mini', hostname: 'host-a', activeAt: 1700 },
        ])
    })

    test('展示名回退链：displayName 缺省回退 host', () => {
        const { service } = makeService([makeMachine({ id: 'm1' })])

        expect(service.listMachines('ns')[0].name).toBe('host-a')
    })

    test('metadata 缺失时回退机器 id，不抛错', () => {
        const { service } = makeService([makeMachine({ id: 'm1', metadata: null })])

        expect(service.listMachines('ns')).toEqual([
            { machineId: 'm1', name: 'm1', hostname: 'm1', activeAt: 200 },
        ])
    })

    test('无在线机器时返回空数组（不是 undefined）', () => {
        const { service } = makeService([])

        expect(service.listMachines('ns')).toEqual([])
    })
})

describe('AgentSessionService.listSessions — status 三档', () => {
    const sessions = [
        makeSession({ id: 'live', active: true }),
        makeSession({ id: 'dead', active: false }),
    ]

    test('缺省只列 active——未激活的进程已经不在，派活必然失败', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns').map(s => s.sessionId)).toEqual(['live'])
    })

    test('INACTIVE 只列未激活（用于区分「没这个会话」与「有但没在跑」）', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { status: 'INACTIVE' }).map(s => s.sessionId)).toEqual(['dead'])
    })

    test('ALL 两档都列', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { status: 'ALL' }).map(s => s.sessionId).sort()).toEqual(['dead', 'live'])
    })

    test('namespace 取自入参（由 handler 从鉴权会话解析后传入），服务不做二次过滤', () => {
        const { service, seenSessionNamespaces } = makeService([], [])

        service.listSessions('ns-99')

        expect(seenSessionNamespaces).toEqual(['ns-99'])
    })
})

describe('AgentSessionService.listSessions — 关键词过滤', () => {
    const sessions = [
        makeSession({ id: 'by-name', metadata: { path: '/tmp/a', host: 'h', name: '前端重构' } }),
        makeSession({ id: 'by-summary', metadata: { path: '/tmp/b', host: 'h', summary: { text: '修复登录超时', updatedAt: 1 } } }),
        makeSession({ id: 'by-path', metadata: { path: '/work/api-server', host: 'h' } }),
        makeSession({ id: 'other', metadata: { path: '/tmp/c', host: 'h', name: '无关会话' } }),
    ]

    test('命中标题', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: '重构' }).map(s => s.sessionId)).toEqual(['by-name'])
    })

    test('命中摘要', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: '登录' }).map(s => s.sessionId)).toEqual(['by-summary'])
    })

    test('命中工作目录', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: 'api-server' }).map(s => s.sessionId)).toEqual(['by-path'])
    })

    test('大小写不敏感，前后空白忽略', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: '  API-SERVER  ' }).map(s => s.sessionId)).toEqual(['by-path'])
    })

    test('空关键词等同没给——否则 agent 传个空串会得到空清单，误判成「一个会话都没有」', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: '   ' })).toHaveLength(sessions.length)
    })

    test('关键词是子串匹配而非分词：跨字段拼不出匹配', () => {
        const { service } = makeService([], sessions)

        expect(service.listSessions('ns', { keyword: '重构修复' })).toEqual([])
    })
})

describe('AgentSessionService.listSessions — 排序与截断', () => {
    test('active 优先，即便它的 updatedAt 更旧', () => {
        const { service } = makeService([], [
            makeSession({ id: 'live-old', active: true, updatedAt: 100 }),
            makeSession({ id: 'dead-new', active: false, updatedAt: 999 }),
        ])

        expect(service.listSessions('ns', { status: 'ALL' }).map(s => s.sessionId)).toEqual(['live-old', 'dead-new'])
    })

    test('同档内按最近活动降序', () => {
        const { service } = makeService([], [
            makeSession({ id: 'older', updatedAt: 100 }),
            makeSession({ id: 'newer', updatedAt: 300 }),
            makeSession({ id: 'middle', updatedAt: 200 }),
        ])

        expect(service.listSessions('ns').map(s => s.sessionId)).toEqual(['newer', 'middle', 'older'])
    })

    test('排序不受待审批数影响——那是给人看的排序，agent 不替人批审批', () => {
        const pending = (n: number) => ({
            requests: Object.fromEntries(
                Array.from({ length: n }, (_, i) => [`r${i}`, { tool: 'Bash', arguments: {} }]),
            ),
        })
        const { service } = makeService([], [
            makeSession({ id: 'older-but-more-pending', updatedAt: 100, agentState: pending(3) }),
            makeSession({ id: 'newer-no-pending', updatedAt: 300, agentState: pending(0) }),
        ])

        expect(service.listSessions('ns').map(s => s.sessionId)).toEqual(['newer-no-pending', 'older-but-more-pending'])
    })

    test('limit 截断，取排序后的前 N 条', () => {
        const { service } = makeService([], [
            makeSession({ id: 'a', updatedAt: 100 }),
            makeSession({ id: 'b', updatedAt: 300 }),
            makeSession({ id: 'c', updatedAt: 200 }),
        ])

        expect(service.listSessions('ns', { limit: 2 }).map(s => s.sessionId)).toEqual(['b', 'c'])
    })

    test('缺省 limit = 20', () => {
        const many = Array.from({ length: 30 }, (_, i) => makeSession({ id: `s${i}`, updatedAt: 1000 - i }))
        const { service } = makeService([], many)

        expect(service.listSessions('ns')).toHaveLength(AGENT_SESSIONS_DEFAULT_LIMIT)
    })

    test('limit 超上限按上限截断（不报错——agent 要的是「给我一批」）', () => {
        const many = Array.from({ length: 60 }, (_, i) => makeSession({ id: `s${i}`, updatedAt: 1000 - i }))
        const { service } = makeService([], many)

        expect(service.listSessions('ns', { limit: 999 })).toHaveLength(AGENT_SESSIONS_MAX_LIMIT)
    })

    test('非法 limit（0 / 负数 / 小数）归到合法区间', () => {
        const { service } = makeService([], [makeSession({ id: 'a' }), makeSession({ id: 'b' })])

        expect(service.listSessions('ns', { limit: 0 })).toHaveLength(1)
        expect(service.listSessions('ns', { limit: -5 })).toHaveLength(1)
        expect(service.listSessions('ns', { limit: 1.5 })).toHaveLength(1)
    })
})

describe('AgentSessionService.listSessions — projectId 与字段映射', () => {
    test('projectId 过滤只留该项目的会话', () => {
        const { service } = makeService([], [
            makeSession({ id: 'in-project', projectId: 'p1' }),
            makeSession({ id: 'loose', projectId: null }),
            makeSession({ id: 'other-project', projectId: 'p2' }),
        ])

        expect(service.listSessions('ns', { projectId: 'p1' }).map(s => s.sessionId)).toEqual(['in-project'])
    })

    test('映射为 agent 视角摘要：标题 / 摘要 / 项目 / 机器 / 目录 / 状态 / 时间 / 模型 / 置顶', () => {
        const { service } = makeService([], [
            makeSession({
                id: 's1',
                active: true,
                running: true,
                updatedAt: 1700,
                projectId: 'p1',
                pinned: true,
                metadata: {
                    path: '/work/app',
                    host: 'host-a',
                    name: '前端重构',
                    summary: { text: '修登录', updatedAt: 1 },
                    machineId: 'm1',
                },
                runtimeState: { model: 'opus' },
            }),
        ])

        expect(service.listSessions('ns')).toEqual([{
            sessionId: 's1',
            name: '前端重构',
            summary: '修登录',
            projectId: 'p1',
            machineId: 'm1',
            path: '/work/app',
            active: true,
            running: true,
            updatedAt: 1700,
            model: 'opus',
            pinned: true,
        }])
    })

    test('metadata 缺失时相关字段缺省，不填假值', () => {
        const { service } = makeService([], [makeSession({ id: 's1', metadata: null, projectId: null })])

        const [summary] = service.listSessions('ns')

        expect(summary.name).toBeUndefined()
        expect(summary.summary).toBeUndefined()
        expect(summary.machineId).toBeUndefined()
        expect(summary.path).toBeUndefined()
        // 不拿 host 之类顶替 machineId——顶替出来的值拿去 create_session 只会得到一个必然失败的入参
        expect(summary).toMatchObject({ sessionId: 's1', projectId: null, pinned: false })
    })

    test('runtimeState 缺失时 model 缺省（agent 尚未上报，不是「没有模型」）', () => {
        const { service } = makeService([], [makeSession({ id: 's1' })])

        expect(service.listSessions('ns')[0].model).toBeUndefined()
    })

    test('无会话时返回空数组（不是 undefined）', () => {
        const { service } = makeService([], [])

        expect(service.listSessions('ns')).toEqual([])
    })
})

/** 取失败文案（断言前先确认是失败分支，顺带收窄类型） */
function failureText(result: { ok: boolean; error?: string }): string {
    expect(result.ok).toBe(false)
    return result.error ?? ''
}

describe('AgentSessionService.createSession — 前置闸', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    test('机器不在清单里 → 人话 + 指路 list_machines，且不碰 spawn', async () => {
        const { service, spawnCalls } = makeService([])

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(failureText(result)).toContain('No online machine with id "m1"')
        expect(failureText(result)).toContain('list_machines')
        // 前置闸的价值就是「不花钱也能确定失败」——碰了 spawn 就白花一次 RPC
        expect(spawnCalls).toHaveLength(0)
    })

    test('传机器名（而非 id）落到同一条失败——不做名字模糊匹配', async () => {
        const { service, spawnCalls } = makeService([online])

        const result = await service.createSession('ns', { machineId: 'Mac Mini', directory: '/work/app' })

        expect(failureText(result)).toContain('No online machine with id "Mac Mini"')
        expect(spawnCalls).toHaveLength(0)
    })

    test('机器在本 namespace 但已离线 → 同样拒绝（离线机器起不了会话）', async () => {
        const { service, spawnCalls } = makeService([makeMachine({ id: 'm1', namespace: 'ns', active: false })])

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(failureText(result)).toContain('No online machine')
        expect(spawnCalls).toHaveLength(0)
    })

    test('机器属于别的 namespace → 看不见即拒绝（namespace 是隔离边界）', async () => {
        const { service, spawnCalls } = makeService([makeMachine({ id: 'm1', namespace: 'other' })])

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(failureText(result)).toContain('No online machine')
        expect(spawnCalls).toHaveLength(0)
    })

    test('projectId 不存在 → 拒绝，不碰 spawn', async () => {
        const { service, spawnCalls } = makeService([online], [], { projectAssignability: 'not_found' })

        const result = await service.createSession('ns', {
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p-missing',
        })

        expect(failureText(result)).toContain('No project with id "p-missing"')
        expect(spawnCalls).toHaveLength(0)
    })

    test('projectId 归属别的机器 → 拒绝（否则会派生出一个绑错机器的幽灵会话）', async () => {
        const { service, spawnCalls } = makeService([online], [], { projectAssignability: 'machine_mismatch' })

        const result = await service.createSession('ns', {
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p1',
        })

        expect(failureText(result)).toContain('belongs to a different machine')
        expect(spawnCalls).toHaveLength(0)
    })

    test('不传 projectId 时跳过归属校验（游离会话是合法默认）', async () => {
        let called = 0
        const service = new AgentSessionService({
            getOnlineMachinesByNamespace: () => [online],
            getSessionsByNamespace: () => [],
            getMachineByNamespace: (machineId, namespace) =>
                machineId === online.id && namespace === online.namespace ? online : undefined,
            getSessionByNamespace: () => undefined,
            checkProjectAssignable: () => {
                called++
                return 'not_found'
            },
            spawnSession: async () => ({ type: 'success', sessionId: 's-new' }),
            pushAgentMessage: async () => {},
            storeAgentMessage: async () => {},
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result).toEqual({ ok: true, sessionId: 's-new' })
        expect(called).toBe(0)
    })
})

describe('AgentSessionService.createSession — 起进程', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    test('成功 → ok:true 带 sessionId', async () => {
        const { service } = makeService([online], [], { spawnResult: { type: 'success', sessionId: 's-new' } })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result).toEqual({ ok: true, sessionId: 's-new' })
    })

    test('machineId / directory 与可选选项原样透传给 spawn（缺省项不编默认值）', async () => {
        const { service, spawnCalls } = makeService([online])

        await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(spawnCalls).toEqual([{
            machineId: 'm1',
            directory: '/work/app',
            options: { model: undefined, effort: undefined, permissionMode: undefined, projectId: undefined },
        }])
    })

    test('显式给的选项透传（model / effort / permissionMode / projectId）', async () => {
        const { service, spawnCalls } = makeService([online])

        await service.createSession('ns', {
            machineId: 'm1',
            directory: '/work/app',
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
            projectId: 'p1',
        })

        expect(spawnCalls[0].options).toEqual({
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
            projectId: 'p1',
        })
    })

    test('namespace 透传用于机器解析', async () => {
        const { service } = makeService([online])

        await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect((await service.createSession('other-ns', { machineId: 'm1', directory: '/work/app' })).ok).toBe(false)
    })
})

describe('AgentSessionService.createSession — 失败翻译', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    const spawnFailing = (message: string) =>
        makeService([online], [], { spawnResult: { type: 'error', message } })

    test('RPC handler 未注册 → 「那台机器没在跑 runner」，不暴露 RPC 内部措辞', async () => {
        const { service } = spawnFailing('RPC handler not registered: m1:spawn-mobi-session')

        const text = failureText(await service.createSession('ns', { machineId: 'm1', directory: '/d' }))

        expect(text).toContain('not running a mobi runner')
        expect(text).toContain('list_machines')
        expect(text).not.toContain('RPC')
    })

    test('RPC socket 断开 → 同一句（对 agent 而言是同一件事）', async () => {
        const { service } = spawnFailing('RPC socket disconnected: m1:spawn-mobi-session')

        const text = failureText(await service.createSession('ns', { machineId: 'm1', directory: '/d' }))

        expect(text).toContain('not running a mobi runner')
        expect(text).not.toContain('RPC')
    })

    test('RPC 层 30s 超时 → 说清「可能已建」，并指路 list_sessions 以避免建重', async () => {
        const { service } = spawnFailing('operation has timed out')

        const text = failureText(await service.createSession('ns', { machineId: 'm1', directory: '/d' }))

        expect(text).toContain('did not respond in time')
        expect(text).toContain('may or may not have been created')
        expect(text).toContain('list_sessions')
    })

    test('runner 等会话 webhook 超时 → 与 RPC 超时同一句（两种情况进程都可能已经起来）', async () => {
        const { service } = spawnFailing('Session webhook timeout for PID 4242')

        const text = failureText(await service.createSession('ns', { machineId: 'm1', directory: '/d' }))

        expect(text).toContain('may or may not have been created')
    })

    test('上游自己产出的失败本就是人话 → 原样透出，不另套一层映射', async () => {
        const upstream = "Unable to create directory at '/work/app'. A file already exists at this path or in the parent path."
        const { service } = spawnFailing(upstream)

        expect(failureText(await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })))
            .toBe(upstream)
    })
})

describe('AgentSessionService.sendMessageToSessions — 扇出', () => {
    const sender = makeSession({
        id: 'A',
        namespace: 'ns',
        metadata: { path: '/work/a', host: 'host-a', name: 'Sender' },
    })
    const targetB = makeSession({ id: 'B', namespace: 'ns', metadata: { path: '/work/b', host: 'host-a', name: 'Target B' } })
    const targetC = makeSession({ id: 'C', namespace: 'ns', metadata: { path: '/work/c', host: 'host-a' } })

    test('每个目标各投一次、各落一次，逐条报成功', async () => {
        const { service, pushed, stored } = makeService([], [sender, targetB, targetC])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B', 'C'], content: 'hello' })

        expect(results).toEqual([
            { sessionId: 'B', ok: true },
            { sessionId: 'C', ok: true },
        ])
        expect(pushed.map((entry) => entry.sessionId)).toEqual(['B', 'C'])
        expect(stored.map((entry) => entry.sessionId)).toEqual(['B', 'C'])
    })

    test('投递与落库拿到的是同一份 delivery（信封只进投递那一份，落库那份不含信封）', async () => {
        const { service, pushed, stored } = makeService([], [sender, targetB])

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hello' })

        expect(pushed[0].delivery).toBe(stored[0].delivery)
        expect(stored[0].delivery.blocks).toEqual([{ type: 'text', text: 'hello' }])
        // 信封不是 content 的一部分：落库后 Web 的 Markdown 通道会把它原样显示出来
        expect(JSON.stringify(stored[0].delivery.blocks)).not.toContain('cross-session-message')
    })

    test('delivery 带发送方名字与 id，且消息标识在投递前就已生成（D24）', async () => {
        const { service, pushed } = makeService([], [sender, targetB])

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(pushed[0].delivery.fromName).toBe('Sender')
        expect(pushed[0].delivery.fromSessionId).toBe('A')
        expect(pushed[0].delivery.messageId.length).toBeGreaterThan(0)
    })

    test('同一批里不同目标拿到不同的消息标识（各自是各自会话里的一行）', async () => {
        const { service, pushed } = makeService([], [sender, targetB, targetC])

        await service.sendMessageToSessions('ns', 'A', { targets: ['B', 'C'], content: 'hi' })

        expect(pushed[0].delivery.messageId).not.toBe(pushed[1].delivery.messageId)
    })

    test('发送方会话未命名 → fromName 降级为空串，不拿 id 冒充名字', async () => {
        const unnamed = makeSession({ id: 'A', namespace: 'ns', metadata: { path: '/w', host: 'h' } })
        const { service, pushed } = makeService([], [unnamed, targetB])

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        // 与 CC 原生 peer 消息「信封缺 from-name」的降级同形（Web 显示「来自 其他会话」）；
        // 身份由 fromSessionId 承担
        expect(pushed[0].delivery.fromName).toBe('')
        expect(pushed[0].delivery.fromSessionId).toBe('A')
    })

    test('内容三形态（裸 string / 单 block / 数组）都归一成同一份 blocks', async () => {
        const cases: unknown[] = [
            'hello',
            { type: 'text', text: 'hello' },
            [{ type: 'text', text: 'hello' }],
        ]

        for (const content of cases) {
            const { service, stored } = makeService([], [sender, targetB])
            await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content })
            expect(stored[0].delivery.blocks).toEqual([{ type: 'text', text: 'hello' }])
        }
    })

    test('部分成功不整体回滚：B 成功、不存在的目标逐条失败', async () => {
        const { service, stored } = makeService([], [sender, targetB])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B', 'does-not-exist'],
            content: 'hi',
        })

        expect(results[0]).toEqual({ sessionId: 'B', ok: true })
        expect(results[1].ok).toBe(false)
        expect(results[1].error).toContain('No session with id "does-not-exist"')
        // 成功那条确实落了库——同批里有失败不回滚它（投递收不回来，回滚是假的）
        expect(stored).toHaveLength(1)
        expect(stored[0].sessionId).toBe('B')
    })

    test('目标未激活（进程已退）→ 明确失败，不投递也不落库', async () => {
        const dead = makeSession({ id: 'D', namespace: 'ns', active: false })
        const { service, pushed, stored } = makeService([], [sender, dead])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['D'], content: 'hi' })

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('not running any more')
        // 静默成功会让 agent 以为话带到了，然后一直等一个不会来的回复
        expect(pushed).toHaveLength(0)
        expect(stored).toHaveLength(0)
    })

    test('落库失败仍报成功：投递已经发生，报失败会诱导 agent 重发一遍', async () => {
        const { service, pushed } = makeService([], [sender, targetB], { storeFailure: 'disk is full' })

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(pushed).toHaveLength(1)
        expect(results).toEqual([{ sessionId: 'B', ok: true }])
    })

    test('跨 namespace 的同 id 会话取不到（解析按 id + namespace 成对）', async () => {
        const otherNamespace = makeSession({ id: 'B', namespace: 'other' })
        const { service, pushed } = makeService([], [sender, otherNamespace])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(results[0].ok).toBe(false)
        expect(pushed).toHaveLength(0)
    })
})

describe('AgentSessionService.sendMessageToSessions — RPC 失败翻译', () => {
    const sender = makeSession({ id: 'A', namespace: 'ns', metadata: { path: '/work/a', host: 'host-a', name: 'Sender' } })
    const targetB = makeSession({ id: 'B', namespace: 'ns' })

    async function failureText(pushFailure: string): Promise<string> {
        const { service } = makeService([], [sender, targetB], { pushFailure })
        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })
        return results[0].error ?? ''
    }

    test('handler 未注册 / socket 断开 → 「目标会话不可达」，不说内部细节', async () => {
        const notRegistered = await failureText('RPC handler not registered: B:push-agent-message')
        const disconnected = await failureText('RPC socket disconnected: B:push-agent-message')

        for (const text of [notRegistered, disconnected]) {
            expect(text).toContain('not reachable')
            // 「哪个 handler 没注册」是 mobi 内部结构，agent 无从据此行动
            expect(text).not.toContain('RPC handler')
            expect(text).not.toContain('RPC socket')
        }
    })

    test('RPC 超时 → 说清「可能已送达」并劝阻盲目重发', async () => {
        const text = await failureText('operation has timed out')

        expect(text).toContain('may or may not have been delivered')
        expect(text).toContain('do not send it again blindly')
    })

    test('上游自己产出的失败本就是人话 → 原样透出', async () => {
        const upstream = 'Claude Code rejected the message: input stream is closed.'
        expect(await failureText(upstream)).toBe(upstream)
    })

    test('投递失败的目标不落库（Web 上不该出现永远不会被处理的消息）', async () => {
        const { service, stored } = makeService([], [sender, targetB], { pushFailure: 'operation has timed out' })

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(stored).toHaveLength(0)
    })
})

describe('AgentSessionService.sendMessageToSessions — 内容闸', () => {
    const sender = makeSession({ id: 'A', namespace: 'ns', metadata: { path: '/work/a', host: 'host-a', name: 'Sender' } })
    const targetB = makeSession({ id: 'B', namespace: 'ns' })
    const targetC = makeSession({ id: 'C', namespace: 'ns' })

    test('非文本 block → 整条拒绝，理由说出是哪个 block', async () => {
        const { service, pushed, stored } = makeService([], [sender, targetB])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B'],
            content: [
                { type: 'text', text: 'look at this' },
                { type: 'image', source: { type: 'url', value: '/tmp/a.png' }, id: 'i1', filename: 'a.png', size: 10 },
            ],
        })

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('"image" block')
        // 不静默降级成纯文本继续发——agent 说「带上这张图」而图没带上，成功会骗了它
        expect(pushed).toHaveLength(0)
        expect(stored).toHaveLength(0)
    })

    test('内容类失败对每个目标都是同一句话（一件事，不是每个目标一件事）', async () => {
        const { service } = makeService([], [sender, targetB, targetC])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B', 'C'],
            content: [{ type: 'document', source: { type: 'url', value: '/tmp/a.pdf' }, id: 'd1', filename: 'a.pdf', size: 10 }],
        })

        expect(results).toHaveLength(2)
        expect(results[0].error).toBe(results[1].error)
    })

    test('空内容 / 空数组 → 拒绝（nothing to send）', async () => {
        for (const content of ['', []]) {
            const { service } = makeService([], [sender, targetB])
            const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content })
            expect(results[0].ok).toBe(false)
            expect(results[0].error).toContain('nothing to send')
        }
    })

    test('形状不认识 → 拒绝，并指出该用什么形态', async () => {
        const { service, pushed } = makeService([], [sender, targetB])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: { text: 'hi' } })

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('text / quote / image / document')
        expect(pushed).toHaveLength(0)
    })
})
