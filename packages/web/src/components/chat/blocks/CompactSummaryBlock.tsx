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

import { Collapse, Typography } from 'antd'
import { CompressOutlined, NumberOutlined } from '@ant-design/icons'
import type { CompactSummaryBlock } from '@/domain/chat/types'
import { Markdown } from '@/components/ui/Markdown'
import { useMemo } from 'react'

const { Text } = Typography

/** 格式化 token 数量 */
function formatTokens(tokens: number): string {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}k`
    }
    return String(tokens)
}

/** 渲染 Compact 总结消息块 */
export function CompactSummaryBlockComponent(props: { block: CompactSummaryBlock }) {
    const { block } = props

    // 提取 Summary 部分（如果存在）
    const summaryContent = useMemo(() => {
        const text = block.text
        const summaryMatch = text.match(/Summary:\n([\s\S]*)/)
        if (summaryMatch) {
            return summaryMatch[1].trim()
        }
        return text
    }, [block.text])

    // 计算压缩率
    const compressionRatio = block.preTokens > 0
        ? ((block.preTokens - block.postTokens) / block.preTokens * 100).toFixed(0)
        : '0'

    const header = (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0, // 允许收缩
        }}>
            <CompressOutlined style={{ color: 'var(--color-success)', flexShrink: 0 }} />
            <Text type="secondary" ellipsis style={{ minWidth: 0 }}>
                对话已压缩
            </Text>
            <Text type="success" style={{ fontSize: '12px', flexShrink: 0 }}>
                -{compressionRatio}%
            </Text>
            <Text type="secondary" style={{ fontSize: '11px', flexShrink: 0 }}>
                {formatTokens(block.preTokens)}→{formatTokens(block.postTokens)}
            </Text>
        </div>
    )

    return (
        <Collapse
            size="small"
            items={[{
                key: 'summary',
                label: header,
                children: (
                    <div style={{
                        maxHeight: '400px',
                        overflow: 'auto',
                        padding: '8px 12px',
                        background: 'var(--color-bg-layout)',
                        borderRadius: '6px',
                    }}>
                        <Markdown content={summaryContent} />
                    </div>
                ),
            }]}
            defaultActiveKey={[]}
        />
    )
}
