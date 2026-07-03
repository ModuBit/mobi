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
import { useQueryClient } from '@tanstack/react-query'
import { Spin, Empty, App } from 'antd'
import { useTranslation } from 'react-i18next'
import { Copy, FileCode, Eye, RefreshCw } from 'lucide-react'
import type { MenuProps } from 'antd'
import { useFileContent, useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { queryKeys } from '@/core/lib/query-keys'
import { FILE_SIZE_LIMITS, NATIVE_MEDIA_EXT } from '@/core/config/fileLimits'
import FileTooLarge from '@/components/files/FileTooLarge'
import FileContentViewHeader from '@/components/files/FileContentViewHeader'
import TextContentView from '@/components/files/TextContentView'
import MarkdownContentView from '@/components/files/MarkdownContentView'
import ImageContentView from '@/components/files/ImageContentView'
import PdfContentView from '@/components/files/PdfContentView'
import MediaContentView from '@/components/files/MediaContentView'

interface FileContentViewProps {
    sessionId: string
    /** 当前 tab id：Folders 选文件后调 openFileInTab 用 */
    tabId: string
    filePath: string
}

export default function FileContentView({ sessionId, tabId, filePath }: FileContentViewProps) {
    const { t } = useTranslation()
    const { message } = App.useApp()
    const queryClient = useQueryClient()

    // meta 先行：不拉 body 即可拿到 mime/size，据此决定渲染策略与是否拉 content
    const { data: meta, isLoading: metaLoading, error: metaError } = useFileMeta(sessionId, filePath)

    // 按 mime 分类（基于 meta，而非 content——可在拉 content 前判断）
    const mime = meta?.mime ?? ''
    const isTextLike = mime.startsWith('text/')
        || ['application/json', 'application/xml', 'application/x-sh', 'application/sql', 'application/toml']
            .includes(mime)
    const isImage = mime.startsWith('image/')
    const isPdf = mime === 'application/pdf'
    const isAudioVideo = mime.startsWith('audio/') || mime.startsWith('video/')
    // .md 文件：text/markdown，可渲染/源码双模式（优先于 isTextLike 分支）
    const isMarkdown = mime === 'text/markdown'

    // size 阈值判断（meta 先行，下载前拦截，省流量/解码）
    const tooLarge = !!meta && (
        (isTextLike && meta.size >= FILE_SIZE_LIMITS.textPlain)
        || (isImage && meta.size >= FILE_SIZE_LIMITS.image)
        || (isPdf && meta.size >= FILE_SIZE_LIMITS.pdf)
    )
    // 文本高亮判断（< 1MB 才走 Shiki，避免 DOM 瓶颈）
    const useHighlight = !!meta && isTextLike && meta.size < FILE_SIZE_LIMITS.textHighlight

    // 原生音视频格式判断（扩展名 ∈ NATIVE_MEDIA_EXT，其余非原生走下载）
    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
    const isNativeMedia = NATIVE_MEDIA_EXT.includes(ext)

    // 只在「size 内 + 可预览类型」才取 content；图片/PDF 走 src 直连端点（不 fetch blob），音视频/二进制不拉
    const shouldFetchContent = !!meta && !tooLarge && !isAudioVideo && isTextLike
    const { data: file, isLoading: contentLoading, error: contentError } = useFileContent(
        sessionId, filePath, shouldFetchContent, meta?.etag,
    )

    // .md 双模式：默认渲染，切文件（filePath 变）重置回渲染
    const [view, setView] = useState<'render' | 'source'>('render')
    useEffect(() => { setView('render') }, [filePath])

    // 文本类：blob → text 异步读取（content 拉回后才执行）
    const isText = !!file && isTextLike
    const [text, setText] = useState<string | null>(null)
    useEffect(() => {
        if (!(file && isText)) {
            setText(null)
            return
        }
        let cancelled = false
        file.blob.text().then((v) => { if (!cancelled) setText(v) }).catch(() => setText(null))
        return () => { cancelled = true }
    }, [file, isText])

    const copyPath = async () => {
        try {
            await navigator.clipboard.writeText(filePath)
        } catch {
            // fallback：对齐 CopyButton.tsx 的 execCommand 兜底（老浏览器/无权限）
            const ta = document.createElement('textarea')
            ta.value = filePath
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
        }
        message.success(t('files.pathCopied'))
    }

    const moreMenuItems: MenuProps['items'] = [
        // 刷新：只 invalidate meta → meta refetch 拿新 etag → useFileContent queryKey 含 etag 变化 → content 自动 refetch
        { key: 'refresh', icon: <RefreshCw size={14} />, label: t('files.refresh'), onClick: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionFileMeta(sessionId, filePath) })
        } },
        { key: 'copyPath', icon: <Copy size={14} />, label: t('files.copyPath'), onClick: copyPath },
        // .md 文件：渲染/源码切换（图标随当前 view 变化）
        ...(isMarkdown ? [{
            key: 'toggleView',
            icon: view === 'render' ? <FileCode size={14} /> : <Eye size={14} />,
            label: view === 'render' ? t('files.viewSource') : t('files.viewRender'),
            onClick: () => setView((v) => v === 'render' ? 'source' : 'render'),
        }] : []),
    ]

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* header：左面包屑（左对齐，空间不够左省略）+ 右功能区（more 菜单 + 文件树） */}
            <FileContentViewHeader
                sessionId={sessionId}
                tabId={tabId}
                filePath={filePath}
                extraMenuItems={moreMenuItems}
            />
            {/* content：meta 先行 → size 阈值拦截 → 按类型三级分发 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {metaLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : metaError ? (
                    <Empty description={metaError instanceof Error ? metaError.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : tooLarge ? (
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.tooLarge')} />
                ) : isPdf ? (
                    // PDF 走 react-pdf：file=url 让 pdfjs HTTP Range 按需加载（不再全量 fetch blob）
                    <PdfContentView sessionId={sessionId} tabId={tabId} filePath={filePath} />
                ) : isAudioVideo ? (
                    // 原生格式 src 直连（cookie 带 + Range 流式，无 size 阈值）；非原生走下载
                    isNativeMedia
                        ? <MediaContentView sessionId={sessionId} filePath={filePath} isAudio={mime.startsWith('audio/')} />
                        : <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.mediaDownload')} />
                ) : isImage ? (
                    // 图片 src 直连端点（cookie 带 + 浏览器原生缓存），不依赖 content
                    <ImageContentView sessionId={sessionId} filePath={filePath} />
                ) : !isTextLike ? (
                    // meta 就绪但不属于可直显类型（文本/图片）→ 二进制，提示下载（不依赖 content）
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.binaryDownload')} />
                ) : contentLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : contentError ? (
                    <Empty description={contentError instanceof Error ? contentError.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : file ? (
                    // 按类型路由到 ContentView（纯展示组件），文本渲染策略在外壳 meta 先行决定
                    isMarkdown ? (
                        <MarkdownContentView text={text ?? ''} filePath={filePath} view={view} />
                    ) : (
                        <TextContentView text={text ?? ''} filePath={filePath} highlight={useHighlight} />
                    )
                ) : (
                    <Empty description={t('files.selectToView')} style={{ marginTop: 40 }} />
                )}
            </div>
        </div>
    )
}
