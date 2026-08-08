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
export const MermaidNodeView = memo(function MermaidNodeView({ node }: NodeViewProps) {
    const [mode, setMode] = useState<'preview' | 'source'>('preview')
    const [zoom, setZoom] = useState(1)
    const previewRef = useRef<HTMLDivElement>(null)
    // 拖动平移状态（zoom > 1 时启用）
    const dragState = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

    const isPreview = mode === 'preview'

    // Ctrl+滚轮缩放（原生 wheel 必须用 passive:false 才能 preventDefault 阻止浏览器页面缩放）
    useEffect(() => {
        if (!isPreview) return
        const el = previewRef.current
        if (!el) return
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            setZoom(z => Math.min(2, Math.max(0.25, +(z + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(2))))
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [isPreview])

    const startDrag = (e: React.MouseEvent) => {
        if (zoom <= 1) return
        const el = previewRef.current
        if (!el) return
        dragState.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    }
    const moveDrag = (e: React.MouseEvent) => {
        const ds = dragState.current
        const el = previewRef.current
        if (!ds || !el) return
        el.scrollLeft = ds.left - (e.clientX - ds.x)
        el.scrollTop = ds.top - (e.clientY - ds.y)
    }
    const endDrag = () => { dragState.current = null }

    const clampZoom = (z: number) => Math.min(2, Math.max(0.25, +z.toFixed(2)))
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
                    onMouseDown={startDrag}
                    onMouseMove={moveDrag}
                    onMouseUp={endDrag}
                    onMouseLeave={endDrag}
                    style={{
                        overflow: 'auto',
                        maxHeight: '60vh',
                        cursor: zoom > 1 ? (dragState.current ? 'grabbing' : 'grab') : 'default',
                        // 缩放/拖动选中文字的视觉干扰
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
