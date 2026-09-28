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
 * diff 文件树面板（审查视图右侧可开合）：筛选输入 + 目录树（复用文件目录树的
 * pathTree 工具），点文件叶节点 → 主列表展开该文件。树内文件挂 kind 徽标，与清单同语义。
 */

import { useEffect, useMemo, useState } from 'react'
import { Empty, Flex, Input, Tree } from 'antd'
import type { TreeProps } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { TurnDiffFileEntry } from '@mobi/shared'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { basename } from '@/core/utils/path'
import { buildPathTree, collectDirKeys, type NestedFileNode } from '@/core/utils/pathTree'
import { KIND_BADGES } from '@/components/chat/blocks/TurnDiffCard'

export function DiffTreePanel({ files, selectedPath, onOpenFile }: {
    files: readonly TurnDiffFileEntry[]
    selectedPath: string | null
    onOpenFile: (path: string) => void
}) {
    const { t } = useTranslation()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const [filter, setFilter] = useState('')
    const q = filter.trim().toLowerCase()
    const filtered = useMemo(
        () => (q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files),
        [files, q],
    )
    const entryByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

    // 扁平条目 → 嵌套树（与文件目录树搜索同一条 buildPathTree 通路）
    const tree = useMemo(
        () => buildPathTree(filtered.map((f) => ({ name: basename(f.path), path: f.path, type: 'file' as const }))),
        [filtered],
    )

    /** 受控展开：数据（档位/筛选）变化即全展开——面板的树只承载变更文件，量小，全展开即默认形态 */
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
    useEffect(() => {
        setExpandedKeys(collectDirKeys(tree))
    }, [tree])

    const treeData: DataNode[] = useMemo(() => {
        const render = (nodes: NestedFileNode[]): DataNode[] =>
            nodes.map((n) => {
                if (n.type === 'directory') {
                    return { key: n.path, title: n.name, children: n.children ? render(n.children) : undefined }
                }
                const entry = entryByPath.get(n.path)
                const badge = entry ? KIND_BADGES[entry.kind] : null
                return {
                    key: n.path,
                    title: (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {badge && (
                                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', color: isDark ? badge.dark : badge.light }}>
                                    {badge.label}
                                </span>
                            )}
                            <span>{n.name}</span>
                        </span>
                    ),
                    isLeaf: true,
                }
            })
        return render(tree)
    }, [tree, entryByPath, isDark])

    const onSelect: TreeProps['onSelect'] = (_keys, info) => {
        if (info.node.isLeaf !== false) onOpenFile(String(info.node.key))
    }

    return (
        <Flex
            data-testid="review-tree-panel"
            vertical
            style={{ width: 264, flexShrink: 0, borderLeft: '1px solid var(--ant-color-border-secondary)', minHeight: 0 }}
        >
            <Input
                size="small"
                allowClear
                prefix={<Search size={13} />}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('review.filterPlaceholder')}
                style={{ margin: 8 }}
                data-testid="review-tree-filter"
            />
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
                {filtered.length > 0 ? (
                    <Tree
                        blockNode
                        treeData={treeData}
                        expandedKeys={expandedKeys}
                        onExpand={(keys) => setExpandedKeys(keys)}
                        selectedKeys={selectedPath ? [selectedPath] : []}
                        onSelect={onSelect}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('files.noResults')} style={{ marginTop: 24 }} />
                )}
            </div>
        </Flex>
    )
}
