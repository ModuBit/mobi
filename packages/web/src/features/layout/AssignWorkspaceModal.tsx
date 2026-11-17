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

import { useState, useEffect } from 'react'
import { App, Typography } from 'antd'
import { Button } from '@/ui/base/interactive/button/Button'
import { AdaptiveDialog } from '@/ui/base/interactive/adaptiveDialog/AdaptiveDialog'
import { RadioCards } from '@/ui/shadcn/radio-cards/radio-cards'
import { useTranslation } from 'react-i18next'
import { FolderOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useAssignSessionWorkspace } from '@/core/data/hooks/mutations/useWorkspaceMutations'
import type { Session } from '@/core/data/api/types'

const { Text } = Typography

export interface AssignWorkspaceModalProps {
    /** 待归入工作区的会话 */
    session: Session | null
    open: boolean
    onClose: () => void
}

/** 「归入工作区」弹窗（单机：原「同机器过滤」随 machine 概念移除退场，全量工作区可选） */
export function AssignWorkspaceModal({ session, open, onClose }: AssignWorkspaceModalProps) {
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const { data: workspaces = [] } = useWorkspaces()
    const assignMutation = useAssignSessionWorkspace()


    const [selected, setSelected] = useState<string | null>(null)
    const isMobile = useIsMobile()

    // 打开时重置选择，避免上次选择残留
    useEffect(() => {
        if (open) setSelected(null)
    }, [open, session?.id])

    // 提交归属变更。PC 走 RadioCards 选中 + 确认；mobile 点行即提交（无独立确定按钮）
    const handlePick = async (workspaceId: string) => {
        if (!session) return
        try {
            await assignMutation.mutateAsync({ sessionId: session.id, workspaceId })
            messageApi.success(t('common.success'))
            onClose()
        } catch {
            messageApi.error(t('common.error'))
        }
    }

    // 端别自适应（PC 居中 Dialog / 移动端底部 sheet）由 AdaptiveDialog 收口：
    // - PC：RadioCards 单选 + 取消/确认双钮
    // - mobile：大点按行、点行即提交（无独立确定按钮）——列表型面板一眼看全，
    //   打开即到内容高；手势返回哨兵由壳内置
    const mobileRows = workspaces.length === 0 ? (
        <Text type="secondary">{t('workspace.assignEmpty')}</Text>
    ) : (
        <div style={{ margin: '4px 0' }}>
            {workspaces.map(workspace => (
                <Button
                    key={workspace.id}
                    variant="ghost"
                    disabled={assignMutation.isPending}
                    block
                    style={{ height: 48, justifyContent: 'flex-start', paddingInline: 0 }}
                    onClick={() => handlePick(workspace.id)}
                >
                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <span>
                            <FolderOutlined style={{ marginRight: 6 }} />
                            {workspace.name}
                        </span>
                        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                            {workspace.folders.find(f => f.primary)?.path}
                        </Text>
                    </span>
                </Button>
            ))}
        </div>
    )

    const desktopBody = workspaces.length === 0 ? (
        <Text type="secondary">{t('workspace.assignEmpty')}</Text>
    ) : (
        <RadioCards
            aria-label={t('workspace.assignTitle')}
            layout="list"
            value={selected}
            onValueChange={setSelected}
            options={workspaces.map(workspace => ({
                value: workspace.id,
                label: workspace.name,
                description: workspace.folders.find(f => f.primary)?.path,
                icon: <FolderOutlined style={{ fontSize: 18 }} aria-hidden="true" />
            }))}
            style={{ margin: '8px 0' }}
        />
    )

    return (
        <AdaptiveDialog
            open={open}
            onOpenChange={(next) => { if (!next) onClose() }}
            title={t('workspace.assignTitle')}
            width={520}
            body={isMobile ? mobileRows : desktopBody}
            footer={isMobile ? undefined : (
                <>
                    <Button variant="secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!selected}
                        loading={assignMutation.isPending}
                        onClick={() => selected && handlePick(selected)}
                    >
                        {t('common.confirm')}
                    </Button>
                </>
            )}
        />
    )
}
