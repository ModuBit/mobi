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

import { Collapse, Tag, Typography, Empty, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { CodeOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { ParsedToolCallBlock, ParsedToolResultBlock } from '@/domain/chat/messageParser'

const { Text } = Typography
const { useToken } = antTheme

interface ToolCallBlockProps {
    block: ParsedToolCallBlock
}

interface ToolResultBlockProps {
    block: ParsedToolResultBlock
}

export function ToolCallBlock({ block }: ToolCallBlockProps) {
    const { token } = useToken()
    const { t } = useTranslation()
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
                                <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.tool.input')}</Text>
                                <pre style={{
                                    background: token.colorBgContainer,
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    overflowX: 'auto',
                                    margin: '4px 0',
                                    border: `1px solid ${token.colorBorder}`
                                }}>
                                    {inputStr}
                                </pre>
                            </div>
                        )}
                        {block.description && (
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.tool.description')}</Text>
                                <pre style={{
                                    background: token.colorInfoBg,
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    overflowX: 'auto',
                                    margin: '4px 0',
                                    border: `1px solid ${token.colorInfoBorder}`
                                }}>
                                    {block.description}
                                </pre>
                            </div>
                        )}
                        {!inputStr && !block.description && <Empty description={t('chat.tool.noContent')} />}
                    </div>
                )
            }]}
        />
    )
}

export function ToolResultBlock({ block }: ToolResultBlockProps) {
    const { token } = useToken()
    const { t } = useTranslation()
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
                                <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.tool.output')}</Text>
                                <pre style={{
                                    background: isError ? token.colorErrorBg : token.colorSuccessBg,
                                    border: `1px solid ${isError ? token.colorErrorBorder : token.colorSuccessBorder}`,
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
                        {!resultStr && <Empty description={t('chat.tool.noContent')} />}
                    </div>
                )
            }]}
        />
    )
}
