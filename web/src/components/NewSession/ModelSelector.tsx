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

import { Select } from 'antd'
import type { AgentType } from './types'
import { MODEL_OPTIONS } from './types'

export interface ModelSelectorProps {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
}

/**
 * 模型选择器组件
 */
export function ModelSelector({
    agent,
    model,
    isDisabled,
    onModelChange
}: ModelSelectorProps) {
    const options = MODEL_OPTIONS[agent]

    if (!options || options.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                模型
                <span className="font-normal text-gray-400 ml-1">(可选)</span>
            </label>
            <Select
                value={model}
                onChange={onModelChange}
                disabled={isDisabled}
                className="w-full"
                options={options.map(opt => ({
                    value: opt.value,
                    label: opt.label
                }))}
            />
        </div>
    )
}
