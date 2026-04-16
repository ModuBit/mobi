# ControlClient (`runner/controlClient.ts`)

CLI 侧与 Runner 进程通信的 HTTP 客户端封装。所有 CLI 命令通过它与 Runner 进程内的 ControlServer 交互。

**文件**: [`packages/cli/src/runner/controlClient.ts`](/packages/cli/src/runner/controlClient.ts)

## 定位

```
┌──────────────────────────────────────────────────────┐
│  CLI 命令层                                          │
│  (runner.ts, claude.ts, doctor.ts, sessionFactory.ts)│
└──────────────┬───────────────────────────────────────┘
               │ 调用导出函数
               ▼
┌──────────────────────────┐     HTTP POST      ┌────────────────────┐
│    controlClient.ts      │ ──────────────────→ │  ControlServer     │
│    (客户端封装)           │ ←────────────────── │  (Runner 进程内)   │
└──────────────────────────┘     JSON 响应       └────────────────────┘
               │                                        ▲
               │ 读取端口                                 │
               ▼                                        │
       runner.state.json                           注入回调
       (httpPort, pid)                             (run.ts)
```

## 核心机制

### `runnerPost` — 统一请求函数

所有 API 调用共享同一个内部 HTTP 函数：

```typescript
async function runnerPost(path: string, body?: any): Promise<{ error?: string } | any>
```

**流程**:

```
runnerPost(path, body)
    │
    ├── readRunnerState() → 获取 httpPort 和 pid
    │   └── 无状态文件 → 返回 { error: "No runner running" }
    │
    ├── isProcessAlive(pid) → 检查 Runner 进程存活
    │   └── 已退出 → 返回 { error: "stale" }
    │
    ├── fetch(POST http://127.0.0.1:{port}{path})
    │   ├── headers: Content-Type: application/json
    │   ├── body: JSON.stringify(body)
    │   ├── signal: AbortSignal.timeout(timeout)
    │   └── HTTP 非 200 → 返回 { error: "HTTP {status}" }
    │
    └── response.json() → 返回结果
        └── 异常 → 返回 { error: error.message }
```

**特点**:
- **统一错误处理**: 所有错误统一包装为 `{ error: string }`，调用方无需 try/catch
- **超时控制**: 默认 10s，可通过 `MOBI_RUNNER_HTTP_TIMEOUT` 环境变量覆盖
- **自动过期检测**: 先检查进程存活，避免向已退出的 Runner 发请求

## 导出 API

### HTTP 代理函数

5 个函数一一对应 ControlServer 的 5 个端点：

| 函数 | 端点 | 说明 | 调用方 |
|------|------|------|--------|
| `notifyRunnerSessionStarted(sessionId, metadata)` | `POST /session-started` | 会话启动后向 Runner 报告 | `sessionFactory.ts` |
| `listRunnerSessions()` | `POST /list` | 列出所有活跃会话 | `mobi runner list` |
| `stopRunnerSession(sessionId)` | `POST /stop-session` | 停止指定会话 | `mobi runner stop-session` |
| `spawnRunnerSession(directory, sessionId?)` | `POST /spawn-session` | 创建新会话 | `mobi runner list --spawn` |
| `stopRunnerHttp()` | `POST /stop` | 优雅停止 Runner | `mobi runner stop` |

```typescript
// 典型调用模式
const sessions = await listRunnerSessions()        // → Array<TrackedSession>
const success = await stopRunnerSession(sid)        // → boolean
const result = await spawnRunnerSession(dir, sid)   // → raw response
```

### 状态检查函数

| 函数 | 返回 | 说明 |
|------|------|------|
| `checkIfRunnerRunningAndCleanupStaleState()` | `boolean` | Runner 是否运行中，过期时自动清理 |
| `isRunnerRunningCurrentlyInstalledMobiVersion()` | `boolean` | Runner 版本是否匹配当前 CLI |

### 进程管理函数

| 函数 | 说明 |
|------|------|
| `stopRunner()` | 优雅停止 → 等待 2s → 强制杀死 |
| `cleanupRunnerState()` | 清理 `runner.state.json` |

### 工具函数

| 函数 | 返回 | 说明 |
|------|------|------|
| `getInstalledCliMtimeMs()` | `number \| undefined` | 当前 CLI 安装文件的修改时间戳 |

## 版本检测机制

`isRunnerRunningCurrentlyInstalledMobiVersion()` 实现了两级版本比对：

```
isRunnerRunningCurrentlyInstalledMobiVersion()
    │
    ├── checkIfRunnerRunningAndCleanupStaleState()
    │   └── Runner 未运行 → 返回 false
    │
    ├── 优先: mtimeMs 比对
    │   ├── getInstalledCliMtimeMs() → 当前 CLI 文件修改时间
    │   ├── state.startedWithCliMtimeMs → Runner 启动时的修改时间
    │   └── 两者相等 → true（版本一致）
    │
    └── 回退: package.json version 比对
        ├── packageJson.version → 当前 CLI 版本号
        ├── state.startedWithCliVersion → Runner 启动时的版本号
        └── 两者相等 → true
```

### getInstalledCliMtimeMs

根据运行模式获取不同的文件时间戳：

| 模式 | 检测文件 | 说明 |
|------|----------|------|
| 编译后 (`isBunCompiled()`) | `process.execPath` | Bun 编译的单文件可执行文件 |
| 开发模式 | `projectPath()/package.json` | 源码目录的 package.json |

## stopRunner 流程

```typescript
stopRunner()
    │
    ├── readRunnerState() → 获取 pid
    │
    ├── 第一阶段: 优雅停止
    │   ├── stopRunnerHttp() → POST /stop
    │   └── waitForProcessDeath(pid, 2000) → 最多等 2s
    │       ├── 每 100ms 检查 isProcessAlive(pid)
    │       └── 超时 → 抛异常
    │
    └── 第二阶段: 强制杀死
        └── killProcess(pid, force=true) → SIGKILL
```

**两阶段停止设计**:
1. 优先 HTTP 优雅停止 — 让 Runner 完成清理（关闭 sessions、释放锁）
2. 失败后强制杀死 — 兜底保证进程终止

## 调用方汇总

```typescript
// packages/cli/src/commands/runner.ts — 所有 runner 子命令
import { listRunnerSessions, stopRunnerSession, spawnRunnerSession, stopRunner,
         checkIfRunnerRunningAndCleanupStaleState } from '@/runner/controlClient'

// packages/cli/src/agent/sessionFactory.ts — 会话创建后通知
import { notifyRunnerSessionStarted } from '@/runner/controlClient'

// packages/cli/src/ui/doctor.ts — 诊断检查
import { checkIfRunnerRunningAndCleanupStaleState } from '@/runner/controlClient'

// packages/cli/src/commands/claude.ts — claude 命令中检查版本
import { isRunnerRunningCurrentlyInstalledMobiVersion } from '@/runner/controlClient'

// packages/cli/src/runner/run.ts — Runner 内部使用状态管理和版本检测
import { cleanupRunnerState, getInstalledCliMtimeMs,
         isRunnerRunningCurrentlyInstalledMobiVersion, stopRunner } from './controlClient'
```

## 与 ControlServer 的对应关系

| 客户端函数 | 服务端端点 | 请求体 | 响应提取 |
|-----------|-----------|--------|----------|
| `notifyRunnerSessionStarted` | `/session-started` | `{ sessionId, metadata }` | 原样返回 |
| `listRunnerSessions` | `/list` | 无 | `result.children \|\| []` |
| `stopRunnerSession` | `/stop-session` | `{ sessionId }` | `result.success \|\| false` |
| `spawnRunnerSession` | `/spawn-session` | `{ directory, sessionId? }` | 原样返回 |
| `stopRunnerHttp` | `/stop` | 无 | 忽略返回 |

## 设计特点

1. **薄封装**: 每个函数仅做 JSON 请求 + 错误包装，不含业务逻辑
2. **防御式调用**: 先检查状态文件和进程存活，再发 HTTP 请求
3. **统一错误格式**: 所有失败场景都返回 `{ error: string }`，调用方无需区分错误类型
4. **零依赖 HTTP**: 使用原生 `fetch`，无需额外 HTTP 客户端库
5. **超时可配置**: 通过环境变量 `MOBI_RUNNER_HTTP_TIMEOUT` 调整
