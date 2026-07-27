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
 * ## 为什么 disposer 的 back 决策必须异步
 * TanStack Router 的 navigate 把 pushState 异步化（@tanstack/history queueHistoryAction 排微任务
 * 才 flush）。点 session 列表切换是「navigate + 关 drawer」同一回调：若 disposer 同步判断
 * history.state，此时 flush 尚未落地、state 仍是哨兵 → 误 history.back() 把刚 push 的路由 entry
 * 弹掉，navigate 被抵消（移动端切 session 无反应）。故 disposer 用 queueMicrotask 延迟判断，
 * 并按哨兵唯一 guardId 精确匹配「栈顶是否本哨兵」，覆盖「纯关闭 / 导航压顶 / 快速重开」三态。
 *
 * ## 嵌套
 * InspectorPane 展开后又开了文件预览 drawer：每个覆盖物各 push 一个哨兵，
 * closeStack 维持栈序（后入先出），手势返回总是先收起最顶层。
 */

/** 栈：每个哨兵对应的「手势返回时收起」回调。后入先出，与 history 栈序一致 */
const closeStack: Array<() => void> = []
/** 当前已 push 的哨兵层数（语义上等于 closeStack.length，独立计数便于阅读） */
let depth = 0
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
    const w = window as unknown as { __mobiHistoryGuardHandler?: () => void }
    // HMR 保护：开发态热更新会重新求值本模块（installed 重置为 false），但旧实例注册的
    // popstate listener 仍挂在 window 上。先移除旧的，避免同一次 popstate 触发两次回调
    // 导致 depth 与实际哨兵数错位。生产环境无此属性，正常注册。
    if (w.__mobiHistoryGuardHandler) {
        window.removeEventListener('popstate', w.__mobiHistoryGuardHandler)
    }
    const handler = () => {
        // 我们主动 back() 弹哨兵触发的 popstate：哨兵已从栈中移除并记账，不再处理
        if (suppressCount > 0) {
            suppressCount--
            return
        }
        // 用户手势返回消费了栈顶哨兵 → 收起对应覆盖物（URL 不变，路由不动）。
        // 前提：覆盖物打开期间不会发生路由层导航（mobi 中 drawer 遮罩盖全屏、InspectorPane 全屏，
        // 均拦截路由点击），故 history 栈顶始终是我们的哨兵。若未来引入「覆盖物打开期间路由跳转」，
        // 路由 entry 会压在哨兵之上，此处会把路由 back 误当作消费哨兵 —— 届时需改为按哨兵唯一 id
        // 精确匹配 event.state。
        if (depth > 0) {
            depth--
            const close = closeStack.pop()
            close?.()
        }
    }
    w.__mobiHistoryGuardHandler = handler
    window.addEventListener('popstate', handler)
}

/**
 * 推一个 history 哨兵，注册「手势返回时应执行的收起动作」。
 *
 * @param onBackPressed 用户手势返回（消费哨兵）时要执行的收起逻辑（如关 drawer、收起面板）
 * @returns disposer —— 覆盖物主动关闭时调用，弹掉哨兵；若哨兵已被 popstate 消费则空操作
 */
export function pushHistoryGuard(onBackPressed: () => void): () => void {
    ensureInstalled()
    depth++
    closeStack.push(onBackPressed)
    const guardId = nextGuardId++
    // 同 URL 哨兵：URL 不变，popstate 后 TanStack Router 匹配结果不变，不触发跳转/重渲染
    window.history.pushState({ mobiHistoryGuard: true, guardId }, '')

    let disposed = false
    return () => {
        if (disposed) return
        disposed = true
        const idx = closeStack.lastIndexOf(onBackPressed)
        // 已被 popstate 消费（栈里找不到）→ 无需再 back
        if (idx < 0) return
        closeStack.splice(idx, 1)
        depth--

        // ⚠️ 必须延迟到微任务再决定是否 back。TanStack Router 的 navigate 把 pushState 异步化
        // （@tanstack/history 的 queueHistoryAction 排一个微任务才 flush）。点 session 切换正是
        // 「navigate + 关 drawer」同一回调：navigate 在事件同步阶段排队 flush 微任务；React 在
        // 事件结束后异步跑 passive effect（含本 dispose）→ 本微任务必排在 flush 之后。故微任务
        // 执行时 flush 已落地、history.state 已更新为路由 entry → 不 back。
        //
        // 若同步判断（旧实现），dispose 跑时 flush 尚未落地，state 仍是本哨兵 → 误 history.back()，
        // 把刚 push 的路由 entry 弹掉、navigate 被抵消 —— 移动端点列表切 session 无反应的根因。
        // （桌面端 session 列表内嵌 AppSidebar、不经 MobileDrawer 哨兵，故不受影响。）
        queueMicrotask(() => {
            const st = window.history.state as { mobiHistoryGuard?: boolean; guardId?: number } | null
            // 仅当 history 栈顶仍是「本哨兵」才 back 弹掉：
            // - 纯关闭（无导航）：state.guardId === guardId → back ✓
            // - navigate 已压入路由 entry：state 无 mobiHistoryGuard → 不 back（路由 entry 留栈顶）✓
            // - 快速重开压了新哨兵：state.guardId === 新 id ≠ guardId → 不 back ✓
            // 其余情况哨兵作为孤儿 entry 留在 history，由后续 popstate 自然消费
            if (st && st.mobiHistoryGuard && st.guardId === guardId) {
                suppressCount++
                window.history.back()
            }
        })
    }
}

/** @internal 测试专用：重置模块级状态（生产代码不要调用） */
export function __resetHistoryGuardForTest(): void {
    closeStack.length = 0
    depth = 0
    suppressCount = 0
    nextGuardId = 1
    // installed 保留：addEventListener 重复注册反而有害；模块状态已清，监听器读到空栈是 no-op
}
