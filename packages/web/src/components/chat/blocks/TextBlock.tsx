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

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/ui/Markdown'

/** 匹配中断消息，如 [Request interrupted by user] 或 [Request interrupted by user for tool use] */
const INTERRUPTED_RE = /\[Request interrupted by user.*\]/

/**
 * 「已截断」中性标注（spec D6）：assistant 正文被 interrupt/abort 截断时的诚实呈现。
 * 刻意非 error 红色样式——截断不是执行失败，只用中性灰描边轻量 tag 表意。
 */
function TruncatedTag() {
    const { t } = useTranslation()
    return (
        <span
            style={{
                display: 'inline-block',
                marginLeft: 6,
                padding: '0 6px',
                fontSize: 11,
                lineHeight: '18px',
                borderRadius: 4,
                border: '1px solid var(--ant-color-border-secondary)',
                color: 'var(--ant-color-text-tertiary)',
                whiteSpace: 'nowrap',
                verticalAlign: 'middle',
            }}
        >
            {t('chat.abortedTruncated')}
        </span>
    )
}

/** 渲染文本块（user-text / agent-text 共用；aborted 仅 agent-text 传入） */
export const TextBlock = memo(function TextBlock({ text, isSynthetic, isStreaming, aborted, enableSlashCommand, enableMention }: {
    text: string
    isSynthetic?: boolean
    isStreaming?: boolean
    /** 源 assistant 消息被截断（spec D6），气泡尾部追加中性标注 */
    aborted?: boolean
    enableSlashCommand?: boolean
    enableMention?: boolean
}) {
    if (isSynthetic || INTERRUPTED_RE.test(text)) {
        return (
            <span style={{ fontSize: 12, opacity: 0.5 }}>
                {text}
                {aborted ? <TruncatedTag /> : null}
            </span>
        )
    }
    if (aborted) {
        return (
            <div>
                <Markdown content={text} streaming={isStreaming} enableSlashCommand={enableSlashCommand} enableMention={enableMention} />
                <TruncatedTag />
            </div>
        )
    }
    return <Markdown content={text} streaming={isStreaming} enableSlashCommand={enableSlashCommand} enableMention={enableMention} />
})
