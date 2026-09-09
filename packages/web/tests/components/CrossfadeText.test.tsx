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
 * CrossfadeText 文案切换动效测试：
 * 文案变化时旧文案以绝对定位叠底淡出、新文案淡入；~200ms 后旧文案移除（定时器清理，jsdom 无 AnimationEvent）
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CrossfadeText } from '@/components/ui/CrossfadeText'

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    cleanup()
})

describe('CrossfadeText', () => {
    it('渲染当前文案', () => {
        render(<CrossfadeText text="正在思考" />)
        expect(screen.getByText('正在思考')).toBeInTheDocument()
    })

    it('文案变化时新旧文案并存（旧淡出新淡入）', () => {
        const { rerender } = render(<CrossfadeText text="正在思考" />)
        rerender(<CrossfadeText text="正在执行命令 bun test" />)

        expect(screen.getByText('正在执行命令 bun test')).toBeInTheDocument()
        // 旧文案在动画期间仍可见（绝对定位叠底，不影响布局）
        expect(screen.getByText('正在思考')).toBeInTheDocument()
    })

    it('文案未变化时不产生旧文案层', () => {
        const { rerender } = render(<CrossfadeText text="相同文案" />)
        rerender(<CrossfadeText text="相同文案" />)
        expect(screen.getAllByText('相同文案')).toHaveLength(1)
    })

    it('淡出时长后旧文案移除', () => {
        const { rerender } = render(<CrossfadeText text="旧文案" />)
        rerender(<CrossfadeText text="新文案" />)
        expect(screen.getByText('旧文案')).toBeInTheDocument()

        act(() => {
            vi.advanceTimersByTime(200)
        })

        expect(screen.queryByText('旧文案')).not.toBeInTheDocument()
        expect(screen.getByText('新文案')).toBeInTheDocument()
    })

    it('连续快速变化：旧层被最新一次切换的旧文案替换，不累积且定时器重置', () => {
        const { rerender } = render(<CrossfadeText text="A" />)
        rerender(<CrossfadeText text="B" />)
        rerender(<CrossfadeText text="C" />)

        expect(screen.getByText('C')).toBeInTheDocument()
        // 旧层只剩 B（被替换），A 不残留
        expect(screen.queryByText('A')).not.toBeInTheDocument()
        expect(screen.getByText('B')).toBeInTheDocument()

        // 第二次切换重置了定时器：150ms（<200，自 B 层起算）时旧层仍在
        act(() => {
            vi.advanceTimersByTime(150)
        })
        expect(screen.getByText('B')).toBeInTheDocument()

        act(() => {
            vi.advanceTimersByTime(50)
        })
        expect(screen.queryByText('B')).not.toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
    })
})
