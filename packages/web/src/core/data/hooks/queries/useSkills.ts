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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BundledSkillInfo, SkillInfo } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * CC 内置 bundled 名单（skill-mgmt 票 06）：仅全局 tab 消费；daemon 侧版本化缓存，
 * 同版本纯缓存命中。失败不静默（明确错误态），列表行只读。
 */
export function useBundledSkills(enabled: boolean): {
    bundled: BundledSkillInfo[]
    isLoading: boolean
    error: Error | null
} {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.skillsBundled,
        enabled,
        queryFn: async () => {
            const res = await api.skills.bundled()
            return res.data
        },
    })
    return { bundled: query.data?.skills ?? [], isLoading: query.isPending, error: query.error }
}

/**
 * skill 管理列表（skill-mgmt 票 02）。
 * workspaceId='global' 为全局视角（个人 + synced + 插件携带），否则为该项目视角。
 * 失败（404 等）静默为空列表：tab 切走的工作区被删时不弹错。
 */
export function useSkills(workspaceId: string): { skills: SkillInfo[]; isLoading: boolean } {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.skills(workspaceId),
        queryFn: async () => {
            const res = await api.skills.list(workspaceId)
            return res.data.skills
        },
    })
    return { skills: query.data ?? [], isLoading: query.isPending }
}

/**
 * skill 安装/更新/删除（skill-mgmt 票 04/05）：影响面跨视角（global 装完全部 tab 可见），
 * 成功后失效整个 skills 查询族。
 */
function useInvalidateAllSkills() {
    const queryClient = useQueryClient()
    return () => queryClient.invalidateQueries({ queryKey: queryKeys.skillsRoot })
}

/** mutation 工厂：api 调用差异注入，「失败静默 + 成功失效全族」声明一次（后续动作零复制） */
function useSkillMutation<TVars>(
    call: (api: ReturnType<typeof useMobiApi>, vars: TVars) => Promise<unknown>,
) {
    const api = useMobiApi()
    const invalidate = useInvalidateAllSkills()
    return useMutation({
        mutationFn: (vars: TVars) => call(api, vars),
        onSuccess: invalidate,
    })
}

export function useSkillInstall() {
    return useSkillMutation((api, vars: { source: string; scope: string }) =>
        api.skills.install(vars.source, vars.scope))
}

export function useSkillUpdate() {
    return useSkillMutation((api, vars: { name: string; workspaceId: string }) =>
        api.skills.update(vars.name, vars.workspaceId))
}

export function useSkillDelete() {
    return useSkillMutation((api, vars: { name: string; workspaceId: string }) =>
        api.skills.remove(vars.name, vars.workspaceId))
}

/**
 * 对话式新建的预填 prompt 请求（票 07）：纯读端点，不动列表数据，
 * 不失效缓存；pending 态由调用方从 isPending 派生。
 */
export function useSkillCreatePrompt() {
    const api = useMobiApi()
    return useMutation({
        mutationFn: (scope: string) => api.skills.createPrompt(scope),
    })
}

/**
 * skill 启停（skill-mgmt 票 03）：写归属层 skillOverrides 后 invalidate 换新列表。
 * 本地扫描 ms 级，invalidate 同步刷新不可感知，不做显式乐观更新；
 * 成功后带回刷新行（遮蔽态由响应承载，调用方据此弹压制提示）。
 */
export function useSkillVisibility() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (vars: { name: string; enabled: boolean; workspaceId: string }) => {
            const res = await api.skills.setVisibility(vars.name, vars.enabled, vars.workspaceId)
            return res.data.skill
        },
        onSuccess: (_skill, vars) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.skills(vars.workspaceId) })
        },
    })
}
