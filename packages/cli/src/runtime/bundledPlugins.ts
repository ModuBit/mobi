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

import { join } from 'node:path';
import { isBunCompiled, projectPath, runtimePath } from '@/projectPath';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * 内置插件清单（inline-artifacts spec：每特性一个 plugin，随 Codex 惯例，首个即 visualize）。
 * 插件目录 `packages/cli/plugins/<name>/`，经 embedded assets 随二进制分发，
 * 启动时由 ensureRuntimeAssets 幂等释放到 runtime 目录。
 */
export const BUNDLED_PLUGINS = ['visualize'] as const;

export type BundledPluginName = (typeof BUNDLED_PLUGINS)[number];

/** 插件资源在 embedded assets / runtime 解包目录下的相对路径前缀（与工具段 `tools/` 平级） */
export const PLUGIN_ASSET_PREFIX = 'plugins/';

/** visualize 插件 SKILL.md 的 runtime 相对路径——解包完整性检查的探针文件 */
export const VISUALIZE_SKILL_REL_PATH = 'plugins/visualize/skills/visualize/SKILL.md';

/**
 * 内置插件在当前运行形态下的绝对挂载路径：
 * - 开发态（非编译）：仓库源目录 `packages/cli/plugins/<name>`（对齐 tools 的 dev/compiled
 *   双路径语义，源码即挂载点）
 * - 编译态：runtime 解包目录 `{mobi_home}/runtime/{version}/plugins/<name>`
 *   （ensureRuntimeAssets 已保证该目录就绪后才可能进入会话 spawn）
 */
export function bundledPluginPath(name: BundledPluginName): string {
    if (!isBunCompiled()) {
        return join(projectPath(), 'plugins', name);
    }
    return join(runtimePath(), 'plugins', name);
}

/**
 * SDK Options 的 plugins 字段：内置插件全部以 local plugin 挂载。
 * remote 模式直接进 sdkOptions（SDK 自动转成 claude 进程的 --plugin-dir）；
 * local 模式经 claudeLocalLauncher 传给 claudeLocal 拼同义 flag。
 */
export function buildBundledPluginOptions(): SdkPluginConfig[] {
    return BUNDLED_PLUGINS.map((name) => ({
        type: 'local' as const,
        path: bundledPluginPath(name),
    }));
}
