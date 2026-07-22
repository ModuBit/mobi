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

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => false,
}))

// 默认收起态（sidebarExpanded=false），SidebarToggle 本应渲染
const mockState = { sidebarExpanded: false, toggleSidebar: vi.fn() }
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}))

vi.mock('@/components/layout/useWindowControlsOverlay', () => ({
    useWco: vi.fn(() => false),
}))

import { useWco } from '@/components/layout/useWindowControlsOverlay'
import { SidebarToggle } from '@/components/layout/SidebarToggle'

describe('SidebarToggle WCO 降级', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => cleanup())

    it('WCO=false + 侧边栏收起 → 渲染展开按钮（现状）', () => {
        vi.mocked(useWco).mockReturnValue(false)
        const { container } = render(<ConfigProvider><SidebarToggle /></ConfigProvider>)
        expect(container.querySelector('button')).not.toBeNull()
    })

    it('WCO=true → 返回 null（标题栏已有收起按钮）', () => {
        vi.mocked(useWco).mockReturnValue(true)
        const { container } = render(<ConfigProvider><SidebarToggle /></ConfigProvider>)
        expect(container.firstChild).toBeNull()
    })
})
