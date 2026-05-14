# Tool Call Grouping — 折叠连续工具调用消息

## 背景

实际使用中，Claude Code 会产生大量 Bash/Glob/Grep/Read 类工具调用，导致消息列表过长、信息密度低。需要将连续工具调用中的已完成项自动折叠，提升可读性。

## 核心概念：Zone

**Zone** = 连续相邻的可折叠工具调用（仅按工具名判定，不论状态）。

Zone 边界由以下条件打断：
- 非可折叠工具名（Edit、Write、Agent 等）
- 其他类型 block（agent-text、cli-output、agent-event 等）

Zone 边界稳定，不随工具状态变化而分裂或合并。

### 可折叠工具名

`Bash`、`shell_command`、`Glob`、`Grep`、`Read`

## 分组规则

Zone 内按状态拆分：

| 状态 | 处理 |
|------|------|
| `completed` | 按原始相对顺序收入折叠组（≥ 2 条才折叠） |
| `running` / `pending` / `error` | 按原始相对顺序在折叠组之后单独展示 |

### 渲染顺序

```
[Fold(completed blocks)] + [non-completed blocks 逐个展示]
```

completed 和 non-completed 各自保持原始相对顺序。

### 示例

5 个 Read 并行，完成顺序 read1 → read5 → read3(失败) → read4：

```
阶段1: read1, read2 完成
Fold(read1✅, read2✅) "Read 2 files"  [折叠]
read3🔄
read4🔄
read5🔄

阶段2: read5 也完成
Fold(read1✅, read2✅, read5✅) "Read 3 files"  [折叠]
read3🔄
read4🔄

阶段3: read3 失败
Fold(read1✅, read2✅, read5✅) "Read 3 files"  [折叠]
read3❌
read4🔄

阶段4: read4 完成
Fold(read1✅, read2✅, read4✅, read5✅) "Read 4 files"  [折叠]
read3❌
```

## 折叠行为

- **默认收起**：显示统计摘要 title，如 `"Run 3 shell commands, read 2 files"`
- **点击展开**：展开后各工具使用现有 `ToolCallRenderer` 渲染，各自的展开/收起状态不变
- **两层嵌套**：外层 Group Think 控制组的展开/收起，内层各 ToolCallRenderer 控制自身内容预览
- **Title 只统计 completed**：不展示 in-progress / error 计数

## 不折叠的情况

- 用户 `! bash` 产生的消息（`CliOutputBlock`，非 `ToolCallBlock`，天然排除）
- Zone 内 completed < 2 时，所有工具单独展示

## 适用场景

| 场景 | 要求 |
|------|------|
| 主对话列表 (`ChatContainer`) | 自动生效 |
| Agent 详情 Drawer (`AgentDrawerContent`) | 自动生效 |
| 历史消息（分页向上加载） | 边界两侧合并为同一 Zone |
| SSE 实时消息 | completed 工具自动吸入折叠 |

## 设计

### 数据流

```
ChatBlock[]
  → groupCollapsibleToolCalls()    // 纯函数，O(n) 扫描
  → GroupedBlock[]                 // ChatBlock | ToolCallGroup
  → buildBubbleItems()             // 遍历 GroupedBlock[]
  → BubbleItemBase[]
```

### 新增类型（展示层，不侵入 domain/chat/types.ts）

```typescript
type ToolCallGroup = {
  kind: 'tool-call-group'
  id: string        // group-${firstCompletedBlockId}
  blocks: Extract<ChatBlock, { kind: 'tool-call' }>[]  // completed only
}

type GroupedBlock = ChatBlock | ToolCallGroup
```

### 分组算法

```
1. 线性扫描 blocks，检测连续可折叠工具名 → 形成 zone
2. zone 内：completed[] + others[]（各自保持原始相对顺序）
3. completed ≥ 2 → ToolCallGroup；completed < 2 → 单独展示
4. 输出：[ToolCallGroup | 单独 completed] + [others 逐个]
5. 非 zone block 原样输出
```

### Title 格式化

按类别统计 completed 工具，拼接为自然语言：

| 工具 | 格式 |
|------|------|
| Bash, shell_command | Run N shell command(s) |
| Read | Read N file(s) |
| Glob | Find N pattern(s) |
| Grep | Search N pattern(s) |

示例：`"Run 3 shell commands, read 2 files"`

单复数：N=1 时单数，N>1 时加 s。

### 组件结构

```
ToolCallGroupRenderer
├── Think (collapsed by default)
│   ├── icon: ✓ (completed 图标)
│   ├── title: formatGroupTitle(completed blocks)
│   └── children (expanded):
│       ├── ToolCallRenderer (completed[0])
│       ├── ToolCallRenderer (completed[1])
│       └── ...
```

## 文件变更

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `components/chat/groupToolCalls.ts` | 纯函数：Zone 检测 + 分组 |
| 新增 | `components/chat/blocks/ToolCallGroupBlock.tsx` | 组渲染组件 |
| 修改 | `components/chat/buildBubbleItems.tsx` | 调用分组函数，处理 `tool-call-group` |

`ChatContainer` 和 `AgentDrawerContent` 无需改动（都通过 `buildBubbleItems` 自动生效）。

## 性能

- 分组扫描：O(n) 线性，纯函数，无副作用
- SSE 场景：每次 chatBlocks 变化触发 `useMemo` 重算，分组扫描增量极小
- 无额外 DOM：未展开时不渲染内部 ToolCallRenderer
