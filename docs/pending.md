# 待确认逻辑

记录暂时跳过、稍后需要深入梳理的逻辑。

---

## 1. 消息推送逻辑与 VisibilityTracker 配合

**相关文件**：
- `packages/hub/src/push/pushNotificationChannel.ts`
- `packages/hub/src/push/pushService.ts`
- `packages/hub/src/visibility/visibilityTracker.ts`

**待确认**：
- Web Push 订阅流程
- `sendToast` vs `broadcast` 的使用场景区分
- VisibilityTracker 如何判断连接可见性
- 通知降级策略的完整逻辑

---

## 2. Web 端与 VisibilityTracker 配合

**相关文件**：
- `packages/hub/src/visibility/visibilityTracker.ts`
- `packages/hub/src/web/routes/events.ts`（`POST /api/visibility`）
- `packages/web/src/`（前端实现）

**待确认**：
- 前端如何监听页面可见性变化
- 前端何时调用 `POST /api/visibility`
- VisibilityTracker 的数据结构
- `hasVisibleConnection()` 的判断逻辑

---

## 3. Web 端 SSE 断连重连

**相关文件**：
- `packages/web/src/`（前端实现）

**待确认**：
- 前端如何监听 SSE 连接状态
- 断连后的重连策略
- 重连时的 token 处理

---

## 4. CLI 触发 Socket 事件的场景

**相关文件**：
- `packages/cli/src/`（CLI 客户端实现）

**待确认**：
- CLI 在什么场景下触发 `message`、`update-metadata`、`update-state` 等 Socket 事件
- CLI 在什么场景下触发 `machine-update-metadata`、`machine-update-state` 等 Socket 事件
- 触发位置在 CLI 代码的哪些文件

---

## 5. CLI - Hub - SyncEngine 事件流转整体流程

**相关文件**：
- `packages/cli/src/`（CLI 客户端）
- `packages/hub/src/socket/`（Socket.IO 服务器）
- `packages/hub/src/sync/syncEngine.ts`（同步引擎）
- `packages/hub/src/sync/eventPublisher.ts`（事件发布）
- `packages/hub/src/sse/sseManager.ts`（SSE 推送）

**待确认**：
- CLI 发送 Socket 事件 → Hub 接收 → SyncEngine 处理 → EventPublisher 广播 → SSE 推送 的完整链路
- 各环节的数据格式转换
- 事件类型在不同层级的映射关系

---

## 6. CLI 端 RPC 注册与响应

**相关文件**：
- `packages/cli/src/api/`（CLI 客户端）
- `packages/hub/src/socket/rpcRegistry.ts`（Hub 端注册表）

**待确认**：
- CLI 如何注册 RPC 方法（`rpc-register` 事件）
- CLI 如何响应 RPC 请求（`rpc-request` 事件）
- CLI 注册了哪些 RPC 方法
- RPC 响应处理器的实现位置

---

## 7. 前端 Web Push 订阅与 VisibilityTracker 配合

**相关文件**：
- `packages/web/src/`（前端实现）
- `packages/hub/src/web/routes/push.ts`（Push API）
- `packages/hub/src/visibility/visibilityTracker.ts`

**待确认**：
- 前端如何调用 `/api/push/subscribe` 和 `/api/push/vapid-public-key`
- 前端何时创建 Web Push 订阅（Service Worker 注册时机）
- VisibilityTracker 如何影响推送策略（页面可见时用 SSE，不可见时用 Web Push）
- 前端监听 `visibilitychange` 事件后如何与 Push 订阅联动

---

## 8. hub/cli 在编译嵌入模式下的使用方式

**相关文件**：
- `hub/packages/cli/src/index.ts`（入口，引用不存在的 `./commands/runCli`）
- `hub/packages/cli/src/bootstrap.ts`（编译产物入口）
- `hub/packages/cli/src/configuration.ts`（CLI 端配置适配）
- `hub/packages/cli/src/persistence.ts`（CLI 端持久化适配）

**待确认**：
- Hub 编译为独立可执行文件时，`hub/cli/` 如何与 `cli/` 的代码合并打包
- `hub/packages/cli/src/index.ts` 中 `import { runCli } from './commands/runCli'` 在编译时如何解析到 `cli/` 的代码
- `hub/cli/` 的 `configuration.ts` 和 `persistence.ts` 与 `cli/` 中同名文件的覆盖/合并关系
- `bootstrap.ts` 中禁用 Ink devtools 的原因和编译上下文

---

## 9. Mobi 系统中的 Web Server 盘点

**相关文件**：
- `packages/hub/src/index.ts`（Hub 入口）
- `packages/cli/src/runner/controlServer.ts`（Runner ControlServer）
- `packages/cli/src/commands/hook.ts`（Hook Server）

**已知信息**：

| 所属模块 | Server | 类型 | 用途 |
|----------|--------|------|------|
| Hub | WebServer | HTTP (Bun.serve + Hono) | REST API，服务前端 |
| Hub | Socket.IO Server | WebSocket | 与 CLI 双向实时通信 |
| Runner（machine 维度） | ControlServer | HTTP (Fastify) | CLI 命令与 Runner 进程通信 |
| CLI（session 维度） | HookServer | HTTP (Node `http`) | 接收 Claude SessionStart Hook 转发 |
| CLI（session 维度） | MCP Server | stdio (FastMCP) | 暴露 `change_title` 工具，随 Claude 会话自动启动 |

**待确认**：
- 各 Server 的监听地址和端口配置
- Hub 中 WebServer 和 Socket.IO Server 的启动顺序和依赖关系
- 各 Server 的生命周期管理（启动、关闭、异常处理）

---

## 10. 技术债：CLI 端 Web Server 框架不统一

**当前状态**：CLI 端两个 Server 使用不同实现
- Runner ControlServer → Fastify（已有 Zod schema 验证、类型化路由）
- HookServer → Node `http`（手写，1 个端点）

**目标**：按模块边界统一框架
- **CLI 端**：统一使用 Fastify（轻量，适合 CLI 工具）
- **Hub 端**：继续使用 Hono（功能强，适合服务端）

**改造范围**：
- `packages/cli/src/claude/utils/startHookServer.ts` — 从 Node `http` 迁移到 Fastify

---

## 11. Local 模式下 SubAgent 消息缺失

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

## 12. SDK 流式输出支持

**相关文件**：
- `packages/cli/src/claude/claudeRemote.ts` — Remote 模式主循环
- `packages/cli/src/claude/utils/sdkToLogConverter.ts` — 消息转换
- `packages/web/src/` — 前端消息展示

**当前状态**：
- `query()` 默认只返回完整的 `SDKAssistantMessage`（一轮完整输出）
- SDK 通过 `includePartialMessages: true` 选项支持流式输出
- 开启后 `for await` 会收到 `SDKPartialAssistantMessage`（`type: 'stream_event'`），包含逐 token 的 `BetaRawMessageStreamEvent`

**待确认**：
- 当前消息推送链路（`sdkToLogConverter` → `OutgoingMessageQueue` → Socket）是否需要调整以支持高频流式消息
- 前端消息渲染组件是否支持增量更新（逐 token 渲染）
- 流式模式下 `onMessage` 回调的调用频率对性能的影响
- Web 端实时打字效果的实现方案

## 13. Web 端权限审批"本次会话允许"功能未生效

**相关文件**：
- `packages/web/src/components/tool-card/PermissionFooter.tsx` — 权限审批 UI
- `packages/web/src/api/client.ts:138-143` — API 调用（approve/deny）
- `packages/hub/src/sync/rpcGateway.ts:70-86` — Hub 转发 RPC
- `packages/cli/src/claude/utils/permissionHandler.ts:270-281` — CLI 端判断逻辑

**状态**：✅ 已修复

**修复内容**：
- `PermissionFooter.tsx` 的 `approveForSession` 回调现在传递 `allowTools` 参数
- `approveAllEdits` 回调现在传递 `mode: 'acceptEdits'` 参数
- 移除了冗余的 `PermissionRequest.tsx`，权限按钮统一在 `ToolCallRenderer` 中渲染

---

## 14. Permission 系统重构

**相关文件**：
- `packages/cli/src/claude/utils/permissionHandler.ts` — Claude 专用权限处理器
- `packages/cli/src/modules/common/permission/BasePermissionHandler.ts` — 通用权限基类
- `packages/cli/src/claude/claudeRemote.ts` — SDK 集成点
- `packages/cli/src/claude/claudeRemoteLauncher.ts` — 生命周期管理
- `packages/web/src/components/tool-card/PermissionFooter.tsx` — Web 端审批 UI
- `packages/web/src/api/client.ts` — API 客户端

**现状问题**：

### 14.1 Web 端"本次会话允许"功能未生效（原 #13）✅ 已修复

- UI 三个按钮现在正确传递 `allowTools` / `mode` 参数
- `decision` 字段已标记为 deprecated，权限范围由 `allowTools` 和 `mode` 决定

### 14.2 ExitPlanMode 模式丢失

- `ExitPlanMode` 被批准后，`PLAN_FAKE_RESTART` 的模式取自 `response.mode`
- 由于 14.1 的问题，`response.mode` 永远为 `undefined`，硬编码为 `'default'`
- 如果用户原来在 `acceptEdits` 模式，Claude 进 plan 后退出，模式被降级为 `default`
- 应该记住进入 plan 前的原始模式，退出时恢复

### 14.3 EnterPlanMode 未被追踪

- Claude 在任何模式下都可能调用 `EnterPlanMode` 进入"软 plan 模式"
- PermissionHandler 没有追踪这个状态转换，`this.permissionMode` 不变
- 虽然 Claude 的 system prompt 会约束只使用只读工具，但 PermissionHandler 层面没有强制执行
- 如果 Claude 违反约束调用写工具，不会被自动拦截

### 14.4 "假拒绝"模式的可维护性

- `PLAN_FAKE_REJECT` + `PLAN_FAKE_RESTART` 机制是理解门槛较高的 hack
- `claudeRemoteLauncher.ts` 中需要额外拦截 `PLAN_FAKE_REJECT` 的 tool_result 并替换为 "Plan approved"
- 多处代码需要感知 plan mode 的特殊处理（`permissionHandler.ts`、`claudeRemoteLauncher.ts`、`getToolDescriptor.ts`）
- 散落在多个文件中的 plan mode 逻辑增加了维护负担

### 14.5 SDK 消息有损转换

- `sdkToLogConverter.ts` 的 `convert()` 方法丢弃了 `SDKUserMessage` 的 `isSynthetic`、`tool_use_result`、`priority` 字段
- 被注释掉的 sidechain UUID 注册代码（line 168-174）应确认是否需要并清理
- 考虑统一转换逻辑，避免静默丢弃字段

**重构方向**：
1. Web 端 API 补全 `allowTools` / `mode` 参数（优先级最高，修复 14.1 和 14.2）
2. PermissionHandler 增加 plan mode 状态追踪，支持 `EnterPlanMode` / `ExitPlanMode` 对称处理
3. 退出 plan 时自动恢复进入前的原始模式，而非硬编码 `'default'`
4. 评估是否有更好的模式切换机制替代"假拒绝"（取决于 SDK 是否提供运行时模式切换能力）
5. 清理 `sdkToLogConverter.ts` 中的注释代码和静默字段丢弃

---

## 15. Task 工具 prompt 展示应由前端处理

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

## 16. Web Worker 优化 SSE 后台连接稳定性

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

## 17. `-c`（continue）模式未复用已有 mobi session

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

## 18. Web 端支持渲染 Claude Code 的 Recap 消息

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

<!-- 模板：新增待确认项
## extractSDKMetadata 功能评估

**相关文件**：
- `packages/cli/src/claude/sdk/metadataExtractor.ts`
- `packages/cli/src/claude/runClaude.ts`
- `packages/shared/src/schemas.ts`

**待确认**：
- `extractSDKMetadata` 会启动一个额外的 Claude 会话（消耗 token、产生临时 session 文件），仅用于提取 `sdkMetadata`
- `sdkMetadata` 存储在 session metadata 中，但 hub 和 web 均未消费
- 斜杠命令通过 RPC `listSlashCommands` 从活跃会话实时获取，不依赖 `sdkMetadata`
- **结论**：当前实现是多余的，后续应考虑移除或从正式会话中复用元数据
-->

## 19. Remote 模式下 /clear /compact 命令的原生支持确认

**相关文件**：
- `packages/cli/src/claude/claudeRemote.ts` — Remote 模式主循环

**待确认**：
- Claude Agent SDK 的 `query()` 是否原生支持 `/clear` 和 `/compact` 命令（直接作为用户消息推送到 iterable）
- 当前实现在第一条消息时对 `/clear` 做了特殊处理（直接 return），对 `/compact` 设置标记后正常推送
- 如果 SDK 原生支持，这些特殊处理是否可以移除，统一作为普通消息推送

---

## 20. Remote 模式首条消息延迟优化（SDK 预热）

**相关文件**：
- `packages/cli/src/claude/claudeRemote.ts` — Remote 模式主循环
- `packages/cli/src/claude/claudeRemoteLauncher.ts` — Remote 启动器

**现状**：
- 切换到 remote 模式后，需要等用户发送第一条消息才会 `query()` spawn Claude Code 进程
- Claude Code 进程启动 + SessionStart hooks 执行需要数秒，导致首条消息响应延迟明显
- 曾尝试 SDK 预热（commit c0000e0）：用 `defaultMode` 立即调用 `query({ prompt: emptyAsyncIterable })`
- **预热失败原因**：AsyncIterable 模式下 SDK 不会发送 `init` 消息，直到第一条用户消息被推送到 iterable 并被 Claude Code 接收；而代码在 `init` handler 中等第一条用户消息，形成循环等待死锁
- 回滚预热，恢复原始流程

**待解决**：
- 找到正确的预热方案：在用户发送第一条消息前 spawn Claude Code 进程，消息到达后直接推送
- 关键约束：`init` 消息由 Claude Code 在收到第一条用户消息后才发送，预热方案不能依赖 `init` 作为消息注入时机
- 可能方向：并发等待第一条消息（与 for-await 并行），消息到达后推送到 iterable，SDK 读取后 Claude Code 发 init，for-await 正常处理

---

## 21. Snapshot 全量推送的带宽优化

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

## 22. Web 端权限审批支持 "Always Allow"（永久允许）

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
