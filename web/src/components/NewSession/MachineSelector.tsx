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

import { Select, Spin } from 'antd'
import { DesktopOutlined } from '@ant-design/icons'
import type { Machine } from '@/api/types'

/**
 * 获取机器显示名称
 */
function getMachineTitle(machine: Machine): string {
    // 使用 displayName 或 host 作为显示名称
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export interface MachineSelectorProps {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    onChange: (machineId: string) => void
}

/**
 * 机器选择器组件
 */
export function MachineSelector({
    machines,
    machineId,
    isLoading,
    isDisabled,
    onChange
}: MachineSelectorProps) {
    const options = machines.map(m => ({
        value: m.id,
        label: (
            <span>
                {getMachineTitle(m)}
                {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
            </span>
        )
    }))

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-gray-500">
                <DesktopOutlined className="mr-1" />
                机器
            </label>
            <Select
                value={machineId ?? undefined}
                onChange={onChange}
                disabled={isDisabled}
                loading={isLoading}
                placeholder={isLoading ? '加载中...' : '选择机器'}
                className="w-full"
                options={options}
                notFoundContent={
                    isLoading ? <Spin size="small" /> : '暂无可用机器'
                }
            />
        </div>
    )
}
