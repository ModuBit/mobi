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
 * 内联预览卡片组件
 * 在消息流中展示工具调用的简要信息，点击后可打开详情抽屉
 */

import { useEffect, useMemo, useRef, useState, memo, type CSSProperties, type ReactNode } from 'react'
import { theme as antTheme, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SessionMetadataSummary } from '@/api/types'
import type { ToolCallBlock } from './types'
import type { MergedToolCallBlock } from '@/components/chat/messageParser'
import { getToolPresentation } from './knownTools'
import { getToolResultViewComponent } from './views/_results'
import { getToolIcon, StatusStateIcon } from './toolIcons'
import { truncate } from '@/lib/toolInputUtils'
import { useIsMobile } from '@/hooks/useMediaQuery'

const { Text } = Typography
const { useToken } = antTheme

/**
 * 内联预览组件属性
 */
type ToolInlinePreviewProps = {
    block: MergedToolCallBlock
    metadata: SessionMetadataSummary | null
    onClick: () => void
}

/**
 * 将 MergedToolCallBlock 转换为 ToolCallBlock，以适配视图组件接口
 */
function mergedToToolCallBlock(block: MergedToolCallBlock): ToolCallBlock {
    return {
        id: block.id,
        kind: 'tool-call',
        tool: {
            name: block.name,
            input: block.input,
            result: block.result,
            state: block.state,
            description: block.description,
            startedAt: null,
            createdAt: block.createdAt,
            permission: null,
        },
        children: block.children.map(mergedToToolCallBlock),
    }
}

/**
 * 内联预览卡片组件
 * 在消息流中展示工具调用的简要信息，包含标题栏、结果预览和溢出遮罩
 */
function ToolInlinePreviewInner({ block, metadata, onClick }: ToolInlinePreviewProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const isMobile = useIsMobile()

    // 缓存展示信息
    const presentation = useMemo(() => getToolPresentation({
        toolName: block.name,
        input: block.input,
        result: block.result,
        childrenCount: block.children.length,
        description: block.description,
        metadata,
    }), [block.name, block.input, block.result, block.children.length, block.description, metadata])

    // 缓存结果视图组件
    const ResultView = useMemo(() => getToolResultViewComponent(block.name), [block.name])

    // 将 MergedToolCallBlock 转为 ToolCallBlock 以适配视图接口
    const adaptedBlock = useMemo(() => mergedToToolCallBlock(block), [block])

    // 溢出检测
    const contentRef = useRef<HTMLDivElement>(null)
    const [isOverflowing, setIsOverflowing] = useState(false)

    useEffect(() => {
        const el = contentRef.current
        if (!el) return

        const observer = new ResizeObserver(() => {
            setIsOverflowing(el.scrollHeight > el.clientHeight)
        })

        observer.observe(el)
        return () => observer.disconnect()
    }, [ResultView, block.result])

    // 副标题截断到 80 字
    const truncatedSubtitle = presentation.subtitle
        ? truncate(presentation.subtitle, 80)
        : null

    // 是否显示预览内容区（运行中或无结果时不显示）
    const showPreview = block.state !== 'running' && block.result !== undefined

    // 预览区最大高度
    const previewMaxHeight = isMobile ? 100 : 120

    // 外层容器样式
    const containerStyle: CSSProperties = {
        cursor: 'pointer',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'background-color 0.2s',
    }

    // 标题栏样式
    const headerStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        overflow: 'hidden',
    }

    // 预览内容区样式
    const previewStyle: CSSProperties = {
        position: 'relative',
        maxHeight: previewMaxHeight,
        overflow: 'hidden',
        padding: '8px 12px',
    }

    // 渐变遮罩样式
    const gradientStyle: CSSProperties = {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: `linear-gradient(transparent, ${token.colorBgContainer})`,
        pointerEvents: 'none',
    }

    // 底部提示样式
    const footerStyle: CSSProperties = {
        textAlign: 'center',
        padding: '6px 12px',
        color: token.colorPrimary,
        fontSize: 12,
    }

    return (
        <div
            style={containerStyle}
            onClick={onClick}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = token.colorBgTextHover
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
            }}
        >
            {/* 标题栏 */}
            <div style={headerStyle}>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: token.colorTextSecondary }}>
                    {getToolIcon(block.name)}
                </div>
                <Text strong style={{ minWidth: 0, fontSize: 13, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {presentation.title}
                </Text>
                {truncatedSubtitle ? (
                    <Text type="secondary" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                        {truncatedSubtitle}
                    </Text>
                ) : null}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <StatusStateIcon state={block.state} />
                </div>
            </div>

            {/* 预览内容区 */}
            {showPreview ? (
                <div style={previewStyle} ref={contentRef}>
                    <ResultView block={adaptedBlock} metadata={metadata} />
                    {/* 渐变遮罩 */}
                    {isOverflowing ? <div style={gradientStyle} /> : null}
                </div>
            ) : null}

            {/* 底部提示 */}
            <div style={footerStyle}>
                {t('chat.tool.viewDetail')} →
            </div>
        </div>
    )
}

export const ToolInlinePreview = memo(ToolInlinePreviewInner)
