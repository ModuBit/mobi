# Bash Handler (`handlers/bash.ts`)

远程执行 Shell 命令，供 Hub Web 端在 CLI 侧运行任意 shell 命令。

## RPC 方法

### `bash`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | Shell 命令（支持管道、重定向等） |
| `cwd` | string | 否 | 工作目录（默认 session 工作目录） |
| `timeout` | number | 否 | 超时毫秒数（默认 30000） |

**响应**:

```typescript
{ success: true, stdout: string, stderr: string, exitCode: 0 }
// 或
{ success: false, error: string, stdout?: string, stderr?: string, exitCode?: number }
```

## 执行方式

```typescript
import { exec } from 'child_process'
const { stdout, stderr } = await execAsync(command, { cwd, timeout })
```

使用 `exec`（非 `execFile`），因此：
- 支持 shell 特性（管道 `|`、重定向 `>`、环境变量 `$VAR` 等）
- 命令字符串直接传入 shell 解释执行

## 安全机制

1. **路径校验**: `cwd` 参数通过 `validatePath` 校验，确保在 workingDirectory 内
2. **超时保护**: 默认 30 秒，防止命令无限运行
3. **错误分类**:
   - `ETIMEDOUT` / `killed` → 超时错误
   - 其他 → 通用执行错误，返回 stdout/stderr/exitCode

## 错误处理

```
execAsync 抛异常
    │
    ├── ETIMEDOUT / killed → rpcError('Command timed out', { stdout, stderr, exitCode: -1 })
    │
    └── 其他 → rpcError(message, { stdout, stderr, exitCode })
```

即使命令执行失败（非零退出码），`exec` 也会抛出异常。Handler 从异常对象中提取 stdout/stderr 返回给调用者。

## 与 Git Handler 的区别

| 特性 | Bash | Git |
|------|------|-----|
| 执行函数 | `exec` | `execFile` |
| 命令注入风险 | 由 shell 解释 | 参数数组，无注入风险 |
| 适用场景 | 通用命令 | 固定 git 子命令 |
| 超时默认值 | 30s | 10s |
