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

import { z } from 'zod'
import { PERMISSION_MODES, type EffortLevel } from '@mobi/shared'
import type { StartOptions } from '@/claude/runClaude'

/**
 * 解析 mobi 默认命令（claude）的命令行参数：
 * - mobi 自身的 flag（--project / --permission-mode / --model 等）进 options
 * - 其余参数（含取值）透传给 claude code（unknownArgs → options.claudeArgs）
 *
 * 从 commands/claude.ts 抽出为纯函数，便于单元测试。
 */
export function parseStartOptions(args: string[]): {
    options: StartOptions
    showHelp: boolean
    unknownArgs: string[]
} {
    const options: StartOptions = {}
    let showHelp = false
    const unknownArgs: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            showHelp = true
            unknownArgs.push(arg)
        } else if (arg === '--mobi-starting-mode') {
            // 设置启动模式
            options.startingMode = z.enum(['local', 'remote']).parse(args[++i])
        } else if (arg === '--yolo') {
            // 设置yolo模式
            options.permissionMode = 'bypassPermissions'
            unknownArgs.push('--dangerously-skip-permissions')
        } else if (arg === '--permission-mode') {
            // 设置权限模式（newchat 透传）
            const mode = args[++i]
            if (!mode) {
                throw new Error('Missing --permission-mode value')
            }
            options.permissionMode = z.enum(PERMISSION_MODES).parse(mode)
        } else if (arg === '--dangerously-skip-permissions') {
            // 与yolo模式相同
            options.permissionMode = 'bypassPermissions'
            unknownArgs.push(arg)
        } else if (arg === '--model' || arg === '-m') {
            // 设置模型
            const model = args[++i]
            if (!model) {
                throw new Error('Missing --model value')
            }
            options.model = model
            unknownArgs.push('--model', model)
        } else if (arg === '--effort') {
            // 设置 reasoning effort
            const effort = args[++i]
            if (!effort) {
                throw new Error('Missing --effort value')
            }
            options.effort = effort as EffortLevel
            unknownArgs.push('--effort', effort)
        } else if (arg === '--started-by') {
            // 设置启动来源
            options.startedBy = args[++i] as 'runner' | 'terminal'
        } else if (arg === '--project') {
            // 归属项目 id（Web spawn 透传；终端亦可手动指定）
            const pid = args[++i]
            if (!pid) {
                throw new Error('Missing --project value')
            }
            options.projectId = pid
        } else {
            // 其他claude code参数
            unknownArgs.push(arg)
            if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                unknownArgs.push(args[++i])
            }
        }
    }

    return { options, showHelp, unknownArgs }
}
