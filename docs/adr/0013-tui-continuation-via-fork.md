# TUI 接续采用 fork 语义：分叉而非接管，终端会话不入账

## Status

accepted（2026-11-18）。取代 [ADR 0001](0001-transport-split-local-remote.md) 中「local 模式长期存在」的前提（其 transport 分流结论随 local 退场一并失效，见该文现状修正）。

## 背景

mobi 同时维护两套会话宿主：remote 模式（Claude Agent SDK 在 mobi 进程内驱动，Web 控制）与 local 模式（spawn 原生 Claude TUI，终端控制）。双模式带来四个方向的持续成本：

- **宿主与 transport 双份**：local 需要 HTTP hook server、HTTP MCP 壳、临时 settings 文件与 hook forwarder 命令；remote 用 SDK 进程内回调，这些设施纯属冗余。
- **模式互切协议**：`switch` RPC、`POST /sessions/:id/switch`、终端快捷键与消息回显、Web「切到远程」按钮、Governor 的「local 不逐出」特例。
- **数据语义**：`mode` 字段贯穿 shared / daemon / web，历史 local 会话与 remote 会话的交互能力不同。
- **真实诉求**：维护者对 local 模式的日常使用几乎为零；终端侧真正需要的只是「Web 会话聊到一半时，能够在终端接着干活」这一兜底能力。

同时，mobi 需要在将来保留接入 ACP / A2A 等 agent 协议的可能性——这要求会话宿主的扩展点保持清晰，但不要求 local 模式继续存在。

## 决定

**删除 local 模式；终端接续改用 fork 语义，终端会话不入 mobi 账。**

1. **会话宿主收敛为 remote 单路径**：删除 local 启动器、local 启动策略、双模循环、终端模式切换 UI（空格 / Ctrl-C / 消息回显）与相关 transport（HTTP hook server、MCP HTTP 壳、临时 hook settings、hook forwarder 命令）。daemon spawn 的会话恒为进程内 SDK 驱动。
2. **`mobi fork` 是唯一的终端接续入口**：
   - 直接只读打开 daemon 的 SQLite（`busy_timeout`、schema 守卫、按 CLI token 的 namespace 过滤），daemon 停机时同样可用；
   - 候选为活跃与休眠、且存在 native session id 的会话，排除归档 / 已结束 / 无 native id；
   - 选中后以会话工作目录为 cwd 执行 `claude --resume <nativeSessionId> --fork-session`；
   - 不注入 mobi 的 append system prompt、hook settings 或 MCP server；fork 出的会话不写 mobi 数据库、不出现在 Web 会话列表。
3. **命令面收敛**：`mobi` 无参打印帮助（引导 Web / `mobi fork` / `mobi daemon start`）；`mobi claude` 保留为 daemon spawn 的内部入口，不再面向终端用户；`mobi sessions list` 改读只读 SQLite。
4. **历史数据只读兼容**：Web 保留对历史 `mode='local'` 会话的展示，输入区呈只读遮罩；`mode` 字段保留在 schema / 摘要 / socket 事件中并标注 deprecated，不再产生新值。模式互切协议面（switch RPC / HTTP 路由 / 事件类型）彻底删除，`PROTOCOL_VERSION` 提升到 2。
5. **daemon 不可达不再降级**：CLI 连不上 daemon 时给出明确错误（并提示 `mobi fork`），不再 `spawn` 裸 claude。

## Considered Options

- **接管式 resume（`claude --resume <nativeSessionId>`）**：与原 Web 会话共享同一 transcript，两侧同时存在会互相改写历史、产生并发写冲突；且「继续」语义会让用户误以为 Web 会话被接管。否决。
- **保留 local 模式作为逃生舱**：维护两套宿主、双模切换协议与 Governor 特例，换取一个使用频率近零的能力；且 local 会话在 Web 侧天然缺观测。否决。
- **fork 后仍登记 mobi 会话（新建 session 行）**：终端会话的生命周期、消息落库与 rewind 语义都要重新对齐，重复 fork 会污染会话列表；而终端会话的价值在于「本地私活」，不需要远程可观测。否决。
- **fork 时注入 mobi 的 hook / MCP**：会让终端会话反向依赖 daemon（hook 转发、工具族都要求 daemon 可达），与「daemon 停机也能接续」的核心诉求冲突。否决。

## Consequences

- **两条分支独立**：fork 前已发生的上下文被复制；之后的对话、文件改动互不影响，原 Web 会话历史不被改写。
- **终端会话不可见于 Web**：需要回到 Web 时，只能从原会话继续，或再 fork 一次；这是刻意的边界，不是缺口。
- **daemon 停机可用**：fork 只依赖本地 SQLite 与原生 claude，不依赖 daemon 进程或网络。
- **升级兼容**：旧 CLI（协议 v1）连接新 daemon 时，错误路径会携带 `X-Mobi-Protocol-Version`，CLI 给出明确的升级提示；`mode` 字段保留读侧容错，历史 local 会话的列表与详情不受影响。
- **未来 agent 协议（ACP / A2A）**：扩展点仍在会话宿主装配层（会话工厂 + 启动循环），`mobi fork` 与 `mobi claude` 内部入口不改变这一判断；fork 的只是 Claude 原生 transcript，不绑定 mobi 的宿主形态。
