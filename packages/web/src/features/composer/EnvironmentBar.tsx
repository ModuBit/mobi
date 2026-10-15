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

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { Monitor, FolderOpen, Plus } from 'lucide-react'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { Combobox } from '@/ui/base/interactive/combobox/Combobox'

/**
 * 从目录路径提取工作区名（取最后一段）
 */
export function extractWorkspaceName(directory: string): string {
    const trimmed = directory.replace(/\/+$/, '')
    const lastSlash = trimmed.lastIndexOf('/')
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/* ========== 类型 ========== */

interface EnvironmentBarProps {
    /** 全量工作区（跨机器——机器由所选工作区派生，不再单独选择） */
    workspaces: Array<{ id: string; name: string }>
    /** 当前选中的工作区 ID（未选 = gate 未通过） */
    selectedWorkspaceId: string | null
    /** 工作区选择变更 */
    onWorkspaceChange: (workspaceId: string) => void
    /** 点击下拉底部「+ 新建工作区」（打开 WorkspaceFormModal，完成后由父组件回填选中） */
    onCreateWorkspace?: () => void
    /** 选中工作区的宿主显示名（displayName → hostname，只读回显，仅展示用） */
    hostLabel?: string
    /** 选中工作区的主目录（只读回显，仅展示用） */
    directoryLabel?: string
    /** 是否禁用 */
    disabled?: boolean
}

/** 弹层底部「+ 新建工作区」（Combobox footer）：与侧边栏新建工作区共用 WorkspaceFormModal */
const CreateButton = styled.button`
    display: flex; width: 100%; min-height: 30px; align-items: center; justify-content: center; gap: 6px;
    border: 0; border-radius: calc(var(--radius-control) - 4px);
    background: transparent; color: var(--foreground); font: inherit; font-size: var(--text-sm);
    cursor: pointer; transition: background-color var(--duration-fast) var(--ease-standard);
    @media (hover: hover) and (pointer: fine) { &:hover:not(:disabled) { background: var(--surface-muted); } }
    &:active:not(:disabled) { background: color-mix(in oklab, var(--surface-muted), var(--border) 55%); }
    &:disabled { opacity: .45; cursor: not-allowed; }
`

/* ========== 组件 ========== */

/**
 * 环境选择栏：工作区即环境
 * 在 NewSessionPage 中位于 Sender 上方——新建会话必须选工作区，
 * 机器与工作目录从工作区派生（primary folder），不再提供手动选择/输入。
 * 工作区下拉可搜索（Combobox 输入过滤，2026-10-15 由 Select 换回——搜索是明确需求，
 * showSearch 在 Select 迁移时被裁掉的交互由 Combobox 的输入框形态恢复），
 * 底部固定「+ 新建工作区」入口（footer）。
 */
export function EnvironmentBar(props: EnvironmentBarProps) {
    const { t } = useTranslation()
    // 受控 open：点下拉底部「+ 新建工作区」时需主动收起下拉，否则弹窗关闭后浮层残留
    const [selectOpen, setSelectOpen] = useState(false)
    const {
        workspaces,
        selectedWorkspaceId,
        onWorkspaceChange,
        onCreateWorkspace,
        hostLabel,
        directoryLabel,
        disabled = false,
    } = props

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '4px 4px 6px',
        }}>
            {/* 工作区选择（必选）：机器 + 工作目录由工作区派生 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
            }}>
                <FolderOpen size={13} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
                {/* 工作区选择无「未选后清除」语义（父组件没有 null 接口），关清除钮；
                    受控 open：footer 点击先收起下拉再开新建弹窗，浮层不残留 */}
                <Combobox
                    aria-label={t('newSession.workspacePlaceholder')}
                    value={selectedWorkspaceId ?? ""}
                    onValueChange={(next) => { if (next) onWorkspaceChange(next) }}
                    open={selectOpen}
                    onOpenChange={setSelectOpen}
                    disabled={disabled}
                    placeholder={t('newSession.workspacePlaceholder')}
                    emptyMessage={t('workspace.empty')}
                    variant="borderless"
                    allowClear={false}
                    options={workspaces.map(p => ({ value: p.id, label: p.name }))}
                    style={{ flex: 1, minWidth: 0 }}
                    footer={onCreateWorkspace && (
                        <CreateButton
                            type="button"
                            disabled={disabled}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                // 先收起宿主下拉再打开新建工作区弹窗（点击在下拉内部不会自动收起）
                                setSelectOpen(false)
                                onCreateWorkspace()
                            }}
                        >
                            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                            {t('workspace.create')}
                        </CreateButton>
                    )}
                />
            </div>

            {/* 派生环境只读回显：机器 + 主目录（选中工作区后展示） */}
            {selectedWorkspaceId && (hostLabel || directoryLabel) && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}>
                    <Monitor size={13} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
                    <AppTooltip title={directoryLabel} mouseEnterDelay={0.3}>
                        <span style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                            {hostLabel}{directoryLabel ? ` · ${directoryLabel}` : ''}
                        </span>
                    </AppTooltip>
                </div>
            )}
        </div>
    )
}
