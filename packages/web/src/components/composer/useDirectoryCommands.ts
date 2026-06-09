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
import type { Command } from '@/core/data/api/types'
import type { DirectoryCapabilities } from '@/core/data/hooks/queries/useDirectoryCapabilities'

/**
 * 从 DirectoryCapabilities 派生命令列表
 *
 * 简单地将 capabilities.commands 透传为稳定的 Command[]，
 * 供 useSlashCommandSuggestion 等消费者使用
 */
export function useDirectoryCommands(capabilities: DirectoryCapabilities): {
    data: Command[]
    isLoading: boolean
} {
    const data = useMemo<Command[]>(
        () => capabilities.commands,
        [capabilities.commands]
    )
    return { data, isLoading: capabilities.metadataLoading }
}
