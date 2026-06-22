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

import { describe, expect, it, beforeEach } from 'vitest'
import { useAuthStore } from '@/core/data/stores/authStore'

describe('authStore（C-T3 删 token 后）', () => {
    beforeEach(() => {
        // 重置到未认证
        useAuthStore.getState().logout()
    })

    it('初始 authenticated 为 false 且无 token 字段', () => {
        const state = useAuthStore.getState()
        expect(state.authenticated).toBe(false)
        // token 字段已删除（C-T3 httpOnly cookie 闭环）
        expect(state).not.toHaveProperty('token')
    })

    it('setAuthenticated(true) 置 authenticated，不存 token', () => {
        useAuthStore.getState().setAuthenticated(true)
        const state = useAuthStore.getState()
        expect(state.authenticated).toBe(true)
        expect(state).not.toHaveProperty('token')
    })

    it('logout 置 authenticated=false', () => {
        useAuthStore.getState().setAuthenticated(true)
        useAuthStore.getState().logout()
        expect(useAuthStore.getState().authenticated).toBe(false)
    })
})
