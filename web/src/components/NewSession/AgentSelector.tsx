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

import { Radio } from 'antd'
import type { AgentType } from './types'

export interface AgentSelectorProps {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}

/**
 * Agent 选择器组件
 * 目前 Mobi 当前仅支持 Claude，保留扩展接口
 */
export function AgentSelector({
    agent,
    isDisabled,
    onAgentChange
}: AgentSelectorProps) {
    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                Agent
            </label>
            <Radio.Group
                value={agent}
                onChange={(e) => onAgentChange(e.target.value)}
                disabled={isDisabled}
            >
                <Radio value="claude">Claude</Radio>
            </Radio.Group>
        </div>
    )
}
