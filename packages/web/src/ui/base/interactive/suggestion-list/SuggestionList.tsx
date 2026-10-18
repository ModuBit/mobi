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
// ① 滑动高亮：激活行之间用 motion 的 y/height 过渡（uiarc 同款），首次放置与
//    reduced-motion 下瞬时落位；
// ② 面板高度弹簧：ResizeObserver 跟随内容高度，在 maxHeight 处封顶后列表自身滚动；
// ③ 匹配字高亮：标签内首次命中的 query 片段用全对比度呈现（过滤仍归调用方）；
// ④ mousedown 不抢焦点：点击选项时 textarea 保持焦点，移动端不会收键盘；
// ⑤ option id 由 listId 派生，供 textarea 的 aria-activedescendant 关联。

import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { motionTokens } from '@/ui/base/motion/motionTokens'
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
    /** 行尾短标记（目录 `/`、参数提示等） */
    trailing?: string
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
    ariaLabel?: string
    /** listbox 的 DOM id：同时派生 `-option-<index>` 供 ARIA 关联 */
    listId?: string
    /** 列表滚动区上限，默认 240px */
    maxHeight?: number
}

const DEFAULT_MAX_HEIGHT = 240
const INSTANT = { duration: 0 }
const GLIDE = motionTokens.spring.snappy
const GROW = motionTokens.spring.smooth

/** 标签内首次命中的 query 片段高亮（大小写不敏感） */
function Highlight({ text, query }: { text: string; query?: string }) {
    const needle = query?.trim()
    if (!needle) return <>{text}</>
    const at = text.toLowerCase().indexOf(needle.toLowerCase())
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
    ariaLabel,
    listId,
    maxHeight = DEFAULT_MAX_HEIGHT,
}: SuggestionListProps) {
    const reduced = !!useReducedMotion()
    const listRef = useRef<HTMLUListElement>(null)
    const rowY = useMotionValue(0)
    const rowHeight = useMotionValue(0)
    const panelHeight = useMotionValue<number | 'auto'>('auto')
    const highlightPlaced = useRef(false)
    const panelMeasured = useRef(false)

    const safeIndex = items.length ? Math.min(Math.max(activeIndex, 0), items.length - 1) : -1

    // 高亮条跟随激活行：首次 / reduced-motion 瞬时，其余滑动
    useLayoutEffect(() => {
        const row = safeIndex < 0
            ? null
            : listRef.current?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)
        if (!row) return
        if (reduced || !highlightPlaced.current) {
            animate(rowY, row.offsetTop, INSTANT)
            animate(rowHeight, row.offsetHeight, INSTANT)
            highlightPlaced.current = true
            return
        }
        animate(rowY, row.offsetTop, GLIDE)
        animate(rowHeight, row.offsetHeight, GLIDE)
    }, [safeIndex, items.length, reduced, rowY, rowHeight])

    // 激活行保持在可视区内（用 scrollTop 计算，避免 scrollIntoView 连带滚动页面）
    useLayoutEffect(() => {
        const list = listRef.current
        if (!list || safeIndex < 0) return
        const row = list.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)
        if (!row) return
        const top = row.offsetTop
        const bottom = top + row.offsetHeight
        if (top < list.scrollTop) list.scrollTop = top
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    }, [safeIndex, items.length])

    // 面板高度：内容变化时弹簧到 clamp(maxHeight)；首次 / reduced-motion 瞬时
    useLayoutEffect(() => {
        const list = listRef.current
        if (!list) return
        const fit = () => {
            const target = Math.min(maxHeight, list.scrollHeight)
            const current = panelHeight.get()
            if (!panelMeasured.current || reduced || typeof current !== 'number') {
                animate(panelHeight, target, INSTANT)
                panelMeasured.current = true
                return
            }
            if (Math.abs(current - target) > 0.5) animate(panelHeight, target, GROW)
        }
        fit()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(fit)
        observer.observe(list)
        return () => observer.disconnect()
    }, [maxHeight, panelHeight, reduced, items.length])

    if (loading && items.length === 0) {
        return <div className={styles.status} role="status">…</div>
    }
    if (items.length === 0) {
        return emptyText ? <div className={styles.status}>{emptyText}</div> : null
    }

    return (
        <motion.div className={styles.viewport} style={{ height: panelHeight }}>
            <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel}
                className={styles.list}
                style={{ maxHeight }}
                onMouseDown={(event) => event.preventDefault()}
            >
                <motion.li aria-hidden="true" className={styles.highlight} style={{ y: rowY, height: rowHeight }} />
                {items.map((item, index) => (
                    <li
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
                            <span className={styles.label} style={item.labelStyle}>
                                <Highlight text={item.label} query={query} />
                            </span>
                            {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
                        </span>
                        {item.trailing ? <span className={styles.trailing}>{item.trailing}</span> : null}
                    </li>
                ))}
            </ul>
        </motion.div>
    )
}
