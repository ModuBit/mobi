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

import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { Button, Spin } from 'antd'
// react-pdf v10：文本层/注释层样式（选中、超链接等）
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// pdfjs worker（react-pdf v9+/pdfjs v4+ 推荐：用 import.meta.url 解析随包 worker，离线可用、版本一致）
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString()

interface PdfContentViewImplProps {
    /** 文件二进制内容（FileContentView fetch content 拿到的 blob） */
    blob: Blob
    /** 文件路径（保留以便后续扩展） */
    filePath: string
}

/** 缩放上下限与步进（移动端友好区间） */
const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.2

/**
 * PDF 内容视图实现（react-pdf Document/Page + 翻页/缩放）：
 * - 接收 Blob，内部 effect 转 Uint8Array 后交给 react-pdf（data 优选 Uint8Array）
 * - 工具栏：上一页 / 页码 / 下一页 / 缩小 / 缩放比 / 放大
 */
export default function PdfContentViewImpl({ blob, filePath: _filePath }: PdfContentViewImplProps) {
    const [data, setData] = useState<Uint8Array | null>(null)
    const [numPages, setNumPages] = useState(0)
    const [pageNum, setPageNum] = useState(1)
    const [scale, setScale] = useState(1.0)

    // blob → Uint8Array：react-pdf Document file.data 优选 Uint8Array
    useEffect(() => {
        let cancelled = false
        blob.arrayBuffer().then((ab) => {
            if (!cancelled) setData(new Uint8Array(ab))
        }).catch(() => {
            if (!cancelled) setData(null)
        })
        return () => { cancelled = true }
    }, [blob])

    const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(1)))
    const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(1)))
    const goPrev = () => setPageNum((p) => Math.max(1, p - 1))
    const goNext = () => setPageNum((p) => Math.min(numPages, p + 1))

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* 工具栏：翻页 + 缩放 */}
            <div style={{
                padding: '4px 8px',
                borderBottom: '1px solid var(--ant-color-border-secondary)',
                display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
            }}>
                <Button size="small" disabled={pageNum <= 1} onClick={goPrev}>上一页</Button>
                <span style={{ fontSize: 12 }}>{pageNum} / {numPages}</span>
                <Button size="small" disabled={pageNum >= numPages} onClick={goNext}>下一页</Button>
                <Button size="small" disabled={scale <= MIN_SCALE} onClick={zoomOut}>-</Button>
                <span style={{ fontSize: 12 }}>{Math.round(scale * 100)}%</span>
                <Button size="small" disabled={scale >= MAX_SCALE} onClick={zoomIn}>+</Button>
            </div>
            {/* 渲染区：data 就绪前 Spin；Document 加载成功后回填 numPages */}
            <div style={{
                flex: 1, overflow: 'auto', textAlign: 'center',
                background: 'var(--ant-color-fill-quaternary)',
            }}>
                {!data ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : (
                    <Document
                        file={{ data }}
                        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                    >
                        <Page pageNumber={pageNum} scale={scale} />
                    </Document>
                )}
            </div>
        </div>
    )
}
