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

import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import {
    CONTEXT_USAGE_CATEGORY_KEYS,
    type ContextUsageBreakdown,
    type ContextUsageCategoryKey
} from '@mobi/shared'

/** CC 显示名 → 语义 key（CC 实现序即 CONTEXT_USAGE_CATEGORY_KEYS 序）。
 *  ⚠️ kind 字段（SDK 0.3.268）不携带类目语义——used 类行的具体类目只能靠 name 识别，
 *  此表是必要映射；free/buffer/deferred 三类一律按 kind 判定（SDK 明确警告勿按英文名分类）。
 *  未知名忽略（前向兼容，输出端守卫见下） */
const CATEGORY_KEY_BY_NAME: Record<string, ContextUsageCategoryKey> = {
    'System prompt': 'systemPrompt',
    'System tools': 'systemTools',
    'MCP tools': 'mcpTools',
    'Memory files': 'memoryFiles',
    'Skills': 'skills',
    'Messages': 'messages',
}

/** deferred 行 name → 合并目标主类目（kind 判定 deferred 后，按 name 剥离变体后缀即主类目名） */
const DEFERRED_TARGET_BY_NAME: Record<string, ContextUsageCategoryKey> = {
    'MCP tools (deferred)': 'mcpTools',
    'System tools (deferred)': 'systemTools',
}

/**
 * 把 SDK `getContextUsage({detail:'summary'})` 响应转成 shared 类目细分契约。
 *
 * - deferred 变体合并进主类目；'Custom agents' 丢弃（契约不含该类目）
 * - 'Free space' / 'Autocompact buffer' 不进 categories，单独成字段（auto-compact 关闭时后者缺省）
 * - 类目按 CONTEXT_USAGE_CATEGORY_KEYS 顺序产出，零值类目不产出（与 CC 同款 tokens>0 才有）
 * - 未知类目名忽略（CC 未来加类目前向兼容）；聚合后 categories 为空返回 null
 *   （守卫在输出端而非输入端：CC 重命名全部类目时所有 name 落不进映射表，
 *   输入非空但聚合为空——同样按结构变化兜底，调用方跳过而非渲染空细分）
 */
export function extractBreakdown(response: SDKControlGetContextUsageResponse): ContextUsageBreakdown | null {
    if (!response.categories?.length) return null

    // 类目聚合：主类目直取 key，deferred 变体并入目标主类目
    const tokensByKey = new Map<ContextUsageCategoryKey, number>()
    let freeTokens = 0
    let autocompactBufferTokens: number | undefined

    for (const category of response.categories) {
        // kind 权威分类（SDK 0.3.268，"Classify on this, never on the English name"）：
        // free/buffer/deferred 按 kind；used 类行再按 name 查类目表
        if (category.kind === 'free') {
            freeTokens = category.tokens
            continue
        }
        if (category.kind === 'buffer') {
            autocompactBufferTokens = category.tokens
            continue
        }
        if (category.kind === 'deferred') {
            const deferredKey = DEFERRED_TARGET_BY_NAME[category.name]
            if (deferredKey) {
                tokensByKey.set(deferredKey, (tokensByKey.get(deferredKey) ?? 0) + category.tokens)
            }
            continue
        }
        const mainKey = CATEGORY_KEY_BY_NAME[category.name]
        if (mainKey) {
            tokensByKey.set(mainKey, (tokensByKey.get(mainKey) ?? 0) + category.tokens)
        }
        // 'Custom agents' 及未知类目名：忽略（前向兼容）
    }

    // 按契约顺序输出，零值类目不产出
    const categories = CONTEXT_USAGE_CATEGORY_KEYS
        .filter(key => (tokensByKey.get(key) ?? 0) > 0)
        .map(key => ({ key, tokens: tokensByKey.get(key)! }))

    // 输出端空类目守卫：映射表全部落空（CC 结构变化）→ null，调用方按无细分跳过
    if (categories.length === 0) return null

    // MCP 逐工具按 serverName 聚合
    const mcpTokensByServer = new Map<string, number>()
    for (const tool of response.mcpTools ?? []) {
        mcpTokensByServer.set(tool.serverName, (mcpTokensByServer.get(tool.serverName) ?? 0) + tool.tokens)
    }
    const mcpTools = [...mcpTokensByServer.entries()].map(([name, tokens]) => ({ name, tokens }))

    // Skills：source 含 '@' 视为 plugin 来源（形如 "plugin@marketplace"），name 拼 "plugin:skill"
    const skills = (response.skills?.skillFrontmatter ?? []).map(({ name, source, tokens }) => ({
        name: source.includes('@') ? `${source.split('@')[0]}:${name}` : name,
        tokens,
    }))

    // Memory 文件：type 不进契约，仅保留 path + tokens
    const memoryFiles = (response.memoryFiles ?? []).map(({ path, tokens }) => ({ path, tokens }))

    return { categories, freeTokens, autocompactBufferTokens, mcpTools, skills, memoryFiles }
}
