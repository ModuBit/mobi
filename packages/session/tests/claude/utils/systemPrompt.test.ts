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
import { OPENUI_CATALOG_PROMPT } from '@/claude/utils/openuiCatalogPrompt.generated';
import { buildActionUri } from '@mobi/shared';

/** 无用户自定义时的完整追加内容（base + openui catalog，票 02 起形状） */
const fullAppend = `${systemPrompt}\n\n${OPENUI_CATALOG_PROMPT}`;

describe('buildAppendSystemPrompt', () => {
  it('无用户自定义时返回 base + openui catalog（change_title 与 catalog 都在）', () => {
    const result = buildAppendSystemPrompt({});
    expect(result).toBe(fullAppend);
    expect(result).toContain('change_title');
  });

  it('把 customSystemPrompt 作为追加内容（不替换 base）', () => {
    const result = buildAppendSystemPrompt({ customSystemPrompt: 'You are concise.' });
    // custom 在前，base 在后，\n\n 连接
    expect(result).toBe(`You are concise.\n\n${fullAppend}`);
  });

  it('把 appendSystemPrompt 作为追加内容', () => {
    const result = buildAppendSystemPrompt({ appendSystemPrompt: 'Be brief.' });
    expect(result).toBe(`Be brief.\n\n${fullAppend}`);
  });

  it('custom 与 append 同时存在时按 custom → append → base → catalog 顺序拼接', () => {
    const result = buildAppendSystemPrompt({
      customSystemPrompt: 'CUSTOM',
      appendSystemPrompt: 'APPEND',
    });
    expect(result).toBe(`CUSTOM\n\nAPPEND\n\n${fullAppend}`);
  });

  it('空字符串与 undefined 等价（被过滤）', () => {
    expect(buildAppendSystemPrompt({ customSystemPrompt: '', appendSystemPrompt: undefined }))
      .toBe(fullAppend);
  });

  it('base 含 mobi://file/open 协议段：模板字面量、时机约束、编码提醒三要素', () => {
    // 模板字面量锁死：agent 照抄输出的就是 web 端解析的 wire 格式，改坏即全链路失效。
    // scheme/域/动作/参数名经 buildActionUri 从 ACTION_REGISTRY 生成——registry 变更
    // （如参数名 path→file）时本测试以协议语义的方式红，而非等真机链路断才发现
    const [uriPrefix] = buildActionUri('file/open', { path: 'x' }).split('?')
    expect(systemPrompt).toContain(`[a.ts](${uriPrefix}?path=src/a.ts)`)
    // 反例锁死：真机实证模型会把「clickable links」理解成 md 惯例的相对路径 href
    // （输出 [t](packages/...) 死链），prompt 必须显式否定该形态
    expect(systemPrompt).toMatch(/\[a\.ts\]\(src\/a\.ts\) is NOT/);
    // 时机约束：仅在有打开价值时用（防链接噪音）
    expect(systemPrompt).toMatch(/only/i);
    // 编码提醒：非 ASCII 路径需 URL 编码
    expect(systemPrompt).toMatch(/URL-encode/i);
  });
});

describe('产物声明契约（inline-artifacts ticket 04）', () => {
  // remote（preset+append+snapshot）与 local（--append-system-prompt）都经 buildAppendSystemPrompt
  // 构建，同一断言覆盖两模式——契约加在源头常量 BASE_SYSTEM_PROMPT，双模式天然同源
  const prompt = buildAppendSystemPrompt({});

  it('含 :mobi-artifact 声明指令的 wire 格式（逐字锁死，模型照抄输出）', () => {
    expect(prompt).toContain(':mobi-artifact{path="/absolute/path"}');
    // mode 枚举：card（复杂 HTML/应用/dev server）与 wide（全宽 mockup）
    expect(prompt).toContain('mode="card"');
    expect(prompt).toContain('mode="wide"');
  });

  it('含产物目录约定：非工作区交付物落 <cwd>/.mobi/artifacts/<YYYY-MM>/', () => {
    expect(prompt).toContain('.mobi/artifacts/');
    expect(prompt).toMatch(/YYYY-MM/);
    // ascii 短文件名 + .gitignore 自隔离两要素
    expect(prompt).toMatch(/ASCII filename/i);
    expect(prompt).toMatch(/gitignore/i);
  });

  it('含边界约束：静态图走 mermaid、仅下载文件不声明、不向用户提及协议', () => {
    expect(prompt).toMatch(/mermaid/i);
    expect(prompt).toMatch(/do not declare/i);
    expect(prompt).toMatch(/Never mention this directive to the user/i);
  });

  it('既有 base 内容不受契约追加影响', () => {
    expect(prompt).toContain('change_title');
    expect(prompt).toContain('[a.ts](mobi://file/open?path=src/a.ts)');
  });
});

describe('openui catalog prompt 契约（generative-ui 票 02）', () => {
  it('含官方围栏教学（```openui-lang 标签，inlineMode 段自带）', () => {
    expect(OPENUI_CATALOG_PROMPT).toContain('```openui-lang');
  });

  it('含纯问题不出码约束（官方 inlineMode 段，PoC 场景 s09/s15/s19 口径）', () => {
    expect(OPENUI_CATALOG_PROMPT).toMatch(/plain text\. Do NOT output any openui-lang code/i);
  });

  it('三层形态判据齐全：native 围栏 / app 文件+mode=app 声明 / fenced 小片段', () => {
    const routings = OPENUI_CATALOG_PROMPT.match(/Form routing:/g) ?? [];
    expect(routings).toHaveLength(3);
    // app 线：自包含单文件 + Edit 迭代 + mode=app 声明（与 base 的 artifact 指令衔接）
    expect(OPENUI_CATALOG_PROMPT).toMatch(/self-contained single-file \.html/i);
    expect(OPENUI_CATALOG_PROMPT).toMatch(/iterate with Edit/i);
    expect(OPENUI_CATALOG_PROMPT).toContain('mode="app"');
  });

  it('含组件目录签名与关键语法规则（catalog 主体在，否则模型无从生成合法 DSL）', () => {
    expect(OPENUI_CATALOG_PROMPT).toMatch(/root = Stack\(/);
    expect(OPENUI_CATALOG_PROMPT).toMatch(/PascalCase/i);
    expect(OPENUI_CATALOG_PROMPT.length).toBeGreaterThan(10_000);
  });

  it('与生成脚本同源同步（升 react-ui 或改判据措辞后未重生成即红）', async () => {
    const { OPENUI_PROMPT_OPTIONS } = await import('../../../scripts/generate-openui-prompt');
    const { openuiLibrary } = await import('@openuidev/react-ui/genui-lib');
    expect(openuiLibrary.prompt(OPENUI_PROMPT_OPTIONS)).toBe(OPENUI_CATALOG_PROMPT);
  });

  it('含档③ $actionState 约定（票 04 原地更新：声明 + 三元派生 + 值域词汇）', () => {
    expect(OPENUI_CATALOG_PROMPT).toContain('$actionState = "idle"');
    // 派生教嵌套三元（表达式层 Ternary；组件层无 Switch 组件）
    expect(OPENUI_CATALOG_PROMPT).toMatch(/\$actionState == "done" \?/);
    expect(OPENUI_CATALOG_PROMPT).toMatch(/idle → running → done\/failed/);
    // 回灌消息的处理语义：当作执行指令，勿重复生成同一 UI 块
    expect(OPENUI_CATALOG_PROMPT).toMatch(/do NOT regenerate the same UI block/);
  });

  it('含 mode=app 主题变量教学（票 05：--mobi-* 调色板 + 双档自适应 + 自带 CSS 优先）', () => {
    expect(OPENUI_CATALOG_PROMPT).toMatch(/--mobi-\*` CSS variable palette/);
    expect(OPENUI_CATALOG_PROMPT).toContain('var(--mobi-bg)');
    expect(OPENUI_CATALOG_PROMPT).toMatch(/light\/dark theme/);
    expect(OPENUI_CATALOG_PROMPT).toMatch(/your own CSS always wins/);
  });
});
