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
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { SkillSummary } from '@/api/types'

/** 技能（保持 Skill 别名以兼容现有使用） */
export type Skill = SkillSummary

/**
 * 获取会话可用的技能列表
 */
export function useSkills(sessionId: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: sessionId ? queryKeys.skills(sessionId) : ['skills', 'disabled'],
        queryFn: async (): Promise<Skill[]> => {
            if (!sessionId) return []

            const res = await api.sessions.skills(sessionId)
            return res.data?.skills ?? []
        },
        enabled: !!token && !!sessionId,
        staleTime: 60_000, // 1 分钟内不重新获取
    })
}
