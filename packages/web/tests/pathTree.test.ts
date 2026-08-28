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
import { buildPathTree } from '@/core/utils/pathTree'
import type { FileNode } from '@/core/data/api/types'

const file = (path: string, extra?: Partial<FileNode>): FileNode => ({
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    type: 'file',
    ...extra,
})

describe('buildPathTree', () => {
    it('根级文件直接挂到根', () => {
        const tree = buildPathTree([file('a.ts')])
        expect(tree).toHaveLength(1)
        expect(tree[0]).toMatchObject({ name: 'a.ts', path: 'a.ts', type: 'file' })
        expect(tree[0].children).toBeUndefined()
    })

    it('相同目录前缀合并', () => {
        const tree = buildPathTree([file('src/a.ts'), file('src/b.ts')])
        expect(tree).toHaveLength(1)
        expect(tree[0]).toMatchObject({ name: 'src', path: 'src', type: 'directory' })
        expect(tree[0].children).toHaveLength(2)
        expect(tree[0].children!.map((n) => n.name)).toEqual(['a.ts', 'b.ts'])
    })

    it('多层嵌套目录', () => {
        const tree = buildPathTree([file('src/foo/a.ts')])
        expect(tree[0].name).toBe('src')
        expect(tree[0].children![0].name).toBe('foo')
        expect(tree[0].children![0].children![0]).toMatchObject({ name: 'a.ts', type: 'file' })
    })

    it('不同分支并行', () => {
        const tree = buildPathTree([file('src/a.ts'), file('docs/b.ts')])
        expect(tree.map((n) => n.name)).toEqual(['src', 'docs'])
    })

    it('文件叶子保留元信息（size/modified）', () => {
        const tree = buildPathTree([file('a.ts', { size: 100, modified: 123 })])
        expect(tree[0].size).toBe(100)
        expect(tree[0].modified).toBe(123)
    })

    it('虚拟目录无 size/modified', () => {
        const tree = buildPathTree([file('src/a.ts')])
        expect(tree[0].size).toBeUndefined()
        expect(tree[0].modified).toBeUndefined()
    })

    it('保持插入顺序（不排序）', () => {
        const tree = buildPathTree([file('b.ts'), file('a.ts')])
        expect(tree.map((n) => n.name)).toEqual(['b.ts', 'a.ts'])
    })

    it('空输入返回空数组', () => {
        expect(buildPathTree([])).toEqual([])
    })

    it('目录键收集：collectDirKeys 收集所有目录 path', async () => {
        const { collectDirKeys } = await import('@/core/utils/pathTree')
        const tree = buildPathTree([file('src/foo/a.ts'), file('docs/b.ts')])
        const keys = collectDirKeys(tree)
        expect(keys.sort()).toEqual(['docs', 'src', 'src/foo'].sort())
    })
})

describe('ancestorDirKeys', () => {
    it('深层文件的祖先目录由浅到深', async () => {
        const { ancestorDirKeys } = await import('@/core/utils/pathTree')
        expect(ancestorDirKeys('src/lib/util.ts')).toEqual(['src', 'src/lib'])
    })

    it('顶层文件无祖先，返回空数组', async () => {
        const { ancestorDirKeys } = await import('@/core/utils/pathTree')
        expect(ancestorDirKeys('a.ts')).toEqual([])
    })

    it('绝对路径按相对处理（过滤空段）', async () => {
        const { ancestorDirKeys } = await import('@/core/utils/pathTree')
        expect(ancestorDirKeys('/Users/x/demo/src/a.ts')).toEqual(['Users', 'Users/x', 'Users/x/demo', 'Users/x/demo/src'])
    })

    it('目录路径的末段也视为「文件名」剔除（传目录 key 时返回其祖先）', async () => {
        const { ancestorDirKeys } = await import('@/core/utils/pathTree')
        expect(ancestorDirKeys('src/lib')).toEqual(['src'])
    })
})

describe('estimateTreeMinWidth', () => {
    // 经 FileTreeView 导出：横向滚动的宽度下限估算（纯函数，虚拟滚动宽度稳定性依赖）
    it('取「逐层缩进 + 最宽名」的最大值，深度更深但名短不一定是最大', async () => {
        const { estimateTreeMinWidth } = await import('@/components/files/FileTreeView')
        const w = estimateTreeMinWidth(
            [{ name: 'short.ts' }, { name: 'a-very-long-file-name-in-root.ts' }],
            { deep: { entries: [{ name: 'x' }] } },
            [],
        )
        // 根级最长名行应主导宽度
        const rootLongest = 0 * 16 + 76 + 'a-very-long-file-name-in-root.ts'.length * 7
        expect(w).toBeGreaterThanOrEqual(rootLongest)
        // 深层短名不超根级长名
        expect(w).toBe(Math.ceil(rootLongest))
    })

    it('CJK 文件名按全宽估算（比同长度 ASCII 更宽）', async () => {
        const { estimateTreeMinWidth } = await import('@/components/files/FileTreeView')
        const ascii = estimateTreeMinWidth([{ name: 'a'.repeat(10) }], {}, [])
        const cjk = estimateTreeMinWidth([{ name: '中'.repeat(10) }], {}, [])
        expect(cjk).toBeGreaterThan(ascii)
    })

    it('空数据返回 0（宽度完全交由 max-content 兜底）', async () => {
        const { estimateTreeMinWidth } = await import('@/components/files/FileTreeView')
        expect(estimateTreeMinWidth(undefined, {}, [])).toBe(0)
    })

    it('搜索路径参与估算（按 path 深度缩进 + 末段名宽）', async () => {
        const { estimateTreeMinWidth } = await import('@/components/files/FileTreeView')
        const base = estimateTreeMinWidth([{ name: 'x' }], {}, [])
        const withSearch = estimateTreeMinWidth([{ name: 'x' }], {}, ['a/b/c/very-long-searched-file-name.ts'])
        expect(withSearch).toBeGreaterThan(base)
    })
})
