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
 * 模型设置面板（model-catalog 票 02）：一个入口统管「模型 / 推理档位（/ 快速模式）」。
 *
 * - 触发器 = 模型 pill（`模型名 · 档位`）；点开是一个面板，**PC 与移动端同一组件**，
 *   移动端仅三处尺寸差异（滑杆轨道 44、thumb 28、图标钮 38×38）并满宽贴 composer 上沿；
 * - 顶栏三栏：左 = 快速模式控件槽（票 03 注入，缺席时中栏仍居中）、中 = 当前档位大字、
 *   右 = 重置为默认（auto + 默认档）；
 * - 模型行点击后**面板内容原地切换**为模型列表（不叠新浮层），选中/返回键回到档位视图；
 * - 档位滑杆（ChatGPT 形态）：轨道内嵌档位点，拖动时拇指跟手但**不提交**，释放吸附到
 *   最近档位才下发（一次拖动只发一次请求）；点按轨道 / 档位名同样即时提交；
 *   拉到最高档时轨道铺满渐变并浮出星屑（reduced-motion 下退化为静态点）；
 * - 档位集合来自模型能力（`resolveModelEffortLevels`）：不支持 effort 时不渲染滑杆区。
 *
 * 样式沿用 morph-select 的 pill 变量（--surface/--border/--radius-pill…），不再另立一套。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { Check, ChevronLeft, ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { EFFORT_LABELS, resolveModelEffortLevels } from '@mobi/shared'
import type { EffortLevel, FastModeState, ModelInfo } from '@mobi/shared'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import { spring } from '@/ui/base/motion/presets'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { buildModelSelectOptions } from '@/domain/session/modelSelectOptions'
import styles from './effortSlider.module.css'

/** 重置目标：默认模型 + 默认档（与偏好缺省值一致） */
const DEFAULT_MODEL = 'auto'
const DEFAULT_EFFORT: EffortLevel = 'medium'

/**
 * 档位强调色：沿轨道渐变取色（首档 → 石青，末档 → 灰紫），与滑杆填充同源。
 * 顶栏大字与 pill 的档位名共用——「看到的颜色」始终对应「轨道上的位置」。
 */
function effortAccent(index: number, lastIndex: number): string {
    const percent = lastIndex > 0 ? Math.max(0, Math.min(100, Math.round((index / lastIndex) * 100))) : 0
    return `color-mix(in oklab, var(--mobi-chart-5) ${100 - percent}%, var(--mobi-chart-6) ${percent}%)`
}

/** 拉满档位的星屑（左/上百分比、尺寸、错相、是否菱形）：纯装饰语言，不从数据推导 */
const TOP_SPARKLES: ReadonlyArray<{ left: number; top: number; size: number; delay: number; diamond?: boolean }> = [
    { left: 12, top: 26, size: 4, delay: 0 },
    { left: 24, top: 62, size: 3, delay: 0.6 },
    { left: 38, top: 32, size: 6, delay: 1.2, diamond: true },
    { left: 52, top: 64, size: 3, delay: 1.8 },
    { left: 66, top: 26, size: 4, delay: 0.3, diamond: true },
    { left: 78, top: 60, size: 3, delay: 0.9 },
    { left: 88, top: 36, size: 5, delay: 1.5, diamond: true },
]

export interface ModelSettingsSelectProps {
    /** 可访问名（aria-label） */
    label: string
    model: string
    effort: EffortLevel
    /** 宿主探针模型清单（档位能力 + 列表内容）；缺失时回落兜底四项 / 四档 */
    models?: readonly ModelInfo[]
    onModelChange?: (model: string) => void
    onEffortChange?: (effort: EffortLevel) => void
    /** 快速模式当前开关（undefined = 未指定，按关闭展示） */
    fastMode?: boolean
    /** 快速模式运行态（来自会话元数据）；cooldown = 限流临时不可用，如实反映而非当作开启 */
    fastModeState?: FastModeState | null
    onFastModeChange?: (enabled: boolean) => void
    disabled?: boolean
}

type PanelView = 'effort' | 'model'

export function ModelSettingsSelect({
    label,
    model,
    effort,
    models,
    onModelChange,
    onEffortChange,
    fastMode,
    fastModeState,
    onFastModeChange,
    disabled,
}: ModelSettingsSelectProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const [open, setOpen] = useState(false)
    const [view, setView] = useState<PanelView>('effort')

    // 关闭即回到档位视图：下次打开不该停在上次的模型列表里
    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next)
        if (!next) setView('effort')
    }, [])

    const modelOptions = useMemo(() => buildModelSelectOptions(models), [models])
    const modelInfo = useMemo(
        () => models?.find(m => m.value === model),
        [models, model],
    )
    const effortLevels = useMemo(() => resolveModelEffortLevels(modelInfo), [modelInfo])

    const modelLabel = useMemo(() => {
        const hit = modelOptions.find(o => o.value === model)
        return hit?.label ?? model
    }, [modelOptions, model])

    const effortLabel = useCallback(
        (level: EffortLevel) => t(`composer.effortLevels.${level}`, { defaultValue: EFFORT_LABELS[level] }),
        [t],
    )

    const showEffort = Boolean(onEffortChange) && effortLevels.length > 0
    // 快速开关只在模型声明支持且调用方能承载切换时出现（创建页与会话内同规）
    const showFast = Boolean(onFastModeChange) && modelInfo?.supportsFastMode === true
    const fastEnabled = fastMode === true

    const handleReset = useCallback(() => {
        if (model !== DEFAULT_MODEL) onModelChange?.(DEFAULT_MODEL)
        if (effort !== DEFAULT_EFFORT) onEffortChange?.(DEFAULT_EFFORT)
        if (fastEnabled) onFastModeChange?.(false)
    }, [model, effort, fastEnabled, onModelChange, onEffortChange, onFastModeChange])

    const handleModelSelect = useCallback((value: string) => {
        if (value !== model) onModelChange?.(value)
        setView('effort')
    }, [model, onModelChange])

    const effortIndex = Math.max(0, effortLevels.indexOf(effort))
    const effortColor = effortAccent(effortIndex, effortLevels.length - 1)

    const panel = (
        <ModelSettingsPanel
            view={view}
            onViewChange={setView}
            model={model}
            modelLabel={modelLabel}
            modelOptions={modelOptions}
            effort={effort}
            effortLevels={effortLevels}
            effortLabel={effortLabel}
            showEffort={showEffort}
            showFast={showFast}
            fastEnabled={fastEnabled}
            fastModeState={fastModeState ?? null}
            onFastModeToggle={onFastModeChange ? () => onFastModeChange(!fastEnabled) : undefined}
            isMobile={isMobile}
            onReset={handleReset}
            onModelSelect={handleModelSelect}
            onEffortChange={onEffortChange}
        />
    )

    return (
        <Popover
            trigger="click"
            open={open}
            onOpenChange={handleOpenChange}
            side="top"
            align="center"
            sideOffset={8}
            panelClassName="model-settings-popover"
            panelPadding={0}
            panelStyle={isMobile ? { width: 'calc(100vw - 20px)' } : { width: 320 }}
            maxWidth="calc(100vw - 20px)"
            content={panel}
        >
            <button
                type="button"
                aria-label={label}
                disabled={disabled}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    maxWidth: '100%',
                    height: 'var(--control-height-md)',
                    padding: '0 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-pill)',
                    background: open ? 'var(--surface-raised)' : 'var(--surface)',
                    color: 'var(--foreground)',
                    font: 'inherit',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                    WebkitTapHighlightColor: 'transparent',
                }}
            >
                {fastEnabled && (
                    <Zap size={12} aria-hidden="true" fill="currentColor" style={{ flex: 'none', color: 'var(--primary)' }} />
                )}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {modelLabel}
                    {showEffort && (
                        <>
                            {' · '}
                            <span style={{ color: effortColor }}>{effortLabel(effort)}</span>
                        </>
                    )}
                </span>
                <ChevronRight
                    size={14}
                    aria-hidden="true"
                    style={{ flex: 'none', color: 'var(--text-muted)', transform: open ? 'rotate(-90deg)' : undefined, transition: 'transform var(--duration-fast) var(--ease-standard)' }}
                />
            </button>
        </Popover>
    )
}

/** 面板本体：档位视图 ⇄ 模型列表视图在同一容器内原地切换 */
function ModelSettingsPanel({
    view,
    onViewChange,
    model,
    modelLabel,
    modelOptions,
    effort,
    effortLevels,
    effortLabel,
    showEffort,
    showFast,
    fastEnabled,
    fastModeState,
    onFastModeToggle,
    isMobile,
    onReset,
    onModelSelect,
    onEffortChange,
}: {
    view: PanelView
    onViewChange: (view: PanelView) => void
    model: string
    modelLabel: string
    modelOptions: ReturnType<typeof buildModelSelectOptions>
    effort: EffortLevel
    effortLevels: readonly EffortLevel[]
    effortLabel: (level: EffortLevel) => string
    showEffort: boolean
    showFast: boolean
    fastEnabled: boolean
    fastModeState: FastModeState | null
    onFastModeToggle?: () => void
    isMobile: boolean
    onReset: () => void
    onModelSelect: (model: string) => void
    onEffortChange?: (effort: EffortLevel) => void
}) {
    const { t } = useTranslation()
    const iconButtonSize = isMobile ? 38 : 30
    /** 拖动中的预览档位：顶栏大字跟着拇指走，实际下发等松手吸附后才发生 */
    const [preview, setPreview] = useState<EffortLevel | null>(null)
    const shownEffort = preview ?? effort
    const shownIndex = Math.max(0, effortLevels.indexOf(shownEffort))
    return (
        <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {view === 'model' ? (
                <ModelListView
                    model={model}
                    modelOptions={modelOptions}
                    isMobile={isMobile}
                    iconButtonSize={iconButtonSize}
                    onBack={() => onViewChange('effort')}
                    onSelect={onModelSelect}
                />
            ) : (
                <>
                    {/* 顶栏三栏：左控件槽 / 中档位大字 / 右重置（左右等宽，中栏恒居中） */}
                    <div style={{ display: 'grid', gridTemplateColumns: `${iconButtonSize}px 1fr ${iconButtonSize}px`, alignItems: 'center', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            {showFast && onFastModeToggle && (
                                <FastModeButton
                                    enabled={fastEnabled}
                                    state={fastModeState}
                                    size={iconButtonSize}
                                    onToggle={onFastModeToggle}
                                />
                            )}
                        </div>
                        <div style={{
                            textAlign: 'center',
                            fontSize: isMobile ? 17 : 16,
                            fontWeight: 600,
                            color: showEffort ? effortAccent(shownIndex, effortLevels.length - 1) : 'var(--foreground)',
                            lineHeight: 1.2,
                        }}>
                            {showEffort ? effortLabel(shownEffort) : modelLabel}
                        </div>
                        <PanelIconButton
                            label={t('composer.modelPanel.reset')}
                            size={iconButtonSize}
                            onClick={onReset}
                        >
                            <RotateCcw size={isMobile ? 16 : 15} />
                        </PanelIconButton>
                    </div>

                    {/* 模型行：点击原地切到列表 */}
                    <button
                        type="button"
                        onClick={() => onViewChange('model')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            minHeight: isMobile ? 40 : 32,
                            padding: '0 8px',
                            border: 0,
                            borderRadius: 'var(--radius-square)',
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            font: 'inherit',
                            fontSize: 13,
                            cursor: 'pointer',
                            WebkitTapHighlightColor: 'transparent',
                        }}
                    >
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelLabel}</span>
                        <ChevronRight size={14} aria-hidden="true" style={{ flex: 'none', color: 'var(--text-muted)' }} />
                    </button>

                    {showEffort && (
                        <EffortSlider
                            levels={effortLevels}
                            value={effort}
                            label={effortLabel}
                            isMobile={isMobile}
                            onChange={(level) => onEffortChange?.(level)}
                            onPreviewChange={setPreview}
                        />
                    )}
                </>
            )}
        </div>
    )
}

/**
 * 快速模式图标钮（无文字）：镂空闪电 = 关 / 填充闪电 = 开 / 填充 + 警告色 = 冷却。
 * 冷却态仍可点击（关掉快速模式），说明走悬浮提示。
 */
function FastModeButton({ enabled, state, size, onToggle }: {
    enabled: boolean
    state: FastModeState | null
    size: number
    onToggle: () => void
}) {
    const { t } = useTranslation()
    const cooldown = state === 'cooldown' && enabled
    const label = cooldown
        ? t('composer.modelPanel.fastCooldown')
        : enabled ? t('composer.modelPanel.fastOn') : t('composer.modelPanel.fastOff')
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={enabled}
            title={label}
            onClick={onToggle}
            style={{
                display: 'grid',
                placeItems: 'center',
                width: size,
                height: size,
                padding: 0,
                border: 0,
                borderRadius: 'var(--radius-square)',
                background: 'transparent',
                color: cooldown ? 'var(--mobi-warning)' : enabled ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
            }}
        >
            <Zap size={size >= 36 ? 18 : 16} aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} />
        </button>
    )
}

/** 面板内图标钮（重置 / 返回）：触屏放大到 38，桌面 30 */
function PanelIconButton({ label, size, onClick, children }: {
    label: string
    size: number
    onClick: () => void
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            style={{
                display: 'grid',
                placeItems: 'center',
                width: size,
                height: size,
                padding: 0,
                border: 0,
                borderRadius: 'var(--radius-square)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
            }}
        >
            {children}
        </button>
    )
}

/**
 * 档位滑杆（ChatGPT 形态 + uiarc 动效语言）：
 * - 轨道铺满渐变（石青→灰紫），进度只做裁切，颜色按位置固定，拖动时不「变色」；
 * - 档位点嵌在轨道内，到达哪档点亮到哪档；
 * - 拖动时拇指**不吃 React 状态**：motion value 1:1 跟手，只有档位真的换了才更新一次
 *   预览（顶栏大字随之走），松手时把拇指速度交给 spring.momentum 做惯性沉降 + 吸附到
 *   最近档位，**吸附完成才下发**（一次拖动 = 一次请求）；
 * - 点按轨道 / 档位名 = 立即提交；键盘左右键逐档提交；
 * - 拉到最高档时浮出星屑（纯装饰，reduced-motion 下退化为静态点）。
 */
function EffortSlider({ levels, value, label, isMobile, onChange, onPreviewChange }: {
    levels: readonly EffortLevel[]
    value: EffortLevel
    label: (level: EffortLevel) => string
    isMobile: boolean
    onChange: (level: EffortLevel) => void
    /** 拖动中的预览档位（父级据此同步顶栏大字）；松手/取消回 null */
    onPreviewChange?: (level: EffortLevel | null) => void
}) {
    const trackRef = useRef<HTMLDivElement>(null)
    const reduced = useReducedMotion() ?? false
    /** 拖动中的预览档位：只在跨档时 setState，逐像素移动不进 React */
    const [preview, setPreview] = useState<EffortLevel | null>(null)
    const draggingRef = useRef(false)
    /** 最近一次指针采样（速度 = px/ms），释放时折算给吸附弹簧 */
    const lastSampleRef = useRef<{ x: number; t: number } | null>(null)
    const velocityRef = useRef(0)
    /** 轨道实测宽度：ResizeObserver 驱动，jsdom 下缺席则保持 0（测试只走比例换算） */
    const [trackWidth, setTrackWidth] = useState(0)

    const currentIndex = Math.max(0, levels.indexOf(value))
    const lastIndex = levels.length - 1
    const ratioOf = (index: number) => (lastIndex > 0 ? index / lastIndex : 0)
    const activeLevel = preview ?? value
    const activeIndex = Math.max(0, levels.indexOf(activeLevel))
    const atTop = lastIndex > 0 && activeIndex === lastIndex

    const trackHeight = isMobile ? 44 : 30
    const thumbSize = isMobile ? 28 : 22
    const dotSize = isMobile ? 7 : 5

    /** 进度（0..1）是动效的唯一真源：拖动直接 set，松手/外部变更走弹簧 */
    const progress = useMotionValue(ratioOf(currentIndex))
    const scale = useMotionValue(1)
    const thumbX = useTransform(progress, (ratio) => ratio * Math.max(0, trackWidth - thumbSize))
    const fillWidth = useTransform(thumbX, (x) => x + thumbSize / 2)
    const clipPath = useTransform(fillWidth, (width) => `inset(0 calc(100% - ${Math.round(width)}px) 0 0)`)

    // 轨道宽度（首帧 + 尺寸变化）
    useEffect(() => {
        const el = trackRef.current
        if (!el) return
        const measure = () => setTrackWidth(el.getBoundingClientRect().width)
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // 外部值变更（换模型收敛档位、重置、点档位名）→ 滑过去而不是瞬移
    useEffect(() => {
        const target = ratioOf(currentIndex)
        if (Math.abs(progress.get() - target) < 1e-4) return
        if (reduced) progress.set(target)
        else animate(progress, target, spring.ui)
    }, [currentIndex, lastIndex, progress, reduced])

    /** 比例 → 轨道内 x（两侧各留拇指半径，首末档位与拇指不会顶出轨道） */
    const positionOf = (ratio: number) =>
        `calc(${ratio} * (100% - ${thumbSize}px) + ${thumbSize / 2}px)`

    /** 指针 x → 连续比例（按拇指留白折算）；量不到轨道尺寸时返回 null */
    const ratioAt = useCallback((clientX: number): number | null => {
        const el = trackRef.current
        if (!el) return null
        const rect = el.getBoundingClientRect()
        const span = rect.width - thumbSize
        if (span <= 0) return null
        return Math.min(1, Math.max(0, (clientX - rect.left - thumbSize / 2) / span))
    }, [thumbSize])

    const levelAt = useCallback((ratio: number): EffortLevel | undefined =>
        levels[Math.round(ratio * Math.max(lastIndex, 0))], [levels, lastIndex])

    /** 只在档位变化时同步预览（拖过 5 档最多 5 次 setState，逐像素移动零渲染） */
    const updatePreview = useCallback((ratio: number) => {
        const level = levelAt(ratio) ?? null
        setPreview(prev => (prev === level ? prev : level))
        onPreviewChange?.(level)
    }, [levelAt, onPreviewChange])

    /** 拖动期间的 window 级监听清理句柄（松手/取消/卸载时摘除） */
    const cleanupRef = useRef<(() => void) | null>(null)
    const stopTracking = () => {
        cleanupRef.current?.()
        cleanupRef.current = null
    }
    useEffect(() => stopTracking, [])

    /** 松手：惯性吸附到最近档位；commit=false（取消）时不提交 */
    const finishDrag = (commit: boolean) => {
        if (!draggingRef.current) return
        draggingRef.current = false
        stopTracking()
        const settled = Math.round(progress.get() * Math.max(lastIndex, 0))
        const target = ratioOf(settled)
        // 惯性吸附：拇指速度（px/ms）折算成比例速度（每秒），弹簧负责把过冲收回来
        const span = Math.max(1, trackWidth - thumbSize)
        const velocity = reduced ? 0 : (velocityRef.current / span) * 1000
        if (reduced) progress.set(target)
        else animate(progress, target, { ...spring.momentum, velocity })
        if (!reduced) animate(scale, 1, spring.ui)
        const level = levels[settled]
        setPreview(null)
        onPreviewChange?.(null)
        lastSampleRef.current = null
        if (commit && level && level !== value) onChange(level)
    }

    /**
     * 跟手移动：直接写 motion value（不进 React 状态机），只在跨档时更新一次预览。
     * 不做 setPointerCapture——实测（CDP drag）捕获会在拖动中被浏览器收回
     * （lostpointercapture 先于 pointerup），之后的 pointerup 落到别的元素上，
     * 松手不提交。window 级监听不依赖捕获，指针离开轨道也照样跟手。
     */
    const trackMove = (clientX: number) => {
        const ratio = ratioAt(clientX)
        if (ratio === null) return
        // 速度采样：甩动越快，释放后的惯性沉降越明显
        const now = performance.now()
        const last = lastSampleRef.current
        if (last && now > last.t) velocityRef.current = (clientX - last.x) / (now - last.t)
        lastSampleRef.current = { x: clientX, t: now }
        progress.set(ratio)
        updatePreview(ratio)
    }

    const startTracking = (pointerId: number) => {
        stopTracking()
        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return
            trackMove(event.clientX)
        }
        const onUp = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return
            finishDrag(true)
        }
        const onCancel = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return
            finishDrag(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        cleanupRef.current = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onCancel)
        }
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        const ratio = ratioAt(event.clientX)
        if (ratio === null) return
        draggingRef.current = true
        velocityRef.current = 0
        lastSampleRef.current = { x: event.clientX, t: performance.now() }
        progress.set(ratio)
        if (!reduced) animate(scale, 1.12, spring.ui)
        updatePreview(ratio)
        startTracking(event.pointerId)
    }

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1
            : 0
        if (delta === 0) return
        event.preventDefault()
        const next = levels[Math.min(lastIndex, Math.max(0, currentIndex + delta))]
        if (next && next !== value) onChange(next)
    }

    return (
        <div>
            <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-label={label(value)}
                aria-valuemin={0}
                aria-valuemax={lastIndex}
                aria-valuenow={activeIndex}
                aria-valuetext={label(activeLevel)}
                className={styles.track}
                onPointerDown={handlePointerDown}
                onKeyDown={handleKeyDown}
                style={{ height: trackHeight, margin: '2px 2px 6px' }}
            >
                {/* 已选进度：裁切而非缩放，渐变颜色按 x 固定 */}
                <motion.div className={styles.gradient} style={{ clipPath }} />
                {/* 档位点：到达的场景用半透明白，未达用墨色淡阶 */}
                {levels.map((level, index) => (
                    <span
                        key={level}
                        aria-hidden="true"
                        className={styles.dot}
                        style={{
                            left: positionOf(ratioOf(index)),
                            width: index === activeIndex ? 0 : dotSize,
                            height: index === activeIndex ? 0 : dotSize,
                            background: index <= activeIndex ? 'rgba(255, 255, 255, 0.62)' : 'var(--mobi-ink-quaternary)',
                            transition: reduced ? undefined : 'background-color var(--duration-fast) var(--ease-standard)',
                        }}
                    />
                ))}
                {/* 拉满档位的星屑 */}
                {atTop && TOP_SPARKLES.map((sparkle, index) => (
                    <span
                        key={index}
                        aria-hidden="true"
                        data-testid="effort-sparkle"
                        className={`${styles.sparkle}${sparkle.diamond ? ` ${styles.sparkleDiamond}` : ''}`}
                        style={{
                            left: `${sparkle.left}%`,
                            top: `${sparkle.top}%`,
                            width: sparkle.size,
                            height: sparkle.size,
                            animationDelay: `${sparkle.delay}s`,
                        }}
                    />
                ))}
                {/* 拇指：x 由 motion value 驱动（1:1 跟手），拖动时轻微放大 */}
                <motion.span
                    aria-hidden="true"
                    className={styles.thumb}
                    style={{
                        x: thumbX,
                        scale,
                        width: thumbSize,
                        height: thumbSize,
                        marginTop: -thumbSize / 2,
                    }}
                />
            </div>
            {/* 档位名刻度：本身也是点按入口（触屏主路径） */}
            <div style={{ display: 'flex', margin: '0 2px' }}>
                {levels.map((level, index) => {
                    const active = level === value
                    return (
                        <button
                            key={level}
                            type="button"
                            onClick={() => level !== value && onChange(level)}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                minHeight: isMobile ? 28 : 20,
                                padding: '2px 0',
                                border: 0,
                                background: 'transparent',
                                color: active ? effortAccent(index, lastIndex) : 'var(--text-muted)',
                                font: 'inherit',
                                fontSize: isMobile ? 11.5 : 11,
                                fontWeight: active ? 600 : 400,
                                textAlign: 'center',
                                cursor: 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                                transition: reduced ? undefined : 'color var(--duration-fast) var(--ease-standard)',
                            }}
                        >
                            {label(level)}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

/** 模型列表视图：`auto` 单列默认组，其余为宿主真实清单（描述行 + 勾选） */
function ModelListView({ model, modelOptions, isMobile, iconButtonSize, onBack, onSelect }: {
    model: string
    modelOptions: ReturnType<typeof buildModelSelectOptions>
    isMobile: boolean
    iconButtonSize: number
    onBack: () => void
    onSelect: (model: string) => void
}) {
    const { t } = useTranslation()
    const autoOptions = modelOptions.filter(o => o.value === DEFAULT_MODEL)
    const hostOptions = modelOptions.filter(o => o.value !== DEFAULT_MODEL)

    const renderItem = (option: { value: string; label: string; description?: string }) => {
        const selected = option.value === model
        return (
            <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(option.value)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    minHeight: isMobile ? 44 : 36,
                    padding: '6px 10px',
                    border: 0,
                    borderRadius: 'var(--radius-square)',
                    background: selected ? 'var(--surface-muted)' : 'transparent',
                    color: selected ? 'var(--foreground)' : 'var(--text-secondary)',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                }}
            >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: selected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {option.label}
                    </span>
                    {option.description && (
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {option.description}
                        </span>
                    )}
                </span>
                {selected && <Check size={15} aria-hidden="true" style={{ flex: 'none' }} />}
            </button>
        )
    }

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: `${iconButtonSize}px 1fr ${iconButtonSize}px`, alignItems: 'center' }}>
                <PanelIconButton label={t('composer.modelPanel.back')} size={iconButtonSize} onClick={onBack}>
                    <ChevronLeft size={isMobile ? 17 : 16} />
                </PanelIconButton>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {t('composer.modelPanel.selectModel')}
                </div>
                <span />
            </div>
            <div
                role="listbox"
                aria-label={t('composer.modelPanel.selectModel')}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    maxHeight: isMobile ? '60dvh' : 320,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    paddingRight: 2,
                }}
            >
                {autoOptions.length > 0 && (
                    <div role="group" aria-label={t('composer.modelPanel.groupDefault')}>
                        <GroupLabel>{t('composer.modelPanel.groupDefault')}</GroupLabel>
                        {autoOptions.map(renderItem)}
                    </div>
                )}
                {hostOptions.length > 0 && (
                    <div role="group" aria-label={t('composer.modelPanel.groupHost')}>
                        <GroupLabel>{t('composer.modelPanel.groupHost')}</GroupLabel>
                        {hostOptions.map(renderItem)}
                    </div>
                )}
            </div>
        </>
    )
}

function GroupLabel({ children }: { children: ReactNode }) {
    return (
        <div style={{ padding: '8px 10px 4px', fontSize: 11, color: 'var(--text-muted)' }}>{children}</div>
    )
}
