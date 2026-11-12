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

import { describe, expect, it, vi, beforeEach } from 'vitest'

/** 调试分区解锁开关：测试内按用例翻转（visible() 在调用时求值） */
const debugUnlocked = { value: false }
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => debugUnlocked.value }))

import {
    SETTINGS_SECTIONS,
    SETTINGS_SECTION_GROUPS,
    groupedSettingsSections,
    filterSettingsSections,
    activeSection,
} from '@/features/settings/sections/registry'

describe('registry 分组视图', () => {
    beforeEach(() => {
        debugUnlocked.value = false
    })

    it('默认可见分区归入三组：通用=通知/Web工具/技能/记忆/归档，工具=遥测/地图/Worktree', () => {
        const groups = groupedSettingsSections()
        expect(groups.map((g) => g.id)).toEqual(['general', 'tools'])
        expect(groups[0].sections.map((s) => s.id)).toEqual(['notifications', 'web-tools', 'skills', 'memory', 'archived'])
        expect(groups[1].sections.map((s) => s.id)).toEqual(['telemetry', 'map', 'worktrees'])
    })

    it('debug 解锁时开发者组出现且包含 debug 分区', () => {
        debugUnlocked.value = true
        const groups = groupedSettingsSections()
        expect(groups.map((g) => g.id)).toEqual(['general', 'tools', 'developer'])
        expect(groups[2].sections.map((s) => s.id)).toEqual(['debug'])
    })

    it('分组视图只含 visible 分区（显式传入），空组不渲染', () => {
        const onlyMemory = SETTINGS_SECTIONS.filter((s) => s.id === 'memory')
        const groups = groupedSettingsSections(onlyMemory)
        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe('general')
    })

    it('分组定义顺序稳定且 titleKey 齐备', () => {
        expect(SETTINGS_SECTION_GROUPS.map((g) => g.titleKey)).toEqual([
            'settings.groups.general.title',
            'settings.groups.tools.title',
            'settings.groups.developer.title',
        ])
    })

    it('activeSection 既有行为不回退', () => {
        expect(activeSection('/settings/web-tools')?.id).toBe('web-tools')
        expect(activeSection('/settings/foo')).toBeNull()
    })
})

describe('registry 分区搜索过滤', () => {
    const ALL = SETTINGS_SECTIONS.filter((s) => s.visible())
    // 模拟调用方 t() 解析后的文案（真实 i18n 输出形态：标题中文、描述含英文术语）
    const COPY: Record<string, [string, string]> = {
        notifications: ['通知与推送', '系统通知与 PWA 订阅'],
        'web-tools': ['Web 工具', 'WebSearch 与 WebFetch 状态'],
        memory: ['长期记忆', '让 mobi 越聊越了解你'],
        telemetry: ['遥测', 'OpenTelemetry trace 导出'],
        map: ['地图', '高德地图 key 与渲染档位'],
        worktrees: ['Worktree 管理', '保留/残留工作树的状态与处置'],
    }
    const textOf = (s: (typeof ALL)[number]) => COPY[s.id] ?? [s.titleKey, s.descKey]

    it('空关键词与纯空白返回全量', () => {
        expect(filterSettingsSections('', ALL, textOf)).toHaveLength(ALL.length)
        expect(filterSettingsSections('   ', ALL, textOf)).toHaveLength(ALL.length)
    })

    it('包含匹配且大小写不敏感', () => {
        expect(filterSettingsSections('记忆', ALL, textOf).map((s) => s.id)).toEqual(['memory'])
        expect(filterSettingsSections('WEB', ALL, textOf).map((s) => s.id)).toEqual(['web-tools'])
        expect(filterSettingsSections('opentelemetry', ALL, textOf).map((s) => s.id)).toEqual(['telemetry'])
    })

    it('描述文案也能命中', () => {
        const sections = filterSettingsSections('工作树', ALL, textOf)
        expect(sections.map((s) => s.id)).toContain('worktrees')
    })

    it('无命中返回空数组', () => {
        expect(filterSettingsSections('不存在的关键词xyz', ALL, textOf)).toEqual([])
    })
})
