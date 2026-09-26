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
import { bundledPluginPath, buildBundledPluginOptions, BUNDLED_PLUGINS, PLUGIN_ASSET_PREFIX, VISUALIZE_SKILL_REL_PATH } from '@/runtime/bundledPlugins';
import { projectPath } from '@/projectPath';

describe('bundledPlugins（inline-artifacts ticket 05）', () => {
  it('插件清单当前只有 visualize（每特性一个 plugin）', () => {
    expect([...BUNDLED_PLUGINS]).toEqual(['visualize']);
  });

  it('开发模式（非编译）从仓库源目录解析插件路径（对齐 tools 的 dev 语义）', () => {
    const pluginPath = bundledPluginPath('visualize');
    // 源目录直挂，不落 {mobi_home}/runtime
    expect(pluginPath).toBe(join(projectPath(), 'plugins', 'visualize'));
    // 仓库源目录里的 SKILL.md 真实存在（防清单与源目录脱节）
    expect(existsSync(join(pluginPath, 'skills', 'visualize', 'SKILL.md'))).toBe(true);
  });

  it('SDK options 携带 local plugin 路径（remote 进 sdkOptions；local 由 launcher 转 --plugin-dir）', () => {
    const options = buildBundledPluginOptions();
    expect(options).toEqual([
      { type: 'local', path: bundledPluginPath('visualize') },
    ]);
    expect(options[0].path).toContain('plugins/visualize');
  });

  it('runtime 相对路径常量与 embedded assets 清单、解包探针三方对齐', () => {
    // embedded assets 的 relativePath 前缀
    expect(VISUALIZE_SKILL_REL_PATH).toBe(`${PLUGIN_ASSET_PREFIX}visualize/skills/visualize/SKILL.md`);
    // 源目录下同名文件存在（ensureRuntimeAssets 释放到 runtime root 的同名相对路径）
    expect(existsSync(join(projectPath(), 'plugins', VISUALIZE_SKILL_REL_PATH.slice('plugins/'.length)))).toBe(true);
    expect(readFileSync(join(projectPath(), 'plugins', 'visualize', 'skills', 'visualize', 'SKILL.md'), 'utf-8'))
      .toContain('name: visualize');
  });
});
