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

import { Layout, Tooltip, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { LogoutOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { PageHeader } from '@/components/layout/PageHeader'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { ChatContainer } from '@/components/chat/ChatContainer'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import type { AgentStatus } from '@/components/pixel-avatar/types'

const ChatWrapper = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
`

export interface ChatPaneProps {
    sessionId: string
    session: Session
    displayName: string
    agentStatus: AgentStatus
}

/**
 * 左侧聊天面板（Splitter 左 pane）
 *
 * 承载 PageHeader（SidebarToggle / 移动端 MobileMenuButton / PixelAvatar / 会话名 /
 * 展开按钮 / 退出会话按钮）+ SessionContextBar + ChatContainer。
 * - 展开按钮仅在检视面板收起（!expanded）时显示
 * - 退出会话按钮仅在会话激活（session.active）时显示
 */
export function ChatPane({ sessionId, session, displayName, agentStatus }: ChatPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const sessionActions = useSessionActions(sessionId)

    const handleArchive = async () => {
        await sessionActions.archiveSession()
    }

    const showExpand = !expanded
    const showExit = session.active === true

    return (
        <Layout style={{ height: '100%' }}>
            <PageHeader
                left={
                    <>
                        <SidebarToggle />
                        {isMobile && <MobileMenuButton />}
                        <PixelAvatar name={sessionId} status={agentStatus} size={18} />
                        <span
                            style={{
                                fontFamily: 'var(--font-body)',
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
                right={(showExpand || showExit) && (
                    <>
                        {showExit && (
                            <Tooltip title={t('session.actions.archive')}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<LogoutOutlined />}
                                    loading={sessionActions.isArchivePending}
                                    onClick={handleArchive}
                                />
                            </Tooltip>
                        )}
                        {showExpand && (
                            <Tooltip title={t('session.inspector.expand')}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<PanelRight size={16} />}
                                    onClick={() => setExpanded(sessionId, true)}
                                />
                            </Tooltip>
                        )}
                    </>
                )}
            />

            <SessionContextBar metadata={session.metadata as SessionMetadataSummary | null} />

            <Layout.Content style={{ position: 'relative', overflow: 'hidden' }}>
                <ChatWrapper>
                    <ChatContainer sessionId={sessionId} />
                </ChatWrapper>
            </Layout.Content>
        </Layout>
    )
}
