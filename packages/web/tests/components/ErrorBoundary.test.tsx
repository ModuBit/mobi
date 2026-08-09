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
import { render, fireEvent, cleanup } from '@testing-library/react'
import { reloadPage } from '@/core/utils/reload'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

vi.mock('@/core/utils/reload', () => ({
    reloadPage: vi.fn(),
}))

/** render 阶段抛指定错误的子组件（驱动 ErrorBoundary 进入错误态） */
function ThrowOnRender({ error }: { error: Error }) {
    throw error
}

/**
 * ErrorBoundary 懒加载 chunk 失败自愈测试。
 *
 * 路由组件 React.lazy 后，部署漂移（旧 index.html 引用已不存在的 chunk 哈希）会触发
 * dynamic import 失败。此时「仅清 state 重渲染」会再次加载同一失效 chunk → 必然再失败。
 * 正确恢复路径：点 retry → 整页 reload 拉最新 no-cache index.html（含新 chunk 哈希）。
 */
describe('ErrorBoundary — 懒加载 chunk 失败自愈', () => {
    beforeEach(() => {
        vi.mocked(reloadPage).mockReset()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('dynamic import 网络失败 → 点 retry 整页 reload', () => {
        const err = new Error('Failed to fetch dynamically imported module: /assets/oldhash.js')
        const { getByRole } = render(
            <ErrorBoundary>
                <ThrowOnRender error={err} />
            </ErrorBoundary>,
        )
        fireEvent.click(getByRole('button'))
        expect(reloadPage).toHaveBeenCalledTimes(1)
    })

    it('SPA fallback 返回 HTML 致 SyntaxError → 同样 reload', () => {
        const err = new SyntaxError("Unexpected token '<'")
        const { getByRole } = render(
            <ErrorBoundary>
                <ThrowOnRender error={err} />
            </ErrorBoundary>,
        )
        fireEvent.click(getByRole('button'))
        expect(reloadPage).toHaveBeenCalledTimes(1)
    })

    it('普通渲染错误 → retry 仅清 state，不 reload', () => {
        const err = new Error('some render bug')
        const { getByRole } = render(
            <ErrorBoundary>
                <ThrowOnRender error={err} />
            </ErrorBoundary>,
        )
        fireEvent.click(getByRole('button'))
        expect(reloadPage).not.toHaveBeenCalled()
    })
})
