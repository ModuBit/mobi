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

import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
import { rpcError, getErrorMessage } from '../rpcResponses'

interface ListMachineDirectoryRequest {
    path: string
    homeDir: string
}

interface ListMachineDirectoryResponse {
    success: boolean
    entries?: Array<{ name: string }>
    error?: string
}

/**
 * 注册 machine 级 list-directory RPC handler
 */
export function registerMachineDirectoryHandler(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListMachineDirectoryRequest, ListMachineDirectoryResponse>('list-directory', async (params) => {
        const { path: targetPath, homeDir } = params ?? {}

        if (!targetPath || !homeDir) {
            return rpcError('Path and homeDir are required')
        }

        const validation = validateHomeDirPath(targetPath, homeDir)
        if (!validation.valid) {
            return rpcError(validation.error!)
        }

        try {
            const resolvedPath = resolve(targetPath)
            const entries = await readdir(resolvedPath, { withFileTypes: true })

            const directories = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => ({ name: entry.name }))
                .sort((a, b) => a.name.localeCompare(b.name))

            return { success: true, entries: directories }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to list directory'))
        }
    })
}
