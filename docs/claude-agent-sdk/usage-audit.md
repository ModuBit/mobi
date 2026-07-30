# Mobi 的 Claude Agent SDK 能力使用审计

> 本文是 **mobi 自有的原创分析**（非上游文档副本），对照 [docs/claude-agent-sdk/README.md](./README.md) 索引的官方能力，盘点 mobi 实际用了什么、用得不合理之处、以及可用但暂未用、能提升 mobi 的能力。
>
> 基线：`@anthropic-ai/claude-agent-sdk@0.3.218`（cli 包）。代码位置以 `packages/cli/src/claude/` 为主。
> 编写日期：2026-07-29。SDK 迭代很快，落地前请按 README 索引拉最新官方文档复核 API。

---

## 一、mobi 当前使用的 SDK 能力（清单）

### 1. 核心调用：`query()` + `startup()` 暖启动 + 流式输入

| 能力 | 代码位置 | 说明 |
|---|---|---|
| `query({ prompt, options })` | `claudeRemote.ts:744` | 主入口，prompt 为 `PushableAsyncIterable<SDKUserMessage>`（流式输入模式） |
| `startup({ options })` → `warmRef.query(messages)` | `claudeRemote.ts:647,734` | 预热子进程，与「等待用户首条消息」并行，首条就绪后复用暖进程 |
| 双循环（`sdkOutputLoop` + `userInputLoop`） | `claudeRemote.ts:281,410` | 输出拉取与输入推送解耦，`AbortController` 协调终止 |

### 2. `Options` 字段（构造 query 时传入）

`claudeRemote.ts:604-644` 的 `sdkOptions`：

| Option | 值 | 用途 |
|---|---|---|
| `cwd` | 工作目录 | 会话工作区 |
| `includePartialMessages` | `true` | 开启 partial 流式拆分（见 §4） |
| `agentProgressSummaries` | `true` | subagent 每 ~30s 产出 summary，web 已渲染（`normalizeAgent.ts:354` task_progress） |
| `resume` / `sessionId` | 动态 | `--resume` 复用 / 预生成 UUID 让 metadata 立即可用 |
| `mcpServers` | `{ mobi: http }` | 注入 mobi 自有 MCP server（`mcp__mobi__*`） |
| `permissionMode` / `model` / `effort` / `fallbackModel` | 动态 | 会话级配置 |
| `systemPrompt` | `preset: claude_code` + append，或 custom | 默认走 claude_code preset + mobi 追加 prompt；用户设 customSystemPrompt 时改为纯字符串 |
| `allowedTools` / `disallowedTools` | 动态 | 工具白/黑名单（mobi MCP 工具常驻 allowed） |
| `canUseTool` | `permissionHandler.handleToolCall` | 权限审批入口（见 §5） |
| `pathToClaudeCodeExecutable` | dev=undefined / 编译=具体路径 | claude 二进制 resolve（`sdk/claudeExecutable.ts`） |
| `settings` | hook settings 文件路径 | 注入 SessionStart hook 配置（见 §6） |
| `env` | `{ ...process.env, ...featureEnv }` | 整体替换子进程 env（含 `DISABLE_AUTOUPDATER=1`、agent teams 开关等） |
| `additionalDirectories` | `[cwd/.mobi]` | 额外可访问目录 |
| `toolConfig` | `{ askUserQuestion: { previewFormat: 'markdown' } }` | askUserQuestion 预览格式 |

### 3. `Query` 运行时控制方法（`queryControlRef`）

`runClaude.ts:232-245` 通过 `queryControlRef` 在会话运行中动态切换：

- `setPermissionMode(mode)` — 切换权限模式
- `setModel(model)` — 切换模型
- `applyFlagSettings({ effortLevel })` — 切换 effort（effort 不在构造选项里，只能走 flag settings）
- `interrupt()` — 中断当前执行（`claudeRemoteLauncher.ts:93`）

### 4. `includePartialMessages` + 自研 `AssistantPartialAssembler`

SDK 把同一条 Anthropic message 的多个 content block 拆成多条 partial emit（共享 `message.id`）。mobi 在 `claudeRemote.ts:315` 用 `AssistantPartialAssembler` 把同 `message.id` 的 partial 装配回一条完整消息再下发，保证 snapshot 与 full 1:1 对应、前端 `parentUuid` 清理不漂移。`streamSnapshotSender` 负责实时累积 delta 生成流式快照。

> 历史：SDK 0.3.204→0.3.211 拆分语义变化曾导致 thinking 刷新丢失，详见 memory `project_sdk-partial-assembler`。

### 5. 权限审批 `canUseTool`（`permissionHandler.ts`）

- 接收 SDK 的 `suggestions`（放行建议）、`toolUseID`、`SDKUIHints`（含 agent 信息）
- 处理 `askUserQuestion` / `request_user_input` / `exit_plan_mode` 特殊工具
- 通过 `updatedPermissions` + `decisionClassification`（`user_permanent` / `user_temporary` / `user_reject`）回传 SDK
- 从 `task_started` 系统消息提取 agent 信息（`agentInfoMap`）

### 6. SessionStart Hook（`startHookServer.ts` + `generateHookSettings.ts`）

mobi 写一个临时 settings.json，配置 `SessionStart` hook 执行 `mobi hook-forwarder`，后者把 hook 数据 POST 到 mobi 本地 HTTP server，用于**捕获 session_id 变化**（新建/resume/fork）。`runClaude.ts:117-130`。

### 7. 元数据提取 `initializationResult()`（`metadataExtractor.ts`）

用空 `AsyncIterable` 启动 query，子进程完成初始化后调 `initializationResult()` 拿 commands/agents/models/account/output styles/fast mode，零 token 消耗，拿到即 close。

### 8. 其他

- **steer**：mobi 自研，把文本 push 进自己的 `PushableAsyncIterable`（`claudeRemote.ts:716`），非 SDK 公开 API
- **特殊命令**：`/clear`（重置 session）、`/compact`（透传 SDK）、`!bash`（本地沙箱执行，生成 tool_use/tool_result 对，不经 SDK）
- **!bash 沙箱**：自研 `sandboxManager`（`wrapCommand` / `spawnWithTimeout`），**未用** SDK 的 `sandbox` option
- **成本读取**：仅终端展示 `result.total_cost_usd` / `num_turns` / `duration_ms`（`messageFormatterInk.ts:119-142`）

---

## 二、使用不合理 / 可改进之处

### 🔧 P1 — SessionStart Hook 链路：理解、不可删、但有未用的价值

> **修正说明**：初版审计曾误判此链路「与 `system/init` 重复、可简化」，那是只看 remote 路径的错判。核实 local 模式后推翻——hook 是 local 模式 session_id 的**唯一来源**，不可删。下文为修正版。

**现状**：mobi 维护一整套 hook 链路——写临时 settings.json → 配置 SessionStart hook 执行子进程 `mobi hook-forwarder` → 启动本地 HTTP server（`/hook/session-start`）接收 → 转发回 `runClaude.ts:117-130` 的 `onSessionHook`。

**关键事实：两种模式，session_id 获取路径完全不同**

| | remote 模式 (`claudeRemote`) | local 模式 (`claudeLocal`) |
|---|---|---|
| claude 怎么跑 | SDK `query()`，有消息流 | 直接 spawn `claude` TUI 子进程，**无消息流** |
| `system/init` 消息 | ✅ 有，带 session_id | ❌ **没有** |
| session_id 来源 | pregenerate + `system/init` + hook | **只有 hook**（+ scanner 被动接收） |

`claudeLocal.ts:53` 注释明确：fresh 启动时「让 Claude 创建新 session ID，**通过 SessionStart hook 报告**」。local 模式下没有 SDK 消息流，hook 是 session_id 的**唯一可靠来源**，驱动 `scanner.onNewSession` 切换 `.jsonl`、metadata 上报、converter 更新。**删掉 = local 模式直接失能。**

**hook 链路「背后做的事」分两层**

- **层 1 · 当前刚需**：① local 模式 session_id 唯一来源；② remote 模式早送达（`system/init` 后还有 `awaitFileExist` 等 .jsonl 落盘延迟，见 `claudeRemote.ts:357-363`，hook 在此之前到）；③ 统一两种模式的 session_id 获取机制。
- **层 2 · 预留未用**：`SessionHookData`（`startHookServer.ts:31-39`）定义了 `transcript_path`、`source`、`hook_event_name`，但 handler 只取 `session_id`，**其余字段全丢**。这套 HTTP 基建（server + token + forwarder + settings）是通用 hook 总线，目前只挂了 `SessionStart` 一个事件、一个端点——设计预留了扩展。

**真正的改进空间（三件，非删除）**

1. **用 `source` 字段做分支**（低风险高价值）：claude 已传入 `source: new | resume | fork | compact | sidechain` 却没读。可 fork 时通知 web「会话已分叉」、resume vs new 区分首屏。纯增量。
2. **用 `transcript_path` 替代 `getProjectPath(cwd)` 拼路径**（准确性）：现 scanner/converter 靠 `getProjectPath` 推断 `.jsonl` 位置（`claudeRemote.ts:359`），hook 已直接给 `transcript_path`，用它更准。
3. **remote 模式可评估改用 SDK 进程内 `Options.hooks` 回调**（仅 remote）：可省掉 forwarder 子进程 + HTTP 往返 + 临时 settings 文件。但 **local 模式无 SDK，HTTP 链路必须保留**，代价是两模式分叉、违背「统一机制」。倾向不动——统一机制的可维护性 > remote 省的那点开销。

**结论**：hook 链路不是「过重可删」，是 local 模式的刚需基建。改进方向是**用上预留字段**，而非简化链路本身。

### 🔧 P2 — 权限持久化「双轨」是 SDK 行为不稳定的补丁

**现状**：`permissionHandler.ts:153-187` 注释明确——SDK 的 `updatedPermissions` 经 E2E 验证**不跨 turn 持久**，mobi 不得不自维护 `allowedTools` / `allowedBashLiterals` / `allowedBashPrefixes` 三个 Set 兜底，同时仍把 `updatedPermissions` 透传给 SDK「双轨」。

**建议**：这不是 mobi 的错，是 SDK 未兑现 session 级放行承诺。但每次升 SDK（见 `/upgrade-deps` 第八步）都应重验该承诺是否被兑现——一旦兑现，整套 Set 兜底 + `parseBashPermission` 可删，权限代码会清爽很多。在 `docs/pending.md` 记一条「SDK 放行持久化追踪」。

### 🔧 P3 — `settings` 字段被挪用为 hook 配置投递通道

**现状**：`Options.settings` 本是「flag 层设置」（最高优先级用户设置），mobi 拿来传一个只含 `SessionStart` hook 的临时 JSON 路径（`claudeRemote.ts:636`）。

**问题**：语义错位——hook 注册不是「设置」。若未来 mobi 想真正用 flag settings 覆盖模型/权限，会与 hook 投递冲突（同一字段）。

**建议**：SDK 提供 `Options.hooks` 回调式 hook（见 §三-P3）。但注意 §二-P1 的修正——**local 模式无 SDK，HTTP+settings 链路是刚需**，回调式 hook 只能用于 remote 模式；若采用会让两模式分叉，需权衡统一性。短期更稳的做法：保留 settings 投递，但在 settings 文件里同时承载真正的 flag 设置（避免将来冲突），而非急着切换通道。

### 🔧 P4 — custom system prompt 丢失 preset 与缓存

**现状**：用户设 `customSystemPrompt` 时，mobi 用纯字符串覆盖 systemPrompt（`claudeRemote.ts:620`），丢掉了 `claude_code` 默认 prompt 与跨会话 prompt 缓存。

**建议**：评估改用 `systemPrompt` 数组形式 + `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记，前缀保留可缓存部分；或至少文档化「设 custom prompt 会丢失默认行为」的取舍。

### 🔧 P5 — SDK 崩溃错误被 debug 级吞掉（日志文件空白）

**现状**（已重新核实）：审计初稿曾建议接管 `Options.stderr` 回调，但事实链表明那不是根因——

- SDK 子进程崩溃时，错误对象 `e.message` **已自带 stderr 尾部**（SDK 源码 `getProcessExitError` 构造 `Error("Claude Code process exited with code ${e}${formatStderrTail()}")`，实证）。
- Web 用户也已能看到：`claudeRemoteLauncher.ts` 的终态 catch 把 `e.message`（含 stderr）作为「Process exited unexpectedly: ...」推给前端。

**真正的 gap 是日志文件空白**：错误链被两处 `logger.debug` 吞掉——`claudeRemote.ts` 内层 catch 与 `claudeRemoteLauncher.ts` 终态 catch 都记在 debug 级。而 `logger.debug` 在生产模式（无 `DEBUG` env）**只进 ringBuffer、不落盘**；再加上错误在终态 catch 被优雅捕获（置 `exitReason='exit'`、不 re-throw）→ 进程不崩 → ringBuffer 永不 dump → 日志文件里没有任何线索。事后从日志排查时一片空白。

**修复**：终态 catch（`claudeRemoteLauncher.ts`）从 `logger.debug` 提到 `logger.error`——始终落盘 + console 可见。子进程崩溃是低频严重事件，值得 error 级。内层 catch 保持 debug，避免与终态双写。`stderr` 回调不必加：致命 stderr 已在错误里，非致命警告价值低且级别难选（debug 不落盘 / warn 刷 console）。

### 🔧 P6 — `!bash` 双路径（已演进为「本地执行 + 输出注入 context」）

**原状**：`!bash` 走 mobi 自研沙箱执行（生成合成消息对），模型完全不参与；agent 自己调的 `Bash` 工具走 SDK。两条 bash 路径，权限/沙箱/超时语义不一致。

**关键认知**：Claude CLI 的 `!command` 同样是「CLI 本地执行 + 输出加入 context + 模型事后可选响应」（SDK settings 的 `respondToBashCommands`/`defaultShell` 仅存在于 Zod schema、无 query() 执行逻辑——`!` 是 TUI 输入层特性，编程式 query() 不识别）。直接把 `!cmd` 当普通 user 消息发 SDK，模型只会「理解」这段文本，不会直接执行。

**已落地**（settings.json `bashInjectContext`，默认开）：保留本地沙箱执行 + UI 合成工具对（即时、不耗 token、可见命令与输出），额外把「命令+输出」作为**隐藏 user 消息**注入 SDK input stream——模型据此感知并可顺势响应。注入文本对齐 Claude CLI `processBashCommand` 的原生标签格式（`bash-input` / `bash-stdout` / `bash-stderr`，stdout/stderr 分离同行、XML 转义；CLI 的 `local-command-caveat`「DO NOT respond」是配合 `shouldQuery:false` 用的，mobi 走 A 路〔注入即响应〕故改用一句「已执行、无需重复执行」框定防重跑，不加该 caveat）。注入消息不调 onMessage、SDK 也不回放 host 推入的 user 文本（源码实证仅 stdin 写入），故 UI 不回显。`messages` + sink 创建已提到首条消息处理之前，故首条即 `!cmd` 也能注入（与中途一致，不退化）。开关关则退回纯本地、模型不参与（首条即 `!cmd` 时不启动 query）。

**残留双路径**：模型自发的 `Bash` 工具调用仍走 SDK（带权限/超时语义），与 `!` 的本地沙箱路径并存。这是 `!command`「即时/省 token」UX 的刻意取舍，文档化即可。

---

## 三、可用但暂未使用、能提升 mobi 的能力（按价值排序）

### ⛔ P1（已弃用）— `getContextUsage()`：上下文用量仪表盘

> **已弃用（2026-07-30）**：实测 `getContextUsage()` 在 claude 子进程内会触发大量 `count_tokens` API + 失败时的 Haiku `messages.create` 兜底（见 clawd-code `analyzeContextUsage` → `countTokensWithFallback`），mobi 原把它接到每条消息事件上自动跑，直接撑爆 provider 请求频率限制（连发必 429）。已**彻底移除**：仪表盘改由 `result.modelUsage[model].contextWindow`（窗口大小）+ 最后一条 assistant 的 `input+cache_creation+cache_read`（当前占用）派生，零额外 API。失去的分类细分（system/tools/mcp/memory）不再提供。

SDK 提供 `Query.getContextUsage()` 返回上下文窗口按类别（system prompt / tools / messages / MCP tools / memory）的 token 占用与总量。

**价值**：长会话场景下，用户无从感知「还剩多少上下文」「该不该 /compact」。web 加一个上下文用量条，直接对应 mobi 已有的 /compact 能力，闭环极强。
**成本**：低。一个 RPC + 一个进度条组件。

### 🚀 P1 — `enableFileCheckpointing` + `rewindFiles()`：文件回滚

开启后 `Query.rewindFiles(userMessageId)` 可把 tracked 文件回滚到某条用户消息时的状态（支持 dryRun 预览）。

**价值**：远程让 agent 改了一堆文件后，用户想「回到改之前」目前只能手动 git。提供「回滚到此消息」的 UI 是差异化能力。
**成本**：中。需开启 checkpointing（有磁盘开销）、web 交互、与现有 git 流程区分定位。

### 🚀 P2 — `promptSuggestions`：下一轮建议 chip

开启后每轮 result 后 emit 一条 `prompt_suggestion`，复用 prompt cache 几乎免费。

**价值**：web 输入框上方加 suggestion chip，降低远程使用门槛。
**成本**：低。需在 `sdkOutputLoop` 处理新消息类型 + web 渲染。

### 🚀 P2 — 成本/用量上墙（`usage_EXPERIMENTAL` 或 result 字段）

mobi 已在终端读 `result.total_cost_usd` 等，但 web 不展示会话累计成本/token。

**价值**：远程会话成本透明（尤其按量付费场景）。
**成本**：低。CLI 端聚合各 turn 的 cost 上报 hub，web 加面板。注意 `usage_*` 标注 EXPERIMENTAL 不稳定，可先只用 result 字段累加。

### 🚀 P2 — `betas: 'context-1m-2025-08-07'`：1M 上下文

Sonnet 4/4.5 支持 1M 上下文窗口（beta）。

**价值**：超长会话/大代码库场景。可作为「长上下文」开关暴露给用户。
**成本**：低（一行 option），但需确认计费/模型支持，且与 /compact 取舍。

### 🚀 P3 — `forwardSubagentText`：subagent 完整 transcript

默认只转发 subagent 的 tool_use/tool_result。开启后文本与 thinking 也以 `parent_tool_use_id` 转发，可渲染嵌套对话。

**价值**：mobi 有 TeamAgentPanel / 后台任务面板，但 subagent「说了什么」看不到，只能看工具调用。开启后可展示 subagent 思路。
**成本**：中。消息量上升，web 需嵌套渲染。注意 memory 记载「Agent Teams 不可达」——subagent 仍存在（Task/Agent 工具），但团队面板受限，先确认目标场景。

### 🚀 P3 — TodoWrite 状态上墙（功能缺口）

**现状**：SDK 内置 TodoWrite 工具（mobi 改名为「Update Tasks」），shared 有 `TodosSchema`、hub 有 `todos.ts`、web 有 `TodoPanel.tsx`——但 **CLI 端从未从 SDK 提取 todo 状态上报**（grep 仅 `getToolName.ts` 一处重命名）。

**价值**：web 的 TodoPanel 形同虚设。补齐 CLI 端的 todo 提取（从 TodoWrite 工具调用或 SDK todo 系统消息）→ runtimeState.todos → hub → web，让任务清单真正可见。
**成本**：中。需确认 SDK 暴露 todo 状态的通道（工具入参解析 or 专用系统消息）。

### 🚀 P3 — `Options.hooks` 回调式 hook（替代 settings 投递）

SDK 支持 `hooks: { PreToolUse, PostToolUse, Stop, ... }` 回调，`includeHookEvents: true` 可把 hook 生命周期事件 emit 进流。

**价值**：① 用回调式 hook 替代 §二-P3 的 settings 挪用；② `includeHookEvents` 可在 web 展示 hook 活动（PreToolUse 拦截等），增强可观测性。
**成本**：低-中。

### 🚀 P3 — `onElicitation` / `onUserDialog`：补齐对话式交互

- `onElicitation`：MCP server 的 elicitation 请求（表单/URL auth），未处理时 SDK 自动 decline。
- `onUserDialog` + `supportedDialogKinds`：CLI 的阻塞式对话框（如 `refusal_fallback_prompt`），未声明则降级为经典 refusal 错误结束 turn。

**价值**：MCP elicitation 当前静默失败，用户无感；refusal 对话框未接则体验是「直接报错」。补齐可改善边界 UX。
**成本**：中。需 web 端新增对话框/表单渲染。

### 🚀 P4 — `skills` / `reloadSkills()` / `supportedCommands()`：技能运行时管控

mobi 仅启动时一次性提取 metadata。SDK 支持运行时 `skills: string[]` 过滤、`reloadSkills()` 热加载、`supportedCommands()` 查询。

**价值**：web 暴露「启用/禁用技能」「修改技能后热重载」。
**成本**：中。

### 🚀 P4 — `forkSession` / `forkSession()`：会话分叉

从某点分叉出新 session（可带自定义 title）。

**价值**：「在当前对话基础上试两条路」的分支能力。
**成本**：中。需 web 分叉 UI + 与现有 session 树整合。

### 🚀 P4 — `sandbox` option：用 SDK 沙箱隔离 agent 的 Bash

mobi 自研沙箱只管 `!bash`，agent 自己调的 Bash 不经沙箱。SDK 的 `sandbox` option（`autoAllowBashIfSandboxed` 等）可给 agent Bash 加隔离层。

**价值**：远程让 agent 跑命令时的安全兜底。
**成本**：中。需与 mobi 现有权限流程整合，注意 `failIfUnavailable` 默认 true 会因缺依赖直接退出。

### 🚀 P5 — 其他低优先

| 能力 | 价值 |
|---|---|
| `maxTurns` / `maxBudgetUsd` | 会话级护栏，防失控 |
| `taskBudget`（alpha） | token 预算节奏控制 |
| `toolAliases` | 把内置工具名重定向到 MCP（如 Bash→远程沙箱 MCP） |
| `setMcpPermissionModeOverride` | 按 MCP server 收紧权限 |
| `reinitialize()` | 断连重连后重发 init、恢复阻塞请求（mobi 有 disconnect 处理，可评估） |
| `seedReadState` | snip/Edit 流程的 readState 补种 |
| `sessionStore`（alpha） | 外部存储镜像 transcript；mobi 已有自研持久化，意义不大 |
| `outputFormat` | 结构化输出，聊天场景 N/A |
| `plugins` | 本地插件加载，mobi 未暴露 |
| `excludeDynamicSections` | 跨用户 prompt 缓存优化，多租户场景才有意义 |

---

## 四、建议的落地优先级

| 优先级 | 项 | 理由 |
|---|---|---|
| **先做（低成本高收益）** | 崩溃错误提级落盘（§二-P5，已修）、`getContextUsage()`（§三-P1）、`promptSuggestions`（§三-P2）、成本上墙（§三-P2） | 改动小、用户可感知、不碰核心流程 |
| **再做（中成本特色）** | TodoWrite 上墙（§三-P3）、`rewindFiles`（§三-P1）、`forwardSubagentText`（§三-P3） | 差异化能力，补齐已有但空转的 UI（TodoPanel） |
| **增量改进（低风险）** | SessionStart hook 用上 `source`/`transcript_path` 字段（§二-P1） | hook 是 local 模式刚需不可删，但预留字段当前全丢，纯增量价值高 |
| **追踪 SDK（随升级兑现）** | 权限双轨清理（§二-P2） | 依赖 SDK 兑现承诺，挂入 `/upgrade-deps` 第八步 |
| **按需** | 1M 上下文、sandbox、fork、skills 管控、elicitation/dialog | 视产品方向选型 |

---

## 五、核实清单（落地前必做）

本文基于 SDK 0.3.218 类型定义 + mobi 代码静态分析。落地任一项前：

1. 按 [README.md](./README.md) 索引拉对应官方文档最新版（partial / hooks / sessions / streaming / permissions / checkpointing / cost-tracking / observability），复核 API 签名与默认值。
2. 涉及运行时行为变化的（partial、hooks、权限、resume），按 `/run-tests` E2E 走真实会话验证。
3. 涉及 alpha/EXPERIMENTAL 标记的（`sessionStore`、`taskBudget`、`usage_EXPERIMENTAL`），评估稳定性后再决定是否依赖。
