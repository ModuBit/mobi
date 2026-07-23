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
import { planNotificationClick, type ClickClient } from '@/core/pwa/swClick'

function client(pathname: string): ClickClient {
    return {
        url: `https://mobi.local${pathname}`,
        focus: async () => undefined,
        postMessage: () => {},
    }
}

describe('planNotificationClick', () => {
    it('无 url(data 未带跳转地址)→ noop', () => {
        expect(planNotificationClick(undefined, [client('/sessions/a')])).toEqual({ kind: 'noop' })
        expect(planNotificationClick('', [])).toEqual({ kind: 'noop' })
    })

    it('已有窗口恰在目标 session → focus(无需导航)', () => {
        const target = client('/sessions/a')
        const plan = planNotificationClick('/sessions/a', [client('/'), target])
        expect(plan).toEqual({ kind: 'focus', client: target })
    })

    it('窗口在目标子路径 → 同样 focus(精确前缀匹配,避免子串误中)', () => {
        // abc 不应误中 abcd
        const abcd = client('/sessions/abcd')
        expect(planNotificationClick('/sessions/abc', [abcd])).toEqual({ kind: 'focusAndNavigate', client: abcd, url: '/sessions/abc' })
        // 真正的子路径才匹配
        const sub = client('/sessions/a/files')
        expect(planNotificationClick('/sessions/a', [sub])).toEqual({ kind: 'focus', client: sub })
    })

    it('有窗口但不在目标 session → focusAndNavigate 第一个(前端 SPA 跳转)', () => {
        const other = client('/sessions/b')
        const plan = planNotificationClick('/sessions/a', [other])
        expect(plan).toEqual({ kind: 'focusAndNavigate', client: other, url: '/sessions/a' })
    })

    it('无任何窗口 → openWindow', () => {
        expect(planNotificationClick('/sessions/a', [])).toEqual({ kind: 'openWindow', url: '/sessions/a' })
    })
})
