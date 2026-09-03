---
name: upgrade-deps
description: 全面升级项目依赖到最新版本。当用户提到"升级依赖"、"升级包"、"update dependencies"、"upgrade packages"、"全面升级"、"依赖更新"时使用此 skill。也适用于用户想检查哪些包过时、批量更新 package.json 的场景。即使用户只说"升级一下包"这种模糊表述，也应触发此 skill。
---

# 依赖全面升级

在 monorepo 中系统性地将所有 package.json 的依赖升级到 npm 上的最新版本，同时确保兼容性。

## 为什么需要这个 skill

手动逐个检查和升级依赖容易遗漏，且难以评估风险。这个 skill 建立了一套可重复的流程：查询 → 分类 → 分步升级 → 验证，确保每次升级都有据可查、风险可控。

## 流程

### 第一步：收集所有依赖

读取所有 package.json，收集去重后的依赖清单（跳过 `workspace:*`）：

```bash
# 包含的位置
- package.json（根）
- packages/*/package.json（子包）
```

对每个包记录：包名、当前版本约束、所在位置（哪个 package.json 的 dependencies/devDependencies）。

### 第二步：从 npm 查询最新版本

**必须从 npm 实时查询，禁止依赖训练数据或本地猜测。** 使用 `npm view <pkg> version` 获取每个包的最新版本。可以分批并发查询以提高效率。

### 第三步：对比分类

将所有包按升级风险分为三档：

| 风险等级 | 判断标准 | 示例 |
|---|---|---|
| 🟢 低风险 (patch) | 主版本号和次版本号不变，仅修订号变化 | 1.2.3 → 1.2.5 |
| 🟡 中等风险 (minor) | 主版本号不变，次版本号变化 | 1.2.x → 1.3.0 |
| 🔴 高风险 (major/0.x) | 主版本号变化，或 0.x.y 的次版本号变化 | 0.2.x → 0.3.x, 1.x → 2.x |

注意：对于 `0.x.y` 版本，semver 约定中次版本号变化视为 breaking change。

> ⚠️ **`@anthropic-ai/*` 包例外**：它们是 mobi 协议层核心，**无论升几级（哪怕 patch）都必须额外执行第八步的 changelog 检查与回归**——SDK 的运行时行为变化（流式拆分、hooks、工具协议）版本号反映不了。

向用户展示分类结果表格，包含：包名、当前版本、最新版本、风险等级、所在位置。同时列出已是最新无需更新的包。

### 第四步：分步升级

**建议分两步走，征求用户确认后执行：**

1. **第一步**：升级所有 🟢 低风险 + 🟡 中等风险 的包
2. **第二步**：单独处理 🔴 高风险的包（查阅 changelog、分析 breaking changes）

#### 升级操作

- 使用 Edit 工具直接修改各 package.json 中的版本号
- 保留 `^` 前缀（如 `^1.2.3` → `^1.3.0`）
- 对于固定版本（无 `^` 前缀），查询最新版后保持固定风格
- 对于特殊约束（如 `>=25`），规范化为标准 semver 约束（如 `^25.9.0`）

#### 安装验证

```bash
bun install    # 更新 lockfile
bun run typecheck  # 类型检查
bun run test       # 全量单测
bun run lint       # ESLint 检查
```

### 第五步：处理高风险升级的兼容性问题

对于 🔴 高风险包，需要额外检查：

1. **对比 peerDependencies**：新版本是否新增或提升了 peer 依赖？
2. **对比 exports**：导出接口是否有变化？
3. **处理类型变更**：如果升级导致类型不兼容，需要同步修改项目代码
4. **新增依赖**：如果新版本将内嵌依赖提升为 peerDependency，需要在 package.json 中显式添加

### 第六步：最终确认

- 运行 `bun outdated` 确认无遗漏
- 展示最终升级汇总：更新数量、各验证项结果
- 提交代码

### 第七步：维护 patchedDependencies（移除 / 迁移 / 重做）

项目可能用 `bun patch` 给第三方包打补丁（见 `patches/` 目录 + `package.json` 的 `patchedDependencies`）。这些补丁通常是上游 bug 的临时修复。上游发新版时，补丁有三种去向：上游修了→**移除**；上游没修但有新版→**迁移**到新版本重做补丁；上游动了相邻代码导致 context 失败→同样要**重做**补丁（可能改动位置已变）。目的：不长期自维护陈旧补丁、不错过上游其他修复。

**每次升级依赖时必须检查**（即使本次没升 patched 包）：

1. 读取 `package.json` 的 `patchedDependencies`（key 格式 `<pkg>@<version>`，如 `@socket.io/bun-engine@0.1.1`）+ 列出 `patches/` 目录
2. 对每个 patched 包，`npm view <pkg> version` 查最新版本
3. **最新版 == patch 绑定版本**（无新版）：补丁继续生效，无需处理，跳过
4. **最新版 > patch 绑定版本**（有新版）：必须评估补丁去向，分三种情况
   - 先查 changelog / release notes / commit：补丁针对的 bug 是否已在上游修复
   - **(a) bug 已修复**：移除补丁（删 `patches/<pkg>.patch` + 删 `package.json` 的 `patchedDependencies` 条目）+ 升级该包到最新 + 跑 typecheck/test/E2E 验证原 bug 场景不再复现
   - **(b) bug 未修复**：补丁仍需要，但**必须重新生成补丁**应用到新版本（`bun patch <pkg>@<新版本>` → 重做改动 → `bun patch --commit`）+ 删旧 patch 文件
   - **(c) bug 未修复，且 `bun install` 因补丁应用失败而报错**：上游动了被 patch 那段代码（重构/相邻行变更），补丁 diff context 对不上。这是 (b) 的信号——同样要重新生成补丁，但需先理解上游新代码结构再决定等价改动落在哪一行（可能改动位置已变）。**绝不能为了"让补丁应用成功"而硬调 context 行号掩盖改动语义变化**
5. 向用户汇报每个补丁的状态：(a) 已移除 / (b) 已迁移到新版本 / 仍不可移除（上游未修，补丁重做）

**关键安全点**：`bun patch`（与 patch-package）应用时**校验 diff context**。上游若改了被 patch 的那段代码，补丁会**应用失败报错**（而非静默打错位置），所以补丁陈旧最坏导致 `bun install` 失败，**不会**因补丁逻辑错位而线上出 bug——失败显式，逼你重做。反过来，若 `bun install` 静默成功了（补丁仍绑定旧版本、你没升该包），说明补丁没被挑战，但**不代表上游没改那段代码**——仍需主动查 changelog 确认 bug 状态。

**示例**（本项目）：`patches/@socket.io%2Fbun-engine@0.1.1.patch` 修复 bun-engine 发送二进制附件 bug（`Buffer.isBuffer`→`ArrayBuffer.isView`）。每次升级时若发现 `@socket.io/bun-engine` 有 0.1.2+，查其是否已修该 bug → 修复则移除补丁并升级。

### 第八步：anthropic/claude 包 changelog 检查、回归与机会挖掘

**触发条件**：本次升级涉及任何 `@anthropic-ai/*` 包（cli 当前依赖 `@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sandbox-runtime`、`@anthropic-ai/sdk`，**均 0.x，semver 上 minor 即 breaking**）。这类包是 mobi 的协议层核心，第三步的风险分级不足以反映真实风险——**版本号无论几级，只要动了 anthropic 包就必须做这一步**。

**为什么单独成步**：历史教训——SDK 0.3.204→0.3.211 升级时，`includePartialMessages` 的流式拆分语义变了（同一条 Anthropic message 的多个 content block 共享 uuid 被拆成多条 SDK 消息分别 emit），导致 mobi 的 thinking 流式可见但刷新后丢失、DB 不存。typecheck 和单测都没拦住——是运行时流式行为变化，只有 changelog + 定向回归能发现（详见 memory `project_sdk-partial-assembler`）。

#### 1. 拉两个 changelog，定位本次跨越的版本范围

| changelog | 反映什么 | 地址 |
|---|---|---|
| Claude Agent SDK | TS SDK 的 API、query options、hooks、partial、导出接口——**直接影响 cli 代码** | `https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/refs/heads/main/CHANGELOG.md` |
| Claude Code | SDK 内嵌 claude 二进制的行为——工具协议、plan 模式、工具调度、提示词、MCP——**影响 mobi 运行时行为预期** | `https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md` |

fetch 下来，按**本次升级跨越的版本范围**筛条目。SDK changelog 按 SDK 版本号；Claude Code changelog 按 claude 二进制版本号（从 SDK 平台子包 manifest 或 `claude --version` 取）。fetch 不通就 download 到磁盘看。

#### 2. 对照 mobi 的 SDK 使用面，逐条评估影响

changelog 里涉及下表方向的变化必须重点评估（代码定位 → 读代码 → 对照 changelog → 必要时查官方文档）：

| SDK 使用面 | mobi 代码位置 | changelog 关注点 |
|---|---|---|
| `includePartialMessages` + assistant partial 装配 | `packages/cli/src/claude/claudeRemote.ts`（query options）、`packages/cli/src/claude/utils/assistantPartialAssembler.ts` | partial 拆分语义、`message.id` 共享、block 累积 / flush 边界 |
| claude 二进制 resolve（dev + 编译态） | `packages/cli/src/claude/sdk/claudeExecutable.ts` | `pathToClaudeCodeExecutable`、平台子包结构、manifest、`extractFromBunfs` |
| 工具协议注入与调度 | SDK 注入（plan 模式 / Write / Bash …） | 工具行为、入参/返回 schema、plan 模式流程 |
| SDK hooks 回调 | `packages/cli/src/claude/utils/sessionHookForwarder.ts`、`startHookServer.ts` | hooks 回调签名、可用事件、输入数据结构 |
| 权限审批 | `packages/cli/src/claude/utils/permissionHandler.ts` | `canUseTool` / 权限回调契约 |
| session resume | `packages/cli/src/claude/session.ts` | resume 语义、消息重放格式 |
| MCP / system prompt | `utils/mcpConfig.ts`、`utils/systemPrompt.ts` | MCP 配置契约、prompt 注入点 |
| 环境变量 / 配置 | env-vars（见配置文档） | 新增 / 废弃 / 默认值变化的 env |

> 查具体 API 细节：按 `docs/claude-agent-sdk/README.md` 索引找到对应官方文档（partial / hooks / sessions / streaming / permissions / env-vars 等）fetch 最新版对照，**不要凭训练数据猜 SDK 行为**。

#### 3. 风险定级与回归验证

对每条"可能影响"：

- **定位 mobi 受影响代码** → 读代码判断是否仍兼容
- **typecheck / test 拦不住的运行时行为**（partial 装配、流式、hooks、权限、resume）→ 必须用 `/run-tests` 的 E2E 走真实会话流程验证（见 `.claude/skills/run-tests/references/e2e.md`，先读其 `memory/MEMORY.md`）
- **历史坑优先重验**：partial 装配（thinking 刷新不丢 + DB 持久）、claude 二进制 resolve（dev + 编译模式）、hooks 回调数据完整——每次必过

#### 4. 机会挖掘：筛出对 mobi 有利的新功能

影响评估（第 2-3 小节）是**防御性**的——新版本会不会弄坏 mobi；机会挖掘是**进攻性**的——新版本能带给 mobi 什么。同一个 changelog 要过两遍筛子，缺后者会错失升级附带的免费产品机会。

**筛选范围**——changelog 里 host-facing 的新能力（mobi 作为 host 可消费的）：

- 新 query options（如 `perTaskStopAffordance`、`managedSettings.modelPricing`）
- 新 hooks 事件 / 回调输入数据（如 `PreModelSwitch`、SessionStart resume 新字段）
- 新消息 / 帧类型与字段（如 task 条目 `ambient` 标记、`user_message_uuid`、`modelUsage[*].costBasis`、result 新字段）
- 权限、subagent / background 任务、MCP、成本与 usage、resume / rewind 方向的新能力
- claude 二进制侧新用户可见行为——若 mobi 可以据此做 UI / 状态展示

**判断标准**——对照 mobi 产品定位（Claude Code 远程控制工具）与第 2 小节的功能面表，分三类：

- (a) **增强现有功能**：mobi 已有对应模块，新能力直接提升它（如任务面板用 `ambient` 过滤家务任务）
- (b) **填补已知短板**：对照 `docs/pending.md` 与历史坑，新能力恰好覆盖
- (c) **全新能力**：mobi 没有的功能，引入需产品决策——照常列出，标明"需决策"

**每条建议必须包含以下全部字段**（缺字段的建议不算产出）：

| 字段 | 说明 |
|---|---|
| 功能名 | changelog 里的能力名 |
| 出处 | SDK / claude 版本号 + 条目原文摘要 |
| 对 mobi 的价值 | 一句话：解决什么问题 / 增强什么 |
| 建议落地位置 | mobi 包 / 模块级（对照第 2 小节代码位置表） |
| 优先级 | 高 / 中 / 低（高 = 低成本高价值，或填补已知短板） |

**纪律**：

- **宁缺毋滥**：没有值得引入的就明确写「本次无可引入项」，禁止为了产出硬凑条目
- **只挖掘不实现**：本步骤产出建议，不写代码、不改配置
- **建议独立成章**：禁止把建议散落在影响评估的括号注记里——散落的建议等于没有建议

#### 5. 汇报

汇报必须包含四个部分：

1. 本次跨越的 changelog 条目摘要
2. 逐条影响评估（影响/不影响 + 理由 + 对应 mobi 代码）
3. 已执行的回归项及结果
4. **📌 新功能引入建议**（第 4 小节的产出，独立章节）：完整建议表；无可引入项时明确写「本次无可引入项」

任何不确定的运行时行为变化，E2E 验证通过后再提交。

**建议处置**：挖掘出的建议在汇报的「新功能引入建议」章节列出，由用户当场定夺；采纳的条目写入 `docs/pending.md` 立项（标注来源版本区间），不采纳的口头结论即可（历史台账 docs/upstream-suggestions.md 已于 2026-09-03 清理，首轮挖掘记录见 git 历史）。

## 版本约束规范

| 原约束 | 推荐写法 | 说明 |
|---|---|---|
| `>=25` | `^25.9.0` | `@types/node` 等应锁定到具体大版本 |
| `^1.2.3` | `^1.3.0` | 保持 `^` 前缀，仅更新版本号 |
| `1.2.3` (固定) | `1.2.3` | 保持固定风格，除非用户明确要求改为 `^` |

## 注意事项

- **先查事实再推理**：不要假设某个包的最新版本，必须从 npm 查询
- **workspace:* 跳过**：monorepo 内部依赖不需要升级
- **bun 运行时**：安装命令用 `bun install`，不是 npm
- **升级后必验证**：typecheck → test → lint 三步缺一不可
- **patchedDependencies 维护**：每次升级必须执行第七步，按上游新版情况处理补丁（移除/迁移/重做），不只是「移除」——上游没修但改了代码，补丁要跟着重做
- **anthropic/claude 包强制 changelog 检查**：升任何 `@anthropic-ai/*` 包必须执行第八步——拉 SDK + Claude Code 两个 changelog，对照 mobi SDK 使用面评估影响（防御）+ 挖掘可引入的新功能并产出建议表（进攻），typecheck 拦不住的运行时行为用 E2E 回归
- **提交规范**：commit message 使用 `chore:` 前缀，列出关键变更
