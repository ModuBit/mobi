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
 * 移动端 history 哨兵：让全屏手势返回（iOS 边缘滑动 / Android 返回键 / 浏览器 back）
 * 先关闭顶层覆盖物（drawer / 全屏面板），而非穿透到路由层退出 session detail。
 *
 * ## 痛点
 * session detail 是 TanStack Router 路由（`$sessionId`），而 drawer 的 open、
 * SplitLayout 的 expanded 都是组件级 state —— 它们不入 history。
 * 移动端全屏手势返回触发 popstate → TanStack Router 后退 → 直接退出 session detail，
 * 用户本意只是关掉 drawer / 收起 InspectorPane。
 *
 * ## 原理
 * 覆盖物打开时 push 一个「同 URL 的 history entry」（哨兵）。
 * - 用户手势返回 → popstate 消费哨兵 → URL 未变，TanStack Router 不重渲染、不跳路由，
 *   我们转而调用覆盖物的收起回调。
 * - 覆盖物主动关闭（点遮罩 / 下拉 / 按钮）→ 调 disposer → 在微任务中 history.back() 弹掉哨兵，
 *   期间触发的 popstate 由 suppressCount 抑制，不会误关其它覆盖物。
 *
 * ## 为什么按「落点」对齐而不是按次数递减（2026-10-13 修）
 * 早期实现用一个 depth 计数器 + 回调栈：每来一次 popstate 就 depth--、弹一个回调。
 * 这隐含假设「一次 popstate = 吞掉一条 entry」。真机上不成立——连按返回键 / 长按连发 /
 * iOS 边缘滑动收尾，浏览器会把多次回退**合并成一次多级回退**：吞掉 N 条 entry，只派发
 * 一个 popstate（实测 390×844 移动视口：一次 back() 连发吞掉 2 条 entry，仅 1 个 popstate）。
 * 于是计数与真实 entry 失配：哨兵提前耗尽，用户再按一次返回就落到**路由 entry**上，
 * 表现为「关掉二级后再返回直接退出页面/应用」。
 *
 * 现在以 popstate 的落点（`event.state.guardId`）为准**整段对齐**：落到哪条哨兵，
 * 就把它之上的所有覆盖物一次收起；落到没有哨兵标记的 entry（路由层）则整栈收起。
 * 这样无论浏览器吞掉几条、派发几次事件，记账都能收敛回真实栈序。
 *
 * ## 孤儿哨兵：已关闭但 entry 没被弹掉的那条（2026-10-13 修）
 * 覆盖物**自己关闭**时（disposer）只有在「history 栈顶还是我这条」时才会 back 弹掉哨兵。
 * 若关闭的同时上层又压了新哨兵（真机场景：菜单层的 ActionSheet 选中一项后自己关掉，同一回调里
 * 二级 sheet 打开），栈顶已不是它 → 不 back，那条哨兵就成了**孤儿 entry**留在浏览器 history 里。
 * 用户返回正好会停在它上面——曾经这条落点「编号在栈里找不到」被当成路由层，触发**整栈收起**：
 * 看得见的菜单 + 二级弹层一起消失，用户下一次返回就落到路由 entry 上退出页面（与上面那类
 * 「两次返回退出」同源）。
 * 现在已关闭的哨兵不从栈里摘除，而是降级为**死标记**（`dead`）——它的 entry 还在 history 里，
 * 落点对齐就得找得到它：停到死标记上，只收起它**之上**的活层，它自己随这次返回被消费后摘掉。
 * 「整栈收起」只留给真正找不到的落点（路由层 entry、HMR 产生的陈旧 entry）。
 *
 * 连带的一条：**抑制位不能「无条件吞掉」**。我们自己 back() 弹哨兵时设的抑制位，可能正好
 * 和用户紧接着按的返回合并成同一次多级回退（顺序按两次返回也中：第一次关二级、第二次在滑出
 * 动画窗口内）——此时那个 popstate 既是自弹也是用户那一次，只吞不记账就丢了一次返回，
 * 用户下一次按返回就落到路由 entry 上退出页面。故抑制只用来决定「落点不是哨兵时不要乱收」，
 * 落点是哨兵时照常按落点对齐。
 *
 * ## 不要在 popstate 之后再补 entry（2026-10-13 删掉「滑出窗口重臂」）
 * 覆盖物层早期在「手势返回关掉本层」后，于滑出动画起手再 push 一条哨兵覆盖动画窗口、落定
 * 时再自己 back() 弹掉。真机上这会让 Android Chrome 的返回键彻底失能：**第二次返回既不来
 * popstate 也不来 navigate**（移动视口实测 Navigation API `idx=4 hl=6` 却零事件），浏览器
 * 直接把应用关掉——用户看到的就是「关掉二级后再返回直接退出 PWA」。根因是我们做了别的网站
 * 都不做的动作：popstate 之后又写一条 history entry。删掉重臂后这条路上只剩用户手势导航，
 * 第二次返回自然落到下一层哨兵（或路由 entry）上，由上面的落点对齐处理。
 * **推论**：任何「收到 popstate 后再补历史」的写法都不要引入，包括用重臂去覆盖退出动画窗口。
 *
 * ## 为什么 disposer 的 back 决策必须异步
 * TanStack Router 的 navigate 把 pushState 异步化（@tanstack/history queueHistoryAction 排微任务
 * 才 flush）。点 session 列表切换是「navigate + 关 drawer」同一回调：若 disposer 同步判断
 * history.state，此时 flush 尚未落地、state 仍是哨兵 → 误 history.back() 把刚 push 的路由 entry
 * 弹掉，navigate 被抵消（移动端切 session 无反应）。故 disposer 用 queueMicrotask 延迟判断，
 * 并按哨兵唯一 guardId 精确匹配「栈顶是否本哨兵」，覆盖「纯关闭 / 导航压顶 / 快速重开」三态。
 *
 * ## 嵌套
 * InspectorPane 展开后又开了文件预览 drawer：每个覆盖物各 push 一个哨兵，
 * `stack` 维持栈序，手势返回总是先收起最顶层；一次多级回退则连着收起沿途所有层。
 */

/** 一个哨兵：id 写进对应 history entry 的 state，用于 popstate 时判断落点 */
interface GuardEntry {
    id: number
    onBackPressed: () => void
    /**
     * 已主动关闭（disposer 跑过），但它的 history entry **可能还留在栈里**——关闭的同时上层又
     * push 了新哨兵（微任务的落点检查会跳过 back），这条就成了孤儿 entry。保留为「死标记」而
     * 不是从栈里摘除，是为了让落点对齐仍能找到它（见文件头「孤儿哨兵」）。
     */
    dead?: boolean
}

/** 栈：我们推出去的哨兵，按 history 栈序。后入先出，与浏览器 history 一致。
 *  **包含死标记**——它对应一条仍在浏览器 history 里的 entry，落点判断需要它 */
const stack: GuardEntry[] = []
/** 我们自己 history.back() 会异步触发 popstate，这些需被抑制，避免误关栈顶覆盖物 */
let suppressCount = 0
/** 全局 popstate 监听是否已安装（幂等） */
let installed = false
/** 哨兵自增 id：每条 push 的 history entry 携带唯一 guardId，dispose 时据此精确判断
 *  「history 栈顶是不是我这条哨兵」，避免误弹别的 entry（路由 entry / 新哨兵） */
let nextGuardId = 1

/** 安装全局 popstate 监听。幂等，仅浏览器环境生效 */
function ensureInstalled(): void {
    if (installed || typeof window === 'undefined') return
    installed = true
    const w = window as unknown as { __mobiHistoryGuardHandler?: (event: PopStateEvent) => void }
    // HMR 保护：开发态热更新会重新求值本模块（installed 重置为 false），但旧实例注册的
    // popstate listener 仍挂在 window 上。先移除旧的，避免同一次 popstate 触发两次回调
    // 导致栈与实际哨兵数错位。生产环境无此属性，正常注册。
    if (w.__mobiHistoryGuardHandler) {
        window.removeEventListener('popstate', w.__mobiHistoryGuardHandler)
    }
    const handler = (event: PopStateEvent): void => {
        // 我们主动 back() 弹哨兵触发的 popstate 要抑制（否则会误关覆盖物）。但抑制**不等于
        // 不记账**：浏览器的回退可能把「我们的 back()」和「用户同时按的返回」合并成一次多级
        // 回退（只派发一个 popstate），此时这个事件既是自弹也是用户那一次——只吞不记账就会
        // 与真实 entry 失配，用户下一次返回直接落到路由 entry 退出页面（真机症状）
        const selfPopped = suppressCount > 0
        if (selfPopped) suppressCount--

        // 用户手势返回 / 自弹：**都以浏览器实际落点为准对齐整段栈**，不按次数递减
        // （见文件头「为什么按落点对齐」）。落点 entry 之上的哨兵全部作废并收起，顶层先收。
        const landed = event.state as { mobiHistoryGuard?: boolean; guardId?: number } | null
        const landedId = landed?.mobiHistoryGuard ? landed.guardId : undefined
        // findIndex 找不到时给 -1，与「落点不是哨兵」是同一件事，**不能当 index 用**：
        // -1 会走到 closeFrom(0)（当 index+1 用）→ 绕过下面的自弹守卫、把整栈覆盖物全部收起
        // （HMR 残留 entry / id 计数器重置后，一条认不出的哨兵 entry 就够触发）
        const index = landedId == null ? -1 : stack.findIndex((entry) => entry.id === landedId)
        if (index < 0) {
            // 落点不是本模块的哨兵（路由 entry / 连编号都对不上的 entry）：用户手势落到这里 =
            // 实际退到了所有覆盖物之下 → 整栈收起；自弹落到这里只说明压在我们下面的不是哨兵，不收
            if (selfPopped) return
            closeFrom(0)
            return
        }
        closeFrom(index + 1)
        // 停到的这条若是死标记（用户返回消费了一条「已主动关闭、entry 没被弹掉」的孤儿哨兵），
        // 它自己也已被浏览器消费 → 摘掉，避免栈里越积越多
        if (stack[index]?.dead) stack.splice(index, 1)
    }
    w.__mobiHistoryGuardHandler = handler
    window.addEventListener('popstate', handler)
}

/** 收起 stack 中 [from, …) 的全部覆盖物，顶层先收（后入先出）。死标记只摘除、不回调 */
function closeFrom(from: number): void {
    const closing = stack.splice(from)
    for (let i = closing.length - 1; i >= 0; i--) {
        if (!closing[i].dead) closing[i].onBackPressed()
    }
}

/**
 * 推一个 history 哨兵，注册「手势返回时应执行的收起动作」。
 *
 * @param onBackPressed 用户手势返回（消费哨兵）时要执行的收起逻辑（如关 drawer、收起面板）
 * @returns disposer —— 覆盖物主动关闭时调用，弹掉哨兵；若哨兵已被 popstate 消费则空操作
 */
export function pushHistoryGuard(onBackPressed: () => void): () => void {
    ensureInstalled()
    const entry: GuardEntry = { id: nextGuardId++, onBackPressed }
    stack.push(entry)
    // 同 URL 哨兵：URL 不变，popstate 后 TanStack Router 匹配结果不变，不触发跳转/重渲染
    window.history.pushState({ mobiHistoryGuard: true, guardId: entry.id }, '')

    let disposed = false
    return () => {
        if (disposed) return
        disposed = true
        const index = stack.indexOf(entry)
        // 已被 popstate 消费（不在了）→ 无需再 back。否则降级为死标记：entry 先留着——它的
        // history entry 未必会被下面这个 back 弹掉（关闭的同时上层又 push 了新哨兵），留着才能
        // 在用户返回停到它时按落点对齐（见文件头「孤儿哨兵」）
        if (index < 0) return
        entry.dead = true

        // ⚠️ 必须延迟到微任务再决定是否 back。TanStack Router 的 navigate 把 pushState 异步化
        // （@tanstack/history 的 queueHistoryAction 排一个微任务才 flush）。点 session 切换正是
        // 「navigate + 关 drawer」同一回调：navigate 在事件同步阶段排队 flush 微任务；React 在
        // 事件结束后异步跑 passive effect（含本 dispose）→ 本微任务必排在 flush 之后。故微任务
        // 执行时 flush 已落地、history.state 已更新为路由 entry → 不 back。
        //
        // 若同步判断（旧实现），dispose 跑时 flush 尚未落地，state 仍是本哨兵 → 误 history.back()，
        // 把刚 push 的路由 entry 弹掉、navigate 被抵消 —— 移动端点列表切 session 无反应的根因。
        // （桌面端 session 列表内嵌 AppSidebar、不经底部 sheet 哨兵，故不受影响。）
        queueMicrotask(() => {
            const st = window.history.state as { mobiHistoryGuard?: boolean; guardId?: number } | null
            // 仅当 history 栈顶仍是「本哨兵」才 back 弹掉：
            // - 纯关闭（无导航）：state.guardId === entry.id → back ✓
            // - navigate 已压入路由 entry：state 无 mobiHistoryGuard → 不 back（路由 entry 留栈顶）✓
            // - 快速重开压了新哨兵：state.guardId === 新 id ≠ entry.id → 不 back ✓
            // 其余情况哨兵作为孤儿 entry 留在 history，落到它时由 handler 整栈收起（无害）
            if (st && st.mobiHistoryGuard && st.guardId === entry.id) {
                suppressCount++
                window.history.back()
            }
        })
    }
}

/** @internal 测试专用：重置模块级状态（生产代码不要调用） */
export function __resetHistoryGuardForTest(): void {
    stack.length = 0
    suppressCount = 0
    nextGuardId = 1
    // installed 保留：addEventListener 重复注册反而有害；模块状态已清，监听器读到空栈是 no-op
}
