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
 * 移动端底部 sheet（uiarc bottom-sheet 认领版，2026-10-13）。
 *
 * 底座：Radix Dialog（portal / 遮罩 / z-index 栈 / focus trap / 滚动锁 / Esc 只作用最上层
 * 都是它的）+ motion 自管位移。认领后即本地代码（registry.json 记 `adopted`），不再跟上游
 * 升级、也不维护「照单恢复」清单——改动直接写在下面。
 *
 * 与上游的差异（逐条都有理由，改前先读）：
 *  1. **内容自适应高度**：上游是「视口分数 detents + 折算出的固定盒高」，Mobi 的 sheet
 *     多是三五个按钮的矮面板，恒定 45dvh 会明显变形；改为 height:auto + maxHeight（默认
 *     85dvh，与旧底部抽屉同档）。上游那套按视口分数算的停靠点实现随之删除，**另按像素
 *     档位重建**（见第 7 条）：单一视口分数在矮面板上会把内容撑成空面板。
 *  2. **否决式关闭**：上游拖拽关闭是「先跑滑出动画、再 onClose」，父组件若否决（open 不
 *     翻转）sheet 就停在屏外且不可恢复。Mobi 有真消费者这么做（执行中的操作菜单、
 *     表单提交中等传 noop onClose）。这里改成「先通知后动画 + 两拍否决检测 + 沉降回原位」，
 *     与旧底部抽屉同一套时序（含连点防重入：宽限窗口内只保留最后一条检测链）。
 *  3. **手势返回哨兵**：Radix 没有 Android 返回键概念，用 useHistoryGuard 自接；哨兵存活期
 *     覆盖滑出动画窗口（关闭途中再返回仍被本 sheet 拦截而非穿透到路由），哨兵被消费但关闭
 *     被否决时重臂（guardEpoch），否则下一次返回会穿透。手势返回发起的正常关闭**不**重臂
 *     （见 useHistoryGuard 调用处：重臂会踩中 Chromium #330744614，真机表现为第二次返回退出 PWA）。
 *  4. **z-index 分层**：上游写死 overlay 50 / sheet 51，嵌套时子层遮罩压不住父层 sheet
 *     （父层 51 > 子层遮罩 50）。改为「打开时领号」：两元素各注入 --sheet-z / --sheet-z-top，
 *     号从 `ui/base/layout/overlayLayer` 的共享分配器领（**antd 原生浮层也用同一个分配器**，
 *     否则菜单里的 antd 操作菜单会压在菜单下面；基线 1080 见该文件）。
 *  5. **外壳形状对齐旧底部抽屉**（换掉组件不该换掉观感）：标题恒居中三栏 grid、新增
 *     extra 槽、可选关闭按钮（默认关——Mobi 的 sheet 靠下拉/点遮罩/返回关闭）、标题可传
 *     ReactNode 或省略、内容内衬归调用方（bodyStyle 透传）、文案走 i18n。
 *  6. 动效走 `ui/base/motion/presets` 的 spring（DESIGN.md 单源），不用上游 motionTokens
 *     自带的一套弹簧。
 *  7. **停靠点是像素档位**（票 04）：上游档位是视口分数（恒定 45dvh / 92dvh），矮面板会明显
 *     变形。这里改成「内容自适应 + 像素档位」：`full = min(内容高, maxHeight)`，peek 档位移
 *     `full − min(full, 45dvh)`；`full ≤ 45dvh` 时两档同值 → 退化成单档，矮面板观感与没有
 *     停靠点时完全一致。展开触发（滚内容 / 上推 / focus 到屏外元素 / 点把手）与落档判定
 *     （`resolveDetentRelease`：投影 + 快甩至少跨一档）都是 Mobi 版实现。
 *     **`peek={false}` 可整体关掉这条**（菜单、表单这类「一看就要看全」的面板：被裁掉的行对
 *     它们不是「还有更多」，是残缺）——peekY 恒为 0，与矮面板走同一条单档路径。
 */

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, usePresence, useReducedMotion, useTransform } from 'motion/react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { lockBodyScroll } from '@/ui/base/interactive/bodyScrollLock'
import { findScrollableInPath } from '@/ui/base/interactive/scrollableInPath'
import { spring } from '@/ui/base/motion/presets'
import { resolveDragDisposition } from '@/ui/base/interactive/resolveDragDisposition'
import { resolveDetentRelease } from '@/ui/base/interactive/resolveDetentRelease'
import { useHistoryGuard } from '@/core/hooks/useHistoryGuard'
import { nextOverlayLayer, retainOverlayLayer } from '@/ui/base/layout/overlayLayer'
import styles from './bottom-sheet.module.css'

/** 屏下延伸段：向上拉伸时底缘不露缝（CSS 的 bottom/padding-bottom 都按它算） */
const EXTENSION = 160
/** 滑出后额外多走一点，把浮起投影一起藏掉 */
const CLOSED_GAP = 40
/** 上拉橡皮筋的渐近上限（px） */
const STRETCH = 120
/** peek 档占视口高的比例：长内容先只露这么多，滚动/上推/点把手再展开到上限。
 *  内容高不超这一档时两档重合，等于没有 peek（矮面板观感不变） */
const PEEK_RATIO = 0.45
/** peek 档残留的遮罩强度：停在 peek 档时背景不亮到头（上游同值同义） */
const LOW_DIM = 0.78
/** 否决检测的第二拍宽限：首拍后 open 仍 true 时再等这一窗口，覆盖 startTransition /
 *  短异步消费者；仍 true 才判定否决（两段式：首拍覆盖同步消费者、宽限拍覆盖短异步消费者，见 scheduleVetoCheck） */
const VETO_GRACE_MS = 100
/** 内容区手势的方向判定阈值（px）：累计位移不到它就不表态。
 *  判定一旦落在「拖 sheet」上，后续每个 touchmove 都会被 preventDefault——真机手指落点带
 *  1~3px 抖动，按首帧判方向会把整段横向滑动（diff 的横向滚动）一并吞掉（2026-10-13 实测：
 *  首帧 2px 横 / 3px 纵即锁定，之后横移 155px 仍被 preventDefault）。 */
const GESTURE_SLOP_PX = 8

/** 无动画的卸载必须离开本次 commit：进离场 effect 跑在 React 的 commit 阶段，此刻
 *  AnimatePresence 还没把子级切到 exiting，同步调 safeToRemove 会被忽略——sheet 停在
 *  屏外永远不卸载（reduced-motion 与「已甩出屏外直卸载」两条路都踩过）。
 *  有动画的滑出天然没这问题：卸载由动画落定回调触发，本就在 commit 之后 */
const deferUnmount = (safeToRemove: () => void) => {
    queueMicrotask(safeToRemove)
}

/** 手势返回 / 下拉关闭无真实 DOM 事件，构造最小事件对象，避免上层 onClose 读
 *  stopPropagation/preventDefault 时 TypeError（与旧底部抽屉一致） */
const createSyntheticCloseEvent = () =>
    ({ stopPropagation() {}, preventDefault() {} }) as unknown as React.MouseEvent

/** iOS 式阻尼：先跟手，再渐近 STRETCH */
const rubber = (distance: number) => (1 - 1 / (distance * 0.55 / STRETCH + 1)) * STRETCH
const unrubber = (stretch: number) => (1 / (1 - Math.min(stretch, STRETCH - 1) / STRETCH) - 1) * STRETCH / 0.55

/**
 * 量 sheet 的可见高 = 盒高 − 屏下延伸段，**下界钳到 0**。
 * 盒高量不到时（jsdom / 首帧尚未布局）这个差值会是负的，负高度会污染后续一切按高度算的
 * 判据——位移阈值退化成「任何位移都算关闭」（实测：-160 时拖 30px 就关闭），滑出目标也变负。
 * 调用方在拿到 0 时要自行回退（视口高 / 上次测得的值）
 */
function visibleHeightOf(sheet: HTMLElement): number {
    return Math.max(0, sheet.offsetHeight - EXTENSION)
}

/**
 * peek 档的位移 = 内容高超出 peek 可见高的那部分（y = 0 是内容全可见位）。
 * 内容高不超 peek 档时归 0——矮面板两档重合，等于没有 peek。
 * 提成纯函数是因为遮罩强度（motion 的 useTransform 回调）也要用同一个值：
 * 两处各写一份必然会漂。
 */
function peekOffsetOf(full: number): number {
    return Math.max(0, full - Math.min(full, PEEK_RATIO * window.innerHeight))
}

type Drag = { startY: number; origin: number; moved: boolean; samples: { t: number; y: number }[] }

/** 释放速度：只看最近 80ms 的位移；松手前停顿会掉动量（慢而稳的释放落回原处） */
function velocityOf(samples: Drag['samples'], now: number) {
    const recent = samples.filter((sample) => now - sample.t <= 80)
    const first = recent[0]
    const last = recent[recent.length - 1]
    if (!first || !last || last === first || now - last.t > 60) return 0
    return (last.y - first.y) / ((last.t - first.t) / 1000)
}

/** 指针捕获：jsdom 与老浏览器可能不实现这两个方法（缺失时当作未捕获，拖拽仍走 window 通道） */
function hasPointerCapture(el: Element, pointerId: number): boolean {
    return typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(pointerId)
}
function setPointerCapture(el: Element, pointerId: number): void {
    if (typeof el.setPointerCapture !== 'function') return
    try {
        el.setPointerCapture(pointerId)
    } catch {
        /* 指针已经不在了 */
    }
}

export interface BottomSheetProps {
    /** 受控开关（无内部状态：否决式父组件保持 true 即可拦住关闭） */
    open: boolean
    /** 关闭通知。**先通知后动画**：调用后父组件应同步决定是否关闭；
     *  不翻转 open = 否决，sheet 沉降回原位（不是卡在屏外） */
    onClose?: (event?: React.MouseEvent) => void
    /** 标题（可省；省略时只留视觉隐藏的可访问名） */
    title?: ReactNode
    /** 标题行右侧操作（如保存按钮） */
    extra?: ReactNode
    /** 高度上限，默认 85dvh（内容更矮时按内容高） */
    maxHeight?: string
    /** 是否展示拖拽指示条，默认 true */
    showDragHandle?: boolean
    /** 是否展示右上关闭按钮，默认 false（Mobi 的 sheet 靠下拉/遮罩/手势返回关闭） */
    showClose?: boolean
    /**
     * 是否启用 peek 档（长内容先只露 45dvh，滚动/上推/点把手再展开），默认 true。
     * 传 false = 打开即到内容高（上限仍是 maxHeight）——「一看就要看全」的面板（菜单、表单）
     * 用它：被裁掉的行对它们不是「还有更多」，是纯粹的残缺。内容矮于 peek 档时两者等价。
     */
    peek?: boolean
    /** 关闭按钮 aria-label，缺省取 i18n 的 common.close */
    closeLabel?: string
    /** 内容区附加样式（内衬由调用方决定，组件默认不加 padding） */
    bodyStyle?: CSSProperties
    /** sheet 主体附加类 */
    className?: string
    children?: ReactNode
}

/**
 * 移动端底部 sheet。Radix Dialog 提供弹层语义，motion 自管位移；高度按内容自适应，
 * header 按下即可下拉关闭，遮罩随拖拽连续变暗。
 */
export function BottomSheet({
    open,
    onClose,
    title,
    extra,
    maxHeight = '85dvh',
    showDragHandle = true,
    showClose = false,
    peek = true,
    closeLabel,
    bodyStyle,
    className,
    children,
}: BottomSheetProps) {
    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (!next) requestCloseRef.current?.()
        },
        [],
    )

    // 关闭请求由内层 Sheet 实现（要读 motion 状态），Root 只负责把 Radix 的关闭意图
    // （Esc / 点遮罩 / Close 按钮）转给它。经 ref 中转避免每次渲染重建 Root 的回调
    const requestCloseRef = useRef<((velocity?: number) => void) | null>(null)

    return (
        // modal={false}：**不要 Radix 的滚动锁**（react-remove-scroll 用 document 级 touchmove
        // 判可滚性，只认浅 DOM，会 preventDefault 掉 shadow DOM 里的滚动区）。背景锁定由
        // Sheet 自己持有的 bodyScrollLock 承担；遮罩关闭、Esc、焦点都在本组件里显式接住
        <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal={false}>
            {/* 离场期间保持挂载（forceMount + AnimatePresence）：滑出动画播完才卸载，
                期间关闭被否决也能原地折返 */}
            <AnimatePresence>
                {open && (
                    <DialogPrimitive.Portal key="sheet" forceMount>
                        <Sheet
                            title={title}
                            extra={extra}
                            maxHeight={maxHeight}
                            showDragHandle={showDragHandle}
                            showClose={showClose}
                            peek={peek}
                            closeLabel={closeLabel}
                            bodyStyle={bodyStyle}
                            className={className}
                            onClose={onClose}
                            requestCloseRef={requestCloseRef}
                        >
                            {children}
                        </Sheet>
                    </DialogPrimitive.Portal>
                )}
            </AnimatePresence>
        </DialogPrimitive.Root>
    )
}

/** 停靠档位：peek = 长内容先露一截，top = 内容全可见（y = 0） */
type Detent = 'peek' | 'top'

type SheetProps = Omit<BottomSheetProps, 'open'> & {
    requestCloseRef: React.RefObject<((velocity?: number) => void) | null>
}

function Sheet({
    title,
    extra,
    maxHeight = '85dvh',
    showDragHandle = true,
    showClose = false,
    peek = true,
    closeLabel,
    bodyStyle,
    className,
    onClose,
    requestCloseRef,
    children,
}: SheetProps) {
    const { t } = useTranslation()
    const reduced = useReducedMotion() ?? false
    // 「在场」由 AnimatePresence 驱动：open 翻 false → isPresent 翻 false → 本组件启动
    // 滑出，落定后调 safeToRemove 才真正卸载
    const [isPresent, safeToRemove] = usePresence()
    // 层号一次领定（本实例生命周期内不变）：后挂载的子层号更大，压住父层
    // 层号从共享分配器领（含 antd 原生浮层那一族）：后打开的压在先打开的上面，见 overlayLayer.ts
    const [layerZ] = useState(() => nextOverlayLayer())
    useLayoutEffect(() => retainOverlayLayer(), [])
    // 背景滚动锁（自建，见 bodyScrollLock.ts）：挂载期间持有，覆盖进场/离场全程；
    // 嵌套 sheet 靠引用计数，最后一个卸载才恢复
    useEffect(() => lockBodyScroll(), [])
    // 初始焦点落在 sheet 本体（而不是第一个按钮）：读屏先读面板名，滚动位置也不跳。
    // modal={false} 下 Radix 不再自动聚焦（FocusScope 只在 modal 档跑），这里显式补上
    useEffect(() => {
        sheetRef.current?.focus({ preventScroll: true })
    }, [])

    const sheetRef = useRef<HTMLDivElement>(null)
    const bodyRef = useRef<HTMLDivElement>(null)
    /** 相对「全开位」的位移：0 = 全开，height + CLOSED_GAP = 出屏。
     *  起点远在屏下，首帧不会闪现 */
    const y = useMotionValue(4000)
    /** 可见高度（盒高 − 屏下延伸段）：位移与遮罩都按它算 */
    const height = useMotionValue(0)
    const presence = useMotionValue(1)

    const drag = useRef<Drag | null>(null)
    const mountedRef = useRef(false)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    /** 手势释放速度暂存：关闭是「先通知后动画」，父组件 setState 翻转 open 需一拍才
     *  触发滑出——速度经此传递，滑出继承释放动量；非手势路径为 null */
    const pendingVelocityRef = useRef<number | null>(null)
    /** 否决检测定时器：关闭接管时作废，卸载时清理（防对已分离的 MotionValue 起动画） */
    const vetoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** 哨兵已被 popstate 消费（本次关闭由手势返回发起）：消费后栈上已无本 sheet 的哨兵，
     *  滑出动画窗口内的第二次返回会穿透路由——关闭起手时要补一个（见滑出分支） */
    const guardConsumedRef = useRef(false)
    /** 重臂纪元：变化即重推哨兵 */
    const [guardEpoch, setGuardEpoch] = useState(0)
    /** 真人在场时刻（presence 变化点）：离场途中落在触发按钮上的点按不得再把 sheet 关一次 */
    const presenceChange = useRef({ present: isPresent, at: 0 })
    useLayoutEffect(() => {
        presenceChange.current = { present: isPresent, at: performance.now() }
    }, [isPresent])

    const closedY = useCallback(() => height.get() + CLOSED_GAP, [height])

    /** 档位：peek（长内容先露一截）→ top（内容全可见，y = 0）。
     *  两档重合时（peekY = 0，矮面板或 peek={false}）行为与单档完全一致 */
    const [detent, setDetent] = useState<Detent>('peek')
    const detentRef = useRef<Detent>('peek')
    /** peek 档位移（矮面板 / 关闭 peek 时为 0 → 打开即全开位） */
    const peekY = useCallback(() => (peek ? peekOffsetOf(height.get()) : 0), [height, peek])
    const detentY = useCallback((stop: Detent) => (stop === 'peek' ? peekY() : 0), [peekY])
    /** 是否真有 peek 档（内容高超出 peek 可见高）。渲染要走它：矮面板的把手不做交互开关，
     *  免得 aria-expanded 在两档同值时空转 */
    const [hasPeek, setHasPeek] = useState(false)

    /** 位移动画的唯一出口：reduced-motion 下直接跳 */
    const go = useCallback(
        (target: number, velocity?: number, onArrive?: () => void) => {
            if (reduced) {
                y.jump(target)
                onArrive?.()
                return undefined
            }
            const anim = animate(y, target, velocity === undefined ? spring.momentum : { ...spring.momentum, velocity })
            if (onArrive) anim.then(onArrive, onArrive)
            return anim
        },
        [reduced, y],
    )

    /** 落档：先切档位状态再跑位移——`data-expanded`（决定内容区可否滚动）与读屏播报
     *  必须立刻生效，等动画落定才切会让展开途中的内容闪一下 */
    const rest = useCallback(
        (next: Detent, velocity?: number) => {
            detentRef.current = next
            setDetent(next)
            go(detentY(next), velocity)
        },
        [detentY, go],
    )

    /** 展开到上限档（内容不超 peek 档时两档同值，等于空操作） */
    const expand = useCallback(() => {
        if (detentRef.current !== 'top') rest('top')
    }, [rest])

    /** 把手开关：在 peek / top 之间切换 */
    const toggleDetent = useCallback(() => {
        rest(detentRef.current === 'top' ? 'peek' : 'top')
    }, [rest])

    /** peek 档下内容区不可滚，滚动意图（滚轮下滚）即展开；用 4px 死区滤掉触控板的抖动 */
    const handleBodyWheel = useCallback(
        (event: React.WheelEvent<HTMLDivElement>) => {
            if (event.deltaY > 4) expand()
        },
        [expand],
    )

    /** peek 档下 focus 到「还在屏幕外」的元素（Tab / 键盘）也应当把 sheet 展开，
     *  否则焦点落在看不见的地方 */
    const handleBodyFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement>) => {
            const target = event.target
            if (detentRef.current === 'top' || !(target instanceof Element)) return
            if (target.getBoundingClientRect().bottom > window.innerHeight - 8) rest('top')
        },
        [rest],
    )

    // 遮罩强度是 sheet 位置的函数：拖拽中背景随之变亮/变暗，而不是按定时器淡入淡出。
    // 两段线性、在 peek 档处接续：y=0（全开）→ 1，到 peek 档 → LOW_DIM，再到滑出位 → 0。
    // 矮面板 peekY = 0 时退化成单段 1 → 0（观感与没有 peek 时一致）。
    // 两段必须首尾相接：上游把 peek 档折成 0 后照搬，首帧就从 1 跳到 LOW_DIM，拖拽一动手
    // 遮罩就亮一截（票 02 实测的亮度台阶）
    const backdrop = useTransform([y, height, presence], ([offsetY = 0, full = 0, shown = 0]: number[]) => {
        if (!full) return 0
        const low = peek ? peekOffsetOf(full) : 0
        const closed = full + CLOSED_GAP
        // 没有 peek 档（矮面板）时只有一段斜坡，起点必须是 1——否则又变成首帧台阶
        const dim =
            low <= 0
                ? 1 - offsetY / closed
                : offsetY <= low
                  ? 1 - (1 - LOW_DIM) * (offsetY / low)
                  : LOW_DIM * (1 - (offsetY - low) / (closed - low))
        return Math.min(1, Math.max(0, dim)) * shown
    })

    /** 沉降回**当前档**（否决 / 未跨档的拖拽释放共用）。不是「回 0」：从展开档
     *  下拉被否决时要回到 peek，跳到展开位会显得「弹回去了」 */
    const settleBack = useCallback(
        (velocity?: number) => {
            rest(detentRef.current, velocity)
        },
        [rest],
    )

    /** 否决检测调度：delayMs=0 是首拍，之后进宽限第二拍；宽限后仍 open=true 才沉降。
     *  句柄始终记在 vetoTimerRef（关闭接管 / 卸载时统一作废） */
    const scheduleVetoCheck = useCallback(
        function scheduleVeto(delayMs: number): ReturnType<typeof setTimeout> {
            return setTimeout(() => {
                vetoTimerRef.current = null
                if (!openRef.current) return
                if (delayMs === 0) {
                    vetoTimerRef.current = scheduleVeto(VETO_GRACE_MS)
                    return
                }
                const v = pendingVelocityRef.current
                // 沉降即消费掉暂存速度，防陈旧速度被后续关闭复用
                pendingVelocityRef.current = null
                settleBack(v ?? undefined)
                // 哨兵已被本次返回手势消费但关闭被否决：重臂覆盖仍开着的 sheet。
                // 仅「哨兵确实被消费」（手势返回发起）才重臂——点遮罩 / 拖拽释放发起的关闭被
                // 否决时哨兵仍在栈上，再推一条只会多压一条 entry
                const consumed = guardConsumedRef.current
                guardConsumedRef.current = false
                if (consumed) setGuardEpoch((epoch) => epoch + 1)
            }, delayMs)
        },
        [settleBack],
    )

    // 「父组件是否仍要它开着」= isPresent：open 翻 false 时 AnimatePresence 立刻把
    // presence 翻 false（即便组件还在播滑出动画）。否决判定必须读最新值——父组件
    // setState flush 之后才知道关没关，闭包捕获会读到旧值
    const openRef = useRef(true)
    openRef.current = isPresent

    /** 统一关闭入口：**先通知后动画**——立即 onClose，父组件翻转 open 后由滑出接管。
     *  倒转时序的原因与旧底部抽屉相同：否决式消费者（onClose 传 noop）在旧时序下会
     *  让 sheet 滑出屏后被拦下、停在屏外永不回来 */
    const requestClose = useCallback(
        (velocity?: number) => {
            pendingVelocityRef.current = velocity ?? null
            onCloseRef.current?.(createSyntheticCloseEvent())
            // 连点防重入（单链重启语义）：宽限窗口内的第二次关闭会再排一条检测链，旧链
            // 回调先置 vetoTimerRef=null 会 clobber 新链句柄，两条链先后触发 → 双份沉降
            // + 双份哨兵重臂。作废旧链只留最后一条——onClose 已再次通知过，检测的只是
            // 「最终是否被否决」，一条链足够
            if (vetoTimerRef.current != null) {
                clearTimeout(vetoTimerRef.current)
                vetoTimerRef.current = null
            }
            vetoTimerRef.current = scheduleVetoCheck(0)
        },
        [scheduleVetoCheck],
    )
    requestCloseRef.current = requestClose

    // 手势返回（iOS 边缘滑动 / Android 返回键 / 浏览器 back）关闭本 sheet 而非穿透到
    // 路由层。哨兵存活期 = 组件挂载期（含滑出动画窗口）；guardConsumedRef 记「本次关闭由
    // 手势返回发起」（哨兵已被 popstate 消费），供否决检测决定是否重臂。
    //
    // **为什么不做「滑出窗口重臂」（2026-10-13 删）**：早期实现于此在滑出起手再 push 一条
    // 哨兵覆盖动画窗口。真机上这踩中 Chromium #330744614——popstate 里再补 history entry，
    // 下一次返回既不来 popstate 也不来 navigate（真机 Navigation API 观测 `idx=4 hl=6`
    // 却零事件），浏览器直接把应用关掉。删掉后不需要它：按落点整段对齐的记账本就让第二次
    // 返回落到下一层哨兵并收起对应覆盖物（见 drawerHistoryGuard 文件头）。
    useHistoryGuard(
        true,
        () => {
            guardConsumedRef.current = true
            requestCloseRef.current?.()
        },
        guardEpoch,
    )

    // 卸载清理：作废否决检测定时器 + 摘掉交给 Root 的关闭入口（防卸载后仍被
    // onOpenChange 调到、对已分离的 MotionValue 起动画）
    useEffect(
        () => () => {
            if (vetoTimerRef.current != null) clearTimeout(vetoTimerRef.current)
            requestCloseRef.current = null
        },
        [requestCloseRef],
    )

    // 进场 / 离场 / 离场途中重开：都重定向同一个 motion value，从当前位置续上
    useLayoutEffect(() => {
        const sheet = sheetRef.current
        if (!sheet) return undefined

        if (!mountedRef.current) {
            mountedRef.current = true
            const measured = visibleHeightOf(sheet)
            height.set(measured)
            y.jump(closedY())
            setHasPeek(peek && peekOffsetOf(measured) > 0)
            if (reduced) presence.jump(0)
        }

        if (isPresent) {
            if (reduced) {
                y.jump(detentY(detentRef.current))
                animate(presence, 1, { duration: 0.16 })
                return undefined
            }
            presence.jump(1)
            // 进场不继承速度（父直调重开时暂存的甩动速度不得复用）
            pendingVelocityRef.current = null
            // 进场落**初始档**：长内容开在 peek（先露一截），矮面板 peekY = 0 即全开位
            go(detentY(detentRef.current))
            return undefined
        }

        // 离场：屏内则带速度滑出，落定卸载；已在屏外（拖拽已把 sheet 甩出去）直卸载。
        // 高度实测为准（内容可能已变，如虚拟按键编辑器），测不到再退回挂载时缓存的值、
        // 最后兜底视口高——保证 y 能滑出屏外而不是滞留在屏内
        const measured = visibleHeightOf(sheet)
        const visible = measured || height.get()
        if (y.get() < visible - 8) {
            const v = pendingVelocityRef.current
            pendingVelocityRef.current = null
            // 复位哨兵消费标记：**不再在滑出起手重臂**（见 useHistoryGuard 调用处的说明）——
            // 滑出窗口内的第二次返回由按落点对齐的记账处理：落到下一层哨兵即收下一层
            guardConsumedRef.current = false
            const target = (visible || window.innerHeight) + CLOSED_GAP
            if (reduced) {
                y.jump(target)
                deferUnmount(safeToRemove)
                return undefined
            }
            const anim = go(target, v ?? undefined, () => safeToRemove())
            return () => anim?.stop()
        }

        // 已出屏：直卸载。暂存速度一并清空——本分支不消费速度，残留会被下次父直调关闭
        // 误继承（旧甩动速度 → sheet 暴速滑出）
        pendingVelocityRef.current = null
        deferUnmount(safeToRemove)
        return undefined
    }, [closedY, detentY, go, height, isPresent, presence, reduced, safeToRemove, y])

    // 视口变化（旋转 / 移动端工具栏收起 / 内容增减）后重测高度，并把 sheet 重新对齐到
    // **当前档**——档位是像素值，内容一变 peekY 就变了，不重定位会停在半截位置
    useEffect(() => {
        const sheet = sheetRef.current
        if (!sheet || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => {
            const next = visibleHeightOf(sheet)
            if (next === height.get()) return
            const wasAtTop = detentRef.current === 'top'
            height.set(next)
            setHasPeek(peek && peekOffsetOf(next) > 0)
            if (drag.current || !isPresent) return
            // 展开档固定在 0，不需要动；peek 档要按新高度重算（内容变短到两档重合时归位）
            if (!wasAtTop) go(peekY())
        })
        observer.observe(sheet)
        return () => observer.disconnect()
    }, [go, height, isPresent, peekY])

    const beginDrag = useCallback(
        (clientY: number, time: number) => {
            // 抓在当前位置（动画途中也能抓住）；已拉伸的负位移换算回手指距离，避免跳变
            y.stop()
            const current = y.get()
            drag.current = {
                startY: clientY,
                origin: current < 0 ? -unrubber(-current) : current,
                moved: false,
                samples: [{ t: time, y: clientY }],
            }
        },
        [y],
    )

    const moveDrag = useCallback(
        (clientY: number, time: number) => {
            const state = drag.current
            if (!state) return
            const delta = clientY - state.startY
            if (!state.moved) {
                if (Math.abs(delta) < 3) return
                state.moved = true
                sheetRef.current?.setAttribute('data-dragging', '')
            }
            const raw = state.origin + delta
            // 下拖 1:1 跟手（可以甩出去关闭）；上拉无停靠点，只给阻尼
            y.set(raw < 0 ? -rubber(-raw) : raw)
            state.samples.push({ t: time, y: clientY })
            if (state.samples.length > 12) state.samples.shift()
        },
        [y],
    )

    const endDrag = useCallback(
        (time: number) => {
            const state = drag.current
            drag.current = null
            sheetRef.current?.removeAttribute('data-dragging')
            if (!state) return
            if (!state.moved) {
                settleBack()
                return
            }
            const current = y.get()
            // 已拉伸（负位移）的释放不继承速度，免得弹簧把 sheet 弹过拉伸极限
            const velocity = current < 0 ? 0 : velocityOf(state.samples, time)
            const full = height.get()
            if (!full) {
                // 高度不可测（首帧）：退回两档判定，避免档位表退化成「任何位移都算关闭」
                const disposition = resolveDragDisposition({ offset: current, velocity, height: window.innerHeight })
                if (disposition === 'close') {
                    requestCloseRef.current?.(velocity)
                    return
                }
                settleBack(velocity)
                return
            }
            // 三档：top(0) → peek → closed。两档重合时 peek 与 top 同值，等价于原来的两档判定
            const detents = [0, peekY(), closedY()]
            const from = detentRef.current === 'top' ? 0 : 1
            const landed = resolveDetentRelease({ offset: current, velocity, detents, from })
            if (landed === detents.length - 1) {
                requestCloseRef.current?.(velocity)
                return
            }
            const next: Detent = landed === 0 ? 'top' : 'peek'
            // 落档顺序有意为之：先切档位状态（data-expanded / 播报），再跑位移
            rest(next, velocity)
        },
        [closedY, height, peekY, rest, settleBack, y],
    )

    // 内容区手势仲裁：**落点的事件路径上还有可滚的容器**就把手势交给浏览器，否则拖动 sheet。
    // 判据走 `findScrollableInPath`（唯一的可滚性实现，穿透 shadow DOM，见该文件），不能只看
    // 内容区自己：工具卡里的 diff / 终端各自带一层小滚动区，内容区装得下它们时只看内容区会把
    // 手势抢走并 preventDefault——真机「工具详情里 diff / bash 输出横竖都滚不动」。
    // 锁滚档（peek，见 CSS 的 data-scroll-locked）是例外：那一档内容区纵向锁死（CSS 层也是
    // touch-action: pan-x），纵向上推＝展开、下拉＝回落/关闭，一律归 sheet；横向照常交回浏览器。
    useEffect(() => {
        const body = bodyRef.current
        if (!body) return undefined
        let gesture: { x: number; y: number; mode: 'pending' | 'sheet' | 'native' } | null = null
        const start = (event: TouchEvent) => {
            const touch = event.touches[0]
            gesture = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, mode: 'pending' } : null
        }
        const move = (event: TouchEvent) => {
            const touch = event.touches[0]
            if (!gesture || !touch || event.touches.length !== 1) return
            const dx = touch.clientX - gesture.x
            const dy = touch.clientY - gesture.y
            if (gesture.mode === 'pending') {
                // 位移不够不表态：按首帧判方向会被落点抖动带偏（见 GESTURE_SLOP_PX）
                if (Math.hypot(dx, dy) < GESTURE_SLOP_PX) return
                const locked = sheetRef.current?.hasAttribute('data-scroll-locked') ?? false
                const scrollable = locked ? null : findScrollableInPath(event.composedPath(), 'y', dy, body)
                gesture.mode = Math.abs(dy) >= Math.abs(dx) && !scrollable ? 'sheet' : 'native'
                if (gesture.mode === 'sheet') beginDrag(touch.clientY, event.timeStamp)
            }
            if (gesture.mode !== 'sheet') return
            if (event.cancelable) event.preventDefault()
            moveDrag(touch.clientY, event.timeStamp)
        }
        const end = (event: TouchEvent) => {
            if (gesture?.mode === 'sheet') endDrag(event.timeStamp)
            gesture = null
        }
        body.addEventListener('touchstart', start, { passive: true })
        body.addEventListener('touchmove', move, { passive: false })
        body.addEventListener('touchend', end)
        body.addEventListener('touchcancel', end)
        return () => {
            body.removeEventListener('touchstart', start)
            body.removeEventListener('touchmove', move)
            body.removeEventListener('touchend', end)
            body.removeEventListener('touchcancel', end)
        }
    }, [beginDrag, endDrag, moveDrag])

    // 滚动发丝线直接改属性，不进 React 状态（滚动不触发重渲染）
    useEffect(() => {
        const body = bodyRef.current
        const sheet = sheetRef.current
        if (!body || !sheet) return undefined
        const update = () => sheet.toggleAttribute('data-scrolled', body.scrollTop > 1)
        body.addEventListener('scroll', update, { passive: true })
        return () => body.removeEventListener('scroll', update)
    }, [])

    /** header 按下即拖动；落在按钮/链接/输入上时不接管（extra 槽与关闭按钮要能点） */
    function headerDown(event: ReactPointerEvent<HTMLDivElement>) {
        const target = event.target instanceof Element ? event.target : null
        if (event.button !== 0 || !event.isPrimary) return
        if (target?.closest("button, a, input, select, textarea, [role='button']")) return
        beginDrag(event.clientY, event.timeStamp)
        // 快速甩动可能在第一帧 move 落地前就离开 header：未捕获指针前由 window 接管，
        // 捕获后交回 header 自己的处理器
        const header = event.currentTarget
        const id = event.pointerId
        const outside = (next: PointerEvent) => next.pointerId === id && !(next.target instanceof Node && header.contains(next.target))
        const move = (next: PointerEvent) => {
            if (!outside(next) || !drag.current) return
            moveDrag(next.clientY, next.timeStamp)
            if (drag.current?.moved && !hasPointerCapture(header, id)) setPointerCapture(header, id)
        }
        const up = (next: PointerEvent) => {
            if (next.pointerId !== id) return
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', up)
            if (outside(next)) endDrag(next.timeStamp)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
    }

    function headerMove(event: ReactPointerEvent<HTMLDivElement>) {
        if (!drag.current) return
        if (event.pointerType === 'mouse' && event.buttons === 0) {
            endDrag(event.timeStamp)
            return
        }
        moveDrag(event.clientY, event.timeStamp)
        if (drag.current.moved && !hasPointerCapture(event.currentTarget, event.pointerId)) {
            setPointerCapture(event.currentTarget, event.pointerId)
        }
    }

    function headerUp(event: ReactPointerEvent<HTMLDivElement>) {
        if (hasPointerCapture(event.currentTarget, event.pointerId) && typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        endDrag(event.timeStamp)
    }

    // 标题恒居中三栏 grid；无标题时也渲染 Title（视觉隐藏）——Radix 要求 Content 内
    // 存在 Title 元素，否则报无障碍警告且读屏拿不到面板名
    const titleNode = title ?? <span className={styles.srOnly}>{t('common.panel')}</span>

    return (
        <>
            {/* 遮罩自己渲染：Radix 的 Overlay 在 modal={false} 下**根本不渲染**（源码里
                `context.modal ? <DialogOverlayImpl/> : null`），而遮罩的视觉、层级、随位移变暗
                本来就全归本组件。点它＝点在 Content 外部 → 走 DismissableLayer 的
                onPointerDownOutside 关闭（下面 Content 上挂着） */}
            <motion.div
                data-testid="bottom-sheet-overlay"
                className={styles.overlay}
                style={{ opacity: backdrop, ['--sheet-z' as string]: layerZ } as unknown as CSSProperties}
            />
            <DialogPrimitive.Content
                asChild
                forceMount
                // 本组件不渲染 Description：显式声明让 Radix 不再要求（面板名由 Title 承担）
                aria-describedby={undefined}
                // Esc 走统一关闭路径（否决可拦）
                onEscapeKeyDown={(event) => {
                    event.preventDefault()
                    requestCloseRef.current?.()
                }}
                // 点遮罩同理。Radix 判定「点在外部」要等 click 落地：离场途中落在触发按钮上
                // 的那一下会先重开 sheet，那一下不应再把它关掉（presence 时间戳判定）
                onPointerDownOutside={(event) => {
                    event.preventDefault()
                    const { present, at } = presenceChange.current
                    if (!present || event.detail.originalEvent.timeStamp < at) return
                    requestCloseRef.current?.()
                }}
            >
                <motion.div
                    ref={sheetRef}
                    data-testid="bottom-sheet-surface"
                    // 区域标注：dev-only layout-shift 归因观测器（core/lib/layoutShiftObserver）消费
                    data-perf-region="drawer"
                    // 内容区锁滚：只在「有两档且停在 peek 档」时锁（CSS 关掉 overflow 与
                    // touch-action），触摸只用来改档——两档共用一套 DOM，靠这个属性切换。
                    // **单档 sheet（矮内容 / peek={false}）不锁**：没有「下面还有内容」这回事，
                    // 锁了就变成「长菜单拉一下才能滚」（真机踩过）
                    data-scroll-locked={hasPeek && detent !== 'top' ? '' : undefined}
                    className={[styles.sheet, className].filter(Boolean).join(' ')}
                    style={
                        {
                            y,
                            opacity: presence,
                            '--sheet-extension': `${EXTENSION}px`,
                            '--sheet-max-height': maxHeight,
                                                    '--sheet-z-top': layerZ + 1,
                        } as unknown as CSSProperties
                    }
                    tabIndex={-1}
                >
                    <div className={styles.header} onPointerDown={headerDown} onPointerMove={headerMove} onPointerUp={headerUp} onPointerCancel={headerUp}>
                        {showDragHandle &&
                            (hasPeek ? (
                                // 有 peek 档时把手是真控件：点一下在两档间切换（键盘也可）
                                <button
                                    type="button"
                                    className={styles.grabber}
                                    data-grabber=""
                                    aria-expanded={detent === 'top'}
                                    aria-label={detent === 'top' ? t('common.collapseSheet') : t('common.expandSheet')}
                                    onClick={toggleDetent}
                                >
                                    <span className={styles.grabberBar} aria-hidden="true" />
                                </button>
                            ) : (
                                // 矮面板两档重合：把手只是视觉提示，不做交互开关
                                <div className={styles.grabber} aria-hidden="true">
                                    <span className={styles.grabberBar} />
                                </div>
                            ))}
                        <div className={styles.headRow}>
                            <div className={styles.headText}>
                                <DialogPrimitive.Title className={styles.title}>{titleNode}</DialogPrimitive.Title>
                            </div>
                            {(extra || showClose) && (
                                <div className={styles.headActions}>
                                    {extra}
                                    {showClose && (
                                        <DialogPrimitive.Close className={styles.close} aria-label={closeLabel ?? t('common.close')}>
                                            <X size={16} strokeWidth={1.75} aria-hidden="true" />
                                        </DialogPrimitive.Close>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div
                        ref={bodyRef}
                        className={styles.body}
                        style={bodyStyle}
                        onWheel={handleBodyWheel}
                        onFocus={handleBodyFocus}
                    >
                        {children}
                    </div>
                    {/* 档位变化的读屏播报（视觉上不可见）。矮面板没有档位可播，保持空 */}
                    <span className={styles.srOnly} role="status" aria-live="polite">
                        {hasPeek ? (detent === 'top' ? t('common.sheetExpanded') : t('common.sheetCollapsed')) : ''}
                    </span>
                </motion.div>
            </DialogPrimitive.Content>
        </>
    )
}

export default BottomSheet
