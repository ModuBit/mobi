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
import { PanelRightClose, Folder, Terminal, FileSearch, Maximize, Minimize, Plus } from 'lucide-react'
import FileTreeView from '@/components/files/FileTreeView'
import FileContentView from '@/components/files/FileContentView'
import { InspectorEmptyState } from './InspectorEmptyState'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWorkspaceStore, type InspectorTabEntry } from '@/core/data/stores/workspaceStore'

export interface InspectorPaneProps {
    sessionId: string
}

export function InspectorPane({ sessionId }: InspectorPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
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

    const tabItems = tabs.map((tab) => ({
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
    }))

    return (
        <Layout style={{ height: '100%' }}>
            <Tabs
                type="editable-card"
                hideAdd
                activeKey={activeTabId ?? undefined}
                onChange={(key) => setActiveTab(sessionId, key)}
                items={tabItems}
                size="small"
                destroyOnHidden={false}
                onEdit={(targetKey, action) => {
                    if (action === 'remove' && typeof targetKey === 'string') {
                        closeTab(sessionId, targetKey)
                    }
                }}
                tabBarStyle={{ padding: '0 12px', margin: 0 }}
                tabBarExtraContent={{
                    right: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Dropdown menu={{ items: addMenuItems }} trigger={['click']}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Plus size={16} />}
                                    aria-label={t('session.inspector.addTab')}
                                />
                            </Dropdown>
                            {rightChrome}
                        </div>
                    ),
                }}
            />
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
