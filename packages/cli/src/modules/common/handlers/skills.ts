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
import { listSkills, type ListSkillsRequest, type ListSkillsResponse } from '../skills'
import { getErrorMessage, rpcError } from '../rpcResponses'

export function registerSkillsHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ListSkillsRequest, ListSkillsResponse>('listSkills', async () => {
        logger.debug('List skills request')

        try {
            const skills = await listSkills(workingDirectory)
            return { success: true, skills }
        } catch (error) {
            logger.debug('Failed to list skills:', error)
            return rpcError(getErrorMessage(error, 'Failed to list skills'))
        }
    })
}
