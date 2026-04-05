# Auth 认证系统

文件 [`cli/src/commands/auth.ts`](/cli/src/commands/auth.ts)

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
        SettingsFile["~/.mobi/settings.json"]
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
| **API Token** | CLI 与 Hub 的共享密钥，用于 Socket.IO 认证 | `~/.mobi/settings.json` → `cliApiToken` |
| **Machine ID** | 机器唯一标识，用于多租户隔离 | `~/.mobi/settings.json` → `machineId` |

此外还有 API URL 配置：

| 维度 | 说明 | 存储位置 |
|------|------|----------|
| **API URL** | Hub 服务器地址 | `~/.mobi/settings.json` → `apiUrl` |

## 优先级链

三个配置项遵循相同的优先级策略：

```mermaid
flowchart LR
    ENV["环境变量<br/>（最高）"] --> File["settings.json"] --> Default["默认值"]
```

### API URL (`MOBI_API_URL`)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `MOBI_API_URL` 环境变量 | 最高优先级，临时覆盖 |
| 2 | `settings.json` → `apiUrl` | 持久化配置 |
| 2' | `settings.json` → `serverUrl` | 旧字段名，向后兼容 |
| 3 | `http://localhost:2222` | 默认值 |

**初始化**：`initializeApiUrl()`（`ui/apiUrlInit.ts`）

### API Token (`CLI_API_TOKEN`)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `CLI_API_TOKEN` 环境变量 | 最高优先级，临时覆盖 |
| 2 | `settings.json` → `cliApiToken` | 持久化配置 |
| 3 | 交互式输入 | 首次运行时提示输入 |

**初始化**：`initializeToken()`（`ui/tokenInit.ts`）

### Machine ID

首次需要时自动生成 UUID v4，写入 `settings.json`。不会从环境变量读取。

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
    Env -->|无| Read["读取 settings.json"]
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
    Env -->|无| Read["读取 settings.json"]
    Read --> HasToken{"cliApiToken 存在?"}
    HasToken -->|是| Set["configuration._setCliApiToken()"]
    HasToken -->|否| TTY{"stdin.isTTY?"}
    TTY -->|否| Error["抛出错误<br/>提示设置环境变量"]
    TTY -->|是| Prompt["交互式输入 Token"]
    Prompt --> Save["保存到 settings.json<br/>+ configuration"]
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
    Generate --> Save["写入 settings.json"]
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
3. 保存到 `settings.json`
4. 更新内存中的 `configuration.cliApiToken`

#### logout — 登出

1. 从 `settings.json` 清除 `cliApiToken`
2. 清除 `machineId`
3. 环境变量中的 Token 仍然生效（提示用户）

## Configuration 单例

**文件**: [`cli/src/configuration.ts`](/cli/src/configuration.ts)

全局配置单例，在模块加载时同步创建：

| 属性 | 来源 | 默认值 |
|------|------|--------|
| `apiUrl` | `MOBI_API_URL` | `http://localhost:2222` |
| `cliApiToken` | `CLI_API_TOKEN` | `''` |
| `mobiHomeDir` | `MOBI_HOME` | `~/.mobi` |
| `settingsFile` | 派生 | `{mobiHomeDir}/settings.json` |
| `isRunnerProcess` | 进程参数 | `false` |

构造器自动创建 `~/.mobi/` 和 `~/.mobi/logs/` 目录。

`_setApiUrl()` 和 `_setCliApiToken()` 是内部方法，仅供初始化层使用。

## Persistence 持久化

**文件**: [`cli/src/persistence.ts`](/cli/src/persistence.ts)

### Settings 文件操作

| 函数 | 说明 |
|------|------|
| `readSettings()` | 读取 `settings.json`，不存在或解析失败返回空对象 |
| `writeSettings()` | 直接写入 `settings.json` |
| `updateSettings(updater)` | 原子更新：文件锁 → 读取 → 更新 → tmp + rename 写入 |

### updateSettings 原子更新机制

```mermaid
flowchart TB
    Start["updateSettings(updater)"] --> Lock["获取文件锁<br/>settings.json.lock"]
    Lock --> Retry{"锁获取失败?"}
    Retry -->|是| Stale{"锁超时 10s?"}
    Stale -->|是| Force["删除旧锁<br/>重试"]
    Stale -->|否| Wait["等待 100ms<br/>重试"]
    Retry -->|否| Read["readSettings()"]
    Wait --> Lock
    Force --> Lock
    Read --> Apply["updater(current)"]
    Apply --> Write["写入 .tmp 文件"]
    Write --> Rename["rename → settings.json<br/>（原子操作）"]
    Rename --> Unlock["释放文件锁"]
```

- **文件锁**：`settings.json.lock`，`wx` 模式创建（排他）
- **重试**：最多 50 次，每次间隔 100ms
- **过期**：锁文件超过 10s 自动视为过期
- **原子写入**：先写 `.tmp` 再 `rename`，保证数据完整性

### Settings 数据结构

```typescript
interface Settings {
    machineId?: string                    // 机器唯一标识
    machineIdConfirmedByServer?: boolean   // 服务器是否已确认
    runnerAutoStartWhenRunningMobi?: boolean // 是否自动启动 Runner
    cliApiToken?: string                   // CLI API Token
    apiUrl?: string                        // Hub API URL
    serverUrl?: string                     // 旧字段名（向后兼容读取）
}
```

## 代码结构

```
cli/src/
├── commands/
│   └── auth.ts                # auth 命令：login / logout / status
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
├── settings.json       # 配置（Token、Machine ID、API URL）
└── settings.json.lock  # 更新时的文件锁（临时）
```
