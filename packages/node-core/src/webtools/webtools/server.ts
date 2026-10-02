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
 * mobi-web in-process MCP server：web_search / web_fetch 两个固定工具。
 * 入参 schema 对齐 CC 内置工具（sdk-tools.d.ts WebSearchInput / WebFetchInput），
 * 模型经 toolAliases 用内置名调用，使用习惯零改变。
 * 配置每次调用经 readWebToolsConfig 惰性读取（热更新零通知）。
 */
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { readWebToolsConfig } from './config'
import { resolveSearchProvider, resolveFetchProvider, domainFilter, NO_PROVIDER_MESSAGE } from './registry'
import { WebToolError } from './provider'
import { textResult, type MobiToolTextResult } from '@/mcp/toolResult'

/** 统一错误 → isError 工具结果（agent loop 不中断，模型可重试/换思路） */
function errorResult(error: unknown): MobiToolTextResult {
    if (error instanceof WebToolError) {
        const hint = error.code === 'auth' ? '（凭据可能失效，请到 mobi 设置页更新 provider 配置）' : ''
        return { content: [{ type: 'text', text: `${error.message}${hint}` }], isError: true }
    }
    return { content: [{ type: 'text', text: `web 工具内部错误：${error instanceof Error ? error.message : String(error)}` }], isError: true }
}

export const webSearchTool = tool(
    'web_search',
    'Web search tool',   // 一句话 description：模型永远用内置名 WebSearch 调用，此处只是执行载体
    {
        query: z.string().describe('The search query to use'),
        allowed_domains: z.array(z.string()).optional().describe('Only include search results from these domains'),
        blocked_domains: z.array(z.string()).optional().describe('Never include search results from these domains'),
    },
    async (args) => {
        const provider = resolveSearchProvider(readWebToolsConfig())
        if (!provider) return { content: [{ type: 'text' as const, text: NO_PROVIDER_MESSAGE }], isError: true }
        try {
            const results = domainFilter(await provider.search(args), args)
            const lines = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
            const sources = results.map((r) => `- ${r.url}`).join('\n')
            return textResult(lines.length ? `${lines.join('\n\n')}\n\nSources:\n${sources}` : 'No results found.')
        } catch (error) {
            return errorResult(error)
        }
    },
)

export const webFetchTool = tool(
    'web_fetch',
    'Fetch a URL and return its content',
    {
        url: z.string().url().describe('The URL to fetch'),
        prompt: z.string().describe('What to do with the fetched content'),
    },
    async (args) => {
        const provider = resolveFetchProvider(readWebToolsConfig())
        if (!provider) return { content: [{ type: 'text' as const, text: NO_PROVIDER_MESSAGE }], isError: true }
        try {
            // prompt 不传给 provider 的直连实现：模型自带 prompt 语境，直接返回正文即可
            const result = await provider.fetch(args)
            return textResult(result.content)
        } catch (error) {
            return errorResult(error)
        }
    },
)

