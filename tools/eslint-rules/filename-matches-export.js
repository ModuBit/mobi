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
 * filename-matches-export 规则（ui 治理：文件命名规范机器化）
 *
 * 规范：**文件名跟随文件的主导出物**（见 docs/conventions/web.md「文件命名」节）——
 * 只导出组件的文件用 PascalCase，含非组件导出（hook / 工具 / 常量表 / 插件）的
 * 文件用 camelCase。
 *
 * 判定方式不猜「是不是组件」，只看**顶层值导出名**（function / const / let / class /
 * default，排除 `export type` / `export interface`——类型名天然 PascalCase，会误判）：
 *
 *   1. 文件名 == 某个 PascalCase 值导出名 → 组件文件 ✓（组件文件必须与组件同名）
 *   2. 文件名为 camelCase → 模块文件 ✓（hook / 工具 / 常量表 / 多组件模块）
 *   3. 其余（PascalCase 孤儿名、kebab-case、其他形态）→ 报
 *
 * 这条判据不需要区分「混合文件」：`Markdown.tsx` 附带 `MARKDOWN_STREAMING_CONFIG`
 * 常量、`PageHeader.tsx` 附带 `HeaderLeft/HeaderRight` 子组件、`present.tsx` 导出
 * 两个组件——只要文件名命中第 1 或第 2 条即合规。SCREAMING_SNAKE 常量不参与判据
 * （它是伴随物而非导出主体）。
 *
 * 白名单（不检查）：`index` / `main` / `router` / `dev` 等约定名、`_` 前缀的聚合
 * 模块（`_all.tsx` / `_results.tsx`）、`*.generated.*` 生成文件、`src/ui/shadcn/**`
 * registry 上游组件（改名会让 add --overwrite 升级全乱）。
 */
'use strict'

/** 组件形态：PascalCase 标识符（不含下划线与连字符） */
const PASCAL = /^[A-Z][A-Za-z0-9]*$/
/** 模块形态：camelCase 标识符 */
const CAMEL = /^[a-z][A-Za-z0-9]*$/
/** 模块形态：SCREAMING_SNAKE 常量 */
const SCREAMING = /^[A-Z][A-Z0-9_]*$/

/** 约定俗成的文件名（小写，不参与大小写校验） */
const CONVENTION_BASENAMES = new Set(['index', 'main', 'router', 'dev'])

/** 文件名去扩展名（保留多段后缀，如 `mobileMenu.styles` → `mobileMenu.styles`） */
function basenameStem(filename) {
    const basename = filename.split('/').pop() || ''
    return basename.replace(/\.(tsx?|css)$/, '')
}

/** 取文件名的首段（`mobileMenu.styles` → `mobileMenu`） */
function fileStem(filename) {
    return basenameStem(filename).split('.')[0]
}

/** 该文件是否豁免校验 */
function isExempt(filename) {
    // registry 上游组件：命名跟随上游，本地改名会让 add --overwrite 升级全乱
    if (filename.includes('/src/ui/shadcn/')) return true
    const stem = basenameStem(filename)
    if (CONVENTION_BASENAMES.has(stem)) return true
    // `_` 前缀：聚合/注册表模块约定（_all / _results）
    if (stem.startsWith('_')) return true
    // 生成文件：命名照生成器
    if (stem.endsWith('.generated')) return true
    return false
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: '文件名大小写必须与文件主导出物一致（组件 PascalCase / 模块 camelCase）',
        },
        schema: [],
    },
    create(context) {
        const filename = (context.filename || context.getFilename()).replace(/\\/g, '/')
        if (!/\.(ts|tsx)$/.test(filename) || isExempt(filename)) return {}

        /** 顶层值导出的标识符名（匿名 default 用哨兵，视同组件） */
        const exported = []

        return {
            ExportNamedDeclaration(node) {
                // 类型导出不算：export type / export interface 的名字天然 PascalCase
                if (node.exportKind === 'type') return
                const decl = node.declaration
                if (decl) {
                    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
                        exported.push(decl.id.name)
                    } else if (decl.type === 'VariableDeclaration') {
                        for (const d of decl.declarations) {
                            if (d.id.type === 'Identifier') exported.push(d.id.name)
                        }
                    }
                }
                for (const spec of node.specifiers || []) {
                    if (spec.type === 'ExportSpecifier') {
                        exported.push((spec.exported || spec.local).name)
                    }
                }
            },
            ExportDefaultDeclaration(node) {
                const decl = node.declaration
                // export default Foo（标识符）或 export default function Foo()（具名）
                if (decl.type === 'Identifier') exported.push(decl.name)
                else if (decl.id && decl.id.name) exported.push(decl.id.name)
                // 匿名 default（export default () => <div/>）无名字线索，视同组件侧占位
                else exported.push('__anonymous_default__')
            },
            'Program:exit'() {
                // 只有匿名 default 的文件无从判定（没有可对齐的名字）——跳过
                const named = exported.filter((n) => n !== '__anonymous_default__')
                if (named.length === 0) return
                const stem = fileStem(filename)
                // 1. 文件名 == 某个 PascalCase 值导出名 → 组件文件（SCREAMING 常量不参与）
                const pascalExports = named.filter((n) => PASCAL.test(n) && !SCREAMING.test(n))
                if (pascalExports.includes(stem)) return
                // 2. camelCase 文件名 → 模块文件（hook / 工具 / 常量表 / 多组件模块）
                if (CAMEL.test(stem)) return
                // 3. 其余形态报错
                if (PASCAL.test(stem)) {
                    context.report({
                        node: context.sourceCode.ast,
                        message: `文件名「${stem}」不与任何导出同名（本文件导出：${pascalExports.join(' / ') || '无 PascalCase 值导出'}）——组件文件须与组件同名，否则按模块改为 camelCase。命名规范见 docs/conventions/web.md「文件命名」节`,
                    })
                } else {
                    context.report({
                        node: context.sourceCode.ast,
                        message: `文件名「${stem}」既非组件名（PascalCase，须与导出组件同名）也非 camelCase——模块文件用 camelCase，目录用 kebab-case。命名规范见 docs/conventions/web.md「文件命名」节`,
                    })
                }
            },
        }
    },
}
