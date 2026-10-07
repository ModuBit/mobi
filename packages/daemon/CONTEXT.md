# Daemon（单机自足服务器）

daemon 侧的领域语言：会话实体的持久化与多端同步。

## Language

### 进程拓扑

**daemon**:
单机自足的服务器进程——原 hub（Web + Socket.IO + SQLite）与 runner（spawn 管线）合并后的唯一常驻服务（machine 层已随 ADR 0011 彻底移除）。每台机器一个 daemon，承载 Web 服务与会话子进程 spawn / 跟踪。
_Avoid_: hub（历史名，文档不再用）、中心服务器（多机语义已废）

**宿主**:
daemon 进程内 spawn 并跟踪会话子进程的一方（原 runner 职责，同进程化后并入），代码承载为 `ExecutorHost` 接口 + `LocalExecutor` 实现（`packages/daemon/src/executor/`）。「宿主通道」「宿主端口」中的宿主均指它。
_Avoid_: runner / machine（进程角色与路由概念均已废，单机世界无路由标识）

**宿主通道**:
会话子进程回连 daemon 的独立 loopback listener：只绑 `127.0.0.1`，端口 = 主端口 + 10000（`MOBI_HOST_PORT` 覆盖），承载 `/cli` Socket.IO namespace 与 `/cli/*` HTTP 路由。不经 frp 暴露，外网物理不可达（主端口对这些路径 404）。
_Avoid_: CLI 端口、内部端口（不指明 loopback-only 与独立 listener 语义）

### 会话实体

**会话行**:
daemon 中一个 mobi 会话的持久化实体。一个会话行的生命周期内可以跨多个 native session（如 /clear 换链、fork 激活换链），归属关系靠消息行的 metadata 维系。
_Avoid_: session（与 native session 口语混用）

**native session**:
Claude Code 侧的会话链（一个 transcript 文件）。会话行经 metadata.nativeSessionId 绑定当前链；/clear 前的旧链仍在盘上但不等于会话行的当前链。
_Avoid_: 原生会话

**消息行**:
归属唯一会话行；metadata.nativeId 是其在 native transcript 上的锚、metadata.nativeSessionId 记录所在链。去重键是会话行 + localId，范围限单会话行。
_Avoid_: message（与 native transcript entry 混用）

### 消息投递

**投递队列**:
人（Web 用户）发出的消息在会话内的待泵区——等 agent 空闲才被取走，取走前可取消或回填编辑。**队列是人的排队区**，不是通用投递通道。
_Avoid_: 消息队列（与 SDK input stream 混称）

**入队**:
消息落库时被标记为 `queued` 并进入投递队列。**只有人发出的消息入队**；会话之间投递的消息不入队——落库即终态，由 daemon 经 RPC 直推给目标会话，因此不可取消、不可编辑，也不会在 Web 上呈现排队态。
_Avoid_: 排队、进队列

**跨会话消息**:
一个会话投到另一个会话的消息。与人发言同形（role=user、正文包 `<cross-session-message from-name="…">` 信封），收件方据此用同一来源回复；mobi 自发投递的那一类另把发件方会话 id 记为 meta 一等字段 `fromSessionId`（CC 原生 peer 消息只有名字，反查不到会话、也无消息身份）。当前来源有二：Claude Code 原生（走本机 UDS，mobi 只观测）与 mobi 自发（`send_message_to_session` 投递，落库不含信封）。
_Avoid_: thread（orca 式的独立线程实体，本仓库不引入——会话自身即线程）、会话间消息

### 分叉

**分叉会话**:
从 parent 会话某条 agent 回复分叉出的独立会话行：建行时复制锚点所属 turn（必要时延伸到该 turn 的 result 行），激活后拥有自己的 native session，与 parent 互相独立。
_Avoid_: fork 会话（口语可，正式文档用「分叉会话」）

**parent 会话**:
分叉来源会话。分叉激活后 parent 的任何变化（继续对话、rewind）不影响分叉会话已锁定的历史。
_Avoid_: 源会话

**待激活态**:
分叉会话已建行（含复制消息行与预生成 native id）但 CC transcript 尚未物化；用户发出首条消息时激活。放弃 = 删除该会话行。
_Avoid_: 空会话、pending fork（内部代号可用）

**分叉创建**:
`SessionForkStore.createFork(parentSessionId, anchorNativeId)` 是创建规则的权威入口：模块自行校验 parent 与锚点资格、解释上下文边界和 turn 范围、生成 native id，并在单事务中建行和复制消息。`SyncEngine` 只负责 namespace 访问协调与成功后的缓存/SSE 衔接。
_Avoid_: 由调用方传入 parent 行、turnStartSeq 或预生成 native id（会绕开分叉资格与范围规则）

### 流式消息同步

**快照同步**:
agent 回复生成期间，会话子进程、daemon 与 Web 之间传递并衔接当前消息内容的同步过程。完整快照是可独立解释的版本基线，快照增量只描述相对某个基线的后续变化。
_Avoid_: 消息同步（范围过宽）、流式转发（忽略基线与追赶语义）

**运行状态投影**:
daemon 将已持久化的消息内容按到达顺序归约为 `runtimeState`（todos、tasks、teamState、backgroundTasks、foregroundTasks）的过程。`SessionMessageRuntimeProjector` 是规则、跨消息配对状态和持久化顺序的权威入口；Socket handler 对这部分只负责校验、鉴权、调用与发布。
_Avoid_: 重建完整消息（投影只生成当前摘要）、在 Socket handler 内直接合并 runtimeState

**前台任务**（foregroundTasks）:
Agent 类工具在前台执行中的清单，由 daemon 从消息投影维护（tool_use 入、tool_result 出、轮次 result 到达清扫孤儿）。与「后台任务」（backgroundTasks，会话子进程上报通道）相对；与「任务列表」（tasks，TaskCreate 条目）无关。等待审批与执行中统一视为运行中，无状态字段。
_Avoid_: 前台 Agent 面板数据（那是消费方视角）、运行中任务（面板标题，涵盖前台 + 后台两类）

**消息事实处理**:
daemon 对会话子进程上报的 `pushed`、`bound`、`attached`、`acked`、`lifecycle`、`withdrawn` 事实做字段收窄、幂等或单调落库，并生成领域 publication 的过程。`SessionMessageFactsProcessor` 是这些规则及连接级 native session 上下文的权威入口；Socket handler 只校验批次外层与访问权，并把 publication 翻译成 room / SSE 通知。
_Avoid_: 在 Socket handler 内按 fact kind 直接写库、把 Socket/SSE 对象传入事实处理模块

**消息受理**:
daemon 对会话子进程上报的终态消息行的落库受理：nsid 补写（连接级上下文经注入 enricher）、position 锚定（positionBeforeResultId → 归属 result 行 position_at − 1）、上下文边界指针推进、流式快照清理，以及运行状态投影的编排。`SessionMessageIntakeProcessor` 是这些规则的权威入口，以惰性 publication 产出；Socket adapter 只做载荷校验、访问权判定与 publication 翻译（CLI 房间广播 + message-received / session-updated SSE）。
_Avoid_: 在 Socket handler 内内联落库规则（规则必须有主）、把受理与「消息事实处理」混称（事实是消息行的后续状态流转，受理是首次落库）

### 消息出口

**出口剥离**:
消息行离开 daemon 供 web 消费时，按工具策略对 tool_result 重内容做的展示层瘦身——文件类工具结果替换为占位、其余工具截断，Task 族与失败结果豁免。消息行在存储中始终是完整事实层；剥离只作用于消费边界、不可变命中才拷贝，不改存储事实，可随时调整或回退。
_Avoid_: 数据删除（存储未动）、脱敏（目的不是安全）、内容裁剪（不指明发生在消费边界）
