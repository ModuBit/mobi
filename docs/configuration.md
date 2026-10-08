# Mobi 配置指南

本文档介绍 Mobi 的配置方式，包括 `~/.mobi` 目录结构、配置文件字段以及环境变量覆盖。

配置按归属拆分为两个文件：**`settings.hub.json`（daemon 权威）** 与 **`settings.cli.json`（会话侧专属）**。单机拓扑下两者恒同机同 MOBI_HOME（daemon 与会话子进程同机，见 [架构总览](architecture/README.md)），文件拆分保留是为了写权限边界清晰。

所有 settings 文件权限为 **0600**（新写走 tmp + rename + chmod，daemon 启动时对存量文件补齐）。

## 目录结构

```
~/.mobi/                           # MOBI_HOME 可覆盖此路径
├── settings.hub.json              # daemon 配置（token/vapidKeys/监听等）
├── settings.cli.json              # 会话侧配置（连接凭证/machineId/claudeEnv 等）
├── *.lock / *.tmp                 # 配置写锁与原子写临时文件
├── access.key                     # 认证密钥（加密存储）
├── mobi.db                        # SQLite 数据库（daemon）
├── daemon.state.json              # daemon 进程状态（唯一进程状态源）
└── logs/                          # 日志目录
    ├── hub.log                    # daemon 主日志
    └── runner.log                 # runner 域日志
```

> `hub.state.json` / `runner.state.json` 已停写（ticket-22），存量文件可安全删除。

### 文件说明

| 文件 | 用途 | 创建时机 |
|------|------|---------|
| `settings.hub.json` | daemon 配置，归 daemon 进程所有 | daemon 首次启动（或迁移）时创建 |
| `settings.cli.json` | 会话侧配置（会话子进程 / webTools 读写） | `mobi setup` / daemon 同步 token / webTools 落盘时创建 |
| `settings.json.bak` | 拆分迁移前的旧单文件归档 | 旧版 `settings.json` 被自动迁移时生成 |
| `access.key` | 认证密钥，包含加密公钥和 token | `mobi auth login` 后创建 |
| `mobi.db` | SQLite 数据库，存储会话、消息等数据 | daemon 首次启动时创建 |
| `daemon.state.json` | daemon 进程状态（pid、主端口、宿主通道端口、startTime） | daemon 启动就绪时写入、优雅退出时清理 |
| `logs/hub.log` | daemon 主日志 | daemon 运行时追加 |
| `logs/runner.log` | runner 域日志 | daemon 运行时追加 |

## settings.hub.json（daemon 配置）

归 daemon 进程所有。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cliApiToken` | string | 自动生成 | 会话子进程认证的**验证基准**（daemon 用它校验宿主通道请求；`settings.cli.json` 同名字段是连接凭证） |
| `webApiToken` | string | 自动生成 | Web 登录令牌（浏览器专用，与 cliApiToken 独立）。轮换：`mobi auth rotate-web-token` |
| `listenHost` | string | `127.0.0.1` | 主端口监听地址 |
| `listenPort` | number | `2222` | 主端口（Web REST/SSE + `/terminal` socket） |
| `publicUrl` | string | `http://localhost:2222` | 公网访问地址 |
| `corsOrigins` | string[] | 从 publicUrl 推导 | CORS 允许的源 |
| `hubName` | string | 自动生成 | 实例名称（PWA 实例标识） |
| `vapidKeys.publicKey` | string | 自动生成 | Web Push VAPID 公钥（Base64） |
| `vapidKeys.privateKey` | string | 自动生成 | Web Push VAPID 私钥（Base64） |
| `memory.engine` | `'off' \| 'hindsight'` | `off` | 长期记忆引擎（默认关闭，隐私姿态） |
| `memory.endpoint` | string | - | Hindsight API 地址（Cloud 或 self-host；engine 开启时必填） |
| `memory.apiToken` | string | - | API token 明文（仅 daemon 落盘与 env 注入，Web 回显只带 `apiTokenSet`） |
| `memory.rules` | array | `[]` | 记忆隔离规则：`{target, mode, tag?, bank?}`；target 为 `{type:'workspace', id}` 或 `{type:'path', path}`。裁决序：路径规则（最长前缀）> workspace 规则（spawn 的工作区语境）> 默认 normal |
| `memory.bankName` | string | `mobi-global` | 全局池 bank 名覆盖（高级） |
| `memory.disabledWorkspaces` | string[] | `[]` | 按目录关闭记忆的排除名单（前缀匹配、支持 `~`） |

**记忆隔离三档**（`rules[].mode`，未命中路径/工作区 = 默认 `normal`）：

| 模式 | bank | 写（retain） | 读（recall） | 适用 |
|------|------|------|------|------|
| `normal` | `mobi-global` | 打 `project:<tag>` 溯源 tag | any 过滤（本项目 ∪ 全局层） | 默认：各项目独立记忆、长期沉淀共享 |
| `open` | `mobi-global` | 不打 tag | 不过滤 | 闲聊：从写入起即全局可见 |
| `isolated` | `mobi-iso-<tag>`（可覆盖） | 打 `project:<tag>` | 不过滤 | 独立项目：硬隔离，与全局互不可见 |

`<tag>` = 规则的 `tag` 覆盖值（多目标同名 = 共享组）或 git 仓库名（worktree 归主仓）。会话 spawn 时按 scope（档位 × tag × bank）在 `<dataDir>/memory/hindsight/projects/` 生成 per-scope hindsight 配置文件（`<mode>-<tag>.json`；isolated 的 bank 覆盖时文件名带 `isolated-<bank>-<tag>` 双标识，防同 tag 不同 bank、同 bank 不同 tag 的规则互相覆写），经 `HINDSIGHT_CONFIG` 注入会话进程；设置变更下个新会话生效。

**宿主通道端口**：会话子进程回连 daemon 的 loopback-only listener（`/cli` socket + `/cli/*` HTTP），端口 = 主端口 + 10000（2222→12222），可被 `MOBI_HOST_PORT` 覆盖；只绑 `127.0.0.1`，不经 frp 暴露。

## settings.cli.json（会话侧配置）

归会话子进程所有。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cliApiToken` | string | - | 会话子进程的**连接凭证**（daemon 首启自动同步，co-located 开箱即连） |
| `machineId` | string | 自动生成 | 机器唯一标识（路由残留：machines 表恒一行=本机，仅作归属字段） |
| `updateChannel` | `'stable' \| 'rc'` | `stable` | 升级通道 |
| `disconnectTimeoutMs` | number | `600000`（10 分钟） | 连接断开后超时退出时间 |
| `idleTimeoutMs` | number | `86400000`（1 天） | 无活动后超时退出时间 |
| `timeoutWarningMs` | number | `300000`（5 分钟） | 超时前预警时间 |
| `claudeEnv` | Record\<string, string\> | - | 注入给 claude 子进程的额外环境变量（优先级高于内置开关） |
| `bashInjectContext` | boolean | `true` | `!bash` 本地执行后是否把命令+输出注入 SDK context（`false` = 模型不参与，不耗 token） |
| `webTools` | object | - | Web 工具配置（provider 启停/凭据/当前选择），由 Web 端经 RPC 读写 |

## 旧 settings.json 自动迁移

升级到拆分版后自动执行一次性迁移，daemon 与会话侧独立进行（同机同 MOBI_HOME 时 daemon 启动统一覆盖）：

1. 旧 `settings.json` 存在 → 按字段归属拆入两个新文件（**新文件已有值不被覆盖**，旧字段只补缺）
2. 旧文件 rename 为 `settings.json.bak` 保留
3. 旧文件解析失败 → daemon 侧 fail-fast 终止启动；cli 侧仅警告跳过

迁移幂等：无旧文件时跳过。

## 环境变量

### 会话侧环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径，支持 `~` 展开 | 仅环境变量 |
| `MOBI_API_URL` | 会话子进程回连地址。daemon spawn 会话时显式注入宿主通道地址（`http://127.0.0.1:<hostPort>`）；profile env 与 dev 场景可手动指定 | 环境变量 > settings.cli.json |
| `CLI_API_TOKEN` | 会话子进程连接凭证 | 环境变量 > settings.cli.json |
| `MOBI_EXPERIMENTAL` | 启用实验性功能（`true`/`1`/`yes`） | 仅环境变量 |
| `MOBI_AGENT_TEAMS` | 启用 agent teams 多 teammate 协作（默认关闭） | 仅环境变量 |
| `MOBI_DISCONNECT_TIMEOUT_MS` | 连接断开超时（毫秒） | 环境变量 > settings.cli.json |
| `MOBI_IDLE_TIMEOUT_MS` | 交互不活跃超时（毫秒） | 环境变量 > settings.cli.json |
| `MOBI_TIMEOUT_WARNING_MS` | 预警提前时间（毫秒） | 环境变量 > settings.cli.json |

### daemon 环境变量

| 变量名 | 说明 | 优先级 |
|--------|------|--------|
| `MOBI_HOME` | 数据目录路径 | 仅环境变量 |
| `DB_PATH` | SQLite 数据库路径 | 仅环境变量 |
| `CLI_API_TOKEN` | 会话子进程认证令牌（验证基准） | 环境变量 > settings.hub.json > 自动生成 |
| `WEB_API_TOKEN` | Web 登录令牌 | 环境变量 > settings.hub.json > 自动生成 |
| `MOBI_LISTEN_HOST` | 主端口监听地址 | 环境变量 > settings.hub.json |
| `MOBI_LISTEN_PORT` | 主端口监听端口 | 环境变量 > settings.hub.json |
| `MOBI_HOST_PORT` | 宿主通道端口（默认 = 主端口 + 10000） | 仅环境变量 |
| `MOBI_PUBLIC_URL` | 公网访问地址 | 环境变量 > settings.hub.json |
| `CORS_ORIGINS` | CORS 允许的源（逗号分隔） | 环境变量 > settings.hub.json |
| `VAPID_SUBJECT` | Web Push 联系方式（mailto: 或 https:） | 仅环境变量 |

注意：以 `WEB_API_TOKEN` 环境变量运行 daemon 时，env 优先级高于文件——此时经 API 轮换的 token 在 daemon 重启后会被 env 值覆盖（cli 命令会收到 `envOverride` 提示）。

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

# 启动 daemon
mobi daemon start
```

```jsonc
// ~/.mobi/settings.hub.json 示例
{
  "cliApiToken": "your-cli-secret-token",
  "webApiToken": "your-web-secret-token",
  "listenPort": 3000,
  "publicUrl": "https://mobi.example.com",
  "hubName": "home-mac"
}
```

```jsonc
// ~/.mobi/settings.cli.json 示例
{
  "cliApiToken": "your-cli-secret-token",
  "machineId": "abc123",
  "idleTimeoutMs": 172800000,
  "claudeEnv": { "ANTHROPIC_MODEL": "claude-opus-4-8" },
  "bashInjectContext": true
}
```

## 常见配置场景

### 1. 修改 daemon 监听地址

```bash
# 监听所有网络接口（用于局域网访问）
export MOBI_LISTEN_HOST=0.0.0.0
export MOBI_PUBLIC_URL=http://your-machine-ip:2222
```

注意：宿主通道恒绑 `127.0.0.1`，不随 `MOBI_LISTEN_HOST` 变化。

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
2. **cliApiToken** 双份语义：daemon 文件里的是验证基准，会话侧文件里的是连接凭证，请妥善保管
3. **webApiToken** 是 Web 浏览器登录专用密钥，与 cliApiToken 完全独立；轮换用 `mobi auth rotate-web-token`（经 daemon API 落盘并热生效，无需重启；已登录 Web 会话最长 1 天后自然失效）
4. settings 文件权限恒 0600；生产环境建议通过环境变量传递敏感配置
5. `MOBI_LISTEN_HOST=0.0.0.0` 会暴露主端口到所有网络接口，请确保网络环境安全；宿主通道不受影响（loopback-only，外网物理不可达）
