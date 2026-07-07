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
