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

import { Spin, Empty, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useFileContent } from '@/core/data/hooks/queries/useFileTree'

const { Text } = Typography

interface FileContentViewProps {
    sessionId: string
    filePath: string
}

/** 只读文件内容视图（占满面板），顶部小字显示相对路径 */
export default function FileContentView({ sessionId, filePath }: FileContentViewProps) {
    const { t } = useTranslation()
    const { data: content, isLoading, error } = useFileContent(sessionId, filePath)

    return (
        <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : error ? (
                // 读取失败（runner 未就绪/无权限等）：显示错误而非误导性的空白
                <Empty description={error instanceof Error ? error.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
            ) : content != null ? (
                <div>
                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                        <Text type="secondary">{filePath}</Text>
                    </div>
                    <pre style={{
                        fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        fontFamily: 'var(--font-mono)', padding: 12,
                    }}>
                        {content}
                    </pre>
                </div>
            ) : (
                <Empty description={t('files.selectToView')} style={{ marginTop: 40 }} />
            )}
        </div>
    )
}
