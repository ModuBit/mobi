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
import type { Machine } from '../../src/sync/machineCache'

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

function makeService(machines: Machine[]) {
    const seenNamespaces: string[] = []
    const service = new AgentSessionService({
        getOnlineMachinesByNamespace: (namespace) => {
            seenNamespaces.push(namespace)
            return machines
        },
    })
    return { service, seenNamespaces }
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
