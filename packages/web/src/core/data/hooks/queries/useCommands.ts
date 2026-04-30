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

import { useMemo } from 'react'
import { useSDKMetadata } from './useSDKMetadata'
import type { Command } from '@/core/data/api/types'

export type { Command }

/**
 * 获取会话可用的命令列表（slash commands + skills）
 *
 * 从 useSDKMetadata 缓存中派生，不单独发请求。
 */
export function useCommands(sessionId: string | null) {
    const metadataQuery = useSDKMetadata(sessionId)

    const commands = useMemo<Command[]>(
        () => metadataQuery.data?.commands ?? [],
        [metadataQuery.data?.commands]
    )

    return {
        ...metadataQuery,
        data: commands,
    }
}
