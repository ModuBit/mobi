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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RedactedTelemetrySettings, TelemetrySettingsSubmission } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * 会话遥测设置数据 hook（OpenTelemetry 设置票）：脱敏读 + 锁内合并写。
 * 保存语义与 memory 一致——「下个新会话生效」：落盘即完成，daemon spawn 时现读，无热推送。
 */

export interface TelemetrySettingsState {
    settings: RedactedTelemetrySettings | null
    /** 加载失败（daemon 不可达 / 读盘失败）——失败时草稿不按空默认值初始化（防一次保存覆写已存配置） */
    offline: boolean
    loaded: boolean
    saving: boolean
    /** 提交（headers 在场性协议：不在场 = 保持旧值；空对象 = 清除）；成功失效缓存重读 */
    save: (submission: TelemetrySettingsSubmission) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useTelemetrySettings(): TelemetrySettingsState {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    const query = useQuery({
        queryKey: queryKeys.telemetrySettings,
        queryFn: async (): Promise<{ status: 'ok'; settings: RedactedTelemetrySettings } | { status: 'offline' }> => {
            try {
                const data = (await api.telemetry.get()).data
                if ('settings' in data) {
                    return { status: 'ok', settings: data.settings }
                }
                console.warn('[telemetrySettings] 加载失败', data)
                return { status: 'offline' }
            } catch (error) {
                console.warn('[telemetrySettings] 加载失败', error)
                return { status: 'offline' }
            }
        },
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
    })

    const saveMutation = useMutation({
        mutationFn: async (submission: TelemetrySettingsSubmission): Promise<{ ok: true } | { ok: false; error: string }> => {
            if (query.data?.status !== 'ok') return { ok: false, error: '' }
            try {
                const res = await api.telemetry.set(submission)
                if (!('settings' in res.data)) {
                    return { ok: false, error: res.data.error ?? '' }
                }
                return { ok: true }
            } catch {
                return { ok: false, error: '' }
            }
        },
        onSuccess: (result) => {
            if (result.ok) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.telemetrySettings })
            }
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
