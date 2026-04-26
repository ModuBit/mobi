# Mobi 配置指南

本文档介绍 Mobi 的配置方式，包括 `~/.mobi` 目录结构、`settings.json` 配置项以及环境变量覆盖。

## 目录结构

```
~/.mobi/                           # MOBI_HOME 可覆盖此路径
├── settings.json                  # 主配置文件（CLI + Hub 共享）
├── access.key                     # 认证密钥（加密存储）
├── mobi.db                        # SQLite 数据库（Hub）
├── runner.state.json              # Runner 进程状态
├── runner.state.json.lock         # Runner 锁文件（防止多实例）
├── hub.state.json                 # Hub 进程状态
└── logs/                          # 日志目录
    ├── runner.log                 # Runner 日志
    └── hub.log                    # Hub 日志
```

### 文件说明

| 文件 | 用途 | 创建时机 |
|------|------|---------|
| `settings.json` | 主配置文件，存储 CLI 和 Hub 的持久化配置 | 首次运行时自动创建 |
| `access.key` | 认证密钥，包含加密公钥和 token | `mobi auth login` 后创建 |
| `mobi.db` | SQLite 数据库，存储会话、消息等数据 | Hub 首次启动时创建 |
| `runner.state.json` | Runner 进程状态（PID、端口、启动时间） | Runner 启动时写入 |
| `runner.state.json.lock` | Runner 锁文件，防止多实例运行 | Runner 启动时创建 |
| `hub.state.json` | Hub 进程状态（PID、监听地址、端口） | Hub 启动时写入 |
| `logs/runner.log` | Runner 运行日志 | Runner 运行时追加 |
| `logs/hub.log` | Hub 运行日志 | Hub 运行时追加 |

## settings.json 配置项

`settings.json` 同时被 CLI 和 Hub 读取，包含以下配置项：

### 通用配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `machineId` | string | 自动生成 | 机器唯一标识，用于 Hub 注册 |
| `machineIdConfirmedByServer` | boolean | false | 服务器是否已确认 machineId |
| `cliApiToken` | string | 自动生成 | CLI 认证令牌，首次运行 Hub 时生成 |
| `runnerAutoStartWhenRunningMobi` | boolean | - | 运行 mobi 时是否自动启动 Runner |

### Hub 服务配置

| 配置项 | 类型 | 默认值 | 环境变量 | 说明 |
|--------|------|--------|---------|------|
| `listenHost` | string | `127.0.0.1` | `MOBI_LISTEN_HOST` | 监听地址 |
| `listenPort` | number | `2222` | `MOBI_LISTEN_PORT` | 监听端口 |
| `publicUrl` | string | `http://localhost:2222` | `MOBI_PUBLIC_URL` | 公网访问地址 |
| `corsOrigins` | string[] | 从 publicUrl 推导 | `CORS_ORIGINS` | CORS 允许的源 |

### Session 超时配置（CLI）

| 配置项 | 类型 | 默认值 | 环境变量 | 说明 |
|--------|------|--------|---------|------|
| `disconnectTimeoutMs` | number | `600000` (10分钟) | `MOBI_DISCONNECT_TIMEOUT_MS` | 连接断开后超时退出时间 |
| `idleTimeoutMs` | number | `86400000` (1天) | `MOBI_IDLE_TIMEOUT_MS` | 无活动后超时退出时间 |
| `timeoutWarningMs` | number | `300000` (5分钟) | `MOBI_TIMEOUT_WARNING_MS` | 超时前预警时间 |

### Web Push 配置（Hub）

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `vapidKeys.publicKey` | string | VAPID 公钥（Base64） |
| `vapidKeys.privateKey` | string | VAPID 私钥（Base64） |

## 环境变量

### CLI 环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径，支持 `~` 展开 | 仅环境变量 |
| `MOBI_API_URL` | Hub API 地址 | 环境变量 > settings.json |
| `CLI_API_TOKEN` | CLI 认证令牌 | 环境变量 > settings.json |
| `MOBI_EXPERIMENTAL` | 启用实验性功能（`true`/`1`/`yes`） | 仅环境变量 |
| `MOBI_DISCONNECT_TIMEOUT_MS` | 连接断开超时（毫秒） | 环境变量 > settings.json |
| `MOBI_IDLE_TIMEOUT_MS` | 交互不活跃超时（毫秒） | 环境变量 > settings.json |
| `MOBI_TIMEOUT_WARNING_MS` | 预警提前时间（毫秒） | 环境变量 > settings.json |

### Hub 环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径 | 仅环境变量 |
| `DB_PATH` | SQLite 数据库路径 | 仅环境变量 |
| `CLI_API_TOKEN` | CLI 认证令牌 | 环境变量 > settings.json > 自动生成 |
| `MOBI_LISTEN_HOST` | 监听地址 | 环境变量 > settings.json |
| `MOBI_LISTEN_PORT` | 监听端口 | 环境变量 > settings.json |
| `MOBI_PUBLIC_URL` | 公网访问地址 | 环境变量 > settings.json |
| `CORS_ORIGINS` | CORS 允许的源（逗号分隔） | 环境变量 > settings.json |
| `VAPID_SUBJECT` | Web Push 联系方式（mailto: 或 https:） | 仅环境变量 |

## 配置优先级

Mobi 配置遵循统一的优先级规则：

```
环境变量 > settings.json > 默认值
```

### 示例

```bash
# 通过环境变量覆盖配置
export MOBI_LISTEN_PORT=3000
export MOBI_PUBLIC_URL=https://mobi.example.com
export MOBI_IDLE_TIMEOUT_MS=172800000  # 2 天

# 启动 Hub
mobi hub
```

```json
// ~/.mobi/settings.json 示例
{
  "machineId": "abc123",
  "cliApiToken": "your-secret-token",
  "listenPort": 3000,
  "publicUrl": "https://mobi.example.com",
  "idleTimeoutMs": 172800000
}
```

## 常见配置场景

### 1. 修改 Hub 监听地址

```bash
# 监听所有网络接口（用于局域网访问）
export MOBI_LISTEN_HOST=0.0.0.0
export MOBI_PUBLIC_URL=http://your-server-ip:2222
```

### 2. 延长 Session 超时时间

```bash
# 设置为 2 天无活动后超时
export MOBI_IDLE_TIMEOUT_MS=172800000
```

### 3. 自定义数据目录

```bash
# 使用自定义路径
export MOBI_HOME=/data/mobi
```

### 4. 配置 CORS（多域名访问）

```bash
# 允许多个域名访问
export CORS_ORIGINS=https://app1.example.com,https://app2.example.com
```

## 安全注意事项

1. **access.key** 包含敏感的认证密钥，请勿分享或提交到版本控制
2. **cliApiToken** 是 CLI 与 Hub 的共享密钥，请妥善保管
3. 生产环境建议通过环境变量传递敏感配置，避免写入 `settings.json`
4. `MOBI_LISTEN_HOST=0.0.0.0` 会暴露服务到所有网络接口，请确保网络环境安全
