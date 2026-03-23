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

import { memo, useCallback, useState } from 'react'
import { Dropdown, Modal, Input, message, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import {
    MoreOutlined,
    EditOutlined,
    DeleteOutlined,
    InboxOutlined,
    StopOutlined,
    PlayCircleOutlined,
    SwapOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import type { Session } from '@/api/types'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { IconButton } from '@/components/ui/IconButton'
import styled from '@emotion/styled'

const { useToken } = antTheme

const MenuButton = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: ${props => props.$token.borderRadius}px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
    }
`

interface SessionModuleProps {
    session: Session
    /** 是否显示为紧凑模式（用于卡片悬浮） */
    compact?: boolean
    /** 操作完成后的回调 */
    onActionComplete?: () => void
}

/**
 * 会话操作模块
 * 提供会话的归档、删除、重命名、中断等操作
 */
function SessionModuleInner({ session, compact = false, onActionComplete }: SessionModuleProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [renameModalOpen, setRenameModalOpen] = useState(false)
    const [newName, setNewName] = useState('')

    const {
        archiveSession,
        deleteSession,
        abortSession,
        resumeSession,
        switchSession,
        renameSession,
        isPending,
    } = useSessionActions(session.id)

    // 处理归档
    const handleArchive = useCallback(async () => {
        try {
            await archiveSession()
            message.success(t('common.success'))
            onActionComplete?.()
        } catch {
            message.error(t('common.error'))
        }
    }, [archiveSession, t, onActionComplete])

    // 处理删除
    const handleDelete = useCallback(() => {
        Modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await deleteSession()
                    message.success(t('common.success'))
                    // 删除后跳转到会话列表
                    navigate({ to: '/sessions' })
                    onActionComplete?.()
                } catch {
                    message.error(t('common.error'))
                }
            },
        })
    }, [deleteSession, navigate, t, onActionComplete])

    // 处理中断
    const handleAbort = useCallback(async () => {
        try {
            await abortSession()
            message.success(t('common.success'))
            onActionComplete?.()
        } catch {
            message.error(t('common.error'))
        }
    }, [abortSession, t, onActionComplete])

    // 处理恢复
    const handleResume = useCallback(async () => {
        try {
            const newSessionId = await resumeSession()
            message.success(t('common.success'))
            // 跳转到新会话
            navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
            onActionComplete?.()
        } catch {
            message.error(t('common.error'))
        }
    }, [resumeSession, navigate, t, onActionComplete])

    // 处理切换（remote/local 模式）
    const handleSwitch = useCallback(async () => {
        try {
            await switchSession()
            message.success(t('common.success'))
            onActionComplete?.()
        } catch {
            message.error(t('common.error'))
        }
    }, [switchSession, t, onActionComplete])

    // 打开重命名弹窗
    const handleOpenRename = useCallback(() => {
        setNewName(session.metadata?.name || '')
        setRenameModalOpen(true)
    }, [session.metadata?.name])

    // 确认重命名
    const handleRenameConfirm = useCallback(async () => {
        if (!newName.trim()) {
            message.error(t('session.actions.nameRequired'))
            return
        }
        try {
            await renameSession(newName.trim())
            message.success(t('common.success'))
            setRenameModalOpen(false)
            onActionComplete?.()
        } catch {
            message.error(t('common.error'))
        }
    }, [newName, renameSession, t, onActionComplete])

    // 构建菜单项
    const menuItems: MenuProps['items'] = [
        // 重命名
        {
            key: 'rename',
            icon: <EditOutlined />,
            label: t('session.actions.rename'),
            onClick: handleOpenRename,
        },
        // 归档
        {
            key: 'archive',
            icon: <InboxOutlined />,
            label: t('session.actions.archive'),
            onClick: handleArchive,
            disabled: isPending,
        },
        // 分割线
        { type: 'divider' },
        // 恢复（已结束的会话可用）
        !session.active && {
            key: 'resume',
            icon: <PlayCircleOutlined />,
            label: t('session.actions.resume'),
            onClick: handleResume,
            disabled: isPending,
        },
        // 中断（活跃的会话可用）
        session.active && {
            key: 'abort',
            icon: <StopOutlined />,
            label: t('session.actions.abort'),
            onClick: handleAbort,
            disabled: isPending,
            danger: true,
        },
        // 切换模式
        session.active && {
            key: 'switch',
            icon: <SwapOutlined />,
            label: t('session.actions.switch'),
            onClick: handleSwitch,
            disabled: isPending,
        },
        // 分割线
        { type: 'divider' },
        // 删除
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: t('session.actions.delete'),
            onClick: handleDelete,
            disabled: isPending,
            danger: true,
        },
    ].filter(Boolean) as MenuProps['items']

    return (
        <>
            <Dropdown
                menu={{ items: menuItems }}
                trigger={compact ? ['hover'] : ['click']}
                placement="bottomRight"
            >
                {compact ? (
                    <MenuButton $token={token}>
                        <MoreOutlined style={{ fontSize: 16 }} />
                    </MenuButton>
                ) : (
                    <IconButton
                        icon={<MoreOutlined style={{ fontSize: 18 }} />}
                        tooltip={t('session.actions.more')}
                        disabled={isPending}
                    />
                )}
            </Dropdown>

            {/* 重命名弹窗 */}
            <Modal
                title={t('session.actions.rename')}
                open={renameModalOpen}
                onOk={handleRenameConfirm}
                onCancel={() => setRenameModalOpen(false)}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                confirmLoading={isPending}
            >
                <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('session.actions.namePlaceholder')}
                    onPressEnter={handleRenameConfirm}
                    autoFocus
                />
            </Modal>
        </>
    )
}

export const SessionModule = memo(SessionModuleInner)
