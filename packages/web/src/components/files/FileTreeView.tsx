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

import { useMemo, useRef, useState } from 'react'
import { Tree, Empty, Skeleton } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FolderOutlined, FileOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useFileTree, parseDirectoryEntries } from '@/core/data/hooks/queries/useFileTree'
import type { FileNode } from '@/core/data/hooks/queries/useFileTree'
import { useMobiApi } from '@/core/data/api/client'
import { useAuthStore } from '@/core/data/stores/authStore'
import { basename } from '@/core/utils/path'

interface FileTreeViewProps {
    sessionId: string
    /** 点文件时回调（filePath, fileName） */
    onOpenFile: (filePath: string, fileName: string) => void
}

/**
 * 文件树视图（仅树，占满面板）。
 * 根目录即时加载；子目录展开时按 path 懒加载（api.files.list），
 * 结果缓存进本地 childrenMap；隐藏文件（. 开头）不显示。
 */
export default function FileTreeView({ sessionId, onOpenFile }: FileTreeViewProps) {
    const { t } = useTranslation()
    const { token } = useAuthStore()
    const api = useMobiApi(token)
    const { data: rootFiles, isLoading, error } = useFileTree(sessionId, '.')
    /** 已懒加载的子目录：path -> FileNode[]（展开时填充） */
    const [childrenMap, setChildrenMap] = useState<Record<string, FileNode[]>>({})
    /** 进行中的目录加载：防止连点/折叠再展开时并发请求与覆盖竞态 */
    const loadingPaths = useRef<Set<string>>(new Set())

    const buildNodes = (files: FileNode[]): DataNode[] =>
        files
            .filter((f) => !f.name.startsWith('.'))
            .map((f) => {
                const node: DataNode = {
                    key: f.path,
                    title: f.name,
                    icon: f.type === 'directory' ? <FolderOutlined /> : <FileOutlined />,
                    isLeaf: f.type === 'file',
                }
                if (f.type === 'directory' && childrenMap[f.path]) {
                    node.children = buildNodes(childrenMap[f.path])
                }
                return node
            })

    const treeData = useMemo(() => buildNodes(rootFiles ?? []), [rootFiles, childrenMap])

    if (isLoading) {
        return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 16 }} />
    }
    // 读取失败（runner 未就绪/无权限等）：显示错误而非误导性的「无文件」
    if (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return <Empty description={msg || t('files.loadFailed')} style={{ marginTop: 40 }} />
    }
    if (!rootFiles || rootFiles.length === 0) {
        return <Empty description={t('files.empty')} style={{ marginTop: 40 }} />
    }

    return (
        <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
            <Tree
                treeData={treeData}
                showIcon
                blockNode
                style={{ fontSize: 13 }}
                loadData={async (node) => {
                    const path = node.key as string
                    // 已加载或正在加载：直接返回，避免并发请求与结果覆盖竞态
                    if (childrenMap[path] || loadingPaths.current.has(path)) return
                    loadingPaths.current.add(path)
                    try {
                        const res = await api.files.list(sessionId, path)
                        const data = res.data as Parameters<typeof parseDirectoryEntries>[0]
                        const files = parseDirectoryEntries(data, path)
                        setChildrenMap((m) => ({ ...m, [path]: files }))
                    } finally {
                        loadingPaths.current.delete(path)
                    }
                }}
                onSelect={(keys, info) => {
                    if (keys.length === 0) return
                    // 用节点 isLeaf 判断叶子（覆盖子目录懒加载的文件，它们不在 rootFiles 里）
                    if (info.node.isLeaf) {
                        const path = keys[0] as string
                        onOpenFile(path, basename(path))
                    }
                }}
            />
        </div>
    )
}
