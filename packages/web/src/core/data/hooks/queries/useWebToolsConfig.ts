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

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { RedactedWebToolsConfig, WebToolsConfigSubmission } from '@mobi/shared'

/** 两跳加载结果：ok / offline（无在线机器或网络异常）/ error（runner 读盘失败，文案区分于离线） */
export type WebToolsConfigQueryData =
    | { status: 'ok'; machineId: string; config: RedactedWebToolsConfig }
    | { status: 'offline' }
    | { status: 'error'; message: string }

/** 保存结果：失败带 runner 校验原因（validateSelection 等），供调用方 toast 具体错误而非通用文案 */
export type WebToolsSaveResult = { ok: true } | { ok: false; error: string }

/**
 * 共享 query options：机器列表（第一台在线，复用 queryKeys.machines 缓存去重 RTT）→ 该机器脱敏配置。
 * 入口徽标（useWebToolsStatus select 派生）与子页（useWebToolsConfig）消费同一份缓存，
 * 保存后失效一次即两处同步——不再有两条互不失效的加载路径。
 */
export function webToolsConfigQuery(api: ReturnType<typeof useMobiApi>, queryClient: QueryClient) {
    return {
        queryKey: queryKeys.webToolsConfig,
        queryFn: async (): Promise<WebToolsConfigQueryData> => {
            try {
                // 与 useMachines 同 key 同结构：staleTime 内命中缓存，机器列表不再重复请求
                const machinesData = await queryClient.ensureQueryData({
                    queryKey: queryKeys.machines,
                    queryFn: async () => (await api.machines.list()).data,
                })
                const online = machinesData.machines.find((m) => m.active)
                if (!online) return { status: 'offline' }
                const configRes = await api.machines.webTools.get(online.id)
                // 200 + { error } 变体 = runner 读盘失败（机器在线），与离线分开提示
                if (!('config' in configRes.data)) {
                    return { status: 'error', message: configRes.data.error ?? '' }
                }
                return { status: 'ok', machineId: online.id, config: configRes.data.config }
            } catch (error) {
                // 502（runner 离线）/ 网络异常统一按"机器离线"；warn 保留现场（先观测原则）
                console.warn('[webToolsConfig] 加载失败', error)
                return { status: 'offline' }
            }
        },
        staleTime: 30_000,
        retry: false,
        // 状态摘要只在挂载/导航时需要新鲜；移动端 PWA focus 抖动不应触发两跳重拉
        refetchOnWindowFocus: false,
    }
}

export interface WebToolsState {
    machineId: string | null
    config: RedactedWebToolsConfig | null
    offline: boolean
    loadError: string | null
    /** 首次加载完成（此后 invalidate 重读期间旧数据保留，子树不卸载——编辑器草稿不丢） */
    loaded: boolean
    saving: boolean
    /** 提交（在场性）：成功自动失效共享缓存重读；失败带原因 */
    save: (config: WebToolsConfigSubmission) => Promise<WebToolsSaveResult>
}

/** Web 工具子页数据 hook（数据层在 core/data；组件目录不再各自手写加载 effect） */
export function useWebToolsConfig(): WebToolsState {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const query = useQuery(webToolsConfigQuery(api, queryClient))

    const saveMutation = useMutation({
        mutationFn: async (config: WebToolsConfigSubmission): Promise<WebToolsSaveResult> => {
            if (query.data?.status !== 'ok') return { ok: false, error: '' }
            try {
                const res = await api.machines.webTools.set(query.data.machineId, config)
                if (res.data?.success !== true) return { ok: false, error: res.data?.error ?? '' }
                return { ok: true }
            } catch {
                // 502（runner 离线）等传输层异常：error 留空，调用方回退通用文案
                return { ok: false, error: '' }
            }
        },
        onSuccess: (result) => {
            if (result.ok) {
                // 失效共享缓存：子页与入口徽标立即一致；refetch 期间旧 data 保留（react-query 语义），编辑器不卸载
                void queryClient.invalidateQueries({ queryKey: queryKeys.webToolsConfig })
            }
        },
    })

    const data = query.data
    return {
        machineId: data?.status === 'ok' ? data.machineId : null,
        config: data?.status === 'ok' ? data.config : null,
        offline: !query.isPending && (data == null || data.status === 'offline'),
        loadError: data?.status === 'error' ? data.message : null,
        loaded: !query.isPending,
        saving: saveMutation.isPending,
        save: (config) => saveMutation.mutateAsync(config),
    }
}
