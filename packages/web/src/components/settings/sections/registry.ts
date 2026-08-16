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

import { Bell, Globe, Bug, type LucideIcon } from 'lucide-react'
import { isDebugUnlocked } from '@/core/lib/debug'

/** 设置分区定义：入口列表（mobile）与分区导航（PC）共用的单一真相 */
export interface SettingsSection {
    /** 分区 id（同时是子路由段） */
    id: 'notifications' | 'web-tools' | 'debug'
    /** i18n 标题 key */
    titleKey: string
    /** i18n 副标题 key */
    descKey: string
    icon: LucideIcon
    /** 是否渲染入口（调试分区未解锁时隐藏，子路由直达仍渲染空分区） */
    visible: () => boolean
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
    { id: 'notifications', titleKey: 'settings.sections.notifications.title', descKey: 'settings.sections.notifications.desc', icon: Bell, visible: () => true },
    { id: 'web-tools', titleKey: 'settings.sections.webTools.title', descKey: 'settings.sections.webTools.desc', icon: Globe, visible: () => true },
    { id: 'debug', titleKey: 'settings.sections.debug.title', descKey: 'settings.sections.debug.desc', icon: Bug, visible: () => isDebugUnlocked() },
]

/**
 * 从 pathname 推断当前激活分区 id（/settings/web-tools → web-tools）
 * 未知段返回 null：PC 分支照常渲染路由 Not Found，mobile 分支回到入口态（settings.title + SidebarToggle）
 */
export function activeSectionId(pathname: string): SettingsSection['id'] | null {
    const match = /^\/settings\/([\w-]+)/.exec(pathname)
    const segment = match?.[1]
    return SETTINGS_SECTIONS.find((s) => s.id === segment)?.id ?? null
}
