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

import {
    Plus,
    Search,
    Blocks,
    Clock,
    Settings,
    LogOut,
    type LucideIcon,
} from 'lucide-react'

// 导航项配置
export interface NavItemConfig {
    key: string
    icon: LucideIcon
    labelKey: string
    disabled?: boolean
}

// 主导航项（侧边栏显示）
export const mainNavItems: NavItemConfig[] = [
    { key: 'new-session', icon: Plus, labelKey: 'nav.newSession' },
    { key: 'search', icon: Search, labelKey: 'nav.search', disabled: true },
    { key: 'plugins', icon: Blocks, labelKey: 'nav.plugins', disabled: true },
    { key: 'automation', icon: Clock, labelKey: 'nav.automation', disabled: true },
]

// 退出登录项
export const logoutNavItem: NavItemConfig = {
    key: 'logout',
    icon: LogOut,
    labelKey: 'nav.logout',
}

// 导航路径映射 - 统一管理所有导航路径
export const navPathMap: Record<string, string> = {
    'new-session': '/sessions/new',
    sessions: '/sessions',
    settings: '/settings',
}

// 根据当前路径判断导航项是否激活
export function getNavActiveKey(pathname: string, key: string): boolean {
    if (key === 'new-session') {
        return pathname === '/sessions/new'
    }
    if (key === 'sessions') {
        return pathname === '/' || pathname === '/sessions' || pathname.startsWith('/sessions/')
    }
    return pathname === `/${key}`
}

// 移动端菜单项（MobileMenu 使用，项目列表单独嵌入）
export const mobileNavItems: NavItemConfig[] = [
    { key: 'new-session', icon: Plus, labelKey: 'nav.newSession' },
    { key: 'settings', icon: Settings, labelKey: 'nav.settings' },
]
