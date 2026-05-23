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
import { Markdown } from '@/components/ui/Markdown'

/** 匹配中断消息，如 [Request interrupted by user] 或 [Request interrupted by user for tool use] */
const INTERRUPTED_RE = /\[Request interrupted by user.*\]/

/** 渲染文本块（user-text / agent-text 共用） */
export const TextBlock = memo(function TextBlock({ text, isSynthetic, isStreaming, enableSlashCommand }: {
    text: string
    isSynthetic?: boolean
    isStreaming?: boolean
    enableSlashCommand?: boolean
}) {
    if (isSynthetic || INTERRUPTED_RE.test(text)) {
        return <span style={{ fontSize: 12, opacity: 0.5 }}>{text}</span>
    }
    return <Markdown content={text} streaming={isStreaming} enableSlashCommand={enableSlashCommand} />
})
