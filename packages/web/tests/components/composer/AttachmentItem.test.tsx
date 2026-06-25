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
import { getDisplayName } from '@/components/composer/AttachmentItem'
import type { FileAttachment } from '@/core/lib/fileAttachments'

// 构造最小 FileAttachment（仅 getDisplayName 关心 path + file.name）
function makeAttachment(path: string | undefined, fileName: string): FileAttachment {
    return {
        id: 'test-id',
        file: new File([], fileName),
        status: 'complete',
        path,
    }
}

describe('getDisplayName', () => {
    it('剥离当前 cli 格式的 shortId 后缀（~12 字符，带扩展名）', () => {
        // cli: Date.now().toString(36)(~8 位) + Math.random().toString(36).slice(2,6)(4 位) = 12 字符
        const a = makeAttachment('.mobi/uploads/2026-06/report-mqt09p66esig.pdf', 'report.pdf')
        expect(getDisplayName(a)).toBe('report.pdf')
    })

    it('剥离 shortId 后缀（无扩展名）', () => {
        const a = makeAttachment('.mobi/uploads/2026-06/notes-lq3x9abc1234', 'notes')
        expect(getDisplayName(a)).toBe('notes')
    })

    it('兼容旧格式（13 位时间戳前缀）', () => {
        const a = makeAttachment('.mobi/uploads/2025-01/1700000000000-report.pdf', 'report.pdf')
        expect(getDisplayName(a)).toBe('report.pdf')
    })

    it('文件名含多个连字符时只剥离末尾 shortId', () => {
        const a = makeAttachment('.mobi/uploads/2026-06/my-report-file-mqt09p66esig.pdf', 'my-report-file.pdf')
        expect(getDisplayName(a)).toBe('my-report-file.pdf')
    })

    it('无 path（上传中 / 失败）回退原始文件名', () => {
        const a = makeAttachment(undefined, 'uploading.png')
        expect(getDisplayName(a)).toBe('uploading.png')
    })
})
