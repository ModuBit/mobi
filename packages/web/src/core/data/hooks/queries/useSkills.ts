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

import { useQuery } from '@tanstack/react-query'
import type { SkillInfo } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

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
