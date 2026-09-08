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
import { systemPrompt, buildAppendSystemPrompt } from '@/claude/utils/systemPrompt';
import { buildActionUri } from '@mobi/shared';

describe('buildAppendSystemPrompt', () => {
  it('仅返回 base（change_title 指令）当无用户自定义', () => {
    const result = buildAppendSystemPrompt({});
    expect(result).toBe(systemPrompt);
    expect(result).toContain('change_title');
  });

  it('把 customSystemPrompt 作为追加内容（不替换 base）', () => {
    const result = buildAppendSystemPrompt({ customSystemPrompt: 'You are concise.' });
    // custom 在前，base 在后，\n\n 连接
    expect(result).toBe(`You are concise.\n\n${systemPrompt}`);
  });

  it('把 appendSystemPrompt 作为追加内容', () => {
    const result = buildAppendSystemPrompt({ appendSystemPrompt: 'Be brief.' });
    expect(result).toBe(`Be brief.\n\n${systemPrompt}`);
  });

  it('custom 与 append 同时存在时按 custom → append → base 顺序拼接', () => {
    const result = buildAppendSystemPrompt({
      customSystemPrompt: 'CUSTOM',
      appendSystemPrompt: 'APPEND',
    });
    expect(result).toBe(`CUSTOM\n\nAPPEND\n\n${systemPrompt}`);
  });

  it('空字符串与 undefined 等价（被过滤）', () => {
    expect(buildAppendSystemPrompt({ customSystemPrompt: '', appendSystemPrompt: undefined }))
      .toBe(systemPrompt);
  });

  it('base 含 mobi://file/open 协议段：模板字面量、时机约束、编码提醒三要素', () => {
    // 模板字面量锁死：agent 照抄输出的就是 web 端解析的 wire 格式，改坏即全链路失效。
    // scheme/域/动作/参数名经 buildActionUri 从 ACTION_REGISTRY 生成——registry 变更
    // （如参数名 path→file）时本测试以协议语义的方式红，而非等真机链路断才发现
    const [uriPrefix] = buildActionUri('file/open', { path: 'x' }).split('?')
    expect(systemPrompt).toContain(`[a.ts](${uriPrefix}?path=src/a.ts)`);
    // 时机约束：仅在有打开价值时用（防链接噪音）
    expect(systemPrompt).toMatch(/only/i);
    // 编码提醒：非 ASCII 路径需 URL 编码
    expect(systemPrompt).toMatch(/URL-encode/i);
  });
});
