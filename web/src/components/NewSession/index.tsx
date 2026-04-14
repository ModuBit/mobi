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

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
    Alert,
    Button,
    Form,
    Input,
    Radio,
    Select,
    Spin,
    Switch,
    Tag,
    Typography,
} from 'antd'
import { DesktopOutlined, FolderOutlined } from '@ant-design/icons'
import type { InputRef } from 'antd'
import type { Machine } from '@/api/types'
import type { Session } from '@mobi/shared'
import { useSessions } from '@/hooks/queries/useSessions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSpawnSession, type SpawnInput } from '@/hooks/mutations/useSpawnSession'
import { useActiveSuggestions, type Suggestion } from './useActiveSuggestions'
import { useDirectorySuggestions } from './useDirectorySuggestions'
import { useRecentPaths } from './useRecentPaths'
import type { AgentType, SessionType } from './types'
import { MODEL_OPTIONS } from './types'
import {
    loadPreferredAgent,
    loadPreferredYoloMode,
    savePreferredAgent,
    savePreferredYoloMode,
} from './preferences'

export interface NewSessionProps {
    machines?: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}

const { Text, Paragraph } = Typography

/**
 * 获取机器显示名称
 */
function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

/**
 * 新建会话组件
 */
export function NewSession(props: NewSessionProps) {
    const { data: sessionsData } = useSessions()
    const sessions: Session[] = sessionsData ?? []

    const { machines: fetchedMachines, isLoading: machinesLoading } = useMachines()
    const machines = props.machines ?? fetchedMachines
    const isLoading = props.isLoading ?? machinesLoading

    const { spawnSession, isPending, error: spawnError } = useSpawnSession()
    const isFormDisabled = Boolean(isPending || isLoading)

    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()

    // 表单状态
    const [machineId, setMachineId] = useState<string | null>(null)
    const [directory, setDirectory] = useState('')
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const [agent, setAgent] = useState<AgentType>(loadPreferredAgent)
    const [model, setModel] = useState('auto')
    const [yoloMode, setYoloMode] = useState(loadPreferredYoloMode)
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const worktreeInputRef = useRef<InputRef>(null)

    // Worktree 输入框自动聚焦
    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    // Agent 变化时重置模型
    useEffect(() => { setModel('auto') }, [agent])

    // 保存偏好设置
    useEffect(() => { savePreferredAgent(agent) }, [agent])
    useEffect(() => { savePreferredYoloMode(yoloMode) }, [yoloMode])

    // 初始化机器选择
    useEffect(() => {
        if (machines.length === 0) return
        if (machineId && machines.find((m: Machine) => m.id === machineId)) return
        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? machines.find((m: Machine) => m.id === lastUsed) : null
        if (foundLast) {
            setMachineId(foundLast.id)
            const paths = getRecentPaths(foundLast.id)
            if (paths[0]) setDirectory(paths[0])
        } else if (machines[0]) {
            setMachineId(machines[0].id)
        }
    }, [machines, machineId, getLastUsedMachineId, getRecentPaths])

    // 最近路径 & 目录建议
    const recentPaths = useMemo(() => getRecentPaths(machineId), [getRecentPaths, machineId])
    const trimmedDirectory = directory.trim()
    const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return allPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({ key: path, text: path, label: path }))
    }, [allPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery, getSuggestions, { allowEmptyQuery: true, autoSelectFirst: false }
    )

    // 机器变化
    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        const paths = getRecentPaths(newMachineId)
        setDirectory(paths[0] || '')
    }, [getRecentPaths])

    // 目录建议选择
    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return
        if (event.key === 'ArrowUp') { event.preventDefault(); moveUp() }
        if (event.key === 'ArrowDown') { event.preventDefault(); moveDown() }
        if ((event.key === 'Enter' || event.key === 'Tab') && selectedIndex >= 0) {
            event.preventDefault(); handleSuggestionSelect(selectedIndex)
        }
        if (event.key === 'Escape') clearSuggestions()
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    // 创建会话
    async function handleCreate() {
        if (!machineId || !trimmedDirectory) return
        setError(null)
        try {
            const result = await spawnSession({
                machineId,
                directory: trimmedDirectory,
                agent,
                model: model !== 'auto' ? model : undefined,
                yolo: yoloMode,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined
            })
            if (result.type === 'success' && result.sessionId) {
                setLastUsedMachineId(machineId)
                addRecentPath(machineId, trimmedDirectory)
                props.onSuccess(result.sessionId)
                return
            }
            setError(result.message ?? '创建会话失败')
        } catch (e) {
            setError(e instanceof Error ? e.message : '创建会话失败')
        }
    }

    const canCreate = Boolean(machineId && trimmedDirectory && !isFormDisabled)

    return (
        <Form layout="vertical" style={{ padding: '16px' }} requiredMark={false}>
            {/* 机器选择 */}
            <Form.Item label={<><DesktopOutlined style={{ marginRight: 4 }} />机器</>}>
                <Select
                    value={machineId ?? undefined}
                    onChange={handleMachineChange}
                    disabled={isFormDisabled}
                    loading={isLoading}
                    placeholder={isLoading ? '加载中...' : '选择机器'}
                    notFoundContent={isLoading ? <Spin size="small" /> : '暂无可用机器'}
                    options={machines.map(m => ({
                        value: m.id,
                        label: (
                            <span>
                                {getMachineTitle(m)}
                                {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
                            </span>
                        )
                    }))}
                />
            </Form.Item>

            {/* 工作目录 */}
            <Form.Item label={<><FolderOutlined style={{ marginRight: 4 }} />工作目录</>}>
                <div style={{ position: 'relative' }}>
                    <Input
                        placeholder="输入工作目录路径"
                        value={directory}
                        onChange={(e) => { setSuppressSuggestions(false); setDirectory(e.target.value) }}
                        onKeyDown={handleDirectoryKeyDown}
                        onFocus={() => { setSuppressSuggestions(false); setIsDirectoryFocused(true) }}
                        onBlur={() => setIsDirectoryFocused(false)}
                        disabled={isFormDisabled}
                    />
                    {/* 目录建议下拉 */}
                    {suggestions.length > 0 && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0,
                            zIndex: 10, marginTop: 4,
                            background: 'var(--ant-colorBgContainer)',
                            border: '1px solid var(--ant-colorBorder)',
                            borderRadius: 6,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                            maxHeight: 192, overflow: 'auto',
                        }}>
                            {suggestions.map((suggestion, index) => (
                                <div
                                    key={suggestion.key}
                                    onClick={() => handleSuggestionSelect(index)}
                                    style={{
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        background: index === selectedIndex ? 'var(--ant-colorPrimaryBg)' : 'transparent',
                                        color: index === selectedIndex ? 'var(--ant-colorPrimary)' : 'inherit',
                                    }}
                                >
                                    {suggestion.text}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {/* 最近路径 */}
                {recentPaths.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {recentPaths.slice(0, 5).map((path) => (
                            <Tag
                                key={path}
                                onClick={() => setDirectory(path)}
                                style={{ cursor: 'pointer', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                {path}
                            </Tag>
                        ))}
                    </div>
                )}
            </Form.Item>

            {/* 会话类型 */}
            <Form.Item label="会话类型">
                <Radio.Group
                    value={sessionType}
                    onChange={(e) => setSessionType(e.target.value)}
                    disabled={isFormDisabled}
                >
                    <Radio value="simple">
                        <span>普通会话</span>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>在指定目录中直接运行</Text>
                    </Radio>
                    <Radio value="worktree" style={{ marginTop: 8 }}>
                        <span>Worktree 会话</span>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>在 git worktree 中运行，隔离工作区</Text>
                    </Radio>
                </Radio.Group>
                {sessionType === 'worktree' && (
                    <Input
                        ref={worktreeInputRef}
                        placeholder="输入 worktree 名称"
                        value={worktreeName}
                        onChange={(e) => setWorktreeName(e.target.value)}
                        disabled={isFormDisabled}
                        style={{ marginTop: 8 }}
                    />
                )}
            </Form.Item>

            {/* Agent 选择 */}
            <Form.Item label="Agent">
                <Radio.Group
                    value={agent}
                    onChange={(e) => setAgent(e.target.value)}
                    disabled={isFormDisabled}
                >
                    <Radio value="claude">Claude</Radio>
                </Radio.Group>
            </Form.Item>

            {/* 模型选择 */}
            {MODEL_OPTIONS[agent] && MODEL_OPTIONS[agent].length > 0 && (
                <Form.Item label={<span>模型 <Text type="secondary" style={{ fontWeight: 400 }}>(可选)</Text></span>}>
                    <Select
                        value={model}
                        onChange={setModel}
                        disabled={isFormDisabled}
                        options={MODEL_OPTIONS[agent].map(opt => ({
                            value: opt.value,
                            label: opt.label,
                        }))}
                    />
                </Form.Item>
            )}

            {/* YOLO 模式 */}
            <Form.Item label="自动模式">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div>YOLO 模式</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>启用后自动执行所有操作，无需确认</Text>
                    </div>
                    <Switch checked={yoloMode} onChange={setYoloMode} disabled={isFormDisabled} />
                </div>
            </Form.Item>

            {/* 错误提示 */}
            {(error ?? spawnError) && (
                <Alert
                    message={error ?? spawnError}
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            {/* 操作按钮 */}
            <Form.Item style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={props.onCancel} disabled={isFormDisabled}>
                        取消
                    </Button>
                    <Button
                        type="primary"
                        onClick={handleCreate}
                        disabled={!canCreate}
                        loading={isPending}
                    >
                        创建会话
                    </Button>
                </div>
            </Form.Item>
        </Form>
    )
}

// 导出子组件和类型
export { useActiveWord, useCursorPosition } from './useActiveWord'
export { useActiveSuggestions } from './useActiveSuggestions'
export { useDirectorySuggestions } from './useDirectorySuggestions'
export { useRecentPaths } from './useRecentPaths'
export type { Suggestion } from './useActiveSuggestions'
export type { AgentType, SessionType } from './types'
