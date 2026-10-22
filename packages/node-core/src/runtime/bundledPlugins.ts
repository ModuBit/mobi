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

/**
 * mobi 插件清单内容（repo 内同名文件与本常量的一致性由 bundledPlugins.test 锁定）。
 * **禁止加 "hooks" 键**：hooks/hooks.json 是 mods function hooks 的 modules 声明
 * （由 CC 的 mods 通道按约定发现），classic plugin hooks 声明会让 CC 改走
 * classic 通道解析该文件（{"hooks":{...}} 形状不匹配）→ mods 静默不加载
 * （2026-10-22 E2E 实锤：带 hooks 键则 register 永不被调用，G15 探针链）。
 */
export const MOBI_PLUGIN_MANIFEST = JSON.stringify({
    name: 'mobi',
    description: 'Mobi built-in skills: conversation-visible artifacts (charts, media, single-file HTML pages) via :mobi-artifact; full openui-lang component catalog for interactive UI blocks',
}, null, 4);

/** mobi transcript tap 接线（mods 声明 modules 形态，与 classic hooks 的 hooks.json 区分） */
export const MOBI_HOOKS_MANIFEST = JSON.stringify({
    description: 'Mobi transcript tap: forwards session.append event signals (metadata only) to the mobi session bridge',
    modules: ['./register.js'],
}, null, 4);
// 过滤规则文件 hooks/config.mjs 是代码形态资产（mods 沙箱禁止 hooks 模块读 .json
// 与 node:fs，只允许 import 自家 .js/.mjs——见该文件头注释），走 embedded assets
// 与 register.js 同链路分发，不走本清单常量写盘。

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
        'hooks/hooks.json': MOBI_HOOKS_MANIFEST,
    },
    'memory-hindsight': {
        '.claude-plugin/plugin.json': MEMORY_HINDSIGHT_PLUGIN_MANIFEST,
        'hooks/hooks.json': MEMORY_HINDSIGHT_HOOKS,
        '.mcp.json': MEMORY_HINDSIGHT_MCP,
    },
};

/**
 * mobi 插件全部内置资产的 runtime 相对路径（skill 文件集单源；升级增删 skill 文件
 * 必须同步此清单——cli 的 embeddedAssets 路径集与测试据此对齐）。进探针：资产集
 * 增删自动触发重释放，否则新文件在存量 runtime 永不落地（2026-10-19 openui
 * skill v2 拆 references 实锤：版本未 bump、探针不含新文件 → 部署即断）。
 */
export const MOBI_PLUGIN_ASSET_REL_PATHS = [
    'skills/visualize/SKILL.md',
    'skills/openui/SKILL.md',
    'skills/openui/references/examples.md',
    'skills/openui/references/signatures.md',
    'skills/openui/references/app-details.md',
    'hooks/register.js',
    'hooks/config.mjs',
] as const;

/**
 * 插件解包探针：各插件全部清单文件 + mobi 内置资产集的 runtime 相对路径。清单在
 * syncPluginAssets 的最后一步写盘、资产在循环中写盘——全部存在即「上一轮全量释放
 * 完成」。资产集进探针是刻意的：**增删 skill 文件必须触发重释放**（新文件要落地、
 * 改名文件要补齐），纯内容更新（同文件集）仍走版本 marker。
 */
export function bundledPluginProbeRelPaths(): string[] {
    return [
        ...ALL_BUNDLED_PLUGIN_NAMES.flatMap((name) =>
            Object.keys(BUNDLED_PLUGIN_MANIFEST_FILES[name]).map((rel) => `${PLUGIN_ASSET_PREFIX}${name}/${rel}`)),
        ...MOBI_PLUGIN_ASSET_REL_PATHS.map((rel) => `${PLUGIN_ASSET_PREFIX}mobi/${rel}`),
    ];
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
 * 按需插件挂载信号（daemon executor spawn 时注入的 env 契约，见 daemon
 * config/memorySettings）：`MOBI_MEMORY_ENGINE=hindsight` 时会话进程挂载记忆插件。
 * 由 daemon 裁决（设置三态 + workspace 排除 + 配置合法性）后注入；terminal 直连
 * 会话（不经 executor spawn）无此 env，天然不挂载。
 */
export const MEMORY_PLUGIN_ENV = 'MOBI_MEMORY_ENGINE';

/** 记忆插件挂载：按 spawn 注入的 env 信号裁决（三处消费方与恒挂载插件同源拼装） */
export function buildMemoryPluginOptions(): SdkPluginConfig[] {
    if (process.env[MEMORY_PLUGIN_ENV] !== 'hindsight') {
        return [];
    }
    return [{
        type: 'local' as const,
        path: bundledPluginPath('memory-hindsight'),
    }];
}

/**
 * SDK Options 的 plugins 字段：恒挂载内置插件 + env 信号激活的记忆插件。
 * remote 模式直接进 sdkOptions（SDK 自动转成 claude 进程的 --plugin-dir）；
 * local 模式经 claudeLocalLauncher 传给 claudeLocal 拼同义 flag。
 */
export function buildBundledPluginOptions(): SdkPluginConfig[] {
    return [
        ...BUNDLED_PLUGINS.map((name) => ({
            type: 'local' as const,
            path: bundledPluginPath(name),
        })),
        ...buildMemoryPluginOptions(),
    ];
}
