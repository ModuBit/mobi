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
 * 组件归属注册表一致性守卫（shadcn 底座票 04）：
 * registry.json 是组件归属的唯一机器事实源，本测试守住它与 registry 目录的双向
 * 一致——登记的组件必须真实存在、目录里的组件必须已登记（挡「顺手 add 不走流程」）、
 * 组件名全局唯一（单一来源，与 eslint mobi/no-duplicate-registry-component 互补）。
 * 规范见 docs/conventions/web.md「组件选型」章。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'registry.json'), 'utf8')) as {
    components: Array<{ name: string; source: string; migratedIn: string; localMods?: string[]; note?: string }>
}

const SOURCES = ['shadcn', 'arc'] as const
/** registry 源目录下的共享基建子目录（非组件，不参与登记） */
const INFRA_DIRS = new Set(['lib'])
const sourceRoot = (source: string) => resolve(webRoot, 'src/components', source)

/** 列出某个 registry 源目录下已存在的顶层组件目录；源目录不存在返回空集 */
function listSourceDirs(source: string): string[] {
    const root = sourceRoot(source)
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !INFRA_DIRS.has(e.name))
        .map((e) => e.name)
}

describe('registry.json 组件归属注册表一致性', () => {
    it('登记项字段完整且 source 合法', () => {
        for (const c of registry.components) {
            expect(c.name, `组件名缺失：${JSON.stringify(c)}`).toBeTruthy()
            expect(SOURCES, `source 必须是 ${SOURCES.join('/')}：${c.name}`).toContain(c.source)
            // migratedIn 为迁移标识（commit / 日期 / 票号），登记与实现常在同一提交，不强制 commit hash
            expect(c.migratedIn, `迁移标识缺失：${c.name}`).toBeTruthy()
        }
    })

    it('登记的组件必须真实存在于对应 source 目录', () => {
        for (const c of registry.components) {
            expect(
                existsSync(resolve(sourceRoot(c.source), c.name)),
                `registry.json 登记了 ${c.source}/${c.name}，但目录不存在（先 add 实现再登记）`,
            ).toBe(true)
        }
    })

    it('registry 目录里的组件必须已登记（挡未登记实现）', () => {
        for (const source of SOURCES) {
            for (const name of listSourceDirs(source)) {
                expect(
                    registry.components.some((c) => c.source === source && c.name === name),
                    `发现未登记的组件 ${source}/${name}——走迁移流程后在 registry.json 登记`,
                ).toBe(true)
            }
        }
    })

    it('同一组件名只允许登记一次（单一来源兜底，编辑期由 eslint 规则先行）', () => {
        const names = registry.components.map((c) => c.name)
        expect(new Set(names).size, `组件名重复：${names.join(', ')}`).toBe(names.length)
    })
})
