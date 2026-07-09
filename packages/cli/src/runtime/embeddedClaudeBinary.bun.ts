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
 * 编译态内嵌 claude 二进制分发模块。
 *
 * 仅 bun build --compile 期使用：build-executable.ts 在 bun build 前已按
 * 当前 target 调 downloadClaudeBinary 落地对应 .bin 到 packages/cli/tools/archives/，
 * 此处用 bun:bundle 的 feature() 在编译期选出该 target 的 .bin 作为 file asset
 * 动态 import，仅命中分支被 bun 打进 bunfs（其余分支被消除）。
 *
 * dev（未编译）模式下 feature() 恒为 false，所有分支均不命中，函数抛错——
 * dev 模式不内嵌二进制，由 SDK 自动 require.resolve 本机 claude-agent-sdk 安装。
 *
 * .bin 文件名必须与 claudeBinarySource.ts 的 archiveFile 字段一致。
 */

import { feature } from 'bun:bundle';

/**
 * 返回内嵌进 bunfs 的 claude 二进制路径（file asset）。
 * 仅编译态调用——dev 模式不内嵌，由 SDK 自动 require.resolve。
 *
 * @throws 未命中任何 target feature flag（dev 模式或漏传 --feature）
 */
export async function loadEmbeddedClaudeBinary(): Promise<string> {
    if (feature('MOBI_TARGET_DARWIN_ARM64')) {
        const { default: p } = await import('../../tools/archives/claude-darwin-arm64.bin', { assert: { type: 'file' } });
        return p;
    }
    if (feature('MOBI_TARGET_DARWIN_X64')) {
        const { default: p } = await import('../../tools/archives/claude-darwin-x64.bin', { assert: { type: 'file' } });
        return p;
    }
    if (feature('MOBI_TARGET_LINUX_ARM64')) {
        const { default: p } = await import('../../tools/archives/claude-linux-arm64.bin', { assert: { type: 'file' } });
        return p;
    }
    if (feature('MOBI_TARGET_LINUX_X64')) {
        const { default: p } = await import('../../tools/archives/claude-linux-x64.bin', { assert: { type: 'file' } });
        return p;
    }
    if (feature('MOBI_TARGET_WIN32_X64')) {
        const { default: p } = await import('../../tools/archives/claude-win32-x64.bin', { assert: { type: 'file' } });
        return p;
    }
    throw new Error('No build target feature flag set. Build with --feature=MOBI_TARGET_*.');
}
