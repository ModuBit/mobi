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

import { describe, expect, test } from 'bun:test'
import { getExecutorState, updateExecutorState } from '../../../src/sync/executorRuntime'

/**
 * executor 运行时状态内存单例（ticket 205）：运行时事实的家，不再落库。
 * 读方 = /api/daemon/status + daemon-status SSE；写方 = runner core 状态上报。
 */

describe('executorRuntime 内存单例', () => {
    test('未上报过（启动早期）读数为 null', () => {
        // bun test 每文件独立模块注册表，本文件内的单例状态不跨文件泄漏
        expect(getExecutorState()).toBeNull()
    })

    test('handler 收旧值返回新值，读数直写生效', () => {
        updateExecutorState(() => ({ status: 'running', pid: 123, startedAt: 1 }))
        expect(getExecutorState()).toEqual({ status: 'running', pid: 123, startedAt: 1 })

        // 二次上报以单例旧值为基（如 spawn 结果在现状态上追加 lastSpawnError）
        updateExecutorState((prev) => ({ ...prev!, lastSpawnError: { message: 'boom', exitCode: 1, signal: null, at: 2 } }))
        expect(getExecutorState()?.lastSpawnError?.message).toBe('boom')
        expect(getExecutorState()?.pid).toBe(123)
    })
})
