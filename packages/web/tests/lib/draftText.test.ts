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
import { saveDraftText, consumeDraftText } from '@/core/lib/draftText'

describe('draftText', () => {
    beforeEach(() => {
        sessionStorage.clear()
    })

    it('save 后 consume 能读取到草稿', () => {
        saveDraftText('请帮我重构这段代码 @/src/app.ts')
        expect(consumeDraftText()).toBe('请帮我重构这段代码 @/src/app.ts')
    })

    it('consume 后清除，再次读取为 null', () => {
        saveDraftText('hello')
        consumeDraftText()
        expect(consumeDraftText()).toBeNull()
    })

    it('无草稿时返回 null', () => {
        expect(consumeDraftText()).toBeNull()
    })
})
