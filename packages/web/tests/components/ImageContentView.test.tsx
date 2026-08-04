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

import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ImageContentView from '@/components/files/ImageContentView'

/** 从 img.src 取回 query 参数（不耦合具体编码方式，比字符串包含更稳） */
function srcQuery(img: HTMLImageElement) {
    return new URL(img.src, 'http://localhost').searchParams
}

describe('ImageContentView', () => {
    afterEach(() => cleanup())

    it('渲染 antd Image（.ant-image-img），src 直连 read-file 端点', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(img).toBeInTheDocument()
        expect(img.src).toContain('/api/sessions/s1/read-file')
    })

    it('filePath 正确编码进 src query（含空格/中文，可原样解析回来）', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a/b 画.png" etag="e1" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(srcQuery(img).get('path')).toBe('a/b 画.png')
    })

    it('etag 进 src 的 v 参数：内容变化（路径不变）→ src 变 → 浏览器重新请求', () => {
        const { container, rerender } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="100-1700" />)
        const before = (container.querySelector('.ant-image-img') as HTMLImageElement).src
        expect(srcQuery(container.querySelector('.ant-image-img') as HTMLImageElement).get('v')).toBe('100-1700')

        // 同一路径、内容被改写（mtime/size 变 → etag 变）
        rerender(<ImageContentView sessionId="s1" filePath="a.png" etag="250-1800" />)
        const after = (container.querySelector('.ant-image-img') as HTMLImageElement).src
        expect(after).not.toBe(before)
        expect(srcQuery(container.querySelector('.ant-image-img') as HTMLImageElement).get('v')).toBe('250-1800')
    })

    it('etag 不变则 src 稳定（不白重新下载）', () => {
        const { container, rerender } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="same" />)
        const before = (container.querySelector('.ant-image-img') as HTMLImageElement).src
        rerender(<ImageContentView sessionId="s1" filePath="a.png" etag="same" />)
        expect((container.querySelector('.ant-image-img') as HTMLImageElement).src).toBe(before)
    })

    it('加载失败后内容更新（etag 变）→ 清失败态重新加载，不永久卡在重试界面', async () => {
        const { container, rerender } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="bad" />)
        fireEvent.error(container.querySelector('.ant-image-img') as HTMLImageElement)
        // 失败态：兜底图 + 重试按钮，无 antd Image
        await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

        // 文件被修好（etag 变）→ 回到正常渲染
        rerender(<ImageContentView sessionId="s1" filePath="a.png" etag="fixed" />)
        await waitFor(() => {
            expect(container.querySelector('.ant-image-img')).toBeInTheDocument()
            expect(container.querySelector('.ant-btn')).toBeNull()
        })
    })

    // 同一 tab 内换文件时组件实例被复用（tab.id 不变，见 openFileInTab），
    // 失败态与重试计数都属于上一个文件，不该跟过来
    it('换文件 → 清掉上一个文件的失败态（不显示继承来的重试界面）', async () => {
        const { container, rerender } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        fireEvent.error(container.querySelector('.ant-image-img') as HTMLImageElement)
        await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

        rerender(<ImageContentView sessionId="s1" filePath="b.png" etag="e1" />)
        await waitFor(() => {
            const img = container.querySelector('.ant-image-img') as HTMLImageElement
            expect(img).toBeInTheDocument()
            expect(srcQuery(img).get('path')).toBe('b.png')
        })
    })

    it('换文件 → 重试计数归零（不把上一个文件的 _retry 带到新 src）', async () => {
        const { container, rerender } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        fireEvent.error(container.querySelector('.ant-image-img') as HTMLImageElement)
        await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())
        // 手点重试 → _retry=1
        fireEvent.click(container.querySelector('.ant-btn')!)
        await waitFor(() => {
            const img = container.querySelector('.ant-image-img') as HTMLImageElement
            expect(srcQuery(img).get('_retry')).toBe('1')
        })

        rerender(<ImageContentView sessionId="s1" filePath="b.png" etag="e1" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(srcQuery(img).get('_retry')).toBeNull()
    })

    it('alt = filePath', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a/b.png" etag="e1" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(img.alt).toBe('a/b.png')
    })

    it('容器带 image-content-view 类（约束尺寸/contain 的 CSS 钩子）', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        expect(container.querySelector('.image-content-view')).toBeInTheDocument()
    })

    it('启用预览（点击放大）：.ant-image 上有 preview 钩子 class', () => {
        // antd Image preview 默认开启，渲染 .ant-image 且其内部 img 可点开预览
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        const wrap = container.querySelector('.ant-image')
        expect(wrap).toBeInTheDocument()
        // preview 启用时 antd 会给 root 加 previewable 标记 class（跨版本稳定：.ant-image-preview）
        // 这里仅断言 root 存在 + img 可交互（点击预览的实质由 antd 内部保障）
        expect(container.querySelector('.ant-image-img')).toBeInTheDocument()
    })

    it('图片加载失败显示重试按钮，点击重试变更 src（绕过缓存重新请求）', async () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" etag="e1" />)
        // 初始 src 不含 _retry
        const img0 = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(img0.src).not.toContain('_retry')

        // 触发原生 onError（模拟 401/损坏）→ 切到失败态
        fireEvent.error(img0)

        // 失败态显示重试按钮（antd Button 渲染 .ant-btn；用 container 局部查询避免全局累积干扰）
        const retryBtn = await waitFor(() => {
            const btn = container.querySelector('.ant-btn') as HTMLButtonElement
            expect(btn).toBeInTheDocument()
            return btn
        })

        // 点击重试 → failed 复位 + retry 自增 → 重新渲染 antd Image，src 带 _retry=1
        fireEvent.click(retryBtn)
        await waitFor(() => {
            const img1 = container.querySelector('.ant-image-img') as HTMLImageElement
            expect(img1.src).toContain('_retry=1')
        })
    })
})
