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
 * 画板载体（浮层）：
 * - 移动端 / PC 兜底：全屏（fixed inset 0）
 * - PC 停靠：composer 上方、宽对齐聊天列、高为消息列表的 70%（吊顶）
 * - PC 全屏：撑满整个内容区（全宽层），四边留 padding
 *
 * 单实例设计（2026-09-19 从 antd Drawer 迁出）：open 期间 DOM 子树常驻，
 * 停靠↔全屏只是几何（top/bottom/left/right）过渡，excalidraw 实例不销毁、
 * 由 ResizeObserver 连续跟随——真正的「调整窗口大小」式缩放。此前经 key
 * 重挂换容器（getContainer 不支持热切换）方案的三处硬伤：画布重建 + scene
 * 重载（闪 excalidraw 的 Loading scene）、初始测量被动画 transform 污染
 * （canvas 尺寸滞后追赶）、过渡只能缩放空壳（FLIP）。
 *
 * 防误关不变量（画到一半丢失不可接受）：mask 不绑定关闭、不监听 ESC、无 X
 * 关闭键，唯一出口是 header 的「取消/完成」（取消的非空二次确认在 SketchCanvas 内）。
 * 注意：刻意不用 MobileDrawer——它的下拉关闭手势与防误关不变量冲突。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button, Space, Tooltip } from 'antd'
import { Check, Maximize, Minimize, X } from 'lucide-react'
import { css, keyframes } from '@emotion/react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { SketchMark } from '@mobi/shared'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { SKETCH_MARK, sketchFilename } from '@/domain/sketch/sketchFile'
import { SketchCanvas, type SketchCanvasHandle } from './SketchCanvas'

export interface SketchDrawerProps {
    open: boolean
    onClose: () => void
    /**
     * 完成：产物为内嵌 scene 的单文件 PNG（调用方负责上传与附件装配）。
     * png 为 null = 场景无内容完成（空画布 / 重编辑后删光）：调用方按「无产物完成」
     * 处理——重编辑语义下等同删除旧附件，绝不上传空白图。
     */
    onComplete: (png: Blob | null, filename: string, sketchMark: SketchMark) => void
    /** 重编辑载入的草图 PNG；缺省 = 空白画布 */
    initialSketch?: Blob | null
    /**
     * 浮层挂载层 = 聊天内容区的全宽节点（position: relative）：停靠与全屏共用
     * 这一挂载点，浮层 absolute 定位相对它。缺省挂 body（fixed 全屏兜底）。
     */
    layerEl?: HTMLElement | null
    /**
     * PC 停靠几何（px，相对挂载层，由调用方测量维护）：底边贴 composer 顶边
     * （bottom），顶部为消息列表高度 × SKETCH_DOCK_HEIGHT_RATIO 的吊顶位（top，
     * 比例定义在 domain/sketch/sketchLayout），水平对齐聊天列（left/right）。
     * 缺省时停靠形态退化为层内全宽下半区。
     */
    dockMetrics?: { top: number; bottom: number; left: number; right: number } | null
}

/** PC 停靠形态兜底几何（无 dockMetrics 时）：层内全宽下半区 */
const DOCK_FALLBACK = { top: '30%', right: 0, bottom: 0, left: 0 } as const

/** 全屏浮层四边留白（用户指定：圆角浮层与内容区边缘的间隙） */
const FULLSCREEN_INSET = 8

/** 移动画纸卡片的缝隙：顶部露出一截聊天上下文（safe-area 优先），营造「聊天之上
 * 浮起一张纸」的层次，而非硬切盖板 */
const MOBILE_SHEET_INSET = 8

/** 停靠 ↔ 全屏几何过渡：四边 inset 均为像素值，全程可连续插值（像调整窗口大小） */
const MORPH_TRANSITION_CSS = 'top 280ms cubic-bezier(0.2, 0.8, 0.2, 1), right 280ms cubic-bezier(0.2, 0.8, 0.2, 1), bottom 280ms cubic-bezier(0.2, 0.8, 0.2, 1), left 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'

/** PC 开合：浮层从 composer 附近浮起/沉回（层不裁剪，位移过大会滑出层外穿帮） */
const SHEET_IN_KEYFRAMES = keyframes`
    from { transform: translateY(48px); opacity: 0 }
    to { transform: translateY(0); opacity: 1 }
`
const SHEET_OUT_KEYFRAMES = keyframes`
    from { transform: translateY(0); opacity: 1 }
    to { transform: translateY(48px); opacity: 0 }
`
/** 移动端开合：整张画纸从视口底部滑入/沉回（fixed 盖满自身，不会穿帮） */
const SHEET_IN_FULL_KEYFRAMES = keyframes`
    from { transform: translateY(100%) }
    to { transform: translateY(0) }
`
const SHEET_OUT_FULL_KEYFRAMES = keyframes`
    from { transform: translateY(0) }
    to { transform: translateY(100%) }
`
/** 移动端背景暗化的淡入/淡出 */
const MASK_IN_KEYFRAMES = keyframes`
    from { opacity: 0 }
    to { opacity: 1 }
`
const MASK_OUT_KEYFRAMES = keyframes`
    from { opacity: 1 }
    to { opacity: 0 }
`

/** 开合相位：enter 滑入中 / open 常驻 / exit 滑出中（结束后卸载） */
type SheetPhase = 'enter' | 'open' | 'exit'

/** 滑入/滑出动画时长：相位切换用定时驱动（不用 portal 内动画事件——经 React
 * 委托在部分环境收不到），卸载/复位定时按此兜底 */
const SHEET_IN_MS = 260
const SHEET_OUT_MS = 220

const Mask = styled.div<{ $zIndex: number; $dim: boolean; $phase: SheetPhase; $fixed: boolean }>`
    position: ${(p) => (p.$fixed ? 'fixed' : 'absolute')};
    inset: 0;
    /* PC：遮罩只挡交互不改视觉，背后消息保持原样可读（用户指定纯透明）；
     * 移动端：暗化背景，强化「浮起一张纸」的层次。均不绑定 click——防误关不变量 */
    background: ${(p) => (p.$dim ? 'rgba(0, 0, 0, 0.45)' : 'transparent')};
    z-index: ${(p) => p.$zIndex};
    ${(p) =>
        p.$dim && p.$phase === 'enter'
            ? css`
                  animation: ${MASK_IN_KEYFRAMES} ${SHEET_IN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
              `
            : ''}
    ${(p) =>
        p.$dim && p.$phase === 'exit'
            ? css`
                  animation: ${MASK_OUT_KEYFRAMES} ${SHEET_OUT_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards;
              `
            : ''}
`

const Sheet = styled.div<{
    $zIndex: number
    $phase: SheetPhase
    $morphing: boolean
    $fullSheet: boolean
}>`
    position: absolute;
    z-index: ${(p) => p.$zIndex};
    display: flex;
    flex-direction: column;
    background: transparent;
    ${(p) =>
        p.$phase === 'enter'
            ? css`
                  animation: ${p.$fullSheet ? SHEET_IN_FULL_KEYFRAMES : SHEET_IN_KEYFRAMES} ${SHEET_IN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
              `
            : ''}
    ${(p) =>
        p.$phase === 'exit'
            ? css`
                  animation: ${p.$fullSheet ? SHEET_OUT_FULL_KEYFRAMES : SHEET_OUT_KEYFRAMES} ${SHEET_OUT_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards;
              `
            : ''}
    ${(p) => (p.$morphing ? `transition: ${MORPH_TRANSITION_CSS};` : '')}
`

/* 圆角经 section + overflow hidden 裁切（sheet 层有过渡动画，圆角放这层会被拉伸）。
 * 圆角落 rounded.lg=14（卡片/Modal 档）；细边框画边界：dark 下深色画布与页面底色
 * 接近，靠它确认画板范围；抬升层底色用 paper-elevated（DESIGN.md 唯一允许净白的层） */
const Section = styled.div`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--ant-color-border);
    background: var(--ant-color-bg-elevated);
`

/* header 视觉对齐 drawer 惯例（标题 16/600 + hairline 分隔线），间距落 8 倍数刻度 */
const Header = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ant-color-split);

    .title {
        font-size: 16px;
        font-weight: 600;
    }
`

export function SketchDrawer({
    open,
    onClose,
    onComplete,
    initialSketch = null,
    layerEl = null,
    dockMetrics = null,
}: SketchDrawerProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()

    const [fullscreen, setFullscreen] = useState(false)
    // 开合相位机：open 挂载 enter → open；关闭先进入 exit 动画（「先通知后动画」，
    // onClose 消费者同步决定），动画结束才卸载——mounted 动画优先于卸载
    const [phase, setPhase] = useState<SheetPhase>(open ? 'enter' : 'exit')
    const [mounted, setMounted] = useState(open)
    // 完成/取消导出在途：header 出口按钮统一禁用，防连点重复导出
    const [exporting, setExporting] = useState(false)
    const canvasRef = useRef<SketchCanvasHandle>(null)

    // 移动端恒全屏（最大手指操作空间）；全屏切换仅 PC 提供
    const canFullscreen = !isMobile && !!layerEl

    // 开合相位机（见上）。全屏形态的复位放在卸载定时器里：关闭动画期间必须保持
    // 当前几何（先复位会让浮层跳回停靠位再淡出）
    const unmountTimerRef = useRef<number | null>(null)
    useEffect(() => {
        if (open) {
            if (unmountTimerRef.current !== null) window.clearTimeout(unmountTimerRef.current)
            setMounted(true)
            setPhase('enter')
            unmountTimerRef.current = window.setTimeout(() => setPhase('open'), SHEET_IN_MS + 40)
            return undefined
        }
        setPhase((p) => (p === 'exit' ? p : 'exit'))
        unmountTimerRef.current = window.setTimeout(() => {
            setMounted(false)
            setFullscreen(false)
        }, SHEET_OUT_MS + 40)
        return undefined
    }, [open])

    // 几何过渡窗口期：render 期从「fullscreen 与上次渲染不同」派生——transition
    // 必须与目标几何在同一次渲染中就位才能产生过渡（commit 后再置标记会先以无
    // transition 状态跳到新几何，动画丢失）。layout effect 在渲染完成后退出窗口期，
    // 此后环境重测（resize 等）带来的几何微调不会触发动画
    const prevFullscreenRef = useRef(fullscreen)
    const morphing = prevFullscreenRef.current !== fullscreen
    useLayoutEffect(() => {
        prevFullscreenRef.current = fullscreen
    }, [fullscreen])

    // 完成：经 canvas 手柄导出（null = 无内容完成，透传给调用方语义化处理），
    // 文件名/标记在此装配
    const handleComplete = useCallback(async () => {
        setExporting(true)
        try {
            const png = await canvasRef.current?.complete()
            onComplete(png ?? null, sketchFilename(), SKETCH_MARK)
        } catch {
            // 导出失败留在画布，用户可重试
        } finally {
            setExporting(false)
        }
    }, [onComplete])

    if (!mounted) return null

    // 几何（自上而下）：移动端 = 「浮起画纸」卡片（fixed，safe-area 缝隙 + 圆角，
    // 背景暗化）——全屏画布空间与聊天上下文锚点兼得；PC 停靠 → 层内聊天列区域
    // （贴 composer 顶、70% 吊顶、宽对齐聊天列）；PC 全屏 → 层内四边留白撑满；
    // 未挂层 → fixed 全屏兜底。停靠↔全屏四边均为像素/比例值，全部可连续插值
    const sheetStyle: CSSProperties = layerEl && !isMobile
        ? fullscreen
            ? { top: FULLSCREEN_INSET, right: FULLSCREEN_INSET, bottom: FULLSCREEN_INSET, left: FULLSCREEN_INSET }
            : (dockMetrics ?? DOCK_FALLBACK)
        : isMobile
            ? {
                position: 'fixed',
                top: `max(${MOBILE_SHEET_INSET}px, env(safe-area-inset-top))`,
                left: `${MOBILE_SHEET_INSET}px`,
                right: `${MOBILE_SHEET_INSET}px`,
                bottom: `max(${MOBILE_SHEET_INSET}px, env(safe-area-inset-bottom))`,
            }
            : { position: 'fixed', inset: 0 }

    const fullscreenLabel = t(fullscreen ? 'sketch.exitFullscreen' : 'sketch.fullscreen')

    return createPortal(
        <>
            <Mask $zIndex={1000} $dim={isMobile} $phase={phase} $fixed={isMobile} data-testid="sketch-mask" />
            <Sheet
                data-testid="sketch-sheet"
                $zIndex={1001}
                $phase={phase}
                $morphing={morphing}
                $fullSheet={isMobile}
                style={sheetStyle}
            >
                <Section>
                    <Header data-testid="sketch-header">
                        <span className="title">{t('sketch.open')}</span>
                        <Space size={4}>
                            {/* 仅 PC 且挂层可切全屏：移动端已全屏 */}
                            {canFullscreen && (
                                <Tooltip title={fullscreenLabel}>
                                    <Button
                                        type="text"
                                        size="small"
                                        aria-label={fullscreenLabel}
                                        icon={fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                                        onClick={() => setFullscreen((v) => !v)}
                                    />
                                </Tooltip>
                            )}
                            <Tooltip title={t('common.cancel')}>
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={t('common.cancel')}
                                    icon={<X size={16} />}
                                    disabled={exporting}
                                    onClick={() => canvasRef.current?.requestCancel()}
                                />
                            </Tooltip>
                            <Tooltip title={t('sketch.complete')}>
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={t('sketch.complete')}
                                    icon={<Check size={16} />}
                                    disabled={exporting}
                                    onClick={() => void handleComplete()}
                                />
                            </Tooltip>
                        </Space>
                    </Header>
                    <div style={{ flex: 1, minHeight: 0 }}>
                        {/* 压感默认恒为速度模拟（全设备手感一致）；触控笔真实压力通道留待用户偏好 */}
                        <SketchCanvas
                            ref={canvasRef}
                            initialSketch={initialSketch}
                            onCancel={onClose}
                        />
                    </div>
                </Section>
            </Sheet>
        </>,
        layerEl ?? document.body,
    )
}
