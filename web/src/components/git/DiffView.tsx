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
import { Spin, Typography } from 'antd'

const { Text } = Typography

interface DiffViewProps {
    sessionId: string
    filePath: string
}

/**
 * Diff 行渲染 - 根据不同类型添加不同样式
 */
function renderDiffLine(line: string, index: number) {
    const style: React.CSSProperties = {
        display: 'block',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'pre',
        paddingLeft: 8,
        paddingRight: 8,
    }

    // 添加的行
    if (line.startsWith('+') && !line.startsWith('+++')) {
        style.background = '#e6ffec'
        style.color = '#22863a'
    }
    // 删除的行
    else if (line.startsWith('-') && !line.startsWith('---')) {
        style.background = '#ffebe9'
        style.color = '#cb2431'
    }
    // 位置信息
    else if (line.startsWith('@@')) {
        style.background = '#f1f8ff'
        style.color = '#0366d6'
    }
    // 文件头信息
    else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        style.fontWeight = 'bold'
        style.color = '#24292e'
        style.background = '#f6f8fa'
    }

    return <span key={index} style={style}>{line || ' '}</span>
}

/**
 * Git Diff 视图组件
 */
export default function DiffView({ sessionId, filePath }: DiffViewProps) {
    const { data: diff, isLoading } = useGitDiff(sessionId, filePath)

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
                <Text type="secondary">无法加载 Diff</Text>
            </div>
        )
    }

    const lines = diff.split('\n')

    return (
        <div style={{ overflow: 'auto', height: '100%' }}>
            {/* 文件路径标题 */}
            <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid #f0f0f0',
                background: '#fafafa',
                position: 'sticky',
                top: 0,
                zIndex: 1
            }}>
                <Text strong style={{ fontSize: 12 }}>{filePath}</Text>
            </div>

            {/* Diff 内容 */}
            <div style={{ padding: '8px 0' }}>
                {lines.map((line, i) => renderDiffLine(line, i))}
            </div>
        </div>
    )
}
