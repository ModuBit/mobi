# 消息生命周期：从 SDK 到 UI

本文档追踪一条消息从 Claude Agent SDK 产生，经过 CLI 转换、Hub 存储、SSE 同步，到 Web 端标准化、归约、最终渲染的完整路径。重点关注：哪些消息被丢弃、哪些被处理、每一步的转换规则是什么。

## 全局流程

```mermaid
flowchart LR
    SDK["Claude Agent SDK<br/>SDKMessage"]
    CLI["CLI<br/>SDKToLogConverter"]
    HUB["Hub<br/>SQLite + SSE"]
    WEB["Web<br/>normalize → reduce → render"]

    SDK -->|"user / assistant / system / result"| CLI
    CLI -->|"过滤 result<br/>转换 RawJSONLines"| HUB
    HUB -->|"DecryptedMessage"| WEB
```

---

## SDK 消息类型与 mobi 三层类型体系（2026-08-25 钉死）

一条消息从产生到渲染经过**三层类型体系**，层层不同、不可混谈：

```mermaid
flowchart LR
    SDKT["① SDK 标准类型<br/>SDKMessage（type + subtype）"]
    ENV["② mobi 信封<br/>{role, content.type, data}"]
    EVT["③ web 领域事件<br/>AgentEvent（派生）"]
    SDKT -->|"apiSession.sendClaudeSessionMessage<br/>原样塞进 data"| ENV
    ENV -->|"normalize / normalizeAgent<br/>从 data 派生"| EVT
```

### ① SDK 标准类型（官方 `SDKMessage` 联合，按顶层 type 分组）

| type | subtype / 说明 | 落库 |
|---|---|---|
| `assistant` | 模型输出；子代理的也是此类型，靠 `parent_tool_use_id` 区分主线/子链 | persistent |
| `user` | 用户输入 / **tool_result**（工具执行结果回传，同 type） | persistent |
| `result` | **turn 结束总结**（`usage`/`modelUsage`/`total_cost_usd` 独家携带）；subtype: success / error_* | persistent |
| `stream_event` | 裸 SSE 事件透传（message_start 等，`includePartialMessages` 开启才有）；**只对主 session**（SDK 契约，子代理请求不走此通道） | 不走落库（快照通道专用） |
| `system` | `init`（会话初始化）、`compact_boundary`（压缩边界，带 `post_tokens`）、`conversation_reset`（/clear）、`status`、`task_started`/`task_updated`/`task_notification`/`background_tasks_changed`（后台任务）、`vcs_state_changed`（git 状态）、`informational`、`permission_denied`、`worker_shutting_down`、`commands_changed` 等 | 多数 persistent，部分 ephemeral |
| `tool_progress` | 工具执行心跳（约 30s） | ephemeral |
| `tool_use_summary` | 工具组人话摘要 | ephemeral |
| `prompt_suggestion` | 下一步输入建议 | ephemeral |
| `auth_status` / `rate_limit_event` / `command_lifecycle` | 认证 / 限流 / 排队回执 | discard |
| `system` 杂项 | `thinking_tokens`、`hook_*`、`plugin_install`、`files_persisted` | discard |

SDK 类型集**持续演进**（加法式新增），mobi 分类采用黑名单就是为了不误伤未知新类型（默认 persistent）。

### ② mobi 信封（CLI→Hub 落库形态，`apiSession.sendClaudeSessionMessage`）

```json
{ "role": "agent", "content": { "type": "output", "data": { …SDK 原始消息原样… } }, "meta": { "sentFrom": "cli" } }
```

- `role`：仅 `user`（真用户输入）/ `agent`（其余一切，含 system/result）
- `content.type`：`output`（CLI 上报 SDK 消息）；webapp 用户输入的 content 是**block 数组**（AG-UI 对齐的 `UserContentBlock[]`，text/image/document/quote 四型，见 shared `userContentSchema.ts`）或兼容旧格式的 `text`
- **`data` 是 SDK 原始消息的不透明透传**（`type`/`subtype`/`message.usage` 原样保留）——从 DB 取 SDK 字段直接下钻 `data.xxx`，无 mobi 改写（见 pending #56「投影税」）
- 用户消息**写入侧统一归一**：hub `sendMessage` 经 shared `normalizeUserContent` 把 string / 旧平铺 `{type:'text',text,attachments}` / 新格式三形态归一为 block 数组落库；读取侧 web 端由同一函数归一（存量零迁移）

### ③ web 领域事件（`normalizeAgent.ts` 派生，与 SDK 无对应关系）

`turn-result`（← result）、`compact`/`microcompact`（← compact_boundary 等）、`bg-task-*`（← task_* 系列）、`aborted`、`tool-progress` 等——纯渲染语义，由 ① 的消息**派生**，不回写。

### usage 账本两把尺子（易混，2026-08-26 实测钉死）

| | `result.usage` | assistant `message.usage`（stream_event 侧） |
|---|---|---|
| 口径 | turn 内主循环所有请求的**逐项累计**（实测 255232 = 127488+127744）——流量表 | 单次请求快照——油量表 |
| 数据落点 | result 消息顶层 | `message_start`（input/cc/cr 输入三项为终值）+ `message_delta`（累计 `output_tokens` 终值；三项亦可回填非空累计值） |
| 能否超窗口 | 能（累计重复计前文） | 不能 |
| 用途 | turn 概要 / 成本核算 | 上下文瞬时水位（该条消息完成后占用 = 三项输入 + output） |

流式协议补充事实：**无 `message_end`**，只有 `message_stop`（无 usage）；一次 API 请求 = 一条 message 信封（`message_start` 恰一次），thinking/text/tool 是信封内并列的 content block（`content_block_start/delta/stop` 三连），**不是**各自一套 message 信封；`message_delta` 无 message.id（同一时刻仅一条 message 在流，关联最近 message_start）。

---

## 消息分类体系

**设计文档**：`docs/superpowers/specs/2026-06-07-message-classification-filtering-design.md`
**实现文件**：`packages/shared/src/messageClassification.ts`

消息分类规则定义在 `@mobi/shared`，CLI 和 Hub 共享，单一事实来源。采用**黑名单**模式：只有明确匹配到 `discard` 或 `ephemeral` 规则的消息才会被特殊处理，**其余一律默认 `persistent`**。

### 三级分类

```typescript
type MessageCategory = 'discard' | 'ephemeral' | 'persistent'
```

| 级别 | 含义 | CLI | Hub 存储 | Hub 历史查询 | SSE 推送 |
|------|------|-----|---------|-------------|---------|
| `discard` | 直接丢弃 | ✘ 不发送 | — | — | — |
| `ephemeral` | 实时临时 | → 发送 | ✓ 存储 | ✘ 过滤 | ✓ 推送 |
| `persistent` | 完整保留 | → 发送 | ✓ 存储 | ✓ 返回 | ✓ 推送 |

### 分类规则

**discard（CLI 直接丢弃，不发送到 Hub）**：

| type | subtype | 说明 |
|------|---------|------|
| `system` | `thinking_tokens` | 内部 token 计数 |
| `system` | `hook_started` | Hook 启动通知 |
| `system` | `hook_progress` | Hook 执行输出 |
| `system` | `hook_response` | Hook 执行结果 |
| `system` | `plugin_install` | 插件安装进度 |
| `system` | `files_persisted` | 文件检查点 |
| `auth_status` | — | 认证流程状态 |
| `rate_limit_event` | — | 限流事件 |
| `command_lifecycle` | — | 排队消息生命周期回执（控制帧非对话内容；CLI onMessage 拦截转终态信号后才轮到分类层，见「终态接入」） |

**ephemeral（存 DB，历史查询时过滤，SSE 实时推送不变）**：

| type | subtype | 说明 | Web 标准化结果 |
|------|---------|------|---------------|
| `system` | `task_progress` | 任务执行指标 | `AgentEvent { type: 'agent-progress' }` |
| `system` | `task_started` | 后台任务启动 | `AgentEvent { type: 'bg-task-started' }` |
| `system` | `task_updated` | 后台任务状态变更 | `AgentEvent { type: 'bg-task-updated' }` |
| `system` | `task_notification` | 任务完成通知 | — |
| `tool_progress` | — | 工具执行进度 | `AgentEvent { type: 'agent-progress', toolUseId, metrics, summary }` |
| `tool_use_summary` | — | 工具使用汇总 | `AgentEvent { type: 'agent-progress', toolUseId, metrics, summary }` |
| `prompt_suggestion` | — | 下一步建议 | — |
| `system` | `status` | 压缩/权限状态 | — |

**persistent（默认，完整保留）**：所有未命中上述黑名单的消息，包括 `assistant`、`user`、`system:init`、`system:compact_boundary`、`system:api_error`、`system:api_retry` 等。

### 分类在管线中的位置

```
                         CLI                        Hub                        Web
                    ┌──────────┐              ┌──────────────┐         ┌──────────┐
 SDK 消息 ────────→ │ convert  │              │              │         │          │
                    │   ↓      │              │  classify    │         │          │
                    │ classify │              │   ↓          │         │          │
                    │   ↓      │   discard    │  store +     │  SSE    │ 实时渲染 │
                    │ discard? ├──────────────✘│  broadcast   ├────────→│ (不变)   │
                    │   ↓      │   发送        │              │         │          │
                    │ enqueue  ├──────────────→│  category=   │         │          │
                    └──────────┘              │  ephemeral/  │         │          │
                                              │  persistent  │         │          │
                                              │      ↓       │         │          │
                                              │  历史查询     │         │ 历史渲染 │
                                              │  WHERE != '  ├────────→│ (更轻量) │
                                              │  ephemeral'  │         │          │
                                              └──────────────┘         └──────────┘
```

### 向后兼容

| 保障点 | 机制 |
|--------|------|
| 未知消息 | `classifyMessage()` 未匹配任何规则 → `persistent` |
| 提取失败 | Hub 提取 type/subtype 失败 → `persistent` |
| 存量数据 | `ALTER TABLE ADD COLUMN DEFAULT 'persistent'`，自动填充 |
| SSE 推送 | `ephemeral` 消息仍通过 SSE 实时推送，行为不变 |
| Web 端 | 零改动，两层过滤（分类层 + Web 可见性白名单）互不干扰 |

---

## 第 1 步：SDK 消息产生

Claude Agent SDK 的 `query()` 异步迭代器产出 `SDKMessage`，共四种类型：

| SDK `type` | 来源 | 包含内容 |
|------------|------|----------|
| `user` | 用户输入 / tool_result | `message.content`（string 或 ContentBlock 数组） |
| `assistant` | Claude 回复 | `message.content`（text / thinking / tool_use）+ `message.usage` |
| `system` | SDK 系统事件 | `subtype`（`init` / `api_error` / `api_retry` / `turn_duration` / `compact_boundary` 等）+ `model` / `tools` |
| `result` | 轮次结束标记 | `subtype`、`terminal_reason`、`is_error`、`num_turns`、`duration_ms`、`usage`、`result`（echo） |

**关键点**：`result` 是 SDK 的内部控制消息，不是对话内容。它标志一轮 agent loop 的结束，用于传递 token 用量、中断原因等元数据。

**来源文件**：`@anthropic-ai/claude-agent-sdk` 类型定义

---

## 第 2 步：CLI 转换（SDKToLogConverter）

**文件**：`packages/cli/src/claude/utils/sdkToLogConverter.ts`

将 `SDKMessage` 转换为 Hub 可存储的 `RawJSONLines` 格式。

### 转换规则

| SDK 类型 | 输出 | 处理 |
|----------|------|------|
| `user` | `RawJSONLines (type=user)` | 检查 tool_result，附加权限审批 mode |
| `assistant` | `RawJSONLines (type=assistant)` | 附加 requestId |
| `system` (subtype=`init`) | `RawJSONLines (type=system)` | 更新 sessionId，全字段透传 |
| `system` (其他) | `RawJSONLines (type=system)` | 全字段透传 |
| **`result`** | **`null`（丢弃）** | 不生成日志消息 |

### 消息分类过滤

**文件**：`packages/cli/src/claude/claudeRemoteLauncher.ts`

`onMessage` 回调中，`convert()` 之后、`enqueue()` 之前调用 `classifyMessage(type, subtype)`：
- 分类为 `discard` 的消息直接 `return`，不发送到 Hub
- 分类为 `ephemeral` / `persistent` 的消息正常入队
- 过滤在 `convert()` 之后：确保格式转换完成，type/subtype 字段可被分类函数读取

**输出格式** (`RawJSONLines`) 基础字段：

```typescript
{
    uuid: string           // 消息唯一标识（优先用 SDK 自带 uuid）
    parentUuid: string     // 上一条消息的 UUID（链式结构，指向 lastUuid）
    isSidechain: boolean   // 是否子链（Task 工具的 subagent）
    userType: 'external'   // 固定值
    cwd: string            // 工作目录
    sessionId: string      // 会话 ID
    version: string        // CLI 版本
    gitBranch: string      // 当前 git 分支
    timestamp: string      // ISO 时间戳
}
```

### UUID 链路

```
主链：lastUuid 追踪，每条非 summary 消息推进
子链：sidechainLastUUID 追踪，按 parent_tool_use_id 分组
      子链消息不影响主链的 lastUuid
```

**注意**：`parentUuid` 命名容易误解为"父节点 UUID"，实际语义是**上一条消息的 UUID**（`this.lastUuid`），本质是链表的 prev 指针。

### 流式 Snapshot（StreamSnapshotSender）

**文件**：`packages/cli/src/claude/utils/streamSnapshotSender.ts`

在等待完整 assistant 消息期间，CLI 通过 `StreamSnapshotSender` 向 Web 端发送实时快照，实现打字机效果。

**流程**：

```
SDK stream_event → StreamSnapshotSender 累积 delta → 每 500ms 发送 snapshot
                                                       ↓
                                               Hub 透传（不落库）
                                                       ↓
                                               Web 接收并渲染
```

**关键设计**：

| 要点 | 说明 |
|------|------|
| snapshot id | 使用 SDK `stream_event` 的 uuid，与最终 assistant 消息的 uuid **不同**（它们是两条不同的 JSON 日志行） |
| snapshot 标识 | `DecryptedMessage.snapshot = true` 区分快照和正式消息 |
| Hub 处理 | snapshot 不写入 SQLite，直接通过 SSE `message-snapshot` 事件透传给 Web |
| 关联清理 | Web 端通过 **`parentUuid`** 关联同一轮次的 snapshot 和 full message；前提：CLI `AssistantPartialAssembler` 把 SDK 拆分的 full 按 `message.id` 聚合成一条 → snapshot/full 1-vs-1 → parentUuid 不漂移 → 清理可靠（= message queue 之前稳定态）。reducer 的 `(messageId, type)` 过滤兜底 parentUuid 边界（双保险，见 [streaming.md](web/streaming.md) 关键设计 1） |

### 特殊方法

| 方法 | 用途 |
|------|------|
| `convertSidechainUserMessage(toolUseId, content)` | Task 工具 subagent 的虚拟 user 消息 |
| `generateInterruptedToolResult(toolUseId, parentToolUseId?)` | 工具被中断时的错误 tool_result |
| `resetParentChain()` | 新会话开始时清空主链 |

---

## 第 3 步：Hub 存储、分类与同步

**存储**：`packages/hub/src/store/index.ts` — SQLite WAL 模式

转换后的 `RawJSONLines` 通过 `OutgoingMessageQueue` 发送到 Hub，存入 `messages` 表。

### 消息分类处理

**分类文件**：`packages/shared/src/messageClassification.ts`（与 CLI 共享）
**存储层**：`packages/hub/src/store/messages.ts`

1. **接收时分类**：Hub 在 `message` handler 中解析消息内容，提取 `type`/`subtype`，调用 `classifyMessage()` 得到 `category`
2. **带 category 存储**：`messages` 表有 `category TEXT NOT NULL DEFAULT 'persistent'` 列，新增索引 `idx_messages_session_category(session_id, category, seq)`
3. **历史查询过滤**：`getMessages` / `getMessagesAfter` / `getSidechainMessages` 均加 `WHERE category != 'ephemeral'` 条件
4. **SSE 推送不变**：`ephemeral` 消息照常通过 SSE 实时推送给 Web，与分类前行为完全一致

### type/subtype 提取路径

消息经 CLI `sendClaudeSessionMessage()` 包装后有两种结构，Hub 按优先级提取：

| 优先级 | 提取路径 | 适用消息 |
|--------|---------|---------|
| 1 | `content.content.data.type` + `content.content.data.subtype` | agent output 消息 |
| 2 | `content.content.type` + `content.content.subtype` | event 消息 |
| 3 | `content.role` | 兜底（user/agent） |
| 兜底 | 返回 `'persistent'` | 提取失败时 |

### OutgoingMessageQueue（`packages/cli/src/claude/utils/OutgoingMessageQueue.ts`）：透传所有消息，不做过滤。消息过滤由前端 `isClaudeChatVisibleMessage()` 等逻辑负责，这样如果后续有消息未渲染，在前端更容易发现。

**主键策略**：Hub 的 `addMessage` 使用 `localId ?? randomUUID()` 作为消息 `id`，即优先使用 CLI 提供的 SDK uuid，仅当无 `localId` 时才生成随机 UUID。

**同步**：`packages/hub/src/sync/syncEngine.ts` — SSE 推送

Hub 通过 SSE 向 Web 端推送 `SyncEvent`：
- `session-updated`：会话状态变化（心跳、agent state）
- `message-received`：新消息到达（落库后的完整消息）
- `message-snapshot`：流式快照透传（不落库，`snapshot: true`）
- `session-added` / `session-removed`：会话增删
- `machine-updated`：机器状态变化
- `toast`：通知消息
- `heartbeat`：心跳
- `connection-changed`：连接状态变化
- `idle-timeout-warning`：空闲超时预警
- `messages-submitted`：排队消息被 CLI 推送给 Claude Code（`lifecycle='pushed'` + `lifecycleAt` 落库；事件名与载荷 `{localIds, submittedAt}` 沿用旧名），Web 据此把悬浮消息翻为正式消息

Web 端 `SSEProvider` 接收事件，更新 React Query 缓存触发 UI 刷新。

### SSE 消息缓存更新

**文件**：`packages/web/src/core/providers/SSEProvider.tsx`

`SSEProvider` 使用 `upsertMessageCache` 辅助函数统一处理消息缓存更新：

| 事件类型 | 处理方式 |
|----------|----------|
| `message-snapshot` | 同 id 原地更新（覆盖旧 snapshot），新 id 追加 |
| `message-received` | 先通过 `parentUuid` 清除同轮次 snapshot（assembler 聚合 full 后 parentUuid 不漂移；reducer 再按 `(messageId, type)` 兜底），再 upsert |

**snapshot 清理机制（双保险）**：SDK 把一条 message 的多 content block 拆成多条 full（共享 `message.id`、各自 uuid；**与 `includePartialMessages` 无关**，2026-08-25 实测关掉 flag 照样拆），与 snapshot（一条累积）粒度不匹配。CLI `AssistantPartialAssembler` 按 `message.id` 把拆分的 full **聚合成一条**，使 snapshot/full 1-vs-1，`parentUuid` 不再漂移（`d7260a2` 之前稳定态）。

**去重键与 uuid 语义（2026-08-25 实测钉死）**：

- **Hub 落库去重只看 `localId = body.uuid`**（`apiSession.sendClaudeSessionMessage`，resume 不变，重发 = UPDATE 同一行）；`message.id`（Anthropic 分配）**不参与** Hub 去重，只用于 CLI 侧 assembler 归拢碎片 + 前端 `(messageId, type)` 兜底（藏在信封 `data.message.id` 里被 web 挖出）
- **合并行 uuid = 最后一个碎片的 uuid**（`template.uuid`）；block 内部**无 uuid**（uuid 是行级字段）；被丢弃的中间碎片 uuid 无任何下游消费者，权威副本在 `.jsonl`（其本身也是 block-per-line，uuid 与 SDK emit 一一对应）
- **不能用 uuid 做 snapshot↔full 关联的原因**：snapshot 每次 flush 现生成随机 uuid；`sdkUuid`（stream_event 包装层）不写 .jsonl、不等于任何 body uuid——snapshot 与 full 之间唯一共享的稳定标识是 `message.id`（message_start 即携带）
- 详细分析（assembler 必要性、abort 合并键边界、信封投影税）见 [streaming.md](web/streaming.md) 关键设计 1 的实测定位与 pending #56

> - **第一道（messageCache `resolveMessageCache`）**：full 到达按 `parentUuid` 删同轮次 snapshot。assembler 聚合后可靠，已知边界（`parentUuid` 为 null 的会话首条、SSE 乱序）可能漏清。
> - **第二道（reducer `dedupeSnapshotBlocks`）**：兜底第一道——snapshot 的 block 若已被同 `(messageId, type)` 的 full 覆盖则不渲染。`type`（reasoning/text）是内容自带的稳定标识。
> - **历史**：`3d2433d` 修 uuid 覆盖的 resume bug 时误删 assembler（见 [streaming.md](web/streaming.md) 坑 2），full 从此拆分裸奔，parentUuid 清理失效 → thinking 双气泡。恢复 assembler（不恢复 uuid 覆盖）修正前提。

---

## 排队消息生命周期（Queued Messages）

当 Web 用户在 agent 运行中发送消息时，消息不会立即送给 Claude，而是进入"排队悬浮"状态，等 agent 闲置后才被真正消费。

### 三语义解耦模型

生命周期状态、转换时刻、排序锚点是三个独立关注点，由不同列承载（不再由 `submitted_at` 一列重载，历史见 P1 重构）：

| 列 / 字段 | 含义 |
|------|------|
| `lifecycle` (`messages.lifecycle` / `DecryptedMessage.lifecycle`，类型 `MessageLifecycle`) | 排队生命周期：`NULL`（非排队轨道，如 agent/CLI/system 输出）/ `'queued'`（webapp 提交待消费）/ `'pushed'`（已推给 Claude Code，原 `queue_state='consumed'`）/ `'acked'`（CC isReplay 回显确认，原 `metadata.nativeAckAt`）/ `'processing'`/`'done'`/`'cancelled'`/`'discarded'`（CC command_lifecycle 终态回执，P2 已接入）/ `'withdrawn'`（预留，pending #53 撤回）。「是否排队」的唯一读取依据 |
| `lifecycle_at` (`lifecycleAt`) | 最近一次 lifecycle 转换的时刻；非排队消息恒 `NULL`。不参与排序（排序请用 `positionAt`，不要 COALESCE 本字段） |
| `position_at` (`positionAt`) | 排序锚点；insert 时 = `created_at`，排队消息 push 时跳到 push 时刻（保留「运行中消费的消息排在 turn 之后」UX） |

转换单调前进：`queued→pushed→acked→processing→{done|cancelled|discarded}`，`queued→withdrawn`。推进序由 shared `LIFECYCLE_RANK` 定义（与 Hub SQL CASE rank 同语义，勿单边改：queued 0 < pushed 1 < acked 2 < processing 3 < 终态 4——done/cancelled/discarded 同 rank 互不覆盖、withdrawn 单独高位 5），`isLifecycleAhead` 为其判定函数。

### 事实上报协议（messages-facts，CLI→Hub）

CLI→Hub 的消息事实收敛为单一 socket 事件 **`messages-facts`**（载荷 `{ sid, facts: MessageFact[] }`，shared `MessageFact` 联合类型，批内合并多 kind 一次往返）：

| fact kind | 语义 | Hub 处理（共享函数） |
|------|------|------|
| `pushed` | 一批 localId 已推给 Claude Code | `processSubmitted` → `markMessagesPushed`（queued→pushed，first-write-wins） |
| `bound` | localId → nativeId 锚点绑定（push 时生成，可带 nativeSessionId） | `processBound` → `bindNativeIds`（幂等，逐项校验） |
| `attached` | native 会话 id 确立，补写缺 nativeSessionId 的行 | `processAttached` → `attachNativeSessionId`（只补空缺） |
| `acked` | CC isReplay 回显确认 | `processAcked` → `advanceMessagesAcked` + `markMessagesAcked` |
| `lifecycle` | command_lifecycle 终态信号 | `processLifecycleFact` → `advanceMessagesLifecycle`（单调推进，见下） |

`at` 为 CLI 观测时刻，缺省由 Hub 取接收时刻。旧 4 事件（`messages-submitted`/`messages-bound`/`messages-native-attached`/`messages-acked`）保留兼容旧 CLI 二进制——Hub 双受理、处理体共享防逻辑分叉（#54 收敛清理时下线）。注意 SSE `messages-submitted`（Hub→Web）名字与载荷 `{localIds, submittedAt}` 不变。

### 终态接入：command_lifecycle 帧拦截

CC 对排队消息（push 时预设的 `command_uuid` = nativeId）发出 `command_lifecycle` 生命周期回执。CLI `onMessage` 中用纯函数 `commandLifecycleToFact`（`claudeRemote.ts`）拦截：**started→processing、completed→done、cancelled/discarded 直传**（queued 不上报，Hub 已有初始排队态）；控制帧不 convert 不落库（分类层 discard 兜底），只取信号 `emitLifecycleFact`（`messages-facts` lifecycle fact）上报。Hub `advanceMessagesLifecycle` 按 nativeId 单调推进（CASE rank：queued 0 < pushed 1 < acked 2 < processing 3 < 终态 4，已处终态/withdrawn 不被覆盖、processing 不回退，乱序帧安全），推进后 `getMessagesByIds` 回读完整行，`broadcastStoredMessages` 逐行广播 update new-message（载荷含推进后 lifecycle/lifecycleAt，Web 单调合并实时消费，见「终态 UI 可见性」）。

### 终态 UI 可见性（P3，粗粒度）

终态广播到达 Web 后不再「刷新才见」，三个消费点共用 `isLifecycleAhead` 单调判定：

- **messageCache 单调合并**：`resolveMessageCache` 同 id 分支（skipIfNotSnapshot 路径）在合并 metadata/seq 的同时单调合并 `lifecycle`/`lifecycleAt`（rank 前进才接受，广播缺 `lifecycleAt` 时保留旧值）——与 messages-bound 补写当年同坑（只落库 Web 不更新）同点修复。
- **mergeMessages 单调防护泛化**：原「陈旧 queued echo 不回退」特判泛化为 rank 比较（rank 更低或同 rank 异终态且 prev 不晚于 incoming 时保留 prev），陈旧 echo / in-flight fetch 旧响应晚到均适用。
- **悬浮条「已丢弃」分区**：`isDiscardedInMobi`（`lifecycle==='cancelled' || 'discarded'`，剔除 `status='sending'/'failed'` 乐观在途/失败态）。`QueuedMessagesBar` 增「已丢弃」分区——灰色删除线 + 状态词（已取消/已丢弃），**无任何操作按钮**，消息不再静默消失。`ComposerInfoPanel` 数据源与 `hasContent` 门禁（hasQueued 信号）均纳入 discarded：turn 死亡常态下无 requests/todos/tasks/agents，丢弃分区是面板唯一内容，只算 queued 会让面板整体卸载。
- **气泡终态标注**：`ChatContainer` 以 `lifecycleById` 为判据，cancelled/discarded 的用户气泡 footer 同排左侧加灰色小标注（icon + 状态词，不抢焦）；`ctxKey` 加 `terminalLifecycleCount` 让缓存失效，标注随广播即时出现（lifecycle 翻转不动 block 引用，不进签名就「刷新才见」）。

**粗粒度边界**：done/processing/pushed/acked 无任何标注（用户不关心传输细节）；withdrawn 不做（#53 预留）。

### 不变量与单一决策点

- **写入决策只在 Hub `addMessage`**：用 shared 谓词 `isQueueableUserSubmission(content, localId)`（**denylist**：`role==='user' && localId && sentFrom!=='cli'`）决定 `lifecycle='queued'`。
  - 只有 CLI 来源一定不排队（CLI 消息是 Claude Code 输出流回显，已在对话里）；webapp 及未来端默认排队。
- **读取只看显式状态**：Web `isQueuedInMobi` = `lifecycle==='queued'`，不再反推来源或时间戳。

### 完整流程

```mermaid
flowchart LR
    Web["Web 用户<br/>（agent 运行中发送）"] -->|"POST 消息<br/>localId"| Hub["Hub<br/>addMessage"]
    Hub -->|"isQueueableUserSubmission<br/>→ lifecycle='queued'"| DB[("SQLite<br/>排队")]
    Hub -->|"SSE message-received<br/>lifecycle=queued"| WebBar["Web 悬浮条<br/>QueuedMessagesBar"]

    CLI["CLI gated pump<br/>agent idle 时 pull"] -->|"collectBatch<br/>localIds（同步标 in-flight）"| Consume["消费"]
    Consume -->|"emitFacts（pushed fact）<br/>socket messages-facts"| Hub2["Hub<br/>processSubmitted"]
    Hub2 -->|"markMessagesPushed<br/>queued→pushed"| DB2[("SQLite")]
    Hub2 -->|"SSE messages-submitted"| WebFinal["Web<br/>markMessagesSubmitted<br/>翻为正式消息"]

    CC["Claude Code"] -->|"command_lifecycle 帧<br/>started/completed/cancelled/discarded"| Intercept["CLI onMessage<br/>commandLifecycleToFact 拦截"]
    Intercept -->|"emitLifecycleFact<br/>messages-facts lifecycle fact"| Hub3["Hub<br/>advanceMessagesLifecycle"]
    Hub3 -->|"单调推进 processing/终态<br/>getMessagesByIds 回读"| DB3[("SQLite")]
    Hub3 -->|"update new-message 逐行广播<br/>（Web 单调合并实时生效）"| WebT["Web"]
```

### 关键环节

| 环节 | 位置 | 行为 |
|------|------|------|
| **入库决策** | Hub `addMessage` + shared `isQueueableUserSubmission` | denylist：非 CLI 的 user+localId → `lifecycle='queued'`；其余 → `NULL` |
| **Gated Pump（C-2）** | CLI `userInputLoop` | agent 运行时不 pull，等 result 才拉取，消息始终停留在 MessageQueue |
| **消费通知** | CLI `collectBatch`（同步标记 `inFlightLocalIds`）→ `onBatchConsumed` → `emitMessagesSubmitted`（内部走 `emitFacts`） | → Hub `messages-facts` handler → `processSubmitted` → `markMessagesPushed`（queued→pushed，first-write-wins）→ SSE `messages-submitted` |
| **回显确认（acked）** | CLI `onMessage` 检测 isReplay 回显 → `emitMessagesAcked`（`emitFacts`） | → Hub `processAcked`：按 nativeId 双写——先 `advanceMessagesAcked` 推进 `lifecycle='acked'` 再写 `metadata.nativeAckAt`（rewind 判据不动，共一时间戳消除分叉），推进行逐行广播 |
| **终态接入（command_lifecycle）** | CLI `onMessage` 帧拦截 `commandLifecycleToFact`（started→processing、completed→done、cancelled/discarded 直传）→ `emitLifecycleFact`（`emitFacts`） | → Hub `processLifecycleFact` → `advanceMessagesLifecycle`（nativeId 单调推进，CASE rank 防乱序回退）→ `getMessagesByIds` 回读 → 逐行广播 update new-message（Web 单调合并实时生效，见「终态 UI 可见性」） |
| **首页钉入** | Hub `getMessagesPage` | 首页（`beforeSeq=null`）out-of-band 查询仍排队的本地消息（`lifecycle='queued'`，`getUnsubmittedLocalMessages`），追加到列表尾部、不参与 `nextBeforeSeq`/`hasMore` 计算。翻页游标 = 页内最老消息的 seq（**不分 lifecycle**）——跳过 queued 会让整页全 queued 时 `hasMore=false` 锁死更早历史；queued 锚点 position 跳变的漂移由 Web `mergeMessages` id 去重兜底 |
| **session-end 兜底** | Hub `sessionHandlers` | CLI 离线时把所有剩余 `lifecycle='queued'` 消息 force-push（`markMessagesPushed`），防止悬浮条卡死 |
| **取消（CLI 权威）** | Web `DELETE` → Hub | Hub 先 `getMessageSubmitState`（`lifecycle!=='queued'` 即已提交）；DB 仍 queued 时问 CLI `cancel-queued-message`：`tryCancel` 返回 `submitted`（in-flight，已 collect）/`cancelled`（仍在队列）/`not-in-queue`（尚未送达）。仅 `cancelled`/`not-in-queue` 才物理删 DB——**in-flight 绝不删**，防幽灵消息 |

### Web 端处理

| 组件 | 职责 |
|------|------|
| `QueuedMessagesBar` | composer 上方悬浮条，展示排队消息，✕ 取消 / ✎ 编辑（回填草稿）/ ⚡ steer；另含「已丢弃」分区（cancelled/discarded 灰色删除线 + 状态词，无操作，终态可见性） |
| `useSendMessage` | 乐观注入：`isRunning` → `lifecycle='queued'`+`status='queued'`（`lifecycleAt`/`positionAt`/`createdAt` 共用同一发送时刻，对齐 hub「queued 时 lifecycle_at = created_at」契约），否则 `status='sending'` |
| `useCancelQueuedMessage` | 乐观删除缓存中的 localId 消息；`status='sent'` 时失效重拉 |
| `markMessagesSubmitted` | SSE `messages-submitted` 到达时，把命中 localId 的消息 `lifecycle='pushed'`（+ `lifecycleAt`/`positionAt` 跳到 submittedAt，first-write-wins） |
| `mergeMessages` | 合并去重时 lifecycle 单调防护（rank 泛化）：prev 已推进而 row 回退（rank 更低或同 rank 异终态，且 prev 不晚于 row）时保留 prev 的 lifecycle + lifecycleAt，陈旧 echo / in-flight fetch 旧响应晚到均适用，防幽灵回悬浮条 |
| `messageCache`（`resolveMessageCache`） | 同 id 广播单调合并 lifecycle/lifecycleAt（`isLifecycleAhead`，rank 前进才接受）——终态推进广播实时生效，不「刷新才见」 |
| `isQueuedInMobi` | `lifecycle==='queued'`（剔除 `status='sending'/'failed'`）。排队判定的唯一入口 |
| `isDiscardedInMobi` | `lifecycle==='cancelled' || 'discarded'`（剔除 `status='sending'/'failed'`）。悬浮条「已丢弃」分区判据；注意与用户主动取消排队（API 返回值 `'cancelled'`）是不同概念 |
| `ChatContainer` | 线程过滤掉排队消息（`isQueuedInMobi`），仅在悬浮条展示；cancelled/discarded 的用户气泡 footer 加灰色终态小标注（`lifecycleById` 判据，ctxKey 含 `terminalLifecycleCount`） |
| `ChatComposer` | `canSend` 去掉 `!running` 门控，运行中允许发送（→排队） |

---

## 第 4 步：Web 标准化（normalize）

**入口**：`packages/web/src/domain/chat/normalize.ts` → `normalizeDecryptedMessage()`

将 API 返回的 `DecryptedMessage` 转换为 `NormalizedMessage`。

### 处理流程

```mermaid
flowchart TD
    DM["DecryptedMessage"]
    UNWRAP["unwrapRoleWrappedRecordEnvelope()"]
    NULL{"record == null?"}
    USER{"record.role == 'user'?"}
    SKIP{"isSkippableAgentContent()?"}
    NAR["normalizeAgentRecord()"]
    RESULT{"data.type == 'result'?"}
    FALLBACK["JSON dump fallback"]

    DM --> UNWRAP --> NULL
    NULL -->|"是"| FALLBACK
    NULL -->|"否"| USER
    USER -->|"是"| UREC["normalizeUserRecord()"]
    USER -->|"否 (agent)"| SKIP
    SKIP -->|"可跳过"| DROP["return null"]
    SKIP -->|"不可跳过"| NAR
    NAR -->|"返回 NormalizedMessage"| OUT["输出"]
    NAR -->|"返回 null"| RESULT
    RESULT -->|"是 result/success"| DROP2["return null"]
    RESULT -->|"否"| FALLBACK

    FALLBACK -->|"未知消息 JSON 展示"| OUT
    UREC --> OUT
```

### 消息过滤规则

**`isSkippableAgentContent()`** 决定消息是否直接跳过：

| 条件 | 结果 |
|------|------|
| `isMeta === true` | 跳过（元数据消息） |
| `isCompactSummary === true` | 跳过（压缩摘要） |
| `isClaudeChatVisibleMessage()` 返回 false | 跳过 |
| 以上均不满足 | 不跳过，进入 normalizeAgentRecord |

**`isClaudeChatVisibleMessage()`**：只要 `type` 不是 `system` 就返回 true。对于 `system` 类型，只有以下 subtype 可见：`api_error`、`api_retry`、`turn_duration`、`microcompact_boundary`、`compact_boundary`、`task_progress`、`task_notification`、`task_started`、`task_updated`。其他 system subtype（如 `init`）被跳过。

### normalizeAgentRecord 处理

**文件**：`packages/web/src/domain/chat/normalizeAgent.ts`

根据 `content` 的具体结构分发处理：

| content 结构 | 处理方式 |
|-------------|---------|
| `content.type === 'text'` | 提取文本 → `role: 'agent'` + text blocks |
| `content.type === 'assistant'`（assistant output） | 解析 message.content 中的 text / thinking / tool_use blocks |
| `content.type === 'user'`（user output） | 解析 message.content 中的 text / tool_result blocks；sidechain 字符串 → `sidechain` block |
| `content.type === 'system'` | 分发到具体 subtype：`init` → ready event，`api_error` → api-error event，`api_retry` → api-retry event，`turn_duration` → turn-duration event 等 |
| `content.type === 'output'` + `data.type === 'result'` | **aborted** → aborted event；**error** → execution-error event；**success** → `null`（静默忽略） |
| `content.type === 'output'` + 其他 data.type | 打印 warning，返回 null |
| `content.type === 'event'` | 解析为 AgentEvent |
| `content.type === 'summary'` | 提取 summary 文本 |

### result 消息的三层处理

result 消息在整个管线中有三层处理：

| 层级 | 位置 | 行为 |
|------|------|------|
| **CLI 转换** | `sdkToLogConverter.ts` | `case 'result': return null` — 不写入 Hub |
| **Web 过滤兜底** | `normalize.ts` | 检查 `data.type === 'result'` → return null — 即使漏过 CLI 也不渲染 |
| **Web 标准化** | `normalizeAgent.ts` | aborted → event, error → event, success → null |

### normalizeUserRecord 处理

**文件**：`packages/web/src/domain/chat/normalizeUser.ts`（归一逻辑单一来源在 shared `normalizeUserContent`）

四形态归一为统一的 block 数组（下游只见一种形态）：

| 输入 | 输出 |
|------|------|
| `typeof content === 'string'` | `[ { type:'text', text } ]` |
| 平铺 object `{type:'text', text, attachments?}`（存量） | text block + attachments→document blocks |
| 单 block 对象 / block 数组（新格式） | `[block]` / 原样 |
| 其他（畸形） | 返回 null（fallback 由 normalize.ts 处理）；未知 block type 逐项剔除 |

### NormalizedMessage 类型

标准化后的消息有三种形态：

```typescript
// 用户消息（blocks 为权威载体；text 恒空串仅为保持判别式占位）
{ role: 'user', content: { type: 'text', text: '', blocks: UserContentBlock[] } }

// Agent 消息（含 text / reasoning / tool-call / tool-result / summary / sidechain blocks）
{ role: 'agent', content: NormalizedAgentContent[] }

// 事件消息（API 错误、耗时、压缩、中断、执行错误等）
{ role: 'event', content: AgentEvent }
```

所有形态共享 `id`、`localId`、`createdAt`、`isSidechain`、`meta`、`usage`、`status`、`originalText` 字段。

---

## 第 5 步：Web 归约（reduce）

**文件**：`packages/web/src/domain/chat/reducer.ts` → `reduceChatBlocks()`

将 `NormalizedMessage[]` 转换为可渲染的 `ChatBlock[]`。

### 处理步骤

```
NormalizedMessage[]
  → traceMessages()        // 追踪父子关系和 sidechain 分组
  → reduceTimeline()       // 按类型转换为 ChatBlock
  → dedupeAgentEvents()    // 去重事件
  → foldApiErrorEvents()   // 合并连续 API 错误
  → ChatBlock[]
```

### reduceTimeline 转换规则

**文件**：`packages/web/src/domain/chat/reducerTimeline.ts`

| NormalizedMessage | ChatBlock | 说明 |
|-------------------|-----------|------|
| `role: 'user'` | `UserTextBlock (kind: 'user-text')` | 用户文本 |
| `role: 'event'` (type=`ready`) | 不输出 | ready 事件仅标记 hasReadyEvent |
| `role: 'event'` (其他) | `AgentEventBlock (kind: 'agent-event')` | 系统事件 |
| `role: 'agent'` + text block | `AgentTextBlock (kind: 'agent-text')` | 文本合并到已有 block 或新建 |
| `role: 'agent'` + reasoning block | `AgentReasoningBlock (kind: 'agent-reasoning')` | 思考过程 |
| `role: 'agent'` + tool-call block | `ToolCallBlock (kind: 'tool-call')` | 工具调用（含子 block）；`isHiddenTool()` 返回 true 的工具跳过不渲染 |
| `role: 'agent'` + tool-result block | 嵌入对应 ToolCallBlock | 作为工具调用的子节点 |
| `role: 'agent'` + sidechain block | `AgentTextBlock (kind: 'agent-text')` | subagent prompt 展示 |
| `role: 'agent'` + summary block | `AgentTextBlock (kind: 'agent-text')` | 摘要文本 |

### ChatBlock 类型

```typescript
type ChatBlock =
    | UserTextBlock        // kind: 'user-text'
    | AgentTextBlock       // kind: 'agent-text'
    | AgentReasoningBlock  // kind: 'agent-reasoning'
    | CliOutputBlock       // kind: 'cli-output'
    | ToolCallBlock        // kind: 'tool-call'（含 children: ChatBlock[]）
    | AgentEventBlock      // kind: 'agent-event'
```

---

## 第 6 步：Web 渲染（render）

**文件**：`packages/web/src/components/chat/ChatContainer.tsx`（主列表容器：`VirtuosoChatList` 虚拟化，内部 Bubble 单组件 + role 模板）

`renderChatBlock()` 根据 `block.kind` 选择渲染组件（在 `VirtuosoChatList` 容器内）：

| ChatBlock kind | 渲染组件 | 说明 |
|----------------|----------|------|
| `user-text` | XMarkdown（TextBlock） | 右对齐，带 `isSynthetic` 柔和样式 |
| `agent-text` | XMarkdown（TextBlock） | 左对齐，Markdown 渲染 |
| `agent-reasoning` | `Think` 组件 | 可折叠的思考过程 |
| `cli-output` | 命令/输出展示 | CLI 输出内容 |
| `tool-call` | `ToolCallRenderer` | 根据 `tool.name` 路由到对应 ToolCard 视图 |
| `agent-event` | 事件格式化 | 根据 `display` 属性决定对齐/颜色/边距 |

### 事件渲染提示

`EventDisplay` 控制 agent-event 的渲染样式：

| event.type | align | color | padding |
|------------|-------|-------|---------|
| `turn-duration` | left | default | false |
| `api-error` | — | error | true |
| `api-retry` | — | error | true |
| `execution-error` | — | error | true |
| 其他 | — | default | true |

---

## 消息命运总结

### 三层过滤

消息在整个管线中经历三层过滤，各层职责独立：

| 层 | 位置 | 职责 | 时机 |
|----|------|------|------|
| **分类层**（CLI + Hub） | CLI `onMessage` + Hub 存储 | 传输 + 存储 + 查询优化 | 数据链路层 |
| **可见性白名单**（Web） | `isClaudeChatVisibleMessage()` | 渲染过滤 | 展示层 |
| **隐藏工具**（Web） | `isHiddenTool()` | 隐藏内部工具调用 | 展示层 |

### 第一层：分类层（discard / ephemeral / persistent）

| 分类 | 消息 | 分类位置 | 效果 |
|------|------|----------|------|
| `discard` | `thinking_tokens`、`hook_*`、`plugin_install`、`files_persisted`、`auth_status`、`rate_limit_event`、`command_lifecycle` | CLI `onMessage` | 不发送到 Hub，全链路不可见 |
| `ephemeral` | `task_progress`、`task_started`、`task_updated`、`task_notification`、`tool_progress`、`tool_use_summary`、`prompt_suggestion`、`system:status` | Hub 存储时标记 | 存 DB，SSE 实时推送，历史查询时过滤 |
| `persistent` | 所有未命中上述规则的消息 | — | 完整保留，正常存储和查询 |

### 第二层：完全丢弃（normalize 阶段，不进入后续流程）

| 消息 | 丢弃位置 | 原因 |
|------|----------|------|
| SDK `result` (success) | CLI `sdkToLogConverter.ts` | SDK 内部控制消息，非对话内容 |
| SDK `result` (漏过 CLI 的) | Web `normalize.ts` 兜底 | 防御性检查 |
| `isMeta === true` | Web `normalizeAgent.ts` | 元数据消息 |
| `isCompactSummary === true` | Web `normalizeAgent.ts` | 压缩摘要 |
| 隐藏工具（ToolSearch 等） | Web `reducerTimeline.ts` | `isHiddenTool()` 返回 true 的 tool-call/tool-result 不渲染 |
| System 非可见 subtype | Web `normalizeAgent.ts` | 如非 `api_error`/`api_retry`/`turn_duration`/`compact_boundary`/`task_progress`/`task_notification`/`task_started`/`task_updated` 等 |

### 转换为事件（不直接展示文本）

| 消息 | 转换结果 |
|------|----------|
| SDK `result` (aborted) | `AgentEvent { type: 'aborted', numTurns }` |
| SDK `result` (error) | `AgentEvent { type: 'execution-error', subtype, errors, numTurns }` |
| System `api_error` | `AgentEvent { type: 'api-error', retryAttempt, maxRetries, error }` |
| System `api_retry` | `AgentEvent { type: 'api-retry', attempt, maxRetries, retryDelayMs, errorStatus, error }`（连续重试去重，只保留最新一条） |
| System `turn_duration` | `AgentEvent { type: 'turn-duration', durationMs }` |
| System `compact_boundary` | `AgentEvent { type: 'compact', trigger, preTokens }` |
| System `init` (model: ready) | 不输出（标记 hasReadyEvent） |

### 流式 Snapshot 生命周期

| 阶段 | 事件 | 处理 |
|------|------|------|
| SDK stream_event 到达 | CLI `StreamSnapshotSender` 累积 delta | 每 500ms 生成 snapshot |
| Snapshot 发送 | Hub 收到 `snapshot: true` 的消息 | 不落库，直接 SSE `message-snapshot` 透传 |
| Web 收到 snapshot | `SSEProvider` → `upsertMessageCache` | 同 id 原地更新，新 id 追加 |
| Web 渲染 snapshot | `reducerTimeline` → `isSnapshot` 标记 | `AgentTextBlock` / `AgentReasoningBlock` 带 `isSnapshot` 标记，ChatContainer 对最后一个 running snapshot 启用 typing 光标 |
| Full message 到达 | `SSEProvider` → `upsertMessageCache` | 通过 `parentUuid` 清除同轮次 snapshot（assembler 聚合后可靠），full message 正常 upsert |

### 隐藏工具

**文件**：`packages/web/src/domain/chat/reducerTools.ts` → `isHiddenTool()`

部分工具是 SDK 内部调用，不需要渲染：

| 工具名 | 说明 | 额外处理 |
|--------|------|----------|
| `ToolSearch` | SDK 自动调用的工具搜索 | 无 |
| `mcp__mobi__change_title` / `mobi__change_title` | 改标题工具 | 提取标题，生成 `title-changed` 事件（不渲染工具卡片本身）；CLI 侧 best-effort 回写 CC customTitle |

### 正常渲染

| 消息 | 渲染为 |
|------|--------|
| User text | 用户气泡（Markdown） |
| User tool_result | 嵌入对应工具卡片 |
| Assistant text | Agent 气泡（Markdown） |
| Assistant thinking | 可折叠思考过程 |
| Assistant tool_use | 工具卡片（按工具名路由视图） |
| Sidechain prompt | Agent 文本块（subagent 输入展示） |

---

## 关键文件索引

| 层级 | 文件 | 职责 |
|------|------|------|
| SDK 类型 | `@anthropic-ai/claude-agent-sdk` | SDKMessage 类型定义 |
| CLI 转换 | `packages/cli/src/claude/utils/sdkToLogConverter.ts` | SDK → RawJSONLines |
| CLI 类型 | `packages/cli/src/claude/types.ts` | RawJSONLines Schema 定义 |
| CLI 启动 | `packages/cli/src/claude/claudeRemoteLauncher.ts` | 创建 Converter，管理消息流 |
| CLI 队列 | `packages/cli/src/claude/utils/OutgoingMessageQueue.ts` | 消息发送队列（保序、延迟发送、透传） |
| CLI 循环 | `packages/cli/src/claude/claudeRemote.ts` | 处理 result 控制信号、流式 snapshot 事件分发、gated pump（排队消息门控）、commandLifecycleToFact（command_lifecycle 帧 → 终态信号） |
| CLI 快照发送 | `packages/cli/src/claude/utils/streamSnapshotSender.ts` | 累积 stream_event delta，定时发送 snapshot |
| Hub 存储 | `packages/hub/src/store/index.ts` | SQLite 消息持久化（lifecycle/position_at 列、byPosition 分页） |
| Hub 同步 | `packages/hub/src/sync/syncEngine.ts` | SSE 推送、cancelQueuedMessage 委托 |
| Hub 消息服务 | `packages/hub/src/sync/messageService.ts` | 分页查询（首页钉排队）、markMessagesPushed/cancelQueuedMessage |
| Web SSE | `packages/web/src/core/providers/SSEProvider.tsx` | 接收实时事件、snapshot 缓存管理（upsertMessageCache + 按 `parentUuid` 关联清理，assembler 聚合后可靠）、messages-submitted 处理 |
| Web 排队消费标记 | `packages/web/src/core/lib/markMessagesSubmitted.ts` | 排队消息 lifecycle 翻为 pushed（first-write-wins） |
| Web 排队悬浮条 | `packages/web/src/components/chat/QueuedMessagesBar.tsx` | composer 上方悬浮排队消息（✕取消 / ✎编辑）+「已丢弃」分区（终态可见性，无操作） |
| Web 标准化入口 | `packages/web/src/domain/chat/normalize.ts` | DecryptedMessage → NormalizedMessage |
| Web Agent 标准化 | `packages/web/src/domain/chat/normalizeAgent.ts` | Agent 消息详细解析 |
| Web User 标准化 | `packages/web/src/domain/chat/normalizeUser.ts` | User 消息解析 |
| Web 类型 | `packages/web/src/domain/chat/types.ts` | NormalizedMessage / ChatBlock 类型 |
| Web 归约 | `packages/web/src/domain/chat/reducer.ts` | NormalizedMessage[] → ChatBlock[] |
| Web 时间线归约 | `packages/web/src/domain/chat/reducerTimeline.ts` | 时间线 → ChatBlock 转换、隐藏工具过滤（isHiddenTool） |
| Web 工具过滤 | `packages/web/src/domain/chat/reducerTools.ts` | isHiddenTool / isChangeTitleToolName 判断 |
| Web 渲染 | `packages/web/src/components/chat/ChatContainer.tsx` | ChatBlock → UI 组件 |
| 共享工具 | `packages/shared/src/messages.ts` | unwrapRole / isSkippable / isVisible / MessageFact 联合类型 / LIFECYCLE_RANK + isLifecycleAhead（lifecycle rank 单调判定，与 hub SQL CASE 同语义） |
| 共享分类 | `packages/shared/src/messageClassification.ts` | classifyMessage / shouldSendToHub / shouldIncludeInHistory |
