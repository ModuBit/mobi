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

import { List, Tag, Spin, Empty, Typography } from 'antd'
import { useGitStatus } from '@/hooks/queries/useGitStatus'
import { useState } from 'react'
import DiffView from './DiffView'

const { Text } = Typography

interface GitStatusProps {
    sessionId: string
}

/**
 * 获取状态标签颜色
 */
function getStatusColor(status: string): string {
    switch (status) {
        case 'M': return 'orange'
        case 'A': return 'green'
        case 'D': return 'red'
        case 'R': return 'blue'
        case '?': return 'default'
        default: return 'default'
    }
}

/**
 * 获取状态文本
 */
function getStatusText(status: string): string {
    switch (status) {
        case 'M': return 'Modified'
        case 'A': return 'Added'
        case 'D': return 'Deleted'
        case 'R': return 'Renamed'
        case '?': return 'Untracked'
        default: return status
    }
}

export default function GitStatus({ sessionId }: GitStatusProps) {
    const { data: gitStatus, isLoading } = useGitStatus(sessionId)
    const [selectedFile, setSelectedFile] = useState<string | null>(null)

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin />
            </div>
        )
    }

    const files = gitStatus?.files || []
    const branch = gitStatus?.branch || 'unknown'
    const ahead = gitStatus?.ahead || 0
    const behind = gitStatus?.behind || 0

    if (files.length === 0) {
        return (
            <div style={{ padding: 16 }}>
                <Empty description="没有待提交的更改" style={{ marginTop: 40 }} />
            </div>
        )
    }

    return (
        <div style={{ height: 'calc(100vh - 130px)', display: 'flex' }}>
            {/* 文件列表 */}
            <div style={{ width: '40%', borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
                {/* 头部信息 */}
                <div style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    background: '#fafafa',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1
                }}>
                    <div>
                        <Text strong>Git Status</Text>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {branch}
                        </Text>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        {files.length} 个文件变更
                        {ahead > 0 && <span style={{ marginLeft: 8 }}>↑ {ahead}</span>}
                        {behind > 0 && <span style={{ marginLeft: 8 }}>↓ {behind}</span>}
                    </div>
                </div>

                {/* 文件列表 */}
                <List
                    size="small"
                    dataSource={files}
                    renderItem={(file) => (
                        <List.Item
                            style={{
                                cursor: 'pointer',
                                padding: '8px 12px',
                                background: selectedFile === file.path ? '#e6f7ff' : undefined,
                                transition: 'background 0.2s',
                            }}
                            onClick={() => setSelectedFile(file.path)}
                        >
                            <Tag
                                color={getStatusColor(file.status)}
                                style={{ margin: 0, minWidth: 70, textAlign: 'center' }}
                            >
                                {getStatusText(file.status)}
                            </Tag>
                            <Text
                                ellipsis
                                style={{ flex: 1, marginLeft: 8, fontSize: 12 }}
                                title={file.path}
                            >
                                {file.path}
                            </Text>
                        </List.Item>
                    )}
                />
            </div>

            {/* Diff 视图 */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {selectedFile ? (
                    <DiffView sessionId={sessionId} filePath={selectedFile} />
                ) : (
                    <Empty description="选择文件查看 Diff" style={{ marginTop: 40 }} />
                )}
            </div>
        </div>
    )
}
