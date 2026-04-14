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

import { theme as antTheme, Button, Drawer, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from '@tanstack/react-router'
import { useUiStore } from '@/stores/uiStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { SessionList } from '@/components/session/SessionList'
import { NewSession } from '@/components/NewSession'
import { Plus } from 'lucide-react'

const { useToken } = antTheme

/**
 * Session 列表 Drawer 组件
 * - 空列表时：显示新建按钮，点击打开第二层 Drawer
 * - 有列表时：显示 SessionList，“+”按钮打开第二层 Drawer
 */
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

    // 检测是否有会话
    const { data: groups = [] } = useSessionGroups()
    const hasSessions = groups.some(g => g.totalCount > 0)

    const handleCloseList = () => {
        setSessionListDrawerOpen(false)
        setNewSessionDrawerOpen(false)
    }
    const handleOpenNew = () => setNewSessionDrawerOpen(true)
    const handleCloseNew = () => setNewSessionDrawerOpen(false)

    // 新建成功：导航到新会话，关闭所有 Drawer
    const handleNewSuccess = (newSessionId: string) => {
        setNewSessionDrawerOpen(false)
        setSessionListDrawerOpen(false)
        navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
    }

    // 新建取消
    const handleNewCancel = () => {
        setNewSessionDrawerOpen(false)
    }

    // 空状态
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

    // 列表 Drawer 的内容
    const listDrawerContent = sessionListDrawerOpen && (
        hasSessions
            ? <SessionList selectedSessionId={sessionId} />
            : emptyContent
    )

    // 新建会话第二层 Drawer 内容
    const newSessionDrawerContent = newSessionDrawerOpen && (
        <NewSession
            onSuccess={handleNewSuccess}
            onCancel={handleNewCancel}
        />
    )

    // 移动端：底部 Drawer（嵌套实现层级推挤效果）
    if (isMobile) {
        return (
            <Drawer
                title={t('nav.sessions')}
                extra={<Button type="text" icon={<Plus size={16} />} onClick={handleOpenNew} />}
                open={sessionListDrawerOpen}
                onClose={handleCloseList}
                placement="bottom"
                styles={{
                    body: { padding: 0, paddingBottom: 'max(24px, env(safe-area-inset-bottom))', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
                    wrapper: { height: 'auto', maxHeight: '85vh' },
                }}
            >
                {listDrawerContent}
                <Drawer
                    title={t('session.newSession')}
                    open={newSessionDrawerOpen}
                    onClose={handleCloseNew}
                    placement="bottom"
                    styles={{
                        body: { padding: 0, paddingBottom: 'max(24px, env(safe-area-inset-bottom))', overflow: 'auto', display: 'flex', flexDirection: 'column' },
                        wrapper: { height: 'auto', maxHeight: '85vh' },
                    }}
                >
                    {newSessionDrawerContent}
                </Drawer>
            </Drawer>
        )
    }

    // PC 端：右侧 Drawer（嵌套实现层级推挤效果）
    return (
        <Drawer
            title={t('nav.sessions')}
            extra={<Button type="text" icon={<Plus size={16} />} onClick={handleOpenNew} />}
            open={sessionListDrawerOpen}
            onClose={handleCloseList}
            placement="right"
            size={300}
            styles={{
                body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
            }}
        >
            {listDrawerContent}
            <Drawer
                title={t('session.newSession')}
                open={newSessionDrawerOpen}
                onClose={handleCloseNew}
                placement="right"
                size={360}
                styles={{
                    body: { padding: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' },
                }}
            >
                {newSessionDrawerContent}
            </Drawer>
        </Drawer>
    )
}
