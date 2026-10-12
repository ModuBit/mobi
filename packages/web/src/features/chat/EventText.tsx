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
 * Agent 事件结构化描述（FormattedEvent）的渲染端（src 分层治理票 01）：
 * domain/chat/eventFormatter 产出纯数据（i18n 以 key+params 透传），本组件执行
 * t()、mono 字体与时间戳后缀等呈现细节；turn-result 委托 TurnResultMeta。
 * 唯一消费方 AgentEventBlock。
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormattedEvent } from '@/domain/chat'
import { TurnResultMeta } from './TurnResultMeta'

export function EventText({ formatted, actions }: { formatted: FormattedEvent; actions?: ReactNode }) {
    const { t } = useTranslation()

    if (formatted === null) return null
    if (formatted.kind === 'turn-result') {
        return <TurnResultMeta event={formatted.event} createdAt={formatted.createdAt} actions={actions} />
    }

    return (
        <>
            {formatted.lines.map((line, i) => (
                <div
                    key={i}
                    style={{
                        ...(line.mono ? { fontFamily: 'var(--font-mono)' } : {}),
                        ...(line.spaced ? { marginTop: 2 } : {}),
                    }}
                >
                    {/* 片段逐 span 包裹（延续旧渲染结构）：语义片段是可寻址文本单元 */}
                    {line.segments.map((seg, j) => (
                        <span key={j}>{typeof seg === 'string' ? seg : t(seg.key, seg.params)}</span>
                    ))}
                    {line.timeSuffix !== undefined && <span style={{ marginLeft: 8 }}>{line.timeSuffix}</span>}
                </div>
            ))}
        </>
    )
}
