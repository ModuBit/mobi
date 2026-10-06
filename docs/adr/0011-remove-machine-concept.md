# remove-machine：hub/runner/machine 概念彻底移除（代码 + 契约 + DB + 落盘文件）

## Status

accepted（2026-10-06）。取代 [ADR 0010](0010-machine-layer-removal.md)（其 D4=C「machineId 作路由残留保留」裁决作废，其余单机化结论被本 ADR 继承）；修订 [ADR 0006](0006-session-addressed-machine-executed.md)（「machine 执行」已本地化为 daemon 内 ExecutorHost 直调，且 `/api/machines/:id/*` 通道随本 ADR 删除）。

## 背景

ADR 0010 完成了 machine 层连接与多机数据面的删除，但按其 D4=C 裁决保留了 machineId 作「路由残留」：`/api/machines/:id/*` URL 族、`Workspace.machineId`、`sessions.metadata.machineId`、machines 表恒一行、内部 `MachineHost`/`LocalMachineHost`/`hubServer` 等命名。当时否决全量清理的理由是「~140 文件、收益仅整洁且将来要加回多机」。

实际运行后重新评估：**旧契约字段不是多机重启的资产，而是复活成本**——将来按 #82 既定原则「多机按新架构重做」时，这些残留只会是要逐一拆除的旧接口，而不是可复用的地基。单机 daemon 定稿后（personal-agent-rewrite），「hub + runner 同进程」的过渡词汇也失去了指代对象，`mobi runner`/`mobi doctor hub` 等命令面成为死引用。

## 决定

**彻底移除 hub / runner / machine 概念**，范围四层：

1. **代码**：死代码与 supervisor 升级兼容层先删（①）；内部命名一把梭——`hubServer.ts`→`server.ts`、`runner/`+`machine/`→`executor/`（`MachineHost`→`ExecutorHost`、`LocalMachineHost`→`LocalExecutor`、`RunnerState`→`ExecutorState`、`MachineMetadata`→`HostMetadata`），并**收窄 D4=C 冻结的 machineId 形参**（ExecutorHost 全接口去 machineId 首参，本地直调无路由标识）
2. **HTTP 契约**：16 条 `/api/machines/:id/*` 路由按资源域重组——`POST /api/sessions/spawn`、`/api/files/*` 五条、`/api/sdk/host-metadata`、`/api/web-tools(+/verify)`、`GET /api/daemon/status`（SSE `machine-updated`→`daemon-status`）；agent/socket 协议删 `AgentMachineSummary`/`machineId` 入参
3. **DB**：machines 表 DROP，sessions/workspaces 的 machine_id 列删（`createSchema` 定稿 + `scripts/migrate-remove-machine.ts` 迁移，BASELINE=0 不递增版本）
4. **落盘与命令面**：`settings.hub.json`→`settings.daemon.json`、`daemon.state.json` 字段 `hubPort/runnerHttpPort`→`httpPort/controlPort`、`runner.lock`→`daemon.lock`（含旧锁活性检测防双实例）——全部**读旧写新**，升级窗口无感；`mobi runner`/`mobi doctor hub|runner` 命令删，`mobi sessions`/`mobi daemon` 承接；日志进程类型收敛 `daemon|cli`（历史 `-hub.log`/`-runner.log` 读取侧归并）

## Considered Options

- **维持 D4=C（保留 machineId 契约）**：被否。走查证实契约残留的实际代价（每次 API 改动都要绕开 machineId 寻址的特例、web 端机器间接层、测试矩阵的空串形参约定）随时间递增，而「将来加回多机」的场景已明确走轻量同步层路线，不复用这些字段
- **只改内部命名、契约与 DB 留 machineId**：被否。半改状态最差——内部无 machine 概念后，契约里的 machineId 成为纯噪音，且 DB 仍背 machines 表
- **machineId 改名 deviceId 保留字段**：被否（用户裁决「彻底删，不留 deviceId」）。单机世界里归属字段无信息量

## Consequences

- **兼容矩阵**：新二进制 + 旧库 → 启动即拒并引导跑迁移脚本；旧二进制 + 新库 → 拒启（REQUIRED_TABLES）；**回退必须整库还原备份**。生产部署顺序：停 daemon → 换二进制 → `bun scripts/migrate-remove-machine.ts --confirm ~/.mobi/mobi.db` → 起 daemon
- 落盘文件升级全自动（读旧写新），生产 ~/.mobi 无需手工处理
- `metadata.startedBy` 新值 `'daemon'`，存量行 `'runner'` 值保留读侧容错；历史日志文件名与 exits.log 记录同策略归并
- 将来多机：按新架构新增轻量同步/发现层，不复用本次删除的任何契约（#82 原则不变，machineId 清理不影响其恢复条件）
- 全程走查与逐票记录见 `.scratch/remove-machine-concept/`（16 票，①死代码 → ②HTTP 契约 → ③agent 协议 → ④DB → ⑤落盘 → ⑥收口）
