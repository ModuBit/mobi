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

import { useEffect, useState } from 'react'
import { Layout, Tabs, Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, Folder, GitBranch, Terminal, Maximize2, Minimize2 } from 'lucide-react'
import { FileView } from '@/components/files/FileView'
import GitStatus from '@/components/git/GitStatus'
import TerminalView from '@/components/terminal/TerminalView'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWorkspaceStore, type InspectorTab } from '@/core/data/stores/workspaceStore'

export interface InspectorPaneProps {
    sessionId: string
}

export function InspectorPane({ sessionId }: InspectorPaneProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const activeTab = useWorkspaceStore((s) => s.getSession(sessionId).activeTab)
    const chatHidden = useWorkspaceStore((s) => s.getSession(sessionId).chatHidden)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
    const setChatHidden = useWorkspaceStore((s) => s.setChatHidden)

    // everExpanded：首次展开后恒为 true，保证内容挂载后续由 destroyOnHidden 保留
    const [everExpanded, setEverExpanded] = useState(false)
    useEffect(() => {
        if (expanded) setEverExpanded(true)
    }, [expanded])

    const tabItems = [
        {
            key: 'files' as InspectorTab,
            label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Folder size={14} />
                    {t('session.tabs.files')}
                </span>
            ),
            children: <FileView sessionId={sessionId} />,
        },
        {
            key: 'git' as InspectorTab,
            label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GitBranch size={14} />
                    {t('session.tabs.git')}
                </span>
            ),
            children: <GitStatus sessionId={sessionId} />,
        },
        {
            key: 'terminal' as InspectorTab,
            label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Terminal size={14} />
                    {t('session.tabs.terminal')}
                </span>
            ),
            children: <TerminalView sessionId={sessionId} />,
        },
    ]

    return (
        <Layout style={{ height: '100%' }}>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(sessionId, key as InspectorTab)}
                items={everExpanded ? tabItems : []}
                size="small"
                destroyOnHidden={false}
                tabBarStyle={{ padding: '0 12px', margin: 0 }}
                tabBarExtraContent={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {/* 最大化/恢复：检视面板占满、聊天归零（仅桌面；移动端不提供） */}
                        {!isMobile && (
                            chatHidden ? (
                                <Tooltip title={t('session.inspector.restore')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Minimize2 size={16} />}
                                        onClick={() => setChatHidden(sessionId, false)}
                                    />
                                </Tooltip>
                            ) : (
                                <Tooltip title={t('session.inspector.maximize')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Maximize2 size={16} />}
                                        onClick={() => setChatHidden(sessionId, true)}
                                    />
                                </Tooltip>
                            )
                        )}
                        <Tooltip title={t('session.inspector.collapse')}>
                            <Button
                                type="text"
                                size="small"
                                icon={<PanelRightClose size={16} />}
                                onClick={() => setExpanded(sessionId, false)}
                            />
                        </Tooltip>
                    </div>
                }
            />
        </Layout>
    )
}
