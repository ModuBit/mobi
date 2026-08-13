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
import { App, Modal, Radio, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { FolderOutlined } from '@ant-design/icons'
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

    // 打开时重置选择，避免上次选择残留
    useEffect(() => {
        if (open) setSelected(null)
    }, [open, session?.id])

    const handleOk = async () => {
        if (!session || !selected) return
        try {
            await assignMutation.mutateAsync({ sessionId: session.id, projectId: selected })
            messageApi.success(t('common.success'))
            onClose()
        } catch {
            messageApi.error(t('common.error'))
        }
    }

    return (
        <Modal
            title={t('project.assignTitle')}
            open={open}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={assignMutation.isPending}
            okButtonProps={{ disabled: !selected }}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            destroyOnClose
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
