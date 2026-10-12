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
 * no-duplicate-registry-component 规则（shadcn 底座票 04）
 *
 * 同一语义组件在 registry 组件目录中只允许一份实现：shadcn/ 与 arc/ 两个
 * registry 根下的顶层组件目录名不得重复（如 shadcn/button 与 arc/button
 * 并存 = Button 双来源，选型漂移的开始）。替换迁移必须先删旧实现再登记新来源。
 * 规范见 docs/conventions/web.md「组件选型」章。
 */
'use strict'

const fs = require('fs')
const path = require('path')

// registry 根目录（相对 packages/web/），新增 registry 落位时扩充
const REGISTRY_ROOTS = ['src/ui/shadcn', 'src/ui/arc']
const WEB_PREFIX = 'packages/web/'

/** 提取文件所属的 registry 根与顶层组件目录名；不在 registry 内返回 null */
function locateRegistryComponent(normalizedPath) {
    for (const root of REGISTRY_ROOTS) {
        const marker = WEB_PREFIX + root + '/'
        const idx = normalizedPath.indexOf(marker)
        if (idx !== -1) {
            const comp = normalizedPath.slice(idx + marker.length).split('/')[0]
            if (comp) return { root, comp }
        }
    }
    return null
}

/** 列出 registry 根下已有的顶层组件目录名；根不存在返回空集 */
function listComponentDirs(cwd, root) {
    try {
        return fs
            .readdirSync(path.resolve(cwd, WEB_PREFIX, root), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
    } catch {
        return []
    }
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: '同一语义组件禁止在多个 registry 目录中重复实现',
        },
        schema: [],
    },
    create(context) {
        const filePath = (context.filename || context.getFilename()).replace(/\\/g, '/')
        const located = locateRegistryComponent(filePath)
        if (!located) return {}

        return {
            Program(node) {
                // 每个文件独立扫描全目录——eslint 无跨文件状态，重复时相关文件都会报，CI 必红即达目的
                const holders = REGISTRY_ROOTS.filter((root) =>
                    listComponentDirs(context.cwd, root).includes(located.comp),
                )
                if (holders.length < 2) return {}

                context.report({
                    node,
                    message: `组件「${located.comp}」在多个 registry 目录中重复实现（${holders.join(' / ')}）。同一语义组件只允许一份来源：替换迁移须先删旧实现再登记新来源（规范见 docs/conventions/web.md「组件选型」章）`,
                })
            },
        }
    },
}
