# 待确认逻辑

记录暂时跳过、稍后需要深入梳理的逻辑。

---

## 1. 技术债：CLI 端 Web Server 框架不统一

**当前状态**：CLI 端两个 Server 使用不同实现
- Runner ControlServer → Fastify（已有 Zod schema 验证、类型化路由）
- HookServer → Node `http`（手写，1 个端点）

**目标**：按模块边界统一框架
- **CLI 端**：统一使用 Fastify（轻量，适合 CLI 工具）
- **Hub 端**：继续使用 Hono（功能强，适合服务端）

**改造范围**：
- `packages/cli/src/claude/utils/startHookServer.ts` — 从 Node `http` 迁移到 Fastify

---

## 2. Local 模式下 SubAgent 消息缺失

**相关文件**：
- `packages/cli/src/claude/utils/sessionScanner.ts` — SessionScanner 实现
- `packages/cli/src/claude/claudeLocalLauncher.ts` — Local 模式启动器
- `packages/cli/src/claude/claudeRemote.ts` — Remote 模式（对比参照）

**待确认**：
- SessionScanner 只监听主 agent 的 JSONL 文件（`~/.claude/projects/{hash}/{sessionId}.jsonl`），不监听 subagent 消息
- `findSessionFiles()` 只收集 `currentSessionId` + `pendingSessions` 的文件，不包含 subagent 文件
- Remote 模式通过 SDK 的 `query()` 迭代器天然获取所有消息（包括 subagent 的 tool use/result），Local 模式缺少这部分
- 是否需要补全 subagent 消息监听，以及 subagent 的 JSONL 文件路径规则

---

## 3. Permission 系统重构

**相关文件**：
- `packages/cli/src/claude/utils/permissionHandler.ts` — Claude 专用权限处理器
- `packages/cli/src/modules/common/permission/BasePermissionHandler.ts` — 通用权限基类
- `packages/cli/src/claude/claudeRemote.ts` — SDK 集成点
- `packages/cli/src/claude/claudeRemoteLauncher.ts` — 生命周期管理
- `packages/web/src/components/tool-card/PermissionFooter.tsx` — Web 端审批 UI
- `packages/web/src/api/client.ts` — API 客户端

**现状问题**：

### 3.1 ExitPlanMode 模式丢失

- `ExitPlanMode` 被批准后，`PLAN_FAKE_RESTART` 的模式取自 `response.mode`
- 由于之前的问题，`response.mode` 永远为 `undefined`，硬编码为 `'default'`
- 如果用户原来在 `acceptEdits` 模式，Claude 进 plan 后退出，模式被降级为 `default`
- 应该记住进入 plan 前的原始模式，退出时恢复

### 3.2 EnterPlanMode 未被追踪

- Claude 在任何模式下都可能调用 `EnterPlanMode` 进入"软 plan 模式"
- PermissionHandler 没有追踪这个状态转换，`this.permissionMode` 不变
- 虽然 Claude 的 system prompt 会约束只使用只读工具，但 PermissionHandler 层面没有强制执行
- 如果 Claude 违反约束调用写工具，不会被自动拦截

### 3.3 "假拒绝"模式的可维护性

- `PLAN_FAKE_REJECT` + `PLAN_FAKE_RESTART` 机制是理解门槛较高的 hack
- `claudeRemoteLauncher.ts` 中需要额外拦截 `PLAN_FAKE_REJECT` 的 tool_result 并替换为 "Plan approved"
- 多处代码需要感知 plan mode 的特殊处理（`permissionHandler.ts`、`claudeRemoteLauncher.ts`、`getToolDescriptor.ts`）
- 散落在多个文件中的 plan mode 逻辑增加了维护负担

### 3.4 SDK 消息有损转换

- `sdkToLogConverter.ts` 的 `convert()` 方法丢弃了 `SDKUserMessage` 的 `isSynthetic`、`tool_use_result`、`priority` 字段
- 被注释掉的 sidechain UUID 注册代码（line 168-174）应确认是否需要并清理
- 考虑统一转换逻辑，避免静默丢弃字段

**重构方向**：
1. PermissionHandler 增加 plan mode 状态追踪，支持 `EnterPlanMode` / `ExitPlanMode` 对称处理
2. 退出 plan 时自动恢复进入前的原始模式，而非硬编码 `'default'`
3. 评估是否有更好的模式切换机制替代"假拒绝"（取决于 SDK 是否提供运行时模式切换能力）
4. 清理 `sdkToLogConverter.ts` 中的注释代码和静默字段丢弃

---

## 4. Task 工具 prompt 展示应由前端处理

**相关文件**：
- `packages/cli/src/claude/claudeRemoteLauncher.ts:287-299` — 生成虚拟 user 消息
- `packages/cli/src/claude/utils/sdkToLogConverter.ts:237-257` — `convertSidechainUserMessage` 方法
- `packages/web/src/` — 前端渲染

**现状**：
- CLI 在检测到 `Task` 工具调用时，从 `tool_use.input.prompt` 提取内容，生成一条虚拟 sidechain user 消息发送到 Hub
- 目的是让 Web 端展示 subagent 的任务描述
- 但 `tool_use` 消息本身已包含完整的 `input.prompt` 数据，前端可以直接从 tool_use block 中读取并渲染

**问题**：
1. 多了一条不必要的网络消息
2. `convertSidechainUserMessage` 方法仅为此场景存在
3. 前端无法区分"用户真的说了这句话"和"subagent 的任务描述"

**重构方向**：
- 前端 Task 工具卡片直接从 `input.prompt` 读取并展示任务描述
- 移除 `claudeRemoteLauncher.ts:287-299` 的虚拟消息生成逻辑
- 移除 `sdkToLogConverter.ts` 的 `convertSidechainUserMessage` 方法

---

## 5. ~~Web Worker 优化 SSE 后台连接稳定性~~ ✅ 已解决（commit dcacf0a）

**真实根因**：`@microsoft/fetch-event-source` 默认 `openWhenHidden=false`，页面进入 hidden（切 tab / 最小化 / 切 app 触发 `visibilitychange`）时库内部主动 `abort()` 连接——是「切走即断」的**确定性原因**，与浏览器后台节流无关（原假设误判）。

**修复**：`packages/web/src/core/data/realtime/sseClient.ts` 显式配置 `openWhenHidden: true`（一行），后台保持 SSE 长连接。Web Worker 方案不再必要，已放弃。回归测试 `packages/web/tests/realtime/sseClient.test.ts` 锁定该配置。

> 以下为已废弃的原方案，保留备查（其中文件路径为重构前的旧路径）：

**相关文件**：
- `packages/web/src/realtime/sseClient.ts` — SSE 客户端
- `packages/web/src/providers/SSEProvider.tsx` — SSE Provider

**现状问题**：
- 浏览器在 Tab 失焦/最小化时会节流甚至静默断开 SSE 连接
- 当前通过 `onopen` 检测静默断开重连，但断连期间会丢失事件
- 后台 Tab 中的 `setTimeout` / `setInterval` 也会被节流，无法可靠检测断连

**改造方案**：
- 将 SSE 客户端移入 Web Worker 线程运行
- Web Worker 不受主线程节流影响，可保持 SSE 长连接
- 通过 `postMessage` 双向通信：
  - 主线程 → Worker：`connect` / `disconnect` 控制指令
  - Worker → 主线程：SSE 事件（`SyncEvent`）转发
- 主线程接收事件后照常更新 React Query 缓存

**架构示意**：
```
主线程 (React)                    Worker 线程
┌─────────────────┐              ┌─────────────────┐
│ SSEProvider     │  connect()   │ SSEClient       │
│ React Query     │ ───────────→ │ fetchEventSource│
│ UI Notification │ ←─────────── │ 事件监听        │
└─────────────────┘  postMessage └─────────────────┘
```

**改造范围**：
- 新建 `packages/web/src/realtime/sseWorker.ts`：Worker 入口，封装 SSEClient
- 修改 `packages/web/src/realtime/sseClient.ts`：抽取为 Worker 兼容的独立类
- 修改 `packages/web/src/providers/SSEProvider.tsx`：通过 Worker 管理连接

---

## 6. `-c`（continue）模式未复用已有 mobi session

**相关文件**：
- `packages/cli/src/agent/sessionFactory.ts:127-137` — `extractResumeSessionId` 只识别 `--resume` / `-r`
- `packages/cli/src/commands/claude.ts:137-141` — claude 参数透传

**现状**：
- `mobi --resume <sessionId>` 会通过 `extractResumeSessionId` 解析出 claudeSessionId，查找已有 Hub session 并复用其 tag
- `mobi -c`（continue，恢复最近一次对话）透传给 Claude Code 后，Claude 会恢复已有会话，但 mobi 端不识别 `-c` 参数
- 结果：同一个 Claude Code session 对应多个 mobi session

**原因**：
- `-c` 没有显式 session ID，需要从 Claude 的项目会话历史中查找最近的 session
- `extractResumeSessionId` 未覆盖 `-c` / `--continue` 参数

**待修复**：
- `extractResumeSessionId` 需要识别 `-c` / `--continue` 参数
- 当检测到 `-c` 但无显式 session ID 时，需通过 Claude 的项目会话目录（`~/.claude/projects/{hash}/`）或 Hub API 查找该工作目录下最近的 session，获取其 claudeSessionId 后走复用逻辑

---

## 7. Web 端支持渲染 Claude Code 的 Recap 消息

**相关文件**：
- `packages/web/src/components/chat/ChatContainer.tsx` — 消息渲染
- `packages/web/src/chat/` — 消息解析与归约
- `packages/cli/src/claude/utils/sdkToLogConverter.ts` — SDK 消息转换

**待确认**：
- Claude Code 在 resume 会话时会生成 recap 消息（对话摘要），当前 Web 端是否已正确识别和渲染
- recap 消息在 SDK 消息流中的 type / subtype 标识
- 前端消息解析器（messageParser / reducerTools）是否需要适配 recap 类型
- recap 消息的展示样式（折叠/展开、区分于普通消息）

---

## 8. Snapshot 全量推送的带宽优化

**相关文件**：
- `packages/cli/src/claude/utils/streamSnapshotSender.ts` — Snapshot 生成与发送
- `packages/web/src/components/ui/Markdown.tsx` — 前端逐字揭示渲染

**现状**：
- CLI 每 500ms 发送一次完整累积内容的 snapshot（非 delta），保证断线重连/刷新后内容完整
- 典型场景（5000 字符回复、20 个 snapshot）实际传输量约为增量的 20 倍
- 本地/局域网场景下带宽开销可忽略，可靠性收益远大于传输成本

**待优化场景**：
- Hub 部署到云端或同时有大量客户端连接时，重复传输会成为瓶颈
- 超长回复（5 万字符+ tool output）累积传输量可达 MB 级别

**优化方向（delta + checkpoint）**：
- 常规 snapshot 发送增量 delta（仅新增内容），客户端本地累积拼接
- 每隔 N 次（如 5 次）发送一次全量 checkpoint，用于客户端校验和断线恢复
- 客户端断线重连时，从最近 checkpoint 恢复后继续接收 delta
- 增加客户端累积状态管理和 delta 校验逻辑，复杂度中等

**优先级**：
- 低优先级，当前本地/局域网场景无需优化
- 当 Hub 上云或多客户端并发时再实施

---

## 9. Web 端权限审批支持 "Always Allow"（永久允许）

**相关文件**：
- `packages/web/src/components/chat/PermissionRequest.tsx` — 权限审批 UI
- `packages/web/src/components/tool-card/PermissionFooter.tsx` — 工具卡片内权限 UI
- `packages/cli/src/claude/utils/permissionHandler.ts` — CLI 端权限处理

**现状**：
- Web 端权限审批只支持：
  - 普通工具：Allow / Allow for session / Deny
  - Edit 工具：Allow / Allow all edits / Deny
- CLI 端支持 "Always allow"（写入项目/用户配置文件），Web 端暂不支持

**待实现**：
- Web 端增加 "Always allow" 选项
- 通过 SDK 的 `updatedPermissions` + `destination: 'projectSettings'` 持久化权限规则
- 需确认前端 UI 设计（避免选项过多）

**优先级**：
- 低优先级，当前会话内授权满足基本需求
- 后续根据用户反馈决定是否实现

---

## 10. Web 端消息列表长列表性能优化

**相关文件**：
- `packages/web/src/components/chat/ChatContainer.tsx`
- `packages/web/src/components/chat/buildBubbleItems.tsx`

**现状**：
- Ant Design X 的 `Bubble.List` 没有虚拟滚动，直接 `items.map()` 全量渲染
- 消息量持续增长时 DOM 节点线性增加，滚动卡顿

**优化方向**：
- 方案 A：渲染窗口控制（超出视口范围的消息从 DOM 移除，保留在内存中）
- 方案 B：引入 `rc-virtual-list` 虚拟滚动（需改造 Bubble.List）

**触发条件**：
- 实际使用中出现明显滚动卡顿时再实施
- 代码中标记 FIXME 提醒

---

## 11. Team Agent UI 支持 — Hook 状态追踪方案待实现

**相关文件**：
- `packages/hub/src/sync/teams.ts` — Hook 事件处理代码（已实现，待激活）
- `packages/hub/tests/sync/teams.test.ts` — Hook 处理测试（已通过）
- `packages/cli/src/claude/claudeRemote.ts` — SDK `hooks` option 配置点
- `packages/web/src/core/data/stores/teamAgentsStore.ts` — 待创建
- `packages/web/src/components/composer/TeamAgentPanel.tsx` — 待创建
- `packages/web/src/components/composer/TeamAgentCard.tsx` — 待创建

**设计文档**：`docs/superpowers/specs/2026-05-31-team-agent-support-design.md`（本地，gitignored）
**实施计划**：`docs/superpowers/plans/2026-05-31-team-agent-ui-support.md`（本地，gitignored）

**现状**：
- Hub 已实现 team state 提取（TeamCreate/Agent(team_name)/TaskUpdate/SendMessage），Task 1（hook 事件处理 + 测试）已完成并提交
- Web UI 组件（store + panel + card + 集成）尚未实现
- Team agent 的 **idle/completed 状态追踪**依赖 hook 事件输入数据

**核心问题 — SDK Hook 输入数据获取**：

| 方案 | 可行性 | 说明 |
|------|--------|------|
| `includeHookEvents: true` | ❌ 不可行 | `SDKHookStartedMessage` 只有事件名（`hook_event`），不含输入数据（`teammate_name`、`team_name` 等） |
| SDK `hooks` option JS 回调 | ✅ 可行 | 回调直接收到完整 `HookInput`（`TeammateIdleHookInput`/`TaskCompletedHookInput`），类型安全 |
| HTTP Hook Server 扩展 | ⚠️ 可行但重 | 需 shell 进程 + HTTP 中转，比 JS 回调重得多 |

**SDK `hooks` option 实现方式**：
```typescript
// claudeRemote.ts sdkOptions.hooks
hooks: {
  TeammateIdle: [{
    hooks: [async (input) => {
      // input: { hook_event_name: "TeammateIdle", teammate_name, team_name, session_id, ... }
      // 转发到 Hub
      return { continue: true }
    }]
  }],
  TaskCompleted: [{
    hooks: [async (input) => {
      // input: { hook_event_name: "TaskCompleted", task_id, task_subject, teammate_name?, team_name?, ... }
      // 转发到 Hub
      return { continue: true }
    }]
  }]
}
```

**暂停原因**：hooks 回调方案实现复杂度高（回调闭包 onMessage、IPC 双向通信、最小化阻塞等）

**无 hook 时的降级行为**：
- Member 生命周期：active → shutdown（无 idle）
- Task 生命周期：in_progress → completed（通过 TaskUpdate）
- 自动清理仅在 TeamDelete 时触发

**待完成（按实施计划顺序）**：
1. ~~Task 1: Hub teams.ts hook 处理~~ ✅ 已完成
2. Task 2: CLI 开启 hooks 回调并转发 team 相关事件
3. Task 3-8: Web 端 store + UI 组件 + 集成
4. Task 9: 集成验证

---

## 12. Web 端消息列表渲染性能优化 — reconcile 与增量 reduce 的取舍

**相关文件**：
- `packages/web/src/components/chat/ChatContainer.tsx` — 消息渲染容器
- `packages/web/src/components/chat/buildBubbleItems.tsx` — bubble 列表构建
- `packages/web/src/domain/chat/reducer.ts` — `reduceChatBlocks` 全量归约
- `packages/web/src/domain/chat/reconcile.ts` — `reconcileChatBlocks` 结构化共享（已实现，未接入）
- `packages/web/src/domain/chat/groupToolCalls.ts` — 工具组折叠

### 现状

- SSE 每推送一条新消息 → `useMessages` 返回新数组 → `reduceChatBlocks` 对**全部消息**执行 normalize → trace → reduce
- `reconcileChatBlocks` 已实现（逐字段对比新旧 block，未变化返回旧引用），但**调用者为 0**，从未接入渲染链路
- `Bubble.List` 无虚拟滚动（见 #10），DOM 节点随消息量线性增长
- 每次 SSE 事件产生全新 block 对象 → 下游 `React.memo`（`TextBlock` 等）无法生效 → 所有 bubble 重渲染

### 决策

- **当前**：接入 `reconcileChatBlocks`，保持全量 reduce 不变。Block 引用稳定 → `React.memo` 生效 → 未变化的 bubble 不重渲染
- **后续**（如全量 reduce 计算耗时成为瓶颈）：将 `reduceChatBlocks` 重构为 **stateful reducer**（维护 `toolBlocksById`、`pendingCompactMetadata`、trace 树等内部状态），实现真正的增量 reduce。这是一次大规模重构

### 实施路径

1. 补齐 `reconcile.ts` 和 `reducer.ts` 的单测
2. 在 `ChatContainer` 的 `useMemo` 中接入 `reconcileChatBlocks`
3. 确保 `buildChatBubbleItems` 及各 Block 组件的 `React.memo` 正确生效
4. 单测全部通过

---

## 13. 页面刷新后 Agent 执行状态丢失

**相关文件**：
- `packages/shared/src/messageClassification.ts` — `tool_progress` / `tool_use_summary` 分类为 `ephemeral`
- `packages/web/src/domain/chat/reducerTimeline.ts:94-111` — `agent-progress` 事件更新 ToolCallBlock 的 metrics/summary
- `packages/hub/src/sync/sessionCache.ts` — runtimeState（已有 backgroundTasks 同模式）

**现状**：
- `tool_progress` 和 `tool_use_summary` 被分类为 `ephemeral`：SSE 实时推送正常，历史查询时过滤
- Web 端通过 SSE 实时收到 `agent-progress` 事件，更新对应 ToolCallBlock 的 `agentMetrics`（token 消耗、工具次数）和 `agentSummary`
- **刷新页面后**：Hub 历史查询不返回 `ephemeral` 消息 → `agent-progress` 事件丢失 → ToolCallBlock 无 metrics/summary → 直到下一个实时 `tool_progress` 到来才恢复

**影响**：
- 功能无影响，仅体验上的小缺陷（agent 执行中间状态暂时空白）
- agent 执行完成后，最终指标通过 `tool_result` 的 `agentMetrics` 字段持久化在 ToolResult 中，不受影响

**评估过的方案**：

| 方案 | 做法 | 成本 | 决定 |
|------|------|------|------|
| runtimeState 存储 agentProgress | 在 `runtimeState.agentProgress[toolUseId]` 存最新 metrics/summary，复用 backgroundTasks 同模式 | 低（~70 行 + 测试） | 暂不实施 |
| 客户端缓存（localStorage） | 浏览器端缓存最新 agentProgress | 中，跨设备不一致 | 不采用 |
| 保留最近 N 条 ephemeral | DB 中仅保留每类最近一条 | 高，需新清理逻辑 | 不采用 |

**暂不实施原因**：
- 需要每条 `tool_progress` 到达时频繁更新 runtimeState（写入 DB）
- 需要额外清理逻辑（`tool_result` 到达时清除对应条目）
- 当前体验缺陷可接受，等下一个 `tool_progress` 自然恢复

---

## 14. 增加项目实体，替代基于 session path 的分组

**现状**：
- 没有"项目"概念，`SessionGroup` 是从 session 的 `metadata.path` 用 `extractGroupKey` 截取最后两段（如 `github/modu`）group 出来的
- `groupKey` 不是全路径，不能直接用作创建 session 的 `cwd`
- 新建会话时需要从该分组下的第一个 session 的 `metadata.path` 反推完整项目路径
- 当分组下没有任何 session 时，无法获取完整路径

**相关文件**：
- `packages/hub/src/store/sessions.ts` — `extractGroupKey` 截断路径逻辑
- `packages/hub/src/web/routes/sessionGroups.ts` — 分组 API
- `packages/web/src/core/data/api/types.ts` — `SessionGroup` 类型
- `packages/web/src/components/layout/SidebarProjects.tsx` — 侧边栏项目列表（当前用 session metadata.path 反推）

**改造方向**：
- 新增 `Project` 实体（独立于 session），存储完整项目路径、名称等元信息
- session 通过 `projectId` 关联项目，不再通过 path 截断 group
- `SessionGroup` API 改为 `Project` API，直接返回完整路径
- 侧边栏项目列表直接使用项目的全路径，无需反推

---

## 15. 项目列表分页/限制展示数量

**现状**：
- `SidebarProjects`（PC）和 `MobileMenuDrawer` 内嵌项目列表（Mobile）均全量展示所有项目折叠组
- 项目组本身是折叠的（只显示一行标题），占用空间小
- 项目数量从会话 path 聚合而来，当前场景下一般 3~8 个，不会无限增长

**潜在问题**：
- 引入 Project 实体（#14）后，用户可能手动创建/关联大量项目
- 长期使用后历史项目积累可能超过 20+，导致列表过长

**优化方向**：
- 默认展示最近活跃的 N 个项目（如 10 个），其余折叠到"更多项目"入口
- 或引入项目归档机制，归档后不在主列表展示
- 待 Project 实体落地后根据实际数据量决定

---

## 16. 通知角标跨端同步

**相关文件**：
- `packages/web/src/core/data/stores/notificationBadgeStore.ts` — 角标状态（一期前端本地）
- `packages/hub/src/notifications/` — 通知中心（未来扩展点）

**现状（通知重设计一期）**：
- ready/permission 角标仅在前端本地 store 维护（`sessionId → {ready, permission}`）
- 进 session 详情页时清零；跨设备不同步
- 多设备场景：设备1 收 toast 产生角标，设备2 不知道；用户在设备2 上看不到角标

**后续方向**：
- Hub 维护每个 session 的未读 ready/permission 计数（runtimeState 同模式）
- 前端通过 SSE / session 查询获取，跨设备一致
- 进详情页时上报"已读"，Hub 清零
- 代价：Hub 写入 + 清理逻辑，约中等复杂度

**触发条件**：多设备使用成为常态、用户反馈角标不一致时实施

---

## 17. ~~VisibilityTracker 与 /api/visibility 清理~~ ⛔ 不再适用（commit a56d549）

**原计划**（通知重设计一期）：通知链路曾改为「前端判定」，VisibilityTracker 一度不再被通知链路消费，计划移除 `VisibilityTracker` 类、`/api/visibility` 路由及前端 visibilitychange 上报。

**为何不再适用**：P0 投递策略分级（commit a56d549）重新启用 visibility 决策——`PushNotificationChannel` 通过 `sseManager.hasVisibleConnection()` 判定「有可见连接 → SSE toast（不打扰）/ 后台 + 有 push 订阅 → Web Push（SW 独立线程，长时后台可靠）/ 无 push 订阅 → SSE toast 兜底」。决策公式：`shouldUseToast = hasVisibleConnection(ns) || !hasSubscription(ns)`。

VisibilityTracker、`/api/visibility` 路由、前端 visibilitychange 上报已恢复为通知投递的**核心依赖**，不可清理。

**相关文件**（均为核心依赖，保留）：
- `packages/hub/src/visibility/visibilityTracker.ts` — 可见性追踪
- `packages/hub/src/web/routes/events.ts` — `/api/visibility` 上报路由
- `packages/web/src/core/providers/SSEProvider.tsx` — 前端 visibilitychange 上报

---

## 18. 通知重设计收尾清理项

通知重设计一期落地后的零散清理（均非阻塞，可独立小 PR）：

**相关文件**：
- `packages/web/src/components/layout/SidebarSessionItem.tsx` — 死代码组件
- `packages/web/src/core/pwa/registerSW.ts` + `packages/web/vite.config.ts` — SW dev 调试矛盾
- `packages/web/src/core/data/hooks/useNotificationSetup.ts` — namespace 死参数

**待清理**：
- **SidebarSessionItem 死代码**：全项目无引用（实际侧边栏用 `SessionList` 的 `@ant-design/x` `<Conversations>`）。删除避免未来误改（本次 Unit 5 曾误在其上加角标，review 才发现）
- **SW dev 调试矛盾**：`vite.config.ts` `devOptions.enabled: true` 但 `registerSW.ts` 在 `import.meta.env.DEV` 跳过 SW 注册 → dev 模式 SW 构建但不注册。如需 dev 调试 SW（push），需对齐两者（pre-existing，非本次引入）
- **useNotificationSetup namespace 参数**：当前 `void namespace` 占位（hub 从 token 解析 namespace，client 不传）。若确认未来 unsubscribe 也不需要 client 传 namespace，可删参数（YAGNI）；reviewer 评估为「尊重预留决策」，非必须改
- **测试补充**：`usePwaMode` 的 change/unmount 路径、`useNotificationSetup` 的 subscribe 失败路径，可补测试锁死行为

**优先级**：低，一期功能完整；稳定后逐项清理

---

## 19. Web 端首屏加载体积优化

**相关文件**：
- `packages/web/vite.config.ts` — 构建配置（无 manualChunks 分包策略）
- `packages/web/src/router.tsx` — 路由（静态 import 所有页面，无懒加载）
- `packages/web/package.json` — 依赖清单（含 `three` 死依赖）
- `packages/web/src/components/terminal/TerminalView.tsx` — 终端视图（`@xterm` + addons）
- `packages/web/src/components/ui/Markdown.tsx` — markdown 渲染入口

**现状**（实测 2026-06-16）：

| 模式 | 体积 | 请求数 | 说明 |
|------|------|--------|------|
| dev（vite dev）| ~40MB | ~350 | 预构建不压缩/不分包/不 tree-shake，**正常现象，不代表线上** |
| prod（dist）| 11MB | — | 主 JS `index-*.js` 3.4MB（gzip ≈ **1MB**）|

**手机端慢的真实判断**：
- dev 体积是 prod 的 ~4 倍，移动网络下加载 40MB 必然慢（1 分钟+）—— **不该用 dev 模式评估手机体验**
- 但即便 prod，首屏 JS gzip ~1MB 对远程控制工具仍偏重，手机弱网/低端机下仍慢，有真实优化空间

**dev 预构建体积大头**（`node_modules/.vite/deps` 实测）：

| 文件 | dev 大小 | 说明 |
|------|---------|------|
| `es-CdRkq_LD.js` + `es-B4a07Xbr.js` | 3.1M + 2.3M | 疑架构图/可视化传递依赖（src 无直接引用，待定位归属）|
| `@ant-design_x.js` | 1.3M | Ant Design X（AI 组件库，核心依赖）|
| `lucide-react.js` | 1.1M | 图标库（dev 全量；prod 按需 import 会 tree-shake）|
| `cytoscape.esm` | 848K | 图布局库（src 无直接引用，疑传递依赖）|
| `motion` / `katex` | 520K / 484K | 动画 / 数学公式（+ 一组 KaTeX 字体）|
| `@xterm/xterm` | 404K | 终端（仅终端页需要）|
| `highlight.js` | 220K | 语法高亮 |

**已确认的问题点**：
1. **无路由懒加载**：`router.tsx` 静态 import `LoginPage`/`SessionDetailPage`/`NewSessionPage`/`SettingsPage`，所有页面代码进首屏
2. **`three` 死依赖**：`package.json` 声明 `three`，`src` 无任何引用 → 直接删除
3. **markdown/语法高亮栈重叠**：`marked` + `@ant-design/x-markdown` + `react-syntax-highlighter` + `highlight.js` 四套并存，有去重空间
4. **`cytoscape` + `es-*` 体积最大**（dev 合计 ~6M），但 `src` 无直接引用 → 需定位是哪个库的传递依赖，评估是否必需

**已做好的**：
- `vconsole`（276K）通过动态 `import()` 按需加载，未触发不进 bundle ✅

**优化方向（按 ROI 排序）**：
1. **路由级懒加载**：`SessionDetailPage`/`NewSessionPage`/`SettingsPage` 改 `React.lazy` + `Suspense`，首屏只保留登录/列表必需代码
2. **终端懒加载**：`@xterm` + addons 动态 import 到 `TerminalView`，非终端页不加载
3. **删 `three` 死依赖**
4. **定位 `cytoscape`/`es-*` 传递依赖来源**：用 `rollup-plugin-visualizer` 做 prod 产物分析，确认归属后按需/移除
5. **markdown 栈去重**：评估四套库的重叠，统一到一套
6. **确认 `lucide-react` 按需 import**（`import { X } from 'lucide-react'`，非 `import *`）

**目标**：首屏 JS gzip 压到 400-500KB 以内。

**优先级**：中。手机端（弱网/低端机）是核心场景，prod 首屏 ~1MB 在弱网下仍慢。

**触发条件**：先用 `bun run build && bun run preview` 在手机验证 prod 真实体积（而非 dev），确认仍是痛点后再按 ROI 实施。

## 20. 多 tab 同账号 sendToast 照投打扰（边缘场景，暂不处理）

**现状**：`sseManager.sendToast` 投递给该 namespace 所有活跃连接（含 hidden），这是有意设计——后台 tab 由前端收到后转系统通知（单 tab 后台兜底，无 push 订阅时也能收到）。

**边缘场景**：同账号开多 tab，visible tab 正盯某 session（`decideToastAction` 返回 ignore），hidden tab 仍弹系统通知，绕过 ignore 语义；或 visible+hidden 并存时同一事件收到 antd toast + 系统通知两次打扰。

**为何暂不处理**：多 tab 同账号非 mobi 目标场景（个人单用户单 tab 为主）。改 `sendToast` 按 visible 过滤会破坏单 tab 后台兜底（需重新设计 `trySendToast` 决策树），投入产出比低。

**触发条件**：多 tab 同账号成为常态、用户反馈后台 tab 误弹系统通知时实施。

**相关文件**：
- `packages/hub/src/sse/sseManager.ts` — `sendToast` 投递所有活跃连接
- `packages/web/src/core/notifications/toastDecision.ts` — 前端三分支决策
- `packages/web/src/core/providers/SSEProvider.tsx` — toast 处理分支

---

## 21. ~~Lint P1 清理遗留的签名/契约不一致~~ ✅ 已解决（commit `8874481`，2026-06-19）

**已修复**：
- **I-1**：`generateLaunchdPlist` / `installLaunchd` 删 host/port 死参（plist 模板不用，靠 wrapper script 传递），与 `generateSystemdUnit()` 无参对齐。host/port 现只流向真正消费它的 `generateWrapperScript`。
- **I-2**：`SidebarProjects.handleRenameConfirm` 删 `_sessionId` 死参（用 `renamingSessionId` state），`ProjectGroup.onRenameConfirm` 改无参，与 `SessionList` / `MobileProjectList` 统一。
- **M-1/M-2/M-3**：按 reviewer 评估跳过（`Record<string,never>` 合格、`let stderr: string` 保留更优、catch 注释内联更好）。

验证：typecheck 0 error、test 全过（shared 155 / cli 277 / web 623）、lint 101 不变（`_` 参数本被 `^_` 抑制，删除不改变 warning 数）。

> 以下为修复前的原记录，保留备查：

P1 lint 清理（commit `7c79400`~`b7a1fce`，lint 244→101）中，对 unused-vars 用 `_` 前缀掩盖了 2 处**既有的**签名/契约不一致（非 lint 引入，`_` 只是让它们不报警）。功能正常，但应单独排查：

**I-1 签名/实现不对称**：`packages/cli/src/setup/serviceManager.ts` `generateLaunchdPlist(_host, _port)` — 签名带 host/port 参数，但 plist 模板不使用（host/port 在 wrapper script 生成时硬编码）。对比同文件 `generateSystemdUnit()`（无参）。建议改签名删参与 systemd 对齐，或确认 plist 确需 host/port 后补上逻辑。

**I-2 prop 契约不一致**：`packages/web/src/components/layout/SidebarProjects.tsx` `handleRenameConfirm(_sessionId)` 与 `onRenameConfirm` prop 契约 `(sessionId: string) => void` 不符；同项目 `SessionList.tsx:157`、`MobileProjectList.tsx:447` 的同名 handler 均无参。建议统一契约（都带 sessionId 或都不带）。

**可选小改进（非必须）**：
- `registerKillSessionHandler.ts` `Record<string, never>` 可简化
- `claudeRemote.ts` `let stderr: string` 类型注解可省（保留也合理）
- `sandboxManager.ts` 两处相同 catch 注释可提取 helper

**优先级**：低（非阻塞，功能正常；`_` 前缀已让 lint 通过）。

---

## 22. session 关闭后文件浏览降级到 machine 级 handler（调研）

**背景**：InspectorPane 的文件浏览（`list-directory`/`read-file`）走 **session 级 RPC**，handler 注册在每会话子进程（`mobi claude`）里——子进程退出（session 关闭）即失效，报 "RPC handler not registered"。当前用「恢复会话」覆盖层引导用户 resume（`InspectorPane` `!active` 时早返回 resume 层）。此为与 hapi 一致的正确兜底，但意味着 session 关闭后**完全无法浏览文件**。

**相关文件**：
- `packages/cli/src/api/apiSession.ts:89` — session 级 `registerCommonHandlers(metadata.path)`（含 `listSessionDirectory`/`readSessionFile`）
- `packages/cli/src/api/apiMachine.ts:97` — machine 级 `registerCommonHandlers(process.cwd())`（runner 守护进程，已注册同款 handler，scope 前缀 `machineId:`）
- `packages/hub/src/sync/rpcGateway.ts:223,211` — `listSessionDirectory`/`readSessionFile` 走 `sessionRpc`，无 fallback
- `packages/hub/src/web/routes/sessions.ts:463` — `GET /sessions/:id/list-directory` 路由
- `packages/web/src/components/session/InspectorPane.tsx` — 当前 `!active` resume 覆盖层

**待调研方案（借鉴 hapi 未走通的思路）**：
mobi 的 runner 守护进程**已注册**一份 machine 级文件/目录 handler（`apiMachine.ts`，与 session 级同方法名、不同 scope 前缀）。理论上可让 hub 在 session 级 RPC 抛 "not registered" 时**降级到 machine 级 RPC**，用 `session.metadata.path` 作为 workingDirectory，从而 session 关闭后仍能浏览该项目的文件。

**关键不确定点**（需验证后再决定是否实施）：
1. machine 级 handler 的 cwd 是 runner 启动时的 `process.cwd()`，**不一定是目标 session 的项目目录**——多项目场景下 machine 级 handler 用哪个 cwd？是否支持按 session.metadata.path 动态指定？（hapi 的 `ListMachineDirectory` 带 cwd 参数，mobi 需确认）
2. terminal 无法降级（纯 socket 转发，必须 session 子进程在线）——本方案仅对「文件浏览」有效
3. 权限边界：machine 级 handler 绕过 session 级审计，需评估安全影响（任意 session 关闭后都能读其项目文件？）

**hapi 对照**：hapi runner 也注册了 machine 级 `ReadFile`/`ListDirectory`/`Bash`（`hapi/cli/src/api/apiMachine.ts:95`），但其 hub 路由**未实现** sessionRpc→machineRpc 的 fallback（`rpcGateway.ts:286-289` 找不到 socket 直接抛错），所以 hapi 实际也未做到 session 关闭后文件可用。mobi 若实施，需自补这层 fallback。

**决策**：暂不实施。当前 resume 覆盖层方案足够；待「session 关闭后仍需查看文件」成为明确需求、且上述 cwd/安全问题有结论后再评估。

**优先级**：低，按需触发。

---

## 23. 会话附件上传（web → hub → cli）流式传输优化 ✅ 已完成

**完成摘要**（对称下载侧 readFileRange，2026-06-25）：
- web↔hub：axios POST 二进制 Blob body（浏览器 chunked 流式 + `onUploadProgress` 进度 + `AbortController` 取消），替换 FormData→multipart→base64
- hub↔cli：`writeFileRange` 分块写 RPC（`emitWithAck` 串行 = 天然背压），替换 base64 整包 `uploadFile`
- hub 端点二进制流式：`c.req.raw.body` reader 聚合 256KB（`uploadStream` 共享管道）+ 中断清理半成品 + 三道大小闸（Content-Length 413 / totalSize 预校验 / 累计 written 兜底）
- cli `writeFileRange` 无状态分块写（`open` + `fd.write(position=offset)`）+ offset 越界防御（stat 校验）+ 扩展名/path 遍历/cwd 安全
- 进度 UI：`FileAttachment.progress` + `onProgress` 节流（每 5%/100ms）+ `AttachmentItem` Progress 圆环
- 测试：cli handler 10 用例 + `uploadStream` 9 用例（聚合/背压/cli拒绝/reader中断/不完整清理）+ rpcCall 二进制往返 4 用例 + 端点集成 + E2E（100KB/500KB md5 一致）

**关键发现：@socket.io/bun-engine 0.1.1 发送二进制附件 bug**
- bun-engine 自带的 parser `encodePacket` 仅认 `Buffer.isBuffer(data)`，对 `Uint8Array`（socket.io 二进制附件的实际类型）走 else 分支字符串拼接 → cli `parse error` 断连
- 这解释了为何下载侧（cli→hub readFileRange，bun-engine **接收**方向）工作，而上传侧（hub→cli writeFileRange，bun-engine **发送**方向）失败
- bun-engine 0.1.1 是 npm 最新（2026-04-23），bug 未修；官方 `engine.io-parser` 5.2.3 处理正确但 bun-engine 没复用
- **修复**：`patches/@socket.io%2Fbun-engine@0.1.1.patch`（`Buffer.isBuffer` → `ArrayBuffer.isView`，对齐官方 parser），`bun patch` 持久化 + `package.json` patchedDependencies，重装自动应用

**遗留（低优先，非本次范围）**：
- 中断清理的边界（`--max-time` 极短导致首块未 flush，无 path → 不触发 cleanup）——实际用户取消场景（AbortController）会经 hub reader.read() 抛错触发清理，已覆盖；curl 极短超时是测试 artifact
- bun-engine patch 待上游修复后可移除（关注 0.1.2+ 版本）

---



## 24. 文件流式端点（`/read-file`）quality review 遗留项

Task 5（commit `28acf9a`，hub 流式端点）code quality review 通过，以下非阻塞项待后续评估：

**I3 — ENOENT/越权 应映射为 404/403（当前 500）**：
- `packages/hub/src/web/routes/sessions.ts` 的流式端点：`readFileMeta` 失败（含 cli ENOENT、validatePath 越权）统一返回 500
- 语义不准：文件不存在应为 404，路径越权应为 403，前端难以区分「文件没了」vs「cli 挂了」
- 方向：cli `readFileMeta` handler 区分 ENOENT 单独返回标志，或 hub 端按 error 字符串轻量映射（`/ENOENT|no such file/i` → 404，validation 类 → 403）

**I4 — suffix range（`bytes=-N`）当前返回 416**：
- 正则 `^bytes=(\d+)-(\d*)$` 不匹配 `bytes=-5`（RFC 7233 表示「最后 5 字节」）→ isRange=false → 命中 416 分支
- 影响：浏览器 `<video>` seek 末尾、`<audio>` 流式、curl `--range -N`/aria2 等会发 suffix range，当前拿不到数据
- 取决于 Task 6/7 预览方式：若 fetch 手动分片（发 `bytes=start-`）则无影响；若 `<video src>` 原生标签则需补 suffix（正则加 `(\d*)-(\d+)` 分支 + `start = max(0, size-N)`）

**M2 — sessions.ts read 类端点可抽模块**：
- 流式端点 +82 行后 sessions.ts 持续膨胀，Task 8 移除旧 readFile 后若 read 类端点（read-file + 未来 list/search）继续膨胀，可抽 `readFileRoute.ts`。当前内联合理，YAGNI。

**相关文件**：`packages/hub/src/web/routes/sessions.ts:492-581`

**优先级**：低，Task 8 收尾或 Task 6/7 预览方式定了后评估。

---

## 25. ~~P3 图片浏览器缓存（SW 方案）搁置~~ ✅ 已解决（cookie 改造 + src 直连）

**原方案**（搁置）：SW 拦截 `/read-file` 注入 token + Cache API（pending #19 复杂）。

**实际解决（2026-06-22）**：cookie 认证改造（C-T1/T2/T3）后，`<img src="/api/sessions/:id/read-file?path=">` 直连带 cookie → 认证通过 → **浏览器原生 HTTP 缓存白送**（端点 ETag + Cache-Control `private, no-cache` → 协商 304）。无需 SW。ImageContentView（M-T1）从 objectURL 改 src 直连。SW 方案不再需要。

**相关文件**：`packages/web/src/components/files/ImageContentView.tsx`（src 直连）、cookie 改造（C-T1/T2/T3）

**状态**：已解决，关闭。

**背景**：用户最初诉求「图片加浏览器缓存，避免重复获取」。当前图片走 `URL.createObjectURL(blob)`（`blob:` 协议，不走浏览器 HTTP 缓存），原因是 `/read-file` 端点要 token 认证，`<img src>` 带不了 Authorization header。

**SW 方案（已设计未实施）**：
- `packages/web/src/core/pwa/sw.ts`（mobi 已有 SW 基建，Web Push 在用）加 fetch 拦截 `/read-file`，透明注入 Authorization header + Cache API 缓存
- token 传递：web postMessage → SW（+ IndexedDB 兜底，防 SW 重启丢 token）
- 缓存策略：stale-while-revalidate（返回缓存 + 后台 etag 更新）
- `ImageContentView` 从 objectURL 改为 `<img src={端点URL}>` 直连（SW 接管）

**搁置原因（2026-06-21 用户决策）**：SW 方案复杂度高（token 传递 postMessage+IDB / 缓存策略选择 / 拦截范围 / SW 重启 token 丢失一致性），收益（图片浏览器缓存）相对核心功能（流式管道 + 高亮 + markdown + etag）是边际的。

**现状可接受**：
- 图片 objectURL 直显（P0）+ 5MB 阈值（P1）
- react-query cache：切 tab 回来命中缓存（不重复下载），非浏览器 HTTP 缓存但功能上「不重复获取」
- etag 协商（P4）：meta refetch 时浏览器层可能 304

**待后续**：若图片重复获取成为体验瓶颈、或 SW 基建为其他需求（如离线）扩展时，再实施此方案。

**相关文件**：`packages/web/src/components/files/ImageContentView.tsx`、`packages/web/src/core/pwa/sw.ts`、`packages/web/src/core/pwa/registerSW.ts`

**优先级**：低，按需触发。

---

## 26. 评估是否换掉 `@socket.io/bun-engine`（触发式，非现在）

**背景**（2026-06-25）：上传流式管道（#23）定位到 `@socket.io/bun-engine` 0.1.1 的发送方向二进制附件 bug（`parser.encodePacket` 用 `Buffer.isBuffer` 判断，对 `Uint8Array` 走字符串拼接 → cli `parse error`）。已用 `bun patch` 修复（`patches/@socket.io%2Fbun-engine@0.1.1.patch`：`Buffer.isBuffer` → `ArrayBuffer.isView`，对齐官方 engine.io-parser）。

**为何现在不换**（触发式评估，不是立即行动）：
- patch 是 **1 行 + skill 维护流程**（upgrade-deps 第七步覆盖移除/迁移/重做），维护成本近乎零
- 「维护不活跃」对 patch 反而**有利**：它不更新 → patch 绑定 0.1.1 永远有效；真正风险是 bun-engine **别的 bug** 没人修，而非 patch 本身
- 换方案代价高于收益：
  - `@rvncom/socketio-bun-engine`（社区 fork）：从**官方包**换到**单人维护 fork**，信任降级，未必更稳
  - 默认 engine.io + ws：失 Bun 原生 WS + 重新引入 ws-on-Bun 兼容性赌注（这正是 bun-engine 当初要规避的）+ 全链路 E2E 回归（terminal/session/machine/upload 全走 socket）

**GitHub 现状**（2026-06-25 查证）：
- `socketio/bun-engine` 官方 issue 仅 [#8](https://github.com/socketio/bun-engine/issues/8)/[#9](https://github.com/socketio/bun-engine/issues/9) + 0 PR，无人报告此 binary bug
- 社区已有 fork [@rvncom/socketio-bun-engine](https://github.com/rvncom/socketio-bun-engine)（v1.1.5，含 bug fix + active maintenance）佐证 bun-engine 确有未修痛点
- socket.io 生态有大量同方向 binary 问题（[#3143](https://github.com/socketio/socket.io/issues/3143) server 收 Uint8Array 变 Object / [socket.io-parser #78](https://github.com/socketio/socket.io-parser/issues/78) binary 附件不解码 / [#4828](https://github.com/socketio/socket.io/discussions/4828) Bun 替换 ws 的行为差异）

**换方案的触发条件**（出现任一即重新评估）：
1. bun-engine 出了**别的、patch 修不动的 bug**（不活跃 = 没人修，致命）
2. `@rvncom/socketio-bun-engine` 证明**长期稳定 + 社区广泛采用**（从单人项目变可信）
3. socket.io 官方**明确放弃** bun-engine
4. 项目遇到 bun-engine 的**另一个阻塞问题**（那时一次性换掉，回归成本摊销）

**备选方案**（触发时评估）：
- A. 换 `@rvncom/socketio-bun-engine`（同 Bun 原生 WS 架构，迁移成本最低）
- B. 换默认 engine.io + ws（官方但失 Bun 原生性能 + ws-on-Bun 兼容回归）
- C. hub→cli 二进制段改 base64（绕过，膨胀 33% 仅内网段，半改善）

**优先级**：低，触发式。无触发信号则保持 patch 现状。

---

## 27. ~~dev 环境终端 WebSocket 受 Vite 8 + Bun proxy 阻塞~~ ✅ 已解决

**真实根因**：这是三个叠加问题，不是单一的 `destroySoon()`：

1. Vite Web 端口与 Hub 端口不同，proxy 默认保留 Web Origin；Hub CORS 因此返回 403 `Origin not allowed`。
2. Vite 8 的 WebSocket proxy 在 Bun runtime 下无法可靠转发 upgrade tunnel；即使 `rewriteWsOrigin` 后 Hub 返回 101，浏览器连接仍会失败。
3. 失败响应/异常断开路径调用 Node `socket.destroySoon()`，而 Bun socket 未实现该方法，导致整个 Vite dev server 崩溃。

**修复**：
- terminal 在 dev 构建中通过 `__MOBI_HUB_URL__` 直连 Hub，绕过损坏的 Vite WS tunnel；production 仍使用 `window.location.origin`。
- dev/e2e profile 明确将 Web origin 加入 `CORS_ORIGINS`，允许浏览器跨端口直连。
- 移除已无调用方的 `/socket.io` proxy；不保留 Vite patch，避免维护一条业务不再经过的死链路。
- 同时修正 E2E 暴露的 Web→Hub 事件名错配：`terminal:open` → Hub 实际监听的 `terminal:create`。

**验证**：dev E2E 中 terminal 状态为 connected，PTY 显示 shell prompt，执行 `printf '__MOBI_DEV_WS_OK__\\n'` 后输出 marker。

---
