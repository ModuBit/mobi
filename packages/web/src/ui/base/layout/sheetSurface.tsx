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
 * 浮层的「面」与头部基线：BottomSheet 与画板载体（SketchDrawer）共用的呈现层。
 * 样式在 ./sheetSurface.module.css（边界与复用纪律写在那个文件头）。
 *
 * 两种用法：
 * - 结构固定（有标题的弹层 / 工具条头部）→ 直接用 `SheetHeader` / `SheetGrabber`；
 * - 宿主元素必须自己渲染（motion.div 要接 MotionValue、Radix 的 asChild 要接管元素）
 *   → 用 `sheetClass` / `sheetSurfaceClass` / `sheetHeaderClass` 把类名贴到自己的元素上。
 *
 * 两种用法共用同一份 CSS，所以「看起来一样」是结构保证的，不靠约定维持。
 */

import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { X } from 'lucide-react'
import styles from './sheetSurface.module.css'

/** 面形状：贴底弹层（上半圆角，底边交给使用方的屏下延伸段）/ 悬浮矩形（PC 停靠、页内浮层） */
export type SurfaceVariant = 'bottom' | 'floating'

/** 头部布局：有标题走三栏（标题恒居中），无标题走工具条（左主出口 + 右操作） */
export type HeaderLayout = 'title' | 'toolbar'

/** 头部图标按钮尺寸档：compact = 32px（桌面），touch = 40px（移动端触达目标） */
export type SheetIconButtonSize = 'compact' | 'touch'

/** 样式类名：宿主元素自己渲染时贴到元素上（motion.div / Radix asChild） */
export const sheetClass = {
    mask: styles.mask,
    surface: styles.surface,
    header: styles.header,
    headRow: styles.headRow,
    headText: styles.headText,
    title: styles.title,
    headActions: styles.headActions,
    iconBtn: styles.iconBtn,
    iconBtnBordered: styles.iconBtnBordered,
    iconBtnTouch: styles.iconBtnTouch,
    grabber: styles.grabber,
    grabberBar: styles.grabberBar,
    body: styles.body,
    srOnly: styles.srOnly,
} as const

export function sheetIconButtonClass({ bordered = true, size = 'compact' }: {
    /** 描边档（破坏性出口：关闭 / 取消）/ 无描边档（工具动作：全屏切换） */
    bordered?: boolean
    size?: SheetIconButtonSize
} = {}): string {
    return [
        styles.iconBtn,
        bordered ? styles.iconBtnBordered : '',
        size === 'touch' ? styles.iconBtnTouch : '',
    ].filter(Boolean).join(' ')
}

export function sheetSurfaceClass(variant: SurfaceVariant = 'bottom'): string {
    return `${styles.surface} ${variant === 'bottom' ? styles.surfaceBottom : styles.surfaceFloating}`
}

export function sheetHeaderClass(layout: HeaderLayout = 'title'): string {
    return layout === 'toolbar' ? `${styles.header} ${styles.headerToolbar}` : styles.header
}

/** 拖拽指示条。可交互档渲染成 button（键盘可操作 + aria-expanded 播报档位），纯提示档是 div */
export function SheetGrabber({ interactive = false, label, expanded, onClick }: {
    interactive?: boolean
    /** 可交互档的无障碍名（如「展开面板 / 收起面板」） */
    label?: string
    expanded?: boolean
    onClick?: () => void
}): ReactNode {
    if (!interactive) {
        return (
            <div className={sheetClass.grabber} aria-hidden="true">
                <span className={sheetClass.grabberBar} />
            </div>
        )
    }
    return (
        <button
            type="button"
            className={sheetClass.grabber}
            data-grabber=""
            aria-expanded={expanded}
            aria-label={label}
            onClick={onClick}
        >
            <span className={sheetClass.grabberBar} aria-hidden="true" />
        </button>
    )
}

/**
 * 头部图标按钮：盒模型 / 描边档 / 尺寸档全在壳里，使用方不再各自拼一版
 * ——否则「同一个图标钮」会在不同浮层里漂移出粗细与触达目标差（实测画板那处 X 是
 * 默认 strokeWidth 2，sheet 这处是 1.75，触达目标一个 24px 一个 40px）。
 *
 * **纯呈现件**：点击行为与「关什么」由外部决定。Radix 的 `DialogPrimitive.Close`
 * 用 `asChild` 包住它即可拿到 Radix 的关闭 / 焦点语义。
 */
export function SheetIconButton({ label, icon, bordered = true, size = 'compact', className, children, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> & {
    /** 无障碍名（形如「关闭 工具详情」——光一个 × 读屏读不出来） */
    label: string
    icon: ReactNode
    bordered?: boolean
    size?: SheetIconButtonSize
}): ReactNode {
    return (
        <button
            type="button"
            data-sheet-icon-button=""
            aria-label={label}
            className={[sheetIconButtonClass({ bordered, size }), className].filter(Boolean).join(' ')}
            {...rest}
        >
            {icon}
            {children}
        </button>
    )
}

/** 关闭钮：图标本体（X / 尺寸 / 描边粗细）一并收在这里，与取消钮共用同一外形 */
export function SheetClose({ label, size = 'compact', className, children, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> & {
    label: string
    size?: SheetIconButtonSize
}): ReactNode {
    return (
        <SheetIconButton
            label={label}
            size={size}
            className={className}
            icon={children ?? <X size={16} strokeWidth={1.75} aria-hidden="true" />}
            {...rest}
        />
    )
}

/**
 * 头部基线：高度 / 内衬 / 抓取光标 / 滚动后的发丝线都收在这里。
 * 拖拽处理器（onPointerDown 等）与状态属性（data-dragging）由使用方透传进来——
 * 壳不认识手势，只保证按下时看起来能拖。
 */
export function SheetHeader({
    layout = 'title',
    grabber,
    leading,
    title,
    trailing,
    className,
    children,
    ...rest
}: Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
    layout?: HeaderLayout
    /** 拖拽指示条（<SheetGrabber />）；不需要就省 */
    grabber?: ReactNode
    /** 工具条布局的主出口（如「取消」）；三栏布局下不使用 */
    leading?: ReactNode
    /** 标题节点（调用方可传 Radix 的 Title，类名用 sheetClass.title） */
    title?: ReactNode
    /** 右侧操作（关闭按钮 / 完成 / 全屏切换） */
    trailing?: ReactNode
}) {
    return (
        <div className={[sheetHeaderClass(layout), className].filter(Boolean).join(' ')} {...rest}>
            {grabber}
            <div className={sheetClass.headRow}>
                <div className={sheetClass.headText}>{layout === 'toolbar' ? leading : title}</div>
                <div className={sheetClass.headActions}>{trailing}</div>
                {children}
            </div>
        </div>
    )
}
