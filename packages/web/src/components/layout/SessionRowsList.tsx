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
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import { SessionListContainer, EmptyRow } from './sidebarProjects.styles'
import { SessionRow } from './SessionRow'
import { SessionSkeletonRows } from './SessionSkeletonRows'
import { SessionListFooter, getSessionListDisplayState } from './SessionListFooter'

const { useToken } = antTheme

/** 从 session metadata 中取显示名称（用于重命名初始值） */
function getSessionName(session: Session): string {
    const metadata = session.metadata as SessionMetadataSummary | undefined
    return metadata?.name || ''
}

// ========== 分组共享 props（项目组与「最近」一致） ==========

export interface SessionListSharedProps {
    activeSessionId: string | undefined
    renamingSessionId: string | null
    renameValue: string
    setRenameValue: (v: string) => void
    onRenameConfirm: () => void
    onRenameCancel: () => void
    onArchive: (session: Session) => void
    onResume: (session: Session) => void
    onDelete: (session: Session) => void
    onRenameStart: (sessionId: string, currentName: string) => void
    renameLoading: boolean
}

// ========== 分组内会话列表（项目组与「最近」共用的渲染骨架） ==========

interface SessionRowsListProps extends SessionListSharedProps {
    sessions: Session[]
    visibleSessions: Session[]
    isLoadingInitial: boolean
    isLoadingMore: boolean
    showCollapse: boolean
    canShowMore: boolean
    remainingCount: number
    showMore: () => void
    collapse: () => void
    onSessionClick: (sessionId: string) => void
    /** 每行的追加操作（「移至最近」/「归入项目」） */
    renderExtraAction?: (session: Session) => React.ReactNode
}

/** 分组内会话列表：骨架 / 空态 / 会话行 / 底部展开收起链接 */
export function SessionRowsList({
    activeSessionId, renamingSessionId, renameValue, setRenameValue,
    onRenameConfirm, onRenameCancel, onArchive, onResume, onDelete, onRenameStart, renameLoading,
    sessions, visibleSessions, isLoadingInitial, isLoadingMore,
    showCollapse, canShowMore, remainingCount, showMore, collapse,
    onSessionClick, renderExtraAction,
}: SessionRowsListProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    const { showSkeleton, showEmpty, showFooter } = getSessionListDisplayState({
        isLoadingInitial, sessionCount: sessions.length, showCollapse, canShowMore, isLoadingMore,
    })

    return (
        <SessionListContainer>
            {showSkeleton ? (
                <SessionSkeletonRows variant="desktop" rows={3} />
            ) : showEmpty ? (
                <EmptyRow $token={token}>{t('nav.noSessions')}</EmptyRow>
            ) : visibleSessions.map(session => (
                <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    isRenaming={renamingSessionId === session.id}
                    renameValue={renameValue}
                    onRenameValueChange={setRenameValue}
                    onRenameConfirm={onRenameConfirm}
                    onRenameCancel={onRenameCancel}
                    onRenameLoading={renameLoading}
                    onClick={() => onSessionClick(session.id)}
                    onRename={() => onRenameStart(session.id, getSessionName(session))}
                    onArchive={() => onArchive(session)}
                    onResume={() => onResume(session)}
                    onDelete={() => onDelete(session)}
                    extraAction={renderExtraAction?.(session)}
                />
            ))}
            {showFooter && (
                <SessionListFooter
                    variant="desktop"
                    canShowMore={canShowMore}
                    remainingCount={remainingCount}
                    isLoadingMore={isLoadingMore}
                    showCollapse={showCollapse}
                    onShowMore={showMore}
                    onCollapse={collapse}
                />
            )}
        </SessionListContainer>
    )
}
