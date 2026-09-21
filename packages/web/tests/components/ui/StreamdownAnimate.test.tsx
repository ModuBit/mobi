/*
 * Copyright Manerfan
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
 * Streamdown 流式动画契约测试（ticket 08，真实渲染管线）
 *
 * Streamdown 的动画由 isAnimating 门控：开启时 animate rehype 插件给新增文本
 * 打 data-sd-animated 标记 + sd-blurIn 内联动画（keyframes 由 streamdown.css
 * 提供）；关闭后插件退出管线，重渲染即无动画标记——「动画仅流式期间存在」。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamdownView } from '@/components/ui/StreamdownView'

describe('Streamdown 流式动画', () => {
    afterEach(cleanup)

    it('isAnimating 开启：文本带动画标记与 sd-blurIn 内联动画', () => {
        const { container } = render(<StreamdownView content={'你好，流式世界'} isAnimating />)
        const animated = container.querySelectorAll('[data-sd-animated]')
        expect(animated.length).toBeGreaterThan(0)
        const styled = container.innerHTML
        expect(styled).toContain('sd-blurIn')
    })

    it('isAnimating 关闭：无动画标记、无动画内联样式（完成后无残留）', () => {
        const { container } = render(<StreamdownView content={'你好，流式世界'} isAnimating={false} />)
        expect(container.querySelectorAll('[data-sd-animated]')).toHaveLength(0)
        expect(container.innerHTML).not.toContain('sd-blurIn')
    })

    it('流式结束翻转：动画标记随 isAnimating=false 移除', () => {
        const { container, rerender } = render(<StreamdownView content={'你好'} isAnimating />)
        expect(container.querySelectorAll('[data-sd-animated]').length).toBeGreaterThan(0)
        rerender(<StreamdownView content={'你好'} isAnimating={false} />)
        expect(container.querySelectorAll('[data-sd-animated]')).toHaveLength(0)
    })
})
