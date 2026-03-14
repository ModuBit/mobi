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

import { List, Empty, Skeleton } from 'antd'
import { SessionCard } from './SessionCard'
import { useSessions } from '@/hooks/queries/useSessions'

export function SessionList() {
    const { data: sessions = [], isLoading } = useSessions()

    if (isLoading) {
        return <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 16 }} />
    }

    if (sessions.length === 0) {
        return (
            <Empty
                description="暂无会话"
                style={{ marginTop: 40 }}
            />
        )
    }

    // 按更新时间排序，活跃会话在前
    const sorted = [...sessions].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return (b.updatedAt || 0) - (a.updatedAt || 0)
    })

    return (
        <List
            dataSource={sorted}
            renderItem={(session) => (
                <List.Item style={{ padding: '4px 12px', borderBottom: 'none' }}>
                    <SessionCard session={session} />
                </List.Item>
            )}
            style={{ padding: '8px 4px' }}
        />
    )
}
