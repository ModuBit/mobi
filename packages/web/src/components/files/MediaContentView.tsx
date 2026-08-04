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
 * 播放期状态闭锁（latch）。
 *
 * 这四个字段必须作为一个整体存在，因为它们描述的是「当前这个文件此刻的播放会话」：
 * - etag：实际写入 src 的版本。与 prop 的 etag 分离，好给「播放中」留缓冲——
 *   播放中文件被改写时先不动 src（换 src 会重新加载、进度归零），等暂停/播完再切
 * - playing / error / retry：都只对当前会话有意义
 *
 * 拆成四个独立 useState 曾导致两类 bug：换文件时旧 etag 泄漏到新文件的第一帧 src，
 * 以及出错卸载元素后 playing 卡在 true 让 etag 永久冻结。绑上 key 一起重建可从
 * 结构上排除这两类，代价是这里多一个类型。
 */
interface PlaybackLatch {
    /** 资源身份（见 resourceKey）：与之不符即说明换了文件，latch 整体作废 */
    key: string
    etag: string
    playing: boolean
    error: boolean
    /** 重试计数：拼到 src query 让浏览器视为新 URL，绕过缓存重新请求（触发 cookie 重新认证） */
    retry: number
}

/**
 * 资源身份：同一 tab 内换文件时 sessionId/filePath 会变，但组件实例被复用（tab.id 不变），
 * 故不能靠 mount 区分「换了文件」，只能比对这个 key。
 * 用 NUL 分隔：POSIX 文件名可以含换行、空格等任意字符，唯独不可能含 NUL，
 * 拼不出歧义的 key。
 */
function resourceKey(sessionId: string, filePath: string): string {
    return `${sessionId}\u0000${filePath}`
}

function freshLatch(sessionId: string, filePath: string, etag: string): PlaybackLatch {
    return { key: resourceKey(sessionId, filePath), etag, playing: false, error: false, retry: 0 }
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
    const [latch, setLatch] = useState<PlaybackLatch>(() => freshLatch(sessionId, filePath, etag))

    // 渲染期同步 latch（而非 effect）：effect 会先提交一帧旧 src、再改成新的，等于多发一次请求。
    let active = latch
    const key = resourceKey(sessionId, filePath)
    if (latch.key !== key) {
        // 换文件：latch 整体重建。播放态、失败态、重试计数都属于上一个文件，一并归零
        active = freshLatch(sessionId, filePath, etag)
        setLatch(active)
    } else if (!latch.playing && latch.etag !== etag) {
        // 同一文件内容被改写且此刻没在播 → 立即采纳新版本。
        // 失败判定与重试计数都是针对旧内容的，随之作废（否则一次失败会把 tab 永久钉在「重试」界面）
        active = { ...latch, etag, error: false, retry: 0 }
        setLatch(active)
    }

    const src = buildReadFileUrl(sessionId, filePath, { etag: active.etag, retry: active.retry })

    /**
     * 播放态上报。播放中不换 src，故这是「延后新 etag」的开关。
     *
     * 注意：媒体元素被卸载时浏览器不会补发 pause 事件，所以任何卸载它的分支
     * （目前只有下方 error 态）都必须显式复位 playing —— 否则 latch 永久冻结在
     * 出错那一刻的 etag，后续所有内容变化（含用户手点「刷新」）全部丢弃。
     */
    const reportPlaying = (v: boolean) => setLatch((l) => ({ ...l, playing: v }))
    const handleError = () => setLatch((l) => ({ ...l, error: true, playing: false }))

    if (active.error) {
        return (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
                <Empty description={t('files.loadFailed')} />
                <Button
                    type="primary"
                    style={{ marginTop: 12 }}
                    onClick={() => setLatch((l) => ({ ...l, error: false, retry: l.retry + 1 }))}
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
                        onError={handleError}
                        onPlayingChange={reportPlaying}
                    />
                )
                : (
                    <video
                        src={src}
                        controls
                        onError={handleError}
                        onPlay={() => reportPlaying(true)}
                        onPause={() => reportPlaying(false)}
                        onEnded={() => reportPlaying(false)}
                    />
                )}
        </div>
    )
}
