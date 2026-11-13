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
 * scope 选项构建（架构深化候选②）：`[{ global 哨兵, 全局label }, ...workspaces]` 的
 * 同构 options——此前在 SkillsSection 的 tabs / 新建弹窗 / 安装弹窗三处逐字重建。
 * tabs 与弹窗 radio 共用（value 即 wire 协议的 workspaceId / SKILL_SCOPE_GLOBAL）。
 */
import { useMemo } from 'react'
import { SKILL_SCOPE_GLOBAL } from '@mobi/shared'

/** scope 选项（tabs items 与 Radio options 形状兼容） */
export interface ScopeOption {
    value: string
    label: string
}

/** workspaces 的最小消费面（调用方从 useWorkspaces 拉数据传入，hook 零数据依赖） */
export function useScopeOptions(
    workspaces: ReadonlyArray<{ id: string; name: string }> | undefined,
    globalLabel: string,
): ScopeOption[] {
    return useMemo(
        () => [{ value: SKILL_SCOPE_GLOBAL, label: globalLabel }, ...(workspaces ?? []).map(w => ({ value: w.id, label: w.name }))],
        [workspaces, globalLabel],
    )
}
