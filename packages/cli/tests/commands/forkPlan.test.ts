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
 * `mobi fork` 的选择规则与 spawn 参数契约（tui-fork 票 01/02）。
 * 只锁对外决策：选中谁、传给 claude 什么；不触碰数据库与进程。
 */

import { describe, expect, it } from 'vitest'
import type { ForkableSession } from '@mobi/shared'
import { buildForkSpawnArgs, filterSessions, formatClaudeExitError, formatSessionLine, planFork, shortSessionId } from '@/commands/forkPlan'

function session(overrides: Partial<ForkableSession> & { id: string }): ForkableSession {
    return {
        title: null,
        path: `/work/${overrides.id}`,
        nativeSessionId: `native-${overrides.id}`,
        updatedAt: 1000,
        status: 'dormant',
        ...overrides
    }
}

describe('planFork', () => {
    it('空列表 → empty', () => {
        expect(planFork([])).toEqual({ kind: 'empty' })
    })

    it('未给 query → 最近活跃的一条（与输入顺序无关）', () => {
        const older = session({ id: 'older', updatedAt: 100 })
        const newer = session({ id: 'newer', updatedAt: 900 })

        const plan = planFork([older, newer])
        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('newer')
    })

    it('按 mobi session id 精确匹配', () => {
        const target = session({ id: 'target', updatedAt: 10 })
        const plan = planFork([session({ id: 'other', updatedAt: 900 }), target], 'target')

        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('target')
    })

    it('按 mobi 短 id 前缀匹配', () => {
        const target = session({ id: '12345678-aaaa-bbbb', updatedAt: 10 })
        const plan = planFork([session({ id: 'other', updatedAt: 900 }), target], '12345678')

        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('12345678-aaaa-bbbb')
    })

    it('前缀多命中 → ambiguous 且按时间倒序', () => {
        const older = session({ id: 'abcd1111-x', updatedAt: 10 })
        const newer = session({ id: 'abcd2222-y', updatedAt: 20 })
        const plan = planFork([older, newer], 'abcd')

        expect(plan.kind).toBe('ambiguous')
        if (plan.kind === 'ambiguous') expect(plan.matches.map(s => s.id)).toEqual([newer.id, older.id])
    })

    it('按标题精确匹配', () => {
        const target = session({ id: 'target', title: '修复登录', updatedAt: 10 })
        const plan = planFork([session({ id: 'other', title: '别的', updatedAt: 900 }), target], '修复登录')

        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('target')
    })

    it('按标题包含匹配（大小写不敏感）', () => {
        const target = session({ id: 'target', title: 'Fix Login Flow', updatedAt: 10 })
        const plan = planFork([target], 'login')

        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('target')
    })

    it('未命中 → not-found 并回带 query', () => {
        expect(planFork([session({ id: 'a' })], '不存在')).toEqual({
            kind: 'not-found',
            query: '不存在',
            nativeIdLike: false
        })
    })

    it('UUID 形状未命中时标记 nativeIdLike，供命令层给出方向性提示', () => {
        const plan = planFork(
            [session({ id: 'a' })],
            '123e4567-e89b-12d3-a456-426614174000'
        )
        expect(plan.kind).toBe('not-found')
        if (plan.kind === 'not-found') expect(plan.nativeIdLike).toBe(true)
    })

    it('无 native id 的行（Claude 会话未就绪）排除出候选：fork 无 --resume 目标无意义', () => {
        const notReady = session({ id: 'pending', nativeSessionId: null, updatedAt: 900 })
        const ready = session({ id: 'ready', updatedAt: 100 })

        // 全部未就绪 → empty（不是把不可 fork 的行当「最近活跃」解析出去）
        expect(planFork([notReady])).toEqual({ kind: 'empty' })

        // 混合列表 → 只在就绪行里解析
        const plan = planFork([notReady, ready])
        expect(plan.kind).toBe('resolved')
        if (plan.kind === 'resolved') expect(plan.session.id).toBe('ready')
    })
})

describe('filterSessions', () => {
    it('按标题、工作区路径或 id 前缀过滤；空关键字返回全部', () => {
        const byTitle = session({ id: 'a', title: '修复登录', path: '/repo/one' })
        const byPath = session({ id: 'bbbb2222', title: '别的', path: '/repo/billing' })

        expect(filterSessions([byTitle, byPath], '登录').map(s => s.id)).toEqual(['a'])
        expect(filterSessions([byTitle, byPath], 'billing').map(s => s.id)).toEqual(['bbbb2222'])
        expect(filterSessions([byTitle, byPath], 'bbbb').map(s => s.id)).toEqual(['bbbb2222'])
        expect(filterSessions([byTitle, byPath], '')).toHaveLength(2)
    })
})

describe('buildForkSpawnArgs', () => {
    it('续接原上下文并生成新 session，不注入任何 mobi 参数', () => {
        expect(buildForkSpawnArgs('native-123')).toEqual(['--resume', 'native-123', '--fork-session'])
    })
})

describe('formatSessionLine', () => {
    it('native id 未就绪的行标注不可接续，避免用户拿着列表行去 fork 落空', () => {
        const line = formatSessionLine(session({ id: 'pending', nativeSessionId: null }), 0)
        expect(line).toContain('不可接续（Claude 会话未就绪）')
    })

    it('就绪行不出现不可接续标注', () => {
        const line = formatSessionLine(session({ id: 'ready' }), 0)
        expect(line).not.toContain('不可接续')
    })
})

describe('formatClaudeExitError', () => {
    it('正常退出带 code', () => {
        expect(formatClaudeExitError(1, null)).toBe('Claude exited with code 1')
    })

    it('信号终止保留信号名，不退化为「exited with code null」（发现 D）', () => {
        expect(formatClaudeExitError(null, 'SIGKILL')).toBe('Claude terminated by signal SIGKILL')
        expect(formatClaudeExitError(null, 'SIGTERM')).toContain('SIGTERM')
    })
})

describe('shortSessionId', () => {
    it('取前 8 位', () => {
        expect(shortSessionId('12345678-abcdef')).toBe('12345678')
    })
})
