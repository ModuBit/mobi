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

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Bubble } from '@ant-design/x'
import { Skeleton } from 'antd'
import { BUBBLE_ROLES } from './bubbleRoles'
import type { BubbleItemBase } from './buildBubbleItems'
import { useStickToBottom } from './useStickToBottom'

/** Virtuoso 渲染的 item 类型（decoratedItems 结构 + 装饰字段） */
export type ChatBubbleItem = BubbleItemBase & {
    header?: ReactNode
    footer?: ReactNode
    footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
    classNames?: { root?: string }
}

/**
 * 单个 bubble 渲染：复刻 antdx BubbleListItem 的 role 模板展开。
 *
 * Bubble.List 内部按 item.role 选 BUBBLE_ROLES 配置 + 选模板（divider/system/默认 Bubble），
 * 这里手动展开——把 role 配置直接传给 Bubble 单组件，保留视觉一致。
 */
const BubbleItem = memo(function BubbleItem({ item }: { item: ChatBubbleItem }) {
    const cfg = BUBBLE_ROLES[item.role as keyof typeof BUBBLE_ROLES] ?? {}

    // 合并顺序严格对齐 antdx BubbleList：`{ ...roleCfg, ...item }`，即 **item 覆盖 role 配置**
    //（见 @ant-design/x/es/bubble/BubbleList.js 的 mergedProps）。
    // 早前写成 `{...cfg}` 展开在 item 之后，role 配置反而覆盖 item，与 Bubble.List 行为相反——
    // 表现为 item.variant 对 assistant 恒被忽略。
    //
    // key / block 是本地字段，不能透传给 Bubble：
    // - key：React key 由 Virtuoso 的 computeItemKey 提供，这里是单个根元素，写 key 无效
    // - block：内部数据，非 Bubble prop
    const { key: _key, block: _block, role, ...itemProps } = item
    const merged = { ...cfg, ...itemProps }

    // divider：虚线分隔（context-cleared 等），用 antdx Bubble.Divider 对齐 Bubble.List 视觉
    if (role === 'divider') {
        return <Bubble.Divider {...merged} />
    }

    // system：无边框系统行（bg-task-completed 等），用 antdx Bubble.System
    if (role === 'system') {
        return <Bubble.System {...merged} />
    }

    return <Bubble {...merged} />
})

/** 传给 Virtuoso 的 context：Header 据此决定是否渲染历史加载骨架 */
type ChatListContext = { isFetchingNextPage: boolean }

/**
 * 顶部历史加载骨架（Virtuoso Header）。
 *
 * 必须是**模块级稳定组件**，不能在渲染期就地定义。若写成
 * `components={{ Header: () => isFetching ? <Skeleton/> : null }}`，
 * 每次 isFetching 变化都产生一个新的函数组件**类型**，React 会卸载旧子树、挂载新子树
 * 而非更新——曾表现为「Header 函数被调用但输出没进 DOM」（pending #39 的误判来源）。
 * 状态通过 Virtuoso 的 context prop 传入，组件类型恒定。
 */
const HistoryLoadingHeader = ({ context }: { context?: ChatListContext }) => (
    context?.isFetchingNextPage ? (
        <div style={{ padding: '12px 16px' }} data-testid="virtuoso-header">
            <Skeleton avatar={{ shape: 'circle' }} paragraph={{ rows: 2 }} active />
        </div>
    ) : null
)

/**
 * components 对象也提到模块级常量，保证引用恒定。
 *
 * 注意：components prop 必须始终传对象——传显式 undefined 会让 react-virtuoso 把
 * undefined 写入 components state，selector `d => d[l]` 对 undefined 读会崩
 *（Cannot read 'EmptyPlaceholder'，见 commit 8e5b02a）。
 */
const CHAT_LIST_COMPONENTS = { Header: HistoryLoadingHeader }

/** firstItemIndex 的起始值。 */
/**
 * 默认 item 估算高度（px）。
 *
 * react-virtuoso 默认用「首个渲染的 item 作探针」测量默认高度。聊天场景末尾常是大段文章 /
 * 代码块（实测 dev 会话末项 2219px），用这种 outlier 作探针会把 totalHeight 估算到 73227px
 *（实际 20539），导致 initialTopMostItemIndex 定位的 offset 严重偏高，测量收敛时视口从
 * 错位位置跳到正确位置——用户看到「先展示其他位置内容后回到正确内容」的闪烁。
 *
 * 设 defaultItemHeight 后 Virtuoso 跳过探针 pass，直接用此值估算未测量 item。向上 prepend
 * 历史时新 item 同样用此值估算，收敛幅度也减小。
 *
 * 取值权衡：bubble 高度极度分散（实测 [29…2219]，中位 99 / 均值 355），单一值无法精确，
 * 选 400 接近「带多行文本/代码块的典型 bubble」——比末尾 outlier 探针好两个数量级，
 * 又不至于像中位值那样让长内容会话严重低估。
 */
const DEFAULT_ITEM_HEIGHT = 400

/**
 * firstItemIndex 的起始值。
 *
 * 必须远小于 `Number.MAX_SAFE_INTEGER`（2^53-1）：react-virtuoso 的 React key 默认由
 * `originalIndex + firstItemIndex` 算出，在 2^53 边界 float64 只能表示偶数，
 * 连续 index 会坍缩成同一个 key（9007199254740992 被 index 1 和 2 共用），
 * 造成 React key 大面积碰撞 → 消息重复渲染 + 尺寸测量错位 + 滚动定位错误。
 *
 * 本组件已显式传 computeItemKey（用稳定的 block id）规避 key 碰撞，
 * 但 firstItemIndex 仍参与 Virtuoso 内部的 index 算术，故一并留出安全余量。
 * 1e9 允许向上 prepend 十亿条历史，远超实际会话规模。
 */
const INITIAL_FIRST_ITEM_INDEX = 1_000_000_000

/**
 * 对外暴露的命令式 handle。
 *
 * 只暴露「回到底部并恢复跟随」这一个语义动作，不透出 Virtuoso 的 scrollToIndex——
 * 滚动权由 useStickToBottom 独占（见其文档），外部绕过它直接调 Virtuoso API
 * 会与贴底机制争抢 scrollTop。
 */
export interface VirtuosoChatListHandle {
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void
}

interface VirtuosoChatListProps {
    items: ChatBubbleItem[]
    /** 滚到顶部（更旧历史）时触发，对接 fetchNextPage */
    onStartReached?: () => void
    /** 跟随状态变化：false 表示用户在看历史，驱动「滚到底」按钮显隐 */
    onFollowingChange?: (following: boolean) => void
    /** 是否正在加载更旧的历史页（为 true 时顶部渲染骨架） */
    isFetchingNextPage?: boolean
}

/**
 * 虚拟化聊天列表 —— 用 react-virtuoso 替换 Bubble.List。
 *
 * 只渲染视口附近的 bubble（increaseViewportBy 扩展上下缓冲），DOM 节点数钳制在 ~几十，
 * 不随消息总量增长。Virtuoso 自动测量动态高度（无需估高），startReached 接管向上加载历史。
 *
 * 贴底跟随**不用** Virtuoso 的 followOutput，改由 useStickToBottom 独占（原因见该 hook 文档）。
 */
export const VirtuosoChatList = forwardRef<VirtuosoChatListHandle, VirtuosoChatListProps>(function VirtuosoChatList({ items, onStartReached, onFollowingChange, isFetchingNextPage }, ref) {
    const handleStartReached = useCallback(() => {
        onStartReached?.()
    }, [onStartReached])

    // Virtuoso 的 context prop：把加载态传给 Header，而不是把状态闭包进 Header 函数。
    // 这样 Header 组件类型恒定，只有 context 值变化（见 HISTORY_LOADING_COMPONENTS 注释）。
    const context = useMemo(
        () => ({ isFetchingNextPage: !!isFetchingNextPage }),
        [isFetchingNextPage],
    )

    // firstItemIndex：让 Virtuoso 识别"开头插入"（prepend 历史）vs"末尾追加"（流式新消息）。
    // Virtuoso 据此在 prepend 时维持滚动位置（用户看到的内容不被新加载的历史顶走）。
    //
    // ⚠️ 两个关键约束，都是踩坑换来的：
    //
    // 1) 必须渲染期同步更新，不能放 useEffect ——
    //    data(items prop) 在父组件渲染期变化，若 firstItemIndex 在 effect（提交后）才回填，
    //    中间一帧 Virtuoso 收到「新 data + 旧 firstItemIndex」→ 误判 prepend 为 append，
    //    内部 offset tree 与 startReached 状态机被污染，首次 prepend 后 startReached 永久失效。
    //    react-virtuoso 官方 auto-prepend 示例同样将 setFirstItemIndex 与 setData 同批同步执行。
    //
    // 2) 不能用「prevFirstKey 在新 items 找位置」算 prepend 量 ——
    //    reducer 重新归约整个 messages 数组时，边界 block（典型：孤立 permission block 在对应
    //    tool_use 加载后消失/并入真实 tool-call block）的 id 会变化，使 prevFirstKey 在新 items
    //    里 findIndex 返回 -1（实测 e2e：prepend 前 items[0]="call_xxx" 在 prepend 后消失），
    //    firstItemIndex 永不减小。
    //
    // 改用「末项 key 锚」：prepend 只在开头加项，末项（最新消息）的 key 不变。
    //   - 末项 key 不变 + 长度增长 = prepend，增量 = 长度差
    //   - 末项 key 变 = append（流式新消息）或首次加载，不减
    // 这样不依赖首项 key 的稳定性，能容忍 reducer 对边界 block 的重组。
    //
    // 幂等性（StrictMode 双调用渲染 / 渲染期 setState 触发的重渲染）：
    // prevLastKeyRef 与 prevLenRef 在渲染期即更新为当前值，第二次进入时 lastKey===prevLast 且
    // grown=0 → 不触发 setFirstItemIndex，不会重复减。渲染期写 ref 在 React 语义里允许（值幂等）。
    const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
    // ready：首次/prepend 测量 settle 前遮挡 item-list（见下方 ready 注释）。
    // 声明在此处因为 prepend 检测块（渲染期）要用 setReady，必须先于它初始化。
    const [ready, setReady] = useState(false)
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const prevLastKeyRef = useRef<string | undefined>(undefined)
    const prevLenRef = useRef(0)
    if (items.length > 0) {
        const lastKey = items[items.length - 1]?.key
        const prevLast = prevLastKeyRef.current
        if (lastKey !== undefined && lastKey === prevLast) {
            const grown = items.length - prevLenRef.current
            if (grown > 0) setFirstItemIndex(prev => prev - grown)
        }
        prevLastKeyRef.current = lastKey
        prevLenRef.current = items.length
    }

    // 贴底跟随：ResizeObserver 观测内容总高 + 几何判据管理跟随意图，详见 useStickToBottom。
    // items.length 由 0 变正时 item-list 才挂载，需重建观测，故用 enabled 参数驱动
    const { handleScrollerRef, following, stickToBottom, onContentHeightChange } = useStickToBottom(items.length > 0)

    // 首次/prepend 测量 settle 前遮挡 item-list，消除「先错位内容后正确内容」的闪烁。
    //
    // 机制：Virtuoso 首次定位 initialTopMostItemIndex 用估算高度算 offset，实测 item 高度后
    // offset 收敛、视口从错位跳到正确位置（实测 firstIdx 31→25 首次 / 0→30→26 prepend）。
    // defaultItemHeight 只缓解（高度分散单一值不精确）。彻底消除可见闪烁：settle 前用
    // visibility:hidden 盖住 item-list——Virtuoso 仍正常估算/测量/收敛（visibility 保留布局不影响
    // 测量），但用户看不到错位内容，settle 后直接显示稳定结果。
    //
    // settle 判据用 useLayoutEffect 监听 items 变化（不用 totalListHeightChanged——后者只在
    // totalHeight 变化时触发，不覆盖 firstIdx 的 scrollTop 调整收敛 ~300ms）：
    // - 首次（items 0→正）→ 遮挡 200ms（覆盖 firstIdx 收敛 ~60ms + 余量）
    // - prepend（末项 key 不变 + 长度增长）→ 遮挡 400ms（覆盖 firstIdx scrollTop 调整收敛 ~300ms）
    // useLayoutEffect 在 commit 后、paint 前同步跑，setReady(false) 在 firstIdx 跳前生效。
    // append（末项 key 变 = 流式新消息）不遮挡——用户想实时看新消息。
    // 会话切换时 VirtuosoChatList 由 ChatPane key={sessionId} 挂载，实例重建 ready 自动重置。
    const prevItemsRef = useRef<readonly ChatBubbleItem[]>([])
    useLayoutEffect(() => {
        const prev = prevItemsRef.current
        const isInitial = prev.length === 0 && items.length > 0
        const isPrepend = prev.length > 0 && items.length > prev.length
            && items[items.length - 1]?.key === prev[prev.length - 1]?.key
        prevItemsRef.current = items
        if (!isInitial && !isPrepend) return
        setReady(false)
        // 清旧 timer（多次 prepend 累积），设新 timer。不返回 cleanup——StrictMode 双调用 effect
        // 的 cleanup 会清掉刚设的 timer 且第二次因 prevItemsRef 已更新而 isInitial=false 不重设，
        // 导致 timer 丢失、ready 永久 false。timer 由下次 isInitial/isPrepend=true 的 clearTimeout
        // 管理；unmount 时 React 18 自动忽略 setReady（无 unmounted warning）。
        if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => setReady(true), isPrepend ? 400 : 200)
    }, [items])

    // 跟随状态上抛，驱动「滚到底」按钮显隐
    useEffect(() => {
        onFollowingChange?.(following)
    }, [following, onFollowingChange])

    useImperativeHandle(ref, (): VirtuosoChatListHandle => ({
        scrollToBottom: stickToBottom,
    }), [stickToBottom])

    // React key 用 item 自身稳定的 key（= block.id），不用 Virtuoso 默认的 index 算术。
    // 默认 computeItemKey 是恒等函数，key = originalIndex + firstItemIndex，既受浮点精度影响，
    // 又会在 prepend 时让同一条消息换 key（整列表重挂载）。用 block.id 后 key 与位置解耦。
    const computeItemKey = useCallback(
        (_index: number, item: ChatBubbleItem) => item.key,
        [],
    )

    // itemContent 保持稳定引用：内联箭头函数每次渲染都是新引用，会让 Virtuoso
    // 对所有可见项重新调用渲染，抵消 BubbleItem 的 memo
    const itemContent = useCallback(
        (_index: number, item: ChatBubbleItem) => <BubbleItem item={item} />,
        [],
    )

    // 外层 wrapper div 承载 ready 遮挡类名（Virtuoso 不把 className 透传到 scroller 祖先，
    // 故用 wrapper + CSS 子选择器 .vcl-settling [data-testid="virtuoso-item-list"] 盖住 item-list）
    return (
        <div className={ready ? undefined : 'vcl-settling'} style={{ height: '100%' }}>
        <Virtuoso
            data={items}
            firstItemIndex={firstItemIndex}
            computeItemKey={computeItemKey}
            // 初始滚到底部（最新消息）
            initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
            // 跳过探针 pass，避免末尾 outlier item 作探针致 totalHeight 估算严重偏高
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            itemContent={itemContent}
            // 顶部加载更旧历史时渲染骨架（替代旧 Bubble.List 的 __loading-skeleton__ 项）。
            // 组件类型与对象引用均为模块级常量，加载态经 context 传入（见 HistoryLoadingHeader）
            components={CHAT_LIST_COMPONENTS}
            context={context}
            startReached={handleStartReached}
            // 有意不传 followOutput / atBottomStateChange：跟随由 useStickToBottom 独占。
            // 两者并存会争抢 scrollTop（followOutput 的 smooth 动画 vs observer 的瞬跳），
            // 表现为流式期间卡顿抖动；atBottomStateChange 的 4px 判据则让按钮闪烁。
            //
            // totalListHeightChanged：Virtuoso 测量系统在内部布局 settle 后触发，此时读 scrollHeight
            // 是最终值，补 RO 观测 DOM 层的时序差（修「turn 结束差几十 px」残留）。
            totalListHeightChanged={onContentHeightChange}
            // 视口外缓冲（类似 overscan），避免快速滚动时空白
            increaseViewportBy={{ top: 600, bottom: 600 }}
            // 拿到滚动容器，供 ResizeObserver 观测内容高度变化（流式贴底跟随）
            scrollerRef={handleScrollerRef}
            style={{ height: '100%' }}
        />
        </div>
    )
})
