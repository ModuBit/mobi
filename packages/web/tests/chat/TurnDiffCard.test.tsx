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
 * 轮次变更卡呈现（摘要/展开/文件行/rename 呈现）、未注册事件跳过、shared 事件名 ↔
 * web 渲染注册表的一致性 lock。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string, opts?: { count?: number }) =>
            k === 'chat.turnDiff.filesEdited' ? `已编辑 ${opts?.count} 个文件` : k }),
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

function makeCustomBlock(blocks: CustomBlock['blocks']): CustomBlock {
    return { kind: 'custom', id: 'custom-1', localId: null, createdAt: 1000, blocks }
}

describe('turn-diff 渲染链', () => {
    it('一致性 lock：shared 事件名常量已注册渲染视图（新增 custom-event name 必须同步注册）', () => {
        expect(CUSTOM_EVENT_VIEWS[TURN_DIFF_EVENT]).toBeDefined()
    })

    it('折叠态摘要：文案 + 总统计；展开后逐文件呈现（A 徽标、rename 旧名、计数）', () => {
        render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: PAYLOAD }])} />)

        const card = screen.getByTestId('turn-diff-card')
        expect(card.textContent).toContain('已编辑 3 个文件')
        expect(card.textContent).toContain('+9')
        expect(card.textContent).toContain('-4')
        expect(screen.queryByTestId('turn-diff-file')).toBeNull()

        fireEvent.click(screen.getByTestId('turn-diff-toggle'))
        const rows = screen.getAllByTestId('turn-diff-file')
        expect(rows).toHaveLength(3)
        expect(rows[0]!.textContent).toContain('a.ts')
        expect(rows[0]!.textContent).toContain('src/deep/')
        expect(rows[1]!.textContent).toContain('A') // add 徽标
        expect(rows[2]!.textContent).toContain('old.ts') // rename 旧名
        expect(rows[2]!.textContent).toContain('+0')
    })

    it('再点折叠开关收起清单', () => {
        render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: PAYLOAD }])} />)
        fireEvent.click(screen.getByTestId('turn-diff-toggle'))
        expect(screen.getAllByTestId('turn-diff-file')).toHaveLength(3)
        fireEvent.click(screen.getByTestId('turn-diff-toggle'))
        expect(screen.queryByTestId('turn-diff-file')).toBeNull()
    })

    it('未注册的 custom-event name 跳过不渲染（向前兼容）', () => {
        const { container } = render(<CustomBlockView block={makeCustomBlock([
            { type: 'custom-event', name: 'future-event', value: { any: true } },
        ])} />)
        expect(container.querySelector('[data-testid="turn-diff-card"]')).toBeNull()
    })

    it('「审核」按钮：git 模式且传入 onReview 才出现；点击触发且不触发折叠', () => {
        const onReview = vi.fn()
        // 无 sessionId → 无 onReview → 不出按钮
        const { rerender } = render(<CustomBlockView block={makeCustomBlock([{ type: 'custom-event', name: TURN_DIFF_EVENT, value: PAYLOAD }])} />)
        expect(screen.queryByTestId('turn-diff-review')).toBeNull()

        // 卡片级按钮语义直测（CustomBlockView→onReview 的接线单测在 workspaceStore 侧覆盖动作本身）
        rerender(<TurnDiffCard payload={PAYLOAD} onReview={onReview} />)
        fireEvent.click(screen.getByTestId('turn-diff-review'))
        expect(onReview).toHaveBeenCalledTimes(1)
        // 点击不触发展开（阻断冒泡）
        expect(screen.queryByTestId('turn-diff-file')).toBeNull()
    })

    it('近似口径（git: null）不出「审核」按钮（无两树指针可查）', () => {
        render(<TurnDiffCard payload={{ ...PAYLOAD, git: null }} onReview={() => {}} />)
        expect(screen.queryByTestId('turn-diff-review')).toBeNull()
    })
})
