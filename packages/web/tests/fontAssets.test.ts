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
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 字体子集化体积守卫。
 *
 * Alibaba 普惠体经 scripts/subset-fonts.py 子集化后每字重 ~500KB（GB2312 一级常用字 +
 * ASCII + 希腊 + 数学/标点）。未子集的全量字体每字重 ~1.7MB——若有人更新字体后忘了重跑
 * subset 脚本，全量字体会被静默发布，撤销首屏性能优化。此测试拦住该回归。
 *
 * 子集化脚本是一次性手动操作（pyftsubset 需 Python + fonttools + brotli，不进 bun 构建
 * 依赖），故用体积阈值在 CI test job 兜底，而非构建期强制。若刻意扩大字符集导致超阈，
 * 重跑 scripts/subset-fonts.py 并酌情上调 SUBSET_MAX_BYTES。
 */
const FONT_DIR = resolve(process.cwd(), 'public/fonts/alibaba-puhuiti')
// 子集后 ~502KB；阈值 800KB 留 headroom，同时能拦住 1.7MB 全量字体
const SUBSET_MAX_BYTES = 800 * 1024

describe('Alibaba 普惠体子集化体积守卫', () => {
    const weights = [
        'AlibabaPuHuiTi-3-55-Regular.woff2',
        'AlibabaPuHuiTi-3-65-Medium.woff2',
        'AlibabaPuHuiTi-3-85-Bold.woff2',
    ]

    for (const weight of weights) {
        it(`${weight} 已子集化（< 800KB；未子集全量 ~1.7MB 会被拦）`, () => {
            const size = statSync(`${FONT_DIR}/${weight}`).size
            expect(
                size,
                `${weight} 体积 ${(size / 1024).toFixed(0)}KB 超过子集阈值 800KB——` +
                    `疑似更新字体后未跑 scripts/subset-fonts.py，全量字体会被静默发布`,
            ).toBeLessThan(SUBSET_MAX_BYTES)
        })
    }
})
