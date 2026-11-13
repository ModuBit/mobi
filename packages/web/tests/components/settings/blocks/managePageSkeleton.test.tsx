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
 * 管理页骨架件测试（架构深化候选②⑥）：ManageRow 槽位 / useScopeOptions 构建 /
 * ScopeTabbedSection 结构。props 驱动零 mock——骨架件从第一天起就该有的独立测试面。
 */
import { render, renderHook, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { SKILL_SCOPE_GLOBAL } from '@mobi/shared'
import { ManageRow, ManageRowTag } from '@/features/settings/blocks/ManageRow'
import { ScopeTabbedSection } from '@/features/settings/blocks/ScopeTabbedSection'
import { useScopeOptions } from '@/features/settings/blocks/useScopeOptions'

// vitest 未开 globals：显式 cleanup（web 测试纪律）
afterEach(() => {
    cleanup()
})

describe('ManageRow', () => {
    it('渲染名字 + 描述 + 徽标 + 右槽', () => {
        render(
            <ManageRow
                name="research"
                description="Investigate a question"
                badges={<ManageRowTag>个人</ManageRowTag>}
                right={<button type="button">动作</button>}
                data-skill-name="research"
            />,
        )
        expect(screen.getByText('research')).toBeTruthy()
        expect(screen.getByText('Investigate a question')).toBeTruthy()
        expect(screen.getByText('个人')).toBeTruthy()
        expect(screen.getByRole('button', { name: '动作' })).toBeTruthy()
        expect(screen.getByText('research').closest('[data-skill-name]')?.getAttribute('data-skill-name')).toBe('research')
    })

    it('描述缺省不渲染描述行；右槽缺省为纯只读行', () => {
        render(<ManageRow name="dataviz" />)
        expect(screen.getByText('dataviz')).toBeTruthy()
        expect(screen.queryByText(/.{20,}/)).toBeNull()
    })

    it('不透明度透传（弱化语义由调用方定，不同值生成不同样式类）', () => {
        const dimmed = render(<ManageRow name="x" opacity={0.55} />).container.firstElementChild as HTMLElement
        const normal = render(<ManageRow name="x" />).container.firstElementChild as HTMLElement
        expect(dimmed.className).not.toBe(normal.className)
    })
})

describe('useScopeOptions', () => {
    it('global 哨兵项（shared 单源）在前 + workspaces 随后', () => {
        const { result } = renderHook(() => useScopeOptions(
            [{ id: 'ws-1', name: 'Demo' }, { id: 'ws-2', name: 'Other' }],
            '全局',
        ))
        expect(result.current).toEqual([
            { value: SKILL_SCOPE_GLOBAL, label: '全局' },
            { value: 'ws-1', label: 'Demo' },
            { value: 'ws-2', label: 'Other' },
        ])
    })

    it('workspaces 未加载时只有全局项', () => {
        const { result } = renderHook(() => useScopeOptions(undefined, '全局'))
        expect(result.current).toEqual([{ value: SKILL_SCOPE_GLOBAL, label: '全局' }])
    })
})

describe('ScopeTabbedSection', () => {
    it('锁住搜索 + tabs + 动作槽 + 内容区结构', () => {
        render(
            <ScopeTabbedSection
                keyword="res"
                onKeywordChange={() => {}}
                searchPlaceholder="搜索技能"
                options={[
                    { value: SKILL_SCOPE_GLOBAL, label: '全局' },
                    { value: 'ws-1', label: 'Demo' },
                ]}
                activeScope={SKILL_SCOPE_GLOBAL}
                onScopeChange={() => {}}
                tabsTestId="skills-tabs"
                actions={<button type="button">安装</button>}
            >
                <div>内容区</div>
            </ScopeTabbedSection>,
        )
        expect((screen.getByPlaceholderText('搜索技能') as HTMLInputElement).value).toBe('res')
        expect(screen.getByTestId('skills-tabs')).toBeTruthy()
        expect(screen.getByRole('tab', { name: '全局', selected: true })).toBeTruthy()
        expect(screen.getByRole('tab', { name: 'Demo', selected: false })).toBeTruthy()
        expect(screen.getByRole('button', { name: '安装' })).toBeTruthy()
        expect(screen.getByText('内容区')).toBeTruthy()
    })

    it('切 scope 回调透传（TabStrip 受控：点击页签即回调目标 value）', () => {
        const onScopeChange = vi.fn()
        render(
            <ScopeTabbedSection
                keyword=""
                onKeywordChange={() => {}}
                searchPlaceholder="搜索"
                options={[
                    { value: SKILL_SCOPE_GLOBAL, label: '全局' },
                    { value: 'ws-1', label: 'Demo' },
                ]}
                activeScope={SKILL_SCOPE_GLOBAL}
                onScopeChange={onScopeChange}
            >
                null
            </ScopeTabbedSection>,
        )
        fireEvent.click(screen.getByRole('tab', { name: 'Demo' }))
        expect(onScopeChange).toHaveBeenCalledWith('ws-1')
        // 交互编排（切 tab 换数据源）由 SkillsSection 测试覆盖
    })
})
