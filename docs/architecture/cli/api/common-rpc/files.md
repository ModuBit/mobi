# Files RPC (`handlers/files.ts` / `handlers/machineFiles.ts`)

浏览器不直接访问本机文件系统；Hub 通过 RPC 请求 CLI 读写文件。读取有 session 和 machine 两条通道，共用文件 implementation，各自保留寻址与授权策略。

## 两条读取通道

| Adapter | 寻址 | 通道策略 |
|---|---|---|
| `files.ts` | session 的 `workingDirectory` | `validateReadPath`；meta 额外返回 `writable` |
| `machineFiles.ts` | `machineId + cwd` | `validateReadPath` 后再校验扩展名白名单 |

Machine adapter 会覆盖 machine 连接上的默认同名 handler，供跨会话的附件和静态资源读取。它的扩展名限制不影响 session 通道。

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

该 module **不负责**路径权限、Machine 扩展名白名单、Session 可写性和 RPC 注册；这些仍属于两个 adapter。

## RPC 方法

### `readFileMeta`

返回文件元数据：

```typescript
{ success: true, meta: { mime, size, etag }, writable? }
// 或
{ success: false, error: string, code?: string }
```

`etag = size-mtimeMs`。`writable` 仅由 session adapter 返回，并使用与写入相同的 `validateWritePath`。

### `readFileRange`

读取 `[offset, offset + length)` 字节范围，Socket.IO 以原生二进制附件传输 `Uint8Array`：

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
- `EXT_FORBIDDEN`：Machine 通道扩展名拒绝。
- `ENOENT`：目标文件不存在。

路径策略先于文件读取 module 执行，因此共享范围语义不会扩大任一通道的可访问文件集。
