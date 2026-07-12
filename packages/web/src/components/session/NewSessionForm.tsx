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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Alert,
    AutoComplete,
    Button,
    Form,
    Input,
    Radio,
    Select,
    Spin,
    Switch,
    Tag,
    Tooltip,
    Typography,
} from 'antd'
import { DesktopOutlined, FolderOutlined, HistoryOutlined, HomeOutlined, LoadingOutlined } from '@ant-design/icons'
import type { InputRef } from 'antd'
import type { AutoCompleteProps } from 'antd'
import type { Machine } from '@/core/data/api/types'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useSpawnSession } from '@/core/data/hooks/mutations/useSpawnSession'
import { useMachineDirectoryListing, parsePrefixInput } from './useMachineDirectoryListing'
import { useRecentPaths } from './useRecentPaths'
import type { AgentType, SessionType } from '@/domain/session/types'
import { CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import { getEffortOptions, type EffortLevel } from '@mobi/shared'
import {
    loadPreferredAgent,
    loadPreferredEffort,
    loadPreferredModel,
    loadPreferredYoloMode,
    savePreferredAgent,
    savePreferredEffort,
    savePreferredModel,
    savePreferredYoloMode,
} from '@/domain/session/preferences'

export interface NewSessionProps {
    machines?: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}

const { Text } = Typography

/**
 * 获取机器显示名称
 */
function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

function startEllipsis(path: string, maxLen = 40): string {
    if (path.length <= maxLen) return path
    return `...${path.slice(-(maxLen - 3))}`
}

/**
 * 新建会话组件
 */
export function NewSession(props: NewSessionProps) {
    const { t } = useTranslation()
    useSessions()

    const { machines: fetchedMachines, isLoading: machinesLoading } = useMachines()
    const machines = props.machines ?? fetchedMachines
    const isLoading = props.isLoading ?? machinesLoading

    const { spawnSession, isPending, error: spawnError } = useSpawnSession()
    const isFormDisabled = Boolean(isPending || isLoading)

    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()

    // 表单状态
    const [machineId, setMachineId] = useState<string | null>(null)
    const [directory, setDirectory] = useState('')
    const [agent, setAgent] = useState<AgentType>(loadPreferredAgent)
    const [model, setModel] = useState(loadPreferredModel)
    const [yoloMode, setYoloMode] = useState(loadPreferredYoloMode)
    const [effort, setEffort] = useState<EffortLevel>(loadPreferredEffort)
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

    // Agent 变化时加载该 agent 的模型偏好
    useEffect(() => { setModel(loadPreferredModel()) }, [agent])

    // 保存偏好设置
    useEffect(() => { savePreferredAgent(agent) }, [agent])
    useEffect(() => { savePreferredModel(model) }, [model])
    useEffect(() => { savePreferredYoloMode(yoloMode) }, [yoloMode])
    useEffect(() => { savePreferredEffort(effort) }, [effort])

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
    const currentMachine = machines.find((m: Machine) => m.id === machineId)
    const machineHomeDir = currentMachine?.metadata?.homeDir
    const { options: directoryOptions, isLoading: isDirectoryLoading } = useMachineDirectoryListing(machineId, directory, machineHomeDir)

    // 目录下拉受控：选中目录后子目录加载完成时自动展开
    const [directoryOpen, setDirectoryOpen] = useState(false)
    const pendingOpenRef = useRef(false)

    useEffect(() => {
        if (pendingOpenRef.current && directoryOptions.length > 0) {
            pendingOpenRef.current = false
            setDirectoryOpen(true)
        }
    }, [directoryOptions])

    // 机器变化
    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        const paths = getRecentPaths(newMachineId)
        setDirectory(paths[0] || '')
    }, [getRecentPaths])

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
                effort,
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
            setError(result.type === 'error' ? (result.message ?? t('newSession.createFailed')) : t('newSession.createFailed'))
        } catch (e) {
            setError(e instanceof Error ? e.message : t('newSession.createFailed'))
        }
    }

    const autoCompleteOptions: AutoCompleteProps['options'] = useMemo(() => {
        if (!directory.trim()) {
            // 空输入：homeDir 始终第一 + 最近使用路径
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
                .filter((path) => path !== machineHomeDir)
                .slice(0, 5)
                .map((path) => ({
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

        // 有输入：显示子目录，高亮匹配前缀
        const parsed = parsePrefixInput(directory)
        const currentPrefix = parsed?.prefix ?? ''
        const lowerPrefix = currentPrefix.toLowerCase()

        return directoryOptions.map((opt) => {
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
    }, [directory, recentPaths, directoryOptions, machineHomeDir])

    const canCreate = Boolean(machineId && trimmedDirectory && !isFormDisabled)
    // 只有一个可选机器时隐藏机器选择器（init effect 已自动选中）
    const showMachineSelect = machines.length > 1

    return (
        <Form layout="vertical" style={{ padding: '16px' }} requiredMark={false}>
            {showMachineSelect && (
                <Form.Item label={<><DesktopOutlined style={{ marginRight: 4 }} />{t('newSession.machine')}</>}>
                    <Select
                        value={machineId ?? undefined}
                        onChange={handleMachineChange}
                        disabled={isFormDisabled}
                        loading={isLoading}
                        placeholder={isLoading ? t('newSession.machineLoading') : t('newSession.machinePlaceholder')}
                        notFoundContent={isLoading ? <Spin size="small" /> : t('newSession.machineEmpty')}
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
            )}

            <Form.Item label={<><FolderOutlined style={{ marginRight: 4 }} />{t('newSession.workDirectory')}</>}>
                <AutoComplete
                    open={directoryOpen && autoCompleteOptions.length > 0}
                    onOpenChange={(open) => {
                        if (!open && pendingOpenRef.current) return
                        setDirectoryOpen(open)
                    }}
                    options={autoCompleteOptions}
                    placeholder={t('newSession.directoryPlaceholder')}
                    value={directory}
                    onChange={(value) => {
                        setDirectory(value)
                        pendingOpenRef.current = false
                    }}
                    onSelect={(value) => {
                        setDirectory(value.endsWith('/') ? value : `${value}/`)
                        pendingOpenRef.current = true
                    }}
                    onBlur={() => {
                        pendingOpenRef.current = false
                        setDirectoryOpen(false)
                    }}
                    defaultActiveFirstOption
                    suffixIcon={isDirectoryLoading ? <LoadingOutlined /> : undefined}
                    disabled={isFormDisabled}
                    style={{ width: '100%' }}
                    popupMatchSelectWidth={false}
                />
                {recentPaths.length > 0 && (
                    <div style={{ marginTop: 8, lineHeight: '2em' }}>
                        {recentPaths.slice(0, 5).map((path) => (
                            <Tooltip key={path} title={path} mouseEnterDelay={0.3}>
                                <Tag
                                    onClick={() => setDirectory(path)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    {startEllipsis(path)}
                                </Tag>
                            </Tooltip>
                        ))}
                    </div>
                )}
            </Form.Item>

            <Form.Item label={t('newSession.sessionType')}>
                <Radio.Group
                    value={sessionType}
                    onChange={(e) => setSessionType(e.target.value)}
                    disabled={isFormDisabled}
                >
                    <Radio value="simple">
                        {t('newSession.simpleSession')}
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('newSession.simpleSessionDesc')}</Text>
                    </Radio>
                    <Radio value="worktree" style={{ marginTop: 8 }}>
                        {t('newSession.worktreeSession')}
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('newSession.worktreeSessionDesc')}</Text>
                    </Radio>
                </Radio.Group>
                {sessionType === 'worktree' && (
                    <Input
                        ref={worktreeInputRef}
                        placeholder={t('newSession.worktreeNamePlaceholder')}
                        value={worktreeName}
                        onChange={(e) => setWorktreeName(e.target.value)}
                        disabled={isFormDisabled}
                        style={{ marginTop: 8 }}
                    />
                )}
            </Form.Item>

            <Form.Item label={t('newSession.agent')}>
                <Radio.Group
                    value={agent}
                    onChange={(e) => setAgent(e.target.value)}
                    disabled={isFormDisabled}
                >
                    <Radio value="claude">Claude</Radio>
                    <Tooltip title={t('newSession.codexComingSoon')}>
                        <Radio value="codex" disabled>Codex</Radio>
                    </Tooltip>
                </Radio.Group>
            </Form.Item>

            {agent === 'claude' && (
                <Form.Item label={<span>{t('newSession.model')} <Text type="secondary" style={{ fontWeight: 400 }}>({t('newSession.modelOptional')})</Text></span>}>
                    <Select
                        value={model}
                        onChange={setModel}
                        disabled={isFormDisabled}
                        options={CLAUDE_MODEL_FALLBACK.map(opt => ({
                            value: opt.value,
                            label: opt.displayName,
                        }))}
                    />
                </Form.Item>
            )}

            {agent === 'claude' && (
                <Form.Item label={t('newSession.effort')}>
                    <Select
                        value={effort}
                        onChange={setEffort}
                        options={getEffortOptions()}
                        style={{ width: '100%' }}
                        disabled={isFormDisabled}
                    />
                </Form.Item>
            )}

            <Form.Item label={t('newSession.autoMode')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div>{t('newSession.yoloMode')}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('newSession.yoloModeDesc')}</Text>
                    </div>
                    <Switch checked={yoloMode} onChange={setYoloMode} disabled={isFormDisabled} />
                </div>
            </Form.Item>

            {(error ?? spawnError) && (
                <Alert
                    message={error ?? spawnError}
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Form.Item style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={props.onCancel} disabled={isFormDisabled}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        type="primary"
                        onClick={handleCreate}
                        disabled={!canCreate}
                        loading={isPending}
                    >
                        {t('newSession.create')}
                    </Button>
                </div>
            </Form.Item>
        </Form>
    )
}

// 导出子组件和类型
export { useRecentPaths } from './useRecentPaths'
export type { AgentType, SessionType } from '@/domain/session/types'
