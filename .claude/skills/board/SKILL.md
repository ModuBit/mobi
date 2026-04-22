---
name: board
description: 管理项目看板事项。当用户提到"看板"、"事项"、"任务进度"、或调用 /board 时使用。也用于完成功能开发后更新事项状态。
---

# Board Skill — 项目看板管理

## 看板位置

- 活跃看板：`docs/board/board.md`
- 已完成归档：`docs/board/board-archive.md`

## 格式

### 事项格式

```
- `Bxxx` 标题 · 优先级 · 参考链接（可选）
```

- **ID**：`B` + 3 位数字，全局唯一递增
- **优先级**：`P0`（紧急）> `P1`（高）> `P2`（中）> `P3`（低）
- **参考链接**：可选，如 `pending.md#19`
- 同一状态列内按优先级排列

### 四列状态

| 列 | 含义 |
|---|---|
| Backlog | 待处理，尚未开始 |
| In Progress | 正在开发 |
| Testing | 开发完成，待验证 |
| Done | 验证通过，等待归档 |

## 操作

### 查看看板（默认）

读取 `docs/board/board.md`，展示各状态列的事项概览。

### 新增事项

1. 读取 `docs/board/board.md` 和 `docs/board/board-archive.md`
2. 找到当前最大 Bxxx ID
3. 在 Backlog 末尾追加新事项，使用下一个 ID
4. 按优先级插入到合适位置

### 移动状态

1. 用 Edit 工具将事项从当前状态区删除
2. 按优先级插入到目标状态区
3. 可选：添加简短备注说明移动原因

### 归档

1. 读取 Done 列所有事项
2. 在 `board-archive.md` 对应月份下追加，附加完成日期
3. 从 `docs/board/board.md` 的 Done 列清除

### 快捷操作

- 开始开发某事项 → 移到 In Progress
- 完成开发待测试 → 移到 Testing
- 测试通过 → 移到 Done
- Done 列超过 5 条 → 触发归档

## ID 分配规则

1. 扫描 `board.md` 和 `board-archive.md` 中所有 `Bxxx` 模式
2. 取最大值 + 1
3. 格式化为 3 位数字（`B007`、`B008`...）

## 注意事项

- 操作使用 Edit 工具，不要重写整个文件
- 保持状态列的注释标记（`<!-- 暂无 -->`）
- 归档时按月份分组，格式 `## YYYY-MM`
- 不自动删除或修改 `docs/todo.md` 和 `docs/pending.md`
