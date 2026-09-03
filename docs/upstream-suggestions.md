# 上游新功能引入建议

记录从 Anthropic 上游（Claude Agent SDK + 内嵌 claude 二进制）changelog 中挖掘出的、对 mobi 有价值的新能力建议。

**来源**：`/upgrade-deps` skill 第八步「机会挖掘」——每次升级 `@anthropic-ai/*` 包时对 changelog 做两遍筛子（防御：影响评估；进攻：本文件）。

**条目生命周期**：`待决策` → `已采纳`（进入 pending.md 立项或直接实施）/ `不采纳`（附理由）。已实施/已否决条目定期清理，历史见 git log。

**覆盖范围**（2026-08-31 建档）：SDK 0.3.178 → 0.3.251 / claude 2.1.178 → 2.1.251（对应 2026-07-08 ~ 08-31 的三次升级批次，机会挖掘此前未做，历史区间一次性回溯补齐；2.1.178~2.1.216 无官方 release notes，该段行为以 SDK changelog 实体条目为准）。

---

## 处理批次总览（2026-08-31 整理；同日 API 面对照后扩充）

按**落地链路**分组——同批条目动的是同一组文件/同一条数据链，一次设计语义、一次改完、一次回归。全部 30 条已收敛终态（✅ 已实施 14 条 / ❌ 不做或不适用 7 条 / ⏸️ 归 pending 或暂缓 9 条），条目详情见 git 历史（2026-09-03 清理）。

### 批次 A｜停止 × 队列语义闭环 ✅ 已完成（2026-08-31）

**目标**：把「停止按钮 × 排队消息」的语义一次设计完整——停止哪些、留哪些、队列状态如何呈现。

- **U-2** `perTaskStopAffordance`（高）——「停止本轮」与「终止一切」分化（配套 `Query.stopTask()` 逐任务停止）✅
- **U-11** `cancel_queued` + `still_queued` 回执（高）——「停止并清空队列」+ 停止后队列对账 ✅
- **U-13** `command_lifecycle` + `terminal_reason`（中）——每条消息的真实终态渲染 ✅（含 **U-8** `refused` 终态，自批次 D 提前）
- **U-5** `queued_turn_count`（中）——✅ 诉求已自研覆盖（QueuedMessagesBar 悬浮条 + SSE 增量维护，数据源 hub queued 行），SDK 字段不引入

实施记录见 spec：`docs/superpowers/specs/2026-08-31-stop-queue-semantics-design.md`（停止动作三档 StopKind、撤回刚发消息 pending #53、lifecycle 终态补全 refused + terminal_reason、message-withdrawn SSE）。

**为什么一批**：全部动 `claudeRemoteLauncher.ts` 的 interrupt/队列链路 + web 停止按钮（SubmitButton）/QueuedMessagesBar，语义互相咬合（停止哪些消息、剩几条、各自什么状态）。
**前置**：与 pending #53（撤回刚发消息）、#28（中途采纳）**一并设计**——四者共享同一套 interrupt/队列语义，割裂做会返工。

### 批次 B｜任务面板与子代理可观测性（2 高 + 2 中）✅ 已完成（2026-08-31）

**目标**：后台任务与 subagent「看得全、滤得净、重连不丢、内容可读」。

- ~~**U-1** `ambient` 标记过滤家务任务~~（✅ 含 **U-3** `is_backgrounded` 第三信号 + 中途后台化补建；`spawn_depth` 留观察）
- ~~**U-23** `forwardSubagentText` 子代理对话流全文转发~~（✅ E2E 验证：sidechain 落库含 text/thinking，Agent drawer 渲染可读对话）
- **U-4** 重连后台任务快照（⚠️ 已验证**未自动受益**：web 重连后面板空白，根因是 hub `runtime_state` 双写路径竞态丢字段，见 pending #62——修复不属 SDK 消费侧，单独处理）

**为什么一批**：同一条链路——cli hook/系统消息/子代理消息转发 → hub `runtime_state` → web 任务/subagent 面板。

**遗留**（E2E 复现并定位根因，单独修）：① web 后台 Agent drawer 内容不随 SSE 实时增长（sidechain 消息不入主消息窗口增量路径，children 冻结在初始快照）；② U-4 的 hub `runtime_state` 双写竞态。见 `docs/pending.md` #62。

### 批次 C｜审批、工具与 MCP 状态保真（2026-09-01 对照 SDK 0.3.251 收敛）✅ 已完成（2026-09-01）

**目标**：审批可达性 + 工具/MCP 在 web 端的状态不再靠猜。**实施前逐条对照当前 sdk.d.ts 复核——7 条中 2 条字段已被上游撤除（U-14a tool_result_meta、U-17 tool_use_meta），教训：台账条目实施前必须重验**。

- **U-12** 后台 subagent 权限请求到达 `canUseTool`（高）→ ✅ 代码已全通（四层都在），批次 C E2E 验证通过（后台 agent Write 审批卡片带来源 agent 标注、批准后继续执行）
- **U-26** `onElicitation` MCP 表单进审批 UI（中）→ ✅ form 模式批次 C 实施（协议零改动走审批链路 + 自写测试 MCP，E2E accept/decline 双路径通过）；url 模式 → pending #63
- **U-14b** `aborted` 截断标注（中）→ ✅ 批次 C 实施（半截 assistant 正文标「已截断」，E2E UI+DB 双证据）
- **U-25** MCP 运行时热管理（中高）→ pending #63（跟 skill/plugin 管理一批；`setMcpServers` 无消费场景明确不做）
- **U-15** `Query.reinitialize()`（中）→ ❌ 不适用（mobi 审批经 agentState.requests 持久化自恢复），留观察 pending #64
- **U-7** `user_message_uuid`（低）→ pending #65
- **U-14a** `tool_result_meta` / **U-17** `tool_use_meta` → ❌ 0.3.251 已无此字段，不适用

spec：`docs/superpowers/specs/2026-09-01-permission-tool-mcp-fidelity-design.md`（本地留存）；架构文档：`docs/architecture/tool-permission.md` 场景五。

### 批次 D｜跨会话数据面（2 条，中）✅ 已完成（2026-09-01）

- **U-18** 跨会话增强包 → ✅ 收敛为 source 细分（`classifyInboundTurn` 识别 schedule_wakeup/loop_wakeup + `meta.turnOrigin` + web CrossSessionTag 三标签）；结构化 name/body ❌spike 证 SDK 0.3.251 不 emit peer 到 onMessage（hook 是唯一观测点）、前置拒绝/notify_when_idle ❌mobi 不发送跨会话无消费场景
- ~~**U-8** `command_lifecycle: refused` 拒收终态~~（✅ 已随批次 A 实施，2026-08-31）

**为什么一批**：mobi 差异化能力的数据面升级，全部动跨会话转发/标签渲染链路；U-8 依赖 U-13 的 lifecycle 帧透传，实际已随批次 A（U-13）一并落地。

**spike 记录**（2026-09-01 E2E 实测 SDK 0.3.251）：A 会话 SendMessage 给空闲 B → B DB 只 1 条 hook 落的 crossSession user 行（无 onMessage 转发第 2 条）→ SDK 不 emit peer 到 onMessage。判据：launcher onMessage 对普通 user message 会落库，若 emit 则重复。

### 批次 E｜rewind/resume 护栏（1 条，中）✅ 已完成（2026-09-01）

- **U-16** `resumeDropsTurn` + `skippedLinks` → ✅ 实施：截断重启传 `resumeDropsTurn=nativeId` 让 SDK 校验截断区间 + refusal（`Resume rejected by --resume-drops-turn:` 前缀）走 plain resume recovery（clear pending + 不带截断点重启保留证据 + 不重试）；`rewindFiles` 结果 `skippedLinks` 跨 shared/cli/hub/web 四包透传到终态 UI「N 路径被安全护栏跳过」。corrective `completeRewind` 覆盖语义（无 progress 时覆盖已有 completion）根治路径 B refusal card 显 success 的 correctness 缺口。

### 批次 F｜成本与预算（3 条，gateway 依赖）

- **U-6** `costBasis` + `canonicalModel`/`provider`（中）
- **U-22** `--max-budget-usd` + gateway spend-limit + `taskBudget` token 预算（低，需决策）
- **U-10** `managedSettings.modelPricing`（低，需决策）

**前置**：统一等 gateway-ccr-backend 推进后一并做，提前做没有消费场景。

**裁定（2026-09-02）**：整体搁置等 gateway。U-6 单独做没有消费场景（估算标注的价值依赖托管价场景）；U-22 预算限额逻辑确认不做（用户裁定）；U-10 / spend-limit / taskBudget 硬绑或 @alpha。详见 pending #66。

### 批次 G｜低优杂项（7 条，随手带）

- **U-27** 动态能力发现 `supportedModels`/`supportedCommands`/`supportedAgents`（中）
- **U-19** `ANTHROPIC_DEFAULT_MODEL`、**U-20** 退出错误带 stderr（配 `stderr` callback 实时捕获）、**U-21** `timestamp`、**U-28** `includeHookEvents`、**U-29** `title` 预设标题、**U-9** `--restricted`（需决策）、**U-30** `onUserDialog`（低）

**盘点裁定（2026-09-02 逐条讨论）**：U-27/U-20 ✅ 已实施（同日批次 G 交付，commits b51cc557..2b169578）；U-29/U-21/U-28 不做；U-19 暂缓；U-9 上游未暴露 SDK 接入面；U-30 缓（pending #67）。

### 批次 H｜架构演进观察（1 条，@alpha）

- **U-24** `sessionStore` transcript 双写镜像——scanner 轮询的长远替代方向，⏸️ 暂缓观察（@alpha），上游 stable 后启动。

---

## ⚠️ 行为变化注意（非机会，mobi 侧需确认/适配）

以下为 07-08 ~ 08-31 升级批次中**改变 mobi 可见行为**的上游变化，不立项但需逐条确认现状无恙：

- **Todo/task 工具在新模型上默认移除**（SDK 0.3.233）——新模型会话不再产生 TodoWrite 调用，todo 渲染路径静默变空；需要时用 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` 或 `tools` 显式保留。**已适配（2026-09-02）**：曾保底注入 `=1`，裁定跟随上游默认不注入（新模型去掉外挂记忆拐杖是正向裁剪，mobi 忠实呈现；TodoPanel/任务面板优雅降级为空）；用户想要可在 settings.json `claudeEnv` 显式配 `'1'`
- **subagent 默认不再嵌套（depth 1）+ 并发上限 20**（SDK 0.3.217，2.1.224 又移除了每会话 200 个总数上限）——subagent 面板的层级/数量预期变化。**已确认无影响（2026-09-02）**：mobi 后台任务面板是扁平列表（taskId upsert）无层级概念，也无数量假设；超限 spawn 失败以 tool_result 错误经工具卡片可见；总数上限移除对远程长会话纯利好
- **auto-compact 对未知模型 ID 强制窗口钳制**（claude 2.1.223）——mobi 网关自定义模型名场景下上下文会按假设窗口提前压缩，可用 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 还原；与 pending #57（水位窗口猜测）联动评估。**已确认跟随新默认（2026-09-02）**：未注入还原 env——钳制防小窗口网关模型爆 "prompt is too long"，且与 mobi `guessContextWindow` 200k 口径对齐（水位显示与 compact 时机一致）；大窗口网关模型如需用满，claudeEnv 显式关闭钳制；根治归 #57 方向 3（hub 模型配置表，仅修 mobi 侧显示，修不了 CC 钳制）
- **`canUseTool` 返回 allow 无 `updatedInput` 的契约修正**（SDK 0.3.207）——按文档契约以原始输入执行（此前被当 deny 报 ZodError）；确认 mobi `permissionHandler.ts` 的返回形态兼容。**已确认无影响（2026-09-02）**：mobi 全部 7 处 allow 分支都显式携带 `updatedInput`（AskUserQuestion/表单合成 + 通用放行透传 + sandbox 路径），触发不了旧 bug；修复使未来潜在遗漏从崩溃降级为按原始输入执行，纯利好
- **usage limit 重置后自动续跑**（claude 2.1.234，`/config` 可关）——会出现「无用户输入的 idle→running」迁移，mobi 会话状态机与 StatusBar 计时需能解释。**已确认无影响（2026-09-02）**：run-started 链路不区分翻转起因（#56 已落地）；StatusBar 取 max(runStartedAt, lastUserMessageAt) 单调不回跳，续跑轮正确起算；等待期 idleTimer 默认 1 天（configuration.ts）大于典型 5h 重置窗口不打断——周 limit 挂机数天的理论边界可接受且可配置
- **后台任务通知轮间以 `<system-reminder>` 包裹投递**（claude 2.1.234）——消息流解析/渲染 system-reminder 的命中面变宽。**已核实（2026-09-02）+ 裁定不做适配、不展示**：mobi 全链路零 system-reminder 过滤逻辑，生产库已落库 136 条（99 条内嵌 tool_result block）——web 看不见是 normalizeUserContent 不认 tool_result block 的结构性副产品，非过滤；若上游改为独立文本形态投递会原样渲染为用户气泡（库中已有 role:'user' 纯文本 task-notification 先例）。不展示的理由：内容是给模型看的轮间状态注入，用户关心的信息已有专用通道（TodoPanel / backgroundTasks 卡片 / 系统灰行），原文展示纯噪音且渲染为用户气泡属错误归因；将来若真涌入，正确动作是识别后转系统灰行或丢弃而非展示
- **Bash 输入重定向权限检查反复**（2.1.232 引入 2.1.233 回退）——权限规则覆盖范围在上游快速变动，审批 UI 不应假设特定语法必不触发。**已确认无影响（2026-09-02）**：mobi 审批兜底是字面匹配设计（PermissionFooter `buildFallbackUpdate` 把 command 字面存 mobi 自己的 Set，`parseBashPermission` 字面填），不做语法解析，与上游权限规则引擎语义解耦——上游规则覆盖变动只影响弹窗频率（即上游行为本身），mobi 侧免疫

---

## 已自动受益（无需动作，留档）

以下上游修复/改进 mobi 零改动受益，仅作记录、不立项：

- **并行工具调用权限请求双发竞态修复**（claude 2.1.247）——审批弹窗更干净
- **`system/init` permissionMode 实时性修复**（SDK 0.3.247）——plan 模式切换显示不再 stale
- **第三方端点无 id tool_use 不再 crash**（claude 2.1.246）——mobi 走 glm 等网关直接受益
- **resumed 会话 400 修复**（claude 2.1.246，第三方 proxy 写入的 tool blocks）——网关场景 resume 更稳
- **subagent 首调 404 走 fallback 模型链**（claude 2.1.247）——网关场景 subagent 更稳
- **hook 输出非法 JSON 不再静默当纯文本**（claude 2.1.248）——hooks 调试体验

### 2026-07-08 ~ 08-28 批次回溯补记（本次机会挖掘时确认）

- **迟连客户端补收挂起权限弹窗**（SDK 0.3.217）——web 刷新/晚连后审批不再丢（与 U-15 相关，验证后可降级 U-15）
- **后台任务运行期间会话正确报 idle**（SDK 0.3.179）——running/idle 判定不再被后台 workflow 拉长
- **`isSynthetic`→`isMeta` 映射修复**（SDK 0.3.198）——合成消息不再混入真实用户消息流
- **自定义 base URL / 网关的 prompt caching 修复**（claude 2.1.237）——mobi proxy 链路 cache 命中与成本口径恢复正确
- **第三方网关非流式 fallback 崩溃修复**（claude 2.1.234）——thinking/text 缺字段的畸形响应不再崩
- **沙盒违规细节写入 Bash tool result**（claude 2.1.224）——被拒的文件/网络访问带原因可见
- **自动会话标题改为短专名**（claude 2.1.234）——mobi 标题同步质量受益
- **SendMessage 长 summary 截断而非失败**（claude 2.1.222）——跨会话卡片预览不再静默丢消息
- **`interrupt_receipt_v1` 能力**（SDK 0.3.205）——pending #28 已记录引用，实施时直接用

## 不适用（有具体理由，防止重复评估）

- `createSdkMcpServer({ timeout })`（SDK 0.3.248）——mobi-web 是自建 in-process MCP（@modelcontextprotocol/sdk），不经过 SDK-hosted MCP 路径
- `managedSettings` 的 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 模式本身——mobi 未采用该模式（U-10 是未来若采用时的配套）
- spinnerTipsOverride / `/claude-api` 系列 / fullscreen / `claude agents` TUI 条目——mobi 无 TUI 消费面

### 2026-07-08 ~ 08-28 批次回溯补记

- `PostToolUse.classifierContext`（SDK 0.3.236）——auto-mode 权限分类器由上游运营，mobi 不注入分类备注
- `sandbox.credentials` / `sandbox.network.strictAllowlist` 设置面（SDK 0.3.187/0.3.219）——mobi 沙盒走自研配置（`~/.mobi/sandbox.json`），暂不接 SDK settings 类
- `CLAUDE_CODE_PROJECT_DIR_NAME`（claude 2.1.234）——面向「每会话独立 config 目录」的 host，mobi 不采用该形态
- `self-hosted runner`（claude 2.1.224）——Claude 官方云/移动会话自托管运行器，与 mobi 定位重叠，仅作概念对标
- skills `'all'` 校验、`fast_mode_disabled_reason`、rate-limit credits 引导（SDK 0.3.221/0.3.219/0.3.181）——mobi 走网关场景，claude.ai credits 与 fast mode 无消费面
- `rewind_conversation` 控制请求（SDK 0.3.186）——mobi rewind 全链路已自研（`resumeSessionAt` 锚点），该请求为潜在未来替代方案，仅留档

### SDK API 面对照已确认不引入（2026-08-31，对照 sdk.d.ts 0.3.251）

- `Query.getContextUsage()`——内部调 countTokens API（fallback 真实 LLM 调用，第三方网关必触发限流）；mobi 已改读 assistant 消息 usage（memory：getContextUsage-api-calls）
- `settingSources`（SDK isolation mode）——mobi 依赖用户/项目 claude 配置生效（CLAUDE.md、MCP、skills），不隔离
- `permissionPromptToolName`——旧式权限路由，mobi 已用 `canUseTool` 回调
- `persistSession: false`——mobi 依赖 transcript 持久化（scanner/rewind/跨会话观测都读 .jsonl）
- `plugins` / `reloadPlugins`——mobi 不装载 SDK 插件（reloadSkills 留档于 pending #49 skill 管理场景）
- `spawnClaudeCodeProcess`——VM/远程 spawn 场景，mobi 本地直跑；远程化方向若启动再评估
- `maxTurns` / `outputFormat`（全局 json_schema）——对话式远程会话不适配每 turn 结构化输出；`outputFormat` 若做「会话自动摘要」类独立用途可再评估
- `betas`（1M context beta header）——[1m] 模型名场景由 CLI 自身处理，mobi 不显式传 beta
- `thinking`（显式 budget）——mobi 用 `effort`（依赖默认 adaptive thinking），语义已覆盖
- `sandbox`（SDK 内建沙盒设置）——mobi 沙盒走 `@anthropic-ai/sandbox-runtime` 自研管理（`~/.mobi/sandbox.json`），两套并存会语义打架
- `strictMcpConfig`——mobi 需要项目 .mcp.json 与用户 MCP 配置生效，不隔离 MCP 来源
