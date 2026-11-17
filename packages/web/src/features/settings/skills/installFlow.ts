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

import type { SkillAvailableInfo, SkillRegistrySkill } from '@mobi/shared'

/**
 * 技能安装弹窗的显式状态机（纯 reducer，网络/toast 由 useInstallFlow 注入）。
 *
 * 此前这套流程散在 SkillsSection 的 8 个 useState + 6 个处理器里：阶段靠信号交叉推断
 *（fetching × available × finding），重置集合每个入口各不相同（7/4/4/3/1 个字段）。
 * 这里把「弹窗开合、输入、目标、搜索结果、清单、勾选、安装中」收进一份状态与一张
 * 迁移表——任何入口的重置都只经过 reducer，不再各自手写。
 *
 * 阶段（派生，不单独存状态）：
 * - input      输入段：可搜生态 / 填 owner/repo 拉清单 / owner/repo@skill 直装
 * - finding    生态搜索中（结果到达前保留上次结果，失败不覆盖）
 * - fetching   整仓清单拉取中（可取消；晚到结果由 useInstallFlow 的 seq 丢弃）
 * - selecting  清单就绪：多选后提交
 * - installing 安装请求在途（成功关闭弹窗，失败留输入段可改后重试）
 */

/** 安装目标（搜索结果点选）：source = owner/repo，skillId = 目录 slug（skills 包的 skillFilter） */
export interface InstallTarget {
    source: string
    skillId?: string
    label: string
}

export interface InstallFlowState {
    open: boolean
    /** 安装到哪个 scope（跟随打开时的 tab；弹窗内可改） */
    scope: string
    input: string
    target: InstallTarget | null
    /** 生态搜索结果（null = 未搜过） */
    findResults: SkillRegistrySkill[] | null
    finding: boolean
    fetching: boolean
    /** 整仓清单（非 null = 选择段）；source 是拉起清单时用的来源 */
    available: { source: string; skills: SkillAvailableInfo[] } | null
    selected: string[]
    installing: boolean
}

export type InstallFlowEvent =
    | { type: 'open'; scope: string }
    | { type: 'close' }
    | { type: 'input'; value: string }
    | { type: 'pickTarget'; target: InstallTarget }
    | { type: 'clearTarget' }
    | { type: 'scope'; value: string }
    | { type: 'findStart' }
    | { type: 'findDone'; results: SkillRegistrySkill[] }
    | { type: 'findFail' }
    | { type: 'fetchStart' }
    | { type: 'fetchDone'; source: string; skills: SkillAvailableInfo[] }
    | { type: 'fetchEnded' }
    | { type: 'toggleSkill'; name: string }
    | { type: 'installStart' }
    | { type: 'installDone' }
    | { type: 'installFail' }

export function createInstallFlowState(scope: string): InstallFlowState {
    return {
        open: false,
        scope,
        input: '',
        target: null,
        findResults: null,
        finding: false,
        fetching: false,
        available: null,
        selected: [],
        installing: false,
    }
}

export function installFlowReducer(state: InstallFlowState, event: InstallFlowEvent): InstallFlowState {
    switch (event.type) {
        case 'open':
            // 每次打开都从同一份初始态出发——重置只在这里定义一次
            return { ...createInstallFlowState(event.scope), open: true }
        case 'close':
            return { ...state, open: false }
        case 'input':
            return {
                ...state,
                input: event.value,
                // 重新打字 = 换目标：搜索点选锁定的 chip 让位（否则提交仍按旧目标装）
                target: event.value ? null : state.target,
                // 输入即作废旧结果与旧清单，避免提交时按过期状态分流
                findResults: null,
                available: null,
                selected: [],
            }
        case 'pickTarget':
            return { ...state, target: event.target, input: '', findResults: null, available: null, selected: [] }
        case 'clearTarget':
            return { ...state, target: null, available: null, selected: [] }
        case 'scope':
            // 换安装目标 scope：已拉清单不再代表目标作用域，作废（勾选随清单一起失效）
            return { ...state, scope: event.value, available: null }
        case 'findStart':
            return { ...state, finding: true }
        case 'findDone':
            return { ...state, finding: false, findResults: event.results }
        case 'findFail':
            // 失败保留上次结果（可重试），只落 finding 标志
            return { ...state, finding: false }
        case 'fetchStart':
            return { ...state, fetching: true }
        case 'fetchDone':
            return {
                ...state,
                fetching: false,
                available: { source: event.source, skills: event.skills },
                // 已装项默认勾上但 readonly；默认勾选集只含可安装项
                selected: event.skills.filter(s => !s.installed).map(s => s.name),
            }
        // 失败与取消同态：都是「拉取结束、没有清单」（失败 toast 由效果层发）
        case 'fetchEnded':
            return { ...state, fetching: false }
        case 'toggleSkill':
            return {
                ...state,
                selected: state.selected.includes(event.name)
                    ? state.selected.filter(n => n !== event.name)
                    : [...state.selected, event.name],
            }
        case 'installStart':
            return { ...state, installing: true }
        case 'installDone':
            return { ...state, installing: false, open: false }
        case 'installFail':
            return { ...state, installing: false }
    }
}

/** 输入段的当前查询（去空白） */
export function installQuery(state: InstallFlowState): string {
    return state.input.trim()
}

/** 形态判定与 skills 包 parseSource 同形：含 `/` 即来源（owner/repo…） */
export function isSourceShape(query: string): boolean {
    return /^[^\s/]+\/[^\s/]+/.test(query)
}

/** owner/repo@skill：直装单个 skill（skills 包的 skillFilter 语义） */
export function isDirectSkillShape(query: string): boolean {
    return /^[^\s/]+\/[^\s/@]+@[^\s]+$/.test(query)
}

/** 搜索点选的 target 优先于输入框；两者都折算成最终安装来源 */
export function resolveTargetSource(state: InstallFlowState): string {
    if (state.target) {
        return `${state.target.source}${state.target.skillId ? `@${state.target.skillId}` : ''}`
    }
    return installQuery(state)
}

/** 是否按「单 skill 直装」分流（target 带 skillId 或输入是 owner/repo@skill 形态） */
export function isDirectSkill(state: InstallFlowState): boolean {
    if (state.target) return Boolean(state.target.skillId)
    return isDirectSkillShape(installQuery(state))
}
