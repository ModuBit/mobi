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
import { Document, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Empty, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
// react-pdf v10：文本层/注释层样式（选中、超链接等）
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
// pdfjs worker：用 ?url 显式拿 worker 文件 URL。
// 不用 new URL('pdfjs-dist/...', import.meta.url)——vite dev 对指向 optimize dep 子路径的
// bare import transform 异常，会得到错误相对路径（如 "pdf.worker.mjs"），fetch 命中 SPA fallback
// 返回 index.html，worker 加载到 HTML 而非脚本 → pdfjs worker 起不来 → PDF 渲染失败。
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
// 缩放上下限从 PdfToolbar 导出（叶子组件，避免重复定义 + 循环依赖）
import PdfToolbar, { MIN_SCALE, MAX_SCALE } from './PdfToolbar'
import PdfContinuousView from './PdfContinuousView'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// 组件外（模块级），保持引用稳定，避免 react-pdf 因 options 变化重新加载
// （react-pdf Document.d.ts 明确要求 options 对象定义在组件外或 useMemo）。
// read-file 端点依赖 httpOnly cookie mobi_token 认证，必须开启 withCredentials，
// 否则 pdfjs 的 JS fetch 不带 cookie → 401 → PDF 加载失败。
const PDF_OPTIONS = { withCredentials: true } as const

/**
 * 计算「适应宽度」缩放：containerWidth / pageWidth，clamp 到 [MIN_SCALE, MAX_SCALE]。
 * 宽度 ≤ 0（未就绪）返回 null（调用方判断是否 setScale）。
 */
const computeFitScale = (cw: number, pw: number): number | null =>
    cw > 0 && pw > 0 ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, cw / pw)) : null

interface PdfContentViewImplProps {
    /** 会话 ID（拼 read-file 端点 url） */
    sessionId: string
    /** 文件路径（拼 url query param path） */
    filePath: string
}

/**
 * PDF 内容视图实现（file=url 按需加载 + 连续滚动 + 适应宽度默认）：
 *
 * - **file={url}**：直接把 read-file 端点 url 交给 react-pdf（pdfjs 走 HTTP Range 按需下载，
 *   不再全量读 blob 转 Uint8Array）。大 PDF 只下载首部 + 当前可视页，首屏更快、内存更省。
 * - **适应宽度默认**：onLoadSuccess 拿第一页 viewport，按 containerWidth / pageWidth 算初始 scale。
 * - **连续滚动**：Document 内放 PdfContinuousView（IntersectionObserver 虚拟化，只渲染可视页）。
 * - **工具栏**：PdfToolbar（-/百分比/+ /适应宽度/100%，Task 1 已实现）。
 *
 * 常量（MIN_SCALE/MAX_SCALE/SCALE_STEP）在 PdfToolbar 导出，这里只 import 前两个用于 clamp。
 */
export default function PdfContentViewImpl({ sessionId, filePath }: PdfContentViewImplProps) {
    const { t } = useTranslation()
    const [numPages, setNumPages] = useState(0)
    const [pageWidth, setPageWidth] = useState(0)
    const [pageHeight, setPageHeight] = useState(0)
    const [scale, setScale] = useState(1)
    // PDF 加载失败（损坏/加密/格式错）：渲染错误提示，而非空白
    const [loadError, setLoadError] = useState<Error | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    // 滚动容器宽度（ResizeObserver 跟踪），用于「适应宽度」计算
    const [containerWidth, setContainerWidth] = useState(0)

    // ResizeObserver：容器宽度变化时更新 containerWidth（驱动适应宽度计算）
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // read-file 端点 url：pdfjs 走 HTTP Range 按需加载
    const src = `/api/sessions/${sessionId}/read-file?path=${encodeURIComponent(filePath)}`

    const handleLoadSuccess = async (pdf: PDFDocumentProxy) => {
        setNumPages(pdf.numPages)
        const page = await pdf.getPage(1)
        const vp = page.getViewport({ scale: 1 })
        setPageWidth(vp.width)
        setPageHeight(vp.height)
        // I3: 同步读 DOM 容器宽度算 fit scale，绕过 ResizeObserver 竞态
        // （首次 mount 时 observer 回调可能晚于 onLoadSuccess → containerWidth state=0 → 适应宽度失效）
        const cw = containerRef.current?.getBoundingClientRect().width ?? 0
        const fit = computeFitScale(cw, vp.width)
        if (fit !== null) setScale(fit)
    }

    const fitWidth = () => {
        // 用户点按钮触发：此时 ResizeObserver 早已 fire，containerWidth state 已就绪
        const fit = computeFitScale(containerWidth, pageWidth)
        if (fit !== null) setScale(fit)
    }
    const reset = () => setScale(1)

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <PdfToolbar
                scale={scale}
                onScaleChange={setScale}
                onFitWidth={fitWidth}
                onReset={reset}
            />
            <div
                ref={containerRef}
                style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--ant-color-fill-quaternary)' }}
            >
                {loadError ? (
                    <Empty description={t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        {numPages === 0 && (
                            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                        )}
                        <Document
                            file={src}
                            options={PDF_OPTIONS}
                            loading={null}
                            onLoadSuccess={handleLoadSuccess}
                            onLoadError={(e) => setLoadError(e)}
                        >
                            {numPages > 0 && (
                                <PdfContinuousView
                                    numPages={numPages}
                                    pageWidth={pageWidth}
                                    pageHeight={pageHeight}
                                    scale={scale}
                                    scrollRootRef={containerRef}
                                />
                            )}
                        </Document>
                    </>
                )}
            </div>
        </div>
    )
}
