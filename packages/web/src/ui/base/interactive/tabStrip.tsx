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
 * TabStrip —— 自带键盘与无障碍契约的页签条（**自建件，无上游**，落 ui/base/，不登记 registry.json）。
 *
 * 为什么不是 antd Tabs / uiarc Tabs：检查器需要的「可关闭 + 右侧 chrome 槽 + 切走不卸载」
 * 在上游都只能靠覆盖内部 DOM 或消费方补丁拼出来（`StyledTabs` 的 `&&` 就是前车之鉴：
 * 关按钮的 hover 显隐、触屏常驻是**产品行为**，却锚在 `.ant-tabs-tab-remove` 上）。
 * 决策与源码级否决记录见 .scratch/tabs-migration/spec.md。
 *
 * 契约（tests/ui/base/tabStrip.test.tsx 固化，改前先读）：
 * - 受控：无内部选中状态，`value` / `onValueChange` 由消费方持有
 * - 键盘：roving tabindex + ArrowLeft/Right/Home/End **自动激活**（移动焦点即选中），端点不循环
 * - a11y：`role=tablist` / `role=tab` + `aria-controls` / `role=tabpanel` + `aria-labelledby` 全程串联
 * - 关闭：关非活动 tab 不动焦点与选中（关闭按钮的 click 不外冒）；关活动 tab 后焦点落到顶上来的那一项
 * - `extra` 槽在 tablist **之外**（同一 flex 行的兄弟）——绝不放任何 `role="tab"` 内部，
 *   否则其中的弹层触发器会被 tab 的焦点抢夺链路当场关掉（dropdown-menu 记过这条）
 * - `keepMounted` 面板首次激活后常驻；隐藏一律用 `display:none`，**不用 `hidden` 属性**——
 *   组件自身的 `display:flex` 会压过 UA 的 `[hidden]` 样式，藏不住（uiarc 面板踩过：只加
 *   `pointer-events:none` 同样藏不住）
 */

import {
    createContext,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
} from 'react'
import styled from '@emotion/styled'
import { X } from 'lucide-react'
import { nextFocusAfterClose, resolveTabNavKey } from './tabStripNavigation'

const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
    /* 页签条是「头」，永远不参与压缩——空间不够时该让面板滚，不该把页签挤扁 */
    flex: none;
    min-width: 0;
`

const ListDiv = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    /* 窄屏页签溢出时横向滚动：藏滚动条（页签条上的滚动条比内容本身更抢眼），
       聚焦项由 scrollIntoView 带进视口 */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    &::-webkit-scrollbar {
        display: none;
    }
`

const TabDiv = styled.div<{ $selected: boolean; $disabled: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    /* 可读下限：页面宽度不够时先按此收窄（标签走省略号），到下限为止才让 tablist 横向滚动。
       若这里给 0（无下限），收缩压力会一路传到底——真机实测 9 个页签挤进 420px 时每个只剩
       38–51px（图标 + 半个字 + 关闭按钮），标签全成省略号，而 tablist 的 scrollWidth 始终等于
       clientWidth：横向滚动分支永远不可达（2026-10-13 真机验证）。下限值取「图标 + 约 4 个
       西文字符 + 关闭按钮」，具体数值可按设计诉求调，但**不能为 0**。 */
    min-width: 96px;
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-icon);
    background: transparent;
    color: var(--mobi-ink-secondary);
    font-size: 14px;
    line-height: 1.4;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition:
        background-color var(--mobi-duration-fast) ease,
        color var(--mobi-duration-fast) ease;

    &:hover {
        background: var(--mobi-hover);
    }

    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: 1px;
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }

    /* hover / 选中 / 禁用三态按此顺序排列：同特异性下后写的胜出 */
    ${(p) =>
        p.$selected &&
        `
        background: var(--mobi-selected);
        color: var(--mobi-ink);
        font-weight: 500;
        &:hover {
            background: var(--mobi-selected);
        }
    `}

    ${(p) =>
        p.$disabled &&
        `
        cursor: default;
        color: var(--mobi-ink-quaternary);
        &:hover {
            background: transparent;
        }
    `}

    /* 关闭 ×：指针设备 hover 才现形（触屏没有 hover，故常驻）；始终占位，避免 hover 时布局抖动。
       用 data 属性选中而不是嵌套一个 styled 子组件——跨组件插值当选择器要 @emotion/babel-plugin
       注入 target 才成立，本项目没装（见 package.json），故在父级里自包含地写 */
    & [data-tab-close] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 16px;
        height: 16px;
        padding: 0;
        margin-inline-start: 2px;
        border: none;
        border-radius: var(--radius-square);
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--mobi-duration-fast) ease;

        &:hover {
            background: var(--mobi-pressed);
        }

        &:focus-visible {
            opacity: 1;
            outline: 2px solid var(--mobi-primary);
            outline-offset: 1px;
        }

        @media (prefers-reduced-motion: reduce) {
            transition: none;
        }
    }

    &:hover [data-tab-close] {
        opacity: 1;
    }

    @media (hover: none) {
        & [data-tab-close] {
            opacity: 1;
        }
    }
`

const TabLabel = styled.span`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
`

const PanelDiv = styled.div`
    min-width: 0;
`

interface TabStripContextValue {
    value: string
    setValue: (value: string) => void
    baseId: string
}

interface TabStripListContextValue {
    listRef: React.RefObject<HTMLDivElement | null>
    /** 关闭前登记：关活动 tab 才需要挪焦点，且此刻被关的 tab 还在 DOM 里（可就地算下标） */
    notifyClosed: (value: string, wasSelected: boolean) => void
}

const TabStripContext = createContext<TabStripContextValue | null>(null)
const TabStripListContext = createContext<TabStripListContextValue | null>(null)

function useTabStripContext(component: string): TabStripContextValue {
    const ctx = useContext(TabStripContext)
    if (!ctx) throw new Error(`${component} 必须放在 <TabStrip> 内`)
    return ctx
}

function useTabStripListContext(component: string): TabStripListContextValue {
    const ctx = useContext(TabStripListContext)
    if (!ctx) throw new Error(`${component} 必须放在 <TabStripList> 内`)
    return ctx
}

export interface TabStripProps {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
    className?: string
    style?: CSSProperties
}

/** 根：只提供受控上下文（布局由消费方给——检查器要撑满高度、气泡内是内联块，诉求不同） */
export function TabStrip({ value, onValueChange, children, className, style }: TabStripProps) {
    // useId 的产物含 `:`、`«` 一类字符（各 React 版本不同），拼进 id 前先收成标识符安全集
    const baseId = useId().replace(/[^a-zA-Z0-9]/g, '')
    const ctx = useMemo<TabStripContextValue>(() => ({ value, setValue: onValueChange, baseId }), [value, onValueChange, baseId])
    return (
        <TabStripContext.Provider value={ctx}>
            <div className={className} style={style} data-tab-strip="">
                {children}
            </div>
        </TabStripContext.Provider>
    )
}

export interface TabStripListProps {
    /** tablist 的无障碍名称（读屏进入页签条时朗读） */
    ariaLabel: string
    /** 行右端槽位（新建 / 收起一类操作）；**不是** tab 的一部分，不会被 tab 的键盘与焦点链路牵动 */
    extra?: ReactNode
    children: ReactNode
    /** 外层行（页签条整条）的样式：内边距、安全区一类归这里 */
    className?: string
    style?: CSSProperties
    /** 内层滚动容器的样式：页签间距、收窄诉求 */
    listClassName?: string
    listStyle?: CSSProperties
}

export function TabStripList({ ariaLabel, extra, children, className, style, listClassName, listStyle }: TabStripListProps) {
    const { value: selectedValue, setValue } = useTabStripContext('TabStripList')
    const listRef = useRef<HTMLDivElement | null>(null)
    const pendingCloseRef = useRef<{ closedIndex: number } | null>(null)

    const listCtx = useMemo<TabStripListContextValue>(
        () => ({
            listRef,
            notifyClosed(value, wasSelected) {
                // 非活动 tab 关闭：焦点与选中都不动（契约）
                if (!wasSelected) return
                const index = collectTabs(listRef.current).findIndex((t) => t.value === value)
                if (index >= 0) pendingCloseRef.current = { closedIndex: index }
            },
        }),
        [],
    )

    // 关活动 tab 后的焦点落点：等消费方换完选中的那一帧再定——
    // 首选它选中的 tab，消费方没换（value 指向已删的 tab）时按「顶上来的那一项」兜底
    useEffect(() => {
        const pending = pendingCloseRef.current
        if (!pending) return
        pendingCloseRef.current = null
        const tabs = collectTabs(listRef.current)
        const target =
            tabs.find((t) => t.el.getAttribute('aria-selected') === 'true') ??
            tabs[nextFocusAfterClose(pending.closedIndex, tabs) ?? -1]
        focusTab(target?.el)
    })

    // 选中项滚进视口（窄屏溢出时切页签不该把新页签留在视野外）
    useEffect(() => {
        const selected = collectTabs(listRef.current).find((t) => t.el.getAttribute('aria-selected') === 'true')
        scrollIntoView(selected?.el)
    }, [selectedValue])

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const tabs = collectTabs(listRef.current)
        // 焦点在关闭按钮上时算作它所在的那个 tab——否则方向键在这一格失灵
        const current = tabs.findIndex((t) => t.el === document.activeElement || t.el.contains(document.activeElement))
        if (current < 0) return
        const target = resolveTabNavKey(event.key, current, tabs)
        if (target === null) return
        event.preventDefault()
        focusTab(tabs[target].el)
        setValue(tabs[target].value)
    }

    return (
        <Row className={className} style={style}>
            <TabStripListContext.Provider value={listCtx}>
                <ListDiv
                    ref={listRef}
                    role="tablist"
                    aria-orientation="horizontal"
                    aria-label={ariaLabel}
                    className={listClassName}
                    style={listStyle}
                    onKeyDown={handleKeyDown}
                >
                    {children}
                </ListDiv>
            </TabStripListContext.Provider>
            {extra}
        </Row>
    )
}

export interface TabStripTabProps {
    value: string
    children: ReactNode
    disabled?: boolean
    /** 给出即渲染关闭 ×；关活动 tab 时焦点由 TabStripList 接管 */
    onClose?: () => void
    /** 关闭按钮的无障碍名称（形如「关闭 终端 1」——光一个 × 读屏读不出来） */
    closeLabel?: string
    className?: string
    style?: CSSProperties
}

export function TabStripTab({ value, children, disabled, onClose, closeLabel, className, style }: TabStripTabProps) {
    const { value: selectedValue, setValue, baseId } = useTabStripContext('TabStripTab')
    const { notifyClosed } = useTabStripListContext('TabStripTab')
    const selected = selectedValue === value
    const encoded = encodeURIComponent(value)

    return (
        <TabDiv
            role="tab"
            id={`${baseId}-tab-${encoded}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${encoded}`}
            aria-disabled={disabled || undefined}
            // roving tabindex：整条页签只留一个 Tab 停留点（选中的那个）
            tabIndex={selected ? 0 : -1}
            data-tab-value={value}
            $selected={selected}
            $disabled={!!disabled}
            className={className}
            style={style}
            onClick={() => {
                if (!disabled) setValue(value)
            }}
            onKeyDown={(event) => {
                // div 没有原生按钮语义（页签里要能放真正的关闭按钮，`<button>` 套 `<button>` 不合法），
                // 故 Enter/Space 自己补；焦点在关闭按钮上时交给它自己处理
                if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && !disabled) {
                    event.preventDefault()
                    setValue(value)
                }
            }}
        >
            <TabLabel>{children}</TabLabel>
            {onClose && (
                <button
                    type="button"
                    data-tab-close=""
                    aria-label={closeLabel}
                    onClick={(event) => {
                        // 不让点击冒泡成一次选中切换（关非活动 tab 时选中必须原地不动）
                        event.stopPropagation()
                        notifyClosed(value, selected)
                        onClose()
                    }}
                >
                    <X size={12} />
                </button>
            )}
        </TabDiv>
    )
}

export interface TabStripPanelProps {
    value: string
    children: ReactNode
    /** 首次激活后常驻（切走只隐藏不卸载）；缺省按普通页签——切走即卸载 */
    keepMounted?: boolean
    className?: string
    style?: CSSProperties
}

export function TabStripPanel({ value, children, keepMounted, className, style }: TabStripPanelProps) {
    const { value: selectedValue, baseId } = useTabStripContext('TabStripPanel')
    const selected = selectedValue === value
    // 「首次激活即常驻」：记一次已挂载过。React 官方的 render 期调整 state 写法（同值短路，不额外渲染）
    const [everSelected, setEverSelected] = useState(selected)
    if (selected && !everSelected) setEverSelected(true)
    if (keepMounted ? !everSelected : !selected) return null

    const encoded = encodeURIComponent(value)
    return (
        <PanelDiv
            role="tabpanel"
            id={`${baseId}-panel-${encoded}`}
            aria-labelledby={`${baseId}-tab-${encoded}`}
            tabIndex={0}
            className={className}
            // 隐藏走 display:none（即从无障碍树移除），不用 hidden 属性——见文件头注释
            style={selected ? style : { ...style, display: 'none' }}
        >
            {children}
        </PanelDiv>
    )
}

interface TabEntry {
    el: HTMLElement
    value: string
    disabled: boolean
}

/** 把容器里的 tab 摊成数组——顺序即 DOM 顺序（渲染顺序的权威），不另建注册表 */
function collectTabs(container: HTMLElement | null): TabEntry[] {
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).map((el) => ({
        el,
        value: el.dataset.tabValue ?? '',
        disabled: el.getAttribute('aria-disabled') === 'true',
    }))
}

function focusTab(el: HTMLElement | undefined): void {
    el?.focus()
}

/** jsdom 未实现 scrollIntoView，故可选调用（浏览器里才有实际行为） */
function scrollIntoView(el: HTMLElement | undefined): void {
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
