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

import { Layout, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/core/data/stores/uiStore'
import FileTree from './FileTree'
import GitStatus from '@/components/git/GitStatus'
import { PageHeader } from '@/components/layout/PageHeader'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { IconButton } from '@/components/ui/IconButton'
import { ArrowLeft, Folder, GitBranch } from 'lucide-react'

interface FileViewProps {
    sessionId: string
}

export function FileView({ sessionId }: FileViewProps) {
    const { t } = useTranslation()
    const { fileViewTab, setFileViewTab, setSessionViewMode } = useUiStore()

    const handleBack = () => {
        setSessionViewMode('chat')
    }

    const tabItems = [
        {
            key: 'files',
            label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Folder size={14} />
                    {t('session.tabs.files')}
                </span>
            ),
        },
        {
            key: 'git',
            label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GitBranch size={14} />
                    {t('session.tabs.git')}
                </span>
            ),
        },
    ]

    return (
        <Layout style={{ height: '100%' }}>
            <PageHeader
                left={
                    <>
                        <SidebarToggle />
                        <IconButton
                            icon={<ArrowLeft size={18} />}
                            onClick={handleBack}
                        />
                    </>
                }
                right={
                    <Tabs
                        activeKey={fileViewTab}
                        onChange={(key) => setFileViewTab(key as 'files' | 'git')}
                        items={tabItems}
                        size="small"
                    />
                }
            />
            <Layout.Content style={{ flex: 1, overflow: 'hidden' }}>
                {fileViewTab === 'files' ? (
                    <FileTree sessionId={sessionId} />
                ) : (
                    <GitStatus sessionId={sessionId} />
                )}
            </Layout.Content>
        </Layout>
    )
}
