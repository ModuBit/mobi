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
import { buildActionUri, MOBI_THEME_VAR_LIST } from '@mobi/shared';
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

  it('c 档形态（2026-10-19 裁决落定）：零常驻组件签名 + 全量名录 + 工具检索引导', () => {
    // 名录在：95 组件 Name — 一句话（模型看得见能力面才能组合）
    expect(OPENUI_CORE_PROMPT).toMatch(/Stack — /);
    expect(OPENUI_CORE_PROMPT).toMatch(/Carousel — |DatePicker — /);
    // 签名不在：签名形态（含参数列表）不进 prompt，经 openui_components 检索
    expect(OPENUI_CORE_PROMPT).not.toContain('Button(label:');
    expect(OPENUI_CORE_PROMPT).not.toContain('OptionCards(name:');
    expect(OPENUI_CORE_PROMPT).not.toContain('LineChart(labels:');
    // 检索引导在：查工具 + 禁瞎猜 + skill 全量兜底
    expect(OPENUI_CORE_PROMPT).toMatch(/call the `openui_components` tool/);
    expect(OPENUI_CORE_PROMPT).toMatch(/Never guess a signature/);
    expect(OPENUI_CORE_PROMPT).toMatch(/`mobi:openui` skill also carries the full catalog/);
  });

  it('函数分组名录在（2026-10-19 函数名录化）：六类各一行，全签名目录不进', () => {
    // 官方分类六组；函数名平铺进组行；逐函数签名行（@Name(params) 形态）不进
    expect(OPENUI_CORE_PROMPT).toMatch(/Lists \(build \/ transform \/ query arrays\): @Append/);
    expect(OPENUI_CORE_PROMPT).toMatch(/Data \(group \/ aggregate \/ reshape rows\): @/);
    expect(OPENUI_CORE_PROMPT).not.toMatch(/@Append\(list: any\[\], item: any\)/);
  });

  it('官方 componentGroups 组合教学保留（单组件深教下沉）', () => {
    // 组合模式 notes 是「怎么组合」的官方承载位——保留
    expect(OPENUI_CORE_PROMPT).toContain('Modal: Modal("Title"');
    expect(OPENUI_CORE_PROMPT).toContain('Table is COLUMN-oriented');
    // EditableTable 深教（低频组件完整用法）下沉 skill
    expect(OPENUI_CORE_PROMPT).not.toContain('EditableTable lets the user edit cells');
  });

  it('mobi 规则 concise 版（官方 notes 已覆盖的不重复）：低频深教下沉 skill', () => {
    // one-shot 完整代码模式不在（指路 skill），闸门语义与反例仍在
    expect(OPENUI_CORE_PROMPT).toMatch(/never a boolean flag like `\$submitted`/);
    expect(OPENUI_CORE_PROMPT).not.toMatch(/never renders as a clickable button again/);
    // charts 教学保留 mobi 特有（自定义 Chart/Svg 顺序/颜色 token），删官方重复
    expect(OPENUI_CORE_PROMPT).toMatch(/Custom Chart component:/);
    expect(OPENUI_CORE_PROMPT).not.toMatch(/shapes: Circle\/Rect\/Line\/Path/);
  });

  it('整页编排判据在核心段（2026-10-19）：按内容结构触发，不枚举场景', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/Composed pages/);
    expect(OPENUI_CORE_PROMPT).toMatch(/load the `mobi:openui` skill FIRST/);
    // 判据是「内容天然分节」而不是固定场景清单——场景枚举不可扩展
    expect(OPENUI_CORE_PROMPT).toMatch(/naturally splits into sections/);
    expect(OPENUI_CORE_PROMPT).not.toMatch(/travel itinerary/);
    // Map 已是原生组件：app 路由不得再把 maps 列为「必须走 .html」
    expect(OPENUI_CORE_PROMPT).toMatch(/Form routing: interactions that need custom JavaScript logic, rich animation/);
    expect(OPENUI_CORE_PROMPT).not.toMatch(/custom JavaScript logic, maps/);
  });

  it('档③ 状态变量值域约定在核心段（票 04 原地更新 + 票 02 值域识别修订）', () => {
    // 宿主按默认值域识别状态变量（模型自创名 $mdState 实测同样生效），$actionState 是惯用名
    expect(OPENUI_CORE_PROMPT).toMatch(/default value is exactly "idle"/);
    expect(OPENUI_CORE_PROMPT).toMatch(/idle \/ running \/ done \/ failed/);
    expect(OPENUI_CORE_PROMPT).toMatch(/\$actionState == "done" \?/);
    expect(OPENUI_CORE_PROMPT).toMatch(/idle → running → done\/failed/);
  });

  it('per-action 教学在核心段（per-action 粒度票 04）：每操作一变量 + Set 即时反馈 + 多操作独立', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/its OWN reactive variable/);
    expect(OPENUI_CORE_PROMPT).toMatch(/never share one variable between actions/);
    expect(OPENUI_CORE_PROMPT).toMatch(/Set\(\$actionState, "running"\)/);
    expect(OPENUI_CORE_PROMPT).toMatch(/Multi-action panels/);
  });

  it('一次性操作条件渲染句式在核心段（concise 版）：闸门语义 + $submitted 反例 + Buttons 包裹', () => {
    // concise 版只留闸门语义（idle/failed/其余三元替换）与反例，完整代码模式在 skill
    expect(OPENUI_CORE_PROMPT).toMatch(/render idle → Button \/ failed → retry Button/);
    expect(OPENUI_CORE_PROMPT).toMatch(/`Buttons\(\[\.\.\.\]\)` wrapper, never a bare Button/);
    // 布尔开关否定式（E2E 实锤模型自创 $submitted 闸，宿主永不写它 → 按钮永不锁定）
    expect(OPENUI_CORE_PROMPT).toMatch(/never a boolean flag like `\$submitted`/);
    // 派生值必须是非 $ 普通语句（E2E 实锤：`$submitBtn = 三元返回组件` 的 $ 初始化
    // 不会被求值，渲染为空——$ 声明只存原始 AST）
    expect(OPENUI_CORE_PROMPT).toMatch(/Derived values \(labels\/buttons\) are PLAIN statements like `btnLabel` — never `\$name`/);
  });

  it('函数词汇在（分组名录形态，2026-10-19 函数名录化）：模型无需加载 skill 即知有哪些函数', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/Function catalog/);
    for (const fn of ['@GroupBy', '@Payment', '@Format', '@MixColor', '@StartOf', '@SliceList']) {
      expect(OPENUI_CORE_PROMPT).toContain(fn);
    }
  });

  it('自定义组件的媒介判据在核心段（票 03 concise）：Chart/Svg/HtmlView 各归其位', () => {
    expect(OPENUI_CORE_PROMPT).toMatch(/Custom Chart component:/);
    expect(OPENUI_CORE_PROMPT).toMatch(/series are column names like \["revenue"\], NOT Series\(\.\.\.\)/);
    // 位置参数顺序示例（E2E 实锤：只给签名列表时模型按直觉写成 Svg(width,height,shapes)）
    expect(OPENUI_CORE_PROMPT).toMatch(/Svg\(\[Rect\(10, 10, 80, 40, "surface", "ink", 2\), SvgText\("Step", 20, 80, 12, "muted"\)\]/);
    expect(OPENUI_CORE_PROMPT).toMatch(/HtmlView only for a game or animation/);
    // 折叠图元参数顺序（2026-10-19 E2E 实锤：模型把 Polygon 写成 Polygon(x1,y1,x2,y2,…)，
    // 8 处语句被 schema 丢弃）
    expect(OPENUI_CORE_PROMPT).toMatch(/Polyline\/Polygon take a "x1,y1 x2,y2" points string first/);
    // 图元颜色 token 词汇（concise：chart1-6 合并写法）
    expect(OPENUI_CORE_PROMPT).toMatch(/chart1-6/);
    // 名录含 Map 行（组件能力面；三档降级由 daemon 设置决定）
    expect(OPENUI_CORE_PROMPT).toMatch(/^Map — /m);
  });

  it('核心段体积受控（≤22K chars——c 档 2026-10-19 裁决：基线 20.3K + 余量；膨胀须先收窄）', () => {
    expect(OPENUI_CORE_PROMPT.length).toBeLessThanOrEqual(22_000);
  });

  it('与生成脚本同源同步（升 react-ui 或改判据措辞后未重生成即红）', async () => {
    const { buildCorePrompt, buildSkillMarkdown, buildSkillExamples, buildSkillSignatures, buildSkillAppDetails } =
      await import('../../../scripts/generate-openui-prompt');
    expect(buildCorePrompt()).toBe(OPENUI_CORE_PROMPT);
    // SKILL.md 路径锚定 cli 安装根（与生成脚本同一锚点，不数目录层数）；
    // 四文件（索引 + 三 references）逐一全等——重生成漏写任一文件即红
    const skillPath = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui');
    // 文件必须以 frontmatter 开头（SKILL_FILE_HEADER 若在更前面，CC 解析不到 → Unknown skill）
    expect(readFileSync(join(skillPath, 'SKILL.md'), 'utf8')).toBe(buildSkillMarkdown());
    expect(readFileSync(join(skillPath, 'references', 'examples.md'), 'utf8')).toBe(buildSkillExamples());
    expect(readFileSync(join(skillPath, 'references', 'signatures.md'), 'utf8')).toBe(buildSkillSignatures());
    expect(readFileSync(join(skillPath, 'references', 'app-details.md'), 'utf8')).toBe(buildSkillAppDetails());
  });
});

describe('openui skill（索引 + references 渐进披露，2026-10-19 拆分）', () => {
  const skillPath = join(projectPath(), 'plugins', 'mobi', 'skills', 'openui');
  const skill = readFileSync(join(skillPath, 'SKILL.md'), 'utf8');
  const examples = readFileSync(join(skillPath, 'references', 'examples.md'), 'utf8');
  const signatures = readFileSync(join(skillPath, 'references', 'signatures.md'), 'utf8');
  const appDetails = readFileSync(join(skillPath, 'references', 'app-details.md'), 'utf8');

  it('frontmatter：name=openui + description 覆盖复杂组件触发词', () => {
    // frontmatter 必须在文件首行：前面有任何注释 CC 都不解析（2026-10-19 实锤 Unknown skill）
    expect(skill.startsWith('---\nname: openui\n')).toBe(true);
    expect(skill).toMatch(/description: openui-lang deep reference/);
    expect(skill).toMatch(/charts/);
    // 票 04：新增能力面进触发词（Svg 图元 / 沙箱 HtmlView）
    expect(skill).toMatch(/SVG drawings \(Svg shapes\)/);
    expect(skill).toMatch(/sandboxed HtmlView pages/);
    // 票 04：Map 能力面进触发词（高德三档渲染）
    expect(skill).toMatch(/geographic maps \(Map with AMap\)/);
    // 富混排页面（行程/指南/报告）同样要求先加载 skill
    expect(skill).toMatch(/rich composed pages \(travel itineraries, guides, multi-section reports\)/);
  });

  it('SKILL.md 是索引不是全量：体积 ≤8K + 三 references 各有指路行', () => {
    // 渐进披露：加载成本从「一律 54K」降到「索引 + 按需 1 个 reference」
    expect(skill.length).toBeLessThanOrEqual(8_000);
    for (const ref of ['references/examples.md', 'references/signatures.md', 'references/app-details.md']) {
      expect(skill).toContain(ref);
    }
    // 名录已在 system prompt 常驻——skill 里不再放组件名录（避免双源漂移）
    expect(skill).not.toMatch(/^Carousel — /m);
  });

  it('规则全文在 SKILL.md（判据缺位防护：skill 单独被读时三层判据仍在）', () => {
    expect((skill.match(/Form routing:/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(skill).toMatch(/Composed pages/);
    expect(skill).toMatch(/Action-state convention/);
  });

  it('富混排页面示例在 references/examples.md：标题 + 编号 Map + 逐项 Card 的可照抄骨架', () => {
    expect(examples).toContain('Composed page example (itinerary');
    expect(examples).toMatch(/Map\("122\.4194,37\.7749", 12, \[\{"position": "122\.4194,37\.7749", "label": "1"\}/);
    expect(examples).toMatch(/stop1 = Card\(\[TextContent\("\*\*9:00 · Ferry Building\*\*"\)/);
  });

  it('全量签名兜底在 references/signatures.md（六类函数 + 低频组件 + 自定义组件）', () => {
    expect(signatures).toContain('## Built-in Functions');
    for (const fn of ['@Append(', '@Range(', '@Allocate(', '@Split(', '@Histogram(', '@Stats(']) {
      expect(signatures).toContain(fn);
    }
    for (const c of ['LineChart(labels:', 'Carousel(children:', 'DatePicker(', 'Modal(title:', 'EditableTable(', 'OverviewCardBlock(', 'Accordion(', 'Tabs(']) {
      expect(signatures).toContain(c);
    }
    // 票 03/04：自定义组件（Chart / Svg 图元 / HtmlView / Map）随 references 分发
    for (const c of ['Chart(type:', 'Svg(children:', 'Circle(', 'Rect(', 'Path(', 'G(children:', 'SvgText(', 'HtmlView(html:', 'Map(center?:']) {
      expect(signatures).toContain(c);
    }
    // demo 的 MapView 不移植（地图走 @mobi/shared 的 Map 签名 + 高德实现）
    expect(signatures).not.toContain('MapView(');
    // 指路：少量签名优先走工具
    expect(signatures).toMatch(/prefer the `openui_components` tool/);
  });

  it('mode=app 细则全文在 references/app-details.md（--mobi-* 调色板 + MobiApp.issueNewTurn）', () => {
    expect(appDetails).toMatch(/--mobi-\*` CSS variable palette/);
    expect(appDetails).toContain('var(--mobi-bg)');
    expect(appDetails).toContain('window.MobiApp.issueNewTurn(text)');
    expect(appDetails).toMatch(/ONLY from explicit user actions/i);
  });

  it('references 教学的 --mobi-* 变量 ⊆ shared 词表（教学虚构变量会让模型照抄产出坏 app）', () => {
    const taught = new Set(
      [...appDetails.matchAll(/--mobi-[a-z-]+/g), ...skill.matchAll(/--mobi-[a-z-]+/g)].map((m) => m[0]),
    );
    const known = new Set(MOBI_THEME_VAR_LIST);
    const invented = [...taught].filter((v) => !known.has(v));
    expect(invented).toEqual([]);
  });
});
