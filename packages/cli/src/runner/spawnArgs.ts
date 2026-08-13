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

import type { SpawnSessionOptions } from '@/modules/common/rpcTypes'

/**
 * 构造 runner spawn mobi 子进程（默认 claude 命令）的 CLI 参数。
 * 从 run.ts 抽出为纯函数，便于单元测试。
 */
export function buildClaudeSpawnArgs(options: SpawnSessionOptions): string[] {
    // Mobi 当前仅支持 Claude
    const args = ['claude']
    if (options.resumeSessionId) {
        args.push('--resume', options.resumeSessionId)
    }
    args.push('--mobi-starting-mode', 'remote', '--started-by', 'runner')
    if (options.model) {
        args.push('--model', options.model)
    }
    if (options.effort !== undefined) {
        args.push('--effort', options.effort)
    }
    if (options.permissionMode) {
        args.push('--permission-mode', options.permissionMode)
    }
    if (options.projectId) {
        args.push('--project', options.projectId)
    }
    return args
}
