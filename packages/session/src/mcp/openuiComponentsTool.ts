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
 * openui_components 核心工具（transport 无关）：openui-lang 组件签名按需检索。
 *
 * 配套 prompt 分层（CC deferred tools 模式）：system prompt 只常驻组件名录
 * （Name — 一句话用途），模型写 openui-lang 前按名录点名要签名——本工具从
 * 生成产物 {@link OPENUI_COMPONENT_CATALOG} 返回精确签名，替代「读整个 skill」
 * 的粗粒度加载。数据与 prompt 同源（同一生成脚本产出），不会漂移。
 *
 * 无会话依赖（不碰 ApiSessionClient / logger），local HTTP 壳与 remote 进程内壳
 * 都只做形状适配直接挂载。
 */

import { z } from 'zod'
import {
    OPENUI_COMPONENT_CATALOG,
    OPENUI_FUNCTION_CATALOG,
    type OpenUiCatalogEntry,
} from '../claude/utils/openuiCatalog.generated'
import { textResult, type MobiToolTextResult } from './toolResult'

export const OPENUI_COMPONENTS_TOOL_NAME = 'openui_components' as const

export const OPENUI_COMPONENTS_TOOL_SHAPE = {
    name: OPENUI_COMPONENTS_TOOL_NAME,
    description:
        'Fetch the exact openui-lang component and @-function signatures for the given names ' +
        '(comma-separated, case-insensitive, substrings allowed — e.g. "DatePicker, Carousel, @Format"). ' +
        'Components return their full signature and description; functions return their @signature. ' +
        'Call this BEFORE writing openui-lang code that uses any component or function whose signature ' +
        'is not already in your context.',
    title: 'OpenUI Component & Function Signatures',
    inputSchema: z.object({
        query: z
            .string()
            .min(1)
            .describe('Comma-separated openui-lang component or function names (substrings allowed)'),
    }),
} as const

const CATALOG_NAMES = OPENUI_COMPONENT_CATALOG.map((entry) => entry.name)
const FUNCTION_NAMES = OPENUI_FUNCTION_CATALOG.map((entry) => entry.name)

/** query → 命中目录项：按逗号切词，词内子串匹配（大小写不敏感）；函数词可带或不带 @ */
function matchCatalog(query: string): Array<{ kind: 'component' | 'function'; entry: OpenUiCatalogEntry }> {
    const tokens = query
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    if (!tokens.length) return []
    const hit = (name: string) => tokens.some((token) => name.toLowerCase().includes(token))
    return [
        ...OPENUI_COMPONENT_CATALOG.filter((e) => hit(e.name)).map((entry) => ({ kind: 'component' as const, entry })),
        ...OPENUI_FUNCTION_CATALOG.filter((e) => hit(e.name)).map((entry) => ({ kind: 'function' as const, entry })),
    ]
}

export async function executeOpenuiComponents(rawArgs: unknown): Promise<MobiToolTextResult> {
    const parsed = OPENUI_COMPONENTS_TOOL_SHAPE.inputSchema.safeParse(rawArgs)
    if (!parsed.success) {
        return {
            content: [{ type: 'text', text: `invalid arguments (${parsed.error.message})` }],
            isError: true,
        }
    }
    const matched = matchCatalog(parsed.data.query)
    if (!matched.length) {
        // 未命中不是错误：给出全部名录提示，模型可改词重试（零次往返拿不到签名时
        // 的兜底路径是 mobi:openui skill 全文，但先让改名重试更便宜）
        return textResult(
            `No openui component or function matches "${parsed.data.query}". Components:\n${CATALOG_NAMES.join(', ')}\nFunctions:\n${FUNCTION_NAMES.map((n) => '@' + n).join(', ')}`,
        )
    }
    return textResult(
        matched
            .map(({ kind, entry }) =>
                kind === 'function'
                    ? `@${entry.signature}\n  ${entry.description}`
                    : `${entry.signature}\n  ${entry.description}`,
            )
            .join('\n'),
    )
}

/** 统一四件套形状（local registerTool / remote toSdkTool 共用） */
export const openuiComponentsTool = {
    ...OPENUI_COMPONENTS_TOOL_SHAPE,
    execute: executeOpenuiComponents,
}
