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
import { App, AutoComplete, Input, Select, Spin, theme as antTheme } from 'antd'
import { Send, FolderOpen } from 'lucide-react'
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
    height: 100%;
    padding: 24px;
    position: relative;
`

const SidebarToggleWrapper = styled.div`
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
`

const SenderCard = styled.div<{ $bg: string; $border: string }>`
    max-width: 720px;
    width: 100%;
    background: ${props => props.$bg};
    border: 1px solid ${props => props.$border};
    border-radius: 16px;
    overflow: hidden;
`

const TitleBar = styled.div<{ $color: string }>`
    padding: 28px 28px 20px;
    text-align: center;
    font-size: 20px;
    font-weight: 600;
    color: ${props => props.$color};
    line-height: 1.4;
`

const ConfigRow = styled.div<{ $border: string }>`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid ${props => props.$border};
    align-items: center;
`

const ConfigItem = styled.div<{ $color: string }>`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: ${props => props.$color};

    .ant-select {
        min-width: 100px;
    }
`

const InputRow = styled.div`
    display: flex;
    align-items: flex-end;
    padding: 12px 16px;
    gap: 8px;
`

const InputWrapper = styled.div`
    flex: 1;
`

const SendButton = styled.button<{ $primary: string; $hover: string }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: ${props => props.$primary};
    color: #fff;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.2s;

    &:hover {
        opacity: 0.85;
    }

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
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

/**
 * 新建会话页面
 * 居中 sender 布局，配置项内嵌在 sender 上方
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

    // Enter 发送，Shift+Enter 换行
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void handleSend()
        }
    }, [handleSend])

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
            <SenderCard $bg={token.colorBgContainer} $border={token.colorBorderSecondary}>
                {/* 动态标题 */}
                <TitleBar $color={token.colorText}>
                    {title}
                </TitleBar>

                {/* 配置栏第一行：功能配置 */}
                <ConfigRow $border={token.colorBorderSecondary}>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <span>权限</span>
                        <Select
                            size="small"
                            value={permissionMode}
                            onChange={setPermissionMode}
                            options={PERMISSION_OPTIONS}
                            style={{ minWidth: 130 }}
                            popupMatchSelectWidth={false}
                        />
                    </ConfigItem>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <span>推理</span>
                        <Select
                            size="small"
                            value={effort}
                            onChange={setEffort}
                            options={EFFORT_OPTIONS}
                            style={{ minWidth: 100 }}
                        />
                    </ConfigItem>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <span>模型</span>
                        <Select
                            size="small"
                            value={model}
                            onChange={setModel}
                            options={MODEL_OPTIONS}
                            style={{ minWidth: 100 }}
                        />
                    </ConfigItem>
                </ConfigRow>

                {/* 配置栏第二行：环境配置 */}
                <ConfigRow $border={token.colorBorderSecondary}>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <FolderOpen size={14} />
                        <AutoComplete
                            size="small"
                            placeholder="项目/目录"
                            value={selectedDirectory}
                            onChange={setSelectedDirectory}
                            options={directoryOptions.map(d => ({
                                value: d.value,
                                label: d.label,
                            }))}
                            style={{ minWidth: 200 }}
                            popupMatchSelectWidth={false}
                        />
                    </ConfigItem>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <span>Agent</span>
                        <Select
                            size="small"
                            value={agent}
                            onChange={setAgent}
                            options={AGENT_OPTIONS}
                            style={{ minWidth: 120 }}
                        />
                    </ConfigItem>
                    <ConfigItem $color={token.colorTextSecondary}>
                        <span>机器</span>
                        <Select
                            size="small"
                            showSearch
                            placeholder="选择机器"
                            value={selectedMachineId || undefined}
                            onChange={setSelectedMachineId}
                            options={machineOptions}
                            style={{ minWidth: 140 }}
                            popupMatchSelectWidth={false}
                        />
                    </ConfigItem>
                </ConfigRow>

                {/* 输入框 + 发送按钮 */}
                <InputRow>
                    <InputWrapper>
                        <Input.TextArea
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="随心输入..."
                            autoSize={{ minRows: 1, maxRows: 6 }}
                            style={{ borderRadius: 8 }}
                            disabled={isPending}
                        />
                    </InputWrapper>
                    <SendButton
                        $primary={token.colorPrimary}
                        $hover={token.colorPrimaryHover}
                        onClick={handleSend}
                        disabled={!canSend}
                        aria-label="发送"
                    >
                        <Send size={16} />
                    </SendButton>
                </InputRow>
            </SenderCard>
        </PageContainer>
    )
}
