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

import { useState, useCallback } from 'react'
import { Button, Drawer, Input, Modal, theme as antTheme } from 'antd'
import {
    EditOutlined,
    InboxOutlined,
    DeleteOutlined,
    PlayCircleOutlined,
    CloseOutlined,
} from '@ant-design/icons'
import { ChevronRight, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects } from '@/core/data/hooks/queries/useProjects'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import {
    Container, SectionHeader, SectionTitleText, SectionChevron, NewSessionBtn,
    SessionListWrapper, SessionListInner,
} from './mobileProjectList.styles'
import { MobileProjectGroup } from './MobileProjectGroup'
import { MobileRecentGroup } from './MobileRecentGroup'
import { ProjectFormModal } from '@/components/project/ProjectFormModal'
import { useSectionExpanded } from './useSectionExpanded'

const { useToken } = antTheme

interface MobileProjectListProps {
    /** 关闭菜单 Drawer 的回调 */
    onCloseMenu: () => void
}

/**
 * Mobile 端项目折叠列表
 * 「项目」「最近」两个平级分区（将来还会有「置顶」），每个分区可折叠、空分区默认收起
 */
export function MobileProjectList({ onCloseMenu }: MobileProjectListProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // ActionSheet 状态
    const [actionSessionId, setActionSessionId] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // 重命名 Modal 状态
    const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')

    // 新建项目表单状态（ProjectFormModal 端别自适应，移动端渲染为底部 Drawer）
    const [projectModalOpen, setProjectModalOpen] = useState(false)

    const renameActions = useSessionActions(renameSessionId)

    // 获取所有项目 + 最近会话（游离会话）
    const { data: projects = [] } = useProjects()
    // 「项目」分区折叠：有项目默认展开、空分区默认收起，用户 toggle 后持久生效
    const {
        expanded: projectsExpanded,
        toggleExpanded: toggleProjectsExpanded,
    } = useSectionExpanded(projects.length > 0)
    // 获取所有会话（用于查找 ActionSheet 对应 session）
    const { data: allSessions } = useSessions()

    const findSession = useCallback((sessionId: string): Session | undefined => {
        return allSessions?.find(s => s.id === sessionId)
    }, [allSessions])

    // 使缓存失效（项目维度视图由 invalidateProjectViews 统一收口）
    const invalidateAll = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            invalidateProjectViews(queryClient),
        ])
    }, [queryClient])

    // 关闭 ActionSheet
    const closeActionSheet = useCallback(() => {
        if (!actionLoading) setActionSessionId(null)
    }, [actionLoading])

    // 重命名
    const handleRenameStart = useCallback(() => {
        if (!actionSessionId) return
        const session = findSession(actionSessionId)
        if (!session) return
        const metadata = session.metadata as SessionMetadataSummary | undefined
        setRenameSessionId(actionSessionId)
        setRenameValue(metadata?.name || '')
        setActionSessionId(null)
    }, [actionSessionId, findSession])

    const handleRenameConfirm = useCallback(async () => {
        if (!renameValue.trim() || !renameSessionId) return
        try {
            await renameActions.renameSession(renameValue.trim())
            await invalidateAll(renameSessionId)
            setRenameSessionId(null)
            setRenameValue('')
        } catch {
            // 错误由 hook 内部处理
        }
    }, [renameValue, renameSessionId, renameActions, invalidateAll])

    const handleRenameCancel = useCallback(() => {
        setRenameSessionId(null)
        setRenameValue('')
    }, [])

    // 归档
    const handleArchive = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('archive')
        try {
            await api.sessions.archive(actionSessionId)
            await invalidateAll(actionSessionId)
            setActionSessionId(null)
        } catch {
            // ignore
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, invalidateAll])

    // 恢复
    const handleResume = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('resume')
        try {
            const res = await api.sessions.resume(actionSessionId)
            await invalidateAll(actionSessionId)
            setActionSessionId(null)
            onCloseMenu()
            navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
        } catch {
            // ignore
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, invalidateAll, onCloseMenu, navigate])

    // 删除
    const handleDelete = useCallback(() => {
        if (!actionSessionId) return
        const sessionId = actionSessionId
        setActionLoading('delete')
        Modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await api.sessions.delete(sessionId)
                    queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
                    clearMessageWindow(sessionId)
                    await invalidateAll(sessionId)
                    // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
                    clearSessionResources(sessionId)
                    setActionSessionId(null)
                    if (activeSessionId === sessionId) {
                        onCloseMenu()
                        navigate({ to: '/sessions' })
                    }
                } catch {
                    // ignore
                } finally {
                    setActionLoading(null)
                }
            },
            onCancel: () => {
                setActionLoading(null)
            },
        })
    }, [actionSessionId, api, queryClient, invalidateAll, activeSessionId, onCloseMenu, navigate, t])

    // ActionSheet 当前操作的 session
    const actionSession = actionSessionId ? findSession(actionSessionId) : null

    return (
        <>
            <Container $token={token}>
                <SectionHeader
                    $token={token}
                    role="button"
                    aria-expanded={projectsExpanded}
                    onClick={toggleProjectsExpanded}
                >
                    <SectionChevron $token={token} $expanded={projectsExpanded}>
                        <ChevronRight size={14} />
                    </SectionChevron>
                    <SectionTitleText>{t('nav.projects')}</SectionTitleText>
                    <NewSessionBtn
                        $token={token}
                        aria-label={t('nav.newProject')}
                        onClick={(e) => { e.stopPropagation(); setProjectModalOpen(true) }}
                    >
                        <Plus size={18} />
                    </NewSessionBtn>
                </SectionHeader>
                <SessionListWrapper $expanded={projectsExpanded}>
                    <SessionListInner>
                        {projects.map(project => (
                            <MobileProjectGroup
                                key={project.id}
                                project={project}
                                activeSessionId={activeSessionId}
                                onSessionAction={setActionSessionId}
                                onCloseMenu={onCloseMenu}
                            />
                        ))}
                    </SessionListInner>
                </SessionListWrapper>
                {/* 「最近」分区：游离会话（自带 SectionHeader 承载标题/折叠/新建按钮） */}
                <MobileRecentGroup
                    activeSessionId={activeSessionId}
                    onSessionAction={setActionSessionId}
                    onCloseMenu={onCloseMenu}
                />
            </Container>

            {/* ActionSheet：会话操作菜单（重命名 / 归档·恢复 / 删除 / 取消）
                ⚠️ 故意使用 antd 原生 Drawer，**不要改成 MobileDrawer**。
                这是轻量操作菜单：内容固定（几个按钮）、高度低、用完即关，
                不需要 MobileDrawer 的下拉关闭手势、拖拽指示条、85dvh maxHeight。
                title 显示当前操作的 session 名称（getSessionDisplayName），让用户
                明确知道正在修改哪个会话 */}
            <Drawer
                placement="bottom"
                open={!!actionSessionId}
                onClose={closeActionSheet}
                title={actionSession ? getSessionDisplayName(actionSession) : undefined}
                closable={false}
                styles={{ body: { padding: '8px 0 max(24px, env(safe-area-inset-bottom))' } }}
            >
                {actionSession && (
                    <>
                        {/* 重命名 */}
                        <Button
                            type="text"
                            block
                            icon={<EditOutlined />}
                            disabled={!!actionLoading}
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={handleRenameStart}
                        >
                            {t('session.actions.rename')}
                        </Button>

                        {/* 归档 / 恢复 */}
                        {actionSession.active ? (
                            <Button
                                type="text"
                                block
                                icon={<InboxOutlined />}
                                disabled={!!actionLoading}
                                loading={actionLoading === 'archive'}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleArchive}
                            >
                                {t('session.actions.archive')}
                            </Button>
                        ) : (
                            <Button
                                type="text"
                                block
                                icon={<PlayCircleOutlined />}
                                disabled={!!actionLoading}
                                loading={actionLoading === 'resume'}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleResume}
                            >
                                {t('session.actions.resume')}
                            </Button>
                        )}

                        <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 16px' }} />

                        {/* 删除 */}
                        <Button
                            type="text"
                            block
                            danger
                            icon={<DeleteOutlined />}
                            disabled={actionSession.active || !!actionLoading}
                            loading={actionLoading === 'delete'}
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={handleDelete}
                        >
                            {t('session.actions.delete')}
                        </Button>

                        <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 16px' }} />

                        {/* 取消 */}
                        <Button
                            type="text"
                            block
                            icon={<CloseOutlined />}
                            disabled={!!actionLoading}
                            style={{ height: 48, justifyContent: 'center', color: token.colorTextSecondary }}
                            onClick={closeActionSheet}
                        >
                            {t('common.cancel')}
                        </Button>
                    </>
                )}
            </Drawer>

            {/* 重命名 Modal */}
            <Modal
                title={t('session.actions.rename')}
                open={!!renameSessionId}
                onOk={handleRenameConfirm}
                onCancel={handleRenameCancel}
                confirmLoading={renameActions.isPending}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                destroyOnClose
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameConfirm}
                    placeholder={t('session.actions.rename')}
                    autoFocus
                />
            </Modal>

            {/* 新建项目表单（移动端渲染为底部 Drawer） */}
            <ProjectFormModal
                open={projectModalOpen}
                onClose={() => setProjectModalOpen(false)}
            />
        </>
    )
}
