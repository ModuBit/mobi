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

import { lazy, type ComponentType } from 'react'

// 路由 chunk 加载层：独立于 router.tsx（router 依赖 App，App 又要预取——放这里
// 让两者都单向依赖本模块，避免 App ↔ router 循环依赖）。
// 页面组件用 React.lazy 拆成独立 chunk，把 chat/bubble/toolcard/markdown/editor 等
// 重依赖移出主入口 bundle——首屏（尤其登录路径）只下 react+antd+providers+router 基础包。

/** 路由 chunk 加载器：动态 import + 页面的具名导出名 */
export interface RouteChunkLoader {
    load: () => Promise<unknown>
    pick: string
}

/**
 * 定义路由 chunk 加载器：pick 经 `keyof T` 编译期锁定为该模块的真实导出名——
 * 页面组件重命名而漏改 pick 时直接编译失败，而不是运行时渲染 undefined 崩溃
 */
function defineLoader<T extends object>(load: () => Promise<T>, pick: keyof T & string): RouteChunkLoader {
    return { load: load as () => Promise<unknown>, pick }
}

// React.lazy 与空闲预取（prefetchRouteChunks）共用同一批 import()，
// 保证预取拉到的 URL 就是路由真正要的 chunk，后续导航命中 HTTP 缓存毫秒级返回。
export const routeChunkLoaders = {
    LoginPage: defineLoader(() => import('@/pages/LoginPage'), 'LoginPage'),
    MainLayout: defineLoader(() => import('@/components/layout/MainLayout'), 'MainLayout'),
    SessionsLayout: defineLoader(() => import('@/pages/SessionsLayout'), 'SessionsLayout'),
    SessionDetailPage: defineLoader(() => import('@/pages/SessionDetailPage'), 'SessionDetailPage'),
    NewSessionPage: defineLoader(() => import('@/pages/NewSessionPage'), 'NewSessionPage'),
    SettingsLayout: defineLoader(() => import('@/pages/SettingsPage'), 'SettingsLayout'),
    NotificationsSection: defineLoader(() => import('@/components/settings/sections/NotificationsSection'), 'NotificationsSection'),
    SettingsIndex: defineLoader(() => import('@/components/settings/sections/SettingsIndex'), 'SettingsIndex'),
    WebToolsSection: defineLoader(() => import('@/components/settings/sections/WebToolsSection'), 'WebToolsSection'),
    DebugSectionRoute: defineLoader(() => import('@/components/settings/sections/DebugSectionRoute'), 'DebugSectionRoute'),
} satisfies Record<string, RouteChunkLoader>

// 具名导出 → React.lazy 的 default 约定适配
export const lazyRoute = (loader: RouteChunkLoader) =>
    lazy(async () => {
        const mod = (await loader.load()) as Record<string, ComponentType>
        return { default: mod[loader.pick] }
    })

/**
 * 空闲预取全部路由 chunk：认证判定通过后由 App 在浏览器空闲时调用一次。
 * 串行逐个拉取：每个 chunk 都很小，串行总时长可接受，且避免弱网下 10 个并发
 * 请求挤占首屏数据链路带宽。单个 chunk 预取失败静默——真正导航时 React.lazy
 * 会重新发起加载，走既有 loading 兜底。
 */
export async function prefetchRouteChunks(): Promise<void> {
    for (const loader of Object.values(routeChunkLoaders)) {
        await loader.load().catch(() => {
            // 静默：预取是锦上添花，失败不应打扰用户
        })
    }
}
