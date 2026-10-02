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
 * 产物声明协议的三方一致性锁：shared 常量 ↔ CLI 常驻契约 ↔ skill 散文。
 *
 * 模型读不了代码，协议知识不可避免有两份散文（常驻契约 + SKILL.md）；散文本身不是
 * 摩擦，摩擦是「改了代码常量、散文不红」。本测试把会漂移的常量类约束（wire 字面量、
 * 目录模板、HTML 大小上限、mode 枚举）钉在三方：改 shared 常量而漏改任何一份文本、
 * 或改文本而绕开常量，此处即红。措辞类差异（如何展开判据）不锁——细则展开归 skill。
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  ARTIFACTS_DIR_MONTH_FORMAT,
  ARTIFACTS_DIR_REL,
  ARTIFACT_DIRECTIVE,
  ARTIFACT_HTML_INLINE_LIMIT_MB,
} from '@mobi/shared';
import { systemPrompt } from '@/claude/utils/systemPrompt';
import { projectPath } from '@mobi/node-core/projectPath';

/** skill 散文（与 bundledPlugins 解包同源的仓库文件） */
const SKILL_MD = readFileSync(
  join(projectPath(), 'plugins', 'mobi', 'skills', 'visualize', 'SKILL.md'),
  'utf-8',
);

describe('产物声明协议三方一致性（shared 常量 ↔ 常驻契约 ↔ SKILL.md）', () => {
  it('wire 字面量三方同源：契约与 skill 的声明句式都由 ARTIFACT_DIRECTIVE 拼出', () => {
    // 契约：模板字面量逐字锁死（模型照抄输出 = web 端解析的 wire 格式）
    expect(systemPrompt).toContain(`${ARTIFACT_DIRECTIVE}{path="/absolute/path"}`);
    // skill：声明句式同一字面量（模型无 skill 时靠契约、有 skill 时靠细则，两者不能分叉）
    expect(SKILL_MD).toContain(`${ARTIFACT_DIRECTIVE}{path="`);
  });

  it('产物目录模板两份文本同源：ARTIFACTS_DIR_REL + 月份段格式', () => {
    const segment = `${ARTIFACTS_DIR_REL}/<${ARTIFACTS_DIR_MONTH_FORMAT}>/`;
    expect(systemPrompt).toContain(segment);
    // skill 用散文写法（.mobi/artifacts/<YYYY-MM>/），路径模板同源
    expect(SKILL_MD).toContain(segment);
  });

  it(`HTML inline 上限 skill 散文与 shared 常量一致（under ${ARTIFACT_HTML_INLINE_LIMIT_MB} MB）`, () => {
    // skill §2 的 size target 是 web 裁决上限的模型侧镜像：改 shared 常量漏改 skill → 红
    expect(SKILL_MD).toMatch(new RegExp(`under ${ARTIFACT_HTML_INLINE_LIMIT_MB} MB`));
  });

  it('mode 枚举两份文本都在（card / wide）', () => {
    for (const text of [systemPrompt, SKILL_MD]) {
      expect(text).toContain('mode="card"');
      expect(text).toContain('mode="wide"');
    }
  });
});
