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

import { logger } from '@/ui/logger'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { extractSDKMetadata, type SlashCommand } from '@/claude/sdk/metadataExtractor'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ListCommandsResponse {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export function registerCommandHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<void, ListCommandsResponse>('listCommands', async () => {
        logger.debug('List commands request via SDK metadata')

        try {
            const metadata = await extractSDKMetadata()
            return { success: true, commands: metadata.commands ?? [] }
        } catch (error) {
            logger.debug('Failed to extract SDK metadata for commands:', error)
            return rpcError(getErrorMessage(error, 'Failed to list commands'))
        }
    })
}
