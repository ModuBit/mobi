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
 * 内部把受控 open 转为半受控 mounted——「动画优先于卸载」：
 * 所有关闭路径（手势释放 / 点遮罩 / 手势返回 / 父组件直调 setOpen(false)）
 * 统一先通知父组件、父组件翻转 open 后由关闭 effect 滑出屏再卸载，调用方零改动；
 * 否决式 onClose 消费者（如 loading 守卫传 noop）可拦住关闭，sheet 沉降回原位而非卡在屏外。
 */

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from 'react'
import { Drawer, type DrawerProps } from 'antd'
import { Global, css } from '@emotion/react'
import styled from '@emotion/styled'
import { pushHistoryGuard } from '@/core/lib/drawerHistoryGuard'
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

// 单向控制：禁用 antd wrapper 的 transform 动画（enter/leave 均不再位移），
// sheet 全部动效由内部 motion.div 自管；antd 只保留 portal / mask 淡入淡出 / a11y。
// 常驻规则（非仅手势期间）——打开动画同样由 motion 呈现，彻底避免双向拉扯。
// 精确匹配自身层级（.ant-drawer-content-wrapper 在 root 的 drawer 直下），
// 防止嵌套 drawer 时外层规则连带锁住内层（旧 #11 的教训）。
const wrapperMotionOff = css`
    .${WRAPPER_MOTION_OFF_CLASS} > .ant-drawer > .ant-drawer-content-wrapper {
        transition: none !important;
        transform: none !important;
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

    // 半受控挂载：open=true 立即挂载；open=false 时若 sheet 仍在屏内（弹入中途 /
    // 父组件直调 setOpen(false)），先 spring 滑出再卸载——「动画优先于卸载」，
    // 所有关闭路径统一滑出，调用方零改动。已出屏则立即卸载（手势路径无额外等待）
    const [mounted, setMounted] = useState(open)
    if (open && !mounted) {
        // open=true 立即挂载（React 官方「渲染期调整 state」模式，避免多等一帧 effect）
        setMounted(true)
    }

    // mounted / open 经 ref 读取：关闭 effect 只依赖 [open]（setMounted 由动画落定回调
    // 异步触发，mounted 进依赖会在落定后反复重跑关闭 effect），openRef 用于动画落定时
    // 判断「关闭途中是否已被重开」
    const mountedRef = useRef(mounted)
    mountedRef.current = mounted
    const openRef = useRef(open)
    openRef.current = open

    // 手势释放速度暂存：closeWithAnimation「先通知后动画」，父组件 setState 翻转
    // open 需一拍后才触发关闭 effect——速度经此 ref 暂存传递，供关闭 effect 的
    // 滑出动画继承；非手势路径（点遮罩 / history guard）为 null
    const pendingCloseVelocityRef = useRef<number | null>(null)

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
    const closeWithAnimation = useCallback((velocity?: number) => {
        pendingCloseVelocityRef.current = velocity ?? null
        onCloseRef.current?.(createSyntheticCloseEvent())
        // 否决检测：为什么用 setTimeout(0)——要等父组件 setState flush 后读 openRef
        // 才能判断关闭是否被否决。若仍为 true（onClose 被 loading 守卫等拦下），
        // 说明关闭 effect 不会运行，把 sheet 沉降回原位而非卡在屏外；
        // 若已翻 false 则什么都不做（关闭 effect 已接管滑出）。
        // 沉降动画带拒绝分支防 unhandled rejection（如被后续动画 stop 中断）——
        // animate 返回的控件类型只有 then（无 catch），用双参 then 兜住拒绝
        setTimeout(() => {
            if (!openRef.current) return
            const v = pendingCloseVelocityRef.current
            // 沉降即消费掉暂存速度，防陈旧速度被后续关闭复用
            pendingCloseVelocityRef.current = null
            animate(y, 0, v != null ? { ...spring.momentum, velocity: v } : spring.momentum)
                .then(() => {}, () => {})
        }, 0)
    }, [y])

    // closeWithAnimation 用 ref 持有：history guard effect 只依赖 open，
    // 避免回调引用变化导致哨兵反复 dispose/re-push（旧实现的教训）。
    // history guard 场景哨兵已被 popstate 消费，closeWithAnimation 立即 onClose
    //（时序上无动画延迟），不影响哨兵语义
    const closeWithAnimationRef = useRef(closeWithAnimation)
    closeWithAnimationRef.current = closeWithAnimation

    // 移动端全屏手势返回（iOS 边缘滑动 / Android 返回键 / 浏览器 back）应关闭 drawer，
    // 而非穿透到路由层退出 session detail。挂载时推一个同 URL history 哨兵：
    // 手势返回消费哨兵 → 先滑出动画再 onClose；卸载（含父直调关闭的滑出落定后）时
    // dispose 弹掉哨兵——哨兵跟随真实可见性（挂载推、卸载弹），滑出动画期间保持存活
    useEffect(() => {
        if (!mounted) return
        const dispose = pushHistoryGuard(() => {
            closeWithAnimationRef.current()
        })
        return dispose
    }, [mounted])

    // 关闭 effect：open=false 时若 sheet 仍在屏内（closeWithAnimation 已通知父组件 /
    // 弹入中途 / 父组件直调 setOpen(false)），先 spring 滑出再卸载——「动画优先于卸载」；
    // 已出屏（y 距屏外 h 不足 8px，如拖拽已把 sheet 拽出屏的释放路径）则立即卸载，
    // 手势路径零额外等待。
    // 判据用「y.get() < h - 8」而非 y.get() > 8：滑出落定时 y 恰等于 h（仍 > 8），
    // 后者会把已出屏误判为在屏内再跑一次 h→h 空动画
    useLayoutEffect(() => {
        if (open || !mountedRef.current) return undefined
        const h = sheetRef.current?.offsetHeight ?? 0
        if (y.get() < h - 8) {
            // 消费 closeWithAnimation 暂存的手势速度：手势路径带速度滑出（释放动量连续），
            // 父直调路径暂存为 null 用纯 spring。启动即清空，防陈旧速度被后续关闭复用
            const v = pendingCloseVelocityRef.current
            pendingCloseVelocityRef.current = null
            const anim = animate(y, h, v != null ? { ...spring.momentum, velocity: v } : spring.momentum)
            anim.then(
                () => {
                    // 落定时 open 已翻回 true（关闭途中重开）则不卸载
                    if (!openRef.current) setMounted(false)
                },
                // 被提前 stop（重开 / 组件卸载）：无需处理，stop 即 cleanup 的本意
                () => {},
            )
            // cleanup stop 防泄漏：关闭途中重开（打断滑出、交还打开动画 effect 接管）
            // 或组件卸载（路由切换）时终止动画
            return () => anim.stop()
        }
        setMounted(false)
        return undefined
    }, [open, y])

    // 打开动画：sheet 从屏外弹入（spring.ui）；antd wrapper 已被 CSS 静默。
    // useLayoutEffect 在首帧绘制前设初值，避免 sheet 先以 y=0 闪现一帧再跳到屏外。
    // 依赖含 mounted（真正挂载后才能测 offsetHeight）与 open（关闭途中重开时
    // mounted 未翻转，靠 open 翻转重新触发弹入）
    useLayoutEffect(() => {
        if (!open || !mounted) return
        const h = sheetRef.current?.offsetHeight ?? 0
        y.set(h)
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
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            ...userStyles?.body,
            // 布局不变量，禁止调用方覆盖：body 是 flex 列容器（overflow hidden），
            // 拖拽把手是其固定子元素、内容区（flex:1 + overflow auto）自行滚动。
            // 一旦 body 允许滚动（如曾传入 overflow: 'auto'），整个 body 连同
            // 拖拽把手会随内容滚走，下拉关闭手势在滚动后不可达。故放在 spread 之后强制生效
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
                        height: '100%',
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

                    {/* 内容区域 */}
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        {children}
                    </div>
                </motion.div>
            </Drawer>
        </>
    )
}
