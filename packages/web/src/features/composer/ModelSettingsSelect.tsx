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
 * - 档位滑杆：档位点 + 高亮 + 档位名刻度，拖动与点按轨道双通道（触屏点按是主路径）；
 * - 档位集合来自模型能力（`resolveModelEffortLevels`）：不支持 effort 时不渲染滑杆区。
 *
 * 样式沿用 morph-select 的 pill 变量（--surface/--border/--radius-pill…），不再另立一套。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { EFFORT_LABELS, resolveModelEffortLevels } from '@mobi/shared'
import type { EffortLevel, ModelInfo } from '@mobi/shared'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { buildModelSelectOptions } from '@/domain/session/modelSelectOptions'

/** 重置目标：默认模型 + 默认档（与偏好缺省值一致） */
const DEFAULT_MODEL = 'auto'
const DEFAULT_EFFORT: EffortLevel = 'medium'

export interface ModelSettingsSelectProps {
    /** 可访问名（aria-label） */
    label: string
    model: string
    effort: EffortLevel
    /** 宿主探针模型清单（档位能力 + 列表内容）；缺失时回落兜底四项 / 四档 */
    models?: readonly ModelInfo[]
    onModelChange?: (model: string) => void
    onEffortChange?: (effort: EffortLevel) => void
    disabled?: boolean
    /** 顶栏左侧控件槽（快速模式图标钮，票 03 注入）；不支持快速模式的模型由调用方传 null */
    fastControl?: ReactNode
}

type PanelView = 'effort' | 'model'

export function ModelSettingsSelect({
    label,
    model,
    effort,
    models,
    onModelChange,
    onEffortChange,
    disabled,
    fastControl,
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

    const handleReset = useCallback(() => {
        if (model !== DEFAULT_MODEL) onModelChange?.(DEFAULT_MODEL)
        if (effort !== DEFAULT_EFFORT) onEffortChange?.(DEFAULT_EFFORT)
    }, [model, effort, onModelChange, onEffortChange])

    const handleModelSelect = useCallback((value: string) => {
        if (value !== model) onModelChange?.(value)
        setView('effort')
    }, [model, onModelChange])

    const pillText = showEffort ? `${modelLabel} · ${effortLabel(effort)}` : modelLabel

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
            fastControl={fastControl}
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
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pillText}</span>
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
    fastControl,
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
    fastControl?: ReactNode
    isMobile: boolean
    onReset: () => void
    onModelSelect: (model: string) => void
    onEffortChange?: (effort: EffortLevel) => void
}) {
    const { t } = useTranslation()
    const iconButtonSize = isMobile ? 38 : 30
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
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>{fastControl ?? null}</div>
                        <div style={{
                            textAlign: 'center',
                            fontSize: isMobile ? 17 : 16,
                            fontWeight: 600,
                            color: 'var(--foreground)',
                            lineHeight: 1.2,
                        }}>
                            {showEffort ? effortLabel(effort) : modelLabel}
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
                        />
                    )}
                </>
            )}
        </div>
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

/** 档位滑杆：拖动（pointer capture）+ 点按轨道分段跳档 + 键盘左右键 */
function EffortSlider({ levels, value, label, isMobile, onChange }: {
    levels: readonly EffortLevel[]
    value: EffortLevel
    label: (level: EffortLevel) => string
    isMobile: boolean
    onChange: (level: EffortLevel) => void
}) {
    const trackRef = useRef<HTMLDivElement>(null)
    const [dragging, setDragging] = useState(false)

    const currentIndex = Math.max(0, levels.indexOf(value))
    const lastIndex = levels.length - 1
    /** 档位在轨道上的位置（0-100）；单档时居中 */
    const percentOf = (index: number) => (lastIndex > 0 ? (index / lastIndex) * 100 : 50)

    const selectByClientX = useCallback((clientX: number) => {
        const el = trackRef.current
        if (!el || lastIndex <= 0) return
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0) return
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        const level = levels[Math.round(ratio * lastIndex)]
        if (level && level !== value) onChange(level)
    }, [levels, lastIndex, value, onChange])

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        // 指针捕获在 jsdom / 老浏览器上可能缺失：缺失时退化为不捕获（拖动期间仍靠 pointermove 跟手）
        const el = event.currentTarget
        if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId)
        setDragging(true)
        selectByClientX(event.clientX)
    }
    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragging) return
        selectByClientX(event.clientX)
    }
    const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const el = event.currentTarget
        if (typeof el.releasePointerCapture === 'function' && typeof el.hasPointerCapture === 'function'
            && el.hasPointerCapture(event.pointerId)) {
            el.releasePointerCapture(event.pointerId)
        }
        setDragging(false)
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

    const trackHeight = isMobile ? 44 : 30
    const thumbSize = isMobile ? 28 : 22
    const currentPercent = percentOf(currentIndex)

    return (
        <div>
            <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-label={label(value)}
                aria-valuemin={0}
                aria-valuemax={lastIndex}
                aria-valuenow={currentIndex}
                aria-valuetext={label(value)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={handleKeyDown}
                style={{
                    position: 'relative',
                    height: trackHeight,
                    margin: '2px 2px 6px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--surface-muted)',
                    cursor: 'pointer',
                    touchAction: 'none',
                    WebkitTapHighlightColor: 'transparent',
                }}
            >
                {/* 已选进度 */}
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${currentPercent}%`,
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--primary)',
                    opacity: 0.9,
                    pointerEvents: 'none',
                }} />
                {/* 档位点 */}
                {levels.map((level, index) => (
                    <span
                        key={level}
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            left: `${percentOf(index)}%`,
                            top: '50%',
                            width: index === currentIndex ? 0 : isMobile ? 7 : 5,
                            height: index === currentIndex ? 0 : isMobile ? 7 : 5,
                            marginLeft: index === currentIndex ? 0 : -(isMobile ? 3.5 : 2.5),
                            marginTop: index === currentIndex ? 0 : -(isMobile ? 3.5 : 2.5),
                            borderRadius: '50%',
                            background: 'var(--surface-raised)',
                            opacity: 0.75,
                            pointerEvents: 'none',
                        }}
                    />
                ))}
                {/* 拇指 */}
                <span
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        left: `${currentPercent}%`,
                        top: '50%',
                        width: thumbSize,
                        height: thumbSize,
                        marginLeft: -thumbSize / 2,
                        marginTop: -thumbSize / 2,
                        borderRadius: '50%',
                        background: 'var(--surface-raised)',
                        boxShadow: 'var(--shadow-floating)',
                        pointerEvents: 'none',
                        transition: dragging ? 'none' : 'left var(--duration-fast) var(--ease-standard)',
                    }}
                />
            </div>
            {/* 档位名刻度：本身也是点按入口（触屏主路径） */}
            <div style={{ display: 'flex', margin: '0 2px' }}>
                {levels.map(level => {
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
                                color: active ? 'var(--foreground)' : 'var(--text-muted)',
                                font: 'inherit',
                                fontSize: isMobile ? 11.5 : 11,
                                fontWeight: active ? 600 : 400,
                                textAlign: 'center',
                                cursor: 'pointer',
                                WebkitTapHighlightColor: 'transparent',
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
