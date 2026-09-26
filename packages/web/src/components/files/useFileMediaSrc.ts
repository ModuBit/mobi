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

/**
 * read-file 媒体源闭锁（图/音视频共用的「认证失效 → 失败态 → 重试」机制单源，
 * 吸收自 MediaContentView 的 PlaybackLatch 与 ImageContentView 的 stamp——两份
 * 独立实现曾各自沉淀，修在一边的 bug 不会传播到另一边）。
 *
 * 威胁/失效模型：原生 <img>/<video>/<audio> 的 src 请求不经 axios interceptor，
 * 401（cookie 过期）/损坏等无法触发全局 401 处理——只能由元素 onError 捕获后渲染
 * 重试入口；重试靠 src 上的 retry 计数造新 URL 绕过缓存强制重新请求（触发 cookie
 * 重新认证）。重试与 etag 独立是有意的：401 时文件本身没变（etag 不变）。
 *
 * 状态整体语义（勿拆成独立 useState——拆开曾导致两类 bug：换文件时旧 etag 泄漏到
 * 新文件的第一帧 src；出错卸载元素后 playing 卡 true 让 etag 永久冻结）：
 * - 换文件（sessionId/filePath 变）→ latch 整体重建，播放/失败/重试都属上一个文件
 * - 同文件内容改写（etag 变）且此刻没在播 → 采纳新版本，失败判定与重试计数作废
 *   （否则一次失败把界面永久钉在「重试」）
 * - 播放中 etag 变 → 暂不换 src（换 src 会重新加载、进度归零），暂停/播完再补
 *   （图片永不上报播放，走「总是立即采纳」的同一代码路径，无需开关）
 */

import { useState } from 'react'
import { buildReadFileUrl } from '@/core/utils/fileUrl'

interface MediaLatch {
    /** 资源身份（resourceKey）：与之不符即换了文件，latch 整体作废 */
    key: string
    etag: string
    playing: boolean
    error: boolean
    /** 重试计数：拼到 src query 让浏览器视为新 URL，绕过缓存重新请求 */
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

function freshLatch(sessionId: string, filePath: string, etag: string): MediaLatch {
    return { key: resourceKey(sessionId, filePath), etag, playing: false, error: false, retry: 0 }
}

export interface FileMediaSrc {
    /** 直连 read-file 端点的 src（etag 作 v 版本 + retry 计数已并入） */
    src: string
    /** 上一次加载失败待重试 */
    failed: boolean
    /** 媒体元素 onError 直传（原生请求不经 axios，这里是唯一捕获点） */
    onError: () => void
    /** 播放态上报（音视频直传；图片不接，永久「未播放」即总是立即采纳新 etag） */
    reportPlaying: (playing: boolean) => void
    /** 用户点重试：清失败态 + 递增 retry 造新 URL */
    retry: () => void
}

export function useFileMediaSrc(sessionId: string, filePath: string, etag: string): FileMediaSrc {
    const [latch, setLatch] = useState<MediaLatch>(() => freshLatch(sessionId, filePath, etag))

    // 渲染期同步 latch（而非 effect）：effect 会先提交一帧旧 src、再改成新的，等于多发一次请求
    let active = latch
    const key = resourceKey(sessionId, filePath)
    if (latch.key !== key) {
        // 换文件：latch 整体重建。播放态、失败态、重试计数都属于上一个文件，一并归零
        active = freshLatch(sessionId, filePath, etag)
        setLatch(active)
    } else if (!latch.playing && latch.etag !== etag) {
        // 同一文件内容被改写且此刻没在播 → 立即采纳新版本
        active = { ...latch, etag, error: false, retry: 0 }
        setLatch(active)
    }

    return {
        src: buildReadFileUrl(sessionId, filePath, { etag: active.etag, retry: active.retry }),
        failed: active.error,
        onError: () => setLatch((l) => ({ ...l, error: true, playing: false })),
        reportPlaying: (playing) => setLatch((l) => ({ ...l, playing })),
        retry: () => setLatch((l) => ({ ...l, error: false, retry: l.retry + 1 })),
    }
}
