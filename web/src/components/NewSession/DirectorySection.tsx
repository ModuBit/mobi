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

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Input, Tag, Alert } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import type { Suggestion } from './useActiveSuggestions'

export interface DirectorySectionProps {
    directory: string
    suggestions: readonly Suggestion[]
    selectedIndex: number
    isDisabled: boolean
    recentPaths: string[]
    statusMessage?: string | null
    statusTone?: 'warning' | 'error' | null
    onDirectoryChange: (value: string) => void
    onDirectoryFocus: () => void
    onDirectoryBlur: () => void
    onDirectoryKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
    onSuggestionSelect: (index: number) => void
    onPathClick: (path: string) => void
}

/**
 * 目录输入区域组件
 */
export function DirectorySection({
    directory,
    suggestions,
    selectedIndex,
    isDisabled,
    recentPaths,
    statusMessage,
    statusTone,
    onDirectoryChange,
    onDirectoryFocus,
    onDirectoryBlur,
    onDirectoryKeyDown,
    onSuggestionSelect,
    onPathClick
}: DirectorySectionProps) {
    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                <FolderOutlined className="mr-1" />
                工作目录
            </label>
            <div className="relative">
                <Input
                    placeholder="输入工作目录路径"
                    value={directory}
                    onChange={(e) => onDirectoryChange(e.target.value)}
                    onKeyDown={onDirectoryKeyDown}
                    onFocus={onDirectoryFocus}
                    onBlur={onDirectoryBlur}
                    disabled={isDisabled}
                    className="w-full"
                />
                {/* 建议列表 */}
                {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto">
                        {suggestions.map((suggestion, index) => (
                            <div
                                key={suggestion.key}
                                className={`px-3 py-2 cursor-pointer text-sm ${
                                    index === selectedIndex
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'hover:bg-gray-50'
                                }`}
                                onClick={() => onSuggestionSelect(index)}
                            >
                                {suggestion.text}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 最近使用的路径 */}
            {recentPaths.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                    <span className="text-xs text-gray-400">最近使用:</span>
                    <div className="flex flex-wrap gap-1">
                        {recentPaths.map((path) => (
                            <Tag
                                key={path}
                                onClick={() => onPathClick(path)}
                                className="cursor-pointer hover:bg-gray-100 max-w-[200px] truncate"
                            >
                                {path}
                            </Tag>
                        ))}
                    </div>
                </div>
            )}

            {/* 状态消息 */}
            {statusMessage && (
                <Alert
                    message={statusMessage}
                    type={statusTone === 'error' ? 'error' : 'warning'}
                    showIcon
                    className="mt-1 text-xs"
                />
            )}
        </div>
    )
}
