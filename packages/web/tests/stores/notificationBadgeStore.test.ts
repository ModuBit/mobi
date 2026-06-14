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

import { describe, it, expect, beforeEach } from 'vitest'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'

describe('notificationBadgeStore', () => {
    beforeEach(() => {
        useNotificationBadgeStore.getState().clearAll()
    })

    it('markUnread 标记某 session 的某类未读', () => {
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')
        expect(useNotificationBadgeStore.getState().hasUnread('s1')).toBe(true)
        expect(useNotificationBadgeStore.getState().getBadge('s1')).toEqual({ ready: true, permission: false })
    })

    it('同一 session 两类都未读', () => {
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')
        useNotificationBadgeStore.getState().markUnread('s1', 'permission')
        expect(useNotificationBadgeStore.getState().getBadge('s1')).toEqual({ ready: true, permission: true })
    })

    it('clearBadge 清零指定 session', () => {
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')
        useNotificationBadgeStore.getState().clearBadge('s1')
        expect(useNotificationBadgeStore.getState().hasUnread('s1')).toBe(false)
    })

    it('hasUnread 未标记的 session 返回 false', () => {
        expect(useNotificationBadgeStore.getState().hasUnread('unknown')).toBe(false)
    })
})
