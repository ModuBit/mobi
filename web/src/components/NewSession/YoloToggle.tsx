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

import { Switch } from 'antd'

export interface YoloToggleProps {
    yoloMode: boolean
    isDisabled: boolean
    onToggle: (value: boolean) => void
}

/**
 * YOLO 模式开关组件
 */
export function YoloToggle({
    yoloMode,
    isDisabled,
    onToggle
}: YoloToggleProps) {
    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                自动模式
            </label>
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                    <span className="text-sm">
                        YOLO 模式
                    </span>
                    <span className="text-xs text-gray-400">
                        启用后自动执行所有操作，无需确认
                    </span>
                </div>
                <Switch
                    checked={yoloMode}
                    onChange={onToggle}
                    disabled={isDisabled}
                />
            </div>
        </div>
    )
}
