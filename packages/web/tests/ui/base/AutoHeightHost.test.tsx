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
 * 自适应高度宿主的契约：量 shadow 里的内容高 → 收缩到 min(内容高, 上限)，
 * 内容在上限内时把经典滚动条占掉的盒内高度补进去（不补就顶出假竖条）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { AutoHeightHost } from '@/ui/base/layout/AutoHeightHost'

/** 假 web component：内容在 shadow root 里，高度按传入值桩掉 */
function ShadowHost({ contentHeight }: { contentHeight: number }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const el = ref.current!
        // 同一个宿主只能挂一个 shadow root：重渲染只更新桩高度，不重建
        const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
        const box = (shadow.firstElementChild as HTMLElement | null) ?? shadow.appendChild(document.createElement('div'))
        Object.defineProperty(box, 'getBoundingClientRect', {
            value: () => ({ height: contentHeight }) as DOMRect,
            configurable: true,
        })
    }, [contentHeight])
    return <div ref={ref} data-testid="shadow-host" />
}

describe('AutoHeightHost', () => {
    afterEach(cleanup)

    it('高度追上 shadow 内容高；超过上限就封顶（内容自己滚）', async () => {
        const { getByTestId, rerender } = render(
            <AutoHeightHost maxHeightPx={null} contentKey="a" testId="host">
                <ShadowHost contentHeight={137} />
            </AutoHeightHost>,
        )
        const host = getByTestId('host')
        await waitFor(() => expect(host.style.height).toBe('137px'))

        rerender(
            <AutoHeightHost maxHeightPx={320} contentKey="b" testId="host">
                <ShadowHost contentHeight={900} />
            </AutoHeightHost>,
        )
        await waitFor(() => expect(host.style.height).toBe('320px'))
        expect(host.style.maxHeight).toBe('320px')
    })

    it('上限为空 = 不限高（高度仍跟内容走，maxHeight 不落样式）', async () => {
        const { getByTestId } = render(
            <AutoHeightHost maxHeightPx={null} contentKey="a" testId="host">
                <ShadowHost contentHeight={240} />
            </AutoHeightHost>,
        )
        const host = getByTestId('host')
        await waitFor(() => expect(host.style.height).toBe('240px'))
        expect(host.style.maxHeight).toBe('')
    })

    /** BottomSheet 的入场收敛检测靠这个标记判断「高度还不是真实值」——契约不能破 */
    it('量到真实高前挂 data-height-pending，量到后摘除；重新量（contentKey 变）时重挂', async () => {
        const { getByTestId, rerender } = render(
            <AutoHeightHost maxHeightPx={null} contentKey="a" testId="host">
                <ShadowHost contentHeight={120} />
            </AutoHeightHost>,
        )
        const host = getByTestId('host')
        // 挂载即 pending（高度还是估计值）
        expect(host.hasAttribute('data-height-pending')).toBe(true)
        await waitFor(() => expect(host.style.height).toBe('120px'))
        expect(host.hasAttribute('data-height-pending')).toBe(false)

        // 内容变化 → 重新量：先回到 pending，量到后再次摘除
        rerender(
            <AutoHeightHost maxHeightPx={null} contentKey="b" testId="host">
                <ShadowHost contentHeight={260} />
            </AutoHeightHost>,
        )
        expect(host.hasAttribute('data-height-pending')).toBe(true)
        await waitFor(() => expect(host.style.height).toBe('260px'))
        expect(host.hasAttribute('data-height-pending')).toBe(false)
    })
})
