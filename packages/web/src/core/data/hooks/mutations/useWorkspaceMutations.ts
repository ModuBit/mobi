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
import { queryKeys } from '@/core/lib/queryKeys'
import type { Workspace, WorkspaceFolder } from '@/core/data/api/types'

/** 创建工作区入参（folders 合法性由 daemon validateWorkspaceFolders 把关） */
export interface CreateWorkspaceInput {
    name: string
    folders: WorkspaceFolder[]
}

/** 更新工作区入参（name/folders 均可选） */
export interface UpdateWorkspaceInput {
    name?: string
    folders?: WorkspaceFolder[]
}

/**
 * 工作区**实体**变更（创建/改名/改 folders）后的本地失效：只重拉工作区列表。
 *
 * 实体 CRUD 的归属语义没变，分组视图不用动（daemon 的 workspace-updated/added
 * 事件也会失效同一个键，多一次往返换「建完立刻可见」——列表极小，值得）。
 *
 * **会话归属变更不在此列**：置顶 / 归入工作区 / 删除工作区解绑都是 membership
 * 变更，daemon 广播的 `affects: 'membership'` 是唯一真值收敛路径（本端同样收得到），
 * 本端再失效一遍 = 把全部工作区分组重拉两次（2026-10-28 实测一次操作 19 个请求）。
 * 断连窗口内漏掉的事件由 SSE 重连的 resyncAfterGap 对账补回。
 */
function useInvalidateWorkspaceList() {
    const queryClient = useQueryClient()
    return async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
    }
}

/** 创建工作区 */
export function useCreateWorkspace() {
    const api = useMobiApi()
    const invalidate = useInvalidateWorkspaceList()

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
    const invalidate = useInvalidateWorkspaceList()

    return useMutation({
        mutationFn: async ({ workspaceId, patch }: { workspaceId: string; patch: UpdateWorkspaceInput }) => {
            const res = await api.workspaces.update(workspaceId, patch)
            return res.data.workspace as Workspace
        },
        onSuccess: () => void invalidate(),
    })
}

/** 删除工作区（daemon 侧名下会话解绑进「最近」，广播 workspace-removed + 逐会话 membership） */
export function useDeleteWorkspace() {
    const api = useMobiApi()

    return useMutation({
        mutationFn: async (workspaceId: string) => {
            await api.workspaces.remove(workspaceId)
        },
        // 无 onSuccess 失效：见 useInvalidateWorkspaceList 注释（membership 由 SSE 收敛）
    })
}

/** 会话归入工作区 / 移出工作区（workspaceId=null 移出） */
export function useAssignSessionWorkspace() {
    const api = useMobiApi()

    return useMutation({
        mutationFn: async ({ sessionId, workspaceId }: { sessionId: string; workspaceId: string | null }) => {
            await api.workspaces.assignSession(sessionId, workspaceId)
        },
        // 无 onSuccess 失效：见 useInvalidateWorkspaceList 注释（membership 由 SSE 收敛）
    })
}
