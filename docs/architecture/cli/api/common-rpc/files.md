# Files Handler (`handlers/files.ts`)

远程文件读写操作，内容以 Base64 编码传输。

## RPC 方法

### `readFile`

读取文件内容（Base64 编码返回）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 相对于 workingDirectory 的文件路径 |

**响应**:

```typescript
{ success: true, content: string }   // content = Base64 编码的文件内容
// 或
{ success: false, error: string }
```

**流程**:
```
validatePath(path, workingDirectory)
    ↓
resolve(workingDirectory, path)
    ↓
readFile → Buffer → toString('base64')
```

### `writeFile`

写入文件，支持乐观锁（SHA-256 哈希校验）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `content` | string | 是 | Base64 编码的文件内容 |
| `expectedHash` | string | null | 否 | 已有文件的 SHA-256 哈希（乐观锁） |

**响应**:

```typescript
{ success: true, hash: string }   // hash = 写入内容的 SHA-256
// 或
{ success: false, error: string }
```

## 写入模式

根据 `expectedHash` 参数分为两种模式：

### 模式一：更新已有文件（expectedHash 有值）

```
1. 读取已有文件 → 计算 SHA-256
2. 比对 expectedHash
   ├── 不匹配 → rpcError('File hash mismatch')
   └── 匹配 → 继续写入
3. 写入新内容
4. 返回新内容的 hash
```

如果文件不存在但提供了 hash → 报错。

### 模式二：创建新文件（expectedHash 为 null/undefined）

```
1. stat(path) 检查文件是否存在
   ├── 存在 → rpcError('File already exists but was expected to be new')
   └── 不存在 (ENOENT) → 继续写入
2. 写入新内容
3. 返回新内容的 hash
```

## 安全机制

1. **路径校验**: 两个方法都通过 `validatePath` 校验
2. **哈希校验**: 防止并发写入导致数据丢失
3. **Base64 传输**: 二进制文件安全传输

## 哈希计算

```typescript
createHash('sha256').update(buffer).digest('hex')
```

使用 Node.js 内置 `crypto` 模块，对原始文件内容计算 SHA-256。
