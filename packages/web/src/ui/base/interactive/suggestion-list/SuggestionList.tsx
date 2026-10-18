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

// 建议列表（uiarc mention-input 的 listbox 抽取件，零业务语义）：
// ① 滑动高亮与高度弹簧复用 ui/base/motion 的共享件（GlidingHighlight / AutoHeight），
//    与 select / combobox / multi-select 同一套手感；
// ② 匹配字高亮：标签内首次命中的 query 片段用全对比度呈现（过滤仍归调用方，
//    needle 规整与选项匹配共用 optionSearch 的 normalizeNeedle）；
// ③ mousedown 不抢焦点：点击选项时 textarea 保持焦点，移动端不会收键盘；
// ④ option id 由 listId 派生，供 textarea 的 aria-activedescendant 关联。

import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AutoHeight } from '@/ui/base/motion/AutoHeight'
import { GlidingHighlight } from '@/ui/base/motion/GlidingHighlight'
import { normalizeNeedle } from '@/ui/base/interactive/optionSearch'
import styles from './suggestion-list.module.css'

export interface SuggestionRow {
    /** 稳定标识（React key） */
    key: string
    /** 主文案；query 命中片段会被高亮 */
    label: string
    /** 副文案（描述/路径等） */
    meta?: string
    /** 行首图标 */
    icon?: ReactNode
    /** 紧跟主文案的短标记（目录 `/`、命令参数提示等），与 label 同排 */
    suffix?: string
    /** 主文案的额外样式（如内置命令色） */
    labelStyle?: CSSProperties
}

export interface SuggestionListProps {
    items: SuggestionRow[]
    activeIndex: number
    onActiveIndexChange: (index: number) => void
    onSelect: (index: number) => void
    /** 当前查询词，仅用于匹配高亮 */
    query?: string
    loading?: boolean
    emptyText?: string
    /** listbox 的 DOM id：同时派生 `-option-<index>` 供 ARIA 关联 */
    listId?: string
}

const DEFAULT_MAX_HEIGHT = 240

/** 标签内首次命中的 query 片段高亮（大小写不敏感，规整规则与选项过滤一致） */
function Highlight({ text, query }: { text: string; query?: string }) {
    const needle = normalizeNeedle(query ?? '')
    if (!needle) return <>{text}</>
    const at = text.toLocaleLowerCase().indexOf(needle)
    if (at < 0) return <>{text}</>
    return (
        <>
            {text.slice(0, at)}
            <mark className={styles.match}>{text.slice(at, at + needle.length)}</mark>
            {text.slice(at + needle.length)}
        </>
    )
}

export function SuggestionList({
    items,
    activeIndex,
    onActiveIndexChange,
    onSelect,
    query,
    loading = false,
    emptyText,
    listId,
}: SuggestionListProps) {
    const listRef = useRef<HTMLDivElement>(null)
    const [activeTarget, setActiveTarget] = useState<HTMLElement | null>(null)

    const safeIndex = items.length ? Math.min(Math.max(activeIndex, 0), items.length - 1) : -1

    // 激活行只解析一次：高亮跟随和滚动保持用同一个节点（避免两次 querySelector）
    useLayoutEffect(() => {
        const list = listRef.current
        const row = !list || safeIndex < 0
            ? null
            : list.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)
        setActiveTarget(prev => (prev === row ? prev : row))
        if (!list || !row) return
        // 用 scrollTop 计算，避免 scrollIntoView 连带滚动页面
        const top = row.offsetTop
        const bottom = top + row.offsetHeight
        if (top < list.scrollTop) list.scrollTop = top
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    }, [safeIndex, items.length])

    if (loading && items.length === 0) {
        return <div className={styles.status} role="status">…</div>
    }
    if (items.length === 0) {
        return emptyText ? <div className={styles.status}>{emptyText}</div> : null
    }

    return (
        <AutoHeight>
            <div
                ref={listRef}
                id={listId}
                role="listbox"
                className={styles.list}
                style={{ maxHeight: DEFAULT_MAX_HEIGHT }}
                onMouseDown={(event) => event.preventDefault()}
            >
                <GlidingHighlight className={styles.highlight} target={activeTarget} />
                {items.map((item, index) => (
                    <div
                        key={item.key}
                        id={listId ? `${listId}-option-${index}` : undefined}
                        role="option"
                        aria-selected={index === safeIndex}
                        data-index={index}
                        className={styles.option}
                        onPointerMove={() => {
                            if (index !== safeIndex) onActiveIndexChange(index)
                        }}
                        onClick={() => onSelect(index)}
                    >
                        {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
                        <span className={styles.optionText}>
                            <span className={styles.labelLine}>
                                <span className={styles.label} style={item.labelStyle}>
                                    <Highlight text={item.label} query={query} />
                                </span>
                                {item.suffix ? <span className={styles.suffix}>{item.suffix}</span> : null}
                            </span>
                            {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
                        </span>
                    </div>
                ))}
            </div>
        </AutoHeight>
    )
}
