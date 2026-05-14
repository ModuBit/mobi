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

import { CompressOutlined } from '@ant-design/icons'
import { Think } from '@ant-design/x'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CompactSummaryBlock } from '@/domain/chat/types'
import { Markdown } from '@/components/ui/Markdown'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { useMemo } from 'react'

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
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)

    const summaryContent = useMemo(() => {
        const text = block.text
        const summaryMatch = text.match(/Summary:\n([\s\S]*)/)
        if (summaryMatch) {
            return summaryMatch[1].trim()
        }
        return text
    }, [block.text])

    const compressionRatio = block.preTokens > 0
        ? ((block.preTokens - block.postTokens) / block.preTokens * 100).toFixed(0)
        : '0'

    const title = `${t('chat.compactSummary')} -${compressionRatio}% ${formatTokens(block.preTokens)}→${formatTokens(block.postTokens)}`

    return (
        <Think
            icon={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <StatusStateIcon state="completed" />
                    <CompressOutlined style={{ color: 'var(--color-success)' }} />
                </span>
            }
            title={title}
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <Markdown content={summaryContent} />
            </div>
        </Think>
    )
}
