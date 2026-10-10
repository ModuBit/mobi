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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemPrompt, buildAppendSystemPrompt } from '@/claude/utils/systemPrompt';
import { OPENUI_CORE_PROMPT } from '@/claude/utils/openuiCorePrompt.generated';
import { buildActionUri } from '@mobi/shared';
import { projectPath } from '@mobi/node-core/projectPath';

/** 无用户自定义时的完整追加内容（base + openui 核心段，票 02 注入 / 票 08 分层后形状） */
const fullAppend = `${systemPrompt}\n\n${OPENUI_CORE_PROMPT}`;

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

describe('openui 核心段契约（generative-ui 票 02 注入、票 08 分层收窄）', () => {
  it('含官方围栏教学（```openui-lang 标签，inlineMode 段自带）', () => {
    expect(OPENUI_CORE_PROMPT).toContain('```openui-lang');
  });

  it('含纯问题不出码约束（官方 inlineMode 段，PoC 场景 s09/s15/s19 口径）', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/plain text\. Do NOT output any openui-lang code/i);
  });

  it('三层形态判据齐全：native 围栏 / app 文件+mode=app 声明 / fenced 小片段（判据常驻）', () => {
    const routings = OPENUI_CORE_PROMPT.match(/Form routing:/g) ?? [];
    expect(routings).toHaveLength(3);
    expect(OPENUI_CORE_PROMPT).toMatch(/self-contained single-file \.html/i);
    expect(OPENUI_CORE_PROMPT).toMatch(/iterate with Edit/i);
    expect(OPENUI_CORE_PROMPT).toContain('mode="app"');
  });

  it('核心组件签名在（简单场景自洽），低频组件签名不在（分层生效）', () => {
    // 签名文档形态是「Name(param: type, ...)」；惯例段提及（如 Charts 语法示例）不算
    for (const c of ['Stack(', 'Button(label:', 'OptionCards(', 'FormControl(', 'Chips(', 'Table(']) {
      expect(OPENUI_CORE_PROMPT).toContain(c);
    }
    for (const c of ['LineChart(labels:', 'Carousel(children:', 'DatePicker(', 'Modal(title:', 'EditableTable(', 'OverviewCardBlock(']) {
      expect(OPENUI_CORE_PROMPT).not.toContain(c);
    }
  });

  it('分层引导在：组件不在清单先加载 openui skill（失败模式=多一次调用而非静默丢语句）', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/CORE SUBSET/i);
    expect(OPENUI_CORE_PROMPT).toMatch(/invoke the `openui` skill FIRST/i);
    expect(OPENUI_CORE_PROMPT).toMatch(/Never guess a signature/i);
  });

  it('档③ $actionState 约定在核心段（票 04 原地更新）', () => {
    expect(OPENUI_CORE_PROMPT).toContain('$actionState = "idle"');
    expect(OPENUI_CORE_PROMPT).toMatch(/\$actionState == "done" \?/);
    expect(OPENUI_CORE_PROMPT).toMatch(/idle → running → done\/failed/);
  });

  it('核心段体积受控（≤26K chars ≈ 6.5K tokens——膨胀预算门，超限须先收窄再扩）', () => {
    expect(OPENUI_CORE_PROMPT.length).toBeLessThanOrEqual(26_000);
  });

  it('与生成脚本同源同步（升 react-ui 或改判据措辞后未重生成即红）', async () => {
    const { buildCorePrompt, buildSkillMarkdown, SKILL_FILE_HEADER } = await import('../../../scripts/generate-openui-prompt');
    expect(buildCorePrompt()).toBe(OPENUI_CORE_PROMPT);
    // SKILL.md 路径锚定 cli 安装根（与生成脚本同一锚点，不数目录层数）
    const skillPath = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui', 'SKILL.md');
    expect(readFileSync(skillPath, 'utf8')).toBe(`${SKILL_FILE_HEADER}${buildSkillMarkdown()}`);
  });
});

describe('openui skill（全量目录，票 08 随 mobi 插件分发）', () => {
  const skillPath = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');

  it('frontmatter：name=openui + description 覆盖复杂组件触发词', () => {
    expect(skill).toMatch(/\n---\nname: openui\n/);
    expect(skill).toMatch(/description: Full openui-lang component catalog/);
    expect(skill).toMatch(/charts/);
  });

  it('全量组件目录在（核心段下沉的低频件 + 语法 root = Stack）', () => {
    expect(skill).toMatch(/root = Stack\(/);
    for (const c of ['LineChart(labels:', 'Carousel(children:', 'DatePicker(', 'Modal(title:', 'EditableTable(', 'OverviewCardBlock(', 'Accordion(', 'Tabs(']) {
      expect(skill).toContain(c);
    }
    expect(skill.length).toBeGreaterThan(30_000);
  });

  it('mode=app 细则全文在 skill（--mobi-* 调色板 + MobiApp.issueNewTurn——核心段只留指路）', () => {
    expect(skill).toMatch(/--mobi-\*` CSS variable palette/);
    expect(skill).toContain('var(--mobi-bg)');
    expect(skill).toContain('window.MobiApp.issueNewTurn(text)');
    expect(skill).toMatch(/ONLY from explicit user actions/i);
    // 判据缺位防护：skill 单独被读时三层判据仍在
    expect((skill.match(/Form routing:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
