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
import { Button, Spin, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
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
    const { t } = useTranslation()
    const [data, setData] = useState<Uint8Array | null>(null)
    const [numPages, setNumPages] = useState(0)
    const [pageNum, setPageNum] = useState(1)
    const [scale, setScale] = useState(1.0)
    // PDF 加载失败（损坏/加密/格式错）：渲染错误提示，而非空白
    const [loadError, setLoadError] = useState<Error | null>(null)

    // blob → Uint8Array：react-pdf Document file.data 优选 Uint8Array
    // blob 变化（切到另一份 PDF）时一并重置页码与错误态，避免旧 pageNum 越界（切到页数更少的 PDF）或残留错误
    useEffect(() => {
        let cancelled = false
        setNumPages(0)
        setPageNum(1)
        setLoadError(null)
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
                ) : loadError ? (
                    // PDF 加载失败（损坏/加密/格式错）：给明确错误提示，而非空白
                    <Empty description={t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : (
                    <Document
                        file={{ data }}
                        onLoadSuccess={({ numPages: n }) => {
                            setNumPages(n)
                            // 切换 PDF 后旧 pageNum 可能越界（前一份留 5 页、新一份仅 2 页），按新 numPages clamp
                            setPageNum((p) => Math.min(p, n))
                        }}
                        onLoadError={(err) => setLoadError(err)}
                    >
                        <Page pageNumber={pageNum} scale={scale} />
                    </Document>
                )}
            </div>
        </div>
    )
}
