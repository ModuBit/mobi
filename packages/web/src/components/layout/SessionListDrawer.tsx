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
import { useUiStore } from '@/stores/uiStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { SessionList } from '@/components/session/SessionList'
import { NewSession } from '@/components/NewSession'
import { Plus } from 'lucide-react'

// 移动端 Drawer 样式常量
const MOBILE_LIST_STYLES = {
    body: { padding: 0, paddingBottom: 'max(24px, env(safe-area-inset-bottom))', overflow: 'hidden', display: 'flex' as const, flexDirection: 'column' as const },
    wrapper: { height: 'auto', maxHeight: '85vh' },
}

const MOBILE_NEW_STYLES = {
    body: { padding: 0, paddingBottom: 'max(24px, env(safe-area-inset-bottom))', overflow: 'auto', display: 'flex' as const, flexDirection: 'column' as const },
    wrapper: { height: 'auto', maxHeight: '85vh' },
}

const PC_LIST_BODY_STYLES = { padding: 0, overflow: 'hidden', display: 'flex' as const, flexDirection: 'column' as const }
const PC_NEW_BODY_STYLES = { padding: 0, overflow: 'auto', display: 'flex' as const, flexDirection: 'column' as const }

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
            styles={{
                body: isMobile ? MOBILE_NEW_STYLES.body : PC_NEW_BODY_STYLES,
                wrapper: isMobile ? MOBILE_NEW_STYLES.wrapper : undefined,
            }}
        >
            {newSessionContent}
        </Drawer>
    )

    if (isMobile) {
        return (
            <>
                <Drawer
                    title={t('nav.sessions')}
                    extra={<Button type="text" icon={<Plus size={16} />} onClick={handleOpenNew} />}
                    open={sessionListDrawerOpen}
                    onClose={handleCloseList}
                    placement="bottom"
                    styles={MOBILE_LIST_STYLES}
                >
                    {listDrawerContent}
                    <Drawer
                        title={t('session.newSession')}
                        open={newSessionDrawerOpen}
                        onClose={handleCloseNew}
                        placement="bottom"
                        styles={MOBILE_NEW_STYLES}
                    >
                        {newSessionContent}
                    </Drawer>
                </Drawer>
                {standaloneNewDrawer}
            </>
        )
    }

    return (
        <>
            <Drawer
                title={t('nav.sessions')}
                extra={<Button type="text" icon={<Plus size={16} />} onClick={handleOpenNew} />}
                open={sessionListDrawerOpen}
                onClose={handleCloseList}
                placement="right"
                size={300}
                styles={{ body: PC_LIST_BODY_STYLES }}
            >
                {listDrawerContent}
                <Drawer
                    title={t('session.newSession')}
                    open={newSessionDrawerOpen}
                    onClose={handleCloseNew}
                    placement="right"
                    size={360}
                    styles={{ body: PC_NEW_BODY_STYLES }}
                >
                    {newSessionContent}
                </Drawer>
            </Drawer>
            {standaloneNewDrawer}
        </>
    )
}
