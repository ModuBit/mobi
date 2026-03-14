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

import { Collapse, Tag, Typography, Empty } from 'antd'
import { CodeOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { ParsedToolCallBlock, ParsedToolResultBlock } from './messageParser'

const { Text } = Typography

interface ToolCallBlockProps {
    block: ParsedToolCallBlock
}

interface ToolResultBlockProps {
    block: ParsedToolResultBlock
}

export function ToolCallBlock({ block }: ToolCallBlockProps) {
    const toolName = block.name || 'Unknown Tool'

    // 工具输入
    const inputStr = block.input
        ? typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input, null, 2)
        : ''

    return (
        <Collapse
            size="small"
            items={[{
                key: '1',
                label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CodeOutlined />
                        <Tag color="blue" style={{ margin: 0 }}>{toolName}</Tag>
                    </span>
                ),
                children: (
                    <div>
                        {inputStr && (
                            <div style={{ marginBottom: 8 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>输入:</Text>
                                <pre style={{
                                    background: '#f5f5f5',
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    overflowX: 'auto',
                                    margin: '4px 0'
                                }}>
                                    {inputStr}
                                </pre>
                            </div>
                        )}
                        {block.description && (
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>描述:</Text>
                                <pre style={{
                                    background: '#e6f7ff',
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    overflowX: 'auto',
                                    margin: '4px 0'
                                }}>
                                    {block.description}
                                </pre>
                            </div>
                        )}
                        {!inputStr && !block.description && <Empty description="无内容" />}
                    </div>
                )
            }]}
        />
    )
}

export function ToolResultBlock({ block }: ToolResultBlockProps) {
    const isError = block.is_error

    // 工具结果
    const resultStr = block.content
        ? typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2)
        : ''

    // 状态图标
    const StatusIcon = isError ? CloseCircleOutlined : CheckCircleOutlined
    const statusColor = isError ? 'red' : 'green'

    return (
        <Collapse
            size="small"
            items={[{
                key: '1',
                label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CodeOutlined />
                        <Tag color="green" style={{ margin: 0 }}>Tool Result</Tag>
                        <StatusIcon style={{ color: statusColor }} />
                    </span>
                ),
                children: (
                    <div>
                        {resultStr && (
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>输出:</Text>
                                <pre style={{
                                    background: isError ? '#fff2f0' : '#f6ffed',
                                    border: `1px solid ${isError ? '#ffa39e' : '#b7eb8f'}`,
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    overflowX: 'auto',
                                    margin: '4px 0',
                                    maxHeight: 300,
                                    overflowY: 'auto'
                                }}>
                                    {resultStr}
                                </pre>
                            </div>
                        )}
                        {!resultStr && <Empty description="无内容" />}
                    </div>
                )
            }]}
        />
    )
}
