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
import { memo, useMemo } from 'react'
import { Popover, theme as antTheme } from 'antd'
import { Eye } from 'lucide-react'
import styled from '@emotion/styled'
import { Markdown } from '@/components/ui/Markdown'

function isHtmlContent(content: string): boolean {
    return /^<[a-zA-Z]/s.test(content)
}

function PreviewContent({ content }: { content: string }) {
    const { token } = antTheme.useToken()
    const style: React.CSSProperties = {
        maxHeight: 300,
        overflow: 'auto',
        fontSize: 13,
        lineHeight: 1.6,
        color: token.colorText,
    }
    if (isHtmlContent(content)) {
        return (
            <div
                style={style}
                dangerouslySetInnerHTML={{ __html: content }}
            />
        )
    }
    return (
        <div style={style}>
            <Markdown content={content} typing={false} />
        </div>
    )
}

type OptionPreviewProps = {
    preview: string
    children: ReactNode
}

const EyeTrigger = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex-shrink: 0;
    margin-left: 4px;
    padding: 4px;
    display: flex;
    align-items: center;
    color: ${props => props.$token.colorTextQuaternary};
    transition: color 0.2s;
    cursor: pointer;

    &:hover {
        color: ${props => props.$token.colorTextSecondary};
    }
`

/**
 * 选项预览包装器
 * hover 或点击 Eye 图标触发 Popover
 */
export const OptionPreview = memo(function OptionPreview({ preview, children }: OptionPreviewProps) {
    const { token } = antTheme.useToken()
    const content = <PreviewContent content={preview} />

    const overlayInnerStyle = useMemo<React.CSSProperties>(() => ({
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadow,
    }), [token.colorBgElevated, token.borderRadiusLG, token.colorBorderSecondary, token.boxShadow])

    return (
        <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
            <EyeTrigger
                $token={token}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                <Popover
                    trigger={['hover', 'click']}
                    placement="left"
                    mouseEnterDelay={0.15}
                    mouseLeaveDelay={0.1}
                    overlayStyle={{ maxWidth: 360 }}
                    overlayInnerStyle={overlayInnerStyle}
                    styles={{ container: { padding: 0 } }}
                    content={content}
                    arrow={false}
                >
                    <Eye size={14} />
                </Popover>
            </EyeTrigger>
        </div>
    )
})
