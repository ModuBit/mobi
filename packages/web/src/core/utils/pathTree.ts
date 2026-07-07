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
