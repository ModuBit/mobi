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
 * 移动端底部抽屉组件
 * 统一行为：最大高度 85dvh、header 下拉手势关闭
 *
 * 动效采用「单向控制」架构：antd Drawer 的 wrapper transform 动画被 CSS 全程禁用，
 * sheet 的打开弹入 / 拖拽跟手 / 释放沉降 / 滑出关闭全部由内部 motion.div 自管；
 * antd 只提供 portal、mask 淡入淡出、z-index、a11y、history guard。
 * 内部把受控 open 转为半受控 mounted——关闭时滑出与卸载**并行**启动：
 * 所有关闭路径（手势释放 / 点遮罩 / 手势返回 / 父组件直调 setOpen(false)）统一
 * 先通知父组件，open 翻 false 后由关闭 effect 同时启动 spring 滑出与 antd leave
 * （mask 淡出），调用方零改动；否决式 onClose 消费者（如 loading 守卫传 noop）
 * 可拦住关闭，sheet 沉降回原位而非卡在屏外，且被消费的 history 哨兵会自动重臂
 * （防下一次返回手势穿透路由）；哨兵发起的关闭（手势返回）在滑出动画窗口内
 * 同样重臂哨兵——动画期间的第二次返回手势仍被本 drawer 拦截而非穿透路由。
 */

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'
import { Drawer, type DrawerProps } from 'antd'
import { Global, css } from '@emotion/react'
import styled from '@emotion/styled'
import { useHistoryGuard } from '@/core/hooks/useHistoryGuard'
import {
    motion,
    useDragControls,
    useMotionValue,
    animate,
    type PanInfo,
} from 'motion/react'
import { spring } from '@/components/motion/presets'
import { resolveDragDisposition } from './resolveDragDisposition'

/** 手势返回 / 下拉关闭无真实 DOM 事件，构造最小事件对象，
 *  避免上层 onClose 实现读取 stopPropagation/preventDefault 时 TypeError */
const createSyntheticCloseEvent = () =>
    ({ stopPropagation() {}, preventDefault() {} }) as unknown as React.MouseEvent

/** 挂在 drawer root 上的标记 class，用于把「禁用 wrapper 动画」精确圈定到本 drawer */
const WRAPPER_MOTION_OFF_CLASS = 'mobile-drawer-motion-off'

/** 否决检测第二拍宽限：首拍后 open 仍 true 时再等这一窗口，覆盖 startTransition /
 *  短异步消费者；仍 true 才判定否决（真正长异步才决定关闭属契约外，见 closeWithAnimation） */
const VETO_GRACE_MS = 100

// 单向控制：禁用 antd 的 panel motion（enter/leave 均）——sheet 全部位移动效由内部
// motion.div 自管，antd 只保留 portal / mask 淡入淡出 / a11y。
// ⚠️ 层级坑（真机采样实证）：antd v6 的 rootClassName 直接挂在 .ant-drawer 元素本身，
// wrapper 是它的直接子元素（两层），不是「root > .ant-drawer > wrapper」三层——曾按
// 三层写导致锁从未命中，antd leave 在 wrapper 上跑 translateY+opacity(→0.7) transition，
// 与 sheet 滑出叠加：sheet 关闭途中整体变 70% 半透明 = 真机「半透明残影」的根因。
// jsdom 不执行 CSS transition，单测无法暴露，须真机/CDP 采样验证。
// 选择器用 `.ant-drawer.mobile-drawer-motion-off`（同元素双类）精确圈定到本 drawer，
// 防止嵌套 drawer 时外层规则连带锁住内层（旧 #11 的教训）。
// opacity 一并锁 1：leave-active 的终态类会设 opacity 0.7，只锁 transition 的话
// 该值会无过渡地瞬时生效，仍是可见跳变。
// box-shadow 一并清零（真机踩坑）：antd v6 面板自带白色 elevation 阴影（向上投影
// rgba(255,255,255,…) 0px -6px 16px），它属于 wrapper 盒子——顶缘固定在 sheet
// 全开位置且**不随 sheet 拖拽/滑出位移**。拖拽中 sheet 移走后，这条白阴影叠在
// 深色 mask 上 = 真机「title 上方一条上下深浅不一的分界线」。wrapper 是被静默
// 的纯容器，视觉主体是内部 motion.div（sheet），不应有任何视觉残留
const wrapperMotionOff = css`
    .ant-drawer.${WRAPPER_MOTION_OFF_CLASS} > .ant-drawer-content-wrapper {
        transition: none !important;
        transform: none !important;
        opacity: 1 !important;
        animation: none !important;
        box-shadow: none !important;
    }
`

/** 拖拽指示条 */
const DragHandle = styled.div`
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--ant-color-text-quaternary);
    margin: 0 auto;
`

/**
 * 可拖拽的 header 区域
 * 占满整个 header 宽度，touch-action: none 阻止浏览器默认滚动
 */
const DraggableArea = styled.div`
    touch-action: none;
    user-select: none;
    cursor: grab;
    padding: 12px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid var(--ant-color-border-secondary);

    &:active {
        cursor: grabbing;
    }
`

/** 标题行：三栏 grid（1fr 内容 1fr）——标题恒居中，extra 靠右；
 *  两侧 1fr 平分剩余空间，标题与 extra 各占一栏，空间不足时标题省略号截断而非重叠 */
const TitleRow = styled.div`
    display: grid;
    grid-template-columns: 1fr minmax(0, auto) 1fr;
    align-items: center;
    min-height: 22px;
    font-weight: 500;
    font-size: 16px;
`

/** 居中标题：中栏 justify-self center；minmax(0, auto) 允许中栏收缩，超长省略号截断 */
const TitleText = styled.span`
    grid-column: 2;
    justify-self: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

/** 右侧 extra：右栏靠右，正常流布局 */
const TitleExtra = styled.span`
    grid-column: 3;
    justify-self: end;
`

export interface MobileDrawerProps extends Omit<DrawerProps, 'placement' | 'width' | 'height'> {
    /** 最大高度，默认 85dvh */
    maxHeight?: string
    /** 是否展示拖拽指示条，默认 true */
    showDragHandle?: boolean
}

/**
 * 移动端底部 Drawer
 * - 从底部弹出，最大高度 85dvh
 * - header 区域支持下拉手势关闭（motion 拖拽：跟手 + 速度继承 + 沉降/滑出）
 * - 顶部拖拽指示条提示可拖拽
 */
export function MobileDrawer({
    open,
    onClose,
    title,
    extra,
    maxHeight = '85dvh',
    showDragHandle = true,
    styles: propStyles,
    rootClassName,
    children,
    closable: _closable,
    ...rest
}: MobileDrawerProps) {
    const controls = useDragControls()
    const y = useMotionValue(0)
    const sheetRef = useRef<HTMLDivElement>(null)

    // onClose 用 ref 持有，避免父组件内联箭头每次渲染产生新引用导致 effect 重跑（重复 push 哨兵）
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // 半受控挂载：open=true 立即挂载；open=false 时由关闭 effect 启动滑出并同步翻
    // mounted=false（antd leave 与 motion 滑出并行），所有关闭路径统一滑出，调用方零改动
    const [mounted, setMounted] = useState(open === true)
    if (open && !mounted) {
        // open=true 立即挂载（React 官方「渲染期调整 state」模式，避免多等一帧 effect）
        setMounted(true)
    }

    // 哨兵存活期：**不绑 mounted**——关闭 effect 在滑出启动时就翻 mounted=false（并行
    // 卸载），若绑 mounted，哨兵会在滑出窗口起手即 dispose（queueMicrotask back()），
    // 其后 ~300ms 内的手势返回将穿透到路由层退出 session detail。guardAlive 覆盖
    // mounted 全程 + 滑出动画窗口，落定（或已出屏直卸载）才释放。
    const [guardAlive, setGuardAlive] = useState(open === true)
    if (open && !guardAlive) setGuardAlive(true)
    // 否决重臂纪元：手势返回消费了哨兵但关闭被否决（onClose 被拦、sheet 沉降回原位）
    // 时 +1，驱动 useHistoryGuard 重推哨兵——否则下一次返回手势将穿透到路由层
    const [guardEpoch, setGuardEpoch] = useState(0)

    // 哨兵是否已被 popstate 消费（本次关闭是否由手势返回发起）：消费后 drawerHistoryGuard
    // 栈上已无本 drawer 的哨兵，滑出动画窗口内的第二次返回手势会穿透到路由层——关闭
    // effect 据此在滑出起手时重臂一个哨兵覆盖动画窗口（见关闭 effect）。重臂（含否决
    // 后的重臂）后哨兵回到栈上，标记随之复位
    const guardConsumedRef = useRef(false)

    // mounted / open 经 ref 读取：关闭 effect 只依赖 [open]（setMounted 翻转后本 effect
    // 不需重跑，ref 读取避免依赖膨胀），openRef 用于 closeWithAnimation 的否决检测
    // （父组件 setState flush 后判断关闭是否被否决）
    const mountedRef = useRef(mounted)
    mountedRef.current = mounted
    const openRef = useRef(open)
    openRef.current = open

    // 手势释放速度暂存：closeWithAnimation「先通知后动画」，父组件 setState 翻转
    // open 需一拍后才触发关闭 effect——速度经此 ref 暂存传递，供关闭 effect 的
    // 滑出动画继承；非手势路径（点遮罩 / history guard）为 null
    const pendingCloseVelocityRef = useRef<number | null>(null)

    // 否决检测定时器：供关闭 effect（接管滑出时作废）与组件卸载清理，防止
    // 卸载后仍对已分离的 MotionValue 启动沉降动画
    const vetoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 统一关闭路径：**先通知后动画**——立即调 onClose，父组件 setOpen(false) 后由
    // 关闭 effect 从当前位置滑出屏（手势速度经 pendingCloseVelocityRef 暂存继承）。
    // 为什么倒转时序：存在否决式消费者（如 loading 守卫期间 onClose 传 noop），
    // 旧「先滑出后通知」会在滑出跑完后被 noop 拦下，父组件 open 保持 true 而
    // 依赖 [open, mounted, y] 的打开动画 effect 均未变化——sheet 永远停在屏外。
    // 先通知则否决天然可拦截；否决时（open 未翻转）由下方否决检测把 sheet 沉降回原位。
    // 完整时序：手势释放 → closeWithAnimation 同步调 onClose → 父组件 setState flush
    // （同一事件循环内）→ open=false 触发关闭 effect（useLayoutEffect，绘制前）→
    // 从当前拖拽位置带速度滑出 → 落定 setMounted(false)。
    // 手势释放（velocity 透传，px/s 向下为正）、点遮罩、history guard 返回全部走这里，
    // 与 iOS sheet 行为同构（点遮罩也是滑出）
    /** 否决检测调度：delayMs 为 0 时是首拍，之后进入宽限第二拍；宽限后仍 open=true 才沉降。
     *  定时器句柄始终记在 vetoTimerRef（关闭 effect 接管 / 组件卸载时统一作废） */
    const scheduleVetoCheck = useCallback(function scheduleVeto(delayMs: number): ReturnType<typeof setTimeout> {
        return setTimeout(() => {
            vetoTimerRef.current = null
            if (!openRef.current) return
            if (delayMs === 0) {
                vetoTimerRef.current = scheduleVeto(VETO_GRACE_MS)
                return
            }
            const v = pendingCloseVelocityRef.current
            // 沉降即消费掉暂存速度，防陈旧速度被后续关闭复用
            pendingCloseVelocityRef.current = null
            animate(y, 0, v != null ? { ...spring.momentum, velocity: v } : spring.momentum)
                .then(() => {}, () => {})
            // 哨兵已被本次返回手势消费但关闭被否决：重臂纪元 +1 驱动 useHistoryGuard
            // 重推哨兵，覆盖仍开着的 drawer——否则下一次返回手势将穿透到路由层。
            // 重臂后哨兵回到栈上，消费标记复位
            guardConsumedRef.current = false
            setGuardEpoch(e => e + 1)
        }, delayMs)
    }, [y])

    const closeWithAnimation = useCallback((velocity?: number) => {
        pendingCloseVelocityRef.current = velocity ?? null
        onCloseRef.current?.(createSyntheticCloseEvent())
        // 连点防重入（单链重启语义）：宽限窗口内的第二次 closeWithAnimation 会再排一条
        // 否决检测链，旧链的定时器回调先置 vetoTimerRef=null 会 clobber 新链句柄，两条链
        // 先后触发 → 双份沉降 + 双份哨兵重臂（history 额外 push/pop 一轮）。作废旧链只保留
        // 最后一条——onClose 已再次通知过，检测的只是「最终是否被否决」，一条链足够
        if (vetoTimerRef.current != null) {
            clearTimeout(vetoTimerRef.current)
            vetoTimerRef.current = null
        }
        // 否决检测（两段式）：关闭是否被否决（onClose 被拦、open 未翻转）只能等父组件
        // setState flush 后读 openRef 判断——
        // - 第一拍（setTimeout 0）：覆盖同步消费者。open 已翻 false 则关闭 effect 接管
        //   （其 clearTimeout 作废本检测），什么都不做
        // - 第二拍（宽限 VETO_GRACE_MS）：覆盖 startTransition / 短异步消费者——首拍时
        //   open 仍 true 但稍后翻 false 的场景。直接判否决会出现「沉降回原位 → 再滑出」
        //   的弹跳，且重臂的哨兵多压一条 entry
        // - 两拍后仍 open=true → 判定否决：沉降回原位 + 重臂哨兵
        // 真正长异步（> 宽限窗口）才决定关闭的消费者属契约外，仍会看到弹跳——
        // onClose 消费者应同步决定是否关闭。
        // 沉降动画带拒绝分支防 unhandled rejection（如被后续动画 stop 中断）——
        // animate 返回的控件类型只有 then（无 catch），用双参 then 兜住拒绝
        vetoTimerRef.current = scheduleVetoCheck(0)
    }, [y, scheduleVetoCheck])

    // closeWithAnimation 用 ref 持有：history guard effect 只依赖 open，
    // 避免回调引用变化导致哨兵反复 dispose/re-push（旧实现的教训）。
    // history guard 场景哨兵已被 popstate 消费，closeWithAnimation 立即 onClose
    //（时序上无动画延迟），不影响哨兵语义
    const closeWithAnimationRef = useRef(closeWithAnimation)
    closeWithAnimationRef.current = closeWithAnimation

    // 移动端全屏手势返回（iOS 边缘滑动 / Android 返回键 / 浏览器 back）应关闭 drawer，
    // 而非穿透到路由层退出 session detail。绑定 guardAlive（非 mounted，见其声明处说明）：
    // 覆盖 mounted 全程 + 滑出动画窗口，滑出落定才 dispose 弹掉。
    // closeWithAnimation 用 ref 持有：避免回调引用变化导致哨兵反复 dispose/re-push
    // （旧实现的教训），也保证嵌套 drawer 的栈序稳定；回调里先记 guardConsumedRef——
    // popstate 已消费栈中哨兵，关闭 effect 须知道「哨兵发起的关闭」滑出起手要重臂；
    // guardEpoch 是否决后的重臂纪元
    useHistoryGuard(guardAlive, () => {
        guardConsumedRef.current = true
        closeWithAnimationRef.current()
    }, guardEpoch)

    // 关闭 effect：open=false 时若 sheet 仍在屏内（closeWithAnimation 已通知父组件 /
    // 弹入中途 / 父组件直调 setOpen(false)），启动 spring 滑出，**同时立即**翻 mounted
    // 让 antd Drawer 进入 leave——mask 淡出与 sheet 滑出并行（串行会出现「sheet 已滑走、
    // 半透明 mask 再慢慢淡出」的残影，真机踩过）。antd leave 期间内容 DOM 保留（leave
    // 结束才加 -hidden），sheet 滑出全程可见；wrapper transform 已被 CSS 锁静止不受影响。
    // 已出屏（y 距屏外 h 不足 8px，如拖拽已把 sheet 拽出屏的释放路径）则直接卸载。
    // 判据用「y.get() < h - 8」而非 y.get() > 8：滑出落定时 y 恰等于 h（仍 > 8），
    // 后者会把已出屏误判为在屏内再跑一次 h→h 空动画
    useLayoutEffect(() => {
        if (open || !mountedRef.current) return undefined
        // 关闭已接管（父组件已翻 open=false）：否决检测定时器作废——沉降不应再发生。
        // 这同时消除异步关闭场景的误判窗口：若父组件 setOpen(false) 有延迟（await /
        // startTransition），旧实现在定时器触发时会误判否决、把 sheet 沉降回屏内，
        // 随后关闭 effect 再滑出，出现「弹回再弹走」的跳变
        if (vetoTimerRef.current != null) {
            clearTimeout(vetoTimerRef.current)
            vetoTimerRef.current = null
        }
        // 读取并复位哨兵消费标记：手势返回发起的关闭，drawerHistoryGuard 栈上已无本
        // drawer 的哨兵（popstate 已消费）——「滑出动画窗口内返回仍被本 drawer 拦截」的
        // 不变量对其不成立，须在滑出起手时重臂一个哨兵补上（见下方 slide-out 分支）。
        // 非哨兵路径（点遮罩 / 拖拽释放 / 父直调）哨兵仍在栈上，无需重臂
        const guardConsumed = guardConsumedRef.current
        guardConsumedRef.current = false
        // 滑出目标高度：实测为准；panel 异常不可测（0，见打开动画 effect 的时序说明）
        // 时兜底视口高——保证 y 能滑出屏外而非滞留屏内
        const h = sheetRef.current?.offsetHeight || window.innerHeight
        if (y.get() < h - 8) {
            // 消费 closeWithAnimation 暂存的手势速度：手势路径带速度滑出（释放动量连续），
            // 父直调路径暂存为 null 用纯 spring。启动即清空，防陈旧速度被后续关闭复用
            const v = pendingCloseVelocityRef.current
            pendingCloseVelocityRef.current = null
            // anim 仅用于 cleanup stop（关闭途中重开 / 组件卸载时终止）；
            // 落定回调无需再卸载——mounted 已在此处翻转
            const anim = animate(y, h, v != null ? { ...spring.momentum, velocity: v } : spring.momentum)
            setMounted(false)
            if (guardConsumed) {
                // 重臂哨兵覆盖滑出动画窗口（guardEpoch +1 驱动 useHistoryGuard 重推）：
                // 动画期间第二次手势返回仍消费哨兵 → closeWithAnimation → onClose 幂等，
                // 而非穿透路由退出 session detail。落定 setGuardAlive(false) 时 disposer
                // 会把这个重臂的哨兵经 history.back() 弹掉，history 净变化为零。
                // 重开（openRef 已 true）时哨兵仍须存活，交由打开路径继续持有
                setGuardEpoch(e => e + 1)
            }
            anim.then(
                () => { if (!openRef.current) setGuardAlive(false) },
                () => { if (!openRef.current) setGuardAlive(false) },
            )
            return () => anim.stop()
        }
        // 已出屏：直接卸载，哨兵随之释放。暂存的手势速度一并清空——本分支不消费速度
        //（sheet 已在屏外，无需动画），残留会被后续重开的父直调关闭误继承
        //（旧甩动速度 → sheet 暴速滑出的跳变）
        pendingCloseVelocityRef.current = null
        setGuardAlive(false)
        setMounted(false)
        return undefined
    }, [open, y])

    // 卸载清理否决检测定时器：防止卸载后仍对已分离的 MotionValue 启动沉降动画
    useEffect(() => () => {
        if (vetoTimerRef.current != null) clearTimeout(vetoTimerRef.current)
    }, [])

    // 打开动画：sheet 从屏外弹入（spring.ui）；antd wrapper 已被 CSS 静默。
    // ⚠️ 起点用视口高而非 sheetRef.offsetHeight（CDP 实证踩坑）：antd v6 panel 的
    // 挂载/可测时序晚于本 effect——首开时 panel 尚未挂载（ref 为 null），重开时
    // panel 处于 leave 后的 hidden 态（display:none 子树，offsetHeight 恒 0），
    // 实测两条路径都让 h 退化 0 → y.set(0) + animate(0→0) 瞬时完成 = 「打开无
    // 动画直接展示」。改用视口高：① 恒 ≥ 85dvh 上限，起点必在屏外；② 与测量
    // 时序彻底解耦——motion.div 挂载时以 y 当前值渲染，弹入自然衔接。
    // 依赖含 mounted（真正挂载后才能弹入）与 open（关闭途中重开时
    // mounted 未翻转，靠 open 翻转重新触发弹入）
    useLayoutEffect(() => {
        if (!open || !mounted) return
        y.set(window.innerHeight)
        const anim = animate(y, 0, spring.ui)
        return () => anim.stop()
    }, [open, mounted, y])

    const handleDragEnd = useCallback((
        _e: MouseEvent | TouchEvent | PointerEvent,
        info: PanInfo,
    ) => {
        const height = sheetRef.current?.offsetHeight ?? 0
        // 拖拽中途 ref 失效（offsetHeight 0）时直接放弃判定：
        // 否则位置阈值退化为 offset > 0，微小位移也会误判为关闭
        if (!height) return
        const disposition = resolveDragDisposition({
            offset: info.offset.y,
            velocity: info.velocity.y,
            height,
        })
        if (disposition === 'close') {
            // 统一关闭路径：立即 onClose + 暂存手势速度，父组件翻转 open 后由
            // 关闭 effect 带速度滑出（继承手势速度）
            closeWithAnimation(info.velocity.y)
        } else {
            // 沉降回原位：同样继承手势速度
            animate(y, 0, { ...spring.momentum, velocity: info.velocity.y })
        }
    }, [y, closeWithAnimation])

    // 合并 wrapper styles（antd 5.x 运行时支持 styles.wrapper，类型为 stylesAndFn 联合，
    // 这里仅处理对象式配置，函数式由 antd 内部消费）
    const userStyles = typeof propStyles === 'object' ? propStyles : undefined
    const mergedStyles = {
        ...propStyles,
        // antd v6：原 styles.content 已改名 styles.section（DOM 为 .ant-drawer-section）。
        // 顶部圆角与背景已移入内部 motion.div（视觉 sheet 主体），section 仅保留
        // overflow hidden 裁切 + 透明背景（防 antd 默认底色从圆角外露出）
        section: {
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            overflow: 'hidden',
            background: 'transparent',
            ...userStyles?.section,
        },
        wrapper: {
            height: 'auto',
            maxHeight,
            ...userStyles?.wrapper,
        },
        body: {
            display: 'flex',
            flexDirection: 'column',
            ...userStyles?.body,
            // 布局不变量，禁止调用方覆盖：body 是透明层（padding 会把 sheet 抬离屏底、
            // 露出 mask = 「距底空隙」），纵向 padding 统一由 sheet 的 paddingBottom
            // 承载；overflow/maxHeight 保证把手固定 + 内容区自滚（说明见声明处）
            padding: 0,
            overflow: 'hidden',
            // 同为不变量：body 必须与 wrapper 同值 maxHeight。antd 的 .ant-drawer-section /
            // content-wrapper 自带 overflow:auto，但 body 处在 auto 高度链上不会跟着 wrapper 收缩——
            // 不限高时溢出部分会由 section 滚动（把手在其内部，随内容滚走）。
            // 限高后 body 成为受限的 flex 列，溢出下沉到内容区滚，把手固定
            maxHeight,
        },
    } as DrawerProps['styles']

    const finalRootClassName = [rootClassName, WRAPPER_MOTION_OFF_CLASS]
        .filter(Boolean).join(' ') || undefined

    return (
        <>
            <Global styles={wrapperMotionOff} />
            <Drawer
                open={mounted}
                // 点遮罩 / closable 关闭也走统一路径：立即把关闭通知给父组件，
                // 父组件翻转 open 后由关闭 effect 滑出屏。
                // 不能直接传 closeWithAnimation——antd 会把 MouseEvent 作为首参传入，
                // 被误当成 velocity 参数；箭头包装确保无速度继承
                onClose={() => closeWithAnimation()}
                placement="bottom"
                title={null}
                closable={false}
                styles={mergedStyles}
                rootClassName={finalRootClassName}
                {...rest}
            >
                {/* 视觉 sheet 主体：背景 + 圆角 + 全部位移动效都在这里，
                    antd 的 wrapper 只是被 CSS 静默的容器 */}
                <motion.div
                    ref={sheetRef}
                    data-testid="mobile-drawer-sheet"
                    drag="y"
                    dragListener={false}
                    dragControls={controls}
                    // 上边界（top: 0）越界由 dragElastic 阻尼跟动 = rubber-band；
                    // 下边界放到 10000px，实际不约束 = 下拖 1:1 跟手
                    dragConstraints={{ top: 0, bottom: 10000 }}
                    dragElastic={0.2}
                    // 释放后的沉降/滑出由 handleDragEnd 显式 animate 接管（带速度继承），
                    // 关掉 motion 内建惯性，避免两套动画对 y 的双向拉扯
                    dragMomentum={false}
                    onDragEnd={handleDragEnd}
                    style={{
                        y,
                        display: 'flex',
                        flexDirection: 'column',
                        // ⚠️ 不能用 height:'100%'：body 只有 maxHeight 没有确定 height
                        //（height:auto），CSS 规范下子级百分比高度退化 auto——CDP 实测
                        // 内容超限时 sheet 被撑到内容全高（2449px > 85dvh=690），
                        // contentArea 跟着全高（无可滚空间），溢出被 body 的
                        // overflow:hidden 直接裁掉 = 「内容多看不到」。改 flex 收缩：
                        // flex:1 让 sheet 填满 body 的钳制高度，minHeight:0 解除
                        // flex item 默认 min-height:auto 的「不收缩」限制
                        flex: '1 1 0%',
                        minHeight: 0,
                        // 底部 safe-area 由组件统一收口：sheet 背景含 padding 铺到屏幕底
                        // （不透 mask 露「空隙」），内容避让 home indicator。此前由各调用方
                        // 往 body 传 paddingBottom——body 是透明层，padding 会把 sheet 抬离
                        // 屏底、露出深色 mask = 真机「drawer 距底部一段空隙」
                        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
                        background: 'var(--ant-color-bg-container)',
                        borderTopLeftRadius: 12,
                        borderTopRightRadius: 12,
                    }}
                >
                    {/* 自定义 header：拖拽区域，pointerdown 启动 sheet 拖拽 */}
                    <DraggableArea onPointerDown={(e) => controls.start(e)}>
                        {showDragHandle && <DragHandle />}
                        {(title || extra) && (
                            <TitleRow>
                                {title != null && <TitleText>{title}</TitleText>}
                                {extra && <TitleExtra>{extra}</TitleExtra>}
                            </TitleRow>
                        )}
                    </DraggableArea>

                    {/* 内容区域：minHeight:0 同 sheet——没有它 flex item 不会收缩到
                        内容高度以下，长内容会把 sheet 撑爆而非出滚动条 */}
                    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {children}
                    </div>
                </motion.div>
            </Drawer>
        </>
    )
}
