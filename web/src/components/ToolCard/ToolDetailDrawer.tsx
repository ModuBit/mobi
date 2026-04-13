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
 * 抽屉详情组件
 * 点击内联预览后弹出，展示工具调用的完整输入和输出信息
 */

import { useMemo, memo, type CSSProperties } from 'react'
import { Drawer, theme as antTheme, Typography } from 'antd'
import { safeStringify } from '@mobi/shared'
import { useTranslation } from 'react-i18next'
import type { SessionMetadataSummary } from '@/api/types'
import type { ToolCallBlock } from './types'
import type { MergedToolCallBlock } from '@/components/chat/messageParser'
import { getToolPresentation } from './knownTools'
import { getToolFullViewComponent, getToolViewComponent } from './views/_all'
import { getToolResultViewComponent } from './views/_results'
import { getToolIcon, StatusStateIcon, ICON_STYLE_LG } from './toolIcons'
import { truncate } from '@/lib/toolInputUtils'
import { useIsMobile } from '@/hooks/useMediaQuery'

const { Text } = Typography
const { useToken } = antTheme

/**
 * 抽屉详情组件属性
 */
type ToolDetailDrawerProps = {
    block: MergedToolCallBlock
    metadata: SessionMetadataSummary | null
    open: boolean
    onClose: () => void
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
 * 获取状态文字描述
 */
function getStatusText(state: MergedToolCallBlock['state'], t: (key: string) => string): string {
    switch (state) {
        case 'completed': return t('chat.tool.statusDone')
        case 'error': return t('chat.tool.statusError')
        case 'running': return t('chat.tool.statusRunning')
        case 'pending': return ''
    }
}

/**
 * 抽屉详情组件
 * 展示工具调用的完整输入和输出信息，桌面端从右侧滑出，移动端从底部弹出
 */
function ToolDetailDrawerInner({ block, metadata, open, onClose }: ToolDetailDrawerProps) {
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

    // 缓存视图组件
    const FullView = useMemo(() => getToolFullViewComponent(block.name), [block.name])
    const CompactView = useMemo(() => getToolViewComponent(block.name), [block.name])
    const ResultView = useMemo(() => getToolResultViewComponent(block.name), [block.name])

    // 将 MergedToolCallBlock 转为 ToolCallBlock 以适配视图接口
    const adaptedBlock = useMemo(() => mergedToToolCallBlock(block), [block])

    // 副标题截断到 60 字
    const truncatedSubtitle = presentation.subtitle
        ? truncate(presentation.subtitle, 60)
        : null

    // 状态文字
    const statusText = getStatusText(block.state, t)

    // 标签样式
    const labelStyle: CSSProperties = {
        marginBottom: 4,
        fontSize: 11,
        fontWeight: 500,
        color: token.colorTextSecondary,
    }

    // 分隔线样式
    const dividerStyle: CSSProperties = {
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        margin: '12px 0',
    }

    // 区域容器样式
    const sectionStyle: CSSProperties = {
        padding: '12px 16px',
    }

    // 标题栏
    const titleContent = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: token.colorTextSecondary }}>
                {getToolIcon(block.name, ICON_STYLE_LG)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <Text strong style={{ fontSize: 14, wordBreak: 'break-word' }}>
                    {presentation.title}
                </Text>
                {truncatedSubtitle ? (
                    <div>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {truncatedSubtitle}
                        </Text>
                    </div>
                ) : null}
            </div>
        </div>
    )

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={titleContent}
            placement={isMobile ? 'bottom' : 'right'}
            width={isMobile ? undefined : 400}
            height={isMobile ? 'auto' : undefined}
            styles={{
                body: {
                    padding: 0,
                    paddingBottom: isMobile ? `max(24px, env(safe-area-inset-bottom))` : 0,
                },
                wrapper: isMobile ? { height: 'auto', maxHeight: '85vh' } : undefined,
            }}
        >
            {/* 输入区 */}
            <div style={sectionStyle}>
                <div style={labelStyle}>{t('chat.tool.input')}</div>
                {FullView ? (
                    <FullView block={adaptedBlock} metadata={metadata} />
                ) : CompactView ? (
                    <CompactView block={adaptedBlock} metadata={metadata} />
                ) : (
                    <pre style={{
                        background: token.colorBgContainer,
                        padding: 8,
                        borderRadius: 4,
                        fontSize: 12,
                        overflowX: 'auto',
                        margin: '4px 0',
                        border: `1px solid ${token.colorBorder}`,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}>
                        {safeStringify(block.input)}
                    </pre>
                )}
            </div>

            {/* 分隔线 */}
            <div style={{ ...dividerStyle, marginLeft: 16, marginRight: 16 }} />

            {/* 输出区 */}
            <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={labelStyle}>{t('chat.tool.output')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <StatusStateIcon state={block.state} style={{ fontSize: 12 }} />
                        {statusText ? (
                            <Text type="secondary" style={{ fontSize: 11 }}>{statusText}</Text>
                        ) : null}
                    </div>
                </div>
                <ResultView block={adaptedBlock} metadata={metadata} />
            </div>
        </Drawer>
    )
}

export const ToolDetailDrawer = memo(ToolDetailDrawerInner)
