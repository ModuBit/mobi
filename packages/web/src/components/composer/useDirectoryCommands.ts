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

import type { Command } from '@/core/data/api/types'
import type { DirectoryCapabilities } from '@/core/data/hooks/queries/useDirectoryCapabilities'

/**
 * 从 DirectoryCapabilities 派生命令列表和加载状态
 *
 * 透传 capabilities.commands 和 metadataLoading，
 * 供 useSlashCommandInteraction 等消费者使用
 */
export function useDirectoryCommands(capabilities: DirectoryCapabilities): {
    data: Command[]
    isLoading: boolean
} {
    return {
        data: capabilities.commands,
        isLoading: capabilities.metadataLoading,
    }
}
