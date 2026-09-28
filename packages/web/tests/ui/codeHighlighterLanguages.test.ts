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

/**
 * 高亮注册表对账（/simplify 盘点：两份清单是手工镜像的跨文件不变量，无对账则
 * detect 候选新增语言后注册表不跟着变，结果静默降级素码、无任何报错）。
 * 断言：检测候选经 HLJS_TO_PRISM 映射后的 prism 名 ⊆ 注册表键集。
 */

import { describe, it, expect } from 'vitest'
import { REGISTERED_LANGUAGE_NAMES } from '@/components/ui/codeHighlighterLanguages'
import { DETECTABLE_PRISM_LANGUAGES, FALLBACK_LANGUAGE } from '@/core/utils/codeLanguageDetect'

describe('codeHighlighterLanguages 注册表对账', () => {
    it('检测候选（经映射）全部已注册——防新增候选语言后静默降级素码', () => {
        const missing = [...DETECTABLE_PRISM_LANGUAGES].filter((l) => !REGISTERED_LANGUAGE_NAMES.has(l))
        expect(missing).toEqual([])
    })

    it('检测兜底语言（clike）已注册', () => {
        expect(REGISTERED_LANGUAGE_NAMES.has(FALLBACK_LANGUAGE)).toBe(true)
    })
})
