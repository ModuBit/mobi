# Common RPC Handlers (`packages/node-core/src/handlers/`)

daemon（Web 端）远程调用 CLI 侧能力的统一入口。Handler 共享统一响应格式，并按读、写与通道用途应用对应的路径策略。

## 注册入口

```typescript
// registerCommonHandlers.ts
registerCommonHandlers(rpcHandlerManager, workingDirectory)
```

在 `ApiSessionClient` 构造时调用，注册到其 `RpcHandlerManager`（session-scoped WebSocket）。

## Handler 一览

| Handler | RPC 方法 | 分类 | 详细文档 |
|---------|---------|------|---------|
| files | `readFileMeta`, `readFileRange`, `writeFile`, `saveFile` | 文件读写 | [files.md](./files.md) |
| difftastic | `difftastic` | 差异对比 | [slash-commands-skills.md](./slash-commands-skills.md) 同级内联说明 |
| commands | `refreshMetadata` | SDK 元数据刷新 | [slash-commands-skills.md](./slash-commands-skills.md) |
| uploads | `uploadFile`, `deleteUpload` | 文件上传（无需 workingDirectory，文件存专用 blobs 目录） | [uploads.md](./uploads.md) |
| sessionFiles | `searchSessionFiles`, `listSessionDirectory` | 会话文件搜索与目录浏览 | （内联） |

> 历史上的 bash / git / ripgrep / directories RPC 族已随单机 daemon 收敛退场：文件搜索、目录浏览、git 审查等能力改走 daemon HTTP 路由（`/api/files/*` 等），daemon 本地直调 node-core 实现。

`packages/node-core/src/handlers/` 下的 `gitReview` / `hostFiles` / `hostDirectory` / `webToolsConfig` / `pathExists` 属于 **host 族**（daemon HTTP 路由或 executor 本地直调消费，不经会话 WebSocket RPC）。

## 架构模式

所有 Handler 遵循统一的分层架构：

```
daemon RPC 请求
    │
    ▼
Handler 入口
    │
    ├── 1. 通道策略校验
    │      └── 读/写边界
    │
    ├── 2. 执行核心逻辑
    │      └── 调用底层模块（child_process / fs / 外部二进制）
    │
    ├── 3a. 成功 → { success: true, ... }
    └── 3b. 失败 → rpcError(message, extras)
```

## 共享基础设施

### 路径安全 (`pathSecurity.ts`)

```typescript
validateReadPath(targetPath, workingDirectory, homeDir): PathResolution
validateWritePath(targetPath, workingDirectory, homeDir): PathResolution
```

- 读边界为 `cwd` 子树 ∪（`home` 子树 − 黑名单）；写边界严格限定在 `cwd`
- 有效结果直接携带 `resolvedPath`，保证校验和实际操作使用同一路径
- 阻止路径穿越攻击（`../`、符号链接等）
- Windows 大小写不敏感处理

**读边界调用者**: files、sessionFiles 等文件读取能力。文件读边界的决策见 ADR 0004。

### 响应格式 (`rpcResponses.ts`)

```typescript
// 统一错误响应
rpcError(message, extras?) → { success: false, error: string, ...extras }

// 错误提取
getErrorMessage(error, fallback) → string
```

所有 Handler 返回统一的 `{ success: boolean }` 格式，失败时附带 `error` 字段。

## 安全边界

```
daemon (远程)                        CLI (本地)
──────────                        ──────────
                                   │
  RPC 请求 ──────────────────────▶ │ 通道策略校验
                                   │    ↓ 得到已授权 resolvedPath
                                   │ 执行操作
                                   │    ↓
  RPC 响应 ◀────────────────────── │ { success, data/error }
```

1. **路径策略**: 读取和写入使用不同允许集
2. **上传限制**: 文件上传最大 50MB，存储在独立 blobs 目录
3. **execFile vs exec**: 外部命令优先 `execFile`（参数数组，防注入）
