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

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncPluginAssets } from '@/runtime/assets';
import { BUNDLED_PLUGIN_ASSET_REL_PATHS, bundledPluginProbeRelPaths, MEMORY_HINDSIGHT_VENDORED_REL_PATHS, VISUALIZE_SKILL_REL_PATH } from '@mobi/node-core/runtime/bundledPlugins';
import type { EmbeddedAsset } from '#embedded-assets';
import { projectPath } from '@mobi/node-core/projectPath';

describe('syncPluginAssets（runtime 解包 · inline-artifacts ticket 05）', () => {
  // 临时目录充当 runtime root，等价 MOBI_HOME 隔离
  let runtimeRoot: string;

  beforeAll(() => {
    runtimeRoot = mkdtempSync(join(tmpdir(), 'mobi-runtime-assets-test-'));
  });

  afterAll(() => {
    rmSync(runtimeRoot, { recursive: true, force: true });
  });

  // 用仓库源 SKILL.md 充当 embedded asset（vitest 非 compiled，走 stub 无真实嵌入资源）
  const skillAsset = (): EmbeddedAsset => ({
    relativePath: VISUALIZE_SKILL_REL_PATH,
    sourcePath: join(projectPath(), 'plugins', 'mobi', 'skills', 'visualize', 'SKILL.md'),
  });

  // 探针含全部插件的内置资产（mobi 的 SKILL.md + references、forked tap 的 hooks 模块）：
  // 测试驱动需给全套才能到「已解包」态
  const fullMobiAssets = (): EmbeddedAsset[] =>
    Object.entries(BUNDLED_PLUGIN_ASSET_REL_PATHS).flatMap(([name, rels]) =>
      (rels ?? []).map((rel) => ({
        relativePath: `plugins/${name}/${rel}`,
        sourcePath: join(projectPath(), 'plugins', name, rel),
      })),
    );

  it('首次释放：SKILL.md 落到 runtime root 的同名相对路径，内容一致', async () => {
    await syncPluginAssets(runtimeRoot, fullMobiAssets());

    const target = join(runtimeRoot, VISUALIZE_SKILL_REL_PATH);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toContain('name: visualize');
  });

  it('二次释放是 no-op：探针文件在即跳过，不重写（mtime 不变）', async () => {
    const target = join(runtimeRoot, VISUALIZE_SKILL_REL_PATH);
    // 把 mtime 拨回过去作哨兵：若被重写，mtime 会被刷新为当前时间
    const past = new Date(Date.now() - 60_000);
    utimesSync(target, past, past);
    const before = statSync(target).mtimeMs;

    await syncPluginAssets(runtimeRoot, fullMobiAssets());

    expect(statSync(target).mtimeMs).toBe(before);
  });

  it('释放时同步写盘全部插件的清单文件（.json 不走嵌入，从常量写盘）', async () => {
    await syncPluginAssets(runtimeRoot, fullMobiAssets());

    for (const probe of bundledPluginProbeRelPaths()) {
      expect(existsSync(join(runtimeRoot, probe))).toBe(true);
    }
    // memory-hindsight 三份清单内容与常量一致（探针文件同时也是内容落点）
    const mcpPath = join(runtimeRoot, 'plugins/memory-hindsight/.mcp.json');
    expect(readFileSync(mcpPath, 'utf-8')).toContain('HINDSIGHT_MCP_HARNESS');
  });

  it('探针（任一清单/资产文件）缺失时重新释放——资产集增删自愈（2026-10-19 openui references 实锤：新文件在存量 runtime 永不落地即部署即断）', async () => {
    // 探针 = 清单文件 + mobi 内置资产集：references 缺失即触发重释放
    const referencesRel = 'plugins/mobi/skills/openui/references/signatures.md';
    rmSync(join(runtimeRoot, referencesRel));
    await syncPluginAssets(runtimeRoot, fullMobiAssets());
    expect(existsSync(join(runtimeRoot, referencesRel))).toBe(true);

    // 清单缺失同样触发，并把被顺手删掉的资产补回
    rmSync(join(runtimeRoot, 'plugins/memory-hindsight/.mcp.json'));
    rmSync(join(runtimeRoot, VISUALIZE_SKILL_REL_PATH));
    await syncPluginAssets(runtimeRoot, fullMobiAssets());
    expect(existsSync(join(runtimeRoot, VISUALIZE_SKILL_REL_PATH))).toBe(true);
  });

  it('忽略非 plugins/ 前缀的资源（工具段由 unpackTools 负责）', async () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'mobi-runtime-assets-test-'));
    try {
      await syncPluginAssets(otherRoot, [
        { relativePath: 'tools/archives/some.tar.gz', sourcePath: skillAsset().sourcePath },
      ]);
      expect(existsSync(join(otherRoot, 'tools'))).toBe(false);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});

describe('vendored 资产清单对齐（embeddedAssets ↔ 常量）', () => {
  it('embedded asset() 首参的 memory-hindsight 路径集合与常量一致（升级增删文件漏改即红）', () => {
    // vitest 非 compiled 走 stub 拿不到真实 COMMON_ASSETS，静态提取 bun 版源码的
    // asset('plugins/memory-hindsight/...') 调用首参——把「保持一致」从注释升为机器检查
    const src = readFileSync(join(projectPath(), 'src', 'runtime', 'embeddedAssets.bun.ts'), 'utf-8');
    const embedded = [...src.matchAll(/asset\('(plugins\/memory-hindsight\/[^']+)'/g)].map((m) => m[1]!);
    expect([...embedded].sort()).toEqual([...MEMORY_HINDSIGHT_VENDORED_REL_PATHS].sort());
  });

  it('embedded asset() 首参的插件路径集合与 BUNDLED_PLUGIN_ASSET_REL_PATHS 一致（增删文件漏改常量即红——探针据此自愈）', () => {
    const src = readFileSync(join(projectPath(), 'src', 'runtime', 'embeddedAssets.bun.ts'), 'utf-8');
    for (const [name, rels] of Object.entries(BUNDLED_PLUGIN_ASSET_REL_PATHS)) {
      const embedded = [...src.matchAll(new RegExp(`asset\\('(plugins/${name}/[^']+)'`, 'g'))].map((m) => m[1]!);
      expect([...embedded].sort()).toEqual((rels ?? []).map((rel) => `plugins/${name}/${rel}`).sort());
    }
  });
});

/**
 * vendored dist 必须保持上游原样——mobi 的策略差异一律落在**配置文件**，不改 dist 代码。
 * 「从不刷新」用 -1 哨兵承载（上游 `|| 1` 会把 0 吞成 1），编码在 daemon 侧
 * （见 VENDOR-NOTES「配置契约」）。此处守住「有人又往压缩产物里打补丁」。
 */
describe('vendored dist 保持上游原样（禁止本地补丁）', () => {
  const distFiles = () => readdirSync(join(projectPath(), 'plugins', 'memory-hindsight', 'dist'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, src: readFileSync(join(projectPath(), 'plugins', 'memory-hindsight', 'dist', f), 'utf-8') }));

  it('pageRefreshEveryTurns 解析保持上游 `|| 1` 形态（被打补丁即红）', () => {
    const files = distFiles();
    expect(files.filter((f) => f.src.includes('pageRefreshEveryTurns: raw.pageRefreshEveryTurns ?? 1')).map((f) => f.name)).toEqual([]);
    // 0.8.0 的 6 个入口各自内联一份配置解析（tsup 逐入口自包含）；数量变化 = 上游结构变了，
    // 须复核配置契约（-1 哨兵）是否仍旧有效
    expect(files.filter((f) => f.src.includes('pageRefreshEveryTurns: raw.pageRefreshEveryTurns || 1'))).toHaveLength(6);
  });
});
