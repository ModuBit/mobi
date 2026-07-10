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

import { useEffect, useRef, useState } from 'react'
import { AutoComplete, Select, Tag, Tooltip, theme } from 'antd'
import { DesktopOutlined, FolderOutlined, HistoryOutlined, HomeOutlined, LoadingOutlined } from '@ant-design/icons'
import { parsePrefixInput, type DirectoryOption } from '@/components/session/useMachineDirectoryListing'
import type { Machine } from '@/core/data/api/types'

/**
 * 从目录路径提取项目名（取最后一段）
 */
export function extractProjectName(directory: string): string {
    const trimmed = directory.replace(/\/+$/, '')
    const lastSlash = trimmed.lastIndexOf('/')
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/**
 * 构建目录 AutoComplete 选项
 * 空输入时显示 homeDir + 最近路径；有输入时显示子目录并高亮匹配前缀
 */
export function buildDirectoryAutoCompleteOptions(
    directory: string,
    recentPaths: string[],
    directoryOptions: DirectoryOption[],
    machineHomeDir?: string,
): Array<{ value: string; label: React.ReactNode }> {
    if (!directory.trim()) {
        const items: Array<{ value: string; label: React.ReactNode }> = []

        if (machineHomeDir) {
            items.push({
                value: machineHomeDir,
                label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <HomeOutlined style={{ color: 'var(--ant-colorPrimary)' }} />
                        <span>{machineHomeDir}</span>
                    </div>
                ),
            })
        }

        const recentItems = recentPaths
            .filter(path => path !== machineHomeDir)
            .slice(0, 5)
            .map(path => ({
                value: path,
                label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <HistoryOutlined style={{ color: 'var(--ant-colorTextSecondary)' }} />
                        <span>{path}</span>
                    </div>
                ),
            }))

        return [...items, ...recentItems]
    }

    const parsed = parsePrefixInput(directory)
    const currentPrefix = parsed?.prefix ?? ''
    const lowerPrefix = currentPrefix.toLowerCase()

    return directoryOptions.map(opt => {
        const labelLower = opt.label.toLowerCase()
        const matchLen = lowerPrefix && labelLower.startsWith(lowerPrefix) ? lowerPrefix.length : 0

        return {
            value: opt.value,
            label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FolderOutlined style={{ color: 'var(--ant-colorTextSecondary)' }} />
                    {matchLen > 0 ? (
                        <span>
                            <span style={{ fontWeight: 600, color: 'var(--ant-colorPrimary)' }}>
                                {opt.label.slice(0, matchLen)}
                            </span>
                            <span>{opt.label.slice(matchLen)}</span>
                        </span>
                    ) : (
                        <span>{opt.label}</span>
                    )}
                </div>
            ),
        }
    })
}

/**
 * 获取机器显示名称
 */
export function getMachineTitle(machine: Pick<Machine, 'id' | 'metadata'>): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

/**
 * 路径过长时头部省略
 */
function startEllipsis(path: string, maxLen = 40): string {
    if (path.length <= maxLen) return path
    return `...${path.slice(-(maxLen - 3))}`
}

/* ========== 类型 ========== */

interface EnvironmentBarProps {
    /** 机器列表 */
    machines: Machine[]
    /** 是否加载中 */
    isLoading?: boolean
    /** 当前选中的机器 ID */
    selectedMachineId: string | null
    /** 机器选择变更 */
    onMachineChange: (id: string) => void
    /** 目录选项（来自 useMachineDirectoryListing） */
    directoryOptions: DirectoryOption[]
    /** 目录选项是否加载中 */
    isDirectoryLoading?: boolean
    /** 当前选中的目录 */
    selectedDirectory: string
    /** 目录选择变更（输入过程中实时触发） */
    onDirectoryChange: (dir: string) => void
    /** 目录确认（blur / 点击最近路径等明确选定动作） */
    onDirectoryConfirm?: (dir: string) => void
    /** 最近使用路径 */
    recentPaths: string[]
    /** 机器 homeDir */
    machineHomeDir?: string
    /** 移除最近路径 */
    onRemoveRecentPath?: (path: string) => void
    /** 是否禁用 */
    disabled?: boolean
}

/* ========== 组件 ========== */

/**
 * 环境选择栏
 * 在 NewSessionPage 中位于 Sender 上方，机器和工作目录各占一行
 * 交互复用 NewSessionForm 的模式（home 目录、最近路径、子目录匹配）
 */
export function EnvironmentBar(props: EnvironmentBarProps) {
    const { token } = theme.useToken()
    const {
        machines,
        isLoading = false,
        selectedMachineId,
        onMachineChange,
        directoryOptions,
        isDirectoryLoading = false,
        selectedDirectory,
        onDirectoryChange,
        onDirectoryConfirm,
        recentPaths,
        machineHomeDir,
        onRemoveRecentPath,
        disabled = false,
    } = props

    const activeMachines = machines.filter(m => m.active !== false)

    // 目录下拉受控：选中目录后子目录加载完成时自动展开
    const [, setDirectoryOpen] = useState(false)
    const pendingOpenRef = useRef(false)

    useEffect(() => {
        if (pendingOpenRef.current && directoryOptions.length > 0) {
            pendingOpenRef.current = false
            setDirectoryOpen(true)
        }
    }, [directoryOptions])

    // AutoComplete 选项
    const autoCompleteOptions = buildDirectoryAutoCompleteOptions(
        selectedDirectory,
        recentPaths,
        directoryOptions,
        machineHomeDir,
    )

    // 机器选项
    const machineSelectOptions = activeMachines.map(m => ({
        value: m.id,
        label: (
            <span>
                {getMachineTitle(m)}
                {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
            </span>
        ),
    }))

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '4px 4px 6px',
        }}>
            {/* 机器选择 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
            }}>
                <DesktopOutlined style={{ color: token.colorTextQuaternary, fontSize: 12, flexShrink: 0 }} />
                <Select
                    value={selectedMachineId ?? undefined}
                    onChange={onMachineChange}
                    disabled={disabled || isLoading}
                    loading={isLoading}
                    placeholder={isLoading ? '加载中...' : '选择机器'}
                    size="small"
                    variant="borderless"
                    options={machineSelectOptions}
                    suffixIcon={isLoading ? <LoadingOutlined /> : undefined}
                    style={{ flex: 1, minWidth: 0 }}
                />
            </div>

            {/* 工作目录 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
            }}>
                <FolderOutlined style={{ color: token.colorTextQuaternary, fontSize: 12, flexShrink: 0 }} />
                <AutoComplete
                    options={autoCompleteOptions}
                    placeholder="输入项目/目录路径"
                    value={selectedDirectory}
                    onChange={(value: string) => {
                        onDirectoryChange(value)
                        pendingOpenRef.current = false
                    }}
                    onSelect={(value: string) => {
                        const dir = value.endsWith('/') ? value : `${value}/`
                        onDirectoryChange(dir)
                        pendingOpenRef.current = true
                    }}
                    defaultActiveFirstOption
                    suffixIcon={isDirectoryLoading ? <LoadingOutlined /> : undefined}
                    disabled={disabled}
                    size="small"
                    variant="borderless"
                    style={{ flex: 1, minWidth: 0 }}
                    popupMatchSelectWidth={false}
                />
            </div>

            {/* 最近路径 */}
            {recentPaths.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    padding: '2px 0 0 18px',
                }}>
                    {recentPaths.slice(0, 5).map(path => (
                        <Tooltip key={path} title={path} mouseEnterDelay={0.3}>
                            <Tag
                                variant="filled"
                                closable={!!onRemoveRecentPath}
                                onClose={(e) => {
                                    e.stopPropagation()
                                    onRemoveRecentPath?.(path)
                                }}
                                onClick={() => {
                                    onDirectoryChange(path)
                                    onDirectoryConfirm?.(path)
                                }}
                                style={{
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    lineHeight: '18px',
                                    padding: '0 6px',
                                    margin: 0,
                                    color: token.colorTextSecondary,
                                    background: token.colorFillQuaternary,
                                }}
                            >
                                {startEllipsis(path, 30)}
                            </Tag>
                        </Tooltip>
                    ))}
                </div>
            )}
        </div>
    )
}
