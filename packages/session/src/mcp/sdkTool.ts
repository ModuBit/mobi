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
 * 工具体 → SDK `tool()` 定义的形状适配（两个 SDK server 壳共用）。
 *
 * 工厂产出的是 transport 无关的四件套（name / description / inputSchema / execute），
 * 这里只做形状适配——SDK 要 `inputSchema.shape`，且 handler 收 `unknown` 再交给 execute
 * （execute 自己会 safeParse，不在这一层替工具做校验）。
 *
 * 两个 server（mobi-apps / mobi-core）都要过这一道，所以它只写一遍：适配的知识
 * （SDK 期望什么形状、为什么这里是 unknown）只有一处，不会两处各自漂移。
 */

import { tool, type AnyZodRawShape, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { MobiToolTextResult } from './toolResult'

export function toSdkTool<Shape extends AnyZodRawShape>(definition: {
    name: string
    description: string
    inputSchema: { shape: Shape }
    execute: (args: unknown) => Promise<MobiToolTextResult>
}): SdkMcpToolDefinition<Shape> {
    return tool(definition.name, definition.description, definition.inputSchema.shape, async (args: unknown) =>
        definition.execute(args)
    )
}
