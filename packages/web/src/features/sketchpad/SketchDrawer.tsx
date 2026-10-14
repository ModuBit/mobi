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
 * 关闭语义（2026-10-14 与其它移动浮层统一）：头部下拉 / ESC / 点遮罩 / 手势返回
 * 四条通道**都走同一条取消入口**（`requestDismiss` → 画布内的 `requestCancel`），
 * 脏数据由取消的二次确认兜底、净则直接走。此前「唯一出口是 header 的取消/完成」
 * 的防误关不变量已放弃——它与「浮层该有的关闭心智」冲突，且确认框已经拦住了误触丢作品
 * 的唯一真实损失（画到一半的内容）。**画板仍刻意不用 BottomSheet 组件本身**：它需要
 * 自管几何（停靠测量 / 全屏切换 / morph 过渡），而共用的是壳（`sheetSurface`）+ 手势与
 * 层号那几件小事（`lockBodyScroll` / `useHistoryGuard` / `overlayLayer`）。
 *
 * 开合动画与 stacking 约定：滑沉消隐——出场原地微沉一小段距离 + 淡出，入场反向
 * （升起归位 + 淡入），整层不发生穿越位移（早先的整片下滑会从 composer 周边透明
 * 缝隙中穿出，视觉穿帮）。PC 保持 100–103 阶梯（停靠 < composer < 全屏）：浮层是页内
 * 临时层，不得盖过 antd 抽屉/对话框；移动端形态与其它移动浮层一样**领层号**
 * （overlayLayer，后开者在上）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button, Tooltip } from 'antd'
import { Check, Maximize, Minimize } from 'lucide-react'
import { css, keyframes } from '@emotion/react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { SketchMark } from '@mobi/shared'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useHistoryGuard } from '@/core/hooks/useHistoryGuard'
import { SKETCH_MARK, sketchFilename } from '@/domain/sketch/sketchFile'
import { SKETCH_MORPH_MS, SKETCH_SHEET_IN_MS, SKETCH_SHEET_OUT_MS, SKETCH_DOCK_GAP, SKETCH_Z_MASK, sketchSheetZIndex } from '@/domain/sketch/sketchLayout'
import { lockBodyScroll } from '@/ui/base/interactive/bodyScrollLock'
import { useVetoableClose } from '@/ui/base/interactive/useVetoableClose'
import { useOpenOverlayLayer } from '@/ui/base/layout/overlayLayer'
import { SheetGrabber, SheetHeader, SheetIconButton, sheetClass, sheetSurfaceClass } from '@/ui/base/layout/sheetSurface'
import { PULL_SETTLE_EASING, PULL_SETTLE_MS, useHeaderPullClose } from './useHeaderPullClose'
import { SketchCanvas, type SketchCanvasHandle } from './SketchCanvas'

export interface SketchDrawerProps {
    open: boolean
    onClose: () => void
    /**
     * 完成：产物为内嵌 scene 的单文件 PNG（调用方负责上传与附件装配）。
     * - png 为 null = 场景无内容完成（空画布 / 重编辑后删光）：调用方按「无产物完成」
     *   处理——重编辑语义下等同删除旧附件，绝不上传空白图。
     * - png 为 'unchanged' = 内容相对打开时无修改（重编辑未动笔）：调用方直接关闭，
     *   保留原附件，无需导出上传。
     */
    onComplete: (png: Blob | null | 'unchanged', filename: string, sketchMark: SketchMark) => void
    /** 重编辑载入的草图 PNG；缺省 = 空白画布 */
    initialSketch?: Blob | null
    /**
     * 浮层挂载层 = 聊天内容区的全宽节点（position: relative）：停靠与全屏共用
     * 这一挂载点，浮层 absolute 定位相对它。缺省挂 body（fixed 全屏兜底）。
     */
    layerEl?: HTMLElement | null
    /**
     * PC 停靠几何（px，相对挂载层，由调用方测量维护）：底边距 composer 顶边 SKETCH_DOCK_GAP
     * （bottom），顶部为消息列表高度 × SKETCH_DOCK_HEIGHT_RATIO 的吊顶位（top，
     * 比例定义在 domain/sketch/sketchLayout），水平对齐聊天列（left/right）。
     * 缺省时停靠形态退化为层内全宽下半区。
     */
    dockMetrics?: { top: number; bottom: number; left: number; right: number } | null
}

/** PC 停靠形态兜底几何（无 dockMetrics 时）：层内全宽下半区（底边同样留 SKETCH_DOCK_GAP 一缝） */
const DOCK_FALLBACK = { top: '30%', right: 0, bottom: SKETCH_DOCK_GAP, left: 0 } as const

/** 全屏浮层四边留白（用户指定：圆角浮层与内容区边缘的间隙） */
const FULLSCREEN_INSET = 8

/** 移动画纸卡片的缝隙：顶部露出一截聊天上下文（safe-area 优先），营造「聊天之上
 * 浮起一张纸」的层次，而非硬切盖板 */
const MOBILE_SHEET_INSET = 8

/** 停靠 ↔ 全屏几何过渡：四边 inset 均为像素值，全程可连续插值（像调整窗口大小）。
 *  时长单源 sketchLayout（画布 settle 定时从它派生，改这里自动跟随），
 *  曲线与下拉回位同一档（PULL_SETTLE_EASING）——浮层里所有几何过渡一个语言 */
const MORPH_TRANSITION_CSS = (['top', 'right', 'bottom', 'left'] as const)
    .map(prop => `${prop} ${SKETCH_MORPH_MS}ms ${PULL_SETTLE_EASING}`)
    .join(', ')

/** 开合动画：滑沉消隐——出场原地微沉一段小距离 + 淡出（纸片「沉降归于页面」），
 *  入场为其时间反演（自下方升起归位 + 淡入）。位移量小（8%），全程不接触 composer，
 *  不存在穿过其透明缝隙的穿帮；移动端全屏形态同一对 keyframes。时长单源 sketchLayout
 *  （同一段曲线正放/倒放，出入场天然对称）
 *
 *  退场的起点取自 `--sheet-drag-y`（不是写死的 0）：下拉关闭时浮层已经跟着手指下去了一段，
 *  退场必须**从那继续**——写死 0 会先弹回原位再滑出，看着像「松手没生效」。没有下拉时该
 *  变量是 0，等于原行为 */
const SHEET_SINK_OFFSET = '8%'
const SHEET_IN_KEYFRAMES = keyframes`
    from { transform: translateY(${SHEET_SINK_OFFSET}); opacity: 0 }
    to { transform: translateY(0); opacity: 1 }
`
const SHEET_OUT_KEYFRAMES = keyframes`
    from { transform: translateY(var(--sheet-drag-y, 0px)); opacity: 1 }
    to { transform: translateY(${SHEET_SINK_OFFSET}); opacity: 0 }
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

/** 滑入/滑出动画时长：单源在 domain/sketch/sketchLayout（与画布 settle 定时、测量方共享），
 *  相位切换用定时驱动（不用 portal 内动画事件——经 React 委托在部分环境收不到） */
const SHEET_IN_MS = SKETCH_SHEET_IN_MS
const SHEET_OUT_MS = SKETCH_SHEET_OUT_MS

const Mask = styled.div<{ $zIndex: number; $dim: boolean; $phase: SheetPhase; $fixed: boolean }>`
    position: ${(p) => (p.$fixed ? 'fixed' : 'absolute')};
    inset: 0;
    z-index: ${(p) => p.$zIndex};
    ${(p) =>
        p.$dim && p.$phase === 'enter'
            ? css`
                  animation: ${MASK_IN_KEYFRAMES} ${SHEET_IN_MS}ms cubic-bezier(0.23, 1, 0.32, 1);
              `
            : ''}
    ${(p) =>
        p.$dim && p.$phase === 'exit'
            ? css`
                  animation: ${MASK_OUT_KEYFRAMES} ${SHEET_OUT_MS}ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
              `
            : ''}
`

/* 位置与层号在本地（壳不拥有定位）：PC 是宿主层内 absolute，移动端是 fixed。
   开合动画与停靠↔全屏过渡同样归本地；「面」（圆角/描边/底色/阴影/裁切）来自壳 */
const Sheet = styled.div<{
    $zIndex: number
    $phase: SheetPhase
    $morphing: boolean
}>`
    position: absolute;
    z-index: ${(p) => p.$zIndex};
    /* 下拉位移的唯一通道：手势写 --sheet-drag-y，跟手、退场续上、被否决时回位都走它
       （写 inline transform 会和退场关键帧打架，见 SHEET_OUT_KEYFRAMES） */
    transform: translateY(var(--sheet-drag-y, 0px));
    /* 松手后的回位过渡 + 停靠↔全屏的几何过渡（两条互不重叠：前者移动端、后者 PC） */
    transition: transform ${PULL_SETTLE_MS}ms ${PULL_SETTLE_EASING}${(p) => (p.$morphing ? `, ${MORPH_TRANSITION_CSS}` : '')};
    /* 跟手期间必须无过渡（有就是黏滞感）：由载体在拖拽中挂上 data-dragging（见 applyPull） */
    &[data-dragging] {
        transition: none;
    }
    ${(p) =>
        p.$phase === 'enter'
            ? css`
                  animation: ${SHEET_IN_KEYFRAMES} ${SHEET_IN_MS}ms cubic-bezier(0.4, 0, 0.2, 1);
              `
            : ''}
    ${(p) =>
        p.$phase === 'exit'
            ? css`
                  animation: ${SHEET_OUT_KEYFRAMES} ${SHEET_OUT_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
              `
            : ''}
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
    const sheetRef = useRef<HTMLDivElement>(null)

    // 移动端恒全屏（最大手指操作空间）；全屏切换仅 PC 提供
    const canFullscreen = !isMobile && !!layerEl

    // ── 关闭语义（四条通道 → 同一条取消入口）──
    // 拖拽的沉降动作来自手势钩子，而钩子又要调取消入口 —— 用 ref 打破这个环
    // （钩子内部已用 ref 持有回调，这里只补一层间接）
    const dismissRef = useRef<() => void>(() => {})
    /**
     * 手势把「当前拖拽态」写到这里，**不进 React state**：一次下拉 60~120 个 pointermove，
     * 进 state 就是每帧重渲整棵浮层树（这层还挂着 excalidraw）。只动一个 CSS 变量与一个属性，
     * 与 BottomSheet 用 motion values 绕开重渲是同一个理由。
     */
    const applyPull = useCallback((offset: number, dragging: boolean) => {
        const sheet = sheetRef.current
        if (!sheet) return
        sheet.style.setProperty('--sheet-drag-y', `${offset}px`)
        if (dragging) sheet.setAttribute('data-dragging', '')
        else sheet.removeAttribute('data-dragging')
    }, [])
    const { settle: settlePull, handlers: pullHandlers } = useHeaderPullClose({
        // 只有移动端贴底形态有下拉语义（PC 是停靠矩形）
        enabled: mounted && isMobile,
        // 复位认 open 的上升沿（不是 enabled）：退场动画期间 mounted 仍为真，见钩子文档
        open,
        onPullClose: () => dismissRef.current(),
        // 量不到（尚未布局）时退回视口高：退回 0 会让「判据 = 高度 / 3」恒成立，任何滑动都关
        measureHeight: () => sheetRef.current?.getBoundingClientRect().height || window.innerHeight,
        applyPull,
    })

    // 否决检测 / 连点防重入 / 哨兵重臂的记账全在 useVetoableClose（关闭契约的单一实现，
    // 与 BottomSheet 共用）；本层只提供「被否决时沉到哪」——沉回原位（默认 0）
    const { request: requestVeto, markGuardConsumed, guardEpoch } = useVetoableClose({
        open,
        onVetoed: settlePull,
    })

    /**
     * 统一取消入口：下拉 / ESC / 点遮罩 / 手势返回都走它。取消是否真的发生（脏数据要先过
     * 二次确认）由画布决定，这里只负责通知与「否决后回位」。
     */
    const requestDismiss = useCallback(() => {
        canvasRef.current?.requestCancel()
        requestVeto()
    }, [requestVeto])
    dismissRef.current = requestDismiss

    // 手势返回（iOS 边缘滑动 / Android 返回键）收画板而不是退出页面。移动端专属（桌面
    // back 语义不同，且 PC 是页内停靠层）。重臂纪律由 useVetoableClose 守着：**不在滑出起手
    // 重臂**——popstate 里再补 entry 会踩中 Chromium #330744614，真机表现为下一次返回直接退出 PWA
    useHistoryGuard(mounted && isMobile, () => {
        markGuardConsumed()
        requestDismiss()
    }, guardEpoch)

    // ESC 走同一条：只认没被内层消费掉的 ESC（`defaultPrevented`）——画布自己的 ESC 语义
    // （取消当前图形 / 取消选择 / 退出文本编辑）优先级更高，抢过来会让「按 ESC 想撤销一笔」
    // 变成「弹出放弃确认」。取消确认框开着时同样让路（否则 ESC 关掉确认框后又被重新弹出）
    //
    // **必须截住这一记 ESC（stopPropagation）**：取消确认框是**同步**弹出来的（本处理器跑在
    // document 冒泡相，`requestCancel` 里 modal.confirm 立刻渲染），而 rc 系弹层的全局 ESC
    // 监听挂在 **window** 上（`@rc-component/portal/useEscKeyDown`，window 是冒泡路径的最后一站）。
    // 于是确认框挂载时装上监听，紧接着就被**同一记** ESC 关掉——弹出与关闭在同一帧里先后发生，
    // 真机表现是「按 ESC 什么都没发生」（实测：modal root 出现后 60ms 开始退场）。rc-dialog
    // 自己的 onEsc 也这么处理（见 DialogWrap：`event.stopPropagation()`）。
    //
    // 弹层已经在上时（isConfirmOpen 早退）不截——那一记 ESC 就该交给确认框自己收。
    useEffect(() => {
        if (!mounted) return undefined
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
            if (canvasRef.current?.isConfirmOpen()) return
            event.stopPropagation()
            requestDismiss()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [mounted, requestDismiss])

    // 背景滚动锁：用钉 body 的方式（不碰触摸事件），滚动区归属仍交回浏览器——
    // 与其它浮层同一套（见 bodyScrollLock 文档）
    useEffect(() => (mounted ? lockBodyScroll() : undefined), [mounted])

    // 层号：移动端与其它移动浮层同一套（后开者在上）；PC 保持 100–103 阶梯——
    // 那是页内临时层，不得盖过 antd 抽屉/对话框（见 sketchLayout 的阶梯说明）
    const mobileLayerZ = useOpenOverlayLayer(mounted && isMobile)

    // 开合相位机（见上）。enter/exit 定时器共用一个 ref 槽位——开合切换时必须清掉
    // 未触发的旧定时器（close 不清 enter 定时器会在 exit 动画中途把 phase 打回 open，
    // 中断退出动画导致浮层停滞后跳变消失）。全屏形态的复位放在卸载定时器里：关闭动画
    // 期间必须保持当前几何（先复位会让浮层跳回停靠位再淡出）；动画期内重开则按停靠
    // 形态打开（open 分支主动复位 fullscreen）
    const unmountTimerRef = useRef<number | null>(null)
    useEffect(() => {
        if (unmountTimerRef.current !== null) {
            window.clearTimeout(unmountTimerRef.current)
            unmountTimerRef.current = null
        }
        if (open) {
            setMounted(true)
            setPhase('enter')
            setFullscreen(false)
            unmountTimerRef.current = window.setTimeout(() => setPhase('open'), SHEET_IN_MS + 40)
            return undefined
        }
        setPhase('exit')
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

    // 完成：经 canvas 手柄导出。undefined = 画布未就绪（编辑器初始化/场景载入中）——
    // 忽略本次完成，绝不能与 null（场景就绪且无内容）混同：重编辑语义下 null = 删除
    // 附件，会把有内容的附件静默删掉；'unchanged' = 未动笔，原样透传给调用方（免上传）
    const handleComplete = useCallback(async () => {
        setExporting(true)
        try {
            const png = await canvasRef.current?.complete()
            if (png === undefined) return
            onComplete(png, sketchFilename(), SKETCH_MARK)
        } catch {
            // 导出失败留在画布，用户可重试
        } finally {
            setExporting(false)
        }
    }, [onComplete])

    if (!mounted) return null

    // 几何（自上而下）：移动端 = 贴底 sheet（左右与底贴屏、上半圆角、顶边留一缝 + 底部
    // 安全区内衬）——与其它移动浮层同一形状语言（原「四周留缝的浮起画纸」已弃）；
    // PC 停靠 → 层内聊天列区域（贴 composer 顶、70% 吊顶、宽对齐聊天列）；
    // PC 全屏 → 层内四边留白撑满；未挂层 → fixed 全屏兜底。
    // 停靠↔全屏四边均为像素/比例值，全部可连续插值
    const sheetStyle: CSSProperties = layerEl && !isMobile
        ? fullscreen
            ? { top: FULLSCREEN_INSET, right: FULLSCREEN_INSET, bottom: FULLSCREEN_INSET, left: FULLSCREEN_INSET }
            : (dockMetrics ?? DOCK_FALLBACK)
        : isMobile
            ? {
                position: 'fixed',
                top: `max(${MOBILE_SHEET_INSET}px, env(safe-area-inset-top))`,
                left: 0,
                right: 0,
                bottom: 0,
                // 画布不吃 home indicator 那条：底部内衬让出去（贴底形态下底边没有缝隙兜底）
                paddingBottom: `max(${MOBILE_SHEET_INSET}px, env(safe-area-inset-bottom))`,
            }
            : { position: 'fixed', inset: 0 }

    const fullscreenLabel = t(fullscreen ? 'sketch.exitFullscreen' : 'sketch.fullscreen')

    /* header 工具条上的按钮与图标钮同高（一条工具条三种控件不该有三种高度）：
       移动端取 40 与图标钮的触达档对齐，PC 取紧凑的 32 */
    const headerControlHeight = isMobile ? 40 : 32

    // 层号：移动端领号（先领到的在下面，后开者在上，与其它移动浮层同一套）；PC 走阶梯。
    // 遮罩与面差一号（同层内面压在遮罩上），与 BottomSheet 的 --sheet-z / --sheet-z-top 同构
    const maskZ = mobileLayerZ ?? SKETCH_Z_MASK
    const sheetZ = mobileLayerZ ? mobileLayerZ + 1 : sketchSheetZIndex({ mobile: isMobile, fullscreen, hasLayer: !!layerEl })

    return createPortal(
        <>
            <Mask
                className={sheetClass.mask}
                $zIndex={maskZ}
                $dim={isMobile}
                $phase={phase}
                $fixed={isMobile}
                /* 壳的 .mask[data-state='closed'] 靠它放行指针：离场那一段遮罩还在屏上
                   （面在播退场动画），不写就是把落点吞掉一整个动画时长；点在那 8px 边条上
                   还会再触发一次 requestDismiss */
                data-state={phase === 'exit' ? 'closed' : 'open'}
                /* 底色来自壳的 .mask（同一套 token）；PC 只挡交互不改视觉——把壳的
                   默认档就地换成透明，背后消息保持原样可读。
                   移动端点遮罩走同一条取消入口；PC 不接（停靠态遮罩只是挡交互，点它关闭会误伤） */
                style={isMobile ? undefined : ({ '--sheet-mask-bg': 'transparent' } as CSSProperties)}
                onClick={isMobile ? requestDismiss : undefined}
                data-testid="sketch-mask"
            />
            <Sheet
                ref={sheetRef}
                className={sheetSurfaceClass(isMobile ? 'bottom' : 'floating')}
                data-testid="sketch-sheet"
                /* z 序：移动端领号（盖过一切页内层，与其它移动浮层同序）；PC 按形态取档
                   （全屏三种形态盖过 composer、停靠保持 101）——PC 是页内临时层，
                   不得盖过 antd 抽屉/对话框 */
                $zIndex={sheetZ}
                $phase={phase}
                $morphing={morphing}
                /* 位置/尺寸走 style；下拉位移与拖拽标记由 applyPull 直接写 DOM（见上） */
                style={sheetStyle}
            >
                <SheetHeader
                    data-testid="sketch-header"
                    layout="toolbar"
                    /* 画布不滚 → 壳的 data-scrolled 显线规则永不触发：头部与画布之间要一道常驻界 */
                    data-bordered=""
                    /* 可拖 = 移动端（PC 是停靠矩形，没有下拉语义）：壳据此给抓取光标与
                       touch-action，并在这里接手势处理器 */
                    data-draggable={isMobile ? '' : undefined}
                    {...(isMobile ? pullHandlers : null)}
                    grabber={isMobile ? <SheetGrabber /> : undefined}
                    leading={(
                        <Tooltip title={t('common.cancel')}>
                            <Button
                                type="text"
                                size="small"
                                disabled={exporting}
                                style={{ minHeight: headerControlHeight }}
                                onClick={() => canvasRef.current?.requestCancel()}
                            >
                                {t('common.cancel')}
                            </Button>
                        </Tooltip>
                    )}
                    trailing={(
                        <>
                            {/* 仅 PC 且挂层可切全屏：移动端已全屏；与完成同侧但非破坏动作，误触无害 */}
                            {canFullscreen && (
                                <Tooltip title={fullscreenLabel}>
                                    <SheetIconButton
                                        label={fullscreenLabel}
                                        bordered={false}
                                        icon={fullscreen
                                            ? <Minimize size={16} strokeWidth={1.75} aria-hidden="true" />
                                            : <Maximize size={16} strokeWidth={1.75} aria-hidden="true" />}
                                        onClick={() => setFullscreen((v) => !v)}
                                    />
                                </Tooltip>
                            )}
                            <Button
                                type="primary"
                                size="small"
                                icon={<Check size={14} strokeWidth={2} />}
                                loading={exporting}
                                /* 与图标钮同高（见 headerControlHeight） */
                                style={{ minHeight: headerControlHeight }}
                                onClick={() => void handleComplete()}
                            >
                                {t('sketch.complete')}
                            </Button>
                        </>
                    )}
                />
                <div style={{ flex: 1, minHeight: 0 }}>
                    {/* 压感默认恒为速度模拟（全设备手感一致）；触控笔真实压力通道留待用户偏好 */}
                    <SketchCanvas
                        ref={canvasRef}
                        initialSketch={initialSketch}
                        onCancel={onClose}
                    />
                </div>
            </Sheet>
        </>,
        layerEl ?? document.body,
    )
}
