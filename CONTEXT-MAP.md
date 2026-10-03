# Context Map

## Contexts

- [Shared](./packages/shared/CONTEXT.md): 消息词汇（ADR 0002）与内部操作协议 mobi URI 的权威词汇
- [Daemon](./packages/daemon/CONTEXT.md): 单机 daemon 的领域语言——会话实体的持久化与多端同步、daemon / 宿主 / 宿主通道
- [Session](./packages/session/CONTEXT.md): 会话宿主的领域语言——local/remote 会话、锚点（rewind / fork）、轮次变更、进程角色
- [CLI](./packages/cli/CONTEXT.md): 组合根词汇——命令入口、supervisor 托管单 daemon
- [Web](./packages/web/CONTEXT.md): 聊天流中的工具呈现词汇（工具行 / 文件 Chip，首建于工具卡片改版）

## Relationships

- **会话子进程 → daemon（宿主通道）**: 会话子进程（cli `claude` 命令，session 包）经 loopback-only 的独立 Socket.IO listener（`/cli` namespace）向 daemon 同步会话事实与消息
- **Web → daemon**: Web 前端经 daemon 主端口的 REST API + SSE/socket 消费会话数据，控制指令由 daemon 经 RPC 转发给会话子进程
- **supervisor → daemon**: supervisor 只托管单个 daemon 组件（拉起、崩溃退避重启）；daemon 内部完成 spawn、机器层与 Web 服务
