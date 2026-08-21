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
 * 所有关闭路径（手势释放 / 点遮罩 / 手势返回）统一走 closeWithAnimation：
 * 先滑出屏，落定后才通知父组件关闭。
 */

import { useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { Drawer, type DrawerProps } from 'antd'
import { Global, css } from '@emotion/react'
import styled from '@emotion/styled'
import { pushHistoryGuard } from '@/core/lib/drawerHistoryGuard'
import {
    motion,
    useDragControls,
    useMotionValue,
    animate,
    type DragControls,
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
    /**
     * 外部拖拽控制柄（可选）。EdgeSwipeBack 从屏幕左缘远程启动本 sheet 的拖拽时传入
     * （motion useDragControls 的远程触发设计）。缺省时内部自建。
     */
    dragControls?: DragControls
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
    dragControls: externalControls,
    closable: _closable,
    ...rest
}: MobileDrawerProps) {
    const controls = useDragControls()
    // 实际驱动 sheet 的控制柄：外部传入时用外部的（EdgeSwipeBack 远程触发），否则用内部自建的
    const activeControls = externalControls ?? controls
    const y = useMotionValue(0)
    const sheetRef = useRef<HTMLDivElement>(null)

    // onClose 用 ref 持有，避免父组件内联箭头每次渲染产生新引用导致 effect 重跑（重复 push 哨兵）
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // 正被拖拽标记（onDragStart 置 true / handleDragEnd 置 false）。
    // EdgeSwipeBack 从屏幕左缘远程 controls.start 后 React 才 flush open=true，
    // 打开动画 effect 若不感知拖拽中，y.set(h) 会把正跟手的 sheet 拽到屏底再弹入（双写竞争）
    const isDraggingRef = useRef(false)

    // 统一关闭路径：先 spring 滑出屏，落定后再调 onClose（父组件此时才 setOpen(false)，
    // antd leave 只淡出 mask——wrapper transform 已被 CSS 锁 none，内容已出屏，无闪烁）。
    // 手势释放（velocity 透传，px/s 向下为正）、点遮罩、history guard 返回全部走这里，
    // 与 iOS sheet 行为同构（点遮罩也是滑出）。
    // 边界：父组件不经 onClose 直接 setOpen(false)（如菜单项 navigate 后关闭）无法拦截，
    // 此时 antd leave 淡 mask、sheet 瞬消，与旧行为一致，可接受。
    const closeWithAnimation = useCallback((velocity?: number) => {
        const h = sheetRef.current?.offsetHeight ?? 0
        animate(y, h, velocity != null ? { ...spring.momentum, velocity } : spring.momentum)
            .then(() => onCloseRef.current?.(createSyntheticCloseEvent()))
    }, [y])

    // closeWithAnimation 用 ref 持有：history guard effect 只依赖 open，
    // 避免回调引用变化导致哨兵反复 dispose/re-push（旧实现的教训）。
    // history guard 场景哨兵已被 popstate 消费，动画延迟 ~0.4s 后才 onClose 不影响哨兵语义
    const closeWithAnimationRef = useRef(closeWithAnimation)
    closeWithAnimationRef.current = closeWithAnimation

    // 移动端全屏手势返回（iOS 边缘滑动 / Android 返回键 / 浏览器 back）应关闭 drawer，
    // 而非穿透到路由层退出 session detail。open 时推一个同 URL history 哨兵：
    // 手势返回消费哨兵 → 先滑出动画再 onClose；用户主动关闭（遮罩/下拉/按钮）时 dispose 弹掉哨兵
    useEffect(() => {
        if (!open) return
        const dispose = pushHistoryGuard(() => {
            closeWithAnimationRef.current()
        })
        return dispose
    }, [open])

    // 打开动画：sheet 从屏外弹入（spring.ui）；antd wrapper 已被 CSS 静默。
    // useLayoutEffect 在首帧绘制前设初值，避免 sheet 先以 y=0 闪现一帧再跳到屏外。
    // 正被拖拽时（EdgeSwipeBack 远程 start 先于 open flush 执行）跳过弹入，
    // 放手后由 handleDragEnd 的 settle 分支归位，防止 y.set(h) 与跟手位移双写竞争
    useLayoutEffect(() => {
        if (!open) return
        if (isDraggingRef.current) return
        const h = sheetRef.current?.offsetHeight ?? 0
        y.set(h)
        const anim = animate(y, 0, spring.ui)
        return () => anim.stop()
    }, [open, y])

    const handleDragEnd = useCallback((
        _e: MouseEvent | TouchEvent | PointerEvent,
        info: PanInfo,
    ) => {
        isDraggingRef.current = false
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
            // 统一关闭路径：滑出动画 + 落定后 onClose（继承手势速度）
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
                open={open}
                // 点遮罩 / closable 关闭也走统一路径：先滑出动画、落定后再把关闭通知给父组件。
                // 不能直接传 closeWithAnimation——antd 会把 MouseEvent 作为首参传入，
                // 被误当成 velocity 参数；箭头包装确保无速度继承
                onClose={() => closeWithAnimation()}
                placement="bottom"
                title={null}
                closable={false}
                styles={mergedStyles}
                rootClassName={finalRootClassName}
                // 外部控制柄存在时保持挂载，供 EdgeSwipeBack 远程 start（后续任务）
                forceRender={!!externalControls}
                {...rest}
            >
                {/* 视觉 sheet 主体：背景 + 圆角 + 全部位移动效都在这里，
                    antd 的 wrapper 只是被 CSS 静默的容器 */}
                <motion.div
                    ref={sheetRef}
                    data-testid="mobile-drawer-sheet"
                    drag="y"
                    dragListener={false}
                    dragControls={activeControls}
                    // 上边界（top: 0）越界由 dragElastic 阻尼跟动 = rubber-band；
                    // 下边界放到 10000px，实际不约束 = 下拖 1:1 跟手
                    dragConstraints={{ top: 0, bottom: 10000 }}
                    dragElastic={0.2}
                    // 释放后的沉降/滑出由 handleDragEnd 显式 animate 接管（带速度继承），
                    // 关掉 motion 内建惯性，避免两套动画对 y 的双向拉扯
                    dragMomentum={false}
                    onDragStart={() => { isDraggingRef.current = true }}
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
                    {/* 自定义 header：拖拽区域，pointerdown 远程启动 sheet 拖拽 */}
                    <DraggableArea onPointerDown={(e) => activeControls.start(e)}>
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
