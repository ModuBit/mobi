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

import { theme as antTheme, Spin, Result, Button, Badge } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '@/hooks/queries/useSession'
import { useUiStore } from '@/stores/uiStore'
import { ChatContainer } from '@/components/chat/ChatContainer'
import { FileView } from '@/components/files/FileView'
import TerminalView from '@/components/terminal/TerminalView'
import { IconButton } from '@/components/ui/IconButton'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getSessionDisplayName } from '@/utils/sessionUtils'
import { Folder, Terminal, ArrowLeft } from 'lucide-react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const DetailContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${props => props.$token.colorBgLayout};
`

const DetailHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: ${props => props.$token.colorBgContainer};
    border-bottom: 1px solid ${props => props.$token.colorBorder};
`

const HeaderLeft = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
`

const HeaderRight = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
`

const ContentArea = styled.div`
    flex: 1;
    position: relative;
    overflow: hidden;
`

const ChatWrapper = styled.div<{ $visible: boolean }>`
    position: absolute;
    inset: 0;
    display: ${props => props.$visible ? 'flex' : 'none'};
    flex-direction: column;
`

const OverlayView = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
`

interface SessionDetailProps {
    sessionId: string
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: session, isLoading, error } = useSession(sessionId)
    const { sessionViewMode, setSessionViewMode } = useUiStore()
    const isMobile = useIsMobile()

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin size="large" />
            </div>
        )
    }

    if (error || !session) {
        return (
            <Result
                status="error"
                title={t('session.loadFailed')}
                subTitle={t('session.notFound')}
                extra={
                    <Button type="primary" onClick={() => navigate({ to: '/' })}>
                        {t('common.backHome')}
                    </Button>
                }
            />
        )
    }

    const displayName = getSessionDisplayName(session)

    return (
        <DetailContainer $token={token}>
            {/* Header */}
            <DetailHeader $token={token}>
                <HeaderLeft>
                    {isMobile && (
                        <>
                            <MobileMenuButton />
                            <IconButton
                                icon={<ArrowLeft size={18} />}
                                tooltip={t('common.back')}
                                onClick={() => navigate({ to: '/sessions' })}
                            />
                        </>
                    )}
                    <span style={{ fontWeight: 500 }}>{displayName}</span>
                    {session.active && (
                        <Badge
                            status="processing"
                            text={session.thinking ? t('session.status.thinking') : t('session.status.active')}
                        />
                    )}
                </HeaderLeft>
                <HeaderRight>
                    <IconButton
                        icon={<Folder size={18} />}
                        active={sessionViewMode === 'files'}
                        tooltip={t('session.tabs.files')}
                        onClick={() => setSessionViewMode(sessionViewMode === 'files' ? 'chat' : 'files')}
                    />
                    <IconButton
                        icon={<Terminal size={18} />}
                        active={sessionViewMode === 'terminal'}
                        tooltip={t('session.tabs.terminal')}
                        onClick={() => setSessionViewMode(sessionViewMode === 'terminal' ? 'chat' : 'terminal')}
                    />
                </HeaderRight>
            </DetailHeader>

            {/* Content Area - 使用隐藏而非卸载来保持长连接 */}
            <ContentArea>
                {/* 聊天视图：隐藏但不卸载 */}
                <ChatWrapper $visible={sessionViewMode === 'chat'}>
                    <ChatContainer sessionId={sessionId} />
                </ChatWrapper>

                {/* 文件视图：全屏覆盖 */}
                {sessionViewMode === 'files' && (
                    <OverlayView>
                        <FileView sessionId={sessionId} />
                    </OverlayView>
                )}

                {/* 终端视图：全屏覆盖 */}
                {sessionViewMode === 'terminal' && (
                    <OverlayView>
                        <TerminalView sessionId={sessionId} />
                    </OverlayView>
                )}
            </ContentArea>
        </DetailContainer>
    )
}
