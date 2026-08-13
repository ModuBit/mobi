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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { Project, ProjectFolder } from '@/core/data/api/types'

/** 创建项目入参（folders 合法性由 hub validateProjectFolders 把关） */
export interface CreateProjectInput {
    name: string
    machineId: string
    folders: ProjectFolder[]
}

/** 更新项目入参（name/folders 均可选，machineId 不可改） */
export interface UpdateProjectInput {
    name?: string
    folders?: ProjectFolder[]
}

/**
 * 会话归属变更 / 项目删除后需要刷新的缓存集合：
 * - ['projects']：项目列表本身
 * - ['sessions']：全局会话缓存（Session 已 upsert，归属变化需重拉）
 * - ['recentSessions'] / ['projectSessions']：两个分组视图
 */
function useInvalidateProjectCaches() {
    const queryClient = useQueryClient()
    return async (opts: { sessionScoped?: boolean } = {}) => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        if (opts.sessionScoped) {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await queryClient.invalidateQueries({ queryKey: queryKeys.recentSessions })
            await queryClient.invalidateQueries({ queryKey: ['projectSessions'] })
        }
    }
}

/** 创建项目 */
export function useCreateProject() {
    const api = useMobiApi()
    const invalidate = useInvalidateProjectCaches()

    return useMutation({
        mutationFn: async (input: CreateProjectInput) => {
            const res = await api.projects.create(input)
            return res.data.project as Project
        },
        onSuccess: () => void invalidate(),
    })
}

/** 更新项目（改名 / 改 folders） */
export function useUpdateProject() {
    const api = useMobiApi()
    const invalidate = useInvalidateProjectCaches()

    return useMutation({
        mutationFn: async ({ projectId, patch }: { projectId: string; patch: UpdateProjectInput }) => {
            const res = await api.projects.update(projectId, patch)
            return res.data.project as Project
        },
        onSuccess: () => void invalidate(),
    })
}

/** 删除项目（hub 侧名下会话解绑进「最近」，会话维度缓存也要刷新） */
export function useDeleteProject() {
    const api = useMobiApi()
    const invalidate = useInvalidateProjectCaches()

    return useMutation({
        mutationFn: async (projectId: string) => {
            await api.projects.remove(projectId)
        },
        onSuccess: () => void invalidate({ sessionScoped: true }),
    })
}

/** 会话归入项目 / 移出项目（projectId=null 移出） */
export function useAssignSessionProject() {
    const api = useMobiApi()
    const invalidate = useInvalidateProjectCaches()

    return useMutation({
        mutationFn: async ({ sessionId, projectId }: { sessionId: string; projectId: string | null }) => {
            await api.projects.assignSession(sessionId, projectId)
        },
        onSuccess: () => void invalidate({ sessionScoped: true }),
    })
}
