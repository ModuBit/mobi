# 自定义消息：role 新增 'custom'，content 用统一 block 词汇表组合表达

## Status

accepted（2026-09-07）。ref block 设计部分被 [ADR 0003](0003-mobi-uri-action-protocol.md) 取代（2026-09-07）：mobi URI 动作链接成为内部动作唯一权威编码，ref block 从词汇表删除，词汇收缩为 text/image/document/quote。

## 背景

分叉会话特性需要在时间线里持久化一条 hub 生成（非 CC 上报）的溯源消息「fork 自会话 xxx」。这是第一类「自定义消息」，预期后续还有多种富 UI 载荷（内嵌网页、文件卡片、操作留档等）。设计过程两次纠偏，最终定型为**通用组合模型**而非逐场景加类型：

- 第一稿按业务造类型（`fork-source` 专用 schema）——否，每来一个场景构造一个新类型不可持续
- 第二稿 `note` 类型自带私有 segments——否，仍是特化思路，只是把特化藏进了类型内部
- 定稿：**block 词汇表 + 组合**，新需求靠组合现有词汇表达

现有消息模型的相关字段语义：

- `category`（`'discard' | 'ephemeral' | 'persistent'`）：CLI 对 **CC 消息流**的黑名单分类，回答「怎么处置」
- 信封 `role`（松散 string，实测 `'user' | 'agent'`）：**来源维度**——`'user'` 是 mobi 构造的用户消息，`'agent'` 是 CC 返回的原始消息
- 用户消息已有 block schema（`shared/userContentSchema.ts`，AG-UI 对齐四型 union：text/image/document/quote）

## 决定

**1. 来源三足鼎立**：role 新增 `'custom'`（mobi 注入），与 user/agent 并列。

**2. content = 统一 block 词汇表的组合**，与用户消息三形态同构（`string | block | block[]`）：

```ts
// shared 唯一词汇表（userContentSchema 四型并入泛化，跨来源共享）
const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('ref'), targetType: z.string(), id: z.string() }),  // 实体引用，可跳转
  z.object({ type: z.literal('image'), source: ..., /* 文件引用字段 */ }),
  z.object({ type: z.literal('document'), source: ..., /* 文件引用字段 */ }),
  z.object({ type: z.literal('quote'), messageId, role, excerpt }),              // 已有
])
```

fork 溯源消息 = `text("fork 自会话 ") + ref(targetType:'session')` 的组合，零专用类型。

**3. 两个通用机制**（保证「不来一个构造一个新的」）：

- **组合优先纪律**：新渲染需求先问「现有 block 能否组合」；不能才加 block 类型——加的是词汇，不是业务类型分支
- **`ref.targetType` 受控开放注册**：`session` 先行，未来 `file` / `message` / `project` 只是注册新 targetType + 渲染器，schema 结构永不动。消费方按 role 决定接受子集（user 输入拒绝 `ref`，防伪造跳转；custom 可用全词汇）

unknown block 统一跳过不渲染，词汇表演化向后兼容免费获得。

## Considered Options

- **逐业务建类型**（`fork-source` 等）：每次扩场景都要动 schema + 三端分发，正是要治理的「来一个构造一个」
- **`note` 类型 + 私有 segments**：特化藏进类型内部，.segments 词汇与全局 block 词汇表割裂
- **role 沿用 `'agent'`**：自定义消息会静默流进所有消费 `role==='agent'` 的现有路径（摘要、预览、标题生成等）；新 role 值让遗漏显式暴露
- **role 新增 `'system'`**：借 LLM API 对话角色语义，但 mobi 的 role 是来源标签；「系统样展示」现状由 web 归一化层驱动（compact/错误消息即如此），role 加值无判别收益
- **category 加 `'custom'` 值**：把「来源」和「处置」挤进一个字段；「ephemeral 的自定义消息」无法表达
- **AG-UI 全量协议迁移**（信封对齐 BaseMessage、消息全转 AG-UI Message/Event）：见 pending #70 治理结论——不可行且有损（mobi 消息是 CC 原始结构的持久化镜像，native 锚点/parentUuid/tool 嵌套/权限卡片等 AG-UI 模型没有；mobi 前后端自闭环无互操作收益），采纳的是 **schema 层对齐**（block 词汇表、role 语义、Message/Event 二分思想）

## Consequences

- 自定义消息落 `persistent` 自动获得正确处置：落库、不排队、查询/分页/SSE 走现有通道零改动
- 现有消费 `role==='agent'` 的路径（摘要/预览/标题）自动免疫
- `userContentSchema.ts` 的四型并入统一词汇表是后续消息治理（pending #70）的第一块基石；归一化函数（`normalizeUserContent` 模式）泛化为跨来源共用
- web 渲染按 role 分流（user 输入通道 / custom 通道），block → renderer 按 block.type + ref.targetType 两级注册
- hub 直写消息（无 localId）不参与 localId 去重，seq 正常分配
- 首个消费方：分叉会话溯源消息（spec：`.scratch/fork-session/SPEC.md`）；「已回退至此」等前端态提示未来可迁为 custom 消息
