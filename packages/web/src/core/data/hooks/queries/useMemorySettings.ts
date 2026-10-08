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
import { queryKeys } from '@/core/lib/query-keys'
import type { MemoryEndpointCheckResult, MemorySettings, MemorySettingsSubmission, RedactedMemorySettings } from '@mobi/shared'

/**
 * 记忆设置数据 hook（agent-memory 票 03）：脱敏读 + 锁内合并写 + 健康检查。
 * 保存语义「下个新会话生效」：落盘即完成，daemon spawn 时现读（票 02 契约），无热推送。
 */
export interface MemorySettingsState {
    settings: RedactedMemorySettings | null
    loaded: boolean
    saving: boolean
    /** 提交（apiToken 在场性协议见 MemorySettingsSubmission）；成功失效缓存重读；失败带原因 */
    save: (submission: MemorySettingsSubmission) => Promise<{ ok: true } | { ok: false; error: string }>
    /** 健康检查（草稿值；token 不在场 daemon 用已存值兜底）。传输层异常收敛为 unreachable */
    check: (input: { endpoint: string; apiToken?: string }) => Promise<MemoryEndpointCheckResult>
}

/** 脱敏设置 → 表单草稿（apiToken 三态：已存→空草稿「保持」语义、未存→undefined） */
export function toDraft(settings: RedactedMemorySettings | null | undefined): MemorySettings & { apiTokenDraft: '' } {
    return {
        engine: settings?.engine,
        endpoint: settings?.endpoint,
        mapPathToBank: settings?.mapPathToBank ? { ...settings.mapPathToBank } : {},
        disabledWorkspaces: settings?.disabledWorkspaces ? [...settings.disabledWorkspaces] : [],
        apiTokenDraft: '',
    }
}

export function useMemorySettings(): MemorySettingsState {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    const query = useQuery({
        queryKey: queryKeys.memorySettings,
        queryFn: async () => (await api.memory.get()).data.settings,
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
    })

    const saveMutation = useMutation({
        mutationFn: async (submission: MemorySettingsSubmission) => {
            const res = await api.memory.set(submission)
            if (!('settings' in res.data)) {
                return { ok: false as const, error: res.data.error ?? '' }
            }
            return { ok: true as const }
        },
        onSuccess: (result) => {
            if (result.ok) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.memorySettings })
            }
        },
    })

    return {
        settings: query.data ?? null,
        loaded: !query.isPending,
        saving: saveMutation.isPending,
        save: (submission) => saveMutation.mutateAsync(submission),
        check: async (input) => {
            try {
                const res = await api.memory.check(input)
                if ('status' in res.data) return res.data
            } catch {
                // 网络层异常（daemon 不可达）：与 endpoint 探测失败同文案呈现
            }
            return { status: 'unreachable', reason: '' }
        },
    }
}
