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

import { useGitDiff } from '@/hooks/queries/useGitDiff'
import { Spin, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'

const { Text } = Typography
const { useToken } = antTheme

interface DiffViewProps {
    sessionId: string
    filePath: string
}

/**
 * Diff 行渲染 - 根据不同类型添加不同样式
 * 注意：Git diff 颜色保持固定（绿色=添加，红色=删除），这是业界标准
 */
function renderDiffLine(line: string, index: number, token: ReturnType<typeof useToken>['token']) {
    const style: React.CSSProperties = {
        display: 'block',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'pre',
        paddingLeft: 8,
        paddingRight: 8,
    }

    // 添加的行 - 保持绿色
    if (line.startsWith('+') && !line.startsWith('+++')) {
        style.background = '#e6ffec'
        style.color = '#22863a'
    }
    // 删除的行 - 保持红色
    else if (line.startsWith('-') && !line.startsWith('---')) {
        style.background = '#ffebe9'
        style.color = '#cb2431'
    }
    // 位置信息 - 保持蓝色
    else if (line.startsWith('@@')) {
        style.background = '#f1f8ff'
        style.color = '#0366d6'
    }
    // 文件头信息 - 使用主题色
    else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        style.fontWeight = 'bold'
        style.color = token.colorText
        style.background = token.colorBgLayout
    }

    return <span key={index} style={style}>{line || ' '}</span>
}

/**
 * Git Diff 视图组件
 */
export default function DiffView({ sessionId, filePath }: DiffViewProps) {
    const { data: diff, isLoading } = useGitDiff(sessionId, filePath)
    const { token } = useToken()
    const { t } = useTranslation()

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin />
            </div>
        )
    }

    if (!diff) {
        return (
            <div style={{ padding: 16 }}>
                <Text type="secondary">{t('git.loadFailed')}</Text>
            </div>
        )
    }

    const lines = diff.split('\n')

    return (
        <div style={{ overflow: 'auto', height: '100%' }}>
            {/* 文件路径标题 */}
            <div style={{
                padding: '8px 12px',
                borderBottom: `1px solid ${token.colorBorder}`,
                background: token.colorBgLayout,
                position: 'sticky',
                top: 0,
                zIndex: 1
            }}>
                <Text strong style={{ fontSize: 12 }}>{filePath}</Text>
            </div>

            {/* Diff 内容 */}
            <div style={{ padding: '8px 0' }}>
                {lines.map((line, i) => renderDiffLine(line, i, token))}
            </div>
        </div>
    )
}
