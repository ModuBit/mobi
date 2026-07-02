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

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Page } from 'react-pdf'

interface PdfContinuousViewProps {
    /** PDF 总页数 */
    numPages: number
    /** 单页原始高度（A4 = 842） */
    pageHeight: number
    /** 即时缩放（CSS transform 预览 + 占位高度）；用户拖动/按钮即时变化 */
    previewScale: number
    /** pdfjs 实际渲染缩放（debounce 后跟随 previewScale，保证清晰） */
    renderScale: number
    /**
     * 滚动容器 ref（作为 IntersectionObserver 的 root）。
     * 滚动发生在 PdfContentViewImpl 的滚动 div 内，IO 必须以该容器为 root 才能正确
     * 检测「页相对滚动可视区」的可见性；若用 viewport（root:null），滚动容器内溢出
     * 的占位会被错误判定为可见 → 全部页渲染，虚拟滚动失效。
     */
    scrollRootRef?: RefObject<HTMLElement | null>
}

/**
 * 单页双缓冲渲染：消除混合缩放「renderScale 跟随 → pdfjs 重绘 canvas 间隙」的闪屏。
 *
 * - renderScale 变化时，叠加新层（absolute）用新 scale 渲染，旧层（relative）保持显示
 * - 新层 onRenderSuccess 后移除旧层，新层 position 从 absolute 切 relative——
 *   **canvas 不重建**（react-pdf Page scale 没变，只是父 div position 变），用户看不到空白
 * - 各层 transform: scale(previewScale / l.scale) 即时补偿到 previewScale 视觉（CSS 预览，无重渲染）
 */
function PdfPage({ pageNumber, previewScale, renderScale }: {
    pageNumber: number
    previewScale: number
    renderScale: number
}) {
    // layers：层列表。[0] 显示（relative），其后 absolute 叠加（渲染中）
    const nextIdRef = useRef(1)
    const [layers, setLayers] = useState<{ id: number; scale: number }[]>([{ id: 0, scale: renderScale }])

    // renderScale 变 → 加新层（叠加渲染），不动旧层（保持显示，无空白）
    useEffect(() => {
        setLayers(prev => {
            if (prev[prev.length - 1].scale === renderScale) return prev
            return [...prev, { id: nextIdRef.current++, scale: renderScale }]
        })
    }, [renderScale])

    // 新层渲染完成 → 仅保留该层（变显示层），旧层卸载。
    // 关键：新层 position 从 absolute 切 relative 不重建 canvas（react-pdf Page 无重渲染）→ 无闪
    const handleRendered = (id: number) => {
        setLayers(prev => {
            if (prev[prev.length - 1].id !== id) return prev
            return [{ id, scale: renderScale }]
        })
    }

    return (
        <>
            {layers.map((l, i) => (
                <div
                    key={l.id}
                    style={{
                        position: i === 0 ? 'relative' : 'absolute',
                        top: 0, left: 0,
                        transform: `scale(${previewScale / l.scale})`,
                        transformOrigin: 'top left',
                    }}
                >
                    <Page
                        pageNumber={pageNumber}
                        scale={l.scale}
                        onRenderSuccess={() => handleRendered(l.id)}
                    />
                </div>
            ))}
        </>
    )
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
export default function PdfContinuousView({ numPages, pageHeight, previewScale, renderScale, scrollRootRef }: PdfContinuousViewProps) {
    const [visible, setVisible] = useState<Set<number>>(new Set())
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // 切换 PDF（numPages 变）→ 先清空 visible，避免旧 PDF 的可见页码残留进新 PDF
        // （越界页码向 pdfjs 请求不存在的页 / 非可视区页浪费 canvas）
        setVisible(new Set())
        const container = containerRef.current
        if (!container) return

        // root 必须是滚动容器（scrollRootRef），否则溢出的占位会被判定为 viewport 可见 → 虚拟滚动失效。
        // rootMargin '50% 0% 50% 0%'：相对滚动容器，前后各半屏预加载，滚动时提前渲染下一页避免白屏
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
        }, { root: scrollRootRef?.current ?? null, rootMargin: '50% 0% 50% 0%' })

        // effect 在 DOM 提交后跑，占位已挂载，一次性 observe 全部 —— 无遗漏
        const placeholders = container.querySelectorAll('[data-placeholder]')
        placeholders.forEach((el) => io.observe(el))

        return () => io.disconnect()
    }, [numPages])

    return (
        // 占位高度用 CSS 变量 --page-h：previewScale 变化时只更新容器一处 style，
        // N 个占位通过 var(--page-h) 读取，浏览器只做一次 layout（避免逐个 inline height 的 O(N) reflow，
        // 长 PDF pinch 缩放时关键）
        <div
            ref={containerRef}
            style={{ '--page-h': `${pageHeight * previewScale}px` } as CSSProperties}
        >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
                <div
                    key={pageNumber}
                    data-placeholder={pageNumber}
                    style={{ height: 'var(--page-h)' }}
                >
                    {visible.has(pageNumber) && (
                        <PdfPage pageNumber={pageNumber} previewScale={previewScale} renderScale={renderScale} />
                    )}
                </div>
            ))}
        </div>
    )
}
