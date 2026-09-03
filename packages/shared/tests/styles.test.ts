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
import { OUTPUT_STYLES, OUTPUT_STYLE_LABELS, OUTPUT_STYLE_FOLLOW_SETTING, isBuiltinOutputStyle } from '../src/styles'

describe('OUTPUT_STYLES', () => {
    it('值为 CC init 上报规范形（default 小写 + 四驼峰，2026-09-03 E2E 实测）', () => {
        expect(OUTPUT_STYLES).toEqual(['default', 'Proactive', 'Concise', 'Explanatory', 'Learning'])
    })

    it('每个 style 都有 label 且一一对应', () => {
        expect(Object.keys(OUTPUT_STYLE_LABELS)).toHaveLength(OUTPUT_STYLES.length)
        for (const s of OUTPUT_STYLES) expect(OUTPUT_STYLE_LABELS[s]).toBeTruthy()
    })

    it('isBuiltinOutputStyle 按规范形判定（availableStyles 去重依赖）', () => {
        expect(isBuiltinOutputStyle('default')).toBe(true)
        expect(isBuiltinOutputStyle('Proactive')).toBe(true)
        expect(isBuiltinOutputStyle('my-style')).toBe(false)
    })

    it('OUTPUT_STYLE_FOLLOW_SETTING 为空串哨兵（spawn 不携带字段）', () => {
        expect(OUTPUT_STYLE_FOLLOW_SETTING).toBe('')
    })
})
