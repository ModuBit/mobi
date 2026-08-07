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

import { useMutation } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'

export interface SaveFileArgs {
    path: string
    content: Uint8Array
    baseEtag: string
    /** 强制覆盖（跳过 OCC），用于冲突后用户选「强制覆盖」：为 true 时传空 baseEtag（cli 约定=跳过 OCC） */
    force?: boolean
}

export interface SaveFileResult {
    etag?: string
    conflict: boolean
    currentEtag?: string
    error?: string
}

/**
 * 保存文件到原路径（etag OCC）。
 *
 * - 成功：{ etag, conflict:false }
 * - 冲突（409）：{ conflict:true, currentEtag }，不抛错（交 UI 分支处理）
 * - 其他错误：{ conflict:false, error }
 *
 * mutationFn 永不抛错（409 已被 client 的 validateStatus 放行），上层直接消费 SaveFileResult。
 * force=true 时传空 baseEtag——cli saveFile 约定「baseEtag='' → 跳过 OCC」。
 */
export function useSaveFile(sessionId: string) {
    const api = useMobiApi()
    return useMutation<SaveFileResult, never, SaveFileArgs>({
        mutationFn: async ({ path, content, baseEtag, force }) => {
            const res = await api.files.save(sessionId, path, content, force ? '' : baseEtag)
            if (res.status === 409) {
                const data = res.data as { currentEtag?: string }
                return { conflict: true, currentEtag: data.currentEtag }
            }
            const data = res.data as { success: boolean; etag?: string; error?: string }
            if (!data.success) return { conflict: false, error: data.error }
            return { etag: data.etag, conflict: false }
        },
        retry: false,
    })
}
