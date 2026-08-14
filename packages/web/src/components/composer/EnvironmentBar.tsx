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

import { useTranslation } from 'react-i18next'
import { Button, Divider, Select, theme } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { DesktopOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'

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
    /** 全量项目（跨机器——机器由所选项目派生，不再单独选择） */
    projects: Array<{ id: string; name: string }>
    /** 当前选中的项目 ID（未选 = gate 未通过） */
    selectedProjectId: string | null
    /** 项目选择变更 */
    onProjectChange: (projectId: string) => void
    /** 点击下拉底部「+ 新建项目」（打开 ProjectFormModal，完成后由父组件回填选中） */
    onCreateProject?: () => void
    /** 选中项目的机器显示名（只读回显，仅展示用） */
    machineLabel?: string
    /** 选中项目的主目录（只读回显，仅展示用） */
    directoryLabel?: string
    /** 是否禁用 */
    disabled?: boolean
}

/* ========== 组件 ========== */

/**
 * 环境选择栏：项目即环境
 * 在 NewSessionPage 中位于 Sender 上方——新建会话必须选项目，
 * 机器与工作目录从项目派生（primary folder），不再提供手动选择/输入。
 * 项目下拉可搜索，底部固定「+ 新建项目」入口。
 */
export function EnvironmentBar(props: EnvironmentBarProps) {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const {
        projects,
        selectedProjectId,
        onProjectChange,
        onCreateProject,
        machineLabel,
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
            {/* 项目选择（必选）：机器 + 工作目录由项目派生 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
            }}>
                <FolderOpenOutlined style={{ color: token.colorTextQuaternary, fontSize: 12, flexShrink: 0 }} />
                <Select
                    value={selectedProjectId ?? undefined}
                    onChange={onProjectChange}
                    disabled={disabled}
                    placeholder={t('newSession.projectPlaceholder')}
                    size="small"
                    variant="borderless"
                    showSearch
                    optionFilterProp="label"
                    options={projects.map(p => ({ value: p.id, label: p.name }))}
                    notFoundContent={t('project.empty')}
                    style={{ flex: 1, minWidth: 0 }}
                    popupRender={(menu) => (
                        <>
                            {menu}
                            {/* 底部固定「+ 新建项目」：与侧边栏新建项目共用 ProjectFormModal，
                                完成后由父组件自动回填选中 */}
                            <Divider style={{ margin: '4px 0' }} />
                            <Button
                                block
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                disabled={disabled}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={onCreateProject}
                            >
                                {t('project.create')}
                            </Button>
                        </>
                    )}
                />
            </div>

            {/* 派生环境只读回显：机器 + 主目录（选中项目后展示） */}
            {selectedProjectId && (machineLabel || directoryLabel) && (
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
                            {machineLabel}{directoryLabel ? ` · ${directoryLabel}` : ''}
                        </span>
                    </AppTooltip>
                </div>
            )}
        </div>
    )
}
