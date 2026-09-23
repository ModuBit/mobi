# Hub（会话同步中心）

hub 侧的领域语言：会话实体的持久化与多端同步。

## Language

### 会话实体

**会话行**:
hub 中一个 mobi 会话的持久化实体。一个会话行的生命周期内可以跨多个 native session（如 /clear 换链、fork 激活换链），归属关系靠消息行的 metadata 维系。
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
消息落库时被标记为 `queued` 并进入投递队列。**只有人发出的消息入队**；会话之间投递的消息不入队——落库即终态，由 Hub 经 RPC 直推给目标会话，因此不可取消、不可编辑，也不会在 Web 上呈现排队态。
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
agent 回复生成期间，CLI、Hub 与 Web 之间传递并衔接当前消息内容的同步过程。完整快照是可独立解释的版本基线，快照增量只描述相对某个基线的后续变化。
_Avoid_: 消息同步（范围过宽）、流式转发（忽略基线与追赶语义）

**运行状态投影**:
Hub 将已持久化的消息内容按到达顺序归约为 `runtimeState`（todos、tasks、teamState、backgroundTasks、foregroundTasks）的过程。`SessionMessageRuntimeProjector` 是规则、跨消息配对状态和持久化顺序的权威入口；Socket handler 对这部分只负责校验、鉴权、调用与发布。
_Avoid_: 重建完整消息（投影只生成当前摘要）、在 Socket handler 内直接合并 runtimeState

**前台任务**（foregroundTasks）:
Agent 类工具在前台执行中的清单，由 Hub 从消息投影维护（tool_use 入、tool_result 出、轮次 result 到达清扫孤儿）。与「后台任务」（backgroundTasks，CLI 上报通道）相对；与「任务列表」（tasks，TaskCreate 条目）无关。等待审批与执行中统一视为运行中，无状态字段。
_Avoid_: 前台 Agent 面板数据（那是消费方视角）、运行中任务（面板标题，涵盖前台 + 后台两类）

**消息事实处理**:
Hub 对 CLI 上报的 `pushed`、`bound`、`attached`、`acked`、`lifecycle`、`withdrawn` 事实做字段收窄、幂等或单调落库，并生成领域 publication 的过程。`SessionMessageFactsProcessor` 是这些规则及连接级 native session 上下文的权威入口；Socket handler 只校验批次外层与访问权，并把 publication 翻译成 room / SSE 通知。
_Avoid_: 在 Socket handler 内按 fact kind 直接写库、把 Socket/SSE 对象传入事实处理模块

### 消息出口

**出口剥离**:
消息行离开 hub 供 web 消费时，按工具策略对 tool_result 重内容做的展示层瘦身——文件类工具结果替换为占位、其余工具截断，Task 族与失败结果豁免。消息行在存储中始终是完整事实层；剥离只作用于消费边界、不可变命中才拷贝，不改存储事实，可随时调整或回退。
_Avoid_: 数据删除（存储未动）、脱敏（目的不是安全）、内容裁剪（不指明发生在消费边界）

### 桌面观看（desktop）

**观看流**:
一个 machine 的一条桌面画面链路：cli 侧连被控端 VNC server（attach），观看端经 hub 观察（observe）。同 machine 同时只有一条，新观看抢占旧观看。
_Avoid_: 桌面会话（与 Claude 会话行混用）、直播流

**抢占**:
同 machine 的新观看使旧观看被拆除的机制。旧的观看端收到归因关闭（superseded）且不自动重连。
_Avoid_: 顶掉、踢下线

**view-only**:
观看流的服务端强制模式：hub 在 RFB 消息边界剥除一切输入事件（键盘/指针/剪贴板/分辨率变更），UI 上的只读状态只是体验呈现，权限边界在 hub。
_Avoid_: 只读模式（UI 语感，弱化了服务端强制语义）

**控制权**:
观看端经显式动作（「接管控制」）从 view-only 获得的输入注入许可。hub 侧放行输入消息；回落时机三重：观看会话结束、不操作超时（10 分钟）、用户主动退出。
_Avoid_: 接管（那是用户动作的名字，不是状态）、控制模式

**代认证**:
hub 替观看端应答被控端 VNC 认证挑战（RFB VNC-auth）的机制——密码只存在于 cli 与 hub 的内存中，不落浏览器、不落盘。
_Avoid_: 密码代理、认证转发
