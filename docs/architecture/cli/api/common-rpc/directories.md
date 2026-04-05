# Directories Handler (`handlers/directories.ts`)

远程目录浏览，支持平铺列表和递归树两种模式。

## RPC 方法

### `listDirectory`

列出目录内容（单层，非递归）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 目录路径（默认 `.`） |

**响应**:

```typescript
{
    success: true,
    entries: DirectoryEntry[]  // 目录在前，文件在后，按名称排序
}
```

**DirectoryEntry**:

```typescript
{
    name: string
    type: 'file' | 'directory' | 'other'  // 符号链接为 'other'
    size?: number       // 字节数
    modified?: number   // mtime 时间戳
}
```

**流程**:
```
validatePath → resolve → readdir({ withFileTypes: true })
    ↓
并行 stat 每个条目 → 分类 + 获取元数据
    ↓
排序: 目录优先 → 按名称字母序
```

**特殊处理**:
- 符号链接分类为 `other`，不获取 size/modified
- stat 失败的条目仍返回（缺少 size/modified）

### `getDirectoryTree`

递归构建目录树（有深度限制）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 根目录路径（默认 `.`） |
| `maxDepth` | number | 是 | 最大递归深度 |

**响应**:

```typescript
{
    success: true,
    tree: TreeNode   // 递归结构
}
```

**TreeNode**:

```typescript
{
    name: string
    path: string         // 绝对路径
    type: 'file' | 'directory'
    size?: number
    modified?: number
    children?: TreeNode[]  // 仅目录有此字段
}
```

**递归构建流程**:
```
buildTree(path, name, depth)
    │
    ├── stat(path)
    ├── 构建当前节点 { name, path, type, size, modified }
    │
    ├── 如果是目录且 depth < maxDepth
    │   ├── readdir → 遍历子条目
    │   ├── 跳过符号链接
    │   ├── 递归 buildTree(childPath, childName, depth + 1)
    │   └── children 按 目录优先 + 名称排序
    │
    └── 返回节点 (null 如果 stat 失败)
```

**保护措施**:
- `maxDepth < 0` → 立即报错
- 符号链接 → 跳过（避免无限递归）
- 单节点 stat 失败 → 返回 `null`，不中断整体遍历

## 排序规则

两个方法使用相同的排序规则：

```
1. 目录排在文件前面
2. 同类型按 name 字母序排列
```

```typescript
entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
})
```
