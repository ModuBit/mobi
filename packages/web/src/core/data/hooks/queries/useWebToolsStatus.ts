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

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { webToolsConfigQuery, type WebToolsConfigQueryData } from './useWebToolsConfig'

/** Web 工具状态摘要（设置入口/分区导航徽标渲染用） */
export type WebToolsStatus = 'enabled' | 'unconfigured' | 'offline' | 'loading'

/**
 * 状态派生：以实际路由为准——search/fetch 任一路由指向 provider 才算"已启用"
 * （写入侧 validateSelection 保证路由目标已启用且凭据齐全）。
 * 仅开关打开而无路由 → unconfigured：runner resolve 返回 null、每次调用 NO_PROVIDER，绿点徽标不能虚报可用。
 */
export function deriveWebToolsStatus(data: WebToolsConfigQueryData | undefined): Exclude<WebToolsStatus, 'loading'> {
    if (data?.status !== 'ok') return 'offline'
    return data.config.searchProviderId || data.config.fetchProviderId ? 'enabled' : 'unconfigured'
}

/**
 * Web 工具分区状态摘要（入口徽标用）。
 * 与子页共用 webToolsConfigQuery 同一份缓存（select 只做派生）：保存后子页 invalidate 一次，徽标立即同步。
 */
export function useWebToolsStatus(): WebToolsStatus {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const query = useQuery({
        ...webToolsConfigQuery(api, queryClient),
        select: deriveWebToolsStatus,
    })
    if (query.isPending) return 'loading'
    return query.data ?? 'offline'
}
