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
 * mentionParser 纯函数单元测试
 * 在重构前补齐，锁定 detectMentionAtCursor / buildMentionPath 现有行为
 */

import { describe, it, expect } from 'vitest'
import { detectMentionAtCursor, buildMentionPath } from '@/domain/command/mentionParser'

// ========== detectMentionAtCursor ==========

describe('detectMentionAtCursor', () => {
    it('单独 @，光标在末尾 → 触发，afterAt 为空', () => {
        expect(detectMentionAtCursor('@', 1)).toEqual({ atIndex: 0, afterAt: '' })
    })

    it('@file，光标在末尾 → 触发', () => {
        expect(detectMentionAtCursor('@file', 5)).toEqual({ atIndex: 0, afterAt: 'file' })
    })

    it('段落中间的 @（前一空格）触发', () => {
        expect(detectMentionAtCursor('foo @bar', 8)).toEqual({ atIndex: 4, afterAt: 'bar' })
    })

    it('换行后的 @ 触发', () => {
        expect(detectMentionAtCursor('foo\n@bar', 8)).toEqual({ atIndex: 4, afterAt: 'bar' })
    })

    it('前导空格的 @ 触发', () => {
        expect(detectMentionAtCursor(' @bar', 5)).toEqual({ atIndex: 1, afterAt: 'bar' })
    })

    it('非独立词的 @ 不触发（@ 前紧邻非空白）', () => {
        expect(detectMentionAtCursor('foo@bar', 7)).toBeNull()
    })

    it('路径式 @（含 / . ~）触发', () => {
        expect(detectMentionAtCursor('@src/sub/file.ts', 17)).toEqual({ atIndex: 0, afterAt: 'src/sub/file.ts' })
        expect(detectMentionAtCursor('@~/x', 4)).toEqual({ atIndex: 0, afterAt: '~/x' })
    })

    it('光标离开 mention 词（后跟空白）不触发', () => {
        expect(detectMentionAtCursor('@foo bar', 8)).toBeNull()
    })

    it('@ 后含非法字符不触发', () => {
        expect(detectMentionAtCursor('@foo(bar)', 10)).toBeNull()
    })

    it('取光标前最近的独立词 @', () => {
        // '@a @b' 光标在末尾：最近的 @ 是 index 3
        expect(detectMentionAtCursor('@a @b', 5)).toEqual({ atIndex: 3, afterAt: 'b' })
    })

    it('无 @ 不触发', () => {
        expect(detectMentionAtCursor('foo bar', 7)).toBeNull()
    })

    it('空字符串不触发', () => {
        expect(detectMentionAtCursor('', 0)).toBeNull()
    })
})

// ========== buildMentionPath ==========

describe('buildMentionPath', () => {
    it('无目录分隔时直接用 selectedName', () => {
        expect(buildMentionPath('src', 'file.ts')).toBe('file.ts')
    })

    it('保留用户输入的目录前缀（以 / 结尾）', () => {
        expect(buildMentionPath('src/', 'file.ts')).toBe('src/file.ts')
    })

    it('取最后一个 / 之前的目录部分', () => {
        expect(buildMentionPath('src/sub', 'file.ts')).toBe('src/file.ts')
    })

    it('多级路径取最后一级目录', () => {
        expect(buildMentionPath('a/b/c', 'd.ts')).toBe('a/b/d.ts')
    })
})
