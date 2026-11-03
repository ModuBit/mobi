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

import type React from 'react'
import { useCallback, useState } from 'react'
import { App, theme as antTheme } from 'antd'
import { ChevronRight, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useAssignSessionWorkspace, useDeleteWorkspace } from '@/core/data/hooks/mutations/useWorkspaceMutations'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useSetSessionPinned } from '@/core/data/hooks/mutations/useSessionPinned'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useMobiApi } from '@/core/data/api/client'
import { resumeSession } from '@/core/data/sessionResume'
import { dormantSessionWithFeedback, dormancyBlockedText, extractBlockers } from '@/core/data/sessionDormancy'
import { useSessionArchive } from '@/core/data/hooks/mutations/useSessionArchive'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'
import { WorkspaceFormModal } from '@/ui/shared/WorkspaceFormModal'
import { AssignWorkspaceModal } from '@/features/layout/AssignWorkspaceModal'
import type { Session, Workspace } from '@/core/data/api/types'
import {
    Container, SectionTitleRow, SectionTitle, SectionChevron, SectionActionButton,
    SessionListWrapper, SessionListInner,
} from './sidebarWorkspaces.styles'
import { WorkspaceGroup } from './WorkspaceGroup'
import { RecentGroup } from './RecentGroup'
import { PinnedGroup } from './PinnedGroup'
import { ArchivedGroupEntry } from './ArchivedGroupEntry'
import { useSessionDelete } from './useSessionDelete'
import { SessionListFooter } from './SessionListFooter'
import { useSectionExpanded } from './useSectionExpanded'
import { usePagedSectionList } from './usePagedSectionList'

const { useToken } = antTheme

/**
 * 侧边栏工作区分组会话列表
 * 「置顶」「工作区」「最近」三个平级分区，每个分区可折叠、空分区默认收起。
 * 置顶是纯展示维度分组（不改归属）：置顶 → 进「置顶」区并从「工作区」「最近」过滤掉，取消反向
 */
export function SidebarWorkspaces() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { message: messageApi, modal } = App.useApp()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // 重命名状态
    const { startRename, renamingSessionId, renameValue, setRenameValue, cancelRename } = useUiStore()
    const renameActions = useSessionActions(renamingSessionId)

    // 工作区管理状态
    const { data: workspaces = [] } = useWorkspaces()
    // 「工作区」分区折叠：有工作区默认展开、空分区默认收起，用户 toggle 后持久生效
    const {
        expanded: workspacesExpanded,
        toggleExpanded: toggleWorkspacesExpanded,
    } = useSectionExpanded(workspaces.length > 0)
    // 工作区列表前端分页：默认 5 个，超出 footer 展开剩余 / 收起（数据仍全量拉取）
    const {
        visibleItems: visibleWorkspaces, showCollapse, canShowMore, remainingCount, showMore, collapse,
    } = usePagedSectionList(workspaces)
    const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
    const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
    const [assignSession, setAssignSession] = useState<Session | null>(null)

    const assignMutation = useAssignSessionWorkspace()
    const deleteWorkspaceMutation = useDeleteWorkspace()
    const pinMutation = useSetSessionPinned()

    // 确认重命名
    const handleRenameConfirm = useCallback(async () => {
        if (!renameValue.trim() || !renamingSessionId) {
            messageApi.error(t('session.actions.nameRequired'))
            return
        }
        try {
            await renameActions.renameSession(renameValue.trim())
            messageApi.success(t('common.success'))
            await invalidateSessionViews(queryClient, [renamingSessionId])
            cancelRename()
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [renameValue, renamingSessionId, renameActions, t, queryClient, cancelRename, messageApi])

    // 手动休眠（dormancy spec §D.11）：动作流收口在 sessionDormancy（gate 阻塞时展示
    // 逐项原因，无强制退出路径），这里只管 pending 态
    const [dormantPendingId, setDormantPendingId] = useState<string | null>(null)
    const handleDormant = useCallback((session: Session) => {
        setDormantPendingId(session.id)
        void dormantSessionWithFeedback({ api, queryClient, t, message: messageApi }, session.id, () => setDormantPendingId(null))
    }, [api, t, queryClient, messageApi])

    // 归档（session-retention 票 04）：在线会话 daemon 先自动休眠，gate 阻塞 409 透出原因；
    // 成功后会话从主列表消失（行消失本身即反馈，不再 toast）
    const { archive } = useSessionArchive()
    const [archivePendingId, setArchivePendingId] = useState<string | null>(null)
    const handleArchive = useCallback((session: Session) => {
        setArchivePendingId(session.id)
        archive.mutate(session.id, {
            onError: (error) => {
                const blockers = extractBlockers(error)
                if (blockers.length > 0) {
                    messageApi.warning(dormancyBlockedText(blockers, t, 'session.archive.blocked'))
                } else {
                    messageApi.error(t('common.error'))
                }
            },
            onSettled: () => setArchivePendingId(null),
        })
    }, [archive, t, messageApi])

    // 恢复会话（未活跃时），成功后跳转详情页
    const handleResume = useCallback(async (session: Session) => {
        try {
            const resumedSessionId = await resumeSession(api, session.id, queryClient)
            messageApi.success(t('common.success'))
            navigate({ to: '/sessions/$sessionId', params: { sessionId: resumedSessionId } })
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [api, queryClient, t, navigate, messageApi])

    // 删除会话（动作流收口在 useSessionDelete，与归档页共用）
    const handleDelete = useSessionDelete()

    // ===== 工作区管理 =====

    // 打开新建工作区弹窗（分区标题行可折叠，阻断冒泡避免连带触发）
    const handleOpenCreateWorkspace = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingWorkspace(null)
        setWorkspaceModalOpen(true)
    }, [])

    // 打开编辑工作区弹窗
    const handleOpenEditWorkspace = useCallback((workspace: Workspace) => {
        setEditingWorkspace(workspace)
        setWorkspaceModalOpen(true)
    }, [])

    // 删除工作区：名下会话解绑进「最近」（total 未就绪时用不含数字的退化文案，不编造 0）
    const handleDeleteWorkspace = useCallback((workspace: Workspace, total: number | undefined) => {
        modal.confirm({
            title: t('workspace.deleteConfirmTitle', { name: workspace.name }),
            content: total === undefined
                ? t('workspace.deleteConfirmContentFallback')
                : t('workspace.deleteConfirmContent', { count: total }),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await deleteWorkspaceMutation.mutateAsync(workspace.id)
                    messageApi.success(t('common.success'))
                } catch {
                    messageApi.error(t('common.error'))
                }
            },
        })
    }, [t, deleteWorkspaceMutation, messageApi])

    // 移至最近（解除归属）
    const handleMoveToRecent = useCallback(async (session: Session) => {
        try {
            await assignMutation.mutateAsync({ sessionId: session.id, workspaceId: null })
            messageApi.success(t('common.success'))
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [assignMutation, t, messageApi])

    // 换工作区 / 归入工作区（打开弹窗，选项按会话机器过滤）
    const handleOpenAssign = useCallback((session: Session) => {
        setAssignSession(session)
    }, [])

    // 正在变更归属的会话 id：mutation pending 时取其 variables（目标行），空闲时为 undefined
    const assignPendingSessionId = assignMutation.isPending
        ? assignMutation.variables?.sessionId
        : undefined

    // 置顶 / 取消置顶（所有分组通用的行内操作，失败提示与归入工作区一致）
    const handleTogglePin = useCallback(async (session: Session) => {
        try {
            await pinMutation.mutateAsync({ sessionId: session.id, pinned: !session.pinned })
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [pinMutation, t, messageApi])

    // 正在变更置顶态的会话 id（仅该行禁用，其余行不受牵连）
    const pinPendingSessionId = pinMutation.isPending
        ? pinMutation.variables?.sessionId
        : undefined

    const sharedProps = {
        activeSessionId,
        renamingSessionId,
        renameValue,
        setRenameValue,
        onRenameConfirm: handleRenameConfirm,
        onRenameCancel: cancelRename,
        onDormant: handleDormant,
        dormantPendingSessionId: dormantPendingId,
        onArchive: handleArchive,
        archivePendingSessionId: archivePendingId,
        onResume: handleResume,
        onDelete: handleDelete,
        onRenameStart: startRename,
        renameLoading: renameActions.isPending,
        onTogglePin: handleTogglePin,
        pinPendingSessionId,
    }

    return (
        <Container>
            {/* 「置顶」分区：跨工作区/游离的置顶会话，三个平级分区之首 */}
            <PinnedGroup {...sharedProps} />

            <SectionTitleRow
                role="button"
                aria-expanded={workspacesExpanded}
                onClick={toggleWorkspacesExpanded}
            >
                <SectionChevron $token={token} $expanded={workspacesExpanded}>
                    <ChevronRight size={12} />
                </SectionChevron>
                <SectionTitle $token={token}>{t('nav.workspaces')}</SectionTitle>
                <SectionActionButton
                    $token={token}
                    className="section-extra"
                    title={t('nav.newWorkspace')}
                    onClick={handleOpenCreateWorkspace}
                >
                    <Plus size={12} />
                </SectionActionButton>
            </SectionTitleRow>
            <SessionListWrapper $expanded={workspacesExpanded}>
                <SessionListInner>
                    {visibleWorkspaces.map(workspace => (
                        <WorkspaceGroup
                            key={workspace.id}
                            workspace={workspace}
                            {...sharedProps}
                            onEditWorkspace={handleOpenEditWorkspace}
                            onDeleteWorkspace={handleDeleteWorkspace}
                            onMoveToRecent={handleMoveToRecent}
                            onChangeWorkspace={handleOpenAssign}
                            assignPendingSessionId={assignPendingSessionId}
                        />
                    ))}
                    {(showCollapse || canShowMore) && (
                        <SessionListFooter
                            variant="desktop"
                            canShowMore={canShowMore}
                            remainingCount={remainingCount}
                            isLoadingMore={false}
                            showCollapse={showCollapse}
                            onShowMore={showMore}
                            onCollapse={collapse}
                        />
                    )}
                </SessionListInner>
            </SessionListWrapper>
            <RecentGroup
                {...sharedProps}
                onAssign={handleOpenAssign}
                assignPendingSessionId={assignPendingSessionId}
            />
            {/* 「已归档」入口：最近之后的唯一一行，右侧主内容区打开归档页（票 05） */}
            <ArchivedGroupEntry />

            {/* 新建/编辑工作区弹窗 */}
            <WorkspaceFormModal
                open={workspaceModalOpen}
                onClose={() => setWorkspaceModalOpen(false)}
                workspace={editingWorkspace}
            />

            {/* 归入工作区弹窗（只列与会话同机器的工作区） */}
            <AssignWorkspaceModal
                session={assignSession}
                open={!!assignSession}
                onClose={() => setAssignSession(null)}
            />
        </Container>
    )
}
