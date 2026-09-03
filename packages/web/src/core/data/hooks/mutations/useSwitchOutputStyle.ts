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

/**
 * 切换 output style（/clear 语义，CLI 重启后 init 回报新值经 metadata 回流）。
 * 成功后失效会话详情 + 会话列表缓存，让切换器显示刷新（同 useSessionActions 的
 * invalidateSession 模式）。
 */
export function useSwitchOutputStyle() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ sessionId, style }: { sessionId: string; style: string }) =>
            api.sessions.switchOutputStyle(sessionId, style),
        onSuccess: (_data, { sessionId }) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })
}
