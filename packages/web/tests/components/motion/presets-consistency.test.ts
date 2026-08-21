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
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spring } from '@/components/motion/presets'

const here = dirname(fileURLToPath(import.meta.url))
// 本文件在 packages/web/tests/components/motion/，DESIGN.md 在 packages/web/，
// 向上三级正好回到包根，无需再校准。
const designMd = readFileSync(resolve(here, '../../../DESIGN.md'), 'utf-8')

/** 从 frontmatter 的 motion 块提取数值（正则解析，避免引入 yaml 依赖） */
function extractPreset(name: string): { damping: number; response: number } {
    const re = new RegExp(`${name}:\\s*\\{\\s*damping:\\s*([\\d.]+),\\s*response:\\s*([\\d.]+)\\s*\\}`)
    const m = designMd.match(re)
    if (!m) throw new Error(`DESIGN.md motion 块缺少 ${name}`)
    return { damping: Number(m[1]), response: Number(m[2]) }
}

describe('spring 预设与 DESIGN.md 一致性（文档与代码同源守卫）', () => {
    it.each(['ui', 'momentum', 'gentle'])('spring.%s 与文档数值一致', (name) => {
        const doc = extractPreset(name)
        const code = spring[name as keyof typeof spring] as { damping: number; duration: number }
        expect(code.damping).toBe(doc.damping)
        expect(code.duration).toBe(doc.response)
    })
})
