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

import { memo, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { Pencil, Eye, ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { MermaidDiagram } from '@/components/ui/MermaidDiagram'

/**
 * 编辑器内 mermaid codeBlock 的 ReactNodeView。
 *
 * 关键：codeBlock 是 content: text*（有文本）。若只用 NodeViewWrapper 不接管 contentDOM，
 * Tiptap 会自动创建 contentDOM 承载源码 → 源码与渲染图同时显示。
 * 故用 NodeViewContent 显式接管 contentDOM，并仅在「源码态」显示它。
 *
 * 两种态（每个 mermaid 块独立）：
 * - preview（默认）：渲染图，双击图进 source；Ctrl+滚轮缩放，溢出可拖动平移
 * - source：可编辑源码，右上角按钮切回 preview
 */

/** zoom 钳到 [0.25, 2]（模块级纯函数，effect 闭包可引用而无需进依赖数组） */
const clampZoom = (z: number) => Math.min(2, Math.max(0.25, +z.toFixed(2)))

export const MermaidNodeView = memo(function MermaidNodeView({ node }: NodeViewProps) {
    const [mode, setMode] = useState<'preview' | 'source'>('preview')
    const [zoom, setZoom] = useState(1)
    // zoom 的 ref 镜像：原生 touch listener 闭包读最新值，避免 stale
    const zoomRef = useRef(1)
    const previewRef = useRef<HTMLDivElement>(null)
    // 拖动平移状态（zoom > 1 时启用）
    const dragState = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

    const isPreview = mode === 'preview'

    // zoom 的 ref 镜像同步：原生 listener 闭包读最新 zoom
    useEffect(() => { zoomRef.current = zoom }, [zoom])

    // 触摸 + 滚轮交互（原生 listener + passive:false 才能 preventDefault）：
    // - Ctrl+滚轮：桌面缩放
    // - 单指拖动：滚动容器（zoom>1 拖内容 / zoom===1 滚动看超大图）
    // - 双指 pinch：缩放，以 pinch 起始两指中点为 focal point（内容不飞移）
    // touch-action:none 让浏览器完全不消费触摸手势 → 单指→双指切换时 pinch 仍稳定收到 touchmove
    // （pan-x pan-y 会在单指 pan 启动后吞掉第 2 指 touchmove，pinch 静默失效）
    useEffect(() => {
        if (!isPreview) return
        const el = previewRef.current
        if (!el) return

        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            setZoom(z => clampZoom(+(z + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(2)))
        }

        const touchDist = (t: TouchEvent) => {
            const a = t.touches[0]!, b = t.touches[1]!
            return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
        }
        // pinch 锚点状态：双指落下时锁定，move 按比例缩放 + focal 平移
        let pinchDist = 0
        let pinchZoom = 1
        let pinchScrollLeft = 0
        let pinchScrollTop = 0
        let pinchMidX = 0
        let pinchMidY = 0
        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                // 进入 pinch：锁定起始 距离/zoom/scroll/中点（focal 锚）
                const a = e.touches[0]!, b = e.touches[1]!
                const rect = el.getBoundingClientRect()
                pinchDist = touchDist(e)
                pinchZoom = zoomRef.current
                pinchScrollLeft = el.scrollLeft
                pinchScrollTop = el.scrollTop
                pinchMidX = (a.clientX + b.clientX) / 2 - rect.left
                pinchMidY = (a.clientY + b.clientY) / 2 - rect.top
                dragState.current = null // 退出单指拖拽
            } else if (e.touches.length === 1) {
                // 单指拖拽：记录起点 + 起始 scroll（move 反向平移 = 滚动容器）
                const t = e.touches[0]
                dragState.current = { x: t.clientX, y: t.clientY, left: el.scrollLeft, top: el.scrollTop }
            }
        }
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && pinchDist > 0) {
                e.preventDefault()
                const newZoom = clampZoom(+(pinchZoom * (touchDist(e) / pinchDist)).toFixed(2))
                // focal point：保持 pinch 起始中点指向的内容在视口不动。
                // 视口坐标 sx = (contentX - scrollLeft) * zoom（transformOrigin top-left）→
                // newScroll = pinchScroll + mid * (1/pinchZoom - 1/newZoom)
                el.scrollLeft = pinchScrollLeft + pinchMidX * (1 / pinchZoom - 1 / newZoom)
                el.scrollTop = pinchScrollTop + pinchMidY * (1 / pinchZoom - 1 / newZoom)
                setZoom(newZoom)
            } else if (e.touches.length === 1 && dragState.current) {
                e.preventDefault()
                const t = e.touches[0], ds = dragState.current
                el.scrollLeft = ds.left - (t.clientX - ds.x)
                el.scrollTop = ds.top - (t.clientY - ds.y)
            }
        }
        const onTouchEnd = (e: TouchEvent) => {
            // <2 指退出 pinch；===0 退出单指（touchcancel 复用此 handler 一并重置）
            if (e.touches.length < 2) pinchDist = 0
            if (e.touches.length === 0) dragState.current = null
        }

        el.addEventListener('wheel', onWheel, { passive: false })
        // touchstart 不 preventDefault，无需 passive:false（touch-action:none 已让浏览器不消费手势）
        el.addEventListener('touchstart', onTouchStart)
        el.addEventListener('touchmove', onTouchMove, { passive: false })
        el.addEventListener('touchend', onTouchEnd)
        el.addEventListener('touchcancel', onTouchEnd)
        return () => {
            el.removeEventListener('wheel', onWheel)
            el.removeEventListener('touchstart', onTouchStart)
            el.removeEventListener('touchmove', onTouchMove)
            el.removeEventListener('touchend', onTouchEnd)
            el.removeEventListener('touchcancel', onTouchEnd)
        }
    }, [isPreview])

    const startDrag = (e: React.PointerEvent) => {
        // pointer handler 只处理鼠标/笔；touch 走原生 listener（见 effect），避免合成/混合事件干扰
        if (e.pointerType === 'touch' || zoom <= 1) return
        const el = previewRef.current
        if (!el) return
        dragState.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    }
    const moveDrag = (e: React.PointerEvent) => {
        // 过滤 touch：混合设备上触摸 pointermove 不应影响鼠标拖拽
        if (e.pointerType === 'touch') return
        const ds = dragState.current
        const el = previewRef.current
        if (!ds || !el) return
        el.scrollLeft = ds.left - (e.clientX - ds.x)
        el.scrollTop = ds.top - (e.clientY - ds.y)
    }
    const endDrag = (e: React.PointerEvent) => {
        // 过滤 touch：触摸 pointerup/leave 不应终止鼠标拖拽
        if (e.pointerType === 'touch') return
        dragState.current = null
    }

    const zoomIn = () => setZoom(z => clampZoom(z + 0.1))
    const zoomOut = () => setZoom(z => clampZoom(z - 0.1))

    return (
        <NodeViewWrapper style={{ position: 'relative' }}>
            {/* contentDOM：始终在 DOM（ProseMirror 要求稳定），仅 source 态可见 */}
            <NodeViewContent
                as="div"
                className="mermaid-source"
                style={{ display: isPreview ? 'none' : 'block' }}
            />
            {isPreview && (
                <div
                    ref={previewRef}
                    onDoubleClick={() => setMode('source')}
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerLeave={endDrag}
                    style={{
                        overflow: 'auto',
                        maxHeight: '60vh',
                        cursor: zoom > 1 ? (dragState.current ? 'grabbing' : 'grab') : 'default',
                        // touch-action:none：完全接管触摸（单指拖 + 双指 pinch）。
                        // pan-x pan-y 会在单指 pan 启动后吞掉第 2 指 touchmove 致 pinch 失效。
                        touchAction: 'none',
                        userSelect: zoom > 1 ? 'none' : 'auto',
                    }}
                >
                    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', padding: 4 }}>
                        <MermaidDiagram code={node.textContent} />
                    </div>
                </div>
            )}
            {/* 右上角控件组：缩放（仅 preview）+ 切换 preview/source */}
            <div className="mermaid-controls">
                {isPreview && (
                    <>
                        {zoom !== 1 && (
                            <button type="button" className="mermaid-btn" title={`复位 100%（当前 ${Math.round(zoom * 100)}%）`} onClick={() => setZoom(1)}>
                                <Maximize size={14} />
                            </button>
                        )}
                        <button type="button" className="mermaid-btn" title="缩小" onClick={zoomOut}>
                            <ZoomOut size={14} />
                        </button>
                        <button type="button" className="mermaid-btn" title="放大" onClick={zoomIn}>
                            <ZoomIn size={14} />
                        </button>
                    </>
                )}
                <button
                    type="button"
                    className="mermaid-btn"
                    title={isPreview ? '编辑源码' : '预览渲染'}
                    onClick={() => setMode(isPreview ? 'source' : 'preview')}
                >
                    {isPreview ? <Pencil size={14} /> : <Eye size={14} />}
                </button>
            </div>
        </NodeViewWrapper>
    )
})
