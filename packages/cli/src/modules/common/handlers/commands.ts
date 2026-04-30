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
import { extractSDKMetadata, type SDKMetadata } from '@/claude/sdk/metadataExtractor'
import { getErrorMessage, rpcError } from '../rpcResponses'

export type RefreshMetadataResponse = {
    success: boolean
    metadata?: SDKMetadata
    error?: string
}

export function registerCommandHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<void, RefreshMetadataResponse>('refreshMetadata', async () => {
        logger.debug('[refreshMetadata] Refreshing full SDK metadata')

        try {
            const metadata = await extractSDKMetadata()
            return { success: true, metadata }
        } catch (error) {
            logger.debug('[refreshMetadata] Failed to extract SDK metadata:', error)
            return rpcError(getErrorMessage(error, 'Failed to refresh metadata'))
        }
    })
}
