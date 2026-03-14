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

import { Tabs, Spin, Result, Button } from 'antd'
import { useParams, useNavigate } from '@tanstack/react-router'
import { useSession } from '@/hooks/queries/useSession'
import { SessionHeader } from '@/components/session/SessionHeader'
import { ChatContainer } from '@/components/chat/ChatContainer'
import { Suspense, lazy } from 'react'

// 懒加载较大的组件
const FileTree = lazy(() => import('@/components/files/FileTree'))
const GitStatus = lazy(() => import('@/components/git/GitStatus'))
const TerminalView = lazy(() => import('@/components/terminal/TerminalView'))

export function SessionPage() {
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const navigate = useNavigate()
    const { data: session, isLoading, error } = useSession(sessionId)

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Spin size="large" />
            </div>
        )
    }

    if (error || !session) {
        return (
            <Result
                status="error"
                title="加载会话失败"
                subTitle="会话不存在或已被删除"
                extra={
                    <Button type="primary" onClick={() => navigate({ to: '/' })}>
                        返回首页
                    </Button>
                }
            />
        )
    }

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <SessionHeader session={session} />
            <Tabs
                defaultActiveKey="chat"
                size="small"
                style={{ flex: 1, overflow: 'hidden' }}
                tabBarStyle={{ margin: '0 16px', marginBottom: 0 }}
                items={[
                    {
                        key: 'chat',
                        label: '对话',
                        children: (
                            <div style={{ height: 'calc(100vh - 100px)' }}>
                                <ChatContainer sessionId={sessionId} />
                            </div>
                        )
                    },
                    {
                        key: 'files',
                        label: '文件',
                        children: (
                            <Suspense fallback={<Spin style={{ display: 'block', margin: '20px auto' }} />}>
                                <FileTree sessionId={sessionId} />
                            </Suspense>
                        )
                    },
                    {
                        key: 'git',
                        label: 'Git',
                        children: (
                            <Suspense fallback={<Spin style={{ display: 'block', margin: '20px auto' }} />}>
                                <GitStatus sessionId={sessionId} />
                            </Suspense>
                        )
                    },
                    {
                        key: 'terminal',
                        label: '终端',
                        children: (
                            <Suspense fallback={<Spin style={{ display: 'block', margin: '20px auto' }} />}>
                                <TerminalView sessionId={sessionId} />
                            </Suspense>
                        )
                    },
                ]}
            />
        </div>
    )
}
