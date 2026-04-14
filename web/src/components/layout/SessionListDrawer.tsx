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

import { theme as antTheme, Drawer, Typography, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useParams } from '@tanstack/react-router'
import { useUiStore } from '@/stores/uiStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { SessionList } from '@/components/session/SessionList'
import { PlusOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'

const { Title } = Typography
const { useToken } = antTheme

const DrawerHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    padding: 12px 12px 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid ${props => props.$token.colorBorder};
`

/**
 * Session 列表 Drawer 组件
 * PC 端：左侧 overlay（无遮罩），由 RailNav hover 触发
 * 移动端：底部 Drawer（有遮罩），由 header 按钮触发
 */
export function SessionListDrawer() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string | undefined
    const { sessionListDrawerOpen, setSessionListDrawerOpen } = useUiStore()

    const handleClose = () => setSessionListDrawerOpen(false)

    const handleNewSession = () => {
        // TODO: 实现新建会话
        console.log('New session')
    }

    const handleDrawerMouseEnter = () => {
        if (!isMobile) {
            window.dispatchEvent(new CustomEvent('session-drawer-enter'))
        }
    }

    const handleDrawerMouseLeave = () => {
        if (!isMobile) {
            window.dispatchEvent(new CustomEvent('session-drawer-leave'))
        }
    }

    // Drawer 内容：仅在打开时渲染 SessionList，避免关闭时执行无用的查询
    const drawerContent = sessionListDrawerOpen && (
        <>
            <DrawerHeader $token={token}>
                <Title level={5} style={{ margin: 0 }}>{t('home.title')}</Title>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={handleNewSession}
                />
            </DrawerHeader>
            <SessionList selectedSessionId={sessionId} />
        </>
    )

    // 移动端：底部 Drawer
    if (isMobile) {
        return (
            <Drawer
                open={sessionListDrawerOpen}
                onClose={handleClose}
                placement="bottom"
                closable={false}
                styles={{
                    body: { padding: 0, maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
                    header: { display: 'none' },
                    wrapper: { height: 'auto', maxHeight: '70vh' },
                }}
            >
                {drawerContent}
            </Drawer>
        )
    }

    // PC 端：左侧 overlay Drawer（无遮罩）
    return (
        <div onMouseEnter={handleDrawerMouseEnter} onMouseLeave={handleDrawerMouseLeave}>
            <Drawer
                open={sessionListDrawerOpen}
                onClose={handleClose}
                placement="left"
                closable={false}
                mask={false}
                width={280}
                styles={{
                    body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
                    header: { display: 'none' },
                    wrapper: { marginLeft: '56px' },
                }}
            >
                {drawerContent}
            </Drawer>
        </div>
    )
}
