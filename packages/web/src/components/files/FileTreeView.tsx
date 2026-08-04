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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from '@emotion/styled'
import { Tree, Empty, Skeleton, Input, Button, type TreeProps } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import type { DataNode } from 'antd/es/tree'
import { FolderOpen, FolderClosed, File as FileIcon, Search, Eye, EyeOff, RotateCw } from 'lucide-react'
import { LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { parseDirectoryEntries } from '@/core/data/hooks/queries/useFileTree'
import type { FileNode } from '@/core/data/hooks/queries/useFileTree'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import { basename } from '@/core/utils/path'
import { formatFileSize } from '@/core/utils/fileSize'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { useDebouncedFileSearch, MAX_DISPLAY } from '@/core/data/hooks/queries/useDebouncedFileSearch'
import { buildPathTree, collectDirKeys, type NestedFileNode } from '@/core/utils/pathTree'
import type { ListDirectoryResponse } from '@/core/data/api/types'

/**
 * 包裹层。antd v6 的 Tree 不会把 style/className 透传到 .ant-tree 根元素，
 * 故 inline style 无效；这里用 && 提优先级直接覆盖 .ant-tree 默认的
 * colorBgContainer 背景，让其透出 InspectorPane 面板色（与 StyledTabs 同款手法）。
 */
const TreeWrap = styled.div`
    height: 100%;
    overflow: auto;
    padding: 8px;
    && .ant-tree {
        background: transparent;
        font-size: 13px;
    }
    /* icon（lucide svg）垂直居中于行：inline svg 默认 baseline 与文字不齐 */
    && .ant-tree-iconEle {
        display: inline-flex;
        align-items: center;
        line-height: 0;
    }
    /* folder 图标按展开状态显隐（收起 FolderClosed / 展开 FolderOpen）。
       依赖 antd 内部的 aria-expanded，无需受控 expandedKeys（避免打断 loadData loading）。 */
    && .ant-tree-treenode[aria-expanded='true'] .folder-closed {
        display: none;
    }
    && .ant-tree-treenode[aria-expanded='false'] .folder-open {
        display: none;
    }
    /* 节点标题省略（名字过长显示 …）：
       antd 默认 .ant-tree-node-content-wrapper 是 inline（span），icon 与 title 走 inline 流；
       直接给 title 设 display:block 会让 block 子项撑破 inline 容器，导致 icon/文字分行。
       这里把 content-wrapper 改成 flex，title 作为 flex 子项占满剩余空间并 ellipsis；
       完整名 + 大小/修改时间由 Tooltip 包裹展示。 */
    && .ant-tree-node-content-wrapper {
        display: flex;
        align-items: center;
        min-width: 0;
    }
    && .ant-tree-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* 搜索结果截断提示 */
    .search-truncated {
        padding: 8px;
        font-size: 12px;
        opacity: 0.45;
        text-align: center;
    }
    /* 刷新按钮转圈：不用 antd Button loading（会把 lucide 图标换成 antd spinner，与树内其他图标不统一） */
    .refresh-spinning {
        animation: file-tree-refresh-spin 0.8s linear infinite;
    }
    @keyframes file-tree-refresh-spin {
        to {
            transform: rotate(360deg);
        }
    }
`

/**
 * 刷新图标最短旋转时长。
 * 快网下 fetch 几十毫秒即完成、搜索的 loading 还有 400ms 延迟才亮，
 * 只跟真实 fetching 状态会导致「点了没反应」。点击即无条件转这么久，与真实状态取或。
 */
const REFRESH_SPIN_MIN_MS = 500

/** 筛选结果前端展示上限（与 useDebouncedFileSearch 的 MAX_DISPLAY 对齐） */
const FILE_SEARCH_MAX = MAX_DISPLAY

interface FileTreeViewProps {
    sessionId: string
    /** 点文件时回调（filePath, fileName） */
    onOpenFile: (filePath: string, fileName: string) => void
    /**
     * 当前是否「被用户看见」：Popover 打开 / Tab 激活。
     * false→true 时静默刷新根 + 已展开目录（已有缓存先展示，无 loading）。
     * 默认 true：调用方不传时仅依赖 react-query 自身的 mount/focus refetch。
     */
    active?: boolean
}

/**
 * 文件树视图（仅树，占满面板）。
 *
 * 数据层全部走 react-query（SWR 语义）：
 * - 根目录与已展开子目录都用 useQueries 订阅（同一 queryKey → 同一份 cache，跨实例共享）
 * - 有缓存先展示（不闪 loading），后台静默 refetch；无缓存首次拉取显示 loading
 * - staleTime 0：每次 mount/focus/invalidate 都后台 refetch，确保目录变化可感知
 *
 * 刷新触发：
 * - `active` 由 false→true（弹层打开 / tab 切入）时 invalidate 该 session 下所有 directory query，
 *   已订阅的目录响应式后台刷新（见下方 useEffect）
 * - 工具栏刷新按钮（见 handleRefresh）：面板一直开着时磁盘变化无从感知，需手动兜底
 *
 * 隐藏文件（. 开头）不显示。
 */
export default function FileTreeView({ sessionId, onOpenFile, active = true }: FileTreeViewProps) {
    const { t } = useTranslation()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    /** 受控选中键：仅 file 选中（folder 点击只展开，不选中不高亮） */
    const [selectedKeys, setSelectedKeys] = useState<string[]>([])
    /** 已展开过的子目录路径（根 '.' 永远订阅，不在此列）；用于驱动 useQueries 订阅 */
    const [expandedPaths, setExpandedPaths] = useState<string[]>([])
    /** 筛选框输入；非空时切换为扁平搜索结果视图（替换树） */
    const [filter, setFilter] = useState('')
    /** 是否展示隐藏文件/目录（. 开头）；默认隐藏 */
    const [showHidden, setShowHidden] = useState(false)
    const isSearching = filter.trim().length > 0
    const {
        results: searchResults,
        isLoading: isSearchLoading,
        refetch: refetchSearch,
    } = useDebouncedFileSearch(sessionId, filter)

    // active false→true：invalidate 该 session 所有 directory query（根 + 已展开子目录），
    // 后台静默刷新。已有缓存先展示（SWR），用户感受到的是「打开即最新」。
    const prevActiveRef = useRef(active)
    useEffect(() => {
        if (!prevActiveRef.current && active) {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionDirectories(sessionId) })
        }
        prevActiveRef.current = active
    }, [active, sessionId, queryClient])

    /** 手动刷新的最短旋转窗口（见 REFRESH_SPIN_MIN_MS） */
    const [spinUntilTimeout, setSpinUntilTimeout] = useState(false)
    const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => {
        if (spinTimerRef.current) clearTimeout(spinTimerRef.current)
    }, [])

    /**
     * 手动刷新：刷「用户眼下看到的内容」。
     * 搜索模式重跑搜索（结果同样会因文件增删而过期）；树模式 invalidate 本 session
     * 所有已订阅目录（根 + 已展开子目录），useQueries 响应式后台 refetch。
     */
    const handleRefresh = useCallback(() => {
        if (isSearching) {
            refetchSearch()
        } else {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionDirectories(sessionId) })
        }
        if (spinTimerRef.current) clearTimeout(spinTimerRef.current)
        setSpinUntilTimeout(true)
        spinTimerRef.current = setTimeout(() => {
            spinTimerRef.current = null
            setSpinUntilTimeout(false)
        }, REFRESH_SPIN_MIN_MS)
    }, [isSearching, refetchSearch, queryClient, sessionId])

    /** 拉单个目录（根/子共用）：hub success:false 抛错，由 react-query 透出 error */
    const fetchDirectory = async (path: string): Promise<FileNode[]> => {
        const res = await api.files.list(sessionId, path)
        const data = res.data as ListDirectoryResponse
        if (data.success === false) {
            throw new Error(data.error ?? 'list-directory failed')
        }
        return parseDirectoryEntries(data, path)
    }

    /** 订阅根 + 已展开目录：同 queryKey → SWR（有缓存先展示 + 后台静默 refetch），跨实例共享 */
    const paths = useMemo(() => ['.', ...expandedPaths], [expandedPaths])
    const results = useQueries({
        queries: paths.map((p) => ({
            queryKey: queryKeys.sessionDirectory(sessionId, p),
            queryFn: () => fetchDirectory(p),
            // staleTime 0：目录需及时反映文件变化，mount/focus/invalidate 都后台 refetch；
            // 缓存仍作 placeholder 先渲染（不闪 skeleton），gcTime 沿用全局 10min
            staleTime: 0,
        })),
    })

    /** dataSig：以每个 query 的 dataUpdatedAt 拼签名；data 不变时签名稳定 → dirData 引用稳定 →
     *  buildNodes/treeData memo 生效（避免 useQueries 每次返回新数组导致 memo 链失效）。 */
    const dataSig = results.map((r) => r.dataUpdatedAt).join('|')
    const dirData = useMemo(() => {
        const m: Record<string, FileNode[] | undefined> = {}
        paths.forEach((p, i) => {
            m[p] = results[i].data
        })
        return m
    }, [paths, dataSig])

    const rootResult = results[0]
    const rootFiles = rootResult?.data
    const rootError = rootResult?.error

    /** 刷新图标是否转圈：真实请求进行中 或 仍在最短旋转窗口内 */
    const isRefreshing =
        spinUntilTimeout || (isSearching ? isSearchLoading : results.some((r) => r.isFetching))

    // folder 图标的展开/收起切换交给 CSS（按 antd 自带的 aria-expanded 显隐）。
    // files 允许带 children（搜索模式由 buildPathTree 产出嵌套结构）；树模式无 children 则从 dirData 取。
    // 依赖 dirData（SWR 响应式刷新）+ showHidden（视图切换），useCallback 让 treeData/searchTreeData 能正确 memo。
    const buildNodes = useCallback((files: NestedFileNode[]): DataNode[] =>
        files
            .filter((f) => showHidden || !f.name.startsWith('.'))
            .map((f) => {
                const node: DataNode = {
                    key: f.path,
                    title: (
                        <AppTooltip
                            // 稍长延迟：避免在树里快速划过时频繁弹出
                            mouseEnterDelay={0.5}
                            title={
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ wordBreak: 'break-all' }}>{f.name}</span>
                                    {f.type === 'file' && f.size !== undefined && (
                                        <span>{t('files.size')}: {formatFileSize(f.size)}</span>
                                    )}
                                    {f.modified !== undefined && (
                                        <span>{t('files.modified')}: {formatRelativeTime(f.modified, t)}</span>
                                    )}
                                </div>
                            }
                        >
                            <span>{f.name}</span>
                        </AppTooltip>
                    ),
                    icon: () => {
                        // folder：两个图标 + CSS 按 aria-expanded 显隐；loading 指示交给 antd 内置 switcher
                        if (f.type === 'directory') {
                            return (
                                <>
                                    <FolderClosed className="folder-closed" size={14} />
                                    <FolderOpen className="folder-open" size={14} />
                                </>
                            )
                        }
                        return <FileIcon size={14} />
                    },
                    isLeaf: f.type === 'file',
                }
                // 已订阅（展开过）的目录：填 children；搜索模式由 buildPathTree 直接提供 children
                if (f.type === 'directory') {
                    const children = f.children ?? dirData[f.path]
                    if (children) node.children = buildNodes(children)
                }
                return node
            }), [dirData, showHidden])

    const treeData = useMemo(() => buildNodes(rootFiles ?? []), [rootFiles, buildNodes])

    // 搜索模式：扁平结果重建嵌套树（虚拟目录合并公共前缀），叶子保留 size/modified
    const searchTree = useMemo(() => buildPathTree(searchResults), [searchResults])
    const searchTreeData = useMemo(() => buildNodes(searchTree), [searchTree, buildNodes])
    // 搜索结果默认全展开（用户正在看匹配项，不应再手动展开虚拟目录）
    const searchExpandedKeys = useMemo(() => collectDirKeys(searchTree), [searchTree])

    const onSelect: TreeProps['onSelect'] = (_keys, info) => {
        // 仅 file 选中并打开；folder 点击只触发展开（expandAction），不选中不高亮
        if (info.node.isLeaf) {
            const path = info.node.key as string
            setSelectedKeys([path])
            onOpenFile(path, basename(path))
        }
    }

    // 树模式懒加载：展开目录时订阅该目录（useQueries 接管后续 SWR 刷新）。
    // cache 有则 fetchQuery 立即 resolve（antd 不显 loading，children 已从 dirData 渲染）；
    // cache 无则等首次拉取完成，antd 期间显示 switcher loading。
    // 注意：cache 命中时 antd 根本不调 loadData（treeData 已有 children）。
    const loadDirData: TreeProps['loadData'] = async (node) => {
        const path = node.key as string
        setExpandedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
        await queryClient.fetchQuery({
            queryKey: queryKeys.sessionDirectory(sessionId, path),
            queryFn: () => fetchDirectory(path),
            staleTime: 0,
        })
    }

    const renderTree = (
        data: DataNode[],
        opts: { expandedKeys?: string[]; loadData?: TreeProps['loadData'] },
    ) => (
        <Tree
            treeData={data}
            showIcon
            blockNode
            expandAction="click"
            selectedKeys={selectedKeys}
            loadData={opts.loadData}
            onSelect={onSelect}
            // 仅搜索模式传 expandedKeys（全展开）；树模式省略以保持非受控（否则 antd 视为受控空，无法展开）
            {...(opts.expandedKeys ? { expandedKeys: opts.expandedKeys } : {})}
        />
    )

    return (
        <TreeWrap>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
                <Input
                    prefix={isSearching && isSearchLoading ? <LoadingOutlined style={{ fontSize: 14 }} /> : <Search size={14} />}
                    allowClear
                    size="small"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t('files.searchPlaceholder')}
                    style={{ flex: 1 }}
                />
                <Button
                    type="text"
                    size="small"
                    icon={showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    onClick={() => setShowHidden((v) => !v)}
                    aria-label={t(showHidden ? 'files.hideHidden' : 'files.showHidden')}
                />
                <AppTooltip title={t('files.refreshTree')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<RotateCw size={14} className={isRefreshing ? 'refresh-spinning' : undefined} />}
                        onClick={handleRefresh}
                        aria-label={t('files.refreshTree')}
                    />
                </AppTooltip>
            </div>
            {isSearching ? (
                searchResults.length === 0 ? (
                    // loading + 空：结果区保持空白（Input prefix 转圈指示），不显示 Skeleton 避免快网闪烁
                    isSearchLoading ? null : (
                        <Empty description={t('files.noResults')} style={{ marginTop: 40 }} />
                    )
                ) : (
                    <>
                        {renderTree(searchTreeData, { expandedKeys: searchExpandedKeys })}
                        {searchResults.length >= FILE_SEARCH_MAX && (
                            <div className="search-truncated">
                                {t('files.resultsTruncated', { count: FILE_SEARCH_MAX })}
                            </div>
                        )}
                    </>
                )
            ) : rootResult?.isPending ? (
                <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 16 }} />
            ) : rootError ? (
                <Empty
                    description={(rootError instanceof Error ? rootError.message : String(rootError)) || t('files.loadFailed')}
                    style={{ marginTop: 40 }}
                />
            ) : !rootFiles || rootFiles.length === 0 ? (
                <Empty description={t('files.empty')} style={{ marginTop: 40 }} />
            ) : (
                renderTree(treeData, { loadData: loadDirData })
            )}
        </TreeWrap>
    )
}
