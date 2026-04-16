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
import { listSlashCommands, type ListSlashCommandsRequest, type ListSlashCommandsResponse } from '../slashCommands'
import { getErrorMessage, rpcError } from '../rpcResponses'

export function registerSlashCommandHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ListSlashCommandsRequest, ListSlashCommandsResponse>('listSlashCommands', async (data) => {
        logger.debug('List slash commands request for agent:', data.agent)

        try {
            const commands = await listSlashCommands(data.agent, workingDirectory)
            return { success: true, commands }
        } catch (error) {
            logger.debug('Failed to list slash commands:', error)
            return rpcError(getErrorMessage(error, 'Failed to list slash commands'))
        }
    })
}
