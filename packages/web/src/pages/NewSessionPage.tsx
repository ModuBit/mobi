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

import { useState, useCallback, useMemo } from 'react'
import { App, theme as antTheme, Dropdown, Spin, AutoComplete, Popover } from 'antd'
import { Sender } from '@ant-design/x'
import { FolderOpen, Monitor, Cpu, ChevronDown } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import styled from '@emotion/styled'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useSpawnSession, type SpawnInput } from '@/core/data/hooks/mutations/useSpawnSession'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import {
    loadPreferredAgent,
    savePreferredAgent,
    loadPreferredModel,
    savePreferredModel,
    loadPreferredEffort,
    savePreferredEffort,
    loadPreferredPermissionMode,
    savePreferredPermissionMode,
} from '@/domain/session/preferences'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { type AgentType, CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import {
    type EffortLevel,
    type PermissionMode,
    EFFORT_LEVELS,
    EFFORT_LABELS,
    PERMISSION_MODES,
    PERMISSION_MODE_LABELS,
} from '@mobi/shared'

const { useToken } = antTheme

/**
 * 从目录路径提取项目名（取最后一段）
 */
function extractProjectName(directory: string): string {
    const trimmed = directory.replace(/\/+$/, '')
    const lastSlash = trimmed.lastIndexOf('/')
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/* ========== 样式组件 ========== */

const PageContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    position: relative;
`

const SidebarToggleWrapper = styled.div`
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
`

const ContentWrapper = styled.div`
    max-width: 720px;
    width: 100%;
    padding: 0 24px;
`

const TitleBar = styled.div<{ $color: string }>`
    text-align: center;
    font-size: 24px;
    font-weight: 600;
    color: ${props => props.$color};
    line-height: 1.4;
    margin-bottom: 32px;
`

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

const SubBar = styled.div<{ $bg: string }>`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    align-items: center;
    background: ${props => props.$bg};
    border-bottom-left-radius: var(--ant-border-radius, 8px);
    border-bottom-right-radius: var(--ant-border-radius, 8px);
    margin: -10px 4px 0;
    padding-top: 14px;
    position: relative;
    z-index: 0;
`

/* ========== 常量 ========== */

const PERMISSION_OPTIONS = PERMISSION_MODES.map(m => ({
    value: m,
    label: PERMISSION_MODE_LABELS[m],
}))

const EFFORT_OPTIONS = EFFORT_LEVELS.map(e => ({
    value: e,
    label: EFFORT_LABELS[e],
}))

const MODEL_OPTIONS = CLAUDE_MODEL_FALLBACK.map(m => ({
    value: m.value,
    label: m.displayName,
}))

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
]

/* ========== 紧凑药丸下拉 ========== */

function PillDropdown({ value, options, onChange, icon, placeholder }: {
    value: string
    options: { value: string; label: string }[]
    onChange: (v: string) => void
    icon?: React.ReactNode
    placeholder?: string
}) {
    const { token } = antTheme.useToken()
    const selectedOption = options.find(o => o.value === value)
    const label = selectedOption?.label ?? (placeholder || value)

    return (
        <Dropdown
            menu={{
                items: options.map(opt => ({ key: opt.value, label: opt.label })),
                selectedKeys: value ? [value] : [],
                onClick: ({ key }) => onChange(key as string),
            }}
            trigger={['click']}
        >
            <PillButton
                $bg={token.colorFillTertiary}
                $hoverBg={token.colorFillSecondary}
                $color={token.colorTextSecondary}
            >
                {icon}
                {label}
                <ChevronDown size={10} style={{ opacity: 0.5 }} />
            </PillButton>
        </Dropdown>
    )
}

/* ========== 目录选择药丸 ========== */

function DirectoryPill({ value, onChange, options }: {
    value: string
    onChange: (v: string) => void
    options: { value: string; label: string }[]
}) {
    const { token } = antTheme.useToken()
    const displayName = value ? extractProjectName(value) : null

    return (
        <Popover
            content={
                <AutoComplete
                    value={value}
                    onChange={onChange}
                    options={options}
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
                {displayName || '项目/目录'}
                <ChevronDown size={10} style={{ opacity: 0.5 }} />
            </PillButton>
        </Popover>
    )
}

/* ========== 页面组件 ========== */

/**
 * 新建会话页面
 * 居中布局，参考 Codex 风格：输入框 → 功能配置行 → 环境配置灰条
 */
export function NewSessionPage() {
    const { token } = useToken()
    const { message } = App.useApp()
    const navigate = useNavigate()

    // 偏好配置（初始化从 localStorage 加载）
    const [agent, setAgent] = useState<AgentType>(() => loadPreferredAgent())
    const [model, setModel] = useState(() => loadPreferredModel())
    const [effort, setEffort] = useState<EffortLevel>(() => loadPreferredEffort())
    const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => loadPreferredPermissionMode())

    // 环境配置
    const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
    const [selectedDirectory, setSelectedDirectory] = useState('')
    const [inputText, setInputText] = useState('')

    // 数据
    const { machines, isLoading: isLoadingMachines } = useMachines()
    const { spawnSession, isPending } = useSpawnSession()
    const { options: directoryOptions } = useMachineDirectoryListing(
        selectedMachineId,
        selectedDirectory,
    )

    const activeMachines = machines.filter(m => m.active)

    // 动态标题
    const projectName = selectedDirectory ? extractProjectName(selectedDirectory) : null

    const title = useMemo(() => {
        const titles = projectName
            ? [`我们想在 ${projectName} 中构建什么？`, `来聊聊 ${projectName} 吧`, `在 ${projectName} 中开始新对话`]
            : ['你想做什么？', '有什么新想法？', '开始一段新对话']
        return titles[Math.floor(Math.random() * titles.length)]
    }, [projectName])

    // 发送
    const handleSend = useCallback(async () => {
        if (!inputText.trim() || !selectedMachineId || isPending) return

        // 持久化配置
        savePreferredAgent(agent)
        savePreferredModel(model)
        savePreferredEffort(effort)
        savePreferredPermissionMode(permissionMode)

        // 创建会话
        const input: SpawnInput = {
            machineId: selectedMachineId,
            directory: selectedDirectory || '/',
            agent,
            model: model === 'auto' ? undefined : model,
            effort,
            yolo: permissionMode === 'bypassPermissions',
        }

        const result = await spawnSession(input)

        if (result.type === 'success' && result.sessionId) {
            navigate({ to: '/sessions/$sessionId', params: { sessionId: result.sessionId } })
        } else if (result.type === 'error') {
            message.error(result.message || '创建会话失败')
        }
    }, [
        inputText, selectedMachineId, selectedDirectory, agent, model, effort,
        permissionMode, isPending, spawnSession, navigate, message,
    ])

    const canSend = inputText.trim().length > 0 && !!selectedMachineId && !isPending

    // 机器选项
    const machineOptions = activeMachines.map(m => ({
        value: m.id,
        label: m.metadata?.displayName || m.metadata?.host || m.id,
    }))

    if (isLoadingMachines) {
        return (
            <PageContainer>
                <Spin size="large" />
            </PageContainer>
        )
    }

    return (
        <PageContainer>
            <SidebarToggleWrapper>
                <SidebarToggle />
                <MobileMenuButton />
            </SidebarToggleWrapper>
            <ContentWrapper>
                <TitleBar $color={token.colorText}>
                    {title}
                </TitleBar>

                <div style={{ position: 'relative' }}>
                    {/* 输入框 + 功能配置行 */}
                    <Sender
                        value={inputText}
                        onChange={setInputText}
                        onSubmit={() => { handleSend() }}
                        placeholder="随心输入..."
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        loading={isPending}
                        footer={(oriNode) => (
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                                padding: '8px 12px',
                                alignItems: 'center',
                            }}>
                                <PillDropdown
                                    value={permissionMode}
                                    options={PERMISSION_OPTIONS}
                                    onChange={(v) => setPermissionMode(v as PermissionMode)}
                                />
                                <PillDropdown
                                    value={effort}
                                    options={EFFORT_OPTIONS}
                                    onChange={(v) => setEffort(v as EffortLevel)}
                                />
                                <PillDropdown
                                    value={model}
                                    options={MODEL_OPTIONS}
                                    onChange={setModel}
                                />
                                <div style={{ flex: 1 }} />
                                {oriNode}
                            </div>
                        )}
                    />

                    {/* 环境配置灰条 */}
                    <SubBar $bg={token.colorFillQuaternary}>
                        <DirectoryPill
                            value={selectedDirectory}
                            onChange={setSelectedDirectory}
                            options={directoryOptions.map(d => ({
                                value: d.value,
                                label: d.label,
                            }))}
                        />
                        <PillDropdown
                            value={agent}
                            options={AGENT_OPTIONS}
                            onChange={(v) => setAgent(v as AgentType)}
                            icon={<Cpu size={12} />}
                        />
                        <PillDropdown
                            value={selectedMachineId ?? ''}
                            options={machineOptions}
                            onChange={setSelectedMachineId}
                            placeholder="选择机器"
                            icon={<Monitor size={12} />}
                        />
                    </SubBar>
                </div>
            </ContentWrapper>
        </PageContainer>
    )
}
