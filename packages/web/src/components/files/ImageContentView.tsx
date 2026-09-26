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

import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { FALLBACK_IMAGE } from '@/core/utils/fallbackImage'
import { AppImage } from '@/components/ui/AppImage'
import { useFileMediaSrc } from './useFileMediaSrc'

interface ImageContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（img alt + src query） */
    filePath: string
    /** 文件内容版本（meta.etag）：并入 src，让「路径不变但内容变了」也能刷出新图 */
    etag: string
}

// 加载失败兜底图见 core/utils/fallbackImage.ts（单源，文件预览与消息气泡共用）

/**
 * 图片文件内容视图（纯展示）：
 * - antd Image：preview 默认开启（点击放大）、placeholder 渐进式加载（大图/弱网友好）、fallback 加载失败兜底
 * - src 直连 read-file 端点（cookie 改造后 httpOnly mobi_token 自动带 → 认证通过；浏览器原生协商缓存）
 * - 尺寸约束见 styles/antd.css 的 .image-content-view：图片永远 contain 在容器内，不超出、不变形
 * - 失败/重试闭锁单源在 useFileMediaSrc（401 cookie 过期等不经 axios 的失败唯一捕获点是元素
 *   onError），本组件只负责 chrome：失败态 = 兜底图 + 「重试」primary（与 MediaContentView 同规）
 */
export default function ImageContentView({ sessionId, filePath, etag }: ImageContentViewProps) {
    const { t } = useTranslation()
    const { src, failed, onError, retry } = useFileMediaSrc(sessionId, filePath, etag)

    if (failed) {
        return (
            <div className="image-content-view image-content-view--error">
                <img src={FALLBACK_IMAGE} alt={filePath} className="image-content-view__fallback" />
                <Button size="small" type="primary" onClick={retry}>
                    {t('files.retry')}
                </Button>
            </div>
        )
    }

    return (
        <div className="image-content-view">
            <AppImage
                src={src}
                alt={filePath}
                placeholder
                fallback={FALLBACK_IMAGE}
                onError={onError}
            />
        </div>
    )
}
