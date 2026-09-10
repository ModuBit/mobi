# Common RPC Handlers (`packages/cli/src/modules/common/`)

Hub（Web 端）远程调用 CLI 侧能力的统一入口。Handler 共享统一响应格式，并按读、写与通道用途应用对应的路径策略。

## 注册入口

```typescript
// registerCommonHandlers.ts
registerCommonHandlers(rpcHandlerManager, workingDirectory)
```

在 `ApiSessionClient` 和 `ApiMachineClient` 构造时均会调用，注册到各自的 `RpcHandlerManager`。

**唯一例外**: `uploads` 不需要 `workingDirectory`（文件存储在专用 blobs 目录）。

## Handler 一览

| Handler | RPC 方法 | 分类 | 详细文档 |
|---------|---------|------|---------|
| bash | `bash` | 命令执行 | [bash.md](./bash.md) |
| files | `readFileMeta`, `readFileRange`, `writeFile`, `saveFile` | 文件读写（session / machine 两通道） | [files.md](./files.md) |
| directories | `listDirectory`, `getDirectoryTree` | 目录浏览 | [directories.md](./directories.md) |
| git | `git-status`, `git-diff-numstat`, `git-diff-file` | Git 操作 | [git.md](./git.md) |
| ripgrep | `ripgrep` | 代码搜索 | [ripgrep-difftastic.md](./ripgrep-difftastic.md) |
| difftastic | `difftastic` | 差异对比 | 同上 |
| commands | `refreshMetadata` | SDK 元数据刷新 | [slash-commands-skills.md](./slash-commands-skills.md) |
| uploads | `uploadFile`, `deleteUpload` | 文件上传 | [uploads.md](./uploads.md) |
| sessionFiles | `searchSessionFiles`, `listSessionDirectory` | 会话文件搜索与目录浏览 | （内联） |
| webToolsConfig | `get-web-tools-config`, `set-web-tools-config`, `verify-web-tools-provider` | Web 工具配置读写与连通性验证（凭据脱敏回显 / 锁内在场性 merge 落盘 / 草稿凭据试连） | （内联；仅 machine 级，`ApiMachineClient` 构造时注册） |

## 架构模式

所有 Handler 遵循统一的分层架构：

```
Hub RPC 请求
    │
    ▼
Handler 入口
    │
    ├── 1. 通道策略校验
    │      └── 读/写边界，machine handler 可追加类型限制
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

**读边界调用者**: files、machineFiles、directories、ripgrep 等文件读取能力。文件读边界的决策见 ADR 0004。

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
Hub (远程)                        CLI (本地)
──────────                        ──────────
                                   │
  RPC 请求 ──────────────────────▶ │ 通道策略校验
                                   │    ↓ 得到已授权 resolvedPath
                                   │ 执行操作
                                   │    ↓
  RPC 响应 ◀────────────────────── │ { success, data/error }
```

1. **路径策略**: 读取和写入使用不同允许集；Machine 文件读取还有扩展名白名单
2. **超时保护**: bash/git 命令有默认超时（30s / 10s）
3. **上传限制**: 文件上传最大 50MB，存储在独立 blobs 目录
4. **execFile vs exec**: Git handler 使用 `execFile`（参数数组，防注入），Bash 使用 `exec`（支持管道等）
