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
 * 行内两击确认按钮（通用）
 *
 * 形态参照 RareUI DeleteButton（https://www.rareui.com/components/deletebutton）：
 * 一击展开确认面板（✓/✗），确认后 icon 原位画 ✓ 短暂停留再执行；Escape /
 * 点击外部 / 超时自动复原。仅借鉴交互形态与节奏常量，代码自行实现——
 * 源码为 MIT + Commons Clause + 强制 attribution，不得复制（spec 许可红线）。
 *
 * 相对 RareUI 的两处适配：
 * - 通用化：icon / expandedIcon / confirmedIcon 三个声明式插槽（缺省回落），
 *   不绑定 delete 场景；取消态无插槽（原 icon 微弹归位，语义是「没动」）
 * - 主题：颜色全部走 antd token（light/dark 自动双档），非 tailwind 硬编码
 *
 * 状态机：idle → open →（confirmed | cancelled）→ idle。展开态即 `open` 状态，
 * 不另设 boolean——双状态源会要求每个转换点同步改两个 setState。
 * onConfirm 在点 ✓ 时立即触发，confirmed 停留只是视觉反馈。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { GlobalToken } from 'antd/es/theme/interface'

const EASE = [0.32, 0.72, 0, 1] as const

/** 确认后 ✓ 停留时长（源码节奏：deleted hold） */
const HOLD_CONFIRMED_MS = 1400
/** 取消后归位微弹停留时长（源码节奏：kept hold） */
const HOLD_CANCELLED_MS = 600
/** 展开态无操作自动复原（触屏无 hover，误触展开后忘记收起的兜底） */
const DEFAULT_TIMEOUT_MS = 3000

/** 紧凑尺寸：适配 22px 级卡片行内按钮（RareUI 为 48px 大按钮，不适配 mobi 行内场景） */
const TILE_SIZE = 22
const PANEL_WIDTH = 56

type TwoStepStatus = 'idle' | 'open' | 'confirmed' | 'cancelled'

export interface TwoStepConfirmButtonProps {
    /** 空闲态图标（取消回落也用它） */
    icon: ReactNode
    /** 展开期间的图标；缺省 = icon 不变 */
    expandedIcon?: ReactNode
    /** 确认停留期的图标；缺省内置 Check */
    confirmedIcon?: ReactNode
    /** 动作名（组装 aria-label 与 sr-only 播报，如「停止任务」） */
    ariaActionLabel: string
    onConfirm: () => void
    onCancel?: () => void
    /** 展开态无操作自动复原时长（ms） */
    timeoutMs?: number
    /** 外部忙/禁用（如停止请求进行中），冻结交互 */
    disabled?: boolean
}

const Root = styled(motion.div)<{ $token: GlobalToken }>`
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: ${TILE_SIZE}px;
    border-radius: 6px;
    overflow: visible;
    background: ${(p) => p.$token.colorBgContainer};
`

const Trigger = styled(motion.button)<{ $token: GlobalToken }>`
    position: relative;
    z-index: 10;
    display: grid;
    place-items: center;
    width: ${TILE_SIZE}px;
    height: ${TILE_SIZE}px;
    flex-shrink: 0;
    border: none;
    padding: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: ${(p) => p.$token.colorTextQuaternary};
    transition: color 0.2s;

    &:hover:not(:disabled) {
        color: ${(p) => p.$token.colorError};
        background: ${(p) => p.$token.colorErrorBg};
    }

    &:focus-visible {
        outline: 2px solid ${(p) => p.$token.colorPrimary};
        outline-offset: 1px;
    }

    &:disabled {
        cursor: default;
    }
`

const Panel = styled(motion.div)<{ $token: GlobalToken }>`
    position: absolute;
    inset-block: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: ${PANEL_WIDTH}px;
    border-radius: 6px;
    background: ${(p) => p.$token.colorFillQuaternary};
`

const CircleButton = styled(motion.button)<{ $token: GlobalToken; $danger?: boolean }>`
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: none;
    padding: 0;
    border-radius: 50%;
    cursor: pointer;
    color: ${(p) => (p.$danger ? p.$token.colorError : p.$token.colorTextSecondary)};
    background: transparent;
    transition: background 0.2s;

    &:hover {
        background: ${(p) => (p.$danger ? p.$token.colorErrorBg : p.$token.colorFillTertiary)};
    }

    &:focus-visible {
        outline: 2px solid ${(p) => p.$token.colorPrimary};
        outline-offset: 1px;
    }
`

/** 统一的 icon 位切换原语：crossfade + scale（声明式「有就显示、缺省回落」） */
function IconSlot({ stateKey, children }: { stateKey: string; children: ReactNode }) {
    const reduced = useReducedMotion() ?? false
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.span
                key={stateKey}
                style={{ display: 'inline-flex', lineHeight: 0 }}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                animate={reduced ? undefined : { opacity: 1, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.22, ease: EASE }}
            >
                {children}
            </motion.span>
        </AnimatePresence>
    )
}

export function TwoStepConfirmButton({
    icon,
    expandedIcon,
    confirmedIcon,
    ariaActionLabel,
    onConfirm,
    onCancel,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    disabled = false,
}: TwoStepConfirmButtonProps) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const reduced = useReducedMotion() ?? false
    const [status, setStatus] = useState<TwoStepStatus>('idle')
    const rootRef = useRef<HTMLDivElement>(null)
    /** 展开中（≈ status === 'open'，语义别名让 effect/JSX 判据自解释） */
    const open = status === 'open'

    // 展开态超时复原：触屏误触展开后忘记收起的兜底（直接回 idle，无取消微弹/播报）
    useEffect(() => {
        if (!open) return
        const timer = setTimeout(() => {
            setStatus('idle')
            onCancel?.()
        }, timeoutMs)
        return () => clearTimeout(timer)
    }, [open, timeoutMs, onCancel])

    // 点击组件外部收起（面板展开期间才监听；直接回 idle，同超时复原）
    useEffect(() => {
        if (!open) return
        const handlePointerDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setStatus('idle')
                onCancel?.()
            }
        }
        document.addEventListener('pointerdown', handlePointerDown)
        return () => document.removeEventListener('pointerdown', handlePointerDown)
    }, [open, onCancel])

    // 确认/取消的视觉停留：停留结束后回 idle（onConfirm 在 resolve 时已触发）
    useEffect(() => {
        if (status !== 'confirmed' && status !== 'cancelled') return
        const hold = status === 'confirmed' ? HOLD_CONFIRMED_MS : HOLD_CANCELLED_MS
        const timer = setTimeout(() => setStatus('idle'), hold)
        return () => clearTimeout(timer)
    }, [status])

    const resolve = (next: 'confirmed' | 'cancelled') => {
        setStatus(next)
        if (next === 'confirmed') onConfirm()
        else onCancel?.()
    }

    const iconForState =
        status === 'confirmed'
            ? (confirmedIcon ?? <Check size={14} aria-hidden />)
            : open
                ? (expandedIcon ?? icon)
                : icon

    return (
        <Root
            ref={rootRef}
            $token={token}
            data-testid="two-step-confirm"
            data-state={open ? 'open' : 'closed'}
            data-status={status}
            animate={{ width: open ? TILE_SIZE + PANEL_WIDTH : TILE_SIZE }}
            transition={reduced ? { duration: 0 } : { duration: 0.35, ease: EASE }}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && open) resolve('cancelled')
            }}
        >
            <Trigger
                $token={token}
                type="button"
                disabled={disabled}
                aria-label={ariaActionLabel}
                aria-expanded={open}
                onClick={() => {
                    if (disabled) return
                    if (open) return resolve('cancelled')
                    setStatus('open')
                }}
            >
                <IconSlot stateKey={status === 'cancelled' ? 'icon-settle' : status === 'confirmed' ? 'confirmed' : open ? 'expanded' : 'idle'}>
                    <motion.span
                        style={{ display: 'inline-flex', lineHeight: 0, transformOrigin: 'center' }}
                        animate={
                            !reduced && status === 'cancelled'
                                ? { scale: [1, 0.86, 1] }
                                : { scale: 1 }
                        }
                        transition={{ duration: 0.45, ease: EASE }}
                    >
                        {iconForState}
                    </motion.span>
                </IconSlot>
            </Trigger>

            {/* 读屏结果播报：视觉隐藏但可达（源码同款 role=status 方案） */}
            <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
                {status === 'confirmed'
                    ? `${ariaActionLabel} · ${t('common.confirm')}`
                    : status === 'cancelled'
                        ? `${ariaActionLabel} · ${t('common.cancel')}`
                        : ''}
            </span>

            <AnimatePresence>
                {open && (
                    <Panel
                        $token={token}
                        initial={reduced ? false : { opacity: 0, x: -6 }}
                        animate={reduced ? undefined : { opacity: 1, x: 0 }}
                        exit={reduced ? undefined : { opacity: 0, x: -6 }}
                        transition={{ duration: 0.3, ease: EASE }}
                    >
                        <CircleButton
                            $token={token}
                            $danger
                            type="button"
                            aria-label={`${t('common.confirm')} ${ariaActionLabel}`}
                            onClick={() => resolve('confirmed')}
                            whileTap={reduced ? undefined : { scale: 0.84 }}
                        >
                            <Check size={11} aria-hidden />
                        </CircleButton>
                        <CircleButton
                            $token={token}
                            type="button"
                            aria-label={`${t('common.cancel')} ${ariaActionLabel}`}
                            onClick={() => resolve('cancelled')}
                            whileTap={reduced ? undefined : { scale: 0.84 }}
                        >
                            <X size={11} aria-hidden />
                        </CircleButton>
                    </Panel>
                )}
            </AnimatePresence>
        </Root>
    )
}
