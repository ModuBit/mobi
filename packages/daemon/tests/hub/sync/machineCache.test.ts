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
import { Store } from '../../../src/store'

/**
 * ticket-20 验收用例：machine 通道删除后本机由 daemon 自注册——
 * 常驻 active、无心跳也不过期（含长时间 inactive 驱逐豁免）；
 * 对照组：非本机机器走原有超时翻 inactive / 驱逐语义不变。
 * （发射语义 205 起收敛到 executorRuntime 写路径，cache 不再持有 publisher）
 */

function makeCache(): { cache: MachineCache; store: Store; cleanup: () => void } {
    const store = new Store(':memory:')
    const cache = new MachineCache(store)
    return {
        cache,
        store,
        cleanup: () => {
            store.close()
        },
    }
}

describe('MachineCache 本机自注册（ticket-20）', () => {
    test('registerLocalMachine 注册即 active；重载（warmup）后再自注册仍 active', () => {
        // ticket-25 起 expireInactive 已随多机分支收敛删除：本机 active 的「常驻」由
        // 「没有任何代码会把它翻成 false」保证，这里只锁注册与重载语义
        const h = makeCache()
        try {
            const machine = h.cache.registerLocalMachine('machine-local', { host: 'h-1' }, { status: 'running' }, 'default')
            expect(machine.active).toBe(true)

            // 重启语义（warmup 从 DB 重载）后 daemon 启动时会再自注册，仍为 active
            h.cache.warmupCache()
            h.cache.registerLocalMachine('machine-local', { host: 'h-1' }, null, 'default')
            expect(h.cache.getMachine('machine-local')?.active).toBe(true)
        } finally {
            h.cleanup()
        }
    })
})
