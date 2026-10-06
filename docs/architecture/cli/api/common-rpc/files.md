# Files Handlers (`handlers/files.ts` / `handlers/hostFiles.ts`)

浏览器不直接访问本机文件系统；daemon 承担文件读写。有 session 和 host 两条通道，共用文件 implementation，各自保留寻址与授权策略。

## 两条读取通道

| Adapter | 寻址 | 通道 | 策略 |
|---|---|---|---|
| `files.ts` | session 的 `workingDirectory` | 会话 WebSocket RPC（`readFileMeta` / `readFileRange` / `writeFile` / `saveFile`） | `validateReadPath`；meta 额外返回 `writable` |
| `hostFiles.ts` | 显式 `cwd` 参数（缺省回退 `process.cwd()`） | daemon HTTP 路由（`/api/files/*`）与 executor 本地直调（`LocalExecutor.hostReadFileMeta` 等） | `validateReadPath`，与 session 通道同源同参 |

host 通道供跨会话存活的静态资源读取（消息附件预览等）。曾有的扩展名白名单已废除（ADR 0006）：两链读边界必须完全同一函数同一参数形态，否则冷会话与活跃会话的文件读行为分叉；闸门 = 目录黑名单 + 敏感文件名单（`validateReadPath` 单源）。

## 共享文件读取 module

`handlers/fileRead.ts` 的 interface 只接收已经 adapter 校验过的绝对路径：

```typescript
readFileMetaAt(absPath)
readFileRangeAt(absPath, offset?, length?)
```

该 module 负责：

- `stat` 和 `mime / size / etag` 元数据组装；
- `offset / length` 取整、默认值与合法性检查；
- 文件末段截断到 EOF；
- `[offset, offset + length)` 字节范围读取；
- 统一失败结果，其中 `ENOENT` 保留结构化错误码。

该 module **不负责**路径权限、Session 可写性和 RPC 注册；这些仍属于两个 adapter。

## 方法

### `readFileMeta`

返回文件元数据：

```typescript
{ success: true, meta: { mime, size, etag }, writable? }
// 或
{ success: false, error: string, code?: string }
```

`etag = size-mtimeMs`。`writable` 仅由 session 通道返回，并使用与写入相同的 `validateWritePath`。

### `readFileRange`

读取 `[offset, offset + length)` 字节范围，Socket.IO 以原生二进制附件传输 `Uint8Array`（HTTP 通道直接回二进制响应）：

```typescript
{ success: true, chunk: Uint8Array }
// 或
{ success: false, error: string, code?: string }
```

- 缺省 `offset` 为 `0`；
- 缺省 `length` 为 `RPC_BINARY_CHUNK_SIZE`；
- 末段超出 EOF 时自动截断；
- 非有限数、负数、空范围或越界起点返回失败。

### `writeFile`

使用 Base64 内容写入文件。`expectedHash` 存在时校验已有文件的 SHA-256；缺省时要求目标尚不存在。写边界严格限定在 session `workingDirectory` 子树。

### `saveFile`

覆盖已有文件，使用 `baseEtag` 做乐观并发控制，通过同目录临时文件加 `rename` 原子替换。空 `baseEtag` 表示用户确认强制覆盖。

## 安全与错误

- 读边界：`cwd` 子树 ∪（`home` 子树 − 黑名单），见 ADR 0004。
- 写边界：严格 `cwd` 子树。
- `ACCESS_DENIED`：路径边界拒绝。
- `ENOENT`：目标文件不存在。

路径策略先于文件读取 module 执行，因此共享范围语义不会扩大任一通道的可访问文件集。
