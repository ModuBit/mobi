# Ripgrep & Difftastic Handler (`handlers/ripgrep.ts`, `handlers/difftastic.ts`)

两个结构几乎相同的 Handler，封装外部二进制工具的调用。代理模式：透传参数给底层工具。

## 共同架构

```
Hub RPC 请求 { args, cwd }
        │
        ▼
validatePath(cwd)       ← 路径安全校验
        │
        ▼
底层模块执行
        │
        ▼
{ success, exitCode, stdout, stderr }
```

两者代码结构完全一致，仅调用的底层模块不同。

---

## Ripgrep (`handlers/ripgrep.ts`)

### RPC 方法: `ripgrep`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `args` | string[] | 是 | ripgrep 命令行参数 |
| `cwd` | string | 否 | 工作目录 |

**底层调用**:

```typescript
import { run as runRipgrep } from '@/modules/ripgrep/index'
const result = await runRipgrep(data.args, { cwd: data.cwd })
```

返回 ripgrep 的 stdout（搜索结果，通常是 JSON 行格式）。

---

## Difftastic (`handlers/difftastic.ts`)

### RPC 方法: `difftastic`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `args` | string[] | 是 | difftastic 命令行参数 |
| `cwd` | string | 否 | 工作目录 |

**底层调用**:

```typescript
import { run as runDifftastic } from '@/modules/difftastic/index'
const result = await runDifftastic(data.args, { cwd: data.cwd })
```

返回 difftastic 的 stdout（结构化 diff 输出）。

---

## 响应格式

两个 Handler 共享相同的响应结构：

```typescript
{
    success: boolean
    exitCode?: number    // 进程退出码（0 = 无匹配/无差异）
    stdout?: string      // 工具输出
    stderr?: string      // 错误输出
    error?: string       // success=false 时
}
```

## 安全机制

- `cwd` 参数通过 `validatePath` 校验
- `args` 数组直接透传给底层模块（底层模块使用 `execFile` 风格调用，无 shell 注入风险）

## 设计特点

这两个 Handler 是典型的**代理模式**：
- Handler 层只负责路径校验和错误包装
- 实际执行逻辑在 `@/modules/ripgrep` 和 `@/modules/difftastic` 中
- 参数完全透传，不做任何修改或校验（由底层工具自行处理）
