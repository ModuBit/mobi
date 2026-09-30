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
 * turn-diff 自定义事件渲染链（ADR 0008）：CustomBlockView 对 custom-event 的二级路由、
 * 轮次变更卡呈现（头部摘要/默认铺开清单/展开收起/rename 呈现）、未注册事件跳过、
 * shared 事件名 ↔ web 渲染注册表的一致性 lock。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string, opts?: { count?: number }) =>
            k === 'chat.turnDiff.filesEdited' ? `已编辑 ${opts?.count} 个文件`
            : k === 'chat.turnDiff.showMoreFiles' ? `再显示 ${opts?.count} 个文件`
            : k }),
    }
})

import { CustomBlockView, CUSTOM_EVENT_VIEWS } from '@/components/chat/blocks/CustomBlock'
import { TurnDiffCard } from '@/components/chat/blocks/TurnDiffCard'
import type { CustomBlock } from '@/domain/chat/types'
import { TURN_DIFF_EVENT, type TurnDiffPayload } from '@mobi/shared'

afterEach(cleanup)

const PAYLOAD: TurnDiffPayload = {
    turnIndex: 3,
    baseTurnIndex: 2,
    stats: { files: 3, additions: 9, deletions: 4 },
    files: [
        { path: 'src/deep/a.ts', kind: 'modify', additions: 5, deletions: 3 },
        { path: 'new.ts', kind: 'add', additions: 4, deletions: 0 },
        { path: 'renamed.ts', kind: 'rename', additions: 0, deletions: 1, previousPath: 'old.ts' },
    ],
    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40) },
}

/** 超出预览条数（3）的载荷：6 个文件，用于展开/收起断言 */
const OVERFLOW_PAYLOAD: TurnDiffPayload = {
    ...PAYLOAD,
    stats: { files: 6, additions: 12, deletions: 5 },
    files: [...PAYLOAD.files, ...PAYLOAD.files.map((f, i) => ({ ...f, path: `more/${i}.ts` }))],
}

function makeCustomBlock(blocks: CustomBlock['blocks']): CustomBlock {
    return { kind: 'custom', id: 'custom-1', localId: null, createdAt: 1000, blocks }
}

describe('turn-diff 渲染链', () => {
    it('一致性 lock：shared 事件名常量已注册渲染视图（新增 custom-event name 必须同步注册）', () => {
        expect(CUSTOM_EVENT_VIEWS[TURN_DIFF_EVENT]).toBeDefined()
    })

    it('头部摘要 + 清单默认铺开（不超 3 条时全显、无展开开关；A 徽标、rename 旧名、计数）', () => {
        render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: PAYLOAD }])} />)

        const card = screen.getByTestId('turn-diff-card')
        expect(card.textContent).toContain('已编辑 3 个文件')
        expect(card.textContent).toContain('+9')
        expect(card.textContent).toContain('-4')
        const rows = screen.getAllByTestId('turn-diff-file')
        expect(rows).toHaveLength(3)
        expect(rows[0]!.textContent).toContain('a.ts')
        expect(rows[0]!.textContent).toContain('src/deep/')
        expect(rows[0]!.textContent).toContain('M') // modify 也占徽标
        expect(rows[1]!.textContent).toContain('A') // add 徽标
        expect(rows[2]!.textContent).toContain('old.ts') // rename 旧名
        expect(rows[2]!.textContent).toContain('+0')
        expect(screen.queryByTestId('turn-diff-toggle')).toBeNull()
    })

    it('超出 3 条默认收起（aria-hidden），展开开关切换双向（动画用 grid 过渡，行常驻 DOM）', () => {
        render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: OVERFLOW_PAYLOAD }])} />)

        expect(screen.getByTestId('turn-diff-overflow').getAttribute('aria-hidden')).toBe('true')
        fireEvent.click(screen.getByTestId('turn-diff-toggle'))
        expect(screen.getByTestId('turn-diff-overflow').getAttribute('aria-hidden')).toBe('false')
        fireEvent.click(screen.getByTestId('turn-diff-toggle'))
        expect(screen.getByTestId('turn-diff-overflow').getAttribute('aria-hidden')).toBe('true')
    })

    it('未注册的 custom-event name 跳过不渲染（向前兼容）', () => {
        const { container } = render(<CustomBlockView block={makeCustomBlock([
            { type: 'custom-event', name: 'future-event', value: { any: true } },
        ])} />)
        expect(container.querySelector('[data-testid="turn-diff-card"]')).toBeNull()
    })

    it('「审查」按钮：传入 onReview 即出现（journal 口径无两树指针也出）；点击触发且不展开清单', () => {
        const onReview = vi.fn()
        // 无 sessionId → 无 onReview → 不出按钮
        const { rerender } = render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: OVERFLOW_PAYLOAD }])} />)
        expect(screen.queryByTestId('turn-diff-review')).toBeNull()

        // 卡片级按钮语义直测（CustomBlockView→onReview 的接线单测在 workspaceStore 侧覆盖动作本身）
        rerender(<TurnDiffCard payload={OVERFLOW_PAYLOAD} onReview={onReview} />)
        fireEvent.click(screen.getByTestId('turn-diff-review'))
        expect(onReview).toHaveBeenCalledTimes(1)
        // 点击不触发展开（溢出区保持收起）
        expect(screen.getByTestId('turn-diff-overflow').getAttribute('aria-hidden')).toBe('true')
    })

    it('journal 口径（git: null）同样出「审查」按钮（供数反转后卡片事实源是归档，审查 turn 档可达）', () => {
        render(<TurnDiffCard payload={{ ...PAYLOAD, git: null }} onReview={() => {}} />)
        expect(screen.getByTestId('turn-diff-review')).toBeTruthy()
        // ≈ 近似标记随快照链退役：journal 内容对是精确统计，不再打「近似」标
        expect(screen.queryByTitle('chat.turnDiff.approximate')).toBeNull()
    })
})
