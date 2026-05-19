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

import type { ReactNode } from 'react'
import { Popover } from 'antd'
import { Eye } from 'lucide-react'
import { Markdown } from '@/components/ui/Markdown'

export function isHtmlContent(content: string): boolean {
    return /^<[a-zA-Z]/s.test(content)
}

export function PreviewContent({ content }: { content: string }) {
    if (isHtmlContent(content)) {
        return (
            <div
                style={{ maxHeight: 300, overflow: 'auto', padding: 4 }}
                dangerouslySetInnerHTML={{ __html: content }}
            />
        )
    }
    return (
        <div style={{ maxHeight: 300, overflow: 'auto', padding: 4 }}>
            <Markdown content={content} typing={false} />
        </div>
    )
}

type OptionPreviewProps = {
    preview: string
    children: ReactNode
}

/**
 * 选项预览包装器
 * - 桌面端：hover 整行触发 Popover
 * - 移动端：Eye 图标 click 触发 Popover（与选择操作分离）
 */
export function OptionPreview({ preview, children }: OptionPreviewProps) {
    const content = <PreviewContent content={preview} />

    return (
        <Popover
            trigger="hover"
            placement="left"
            overlayStyle={{ maxWidth: 320 }}
            content={content}
            mouseEnterDelay={0.3}
        >
            <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
                <span
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        flexShrink: 0,
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                        color: 'inherit',
                        opacity: 0.45
                    }}
                >
                    <Popover
                        trigger="click"
                        placement="left"
                        overlayStyle={{ maxWidth: 320 }}
                        content={content}
                    >
                        <Eye size={14} style={{ cursor: 'pointer' }} />
                    </Popover>
                </span>
            </div>
        </Popover>
    )
}
