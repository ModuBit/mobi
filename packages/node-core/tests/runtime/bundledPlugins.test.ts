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
import { bundledPluginPath, buildBundledPluginOptions, BUNDLED_PLUGINS, MOBI_PLUGIN_MANIFEST, PLUGIN_ASSET_PREFIX, VISUALIZE_SKILL_REL_PATH } from '@/runtime/bundledPlugins';
import { projectPath } from '@/projectPath';

describe('bundledPlugins（单插件 mobi 聚合全部内置 skill）', () => {
  it('插件清单当前只有 mobi（单插件聚合，slash 命名空间 /mobi:<skill>）', () => {
    expect([...BUNDLED_PLUGINS]).toEqual(['mobi']);
  });

  it('插件清单文件存在且 name=mobi（plugin.json 的 name 决定 slash 命名空间），与 TS 常量单源一致', () => {
    const manifestPath = join(projectPath(), 'plugins', 'mobi', '.claude-plugin', 'plugin.json');
    expect(existsSync(manifestPath)).toBe(true);
    // repo 文件（dev 直挂用）与 TS 常量（编译态解包写盘用）是同一份内容的两个落点，防漂移
    expect(readFileSync(manifestPath, 'utf-8').trim()).toBe(MOBI_PLUGIN_MANIFEST);
    expect(JSON.parse(MOBI_PLUGIN_MANIFEST).name).toBe('mobi');
  });

  it('开发模式（非编译）从仓库源目录解析插件路径（对齐 tools 的 dev 语义）', () => {
    const pluginPath = bundledPluginPath('mobi');
    // 源目录直挂，不落 {mobi_home}/runtime
    expect(pluginPath).toBe(join(projectPath(), 'plugins', 'mobi'));
    // 仓库源目录里的 SKILL.md 真实存在（防清单与源目录脱节）
    expect(existsSync(join(pluginPath, 'skills', 'visualize', 'SKILL.md'))).toBe(true);
  });

  it('SDK options 携带 local plugin 路径（remote 进 sdkOptions；local 由 launcher 转 --plugin-dir）', () => {
    const options = buildBundledPluginOptions();
    expect(options).toEqual([
      { type: 'local', path: bundledPluginPath('mobi') },
    ]);
    expect(options[0].path).toContain('plugins/mobi');
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
