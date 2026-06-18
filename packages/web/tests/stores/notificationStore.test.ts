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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useNotificationStore } from '@/core/data/stores/notificationStore'

describe('notificationStore reset', () => {
    beforeEach(() => {
        // 隔离:每个测试前重置到干净状态
        useNotificationStore.setState({ permission: 'default', subscribed: false, error: null })
    })
    afterEach(() => vi.unstubAllGlobals())

    it('reset 清空 subscribed 与 error(换号不继承上一用户状态)', () => {
        useNotificationStore.setState({ subscribed: true, error: { kind: 'subscribe' } })
        useNotificationStore.getState().reset()
        expect(useNotificationStore.getState().subscribed).toBe(false)
        expect(useNotificationStore.getState().error).toBeNull()
    })

    it('reset 重置 permission 为当前浏览器权限(不保留脏值)', () => {
        vi.stubGlobal('Notification', { permission: 'denied' })
        useNotificationStore.setState({ permission: 'granted' })
        useNotificationStore.getState().reset()
        expect(useNotificationStore.getState().permission).toBe('denied')
    })
})
