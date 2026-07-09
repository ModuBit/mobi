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
 * 1. MOBI_CLAUDE_PATH 环境变量（escape hatch，不做存在性校验）
 * 2. 编译态：extractFromBunfs(内嵌二进制) → 提取到 SDK 管理的临时目录
 *    （按二进制内容 sha256 缓存复用）。提取失败时 SDK 会 console.warn 并返回
 *    原始 $bunfs 路径——该路径不可 spawn，此处检测到即回退 undefined（让调用方
 *    `?? 'claude'` / SDK 自动解析兜底），避免把不可达路径透传给子进程。
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
    const extracted = extractFromBunfs(await loadEmbeddedClaudeBinary());
    // SDK 提取失败（tmpDir 不可写/磁盘满/chmod 失败等）时会返回原始 $bunfs/~BUN 虚拟路径，
    // 子进程无法从中 spawn。检测到即视为未提取，回退 undefined 让调用方兜底。
    if (extracted.includes('$bunfs') || extracted.includes('~BUN')) {
        return undefined;
    }
    return extracted;
}
