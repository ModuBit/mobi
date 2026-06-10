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

import { AutoComplete, Dropdown, Popover, theme } from 'antd'
import { Monitor, FolderOpen } from 'lucide-react'
import styled from '@emotion/styled'
import { shouldNotForwardDollarProps } from '@/core/lib/styledUtils'

/* ========== 样式组件 ========== */

const PillButton = styled.button<{ $bg: string; $hoverBg: string; $color: string }>`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 10px;
    border-radius: 12px;
    border: none;
    background: ${props => props.$bg};
    color: ${props => props.$color};
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;

    &:hover {
        background: ${props => props.$hoverBg};
    }
`

/* ========== 辅助函数 ========== */

/**
 * 从目录路径提取项目名（取最后一段）
 */
export function extractProjectName(directory: string): string {
    const trimmed = directory.replace(/\/+$/, '')
    const lastSlash = trimmed.lastIndexOf('/')
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/* ========== 类型 ========== */

interface EnvironmentBarProps {
    /** 机器选项 */
    machineOptions: { value: string; label: string }[]
    /** 当前选中的机器 ID */
    selectedMachineId: string | null
    /** 机器选择变更 */
    onMachineChange: (id: string) => void
    /** 目录选项 */
    directoryOptions: { value: string; label: string }[]
    /** 当前选中的目录 */
    selectedDirectory: string
    /** 目录选择变更 */
    onDirectoryChange: (dir: string) => void
}

/* ========== 组件 ========== */

/**
 * 环境选择栏
 * 在 NewSessionPage 中位于 Sender 上方，用于选择机器和项目目录
 */
export function EnvironmentBar(props: EnvironmentBarProps) {
    const { token } = theme.useToken()
    const {
        machineOptions,
        selectedMachineId,
        onMachineChange,
        directoryOptions,
        selectedDirectory,
        onDirectoryChange,
    } = props

    const displayDirName = selectedDirectory ? extractProjectName(selectedDirectory) : null

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 8px 4px',
            fontSize: 12,
        }}>
            {/* 机器选择 */}
            <Dropdown
                menu={{
                    items: machineOptions.map(opt => ({ key: opt.value, label: opt.label })),
                    selectedKeys: selectedMachineId ? [selectedMachineId] : [],
                    onClick: ({ key }) => onMachineChange(key),
                }}
                trigger={['click']}
            >
                <PillButton
                    $bg={token.colorFillTertiary}
                    $hoverBg={token.colorFillSecondary}
                    $color={token.colorTextSecondary}
                >
                    <Monitor size={12} />
                    {selectedMachineId
                        ? (machineOptions.find(m => m.value === selectedMachineId)?.label ?? '选择机器')
                        : '选择机器'}
                </PillButton>
            </Dropdown>

            {/* 目录选择 */}
            <Popover
                content={
                    <AutoComplete
                        value={selectedDirectory}
                        onChange={onDirectoryChange}
                        options={directoryOptions}
                        style={{ minWidth: 250 }}
                        placeholder="输入项目/目录路径"
                        autoFocus
                    />
                }
                trigger={['click']}
                placement="bottomLeft"
            >
                <PillButton
                    $bg={token.colorFillTertiary}
                    $hoverBg={token.colorFillSecondary}
                    $color={token.colorTextSecondary}
                >
                    <FolderOpen size={12} />
                    {displayDirName || '项目/目录'}
                </PillButton>
            </Popover>
        </div>
    )
}
