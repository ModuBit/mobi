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

import { Layout } from 'antd'
import type { ReactNode } from 'react'

const { Sider, Content } = Layout

interface AppLayoutProps {
    sidebar?: ReactNode
    children: ReactNode
    sidebarOpen?: boolean
    onSidebarToggle?: () => void
}

export function AppLayout({ sidebar, children, sidebarOpen = true, onSidebarToggle }: AppLayoutProps) {
    return (
        <Layout style={{ height: '100vh' }}>
            {sidebar && (
                <Sider
                    width={280}
                    breakpoint="md"
                    collapsedWidth="0"
                    collapsed={!sidebarOpen}
                    onCollapse={(collapsed) => {
                        if (onSidebarToggle) onSidebarToggle()
                    }}
                    style={{
                        overflow: 'auto',
                        height: '100vh',
                        background: '#fff',
                        borderRight: '1px solid #f0f0f0'
                    }}
                >
                    {sidebar}
                </Sider>
            )}
            <Content style={{ overflow: 'hidden', height: '100vh', display: 'flex', flexDirection: 'column' }}>
                {children}
            </Content>
        </Layout>
    )
}
