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
 * 颜色类 @函数（1 个）：两个十六进制颜色之间按比例插值——热力图 / 色阶 / 淡色
 * 背景的本地计算。来源：thesysdev/open-intelligent-ui（MIT）
 * `src/lib/functions/colors.ts`。
 */

import { defineFunction } from '@openuidev/lang-core'
import { z } from 'zod'

const HEX = /^#?([\da-f]{3}|[\da-f]{6})$/i

/** "#abc" / "#aabbcc" → [r, g, b] */
function channels(color: string): number[] {
    const m = HEX.exec(color.trim())
    if (!m) throw new Error(`not a hex color: ${color}`)
    const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

export const MixColor = defineFunction({
    name: 'MixColor',
    description:
        'The hex color a fraction t of the way from one hex color to another, e.g. @MixColor("#ffffff", "#0285ff", 0.5) for a heatmap or a tint',
    params: z.object({ from: z.string(), to: z.string(), t: z.number() }),
    returns: z.string(),
    fn: ({ from, to, t }) => {
        const a = channels(from)
        const b = channels(to)
        // t 夹在 [0, 1]：越界不抛错，直接取端点
        const k = Math.min(1, Math.max(0, t))
        return `#${a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('')}`
    },
})

export const colorFunctions = [MixColor]
