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

import { useState } from 'react'
import { Button, Image } from 'antd'
import { useTranslation } from 'react-i18next'
import { buildReadFileUrl } from '@/core/utils/fileUrl'

interface ImageContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（img alt + src query） */
    filePath: string
    /** 文件内容版本（meta.etag）：并入 src，让「路径不变但内容变了」也能刷出新图 */
    etag: string
}

// 加载失败兜底图：语言无关的「破损图片」SVG（灰色山+太阳占位）。
// 用 data URI 内联，无需额外网络请求；i18n 文案由 antd 的 fallback 视觉语义承载。
const FALLBACK_IMAGE = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180' viewBox='0 0 240 180'>
        <rect width='240' height='180' fill='#f5f5f5'/>
        <path d='M30 130 L90 70 L130 110 L170 60 L210 130 Z' fill='#d9d9d9'/>
        <circle cx='175' cy='55' r='14' fill='#bfbfbf'/>
    </svg>`,
)}`

/**
 * 图片文件内容视图（纯展示）：
 * - antd Image：preview 默认开启（点击放大）、placeholder 渐进式加载（大图/弱网友好）、fallback 加载失败兜底
 * - src 直连 read-file 端点（cookie 改造后 httpOnly mobi_token 自动带 → 认证通过；浏览器原生协商缓存）
 * - 尺寸约束见 styles/antd.css 的 .image-content-view：图片永远 contain 在容器内，不超出、不变形
 * - 加载失败（401 cookie 过期/损坏等）显示「重试」按钮：点击变更 src query 强制重新请求（触发 cookie 重新认证）
 */
export default function ImageContentView({ sessionId, filePath, etag }: ImageContentViewProps) {
    const { t } = useTranslation()
    /**
     * 加载失败态 + 重试计数，绑定到具体的「文件版本」。
     *
     * 两者都只对某一个文件的某一个版本有意义：
     * - 内容已变（etag 变）→ 上次的失败判定过期，清掉兜底图让新内容有机会加载。
     *   否则一次加载失败会把 tab 永久钉在「重试」界面，即便文件本身已经修好
     * - 同一 tab 内换文件（组件实例被复用，见 openFileInTab）→ 上一个文件的失败态
     *   与重试计数都不该跟过来
     * 合成一个 state 并在渲染期比对 stamp，是为了让「作废」这件事只有一条路径。
     */
    // NUL 分隔：POSIX 文件名可含空格等任意字符，唯独不含 NUL，拼不出歧义
    const stamp = `${sessionId}\u0000${filePath}\u0000${etag}`
    const [state, setState] = useState({ stamp, failed: false, retry: 0 })
    // 渲染期同步（而非 effect）：effect 会多提交一帧带旧 retry 的 src
    let active = state
    if (state.stamp !== stamp) {
        active = { stamp, failed: false, retry: 0 }
        setState(active)
    }
    const src = buildReadFileUrl(sessionId, filePath, { etag, retry: active.retry })

    if (active.failed) {
        return (
            <div className="image-content-view image-content-view--error">
                <img src={FALLBACK_IMAGE} alt={filePath} className="image-content-view__fallback" />
                <Button
                    size="small"
                    onClick={() => setState((s) => ({ ...s, failed: false, retry: s.retry + 1 }))}
                >
                    {t('files.retry')}
                </Button>
            </div>
        )
    }

    return (
        <div className="image-content-view">
            <Image
                src={src}
                alt={filePath}
                placeholder
                preview
                fallback={FALLBACK_IMAGE}
                onError={() => setState((s) => ({ ...s, failed: true }))}
            />
        </div>
    )
}
