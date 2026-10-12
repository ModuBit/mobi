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

import { Empty, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import AudioPlayer from './AudioPlayer'
import { useFileMediaSrc } from './useFileMediaSrc'

interface MediaContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（src query） */
    filePath: string
    /** 是否音频（true=audio 标签，false=video 标签） */
    isAudio: boolean
    /** 文件内容版本（meta.etag）：并入 src 感知内容变化，但播放中会延后（见 useFileMediaSrc） */
    etag: string
}

/**
 * 音视频内容视图（纯展示）：
 * - src 直连 read-file 端点（cookie 改造后 httpOnly mobi_token 自动带 → 认证通过）
 * - 浏览器原生 Range 流式（P0 端点 206 Partial，seek/缓冲原生）
 * - 失败/重试/播放锁闭锁单源在 useFileMediaSrc（401 cookie 过期等不经 axios 的失败唯一捕获点
 *   是元素 onError），本组件只负责 chrome：AudioPlayer / video 与失败兜底界面
 */
export default function MediaContentView({ sessionId, filePath, isAudio, etag }: MediaContentViewProps) {
    const { t } = useTranslation()
    const { src, failed, onError, reportPlaying, retry } = useFileMediaSrc(sessionId, filePath, etag)

    if (failed) {
        return (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
                <Empty description={t('files.loadFailed')} />
                <Button type="primary" style={{ marginTop: 12 }} onClick={retry}>
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
                        onError={onError}
                        onPlayingChange={reportPlaying}
                    />
                )
                : (
                    <video
                        src={src}
                        controls
                        onError={onError}
                        onPlay={() => reportPlaying(true)}
                        onPause={() => reportPlaying(false)}
                        onEnded={() => reportPlaying(false)}
                    />
                )}
        </div>
    )
}
