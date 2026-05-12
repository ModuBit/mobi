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

/**
 * CLI 输出详情抽屉
 * 在 Drawer 中展示完整的 stdout/stderr 输出
 */

import { memo, useMemo, type CSSProperties } from 'react'
import { theme } from 'antd'
import type { GlobalToken } from 'antd/es/theme/interface'
import { useTranslation } from 'react-i18next'
import { ansiToHtml } from '@/core/lib/ansiUtils'
import { ContentDrawer } from '@/components/ui/ContentDrawer'

// 用于 pre 标签的通用样式
const preStyle = (token: GlobalToken, extra?: CSSProperties): CSSProperties => ({
    background: token.colorBgContainer,
    padding: 8,
    borderRadius: 4,
    fontSize: 12,
    overflowX: 'auto',
    margin: '4px 0',
    border: `1px solid ${token.colorBorder}`,
    whiteSpace: 'pre',
    fontFamily: 'var(--font-mono)',
    ...extra,
})

interface CliOutputDetailDrawerProps {
    title: string | null
    stdout: string | null
    stderr: string | null
    open: boolean
    onClose: () => void
}

export const CliOutputDetailDrawer = memo(function CliOutputDetailDrawer({
    title,
    stdout,
    stderr,
    open,
    onClose,
}: CliOutputDetailDrawerProps) {
    const { token } = theme.useToken()
    const { t } = useTranslation()

    const stdoutHtml = useMemo(() => stdout ? ansiToHtml(stdout) : '', [stdout])
    const stderrHtml = useMemo(() => stderr ? ansiToHtml(stderr) : '', [stderr])

    return (
        <ContentDrawer
            title={title}
            open={open}
            onClose={onClose}
        >
            {stdout && (
                <div style={{ padding: '12px 16px' }}>
                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                        {t('chat.tool.output')}
                    </div>
                    <pre style={preStyle(token)} dangerouslySetInnerHTML={{ __html: stdoutHtml }} />
                </div>
            )}
            {stdout && stderr && (
                <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}`, margin: '0 16px' }} />
            )}
            {stderr && (
                <div style={{ padding: '12px 16px' }}>
                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                        stderr
                    </div>
                    <pre style={preStyle(token, { color: token.colorError })} dangerouslySetInnerHTML={{ __html: stderrHtml }} />
                </div>
            )}
        </ContentDrawer>
    )
})
