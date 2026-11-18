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

import { resolveSessionTitle } from '@mobi/shared'
import type { Session } from '@/core/data/api/types'

interface SessionMetadata {
    name?: string
    path?: string
    flavor?: string
    modelMode?: string
    summary?: { text: string }
}

/**
 * 获取会话显示名称：取值链（summary.text > name > path 最后一段）单源在 shared 的
 * resolveSessionTitle（daemon 只读投影同链——两处独立拼写会让「照 Web 标题 fork」
 * 落空，见 tui-fork 标题口径修复）；fork 行（forkedFrom/forkFrom 在场）反转
 * name 优先的原因同见该函数文档。短 id / Unknown 兜底是本函数的展示层职责。
 */
export function getSessionDisplayName(session: Session): string {
    const metadata = session.metadata as SessionMetadata & { forkedFrom?: unknown; forkFrom?: unknown } | undefined
    const isFork = !!(metadata?.forkedFrom || metadata?.forkFrom)
    return resolveSessionTitle({
        name: metadata?.name,
        summaryText: metadata?.summary?.text,
        path: metadata?.path,
        isFork,
    }) || session.id?.slice(0, 8) || 'Unknown'
}

/**
 * 首字母大写
 */
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}
