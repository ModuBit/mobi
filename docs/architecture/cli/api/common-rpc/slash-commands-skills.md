# Slash Commands & Skills Handler (`handlers/slashCommands.ts`, `handlers/skills.ts`)

命令和 Skill 的远程发现接口。Hub 通过这些 RPC 查询 CLI 侧可用的自定义命令和技能。

---

## Slash Commands (`handlers/slashCommands.ts`)

### RPC 方法: `listSlashCommands`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent` | string | 是 | Agent 类型（当前仅 `'claude'`） |

**响应**:

```typescript
{
    success: boolean
    commands?: SlashCommand[]
    error?: string
}
```

### 命令来源

按优先级从低到高扫描四个来源：

| 来源 | 路径 | 说明 |
|------|------|------|
| **builtin** | 硬编码 | 内置命令（clear, compact, context, cost, plan） |
| **user** | `~/.claude/commands/` | 用户全局自定义命令 |
| **plugin** | 已安装插件的 `commands/` 目录 | 插件提供的命令 |
| **project** | `<project>/.claude/commands/` | 项目级自定义命令 |

**优先级规则**: 后发现的同名命令覆盖先发现的（project > plugin > user > builtin）。

### 命令文件格式

Markdown 文件（`.md`），支持 frontmatter：

```markdown
---
description: 命令描述
name: 可选的命令名覆盖
---

命令的具体内容（展开后作为 prompt 注入）
```

### 扫描逻辑

```
listSlashCommands(agent, workingDirectory)
    │
    ├── 并行扫描四个来源
    │   ├── builtin → BUILTIN_COMMANDS 常量
    │   ├── user → scanCommandsDir(~/.claude/commands/)
    │   ├── plugin → 读取 installed_plugins.json → 遍历各插件的 commands/
    │   └── project → scanCommandsDir(<project>/.claude/commands/)
    │
    ├── 合并 + 去重（后者覆盖前者）
    │
    └── 按名称排序返回
```

#### scanCommandsDir 递归扫描

```
scanCommandsDir(dir, source)
    │
    └── scanRecursive(dir, segments=[])
         ├── 跳过: .开头的文件、符号链接
         ├── 目录 → 递归（segments 追加目录名）
         └── *.md 文件
              ├── 路径段 + 文件名 → 命令名 (如 "sub:cmd")
              ├── 插件命令 → "pluginName:sub:cmd"
              └── 解析 frontmatter → { name, description, content }
```

#### 插件发现

```
~/.claude/plugins/installed_plugins.json
    │
    ├── 解析插件列表
    ├── 按 pluginKey 提取 pluginName
    ├── 每个 plugin 取最新安装实例（按 lastUpdated 排序）
    └── 扫描 <installPath>/commands/ 目录
```

---

## Skills (`handlers/skills.ts`)

### RPC 方法: `listSkills`

无请求参数（仅使用 workingDirectory）。

**响应**:

```typescript
{
    success: boolean
    skills?: SkillSummary[]   // { name, description }
    error?: string
}
```

### Skill 来源

| 来源 | 路径 | 说明 |
|------|------|------|
| **project** | `<project>/.agents/skills/*/` | 项目级 skill（沿目录树向上搜索至 git 根） |
| **user** | `~/.agents/skills/*/` | 用户全局 skill |
| **admin** | `/etc/mobi/skills/*/` | 系统管理员 skill |

**优先级**: project > user > admin（同名 skill，project 优先）。

### Skill 文件格式

每个 Skill 是一个目录，包含 `SKILL.md` 文件：

```
.agents/skills/
├── my-skill/
│   └── SKILL.md     ← frontmatter + 内容
└── another-skill/
    └── SKILL.md
```

`SKILL.md` frontmatter:

```markdown
---
name: skill-name
description: Skill 描述
---

Skill 的具体内容
```

### 项目根目录发现

```
listProjectSkillsRoots(workingDirectory)
    │
    └── 从 workingDirectory 向上遍历
        ├── 找到 .git 目录 → 停止，返回沿途所有目录对应的 skills 路径
        └── 到达文件系统根 → 仅返回 workingDirectory 对应的路径
```

这确保了嵌套项目结构中，子目录也能继承父项目的 skills。

### 扫描与合并

```
listSkills(workingDirectory)
    │
    ├── 并行扫描三个来源
    │   ├── project → 所有项目级 skill 目录
    │   ├── user → ~/.agents/skills/
    │   └── admin → /etc/mobi/skills/
    │
    ├── 并行读取 SKILL.md → 解析 frontmatter
    │
    ├── 去重（同名 skill，首次出现优先 → project 优先）
    │
    └── 按名称排序返回
```

---

## 共同设计模式

1. **多级来源合并**: 内置/全局/项目分级，后者覆盖前者
2. **Frontmatter 解析**: YAML frontmatter 提取元数据，body 作为内容
3. **并行扫描**: 所有来源 `Promise.all` 并行读取
4. **Map 去重**: `Map<string, T>` 实现同名校验和覆盖
5. **防御式 I/O**: 所有文件读取都有 try/catch，失败返回空数组而非中断
