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
import { Empty, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { buildReadFileUrl } from '@/core/utils/fileUrl'
import AudioPlayer from './AudioPlayer'

interface MediaContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（src query） */
    filePath: string
    /** 是否音频（true=audio 标签，false=video 标签） */
    isAudio: boolean
    /** 文件内容版本（meta.etag）：并入 src 感知内容变化，但播放中会延后（见下方 activeEtag） */
    etag: string
}

/**
 * 音视频内容视图（纯展示）：
 * - src 直连 read-file 端点（cookie 改造后 httpOnly mobi_token 自动带 → 认证通过）
 * - 浏览器原生 Range 流式（P0 端点 206 Partial，seek/缓冲原生）
 * - onError 兜底：原生 audio/video 请求不经 axios interceptor，401（cookie 过期）/损坏等无法触发全局 401 处理，
 *   这里捕获后渲染「加载失败，点击重试」，重试通过变更 src 上的 retry 计数强制重新请求。
 */
export default function MediaContentView({ sessionId, filePath, isAudio, etag }: MediaContentViewProps) {
    const { t } = useTranslation()
    const [error, setError] = useState(false)
    // 重试计数：拼到 src query 让浏览器视为新 URL，绕过缓存重新请求（触发 cookie 重新认证）
    const [retry, setRetry] = useState(0)
    /** 正在播放：播放中不换 src（换了会重新加载、进度归零） */
    const [playing, setPlaying] = useState(false)
    /**
     * 实际写入 src 的 etag。与 prop 的 etag 分离，是为了给「播放中」留一个缓冲：
     * 播放中文件被改写时先不动 src，等用户暂停/播完再切到新版本。
     */
    const [activeEtag, setActiveEtag] = useState(etag)
    useEffect(() => {
        if (!playing && etag !== activeEtag) setActiveEtag(etag)
    }, [playing, etag, activeEtag])

    const src = buildReadFileUrl(sessionId, filePath, { etag: activeEtag, retry })

    // 内容已变（换到新 etag）→ 上次的失败判定过期，清掉错误态让新内容有机会加载
    useEffect(() => { setError(false) }, [activeEtag])

    if (error) {
        return (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
                <Empty description={t('files.loadFailed')} />
                <Button
                    type="primary"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                        setError(false)
                        setRetry((r) => r + 1)
                    }}
                >
                    {t('files.retry')}
                </Button>
            </div>
        )
    }

    return (
        <div className="media-content-view">
            {isAudio
                ? (
                    <AudioPlayer
                        src={src}
                        filePath={filePath}
                        onError={() => setError(true)}
                        onPlayingChange={setPlaying}
                    />
                )
                : (
                    <video
                        src={src}
                        controls
                        onError={() => setError(true)}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                    />
                )}
        </div>
    )
}
