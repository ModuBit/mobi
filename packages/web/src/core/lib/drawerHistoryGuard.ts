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
 * - 覆盖物主动关闭（点遮罩 / 下拉 / 按钮）→ 调 disposer → history.back() 弹掉哨兵，
 *   期间触发的 popstate 由 suppressCount 抑制，不会误关其它覆盖物。
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
    // 同 URL 哨兵：URL 不变，popstate 后 TanStack Router 匹配结果不变，不触发跳转/重渲染
    window.history.pushState({ mobiHistoryGuard: true }, '')

    let disposed = false
    return () => {
        if (disposed) return
        disposed = true
        const idx = closeStack.lastIndexOf(onBackPressed)
        // 已被 popstate 消费（栈里找不到）→ 无需再 back
        if (idx < 0) return
        // 只有本覆盖物的哨兵在 closeStack 栈顶时，其 history 哨兵才在 history 栈顶可直接 back 弹掉。
        // 若上方还有未关闭的覆盖物（idx 非最后一项），本哨兵被压在 history 下方，主动 back 会误弹
        // 栈顶覆盖物的哨兵 —— 此时只从栈中移除，本哨兵作为孤儿 entry 留在 history，由后续 popstate 自然消费
        const isTop = idx === closeStack.length - 1
        closeStack.splice(idx, 1)
        depth--
        if (!isTop) return
        // 栈顶哨兵：再确认 history 当前 entry 确实是我们的哨兵（state 含标记），而非上方压了路由 entry。
        // 若 Router 在哨兵为当前 entry 时 replaceState 覆盖了 state（scroll restoration 等），此处读到
        // undefined → 不 back，哨兵残留（退化：用户多按一次返回，无功能损害）
        const st = window.history.state as { mobiHistoryGuard?: boolean } | null
        if (st && st.mobiHistoryGuard) {
            suppressCount++
            window.history.back()
        }
    }
}

/** @internal 测试专用：重置模块级状态（生产代码不要调用） */
export function __resetHistoryGuardForTest(): void {
    closeStack.length = 0
    depth = 0
    suppressCount = 0
    // installed 保留：addEventListener 重复注册反而有害；模块状态已清，监听器读到空栈是 no-op
}
