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

import { useState, useEffect, memo, useRef } from 'react'
import { Think } from '@ant-design/x'
import ThinkIcon from '@ant-design/x/es/think/icons/think'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/ui/Markdown'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'

/** 思考过程渲染 */
export const ReasoningBlock = memo(function ReasoningBlock({ text, thinking, isStreaming }: {
    text: string
    thinking: boolean
    isStreaming?: boolean
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(thinking)
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!thinking) setExpanded(false)
    }, [thinking])

    useEffect(() => {
        if (isStreaming && contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight
        }
    }, [text, isStreaming])

    return (
        <Think
            icon={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <StatusStateIcon state={thinking ? 'running' : 'completed'} />
                    <ThinkIcon />
                </span>
            }
            title={thinking ? t('chat.thinking') : t('chat.thought')}
            blink={thinking}
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div ref={contentRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
                <Markdown content={text} streaming={isStreaming} />
            </div>
        </Think>
    )
})
