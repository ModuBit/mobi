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

import { useMemo, useState, useEffect } from 'react'
import { App, Button, Modal, Radio, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { FolderOutlined } from '@ant-design/icons'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useProjects } from '@/core/data/hooks/queries/useProjects'
import { useAssignSessionProject } from '@/core/data/hooks/mutations/useProjectMutations'
import type { Session } from '@/core/data/api/types'

const { Text } = Typography

export interface AssignProjectModalProps {
    /** 待归入项目的会话 */
    session: Session | null
    open: boolean
    onClose: () => void
}

/**
 * 「归入项目」弹窗
 *
 * 会话只能归入与其同机器的项目（项目 folders 是机器本地路径，跨机器无意义），
 * 故选项按 session.metadata.machineId 过滤
 */
export function AssignProjectModal({ session, open, onClose }: AssignProjectModalProps) {
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const { data: projects = [] } = useProjects()
    const assignMutation = useAssignSessionProject()

    const machineId = (session?.metadata as { machineId?: string } | null | undefined)?.machineId
    // 只列同机器项目
    const machineProjects = useMemo(
        () => projects.filter(p => p.machineId === machineId),
        [projects, machineId],
    )

    const [selected, setSelected] = useState<string | null>(null)
    const isMobile = useIsMobile()

    // 打开时重置选择，避免上次选择残留
    useEffect(() => {
        if (open) setSelected(null)
    }, [open, session?.id])

    // 提交归属变更。PC 走 Modal onOk（先 Radio 选中再确认）；
    // mobile 点行即提交（无独立确定按钮）
    const handlePick = async (projectId: string) => {
        if (!session) return
        try {
            await assignMutation.mutateAsync({ sessionId: session.id, projectId })
            messageApi.success(t('common.success'))
            onClose()
        } catch {
            messageApi.error(t('common.error'))
        }
    }

    // mobile：底部 Drawer 大点按行，点行即提交。
    // 手势返回哨兵由 MobileDrawer 内置（组件不变量），无需额外接线
    if (isMobile) {
        return (
            <MobileDrawer open={open} onClose={onClose} title={t('project.assignTitle')}>
                {machineProjects.length === 0 ? (
                    <Text type="secondary" style={{ padding: '16px 20px', display: 'block' }}>
                        {t('project.assignEmpty')}
                    </Text>
                ) : (
                    <div style={{ padding: '8px 0' }}>
                        {machineProjects.map(project => (
                            <Button
                                key={project.id}
                                type="text"
                                block
                                disabled={assignMutation.isPending}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={() => handlePick(project.id)}
                            >
                                <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                                    <span>
                                        <FolderOutlined style={{ marginRight: 6 }} />
                                        {project.name}
                                    </span>
                                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                                        {project.folders.find(f => f.primary)?.path}
                                    </Text>
                                </span>
                            </Button>
                        ))}
                    </div>
                )}
            </MobileDrawer>
        )
    }

    return (
        <Modal
            title={t('project.assignTitle')}
            open={open}
            onOk={() => selected && handlePick(selected)}
            onCancel={onClose}
            confirmLoading={assignMutation.isPending}
            okButtonProps={{ disabled: !selected }}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            destroyOnHidden
        >
            {machineProjects.length === 0 ? (
                <Text type="secondary">{t('project.assignEmpty')}</Text>
            ) : (
                <Radio.Group
                    value={selected ?? undefined}
                    onChange={(e) => setSelected(e.target.value)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}
                >
                    {machineProjects.map(project => (
                        <Radio key={project.id} value={project.id}>
                            <FolderOutlined style={{ marginRight: 6 }} />
                            <span>{project.name}</span>
                            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                                {project.folders.find(f => f.primary)?.path}
                            </Text>
                        </Radio>
                    ))}
                </Radio.Group>
            )}
        </Modal>
    )
}
