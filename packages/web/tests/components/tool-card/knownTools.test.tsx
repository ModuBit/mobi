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

import { describe, expect, it } from 'vitest'
import { getToolPresentation } from '@/components/tool-card/knownTools'

describe('文件工具标题', () => {
    it.each(['Read', 'Edit', 'MultiEdit', 'Write'])('%s 兼容 file 字段', (toolName) => {
        const presentation = getToolPresentation({
            toolName,
            input: { file: 'src/a.ts' },
            result: null,
            childrenCount: 0,
            description: null,
            metadata: null,
        })

        expect(presentation.title).toContain('(src/a.ts')
    })
})
