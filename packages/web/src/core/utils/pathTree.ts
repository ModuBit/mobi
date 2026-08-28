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

import type { FileNode } from '@/core/data/api/types'

/** 嵌套文件节点（buildPathTree 产物：虚拟目录 + 真实文件叶子） */
export type NestedFileNode = FileNode & { children?: NestedFileNode[] }

/**
 * 把扁平的 FileNode[]（每个含完整 path）重建为嵌套树。
 * 文件树筛选框用：搜索结果扁平返回，UI 需按目录层级展示。
 *
 * - 相同目录前缀合并（src/a、src/b → src 下两个叶子）
 * - 中间目录是「虚拟」节点：无 size/modified（仅 path 推导，非真实 stat）
 * - 文件叶子保留原 FileNode 的全部元信息（size/modified）
 * - 保持插入顺序（不排序，交由调用方决定）
 * - 空输入返回 []
 */
export function buildPathTree(files: FileNode[]): NestedFileNode[] {
    const root: NestedFileNode = { name: '', path: '', type: 'directory', children: [] }
    const dirIndex = new Map<string, NestedFileNode>()
    dirIndex.set('', root)

    for (const f of files) {
        const parts = f.path.split('/')
        let cur = root
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            if (!part) continue
            const fullPath = parts.slice(0, i + 1).join('/')
            const isLeaf = i === parts.length - 1

            if (isLeaf) {
                cur.children = cur.children ?? []
                cur.children.push({ ...f, name: part, path: fullPath })
            } else {
                let dir = dirIndex.get(fullPath)
                if (!dir) {
                    dir = { name: part, path: fullPath, type: 'directory', children: [] }
                    dirIndex.set(fullPath, dir)
                    cur.children = cur.children ?? []
                    cur.children.push(dir)
                }
                cur = dir
            }
        }
    }

    return root.children ?? []
}

/**
 * 收集嵌套树中所有目录节点的 path（用于 antd Tree expandedKeys 全展开）。
 */
export function collectDirKeys(nodes: NestedFileNode[]): string[] {
    const keys: string[] = []
    const walk = (ns: NestedFileNode[]) => {
        for (const n of ns) {
            if (n.type === 'directory') {
                keys.push(n.path)
                if (n.children) walk(n.children)
            }
        }
    }
    walk(nodes)
    return keys
}

/**
 * 文件路径的祖先目录 key（相对根、由浅到深）：'a/b/c.ts' → ['a', 'a/b']。
 * 文件树「定位当前文件」用：展开这些目录即可露出目标文件。
 * 顶层文件返回 []；绝对路径按相对处理（split 过滤空段，与树内相对 key 语义一致——
 * 若文件真在根外，展开这些 key 只是 no-op，不产生副作用）。
 */
export function ancestorDirKeys(filePath: string): string[] {
    const parts = filePath.split('/').filter(Boolean)
    parts.pop()
    const keys: string[] = []
    let cur = ''
    for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part
        keys.push(cur)
    }
    return keys
}

/** 单行文本宽度估算（px）：13px 字号，CJK/全角近似 13px、其余近似 7px */
function estimateTextWidth(text: string): number {
    let w = 0
    for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 13 : 7
    return w
}

/**
 * 树的最小宽度估算（px）——文件树横向滚动方案的宽度下限。
 *
 * 虚拟滚动只渲染可视行，`min-width: max-content` 仅由已渲染行决定：宽度随纵向滚动
 * 跳变，且未渲染的长名行不贡献宽度、无法预先横向滚到。树数据是全量已知的
 * （虚拟化只裁渲染不裁数据），故按「逐层缩进 + 该层最宽名」做全量估算，保证：
 * - 宽度稳定单调（不随滚动窗口变化）
 * - 不小于绝大多数行的实际宽度（个别估算偏小的行由行内 nowrap 溢出补偿，不会截断）
 *
 * 估算偏大只是多留白（横向滚到空白），无害。
 *
 * searchTreeNodes 必须传 buildPathTree 产物（已合并公共前缀的嵌套树）：
 * 搜索视图渲染深度是合并后的真实深度，若按原始 path 段数算缩进会系统性高估宽度。
 */
export function estimateTreeMinWidth(
    rootEntries: { name: string }[] | undefined,
    dirEntries: Record<string, { entries: { name: string }[] } | undefined>,
    searchTreeNodes: NestedFileNode[],
): number {
    const INDENT_UNIT = 16
    const NODE_EXTRA = 76 // 图标 + switcher + 内边距
    let max = 0
    const consider = (depth: number, entries?: { name: string }[]) => {
        if (!entries) return
        for (const e of entries) {
            max = Math.max(max, depth * INDENT_UNIT + NODE_EXTRA + estimateTextWidth(e.name))
        }
    }
    consider(0, rootEntries)
    for (const [path, meta] of Object.entries(dirEntries)) {
        if (!meta || path === '.') continue
        consider(path.split('/').length, meta.entries)
    }
    const walkSearch = (nodes: NestedFileNode[], depth: number) => {
        for (const n of nodes) {
            max = Math.max(max, depth * INDENT_UNIT + NODE_EXTRA + estimateTextWidth(n.name))
            if (n.children) walkSearch(n.children, depth + 1)
        }
    }
    walkSearch(searchTreeNodes, 0)
    return Math.ceil(max)
}
