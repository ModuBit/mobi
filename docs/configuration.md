# Mobi 配置指南

本文档介绍 Mobi 的配置方式，包括 `~/.mobi` 目录结构、配置文件字段以及环境变量覆盖。

自 2026-09-05 起，配置按部署归属拆分为两个文件：**`settings.hub.json`（Hub 权威）** 与 **`settings.cli.json`（CLI 专属）**。Hub 与 CLI 支持部署在不同机器——CLI 进程不读取 Hub 的配置文件。

## 目录结构

```
~/.mobi/                           # MOBI_HOME 可覆盖此路径
├── settings.hub.json              # Hub 配置（hub 权威，token/vapidKeys/监听等）
├── settings.cli.json              # CLI 配置（连接凭证/machineId/claudeEnv 等，随 CLI 走）
├── *.lock / *.tmp                 # 配置写锁与原子写临时文件
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
| `settings.hub.json` | Hub 配置，归 hub 进程所有（cli 仅受限写本机文件的 `listen*`） | hub 首次启动（或迁移）时创建 |
| `settings.cli.json` | CLI 配置，随 cli 部署位置走 | `mobi auth login` / `mobi setup` / runner 写 webTools 时创建 |
| `settings.json.bak` | 拆分迁移前的旧单文件归档 | 旧版 `settings.json` 被自动迁移时生成 |
| `access.key` | 认证密钥，包含加密公钥和 token | `mobi auth login` 后创建 |
| `mobi.db` | SQLite 数据库，存储会话、消息等数据 | Hub 首次启动时创建 |
| `runner.state.json` | Runner 进程状态（PID、端口、启动时间） | Runner 启动时写入 |
| `runner.state.json.lock` | Runner 锁文件，防止多实例运行 | Runner 启动时创建 |
| `hub.state.json` | Hub 进程状态（PID、监听地址、端口） | Hub 启动时写入 |
| `logs/runner.log` | Runner 运行日志 | Runner 运行时追加 |
| `logs/hub.log` | Hub 运行日志 | Hub 运行时追加 |

## settings.hub.json（Hub 配置）

归 hub 进程所有。cli 与 hub 可不同机器部署，此文件始终在 **hub 机器**上。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cliApiToken` | string | 自动生成 | CLI 认证的**验证基准**（hub 用它校验 cli 请求；cli 机器上另有一份连接凭证，见 cli 文件同名字段） |
| `webApiToken` | string | 自动生成 | Web 登录令牌（浏览器专用，与 cliApiToken 独立）。轮换：`mobi auth rotate-web-token`（任何部署形态均经 hub API 完成） |
| `listenHost` | string | `127.0.0.1` | 监听地址 |
| `listenPort` | number | `2222` | 监听端口 |
| `publicUrl` | string | `http://localhost:2222` | 公网访问地址 |
| `corsOrigins` | string[] | 从 publicUrl 推导 | CORS 允许的源 |
| `hubName` | string | 自动生成 | Hub 实例名称（PWA 实例标识） |
| `vapidKeys.publicKey` | string | 自动生成 | Web Push VAPID 公钥（Base64） |
| `vapidKeys.privateKey` | string | 自动生成 | Web Push VAPID 私钥（Base64） |

## settings.cli.json（CLI 配置）

归 cli/runner/会话进程所有，随 CLI 部署位置走（与 hub 可在不同机器）。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cliApiToken` | string | - | CLI 的**连接凭证**（co-located 部署时由 hub 首启自动同步；远程部署经 `mobi auth login` 写入） |
| `machineId` | string | 自动生成 | 机器唯一标识，用于 Hub 注册 |
| `apiUrl` | string | `http://localhost:2222` | Hub API 地址（旧名 `serverUrl` 只读兼容） |
| `updateChannel` | `'stable' \| 'rc'` | `stable` | 升级通道 |
| `disconnectTimeoutMs` | number | `600000`（10 分钟） | 连接断开后超时退出时间 |
| `idleTimeoutMs` | number | `86400000`（1 天） | 无活动后超时退出时间 |
| `timeoutWarningMs` | number | `300000`（5 分钟） | 超时前预警时间 |
| `claudeEnv` | Record\<string, string\> | - | 注入给 claude 子进程的额外环境变量（优先级高于内置开关） |
| `bashInjectContext` | boolean | `true` | `!bash` 本地执行后是否把命令+输出注入 SDK context（`false` = 模型不参与，不耗 token） |
| `webTools` | object | - | Web 工具配置（provider 启停/凭据/当前选择），由 Web 端经 runner RPC 读写 |

## 旧 settings.json 自动迁移

升级到拆分版后，hub 首次启动时自动执行一次性迁移：

1. 旧 `settings.json` 存在 → 按字段归属拆入两个新文件（**新文件已有值不被覆盖**，旧字段只补缺）
2. 旧文件 rename 为 `settings.json.bak` 保留
3. 旧文件解析失败 → fail-fast 终止启动（防静默丢配置），修复或移除后重启

迁移幂等：无旧文件时跳过。

## 部署形态说明

### co-located（默认，hub 与 cli 同机同 MOBI_HOME）

- hub 首启生成 `cliApiToken` 后自动同步一份到 `settings.cli.json`，开箱即连
- `mobi setup settings` 可交互配置 cli 凭证与本机 hub 监听（`listen*` 写本机 `settings.hub.json`）

### 远程部署（cli 与 hub 不同机器）

- cli 机器上**没有** hub 的配置文件，`mobi doctor` 对此有明确提示（非故障）
- 连接凭证：从 hub 启动 banner 获取 token → `mobi auth login` 写入本机 cli 文件
- `webApiToken` 查看/轮换：`mobi auth web-token` / `mobi auth rotate-web-token`（走 hub HTTP API，cliApiToken 鉴权）
- hub 监听配置（`listen*`）：直接编辑 **hub 机器**上的 `settings.hub.json`

## 环境变量

### CLI 环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径，支持 `~` 展开 | 仅环境变量 |
| `MOBI_API_URL` | Hub API 地址 | 环境变量 > settings.cli.json |
| `CLI_API_TOKEN` | CLI 连接凭证 | 环境变量 > settings.cli.json |
| `MOBI_EXPERIMENTAL` | 启用实验性功能（`true`/`1`/`yes`） | 仅环境变量 |
| `MOBI_AGENT_TEAMS` | 启用 agent teams 多 teammate 协作（默认关闭） | 仅环境变量 |
| `MOBI_DISCONNECT_TIMEOUT_MS` | 连接断开超时（毫秒） | 环境变量 > settings.cli.json |
| `MOBI_IDLE_TIMEOUT_MS` | 交互不活跃超时（毫秒） | 环境变量 > settings.cli.json |
| `MOBI_TIMEOUT_WARNING_MS` | 预警提前时间（毫秒） | 环境变量 > settings.cli.json |

### Hub 环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径 | 仅环境变量 |
| `DB_PATH` | SQLite 数据库路径 | 仅环境变量 |
| `CLI_API_TOKEN` | CLI 认证令牌（验证基准） | 环境变量 > settings.hub.json > 自动生成 |
| `WEB_API_TOKEN` | Web 登录令牌 | 环境变量 > settings.hub.json > 自动生成 |
| `MOBI_LISTEN_HOST` | 监听地址 | 环境变量 > settings.hub.json |
| `MOBI_LISTEN_PORT` | 监听端口 | 环境变量 > settings.hub.json |
| `MOBI_PUBLIC_URL` | 公网访问地址 | 环境变量 > settings.hub.json |
| `CORS_ORIGINS` | CORS 允许的源（逗号分隔） | 环境变量 > settings.hub.json |
| `VAPID_SUBJECT` | Web Push 联系方式（mailto: 或 https:） | 仅环境变量 |

注意：以 `WEB_API_TOKEN` 环境变量运行 hub 时，env 优先级高于文件——此时经 API 轮换的 token 在 hub 重启后会被 env 值覆盖（cli 命令会收到 hub 返回的 `envOverride` 提示）。

## 配置优先级

```
环境变量 > 配置文件（各归属文件） > 默认值
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

```jsonc
// ~/.mobi/settings.hub.json 示例（hub 机器）
{
  "cliApiToken": "your-cli-secret-token",
  "webApiToken": "your-web-secret-token",
  "listenPort": 3000,
  "publicUrl": "https://mobi.example.com",
  "hubName": "home-mac"
}
```

```jsonc
// ~/.mobi/settings.cli.json 示例（cli 机器）
{
  "cliApiToken": "your-cli-secret-token",
  "machineId": "abc123",
  "apiUrl": "https://mobi.example.com",
  "idleTimeoutMs": 172800000,
  "claudeEnv": { "ANTHROPIC_MODEL": "claude-opus-4-8" },
  "bashInjectContext": true
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
2. **cliApiToken** 双份语义：hub 文件里的是验证基准，cli 文件里的是连接凭证，请妥善保管
3. **webApiToken** 是 Web 浏览器登录专用密钥，与 cliApiToken 完全独立；轮换用 `mobi auth rotate-web-token`（经 hub API 落盘并热生效，无需重启；已登录 Web 会话最长 1 天后自然失效）
4. 生产环境建议通过环境变量传递敏感配置，避免写入配置文件
5. `MOBI_LISTEN_HOST=0.0.0.0` 会暴露服务到所有网络接口，请确保网络环境安全
