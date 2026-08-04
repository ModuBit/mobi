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

import { useCallback, useEffect, useState } from 'react'
import { useFileContent, useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { FILE_SIZE_LIMITS } from '@/core/config/fileLimits'
import { resolveFileKind, type FileKind } from '@/components/files/fileKind'

/** 渲染决策状态（判别联合）—— useFileRenderState 的输出
 *
 *  kind 在 meta 就绪后的多个状态（content-loading / ready）均携带，
 *  以便父组件在 content 拉取期间就能派生 markdown 等菜单项，避免加载过程菜单闪退。
 */
export type RenderState =
    | { status: 'meta-loading' }
    | { status: 'meta-error'; error: unknown }
    | { status: 'too-large' }
    | { status: 'content-loading'; kind: FileKind; view: 'render' | 'source'; toggleView: () => void; wrap: boolean; toggleWrap: () => void }
    | { status: 'content-error'; error: unknown }
    | { status: 'empty' }
    | {
        status: 'ready'
        kind: FileKind
        text: string
        /**
         * 文件内容版本（= meta.etag，cli 侧为 `size-mtimeMs`）。
         * 供 src 直连类型（image / media / pdf）并入 URL——URL 不带版本时内容原地变化无从感知，
         * 详见 buildReadFileUrl 的说明。
         */
        etag: string
        view: 'render' | 'source'
        toggleView: () => void
        wrap: boolean
        toggleWrap: () => void
    }

/** ready 态（带 kind/text/view/toggleView）—— 供消费侧复用，避免重复 Extract */
export type ReadyRenderState = Extract<RenderState, { status: 'ready' }>

/** 按 kind + size 判是否超阈值（与原 FileContentView 一致） */
function isTooLarge(kind: FileKind, size: number): boolean {
    switch (kind.kind) {
        case 'text':
        case 'markdown':
        case 'html': return size >= FILE_SIZE_LIMITS.textPlain
        case 'image': return size >= FILE_SIZE_LIMITS.image
        case 'pdf': return size >= FILE_SIZE_LIMITS.pdf
        // media-native / media-download / binary：无 size 阈值
        default: return false
    }
}

/** 是否需要拉 content（文本类：text / markdown / html） */
function needsContent(kind: FileKind): boolean {
    return kind.kind === 'text' || kind.kind === 'markdown' || kind.kind === 'html'
}

/**
 * 文件渲染决策 hook：吃 meta/content query 状态，输出 RenderState 判别联合。
 * 封装「meta 先行 + size 阈值 + 是否拉 content + 文本 blob→text + markdown view」全部决策。
 * 所有 hooks 无条件调用（rules-of-hooks），决策在 return 阶段做。
 */
export function useFileRenderState(sessionId: string, filePath: string): RenderState {
    const { data: meta, isLoading: metaLoading, error: metaError } = useFileMeta(sessionId, filePath)

    const kind = meta ? resolveFileKind(meta, filePath) : null
    const tooLarge = !!(meta && kind && isTooLarge(kind, meta.size))
    const shouldFetchContent = !!(meta && kind && !tooLarge && needsContent(kind))

    const { data: file, isLoading: contentLoading, error: contentError } = useFileContent(
        sessionId, filePath, shouldFetchContent, meta?.etag,
    )

    // view 默认值：markdown=render（保持回归）；html=source（默认源码，用户可选切预览）
    // filePath 变化或 kind 变化时重置（如从 .md 切到 .html）
    const [view, setView] = useState<'render' | 'source'>('render')
    useEffect(() => {
        setView(kind?.kind === 'html' ? 'source' : 'render')
    }, [filePath, kind?.kind])
    const toggleView = useCallback(() => setView((v) => v === 'render' ? 'source' : 'render'), [])

    // 源码模式自动换行：默认关（与 VS Code/GitHub 一致，保代码结构），filePath 变化重置
    const [wrap, setWrap] = useState(false)
    useEffect(() => { setWrap(false) }, [filePath])
    const toggleWrap = useCallback(() => setWrap((w) => !w), [])

    // 文本类 blob → text 异步读取
    const isText = !!(file && kind && needsContent(kind))
    const [text, setText] = useState<string | null>(null)
    useEffect(() => {
        if (!(file && isText)) {
            setText(null)
            return
        }
        let cancelled = false
        file.blob.text()
            .then((v) => { if (!cancelled) setText(v) })
            .catch(() => { if (!cancelled) setText(null) })
        return () => { cancelled = true }
    }, [file, isText])

    // 决策阶段（return）—— 顺序与原 FileContentView 嵌套三元一致
    if (metaLoading) return { status: 'meta-loading' }
    if (metaError) return { status: 'meta-error', error: metaError }
    if (!meta || !kind) return { status: 'meta-loading' }
    if (tooLarge) return { status: 'too-large' }
    if (!needsContent(kind)) {
        // pdf / image / media：src 直连端点，不依赖 content；etag 并入 URL 以感知内容变化
        return { status: 'ready', kind, text: '', etag: meta.etag, view, toggleView, wrap, toggleWrap }
    }
    if (contentLoading) return { status: 'content-loading', kind, view, toggleView, wrap, toggleWrap }
    if (contentError) return { status: 'content-error', error: contentError }
    if (!file) return { status: 'empty' }
    // text===null 时短暂以空串渲染（与原 `text ?? ''` 一致），blob 解析完更新
    return { status: 'ready', kind, text: text ?? '', etag: meta.etag, view, toggleView, wrap, toggleWrap }
}
