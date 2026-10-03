# machine 层删除：单机假设、machineId 作路由残留保留

## Status

accepted（2026-10-03）。personal-agent-rewrite ticket-20/24/25 落地（裁决 Q2/Q4，契约 D4=C，namespace Q6）。

## 背景

原架构是「中心 hub 管多机」：machines 表承载他机注册、心跳、在线状态；会话/消息/文件操作按 machineId 路由到远端 runner；machine 连接（runner↔hub socket）是数据面的一部分。实际使用中**用户始终只有一台 machine**，hub 却为此承载过多会话职责与多机分支：

- machine 连接、心跳、过期驱逐、离线判定等机制真实运转，但服务对象只有本机
- 每条数据通路都带「目标 machine 在不在线、是不是本机」的分支，测试矩阵与认知负担翻倍
- 跨机数据面从未被真实使用（Q2：单机假设成立；Q4：无他机数据需要保留）

## 决定

**删除 machine 层的连接与多机数据面，machines 表退化为单行本机常驻记录：**

1. **删除 machine 连接**（ticket-20）：runner↔hub 的 machine socket 通道整体退场，machine 层操作（文件/uploads/gitReview/webToolsConfig 等 handlers）本地化进 daemon（LocalMachineHost，17 票），spawn 本地直调（18 票）
2. **machines 表恒一行 = 本机**（ticket-24）：daemon 启动自注册并**常驻 active**——由「无翻转点」保证（不存在任何把本机翻成 offline 的代码路径），不靠心跳。他机历史行由一次性迁移脚本删除（预扫描打明细 + `--confirm` 门，零接触拒绝）
3. **users 表一并退场**（ticket-24）：多机多用户语义的残留，无消费方
4. **`machineId` 作路由残留保留（D4=C）**：web 契约（URL 路径 `/api/machines/:id/*` 与消息/会话行的 `machineId` 字段）**零改动**——web 契约冻结（ticket-02）优先于内部语义洁癖。machineId 从路由键降级为归属字段；`list_machines` 工具保留，实现直接返回本机单元素
5. **hub 侧多机死分支删除**（ticket-25）：`machine_mismatch`、`isSameMachineProven` 附件闸、spawn `unreachable` 文案、machineCache 过期/驱逐、settings `apiUrl` 远端分支——逐分支核对不可达依据后删除
6. **namespace 冻结 `default`**（Q6）：Socket.IO namespace 不做迁移清理，`/cli` 路径语义随宿主通道保留（见 [ADR 0009](0009-host-channel-loopback-listener.md)）

## Considered Options

- **保留 machine 层等将来多机**：被否。多机将来只做「轻量中心」（数据同步/发现），不是恢复 hub 式机器路由；留着死分支只会让每次改动都背多机假设
- **连 web 契约一起改（删 machineId 字段与路径段）**：被否（D4=C）。web 全量改寻址的收益只是语义干净，代价是 API surface 破坏性变更 + web 契约冻结失效；机器列表接口返回单元素已是诚实呈现
- **machines 表整体删除**：被否。本机行仍承载 machineId 分配（会话/消息归属锚点）与自注册语义，删表收益为零

## Consequences

- 单机假设成为一等架构事实：daemon 不再有任何「他机」概念，将来多机是新增的轻量同步层而非复活路由
- `checkWorkspaceAssignable` 收窄为 `'ok' | 'not_found'`；所有「machine 不在线」类报错退场（本机恒在线）
- 数据库迁移脚本（`scripts/migrate-personal-agent.ts`）是他机行的唯一清理通道，生产库迁移见 pending #95
- web 端机器维度 UI（机器列表等）继续工作，恒单元素——将来真多机时按新架构重做
- 附带收益：13 项未用依赖、3 个零引用文件随之删除（knip 验证）
