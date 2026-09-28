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
import { invalidateWorkspaceViews } from '@/core/lib/invalidateViews'
import type { Workspace, WorkspaceFolder } from '@/core/data/api/types'

/** 创建工作区入参（folders 合法性由 hub validateWorkspaceFolders 把关） */
export interface CreateWorkspaceInput {
    name: string
    machineId: string
    folders: WorkspaceFolder[]
}

/** 更新工作区入参（name/folders 均可选，machineId 不可改） */
export interface UpdateWorkspaceInput {
    name?: string
    folders?: WorkspaceFolder[]
}

/**
 * 会话归属变更 / 工作区删除后需要刷新的缓存集合：
 * - ['workspaces']：工作区列表本身
 * - ['sessions']：全局会话缓存（Session 已 upsert，归属变化需重拉）
 * - ['recentSessions'] / ['workspaceSessions']：两个分组视图（invalidateWorkspaceViews 收口）
 */
function useInvalidateWorkspaceCaches() {
    const queryClient = useQueryClient()
    return async (opts: { sessionScoped?: boolean } = {}) => {
        if (opts.sessionScoped) {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await invalidateWorkspaceViews(queryClient)
        } else {
            await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
        }
    }
}

/** 创建工作区 */
export function useCreateWorkspace() {
    const api = useMobiApi()
    const invalidate = useInvalidateWorkspaceCaches()

    return useMutation({
        mutationFn: async (input: CreateWorkspaceInput) => {
            const res = await api.workspaces.create(input)
            return res.data.workspace as Workspace
        },
        onSuccess: () => void invalidate(),
    })
}

/** 更新工作区（改名 / 改 folders） */
export function useUpdateWorkspace() {
    const api = useMobiApi()
    const invalidate = useInvalidateWorkspaceCaches()

    return useMutation({
        mutationFn: async ({ workspaceId, patch }: { workspaceId: string; patch: UpdateWorkspaceInput }) => {
            const res = await api.workspaces.update(workspaceId, patch)
            return res.data.workspace as Workspace
        },
        onSuccess: () => void invalidate(),
    })
}

/** 删除工作区（hub 侧名下会话解绑进「最近」，会话维度缓存也要刷新） */
export function useDeleteWorkspace() {
    const api = useMobiApi()
    const invalidate = useInvalidateWorkspaceCaches()

    return useMutation({
        mutationFn: async (workspaceId: string) => {
            await api.workspaces.remove(workspaceId)
        },
        onSuccess: () => void invalidate({ sessionScoped: true }),
    })
}

/** 会话归入工作区 / 移出工作区（workspaceId=null 移出） */
export function useAssignSessionWorkspace() {
    const api = useMobiApi()
    const invalidate = useInvalidateWorkspaceCaches()

    return useMutation({
        mutationFn: async ({ sessionId, workspaceId }: { sessionId: string; workspaceId: string | null }) => {
            await api.workspaces.assignSession(sessionId, workspaceId)
        },
        onSuccess: () => void invalidate({ sessionScoped: true }),
    })
}
