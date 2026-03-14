# Mobi 开发指南

## 环境要求

- **运行时**: Bun >= 1.3
- **Node.js**: >= 20 (可选，用于某些工具)
- **TypeScript**: 5.x

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器 (Hub + Web)
bun run dev

# 仅启动 Hub
bun run dev:hub

# 仅启动 Web
bun run dev:web
```

## 脚本命令

### 根目录

| 命令 | 说明 |
|------|------|
| `bun install` | 安装所有依赖 |
| `bun run dev` | 启动 Hub + Web (开发模式) |
| `bun run build` | 构建 Hub + Web |
| `bun run typecheck` | 所有包类型检查 |
| `bun run test` | 运行测试 |

### Hub

| 命令 | 说明 |
|------|------|
| `bun run dev` | 开发模式 (热重载) |
| `bun run start` | 生产模式启动 |
| `bun run build` | 构建可执行文件 |
| `bun run test` | 运行测试 |
| `bun run typecheck` | 类型检查 |

### CLI

| 命令 | 说明 |
|------|------|
| `bun run dev` | 开发模式运行 |
| `bun run typecheck` | 类型检查 |
| `bun run test` | 运行测试 |
| `bun run build:exe` | 构建可执行文件 |

### Web

| 命令 | 说明 |
|------|------|
| `bun run dev` | Vite 开发服务器 |
| `bun run build` | 构建生产版本 |
| `bun run typecheck` | 类型检查 |

## CLI 子命令

```bash
# 启动新会话
mobi

# 指定工作目录
mobi /path/to/project

# 指定权限模式
mobi --permission-mode acceptEdits

# 指定模型
mobi --model sonnet

# 恢复会话
mobi --resume <session-id>

# 列出会话
mobi list

# 启动 Hub
mobi hub
```

### 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 每次操作都询问 |
| `acceptEdits` | 自动接受编辑操作 |
| `bypassPermissions` | 绕过所有权限检查 |
| `plan` | 计划模式 |

### 模型模式

| 模式 | 说明 |
|------|------|
| `default` | 默认模型 |
| `sonnet` | Claude Sonnet |
| `opus` | Claude Opus |

## 环境变量

### Hub

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MOBI_PORT` | `2222` | Hub 端口 |
| `MOBI_HOST` | `0.0.0.0` | Hub 绑定地址 |
| `MOBI_DATA_DIR` | `~/.mobi` | 数据目录 |
| `MOBI_JWT_SECRET` | (随机生成) | JWT 密钥 |

### CLI

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MOBI_HUB_URL` | `http://localhost:2222` | Hub 地址 |

## 目录结构

```
~/.mobi/
├── mobi.db          # SQLite 数据库
├── mobi.db-wal      # WAL 文件
├── mobi.db-shm      # 共享内存文件
├── config.json      # 配置文件
└── uploads/         # 上传文件
```

## 内部依赖

使用 `workspace:*` 引用：

```json
{
  "dependencies": {
    "@mobi/shared": "workspace:*"
  }
}
```

## 开发规范

### TypeScript

- 严格模式启用
- 使用 ES Module (`"type": "module"`)
- 代码注释使用中文

### 代码风格

- 使用 Bun 运行时（不是 npm/node）
- 注释语言：中文
- 提交信息：遵循 Conventional Commits

### 文档同步

以下情况需同步更新文档：

- 修改架构 → `docs/architecture.md`
- 新增包/调整文件路径 → `docs/architecture.md`
- 改变通信机制 → `docs/architecture.md`
- 调整脚本命令 → `docs/development.md`
- 新增 CLI 子命令 → `docs/development.md`
- 新增环境变量 → `docs/development.md`

## 测试

```bash
# 运行所有测试
bun run test

# 运行 Hub 测试
cd hub && bun test

# 运行 CLI 测试
cd cli && bun run test
```

## 构建与部署

```bash
# 构建所有
bun run build

# 构建 Hub
cd hub && bun run build

# 构建 Web
cd web && bun run build

# 构建 CLI 可执行文件
cd cli && bun run build:exe
```

## 调试

### Hub 日志

Hub 输出到 stdout/stderr，可重定向到文件：

```bash
bun run dev:hub 2>&1 | tee hub.log
```

### CLI 日志

CLI 日志文件位于临时目录，具体路径见 CLI 输出。

### 数据库调试

```bash
sqlite3 ~/.mobi/mobi.db

# 查看所有表
.tables

# 查看会话
SELECT id, active, metadata FROM sessions;
```
