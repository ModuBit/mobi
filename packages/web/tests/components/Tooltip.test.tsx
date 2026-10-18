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

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Tooltip } from '@/ui/base/interactive/tooltip/Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
    it('hover 不打开（打开态只由受控 open 决定）', () => {
        const { rerender } = render(
            <Tooltip open={false} content={<span>提示内容</span>}>
                <button type="button">触发</button>
            </Tooltip>,
        )
        const trigger = screen.getByRole('button', { name: '触发' })
        fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
        expect(screen.queryByText('提示内容')).not.toBeInTheDocument()

        rerender(
            <Tooltip open content={<span>提示内容</span>}>
                <button type="button">触发</button>
            </Tooltip>,
        )
        expect(screen.getByText('提示内容')).toBeInTheDocument()
    })

    it('字符串内容走尺寸动画容器，data-state 与方位落到浮层', async () => {
        render(
            <Tooltip open side="right" align="start" content="纯文本">
                <button type="button">触发</button>
            </Tooltip>,
        )
        // 字符串内容同时渲染测量层与可视层，取第一个
        const content = (await screen.findAllByText('纯文本'))[0]
        const bubble = content.closest('[data-state]') as HTMLElement
        expect(bubble).toBeTruthy()
        expect(bubble.dataset.state).toMatch(/open$/)
        expect(bubble.dataset.side).toBe('right')
        expect(bubble.dataset.align).toBe('start')
    })
})
