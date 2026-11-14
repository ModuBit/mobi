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
 * scope 选项构建（架构深化候选②）：此前在 SkillsSection 的 tabs / 新建弹窗 / 安装
 * 弹窗三处逐字重建。tabs 与弹窗 radio 的**选项集不同**（2026-11-14 起）：
 * - tabOptions：系统（bundled 只读视角）+ 个人 + **非空**项目（occupancy 过滤，空项目隐藏）
 * - promptOptions（新建/安装弹窗 radio）：个人 + **全量**项目——空项目也能被选为
 *   目标（不然空项目永远建不出第一个 skill），但没有系统项（bundled 不可装/建）
 * value 即 wire 协议的 workspaceId / SKILL_SCOPE_* 哨兵。
 */
import { useMemo } from 'react'
import { SKILL_SCOPE_BUNDLED, SKILL_SCOPE_GLOBAL } from '@mobi/shared'

/** scope 选项（tabs items 与 Radio options 形状兼容） */
export interface ScopeOption {
    value: string
    label: string
}

/** workspaces 的最小消费面（调用方从 useWorkspaces 拉数据传入，hook 零数据依赖） */
export interface ScopeOptionsInput {
    workspaces: ReadonlyArray<{ id: string; name: string }> | undefined
    /** 有技能的 workspaceId 集合（useSkillOccupancy；undefined = 未到位时不过滤） */
    occupiedWorkspaceIds?: ReadonlyArray<string>
    bundledLabel: string
    personalLabel: string
}

/** tabs 与弹窗 radio 两套选项（value 同一 wire 空间，选项集按用途分流） */
export interface ScopeOptions {
    tabOptions: ScopeOption[]
    promptOptions: ScopeOption[]
}

export function useScopeOptions({ workspaces, occupiedWorkspaceIds, bundledLabel, personalLabel }: ScopeOptionsInput): ScopeOptions {
    return useMemo(() => {
        const occupied = occupiedWorkspaceIds && new Set(occupiedWorkspaceIds)
        const projectOptions = (workspaces ?? [])
            .filter(w => !occupied || occupied.has(w.id))
            .map(w => ({ value: w.id, label: w.name }))
        const allProjectOptions = (workspaces ?? []).map(w => ({ value: w.id, label: w.name }))
        return {
            tabOptions: [{ value: SKILL_SCOPE_BUNDLED, label: bundledLabel }, { value: SKILL_SCOPE_GLOBAL, label: personalLabel }, ...projectOptions],
            promptOptions: [{ value: SKILL_SCOPE_GLOBAL, label: personalLabel }, ...allProjectOptions],
        }
    }, [workspaces, occupiedWorkspaceIds, bundledLabel, personalLabel])
}
