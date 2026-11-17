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
import type { BundledSkillInfo, SkillDetailResponse, SkillInfo } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * skill 详情（行数据 + 正文 + 扩展元数据）：点击列表行时按 name+scope 请求。
 * 键挂 skillsRoot 前缀内——启停/更新等 mutation 成功后全族失效，重开 sheet 拿到新值。
 */
export function useSkillDetail(name: string | null, workspaceId: string): { detail: SkillDetailResponse | undefined; isLoading: boolean; error: Error | null } {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.skillsDetail(name ?? '', workspaceId),
        enabled: name !== null,
        queryFn: async () => {
            const res = await api.skills.detail(name!, workspaceId)
            return res.data
        },
    })
    return { detail: query.data, isLoading: query.isPending, error: query.error }
}

/**
 * CC 内置 bundled 名单（skill-mgmt 票 06）：系统 tab 消费；daemon 侧版本化缓存，
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
 * bundled 是纯前端视角（数据走 useBundledSkills），不发列表请求——enabled=false 挡住。
 * 失败（404 等）静默为空列表：tab 切走的工作区被删时不弹错。
 */
export function useSkills(workspaceId: string, options?: { enabled?: boolean }): { skills: SkillInfo[]; isLoading: boolean } {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.skills(workspaceId),
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            const res = await api.skills.list(workspaceId)
            return res.data.skills
        },
    })
    return { skills: query.data ?? [], isLoading: query.isPending }
}

/**
 * 项目占用（有技能的 workspaceId 集合）：web tabs 空项目隐藏的数据源。
 * 与列表同口径（同名遮蔽后为空 = 未占用）；装/删/建改变占用态——键在 skillsRoot
 * 前缀内，被 mutation 成功后的全族失效连带重拉。
 */
export function useSkillOccupancy(): { workspaceIds: string[] | undefined } {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.skillsOccupancy,
        queryFn: async () => {
            const res = await api.skills.occupancy()
            return res.data.workspaceIds
        },
    })
    // 未到位（pending / error）保持 undefined：消费方据此「不过滤」，空数组会被当成
    // 「没有任何项目占用」而把所有项目 tab 藏光
    return { workspaceIds: query.data }
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
function useSkillMutation<TVars, TData = unknown>(
    call: (api: ReturnType<typeof useMobiApi>, vars: TVars) => Promise<TData>,
) {
    const api = useMobiApi()
    const invalidate = useInvalidateAllSkills()
    return useMutation({
        mutationFn: (vars: TVars) => call(api, vars),
        onSuccess: invalidate,
    })
}

export function useSkillInstall() {
    return useSkillMutation((api, vars: { source: string; scope: string; skills?: string[] }) =>
        api.skills.install(vars.source, vars.scope, vars.skills))
}
/** 两步式安装第一步：repo 清单 × 已装判定（一次性动作非缓存 query；pending 态由调用方派生） */
export function useSkillAvailable() {
    const api = useMobiApi()
    return useMutation({
        mutationFn: (vars: { source: string; workspaceId: string }) =>
            api.skills.available(vars.source, vars.workspaceId),
    })
}

/** 生态搜索（= CLI find）：关键词 → skills.sh 注册表命中清单（安装弹窗搜索段） */
export function useSkillFind() {
    const api = useMobiApi()
    return useMutation({
        mutationFn: (query: string) => api.skills.find(query),
    })
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
        onSuccess: () =>
            // 失效列表/详情族（生效状态跨视角计算，global off 遮蔽 workspace on；详情 sheet 也读同一份数据）。
            // 跳过 occupancy：启停只改 override 层，磁盘上的 project skill 集合不变——
            // 全族失效会让 /skills/occupancy 重扫 personal + 每个 workspace 的 skill 目录
            queryClient.invalidateQueries({
                queryKey: queryKeys.skillsRoot,
                predicate: query => query.queryKey[1] !== 'occupancy',
            }),
    })
}
