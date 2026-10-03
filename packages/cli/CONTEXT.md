# CLI（组合根）

cli 侧的领域语言：二进制入口与进程编排。会话宿主词汇（local/remote、锚点、轮次变更等）见 [session 包](../session/CONTEXT.md)，daemon 词汇见 [daemon 包](../daemon/CONTEXT.md)。

## Language

### 进程角色

**组合根**:
cli 包的定位——只含入口、命令路由、supervisor/setup/upgrader/auth UI 与 runtime 编译期资产；daemon 与 session 按命令经动态 import 装配，cli 自身无业务逻辑。
_Avoid_: 客户端（多机拓扑下的旧定位，已废）

**Supervisor**:
组件守护进程，只托管单个 daemon 的拉起、崩溃退避重启；控制通道为 unix domain socket。托管集清空时自动退出。
_Avoid_: 托管 hub 与 runner（旧拓扑，runner 已并入 daemon）

**会话子进程**:
daemon 经宿主 spawn 的 `mobi claude` 子进程（源码直跑，session 包），经宿主通道回连 daemon。
_Avoid_: CLI 客户端（旧拓扑下会话由远端机器的 CLI 提供）
