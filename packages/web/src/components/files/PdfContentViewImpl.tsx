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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import PdfToolbar, { clampScale } from './PdfToolbar'
import PdfContinuousView from './PdfContinuousView'
// PDF 视图状态（缩放 + 滚动比例）记忆在 workspaceStore 的 tab.viewState，与 tab 同生命周期：
// 切走再切回恢复，关 tab / 删 session 自动清理。命令式读写（getState/setTabViewState），不订阅以避免滚动触发 re-render。
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// 组件外（模块级），保持引用稳定，避免 react-pdf 因 options 变化重新加载
// （react-pdf Document.d.ts 明确要求 options 对象定义在组件外或 useMemo）。
// read-file 端点依赖 httpOnly cookie mobi_token 认证，必须开启 withCredentials，
// 否则 pdfjs 的 JS fetch 不带 cookie → 401 → PDF 加载失败。
const PDF_OPTIONS = { withCredentials: true } as const

/**
 * 计算「适应宽度」缩放：containerWidth / pageWidth，clamp 到 [MIN_SCALE, MAX_SCALE]。
 * 宽度 ≤ 0（未就绪）返回 null（调用方判断是否 setScale）。
 * 「适应宽度」按钮用此值（可能 > 100%，真·撑满宽度）。
 */
const computeFitScale = (cw: number, pw: number): number | null =>
    cw > 0 && pw > 0 ? clampScale(cw / pw) : null

/**
 * 计算「首屏默认」缩放：min(fit, 100%)。复用 computeFitScale（已 clamp 到 [MIN,MAX]）再封顶 1。
 * 窄页（A4 在宽屏）fit 常 > 1 → 封顶 100%（不默认放大）；宽页 fit < 1 → 取 fit（缩到容器内）。
 * 仅用于打开 PDF 的初始缩放，「适应宽度」按钮仍走 computeFitScale（真·撑满，可 >100%）。
 */
const computeInitialScale = (cw: number, pw: number): number | null => {
    const fit = computeFitScale(cw, pw)
    return fit === null ? null : Math.min(fit, 1)
}

/** renderScale 跟随 previewScale 的 debounce 延迟（ms）：停顿 300ms 后才触发 pdfjs 高清重渲染 */
const DEBOUNCE_MS = 300

interface PdfContentViewImplProps {
    /** 会话 ID（拼 read-file 端点 url） */
    sessionId: string
    /** 所属 tab id（读写 tab.viewState 记忆缩放+滚动） */
    tabId: string
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
 * - **混合缩放**：previewScale 即时（CSS transform 预览）/ renderScale debounce 300ms 跟随（pdfjs
 *   高清重渲染）。用户拖动/按按钮时 previewScale 立即变化（视觉无卡顿），停顿 300ms 后 renderScale
 *   才追上（避免高频重渲染）。首屏 fit 时 preview+render 同步设置，绕过 debounce（避免首屏 300ms 模糊）。
 * - **工具栏**：PdfToolbar（-/百分比/+ /适应宽度/100%），百分比显示即时 previewScale。
 *
 * clampScale 及其常量（MIN_SCALE/MAX_SCALE/SCALE_STEP）在 PdfToolbar 导出（叶子组件，避免重复定义 + 循环依赖）。
 */
export default function PdfContentViewImpl({ sessionId, tabId, filePath }: PdfContentViewImplProps) {
    const { t } = useTranslation()
    const [numPages, setNumPages] = useState(0)
    const [pageWidth, setPageWidth] = useState(0)
    const [pageHeight, setPageHeight] = useState(0)
    // 混合缩放：previewScale 即时（驱动 CSS transform 预览 + 工具栏百分比），
    // renderScale debounce 300ms 跟随（驱动 pdfjs <Page scale=renderScale> 高清重渲染）
    const [previewScale, setPreviewScale] = useState(1)
    const [renderScale, setRenderScale] = useState(1)
    // debounce timer handle（useEffect cleanup 时 clear，避免泄漏/重复触发）
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // PDF 加载失败（损坏/加密/格式错）：渲染错误提示，而非空白
    const [loadError, setLoadError] = useState<Error | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    // 加载令牌：每次 handleLoadSuccess 自增，丢弃切换 filePath 后旧 getPage 的延迟回调
    const loadTokenRef = useRef(0)
    // 滚动容器宽度（ResizeObserver 跟踪），用于「适应宽度」计算
    const [containerWidth, setContainerWidth] = useState(0)
    // 记忆恢复：加载后待恢复 scrollTop（[sessionId,filePath] 变化时置 true，恢复一次后清空）
    const pendingRestoreRef = useRef(true)
    // 最近一次滚动比例（scrollTop/scrollHeight），用于持久化与恢复（与 scale 无关，缩放后仍按比例恢复）
    const lastScrollRatioRef = useRef(0)
    // PDF 是否已加载完成（handleLoadSuccess 跑过）。卸载时据此判断是否落盘：
    // 未加载完就切走时 lastScrollRatioRef 仍是初始 0，写入会污染 saved → 此时跳过
    const loadedRef = useRef(false)
    // onScroll 的 rAF handle：高频 scroll（60-120Hz）合并到每帧一次 ratio 计算
    const scrollRafRef = useRef<number | null>(null)
    // previewScale 的 ref 镜像：卸载 effect 的 deps 只 [sessionId,filePath]，闭包会过期，
    // 用 ref 保证切走时落盘的是最新 scale（而非首次 render 的过期值）
    const previewScaleRef = useRef(previewScale)

    // previewScale 变化：① 同步 ref 镜像（卸载 effect 闭包用，保证落盘最新 scale）
    // ② debounce renderScale 跟随。每次都 clear 上次 timer 重排，保证只在用户停止操作后才重渲染。
    // cleanup 清理 pending timer，防止组件卸载后 setState（内存泄漏/警告）。
    // 注意：不在此持久化 scale——挂载时本 effect 会立即 schedule，若 PDF 异步加载未完成，
    // lastScrollRatioRef 仍是初始 0，写入会污染 saved ratio。持久化统一在卸载 effect 做。
    useEffect(() => {
        previewScaleRef.current = previewScale
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => setRenderScale(previewScale), DEBOUNCE_MS)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [previewScale])

    // ResizeObserver：容器宽度变化时更新 containerWidth（驱动适应宽度计算）
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // 切换 PDF（sessionId/filePath 变）→ 重置加载状态，避免旧 PDF 残留：
    // - loadError 不清会永久卡 Empty（Document 不挂载，新 onLoadSuccess 永不触发）
    // - numPages/pageWidth/pageHeight 不清会旧占位 + 旧尺寸（PdfContinuousView 也会清 visible）
    useEffect(() => {
        setLoadError(null)
        setNumPages(0)
        setPageWidth(0)
        setPageHeight(0)
        // 标记需恢复滚动位置（新 PDF 加载完成后按 saved.ratio 恢复一次）
        pendingRestoreRef.current = true
        // PDF 未加载完：卸载时据此跳过落盘，避免初始 ratio=0 污染 saved
        loadedRef.current = false
    }, [sessionId, filePath])

    // read-file 端点 url：pdfjs 走 HTTP Range 按需加载
    const src = `/api/sessions/${sessionId}/read-file?path=${encodeURIComponent(filePath)}`

    const handleLoadSuccess = async (pdf: PDFDocumentProxy) => {
        const token = ++loadTokenRef.current
        setNumPages(pdf.numPages)
        const page = await pdf.getPage(1)
        // 切换 filePath 后旧 PDF 的 getPage 可能晚 resolve → 丢弃，避免覆盖新 PDF 状态
        if (token !== loadTokenRef.current) return
        const vp = page.getViewport({ scale: 1 })
        setPageWidth(vp.width)
        setPageHeight(vp.height)
        // 记忆恢复：读该 tab 上次的视图状态（scrollRatio + scale）。有 scale 则优先（用户上次缩放），scrollRatio 存 ref 供恢复
        const saved = useWorkspaceStore.getState().getSession(sessionId).tabs.find((t) => t.id === tabId)?.viewState ?? null
        lastScrollRatioRef.current = saved?.scrollRatio ?? 0
        // 加载完成：卸载时允许落盘（此前的 lastScrollRatioRef 已是 saved 或用户滚动值，非初始 0）
        loadedRef.current = true
        // I3: 同步读 DOM 容器宽度算初始 scale，绕过 ResizeObserver 竞态
        // （首次 mount 时 observer 回调可能晚于 onLoadSuccess → containerWidth state=0 → 适应宽度失效）
        const cw = containerRef.current?.getBoundingClientRect().width ?? 0
        // 有记忆 scale 优先于默认 fit（用户上次缩放值），否则走 min(fit, 100%)
        const initial: number | null = saved?.scale ?? computeInitialScale(cw, vp.width)
        if (initial !== null) {
            // 首屏：preview + render 同步设，绕过 debounce（避免首屏 300ms 模糊）
            setPreviewScale(initial)
            setRenderScale(initial)
        }
    }

    const fitWidth = () => {
        // 用户点按钮触发：此时 ResizeObserver 早已 fire，containerWidth state 已就绪
        const fit = computeFitScale(containerWidth, pageWidth)
        if (fit !== null) setPreviewScale(fit)   // 即时预览，debounce 自然跟进 renderScale
    }
    const reset = () => setPreviewScale(1)
    const handleScaleChange = (s: number) => setPreviewScale(clampScale(s))

    // 记忆恢复：numPages/pageHeight/previewScale 都就绪 + DOM 提交（layoutEffect 在绘制前）后，
    // 一次性按 saved.ratio 恢复 scrollTop。恢复完清 pendingRestoreRef（后续缩放/滚动由用户主导）。
    useLayoutEffect(() => {
        if (!pendingRestoreRef.current) return
        if (numPages === 0 || pageHeight === 0 || previewScale === 0) return
        const el = containerRef.current
        if (!el) return
        const sh = numPages * pageHeight * previewScale
        el.scrollTop = lastScrollRatioRef.current * sh
        pendingRestoreRef.current = false
    }, [numPages, pageHeight, previewScale])

    /** 滚动时 rAF 节流记录 ratio 到 ref（不写 store，卸载时统一持久化，避免高频写 + 恢复前污染） */
    const onScroll = () => {
        if (scrollRafRef.current != null) return
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null
            const el = containerRef.current
            if (!el) return
            const sh = el.scrollHeight
            lastScrollRatioRef.current = sh > 0 ? el.scrollTop / sh : 0
        })
    }

    // 卸载/切走时一次性把视图状态写到 tab.viewState（与 tab 同生命周期）。
    // - 实时滚动只更新 ref（onScroll rAF 节流），不写 store
    // - flush 最后一次滚动（rAF 可能 pending，cancel 后同步算一次确保最新 ratio）
    // - loadedRef 防护：PDF 未加载完就切走时跳过，避免初始 ratio=0 覆盖 saved
    // deps [sessionId,filePath,tabId]：切换时 cleanup 保存旧 tab 状态；ref 保证读到最新值（闭包会过期）
    useEffect(() => {
        return () => {
            if (scrollRafRef.current != null) {
                cancelAnimationFrame(scrollRafRef.current)
                scrollRafRef.current = null
            }
            // 同步 flush 最后一帧 ratio（cancel 可能漏掉未提交的滚动）
            const el = containerRef.current
            if (el) {
                const sh = el.scrollHeight
                if (sh > 0) lastScrollRatioRef.current = el.scrollTop / sh
            }
            if (!loadedRef.current) return
            useWorkspaceStore.getState().setTabViewState(sessionId, tabId, {
                scrollRatio: lastScrollRatioRef.current,
                scale: previewScaleRef.current,
            })
        }
    }, [sessionId, filePath, tabId])

    // pinch 状态：双指起始距离 + 起始 previewScale（onTouchStart 记录，onTouchMove 按比例缩放）
    const pinchRef = useRef<{ startDist: number; baseScale: number } | null>(null)
    // rAF 节流：高频 touchmove（60-120Hz）合并到每帧一次 setPreviewScale，避免长 PDF pinch 时
    // React 每秒 60-120 次重渲染（含 N 占位 + debounce timer churn）导致掉帧
    const rafRef = useRef<number | null>(null)
    const pinchPendingRef = useRef<number | null>(null)

    /** 两指欧几里得距离（clientX/Y 坐标系）；不足两指返回 0 */
    const getTouchDist = (touches: React.TouchList): number => {
        if (touches.length < 2) return 0
        const dx = touches[0].clientX - touches[1].clientX
        const dy = touches[0].clientY - touches[1].clientY
        return Math.hypot(dx, dy)
    }

    // touchAction: 'pan-y' 允许纵向滚动交给浏览器原生处理（pan-y），双指 pinch 由 JS 接管。
    const onTouchStart = (e: React.TouchEvent) => {
        // 双指落下：记录初始指间距 + 当前 previewScale 作为 pinch 基线
        if (e.touches.length === 2) {
            pinchRef.current = { startDist: getTouchDist(e.touches), baseScale: previewScale }
        }
    }
    const onTouchMove = (e: React.TouchEvent) => {
        const ps = pinchRef.current
        if (!ps || e.touches.length !== 2) return
        const dist = getTouchDist(e.touches)
        // 距离 0 防御（除零）：起点或当前距离退化时跳过
        if (ps.startDist <= 0 || dist <= 0) return
        const ratio = dist / ps.startDist
        // 写入 pending，rAF 回调统一 flush（每帧最多一次 setPreviewScale）
        pinchPendingRef.current = clampScale(ps.baseScale * ratio)
        if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null
                if (pinchPendingRef.current != null) {
                    setPreviewScale(pinchPendingRef.current)
                    pinchPendingRef.current = null
                }
            })
        }
    }
    // 结束 pinch：无条件清 pinchRef（修复 3 指→2 指：剩 2 指但组合变了，旧 startDist 不匹配 → scale 突跳），
    // flush 最后一次 pending 值 + 取消 rAF（确保停手即定稿）
    const endPinch = () => {
        pinchRef.current = null
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        if (pinchPendingRef.current != null) {
            setPreviewScale(pinchPendingRef.current)
            pinchPendingRef.current = null
        }
    }
    const onTouchEnd = () => endPinch()
    const onTouchCancel = () => endPinch()

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <PdfToolbar
                scale={previewScale}
                onScaleChange={handleScaleChange}
                onFitWidth={fitWidth}
                onReset={reset}
            />
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    background: 'var(--ant-color-fill-quaternary)',
                    // 允许纵向滚动交给浏览器原生（pan-y），横向留给未来 pinch（Task 3）
                    touchAction: 'pan-y',
                }}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchCancel}
                onScroll={onScroll}
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
                                    pageHeight={pageHeight}
                                    previewScale={previewScale}
                                    renderScale={renderScale}
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
