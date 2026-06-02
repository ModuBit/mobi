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
import { attachmentInlineExtension } from '@/components/ui/attachmentPlugin'

describe('attachmentPlugin', () => {
    describe('tokenizer', () => {
        const ext = attachmentInlineExtension()

        it('应该匹配 @.mobi/attachments/YYYY-MM/filename', () => {
            const src = '@.mobi/attachments/2026-06/1748900000000-report.pdf'
            const start = ext.start?.(src, undefined as any)
            expect(start).toBe(0)

            const token = ext.tokenizer?.call({} as any, src)
            expect(token).toBeDefined()
            expect(token?.raw).toBe('@.mobi/attachments/2026-06/1748900000000-report.pdf')
        })

        it('不应匹配普通 @ 提及', () => {
            const src = '@username hello'
            const start = ext.start?.(src, undefined as any)
            expect(start).toBeUndefined()
        })

        it('应该在文本中间匹配附件路径', () => {
            const src = 'see @.mobi/attachments/2026-06/file.png for details'
            const start = ext.start?.(src, undefined as any)
            expect(start).toBe(4)
        })

        it('应该从路径中提取文件名（移除时间戳前缀）', () => {
            const src = '@.mobi/attachments/2026-06/1748900000000-report.pdf'
            const token = ext.tokenizer?.call({} as any, src) as any
            expect(token.filename).toBe('report.pdf')
        })

        it('应该根据扩展名返回正确的图标', () => {
            const pdfSrc = '@.mobi/attachments/2026-06/123-doc.pdf'
            const token = ext.tokenizer?.call({} as any, pdfSrc) as any
            expect(token.icon).toBe('📄')
        })

        it('renderer 应该输出 attachment-ref 标签', () => {
            const src = '@.mobi/attachments/2026-06/123-test.txt'
            const token = ext.tokenizer?.call({} as any, src) as any
            const html = ext.renderer?.call({} as any, token)
            expect(html).toContain('<attachment-ref')
            expect(html).toContain('data-path=".mobi/attachments/2026-06/123-test.txt"')
            expect(html).toContain('data-filename="test.txt"')
        })
    })
})
