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

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Spin, Empty, App } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Copy, FileCode, Eye, RefreshCw, WrapText } from 'lucide-react'
import { queryKeys } from '@/core/lib/query-keys'
import FileDownloadPrompt from '@/components/files/FileDownloadPrompt'
import TextContentView from '@/components/files/TextContentView'
import MarkdownContentView from '@/components/files/MarkdownContentView'
import HtmlPreviewView from '@/components/files/HtmlPreviewView'
import ImageContentView from '@/components/files/ImageContentView'
import PdfContentView from '@/components/files/PdfContentView'
import MediaContentView from '@/components/files/MediaContentView'
import FileContentViewHeader from '@/components/files/FileContentViewHeader'
import { useFileRenderState, type ReadyRenderState } from '@/components/files/useFileRenderState'
import { useFileEditor, type FileEditorState } from '@/components/files/useFileEditor'
import { CodeEditorView } from '@/components/files/CodeEditorView'
import { MarkdownEditorView } from '@/components/files/MarkdownEditorView'

interface FileContentViewProps {
    sessionId: string
    /** 当前 tab id：Folders 选文件后调 openFileInTab 用 */
    tabId: string
    filePath: string
    /** session 是否在线（CLI 已连接）；离线时不可编辑（save-file 路由 requireActive） */
    active?: boolean
}

export default function FileContentView({ sessionId, tabId, filePath, active = true }: FileContentViewProps) {
    const { t } = useTranslation()
    const { message } = App.useApp()
    const queryClient = useQueryClient()
    const state = useFileRenderState(sessionId, filePath, active)

    // 编辑器状态机：ready+editable 时启用；非 ready 传占位（hooks 无条件调用，内部 draft=null 短路）
    const isReady = state.status === 'ready'
    const editor = useFileEditor(
        sessionId, filePath,
        isReady ? { text: state.text, etag: state.etag } : { text: '', etag: '' },
    )
    // 仅 ready + editable 时挂编辑器 / 监听快捷键
    const editableNow = isReady && state.editable

    // Ctrl/Cmd+S 手动保存
    useEffect(() => {
        if (!editableNow) return
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault()
                void editor.saveNow()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [editableNow, editor])

    // markdown 菜单：kind 在 content-loading / ready 均携带，故 content 拉取期间菜单也常驻，
    // 不会因加载完成而闪退闪现；view/toggleView 在这两个状态均可用，加载期间可预切源码。
    const onCodePath = state.status === 'content-loading' || state.status === 'ready'
    const isMarkdown = onCodePath && state.kind.kind === 'markdown'
    const isHtml = onCodePath && state.kind.kind === 'html'
    const view = onCodePath ? state.view : 'render'
    const toggleView = onCodePath ? state.toggleView : undefined
    // 源码视图（text 文件，或 markdown / html source 模式）才显示「自动换行」切换
    const isCodeView = onCodePath && (state.kind.kind === 'text' || ((isMarkdown || isHtml) && view === 'source'))
    const wrap = onCodePath ? state.wrap : true
    const toggleWrap = onCodePath ? state.toggleWrap : undefined

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
    ]
    // .md / .html 文件：渲染/源码切换（图标随当前 view 变化）；isMarkdown || isHtml 隐含 toggleView 已定义
    // - markdown: render→source 用 viewSource；source→render 用 viewRender
    // - html: source(默认)→render(预览) 用 viewPreview；render→source 用 viewSource
    if (isMarkdown || isHtml) {
        const inRenderMode = view === 'render'
        // 切换目标文案：render 态下要切去 source（viewSource）；source 态下要切去 渲染/预览
        // markdown 用 viewRender，html 用 viewPreview
        const switchLabel = inRenderMode
            ? t('files.viewSource')
            : (isHtml ? t('files.viewPreview') : t('files.viewRender'))
        moreMenuItems.push({
            key: 'toggleView',
            icon: inRenderMode ? <FileCode size={14} /> : <Eye size={14} />,
            label: switchLabel,
            onClick: () => toggleView?.(),
        })
    }
    // 源码视图：自动换行切换（label 显示切换后的目标状态）
    if (isCodeView) {
        moreMenuItems.push({
            key: 'toggleWrap',
            icon: <WrapText size={14} />,
            label: wrap ? t('files.noWrap') : t('files.wordWrap'),
            onClick: () => toggleWrap?.(),
        })
    }

    // 保存状态指示（仅 editable 时显示）
    const saveStatus: 'saved' | 'saving' | 'dirty' | 'conflict' | undefined =
        !editableNow ? undefined
            : editor.conflict ? 'conflict'
                : editor.saving ? 'saving'
                    : editor.dirty ? 'dirty' : 'saved'

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* header：左面包屑（左对齐，空间不够左省略）+ 右功能区（more 菜单 + 文件树） */}
            <FileContentViewHeader
                sessionId={sessionId}
                tabId={tabId}
                filePath={filePath}
                extraMenuItems={moreMenuItems}
                saveStatus={saveStatus}
            />
            {/* content：按 RenderState exhaustive switch 渲染 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {renderBody(state, sessionId, tabId, filePath, t, editor)}
            </div>
        </div>
    )
}

/** 按 RenderState exhaustive switch 渲染内容区（含 ready 态按 FileKind 二级 switch） */
function renderBody(
    state: ReturnType<typeof useFileRenderState>,
    sessionId: string,
    tabId: string,
    filePath: string,
    t: TFunction,
    editor: FileEditorState,
) {
    switch (state.status) {
        case 'meta-loading':
            return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        case 'meta-error':
            return <Empty description={state.error instanceof Error ? state.error.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
        case 'too-large':
            return <FileDownloadPrompt sessionId={sessionId} filePath={filePath} reason={t('files.tooLarge')} />
        case 'content-loading':
            return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        case 'content-error':
            return <Empty description={state.error instanceof Error ? state.error.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
        case 'empty':
            // content 拉回但 file 为空（如 304 无 body），非「未选文件」
            return <Empty description={t('files.fileEmpty')} style={{ marginTop: 40 }} />
        case 'ready':
            return renderReady(state, sessionId, tabId, filePath, t, editor)
    }
}

/** ready 态按 FileKind exhaustive switch 路由到各 ContentView */
function renderReady(
    state: ReadyRenderState,
    sessionId: string,
    tabId: string,
    filePath: string,
    t: TFunction,
    editor: FileEditorState,
) {
    switch (state.kind.kind) {
        case 'pdf':
            // PDF 走 react-pdf：file=url 让 pdfjs HTTP Range 按需加载
            return <PdfContentView sessionId={sessionId} tabId={tabId} filePath={filePath} etag={state.etag} />
        case 'image':
            // 图片 src 直连端点（cookie 带 + 浏览器原生缓存）；etag 入 src 才能感知内容变化
            return <ImageContentView sessionId={sessionId} filePath={filePath} etag={state.etag} />
        case 'media-native':
            // 原生格式 src 直连（cookie 带 + Range 流式）
            return <MediaContentView sessionId={sessionId} filePath={filePath} isAudio={state.kind.isAudio} etag={state.etag} />
        case 'media-download':
            // 非原生音视频走下载
            return <FileDownloadPrompt sessionId={sessionId} filePath={filePath} reason={t('files.mediaDownload')} />
        case 'binary':
            // 不可直显二进制，提示下载
            return <FileDownloadPrompt sessionId={sessionId} filePath={filePath} reason={t('files.binaryDownload')} />
        case 'markdown':
            // editable → Typora 式 WYSIWYG；否则只读渲染（含 render/source 切换）
            if (state.editable) {
                return <MarkdownEditorView text={editor.draft} onChange={editor.update} />
            }
            return <MarkdownContentView text={state.text} filePath={filePath} view={state.view} wrap={state.wrap} />
        case 'html':
            return <HtmlPreviewView sessionId={sessionId} filePath={filePath} view={state.view} text={state.text} wrap={state.wrap} />
        case 'text':
            // editable → CodeMirror 编辑器；否则只读高亮
            if (state.editable) {
                return <CodeEditorView text={editor.draft} filePath={filePath} wrap={state.wrap} onChange={editor.update} />
            }
            return <TextContentView text={state.text} filePath={filePath} highlight={state.kind.highlight} wrap={state.wrap} />
    }
}
