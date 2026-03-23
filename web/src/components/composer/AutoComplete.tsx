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

import { memo, useEffect, useRef } from 'react'
import { theme } from 'antd'
import type { Suggestion } from '@/components/NewSession/useActiveSuggestions'

interface AutoCompleteProps {
    /** 建议列表 */
    suggestions: readonly Suggestion[]
    /** 当前选中的索引 */
    selectedIndex: number
    /** 选择回调 */
    onSelect: (index: number) => void
}

/**
 * 自动完成弹出层组件
 * 显示斜杠命令、技能等自动完成建议
 */
export const AutoComplete = memo(function AutoComplete(props: AutoCompleteProps) {
    const { suggestions, selectedIndex, onSelect } = props
    const listRef = useRef<HTMLDivElement>(null)
    const { token } = theme.useToken()

    // 自动滚动到选中项
    useEffect(() => {
        if (selectedIndex < 0 || selectedIndex >= suggestions.length) return
        const listEl = listRef.current
        if (!listEl) return
        const selectedEl = listEl.querySelector<HTMLButtonElement>(
            `[data-suggestion-index="${selectedIndex}"]`
        )
        selectedEl?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, suggestions])

    if (suggestions.length === 0) {
        return null
    }

    return (
        <div
            ref={listRef}
            style={{
                padding: '4px 0',
                maxHeight: 240,
                overflowY: 'auto'
            }}
        >
            {suggestions.map((suggestion, index) => {
                const isSelected = index === selectedIndex
                return (
                    <button
                        key={suggestion.key}
                        type="button"
                        data-suggestion-index={index}
                        onClick={() => onSelect(index)}
                        onMouseDown={(e) => e.preventDefault()} // 防止失焦
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: 2,
                            width: '100%',
                            padding: '8px 12px',
                            textAlign: 'left',
                            fontSize: 14,
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            background: isSelected
                                ? token.colorPrimary
                                : 'transparent',
                            color: isSelected
                                ? token.colorWhite
                                : token.colorText,
                        }}
                    >
                        <span style={{ fontWeight: 500, width: '100%' }}>
                            {suggestion.label}
                        </span>
                        {suggestion.description && (
                            <span
                                style={{
                                    width: '100%',
                                    fontSize: 12,
                                    lineHeight: 1.4,
                                    maxWidth: '100%',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    opacity: isSelected ? 0.8 : 0.65
                                }}
                            >
                                {suggestion.description}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
})
