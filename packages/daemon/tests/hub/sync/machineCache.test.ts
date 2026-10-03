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
import { MachineCache } from '../../../src/sync/machineCache'
import { EventPublisher } from '../../../src/sync/eventPublisher'
import { Store } from '../../../src/store'

/**
 * ticket-20 验收用例：machine 通道删除后本机由 daemon 自注册——
 * 常驻 active、无心跳也不过期（含长时间 inactive 驱逐豁免）；
 * 对照组：非本机机器走原有超时翻 inactive / 驱逐语义不变。
 */

function makeCache(): { cache: MachineCache; store: Store; cleanup: () => void } {
    const store = new Store(':memory:')
    const sseManager = { broadcast: () => {} } as unknown as import('../../../src/sse/sseManager').SSEManager
    const cache = new MachineCache(store, new EventPublisher(sseManager, (event) => event.namespace))
    return {
        cache,
        store,
        cleanup: () => {
            store.close()
        },
    }
}

describe('MachineCache 本机自注册（ticket-20）', () => {
    test('registerLocalMachine 注册即 active；远超心跳超时后 expireInactive 仍 active 且不被驱逐', () => {
        const h = makeCache()
        try {
            const machine = h.cache.registerLocalMachine('machine-local', { host: 'h-1' }, { status: 'running' }, 'default')
            expect(machine.active).toBe(true)

            // 无心跳：远超 45s 超时与 1h 驱逐窗口仍常驻
            h.cache.expireInactive(Date.now() + 2 * 3_600_000)
            expect(h.cache.getMachine('machine-local')?.active).toBe(true)
            expect(h.cache.getMachine('machine-local')).toBeTruthy()

            // 重启语义（warmup 从 DB 重载）后 local 标记仍在缓存层重建（daemon 启动时会再自注册，
            // 此处只锁「注册过的机器不会因 expireInactive 消失」）
            h.cache.registerLocalMachine('machine-local', { host: 'h-1' }, null, 'default')
            h.cache.expireInactive(Date.now() + 2 * 3_600_000)
            expect(h.cache.getMachine('machine-local')?.active).toBe(true)
        } finally {
            h.cleanup()
        }
    })

    test('对照组：非本机机器超时翻 inactive、长时间 inactive 被驱逐（原语义不变）', () => {
        const h = makeCache()
        try {
            // getOrCreateMachine 只建行不置活——模拟离线注册（handleMachineAlive 已删，active 判据只剩缓存态）
            const machine = h.cache.getOrCreateMachine('machine-remote', { host: 'h-2' }, null, 'default')
            // 手动置活（模拟旧心跳效果）：直接改缓存态
            const cached = h.cache.getMachine('machine-remote')!
            cached.active = true
            cached.activeAt = Date.now() - 46_000 // 已超 45s 心跳超时

            h.cache.expireInactive()
            expect(h.cache.getMachine('machine-remote')?.active).toBe(false)

            // 驱逐窗口：inactive 超 1h 后从缓存删除（DB 行仍在）
            cached.activeAt = Date.now() - 2 * 3_600_000
            h.cache.expireInactive()
            expect(h.cache.getMachine('machine-remote')).toBeUndefined()
            expect(h.store.machines.getMachine('machine-remote')).toBeTruthy()
        } finally {
            h.cleanup()
        }
    })
})
