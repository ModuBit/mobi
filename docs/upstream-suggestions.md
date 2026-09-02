# 上游新功能引入建议

记录从 Anthropic 上游（Claude Agent SDK + 内嵌 claude 二进制）changelog 中挖掘出的、对 mobi 有价值的新能力建议。

**来源**：`/upgrade-deps` skill 第八步「机会挖掘」——每次升级 `@anthropic-ai/*` 包时对 changelog 做两遍筛子（防御：影响评估；进攻：本文件）。

**条目生命周期**：`待决策` → `已采纳`（进入 pending.md 立项或直接实施）/ `不采纳`（附理由）。已实施/已否决条目定期清理，历史见 git log。

**覆盖范围**（2026-08-31 建档）：SDK 0.3.178 → 0.3.251 / claude 2.1.178 → 2.1.251（对应 2026-07-08 ~ 08-31 的三次升级批次，机会挖掘此前未做，历史区间一次性回溯补齐；2.1.178~2.1.216 无官方 release notes，该段行为以 SDK changelog 实体条目为准）。

---

## 处理批次总览（2026-08-31 整理；同日 API 面对照后扩充）

按**落地链路**分组——同批条目动的是同一组文件/同一条数据链，一次设计语义、一次改完、一次回归。批次按建议处理顺序排列；条目本体见下文对应 U-N 编号。

### 批次 A｜停止 × 队列语义闭环 ✅ 已完成（2026-08-31）

**目标**：把「停止按钮 × 排队消息」的语义一次设计完整——停止哪些、留哪些、队列状态如何呈现。

- **U-2** `perTaskStopAffordance`（高）——「停止本轮」与「终止一切」分化（配套 `Query.stopTask()` 逐任务停止）✅
- **U-11** `cancel_queued` + `still_queued` 回执（高）——「停止并清空队列」+ 停止后队列对账 ✅
- **U-13** `command_lifecycle` + `terminal_reason`（中）——每条消息的真实终态渲染 ✅（含 **U-8** `refused` 终态，自批次 D 提前）
- **U-5** `queued_turn_count`（中）——QueuedMessagesBar 显示剩余排队数（**本批跳过**，spec D9 留台账）

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

**盘点裁定（2026-09-02 逐条讨论）**：U-27/U-20 采纳（设计定稿待实施）；U-29/U-21/U-28 不做；U-19 暂缓；U-9 上游未暴露 SDK 接入面；U-30 缓（pending #67）。批次 H（U-24 @alpha）保持观察。

### 批次 H｜架构演进观察（1 条，@alpha）

- **U-24** `sessionStore` transcript 双写镜像——scanner 轮询的长远替代方向，上游 stable 后启动。

---

---

## U-1. task 条目 `ambient` 标记——任务面板过滤家务任务

**来源**：SDK 0.3.247 — `task_started` / `task_notification` / `background_tasks_changed` 新增可选 `ambient` 标记，供 host 排除 housekeeping 任务。

**对 mobi 的价值**：直接填补已知短板——SDK 对所有任务都 emit `task_started`，家务任务（checkpoint/索引类）混入任务面板与活跃指示（见 memory「task_started 前后台识别」）。按 `ambient` 过滤后面板只显示真实工作，running 指示不再被噪音任务点亮。

**落地位置**：cli `packages/cli/src/claude/utils/sessionHookForwarder.ts` 透传字段 → hub `runtime_state`（tasks / backgroundTasks）随帧存储 → web 任务面板与活跃指示过滤 `ambient === true` 条目（可选提供「显示家务任务」开关）。

**优先级**：高（低成本、填补历史痛点）。
**状态**：✅ 已采纳（2026-08-31 批次 B 实施：hub `backgroundTasks.ts` 信号入口过滤（活跃集合 + task_started 双入口，`skip_transcript` 不过滤）、cli `collectLiveTaskIds` 滤『全部停止』遍历源，spec：`docs/superpowers/specs/2026-08-31-task-subagent-observability-design.md`）

---

## U-2. `perTaskStopAffordance`——停止按钮语义分化

**来源**：SDK 0.3.246 — 设置后 `interrupt()` 仅中断当前 turn，后台 agents/workflows 继续运行；不设置（及一次性字符串 prompt）则一并停止。

**对 mobi 的价值**：mobi 停止按钮是唯一 interrupt 入口（`packages/cli/src/claude/claudeRemoteLauncher.ts` 的 `handleAbortRequest → queryRef.interrupt()`），当前停止会连带终止后台任务。开启后「停止本轮」与「终止一切」可分化为两个动作，远程场景下用户可以只打断当前回答而保留后台 agent。

**落地位置**：cli 会话启动 query options 注入处设 `perTaskStopAffordance: true`；web 停止按钮（SubmitButton / submitButtonState）区分「停止本轮」与「停止全部」两个入口。

**优先级**：高（一行 option + 按钮分化，远程控制工具的核心体验增强）。
**状态**：✅ 已采纳（2026-08-31 批次 A 实施：`perTaskStopAffordance: true` 默认开 + 停止按钮三档分化，spec：`docs/superpowers/specs/2026-08-31-stop-queue-semantics-design.md`）

---

## U-3. `is_backgrounded` / `spawn_depth`——任务前后台显式信号

**来源**：SDK 0.3.238 — `task_started` 事件新增 `is_backgrounded` 与 `spawn_depth`（`is_backgrounded` 也出现在后台 Bash 任务）。

**对 mobi 的价值**：任务面板前后台识别的第二信号——当前靠 `background_tasks_changed` 集合 + `run_in_background` 推断（memory「task_started 前后台识别」），改为读显式字段更鲁棒。

**落地位置**：与 U-1 同链路，建议合并实现。

**优先级**：中（并入 U-1）。
**状态**：✅ 已采纳（2026-08-31 批次 B 实施：`is_backgrounded` 作第三 OR 信号并入现有双信号判定（不替换），并补 `task_updated patch.is_backgrounded` 中途后台化补建（带 knownTaskIds 守卫防正常任务被降级覆盖）；`spawn_depth` 本批不消费留观察，spec 同上）

---

## U-4. 重连后台任务快照——initialize 后自动同步

**来源**：SDK 0.3.239 — 对运行中进程重复 `initialize` 后，SDK 主动下发一次 `background_tasks_changed` 快照，重连的 host 能看到仍在运行的后台工作。

**对 mobi 的价值**：web 重连 / CLI 会话重启后后台任务状态不再空白，缓解「首拉竞态」模式（memory：SSE 早到信号被丢弃 / CLI 未就绪首拉失败无补拉）中的时序窗口。

**落地位置**：cli 重连链路确认消费该快照——可能零改动自动受益，验证即可。

**优先级**：中。
**状态**：⚠️ 已验证未自动受益（2026-08-31 批次 B E2E：后台任务 running 中 web 断开重连后面板空白。SDK 快照机制本身可用，但 mobi hub `runtime_state` 双写路径（消息事件 / sessionCache 事件）全量覆盖无锁，并发时 `backgroundTasks` 字段被覆盖丢失，DB 持久层无数据可拉。修复见 `docs/pending.md` #62，属 hub 并发域而非 SDK 消费侧）

---

## U-5. `queued_turn_count`——排队消息剩余量可见

**来源**：SDK 0.3.243 — result 消息新增可选 `queued_turn_count`：result 产生时仍在等待的排队用户发送数，host 由此知道是否还有 turn 和 result 会到来。

**对 mobi 的价值**：mobi 已有排队消息（QueuedMessagesBar / gated pump），result 到达时据此显示「还有 N 条待处理」，并可精确判断队列是否已清空（当前靠消息事件推断）。

**落地位置**：cli result 处理（`claudeRemoteLauncher.ts` 的 `handleContextUsage` 同层）→ hub → web QueuedMessagesBar。

**优先级**：中。
**状态**：待决策（批次 A 跳过——spec D9：QueuedMessagesBar 本批不动则无消费点，留台账）

---

## U-6. `modelUsage[*].costBasis`——成本摘要卡计价来源标注

**来源**：SDK 0.3.246 — `modelUsage[*].costBasis`（`'list' | 'managed' | 'unknown'`）标明各模型 `costUSD` 按哪张价目表计算；SDK 0.3.218 — `modelUsage[*]` 另增 `canonicalModel` / `provider` 字段，供下游按正确费率表查价（网关改写模型名场景的关键：mobi 请求名与上游真实名不同源的问题已有记录）。

**对 mobi 的价值**：mobi 走第三方网关（glm 等），`costUSD` 本为按官方价的估算；摘要卡可据此标注「官方价 / 托管价 / 未知来源」，避免用户把估算当账单。gateway-ccr-backend 落地后价值放大。

**落地位置**：web 成本摘要卡（读 assistant usage / modelUsage 的展示层）；cli/hub 透传字段。

**优先级**：中（依赖 gateway/CCR 落地后价值放大）。
**状态**：⏸️ pending #66（2026-09-02 裁定：整体搁置等 gateway-ccr-backend——估算标注单独做没有消费场景，托管价（managed）消费场景随 gateway 落地才出现；届时与 U-10 组合一并设计）

---

## U-7. `user_message_uuid`——错误结果回链触发消息

**来源**：SDK 0.3.246 — 错误 result 消息与每 turn 首条 assistant 消息 / `stream_event` 新增可选 `user_message_uuid`，将回复或失败关联到触发它的用户消息。

**对 mobi 的价值**：错误归因——web 错误卡片可标注「这条失败对应你发的哪条消息」，多轮并发/排队场景下定位失败来源更准确。

**落地位置**：cli 透传（assistantPartialAssembler / 转发层）→ hub 消息持久化附带 → web 错误展示组件关联显示。

**优先级**：低。
**状态**：⏸️ pending #65（2026-09-01 裁定：错误归因暂无强烈实际痛点，user 消息 native uuid 与 mobi localId/nativeId 双轨对齐成本可能大于收益；出现排队失败归因需求或做 edit-and-retry（`refused_user_message_uuid` 配套）时重启）

---

## U-8. `command_lifecycle: refused`——跨会话拒收终态

**来源**：SDK 0.3.238 — `command_lifecycle` 新增 `refused` 状态：跨会话 peer 消息被接收侧策略拒绝时上报此终态，而非不产生任何 lifecycle 帧。

**对 mobi 的价值**：配合已交付的跨会话消息可见性，mobi 可显示「对方拒绝接收」而非静默无响应。

**落地位置**：cli 跨会话 lifecycle 处理 → web 跨会话标签状态。

**优先级**：低。
**状态**：✅ 已采纳（2026-08-31 随批次 A 实施——lifecycle fact 透传 `refused` 终态 + `LIFECYCLE_RANK` 同档（终态互不覆盖），跨会话拒收消息有显式终态可渲染，spec 同上）

---

## U-9. `--restricted` 受限会话模式

**来源**：claude 2.1.248 — `--restricted`（或 `CLAUDE_CODE_RESTRICTED=1`）：移除执行命令/代码的内置工具与 WebFetch（除非 `--tools` 显式保留），文件工具限工作目录内，拒绝 `bypassPermissions`，忽略 user/project/local 设置文件。

**对 mobi 的价值**：全新能力（需产品决策）——远程控制场景的「安全只读会话」：给不受信环境/演示场景提供无命令执行能力的会话形态。

**落地位置**：cli spawn args（`claudeArgs.ts` / `spawnArgs.ts`）+ web 会话创建选项。

**优先级**：低（需决策）。
**状态**：⏸️ 上游未暴露（2026-09-02 核实：`--restricted` 是 claude CLI flag，SDK 0.3.251 Options 无对应字段、无 extra args 机制——mobi 经 SDK 起 claude 没有官方入口，产品决策（远程控制只读会话形态）留 SDK 暴露接入面后一并议）

---

## U-10. `managedSettings.modelPricing`——host 托管价目表

**来源**：SDK 0.3.246 — host 设置 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 后可在 `managedSettings` 注入 `modelPricing`；admin-managed settings 仍优先。

**对 mobi 的价值**：全新能力（需决策）——若 mobi 未来作为 host 托管 provider（与 gateway-ccr-backend 方向吻合），可自行声明模型价格使成本计算准确（与 U-6 组合消费）。

**落地位置**：cli 会话 options 的 `managedSettings` + gateway provider 配置层。

**优先级**：低（需决策，与 gateway-ccr-backend 合并考虑）。
**状态**：⏸️ pending #66（2026-09-02 裁定：等 gateway-ccr-backend 落地，与 U-6 组合做——mobi 作为 host 托管 provider 时才需要自声明价目表）

---

## U-11. 停止×队列控制：`cancel_queued` + `still_queued` 回执

**来源**：SDK 0.3.219 — interrupt 控制请求新增 opt-in `cancel_queued`（capability `interrupt_cancel_queued_v1`）：中断时连同取消排队与待派发消息；SDK 0.3.205 — interrupt 回执带 `still_queued`（仍会执行的排队消息 UUID），`system/init` 广播 `interrupt_receipt_v1` capability 供特性检测。

**对 mobi 的价值**：停止按钮语义的第三块拼图——现有「停止 = 中断当前 turn，队列照跑」（pending #53 已定），加上 `cancel_queued` 后可提供「停止并清空队列」；`still_queued` 回执让停止后 UI 能精确显示「还有 N 条排队消息仍会执行」，消除竞态对账。

**落地位置**：cli `handleAbortRequest`（`claudeRemoteLauncher.ts`）扩展 interrupt 调用；web 停止按钮第三动作 + QueuedMessagesBar 对账显示。

**优先级**：高（与 pending #53 撤回消息、#28 中途采纳直接衔接，实施时一并设计）。
**状态**：✅ 已采纳（2026-08-31 批次 A 实施：`interrupt({cancelQueued:true})` 清 CC 层队列 + hub 批量删 queued 行，`still_queued` 经 aborted event `stillQueuedCount` 展示在停止灰行，spec 同上）

---

## U-12. 后台 subagent 权限请求到达 `canUseTool`（`agent_id`）

**来源**：SDK 0.3.186 — `can_use_tool` 控制请求新增 `agent_id` 字段：后台 agents 的权限提示转发给 `canUseTool` 而非自动拒绝，且后台任务运行期间 stdin 保持打开。

**对 mobi 的价值**：远程审批的关键缺口——后台 subagent 触发的权限请求此前被自动拒绝，用户在 web 端根本看不到；打通后所有 agent 的审批统一进 mobi 审批 UI，并可按 `agent_id` 在卡片上标注来源 agent。

**落地位置**：cli `permissionHandler.ts`（读取 `agent_id`、透传）；web 审批卡片显示来源 agent。

**优先级**：高（远程控制场景的核心完整性：凡权限必可达）。
**状态**：✅ 已实现（代码链路全通，早于批次 C：cli `permissionHandler.ts` 透传 `agentID` + `agentInfoMap` 反查、shared `SDKUIHints` 三字段、web `PermissionFooter.tsx` 渲染来源 agent。批次 C 仅 E2E 顺手验证，spec 同批次 C）

---

## U-13. `command_lifecycle` 帧 + `terminal_reason` 枚举——消息终态结构化

**来源**：SDK 0.3.206 — `command_lifecycle` 帧报告每条 uuid 消息的终态（`queued`/`started`/`completed`/`cancelled`/`discarded`）；0.3.238 增 `refused`（跨会话拒收）；0.3.204/0.3.214 — `terminal_reason` 新枚举（`api_error`/`budget_exhausted`/`tool_deferred_unavailable`/`turn_setup_failed` 等），异常终止的轮次不再伪装成 `completed`。

**对 mobi 的价值**：排队消息 UI 可按每条消息的真实生命周期渲染（排队/已启动/完成/取消/丢弃），不再靠消息事件推断；轮次异常死亡（API 错误/预算耗尽）可按枚举给出准确错误提示。与 U-8（refused）、U-11（still_queued）同族。

**落地位置**：cli 消息转发层透传 lifecycle/terminal_reason → hub → web QueuedMessagesBar 与错误展示。

**优先级**：中。
**状态**：✅ 已采纳（2026-08-31 批次 A 实施：`commandLifecycleToFact` 透传 `refused` 终态 + `terminalReason`（开放 string 原样透传，web 消费时才解释），lifecycle 联合加 `refused`，spec 同上）

**来源**：SDK 0.3.216 — user 消息新增 `tool_result_meta` sidecar（`non_execution_kind`、`user_feedback`），无需字符串匹配即可分类被拒绝/被打断/被取消的工具调用；0.3.214 — 被 `interrupt()` 截断的 assistant 消息携带 `aborted: true`。

**对 mobi 的价值**：工具卡片可结构化区分「被拒绝/被打断/被取消」，停止后的半截正文可正确标注「已截断」而非渲染成完整消息（当前靠文案匹配/heuristic）。

**落地位置**：web `domain/chat`（normalize/reducer 消费 sidecar 字段）、工具卡片状态渲染。

**优先级**：中。
**状态**：⚠️ 收敛拆分（2026-09-01 对照 SDK 0.3.251：`tool_result_meta` **已被上游撤除**（0.3.216 引入后不在当前 sdk.d.ts），被拒/被取消分类仍靠 `INTERRUPTED_PATTERN` 文案匹配，无结构化替代；`aborted`（sdk.d.ts:3221，assistant 消息截断标记）✅ 已实施（批次 C：cli `...assistantMsg` 展开自动落库零改动 + web normalize 保留 `aborted` + 半截 assistant 气泡尾部中性「已截断」标注。E2E 验证：UI Truncated tag + DB content 含 `"aborted":true` 双证据。spec：批次 C）

---

## U-15. `Query.reinitialize()`——断线重连重放挂起审批

**来源**：SDK 0.3.195 — 新增 `Query.reinitialize()`：传输中断恢复后重发 initialize 并重新投递挂起的 permission/dialog 提示；SDK 0.3.217 起迟连客户端也会自动补收挂起的权限弹窗（Remote Control 路径行为修复）。

**对 mobi 的价值**：mobi web 断线重连/CLI 重启场景下，挂起中的审批不再丢失——「刷新页面后审批弹窗消失」类问题的 SDK 级解法（与 memory「首拉竞态」场景相关）。

**落地位置**：cli 传输恢复链路调用 `reinitialize()`；先验证 0.3.217 的自动补收在 mobi 链路是否已生效。

**优先级**：中。
**状态**：❌ 不适用（2026-09-01 核实：mobi 审批经 `agentState.requests` 持久化（cli→hub update-state RPC→web 首拉自恢复），web 刷新/重连不丢审批卡片；SDK 0.3.217 迟连补收面向 Remote Control 路径、`reinitialize()` 面向 SDK 传输层重连，mobi 均无对应场景（cli↔SDK 进程内 stdio）。留观察场景见 pending #64）

---

## U-16. rewind/resume 护栏：`resumeDropsTurn` + `skippedLinks`

**来源**：SDK 0.3.223 — `resumeSessionAt` 搭配 `resumeDropsTurn` 显式声明截断恢复要丢弃的 turn，CLI 在会误删其他内容时拒绝恢复；SDK 0.3.216 — `rewindFiles` 响应新增 `skippedLinks`（安全护栏拒绝恢复/删除的路径数）。

**对 mobi 的价值**：rewind 全链路的安全增强——截断恢复加防误删护栏；rewind 完成提示可显示「N 个路径被安全护栏跳过」。

**落地位置**：cli `resumeSessionAt` 调用处（`session.ts`）+ web rewind 结果提示。

**优先级**：中。
**状态**：✅ 已采纳（2026-09-01 批次 E 实施：截断重启传 `resumeDropsTurn=nativeId` 让 SDK 校验截断区间 + refusal 走 plain resume recovery（clear pending + 不带截断点重启保留证据 + 不重试）+ `rewindFiles` 结果 `skippedLinks` 跨 shared/cli/hub/web 四包透传到终态 UI + completeRewind corrective 覆盖语义根治路径 B card correctness。spec：`docs/superpowers/specs/2026-09-01-cross-session-source-rewind-guard-design.md`）

---

## U-17. `tool_use_meta`——工具卡片人类可读名与图标

**来源**：SDK 0.3.179 — assistant 消息新增 `tool_use_meta` sidecar，提供工具调用的显示友好名（替代 `mcp__server__tool` 原始名）；0.3.181 — 增 `icon_url`（来自 MCP 服务器目录元数据）。

**对 mobi 的价值**：`knownTools.tsx` 注册表之外的工具（长尾 MCP 工具）可获得人类可读标题，不再显示原始 wire name。

**落地位置**：web 工具卡片标题渲染层读 `tool_use_meta` 回退 `knownTools` 注册表。

**优先级**：中低。
**状态**：❌ 不适用（2026-09-01 对照 SDK 0.3.251：`tool_use_meta` / `icon_url` **不在当前 sdk.d.ts**——0.3.179/0.3.181 引入后被上游撤除。若后续以其他形态回归再评估）

---

## U-18. 跨会话数据面增强包

**来源**（多条同族合并）：SDK 0.3.205 — peer-message 事件带结构化 `name`/`body`（发送者显示名 + 解码正文）；0.3.214/0.3.224 — `task-notification` origin 增 `subkind: 'scheduled-trigger'` / `'peer-send-message'` 区分消息来源；0.3.234 — peer origin 可声明 `fromMode` 权限等级；claude 2.1.235/2.1.236 — `SendMessage` 超大消息与 inbox 背压改为前置显式拒绝；2.1.236 — `notify_when_idle` 一次性空闲通知。

**对 mobi 的价值**：已交付的跨会话消息能力的数据面升级——直接读结构化发送者名/正文（去掉解析）、区分跨会话消息与定时任务触发、发送失败从「假成功」变显式态、支持「对端空闲时通知我」订阅。

**落地位置**：cli 跨会话转发层（结构化字段透传）→ web 跨会话标签/卡片渲染。

**优先级**：中（跨会话是 mobi 差异化能力，数据面升级性价比高）。
**状态**：✅ 已采纳（2026-09-01 批次 D 实施：收敛为 source 细分——`classifyInboundTurn` 识别 `schedule_wakeup`/`loop_wakeup` + `meta.turnOrigin` + web CrossSessionTag 三标签「📨 来自 xxx」/「⏰ 定时任务」/「🔁 /loop」。结构化 name/body ❌不适用（spike E2E 实测 SDK 0.3.251 不 emit peer 到 onMessage，hook 是唯一观测点，看不到 origin 字段）；前置拒绝/notify_when_idle ❌不适用（mobi 不发送跨会话消息，无消费场景）。spec：`docs/superpowers/specs/2026-09-01-cross-session-source-rewind-guard-design.md`）

---

## U-19. `ANTHROPIC_DEFAULT_MODEL`——新会话默认模型的正式入口

**来源**：claude 2.1.236 — 设置新会话起始模型，`/model` 手动选择仍覆盖且跨重启持久（与 `ANTHROPIC_MODEL` 语义不同）。

**对 mobi 的价值**：mobi 有模型选择器与 initialModel 回填逻辑，该 env 是官方认可的「默认模型」注入入口，与用户手动选模型的持久化语义正交。

**落地位置**：cli 会话 env 注入层（claudeEnv 配置）。

**优先级**：中低。
**状态**：⏸️ 暂缓（2026-09-02 裁定：mobi 的 `initialModel` 链路已覆盖「新会话起始模型」；此 env 的「不传时默认值」场景待有真实需求再议）

---

## U-20. SDK 进程退出错误携带 CLI stderr

**来源**：SDK 0.3.211 — claude 二进制启动失败时错误信息包含 CLI 的 stderr 输出，而非只有 exit code。

**对 mobi 的价值**：直接改善已知诊断痛点——「Claude Code process exited with code 1」无信息类问题（如 BUN_INSPECT 污染导致子进程异常退出，见 cli CLAUDE.md 已知陷阱）现在能把真实原因透出到 web 错误提示。

**落地位置**：cli 错误处理层捕获 stderr 并透传 → web 会话错误提示。

**优先级**：中低（诊断体验，出问题时价值大）。
**状态**：✅ 已实施（2026-09-02 批次 G：commit 8465628a + 收尾 36ac94e9——`Options.stderr` callback 实时落 debug 日志，chunk 超 4096 截断防挤占 ringBuffer；web 渲染检查结论（2026-09-02）：无需改动——SDK `formatStderrTail` 硬性截 stderr tail 至 2048 字符（消息总长 ≤ ~2.2KB），web `AgentEventBlock` 默认 white-space 渲染（无 pre-wrap）多行自动折叠为段落、`reducerEvents` 对连续重复 message 事件去重，长 stderr 不会刷屏；local 模式核实为终端直连子进程（`spawnWithAbort` 默认 stdio inherit，stderr 直达用户终端），无接线缺口。核实底稿：SDK 0.3.211+ 退出错误 message 已自动追加 stderr tail（`formatStderrTail`，sdk.mjs 核实），launcher catch → `sendSessionEvent` 透传链完整——「无信息 exit code 1」痛点已随 SDK 升级自然解决）

---

## U-21. `SDKAssistantMessage.timestamp`——流式消息精确时间戳

**来源**：SDK 0.3.211 — live stream 的 assistant 消息新增 ISO-8601 `timestamp`（对齐 `SDKUserMessage`）；旧 emitter 缺省时回退接收时间。

**对 mobi 的价值**：气泡时间戳不再依赖 hub 接收时刻（中转延迟会造成偏差），多端展示一致。

**落地位置**：cli 转发透传 → web 气泡时间显示。

**优先级**：低。
**状态**：❌ 不做（2026-09-02 裁定：mobi 显示面核实——时间只出现在 user 消息 footer 与 result 详情，**assistant 气泡不显示时间**，而 timestamp 恰只挂 assistant 消息；显示的两处偏差在 cli/hub 同机部署下为毫秒级。三端 schema 扩展换毫秒级修正，价值不足。重启时机：assistant 气泡加时间显示、或 runner 与 hub 分机部署）

---

## U-22. 预算护栏：`--max-budget-usd` + gateway spend-limit

**来源**：claude 2.1.217 — `--max-budget-usd` 现在能拦住后台 subagent（达上限后拒绝新 spawn、叫停运行中的后台 agent）；2.1.225 — gateway spend-limit 结构化警告（上限金额/重置时间/运营者留言，需 gateway 2.1.225 配合）；SDK Options `taskBudget`（@alpha）——API 侧 token 预算，模型感知剩余预算自主收敛（`task-budgets-2026-03-13` beta）。

**对 mobi 的价值**：远程无人值守场景的成本护栏——可透出「会话预算上限」设置；gateway-ccr-backend 落地后限额警告有结构化数据可做到期 UI。

**落地位置**：cli spawn args + web 会话设置；依赖 gateway 落地。

**优先级**：低（需决策，随 gateway 推进）。
**状态**：⏸️ pending #66（2026-09-02 裁定：**预算限额逻辑确认不做**——maxBudgetUsd 语义已核实为估算美元（按官方牌价折算，非真实账单），per-query 语义在 mobi 需「上限−已花费」换算成会话累计，价值不足以支撑；gateway spend-limit 与 taskBudget（@alpha）留 gateway 落地时再议）

---

## U-23. `forwardSubagentText`——子代理对话流全文转发

**来源**：SDK Options（0.3.2xx 起）——开启后子代理的 text/thinking block 以带 `parent_tool_use_id` 的消息全文转发；默认只发 tool_use/tool_result（仅够心跳计数）。

**对 mobi 的价值**：subagent 面板从「状态卡 + 心跳」升级为**可读的嵌套对话流**——mobi 只派 local_agent（memory：teamState 面板不可达），子代理在做什么目前完全不可见，这是远程可观测性的明显缺口。

**落地位置**：cli 开 option → cli 消息转发层按 `parent_tool_use_id` 归组透传 → web subagent 面板嵌套渲染。

**优先级**：中高。
**状态**：✅ 已采纳（2026-08-31 批次 B 实施：cli `forwardSubagentText: true` + web 三处 drawer 入口统一（ToolCallBlock 解禁 isBgAgent / TasksPanel 卡片点击 / completed 态补查看详情链接）。E2E 验证 sidechain 落库含 text×3+thinking×3，drawer 渲染子代理可读对话。遗留：drawer 内容不随 SSE 实时增长（pending #62），先于本批存在）

---

## U-24. `sessionStore` transcript 双写镜像（@alpha）

**来源**：SDK Options `sessionStore` + `sessionStoreFlush`（`@alpha`）——CLI 写本地 transcript 的同时双写适配器（`SessionStore` 接口），可控制 flush 策略。

**对 mobi 的价值**：**架构级演进方向**——mobi 当前靠 `BaseSessionScanner` 轮询 + file watcher 扫 `~/.claude/projects/*.jsonl`（跨会话观测、rewind 锚点等），双写适配器可把「扫文件」变成「收推送」，消除轮询延迟与解析脆弱性。

**落地位置**：cli 实现 SessionStore 适配器接 hub 上报通道；与 scanner 共存过渡。

**优先级**：中高（@alpha 标注，跟进上游稳定后再动；先留档方向）。
**状态**：待决策（@alpha 观察）

---

## U-25. MCP 运行时热管理四件套

**来源**：SDK Query 方法 `setMcpServers(servers)` / `toggleMcpServer(name, enabled)` / `reconnectMcpServer(name)` / `mcpServerStatus()`——会话运行中热更新 MCP 配置、启停/重连单服务器、查连接状态。

**对 mobi 的价值**：mobi 改 MCP 配置（如 webTools provider 切换、用户改外部 MCP）当前需重启会话生效；热管理后配置变更即时生效，web 设置页可显示每台 MCP 服务器的实时连接状态并支持「重连」按钮。

**落地位置**：cli 会话控制链路（QueryControlRef 透传）→ hub → web 设置页 / inspector MCP 状态。

**优先级**：中高。
**状态**：⏸️ pending #63（2026-09-01 裁定：跟 skill/plugin 管理一批做「配置资产管理面」。收敛结论：状态查询 + 重连对用户配置层 MCP 有效、价值真实；`toggleMcpServer` 会话级语义易困惑暂缓；`setMcpServers` 只覆盖 dynamic 层，mobi 无消费场景，明确不做）

---

## U-26. `onElicitation`——MCP elicitation 表单进审批 UI

**来源**：SDK Options `onElicitation`——MCP 服务器请求用户输入（表单字段 / URL auth）时回调 host；不提供则自动 decline。

**对 mobi 的价值**：mobi 支持用户配置外部 MCP 服务器，带 elicitation 的服务器在 mobi 下当前**静默被拒**；接入后 elicitation 表单可在 web 端渲染（与权限审批 UI 同层）。

**落地位置**：cli 接回调 → 透传 web 渲染表单 → 结果回传（可参照 AskUserQuestion 卡片形态）。

**优先级**：中。
**状态**：✅ form 模式已实施（2026-09-01 批次 C：elicitation 以合成 toolName `mcp_elicitation` 走现有审批链路（agentState.requests，hub/shared 协议零改动）、web `ElicitationFormCard` 按 requestedSchema 渲染动态表单、answers 通道放宽 number/boolean、自写测试 MCP 验证。E2E 全链路通过：accept 回显 content number/boolean 原生类型（转型正确）、decline 绕过 required 直达 server。url 模式 decline 兜底 → pending #63。spec：`docs/superpowers/specs/2026-09-01-permission-tool-mcp-fidelity-design.md`；架构文档：`docs/architecture/tool-permission.md` 场景五）

---

## U-27. 动态能力发现：`supportedModels` / `supportedCommands` / `supportedAgents`

**来源**：SDK Query 方法——从运行中会话拉取可用模型列表、slash 命令、agent 定义。

**对 mobi 的价值**：模型选择器的权威数据源（当前 web 端模型列表走 hub metadata 静态维护，memory 有 metadata SWR 死循环的教训；SDK 列表天然与会话实际可用一致）；`supportedCommands` 可做 sender 的 `/` 命令补全；`supportedAgents` 校验 subagent 派发类型。

**落地位置**：cli 会话就绪后拉取上报 hub → web 模型选择器 / sender 补全。

**优先级**：中。
**状态**：✅ 已实施（2026-09-02 批次 G：commit b51cc557 + 01bc411c——launcher onQueryReady 经 discoverCapabilities 三方法落 metadata，extractSDKMetadataAsync 专用进程退场；E2E 验证通过。设计定稿 2026-09-02：`runClaude` 启动时经会话 Query 调三方法 → `updateMetadata` 落 hub，替换 `runClaude.ts` 的 `extractSDKMetadataAsync` 专用进程调用；extractor 本体保留服务 machine RPC（创建会话前兜底）。三方法在 WarmQuery 上不可用、须在提前激活创建的 Query 实例上调，锚点 `onQueryReady` 公共点；web 消费面核实恰为 models/commands/agents 三件套，`outputStyle/account/fastModeState` 零消费可丢。E2E（2026-09-02）：首轮会话 sdkMetadata models=5/commands=43/agents=5 非空、改名→Exit→resume 二次刷新后 `name` 等全部 metadata 字段保留、会话活跃期无第二个 SDK claude 进程——resume 窗口的瞬态 HEADLESS 进程经身份级采样归因为 hub 侧既有 refreshMetadata 兜底路径（首次激活补拉 + SWR），与本次退场的 CLI bootstrap extractor 无关）

---

## U-28. `includeHookEvents`——hook 生命周期事件入流

**来源**：SDK Options——开启后 `hook_started` / `hook_progress` / `hook_response` 系统消息进入输出流。

**对 mobi 的价值**：web 端可显示 hook 执行状态（正在跑什么 hook、耗时、结果），补全可观测性；与现有 settings 文件 hook-forwarder（跨会话观测）并存不冲突。

**落地位置**：cli 开 option → 消息分类器归 ephemeral → web hook 状态显示。

**优先级**：中低。
**状态**：❌ 不做（2026-09-02 裁定：用户确认暂不需要展示 hook 事件。mobi hook 面窄——自身跨会话 hook 毫秒级完成无显示价值；用户自配 hooks 的执行状态间接可从工具结果/回复异常感知。重启时机：出现「配了 hooks 但排查不了」的真实反馈）

---

## U-29. `title`——新会话预设标题

**来源**：SDK Options——新会话用自定义标题替代自动生成（resume 场景持久标题优先，改用 `renameSession`）。

**对 mobi 的价值**：当前 mobi 会话名在首条消息后由 CC 自动生成，web 端创建会话时可先起名并传 `title`，消除「先叫 untitled 后改名」的窗口；标题同步链路（memory：change_title 回写 customTitle）已有对应概念。

**落地位置**：cli query options 透传（web 创建会话时带初始名）。

**优先级**：中低。
**状态**：❌ 不做（2026-09-02 裁定：预设标题需要用户创建时手动输入，违背零操作预期；现状 agent 首聊经 `change_title` MCP 自动起名已覆盖无操作场景，首聊前的无名窗口仅数十秒占位。重启时机：用户出现「想创建时自己命名」的真实需求）

---

## U-30. `onUserDialog` + `supportedDialogKinds`——host 渲染 CLI 阻塞对话框

**来源**：SDK Options——CLI 通过 `request_user_dialog` 请求 host 渲染阻塞对话框（如 `refusal_fallback_prompt`）；host 须声明能渲染的 `dialogKind`，未声明的 fail-closed 走默认行为。

**对 mobi 的价值**：CLI 侧需要用户决策的阻塞场景不再静默走默认——web 端可渲染成对话框（形态类似权限审批），首期只接 `refusal_fallback_prompt` 一个 kind 即可。

**落地位置**：cli 接回调 + 声明 kinds → web 对话框渲染 → 结果回传。

**优先级**：低（kind 面目前很窄，出现更多 kind 后价值上升）。
**状态**：⏸️ pending #67（2026-09-02 裁定：缓——fail-closed 默认行为已可用（refusal 错误结束 turn，CC 自动 fallback 重试不受影响），接入是罕见场景下「错误提示 → 可交互对话框」的升级；等 dialogKind 通道扩为通用机制（kind 为开放 string，上游明示会新增）再一并接，一个 UI 承载多场景。机制认知详见 pending #67）

---

## ⚠️ 行为变化注意（非机会，mobi 侧需确认/适配）

以下为 07-08 ~ 08-31 升级批次中**改变 mobi 可见行为**的上游变化，不立项但需逐条确认现状无恙：

- **Todo/task 工具在新模型上默认移除**（SDK 0.3.233）——新模型会话不再产生 TodoWrite 调用，todo 渲染路径静默变空；需要时用 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` 或 `tools` 显式保留。**已适配（2026-09-02）**：曾保底注入 `=1`，裁定跟随上游默认不注入（新模型去掉外挂记忆拐杖是正向裁剪，mobi 忠实呈现；TodoPanel/任务面板优雅降级为空）；用户想要可在 settings.json `claudeEnv` 显式配 `'1'`
- **subagent 默认不再嵌套（depth 1）+ 并发上限 20**（SDK 0.3.217，2.1.224 又移除了每会话 200 个总数上限）——subagent 面板的层级/数量预期变化
- **auto-compact 对未知模型 ID 强制窗口钳制**（claude 2.1.223）——mobi 网关自定义模型名场景下上下文会按假设窗口提前压缩，可用 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 还原；与 pending #57（水位窗口猜测）联动评估
- **`canUseTool` 返回 allow 无 `updatedInput` 的契约修正**（SDK 0.3.207）——按文档契约以原始输入执行（此前被当 deny 报 ZodError）；确认 mobi `permissionHandler.ts` 的返回形态兼容
- **usage limit 重置后自动续跑**（claude 2.1.234，`/config` 可关）——会出现「无用户输入的 idle→running」迁移，mobi 会话状态机与 StatusBar 计时需能解释
- **后台任务通知轮间以 `<system-reminder>` 包裹投递**（claude 2.1.234）——消息流解析/渲染 system-reminder 的命中面变宽
- **Bash 输入重定向权限检查反复**（2.1.232 引入 2.1.233 回退）——权限规则覆盖范围在上游快速变动，审批 UI 不应假设特定语法必不触发

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
