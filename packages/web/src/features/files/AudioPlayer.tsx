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

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Slider, Popover } from 'antd'
import { motion, useMotionValue, useReducedMotion, useTransform, animate, type Transition } from 'motion/react'
import { Music, Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { basename } from '@/core/utils/path'
import { formatPlayTime } from '@/core/utils/timeFormat'

interface AudioPlayerProps {
    /** 音频源 URL（read-file 端点，cookie 带） */
    src: string
    /** 文件路径（取 basename 显示 + 作波形 seed） */
    filePath: string
    /** 加载失败回调（401/404/损坏等；原生 audio 请求不经 axios interceptor，需组件层兜底） */
    onError?: () => void
    /** 播放态变化回调：调用方据此决定是否可以换 src（播放中换会重新加载、进度归零） */
    onPlayingChange?: (playing: boolean) => void
}

const GLOW: Transition = { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
const ICON: Transition = { type: 'spring', duration: 0.34, bounce: 0.2 }
const INSTANT: Transition = { duration: 0 }

// 流光强度（播放时）与流速参数——照搬 rareui voice-note 的调校值
const PLAYING_GLOW = 0.62
const PULSE_SPEED = 0.6
const SPIN_UP = 0.45
const BLUR_RATIO = 0.32
const MIDDLE_MASK = 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.3) 46%, rgba(0,0,0,0.3) 54%, #000 100%)'
// 每个光斑沿 pill 轮廓绕行，lap 拉开彼此间距；clock 从中段起避免开局对齐
const BLOBS = [
    { size: 2, alpha: 0.5, lap: 11, offset: 0.04, pulse: 0.12 },
    { size: 1.5, alpha: 0.4, lap: 17, offset: 0.19, pulse: 0.14 },
    { size: 2.3, alpha: 0.45, lap: 23, offset: 0.47, pulse: 0.1 },
    { size: 1.2, alpha: 0.35, lap: 13, offset: 0.71, pulse: 0.16 },
] as const
const START_AT = 6.2

/** 沿胶囊轮廓行走（上边 → 右帽 → 下边 → 左帽），返回 [x, y] */
function pointOnPill(distance: number, width: number, height: number): [number, number] {
    const radius = height / 2
    const straight = Math.max(0, width - height)
    const arc = Math.PI * radius
    const perimeter = 2 * straight + 2 * arc

    let d = distance % perimeter
    if (d < 0) d += perimeter

    if (d < straight) return [radius + d, 0]
    d -= straight
    if (d < arc) {
        const a = -Math.PI / 2 + d / radius
        return [width - radius + radius * Math.cos(a), radius + radius * Math.sin(a)]
    }
    d -= arc
    if (d < straight) return [width - radius - d, height]
    d -= straight
    const a = Math.PI / 2 + d / radius
    return [radius + radius * Math.cos(a), radius + radius * Math.sin(a)]
}

// 三角/双竖条各拆成两个四边形，morph 时逐点插值（两端点数一致）
const PLAY_SHAPE = [7.7, 5.8, 13, 8.9, 13, 15.1, 7.7, 18.2, 13, 8.9, 18.3, 12, 18.3, 12, 13, 15.1]
const PAUSE_SHAPE = [8.2, 6.8, 10.9, 6.8, 10.9, 17.2, 8.2, 17.2, 13.1, 6.8, 15.8, 6.8, 15.8, 17.2, 13.1, 17.2]

const toPath = (shape: number[]) => {
    let d = ''
    for (let quad = 0; quad < shape.length; quad += 8) {
        d += `M${shape[quad]} ${shape[quad + 1]}`
        for (let point = 2; point < 8; point += 2) {
            d += ` L${shape[quad + point]} ${shape[quad + point + 1]}`
        }
        d += ' Z'
    }
    return d
}
const morph = (from: number[], to: number[], t: number) => toPath(from.map((v, i) => v + (to[i] - v) * t))
const PLAY_PATH = toPath(PLAY_SHAPE)
const PAUSE_PATH = toPath(PAUSE_SHAPE)

const ICON_PAINT = {
    fill: 'currentColor',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
}

const SPEEDS = [1, 1.5, 2]
const SEEK_STEP = 5
const MIN_AMPLITUDE = 0.14
const PEAK_RATIO = 0.68
const BARS = 40
const PILL_HEIGHT = 52
const ICON_SIZE = 28

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

/** 文件路径 hash → 波形 seed：同一文件每次渲染波形一致（伪随机但稳定） */
const hashSeed = (path: string) => {
    let h = 2166136261
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

/**
 * 伪随机振幅序列：sin 包络 × 噪声 × 缓动起伏，取整以稳定渲染（照搬 rareui，含注释原因：
 * sin/** 跨引擎不位相同，取整可避免视觉抖动）
 */
const buildWaveform = (count: number, seed: number) => {
    let state = (seed >>> 0) + 0x9e3779b9
    return Array.from({ length: count }, (_, i) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const noise = state / 0x100000000
        const envelope = Math.sin((Math.PI * (i + 0.5)) / count) ** 0.55
        const swell = 0.5 + 0.5 * Math.sin(i * 0.9 + seed)
        const amplitude = envelope * (0.3 + 0.5 * noise + 0.2 * swell)
        return Math.round(clamp(amplitude, MIN_AMPLITUDE, 1) * 1000) / 1000
    })
}

/**
 * 音频播放器（voice-note 风格胶囊）：
 * - 波形 seek 条（伪随机振幅、已播 clip 揭示、pointer 拖拽 + 键盘）
 * - 播放/暂停 SVG path morph 动画；播放时 accent 流光沿胶囊边缘流动（reduced-motion 降级）
 * - 时间标签点击循环倍速（1×/1.5×/2×）；音量走 antd Popover（保留原有交互）
 * - 文件名在胶囊上方 caption 行（与 rareui 的差异点：mobi 需要可见文件名与音量控制）
 * - 播放锁与 src 换血契约不变：onPlayingChange 上报 + onError 唯一捕获点（useFileMediaSrc）
 */
export default function AudioPlayer({ src, filePath, onError, onPlayingChange }: AudioPlayerProps) {
    const { t } = useTranslation()
    const audioRef = useRef<HTMLAudioElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const scrubbing = useRef(false)

    const [metaDuration, setMetaDuration] = useState<number | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [volume, setVolume] = useState(1)
    const [muted, setMuted] = useState(false)
    const [speed, setSpeed] = useState(SPEEDS[0])

    const reduced = useReducedMotion() ?? false

    // 波形：seed 取文件路径 hash，同一文件波形稳定不跳变
    const amplitudes = useMemo(() => buildWaveform(BARS, hashSeed(filePath)), [filePath])

    // 进度用 motion value 驱动 clip（rAF 循环写，不触发 React 重渲；时间标签整数秒才 set）
    const progress = useMotionValue(0)
    const clipPath = useTransform(progress, (p) => `inset(0 ${(1 - p) * 100}% 0 0)`)

    // 回调走 ref：事件监听 effect 只挂载一次，不受调用方回调身份变化影响
    const callbacks = useRef({ onError, onPlayingChange })
    callbacks.current = { onError, onPlayingChange }

    // duration 可能是 Infinity（流式/无内嵌时长），Number.isFinite 兜底为 0
    const duration = metaDuration ?? 0
    // meta 未就绪前波形/按钮不可信（rareui 的 loading 门）
    const loading = !!src && metaDuration === null
    const total = duration

    const commitPlaying = useCallback((next: boolean) => {
        setIsPlaying(next)
        callbacks.current.onPlayingChange?.(next)
    }, [])

    const seekTo = useCallback((ratio: number) => {
        const next = clamp(ratio)
        if (total <= 0) return
        progress.set(next)
        setElapsed(Math.floor(next * total))
        const audio = audioRef.current
        if (audio) audio.currentTime = next * total
    }, [progress, total])

    const reset = useCallback(() => {
        // rAF 循环与 audio ended 事件可能同时报告结束，progress 已归零就不再重置
        if (progress.get() === 0) return
        progress.set(0)
        setElapsed(0)
        const audio = audioRef.current
        if (audio) audio.currentTime = 0
        commitPlaying(false)
    }, [progress, commitPlaying])

    // 播放主循环：rAF 跟踪 audio.currentTime 写进度（speed 只影响 audio 本体 playbackRate）
    useEffect(() => {
        const audio = audioRef.current
        if (audio) audio.playbackRate = speed
    }, [speed])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return
        if (isPlaying) {
            // play() 在部分 mock/jsdom 实现返回 undefined，可选链兜底
            audio.play()?.catch(() => commitPlaying(false))
        } else {
            audio.pause()
        }
    }, [isPlaying, commitPlaying])

    useEffect(() => {
        if (!isPlaying) return
        let frame = 0
        const tick = () => {
            const seconds = audioRef.current?.currentTime ?? 0
            const ratio = total > 0 ? clamp(seconds / total) : 0
            progress.set(ratio)
            setElapsed(Math.floor(seconds))
            if (total > 0 && seconds >= total - 0.05) {
                // audio ended 事件会触发 reset，这里只兜底不重复 commit
                return
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [isPlaying, total, progress])

    // 音量/静音直接写 audio 本体
    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume }, [volume])
    useEffect(() => { if (audioRef.current) audioRef.current.muted = muted }, [muted])

    const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = trackRef.current?.getBoundingClientRect()
        if (rect?.width) seekTo((event.clientX - rect.left) / rect.width)
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (loading || total <= 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        scrubbing.current = true
        scrub(event)
    }

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (loading || total <= 0) return
        const at = progress.get() * total
        const to = {
            ArrowLeft: at - SEEK_STEP,
            ArrowRight: at + SEEK_STEP,
            Home: 0,
            End: total,
        }[event.key]
        if (to === undefined) return
        event.preventDefault()
        seekTo(to / total)
    }

    const toggle = () => commitPlaying(!isPlaying)

    const cycleSpeed = () => {
        setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])
    }

    const fileName = basename(filePath)
    const remaining = Math.max(0, total - elapsed)

    return (
        <div className="voice-note-wrap">
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                style={{ display: 'none' }}
                onLoadedMetadata={(e) => {
                    const v = e.currentTarget.duration
                    // Infinity（流式/无内嵌时长）兜底 0
                    setMetaDuration(Number.isFinite(v) ? v : 0)
                }}
                onError={() => callbacks.current.onError?.()}
                // 文件可能在自身 duration 前一瞬停止，rAF 循环未必走到终点，ended 兜底归零
                onEnded={reset}
                onPause={() => commitPlaying(false)}
                onPlay={() => commitPlaying(true)}
            />

            {/* caption 行：文件名（mobi 特有，rareui 无） */}
            <div className="voice-note-caption">
                <Music size={14} />
                <span className="voice-note-name" title={filePath}>{fileName}</span>
            </div>

            <div className="voice-note" data-playing={isPlaying || undefined}>
                {/* accent 可经 --voice-note-accent 覆盖；默认蓝与运行状态色同源 */}
                <Aurora accent="var(--voice-note-accent, #4dabf7)" playing={isPlaying} reduced={reduced} />

                <button
                    type="button"
                    className="voice-note-control"
                    onClick={toggle}
                    disabled={loading}
                    aria-label={isPlaying ? 'pause' : 'play'}
                    aria-disabled={loading || undefined}
                >
                    <TransportIcon playing={isPlaying} size={ICON_SIZE} reduced={reduced} />
                </button>

                <div
                    ref={trackRef}
                    className="voice-note-track"
                    role="slider"
                    tabIndex={0}
                    aria-label="Seek"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(total)}
                    aria-valuenow={elapsed}
                    aria-valuetext={`${formatPlayTime(elapsed)} / ${formatPlayTime(total)}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={(e) => scrubbing.current && scrub(e)}
                    onPointerUp={() => { scrubbing.current = false }}
                    onPointerCancel={() => { scrubbing.current = false }}
                    onKeyDown={handleKeyDown}
                >
                    <Bars amplitudes={amplitudes} className="voice-note-bars-bg" />
                    <motion.div aria-hidden className="voice-note-bars-clip" style={{ clipPath }}>
                        <Bars amplitudes={amplitudes} className="voice-note-bars-fg" />
                    </motion.div>
                </div>

                <button
                    type="button"
                    className="voice-note-time"
                    onClick={cycleSpeed}
                    aria-label={`Playback speed, ${speed} times. Press to change`}
                >
                    {formatPlayTime(remaining)}
                    {speed !== 1 && <span className="voice-note-speed">{speed}×</span>}
                </button>

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
                    <button
                        type="button"
                        className="voice-note-vol"
                        onClick={() => setMuted((m) => !m)}
                        aria-label={t('files.mute')}
                    >
                        {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                </Popover>
            </div>
        </div>
    )
}

/** 播放/暂停图标：SVG path 在两个形态间 morph（reduced-motion 直接落位） */
function TransportIcon({ playing, size, reduced }: { playing: boolean; size: number; reduced: boolean }) {
    const shape = useMotionValue(playing ? PAUSE_PATH : PLAY_PATH)
    const previous = useRef(playing)

    useEffect(() => {
        if (previous.current === playing) return
        previous.current = playing
        shape.set(playing ? PAUSE_PATH : PLAY_PATH)
        if (reduced) return

        const from = playing ? PLAY_SHAPE : PAUSE_SHAPE
        const to = playing ? PAUSE_SHAPE : PLAY_SHAPE
        const controls = animate(0, 1, {
            ...ICON,
            onUpdate: (t) => shape.set(morph(from, to, clamp(t))),
            // spring 可能过冲，结束落在精确 path 上
            onComplete: () => shape.set(playing ? PAUSE_PATH : PLAY_PATH),
        })
        return () => controls.stop()
    }, [playing, reduced, shape])

    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
            <motion.path d={shape} {...ICON_PAINT} />
        </svg>
    )
}

/** 播放时的流光：光斑沿胶囊轮廓绕行，暂停减速停靠原地（reduced-motion 静态淡出） */
function Aurora({ accent, playing, reduced }: { accent: string; playing: boolean; reduced: boolean }) {
    const clock = useRef(START_AT)
    const rate = useRef(0)
    const fieldRef = useRef<HTMLDivElement>(null)
    const nodes = useRef<(HTMLSpanElement | null)[]>([])
    const width = useRef(0)

    const place = useCallback((t: number) => {
        if (width.current === 0) return
        const perimeter = 2 * Math.max(0, width.current - PILL_HEIGHT) + Math.PI * PILL_HEIGHT
        BLOBS.forEach((blob, i) => {
            const node = nodes.current[i]
            if (!node) return
            const travelled = blob.offset + t / blob.lap
            const [x, y] = pointOnPill(travelled * perimeter, width.current, PILL_HEIGHT)
            const phase = blob.offset * Math.PI * 2
            const scale = 1 + Math.sin(t * PULSE_SPEED + phase) * blob.pulse
            node.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
        })
    }, [])

    useEffect(() => {
        const node = fieldRef.current
        if (!node) return
        const observer = new ResizeObserver(([entry]) => {
            width.current = entry.contentRect.width
            // 一次立即摆位，避免 resize/reduced-motion 观察者看到光斑堆叠在原点
            place(clock.current)
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [place])

    useEffect(() => {
        if (reduced) return
        let frame = 0
        let last = performance.now()
        const loop = (now: number) => {
            // 后台标签页回来的长帧不能把光斑甩到对面去
            const delta = Math.min(0.05, (now - last) / 1000)
            last = now
            const target = playing ? 1 : 0
            rate.current += (target - rate.current) * (1 - Math.exp(-delta / SPIN_UP))
            clock.current += delta * rate.current
            place(clock.current)
            if (playing || rate.current > 0.002) {
                frame = requestAnimationFrame(loop)
                return
            }
            rate.current = 0
        }
        frame = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(frame)
    }, [playing, reduced, place])

    const glow = playing ? PLAYING_GLOW : 0

    return (
        <div className="voice-note-glow" aria-hidden>
            <motion.div
                ref={fieldRef}
                className="voice-note-glow-field"
                style={{
                    filter: `blur(${PILL_HEIGHT * BLUR_RATIO}px)`,
                    maskImage: MIDDLE_MASK,
                    WebkitMaskImage: MIDDLE_MASK,
                }}
                // 首帧不播动画，避免 field 先以全强度闪一帧
                initial={false}
                animate={{ opacity: glow }}
                transition={reduced ? INSTANT : GLOW}
            >
                <span className="voice-note-glow-base" style={{ background: `radial-gradient(70% 170% at 8% 115%, ${accent} 0%, transparent 62%), radial-gradient(55% 150% at 40% 130%, ${accent} 0%, transparent 58%)` }} />
                {BLOBS.map((blob, i) => (
                    <span
                        key={i}
                        ref={(node) => { nodes.current[i] = node }}
                        className="voice-note-glow-blob"
                        style={{
                            width: blob.size * PILL_HEIGHT,
                            height: blob.size * PILL_HEIGHT,
                            marginLeft: (-blob.size * PILL_HEIGHT) / 2,
                            marginTop: (-blob.size * PILL_HEIGHT) / 2,
                            background: accent,
                            opacity: blob.alpha,
                        }}
                    />
                ))}
            </motion.div>
        </div>
    )
}

/** 波形条：flex 等分、圆角、振幅比例高度（memo 避免进度 clip 每帧重排子节点） */
function Bars({ amplitudes, className }: { amplitudes: number[]; className: string }) {
    return (
        <div className="voice-note-bars">
            {amplitudes.map((amplitude, i) => (
                <span
                    key={i}
                    className={className}
                    style={{ height: `${(amplitude * PEAK_RATIO * 100).toFixed(2)}%` }}
                />
            ))}
        </div>
    )
}
