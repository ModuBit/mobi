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

import { Layout, Spin, Result, Button, Tooltip } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useUiStore } from '@/core/data/stores/uiStore'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { ChatContainer } from '@/components/chat/ChatContainer'
import type { ActionItem } from '@/components/composer/ResponsiveActionBar'
import { FileView } from '@/components/files/FileView'
import TerminalView from '@/components/terminal/TerminalView'
import { IconButton } from '@/components/ui/IconButton'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { PageHeader } from '@/components/layout/PageHeader'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { getAgentStatus } from '@/components/pixel-avatar/types'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { Folder, Terminal, ArrowLeft, List } from 'lucide-react'
import styled from '@emotion/styled'

const ContentArea = styled.div`
    flex: 1;
    position: relative;
    overflow: hidden;
`

const ChatWrapper = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
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
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: session, isLoading, error } = useSession(sessionId)
    const { sessionViewMode, setSessionViewMode, setSessionListDrawerOpen } = useUiStore()
    const isMobile = useIsMobile()

    const viewModeItems: ActionItem[] = useMemo(() => ([
        { key: 'files', labelKey: 'session.tabs.files', Icon: Folder, mode: 'files' as const },
        { key: 'terminal', labelKey: 'session.tabs.terminal', Icon: Terminal, mode: 'terminal' as const },
    ].map(({ key, labelKey, Icon, mode }) => ({
        key,
        label: t(labelKey),
        render: () => (
            <Tooltip title={t(labelKey)}>
                <Button
                    type="text"
                    size="small"
                    icon={<Icon size={14} />}
                    onClick={() => setSessionViewMode(sessionViewMode === mode ? 'chat' : mode)}
                    style={{
                        borderRadius: '50%',
                        color: sessionViewMode === mode ? 'var(--ant-color-primary)' : undefined,
                    }}
                />
            </Tooltip>
        ),
    }))), [t, sessionViewMode])

    const agentStatus = useMemo(
        () => getAgentStatus({
            active: session?.active ?? false,
            running: session?.running ?? false,
            agentState: session?.agentState ?? null,
        }),
        [session?.active, session?.running, session?.agentState],
    )

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
        <Layout style={{ height: '100%' }}>
            <PageHeader
                left={
                    <>
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
                        <PixelAvatar name={sessionId} status={agentStatus} size={18} />
                        <span
                            style={{
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                minWidth: 0,
                                flex: '1 1 auto',
                            }}
                        >
                            {displayName}
                        </span>
                    </>
                }
                right={
                    <IconButton
                        icon={<List size={18} />}
                        tooltip={t('nav.sessions')}
                        onClick={() => setSessionListDrawerOpen(true)}
                    />
                }
            />

            <SessionContextBar metadata={session.metadata as SessionMetadataSummary | null} />

            <Layout.Content style={{ position: 'relative', overflow: 'hidden' }}>
                {/* 聊天视图：条件渲染，非可见时不挂载以节省资源 */}
                {sessionViewMode === 'chat' && (
                    <ChatWrapper>
                        <ChatContainer sessionId={sessionId} extraComposerItems={viewModeItems} />
                    </ChatWrapper>
                )}

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
            </Layout.Content>
        </Layout>
    )
}
