# Session（会话宿主）

会话宿主侧的领域语言：与 Claude Code 会话进程共处一个进程的一切——local/remote 会话、锚点、轮次变更。

会话宿主 = 会话子进程内运行的 mobi 代码（`packages/session/`）。它由 daemon 经宿主通道 spawn 并回连；local 与 remote 的区分标准是**谁在控制会话**（本地终端 vs Web 远程），不是进程拓扑。

## Language

### 会话控制方向

**local 模式**:
本地终端控制——用户在本机终端直接操作，mobi spawn 独立的 claude 子进程，用户与该子进程交互。
_Avoid_: 交互模式、interactive（旧口头称呼）

**remote 模式**:
远程控制——会话经 daemon 由 Web 端驱动，Claude 以 SDK Query 形态跑在 mobi 进程内（headless，无终端 UI）。
_Avoid_: headless 模式（旧口头称呼）

### 锚点

两个锚点同源（都取自消息的 native uuid），方向相反：rewind 从锚点**向前丢弃**，fork 从锚点**向前保留**。

**Rewind 锚点**:
rewind 的回退目标——用户消息的 nativeId，激活时换算为其前最近一条 assistant entry（resumeSessionAt 保留锚），截断重启只保留该锚（含）之前的历史。
_Avoid_: 直接把用户消息 uuid 当 resumeSessionAt（会保留该条导致重发重复）

**分叉锚点**:
fork 的分叉基点——agent 回复消息的 nativeId，激活时直接作截断式 fork 的 resumeSessionAt（含该条），分叉会话的历史锁定在点 fork 时刻的锚点，不受 parent 后续变化影响。
_Avoid_: 分叉点（口语）、fork 点

### Query 重启

**Restart module**:
remote 模式中 Query 重启的单一状态所有者。rewind 与 output style 切换只向它提交重启意图；它统一管理异步准备占位、待执行单槽、消息队列清理与退出哨兵配对，launcher 负责消费和完成请求。
_Avoid_: 让 handler 或 launcher 直接读写 pending / in-flight 标志，或者自行清队列并注入哨兵。

### 轮次变更

**轮次变更（Turn Diff）**：
一轮对话造成的文件变更事实——会话宿主在轮次结束时合成并落库的 custom 消息（shared「自定义事件」形态，name=`turn-diff`）。事实源按 v3 供数反转分层：归因主源 = turn 内工具层内容对累积（本会话 Edit 族，封口归档供历史轮回看）；实况兜底 = 相邻两轮快照之间的 git 差异（累积为空才回落）；非 git 目录退化为工具事件投影的近似口径。文件清单与增删统计只有一个权威口径，聊天卡与审查视图共用同一份事实。
_Avoid_: 逐次编辑流水（那是工具行粒度，不是轮次粒度）、双口径统计（卡片与审查的数字必须同源）、把快照 diff 当主源（并发会话/手改会互相归因）

**轮次快照（Turn Snapshot）**：
轮次边界上对工作区可追踪内容的一次 git 目录快照——只落 git 对象与引用，不产生提交、不进入分支历史、不触碰用户暂存区与工作区。轮次变更的实况兜底 = 相邻快照之差；快照引用按会话聚集、随会话生灭（会话删除即清理引用，未清理的引用只钉住压缩字节，无运行时成本）。
_Avoid_: 全文备份/内容快照（快照引用已有 git 对象，不复制文件内容）、影子提交（没有 commit）

**上一轮（Last Turn）**：
审查 turn 档的缺省语义 = 最新封口归档轮（供数器 `TurnAttributionProvider` 收口，归因口径）；归档未覆盖时回落快照链口径——store 的 `lastTurnDiff`（base = 链尾 -2、head = 链尾，引用与 per-file diff 一并返回）。链不足两颗（baseline 缺失/空仓库无链）= 拿不到上一轮（`null`，消费方各自降级：合成器退投影口径、审查档位置空）；空轮（两树内容无差异）= git 口径但零变更（空 files，不发卡），两者不是一回事。不存在 HEAD 兜底语义（`632048b2`：不裹挟历史未提交变更）。
_Avoid_: 各消费方自行从链推导「上一轮」（口径双写）、HEAD 树兜底（裹挟历史改动）、绕开供数器直查归档或快照链

### 进程内组件

**会话传输（SessionTransport）**:
CLI↔daemon socket 的连接生命周期 module——建连鉴权、断线重连（内置自动重连 + 服务端断开的手动兜底退避，loopback 口径 0.5s 起封顶 5s）、connect_error 节流落盘、ack 发送咽喉（emitWithAck 统一超时）、keepAlive 心跳。不含任何会话语义。
_Avoid_: 在协议层直接摸 socket（emit/timeout 散落）、把重连退避当远端 hub 时代口径调（1s→30s 已随单机化作废）

**会话协议（SessionChannel）**:
CLI↔daemon 的会话语义 module——入站分流（用户消息入队 + seq 记账 + 断线 HTTP 补拉）、出站消息五族、流式快照三方法、事实与状态上报（单一 `report` 出口，kind 映射回各 socket 事件，wire 不变）、rewind 两段回报（可靠队列）、agent 编排 RPC、metadata/agentState 版本化 CAS。连接反应（补拉/重基线/存活上报）由它响应传输回调。
_Avoid_: 绕开 report 直接 emit 事实类事件、把传输保活语义（重连/心跳）写进协议层

`ApiSessionClient` 是两者的装配门面：生命周期编排（IdleTimer/RpcHandlerManager/flush/close 次序）+ 对消费者的 EventEmitter 事件；37 个公开成员零迁移。

**会话运行（claudeRemote 单轮）**:
remote 会话单轮运行 module，interface = 轮次装配参数（RemoteRoundParams，含 rewind/fork 子对象）+ 消息源 + 事件汇三分组（深化候选④票①）。SDK options 装配、attach 编舞（预热/提前激活/fallback/截断四路径）、双循环协调都在其后。
_Avoid_: 给它加第 N 个回调参数（新事件进事件汇 interface）、把 launcher 的编排逻辑写进运行层

**事件汇（RemoteSessionEvents）**:
会话运行 module → launcher 的全部回调与能力回投，单一 listener 对象。字段名与历史回调名一致（零翻译），可选性是调用契约——缺省 onRewindRefusal 即「非 rewind 轮」的语义门控。
_Avoid_: 往轮次参数里塞 on* 回调、绕开 listener 直接透传散回调

**消息源（MessageSource）**:
本轮待投递用户消息的拉取与交回（nextMessage + onCollectedMessageAbandoned）。独立成组的意义是测试面——事件汇 fake + 可控消息源可直驱运行层，锁 attach 编舞（提前激活/fallback/rewind/fork 四路径）的对外可观察行为。
_Avoid_: 测试里构造整套 launcher 才能驱动 claudeRemote

**转换链（SessionStreamRuntime）**:
SDK 消息 → 落库行的转换装配 module（深化候选④票③）：converter（SDKToLogConverter）、出站排队（OutgoingMessageQueue 的 tool_use 配对延迟与 FIFO 仲裁）、流式快照发送器工厂三件单一归属。dispatch 的「result 先入列再触发轮次合成」顺序契约在此锁定（此前靠跨文件时序注释维持）；运行层经 `createSnapshotSender` 消费，不再借 converter。
_Avoid_: 在 launcher/运行层直接 new converter 或 OutgoingMessageQueue、把停止/撤回语义写进转换链（经 dispatchHooks 注入）

**Hook Server**:
local 模式下接收 Claude 子进程 SessionStart hook 的本地 HTTP server（hook 经 hook-forwarder 命令转发）。

**mobi MCP Server**:
承载 `change_title` 等面向模型的工具的 MCP server；local 模式为 HTTP transport，remote 模式为 SDK 进程内 server。
