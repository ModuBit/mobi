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

## 5. Web Worker 优化 SSE 后台连接稳定性

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
