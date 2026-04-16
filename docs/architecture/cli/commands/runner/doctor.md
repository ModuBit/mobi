# Doctor (`runner/doctor.ts`)

Runner 进程诊断与清理工具，用于发现和杀死失控的 MOBI 进程。

**文件**: [`packages/cli/src/runner/doctor.ts`](/packages/cli/src/runner/doctor.ts)

## 定位

```
┌──────────────────────────────────────────────┐
│  mobi runner status / mobi doctor            │
└───────────────┬──────────────────────────────┘
                │ 调用
                ▼
┌──────────────────────────┐
│    doctor.ts             │
│    ├── findAllMobiProcesses()       进程发现 + 分类
│    ├── findRunawayMobiProcesses()   失控进程筛选
│    └── killRunawayMobiProcesses()   进程清理
└──────────────────────────┘
                │ 依赖
                ▼
        ps-list (进程列表)
        killProcess (进程终止)
```

## 进程分类体系

`findAllMobiProcesses` 先识别 MOBI 相关进程，再按命令行参数分类：

### 识别规则

```typescript
// 判断是否为 MOBI 进程
const isMobiBinary = name === 'mobi' || name === 'mobi.exe' || /\bmobi(\.exe)?\b/.test(cmd)
const isDevMode = cmd.includes('src/index.ts')
const isMobi = name.includes('Mobi') ||
                name === 'node' && cmd.includes('mobi') ||
                cmd.includes('Mobi-coder') ||
                isMobiBinary ||
                isDevMode
```

### 分类矩阵

| 条件 | 生产模式 type | 开发模式 type |
|------|--------------|--------------|
| `pid === process.pid` | `current` | `current` |
| `--version` | `runner-version-check` | `dev-runner-version-check` |
| `runner start-sync` 或 `runner start` | `runner` | `dev-runner` |
| `--started-by runner` | `runner-spawned-session` | `dev-runner-spawned` |
| `doctor` | `doctor` | `dev-doctor` |
| `--yolo` | — | `dev-session` |
| 其他 | `user-session` | `dev-related` |

**分类流程**:

```
findAllMobiProcesses()
    │
    ├── psList() → 获取系统进程列表
    │
    └── 遍历每个进程
         ├── 识别: name/cmd 中包含 mobi 关键字
         │   ├── mobi / mobi.exe (编译二进制)
         │   ├── src/index.ts (开发模式)
         │   └── Mobi-coder 等
         │
         └── 分类: 按命令行参数精确匹配
              ├── 当前进程 → current
              ├── --version → version-check
              ├── runner start → runner
              ├── --started-by runner → runner-spawned-session
              ├── doctor → doctor
              ├── --yolo → dev-session
              └── 其他 → user-session / dev-related
```

## 函数详解

### `findAllMobiProcesses()`

发现所有 MOBI CLI 进程（包括当前进程）。

```typescript
async function findAllMobiProcesses(): Promise<Array<{
  pid: number
  command: string
  type: string    // 分类标签
}>>
```

- 依赖 `ps-list` 库获取系统进程列表
- 按 name 和 cmd 字段匹配 MOBI 进程
- 返回包含 pid、command、type 的数组
- 失败时返回空数组（防御式处理）

### `findRunawayMobiProcesses()`

从所有 MOBI 进程中筛选出需要清理的失控进程。

```typescript
async function findRunawayMobiProcesses(): Promise<Array<{
  pid: number
  command: string
}>>
```

**筛选条件**:
- 排除当前进程（`pid !== process.pid`）
- 仅保留以下类型：

| 类型 | 说明 | 需要清理的原因 |
|------|------|---------------|
| `runner` | 生产模式 Runner | Runner 应正常退出，残留即为失控 |
| `dev-runner` | 开发模式 Runner | 同上 |
| `runner-spawned-session` | Runner 创建的会话 | 会话应被 Runner 管理，Runner 已死则失控 |
| `dev-runner-spawned` | 开发模式 Runner 创建的会话 | 同上 |
| `runner-version-check` | 版本检查进程 | 应快速完成并退出，残留即为异常 |
| `dev-runner-version-check` | 开发模式版本检查 | 同上 |

**不需要清理的类型**:
- `current` — 当前进程自身
- `doctor` — 诊断进程本身
- `dev-doctor` — 开发模式诊断进程
- `user-session` — 用户主动启动的会话
- `dev-session` — 开发模式会话
- `dev-related` / `unknown` — 其他相关进程

### `killRunawayMobiProcesses()`

杀死所有失控进程，两阶段终止策略。

```typescript
async function killRunawayMobiProcesses(): Promise<{
  killed: number
  errors: Array<{ pid: number, error: string }>
}>
```

**流程**:

```
killRunawayMobiProcesses()
    │
    ├── findRunawayMobiProcesses() → 获取失控进程列表
    │
    └── 遍历每个进程
         ├── 第一阶段: killProcess(pid, force=false)  ← 优雅终止
         │   └── 等待 1 秒
         │       └── 再次 psList 检查存活
         │           ├── 已退出 → 计入 killed
         │           └── 仍存活 → 进入第二阶段
         │
         └── 第二阶段: killProcess(pid, force=true)   ← 强制杀死
              ├── 成功 → 计入 killed
              └── 失败 → 计入 errors
```

**两阶段终止设计**:
1. **优雅终止** (`force=false`): 发送 SIGTERM，允许进程清理资源
2. **强制杀死** (`force=true`): 发送 SIGKILL，立即终止

## 调用方

```typescript
// packages/cli/src/ui/doctor.ts — mobi doctor 命令
import { findAllMobiProcesses, findRunawayMobiProcesses, killRunawayMobiProcesses }
  from '@/runner/doctor'

// packages/cli/src/commands/runner.ts — mobi runner status 子命令
// 通过 runDoctorCommand 间接调用
```

## 设计特点

1. **非破坏性发现**: `findAllMobiProcesses` 只读进程列表，不修改任何状态
2. **两阶段清理**: 先优雅终止，失败后强制杀死，避免直接 SIGKILL 丢失数据
3. **精确分类**: 通过命令行参数区分 10+ 种进程类型，避免误杀用户会话
4. **防御式设计**: 所有操作都有 try/catch，单进程失败不影响其他进程清理
5. **开发模式感知**: 区分生产/开发模式进程，方便本地开发调试
