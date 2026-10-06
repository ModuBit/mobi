# 会话宿主 = 子进程 + Socket.IO loopback 宿主通道（独立 listener）

## Status

accepted（2026-10-03）。personal-agent-rewrite ticket-21 落定（Q10=a）。

## 背景

原拓扑中 runner 与 hub 分离，会话 CLI 经公网可达的 hub 端口连接（hub/runner 为单机 daemon 定稿前的历史组件名）（`/cli` namespace + `/cli/*` HTTP 与 Web 流量同 listener）。进程合并（ticket-16）与 spawn 本地化（ticket-18）之后，会话子进程与 daemon 恒同机——会话回连流量不再需要（也不应该）走暴露面：

- 会话子进程的认证 token 走宿主通道，若通道与公网流量同端口，攻击面无谓扩大
- frp 反向代理场景下，外网流量到达 daemon 时来源地址恒为 loopback——**不能按来源地址区分「本机会话」与「外网请求」**（07 K 实证）
- 会话生命周期由 daemon spawn 管理，双向都只在本机发生

## 决定

**会话宿主（daemon 内 spawn `mobi claude` 的会话子进程）经独立的 loopback-only Socket.IO listener 回连 daemon：**

1. **独立 listener**：第二个 Bun server 实例只绑 `127.0.0.1`，承载 `/cli` Socket.IO namespace 与 14 个 `/cli/*` HTTP 路由。主端口的这些路径显式 404（SPA fallback 之前，测试锁定）。Web 与 `/terminal` 留在主端口
2. **端口派生**：宿主端口 = 主端口 + 10000（2222→12222），`MOBI_HOST_PORT` 可覆盖；派生越界（>55535）wrap 回非特权段并 warn。`daemon.state.json` 记录 `hostPort`
3. **frp 只转发主端口**——宿主通道外网物理不可达，这是边界保证而不是配置约定
4. **token 收紧**：沿同机配对同步（daemon 首启把 `cliApiToken` 同步进 `settings.cli.json`）；settings 文件统一 chmod 0600（tmp+rename 写、daemon 启动补齐存量）。`CLI_API_TOKEN` 校验保留作纵深防御
5. **会话子进程地址注入**：daemon spawn 会话时经 env 显式注入 `MOBI_API_URL=127.0.0.1:<hostPort>`，不依赖 settings 猜测；profile env 的 `MOBI_API_URL` 指主端口（web vite proxy 同键双消费），不被会话消费
6. **namespace 冻结 `default`**（Q6）：`/cli` 路径语义保留，Socket.IO namespace 不再迁移

## Considered Options

- **同进程会话（daemon 内直接跑 Query，无子进程）**：被否。会话进程隔离是既有价值——daemon 崩溃/升级不连带杀会话（`mobi daemon stop` 会话存活是 ticket-22 明确语义）、会话资源与生命周期独立核算、local 模式的 spawn 判据（/session-started webhook）零改动。同进程化省一次 spawn 与一条 loopback 连接，换来进程模型回退
- **按来源地址判断（同 listener，loopback 来源视作本机会话）**：被否。frp 下外网流量到达时来源地址恒 loopback，判断不可靠——07 K 已实证。地址不是身份，通道才是
- **UDS（unix domain socket）替代 loopback TCP**：可行性存疑（Socket.IO over UDS 需自研 engine 适配，SDK/工具链零支持），且 loopback TCP 已满足「外网不可达」目标。另立可选后续（⑥ 阶段）

## Consequences

- 外网访问 `https://<公网域名>/cli/...` 必然 404，可作部署后验证判据
- 多 profile（dev/e2e）宿主端口由主端口派生，天然互不冲突（12222/12223/12224）
- 会话子进程的连接配置不再有「远端 hub」分支（ticket-25 删除 `settings.apiUrl` 的依据）
- hubServer 装配双 listener、双 socket.io 实例（宿主 `/cli`、主端口 `/web`+`/terminal`），engine 与各自 Bun.serve 挂载需配对（曾出现绑反导致 Invalid namespace，E2E 实证后修正）
- 「宿主」「宿主通道」词汇进 daemon 包 CONTEXT，作为进程拓扑的正式领域语言
