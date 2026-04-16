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

import type { Session } from '@/api/types'

interface SessionMetadata {
    name?: string
    path?: string
    flavor?: string
    modelMode?: string
    summary?: { text: string }
}

/**
 * 获取会话显示名称
 * 优先级：summary.text > metadata.name > path 最后一段 > session.id 前8位 > 'Unknown'
 */
export function getSessionDisplayName(session: Session): string {
    const metadata = session.metadata as SessionMetadata | undefined
    return metadata?.summary?.text || metadata?.name || metadata?.path?.split('/').pop() || session.id?.slice(0, 8) || 'Unknown'
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
function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}
