# Uploads Handler (`handlers/uploads.ts`)

远程文件上传管理，支持文件的上传和删除。存储在 CLI 侧的临时 blobs 目录中。

> **注意**: 这是唯一不需要 `workingDirectory` 的 Handler。文件存储在独立的 blobs 目录，不受路径沙箱限制。

## RPC 方法

### `uploadFile`

上传文件到 CLI 侧临时目录。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | Session ID（用于目录隔离） |
| `filename` | string | 是 | 原始文件名 |
| `content` | string | 是 | Base64 编码的文件内容 |
| `mimeType` | string | 是 | MIME 类型 |

**响应**:

```typescript
{ success: true, path: string }   // 文件在 CLI 侧的绝对路径
// 或
{ success: false, error: string }
```

**流程**:
```
校验 filename 和 content
    ↓
估算 Base64 解码后大小 → 上限 50MB
    ↓
getOrCreateUploadDir(sessionId) → 创建或复用临时目录
    ↓
sanitizeFilename + 时间戳 → 生成唯一文件名
    ↓
Buffer.from(content, 'base64') → writeFile
    ↓
二次校验实际 buffer 大小 → 返回文件路径
```

### `deleteUpload`

删除已上传的文件。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | Session ID |
| `path` | string | 是 | 要删除的文件路径 |

**响应**:

```typescript
{ success: true }
// 或
{ success: false, error: string }
```

## 目录管理

### 目录创建策略

```typescript
// 每按 session 一个临时目录
getMobiBlobsDir() / `${sessionKey}-XXXXXXXX/`
```

- 使用 `mkdtemp` 创建唯一临时目录
- 目录名格式: `{sessionId}-{random}`
- 通过 Map 缓存已创建的目录，避免重复创建

### 并发控制

```typescript
const uploadDirs = new Map<string, string>()           // sessionKey → 目录路径
const uploadDirPromises = new Map<string, Promise<string>>()  // 防止并发创建
```

- 多个并发上传请求共享同一个目录创建 Promise
- 防止同一 session 同时创建多个临时目录

### 清理机制

三种清理路径：

| 时机 | 方法 | 说明 |
|------|------|------|
| Session 结束 | `cleanupUploadDir(sessionId)` | 异步清理，由 `ApiSessionClient.sendSessionDeath()` 调用 |
| 进程退出 | `cleanupUploadDirsSync()` | 同步清理所有目录，通过 `process.once('exit')` 注册 |
| 取消竞态 | `uploadDirCleanupRequested` | 防止在清理请求后仍然创建目录 |

```
cleanupUploadDir(sessionId)
    │
    ├── 标记 cleanupRequested
    ├── 等待进行中的创建 Promise 完成
    ├── 删除目录引用
    └── rm(dir, { recursive: true, force: true })
```

## 安全机制

### 文件名消毒

```typescript
sanitizeFilename(filename)
    ├── 替换 / \ → _
    ├── 替换 .. → _
    ├── 空格 → _
    ├── 截断为 255 字符
    └── 空字符串 → 'upload'
```

### 大小限制

```typescript
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024  // 50MB
```

双重校验：
1. Base64 编码长度估算（快速拒绝）
2. 实际 Buffer 大小校验（精确限制）

### 路径校验（删除时）

```typescript
isPathWithinUploadDir(path, sessionId)
```

确保删除操作只能删除上传目录内的文件，不能删除系统文件。

## Base64 大小估算

```typescript
estimateBase64Bytes(base64) → number
// 公式: floor(len * 3 / 4) - padding
```

快速估算解码后字节数，避免提前解码大文件浪费内存。
