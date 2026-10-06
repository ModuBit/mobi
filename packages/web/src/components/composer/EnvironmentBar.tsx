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
import { Button, Divider, Select, theme } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { DesktopOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'

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

/* ========== 组件 ========== */

/**
 * 环境选择栏：工作区即环境
 * 在 NewSessionPage 中位于 Sender 上方——新建会话必须选工作区，
 * 机器与工作目录从工作区派生（primary folder），不再提供手动选择/输入。
 * 工作区下拉可搜索，底部固定「+ 新建工作区」入口。
 */
export function EnvironmentBar(props: EnvironmentBarProps) {
    const { token } = theme.useToken()
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
                <FolderOpenOutlined style={{ color: token.colorTextQuaternary, fontSize: 12, flexShrink: 0 }} />
                <Select
                    value={selectedWorkspaceId ?? undefined}
                    onChange={onWorkspaceChange}
                    open={selectOpen}
                    onOpenChange={setSelectOpen}
                    disabled={disabled}
                    placeholder={t('newSession.workspacePlaceholder')}
                    size="small"
                    variant="borderless"
                    showSearch
                    optionFilterProp="label"
                    options={workspaces.map(p => ({ value: p.id, label: p.name }))}
                    notFoundContent={t('workspace.empty')}
                    style={{ flex: 1, minWidth: 0 }}
                    popupRender={(menu) => (
                        <>
                            {menu}
                            {/* 底部固定「+ 新建工作区」：与侧边栏新建工作区共用 WorkspaceFormModal，
                                完成后由父组件自动回填选中 */}
                            <Divider style={{ margin: '4px 0' }} />
                            <Button
                                block
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                disabled={disabled}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    // 先收起宿主下拉再打开新建工作区弹窗（点击在下拉内部 antd 不会自动收起）
                                    setSelectOpen(false)
                                    onCreateWorkspace?.()
                                }}
                            >
                                {t('workspace.create')}
                            </Button>
                        </>
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
                    <DesktopOutlined style={{ color: token.colorTextQuaternary, fontSize: 12, flexShrink: 0 }} />
                    <AppTooltip title={directoryLabel} mouseEnterDelay={0.3}>
                        <span style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 12,
                            color: token.colorTextTertiary,
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
