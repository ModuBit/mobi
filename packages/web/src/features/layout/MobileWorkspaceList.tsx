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

import { useState, useCallback, useEffect } from 'react'
import { App as AntdApp, Button, Input, Modal, theme as antTheme } from 'antd'
import {
    EditOutlined,
    MoonOutlined,
    DeleteOutlined,
    PlayCircleOutlined,
    PushpinOutlined,
    SwapOutlined,
    ImportOutlined,
} from '@ant-design/icons'
import { ChevronRight, Plus } from 'lucide-react'
import { dormantSessionWithFeedback, deleteBlockedText } from '@/core/data/sessionDormancy'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { nextOverlayLayer, useOpenOverlayLayer } from '@/ui/base/layout/overlayLayer'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useSetSessionPinned } from '@/core/data/hooks/mutations/useSessionPinned'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useAssignSessionWorkspace } from '@/core/data/hooks/mutations/useWorkspaceMutations'
import { useMobiApi } from '@/core/data/api/client'
import { resumeSession } from '@/core/data/sessionResume'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { queryKeys } from '@/core/lib/queryKeys'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { useHistoryGuard } from '@/core/hooks/useHistoryGuard'
import { pushHistoryGuard } from '@/core/lib/drawerHistoryGuard'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import {
    Container, SectionHeader, SectionTitleText, SectionChevron, NewSessionBtn,
    SessionListWrapper, SessionListInner,
} from './mobileWorkspaceList.styles'
import { MobileWorkspaceGroup } from './MobileWorkspaceGroup'
import { MobileRecentGroup } from './MobileRecentGroup'
import { MobilePinnedGroup } from './MobilePinnedGroup'
import { useMenuNavigate } from './useMenuNavigate'
import { WorkspaceFormModal } from '@/ui/shared/WorkspaceFormModal'
import { BottomSheet } from '@/ui/base/interactive/bottom-sheet/BottomSheet'
import { AssignWorkspaceModal } from '@/features/layout/AssignWorkspaceModal'
import { SessionListFooter } from './SessionListFooter'
import { useSectionExpanded } from './useSectionExpanded'
import { usePagedSectionList } from './usePagedSectionList'

const { useToken } = antTheme

/**
 * Mobile 端工作区折叠列表
 * 「置顶」「工作区」「最近」三个平级分区，每个分区可折叠、空分区默认收起。
 * 置顶是纯展示维度分组（不改归属），入口在长按 ActionSheet
 */
export function MobileWorkspaceList() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message: messageApi, modal } = AntdApp.useApp()
    const navigate = useNavigate()
    const navigateFromMenu = useMenuNavigate()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // 会话操作菜单（BottomSheet）状态
    const [actionSessionId, setActionSessionId] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    /** 菜单内的视图：删除确认就地展开，**不在 sheet 之上叠 antd Modal**。Radix Dialog 打开期间
     *  会把 body 置 `pointer-events: none`，antd 弹层得靠自己把内容提回 `auto` 才点得到——能用，
     *  但两层 modal 的焦点陷阱互相抢，fragile；菜单里的其它入口（重命名 / 归入工作区）也是
     *  「先关 sheet 再开弹层」的同一套做法 */
    const [actionView, setActionView] = useState<'menu' | 'confirmDelete'>('menu')

    // 重命名 Modal 状态
    const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')

    // 新建工作区表单状态（WorkspaceFormModal 端别自适应，移动端渲染为底部 Drawer）
    const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)

    // 置顶 / 取消置顶（ActionSheet 入口，所有分组通用）
    const pinMutation = useSetSessionPinned()
    const [pinLoadingId, setPinLoadingId] = useState<string | null>(null)
    const handleTogglePin = useCallback(async (session: Session) => {
        setPinLoadingId(session.id)
        try {
            await pinMutation.mutateAsync({ sessionId: session.id, pinned: !session.pinned })
            setActionSessionId(null)
        } catch {
            // mutation hook 无 onError，这里与桌面端 SidebarWorkspaces 对齐：失败弹全局错误提示
            messageApi.error(t('common.error'))
        } finally {
            setPinLoadingId(null)
        }
    }, [pinMutation, messageApi, t])

    const renameActions = useSessionActions(renameSessionId)

    // 获取所有工作区 + 最近会话（游离会话）
    const { data: workspaces = [] } = useWorkspaces()
    // 「工作区」分区折叠：有工作区默认展开、空分区默认收起，用户 toggle 后持久生效
    const {
        expanded: workspacesExpanded,
        toggleExpanded: toggleWorkspacesExpanded,
    } = useSectionExpanded(workspaces.length > 0)
    // 工作区列表前端分页：默认 5 个，超出 footer 展开剩余 / 收起（与桌面端一致）
    const {
        visibleItems: visibleWorkspaces, showCollapse, canShowMore, remainingCount, showMore, collapse,
    } = usePagedSectionList(workspaces)
    // 获取所有会话（用于查找 ActionSheet 对应 session）
    const { data: allSessions } = useSessions()

    const findSession = useCallback((sessionId: string): Session | undefined => {
        return allSessions?.find(s => s.id === sessionId)
    }, [allSessions])

    // 归属变更：换工作区 / 归入工作区（选择器）+ 移至最近（直接执行）
    const assignMutation = useAssignSessionWorkspace()
    const [assignSession, setAssignSession] = useState<Session | null>(null)

    const handleOpenAssign = useCallback(() => {
        if (!actionSessionId) return
        const session = findSession(actionSessionId)
        if (!session) return
        setAssignSession(session)
        setActionSessionId(null)
    }, [actionSessionId, findSession])

    const handleMoveToRecent = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('moveToRecent')
        try {
            await assignMutation.mutateAsync({ sessionId: actionSessionId, workspaceId: null })
            messageApi.success(t('common.success'))
            setActionSessionId(null)
        } catch {
            messageApi.error(t('common.error'))
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, assignMutation, messageApi, t])

    // 关闭会话操作菜单（执行中否决关闭：BottomSheet 收到否决即沉降回原位）
    const closeActionSheet = useCallback(() => {
        if (!actionLoading) setActionSessionId(null)
    }, [actionLoading])

    // 菜单关闭即复位视图：下次长按重新从菜单进（确认中被遮罩/手势返回关掉时也要复位）
    useEffect(() => {
        if (actionSessionId == null) setActionView('menu')
    }, [actionSessionId])

    // 删除确认视图自带一层手势返回：返回 = 取消确认、退回菜单（同原先命令式 Modal 那层哨兵）。
    // 进出确认视图时挂/摘哨兵——退回菜单后返回事件自然交回菜单自己的哨兵。
    useEffect(() => {
        if (actionView !== 'confirmDelete') return undefined
        return pushHistoryGuard(() => setActionView('menu'))
    }, [actionView])

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
            await invalidateSessionViews(queryClient, [renameSessionId])
            setRenameSessionId(null)
            setRenameValue('')
        } catch {
            // 错误由 hook 内部处理
        }
    }, [renameValue, renameSessionId, renameActions, queryClient])

    const handleRenameCancel = useCallback(() => {
        setRenameSessionId(null)
        setRenameValue('')
    }, [])

    // 重命名 Modal 是 antd 原生浮层，必须接 history 哨兵——否则手势返回会穿透过去消费下层
    // 菜单的哨兵。操作菜单本身已是 BottomSheet，哨兵由组件内置，不再手工接线。
    useHistoryGuard(renameSessionId != null, handleRenameCancel)

    // 弹层层号：重命名 Modal 弹在 MobileMenu / 操作菜单之上，必须领比它们大的号，否则默认
    // z 1000 被菜单的 1080 压住——真机「长按 session 弹出的二级退到后面去了」。
    // 操作菜单（BottomSheet）自带层号分配，不在此领。
    const renameModalZ = useOpenOverlayLayer(!!renameSessionId)

    // 手动休眠（dormancy spec §D.11）：动作流收口在 sessionDormancy（gate 阻塞时弹
    // 「仍要退出」确认，archive 作为强制兜底），这里只管 pending 态。
    // 确认弹窗必须领号：它要叠在**本菜单 sheet** 之上（菜单在 await 期间保持打开），
    // 不领号就会被 sheet 的 1080+ 盖住（见 dormantSessionWithFeedback 的 confirmZIndex）
    const handleDormant = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('dormant')
        const target = actionSessionId
        await dormantSessionWithFeedback(
            { api, queryClient, t, modal, message: messageApi, confirmZIndex: nextOverlayLayer },
            target,
            () => {
                setActionLoading(null)
                setActionSessionId(null)
            },
        )
    }, [actionSessionId, api, queryClient, t, modal, messageApi])

    // 恢复
    const handleResume = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('resume')
        try {
            const resumedSessionId = await resumeSession(api, actionSessionId, queryClient)
            setActionSessionId(null)
            navigateFromMenu(() => navigate({ to: '/sessions/$sessionId', params: { sessionId: resumedSessionId } }))
        } catch {
            // ignore
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, queryClient, navigate, navigateFromMenu])

    // 删除：先切到确认视图（同一 sheet 就地展开，见 actionView 注释），确认后再落真正的删除
    const handleDelete = useCallback(() => {
        if (!actionSessionId) return
        setActionView('confirmDelete')
    }, [actionSessionId])

    // 确认删除
    const handleDeleteConfirm = useCallback(async () => {
        if (!actionSessionId) return
        const sessionId = actionSessionId
        setActionLoading('delete')
        try {
            await api.sessions.delete(sessionId)
            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            clearMessageWindow(sessionId)
            await invalidateSessionViews(queryClient, [sessionId])
            // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
            clearSessionResources(sessionId)
            setActionSessionId(null)
            if (activeSessionId === sessionId) {
                navigateFromMenu(() => navigate({ to: '/sessions' }))
            }
        } catch (error) {
            // gate 阻塞（daemon 删除前自动休眠被挡）→ 逐项原因文案；其余保持静默（原行为）
            const text = deleteBlockedText(error, t)
            if (text) {
                messageApi.error(text)
            }
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, queryClient, activeSessionId, navigate, navigateFromMenu, t, messageApi])

    // ActionSheet 当前操作的 session
    const actionSession = actionSessionId ? findSession(actionSessionId) : null
    // Drawer 标题（fork 行标题已由 daemon 落库，displayName 自然区分）
    const actionSessionDisplayTitle = actionSession ? getSessionDisplayName(actionSession) : ''

    return (
        <>
            <Container $token={token}>
                {/* 「置顶」分区：跨工作区/游离的置顶会话，三个平级分区之首 */}
                <MobilePinnedGroup
                    activeSessionId={activeSessionId}
                    onSessionAction={setActionSessionId}
                />
                <SectionHeader
                    $token={token}
                    role="button"
                    aria-expanded={workspacesExpanded}
                    onClick={toggleWorkspacesExpanded}
                >
                    <SectionChevron $token={token} $expanded={workspacesExpanded}>
                        <ChevronRight size={14} />
                    </SectionChevron>
                    <SectionTitleText>{t('nav.workspaces')}</SectionTitleText>
                    <NewSessionBtn
                        $token={token}
                        aria-label={t('nav.newWorkspace')}
                        onClick={(e) => { e.stopPropagation(); setWorkspaceModalOpen(true) }}
                    >
                        <Plus size={18} />
                    </NewSessionBtn>
                </SectionHeader>
                <SessionListWrapper $expanded={workspacesExpanded}>
                    <SessionListInner>
                        {visibleWorkspaces.map(workspace => (
                            <MobileWorkspaceGroup
                                key={workspace.id}
                                workspace={workspace}
                                activeSessionId={activeSessionId}
                                onSessionAction={setActionSessionId}
                            />
                        ))}
                        {(showCollapse || canShowMore) && (
                            <SessionListFooter
                                variant="mobile"
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
                {/* 「最近」分区：游离会话（自带 SectionHeader 承载标题/折叠/新建按钮） */}
                <MobileRecentGroup
                    activeSessionId={activeSessionId}
                    onSessionAction={setActionSessionId}
                />
            </Container>

            {/* 会话操作菜单（重命名 / 置顶 / 归属 / 休眠·恢复 / 删除 / 取消）
                BottomSheet 二级弹层：弹在 MobileMenu（同为 BottomSheet）之上，层号由组件的
                共享分配器给（后开者在上），调用方不再手工配 zIndex。
                动作菜单关掉 peek（同菜单语义）：被裁掉的行对菜单是残缺，不是「还有更多」。
                删除确认就地展开在同一个 sheet 里，**不叠 antd Modal**——Radix Dialog 打开期间
                把 body 置 pointer-events:none，叠上来的 antd 弹层要自己提回 auto 才点得到，
                再加两层 focus trap 互相抢，不稳。
                title 显示当前操作的 session 名称（fork 行标题已落库，displayName 自然区分） */}
            <BottomSheet
                open={!!actionSessionId}
                onClose={closeActionSheet}
                title={actionSessionDisplayTitle || undefined}
                peek={false}
                // 内衬归调用方：组件默认不加 padding（底部安全区由 .sheet 自带）
                bodyStyle={{ padding: '8px 0 0' }}
            >
                {actionSession && actionView === 'confirmDelete' ? (
                    <>
                        <div style={{ padding: '4px 20px 16px' }}>
                            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
                                {t('session.actions.deleteConfirmTitle')}
                            </div>
                            <div style={{ color: token.colorTextSecondary }}>
                                {t('session.actions.deleteConfirmContent')}
                            </div>
                        </div>

                        <Button
                            danger
                            type="primary"
                            block
                            loading={actionLoading === 'delete'}
                            style={{ height: 44 }}
                            onClick={handleDeleteConfirm}
                        >
                            {t('common.confirm')}
                        </Button>

                        <Button
                            type="text"
                            block
                            disabled={!!actionLoading}
                            style={{
                                height: 48,
                                marginTop: 4,
                                justifyContent: 'center',
                                color: token.colorTextSecondary,
                            }}
                            onClick={() => setActionView('menu')}
                        >
                            {t('common.cancel')}
                        </Button>
                    </>
                ) : actionSession ? (
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

                        {/* 置顶 / 取消置顶 */}
                        <Button
                            type="text"
                            block
                            icon={<PushpinOutlined />}
                            disabled={!!actionLoading || pinLoadingId === actionSession.id}
                            loading={pinLoadingId === actionSession.id}
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={() => handleTogglePin(actionSession)}
                        >
                            {actionSession.pinned ? t('session.actions.unpin') : t('session.actions.pin')}
                        </Button>

                        {/* 归属操作：按归属动态显示（游离=归入工作区；工作区内=换工作区+移至最近） */}
                        {actionSession.workspaceId ? (
                            <>
                                <Button
                                    type="text"
                                    block
                                    icon={<SwapOutlined />}
                                    disabled={!!actionLoading}
                                    style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                    onClick={handleOpenAssign}
                                >
                                    {t('workspace.changeWorkspace')}
                                </Button>
                                <Button
                                    type="text"
                                    block
                                    icon={<ImportOutlined />}
                                    disabled={!!actionLoading}
                                    loading={actionLoading === 'moveToRecent'}
                                    style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                    onClick={handleMoveToRecent}
                                >
                                    {t('workspace.toRecent')}
                                </Button>
                            </>
                        ) : (
                            <Button
                                type="text"
                                block
                                icon={<SwapOutlined />}
                                disabled={!!actionLoading}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleOpenAssign}
                            >
                                {t('workspace.assignTo')}
                            </Button>
                        )}

                        {/* 休眠 / 归档 / 恢复 */}
                        {actionSession.active ? (
                            <Button
                                type="text"
                                block
                                icon={<MoonOutlined />}
                                disabled={!!actionLoading}
                                loading={actionLoading === 'dormant'}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleDormant}
                            >
                                {t('session.actions.dormant')}
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
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={handleDelete}
                        >
                            {t('session.actions.delete')}
                        </Button>
                    </>
                ) : null}
            </BottomSheet>

            {/* 重命名 Modal */}
            <Modal
                zIndex={renameModalZ}
                title={t('session.actions.rename')}
                open={!!renameSessionId}
                onOk={handleRenameConfirm}
                onCancel={handleRenameCancel}
                confirmLoading={renameActions.isPending}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                destroyOnHidden
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameConfirm}
                    placeholder={t('session.actions.rename')}
                    autoFocus
                />
            </Modal>

            {/* 归入/换工作区选择器（端别自适应，见 AssignWorkspaceModal） */}
            <AssignWorkspaceModal
                session={assignSession}
                open={!!assignSession}
                onClose={() => setAssignSession(null)}
            />

            {/* 新建工作区表单（移动端渲染为底部 Drawer） */}
            <WorkspaceFormModal
                open={workspaceModalOpen}
                onClose={() => setWorkspaceModalOpen(false)}
            />
        </>
    )
}
