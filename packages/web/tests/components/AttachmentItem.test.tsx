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
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AttachmentList } from '@/components/composer/AttachmentItem'
import type { FileAttachment } from '@/core/lib/fileAttachments'

// vitest 未开 globals，渲染型测试需显式 cleanup，否则 DOM 累积串味后续断言
afterEach(cleanup)

describe('AttachmentList 恢复态渲染', () => {
    it('优先用顶层 size 而非空 file.size', () => {
        const a: FileAttachment = {
            id: 'r1',
            file: new File([], 'report.pdf'),  // 恢复态占位 file，size=0
            status: 'complete',
            path: '/uploads/report-xxxx.pdf',
            name: 'report.pdf',
            size: 4096,
        }
        const { getByText } = render(<AttachmentList attachments={[a]} onRemove={() => {}} />)
        // formatFileSize(4096) → "4.0 KB"，不应是空 file 的 "0 B"
        expect(getByText('4.0 KB')).toBeTruthy()
    })

    it('无顶层字段时回退 file.size（正常上传态兼容）', () => {
        const a: FileAttachment = {
            id: 'n1',
            file: new File(['abcdef'], 'note.txt'),  // size=6
            status: 'complete',
            path: '/uploads/note-xxxx.txt',
        }
        const { getByText } = render(<AttachmentList attachments={[a]} onRemove={() => {}} />)
        expect(getByText('6.0 B')).toBeTruthy()
    })

    it('恢复态图片附件不渲染空 objectURL，回退图标（无 img 元素）', () => {
        const a: FileAttachment = {
            id: 'img1',
            file: new File([], 'pic.png'),
            status: 'complete',
            path: '/uploads/pic-xxxx.png',
            name: 'pic.png',
            size: 1024,
        }
        const { container } = render(<AttachmentList attachments={[a]} onRemove={() => {}} />)
        expect(container.querySelector('img')).toBeNull()
    })
})

describe('ImageThumb 图片缩略图', () => {
    const imgAttachment = (): FileAttachment => ({
        id: 'img-x',
        file: new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }),
        status: 'complete',
        path: '/uploads/2026-08/shot-xxxx.png',
    })

    it('上传完成态图片：36×36 cover 缩略图（外层容器），img 承载裁切', () => {
        const { container } = render(<AttachmentList attachments={[imgAttachment()]} onRemove={() => {}} />)
        const holder = container.querySelector('.ant-image') as HTMLElement
        expect(holder).not.toBeNull()
        expect(holder.style.width).toBe('36px')
        expect(holder.style.height).toBe('36px')
        const img = holder.querySelector('img')
        expect(img).not.toBeNull()
        expect(img!.style.objectFit).toBe('cover')
        expect(img!.getAttribute('src')).toMatch(/^blob:/)
    })

    it('点击可放大预览：点击缩略图后 preview 浮层挂载', async () => {
        const { container } = render(<AttachmentList attachments={[imgAttachment()]} onRemove={() => {}} />)
        const holder = container.querySelector('.ant-image') as HTMLElement
        fireEvent.click(holder.querySelector('img') ?? holder)
        // 浮层经 Portal 渲染到 document.body
        await waitFor(() => {
            expect(document.body.querySelector('.ant-image-preview')).not.toBeNull()
        })
    })

    it('空 file（恢复态）不渲染预览容器，回退图标（既有行为不回归）', () => {
        const a: FileAttachment = {
            id: 'empty',
            file: new File([], 'pic.png'),
            status: 'complete',
            path: '/uploads/pic-xxxx.png',
            name: 'pic.png',
            size: 1024,
        }
        const { container } = render(<AttachmentList attachments={[a]} onRemove={() => {}} />)
        expect(container.querySelector('.ant-image')).toBeNull()
        expect(container.querySelector('img')).toBeNull()
    })

    it('恢复态附件有 path + sessionId：经 read-file 端点渲染可预览缩略图（rewind 回填场景）', () => {
        const a: FileAttachment = {
            id: 'restored',
            file: new File([], 'shot.png'),
            status: 'complete',
            path: '.mobi/uploads/2026-08/shot-abc123.png',
            name: 'shot.png',
            size: 2048,
            mimeType: 'image/png',
        }
        const { container } = render(
            <AttachmentList attachments={[a]} onRemove={() => {}} sessionId="sess-rw" />,
        )
        const holder = container.querySelector('.ant-image') as HTMLElement
        expect(holder).not.toBeNull()
        const img = holder.querySelector('img')
        expect(img!.getAttribute('src')).toContain('/api/sessions/sess-rw/read-file')
        expect(img!.getAttribute('src')).toContain(encodeURIComponent('.mobi/uploads/2026-08/shot-abc123.png'))
        // 点击同样可放大（preview 浮层挂载）
        fireEvent.click(img!)
        return waitFor(() => {
            expect(document.body.querySelector('.ant-image-preview')).not.toBeNull()
        })
    })
})
