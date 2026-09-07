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

import type { Session } from '@/core/data/api/types'

interface SessionMetadata {
    name?: string
    path?: string
    flavor?: string
    modelMode?: string
    summary?: { text: string }
}

/**
 * 获取会话显示名称
 * 优先级：summary.text > name > path 最后一段 > id 前8位 > 'Unknown'
 * fork 行（forkedFrom/forkFrom 在场）反转：name > 其余——标题由 hub 建行时落库
 * （含「· 分叉」后缀，身份字段）；fork 激活后自身 CLI 产出的 summary 会回填 metadata，
 * 若 summary 优先会把后缀盖掉，fork 行与普通会话无法从标题区分
 */
export function getSessionDisplayName(session: Session): string {
    const metadata = session.metadata as SessionMetadata & { forkedFrom?: unknown; forkFrom?: unknown } | undefined
    const base = metadata?.name || metadata?.path?.split('/').pop() || session.id?.slice(0, 8) || 'Unknown'
    const isFork = !!(metadata?.forkedFrom || metadata?.forkFrom)
    return isFork ? base : (metadata?.summary?.text || base)
}

/**
 * 获取模型显示名称
 */
export function getModelDisplayName(modelMode?: string): string {
    if (!modelMode || modelMode === 'default') {
        return 'Default'
    }
    return capitalize(modelMode)
}

/**
 * 获取 CLI 显示名称
 */
export function getCliDisplayName(flavor?: string): string {
    if (!flavor || flavor === 'claude') {
        return 'Claude'
    }
    return capitalize(flavor)
}

/**
 * 首字母大写
 */
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}
