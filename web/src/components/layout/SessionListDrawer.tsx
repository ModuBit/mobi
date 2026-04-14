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

import { theme as antTheme, Drawer, FloatButton, Typography, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useParams } from '@tanstack/react-router'
import { useUiStore } from '@/stores/uiStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { SessionList } from '@/components/session/SessionList'
import { PlusOutlined, UnorderedListOutlined } from '@ant-design/icons'
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
 * 通过右上角 FloatButton 触发：
 * - PC 端：右侧 Drawer
 * - 移动端：底部 Drawer（最高 85%）
 */
export function SessionListDrawer() {
    const { token } = useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const params = useParams({ strict: false })
    const sessionId = params.sessionId as string | undefined
    const { sessionListDrawerOpen, setSessionListDrawerOpen } = useUiStore()

    const handleOpen = () => setSessionListDrawerOpen(true)
    const handleClose = () => setSessionListDrawerOpen(false)

    const handleNewSession = () => {
        // TODO: 实现新建会话
        console.log('New session')
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

    // 移动端：底部 Drawer（自适应高度，最高 85%）
    if (isMobile) {
        return (
            <>
                <FloatButton
                    icon={<UnorderedListOutlined />}
                    onClick={handleOpen}
                    style={{ right: 16, top: 16 }}
                />
                <Drawer
                    open={sessionListDrawerOpen}
                    onClose={handleClose}
                    placement="bottom"
                    closable={false}
                    styles={{
                        body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
                        header: { display: 'none' },
                        wrapper: { height: 'auto', maxHeight: '85vh' },
                    }}
                >
                    {drawerContent}
                </Drawer>
            </>
        )
    }

    // PC 端：右侧 Drawer
    return (
        <>
            <FloatButton
                icon={<UnorderedListOutlined />}
                onClick={handleOpen}
                style={{ right: 24, top: 24 }}
            />
            <Drawer
                open={sessionListDrawerOpen}
                onClose={handleClose}
                placement="right"
                closable={false}
                width={300}
                styles={{
                    body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
                    header: { display: 'none' },
                }}
            >
                {drawerContent}
            </Drawer>
        </>
    )
}
