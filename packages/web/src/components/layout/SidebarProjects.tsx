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
import { App, Modal, theme as antTheme } from 'antd'
import { FolderAddOutlined } from '@ant-design/icons'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects } from '@/core/data/hooks/queries/useProjects'
import { useAssignSessionProject, useDeleteProject } from '@/core/data/hooks/mutations/useProjectMutations'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { ProjectFormModal } from '@/components/project/ProjectFormModal'
import { AssignProjectModal } from '@/components/project/AssignProjectModal'
import type { Session, Project } from '@/core/data/api/types'
import {
    Container, SectionTitleRow, SectionTitle, SectionChevron, SectionActionButton,
    SessionListWrapper, SessionListInner,
} from './sidebarProjects.styles'
import { ProjectGroup } from './ProjectGroup'
import { RecentGroup } from './RecentGroup'
import { useSectionExpanded } from './useSectionExpanded'

const { useToken } = antTheme

/**
 * 侧边栏项目分组会话列表
 * 「项目」「最近」两个平级分区（将来还会有「置顶」），每个分区可折叠、空分区默认收起
 */
export function SidebarProjects() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { message: messageApi } = App.useApp()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // 重命名状态
    const { startRename, renamingSessionId, renameValue, setRenameValue, cancelRename } = useUiStore()
    const renameActions = useSessionActions(renamingSessionId)

    // 项目管理状态
    const { data: projects = [] } = useProjects()
    // 「项目」分区折叠：有项目默认展开、空分区默认收起，用户 toggle 后持久生效
    const {
        expanded: projectsExpanded,
        toggleExpanded: toggleProjectsExpanded,
    } = useSectionExpanded(projects.length > 0)
    const [projectModalOpen, setProjectModalOpen] = useState(false)
    const [editingProject, setEditingProject] = useState<Project | null>(null)
    const [assignSession, setAssignSession] = useState<Session | null>(null)

    const assignMutation = useAssignSessionProject()
    const deleteProjectMutation = useDeleteProject()

    // 使缓存失效（项目维度视图由 invalidateProjectViews 统一收口）
    const invalidateAll = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            invalidateProjectViews(queryClient),
        ])
    }, [queryClient])

    // 确认重命名
    const handleRenameConfirm = useCallback(async () => {
        if (!renameValue.trim() || !renamingSessionId) {
            messageApi.error(t('session.actions.nameRequired'))
            return
        }
        try {
            await renameActions.renameSession(renameValue.trim())
            messageApi.success(t('common.success'))
            await invalidateAll(renamingSessionId)
            cancelRename()
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [renameValue, renamingSessionId, renameActions, t, invalidateAll, cancelRename, messageApi])

    // 退出会话
    const handleArchive = useCallback(async (session: Session) => {
        try {
            await api.sessions.archive(session.id)
            messageApi.success(t('common.success'))
            await invalidateAll(session.id)
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [api, t, invalidateAll, messageApi])

    // 恢复会话（未活跃时），成功后跳转详情页
    const handleResume = useCallback(async (session: Session) => {
        try {
            const res = await api.sessions.resume(session.id)
            messageApi.success(t('common.success'))
            await invalidateAll(session.id)
            navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [api, t, invalidateAll, navigate, messageApi])

    // 删除会话
    const handleDelete = useCallback((session: Session) => {
        Modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await api.sessions.delete(session.id)
                    messageApi.success(t('common.success'))
                    queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
                    clearMessageWindow(session.id)
                    await invalidateAll(session.id)
                    // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
                    clearSessionResources(session.id)
                    if (activeSessionId === session.id) {
                        navigate({ to: '/sessions' })
                    }
                } catch {
                    messageApi.error(t('common.error'))
                }
            },
        })
    }, [api, t, invalidateAll, queryClient, activeSessionId, navigate, messageApi])

    // ===== 项目管理 =====

    // 打开新建项目弹窗（分区标题行可折叠，阻断冒泡避免连带触发）
    const handleOpenCreateProject = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingProject(null)
        setProjectModalOpen(true)
    }, [])

    // 打开编辑项目弹窗
    const handleOpenEditProject = useCallback((project: Project) => {
        setEditingProject(project)
        setProjectModalOpen(true)
    }, [])

    // 删除项目：名下会话解绑进「最近」（total 未就绪时用不含数字的退化文案，不编造 0）
    const handleDeleteProject = useCallback((project: Project, total: number | undefined) => {
        Modal.confirm({
            title: t('project.deleteConfirmTitle', { name: project.name }),
            content: total === undefined
                ? t('project.deleteConfirmContentFallback')
                : t('project.deleteConfirmContent', { count: total }),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await deleteProjectMutation.mutateAsync(project.id)
                    messageApi.success(t('common.success'))
                } catch {
                    messageApi.error(t('common.error'))
                }
            },
        })
    }, [t, deleteProjectMutation, messageApi])

    // 移至最近（解除归属）
    const handleMoveToRecent = useCallback(async (session: Session) => {
        try {
            await assignMutation.mutateAsync({ sessionId: session.id, projectId: null })
            messageApi.success(t('common.success'))
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [assignMutation, t, messageApi])

    // 换项目 / 归入项目（打开弹窗，选项按会话机器过滤）
    const handleOpenAssign = useCallback((session: Session) => {
        setAssignSession(session)
    }, [])

    // 正在变更归属的会话 id：mutation pending 时取其 variables（目标行），空闲时为 undefined
    const assignPendingSessionId = assignMutation.isPending
        ? assignMutation.variables?.sessionId
        : undefined

    const sharedProps = {
        activeSessionId,
        renamingSessionId,
        renameValue,
        setRenameValue,
        onRenameConfirm: handleRenameConfirm,
        onRenameCancel: cancelRename,
        onArchive: handleArchive,
        onResume: handleResume,
        onDelete: handleDelete,
        onRenameStart: startRename,
        renameLoading: renameActions.isPending,
    }

    return (
        <Container>
            <SectionTitleRow
                role="button"
                aria-expanded={projectsExpanded}
                onClick={toggleProjectsExpanded}
            >
                <SectionChevron $token={token} $expanded={projectsExpanded}>
                    <ChevronRight size={12} />
                </SectionChevron>
                <SectionTitle $token={token}>{t('nav.projects')}</SectionTitle>
                <SectionActionButton
                    $token={token}
                    className="section-extra"
                    title={t('nav.newProject')}
                    onClick={handleOpenCreateProject}
                >
                    <FolderAddOutlined style={{ fontSize: 12 }} />
                </SectionActionButton>
            </SectionTitleRow>
            <SessionListWrapper $expanded={projectsExpanded}>
                <SessionListInner>
                    {projects.map(project => (
                        <ProjectGroup
                            key={project.id}
                            project={project}
                            {...sharedProps}
                            onEditProject={handleOpenEditProject}
                            onDeleteProject={handleDeleteProject}
                            onMoveToRecent={handleMoveToRecent}
                            onChangeProject={handleOpenAssign}
                            assignPendingSessionId={assignPendingSessionId}
                        />
                    ))}
                </SessionListInner>
            </SessionListWrapper>
            <RecentGroup
                {...sharedProps}
                onAssign={handleOpenAssign}
                assignPendingSessionId={assignPendingSessionId}
            />

            {/* 新建/编辑项目弹窗 */}
            <ProjectFormModal
                open={projectModalOpen}
                onClose={() => setProjectModalOpen(false)}
                project={editingProject}
            />

            {/* 归入项目弹窗（只列与会话同机器的项目） */}
            <AssignProjectModal
                session={assignSession}
                open={!!assignSession}
                onClose={() => setAssignSession(null)}
            />
        </Container>
    )
}
