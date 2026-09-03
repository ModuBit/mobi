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
import { OUTPUT_STYLES, OUTPUT_STYLE_LABELS, isBuiltinOutputStyle } from '../src/styles'

describe('OUTPUT_STYLES', () => {
    it('顺序对齐 CC /config 官方菜单序（2026-09-03 实抄）', () => {
        expect(OUTPUT_STYLES).toEqual(['default', 'proactive', 'concise', 'explanatory', 'learning'])
    })

    it('每个 style 都有 label 且一一对应', () => {
        expect(Object.keys(OUTPUT_STYLE_LABELS)).toHaveLength(OUTPUT_STYLES.length)
        for (const s of OUTPUT_STYLES) expect(OUTPUT_STYLE_LABELS[s]).toBeTruthy()
    })

    it('isBuiltinOutputStyle 判定', () => {
        expect(isBuiltinOutputStyle('default')).toBe(true)
        expect(isBuiltinOutputStyle('my-style')).toBe(false)
    })
})
