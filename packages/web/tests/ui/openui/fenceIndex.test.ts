/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * openui fence 身份注解规格（generative-ui 状态持久化票 01）：
 * - annotateOpenuiFences：给完整 openui fence 的 info string 追加文档序 token，
 *   供 anchor 下钻到 fence 级；未闭合 fence（流式中）不编号；同输入幂等
 * - parseFenceIndexToken：从 code 组件的 info string 反解序号；无 token → null
 */

import { describe, it, expect } from 'vitest'
import { annotateOpenuiFences, parseFenceIndexToken, FENCE_INDEX_TOKEN_PREFIX } from '@/ui/openui/fenceIndex'

describe('annotateOpenuiFences', () => {
    it('单个完整 fence → 追加 0 号 token', () => {
        const src = '前言\n\n```openui-lang\nroot = Card([])\n```\n\n后记\n'
        const out = annotateOpenuiFences(src)
        expect(out).toBe('前言\n\n```openui-lang mobi-fence-0\nroot = Card([])\n```\n\n后记\n')
    })

    it('多个 fence 按文档序编号（openui 与 openui-lang 混合）', () => {
        const src = [
            '```openui\na = Button("x")\n```',
            '中间文本',
            '```openui-lang\nb = Button("y")\n```',
        ].join('\n\n')
        const out = annotateOpenuiFences(src)
        expect(out).toContain('```openui mobi-fence-0\n')
        expect(out).toContain('```openui-lang mobi-fence-1\n')
    })

    it('流式未闭合 fence 不编号（避免后续闭合时序号漂移）', () => {
        const src = '```openui-lang\nroot = Card([])\n```\n\n```openui\nx = 1\n'
        const out = annotateOpenuiFences(src)
        expect(out).toBe('```openui-lang mobi-fence-0\nroot = Card([])\n```\n\n```openui\nx = 1\n')
    })

    it('幂等：同输入重扫结果一致（流式 delta 重渲染安全）', () => {
        const src = '```openui-lang\nroot = Card([])\n```'
        expect(annotateOpenuiFences(annotateOpenuiFences(src))).toBe(annotateOpenuiFences(src))
    })

    it('info string 已含额外 token 时追加而非覆盖', () => {
        const src = '```openui-lang foo bar\nroot = Card([])\n```'
        const out = annotateOpenuiFences(src)
        expect(out).toBe('```openui-lang foo bar mobi-fence-0\nroot = Card([])\n```')
    })

    it('非 openui fence 不动', () => {
        const src = '```ts\nconst a = 1\n```\n\n```mermaid\ngraph TD\n```\n'
        expect(annotateOpenuiFences(src)).toBe(src)
    })

    it('fence 内容含伪围栏行（缩进/非行首反引号）不误判', () => {
        const src = '```openui-lang\nroot = Card([])\n// ```openui 假围栏（行中）\n```\n'
        const out = annotateOpenuiFences(src)
        expect(out.match(new RegExp(FENCE_INDEX_TOKEN_PREFIX, 'g'))).toHaveLength(1)
    })

    it('外层非 openui 围栏内的 openui 样行只是内容，不注解（外层围栏上下文追踪）', () => {
        const src = [
            '```markdown',
            '示例：',
            '',
            '```openui',
            'x = 1',
            '```',
            '',
            '如上',
            '```',
            '后记',
        ].join('\n')
        expect(annotateOpenuiFences(src)).toBe(src)
    })

    it('外层围栏未闭合时其内容整体透传（内含 openui 样围栏也不注解）', () => {
        const src = '```markdown\n```openui\nx = 1\n'
        expect(annotateOpenuiFences(src)).toBe(src)
    })

    it('GFM 闭栏长度规则：内容里的短反引号行不闭合 4 反引号 openui fence', () => {
        const body = [
            '示例内嵌：',
            '```ts',
            'const a = 1',
            '```',
            '继续内容',
        ].join('\n')
        const src = '````openui\n' + body + '\n````'
        const out = annotateOpenuiFences(src)
        expect(out).toBe('````openui mobi-fence-0\n' + body + '\n````')
    })

    it('GFM 闭栏长度规则：短反引号行不是闭栏 → fence 保持未闭合不编号', () => {
        const src = '````openui\nx = 1\n```\n更多\n'
        expect(annotateOpenuiFences(src)).toBe(src)
    })
})

describe('parseFenceIndexToken', () => {
    it('从 info string 反解序号', () => {
        expect(parseFenceIndexToken('openui-lang mobi-fence-3')).toBe(3)
        expect(parseFenceIndexToken('openui mobi-fence-0')).toBe(0)
    })

    it('无 token / 非 openui fence → null', () => {
        expect(parseFenceIndexToken('openui-lang')).toBeNull()
        expect(parseFenceIndexToken('ts mobi-fence-2')).toBeNull()
        expect(parseFenceIndexToken(undefined)).toBeNull()
    })

    it('多 token 场景 token 不在首位也能解析', () => {
        expect(parseFenceIndexToken('openui-lang foo mobi-fence-12')).toBe(12)
    })
})
