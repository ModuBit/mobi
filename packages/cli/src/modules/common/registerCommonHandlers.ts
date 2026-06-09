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

import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerBashHandlers } from './handlers/bash'
import { registerCommandHandlers } from './handlers/commands'
import { registerDirectoryHandlers } from './handlers/directories'
import { registerDifftasticHandlers } from './handlers/difftastic'
import { registerFileHandlers } from './handlers/files'
import { registerGitHandlers } from './handlers/git'
import { registerRipgrepHandlers } from './handlers/ripgrep'
import { registerSessionFilesHandler } from './handlers/sessionFiles'
import { registerUploadHandlers } from './handlers/uploads'

export function registerCommonHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    registerBashHandlers(rpcHandlerManager, workingDirectory)
    registerFileHandlers(rpcHandlerManager, workingDirectory)
    registerDirectoryHandlers(rpcHandlerManager, workingDirectory)
    registerRipgrepHandlers(rpcHandlerManager, workingDirectory)
    registerDifftasticHandlers(rpcHandlerManager, workingDirectory)
    registerCommandHandlers(rpcHandlerManager, workingDirectory)
    registerGitHandlers(rpcHandlerManager, workingDirectory)
    registerUploadHandlers(rpcHandlerManager, workingDirectory)
    registerSessionFilesHandler(rpcHandlerManager, workingDirectory)
}
