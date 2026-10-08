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

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
    bundledPluginPath,
    buildBundledPluginOptions,
    BUNDLED_PLUGINS,
    OPTIONAL_BUNDLED_PLUGINS,
    ALL_BUNDLED_PLUGIN_NAMES,
    BUNDLED_PLUGIN_MANIFEST_FILES,
    MOBI_PLUGIN_MANIFEST,
    MEMORY_HINDSIGHT_PLUGIN_MANIFEST,
    MEMORY_HINDSIGHT_HOOKS,
    MEMORY_HINDSIGHT_MCP,
    MEMORY_HINDSIGHT_VENDORED_REL_PATHS,
    PLUGIN_ASSET_PREFIX,
    VISUALIZE_SKILL_REL_PATH,
    bundledPluginProbeRelPaths,
} from '@/runtime/bundledPlugins';
import { projectPath } from '@/projectPath';

describe('bundledPlugins（恒挂载 mobi 聚合 + 按需 memory-hindsight）', () => {
    it('恒挂载清单只有 mobi；按需清单只有 memory-hindsight（挂载裁决在 spawn 装配，票 02）', () => {
        expect([...BUNDLED_PLUGINS]).toEqual(['mobi']);
        expect([...OPTIONAL_BUNDLED_PLUGINS]).toEqual(['memory-hindsight']);
        expect([...ALL_BUNDLED_PLUGIN_NAMES]).toEqual(['mobi', 'memory-hindsight']);
    });

    it('mobi 插件清单文件与 TS 常量单源一致（repo 文件 dev 直挂、常量编译态写盘，双落点防漂移）', () => {
        const manifestPath = join(projectPath(), 'plugins', 'mobi', '.claude-plugin', 'plugin.json');
        expect(existsSync(manifestPath)).toBe(true);
        expect(readFileSync(manifestPath, 'utf-8').trim()).toBe(MOBI_PLUGIN_MANIFEST);
        expect(JSON.parse(MOBI_PLUGIN_MANIFEST).name).toBe('mobi');
    });

    it('memory-hindsight 三份清单/接线文件与 TS 常量一致，且 name/harness 形状正确', () => {
        const pluginDir = join(projectPath(), 'plugins', 'memory-hindsight');
        expect(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8').trim()).toBe(MEMORY_HINDSIGHT_PLUGIN_MANIFEST);
        expect(readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8').trim()).toBe(MEMORY_HINDSIGHT_HOOKS);
        expect(readFileSync(join(pluginDir, '.mcp.json'), 'utf-8').trim()).toBe(MEMORY_HINDSIGHT_MCP);

        // 形状：CC 插件格式关键点——hooks 路径带 ./ 前缀；三 hook 事件齐全；MCP 用 ${CLAUDE_PLUGIN_ROOT}
        const manifest = JSON.parse(MEMORY_HINDSIGHT_PLUGIN_MANIFEST);
        expect(manifest.name).toBe('memory-hindsight');
        expect(manifest.hooks).toBe('./hooks/hooks.json');
        const hooks = JSON.parse(MEMORY_HINDSIGHT_HOOKS).hooks;
        expect(Object.keys(hooks).sort()).toEqual(['SessionStart', 'Stop', 'UserPromptSubmit']);
        const mcp = JSON.parse(MEMORY_HINDSIGHT_MCP).mcpServers.hindsight;
        expect(mcp.args[0]).toContain('${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js');
        expect(mcp.env.HINDSIGHT_MCP_HARNESS).toBe('claude-code');
    });

    it('memory-hindsight vendored 资产文件真实存在（防资产清单与源目录脱节）', () => {
        for (const rel of MEMORY_HINDSIGHT_VENDORED_REL_PATHS) {
            expect(existsSync(join(projectPath(), PLUGIN_ASSET_PREFIX, rel.slice(PLUGIN_ASSET_PREFIX.length)))).toBe(true);
        }
    });

    it('开发模式（非编译）从仓库源目录解析插件路径（对齐 tools 的 dev 语义）', () => {
        const pluginPath = bundledPluginPath('mobi');
        // 源目录直挂，不落 {mobi_home}/runtime
        expect(pluginPath).toBe(join(projectPath(), 'plugins', 'mobi'));
        // 仓库源目录里的 SKILL.md 真实存在（防清单与源目录脱节）
        expect(existsSync(join(pluginPath, 'skills', 'visualize', 'SKILL.md'))).toBe(true);
        expect(bundledPluginPath('memory-hindsight')).toBe(join(projectPath(), 'plugins', 'memory-hindsight'));
    });

    it('SDK options 只携带恒挂载插件（按需插件挂载由 spawn 裁决点决定，agent-memory 票 02）', () => {
        const options = buildBundledPluginOptions();
        expect(options).toEqual([
            { type: 'local', path: bundledPluginPath('mobi') },
        ]);
        expect(options[0].path).toContain('plugins/mobi');
    });

    it('解包探针覆盖全部插件的全部清单文件（存在即上一轮全量释放完成）', () => {
        const probes = bundledPluginProbeRelPaths();
        expect(probes).toContain(`${PLUGIN_ASSET_PREFIX}mobi/.claude-plugin/plugin.json`);
        expect(probes).toContain(`${PLUGIN_ASSET_PREFIX}memory-hindsight/.claude-plugin/plugin.json`);
        expect(probes).toContain(`${PLUGIN_ASSET_PREFIX}memory-hindsight/hooks/hooks.json`);
        expect(probes).toContain(`${PLUGIN_ASSET_PREFIX}memory-hindsight/.mcp.json`);
        // 与清单文件表一一对应（每插件每文件一个探针）
        expect(probes).toHaveLength(
            ALL_BUNDLED_PLUGIN_NAMES.reduce((n, name) => n + Object.keys(BUNDLED_PLUGIN_MANIFEST_FILES[name]).length, 0),
        );
    });

    it('runtime 相对路径常量与 embedded assets 清单、解包探针三方对齐', () => {
        // embedded assets 的 relativePath 前缀
        expect(VISUALIZE_SKILL_REL_PATH).toBe(`${PLUGIN_ASSET_PREFIX}mobi/skills/visualize/SKILL.md`);
        // 源目录下同名文件存在（ensureRuntimeAssets 释放到 runtime root 的同名相对路径）
        expect(existsSync(join(projectPath(), 'plugins', VISUALIZE_SKILL_REL_PATH.slice('plugins/'.length)))).toBe(true);
        expect(readFileSync(join(projectPath(), 'plugins', 'mobi', 'skills', 'visualize', 'SKILL.md'), 'utf-8'))
            .toContain('name: visualize');
    });
});
