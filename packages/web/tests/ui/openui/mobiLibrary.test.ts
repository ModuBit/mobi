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
 * 点击 registry 规格（per-action 粒度票 02）：Button capture 同步帧写、onAction
 * take 语义读。registry 必须跨模块实例共享——vite dev re-optimize 会产生同一模块
 * 的两个实例（E2E 2026-10-11 实锤：写读落不同实例，刷新后首次点击身份 miss），
 * 模块级变量各持一份必断，须挂 globalThis Symbol.for 槽位。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { takeClickedActionStatementId } from '@/components/ui/openui/mobiLibrary'

describe('点击 registry（跨模块实例共享）', () => {
    afterEach(() => {
        vi.resetModules()
    })

    it('实例 A 写、实例 B 读同一位（vite re-optimize 双实例断裂回归）', async () => {
        const instA = await import('@/components/ui/openui/mobiLibrary')
        vi.resetModules()
        const instB = await import('@/components/ui/openui/mobiLibrary')
        expect(instA).not.toBe(instB)

        instB.writeClickedStatementIdForTest('stmt-9')
        expect(takeClickedActionStatementId()).toBe('stmt-9')
    })

    it('take 语义：读后即清，陈旧身份不跨事件存活', async () => {
        const inst = await import('@/components/ui/openui/mobiLibrary')
        inst.writeClickedStatementIdForTest('stmt-1')
        expect(takeClickedActionStatementId()).toBe('stmt-1')
        expect(takeClickedActionStatementId()).toBeNull()
    })
})
