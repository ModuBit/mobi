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
 * registry.json 是组件归属的唯一机器事实源，本测试守住它与 registry 落位目录的双向
 * 一致——登记的组件必须真实存在、落位目录里的组件必须已登记（挡「顺手 add 不走流程」）、
 * 组件名全局唯一（单一来源）。
 *
 * registry 组件统一落 `src/ui/shadcn/<组件名>/`（该目录是组件体系名，非来源名），
 * 官方 shadcn / uiarc / beautifului 在路径上无来源差异——来源只记 registry.json 的
 * source 字段（对齐 shadcn 官方模型：注册表命名空间只决定下载源，落盘统一进
 * components.json 的 aliases.ui 目录）。source 之外另记 upstream（与上游的关系：
 * tracked / adopted）——「认领」不改落位目录（落位根由 registry 模型决定），只改这个字段。
 * 规范见 docs/conventions/web.md「组件选型」章。
 *
 * 2026-10-15 起自管件（首批 bottom-sheet / copy-button / dropdown-menu / morph-select，
 * 同日又迁 select / combobox / multi-select）迁落 src/ui/base/interactive/、脱离本表
 * （账本定格于各自迁出 commit）；本守卫继续约束 ui/shadcn/ 落位根与登记表的双向一致
 * （当前为空集）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'registry.json'), 'utf8')) as {
    components: Array<{
        name: string
        source: string
        upstream: string
        migratedIn: string
        localMods?: string[]
        note?: string
    }>
}

const SOURCES = ['shadcn', 'arc'] as const
/** 与上游的关系：tracked 跟上游（升级走 add --overwrite）/ adopted 已认领（不再跑 --overwrite） */
const UPSTREAMS = ['tracked', 'adopted'] as const
/** registry 组件落位根（src/ui/shadcn/<组件名>/） */
const COMPONENT_ROOT = resolve(webRoot, 'src/ui/shadcn')

/** 组件的落位路径 */
const componentPath = (name: string) => resolve(COMPONENT_ROOT, name)

/** 列出落位根下已存在的组件目录 */
function listComponentDirs(): string[] {
    if (!existsSync(COMPONENT_ROOT)) return []
    return readdirSync(COMPONENT_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
}

describe('registry.json 组件归属注册表一致性', () => {
    it('登记项字段完整且 source / upstream 合法', () => {
        for (const c of registry.components) {
            expect(c.name, `组件名缺失：${JSON.stringify(c)}`).toBeTruthy()
            expect(SOURCES, `source 必须是 ${SOURCES.join('/')}：${c.name}`).toContain(c.source)
            expect(
                UPSTREAMS,
                `upstream 必须是 ${UPSTREAMS.join('/')}（tracked 跟上游 / adopted 已认领，判据见 web.md）：${c.name}`,
            ).toContain(c.upstream)
            // migratedIn 为迁移标识（commit / 日期 / 票号），登记与实现常在同一提交，不强制 commit hash
            expect(c.migratedIn, `迁移标识缺失：${c.name}`).toBeTruthy()
        }
    })

    it('登记的组件必须真实存在于 src/ui/shadcn/ 下', () => {
        for (const c of registry.components) {
            expect(
                existsSync(componentPath(c.name)),
                `registry.json 登记了 ${c.name}，但目录 src/ui/shadcn/${c.name}/ 不存在（先 add 实现再登记）`,
            ).toBe(true)
        }
    })

    it('落位目录里的组件必须已登记（挡未登记实现）', () => {
        for (const name of listComponentDirs()) {
            expect(
                registry.components.some((c) => c.name === name),
                `发现未登记的组件 src/ui/shadcn/${name}/——走迁移流程后在 registry.json 登记`,
            ).toBe(true)
        }
    })

    it('同一组件名只允许登记一次（单一来源兜底）', () => {
        const names = registry.components.map((c) => c.name)
        expect(new Set(names).size, `组件名重复：${names.join(', ')}`).toBe(names.length)
    })
})
