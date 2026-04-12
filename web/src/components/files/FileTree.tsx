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

import { Tree, Spin, Empty, Typography, Skeleton, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { FolderOutlined, FileOutlined } from '@ant-design/icons'
import { useFileTree, useFileContent } from '@/hooks/queries/useFileTree'
import { useState, useMemo } from 'react'
import type { DataNode } from 'antd/es/tree'

const { Text } = Typography
const { useToken } = antTheme

interface FileTreeProps {
    sessionId: string
}

export default function FileTree({ sessionId }: FileTreeProps) {
    const [selectedFile, setSelectedFile] = useState<string | null>(null)
    const { token } = useToken()
    const { t } = useTranslation()

    // 获取根目录文件列表
    const { data: rootFiles, isLoading } = useFileTree(sessionId, '.')

    // 获取选中文件的内容
    const { data: fileContent, isLoading: fileLoading } = useFileContent(sessionId, selectedFile)

    const handleSelect = (selectedKeys: React.Key[]) => {
        if (selectedKeys.length > 0) {
            const path = selectedKeys[0] as string
            // 检查是否是文件（从 rootFiles 中查找）
            const file = rootFiles?.find(f => f.path === path)
            if (file && file.type === 'file') {
                setSelectedFile(path)
            }
        }
    }

    // 转换为 Ant Design Tree 格式
    const treeData: DataNode[] = useMemo(() => {
        return (rootFiles || [])
            .filter(file => !file.name.startsWith('.')) // 隐藏文件不显示
            .map((file) => ({
                key: file.path,
                title: file.name,
                icon: file.type === 'directory' ? <FolderOutlined /> : <FileOutlined />,
                isLeaf: file.type === 'file',
            }))
    }, [rootFiles])

    if (isLoading) {
        return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 16 }} />
    }

    if (!rootFiles || rootFiles.length === 0) {
        return <Empty description={t('files.empty')} style={{ marginTop: 40 }} />
    }

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 130px)' }}>
            {/* 文件树 */}
            <div style={{ width: '40%', overflow: 'auto', borderRight: `1px solid ${token.colorBorder}`, padding: 8 }}>
                <div style={{ padding: '8px 4px', borderBottom: `1px solid ${token.colorBorder}`, marginBottom: 8 }}>
                    <Text strong>{t('files.title')}</Text>
                </div>
                <Tree
                    treeData={treeData}
                    onSelect={handleSelect}
                    showIcon
                    defaultExpandAll
                    style={{ fontSize: 13 }}
                />
            </div>

            {/* 文件内容 */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16, background: token.colorBgLayout }}>
                {fileLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                        <Spin />
                    </div>
                ) : fileContent !== null ? (
                    <div>
                        <div style={{ marginBottom: 8, fontSize: 12 }}>
                            <Text type="secondary">{selectedFile}</Text>
                        </div>
                        <pre style={{
                            fontSize: 12,
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            fontFamily: 'var(--font-mono)',
                            background: token.colorBgContainer,
                            padding: 12,
                            borderRadius: 4,
                            border: `1px solid ${token.colorBorder}`
                        }}>
                            {fileContent}
                        </pre>
                    </div>
                ) : (
                    <Empty description={t('files.selectToView')} style={{ marginTop: 40 }} />
                )}
            </div>
        </div>
    )
}
