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

import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Popover } from 'antd'
import { ArrowUpOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import type { StopKind } from '@mobi/shared'
import { resolveStopPress, LONG_PRESS_MS, type SubmitButtonState } from './submitButtonState'

const spinKf = keyframes`
    to { transform: rotate(360deg); }
`

/**
 * 停止态外圈：旋转的 loading ring（轨道淡橙 + 顶部暖橙头）
 * 可见性 tuned：2.5→3px 边框、轨道 30%→35%——原参数太细太淡，用户感知不到"有动效"
 * 仅在方块态（非 abortPending）显示——abortPending 时 Button 自身 loading 转圈，
 * 双重转圈视觉冗余，故此时 $ring=false 隐藏光环
 */
const StopWrap = styled.span<{ $ring: boolean }>`
    position: relative;
    display: inline-flex;

    &::before {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        border: 3px solid color-mix(in srgb, var(--ant-color-warning) 35%, transparent);
        border-top-color: var(--ant-color-warning);
        animation: ${spinKf} 1s linear infinite;
        pointer-events: none;
        /* abortPending 时 Button 自身转圈，光环隐藏 */
        display: ${props => props.$ring ? 'block' : 'none'};
    }

    @media (prefers-reduced-motion: reduce) {
        &::before { animation: none; opacity: .5; }
    }
`

/** 停止图标：实心圆角方块（720/1024 ≈ 70%，原 600/1024 ≈ 58% 偏小） */
function SquareIcon() {
    return (
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style={{ width: '1em', height: '1em' }}>
            <rect fill="currentColor" height="720" rx="76" ry="76" width="720" x="152" y="152" />
        </svg>
    )
}

/** 三档菜单项（key 即 StopKind，顺序即档位递进） */
const STOP_KIND_ITEMS: ReadonlyArray<{ kind: StopKind; labelKey: string; descKey: string }> = [
    { kind: 'turn', labelKey: 'chat.stop.menu.turn', descKey: 'chat.stop.menu.turnDesc' },
    { kind: 'turn-queue', labelKey: 'chat.stop.menu.turnQueue', descKey: 'chat.stop.menu.turnQueueDesc' },
    { kind: 'turn-queue-tasks', labelKey: 'chat.stop.menu.turnQueueTasks', descKey: 'chat.stop.menu.turnQueueTasksDesc' },
]

/** 三档停止菜单（Popover content）：主标题 + 副标题说明，key 即 StopKind */
function StopKindMenu(props: { onPick: (kind: StopKind) => void }) {
    const { onPick } = props
    const { t } = useTranslation()
    return (
        <div style={{ minWidth: 240, padding: '4px 0' }} onClick={(e) => e.stopPropagation()}>
            <div style={{
                padding: '2px 12px 6px',
                fontSize: 12,
                color: 'var(--ant-color-text-tertiary)',
                userSelect: 'none',
            }}>
                {t('chat.stop.menu.title')}
            </div>
            <Menu
                selectable={false}
                onClick={({ key }) => onPick(key as StopKind)}
                items={STOP_KIND_ITEMS.map(({ kind, labelKey, descKey }) => ({
                    key: kind,
                    label: (
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.45, padding: '2px 0' }}>
                            <span>{t(labelKey)}</span>
                            <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>{t(descKey)}</span>
                        </div>
                    ),
                }))}
            />
        </div>
    )
}

export interface SubmitButtonProps {
    /** 按钮状态（由 resolveSubmitButtonState 推导） */
    state: SubmitButtonState
    /** 点击发送 */
    onSubmit: () => void
    /** 中止会话：入参为停止档位（点按=turn，长按菜单三选一，spec D1） */
    onAbort?: (stopKind: StopKind) => void
}

/**
 * 发送/停止合并按钮
 *
 * 由 state.kind 决定形态：
 * - send → 主色圆形 ↑（禁用态由 state.disabled 控制）
 * - stop → 主色圆形 + 方块 ■（变大）；点按只停本轮（'turn'），长按 500ms 弹三档菜单
 *   （Popover 全编程控制：pointerdown 起 timer，到阈值开菜单；触发长按后抑制释放 click）。
 *   方块态额外叠加外圈旋转光环传递"运行中"，abortPending 时光环隐藏（Button 自身 loading 转圈）
 *   + 禁用以防重复中止
 *
 * 不挂在 antd X Sender 的 disabled 上下文里，故请求权限期间（Sender disabled）仍可点击。
 */
export function SubmitButton(props: SubmitButtonProps) {
    const { state, onSubmit, onAbort } = props

    const stopState = state.kind === 'stop' ? state : null
    return (
        <>
            {state.kind === 'send' && (
                <Button
                    type="primary"
                    shape="circle"
                    icon={<ArrowUpOutlined />}
                    disabled={state.disabled}
                    onClick={onSubmit}
                />
            )}
            {stopState && (
                <StopButtonState
                    state={stopState}
                    onAbort={onAbort}
                />
            )}
        </>
    )
}

/** 停止态（独立组件承载长按时序的 state/refs，发送态零开销） */
function StopButtonState(props: { state: Extract<SubmitButtonState, { kind: 'stop' }>; onAbort?: (stopKind: StopKind) => void }) {
    const { state, onAbort } = props
    const { t } = useTranslation()

    // 三档菜单开合：全编程控制（trigger=[]），pointer 时序自管
    const [menuOpen, setMenuOpen] = useState(false)
    const wrapRef = useRef<HTMLSpanElement>(null)
    // pointerdown 时刻（null=无按 press 在途）；长按 timer；长按已触发标记（抑制释放 click）
    const downAtRef = useRef<number | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const longPressFiredRef = useRef(false)
    // pointerup 已自行处理 abort（click 消费该标记防双触发；null 时 click 走键盘兜底路径）
    const pointerHandledRef = useRef(false)

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }

    // 菜单开着时点外部关闭（trigger=[] 下 antd 不接管，外部点击需自监听；
    // Popover 内容挂在 portal 不在 wrapRef 内，靠 .ant-popover 祖先识别豁免——
    // 否则 mousedown 先关菜单，菜单项的 click 就再也收不到）
    useEffect(() => {
        if (!menuOpen) return
        const onDocMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (wrapRef.current?.contains(target)) return
            if (typeof target.closest === 'function' && target.closest('.ant-popover')) return
            setMenuOpen(false)
        }
        document.addEventListener('mousedown', onDocMouseDown)
        return () => document.removeEventListener('mousedown', onDocMouseDown)
    }, [menuOpen])

    // 卸载清 timer（防泄漏）
    useEffect(() => clearTimer, [])

    const startPress = (e: React.PointerEvent) => {
        // 只响应左键；abortPending（转圈禁用）时不可再触发停止
        if (e.button !== 0 || state.loading || state.disabled) return
        // 新按压即收起旧菜单（长按会再次弹出）
        setMenuOpen(false)
        downAtRef.current = Date.now()
        longPressFiredRef.current = false
        pointerHandledRef.current = false
        clearTimer()
        // 到阈值即开菜单（无需等释放）；触发长按后释放不再当点按
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            longPressFiredRef.current = true
            setMenuOpen(true)
        }, LONG_PRESS_MS)
    }

    const cancelPress = () => {
        // 按压中断（移出/系统取消）：撤 timer + 作废时长，释放不再触发任何停止
        clearTimer()
        downAtRef.current = null
    }

    const finishPress = () => {
        const startedAt = downAtRef.current
        cancelPress()
        if (longPressFiredRef.current) {
            longPressFiredRef.current = false
            // 长按释放：菜单保持打开，交由点选/点外部收场；
            // 吞掉随后合成的 click（否则 handleClick 的键盘兜底分支会误发 'turn' 中止）
            pointerHandledRef.current = true
            return
        }
        if (startedAt == null) return
        pointerHandledRef.current = true
        if (resolveStopPress(Date.now() - startedAt) === 'click') onAbort?.('turn')
    }

    const handleClick = () => {
        // pointerup 路径已处理（含点按 abort）→ 只吞掉这次 click 防双触发
        if (pointerHandledRef.current) {
            pointerHandledRef.current = false
            return
        }
        // 无 pointer 在途（键盘 Enter 聚焦触发）→ 兜底当点按
        if (downAtRef.current == null) onAbort?.('turn')
    }

    const pickStopKind = (kind: StopKind) => {
        setMenuOpen(false)
        onAbort?.(kind)
    }

    return (
        <span ref={wrapRef}>
            <Popover
                open={menuOpen}
                onOpenChange={setMenuOpen}
                trigger={[]}
                // spec D8：PC/移动统一 Popover，placement top（antd 自动翻转兜底底部溢出）
                placement="top"
                content={<StopKindMenu onPick={pickStopKind} />}
            >
                <StopWrap $ring={!state.loading} style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
                    <Button
                        type="primary"
                        shape="circle"
                        icon={<SquareIcon />}
                        aria-label={t('chat.stop.menu.title')}
                        loading={state.loading}
                        disabled={state.disabled}
                        onPointerDown={startPress}
                        onPointerUp={finishPress}
                        onPointerCancel={cancelPress}
                        onPointerLeave={cancelPress}
                        // 触屏长按的系统 contextmenu（放大镜/菜单）会打断 press 时序，抑制
                        onContextMenu={(e) => e.preventDefault()}
                        onClick={handleClick}
                    />
                </StopWrap>
            </Popover>
        </span>
    )
}
