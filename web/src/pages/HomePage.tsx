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

import { Typography, Button, Space } from 'antd'
import { SessionList } from '@/components/session/SessionList'
import { PlusOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/stores/authStore'

const { Title } = Typography

export function HomePage() {
    const { logout } = useAuthStore()

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{
                padding: '16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#fff'
            }}>
                <Title level={4} style={{ margin: 0 }}>Mobi</Title>
                <Space>
                    <Button type="primary" icon={<PlusOutlined />} size="small">
                        新建会话
                    </Button>
                    <Button
                        icon={<LogoutOutlined />}
                        size="small"
                        onClick={logout}
                    >
                        退出
                    </Button>
                </Space>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
                <SessionList />
            </div>
        </div>
    )
}
