# Context Map

## Contexts

- [CLI](./packages/cli/CONTEXT.md): 本地拉起并托管 Claude Code 会话进程，向 hub 同步状态与消息
- [Hub](./packages/hub/CONTEXT.md): 会话实体的持久化与多端同步（首次建模于分叉会话特性）
- Web、Shared 的 CONTEXT.md 待各自领域首次建模时创建

## Relationships

- **CLI → Hub**: CLI 作为客户端经 socket.io `/cli` 命名空间连接 hub，同步会话事实与消息
- **Web → Hub**: Web 前端经 hub 的 REST API + SSE/socket 消费会话数据，控制指令由 hub 经 RPC 转发给 CLI
