# runtimeState 投影保持命令式 fold，否决注册表化

## Status

accepted（2026-10-22）

## 背景

`SessionMessageRuntimeProjector.project()`（`packages/daemon/src/sync/sessionMessageRuntimeProjector.ts`）从持久化消息内容派生 `runtimeState` 摘要字段（todos / tasks / teamState / backgroundTasks / foregroundTasks / goalStatus 等）。2026-10-22 mods-goal-channel 票 03 给它加 goal 投影时，需要在三处动刀：调用提取器、无变化短路条件加一个子句、apply 段加一段写入。架构审查（goal 通道专项）据此提出候选：把投影收口为注册表——每条规则 `extract(content, …) → patch | null`，`project()` 统一收集合并，短路自动推导，新增投影降为一处接线。

审查当时标为 Speculative。本 ADR 记录复审后的否决理由，防止后续架构审查把同一候选反复捞出。

## 决定

**`project()` 保持命令式 fold（提取 → 侧状态喂养 → 逐字段 apply），不引入注册表。** 原因有二，均承重：

### 1. 提取器有四种互不兼容的形状类，统一 interface 必然 shallow

| 形状类 | 成员 | interface 需求 |
|---|---|---|
| 纯函数 content→patch | goal、todos | `(content)` |
| 需现值 | team 系、foreground apply | `(content, existing)` |
| 需跨消息累加器 | task deltas、background deltas | `(content, pendingTaskMap, 多个 Set)` |
| 纯侧状态喂养 | collectBackgroundToolUseIds、taskStartedInfo 缓存 | 无投影产出，只喂后续提取 |

注册表的规则 interface 必须是四类的并集——interface 与 implementation 一样宽，正是 shallow module 的定义。deep 的收益（callers/testers 每学一单位 interface 换多少行为）在这里为负。

### 2. apply 段不是样板，是领域本身

提取之后、写回之前的 apply 段承载着真实的跨投影顺序契约：

- **team delete 级联到 tasks**：删 team 时把该 team 名下未完成任务标 completed；
- **新建 task 依赖先更新的 teamState**（取 teamName，代码注释明写「team 必须先更新」）；
- **任务中途转后台**要读**同一轮刚算出的** foregroundChanged（`foregroundChanged ?? existing` 的取值顺序）。

注册表模型的统一 merge 要么破坏这些顺序契约，要么退化成有序 fold + 共享可变 working state——即把现有命令式代码包一层列表，extract 与 apply 被迫合体后「提取是纯函数」的故事对后三类形状不成立，locality 反而更差。

### 辅助证据：演进频率不支持摊销

git 历史（`--follow` 该文件）显示投影级**新增**稀疏（goal 之前上一个新投影是 foreground-tasks 票 01），近期提交全部是**既有投影内部**的修复。三处接线的成本被稀疏的新增摊薄，而高频发生的修复恰恰受益于「提取逻辑与 apply 就近」的现状布局。

## Considered Options

- **注册表化（extract → patch，统一收集合并）**：见决定 §1 §2，interface 并集宽、apply 领域装不进统一 merge。
- **有序 fold 注册表（rule.apply(working, content, state) 原地改 working）**：能保顺序契约，但只是把现有代码换个宿主，多一层 indirection，无 depth 收益。
- **仅抽 apply 段为各域的 applyXxx 函数**（如 applyGoalProjection）：goal 的 apply 只有 8 行且含删字段语义，抽出去是 pass-through，deletion test 不过。
- **维持现状（本 ADR 的选择）**：三处接线是有界、机械的成本；换来的 locality（一处看全顺序契约）与最低的修复摩擦。

## Consequences

- 新增投影继续按「调提取器 + 短路条件加子句 + apply 段加一段」三处接线，接受为有界成本。
- **重启条件**：当第 9/10 个新投影出现、且提取器形状类收敛到 ≤2（比如侧状态喂养被 transcript tap 类通道取代、累加器类迁入独立 tracker）时，重开此决策——届时注册表的 interface 能缩到真正 deep。
- 架构审查不再把「projector 注册表化」列为候选；引用本 ADR 即可。
