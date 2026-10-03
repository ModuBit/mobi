# CLI 命令体系

`mobi` CLI 的所有命令注册在 `packages/cli/src/commands/registry.ts`，通过 `resolveCommand` 路由到对应的 `CommandDefinition`。

## 命令总览

```
mobi [options]                # 默认命令：启动 Claude Code 会话（远程控制模式）
mobi setup                    # 交互式首次配置向导
mobi service <action>         # supervisor 托管 daemon
mobi daemon <action>          # daemon 进程管理（service daemon 的别名）
mobi runner <action>          # 会话管理工具族（list / stop-session / logs）
mobi logs [target]            # 打印各进程最新日志路径
mobi auth <action>            # 管理认证凭据
mobi version                  # 版本信息
mobi upgrade                  # 自升级
mobi doctor                   # 系统诊断与排障
mobi mcp                      # MCP stdio 桥接（内部使用）
mobi hook-forwarder           # SessionStart hook 转发（内部使用）
```

> `mobi hub` 命令已删除（ticket-22）：hub 与 runner 合并为单机 daemon，进程级操作统一走 `mobi daemon` / `mobi service`。

## 命令详解

### `mobi` (默认命令)

启动一个 Claude Code 会话，经 daemon 实现远程控制。支持透传所有 Claude Code 参数。

| 文件 | `packages/cli/src/commands/claude.ts` |
|------|------|
| 启动模式 | `remote`（默认）经 daemon 由 Web 驱动；降级到 `local` 直接运行 claude |

```
mobi                          启动会话
mobi --yolo                   等同 --dangerously-skip-permissions
mobi --model sonnet           指定模型
mobi --resume                 恢复上次会话
```

### `mobi setup`

交互式首次配置向导，生成 token、配置 host/port、选择启动方式。

| 文件 | `packages/cli/src/commands/setup.ts` |
|------|------|
| 子模块 | `setup/settingsWizard.ts`（配置 settings）、`setup/serviceManager.ts`（系统服务管理） |

```
mobi setup                    完整向导：settings → 选择启动方式
mobi setup settings           仅配置 settings
mobi setup service install    安装为系统服务（launchd / systemd）
mobi setup service remove     移除系统服务
mobi setup service status     查看系统服务状态
```

### `mobi service`

supervisor 托管 daemon 的生命周期。

| 文件 | `packages/cli/src/commands/service.ts` |
|------|------|

```
mobi service start [--host <host>] [--port <port>]
mobi service stop
mobi service restart
mobi service status
```

托管集只含一个 daemon 组件；清空时 supervisor 自动退出。`supervise --sync`（内部子命令）前台运行 supervisor 本体。

### `mobi daemon`

daemon 进程管理，顶层命令是 `service daemon` 子命令的别名。

| 文件 | `packages/cli/src/commands/daemon.ts` |
|------|------|

```
mobi daemon start [--host <host>] [--port <port>]   后台启动（supervisor 托管）
mobi daemon start-sync [--host] [--port]            前台直跑（内部子命令）
mobi daemon stop               停止 daemon（会话子进程保持存活）
mobi daemon restart            重启
mobi daemon status             显示状态
```

**后台启动原理：** `start` 子命令 spawn `daemon start-sync` 作为 detached 子进程，轮询 `/health` 端点确认就绪。

**`start-sync`（内部子命令）：** 动态 import `@mobi/daemon/daemonEntry` 阻塞运行。不应对用户暴露。

### `mobi runner`

会话管理工具族。runner 与 hub 同进程为 daemon，进程级操作走 `mobi daemon` / `mobi service`。

| 文件 | `packages/cli/src/commands/runner.ts` |
|------|------|

```
mobi runner list                 列出活跃会话
mobi runner stop-session <id>    停止指定会话
mobi runner logs                 显示最新日志文件路径
```

### `mobi logs`

打印各进程最新日志文件路径。

| 文件 | `packages/cli/src/commands/logs.ts` |
|------|------|

```
mobi logs            打印 hub / runner / cli 各自最新路径
mobi logs hub        打印最新 hub 日志路径
mobi logs runner     打印最新 runner 日志路径
mobi logs cli        打印最新 cli 日志路径
mobi logs all        等同 mobi logs
```

### `mobi auth`

管理认证凭据。

| 文件 | `packages/cli/src/commands/auth.ts` |
|------|------|

```
mobi auth status              查看当前认证配置
mobi auth login               手动输入 CLI_API_TOKEN
mobi auth logout              清除本地凭据
```

**Token 优先级：** `CLI_API_TOKEN` 环境变量 > `~/.mobi/settings.cli.json` > 自动生成

> 首次配置推荐使用 `mobi setup settings`，它会自动生成 token。

### `mobi version`

版本信息与可用版本列表。

| 文件 | `packages/cli/src/commands/version.ts` |
|------|------|

```
mobi version                  显示当前版本
mobi version list             列出可用版本（stable）
mobi version list --all       列出 stable + rc 版本
mobi version list rc          仅列出 rc 版本
```

### `mobi upgrade`

自升级到最新版本。

| 文件 | `packages/cli/src/commands/upgrade.ts` |
|------|------|
| 模块 | `upgrader/checker.ts`（版本检查）、`upgrader/downloader.ts`（下载校验）、`upgrader/replacer.ts`（原子替换） |

```
mobi upgrade                  升级到最新 stable
mobi upgrade --rc             升级到最新 rc
mobi upgrade v0.2.0           升级到指定版本
```

**流程：** 版本比较 → 下载 checksums → 下载二进制 → SHA256 校验 → 解压 → 原子替换 → 检测活跃进程并提示重启

### `mobi doctor`

系统诊断与排障工具。

| 文件 | `packages/cli/src/commands/doctor.ts` |
|------|------|
| 子模块 | `runner/doctor.ts`（进程发现与清理，现位于 daemon 包）、`ui/doctor.ts`（诊断 UI） |

```
mobi doctor                   运行完整诊断
mobi doctor hub               诊断 daemon 服务域问题
mobi doctor runner            诊断 runner 域问题
mobi doctor clean             清理所有残留进程
mobi doctor clean [profile]   清理指定 profile 的残留进程
mobi doctor exits [--process hub|runner|cli] [--limit N]
                              查看近期进程退出记录
```

**可清理的进程类型：** supervisor、旧 hub/runner 形态及其 spawn 会话、版本检查（含 dev 变体）。⚠️ 已知缺口：`daemon start-sync` 进程未被分类规则识别（落 `user-session`，不在清理集合），见 docs/pending.md。

### `mobi mcp` / `mobi hook-forwarder`

内部命令，不面向用户。

| 命令 | 文件 | 用途 |
|------|------|------|
| `mcp` | `commands/mcp.ts` | MCP stdio 桥接，供 Claude Code 集成 |
| `hook-forwarder` | `commands/hookForwarder.ts` | 转发 SessionStart hook 到主 CLI 进程 |

## 公共约定

### 帮助文本

所有面向用户的命令支持 `-h` / `--help`，格式统一：

```
mobi <cmd> - <一句话描述>

Usage:
  mobi <cmd> <subcommand> [options]    <说明>
```

### 后台进程模式

`start`（公开）→ spawn `start-sync`（内部）→ detached + unref → 轮询就绪：

```typescript
const child = spawnMobiCli(['daemon', 'start-sync'], { detached: true, stdio: 'ignore' })
child.unref()
// 轮询 /health
```

### 状态持久化

| 组件 | 文件 | 字段 |
|------|------|------|
| daemon | `~/.mobi/daemon.state.json` | pid, hubPort（主端口）, hostPort（宿主通道）, runnerHttpPort, startTime |
| Settings | `~/.mobi/settings.hub.json` + `~/.mobi/settings.cli.json` | token / 监听 / machineId / claudeEnv 等（见 [配置指南](../configuration.md)） |

`hub.state.json` / `runner.state.json` 已停写（ticket-22，daemon.state.json 是唯一进程状态源）。

### 系统服务

| 平台 | 机制 | 路径 |
|------|------|------|
| macOS | launchd | `~/Library/LaunchAgents/com.modu.mobi.plist` |
| Linux | systemd user unit | `~/.config/systemd/user/mobi.service` |

两者共用同一个 wrapper 脚本 `~/.mobi/mobi-service.sh`：后台启动 daemon → 轮询就绪。
