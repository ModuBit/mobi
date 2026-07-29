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
});
