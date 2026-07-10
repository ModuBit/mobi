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

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Layout, Tabs, Button, Tooltip, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { PanelRightClose, Folder, FileSearch, Maximize, Minimize, Plus } from 'lucide-react'
import FileTreeView from '@/components/files/FileTreeView'
import FileContentView from '@/components/files/FileContentView'
import TerminalView from '@/components/terminal/TerminalView'
import { ActivateCover } from '@/components/ui/ActivateCover'
import { clearCachedInstance } from '@/core/hooks/useCachedInstance'
import { InspectorEmptyState } from './InspectorEmptyState'
import { TerminalTabLabel } from './TerminalTabLabel'
import { INSPECTOR_ACTIONS } from './inspectorActions'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import {
    useWorkspaceStore,
    type InspectorTabEntry,
    MAX_TERMINALS_PER_SESSION,
} from '@/core/data/stores/workspaceStore'

/**
 * editable-card 提供关闭 × 机制，但其卡片外观（边框/背景）过重。
 * 这里覆盖样式：去边框、透明背景，hover/active 用填充色，呈现简洁的胶囊式 tab。
 * 用 && 提升 emotion 选择器优先级以压过 antd 的 .ant-tabs-card 规则。
 */
const StyledTabs = styled(Tabs)`
    && > .ant-tabs-nav .ant-tabs-tab,
    && > .ant-tabs-nav .ant-tabs-tab.ant-tabs-tab-active {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 4px 10px;
        margin: 2px 2px;
    }
    && > .ant-tabs-nav .ant-tabs-tab:hover {
        background: var(--ant-color-fill-quaternary);
    }
    && > .ant-tabs-nav .ant-tabs-tab.ant-tabs-tab-active {
        background: var(--ant-color-fill-tertiary);
        border-color: transparent;
    }
    && > .ant-tabs-nav .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
        font-weight: 500;
    }
    /* tab 内容垂直居中：让只有图标的「+」与「图标+文字」tab 对齐 */
    && .ant-tabs-tab-btn {
        display: inline-flex;
        align-items: center;
    }
    /* 关闭按钮：默认隐藏，hover tab 时才显示（保留占位，避免 hover 时布局抖动） */
    && .ant-tabs-tab-remove {
        margin-inline-start: 2px;
        padding: 2px;
        border-radius: 4px;
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    && > .ant-tabs-nav .ant-tabs-tab:hover .ant-tabs-tab-remove {
        opacity: 1;
    }
    && .ant-tabs-tab-remove:hover {
        background: var(--ant-color-fill);
    }
    /* 触屏设备（无 hover）：关闭按钮常驻显示 */
    @media (hover: none) {
        && .ant-tabs-tab-remove {
            opacity: 1;
        }
    }
    /* 隐藏 editable-card 默认的底部墨条（line 风格不需要） */
    && > .ant-tabs-nav .ant-tabs-ink-bar {
        background: transparent;
    }
    /* 去掉 nav 底部分割线（editable-card 默认有一条 border-bottom） */
    && > .ant-tabs-nav::before {
        border-bottom: none;
    }
    /* 高度链：让 tab 内容占满剩余空间。
       多页 PDF / xterm 等需要 tabpane 有 bounded height 才能在内部滚动/自适应，
       否则内容会把整条链撑开（tabpane → FileContentView / TerminalView 全部 height:auto），
       表现为「不能滚动 / 终端占不满」。flex 滚动容器还需配合 minHeight:0（见各组件）。
       注意 antd v5 类名链为 body-holder > body > content > tabpane（v4 的 content-holder 已废弃）。*/
    && {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    && > .ant-tabs-body-holder {
        flex: 1;
        min-height: 0;
    }
    && > .ant-tabs-body-holder > .ant-tabs-body {
        height: 100%;
    }
    && > .ant-tabs-body-holder > .ant-tabs-body > .ant-tabs-content {
        height: 100%;
    }
    && > .ant-tabs-body-holder > .ant-tabs-body > .ant-tabs-content > .ant-tabs-tabpane {
        height: 100%;
    }
`

export interface InspectorPaneProps {
    sessionId: string
    /** session 是否在线（CLI runner 已连接）。离线时覆盖「恢复会话」层，不渲染文件树（避免无谓 RPC） */
    active?: boolean
}

/** 尾部「+」tab 的 key（仅作菜单触发，不进 store） */
const ADD_TAB_KEY = '__inspector_add'

export function InspectorPane({ sessionId, active = true }: InspectorPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const { resumeSession, isResumePending } = useSessionActions(sessionId)
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const tabs = useWorkspaceStore((s) => s.getSession(sessionId).tabs)
    const activeTabId = useWorkspaceStore((s) => s.getSession(sessionId).activeTabId)
    const chatHidden = useWorkspaceStore((s) => s.getSession(sessionId).chatHidden)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setChatHidden = useWorkspaceStore((s) => s.setChatHidden)
    const openFileTreeTab = useWorkspaceStore((s) => s.openFileTreeTab)
    const openFileInTab = useWorkspaceStore((s) => s.openFileInTab)
    const closeTab = useWorkspaceStore((s) => s.closeTab)
    const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
    const openTerminalTab = useWorkspaceStore((s) => s.openTerminalTab)
    const renameTerminalTab = useWorkspaceStore((s) => s.renameTerminalTab)
    // 终端数与上限：达上限时 disable 新建入口（叠加 INSPECTOR_ACTIONS.disabled）
    const terminalCount = tabs.filter((t) => t.mode === 'terminal').length
    const terminalLimitReached = terminalCount >= MAX_TERMINALS_PER_SESSION

    // 首次展开才挂载内容（懒加载闸）；与 destroyOnHidden={false} 分工 keepalive。
    const [everExpanded, setEverExpanded] = useState(false)
    useEffect(() => {
        if (expanded) setEverExpanded(true)
    }, [expanded])

    const rightChrome = useMemo(
        () => (
            <RightChrome
                isMobile={isMobile}
                chatHidden={chatHidden}
                onToggleChat={(v) => setChatHidden(sessionId, v)}
                onCollapse={() => setExpanded(sessionId, false)}
                t={t}
            />
        ),
        [isMobile, chatHidden, setChatHidden, setExpanded, sessionId, t],
    )

    // 「+」下拉菜单：与空态卡片共用 INSPECTOR_ACTIONS，terminal 项达上限时叠加 disable
    const addMenuItems: MenuProps['items'] = INSPECTOR_ACTIONS.map((action) => {
        const { Icon } = action
        const isTerminal = action.key === 'terminal'
        // 终端达上限：叠加 disable（即便 Task 9 启用 terminal，达上限仍不可新建）
        const disabled = action.disabled || (isTerminal && terminalLimitReached)
        return {
            key: action.key,
            icon: <Icon size={14} />,
            label: t(action.labelKey),
            disabled,
            onClick: disabled ? undefined : () => {
                if (isTerminal) openTerminalTab(sessionId)
                else openFileTreeTab(sessionId)
            },
        }
    })

    const renderTabContent = (tab: InspectorTabEntry): ReactNode => {
        if (tab.mode === 'file' && tab.filePath) {
            return <FileContentView sessionId={sessionId} tabId={tab.id} filePath={tab.filePath} />
        }
        if (tab.mode === 'terminal' && tab.terminalId) {
            return <TerminalView sessionId={sessionId} terminalId={tab.terminalId} />
        }
        return (
            <FileTreeView
                sessionId={sessionId}
                active={activeTabId === tab.id}
                onOpenFile={(filePath, fileName) => openFileInTab(sessionId, tab.id, filePath, fileName)}
            />
        )
    }

    const tabItems = [
        ...tabs.map((tab) => ({
            key: tab.id,
            label: (
                <Tooltip title={tab.mode === 'file' ? tab.filePath : ''}>
                    {tab.mode === 'terminal' ? (
                        <TerminalTabLabel
                            tab={tab}
                            onRename={(title) => renameTerminalTab(sessionId, tab.id, title)}
                        />
                    ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {tab.mode === 'file' ? <FileSearch size={14} /> : <Folder size={14} />}
                            {tab.mode === 'file' ? tab.fileName : t('session.inspector.openFile')}
                        </span>
                    )}
                </Tooltip>
            ),
            children: renderTabContent(tab),
            closable: true,
        })),
        // 尾部「+」：作为不可关闭的 tab 项，点击弹出下拉菜单新增 tab
        {
            key: ADD_TAB_KEY,
            label: (
                <Dropdown menu={{ items: addMenuItems }} trigger={['click']}>
                    <span
                        role="button"
                        aria-label={t('session.inspector.addTab')}
                        style={{ display: 'inline-flex', alignItems: 'center', padding: '0 4px' }}
                    >
                        <Plus size={14} />
                    </span>
                </Dropdown>
            ),
            children: null,
            closable: false,
            disabled: false,
        },
    ]

    const hasTabs = tabs.length > 0
    // 在线 + 空态：居中 3 按钮
    const showEmpty = active && expanded && !hasTabs

    return (
        <Layout style={{ height: '100%', position: 'relative' }}>
            {/* tab 内容：有 tab 时渲染。active 切换（在线↔离线）不卸载（destroyOnHidden + 同一条件分支），
                离线时保留作毛玻璃背景，模糊可见关闭前的内容。空态/未展开不渲染（避免无谓 RPC）。 */}
            {everExpanded && hasTabs && (
                <StyledTabs
                    type="editable-card"
                    hideAdd
                    activeKey={activeTabId ?? undefined}
                    onChange={(key) => {
                        // 「+」tab 仅作菜单触发，不切换激活
                        if (key === ADD_TAB_KEY) return
                        setActiveTab(sessionId, key)
                    }}
                    items={tabItems}
                    size="small"
                    destroyOnHidden={false}
                    onEdit={(targetKey, action) => {
                        if (action === 'remove' && typeof targetKey === 'string') {
                            // 关闭 terminal tab：清理缓存实例（dispose 发 terminal:close 杀 PTY + 断 socket）。
                            // 切换 tab 不走此处，PTY 保留（keepalive）。
                            const closingTab = tabs.find((t) => t.id === targetKey)
                            if (closingTab?.mode === 'terminal' && closingTab.terminalId) {
                                clearCachedInstance(`terminal:${sessionId}:${closingTab.terminalId}`)
                            }
                            closeTab(sessionId, targetKey)
                        }
                    }}
                    tabBarStyle={{ padding: '0 12px', margin: 0 }}
                    // 离线时 rightChrome 改为浮动定位（置于毛玻璃之上），不放进 tabBar
                    tabBarExtraContent={active ? { right: rightChrome } : undefined}
                />
            )}
            {everExpanded && showEmpty && (
                <InspectorEmptyState
                    onOpenFile={() => openFileTreeTab(sessionId)}
                    onOpenTerminal={() => openTerminalTab(sessionId)}
                    terminalDisabled={terminalLimitReached}
                />
            )}
            {/* 空态/离线态的浮动 rightChrome（tab 态的在 tabBarExtraContent）。
                zIndex 高于毛玻璃，保证离线时最大化/收起按钮可点 */}
            {(showEmpty || !active) && (
                <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 11 }}>{rightChrome}</div>
            )}
            {/* 离线毛玻璃覆盖（sender-overlay）：叠加在 tab 内容之上，模糊可见关闭前的 tab 内容 */}
            {!active && (
                <ActivateCover className="sender-overlay" loading={isResumePending} onActivate={() => resumeSession()} />
            )}
        </Layout>
    )
}

/** 右上角 chrome：最大化/恢复 + 收起。空态与 Tab 态共用。 */
function RightChrome({
    isMobile,
    chatHidden,
    onToggleChat,
    onCollapse,
    t,
}: {
    isMobile: boolean
    chatHidden: boolean
    onToggleChat: (v: boolean) => void
    onCollapse: () => void
    t: (k: string) => string
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {!isMobile && (
                chatHidden ? (
                    <Tooltip title={t('session.inspector.restore')}>
                        <Button type="text" size="small" icon={<Minimize size={16} />} onClick={() => onToggleChat(false)} />
                    </Tooltip>
                ) : (
                    <Tooltip title={t('session.inspector.maximize')}>
                        <Button type="text" size="small" icon={<Maximize size={16} />} onClick={() => onToggleChat(true)} />
                    </Tooltip>
                )
            )}
            <Tooltip title={t('session.inspector.collapse')}>
                <Button type="text" size="small" icon={<PanelRightClose size={16} />} onClick={onCollapse} />
            </Tooltip>
        </div>
    )
}
