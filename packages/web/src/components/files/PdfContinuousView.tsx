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

import { useEffect, useRef, useState } from 'react'
import { Page } from 'react-pdf'

interface PdfContinuousViewProps {
    /** PDF 总页数 */
    numPages: number
    /** 单页原始宽度（预留，当前虚拟滚动用 height 占位） */
    pageWidth: number
    /** 单页原始高度（A4 = 842） */
    pageHeight: number
    /** 当前缩放比例 */
    scale: number
}

/**
 * PDF 连续滚动视图 + IntersectionObserver 虚拟化：
 *
 * 放在 react-pdf <Document> 内部作为 children。渲染 N 个占位 div（高度 = pageHeight * scale），
 * 用 IntersectionObserver（rootMargin '50% 0% 50% 0%'，前后各预加载半屏）观察占位：
 * - 进入可视区 → 渲染 <Page>（react-pdf 真实渲染，吃 canvas/内存）
 * - 离开可视区 → 卸载 <Page>（释放 canvas 内存，避免长 PDF 累积 OOM）
 *
 * observe 时机：纯 useEffect 方案（而非 ref 回调）——effect 在 DOM 提交后执行，
 * 此时所有占位 div 已挂载，containerRef.current 必然非 null，
 * querySelectorAll('[data-placeholder]') 一次性 observe 全部占位，无遗漏。
 * numPages 变化（切换 PDF）时 effect 重跑，对新占位重新 observe。
 */
export default function PdfContinuousView({ numPages, pageWidth: _pageWidth, pageHeight, scale }: PdfContinuousViewProps) {
    const [visible, setVisible] = useState<Set<number>>(new Set())
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        // rootMargin '50% 0% 50% 0%'：前后各半屏预加载，滚动时提前渲染下一页，避免白屏闪烁
        const io = new IntersectionObserver((entries) => {
            setVisible((prev) => {
                let changed = false
                const next = new Set(prev)
                for (const e of entries) {
                    const pageNumber = Number((e.target as HTMLElement).dataset.placeholder)
                    if (!pageNumber) continue
                    if (e.isIntersecting) {
                        if (!next.has(pageNumber)) {
                            next.add(pageNumber)
                            changed = true
                        }
                    } else {
                        if (next.has(pageNumber)) {
                            next.delete(pageNumber)
                            changed = true
                        }
                    }
                }
                // 仅在可见集合变化时返回新引用，避免无谓 re-render
                return changed ? next : prev
            })
        }, { root: null, rootMargin: '50% 0% 50% 0%' })

        // effect 在 DOM 提交后跑，占位已挂载，一次性 observe 全部 —— 无遗漏
        const placeholders = container.querySelectorAll('[data-placeholder]')
        placeholders.forEach((el) => io.observe(el))

        return () => io.disconnect()
    }, [numPages])

    return (
        <div ref={containerRef}>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
                <div
                    key={pageNumber}
                    data-placeholder={pageNumber}
                    style={{ height: `${pageHeight * scale}px` }}
                >
                    {visible.has(pageNumber) && (
                        <Page pageNumber={pageNumber} scale={scale} />
                    )}
                </div>
            ))}
        </div>
    )
}
