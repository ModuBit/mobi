# Context Map

## Contexts

- [CLI](./packages/cli/CONTEXT.md): 本地拉起并托管 Claude Code 会话进程，向 hub 同步状态与消息
- [Hub](./packages/hub/CONTEXT.md): 会话实体的持久化与多端同步（首次建模于分叉会话特性）
- [Shared](./packages/shared/CONTEXT.md): 消息词汇（ADR 0002）与内部操作协议 mobi URI 的权威词汇
- [Web](./packages/web/CONTEXT.md): 聊天流中的工具呈现词汇（工具行 / 文件 Chip，首建于工具卡片改版）

## Relationships

- **CLI → Hub**: CLI 作为客户端经 socket.io `/cli` 命名空间连接 hub，同步会话事实与消息
- **Web → Hub**: Web 前端经 hub 的 REST API + SSE/socket 消费会话数据，控制指令由 hub 经 RPC 转发给 CLI
