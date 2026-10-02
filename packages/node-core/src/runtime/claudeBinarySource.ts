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

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

/** Claude 二进制目标描述（平台子包、二进制名、manifest key、归档文件名） */
export interface ClaudeBinaryTarget {
    /** npm 平台子包名（scoped） */
    subpackage: string;
    /** 解压后的二进制文件名（Windows 带 .exe） */
    binaryName: string;
    /** SDK manifest.json platforms 下的 key */
    manifestKey: string;
    /** SDK 子包归档内二进制文件名 */
    archiveFile: string;
}

/** mobi Bun target → Claude SDK 平台子包映射表 */
const TARGET_MAP: Record<string, ClaudeBinaryTarget> = {
    'bun-darwin-arm64': { subpackage: '@anthropic-ai/claude-agent-sdk-darwin-arm64', binaryName: 'claude', manifestKey: 'darwin-arm64', archiveFile: 'claude-darwin-arm64.bin' },
    'bun-darwin-x64': { subpackage: '@anthropic-ai/claude-agent-sdk-darwin-x64', binaryName: 'claude', manifestKey: 'darwin-x64', archiveFile: 'claude-darwin-x64.bin' },
    'bun-linux-x64-baseline': { subpackage: '@anthropic-ai/claude-agent-sdk-linux-x64', binaryName: 'claude', manifestKey: 'linux-x64', archiveFile: 'claude-linux-x64.bin' },
    // modern 与 baseline 共用同一个 glibc linux-x64 二进制（SDK manifest 无 baseline/modern 之分），
    // 故映射到同一子包 + 同一 archiveFile，缓存自动复用
    'bun-linux-x64-modern': { subpackage: '@anthropic-ai/claude-agent-sdk-linux-x64', binaryName: 'claude', manifestKey: 'linux-x64', archiveFile: 'claude-linux-x64.bin' },
    'bun-linux-arm64': { subpackage: '@anthropic-ai/claude-agent-sdk-linux-arm64', binaryName: 'claude', manifestKey: 'linux-arm64', archiveFile: 'claude-linux-arm64.bin' },
    'bun-windows-x64': { subpackage: '@anthropic-ai/claude-agent-sdk-win32-x64', binaryName: 'claude.exe', manifestKey: 'win32-x64', archiveFile: 'claude-win32-x64.bin' },
};

/**
 * 将 mobi 的 Bun target 解析为 Claude SDK 平台子包信息
 * @param mobiTarget mobi build target（如 bun-darwin-arm64）
 * @throws 不支持的 target 抛错
 */
export function resolveClaudeTarget(mobiTarget: string): ClaudeBinaryTarget {
    const t = TARGET_MAP[mobiTarget];
    if (!t) throw new Error(`Unsupported claude binary target: ${mobiTarget}`);
    return t;
}

/**
 * mobi 支持的所有 claude 二进制 target（Object.keys 快照，用于一致性校验）。
 *
 * embeddedClaudeBinary.bun.ts 按「平台 feature flag」静态 import 5 个 .bin 文件
 * （darwin-arm64/darwin-x64/linux-arm64/linux-x64/win32-x64），不区分 baseline/modern。
 * 新增 target 时，若其 archiveFile 不在既有 5 个文件名内，必须同步在
 * embeddedClaudeBinary.bun.ts 补 feature 分支，否则编译态产物在目标平台静默不可用。
 */
export const ALL_MOBI_TARGETS: readonly string[] = Object.freeze(Object.keys(TARGET_MAP));

/** 默认 npm registry（官方源） */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/**
 * 解析生效的 registry：MOBI_NPM_REGISTRY env > 默认官方源
 *
 * 用于 build:exe 时按需切换镜像源（如国内阿里源 https://registry.npmmirror.com）。
 * env 为空或纯空白时回退默认；带尾斜杠的会被规范化去掉（避免拼出双斜杠）。
 *
 * @param env 可选的环境变量对象（默认 process.env，便于测试注入）
 */
export function resolveRegistry(env: NodeJS.ProcessEnv = process.env): string {
    const v = env.MOBI_NPM_REGISTRY;
    return (v && v.trim()) ? v.trim().replace(/\/$/, '') : DEFAULT_REGISTRY;
}

/**
 * 从 npm 子包名与版本拼标准 registry tarball URL
 * （scoped 包路径保留 @scope/，文件名是去掉 @scope/ 的 <name>-<version>.tgz）
 *
 * @param subpackage npm scoped 包名
 * @param version 语义化版本号
 * @param registryBase 可选 registry 前缀，默认 resolveRegistry()（读 MOBI_NPM_REGISTRY env）
 */
export function buildTarballUrl(
    subpackage: string,
    version: string,
    registryBase: string = resolveRegistry(),
): string {
    const unscoped = subpackage.replace(/^@[^/]+\//, '');
    return `${registryBase}/${subpackage}/-/${unscoped}-${version}.tgz`;
}

/**
 * 计算文件 sha256（流式，适合 200MB 二进制）
 * @param filePath 文件绝对路径
 */
export async function sha256OfFile(filePath: string): Promise<string> {
    return new Promise((resolveP, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (d) => hash.update(d));
        stream.on('error', reject);
        stream.on('end', () => resolveP(hash.digest('hex')));
    });
}

/**
 * 校验文件 sha256 是否匹配
 * @param filePath 文件绝对路径
 * @param expectedSha256 期望的 sha256（大小写不敏感）
 */
export async function verifySha256(filePath: string, expectedSha256: string): Promise<boolean> {
    const actual = await sha256OfFile(filePath);
    return actual.toLowerCase() === expectedSha256.toLowerCase();
}

/** SDK manifest.json 形状（仅取用到的字段） */
export interface ClaudeManifest {
    version: string;
    platforms: Record<string, { binary: string; checksum: string; size: number }>;
}

/**
 * 读已安装 SDK 主包根下的 manifest.json
 * （通过 require.resolve 解析 @anthropic-ai/claude-agent-sdk/package.json，再拼同级 manifest.json）
 * @param sdkRequire 可选的 require 函数（便于测试注入）
 */
export function readSdkManifest(sdkRequire: NodeRequire = createRequire(import.meta.url)): ClaudeManifest {
    const sdkPkgPath = sdkRequire.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const manifestPath = resolve(sdkPkgPath, '..', 'manifest.json');
    return sdkRequire(manifestPath) as ClaudeManifest;
}

/**
 * 读已安装 SDK 主包版本号
 * @param sdkRequire 可选的 require 函数（便于测试注入）
 */
export function readSdkVersion(sdkRequire: NodeRequire = createRequire(import.meta.url)): string {
    return (sdkRequire('@anthropic-ai/claude-agent-sdk/package.json') as { version: string }).version;
}
