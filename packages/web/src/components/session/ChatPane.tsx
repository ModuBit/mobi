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

import { Layout, Button } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import styled from '@emotion/styled'
import { PageHeader } from '@/components/layout/PageHeader'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { ChatContainer } from '@/components/chat/ChatContainer'
import { ContextRing } from '@/components/composer/ContextRing'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { EdgeSwipeBack } from '@/components/ui/EdgeSwipeBack'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
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
 * 展开按钮）+ SessionContextBar + ChatContainer。
 * - 展开按钮仅在检视面板收起（!expanded）时显示
 * - 归档会话入口移至会话列表（SidebarProjects / MobileProjectList），避免误触
 * - 移动端另挂 EdgeSwipeBack（左缘右滑开菜单）
 */
export function ChatPane({ sessionId, session, displayName, agentStatus }: ChatPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)

    const showExpand = !expanded

    // header 内容两分支复用（同一时刻只渲染一支，元素复用安全）
    const headerLeft = (
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
    )

    const headerRight = (
        <>
            {/* 移动端水位圆环（PC 挂 composer 工具栏）——参照 codex/chatgpt 双端分流 */}
            {isMobile && session.runtimeState?.contextUsage ? (
                <ContextRing usage={session.runtimeState.contextUsage} size={22} />
            ) : null}
            {showExpand && (
                <AppTooltip title={t('session.inspector.expand')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<PanelRight size={16} />}
                        onClick={() => setExpanded(sessionId, true)}
                    />
                </AppTooltip>
            )}
        </>
    )

    // key={sessionId}：切会话必须重新挂载，不能复用组件实例。
    // 聊天容器内部有一批「只在挂载时生效」或「跨会话必须归零」的状态——
    // Virtuoso 的 initialTopMostItemIndex（仅首次挂载定位到底部）、
    // firstItemIndex 累减游标、reconcile 的 prevById 缓存、后台任务完成卡片。
    // 复用实例会让这些状态跨会话泄漏（表现为切会话后停在顶部而非最新消息）。
    // 用 key 交给 React 统一重置，胜过逐个字段手写 reset effect。
    const chatContainer = <ChatContainer key={sessionId} sessionId={sessionId} />

    return (
        <Layout style={{ height: '100%' }}>
            <PageHeader left={headerLeft} right={headerRight} />

            <SessionContextBar
                metadata={session.metadata as SessionMetadataSummary | null}
            />

            <Layout.Content style={{ position: 'relative', overflow: 'hidden' }}>
                <ChatWrapper>
                    {chatContainer}
                </ChatWrapper>
            </Layout.Content>

            {/* 左缘右滑开侧栏（仅移动端；fixed 定位不参与 flex 布局） */}
            {isMobile && <EdgeSwipeBack />}
        </Layout>
    )
}
