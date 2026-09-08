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
import { inferToolRow, FILE_BEARING_TOOLS } from '@/core/lib/toolRow'
import type { SessionMetadataSummary } from '@/core/data/api/types'

const metadata = { path: '/home/u/proj' } as SessionMetadataSummary

describe('inferToolRow：跳转类工具（file/open 可点击）', () => {
    it('Read：chip 带 file/open URI（path 透传 input 原值），rowMeta 给行号区间', () => {
        const row = inferToolRow('Read', { file_path: '/home/u/proj/src/a.ts', offset: 9, limit: 40 }, metadata)
        expect(row?.verb).toBe('Read')
        expect(row?.chip?.text).toBe('src/a.ts')
        expect(row?.chip?.uri).toContain('mobi://file/open?')
        expect(row?.chip?.uri).toContain(encodeURIComponent('/home/u/proj/src/a.ts'))
        expect(row?.rowMeta).toBe('L10–49')
        expect(row?.stats).toBeNull()
    })

    it('Read：无 offset 时 rowMeta 为空', () => {
        const row = inferToolRow('Read', { file_path: '/home/u/proj/src/a.ts' }, metadata)
        expect(row?.rowMeta).toBeNull()
    })

    it('Edit：chip 可点击，stats 由 old/new 行数静态推算', () => {
        const row = inferToolRow('Edit', {
            file_path: '/home/u/proj/src/b.ts',
            old_string: 'a\nb\nc',
            new_string: 'a\nx\ny\nz',
        }, metadata)
        expect(row?.chip?.uri).toContain('mobi://file/open')
        expect(row?.stats).toEqual({ add: 4, del: 3 })
    })

    it('MultiEdit：stats 汇总 edits 数组，rowMeta 给编辑数', () => {
        const row = inferToolRow('MultiEdit', {
            file_path: '/home/u/proj/src/c.ts',
            edits: [
                { old_string: 'a\nb', new_string: 'x' },
                { old_string: 'c', new_string: 'y\nz' },
            ],
        }, metadata)
        expect(row?.rowMeta).toBe('2 edits')
        expect(row?.stats).toEqual({ add: 3, del: 3 })
    })

    it('Write：chip 可点击，stats 全计为新增', () => {
        const row = inferToolRow('Write', { file_path: '/home/u/proj/src/d.ts', content: 'a\nb\n' }, metadata)
        expect(row?.chip?.uri).toContain('mobi://file/open')
        expect(row?.stats).toEqual({ add: 3, del: 0 })
    })

    it('cwd 内绝对路径 chip 文本显示为相对项目根', () => {
        const row = inferToolRow('Edit', { file_path: '/home/u/proj/src/e.ts' }, metadata)
        expect(row?.chip?.text).toBe('src/e.ts')
    })

    it('cwd 外路径 chip 文本原样显示，URI 仍透传原值', () => {
        const row = inferToolRow('Edit', { file_path: '/etc/hosts' }, metadata)
        expect(row?.chip?.text).toBe('/etc/hosts')
        expect(row?.chip?.uri).toContain(encodeURIComponent('/etc/hosts'))
    })
})

describe('inferToolRow：纯展示 chip（不可点击）', () => {
    it('Bash：command 用 chip 形态但无 URI，description 收进 summary 不丢', () => {
        const row = inferToolRow('Bash', { command: 'bun run test:web' }, metadata, '跑测试')
        expect(row?.chip).toEqual({ text: 'bun run test:web' })
        expect(row?.chip?.uri).toBeUndefined()
        expect(row?.summary).toBe('跑测试')
    })

    it('Bash：无 description 时 summary 为空', () => {
        const row = inferToolRow('Bash', { command: 'ls' }, metadata)
        expect(row?.summary).toBeNull()
    })

    it('shell_command 与 Bash 同形态', () => {
        const row = inferToolRow('shell_command', { command: 'ls' }, metadata)
        expect(row?.chip).toEqual({ text: 'ls' })
    })

    it('Glob/Grep：pattern 纯展示', () => {
        expect(inferToolRow('Glob', { pattern: '**/*.ts' }, metadata)?.chip).toEqual({ text: '**/*.ts' })
        expect(inferToolRow('Grep', { pattern: 'TODO' }, metadata)?.chip).toEqual({ text: 'TODO' })
    })
})

describe('inferToolRow：不参与新形态的工具', () => {
    it('Agent/Task 类返回 null（维持现状渲染）', () => {
        expect(inferToolRow('Task', { prompt: 'x' }, metadata)).toBeNull()
        expect(inferToolRow('Agent', { description: 'x' }, metadata)).toBeNull()
    })

    it('无 chip 信息可提取时返回 null', () => {
        expect(inferToolRow('Bash', {}, metadata)).toBeNull()
    })

    it('跳转类工具缺 file_path 时返回 null', () => {
        expect(inferToolRow('Edit', { old_string: 'a' }, metadata)).toBeNull()
    })
})

describe('FILE_BEARING_TOOLS', () => {
    it('白名单恰为四件套', () => {
        expect(FILE_BEARING_TOOLS).toEqual(['Read', 'Edit', 'MultiEdit', 'Write'])
    })
})
