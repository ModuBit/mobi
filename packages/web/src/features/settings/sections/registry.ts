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

import { Bell, Globe, Bug, Brain, Activity, MapPin, FolderTree, Archive, Sparkles, type LucideIcon } from 'lucide-react'
import { isDebugUnlocked } from '@/core/lib/debug'
import { normalizeNeedle } from '@/ui/base/interactive/optionSearch'
import { SETTINGS_WIDE_QUERY } from '@/domain/navigation/settingsPath'

/**
 * 设置分区导航断点：≥992px 显示左侧分区导航。真相在 domain/navigation/settingsPath
 * （MainLayout 主侧栏让位须用同一断点，域间互引禁止故下沉 domain），此处转发导出，
 * 分区组件照旧从 registry 取（分区单一真相入口不变）。
 */
export { SETTINGS_WIDE_QUERY }

/** 分区徽标声明：渲染层据此挂对应状态组件（机制在 registry，组件映射在渲染点） */
export type SettingsSectionBadge = 'web-tools-status'

/** 分区分组 id：通用（通知/工具/记忆类）→ 工具（遥测/地图/工作树）→ 开发者（调试） */
export type SettingsSectionGroupId = 'general' | 'tools' | 'developer'

/** 设置分组定义：分组视图（PC 侧栏 / mobile 入口）的分组标题与顺序单一真相 */
export interface SettingsSectionGroup {
    id: SettingsSectionGroupId
    /** i18n 分组标题 key */
    titleKey: string
}

/** 分组定义顺序即渲染顺序 */
export const SETTINGS_SECTION_GROUPS: SettingsSectionGroup[] = [
    { id: 'general', titleKey: 'settings.groups.general.title' },
    { id: 'tools', titleKey: 'settings.groups.tools.title' },
    { id: 'developer', titleKey: 'settings.groups.developer.title' },
]

/** 设置分区定义：入口列表（mobile）与分区导航（PC）共用的单一真相 */
export interface SettingsSection {
    /** 分区 id（同时是子路由段） */
    id: 'notifications' | 'web-tools' | 'skills' | 'memory' | 'archived' | 'telemetry' | 'map' | 'worktrees' | 'debug'
    /** i18n 标题 key */
    titleKey: string
    /** i18n 副标题 key */
    descKey: string
    icon: LucideIcon
    /** 是否渲染入口（调试分区未解锁时隐藏，子路由直达仍渲染空分区） */
    visible: () => boolean
    /** 状态徽标（有实时摘要的分区声明；PC 导航与 mobile 入口两处渲染点共用同一映射） */
    badge?: SettingsSectionBadge
    /** 所属分组（分组视图据此归位） */
    groupId: SettingsSectionGroupId
    /**
     * 内容布局模式：缺省 'form'（表单流——设置壳整区滚动）；'fill' = 列表流分区
     * （设置壳只让出滚动 overflow:hidden + flex 纵向链，分区组件满高内滚——归档列表
     * 的 Listy 虚拟滚动需要限高容器，整区滚动会把它撑开）。声明在此单一真相，
     * SettingsPage 只是渲染响应。
     */
    layout?: 'fill'
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
    { id: 'notifications', titleKey: 'settings.sections.notifications.title', descKey: 'settings.sections.notifications.desc', icon: Bell, visible: () => true, groupId: 'general' },
    { id: 'web-tools', titleKey: 'settings.sections.webTools.title', descKey: 'settings.sections.webTools.desc', icon: Globe, visible: () => true, badge: 'web-tools-status', groupId: 'general' },
    { id: 'skills', titleKey: 'settings.sections.skills.title', descKey: 'settings.sections.skills.desc', icon: Sparkles, visible: () => true, groupId: 'general' },
    { id: 'memory', titleKey: 'settings.sections.memory.title', descKey: 'settings.sections.memory.desc', icon: Brain, visible: () => true, groupId: 'general' },
    { id: 'archived', titleKey: 'settings.sections.archived.title', descKey: 'settings.sections.archived.desc', icon: Archive, visible: () => true, groupId: 'general', layout: 'fill' },
    { id: 'telemetry', titleKey: 'settings.sections.telemetry.title', descKey: 'settings.sections.telemetry.desc', icon: Activity, visible: () => true, groupId: 'tools' },
    { id: 'map', titleKey: 'settings.sections.map.title', descKey: 'settings.sections.map.desc', icon: MapPin, visible: () => true, groupId: 'tools' },
    { id: 'worktrees', titleKey: 'settings.sections.worktrees.title', descKey: 'settings.sections.worktrees.desc', icon: FolderTree, visible: () => true, groupId: 'tools' },
    { id: 'debug', titleKey: 'settings.sections.debug.title', descKey: 'settings.sections.debug.desc', icon: Bug, visible: () => isDebugUnlocked(), groupId: 'developer' },
]

/**
 * 分组视图：把分区清单按分组定义归位，空组整体不出现（如 debug 未解锁时开发者组消失）。
 * 缺省入参 = 当前可见分区；调用方可显式传入（如搜索过滤后的子集）复用同一归组逻辑。
 */
export function groupedSettingsSections(
    sections: SettingsSection[] = SETTINGS_SECTIONS.filter((s) => s.visible()),
): Array<SettingsSectionGroup & { sections: SettingsSection[] }> {
    return SETTINGS_SECTION_GROUPS.map((group) => ({
        ...group,
        sections: sections.filter((s) => s.groupId === group.id),
    })).filter((group) => group.sections.length > 0)
}

/**
 * 分区搜索过滤：关键词对调用方解析出的文案做大小写不敏感的包含匹配。
 * 规整复用 optionSearch 的 normalizeNeedle（全站统一键入匹配入口）。
 * 文案由调用方经 textOf 注入（先 t() 再传入），registry 不引入 i18n 依赖。
 * 空关键词（含纯空白）返回全量。
 */
export function filterSettingsSections(
    keyword: string,
    sections: SettingsSection[],
    textOf: (section: SettingsSection) => string[],
): SettingsSection[] {
    const needle = normalizeNeedle(keyword)
    if (!needle) return sections
    return sections.filter((s) => textOf(s).some((text) => text.toLocaleLowerCase().includes(needle)))
}

/**
 * 分区搜索一步到位：visible 过滤 → 关键词过滤（title+desc 文案）→ 分组归位。
 * PC 侧栏与 mobile 入口共用同一管线（文案投影在此收口，调用方只传 t）。
 */
export function searchSettingsSectionGroups(
    keyword: string,
    t: (key: string) => string,
): Array<SettingsSectionGroup & { sections: SettingsSection[] }> {
    const visible = SETTINGS_SECTIONS.filter((s) => s.visible())
    const filtered = filterSettingsSections(keyword, visible, (s) => [t(s.titleKey), t(s.descKey)])
    return groupedSettingsSections(filtered)
}

/**
 * 从 pathname 推断当前激活分区（/settings/web-tools → web-tools 分区对象）。
 * 返回对象而非 id：调用方无需再按 id 二次 find 取 titleKey/icon。
 * 未知段返回 null：PC 分支照常渲染路由 Not Found，mobile 分支回到入口态（settings.title + SidebarToggle）
 */
export function activeSection(pathname: string): SettingsSection | null {
    const match = /^\/settings\/([\w-]+)/.exec(pathname)
    const segment = match?.[1]
    return SETTINGS_SECTIONS.find((s) => s.id === segment) ?? null
}
