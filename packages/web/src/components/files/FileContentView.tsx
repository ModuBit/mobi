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

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Spin, Empty, Button, App, Popover, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'
import { Folders, Ellipsis, Copy } from 'lucide-react'
import type { MenuProps } from 'antd'
import { useFileContent, useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { FILE_SIZE_LIMITS } from '@/core/config/fileLimits'
import FileTreeView from '@/components/files/FileTreeView'
import CodeHighlight from '@/components/files/CodeHighlight'
import FileTooLarge from '@/components/files/FileTooLarge'

interface FileContentViewProps {
    sessionId: string
    /** 当前 tab id：Folders 选文件后调 openFileInTab 用 */
    tabId: string
    filePath: string
}

export default function FileContentView({ sessionId, tabId, filePath }: FileContentViewProps) {
    const { t } = useTranslation()
    const { message } = App.useApp()

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

    // size 阈值判断（meta 先行，下载前拦截，省流量/解码）
    const tooLarge = !!meta && (
        (isTextLike && meta.size >= FILE_SIZE_LIMITS.textPlain)
        || (isImage && meta.size >= FILE_SIZE_LIMITS.image)
        || (isPdf && meta.size >= FILE_SIZE_LIMITS.pdf)
    )
    // 文本高亮判断（< 1MB 才走 Shiki，避免 DOM 瓶颈）
    const useHighlight = !!meta && isTextLike && meta.size < FILE_SIZE_LIMITS.textHighlight

    // 只在「size 内 + 可渲染类型（文本/图片）」才取 content，其余（大文件/PDF/音视频/二进制）不拉
    const shouldFetchContent = !!meta && !tooLarge && !isPdf && !isAudioVideo && (isTextLike || isImage)
    const { data: file, isLoading: contentLoading, error: contentError } = useFileContent(
        sessionId, filePath, shouldFetchContent,
    )

    const openFileInTab = useWorkspaceStore((s) => s.openFileInTab)
    const [treeOpen, setTreeOpen] = useState(false)

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

    // 图片类：blob → objectURL，unmount/换文件时 revoke 防泄漏
    const isImg = !!file && isImage
    const [imgUrl, setImgUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!(file && isImg)) {
            setImgUrl(null)
            return
        }
        const url = URL.createObjectURL(file.blob)
        setImgUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [file, isImg])

    // 面包屑分段：a/b/c.ts → [a, b, c.ts]，最后一项（文件名）加粗
    const segments = filePath.split('/').filter(Boolean)
    const lastIndex = segments.length - 1

    // 左对齐 + 空间不够时左侧省略（保留文件名）：CSS 的 text-overflow 只能在右端省略，
    // 这里用 JS 测容器宽度——溢出则从左逐段砍、前缀 …；容器变宽时重置重新计算。
    const crumbRef = useRef<HTMLDivElement>(null)
    const [cutStart, setCutStart] = useState(0)
    const [crumbWidth, setCrumbWidth] = useState(0)

    // 监听面包屑容器宽度（inspector 分栏拖动 / 窗口缩放）
    useLayoutEffect(() => {
        const el = crumbRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            setCrumbWidth(entries[0].contentRect.width)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // 宽度或路径变化 → 重置为完整显示，再按需砍
    useLayoutEffect(() => {
        setCutStart(0)
    }, [crumbWidth, filePath])

    // 仍溢出 → 从左再砍一段（至少保留文件名），下一帧重测直至 fits
    useLayoutEffect(() => {
        const el = crumbRef.current
        if (!el || lastIndex < 0) return
        if (el.scrollWidth > el.clientWidth + 1 && cutStart < lastIndex) {
            setCutStart((s) => s + 1)
        }
    }, [cutStart, crumbWidth, lastIndex])

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
        { key: 'copyPath', icon: <Copy size={14} />, label: t('files.copyPath'), onClick: copyPath },
    ]

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* header：左面包屑（左对齐，空间不够左省略）+ 右功能区 */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', flexShrink: 0,
                borderBottom: '1px solid var(--ant-color-border-secondary)',
            }}>
                <div ref={crumbRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {cutStart > 0 && <span style={{ opacity: 0.45 }}>…{segments[cutStart] !== undefined ? ' /' : ''} </span>}
                    {segments.slice(cutStart).map((seg, i) => {
                        const realIdx = cutStart + i
                        return (
                            <Fragment key={realIdx}>
                                {i > 0 && <span style={{ margin: '0 2px', opacity: 0.45 }}>/</span>}
                                <span style={{ fontWeight: realIdx === lastIndex ? 600 : 400 }}>{seg}</span>
                            </Fragment>
                        )
                    })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <Dropdown menu={{ items: moreMenuItems }} trigger={['click']}>
                        <Button type="text" size="small" icon={<Ellipsis size={14} />} aria-label={t('files.more')} />
                    </Dropdown>
                    <Popover
                        open={treeOpen}
                        onOpenChange={setTreeOpen}
                        trigger="click"
                        placement="bottomLeft"
                        content={
                            <div style={{ width: 300, height: 400, overflow: 'auto' }}>
                                <FileTreeView
                                    sessionId={sessionId}
                                    onOpenFile={(fp, fn) => {
                                        // store 去重：当前文件不响应 / 别的 tab 已开则激活 / 否则当前 tab 转该文件
                                        openFileInTab(sessionId, tabId, fp, fn)
                                        setTreeOpen(false)
                                    }}
                                />
                            </div>
                        }
                    >
                        <Button type="text" size="small" icon={<Folders size={14} />} aria-label={t('files.openFromTree')} />
                    </Popover>
                </div>
            </div>
            {/* content：meta 先行 → size 阈值拦截 → 按类型三级分发 */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {metaLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : metaError ? (
                    <Empty description={metaError instanceof Error ? metaError.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : tooLarge ? (
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.tooLarge')} />
                ) : isPdf ? (
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.pdfDownload')} />
                ) : isAudioVideo ? (
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.mediaDownload')} />
                ) : !(isTextLike || isImage) ? (
                    // meta 就绪但不属于可直显类型（文本/图片）→ 二进制，提示下载（不依赖 content）
                    <FileTooLarge sessionId={sessionId} filePath={filePath} reason={t('files.binaryDownload')} />
                ) : contentLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : contentError ? (
                    <Empty description={contentError instanceof Error ? contentError.message : t('files.loadFailed')} style={{ marginTop: 40 }} />
                ) : file ? (
                    isImage ? (
                        <div style={{ textAlign: 'center', padding: 12, overflow: 'auto' }}>
                            {imgUrl && <img src={imgUrl} alt={filePath} style={{ maxWidth: '100%' }} />}
                        </div>
                    ) : (
                        useHighlight
                            ? <CodeHighlight code={text ?? ''} filePath={filePath} />
                            : (
                                <pre style={{
                                    fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                    fontFamily: 'var(--font-mono)', padding: 12,
                                }}>
                                    {text ?? ''}
                                </pre>
                            )
                    )
                ) : (
                    <Empty description={t('files.selectToView')} style={{ marginTop: 40 }} />
                )}
            </div>
        </div>
    )
}
