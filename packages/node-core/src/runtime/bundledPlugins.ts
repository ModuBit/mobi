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
import { isBunCompiled, projectPath, runtimePath } from '../projectPath';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * 恒挂载内置插件（单插件 `mobi` 聚合全部内置 skill——无独立分发诉求，
 * 聚合到单一命名空间：slash 即 `/mobi:<skill>`）。
 * 插件目录 `packages/cli/plugins/mobi/`，经 embedded assets 随二进制分发，
 * 启动时由 ensureRuntimeAssets 幂等释放到 runtime 目录。
 */
export const BUNDLED_PLUGINS = ['mobi'] as const;

/**
 * 按需挂载内置插件：分发/解包与恒挂载插件同链路，**挂载与否由 spawn 裁决点按
 * daemon 记忆设置决定**（.scratch/agent-memory 票 02 接线；票 01 先落地分发）。
 * - `memory-hindsight`：vendored hindsight 记忆插件（VENDOR-NOTES.md 记来源与裁剪）
 */
export const OPTIONAL_BUNDLED_PLUGINS = ['memory-hindsight'] as const;

export type BundledPluginName = (typeof BUNDLED_PLUGINS)[number] | (typeof OPTIONAL_BUNDLED_PLUGINS)[number];

/** 全部内置插件名（清单文件写盘与解包探针按此遍历） */
export const ALL_BUNDLED_PLUGIN_NAMES: readonly BundledPluginName[] = [...BUNDLED_PLUGINS, ...OPTIONAL_BUNDLED_PLUGINS];

/** 插件资源在 embedded assets / runtime 解包目录下的相对路径前缀（与工具段 `tools/` 平级） */
export const PLUGIN_ASSET_PREFIX = 'plugins/';

/** visualize skill 的 runtime 相对路径——解包完整性检查的探针文件 */
export const VISUALIZE_SKILL_REL_PATH = 'plugins/mobi/skills/visualize/SKILL.md';

/** mobi 插件清单内容（repo 内同名文件与本常量的一致性由 bundledPlugins.test 锁定） */
export const MOBI_PLUGIN_MANIFEST = JSON.stringify({
    name: 'mobi',
    description: 'Mobi built-in skills: conversation-visible artifacts (charts, media, single-file HTML pages) via :mobi-artifact',
}, null, 4);

/** memory-hindsight 插件清单（vendored runtime 的接入壳，上游形态见 VENDOR-NOTES.md） */
export const MEMORY_HINDSIGHT_PLUGIN_MANIFEST = JSON.stringify({
    name: 'memory-hindsight',
    version: '0.8.0',
    description: 'Hindsight long-term memory (vendored @vectorize-io/hindsight-coding-agents runtime; connect via HINDSIGHT_API_URL / HINDSIGHT_CONFIG)',
    author: { name: 'Maner·Fan' },
    license: 'MIT',
    hooks: './hooks/hooks.json',
}, null, 4);

/** memory-hindsight 三 hook 接线（CC 插件格式，exec form + ${CLAUDE_PLUGIN_ROOT} 展开） */
export const MEMORY_HINDSIGHT_HOOKS = JSON.stringify({
    hooks: {
        SessionStart: [{
            hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/claude-sessionstart-hook.js'], timeout: 30 }],
        }],
        UserPromptSubmit: [{
            hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.js'], timeout: 30 }],
        }],
        Stop: [{
            hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/claude-stop-hook.js'], timeout: 60 }],
        }],
    },
}, null, 4);

/** memory-hindsight MCP server（hindsight_* 知识工具；harness 标识钉 claude-code） */
export const MEMORY_HINDSIGHT_MCP = JSON.stringify({
    mcpServers: {
        hindsight: {
            command: 'node',
            args: ['${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js'],
            env: { HINDSIGHT_MCP_HARNESS: 'claude-code' },
        },
    },
}, null, 4);

/**
 * 各插件的清单/接线文件（.json 不走 embedded asset——.json 静态导入被 resolveJsonModule
 * 按对象解析，无法走 bun 的 file 嵌入）：键为插件内相对路径，值为文件内容单源。
 * 编译态由 syncPluginAssets 写盘；开发态源目录直挂，repo 内同名文件与常量的
 * 一致性由 bundledPlugins.test 锁定（双落点防漂移）。
 */
export const BUNDLED_PLUGIN_MANIFEST_FILES: Record<BundledPluginName, Record<string, string>> = {
    mobi: {
        '.claude-plugin/plugin.json': MOBI_PLUGIN_MANIFEST,
    },
    'memory-hindsight': {
        '.claude-plugin/plugin.json': MEMORY_HINDSIGHT_PLUGIN_MANIFEST,
        'hooks/hooks.json': MEMORY_HINDSIGHT_HOOKS,
        '.mcp.json': MEMORY_HINDSIGHT_MCP,
    },
};

/**
 * 插件解包探针：各插件**全部**清单文件的 runtime 相对路径。清单文件在 syncPluginAssets
 * 的最后一步写盘，全部存在即「上一轮全量释放完成」——与具体 skill/dist 文件命名解耦
 * （skill 改名/增删不再使探针失效而触发无谓全量重释放）。
 */
export function bundledPluginProbeRelPaths(): string[] {
    return ALL_BUNDLED_PLUGIN_NAMES.flatMap((name) =>
        Object.keys(BUNDLED_PLUGIN_MANIFEST_FILES[name]).map((rel) => `${PLUGIN_ASSET_PREFIX}${name}/${rel}`));
}

/** memory-hindsight vendored 资产的 runtime 相对路径（embedded assets 清单与测试三方对齐用；升级增删文件时同步） */
export const MEMORY_HINDSIGHT_VENDORED_REL_PATHS = [
    'plugins/memory-hindsight/dist/claude-hook.js',
    'plugins/memory-hindsight/dist/claude-sessionstart-hook.js',
    'plugins/memory-hindsight/dist/claude-stop-hook.js',
    'plugins/memory-hindsight/dist/mcp-server.js',
    'plugins/memory-hindsight/dist/daemon-start.js',
    'plugins/memory-hindsight/dist/deepen.js',
    'plugins/memory-hindsight/dist/survey-supervisor.js',
    'plugins/memory-hindsight/skills/hindsight/SKILL.md',
] as const;

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
 * SDK Options 的 plugins 字段：恒挂载内置插件全部以 local plugin 挂载。
 * remote 模式直接进 sdkOptions（SDK 自动转成 claude 进程的 --plugin-dir）；
 * local 模式经 claudeLocalLauncher 传给 claudeLocal 拼同义 flag。
 * 按需插件（OPTIONAL_BUNDLED_PLUGINS）不在此处——挂载裁决见 spawn 装配（agent-memory 票 02）。
 */
export function buildBundledPluginOptions(): SdkPluginConfig[] {
    return BUNDLED_PLUGINS.map((name) => ({
        type: 'local' as const,
        path: bundledPluginPath(name),
    }));
}
