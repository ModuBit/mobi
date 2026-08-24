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

import { describe, it, expect } from 'vitest'

import { commandLifecycleToFact } from '../../src/claude/claudeRemote'

/**
 * command_lifecycle 帧 → lifecycle fact 映射（launcher onMessage 拦截单元）：
 * CC 排队消息生命周期回执的转译规则，控制帧不进消息流、只取信号上报 Hub。
 */

describe('commandLifecycleToFact', () => {
    it('started → processing', () => {
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'started' }))
            .toEqual({ nativeId: 'cmd-1', state: 'processing' })
    })

    it('completed → done', () => {
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'completed' }))
            .toEqual({ nativeId: 'cmd-1', state: 'done' })
    })

    it('cancelled / discarded 直传', () => {
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'cancelled' }))
            .toEqual({ nativeId: 'cmd-1', state: 'cancelled' })
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'discarded' }))
            .toEqual({ nativeId: 'cmd-1', state: 'discarded' })
    })

    it('queued → null（不上报，Hub 已有初始排队态）', () => {
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'queued' }))
            .toBeNull()
    })

    it('非 command_lifecycle 帧或缺字段 → null', () => {
        // 非本类型
        expect(commandLifecycleToFact({ type: 'user', isReplay: true, uuid: 'x' })).toBeNull()
        // 缺 command_uuid / 空串
        expect(commandLifecycleToFact({ type: 'command_lifecycle', state: 'completed' })).toBeNull()
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: '', state: 'completed' })).toBeNull()
        // 未知 state
        expect(commandLifecycleToFact({ type: 'command_lifecycle', command_uuid: 'cmd-1', state: 'whatever' })).toBeNull()
        // 非对象
        expect(commandLifecycleToFact(null)).toBeNull()
        expect(commandLifecycleToFact('command_lifecycle')).toBeNull()
        expect(commandLifecycleToFact(undefined)).toBeNull()
    })
})
