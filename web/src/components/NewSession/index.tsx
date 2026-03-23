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
import { Alert } from 'antd'
import type { InputRef } from 'antd'
import type { Machine } from '@/api/types'
import type { Session } from '@mobi/shared'
import { useSessions } from '@/hooks/queries/useSessions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useActiveSuggestions, type Suggestion } from './useActiveSuggestions'
import { useDirectorySuggestions } from './useDirectorySuggestions'
import { useRecentPaths } from './useRecentPaths'
import type { AgentType, SessionType } from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { DirectorySection } from './DirectorySection'
import { MachineSelector } from './MachineSelector'
import { ModelSelector } from './ModelSelector'
import {
    loadPreferredAgent,
    loadPreferredYoloMode,
    savePreferredAgent,
    savePreferredYoloMode,
} from './preferences'
import { SessionTypeSelector } from './SessionTypeSelector'
import { YoloToggle } from './YoloToggle'

export interface NewSessionProps {
    /** 可选：外部传入的机器列表 */
    machines?: Machine[]
    /** 机器列表加载状态 */
    isLoading?: boolean
    /** 创建成功回调 */
    onSuccess: (sessionId: string) => void
    /** 取消回调 */
    onCancel: () => void
}

/**
 * 新建会话组件
 */
export function NewSession(props: NewSessionProps) {
    // 获取会话列表用于目录建议
    const { data: sessionsData } = useSessions()
    const sessions: Session[] = sessionsData ?? []

    // 获取机器列表（如果没有外部传入）
    const { machines: fetchedMachines, isLoading: machinesLoading } = useMachines()
    const machines = props.machines ?? fetchedMachines
    const isLoading = props.isLoading ?? machinesLoading

    // 创建会话 mutation
    const { spawnSession, isPending, error: spawnError } = useSpawnSession()
    const isFormDisabled = Boolean(isPending || isLoading)

    // 最近路径管理
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
    const [directoryCreationConfirmed, setDirectoryCreationConfirmed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const worktreeInputRef = useRef<InputRef>(null)

    // Worktree 输入框自动聚焦
    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    // Agent 变化时重置模型
    useEffect(() => {
        setModel('auto')
    }, [agent])

    // 保存偏好设置
    useEffect(() => {
        savePreferredAgent(agent)
    }, [agent])

    useEffect(() => {
        savePreferredYoloMode(yoloMode)
    }, [yoloMode])

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

    // 选中的机器
    const selectedMachine = useMemo(
        () => (machineId ? machines.find((machine: Machine) => machine.id === machineId) ?? null : null),
        [machineId, machines]
    )

    // 最近路径
    const recentPaths = useMemo(
        () => getRecentPaths(machineId),
        [getRecentPaths, machineId]
    )

    // 目录建议
    const trimmedDirectory = directory.trim()
    const deferredDirectory = useDeferredValue(trimmedDirectory)
    const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)

    // 获取建议
    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return allPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [allPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory

    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )

    // 目录状态（简化版，不检查路径是否存在）
    const directoryStatusMessage = null
    const directoryStatusTone = null
    const createLabel = undefined

    // 机器变化处理
    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        const paths = getRecentPaths(newMachineId)
        if (paths[0]) {
            setDirectory(paths[0])
        } else {
            setDirectory('')
        }
    }, [getRecentPaths])

    // 路径点击处理
    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    // 建议选择处理
    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    // 目录输入变化处理
    const handleDirectoryChange = useCallback((value: string) => {
        setSuppressSuggestions(false)
        setDirectory(value)
    }, [])

    // 目录焦点处理
    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    // 目录键盘事件处理
    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    // 创建会话处理
    async function handleCreate() {
        if (!machineId || !trimmedDirectory) return

        setError(null)
        try {
            const resolvedModel = model !== 'auto' ? model : undefined
            // Mobi 目前当前仅支持 Claude，不使用 modelReasoningEffort
            const resolvedModelReasoningEffort = undefined

            const result = await spawnSession({
                machineId,
                directory: trimmedDirectory,
                agent,
                model: resolvedModel,
                modelReasoningEffort: resolvedModelReasoningEffort,
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
        <div className="flex flex-col divide-y divide-gray-200">
            {/* 机器选择 */}
            <MachineSelector
                machines={machines}
                machineId={machineId}
                isLoading={isLoading}
                isDisabled={isFormDisabled}
                onChange={handleMachineChange}
            />

            {/* 目录输入 */}
            <DirectorySection
                directory={directory}
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                isDisabled={isFormDisabled}
                recentPaths={recentPaths}
                statusMessage={directoryStatusMessage}
                statusTone={directoryStatusTone}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
            />

            {/* 会话类型 */}
            <SessionTypeSelector
                sessionType={sessionType}
                worktreeName={worktreeName}
                worktreeInputRef={worktreeInputRef}
                isDisabled={isFormDisabled}
                onSessionTypeChange={setSessionType}
                onWorktreeNameChange={setWorktreeName}
            />

            {/* Agent 选择 */}
            <AgentSelector
                agent={agent}
                isDisabled={isFormDisabled}
                onAgentChange={setAgent}
            />

            {/* 模型选择 */}
            <ModelSelector
                agent={agent}
                model={model}
                isDisabled={isFormDisabled}
                onModelChange={setModel}
            />

            {/* YOLO 模式 */}
            <YoloToggle
                yoloMode={yoloMode}
                isDisabled={isFormDisabled}
                onToggle={setYoloMode}
            />

            {/* 错误提示 */}
            {(error ?? spawnError) ? (
                <div className="px-3 py-2">
                    <Alert
                        message={error ?? spawnError}
                        type="error"
                        showIcon
                    />
                </div>
            ) : null}

            {/* 操作按钮 */}
            <ActionButtons
                isPending={isPending}
                canCreate={canCreate}
                isDisabled={isFormDisabled}
                createLabel={createLabel}
                onCancel={props.onCancel}
                onCreate={handleCreate}
            />
        </div>
    )
}

// 导出子组件和类型
export { useActiveWord, useCursorPosition } from './useActiveWord'
export { useActiveSuggestions } from './useActiveSuggestions'
export { useDirectorySuggestions } from './useDirectorySuggestions'
export { useRecentPaths } from './useRecentPaths'
export type { Suggestion } from './useActiveSuggestions'
export type { AgentType, SessionType } from './types'
