# Git Handler (`handlers/git.ts`)

远程 Git 操作，封装三个常用 git 子命令。使用 `execFile`（参数数组），避免命令注入。

## RPC 方法

### `git-status`

查看工作区状态。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | string | 否 | 工作目录 |
| `timeout` | number | 否 | 超时（默认 10s） |

执行: `git status --porcelain=v2 --branch --untracked-files=all`

- `--porcelain=v2`: 机器可解析格式
- `--branch`: 包含分支信息
- `--untracked-files=all`: 显示所有未跟踪文件

### `git-diff-numstat`

查看变更统计（增删行数）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | string | 否 | 工作目录 |
| `staged` | boolean | 否 | 查看暂存区 diff（`--cached`） |
| `timeout` | number | 否 | 超时 |

```
staged=false → git diff --numstat
staged=true  → git diff --cached --numstat
```

输出格式: `{added}\t{deleted}\t{filename}`

### `git-diff-file`

查看指定文件的 diff。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | string | 否 | 工作目录 |
| `filePath` | string | 是 | 目标文件路径 |
| `staged` | boolean | 否 | 查看暂存区 diff |
| `timeout` | number | 否 | 超时 |

```
staged=false → git diff --no-ext-diff -- <filePath>
staged=true  → git diff --cached --no-ext-diff -- <filePath>
```

- `--no-ext-diff`: 禁用外部 diff 工具，确保输出一致性
- `--`: 分隔选项和文件路径

## 通用响应格式

```typescript
{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string    // success=false 时
}
```

## 安全机制

1. **execFile 代替 exec**: 参数以数组传递，不经 shell 解释
2. **cwd 校验**: `resolveCwd()` 调用 `validatePath`
3. **filePath 校验**: `git-diff-file` 额外校验文件路径
4. **超时保护**: 默认 10s（比 bash 的 30s 更短）

## 辅助函数

```typescript
// 解析并校验 cwd
resolveCwd(requestedCwd, workingDirectory)
    → { cwd: string, error?: string }

// 校验文件路径
validateFilePath(filePath, workingDirectory)
    → string | null  // null = 有效

// 执行 git 命令（共享实现）
runGitCommand(args, cwd, timeout)
    → GitCommandResponse
```

三个 RPC 方法共享 `runGitCommand` 实现，差异仅在参数构造。

## 错误处理

```
execFileAsync 抛异常
    │
    ├── ETIMEDOUT / killed → 超时错误 (exitCode: -1)
    └── 其他 → 包含 stdout/stderr 的执行错误
```
