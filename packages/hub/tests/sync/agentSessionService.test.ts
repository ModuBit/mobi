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
import type { ReceiveReadiness } from '../../src/sync/sessionReceiveReadiness'
import { RpcFailure, type RpcFailureKind } from '../../src/sync/rpcFailure'
import { AGENT_SESSIONS_DEFAULT_LIMIT, AGENT_SESSIONS_MAX_LIMIT } from '@mobi/shared'
import type { AgentMessageDelivery, AgentMessagePushResult, UserContentBlock } from '@mobi/shared'
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
        /** spawn 失败支要连分类一起给——分类由适配器产出，服务只读它（见 rpcFailure） */
        spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string; failure: RpcFailureKind }
        projectAssignability?: ProjectAssignability
        /** 让 pushAgentMessage 抛一个**带分类**的传输故障（模拟适配器抛出的三种 RPC 故障） */
        pushFailure?: { kind: RpcFailureKind; message: string }
        /** 让 pushAgentMessage 返回这个裁决（模拟 CLI 跑了 handler 却没接住） */
        pushVerdict?: AgentMessagePushResult
        /** 让 storeAgentMessage 抛这个错（模拟落库故障） */
        storeFailure?: string
        /** renameSession 前 N 次抛这个错（模拟 CAS 版本撞车），之后成功 */
        renameFailures?: number
        /** waitUntilCanReceive 的返回（缺省 'ready'，即「建完就接上了」） */
        readiness?: ReceiveReadiness
        /** canReceiveNow 的返回（缺省 undefined = 从没上报过） */
        canReceiveNow?: boolean
    },
) {
    const seenNamespaces: string[] = []
    const seenSessionNamespaces: string[] = []
    const spawnCalls: Array<{ machineId: string; directory: string; options: unknown }> = []
    const pushed: Array<{ sessionId: string; delivery: AgentMessageDelivery }> = []
    const stored: Array<{ sessionId: string; delivery: AgentMessageDelivery }> = []
    const renamed: Array<{ sessionId: string; name: string }> = []
    /** 改名被调用的次数（与成功次数分开：失败也要能数出来，否则重试用例数不出「试了几次」） */
    let renameAttempts = 0
    /** 就绪等待的入参（秒数也要断言：预算是服务端固定值，不该被调用方改） */
    const readinessWaits: Array<{ sessionId: string; timeoutMs: number }> = []
    /** 投递失败后读事实的入参（用来证明「先试再解释」：失败前不该有人读它） */
    const readinessReads: string[] = []
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
                throw new RpcFailure(overrides.pushFailure.kind, overrides.pushFailure.message)
            }
            if (overrides?.pushVerdict) {
                return overrides.pushVerdict
            }
            pushed.push({ sessionId, delivery })
            return { status: 'delivered' }
        },
        storeAgentMessage: async (sessionId, delivery) => {
            if (overrides?.storeFailure) {
                throw new Error(overrides.storeFailure)
            }
            stored.push({ sessionId, delivery })
        },
        renameSession: async (sessionId, name) => {
            // 按**调用次数**判失败，不能按成功次数（renamed.length）：失败时不入列表，
            // 用成功次数判会让「只失败前 N 次」变成「永远失败」，重试用例就假红
            renameAttempts++
            if (renameAttempts <= (overrides?.renameFailures ?? 0)) {
                throw new Error('Session was modified concurrently. Please try again.')
            }
            renamed.push({ sessionId, name })
        },
        waitUntilCanReceive: async (sessionId, timeoutMs) => {
            readinessWaits.push({ sessionId, timeoutMs })
            return overrides?.readiness ?? 'ready'
        },
        canReceiveNow: (sessionId) => {
            readinessReads.push(sessionId)
            return overrides?.canReceiveNow
        },
    })
    return { service, seenNamespaces, seenSessionNamespaces, spawnCalls, pushed, stored, renamed, readinessWaits, readinessReads }
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
            pushAgentMessage: async () => ({ status: 'delivered' }),
            storeAgentMessage: async () => {},
            renameSession: async () => {},
            waitUntilCanReceive: async () => 'ready',
            canReceiveNow: () => undefined,
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'ready' })
        expect(called).toBe(0)
    })
})

describe('AgentSessionService.createSession — 起进程', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    test('成功 → ok:true 带 sessionId', async () => {
        const { service } = makeService([online], [], { spawnResult: { type: 'success', sessionId: 's-new' } })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'ready' })
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

describe('AgentSessionService.createSession — 初始标题（D10 的可选 title）', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    test('给了 title → 建完调改名（走人手动改名那条路），且不进 spawn 透传', async () => {
        const { service, renamed, spawnCalls } = makeService([online], [], { spawnResult: { type: 'success', sessionId: 's-new' } })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app', title: '验收会话' })

        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'ready' })
        expect(renamed).toEqual([{ sessionId: 's-new', name: '验收会话' }])
        // 标题不走 spawn 链路（那条路要新增 CLI 启动参数）——spawn 的选项里没有它
        expect(spawnCalls[0].options).not.toHaveProperty('title')
    })

    test('不给 title → 一次改名都不调（缺省就是没有名字，不编一个）', async () => {
        const { service, renamed } = makeService([online], [], { spawnResult: { type: 'success', sessionId: 's-new' } })

        await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(renamed).toHaveLength(0)
    })

    test('改名撞 CAS 版本 → 刷新后重试一次就成（时序问题，不是规则冲突）', async () => {
        const { service, renamed } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
            renameFailures: 1,
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app', title: 'T' })

        expect(result.ok).toBe(true)
        expect(renamed).toEqual([{ sessionId: 's-new', name: 'T' }])
    })

    test('两次都改名失败 → 仍判成功（会话已建好可用，不为一个称呼把它判失败）', async () => {
        const { service, renamed } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
            renameFailures: 2,
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app', title: 'T' })

        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'ready' })
        expect(renamed).toHaveLength(0)
    })

    test('进程没起来 → 不调改名（没有会话可改名）', async () => {
        const { service, renamed } = makeService([online], [], {
            spawnResult: { type: 'error', message: 'directory could not be created', failure: 'other' },
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/nope', title: 'T' })

        expect(result.ok).toBe(false)
        expect(renamed).toHaveLength(0)
    })
})

describe('AgentSessionService.createSession — 建完等就绪（waitForReady，D39/D42）', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    test('默认等：等的是新会话，预算用服务端固定值（不暴露给 agent）', async () => {
        const { service, readinessWaits } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(readinessWaits).toEqual([{ sessionId: 's-new', timeoutMs: 3000 }])
        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'ready' })
    })

    test('waitForReady:false → 一次都不等，说「没查过」而不是「不能收」', async () => {
        const { service, readinessWaits } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app', waitForReady: false })

        expect(readinessWaits).toHaveLength(0)
        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'not-checked' })
    })

    test('等满超时 → 仍算成功（会话确实建好了），只是就绪状态说成 not-ready', async () => {
        const { service } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
            readiness: 'timeout',
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        // 不判失败：判失败会逼 agent 再建一个，正是「一物两建」要避免的
        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'not-ready' })
    })

    test('等待期间就翻成「不能收」（确定的否定）→ 与超时同一种说法（都是「现在收不下」）', async () => {
        const { service } = makeService([online], [], {
            spawnResult: { type: 'success', sessionId: 's-new' },
            readiness: 'unavailable',
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result).toEqual({ ok: true, sessionId: 's-new', readiness: 'not-ready' })
    })

    test('进程没起来 → 不等（没有会话可等，也不该多花 3s 去等一个不存在的会话）', async () => {
        const { service, readinessWaits } = makeService([online], [], {
            spawnResult: { type: 'error', message: 'boom', failure: 'other' },
        })

        const result = await service.createSession('ns', { machineId: 'm1', directory: '/work/app' })

        expect(result.ok).toBe(false)
        expect(readinessWaits).toHaveLength(0)
    })
})

describe('AgentSessionService.createSession — 失败翻译', () => {
    const online = makeMachine({ id: 'm1', namespace: 'ns' })

    /** 失败支照适配器的形态构造：**分类与文案分开给**——服务只读分类，不读句子 */
    const spawnFailing = (failure: RpcFailureKind, message: string) =>
        makeService([online], [], { spawnResult: { type: 'error', message, failure } })

    const spawnFailureText = async (failure: RpcFailureKind, message: string) =>
        failureText(await spawnFailing(failure, message).service.createSession('ns', { machineId: 'm1', directory: '/d' }))

    test('unreachable 的两种句子（handler 没登记 / socket 断了）→ 同一句，不暴露 RPC 内部措辞', async () => {
        const sentences = [
            'RPC handler not registered: m1:spawn-mobi-session',
            'RPC socket disconnected: m1:spawn-mobi-session',
        ]

        for (const message of sentences) {
            const text = await spawnFailureText('unreachable', message)

            // 两种句子都是「这条 RPC 通道不存在」，对 agent 而言是同一件事
            expect(text).toContain('not running a mobi runner')
            expect(text).toContain('list_machines')
            expect(text).not.toContain('RPC')
        }
    })

    test('timeout → 说清「可能已建」，并指路 list_sessions 以避免建重', async () => {
        const text = await spawnFailureText('timeout', 'operation has timed out')

        expect(text).toContain('did not respond in time')
        expect(text).toContain('may or may not have been created')
        expect(text).toContain('list_sessions')
    })

    test('other → 上游自己产出的失败本就是人话，原样透出，不另套一层映射', async () => {
        const upstream = "Unable to create directory at '/work/app'. A file already exists at this path or in the parent path."

        expect(await spawnFailureText('other', upstream)).toBe(upstream)
    })

    test('分支只认分类、不认文案：含 "timed out" 的句子归 other 就照原样说', async () => {
        // 此前分类是从这句话里反解的——适配器换一个措辞就静默降级成 other（或反过来
        // 把别的东西说成超时）。这条用例钉住：文案只是文案
        const upstream = 'the machine did not answer: its wait timed out.'

        expect(await spawnFailureText('other', upstream)).toBe(upstream)
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

    /** 传输故障照适配器的形态构造：**分类与文案分开给**——服务只读分类，不读句子 */
    async function failureText(failure: RpcFailureKind, message: string, canReceiveNow?: boolean): Promise<string> {
        const { service } = makeService([], [sender, targetB], {
            pushFailure: { kind: failure, message },
            canReceiveNow,
        })
        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })
        return results[0].error ?? ''
    }

    /** CLI 明确拒收（跑了 handler，只是这一刻收不下）——走返回值，不走异常通道 */
    async function rejectionText(reason: string, canReceiveNow?: boolean): Promise<string> {
        const { service } = makeService([], [sender, targetB], {
            pushVerdict: { status: 'rejected', reason },
            canReceiveNow,
        })
        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })
        return results[0].error ?? ''
    }

    test('不可达 + 从没上报过 → 说「可能还在启动、稍后再试」，不编一个「已经退出」', async () => {
        const sentences = [
            'RPC handler not registered: B:push-agent-message',
            'RPC socket disconnected: B:push-agent-message',
        ]

        for (const message of sentences) {
            const text = await failureText('unreachable', message, undefined)

            // 这正是「刚建好、还没接上」的样子：说成「进程没了」会把 agent 吓走，而它只是还没开门
            expect(text).toContain('no recent word from it')
            expect(text).toContain('may still be starting up')
            expect(text).toContain('trying again shortly is often enough')
            expect(text).not.toContain('RPC handler')
            expect(text).not.toContain('RPC socket')
        }
    })

    test('不可达 + 上报过（真或假都一样）→ 说「连接没了，先确认它还在不在」，别干等', async () => {
        for (const reported of [true, false]) {
            const text = await failureText('unreachable', 'RPC socket disconnected: B:push-agent-message', reported)

            // 上报过 = 它连上过；现在连 RPC 都送不到 = 连接没了。上次报的是真是假区分不出
            // 死在一轮中间还是一轮之间，而对 agent 而言都是「没了」
            expect(text).toContain('has reported to mobi before')
            expect(text).toContain('connection is gone now')
            expect(text).toContain('may have exited')
            expect(text).toContain('only if it is still active')
            expect(text).not.toContain('may still be starting up')
        }
    })

    test('超时 → 说清「可能已送达」并劝阻盲目重发（事实不参与这一支）', async () => {
        const text = await failureText('timeout', 'operation has timed out')

        expect(text).toContain('may or may not have been delivered')
        expect(text).toContain('do not send it again blindly')
    })

    test('other → 上游的句子原样透出；分支只认分类、不认文案', async () => {
        const upstream = 'push-agent-message failed: the CLI said it timed out internally.'

        expect(await failureText('other', upstream)).toBe(upstream)
        expect(await failureText('other', upstream)).not.toContain('may or may not have been delivered')
    })

    test('CLI 明确拒收 → 理由原样透出，不套传输故障那一套说法', async () => {
        const reason =
            'that session is not accepting input right now (its Claude Code process is restarting or shutting down).'

        expect(await rejectionText(reason)).toBe(reason)
    })

    test('拒收理由里恰好含 "timed out" 也不能被说成「可能已送达」', async () => {
        // 拒收是**确定性**的裁决，而超时那套话（「可能已送达、别盲目重发」）说的是不确定。
        // 两者混起来会把确定的事说成不确定——正是这套翻译要消灭的那类谎
        const reason = 'the target did not accept it: the wait timed out before its sink was ready.'
        const text = await rejectionText(reason)

        expect(text).toBe(reason)
        expect(text).not.toContain('may or may not have been delivered')
    })

    test('投递失败的目标不落库（Web 上不该出现永远不会被处理的消息）', async () => {
        const { service, stored } = makeService([], [sender, targetB], {
            pushFailure: { kind: 'timeout', message: 'operation has timed out' },
        })

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(stored).toHaveLength(0)
    })
})

describe('AgentSessionService.sendMessageToSessions — 事实是解释，不是闸门（D43）', () => {
    const sender = makeSession({ id: 'A', namespace: 'ns', metadata: { path: '/work/a', host: 'host-a', name: 'Sender' } })
    const targetB = makeSession({ id: 'B', namespace: 'ns' })

    test('事实为假时仍然照发：轮次之间的几十毫秒窗口不该把健康会话挡在门外', async () => {
        const { service, pushed, readinessReads } = makeService([], [sender, targetB], { canReceiveNow: false })

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(results[0].ok).toBe(true)
        expect(pushed).toHaveLength(1)
        // 投递成功就不该有人去读事实——它只在失败之后被读来「解释为什么」
        expect(readinessReads).toHaveLength(0)
    })

    test('投递失败时才读事实，且读的是失败之后的值', async () => {
        const { service, readinessReads } = makeService([], [sender, targetB], {
            pushFailure: { kind: 'unreachable', message: 'RPC handler not registered: B:push-agent-message' },
            canReceiveNow: false,
        })

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(readinessReads).toEqual(['B'])
    })

    test('投递不等待：事实的「等」只属于 create_session', async () => {
        const { service, readinessWaits } = makeService([], [sender, targetB])

        await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'hi' })

        expect(readinessWaits).toHaveLength(0)
    })
})

describe('AgentSessionService.sendMessageToSessions — 内容闸', () => {
    const sender = makeSession({ id: 'A', namespace: 'ns', metadata: { path: '/work/a', host: 'host-a', name: 'Sender' } })
    const targetB = makeSession({ id: 'B', namespace: 'ns' })
    const targetC = makeSession({ id: 'C', namespace: 'ns' })

    test('四型 block 原样投递并落库（text / quote / image / document）', async () => {
        const { service, pushed, stored } = makeService([], [sender, targetB])
        const content: UserContentBlock[] = [
            { type: 'text', text: 'look at this' },
            { type: 'quote', messageId: 'm-prev', role: 'user', excerpt: 'earlier question' },
            { type: 'image', source: { type: 'url', value: '/work/a/pic.png' }, id: 'i1', filename: 'pic.png', size: 10 },
            { type: 'document', source: { type: 'url', value: '/work/a/doc.pdf' }, id: 'd1', filename: 'doc.pdf', size: 20 },
        ]

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content })

        expect(results[0].ok).toBe(true)
        // 原形保留：agent 给的 blocks 就是落库的 blocks（归一只是把三形态收敛成数组，
        // 不重排、不改写——渲染层读的是这些字段，Hub 不该有第二套理解）
        expect(pushed[0].delivery.blocks).toEqual(content)
        expect(stored[0].delivery.blocks).toEqual(content)
    })

    test('内容类失败对每个目标都是同一句话（一件事，不是每个目标一件事）', async () => {
        const { service } = makeService([], [sender, targetB, targetC])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B', 'C'],
            content: { text: 'hi' },
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

describe('AgentSessionService.sendMessageToSessions — 附件闸（同机器）', () => {
    const image = { type: 'image' as const, source: { type: 'url' as const, value: '/work/a/pic.png' }, id: 'i1', filename: 'pic.png', size: 10 }
    const document = { type: 'document' as const, source: { type: 'url' as const, value: '/work/a/doc.pdf' }, id: 'd1', filename: 'doc.pdf', size: 20 }

    const onMacA = (id: string) =>
        makeSession({ id, namespace: 'ns', metadata: { path: `/work/${id}`, host: 'host-a', machineId: 'm-a' } })
    const onMacB = (id: string) =>
        makeSession({ id, namespace: 'ns', metadata: { path: `/work/${id}`, host: 'host-b', machineId: 'm-b' } })

    test('跨机器带本机文件 → 整条失败，不投不落库，并说清是哪一步做不了', async () => {
        const { service, pushed, stored } = makeService([], [onMacA('A'), onMacB('B')])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B'],
            content: [{ type: 'text', text: 'here you go' }, image],
        })

        expect(results[0].ok).toBe(false)
        // 面向 agent 的人话：说清原因（路径只在写出它的机器上有意义）、后果（什么都没发）
        // 与出路（网络图给 URL / 让人搬文件），不吐内部结构。
        // **说的是「无法确认同机器」，不是「它在另一台机器上」**——同一个判据也覆盖
        // 「拿不到发件方身份」，那句话必须对两种成因都为真（候选 #8）
        expect(results[0].error).toContain('could not confirm')
        expect(results[0].error).toContain('pic.png')
        expect(results[0].error).toContain('Nothing was sent')
        // 不做静默降级：剔掉图片继续发文本会让 agent 以为文件带上了
        expect(pushed).toHaveLength(0)
        expect(stored).toHaveLength(0)
    })

    /**
     * 「解析不出对方是谁」这一支（2026-09-13 架构评审候选 #8）：发件方会话解析不到时
     * 判据证明不了同机器，闸照常拒绝——但话术不能变成「它在另一台机器上」，那是这条分支
     * 无从知道的结论。
     */
    test('发件方身份解析不到 → 照常拒绝，话术是「无法确认」而不是「在另一台机器」', async () => {
        const { service, pushed } = makeService([], [onMacB('B')])

        const results = await service.sendMessageToSessions('ns', 'missing', {
            targets: ['B'],
            content: image,
        })

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('could not confirm')
        expect(results[0].error).not.toContain('is on a different machine')
        expect(pushed).toHaveLength(0)
    })

    test('多个本机文件跨机器 → 话术把文件名都列出来（只报一个会解释不了另一张的去向）', async () => {
        const second = { ...image, id: 'i2', filename: 'v2.png', source: { type: 'url' as const, value: '/work/a/v2.png' } }
        const { service, pushed } = makeService([], [onMacA('A'), onMacB('B')])

        const results = await service.sendMessageToSessions('ns', 'A', {
            targets: ['B'],
            content: [image, second],
        })

        expect(results[0].ok).toBe(false)
        expect(results[0].error).toContain('local files')
        expect(results[0].error).toContain('pic.png')
        expect(results[0].error).toContain('v2.png')
        expect(pushed).toHaveLength(0)
    })

    test('跨机器纯文本不受影响', async () => {
        const { service, pushed } = makeService([], [onMacA('A'), onMacB('B')])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: 'just words' })

        expect(results[0].ok).toBe(true)
        expect(pushed).toHaveLength(1)
    })

    test('跨机器给的是网络图（值自足）→ 不受影响：不依赖任何本机文件', async () => {
        const { service, pushed } = makeService([], [onMacA('A'), onMacB('B')])
        const remote = { ...image, source: { type: 'url' as const, value: 'https://cdn.example.com/pic.png' } }

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: remote })

        expect(results[0].ok).toBe(true)
        expect(pushed).toHaveLength(1)
    })

    test('previewUrl 换成网络地址救不了本机路径：推给 CC 时读的仍是 value', async () => {
        const { service, pushed } = makeService([], [onMacA('A'), onMacB('B')])
        const withPreview = { ...image, previewUrl: 'https://cdn.example.com/pic.png' }

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: withPreview })

        // Web 会拿 previewUrl 渲染得好看，但 CC 手上仍是对方机器上不存在的路径——
        // 渲染好看而投递报成功，正是「agent 以为文件带上了」的那类欺骗
        expect(results[0].ok).toBe(false)
        expect(pushed).toHaveLength(0)
    })

    test('同机器（machineId 相同）→ 附件照常投递', async () => {
        const { service, stored } = makeService([], [onMacA('A'), onMacA('B')])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: document })

        expect(results[0].ok).toBe(true)
        expect(stored).toHaveLength(1)
    })

    test('machineId 缺失时退回 host 比对（同一 host = 同一文件系统）', async () => {
        const noId = (id: string) => makeSession({ id, namespace: 'ns', metadata: { path: `/work/${id}`, host: 'host-a' } })
        const { service } = makeService([], [noId('A'), noId('B')])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: image })

        expect(results[0].ok).toBe(true)
    })

    test('两边的机器身份都缺失 → 证明不了同机器就不放行（与「确实不同机器」同一支）', async () => {
        // host 是 schema 必填字段，用空串表达「这条会话没自报机器身份」
        const bare = (id: string) => makeSession({ id, namespace: 'ns', metadata: { path: `/work/${id}`, host: '' } })
        const { service, pushed } = makeService([], [bare('A'), bare('B')])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B'], content: image })

        expect(results[0].ok).toBe(false)
        expect(pushed).toHaveLength(0)
    })

    test('扇出逐条判：同机器的收得到，另一台机器的整条失败', async () => {
        const { service, pushed, stored } = makeService([], [onMacA('A'), onMacA('B'), onMacB('C')])

        const results = await service.sendMessageToSessions('ns', 'A', { targets: ['B', 'C'], content: image })

        expect(results.map((r) => r.ok)).toEqual([true, false])
        expect(pushed.map((p) => p.sessionId)).toEqual(['B'])
        expect(stored.map((s) => s.sessionId)).toEqual(['B'])
    })
})

