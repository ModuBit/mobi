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

/**
 * 适配层：包装官方 @anthropic-ai/claude-agent-sdk
 *
 * 将自定义 SDK API 转换为官方 SDK 调用，保持向后兼容。
 */

import {
    query as officialQuery,
    type Query as OfficialQuery,
    type Options as OfficialOptions,
    type SDKMessage as OfficialSDKMessage,
    type PermissionResult as OfficialPermissionResult,
    type CanUseTool as OfficialCanUseTool
} from '@anthropic-ai/claude-agent-sdk'
import type {
    QueryOptions,
    QueryPrompt,
    SDKMessage,
    PermissionResult
} from './types'
import { AbortError } from './types'

/**
 * 将自定义 PermissionResult 转换为官方 SDK 格式
 */
function toOfficialPermissionResult(
    result: PermissionResult,
    toolUseID: string
): OfficialPermissionResult {
    if (result.behavior === 'allow') {
        return {
            behavior: 'allow',
            updatedInput: result.updatedInput
        }
    } else {
        return {
            behavior: 'deny',
            message: result.message
        }
    }
}

/**
 * 将 AbortSignal 转换为 AbortController
 */
function signalToController(signal?: AbortSignal): AbortController | undefined {
    if (!signal) return undefined

    const controller = new AbortController()

    // 如果信号已经中止，立即中止控制器
    if (signal.aborted) {
        controller.abort()
        return controller
    }

    // 监听中止事件
    signal.addEventListener('abort', () => controller.abort(), { once: true })

    return controller
}

/**
 * 适配选项：自定义 SDK → 官方 SDK
 */
function adaptOptions(options?: QueryOptions): OfficialOptions {
    const adapted: OfficialOptions = {}

    // 直接映射的字段
    if (options?.cwd) adapted.cwd = options.cwd
    if (options?.allowedTools) adapted.allowedTools = options.allowedTools
    if (options?.disallowedTools) adapted.disallowedTools = options.disallowedTools
    if (options?.maxTurns) adapted.maxTurns = options.maxTurns
    // mcpServers 类型断言：官方 SDK 接受 Record<string, McpServerConfig>
    if (options?.mcpServers) {
        adapted.mcpServers = options.mcpServers as Record<string, never>
    }
    if (options?.pathToClaudeCodeExecutable) adapted.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable
    if (options?.permissionMode) adapted.permissionMode = options.permissionMode
    if (options?.continue) adapted.continue = options.continue
    if (options?.resume) adapted.resume = options.resume
    if (options?.model) adapted.model = options.model
    if (options?.fallbackModel) adapted.fallbackModel = options.fallbackModel
    if (options?.additionalDirectories) adapted.additionalDirectories = options.additionalDirectories

    // AbortSignal → AbortController
    if (options?.abort) {
        adapted.abortController = signalToController(options.abort)
    }

    // canCallTool → canUseTool
    if (options?.canCallTool) {
        adapted.canUseTool = async (
            toolName: string,
            input: Record<string, unknown>,
            opts: Parameters<OfficialCanUseTool>[2]
        ): Promise<OfficialPermissionResult> => {
            const result = await options.canCallTool!(toolName, input, { signal: opts.signal })
            return toOfficialPermissionResult(result, opts.toolUseID)
        }
    }

    // CLI 参数通过 extraArgs 传递
    adapted.extraArgs = {}

    if (options?.customSystemPrompt) {
        adapted.extraArgs['system-prompt'] = options.customSystemPrompt
    }
    if (options?.appendSystemPrompt) {
        adapted.extraArgs['append-system-prompt'] = options.appendSystemPrompt
    }
    if (options?.settingsPath) {
        adapted.extraArgs['settings'] = options.settingsPath
    }
    if (options?.strictMcpConfig) {
        adapted.extraArgs['strict-mcp-config'] = null
    }

    // 清理空的 extraArgs
    if (Object.keys(adapted.extraArgs).length === 0) {
        delete adapted.extraArgs
    }

    return adapted
}

/**
 * Query 包装类
 *
 * 包装官方 SDK 的 Query 对象，提供与自定义 SDK 兼容的接口
 */
export class QueryWrapper implements AsyncIterableIterator<SDKMessage> {
    private officialQuery: OfficialQuery
    private iterator: AsyncIterator<OfficialSDKMessage>
    private abortSignal?: AbortSignal

    constructor(
        officialQuery: OfficialQuery,
        abortSignal?: AbortSignal
    ) {
        this.officialQuery = officialQuery
        this.abortSignal = abortSignal
        this.iterator = officialQuery[Symbol.asyncIterator]()
    }

    /**
     * 发送中断请求
     */
    async interrupt(): Promise<void> {
        return this.officialQuery.interrupt()
    }

    /**
     * 获取初始化结果（工具和命令列表）
     */
    async initializationResult(): Promise<{
        tools?: string[]
        slashCommands?: string[]
    }> {
        try {
            const init = await this.officialQuery.initializationResult()
            return {
                tools: init.commands?.map(c => c.name),
                slashCommands: init.commands?.map(c => c.name)
            }
        } catch (error) {
            // 如果获取失败，返回空对象
            return {}
        }
    }

    /**
     * 关闭查询
     */
    close(): void {
        this.officialQuery.close()
    }

    // AsyncIterableIterator 实现

    async next(): Promise<IteratorResult<SDKMessage>> {
        if (this.abortSignal?.aborted) {
            return { done: true, value: undefined }
        }

        try {
            const result = await this.iterator.next()
            if (result.done) {
                return { done: true, value: undefined }
            }
            // 类型转换：官方 SDK 消息与自定义 SDK 消息结构兼容
            return {
                done: false,
                value: result.value as unknown as SDKMessage
            }
        } catch (error) {
            // 处理中止错误
            if (this.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
                throw new AbortError('Claude Code process aborted by user')
            }
            throw error
        }
    }

    async return?(value?: unknown): Promise<IteratorResult<SDKMessage>> {
        this.close()
        return { done: true, value: undefined }
    }

    async throw?(e?: unknown): Promise<IteratorResult<SDKMessage>> {
        this.close()
        throw e
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<SDKMessage> {
        return this
    }
}

/**
 * 主查询函数
 *
 * 包装官方 SDK 的 query 函数，提供与自定义 SDK 兼容的接口
 */
export function query(config: {
    prompt: QueryPrompt
    options?: QueryOptions
}): QueryWrapper {
    const { prompt, options } = config

    // 适配选项
    const officialOptions = adaptOptions(options)

    // 调用官方 SDK
    const official = officialQuery({
        prompt: prompt as string,
        options: officialOptions
    })

    // 返回包装后的 Query
    return new QueryWrapper(official, options?.abort)
}

// 重新导出 AbortError
export { AbortError }
