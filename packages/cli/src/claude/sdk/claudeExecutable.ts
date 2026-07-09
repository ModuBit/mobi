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

import { isBunCompiled } from '@/projectPath';

/**
 * 解析 claude 可执行路径（local + remote 共用）。
 *
 * 三层回退：
 * 1. MOBI_CLAUDE_PATH 环境变量（escape hatch）
 * 2. 编译态：extractFromBunfs(内嵌二进制) → /tmp/claude-<uid>/<sha256>/claude
 * 3. dev 态：返回 undefined，由 SDK 自动 require.resolve node_modules 子包
 *
 * 返回 undefined 时：
 * - 传给 SDK 的 pathToClaudeCodeExecutable → 触发自动解析（正确）
 * - 用于 spawn → 调用方需 `?? 'claude'` 回退 PATH
 */
export async function getClaudeExecutablePath(): Promise<string | undefined> {
    if (process.env.MOBI_CLAUDE_PATH) {
        return process.env.MOBI_CLAUDE_PATH;
    }

    if (!isBunCompiled()) {
        return undefined;
    }

    const { extractFromBunfs } = await import('@anthropic-ai/claude-agent-sdk/extract');
    const { loadEmbeddedClaudeBinary } = await import('@/runtime/embeddedClaudeBinary.bun');
    return extractFromBunfs(await loadEmbeddedClaudeBinary());
}
