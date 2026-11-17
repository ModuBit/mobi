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

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SkillAvailableInfo, SkillRegistrySkill } from '@mobi/shared'
import {
    createInstallFlowState,
    installFlowReducer,
    isDirectSkill,
    isDirectSkillShape,
    isSourceShape,
    resolveTargetSource,
    type InstallFlowState,
} from '@/features/settings/skills/installFlow'
import { useInstallFlow, type InstallFlowEffects } from '@/features/settings/skills/useInstallFlow'

function availableSkill(name: string, installed = false): SkillAvailableInfo {
    return { name, description: name, installed, conflict: false } as SkillAvailableInfo
}

function hit(name: string, source = 'owner/repo'): SkillRegistrySkill {
    return { name, source, skillId: name, installs: 1 } as SkillRegistrySkill
}

/** 构造一个「选择段」状态：清单已拉取、默认勾选可装项 */
function selectingState(): InstallFlowState {
    const opened = installFlowReducer(createInstallFlowState('global'), { type: 'open', scope: 'global' })
    const withInput = installFlowReducer(opened, { type: 'input', value: 'owner/repo' })
    return installFlowReducer(withInput, {
        type: 'fetchDone',
        source: 'owner/repo',
        skills: [availableSkill('a'), availableSkill('b'), availableSkill('installed', true)],
    })
}

describe('installFlow — 打开与重置', () => {
    it('open 从同一份初始态出发：残留状态全部清空', () => {
        const dirty: InstallFlowState = {
            ...selectingState(),
            input: 'x',
            findResults: [hit('a')],
            finding: true,
        }
        const next = installFlowReducer(dirty, { type: 'open', scope: 'ws-1' })
        expect(next).toEqual({ ...createInstallFlowState('ws-1'), open: true })
    })

    it('close 只关弹窗，不在关闭路径散落重置', () => {
        const state: InstallFlowState = { ...selectingState(), open: true }
        const next = installFlowReducer(state, { type: 'close' })
        expect(next.open).toBe(false)
        expect(next.available).toBe(state.available)
    })
})

describe('installFlow — 输入与目标', () => {
    it('输入非空：作废旧目标/结果/清单/勾选（重新打字 = 换目标）', () => {
        const state: InstallFlowState = {
            ...selectingState(),
            target: { source: 'owner/repo', skillId: 'a', label: 'a' },
            findResults: [hit('a')],
        }
        const next = installFlowReducer(state, { type: 'input', value: 'o' })
        expect(next.target).toBeNull()
        expect(next.findResults).toBeNull()
        expect(next.available).toBeNull()
        expect(next.selected).toEqual([])
    })

    it('输入清空：保留已锁定的 chip 目标（用户只删了输入框文本）', () => {
        const target = { source: 'owner/repo', skillId: 'a', label: 'a' }
        const state: InstallFlowState = { ...selectingState(), target }
        const next = installFlowReducer(state, { type: 'input', value: '' })
        expect(next.target).toEqual(target)
    })

    it('pickTarget：锁定目标并清空输入/结果/清单；clearTarget 反向', () => {
        const picked = installFlowReducer(selectingState(), { type: 'pickTarget', target: { source: 'o/r', skillId: 's', label: 's' } })
        expect(picked.target).toEqual({ source: 'o/r', skillId: 's', label: 's' })
        expect(picked.input).toBe('')
        expect(picked.findResults).toBeNull()
        expect(picked.available).toBeNull()
        const cleared = installFlowReducer(picked, { type: 'clearTarget' })
        expect(cleared.target).toBeNull()
        expect(cleared.selected).toEqual([])
    })

    it('切安装 scope：已拉清单失效（不再代表目标作用域）', () => {
        const next = installFlowReducer(selectingState(), { type: 'scope', value: 'ws-9' })
        expect(next.scope).toBe('ws-9')
        expect(next.available).toBeNull()
    })
})

describe('installFlow — 搜索 / 清单 / 安装', () => {
    it('findDone 写结果；findFail 保留上次结果（可重试）', () => {
        const found = installFlowReducer(selectingState(), { type: 'findDone', results: [hit('x')] })
        expect(found.findResults).toEqual([hit('x')])
        expect(found.finding).toBe(false)

        const failed = installFlowReducer({ ...found, finding: true }, { type: 'findFail' })
        expect(failed.findResults).toEqual([hit('x')])
        expect(failed.finding).toBe(false)
    })

    it('fetchDone：清单与默认勾选集一致——只勾未安装项', () => {
        const state = selectingState()
        expect(state.available?.skills.map(s => s.name)).toEqual(['a', 'b', 'installed'])
        expect(state.selected).toEqual(['a', 'b'])
    })

    it('fetchEnded（失败 / 取消同态）：只落 fetching，不产生清单', () => {
        const fetching = installFlowReducer(createInstallFlowState('global'), { type: 'fetchStart' })
        expect(fetching.fetching).toBe(true)
        const ended = installFlowReducer(fetching, { type: 'fetchEnded' })
        expect(ended.fetching).toBe(false)
        expect(ended.available).toBeNull()
    })

    it('toggleSkill：加入 / 移除', () => {
        const withC = installFlowReducer(selectingState(), { type: 'toggleSkill', name: 'c' })
        expect(withC.selected).toEqual(['a', 'b', 'c'])
        const withoutA = installFlowReducer(withC, { type: 'toggleSkill', name: 'a' })
        expect(withoutA.selected).toEqual(['b', 'c'])
    })

    it('installDone 关闭弹窗；installFail 保持打开可重试', () => {
        const installing = installFlowReducer(selectingState(), { type: 'installStart' })
        expect(installing.installing).toBe(true)
        expect(installFlowReducer(installing, { type: 'installDone' }).open).toBe(false)
        const failed = installFlowReducer(installing, { type: 'installFail' })
        expect(failed.open).toBe(true)
        expect(failed.installing).toBe(false)
        expect(failed.available).not.toBeNull()
    })
})

describe('installFlow — 形态选择器', () => {
    it('来源形态与直装形态判定', () => {
        expect(isSourceShape('owner/repo')).toBe(true)
        expect(isSourceShape('keyword')).toBe(false)
        expect(isDirectSkillShape('owner/repo@skill')).toBe(true)
        expect(isDirectSkillShape('owner/repo')).toBe(false)
    })

    it('target 优先于输入框；带 skillId 时走直装', () => {
        const base = createInstallFlowState('global')
        const withTarget: InstallFlowState = {
            ...base,
            input: 'ignored',
            target: { source: 'owner/repo', skillId: 'skill', label: 'skill' },
        }
        expect(resolveTargetSource(withTarget)).toBe('owner/repo@skill')
        expect(isDirectSkill(withTarget)).toBe(true)

        const inputOnly: InstallFlowState = { ...base, input: 'owner/repo@skill' }
        expect(resolveTargetSource(inputOnly)).toBe('owner/repo@skill')
        expect(isDirectSkill(inputOnly)).toBe(true)
    })
})

/** hook 层接线：effects 注入（搜索 / 拉清单 / 安装）后的代次与阶段收尾 */
describe('useInstallFlow — 在途请求失效与阶段收尾', () => {
    function setup(effects: Partial<InstallFlowEffects>) {
        const full: InstallFlowEffects = {
            find: vi.fn(async () => null),
            fetchAvailable: vi.fn(async () => null),
            install: vi.fn(async () => true),
            ...effects,
        }
        const hook = renderHook(() => useInstallFlow(full, 'global'))
        act(() => hook.result.current.open('global'))
        return { ...hook, effects: full }
    }

    it('拉取在途时改输入：晚到清单被丢弃，fetching 归位（不残留到新目标上）', async () => {
        let resolveFetch!: (v: SkillAvailableInfo[] | null) => void
        const { result } = setup({
            fetchAvailable: vi.fn(() => new Promise<SkillAvailableInfo[] | null>((resolve) => { resolveFetch = resolve })),
        })

        act(() => result.current.setInput('owner/repo'))
        let pending!: Promise<void>
        act(() => { pending = result.current.submit() })
        expect(result.current.state.fetching).toBe(true)

        // 用户在拉取期间改了来源：清单不再对应当前目标
        act(() => result.current.setInput('other/repo'))
        expect(result.current.state.fetching).toBe(false)

        await act(async () => {
            resolveFetch([availableSkill('a'), availableSkill('b')])
            await pending
        })
        expect(result.current.state.available).toBeNull()
        expect(result.current.state.fetching).toBe(false)
    })

    it('单 skill 直装路径：拉取结束先收尾 fetching，安装失败后主按钮不锁死', async () => {
        const install = vi.fn(async () => false)
        const { result } = setup({
            fetchAvailable: vi.fn(async () => [availableSkill('only')]),
            install,
        })

        act(() => result.current.setInput('owner/repo'))
        await act(async () => { await result.current.submit() })

        expect(install).toHaveBeenCalledWith('owner/repo', 'global', ['only'])
        expect(result.current.state.fetching).toBe(false)
        expect(result.current.state.installing).toBe(false)
    })
})
