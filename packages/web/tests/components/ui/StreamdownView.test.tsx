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
 * StreamdownView 组件测试
 * 验证：components.a 链接分发（mobi:// → ActionLink / 外链 → 新标签页 <a>）/
 * controls 与 lineNumbers 配置透传 / 容器类与外部 className 合并
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// 捕获传给 Streamdown 的 props，并按 components.a 渲染一条链接以验证分发逻辑
const streamdownSpy = vi.hoisted(() => vi.fn())
vi.mock('streamdown', () => ({
    Streamdown: (props: {
        children?: React.ReactNode
        components?: { a?: React.ComponentType<React.AnchorHTMLAttributes<HTMLAnchorElement>> }
        controls?: unknown
        lineNumbers?: boolean
        linkSafety?: unknown
        mode?: string
        isAnimating?: boolean
    }) => {
        streamdownSpy(props)
        const Link = props.components?.a
        return (
            <div data-testid="sd">
                {props.children}
                {Link && (
                    <>
                        <Link href="https://example.com">ext</Link>
                        <Link href="mobi://file/open?path=a.ts">mobi</Link>
                        <Link href="MOBI://file/open?path=a.ts">mobi-upper</Link>
                    </>
                )}
            </div>
        )
    },
}))

// ActionLink mock 成 marker（真实组件有拖挂依赖）
vi.mock('@/components/ui/ActionLink', () => ({
    ActionLink: vi.fn(({ uri, children }: { uri: string; children?: React.ReactNode }) => (
        <span data-testid="action-link" data-uri={uri}>{children}</span>
    )),
}))

import { StreamdownView, STREAMDOWN_CONTAINER_CLASS } from '@/components/ui/StreamdownView'
import { ActionLink } from '@/components/ui/ActionLink'

describe('StreamdownView', () => {
    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it('容器挂 streamdown-md 类，外部 className 合并其后', () => {
        render(<StreamdownView content="hi" className="custom-md" />)
        const container = document.querySelector('.streamdown-md')!
        expect(container).toBeInTheDocument()
        expect(container).toHaveClass('custom-md')
    })

    it('mobi:// 链接（scheme 大小写不敏感）交 ActionLink，外链新标签页 <a>', () => {
        render(<StreamdownView content="hi" />)
        const actionLinks = screen.getAllByTestId('action-link')
        expect(actionLinks).toHaveLength(2)
        expect(actionLinks[0]).toHaveAttribute('data-uri', 'mobi://file/open?path=a.ts')
        expect(actionLinks[1]).toHaveAttribute('data-uri', 'MOBI://file/open?path=a.ts')
        const ext = screen.getByText('ext')
        expect(ext).toHaveAttribute('href', 'https://example.com')
        expect(ext).toHaveAttribute('target', '_blank')
        expect(ext).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('配置透传：linkSafety 关 / 表格无控件 / 代码块仅 copy / 行号关', () => {
        render(<StreamdownView content="hi" />)
        const props = streamdownSpy.mock.calls[0][0] as {
            linkSafety: { enabled: boolean }
            controls: { table: boolean; code: { copy: boolean; download: boolean }; image: boolean }
            lineNumbers: boolean
            mode: string
        }
        expect(props.linkSafety.enabled).toBe(false)
        expect(props.controls).toEqual({ table: false, code: { copy: true, download: false }, image: false })
        expect(props.lineNumbers).toBe(false)
        expect(props.mode).toBe('streaming')
        expect(ActionLink).toHaveBeenCalled()
    })
})

// 引用容器类导出，防止未使用导出告警（同时锁定命名）
describe('容器类约定', () => {
    it('STREAMDOWN_CONTAINER_CLASS = streamdown-md', () => {
        expect(STREAMDOWN_CONTAINER_CLASS).toBe('streamdown-md')
    })
})
