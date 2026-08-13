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
 * 取「值类 flag」的下一参数作值；缺失或本身是 flag（以 - 开头）时报缺值，
 * 避免把后续 flag 吞作值（如 `mobi --project --yolo` 把 --yolo 当 projectId）
 */
function consumeFlagValue(args: string[], index: number, flagName: string): string {
    const value = args[index + 1]
    if (!value || value.startsWith('-')) {
        throw new Error(`Missing ${flagName} value`)
    }
    return value
}

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
            options.startingMode = z.enum(['local', 'remote']).parse(consumeFlagValue(args, i, arg))
            i += 1
        } else if (arg === '--yolo') {
            // 设置yolo模式
            options.permissionMode = 'bypassPermissions'
            unknownArgs.push('--dangerously-skip-permissions')
        } else if (arg === '--permission-mode') {
            // 设置权限模式（newchat 透传）
            options.permissionMode = z.enum(PERMISSION_MODES).parse(consumeFlagValue(args, i, arg))
            i += 1
        } else if (arg === '--dangerously-skip-permissions') {
            // 与yolo模式相同
            options.permissionMode = 'bypassPermissions'
            unknownArgs.push(arg)
        } else if (arg === '--model' || arg === '-m') {
            // 设置模型
            const model = consumeFlagValue(args, i, '--model')
            i += 1
            options.model = model
            unknownArgs.push('--model', model)
        } else if (arg === '--effort') {
            // 设置 reasoning effort
            const effort = consumeFlagValue(args, i, '--effort')
            i += 1
            options.effort = effort as EffortLevel
            unknownArgs.push('--effort', effort)
        } else if (arg === '--started-by') {
            // 设置启动来源
            options.startedBy = consumeFlagValue(args, i, arg) as 'runner' | 'terminal'
            i += 1
        } else if (arg === '--project') {
            // 归属项目 id（Web spawn 透传；终端亦可手动指定）
            options.projectId = consumeFlagValue(args, i, '--project')
            i += 1
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
