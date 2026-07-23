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
 * 通知点击跳转决策（纯函数，与 SW 运行时解耦，便于单测）。
 *
 * 背景：已安装 PWA 的通知点击必须「聚焦已有窗口 + 让前端 SPA 跳转到目标 session」。
 * 旧实现只 focus pathname 严格匹配的窗口，否则 clients.openWindow——但 standalone PWA
 * 窗口已存在时 openWindow 只聚焦不导航,导致点击「没反应/不跳转」。
 *
 * 决策优先级：
 * 1. 已有窗口的 pathname 恰在目标 session → focus（无需导航）
 * 2. 否则 focus 任意窗口 + postMessage 让前端路由跳转（SPA 无刷新）
 * 3. 无窗口 → openWindow（新窗口整页加载到目标 url）
 *
 * 4. data 无 url → noop（兼容不带 url 的通知）
 */

/** 决策所需的最小 client 形状（SW Client 满足此结构） */
export interface ClickClient {
    url: string
    focus: () => Promise<unknown>
    postMessage: (message: unknown) => void
}

/** 通知点击要执行的动作 */
export type ClickPlan =
    | { kind: 'noop' }
    | { kind: 'focus'; client: ClickClient }
    | { kind: 'focusAndNavigate'; client: ClickClient; url: string }
    | { kind: 'openWindow'; url: string }

/** 判断某 client 的 pathname 是否落在目标 url（精确或子路径，避免子串误匹配） */
function pathMatches(clientUrl: string, target: string): boolean {
    try {
        const path = new URL(clientUrl).pathname
        return path === target || path.startsWith(`${target}/`)
    } catch {
        return false
    }
}

/**
 * 根据目标 url 与当前已打开的窗口列表，决定点击通知后做什么。
 * 纯函数：不产生副作用，由调用方（sw.ts）执行返回的 plan。
 */
export function planNotificationClick(url: string | undefined, clients: ClickClient[]): ClickPlan {
    if (!url) {
        return { kind: 'noop' }
    }

    // 1. 已有窗口在目标 session → 直接聚焦
    const exact = clients.find((c) => pathMatches(c.url, url))
    if (exact) {
        return { kind: 'focus', client: exact }
    }

    // 2. 有任意窗口 → 聚焦它并让前端 SPA 跳转
    const any = clients[0]
    if (any) {
        return { kind: 'focusAndNavigate', client: any, url }
    }

    // 3. 无窗口 → 新开
    return { kind: 'openWindow', url }
}
