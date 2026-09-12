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
import { AGENT_SESSIONS_DEFAULT_LIMIT, AGENT_SESSIONS_MAX_LIMIT } from '@mobi/shared'
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

function makeService(machines: Machine[], sessions: Session[] = []) {
    const seenNamespaces: string[] = []
    const seenSessionNamespaces: string[] = []
    const service = new AgentSessionService({
        getOnlineMachinesByNamespace: (namespace) => {
            seenNamespaces.push(namespace)
            return machines
        },
        getSessionsByNamespace: (namespace) => {
            seenSessionNamespaces.push(namespace)
            return sessions
        },
    })
    return { service, seenNamespaces, seenSessionNamespaces }
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
