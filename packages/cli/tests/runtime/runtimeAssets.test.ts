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
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncPluginAssets } from '@/runtime/assets';
import { VISUALIZE_SKILL_REL_PATH } from '@/runtime/bundledPlugins';
import type { EmbeddedAsset } from '#embedded-assets';
import { projectPath } from '@/projectPath';

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
    sourcePath: join(projectPath(), 'plugins', 'visualize', 'skills', 'visualize', 'SKILL.md'),
  });

  it('首次释放：SKILL.md 落到 runtime root 的同名相对路径，内容一致', async () => {
    await syncPluginAssets(runtimeRoot, [skillAsset()]);

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

    await syncPluginAssets(runtimeRoot, [skillAsset()]);

    expect(statSync(target).mtimeMs).toBe(before);
  });

  it('探针文件缺失（版本重置/不完整）时重新释放', async () => {
    const target = join(runtimeRoot, VISUALIZE_SKILL_REL_PATH);
    rmSync(target);

    await syncPluginAssets(runtimeRoot, [skillAsset()]);

    expect(existsSync(target)).toBe(true);
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
