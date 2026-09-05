# Auth 认证系统

文件 [`packages/cli/src/commands/auth.ts`](/packages/cli/src/commands/auth.ts)

CLI 的认证系统管理 API Token 和机器身份，确保 CLI 能安全连接 Hub。

## 架构概览

```mermaid
flowchart TB
    subgraph Commands["命令层"]
        AuthCmd["auth 命令<br/>login / logout / status"]
        ClaudeCmd["claude 命令<br/>（自动认证）"]
    end

    subgraph Init["初始化层"]
        ApiUrlInit["initializeApiUrl()<br/>ui/apiUrlInit.ts"]
        TokenInit["initializeToken()<br/>ui/tokenInit.ts"]
        AuthSetup["authAndSetupMachineIfNeeded()<br/>ui/auth.ts"]
    end

    subgraph Config["配置层"]
        Conf["Configuration 单例<br/>configuration.ts"]
        Persist["Persistence<br/>persistence.ts"]
    end

    subgraph Files["文件系统"]
        SettingsFile["~/.mobi/settings.cli.json"]
    end

    AuthCmd --> Persist
    ClaudeCmd --> ApiUrlInit --> TokenInit --> AuthSetup
    TokenInit --> Conf & Persist
    AuthSetup --> Persist
    Persist --> SettingsFile
    Conf -->|"读写"| SettingsFile
```

## 认证维度

CLI 认证包含两个维度：

| 维度 | 说明 | 存储位置 |
|------|------|----------|
| **API Token** | CLI 与 Hub 的共享密钥，用于 Socket.IO 认证 | `~/.mobi/settings.cli.json` → `cliApiToken` |
| **Machine ID** | 机器唯一标识，用于多租户隔离 | `~/.mobi/settings.cli.json` → `machineId` |

此外还有 API URL 配置：

| 维度 | 说明 | 存储位置 |
|------|------|----------|
| **API URL** | Hub 服务器地址 | `~/.mobi/settings.cli.json` → `apiUrl` |

## 优先级链

三个配置项遵循相同的优先级策略：

```mermaid
flowchart LR
    ENV["环境变量<br/>（最高）"] --> File["settings.cli.json"] --> Default["默认值"]
```

### API URL (`MOBI_API_URL`)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `MOBI_API_URL` 环境变量 | 最高优先级，临时覆盖 |
| 2 | `settings.cli.json` → `apiUrl` | 持久化配置 |
| 2' | `settings.cli.json` → `serverUrl` | 旧字段名，向后兼容 |
| 3 | `http://localhost:2222` | 默认值 |

**初始化**：`initializeApiUrl()`（`ui/apiUrlInit.ts`）

### API Token (`CLI_API_TOKEN`)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `CLI_API_TOKEN` 环境变量 | 最高优先级，临时覆盖 |
| 2 | `settings.cli.json` → `cliApiToken` | 持久化配置 |
| 3 | 交互式输入 | 首次运行时提示输入 |

**初始化**：`initializeToken()`（`ui/tokenInit.ts`）

### Machine ID

首次需要时自动生成 UUID v4，写入 `settings.cli.json`。不会从环境变量读取。

**初始化**：`authAndSetupMachineIfNeeded()`（`ui/auth.ts`）

## 初始化流程

`claudeCommand` 启动时自动执行三步初始化：

```mermaid
flowchart TB
    Start["claudeCommand.run()"] --> Step1["1. initializeApiUrl()"]
    Step1 --> Step2["2. initializeToken()"]
    Step2 --> Step3["3. authAndSetupMachineIfNeeded()"]
    Step3 --> Ready["认证就绪"]
```

### Step 1: initializeApiUrl()

```mermaid
flowchart TB
    Start["initializeApiUrl()"] --> Env{"MOBI_API_URL<br/>环境变量?"}
    Env -->|有| Done["保持默认值<br/>（构造器已设置）"]
    Env -->|无| Read["读取 settings.cli.json"]
    Read --> ApiUrl{"apiUrl 存在?"}
    ApiUrl -->|是| Set1["configuration._setApiUrl()"]
    ApiUrl -->|否| Legacy{"serverUrl 存在?<br/>（旧字段）"}
    Legacy -->|是| Set2["configuration._setApiUrl()<br/>向后兼容"]
    Legacy -->|否| Default["使用默认值<br/>http://localhost:2222"]
```

### Step 2: initializeToken()

```mermaid
flowchart TB
    Start["initializeToken()"] --> Step1["initializeApiUrl()"]
    Step1 --> Env{"CLI_API_TOKEN<br/>环境变量?"}
    Env -->|有| Done["直接返回<br/>（构造器已设置）"]
    Env -->|无| Read["读取 settings.cli.json"]
    Read --> HasToken{"cliApiToken 存在?"}
    HasToken -->|是| Set["configuration._setCliApiToken()"]
    HasToken -->|否| TTY{"stdin.isTTY?"}
    TTY -->|否| Error["抛出错误<br/>提示设置环境变量"]
    TTY -->|是| Prompt["交互式输入 Token"]
    Prompt --> Save["保存到 settings.cli.json<br/>+ configuration"]
```

### Step 3: authAndSetupMachineIfNeeded()

```mermaid
flowchart TB
    Start["authAndSetupMachineIfNeeded()"] --> Check{"cliApiToken<br/>已设置?"}
    Check -->|否| Error["抛出错误"]
    Check -->|是| Update["updateSettings()"]
    Update --> HasId{"machineId 存在?"}
    HasId -->|是| Return["返回 { token, machineId }"]
    HasId -->|否| Generate["生成 randomUUID()"]
    Generate --> Save["写入 settings.cli.json"]
    Save --> Return
```

## auth 命令

`mobi auth` 提供手动管理认证状态的子命令。

### 子命令

#### status — 查看认证状态

显示当前连接配置，不做任何修改：

```
MOBI_API_URL:    http://localhost:2222
CLI_API_TOKEN:   set / missing
Token Source:    environment / settings file / none
Machine ID:      xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Host:            my-machine
```

#### login — 交互式登录

1. 检查 `stdin.isTTY`，非 TTY 环境拒绝执行
2. 提示输入 Token
3. 保存到 `settings.cli.json`
4. 更新内存中的 `configuration.cliApiToken`

#### logout — 登出

1. 从 `settings.cli.json` 清除 `cliApiToken`
2. 清除 `machineId`
3. 环境变量中的 Token 仍然生效（提示用户）

#### web-token / rotate-web-token — Web 登录令牌（HTTP API）

webApiToken 归 hub 所有（`settings.hub.json`，在 hub 机器上），cli 与 hub 可不同机器部署，
故这两个子命令一律经 hub HTTP API 而非本地文件：

| 子命令 | API | 行为 |
|--------|-----|------|
| `web-token` | `GET /cli/web-token` | 回显当前 webApiToken + `envOverride` 标志 |
| `rotate-web-token` | `POST /cli/web-token` | hub 生成新 token、落盘并即时热更新，返回新值 |

两命令均以 `Authorization: Bearer <cliApiToken>` 鉴权；`envOverride: true` 表示 hub 以
`WEB_API_TOKEN` 环境变量运行，重启后轮换会被 env 值覆盖（cli 据此提示）。

## Configuration 单例

**文件**: [`packages/cli/src/configuration.ts`](/packages/cli/src/configuration.ts)

全局配置单例，在模块加载时同步创建：

| 属性 | 来源 | 默认值 |
|------|------|--------|
| `apiUrl` | `MOBI_API_URL` | `http://localhost:2222` |
| `cliApiToken` | `CLI_API_TOKEN` | `''` |
| `mobiHomeDir` | `MOBI_HOME` | `~/.mobi` |
| `settingsFile` | 派生 | `{mobiHomeDir}/settings.cli.json` |
| `hubSettingsFile` | 派生 | `{mobiHomeDir}/settings.hub.json` |
| `isRunnerProcess` | 进程参数 | `false` |

构造器自动创建 `~/.mobi/` 和 `~/.mobi/logs/` 目录。

`_setApiUrl()` 和 `_setCliApiToken()` 是内部方法，仅供初始化层使用。

## Persistence 持久化

**文件**: [`packages/cli/src/persistence.ts`](/packages/cli/src/persistence.ts)

### Settings 文件操作

| 函数 | 说明 |
|------|------|
| `readSettings()` | 读取 `settings.cli.json`，不存在或解析失败返回空对象 |
| `updateSettings(updater)` | 原子更新 cli 文件：文件锁 → 读取 → 更新 → tmp + rename 写入 |
| `readHubSettings()` | 读取 `settings.hub.json`（只读展示用） |
| `updateHubSettings(updater)` | 受限写本机 hub 文件的 `listen*`（其余字段归 hub 所有，原样保留） |

### updateSettings 原子更新机制

```mermaid
flowchart TB
    Start["updateSettings(updater)"] --> Lock["获取文件锁<br/>settings.cli.json.lock"]
    Lock --> Retry{"锁获取失败?"}
    Retry -->|是| Stale{"锁超时 10s?"}
    Stale -->|是| Force["删除旧锁<br/>重试"]
    Stale -->|否| Wait["等待 100ms<br/>重试"]
    Retry -->|否| Read["readSettings()"]
    Wait --> Lock
    Force --> Lock
    Read --> Apply["updater(current)"]
    Apply --> Write["写入 .tmp 文件"]
    Write --> Rename["rename → settings.cli.json<br/>（原子操作）"]
    Rename --> Unlock["释放文件锁"]
```

- **文件锁**：`settings.cli.json.lock`，`wx` 模式创建（排他）；hub 侧有对称实现
- **重试**：最多 50 次，每次间隔 100ms
- **过期**：锁文件超过 10s 自动视为过期
- **原子写入**：先写 `.tmp` 再 `rename`，保证数据完整性

### Settings 数据结构

```typescript
interface Settings {
    machineId?: string                    // 机器唯一标识
    cliApiToken?: string                   // CLI 连接凭证（hub 侧验证基准在 settings.hub.json）
    apiUrl?: string                        // Hub API URL
    serverUrl?: string                     // 旧字段名（向后兼容读取）
    updateChannel?: 'stable' | 'rc'        // 升级通道
    disconnectTimeoutMs?: number           // 连接断开超时
    idleTimeoutMs?: number                 // 交互不活跃超时
    timeoutWarningMs?: number              // 预警提前时间
    claudeEnv?: Record<string, string>     // 注入 claude 子进程的额外环境变量
    bashInjectContext?: boolean            // !bash 输出是否注入 SDK context
    webTools?: WebToolsConfig              // Web 工具配置（runner RPC 读写）
}
```

## 代码结构

```
packages/cli/src/
├── commands/
│   └── auth.ts                # auth 命令：login / logout / status / web-token / rotate-web-token
├── ui/
│   ├── apiUrlInit.ts           # API URL 初始化
│   ├── tokenInit.ts            # Token 初始化（含交互式输入）
│   └── auth.ts                 # Machine ID 初始化
├── configuration.ts            # 全局配置单例
└── persistence.ts              # 文件持久化（Settings 读写 + 文件锁）
```

## 文件分布

```
~/.mobi/
├── settings.cli.json       # cli 配置（Token、Machine ID、API URL 等，随 cli 部署位置走）
├── settings.hub.json       # hub 配置（仅 co-located 部署时在本机）
└── settings.cli.json.lock  # 更新时的文件锁（临时）
```
