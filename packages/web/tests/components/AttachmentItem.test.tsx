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
import { render } from '@testing-library/react'
import { AttachmentList } from '@/components/composer/AttachmentItem'
import type { FileAttachment } from '@/core/lib/fileAttachments'

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
