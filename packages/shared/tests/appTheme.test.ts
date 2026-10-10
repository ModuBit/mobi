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
import { MOBI_THEME_VARS, MOBI_THEME_VAR_LIST, MOBI_THEME_PALETTE_VARS } from '../src/appTheme'

describe('--mobi-* 主题变量词表（架构评审候选 3 单源）', () => {
    it('扁平全集无重复、且全部以 --mobi- 前缀命名', () => {
        expect(new Set(MOBI_THEME_VAR_LIST).size).toBe(MOBI_THEME_VAR_LIST.length)
        for (const v of MOBI_THEME_VAR_LIST) expect(v.startsWith('--mobi-')).toBe(true)
    })

    it('调色板投影 = 全集 − meta 组（教学文本不列非调色板变量）', () => {
        expect(MOBI_THEME_PALETTE_VARS).not.toContain('--mobi-color-scheme')
        expect([...MOBI_THEME_PALETTE_VARS, ...MOBI_THEME_VARS.meta].sort()).toEqual([...MOBI_THEME_VAR_LIST].sort())
    })
})
