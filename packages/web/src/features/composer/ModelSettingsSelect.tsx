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
 * - 触发器 = 模型 pill（`模型名 · 档位`）；pill 本身原地长成面板（MorphSurface），
 *   **PC 与移动端同一组件**，移动端面板满宽贴 composer 上沿；
 * - 顶栏三栏：左 = 快速模式控件槽（票 03 注入，缺席时中栏仍居中）、中 = 当前档位大字、
 *   右 = 重置为默认（auto + 默认档）；
 * - 模型行是 **MorphSelect**：点开在面板内就地长成模型列表，选中后收起并更新 pill；
 * - 档位滑杆（ChatGPT 形态）：矮轨道 + 大拇指南，轨道内嵌档位点，拖动时拇指只在档位点
 *   之间跳、**松手才提交**（一次拖动只发一次请求）；点按轨道同样即时提交；
 *   普通档纯蓝填充，只有最高档铺多彩流光并浮出星屑（reduced-motion 下退化为静态点）；
 * - 档位集合来自模型能力（`resolveModelEffortLevels`）：不支持 effort 时不渲染滑杆区。
 *
 * 样式沿用 morph-select 的 pill 变量（--surface/--border/--radius-pill…），不再另立一套。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { DEFAULT_EFFORT, DEFAULT_MODEL, resolveModelEffortLevels } from '@mobi/shared'
import type { EffortLevel, FastModeState, ModelInfo } from '@mobi/shared'
import { MorphSelect, type MorphSelectItem } from '@/ui/base/interactive/morph-select/MorphSelect'
import { MorphSurface } from '@/ui/base/interactive/morph-surface/MorphSurface'
import { spring } from '@/ui/base/motion/presets'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { buildModelSelectOptions } from '@/domain/session/modelSelectOptions'
import styles from './effortSlider.module.css'

/**
 * pill 收起态的宽度上限。
 *
 * 不能靠 `max-width: 100%`：pill 挂在 MorphSurface 的 inline-grid 里，隐式列按 max-content
 * 定宽，百分比没有可约束的祖先，长模型名会把工具条整条撑开（2026-10-27 真机）。上限还必须
 * 小于面板宽（320），否则展开时表面按 pill 宽长开、右侧多出一条空白。
 */
function pillMaxWidth(isMobile: boolean): number {
    return isMobile ? 200 : 260
}

/**
 * 档位强调色：非最高档统一取填充蓝（与轨道同色），只有最高档取彩色档的墨紫——
 * 轨道也只在最高档才铺多彩流光，「文字的颜色」与「轨道的颜色」始终是同一句话。
 */
function effortAccent(index: number, lastIndex: number): string {
    return lastIndex > 0 && index >= lastIndex ? 'var(--effort-ink-top)' : 'var(--effort-fill)'
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

    const modelOptions = useMemo(() => buildModelSelectOptions(models), [models])
    const modelInfo = useMemo(
        () => models?.find(m => m.value === model),
        [models, model],
    )
    const effortLevels = useMemo(() => resolveModelEffortLevels(modelInfo), [modelInfo])

    /** MorphSelect 的分组清单：`auto` 单列默认组，其余为宿主真实模型（描述行参与搜索） */
    const modelItems = useMemo<MorphSelectItem[]>(() => {
        // ModelSelectOption 与 MorphSelectItem 同构（value/label/description），直接复用
        const auto = modelOptions.filter(o => o.value === DEFAULT_MODEL)
        const host = modelOptions.filter(o => o.value !== DEFAULT_MODEL)
        const items: MorphSelectItem[] = []
        if (auto.length > 0) items.push({ label: t('composer.modelPanel.groupDefault'), options: auto })
        if (host.length > 0) items.push({ label: t('composer.modelPanel.groupHost'), options: host })
        return items
    }, [modelOptions, t])

    const modelLabel = useMemo(() => {
        const hit = modelOptions.find(o => o.value === model)
        return hit?.label ?? model
    }, [modelOptions, model])

    const effortLabel = useCallback(
        (level: EffortLevel) => t(`composer.effortLevels.${level}`),
        [t],
    )

    const showEffort = Boolean(onEffortChange) && effortLevels.length > 0
    /**
     * 快速开关的可见性（pill 的闪电与面板里的开关共用，避免「⚡ 亮着却关不掉」）。
     *
     * 只有模型**明确声明不支持**时才隐藏：能力未知（auto / 目录里没有它）时开关可见——
     * `fastMode` 是用户意图，能不能生效由 SDK 回读的 `fastModeState` 说了算，
     * 拿能力位去挡意图，会让已经开着快速模式的会话失去唯一关闭入口。
     */
    const showFast = Boolean(onFastModeChange) && modelInfo?.supportsFastMode !== false
    const fastEnabled = fastMode === true

    const handleReset = useCallback(() => {
        if (model !== DEFAULT_MODEL) onModelChange?.(DEFAULT_MODEL)
        if (effort !== DEFAULT_EFFORT) onEffortChange?.(DEFAULT_EFFORT)
        if (fastEnabled) onFastModeChange?.(false)
    }, [model, effort, fastEnabled, onModelChange, onEffortChange, onFastModeChange])

    const handleModelSelect = useCallback((value: string) => {
        if (value !== model) onModelChange?.(value)
    }, [model, onModelChange])

    const effortIndex = Math.max(0, effortLevels.indexOf(effort))
    const effortColor = effortAccent(effortIndex, effortLevels.length - 1)

    const panel = (
        <ModelSettingsPanel
            model={model}
            modelLabel={modelLabel}
            modelItems={modelItems}
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
        <MorphSurface
            label={label}
            width={320}
            fullWidth={isMobile}
            open={open}
            onOpenChange={setOpen}
            disabled={disabled}
            content={panel}
            trigger={({ open: isOpen, toggle }) => (
                <button
                    type="button"
                    aria-label={label}
                    aria-haspopup="dialog"
                    aria-expanded={isOpen}
                    disabled={disabled}
                    onClick={toggle}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        maxWidth: pillMaxWidth(isMobile),
                        height: 'var(--control-height-md)',
                        padding: '0 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-pill)',
                        background: isOpen ? 'var(--surface-raised)' : 'var(--surface)',
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
                    {showFast && fastEnabled && (
                        <Zap size={12} aria-hidden="true" fill="currentColor" style={{ flex: 'none', color: 'var(--primary)' }} />
                    )}
                    {/* 省略号只吃模型名：档位是「模型 · 档位」里信息密度更高的一半，
                        长模型名截断时不该把档位一起截掉 */}
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {modelLabel}
                    </span>
                    {showEffort && (
                        <>
                            <span aria-hidden="true" style={{ flex: 'none', color: 'var(--text-muted)' }}>·</span>
                            <span style={{ flex: 'none', color: effortColor }}>{effortLabel(effort)}</span>
                        </>
                    )}
                    <ChevronRight
                        size={14}
                        aria-hidden="true"
                        style={{ flex: 'none', color: 'var(--text-muted)', transform: isOpen ? 'rotate(-90deg)' : undefined, transition: 'transform var(--duration-fast) var(--ease-standard)' }}
                    />
                </button>
            )}
        />
    )
}

/** 面板本体：顶栏（快速模式 / 档位大字 / 重置）+ 模型行（MorphSelect）+ 档位滑杆 */
function ModelSettingsPanel({
    model,
    modelLabel,
    modelItems,
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
    model: string
    modelLabel: string
    modelItems: MorphSelectItem[]
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

            {/* 模型行：MorphSelect 原地长成列表（stretch 让行与展开面都占满面板宽） */}
            <MorphSelect
                label={t('composer.modelPanel.selectModel')}
                hideLabel
                stretch
                items={modelItems}
                value={model}
                // 当前模型不在宿主目录里（探针滞后 / 已下线的模型）时，如实显示原值而不是占位符
                placeholder={modelLabel}
                onValueChange={onModelSelect}
                // 模型清单短：不做搜索行，展开即全列表（typeahead 键盘检索仍可用）
                searchable={false}
                // 面板贴在 composer 上沿：列表恒向上展开，覆盖面板而不是压到输入框上
                direction="up"
                maxListHeight={isMobile ? 260 : 240}
            />

            {showEffort && (
                <EffortSlider
                    levels={effortLevels}
                    value={effort}
                    preview={preview}
                    label={effortLabel}
                    isMobile={isMobile}
                    onChange={(level) => onEffortChange?.(level)}
                    onPreviewChange={setPreview}
                />
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
        <PanelIconButton
            label={label}
            size={size}
            onClick={onToggle}
            pressed={enabled}
            color={cooldown ? 'var(--mobi-warning)' : enabled ? 'var(--primary)' : 'var(--text-muted)'}
        >
            <Zap size={size >= 36 ? 18 : 16} aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} />
        </PanelIconButton>
    )
}

/** 面板内图标钮（快速模式 / 重置）：触屏放大到 38，桌面 30 */
function PanelIconButton({ label, size, onClick, color = 'var(--text-secondary)', pressed, children }: {
    label: string
    size: number
    onClick: () => void
    /** 图标墨色，默认二级文字 */
    color?: string
    /** 切换类控件才传（带 aria-pressed） */
    pressed?: boolean
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
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
                color,
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
 * - 填充只做裁切，颜色分两态：普通档统一填充蓝，**只有最高档**才铺多彩流光并浮出星屑；
 * - 档位点嵌在轨道内，到达哪档点亮到哪档（hover 时放大，作为「可落点」的响应）；
 * - 拖动时拇指**只在档位点之间跳**：指针跨过相邻两点中点才换档，拇指从点滑到点，
 *   不会停在两个点之间；跨档只更新一次预览（顶栏大字随之走），**松手才下发**
 *   （一次拖动 = 一次请求）；
 * - 点按轨道 = 立即提交（档位名不进面板，当前档位只在顶栏大字与 pill 上显示）；
 *   键盘左右键逐档提交；
 * - 拉到最高档时浮出星屑（纯装饰，reduced-motion 下退化为静态点）。
 */
function EffortSlider({ levels, value, preview, label, isMobile, onChange, onPreviewChange }: {
    levels: readonly EffortLevel[]
    value: EffortLevel
    /** 拖动中的预览档位（父级持有，顶栏大字与滑杆共用同一份，避免两处状态分叉） */
    preview: EffortLevel | null
    label: (level: EffortLevel) => string
    isMobile: boolean
    onChange: (level: EffortLevel) => void
    /** 拖动中跨档 / 松手回 null 时通知父级 */
    onPreviewChange?: (level: EffortLevel | null) => void
}) {
    const trackRef = useRef<HTMLDivElement>(null)
    const reduced = useReducedMotion() ?? false
    const draggingRef = useRef(false)
    /** 当前吸附到的档位索引：拇指位置可能还在弹簧途中，松手要按「指针停在哪档」提交 */
    const snappedIndexRef = useRef(Math.max(0, levels.indexOf(value)))
    /** 上次已启动动画的档位索引（null = 本次拖动尚未吸附），用于吞掉同档的重复动画 */
    const lastSnappedRef = useRef<number | null>(null)
    /** 本次拖动起始时量到的轨道矩形（拖动期间几何不变，逐事件不再强制布局） */
    const dragRectRef = useRef<{ left: number; width: number } | null>(null)
    /** 轨道实测宽度：ResizeObserver 驱动，jsdom 下缺席则保持 0（测试只走比例换算） */
    const [trackWidth, setTrackWidth] = useState(0)

    const currentIndex = Math.max(0, levels.indexOf(value))
    const lastIndex = levels.length - 1
    const ratioOf = (index: number) => (lastIndex > 0 ? index / lastIndex : 0)
    const activeLevel = preview ?? value
    const activeIndex = Math.max(0, levels.indexOf(activeLevel))
    const atTop = lastIndex > 0 && activeIndex === lastIndex

    // 轨道矮、拇指大：拇指直径 ≈ 轨道高 × 1.3，上下各溢出一圈（ChatGPT 形态）。
    // 轨道越矮越像「条」，拇指越大越好抓；两者比例保持不变，只按视口缩放。
    const trackHeight = isMobile ? 34 : 26
    const thumbSize = isMobile ? 44 : 34
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

    // 外部值变更（换模型收敛档位、重置）→ 滑过去而不是瞬移
    useEffect(() => {
        const target = ratioOf(currentIndex)
        snappedIndexRef.current = currentIndex
        if (Math.abs(progress.get() - target) < 1e-4) return
        if (reduced) progress.set(target)
        else animate(progress, target, spring.ui)
    }, [currentIndex, lastIndex, progress, reduced])

    /** 比例 → 轨道内 x（两侧各留拇指半径，首末档位与拇指不会顶出轨道） */
    const positionOf = (ratio: number) =>
        `calc(${ratio} * (100% - ${thumbSize}px) + ${thumbSize / 2}px)`

    /** 指针 x → 连续比例（按拇指留白折算）；量不到轨道尺寸时返回 null */
    const ratioAt = useCallback((clientX: number, rect?: { left: number; width: number }): number | null => {
        const box = rect ?? trackRef.current?.getBoundingClientRect()
        if (!box) return null
        const span = box.width - thumbSize
        if (span <= 0) return null
        return Math.min(1, Math.max(0, (clientX - box.left - thumbSize / 2) / span))
    }, [thumbSize])

    const levelAt = useCallback((ratio: number): EffortLevel | undefined =>
        levels[Math.round(ratio * Math.max(lastIndex, 0))], [levels, lastIndex])

    /** 预览档位直接交给父级：同值 setState 由 React 跳过，逐像素移动不产生渲染 */
    const updatePreview = useCallback((ratio: number) => {
        onPreviewChange?.(levelAt(ratio) ?? null)
    }, [levelAt, onPreviewChange])

    /** 拖动期间的 window 级监听清理句柄（松手/取消/卸载时摘除） */
    const cleanupRef = useRef<(() => void) | null>(null)
    const stopTracking = () => {
        cleanupRef.current?.()
        cleanupRef.current = null
    }
    useEffect(() => stopTracking, [])

    /** 松手：档位已由吸附决定，这里只把拇指稳定到点上并提交 */
    const finishDrag = (commit: boolean) => {
        if (!draggingRef.current) return
        draggingRef.current = false
        stopTracking()
        dragRectRef.current = null
        lastSnappedRef.current = null
        const settled = commit ? snappedIndexRef.current : currentIndex
        const target = ratioOf(settled)
        if (reduced) progress.set(target)
        else animate(progress, target, spring.ui)
        if (!reduced) animate(scale, 1, spring.ui)
        const level = levels[settled]
        snappedIndexRef.current = currentIndex
        onPreviewChange?.(null)
        if (commit && level && level !== value) onChange(level)
    }

    /**
     * 拖动：拇指**只在档位点之间跳**，不做连续跟手。
     *
     * 连续跟手会让圆圈停在两个点之间，看起来像是能落在未定义的位置（拖动时空转、
     * 松手又弹回点上）；改成「跨过两点中点才换档、圆圈从点滑到点」后，视觉位置
     * 始终等于当前档位。
     *
     * 一次拖动 60~120 个 pointermove：它们共用 pointerdown 量到的轨道矩形（拖动期间
     * 几何不变，不必逐事件强制布局），且**吸附档位没变就不重启动画**（重启动只会把
     * 上一个弹簧顶掉，白建一批 playback controls）。
     */
    const moveTo = (clientX: number) => {
        const ratio = ratioAt(clientX, dragRectRef.current ?? undefined)
        if (ratio === null) return
        const index = Math.round(ratio * Math.max(lastIndex, 0))
        snappedIndexRef.current = index
        if (index !== lastSnappedRef.current) {
            lastSnappedRef.current = index
            const snapped = ratioOf(index)
            if (reduced) progress.set(snapped)
            else animate(progress, snapped, spring.ui)
        }
        updatePreview(ratio)
    }

    /**
     * 拖动期间在 window 上监听移动/松手。不做 setPointerCapture——实测（CDP drag）捕获会在
     * 拖动中被浏览器收回（lostpointercapture 先于 pointerup），之后的 pointerup 落到别的元素上，
     * 松手不提交。window 级监听不依赖捕获，指针离开轨道也照样跟着走。
     */
    const startTracking = (pointerId: number) => {
        stopTracking()
        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return
            moveTo(event.clientX)
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
        // 轨道几何在整个拖动期间不变：这里量一次，pointermove 全部复用
        const rect = trackRef.current?.getBoundingClientRect()
        if (!rect || rect.width - thumbSize <= 0) return
        dragRectRef.current = { left: rect.left, width: rect.width }
        lastSnappedRef.current = null
        draggingRef.current = true
        // 点按也走同一吸附：圆圈从当前档滑到被点的档，而不是瞬间跳到指针下方
        moveTo(event.clientX)
        if (!reduced) animate(scale, 1.12, spring.ui)
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
                data-top={atTop || undefined}
                onPointerDown={handlePointerDown}
                onKeyDown={handleKeyDown}
                style={{ height: trackHeight, margin: '2px 2px 4px' }}
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
        </div>
    )
}
