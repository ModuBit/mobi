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
import { PanelRightClose, Folder, Terminal, FileSearch, Maximize, Minimize, Plus, PlayCircle } from 'lucide-react'
import FileTreeView from '@/components/files/FileTreeView'
import FileContentView from '@/components/files/FileContentView'
import { InspectorEmptyState } from './InspectorEmptyState'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useWorkspaceStore, type InspectorTabEntry } from '@/core/data/stores/workspaceStore'

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

    // session 离线（CLI runner 未连接）：覆盖「恢复会话」层。
    // 不渲染文件树/空态，避免触发注定失败的 RPC（handler 注册在 runner 侧）。
    // active 与 mode 正交，local/remote 一视同仁；local+active 文件浏览本就可用，无需此层。
    if (!active) {
        return (
            <Layout style={{ height: '100%', position: 'relative' }}>
                <ResumeCover loading={isResumePending} onResume={() => resumeSession()} label={t('composer.activate')} />
                <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 2 }}>{rightChrome}</div>
            </Layout>
        )
    }

    // 空态：居中 3 按钮（仅展开且无 tab 时）
    if (expanded && tabs.length === 0) {
        return (
            <Layout style={{ height: '100%', position: 'relative' }}>
                <InspectorEmptyState onOpenFile={() => openFileTreeTab(sessionId)} />
                {rightChrome}
            </Layout>
        )
    }

    if (!everExpanded) return <Layout style={{ height: '100%' }} />

    const addMenuItems: MenuProps['items'] = [
        {
            key: 'file',
            icon: <Folder size={14} />,
            label: t('session.inspector.openFile'),
            onClick: () => openFileTreeTab(sessionId),
        },
        { key: 'terminal', icon: <Terminal size={14} />, label: t('session.inspector.terminal'), disabled: true },
        { key: 'review', icon: <FileSearch size={14} />, label: t('session.inspector.review'), disabled: true },
    ]

    const renderTabContent = (tab: InspectorTabEntry): ReactNode => {
        if (tab.mode === 'file' && tab.filePath) {
            return <FileContentView sessionId={sessionId} filePath={tab.filePath} />
        }
        return (
            <FileTreeView
                sessionId={sessionId}
                onOpenFile={(filePath, fileName) => openFileInTab(sessionId, tab.id, filePath, fileName)}
            />
        )
    }

    const tabItems = [
        ...tabs.map((tab) => ({
            key: tab.id,
            label: (
                <Tooltip title={tab.mode === 'file' ? tab.filePath : ''}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {tab.mode === 'file' ? <FileSearch size={14} /> : <Folder size={14} />}
                        {tab.mode === 'file' ? tab.fileName : t('session.inspector.openFile')}
                    </span>
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

    return (
        <Layout style={{ height: '100%' }}>
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
                        closeTab(sessionId, targetKey)
                    }
                }}
                tabBarStyle={{ padding: '0 12px', margin: 0 }}
                tabBarExtraContent={{ right: rightChrome }}
            />
        </Layout>
    )
}

/** session 离线覆盖层：居中「恢复会话」按钮，覆盖整个检视面板内容区。 */
function ResumeCover({ loading, onResume, label }: {
    loading: boolean
    onResume: () => void
    label: string
}) {
    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <Button type="primary" icon={<PlayCircle size={18} />} loading={loading} onClick={onResume}>
                {label}
            </Button>
        </div>
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
