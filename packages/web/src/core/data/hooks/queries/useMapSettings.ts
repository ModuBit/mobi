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
import { useMobiApi } from '@/core/data/api/client'
import { invalidateMapSettingsCache } from '@/core/data/mapSettingsCache'
import { queryKeys } from '@/core/lib/queryKeys'
import type { MapSettingsSubmission, MapSettingsView } from '@mobi/shared'

/**
 * 地图设置数据 hook（地图组件票 02）：读三档配置 + 合并写。
 * 保存语义即时生效：openui Map 组件的模块级缓存同步失效，下一次渲染按新档位走。
 */
export interface MapSettingsState {
    settings: MapSettingsView | null
    offline: boolean
    loaded: boolean
    saving: boolean
    save: (submission: MapSettingsSubmission) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useMapSettings(): MapSettingsState {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    const query = useQuery({
        queryKey: queryKeys.mapSettings,
        queryFn: async (): Promise<{ status: 'ok'; settings: MapSettingsView } | { status: 'offline' }> => {
            try {
                const data = (await api.map.get()).data
                if ('settings' in data) return { status: 'ok', settings: data.settings }
                return { status: 'offline' }
            } catch {
                return { status: 'offline' }
            }
        },
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
    })

    const saveMutation = useMutation({
        mutationFn: async (submission: MapSettingsSubmission): Promise<{ ok: true } | { ok: false; error: string }> => {
            if (query.data?.status !== 'ok') return { ok: false, error: '' }
            try {
                const res = await api.map.set(submission)
                if (!('settings' in res.data)) return { ok: false, error: res.data.error ?? '' }
                return { ok: true }
            } catch {
                return { ok: false, error: '' }
            }
        },
        onSuccess: (result) => {
            if (!result.ok) return
            invalidateMapSettingsCache()
            void queryClient.invalidateQueries({ queryKey: queryKeys.mapSettings })
        },
    })

    return {
        settings: query.data?.status === 'ok' ? query.data.settings : null,
        offline: !query.isPending && query.data?.status === 'offline',
        loaded: query.data?.status === 'ok',
        saving: saveMutation.isPending,
        save: (submission) => saveMutation.mutateAsync(submission),
    }
}
