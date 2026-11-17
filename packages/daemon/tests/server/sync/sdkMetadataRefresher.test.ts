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
 * sdkMetadata 刷新模块的接口契约：
 * - force 的承诺：飞行中到达也不丢，本轮落地后补跑一轮；
 * - 节流：普通请求 30s 内合并，force 绕过；
 * - 活跃闸：不活跃会话不发 RPC；
 * - 版本闸：apply 携带发起时快照的 metadataVersion；
 * - 作用面：global/workspace/session 各自圈定，会话内 reload 不外溢。
 */

import { describe, expect, test } from 'bun:test'
import type { SDKMetadata } from '@mobi/shared/types'
import {
    SdkMetadataRefresher,
    type RefresherSession,
} from '../../../src/sync/sdkMetadataRefresher'

const METADATA = { commands: [] } as unknown as SDKMetadata

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(options?: { minIntervalMs?: number }) {
    const sessions = new Map<string, RefresherSession>()
    const started: string[] = []
    const applied: Array<{ sessionId: string; expectedVersion: number }> = []
    const pending: Array<(success: boolean) => void> = []

    const refresher = new SdkMetadataRefresher(
        {
            getSession: sessionId => sessions.get(sessionId),
            getSessionsByNamespace: namespace => [...sessions.values()].filter(s => s.namespace === namespace),
            refreshMetadata: (sessionId) => {
                started.push(sessionId)
                return new Promise(resolve => {
                    pending.push((success) => {
                        resolve(success ? { success: true, metadata: METADATA } : { success: false })
                    })
                })
            },
            applyRefreshedSDKMetadata: (sessionId, _metadata, expectedVersion) => {
                applied.push({ sessionId, expectedVersion })
                return true
            },
        },
        options,
    )

    const addSession = (id: string, overrides: Partial<RefresherSession> = {}): RefresherSession => {
        const session: RefresherSession = {
            id,
            active: true,
            namespace: 'default',
            workspaceId: null,
            metadataVersion: 1,
            ...overrides,
        }
        sessions.set(id, session)
        return session
    }

    /** 让最早一个未决 RPC 落地（默认成功）并刷新微任务 */
    const settle = async (success = true) => {
        const finish = pending.shift()
        if (!finish) throw new Error('没有未决的 refreshMetadata')
        finish(success)
        await tick()
    }

    return { refresher, started, applied, pending, addSession, settle }
}

describe('SdkMetadataRefresher · force 的承诺', () => {
    test('飞行中到达的 force 本轮落地后补跑一轮（不被并发闸吞掉）', async () => {
        const h = setup()
        h.addSession('s1')

        void h.refresher.request('s1')
        expect(h.started).toEqual(['s1'])

        // 飞行中的 force：立即返回，不并发发起
        await h.refresher.request('s1', { force: true })
        expect(h.started).toEqual(['s1'])

        await h.settle(true)
        // 第一轮已应用，且补跑的第二轮已发起
        expect(h.applied).toHaveLength(1)
        expect(h.started).toEqual(['s1', 's1'])

        await h.settle(true)
        expect(h.applied).toHaveLength(2)
    })

    test('飞行中到达的普通请求合并丢弃', async () => {
        const h = setup()
        h.addSession('s1')

        void h.refresher.request('s1')
        await h.refresher.request('s1')
        await h.settle(true)

        expect(h.started).toEqual(['s1'])
    })

    test('补跑的 force 遇到会话已转不活跃 → 不再发起', async () => {
        const h = setup()
        const session = h.addSession('s1')

        void h.refresher.request('s1')
        void h.refresher.request('s1', { force: true })
        session.active = false
        await h.settle(true)

        expect(h.started).toEqual(['s1'])
    })
})

describe('SdkMetadataRefresher · 节流与活跃闸', () => {
    test('30s 内普通请求跳过；force 绕过节流', async () => {
        const h = setup()
        h.addSession('s1')

        void h.refresher.request('s1')
        await h.settle(true)

        await h.refresher.request('s1')
        expect(h.started).toHaveLength(1)

        void h.refresher.request('s1', { force: true })
        expect(h.started).toEqual(['s1', 's1'])
        await h.settle(true)
    })

    test('不活跃会话不发 RPC', async () => {
        const h = setup()
        h.addSession('s1', { active: false })

        await h.refresher.request('s1', { force: true })
        expect(h.started).toEqual([])
    })
})

describe('SdkMetadataRefresher · 版本闸与失败静默', () => {
    test('apply 携带发起时快照的 metadataVersion', async () => {
        const h = setup()
        h.addSession('s1', { metadataVersion: 7 })

        void h.refresher.request('s1')
        await h.settle(true)

        expect(h.applied).toEqual([{ sessionId: 's1', expectedVersion: 7 }])
    })

    test('RPC 失败 → 不 apply（web 继续用缓存）', async () => {
        const h = setup()
        h.addSession('s1')

        void h.refresher.request('s1')
        await h.settle(false)

        expect(h.applied).toEqual([])
    })
})

describe('SdkMetadataRefresher · 清单变更的作用面', () => {
    test('global → 全部活跃会话（inactive 跳过）', async () => {
        const h = setup()
        h.addSession('a')
        h.addSession('b', { workspaceId: 'ws-2' })
        h.addSession('idle', { active: false })

        h.refresher.refreshInventory('default', { kind: 'global' })
        expect(h.started.sort()).toEqual(['a', 'b'])
        await h.settle()
        await h.settle()
    })

    test('workspace → 只圈定该工作区的活跃会话', async () => {
        const h = setup()
        h.addSession('a', { workspaceId: 'ws-1' })
        h.addSession('b', { workspaceId: 'ws-2' })
        h.addSession('other-ns', { workspaceId: 'ws-1', namespace: 'other' })

        h.refresher.refreshInventory('default', { kind: 'workspace', workspaceId: 'ws-1' })
        expect(h.started).toEqual(['a'])
        await h.settle()
    })

    test('session → 只刷新该会话，不因同工作区外溢（会话内 reload 的原始语义）', async () => {
        const h = setup()
        h.addSession('a', { workspaceId: 'ws-1' })
        h.addSession('peer', { workspaceId: 'ws-1' })

        h.refresher.refreshInventory('default', { kind: 'session', sessionId: 'a' })
        expect(h.started).toEqual(['a'])
        await h.settle()
    })
})
