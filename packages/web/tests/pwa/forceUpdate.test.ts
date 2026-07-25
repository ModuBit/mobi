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
import { planForceUpdate } from '@/core/pwa/forceUpdate'

describe('planForceUpdate', () => {
    it('无 SW 支持 → reload(直接刷新,绕过一切)', () => {
        expect(planForceUpdate({ hasSw: false, hasWaiting: false })).toBe('reload')
    })

    it('有 SW 且有 waiting 新 SW → skipWaiting(复用激活链路)', () => {
        expect(planForceUpdate({ hasSw: true, hasWaiting: true })).toBe('skipWaiting')
    })

    it('有 SW 但无 waiting → clearCaches(应对 SW 未检测到更新但版本不对)', () => {
        expect(planForceUpdate({ hasSw: true, hasWaiting: false })).toBe('clearCaches')
    })
})
