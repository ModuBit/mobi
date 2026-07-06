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

import { Image } from 'antd'

interface ImageContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（img alt + src query） */
    filePath: string
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
 * - 原生 img 不经 axios interceptor，401（cookie 过期）/损坏等由 fallback 兜底；恢复走 header 的 refresh（重挂载触发重新认证）
 */
export default function ImageContentView({ sessionId, filePath }: ImageContentViewProps) {
    const src = `/api/sessions/${sessionId}/read-file?path=${encodeURIComponent(filePath)}`
    return (
        <div className="image-content-view">
            <Image
                src={src}
                alt={filePath}
                placeholder
                preview
                fallback={FALLBACK_IMAGE}
            />
        </div>
    )
}
