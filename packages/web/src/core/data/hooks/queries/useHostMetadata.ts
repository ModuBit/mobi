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
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { SDKMetadata, SDKMetadataResponse } from '@/core/data/api/types'

/**
 * 通过 host 通道获取 SDK metadata（无需活跃 session；单机：daemon 即宿主）
 * 选定目录后预取，staleTime 长缓存
 *
 * @param enabled 是否启用查询，默认 true。
 *   NewSessionPage 中可延迟到用户首次输入 '/' 时再启用，
 *   避免每输入一个目录字符就触发 metadata 请求
 */
export function useHostMetadata(cwd: string | null, enabled: boolean = true) {
    const api = useMobiApi()

    return useQuery<SDKMetadata | null>({
        queryKey: cwd ? queryKeys.hostMetadata(cwd) : ['hostMetadata', 'disabled'],
        queryFn: async () => {
            if (!cwd) return null
            const res = await api.sdk.hostMetadata(cwd)
            return (res.data as SDKMetadataResponse | undefined)?.metadata ?? null
        },
        enabled: !!cwd && enabled,
        staleTime: 5 * 60_000,
    })
}
