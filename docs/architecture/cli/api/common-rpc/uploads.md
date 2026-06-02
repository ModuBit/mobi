# Uploads Handler (`handlers/uploads.ts`)

远程文件上传管理，支持文件的上传和删除。文件持久化存储在项目根目录 `.mobi/uploads/` 下，跨 session 共享。

> **依赖**: 此 Handler 需要 `workingDirectory` 参数（项目根目录），用于确定 `.mobi/` 的位置。通过 `registerCommonHandlers` 统一传入。

## RPC 方法

### `uploadFile`

上传文件到项目 `.mobi/uploads/YYYY-MM/` 目录。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | Session ID（预留，当前未使用） |
| `filename` | string | 是 | 原始文件名 |
| `content` | string | 是 | Base64 编码的文件内容 |
| `mimeType` | string | 是 | MIME 类型 |

**响应**:

```typescript
{ success: true, path: string }   // 文件的项目相对路径（如 .mobi/uploads/2026-06/1748900000000-report.pdf）
// 或
{ success: false, error: string }
```

**流程**:
```
校验 filename 和 content
    ↓
文件类型校验（黑名单 + 白名单）
    ↓
估算 Base64 解码后大小 → 上限 50MB
    ↓
ensureUploadDir(projectRoot) → 创建 .mobi/uploads/YYYY-MM/ 和 .gitignore
    ↓
sanitizeFilename + 时间戳前缀 → 生成唯一文件名
    ↓
Buffer.from(content, 'base64') → writeFile
    ↓
二次校验实际 buffer 大小 → 返回项目相对路径
```

### `deleteUpload`

删除已上传的文件。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | Session ID（预留） |
| `path` | string | 是 | 文件的项目相对路径 |

**响应**:

```typescript
{ success: true }
// 或
{ success: false, error: string }
```

## 存储架构

### 目录结构

```
项目根/
├── .mobi/
│   ├── .gitignore              # 内容: uploads/ 和 artifacts/
│   └── uploads/
│       └── 2026-06/            # 按月分组
│           ├── 1748900000000-screenshot.png
│           └── 1748900001000-report.pdf
```

- 使用 `getUploadsDir(projectRoot)` 返回 `.mobi/uploads` 路径
- 按月自动创建子目录（`YYYY-MM` 格式）
- `.mobi/.gitignore` 自动创建，内容为 `uploads/` 和 `artifacts/`，排除上传和制品目录

### 路径常量

```typescript
// packages/cli/src/constants/uploadPaths.ts
getUploadsDir(projectRoot: string): string  // 返回 join(projectRoot, '.mobi', 'uploads')
```

### 文件名策略

```
{timestamp}-{sanitizedOriginalName}
```

- 时间戳前缀避免冲突
- 文件名清理：移除 `/`、`\`、`..`、空白字符，截断至 255 字符

## 安全机制

### 文件类型校验

双重检查：黑名单优先于白名单。

**黑名单**（明确拒绝）：
`.exe` `.bat` `.cmd` `.msi` `.com` `.scr` `.dll` `.so` `.dylib` `.app` `.dmg` `.deb` `.rpm` `.iso`

**白名单**（允许的类型）：
- 图片：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.bmp` `.ico`
- 文档：`.pdf` `.doc` `.docx` `.xls` `.xlsx` `.ppt` `.pptx` `.txt` `.md` `.csv` `.rtf`
- 代码：`.ts` `.tsx` `.js` `.jsx` `.py` `.java` `.go` `.rs` `.c` `.cpp` `.h` 等
- 音频：`.mp3` `.wav` `.ogg` `.aac` `.flac` `.m4a`
- 视频：`.mp4` `.webm` `.mov` `.avi` `.mkv`
- 压缩包：`.zip` `.tar` `.gz` `.bz2` `.xz` `.7z` `.rar`

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
isPathWithinUploads(projectRoot, relativePath)
```

确保删除操作只能删除 `.mobi/uploads/` 目录内的文件。支持相对路径（通过 `resolve(projectRoot, relativePath)` 解析）。

## Claude 访问

上传的文件通过以下方式让 Claude Agent SDK 可访问：

- **Local 模式**：`--add-dir` 参数添加 `.mobi/` 目录
- **Remote 模式**：`additionalDirectories` 选项添加 `.mobi/` 目录
- 消息中使用 `@.mobi/uploads/YYYY-MM/filename` 引用文件
