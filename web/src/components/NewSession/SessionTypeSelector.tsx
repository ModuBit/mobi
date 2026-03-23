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

import type { RefObject } from 'react'
import { Radio, Input } from 'antd'
import type { InputRef } from 'antd'
import type { SessionType } from './types'

export interface SessionTypeSelectorProps {
    sessionType: SessionType
    worktreeName: string
    worktreeInputRef: RefObject<InputRef | null>
    isDisabled: boolean
    onSessionTypeChange: (value: SessionType) => void
    onWorktreeNameChange: (value: string) => void
}

/**
 * 会话类型选择器组件
 */
export function SessionTypeSelector({
    sessionType,
    worktreeName,
    worktreeInputRef,
    isDisabled,
    onSessionTypeChange,
    onWorktreeNameChange
}: SessionTypeSelectorProps) {
    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                会话类型
            </label>
            <div className="flex flex-col gap-2">
                {/* 普通会话 */}
                <label className="flex items-center gap-2 cursor-pointer min-h-[34px]">
                    <Radio
                        checked={sessionType === 'simple'}
                        onChange={() => onSessionTypeChange('simple')}
                        disabled={isDisabled}
                    />
                    <div className="flex flex-col">
                        <span className="text-sm">普通会话</span>
                        <span className="text-xs text-gray-400">
                            在指定目录中直接运行
                        </span>
                    </div>
                </label>

                {/* Worktree 会话 */}
                <div className="flex items-center gap-2">
                    <Radio
                        checked={sessionType === 'worktree'}
                        onChange={() => onSessionTypeChange('worktree')}
                        disabled={isDisabled}
                    />
                    <div className="flex-1">
                        {sessionType === 'worktree' ? (
                            <Input
                                ref={worktreeInputRef}
                                placeholder="输入 worktree 名称"
                                value={worktreeName}
                                onChange={(e) => onWorktreeNameChange(e.target.value)}
                                disabled={isDisabled}
                                className="w-full"
                            />
                        ) : (
                            <div className="flex flex-col">
                                <span className="text-sm">Worktree 会话</span>
                                <span className="text-xs text-gray-400">
                                    在 git worktree 中运行，隔离工作区
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
