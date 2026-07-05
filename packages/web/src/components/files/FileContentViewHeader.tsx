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

import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { Button, Dropdown, Popover } from 'antd'
import type { MenuProps } from 'antd'
import { Ellipsis, Folders } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import FileTreeView from '@/components/files/FileTreeView'

export interface FileContentViewHeaderProps {
    sessionId: string
    /** 当前 tab id：Folders 选文件后调 openFileInTab 用 */
    tabId: string
    filePath: string
    /** more 菜单额外项（refresh/copyPath/markdown toggle 等由父组件提供） */
    extraMenuItems: MenuProps['items']
}

/**
 * 文件内容视图头部：纯展示组件。
 * - 左：面包屑（按 / 分段，文件名加粗；空间不够时左侧逐段省略，至少保留文件名）
 * - 右：more 菜单（items 由父组件提供，本组件不感知文件类型）+ 文件树 Popover
 *
 * 不持有 view state、不 import 任何 *ContentView——它是 markdown/pdf 等无关的展示外壳。
 */
export default function FileContentViewHeader({ sessionId, tabId, filePath, extraMenuItems }: FileContentViewHeaderProps) {
    const { t } = useTranslation()
    const openFileInTab = useWorkspaceStore((s) => s.openFileInTab)
    const [treeOpen, setTreeOpen] = useState(false)

    // 面包屑分段：a/b/c.ts → [a, b, c.ts]，最后一项（文件名）加粗
    const segments = filePath.split('/').filter(Boolean)
    const lastIndex = segments.length - 1

    // 左对齐 + 空间不够时左侧省略（保留文件名）：CSS 的 text-overflow 只能在右端省略，
    // 这里用 JS 测容器宽度——溢出则从左逐段砍、前缀 …；容器变宽时重置重新计算。
    const crumbRef = useRef<HTMLDivElement>(null)
    const [cutStart, setCutStart] = useState(0)
    const [crumbWidth, setCrumbWidth] = useState(0)
    // 二分收敛 cutStart 的搜索边界（ref，避免进 effect 依赖触发重跑）。
    // 不变量：答案（最小不溢出的 cutStart）∈ [loRef, hiRef]；loRef===hiRef 时收敛。
    const loRef = useRef(0)
    const hiRef = useRef(0)
    // 上次的「重置触发」签名，用于在同一 effect 内区分「重置」与「继续探针」
    const lastTriggerRef = useRef('')

    // 监听面包屑容器宽度（inspector 分栏拖动 / 窗口缩放）。
    // rAF 合并高频回调：拖动分栏时 ResizeObserver 每帧多次触发，合并到下一帧只 setState 一次，
    // 避免每次宽度变化都触发下方 O(n) 收敛链反复跑。
    const rafRef = useRef<number | null>(null)
    useLayoutEffect(() => {
        const el = crumbRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            const w = entries[0].contentRect.width
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            rafRef.current = requestAnimationFrame(() => { setCrumbWidth(w) })
        })
        ro.observe(el)
        return () => {
            ro.disconnect()
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
        }
    }, [])

    // 二分收敛 cutStart：测当前 cutStart 是否溢出 → 收紧 [lo, hi] → 跳到中点；
    // O(log n) 次重排（替代原逐段 +1 的 O(n)）。宽度/路径变化时先重置边界。
    useLayoutEffect(() => {
        const el = crumbRef.current
        if (!el || lastIndex < 0) return
        const trigger = `${crumbWidth}|${filePath}|${lastIndex}`
        if (trigger !== lastTriggerRef.current) {
            // 宽度/路径变化：重置搜索范围为 [0, lastIndex]，跳到中点开始探针
            lastTriggerRef.current = trigger
            loRef.current = 0
            hiRef.current = lastIndex
            const mid = lastIndex >> 1
            if (mid !== cutStart) {
                setCutStart(mid)
                return // 等 cutStart 变更后下一帧再探针
            }
            // mid===cutStart（如重设到同值）：落入下方探针逻辑
        }
        // 探针：测当前 cutStart 是否溢出，收紧搜索范围
        const overflows = el.scrollWidth > el.clientWidth + 1
        if (overflows) {
            loRef.current = Math.min(cutStart + 1, lastIndex) // cutStart 溢出 → 答案在更右
        } else {
            hiRef.current = cutStart // cutStart fit → 答案 ≤ cutStart
        }
        if (loRef.current < hiRef.current) {
            // 未收敛：跳到新中点（保证 ≠ 当前，避免死循环）
            const next = (loRef.current + hiRef.current) >> 1
            if (next !== cutStart) setCutStart(next)
        } else if (loRef.current !== cutStart) {
            // 收敛（lo===hi===答案）：定格到答案
            setCutStart(Math.min(loRef.current, lastIndex))
        }
    }, [cutStart, crumbWidth, filePath, lastIndex])

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', flexShrink: 0,
            borderBottom: '1px solid var(--ant-color-border-secondary)',
        }}>
            <div ref={crumbRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {cutStart > 0 && <span style={{ opacity: 0.45 }}>…{segments[cutStart] !== undefined ? ' /' : ''} </span>}
                {segments.slice(cutStart).map((seg, i) => {
                    const realIdx = cutStart + i
                    return (
                        <Fragment key={realIdx}>
                            {i > 0 && <span style={{ margin: '0 2px', opacity: 0.45 }}>/</span>}
                            <span style={{ fontWeight: realIdx === lastIndex ? 600 : 400 }}>{seg}</span>
                        </Fragment>
                    )
                })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <Dropdown menu={{ items: extraMenuItems }} trigger={['click']}>
                    <Button type="text" size="small" icon={<Ellipsis size={14} />} aria-label={t('files.more')} />
                </Dropdown>
                <Popover
                    open={treeOpen}
                    onOpenChange={setTreeOpen}
                    trigger="click"
                    placement="bottomLeft"
                    content={
                        <div style={{ width: 300, height: 400, overflow: 'auto' }}>
                            <FileTreeView
                                sessionId={sessionId}
                                onOpenFile={(fp, fn) => {
                                    // store 去重：当前文件不响应 / 别的 tab 已开则激活 / 否则当前 tab 转该文件
                                    openFileInTab(sessionId, tabId, fp, fn)
                                    setTreeOpen(false)
                                }}
                            />
                        </div>
                    }
                >
                    <Button type="text" size="small" icon={<Folders size={14} />} aria-label={t('files.openFromTree')} />
                </Popover>
            </div>
        </div>
    )
}
