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
 * **观感与动效取自 uiarc 的 Tabs**（`uiarc.dev/r/tabs.json`：`tabs.tsx` + `tabs.module.css`），
 * 但我们不用它的组件：检查器需要的「可关闭 + 右侧 chrome 槽 + 切走不卸载」它都没有，
 * 且 `forceMount` 的语义（照常渲染 **且不隐藏**）与我们「非活动面板 `display:none`」相反。
 * 于是只把它那套**呈现**搬过来，能力仍由我们自己的契约承载（见下「契约」）。
 *
 * uiarc 的四条呈现特征，逐条对应到下面的实现：
 * 1. **分段控件外壳**（`.listShell`）：描边 + 轨道底色 + 内边距 + 圆角，页签是轨道里的块
 * 2. **选中项是一块滑移的独立块**（`.selection` + motion 共享布局）：块自己从旧页签滑到新页签，
 *    而不是「每个页签各自换个底色」；`z-index:-1` 让它垫在文字下方，`isolate` 圈住层级
 * 3. **不收缩**（`.trigger { flex: 0 0 auto; min-width: 5.5rem }`）：空间不够时横向滚动，
 *    绝不把页签挤扁（曾实测：允许收缩时 9 个页签会各自压成 38–51px 只剩省略号）
 * 4. **溢出用两侧滚动按钮 + 两端渐隐**（`.scrollButton` + `viewport` 的 `mask-image`），
 *    选中项变化时 `reveal()` 把它滚进视口，并给按钮让出 34px
 *
 * 刻意**没有**照搬的：面板的入/出场动效（x 位移 + 高度 morph + 出界面板钉原位）。它靠
 * `AnimatePresence` + 面板卸载成立，而检查器面板是 `keepMounted` + `display:none`（终端不重连、
 * 文件树不回根），两者语义冲突——要保 keepalive 就得放弃这段面板动效。页签条的滑移不受影响。
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
    useCallback,
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
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { LayoutGroup, motion, useReducedMotion, type Transition } from 'motion/react'
import { spring } from '@/ui/base/motion/presets'
import { nextFocusAfterClose, resolveTabNavKey } from './tabStripNavigation'

/** 滚动按钮宽度（与 ScrollButton 的 width 同源）——reveal 要按它给按钮让位 */
const SCROLL_BUTTON_WIDTH = 33
/** 两端渐隐的宽度（与 Viewport 的 mask 同源） */
const EDGE_FADE_WIDTH = 35

const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    /* 页签条是「头」，永远不参与压缩——空间不够时该让页签条内部滚，不该把它挤没 */
    flex: none;
    min-width: 0;
`

/* 分段控件外壳（uiarc .listShell）：描边 + 轨道底色 + 圆角，页签在轨道里滑动 */
const Shell = styled.div`
    position: relative;
    display: inline-flex;
    flex: 0 1 auto;
    max-width: 100%;
    min-width: 0;
    align-items: center;
    /* 圈住层级：选中块的 z-index:-1 只沉到轨道之下，不会穿到父级背景之后 */
    isolation: isolate;
    border: 1px solid var(--mobi-hairline);
    border-radius: var(--radius-control);
    background: var(--mobi-hover);
`

/* 滚动视口（uiarc .viewport）：滚的是它，外壳那道描边不跟着动 */
const Viewport = styled.div`
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    border-radius: inherit;
    scrollbar-width: none;
    &::-webkit-scrollbar {
        display: none;
    }

    /* 滚到某端之外还有内容时，该端渐隐（暗示还有页签）。emotion 不能跨组件插值当选择器
       （需 @emotion/babel-plugin 注入 target，本项目没装），故用父级属性选择器反向命中 */
    [data-left='true'] > & {
        mask-image: linear-gradient(to right, transparent, black ${EDGE_FADE_WIDTH}px, black);
    }
    [data-right='true'] > & {
        mask-image: linear-gradient(to right, black, black calc(100% - ${EDGE_FADE_WIDTH}px), transparent);
    }
    [data-left='true'][data-right='true'] > & {
        mask-image: linear-gradient(
            to right,
            transparent,
            black ${EDGE_FADE_WIDTH}px,
            black calc(100% - ${EDGE_FADE_WIDTH}px),
            transparent
        );
    }
`

/* 页签列表（uiarc .list）：width:max-content —— 内容多宽就多宽，外壳负责裁切与滚动 */
const TabList = styled.div`
    display: inline-flex;
    width: max-content;
    align-items: center;
    gap: 2px;
    padding: 2px;
    isolation: isolate;
`

const TabDiv = styled.div<{ $selected: boolean; $disabled: boolean }>`
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* 不收缩：空间不够时由视口滚动解决，页签本身永远是可读的自然宽度 */
    flex: 0 0 auto;
    min-width: 5.5rem;
    min-height: 28px;
    padding: 0 12px;
    border: 0;
    /* 与外框同心的内层档位（外框 control，内层收一档即 control-sm） */
    border-radius: var(--radius-control-sm);
    background: transparent;
    color: var(--mobi-ink-secondary);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--mobi-duration-fast) var(--mobi-ease-out);

    /* hover / 按下只改文字色（uiarc 的做法）：底色留给选中块，避免和滑移的块打架 */
    @media (hover: hover) and (pointer: fine) {
        &:hover {
            color: var(--mobi-ink);
        }
    }
    &:active {
        color: var(--mobi-ink);
    }

    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: 1px;
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }

    /* 选中：文字用最深一档墨。mobi 的强调色是**中性墨族**（primary 在暗档就等于 ink，
       在亮档还比 ink 浅一档——见 tokens.ts），所以「强调」在这里的正确表达是最重的墨，
       而不是某个色相；块的存在感交给下面那块滑移的面。 */
    ${(p) => p.$selected && `color: var(--mobi-ink);`}

    ${(p) =>
        p.$disabled &&
        `
        cursor: not-allowed;
        opacity: 0.5;
    `}

    /* 关闭 ×：指针设备 hover 才现形（触屏没有 hover，故常驻）；始终占位，避免 hover 时布局抖动 */
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

/* 选中块（uiarc .selection）：垫在文字之下的一块浮起面，靠 motion 共享布局在页签间滑移 */
const Selection = styled(motion.span)`
    position: absolute;
    z-index: -1;
    inset: 0;
    border: 1px solid var(--mobi-hairline);
    border-radius: inherit;
    background: var(--mobi-elevated);
    box-shadow: var(--shadow-resting);
    will-change: transform;
`

const TabLabel = styled.span`
    position: relative;
    z-index: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
`

/* 溢出时的两端滚动按钮（uiarc .scrollButton）：盖在视口上，禁用即透明（不占位观感） */
const ScrollButton = styled.button`
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    display: grid;
    width: 33px;
    place-items: center;
    border: 0;
    background: var(--mobi-hover);
    color: var(--mobi-ink);
    cursor: pointer;

    &:disabled {
        opacity: 0;
        pointer-events: none;
    }

    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: -3px;
    }
`

const ScrollLeftButton = styled(ScrollButton)`
    left: 0;
    border-radius: var(--radius-control) 0 0 var(--radius-control);
`

const ScrollRightButton = styled(ScrollButton)`
    right: 0;
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
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
    viewportRef: React.RefObject<HTMLDivElement | null>
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
            {/* LayoutGroup 按实例隔离：选中块只在同一条页签条内滑移，不会从另一组页签"飞"过来 */}
            <LayoutGroup id={baseId}>
                <div className={className} style={style} data-tab-strip="">
                    {children}
                </div>
            </LayoutGroup>
        </TabStripContext.Provider>
    )
}

export interface TabStripListProps {
    /** tablist 的无障碍名称（读屏进入页签条时朗读） */
    ariaLabel: string
    /** 溢出时两端滚动按钮的无障碍名称（形如「向左滚动页签」——光一个箭头读屏读不出来） */
    scrollButtonLabels: { left: string; right: string }
    /** 行右端槽位（新建 / 收起一类操作）；**不是** tab 的一部分，不会被 tab 的键盘与焦点链路牵动 */
    extra?: ReactNode
    children: ReactNode
    /** 外层行（页签条整条）的样式：内边距、安全区一类归这里 */
    className?: string
    style?: CSSProperties
    /** 外层外壳（描边轨道）的样式：需要限宽一类诉求时用 */
    shellClassName?: string
    shellStyle?: CSSProperties
    /** 内层列表的样式：页签间距一类归这里 */
    listClassName?: string
    listStyle?: CSSProperties
}

export function TabStripList({
    ariaLabel,
    scrollButtonLabels,
    extra,
    children,
    className,
    style,
    shellClassName,
    shellStyle,
    listClassName,
    listStyle,
}: TabStripListProps) {
    const { value: selectedValue, setValue } = useTabStripContext('TabStripList')
    const listRef = useRef<HTMLDivElement | null>(null)
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const shellRef = useRef<HTMLDivElement | null>(null)
    const pendingCloseRef = useRef<{ closedIndex: number } | null>(null)
    const reduced = useReducedMotion() ?? false
    const edges = useStripScroll(shellRef, viewportRef, listRef, selectedValue, reduced)

    const listCtx = useMemo<TabStripListContextValue>(
        () => ({
            listRef,
            viewportRef,
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

    const scrollByPage = useCallback(
        (direction: 1 | -1) => {
            const viewport = viewportRef.current
            if (!viewport) return
            viewport.scrollBy?.({ left: direction * viewport.clientWidth * 0.75, behavior: reduced ? 'instant' : 'smooth' })
        },
        [reduced],
    )

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
        <Row className={className} style={style} data-tab-strip-row="">
            <TabStripListContext.Provider value={listCtx}>
                <Shell ref={shellRef} className={shellClassName} style={shellStyle} data-left={edges.left} data-right={edges.right} data-overflow={edges.overflow}>
                    {edges.overflow && (
                        <ScrollLeftButton type="button" aria-label={scrollButtonLabels.left} disabled={!edges.left} onClick={() => scrollByPage(-1)}>
                            <ChevronLeft size={17} aria-hidden />
                        </ScrollLeftButton>
                    )}
                    <Viewport
                        ref={viewportRef}
                        /* 焦点进入页签（键盘 Tab 或方向键落到某个页签）时同样把它带进视口 */
                        onFocusCapture={(event) => {
                            if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab') {
                                revealTab(viewportRef.current, event.target, reduced)
                            }
                        }}
                    >
                        <TabList
                            ref={listRef}
                            role="tablist"
                            aria-orientation="horizontal"
                            aria-label={ariaLabel}
                            className={listClassName}
                            style={listStyle}
                            onKeyDown={handleKeyDown}
                        >
                            {children}
                        </TabList>
                    </Viewport>
                    {edges.overflow && (
                        <ScrollRightButton type="button" aria-label={scrollButtonLabels.right} disabled={!edges.right} onClick={() => scrollByPage(1)}>
                            <ChevronRight size={17} aria-hidden />
                        </ScrollRightButton>
                    )}
                </Shell>
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
    const reduced = useReducedMotion() ?? false

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
            {selected && (
                <Selection
                    data-tab-selection=""
                    aria-hidden
                    layoutId="selection"
                    /* uiarc 同款做法：reduced-motion 下不是不渲染，而是把时长归零（动效降级而非结构分叉）。
                       弹簧用全局预设 spring.ui（DESIGN.md 的口径：组件不许自带第二套缓动语言） */
                    transition={reduced ? { duration: 0 } : (spring.ui as Transition)}
                />
            )}
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

/**
 * 把某页签滚进视口（uiarc `reveal`）：两端各有滚动按钮盖在视口上，故只在**按钮之外**的区间里判可见，
 * 免得滚进来又正好被按钮盖住。`scrollBy` 在 jsdom 里不存在，故可选调用（浏览器里才有实际行为）。
 * 返回它是否已经落定（本来就在区间内 = 无位移可做）。滚到列表尽头时按钮会因禁用而淡出，
 * 那里少量遮挡不算问题——所以「已经在尽头」也算落定。
 */
function revealTab(viewport: HTMLDivElement | null, tab: HTMLElement | undefined, reduced: boolean): boolean {
    if (!viewport || !tab) return true
    const frame = viewport.getBoundingClientRect()
    const item = tab.getBoundingClientRect()
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const left = frame.left + (viewport.scrollLeft > 1 ? SCROLL_BUTTON_WIDTH + 1 : 0)
    const right = frame.right - (viewport.scrollLeft < max - 1 ? SCROLL_BUTTON_WIDTH + 1 : 0)
    const delta = item.left < left ? item.left - left : item.right > right ? item.right - right : 0
    if (!delta) return true
    // 已到尽头还够不着（末尾页签）——按钮此刻是禁用态（透明且不可点），不必再追
    if ((delta < 0 && viewport.scrollLeft <= 1) || (delta > 0 && viewport.scrollLeft >= max - 1)) return true
    viewport.scrollBy?.({ left: delta, behavior: reduced ? 'instant' : 'smooth' })
    return false
}

interface ScrollEdges {
    overflow: boolean
    left: boolean
    right: boolean
}

const NO_EDGES: ScrollEdges = { overflow: false, left: false, right: false }

/**
 * 视口两端的可滚状态（决定滚动按钮与渐隐的显隐）+「把选中项带进视口」。
 * ResizeObserver 在 jsdom 里不存在——守卫后使用，测试环境下恒为「无溢出」，不影响其它断言。
 *
 * 两者合在一个 effect 里，是因为揭示（reveal）**不能只算一次**：新建页签那一帧它的宽度往往还没定稿
 * （先按占位标题摆一道，再换成真标题），此刻量出的可达滚动范围偏小，滚动就此停在
 * 「新页签仍被右侧按钮压住」的位置不动了（2026-10-13 实测：选中项右缘超出视口 48px 定格）。
 * 于是把「带进视口」当成一项**待办的布局义务**：选中变化时挂起，此后每次尺寸变化复核一遍，
 * 直到它真的落在视口里（或已在尽头）才算完。滚动事件只更新两端状态、绝不触发滚动本身，避免互相打架。
 */
function useStripScroll(
    shellRef: React.RefObject<HTMLDivElement | null>,
    viewportRef: React.RefObject<HTMLDivElement | null>,
    listRef: React.RefObject<HTMLDivElement | null>,
    selectedValue: string,
    reduced: boolean,
): ScrollEdges {
    const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES)
    const revealPendingRef = useRef(false)

    useEffect(() => {
        revealPendingRef.current = true
        const frame = shellRef.current
        const scroll = viewportRef.current
        const container = listRef.current
        if (!frame || !scroll || !container) return

        const syncEdges = () => {
            const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
            const next: ScrollEdges = {
                // 外壳比内容窄才算溢出：用 1px 容差吸收亚像素
                overflow: scroll.scrollWidth > frame.clientWidth + 1,
                left: scroll.scrollLeft > 1,
                right: scroll.scrollLeft < max - 1,
            }
            setEdges((prev) => (prev.overflow === next.overflow && prev.left === next.left && prev.right === next.right ? prev : next))
        }
        const measure = () => {
            syncEdges()
            if (!revealPendingRef.current) return
            const selected = collectTabs(container).find((t) => t.el.getAttribute('aria-selected') === 'true')
            if (revealTab(scroll, selected?.el, reduced)) revealPendingRef.current = false
        }

        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(frame)
        observer?.observe(scroll)
        observer?.observe(container)
        scroll.addEventListener('scroll', syncEdges, { passive: true })
        measure()
        return () => {
            observer?.disconnect()
            scroll.removeEventListener('scroll', syncEdges)
        }
    }, [selectedValue, reduced, shellRef, viewportRef, listRef])

    return edges
}
