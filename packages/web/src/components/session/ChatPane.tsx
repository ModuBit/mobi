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

import { useRef } from 'react'
import { Layout, Button } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import styled from '@emotion/styled'
import { PageHeader } from '@/components/layout/PageHeader'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { ChatContainer } from '@/components/chat/ChatContainer'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { EdgeSwipeBack } from '@/components/ui/EdgeSwipeBack'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useElementHeightVar } from '@/core/hooks/useElementHeightVar'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import type { AgentStatus } from '@/components/pixel-avatar/types'

// $ 前缀 transient prop：emotion 默认不透传到 DOM（项目惯例，同 MobileMenu.styles 的 $token）
const ChatWrapper = styled.div<{ $padTop?: boolean }>`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    /* 移动端 header 浮层让位：--chat-header-h 由 ResizeObserver 同步
     * （useElementHeightVar 挂在 header 浮层 wrapper 上，变量写在它的父容器
     * = 浮层结构最外层 relative div，ChatWrapper 是其后代可继承） */
    padding-top: ${p => (p.$padTop ? 'var(--chat-header-h, 0px)' : '0')};
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
 * - 移动端：header 区浮层化（毛玻璃 GlassHeader），消息从其下滚过被模糊，
 *   滚动区以 padding-top 让位（高度经 --chat-header-h 实时跟随）；
 *   桌面端保持原 flex 流结构不变
 */
export function ChatPane({ sessionId, session, displayName, agentStatus }: ChatPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)

    const showExpand = !expanded

    // header 浮层 wrapper：高度同步为父容器（relative div）的 --chat-header-h，
    // 供 ChatWrapper padding-top 继承（写入链见 ChatWrapper 注释）
    const headerWrapRef = useRef<HTMLDivElement>(null)
    useElementHeightVar(headerWrapRef, '--chat-header-h')

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

    const headerRight = showExpand && (
        <AppTooltip title={t('session.inspector.expand')}>
            <Button
                type="text"
                size="small"
                icon={<PanelRight size={16} />}
                onClick={() => setExpanded(sessionId, true)}
            />
        </AppTooltip>
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
            {isMobile ? (
                /* 移动端浮层结构：滚动区占满全高，header 毛玻璃浮层叠其上 */
                <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Layout.Content style={{ position: 'relative', overflow: 'hidden', flex: 1 }}>
                        <ChatWrapper $padTop>
                            {chatContainer}
                            {/* 顶部 edge fade：消息从毛玻璃 GlassHeader 下滚过时自然淡出（与底部对称）。
                                zIndex 4 低于 header 浮层（zIndex 6），透过半透明玻璃形成融合 */}
                            <div className="chat-edge-fade-top" />
                        </ChatWrapper>
                    </Layout.Content>
                    {/* header 浮层：消息从其下滚过被毛玻璃模糊。
                        zIndex 6 高于 Composer 浮层（5）/ edge fade（4）；
                        高度经 ResizeObserver 同步为父容器 --chat-header-h 供下方让位 */}
                    <div
                        ref={headerWrapRef}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            zIndex: 6,
                            background: 'var(--glass-bg)',
                            backdropFilter: 'var(--glass-blur)',
                            WebkitBackdropFilter: 'var(--glass-blur)',
                            borderBottom: 'var(--glass-edge)',
                        }}
                    >
                        <PageHeader left={headerLeft} right={headerRight} />
                        <SessionContextBar
                            metadata={session.metadata as SessionMetadataSummary | null}
                        />
                    </div>
                </div>
            ) : (
                /* 桌面端原结构：header 区在滚动区外的 flex 流中 */
                <>
                    <PageHeader left={headerLeft} right={headerRight} />

                    <SessionContextBar
                        metadata={session.metadata as SessionMetadataSummary | null}
                    />

                    <Layout.Content style={{ position: 'relative', overflow: 'hidden' }}>
                        <ChatWrapper>
                            {chatContainer}
                        </ChatWrapper>
                    </Layout.Content>
                </>
            )}

            {/* 左缘右滑开侧栏（仅移动端；fixed 定位不参与 flex 布局） */}
            {isMobile && <EdgeSwipeBack />}
        </Layout>
    )
}
