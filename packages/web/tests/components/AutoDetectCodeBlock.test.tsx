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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import AutoDetectCodeBlock from '@/components/ui/AutoDetectCodeBlock'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: () => 'dark',
    resolveTheme: (theme: string) => theme,
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

afterEach(cleanup)

describe('AutoDetectCodeBlock（light 高亮）', () => {
    it('显式语言命中注册表 → 渲染 token 着色', async () => {
        const { container } = render(
            <AutoDetectCodeBlock code={'const a = 1'} explicitLang="javascript" />,
            { wrapper },
        )
        // antdx light 模式经 lazy/Suspense 异步切换，等 token 出现
        await waitFor(() => {
            expect(container.querySelectorAll('span.token').length).toBeGreaterThan(0)
        })
    })

    it('未注册的冷门语言降级素码（不抛错、代码文本完整）', () => {
        const { container } = render(
            <AutoDetectCodeBlock code={'λ f. f x'} explicitLang="haskell" />,
            { wrapper },
        )
        expect(container.textContent).toContain('λ f. f x')
    })
})
