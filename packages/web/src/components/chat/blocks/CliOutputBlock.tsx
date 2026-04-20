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

import { useState, memo } from 'react'
import { Think } from '@ant-design/x'
import { theme as antTheme } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { CliOutputDetailDrawer } from '../CliOutputDetailDrawer'
import { parseCliOutputText } from '@/domain/chat'

/** CLI 输出渲染（使用 Think 组件，与 ToolCall 渲染风格统一） */
export const CliOutputBlock = memo(function CliOutputBlock({ text }: { text: string }) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(true)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const { command, stdout, stderr } = parseCliOutputText(text)
    const hasOutput = !!stdout || !!stderr

    return (
        <>
            <Think
                icon={<CodeOutlined />}
                title={
                    <span style={{ fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                        {command}
                    </span>
                }
                expanded={expanded}
                onExpand={setExpanded}
            >
                {hasOutput ? (
                    <div style={{ position: 'relative', marginTop: 4 }}>
                        <OverflowContainer
                            maxHeight={200}
                            className="hide-scrollbar"
                            onClickExpand={() => setDrawerOpen(true)}
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 12,
                                lineHeight: 1.6,
                                whiteSpace: 'pre',
                                overflowX: 'hidden',
                            }}
                        >
                            {stdout && <span style={{ color: token.colorTextSecondary }}>{stdout}</span>}
                            {stderr && (
                                <span style={{ color: token.colorError }}>
                                    {stdout ? '\n' : ''}
                                    {stderr}
                                </span>
                            )}
                        </OverflowContainer>
                    </div>
                ) : (
                    <div style={{ marginTop: 4, fontSize: 12, color: token.colorTextQuaternary, fontStyle: 'italic' }}>
                        {t('chat.tool.noOutput')}
                    </div>
                )}
            </Think>
            <CliOutputDetailDrawer
                title={command}
                stdout={stdout}
                stderr={stderr}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </>
    )
})
