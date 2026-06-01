# CLI 命令体系

`mobi` CLI 的所有命令注册在 `packages/cli/src/commands/registry.ts`，通过 `resolveCommand` 路由到对应的 `CommandDefinition`。

## 命令总览

```
mobi [options]                # 默认命令：启动 Claude Code 会话（远程控制模式）
mobi setup                    # 交互式首次配置向导
mobi service <action>         # 统一管理 Hub + Runner
mobi hub <action>             # 单独管理 Hub 服务器
mobi runner <action>          # 单独管理 Runner 进程
mobi auth <action>            # 管理认证凭据
mobi version                  # 版本信息
mobi upgrade                  # 自升级
mobi doctor                   # 系统诊断与排障
mobi mcp                      # MCP stdio 桥接（内部使用）
mobi hook-forwarder           # SessionStart hook 转发（内部使用）
```

## 命令详解

### `mobi` (默认命令)

启动一个 Claude Code 会话，通过 Hub 实现远程控制。支持透传所有 Claude Code 参数。

| 文件 | `packages/cli/src/commands/claude.ts` |
|------|------|
| 启动模式 | `remote`（默认）通过 Hub 桥接；降级到 `local` 直接运行 claude |

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
| 子模块 | `setup/settingsWizard.ts`（配置 settings.json）、`setup/serviceManager.ts`（系统服务管理） |

```
mobi setup                    完整向导：settings → 选择启动方式
mobi setup settings           仅配置 settings.json
mobi setup service install    安装为系统服务（launchd / systemd）
mobi setup service remove     移除系统服务
mobi setup service status     查看系统服务状态
```

**配置内容：**
- `cliApiToken` — 自动生成或重新生成
- `listenHost` / `listenPort` — Hub 监听地址（默认 127.0.0.1:2222）
- `apiUrl` — 从 host:port 自动派生

**启动方式三选一：**
1. 立即启动（后台进程，重启后需手动）
2. 安装为系统服务（开机自启）
3. 稍后手动启动

### `mobi service`

统一管理 Hub 和 Runner 的生命周期。先启动 Hub 等待就绪，再启动 Runner。

| 文件 | `packages/cli/src/commands/service.ts` |
|------|------|

```
mobi service start [--host <host>] [--port <port>]
mobi service stop
mobi service restart
mobi service status
```

**停止顺序：** 先 Runner → 再 Hub（确保连接正确关闭）

### `mobi hub`

单独管理 Hub 服务器。

| 文件 | `packages/cli/src/commands/hub.ts` |
|------|------|

```
mobi hub start [--host <host>] [--port <port>]
mobi hub stop
mobi hub restart
mobi hub status
```

**后台启动原理：** `start` 子命令 spawn `hub start-sync` 作为 detached 子进程，轮询 `/health` 端点确认就绪。

**`start-sync`（内部子命令）：** 直接 `import` hub 入口，阻塞运行。不应对用户暴露。

### `mobi runner`

单独管理 Runner 进程。

| 文件 | `packages/cli/src/commands/runner.ts` |
|------|------|

```
mobi runner start                后台启动
mobi runner stop                 停止（会话保持存活）
mobi runner restart              重启
mobi runner status               查看状态（PID、端口、心跳等）
mobi runner list                 列出活跃会话
mobi runner logs                 显示最新日志文件路径
mobi runner stop-session <id>    停止指定会话
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

**Token 优先级：** `CLI_API_TOKEN` 环境变量 > `~/.mobi/settings.json` > 自动生成

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
| 子模块 | `runner/doctor.ts`（进程发现与清理）、`ui/doctor.ts`（诊断 UI） |

```
mobi doctor                   运行完整诊断
mobi doctor hub               诊断 Hub 问题
mobi doctor runner            诊断 Runner 问题
mobi doctor clean             清理所有残留进程
mobi doctor clean [profile]   清理指定 profile 的残留进程
```

**可清理的进程类型：** runner、hub、runner-spawned-session、runner-version-check 及其 dev 变体。

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
const child = spawnMobiCli(['hub', 'start-sync'], { detached: true, stdio: 'ignore' })
child.unref()
// 轮询 /health 或 checkIfRunnerRunningAndCleanupStaleState()
```

### 状态持久化

| 组件 | 文件 | 字段 |
|------|------|------|
| Hub | `~/.mobi/hub.state.json` | pid, listenHost, listenPort, startTime |
| Runner | `~/.mobi/runner.state.json` | pid, httpPort, startTime, lastHeartbeat, runnerLogPath |
| Settings | `~/.mobi/settings.json` | cliApiToken, listenHost, listenPort, apiUrl, updateChannel |

### 系统服务

| 平台 | 机制 | 路径 |
|------|------|------|
| macOS | launchd | `~/Library/LaunchAgents/com.modu.mobi.plist` |
| Linux | systemd user unit | `~/.config/systemd/user/mobi.service` |

两者共用同一个 wrapper 脚本 `~/.mobi/mobi-service.sh`：后台启动 Hub → 轮询就绪 → 前台 exec Runner。
