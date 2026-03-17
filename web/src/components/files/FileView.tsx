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

import { theme as antTheme, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/uiStore'
import FileTree from './FileTree'
import GitStatus from '@/components/git/GitStatus'
import { ArrowLeft, Folder, GitBranch } from 'lucide-react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const FileViewContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${props => props.$token.colorBgLayout};
`

const FileViewHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: ${props => props.$token.colorBgContainer};
    border-bottom: 1px solid ${props => props.$token.colorBorder};
`

const BackButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    margin-right: 12px;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

const TabsContainer = styled.div`
    margin-left: auto;
`

const ContentArea = styled.div`
    flex: 1;
    overflow: hidden;
`

interface FileViewProps {
    sessionId: string
}

export function FileView({ sessionId }: FileViewProps) {
    const { token } = useToken()
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
        <FileViewContainer $token={token}>
            <FileViewHeader $token={token}>
                <BackButton $token={token} onClick={handleBack}>
                    <ArrowLeft size={18} />
                </BackButton>
                <TabsContainer>
                    <Tabs
                        activeKey={fileViewTab}
                        onChange={(key) => setFileViewTab(key as 'files' | 'git')}
                        items={tabItems}
                        size="small"
                    />
                </TabsContainer>
            </FileViewHeader>
            <ContentArea>
                {fileViewTab === 'files' ? (
                    <FileTree sessionId={sessionId} />
                ) : (
                    <GitStatus sessionId={sessionId} />
                )}
            </ContentArea>
        </FileViewContainer>
    )
}
