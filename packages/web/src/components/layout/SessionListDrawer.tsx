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

import { Button, Drawer, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from '@tanstack/react-router'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { SessionList } from '@/components/session/SessionList'
import { NewSession } from '@/components/session/NewSessionForm'
import { Plus } from 'lucide-react'

// Session List Drawer：body 不滚动，由 SessionList 自管滚动
const LIST_BODY_STYLES = { padding: 0, overflow: 'hidden' as const, display: 'flex' as const, flexDirection: 'column' as const }

export function SessionListDrawer() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const isMobile = useIsMobile()
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string | undefined
    const {
        sessionListDrawerOpen, setSessionListDrawerOpen,
        newSessionDrawerOpen, setNewSessionDrawerOpen,
    } = useUiStore()

    const { data: groups = [] } = useSessionGroups()
    const hasSessions = groups.some(g => g.totalCount > 0)

    // 桌面端不再渲染（会话列表已内嵌在 AppSidebar 中）
    if (!isMobile) return null

    const handleCloseList = () => {
        setSessionListDrawerOpen(false)
        setNewSessionDrawerOpen(false)
    }
    const handleOpenNew = () => setNewSessionDrawerOpen(true)
    const handleCloseNew = () => setNewSessionDrawerOpen(false)

    const handleNewSuccess = (newSessionId: string) => {
        setNewSessionDrawerOpen(false)
        setSessionListDrawerOpen(false)
        navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
    }

    const handleNewCancel = () => {
        setNewSessionDrawerOpen(false)
    }

    const emptyContent = (
        <div style={{ padding: '32px 16px' }}>
            <Empty
                description={t('session.empty')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
                <Button
                    type="primary"
                    icon={<Plus size={16} />}
                    onClick={handleOpenNew}
                >
                    {t('session.newSession')}
                </Button>
            </Empty>
        </div>
    )

    const listDrawerContent = hasSessions
        ? <SessionList selectedSessionId={sessionId} />
        : emptyContent

    const newSessionContent = (
        <NewSession
            onSuccess={handleNewSuccess}
            onCancel={handleNewCancel}
        />
    )

    // 独立的 NewSession Drawer（session list 未打开时使用）
    const standaloneNewDrawer = !sessionListDrawerOpen && (
        <Drawer
            title={t('session.newSession')}
            open={newSessionDrawerOpen}
            onClose={handleCloseNew}
            placement={isMobile ? 'bottom' : 'right'}
            size={360}
            destroyOnClose
            styles={{ body: { padding: 0 } }}
        >
            {newSessionContent}
        </Drawer>
    )

    return (
        <>
            <Drawer
                title={t('nav.sessions')}
                extra={<Button type="text" icon={<Plus size={16} />} onClick={handleOpenNew} />}
                open={sessionListDrawerOpen}
                onClose={handleCloseList}
                placement="bottom"
                styles={{ body: LIST_BODY_STYLES }}
            >
                {listDrawerContent}
                <Drawer
                    title={t('session.newSession')}
                    open={newSessionDrawerOpen}
                    onClose={handleCloseNew}
                    placement="bottom"
                    destroyOnClose
                    styles={{ body: { padding: 0 } }}
                >
                    {newSessionContent}
                </Drawer>
            </Drawer>
            {/* 独立的 NewSession Drawer（session list 未打开时使用） */}
            {standaloneNewDrawer}
        </>
    )
}
