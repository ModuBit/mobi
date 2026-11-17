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

import { useReducer, useRef } from 'react'
import type { SkillAvailableInfo, SkillRegistrySkill } from '@mobi/shared'
import {
    createInstallFlowState,
    installFlowReducer,
    installQuery,
    isDirectSkill,
    isSourceShape,
    resolveTargetSource,
    type InstallTarget,
} from './installFlow'

/**
 * 安装弹窗状态机（{@link installFlow}）的 React 接线层。
 *
 * 效果（搜索 / 拉清单 / 安装）由调用方注入——网络与 toast 仍归 useSkillsActions，
 * reducer 保持纯函数可穷举测试。目标分流（选择段提交 / 单 skill 直装 / 拉清单 /
 * 生态搜索）集中在本 hook 的 submit 一个入口。
 */

export interface InstallFlowEffects {
    find: (query: string) => Promise<SkillRegistrySkill[] | null>
    fetchAvailable: (source: string, scope: string) => Promise<SkillAvailableInfo[] | null>
    install: (source: string, scope: string, skills?: string[]) => Promise<boolean>
}

export interface InstallFlowController {
    state: ReturnType<typeof createInstallFlowState>
    open: (scope: string) => void
    close: () => void
    setInput: (value: string) => void
    setScope: (value: string) => void
    pickFound: (hit: SkillRegistrySkill) => void
    clearTarget: () => void
    toggleSkill: (name: string) => void
    cancelFetch: () => void
    submit: () => Promise<void>
}

export function useInstallFlow(effects: InstallFlowEffects, initialScope: string): InstallFlowController {
    const [state, dispatch] = useReducer(installFlowReducer, initialScope, createInstallFlowState)
    // 拉取代次：取消 / 新请求后旧结果直接丢弃，不写入状态（晚到结果不落到 UI）
    const fetchSeqRef = useRef(0)
    // scope 在 await 期间可能被改（弹窗内切换目标），拉取时用发起瞬间的值
    const scopeRef = useRef(state.scope)
    scopeRef.current = state.scope

    const open = (scope: string) => dispatch({ type: 'open', scope })
    const close = () => dispatch({ type: 'close' })
    const setInput = (value: string) => dispatch({ type: 'input', value })
    const setScope = (value: string) => dispatch({ type: 'scope', value })
    const pickFound = (hit: SkillRegistrySkill) => dispatch({
        type: 'pickTarget',
        target: { source: hit.source, skillId: hit.skillId, label: hit.name } satisfies InstallTarget,
    })
    const clearTarget = () => dispatch({ type: 'clearTarget' })
    const toggleSkill = (name: string) => dispatch({ type: 'toggleSkill', name })

    const cancelFetch = () => {
        fetchSeqRef.current += 1
        dispatch({ type: 'fetchEnded' })
    }

    /** 生态搜索（显式触发；失败保留上次结果） */
    const find = async () => {
        const query = installQuery(state)
        if (!query || isSourceShape(query) || state.finding) return
        dispatch({ type: 'findStart' })
        const results = await effects.find(query)
        if (results) dispatch({ type: 'findDone', results })
        else dispatch({ type: 'findFail' })
    }

    /**
     * 拉整仓清单（可取消）：取消 / 新请求让代次失效，晚到结果直接丢弃。
     * 返回 null 表示取消或失败（调用方不再分流）。
     */
    const fetchAvailable = async (source: string): Promise<SkillAvailableInfo[] | null> => {
        const seq = ++fetchSeqRef.current
        dispatch({ type: 'fetchStart' })
        const skills = await effects.fetchAvailable(source, scopeRef.current)
        if (seq !== fetchSeqRef.current) return null
        if (!skills) {
            dispatch({ type: 'fetchEnded' })
            return null
        }
        return skills
    }

    /** 安装请求：成功关闭弹窗；失败保持打开（可改来源重试） */
    const runInstall = async (source: string, scope: string, skills?: string[]) => {
        dispatch({ type: 'installStart' })
        const ok = await effects.install(source, scope, skills)
        dispatch(ok ? { type: 'installDone' } : { type: 'installFail' })
    }

    /** 主动作按阶段分流：选择段提交 / 单 skill 直装 / 整仓拉清单 / 关键词搜索 */
    const submit = async () => {
        if (state.installing || state.fetching) return
        if (state.available) {
            if (state.selected.length === 0) return
            await runInstall(state.available.source, state.scope, state.selected)
            return
        }
        if (isDirectSkill(state)) {
            const source = resolveTargetSource(state)
            if (!source) return
            // skills 包按 source 里的 skillFilter 只装这一个（skills 参数缺省 = skillFilter）
            await runInstall(source, state.scope)
            return
        }
        const query = installQuery(state)
        if (!isSourceShape(query)) {
            await find()
            return
        }
        const skills = await fetchAvailable(query)
        if (!skills) return
        // 只有一个可装项且无冲突：跳过选择段直达安装
        const only = skills.length === 1 && !skills[0].installed && !skills[0].conflict ? skills[0] : null
        if (only) {
            await runInstall(query, state.scope, [only.name])
            return
        }
        dispatch({ type: 'fetchDone', source: query, skills })
    }

    return { state, open, close, setInput, setScope, pickFound, clearTarget, toggleSkill, cancelFetch, submit }
}
