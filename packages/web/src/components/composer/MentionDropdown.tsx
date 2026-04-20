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

import { useCallback } from 'react'
import { FolderOutlined, FileOutlined } from '@ant-design/icons'
import type { FileSuggestionItem } from './useSessionFileListing'

/** 下拉列表容器共享样式 */
const DROPDOWN_STYLE: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    maxHeight: 240,
    overflowY: 'auto',
    backgroundColor: 'var(--ant-color-bg-elevated)',
    borderRadius: 'var(--ant-border-radius)',
    boxShadow: 'var(--ant-box-shadow-secondary)',
    zIndex: 50,
    marginBottom: 4,
}

interface MentionDropdownProps {
    items: FileSuggestionItem[]
    loading: boolean
    activeIndex: number
    scrollIntoActive: (node: HTMLDivElement | null) => void
    onSelect: (item: FileSuggestionItem) => void
    onHover: (index: number) => void
}

/** @ 文件引用下拉列表 */
export function MentionDropdown({
    items,
    loading,
    activeIndex,
    scrollIntoActive,
    onSelect,
    onHover,
}: MentionDropdownProps) {
    if (items.length === 0 && !loading) return null

    return (
        <div role="listbox" style={DROPDOWN_STYLE}>
            {loading && items.length === 0 ? (
                <div style={{ padding: '8px 12px', color: 'var(--ant-color-text-tertiary)', fontSize: 14 }}>
                    ...
                </div>
            ) : items.map((item, index) => (
                <div
                    key={item.value}
                    ref={index === activeIndex ? scrollIntoActive : undefined}
                    role="option"
                    aria-selected={index === activeIndex}
                    onClick={() => onSelect(item)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 12px',
                        cursor: 'pointer',
                        backgroundColor: index === activeIndex
                            ? 'var(--ant-color-bg-text-hover)'
                            : 'transparent',
                        fontSize: 14,
                    }}
                    onMouseEnter={() => onHover(index)}
                >
                    {item.isDirectory
                        ? <FolderOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
                        : <FileOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
                    <span>{item.label}</span>
                    {item.isDirectory && (
                        <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>/</span>
                    )}
                </div>
            ))}
        </div>
    )
}
