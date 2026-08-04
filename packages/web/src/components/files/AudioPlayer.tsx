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

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button, Slider, Popover } from 'antd'
import { Play, Pause, Music, Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { basename } from '@/core/utils/path'
import { formatPlayTime } from '@/core/utils/timeFormat'

interface AudioPlayerProps {
    /** 音频源 URL（read-file 端点，cookie 带） */
    src: string
    /** 文件路径（取 basename 显示） */
    filePath: string
    /** 加载失败回调（401/404/损坏等；原生 audio 请求不经 axios interceptor，需组件层兜底） */
    onError?: () => void
    /** 播放态变化回调：调用方据此决定是否可以换 src（播放中换会重新加载、进度归零） */
    onPlayingChange?: (playing: boolean) => void
}

/**
 * 音频播放器：bg-container 与 layout 区分，顶部满宽进度条作上边框。
 * - 顶部：进度条（贴上边缘）+ hover 时间预览
 * - 内容行：左（图标 + 文件名 + 时间）/ 中（播放/暂停）/ 右（音量）
 */
export default function AudioPlayer({ src, filePath, onError, onPlayingChange }: AudioPlayerProps) {
    const { t } = useTranslation()
    const audioRef = useRef<HTMLAudioElement>(null)
    const sliderWrapRef = useRef<HTMLDivElement>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [muted, setMuted] = useState(false)
    // hover 进度条时预览的时间 + 浮层 x 偏移（相对 slider wrap）
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null)

    // 把 onError 存进 ref，让事件监听 effect 只挂载一次（避免回调每次渲染变更导致反复 add/remove）
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError
    // onPlayingChange 同理走 ref，保持事件监听 effect 的空依赖
    const onPlayingChangeRef = useRef(onPlayingChange)
    onPlayingChangeRef.current = onPlayingChange

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return
        const onTime = () => setCurrent(audio.currentTime)
        // duration 可能是 Infinity（流式/无内嵌时长），Number.isFinite 兜底为 0
        const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
        // 播放态同时上报给调用方（MediaContentView 据此决定是否延后换 src）
        const setPlayState = (v: boolean) => {
            setIsPlaying(v)
            onPlayingChangeRef.current?.(v)
        }
        const onEnd = () => setPlayState(false)
        const onPlay = () => setPlayState(true)
        const onPause = () => setPlayState(false)
        const onErr = () => onErrorRef.current?.()
        audio.addEventListener('timeupdate', onTime)
        audio.addEventListener('loadedmetadata', onMeta)
        audio.addEventListener('durationchange', onMeta)
        audio.addEventListener('ended', onEnd)
        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('error', onErr)
        return () => {
            audio.removeEventListener('timeupdate', onTime)
            audio.removeEventListener('loadedmetadata', onMeta)
            audio.removeEventListener('durationchange', onMeta)
            audio.removeEventListener('ended', onEnd)
            audio.removeEventListener('play', onPlay)
            audio.removeEventListener('pause', onPause)
            audio.removeEventListener('error', onErr)
        }
    }, [])

    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume }, [volume])
    useEffect(() => { if (audioRef.current) audioRef.current.muted = muted }, [muted])

    const toggle = () => {
        const audio = audioRef.current
        if (!audio) return
        if (audio.paused) {
            // play() 可能 reject（自动播放策略 / 401 / 解码错误），catch 兜底避免 unhandledrejection
            audio.play().catch(() => { /* 加载/权限失败由 error 事件或 UI 静默处理 */ })
        } else {
            audio.pause()
        }
    }

    const seek = (v: number) => {
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = v
        setCurrent(v)
    }

    const onSliderMove = (e: MouseEvent) => {
        const wrap = sliderWrapRef.current
        if (!wrap || !duration) return
        const rect = wrap.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        setHover({ x: e.clientX - rect.left, t: ratio * duration })
    }

    const fileName = basename(filePath)

    return (
        <div className="audio-block">
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                // error 由 effect 内 addEventListener 统一处理（onErrorRef 模式，避免回调变更反复挂卸）
                style={{ display: 'none' }}
            />

            {/* 顶部满宽进度条（贴上边缘，作 audio-block 的上边框） */}
            <div
                ref={sliderWrapRef}
                className="audio-block-progress mobi-audio-slider"
                onMouseMove={onSliderMove}
                onMouseLeave={() => setHover(null)}
            >
                {hover && (
                    <div className="audio-hover-tip" style={{ left: hover.x }}>
                        {formatPlayTime(hover.t)}
                    </div>
                )}
                <Slider
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={current}
                    onChange={seek}
                    tooltip={{ open: false }}
                />
            </div>

            {/* 内容行：左 文件名+时间 / 中 播放 / 右 音量 */}
            <div className="audio-block-row">
                <div className="audio-block-info">
                    <Music size={15} />
                    <span className="audio-block-name" title={filePath}>{fileName}</span>
                    <span className="audio-block-time">{formatPlayTime(current)} / {formatPlayTime(duration)}</span>
                </div>
                <Button
                    shape="circle"
                    type="primary"
                    icon={isPlaying ? <Pause size={15} /> : <Play size={15} />}
                    onClick={toggle}
                    aria-label={isPlaying ? 'pause' : 'play'}
                />
                <Popover
                    trigger={['hover']}
                    placement="bottom"
                    overlayClassName="audio-vol-popover"
                    content={
                        <div className="audio-vol-pop mobi-audio-slider">
                            <Slider
                                min={0}
                                max={1}
                                step={0.01}
                                value={muted ? 0 : volume}
                                onChange={(v) => { setVolume(v); setMuted(v === 0) }}
                                tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }}
                                style={{ width: 100 }}
                            />
                            <span className="audio-vol-pct">{Math.round((muted ? 0 : volume) * 100)}</span>
                        </div>
                    }
                >
                    <Button
                        size="small"
                        type="text"
                        icon={muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                        onClick={() => setMuted((m) => !m)}
                        aria-label={t('files.mute')}
                    />
                </Popover>
            </div>
        </div>
    )
}
