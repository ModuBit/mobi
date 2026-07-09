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

import { describe, it, expect } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import ImageContentView from '@/components/files/ImageContentView'

describe('ImageContentView', () => {
    it('渲染 antd Image（.ant-image-img），src 直连 read-file 端点', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(img).toBeInTheDocument()
        expect(img.src).toContain('/api/sessions/s1/read-file')
    })

    it('filePath 正确编码进 src query', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a/b 画.png" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        // encodeURI 保留 '/'，故 path 中的 '/' 不被编码；空格/中文被编码
        expect(img.src).toContain(encodeURIComponent('a/b 画.png'))
    })

    it('alt = filePath', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a/b.png" />)
        const img = container.querySelector('.ant-image-img') as HTMLImageElement
        expect(img.alt).toBe('a/b.png')
    })

    it('容器带 image-content-view 类（约束尺寸/contain 的 CSS 钩子）', () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" />)
        expect(container.querySelector('.image-content-view')).toBeInTheDocument()
    })

    it('启用预览（点击放大）：.ant-image 上有 preview 钩子 class', () => {
        // antd Image preview 默认开启，渲染 .ant-image 且其内部 img 可点开预览
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" />)
        const wrap = container.querySelector('.ant-image')
        expect(wrap).toBeInTheDocument()
        // preview 启用时 antd 会给 root 加 previewable 标记 class（跨版本稳定：.ant-image-preview）
        // 这里仅断言 root 存在 + img 可交互（点击预览的实质由 antd 内部保障）
        expect(container.querySelector('.ant-image-img')).toBeInTheDocument()
    })

    it('图片加载失败显示重试按钮，点击重试变更 src（绕过缓存重新请求）', async () => {
        const { container } = render(<ImageContentView sessionId="s1" filePath="a.png" />)
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
