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

import { useMemo } from 'react'
import { Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import TextContentView from './TextContentView'
import { encodePathSegments } from '@/core/utils/path'

interface Props {
    sessionId: string
    filePath: string
    /** 'render'=预览(iframe), 'source'=源码(TextContentView) */
    view: 'render' | 'source'
    text: string
    wrap: boolean
}

export default function HtmlPreviewView({ sessionId, filePath, view, text, wrap }: Props) {
    if (view === 'source') {
        return <TextContentView text={text} filePath={filePath} highlight wrap={wrap} />
    }
    return <HtmlIframe sessionId={sessionId} filePath={filePath} />
}

/** 预览态：sandboxed iframe 指向 serve-file，相对路径基准交给浏览器原生解析 */
function HtmlIframe({ sessionId, filePath }: { sessionId: string; filePath: string }) {
    const { t } = useTranslation()

    // filePath 来自文件树，已是相对 session cwd 的 posix 路径（parseDirectoryEntries 以 '.' 为根），
    // 正是 serve-file 端点的 relPath——直接拼接，无需再算相对路径。
    // 越界（如 ../）由 hub 侧 isWithinDir 兜底拦截。
    const src = useMemo(() => {
        if (!filePath) return null
        return `/api/sessions/${sessionId}/serve-file/${encodePathSegments(filePath)}`
    }, [sessionId, filePath])

    if (!src) {
        return <Empty description={t('files.previewUnavailable')} style={{ marginTop: 40 }} />
    }

    return (
        <div className="html-preview-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--ant-color-border-secondary)' }}>
                {/* 下载而非新标签打开：serve-file 在 top-level 打开会脱离 sandbox（同源执行），
                    ?download=1 触发 attachment，避免恶意 HTML 在 mobi origin 下跑脚本 */}
                <a href={`${src}?download=1`} download>{t('files.download')}</a>
            </div>
            <iframe
                src={src}
                // 脚本可执行但 opaque origin 隔离：拿不到 mobi cookie/storage、调不了父窗口
                sandbox="allow-scripts allow-forms allow-popups"
                referrerPolicy="no-referrer"
                style={{ flex: 1, border: 'none', minHeight: 0 }}
                title="html-preview"
            />
        </div>
    )
}
