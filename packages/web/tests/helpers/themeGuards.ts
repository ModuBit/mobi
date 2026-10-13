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
 * 主题守卫测试的共享脚手架（配色 / 圆角两个守卫都用）：读 DESIGN.md 的 frontmatter 块、
 * 遍历 src 下的源文件。此前这两段在每个守卫里各抄一份，加一个守卫就再抄一遍。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** packages/web（本文件在 tests/helpers/ 下，向上两级即包根） */
export const WEB_ROOT = resolve(here, '../..')

/** DESIGN.md 全文（规格侧的唯一文本） */
export const DESIGN_MD = readFileSync(resolve(WEB_ROOT, 'DESIGN.md'), 'utf-8')

/**
 * 取 frontmatter 里某个块的行（缩进即块边界；正则解析，不引入 yaml 依赖）。
 * 块内怎么解析由各守卫自便（色值是带引号的字符串、档位是 px 数值），这里只管切块。
 */
export function readDesignBlock(block: string): string[] {
    const match = DESIGN_MD.match(new RegExp(`^${block}:\\n((?:[ \\t].*\\n)+)`, 'm'))
    if (!match) throw new Error(`DESIGN.md frontmatter 缺少 ${block} 块`)
    return match[1]!.split('\n')
}

/** 递归列出目录下的源码文件（.ts / .tsx / .css）——守卫扫字面量用 */
export function collectSourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full))
        else if (/\.(ts|tsx|css)$/.test(entry)) out.push(full)
    }
    return out
}
