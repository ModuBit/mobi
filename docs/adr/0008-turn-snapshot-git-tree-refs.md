# 轮次快照 = 用户仓库内的 git tree 快照引用（refs/mobi/turn-diffs）

## Status

accepted（2026-09-27）。turn 文件变更与审查特性（`.scratch/turn-diff/`）的事实源基线。

## 背景

特性需要「某一轮对话改了哪些文件、各增删多少行」的**按轮归因**事实。调研四家实现（ChatGPT asar / ZCode / HAPI 源码 / Claude 官方文档）后的事实：

- **消息流投影**（Edit/Write 工具块聚合）覆盖不到 Bash 写文件与部分 subagent 编辑，且同文件多次编辑的行数累加会高估——归因口径会漂移
- **Claude checkpointing** 只给到锚点的汇总数（filesChanged/insertions/deletions），无 per-file；盲区与投影相同（官方文档明示 Bash 与 subagent 不追踪）
- **ZCode** 用 CLI 侧内容快照（before/after 全文）——准确但要自建存储与冷恢复
- **ChatGPT** 用 turn 边界的 git tree 快照引用（`refs/codex/turn-diffs/captures|checkpoints`）——一份事实同时供给统计真值、last-turn 审查 scope 与撤销，客户端零内容存储

mobi 需要同一份事实供给：轮次变更卡统计、审查视图「上一轮」档位、未来的撤销底座。

## 决定

**CLI 在轮次边界对工作区打 git tree 快照，以引用形式存在用户仓库内：**

- 快照动作：临时 `GIT_INDEX_FILE` 上 `git add -A` + `git write-tree`——不产生 commit、不进入分支历史、不触碰用户暂存区与工作区
- 引用命名：`refs/mobi/turn-diffs/<sessionId>/<n>`（按会话分段，n 递增）——会话归属编码在引用路径里，列举/清理一个会话的快照是一条 `for-each-ref` 命令；对比 Codex 按全局 id 平铺、会话归属放应用层的方案，mobi 选择运维聚合优先
- **轮次变更 = 相邻两快照之差**（`git diff tree₁ tree₂`）：per-file 统计、diff 文本、重命名/新增/删除全部来自这一份事实
- `.mobi/artifacts` 排除在快照外（产物有自己的展示通道）；`add -A` 天然尊重 .gitignore，node_modules 等不入快照
- 非 git 目录不快照，轮次变更退化为工具事件投影的近似口径（`git: null` 显式标记）

## Considered Options

- **CLI 内容快照（ZCode 路线）**：准确，但要自建内容存储、按轮持久化、冷恢复重建；git 对象库已免费提供同等能力（内容寻址去重 + zlib），不重复造
- **纯消息流投影（HAPI Claude 路线）**：零采集成本，但 Bash/subagent 盲区 + 多次编辑高估，与审查视图的 git 真值形成双口径打架
- **checkpoint dryRun 做统计源**：原生零采集，但只有汇总数无 per-file，且需要 resume 通路；保留为未来撤销的底座（`rewindFiles` 语义正合），不承担统计
- **git 影子提交（ZCode 预留方案）**：`commit-tree` + hidden ref，能力等同但比 tree 引用重（多出 commit 对象与可被 `git log --all` 看见的噪音）

## Consequences

- **用户仓库 `.git` 内出现 `refs/mobi/*`**。这是刻意的设计而非污染：引用不进任何 push refspec（永不出本机）、不影响 HEAD/分支/index/工作区；`git gc` 不会回收被引用钉住的对象，但对象是内容寻址去重的压缩字节（每轮增量 ≈ 变更文件内容），泄漏会话仅占静默空间无运行时成本
- **清理责任**：会话删除时清理该会话全部快照引用（`delete-ref` 链）；名字空间集中使孤儿对账（`for-each-ref refs/mobi/` 与会话表比对）成为可能的兜底
- **审查视图「上一轮」档位由快照支撑**，语义是「相邻两轮快照之差」——用户在轮间手改的内容会被如实归入其中一轮，这是归因口径的诚实呈现而非缺陷
- **会话续链**：fork/resume 的会话共享旧快照链，新轮次从最新快照续（fork 基点即分叉时刻的快照）
- **大仓库首快照可能较慢**（未提交改动首次写成 blob 对象）；首版接受，出现真实体感再做 profiling（基准先证体感相关性，见性能纪律）
- 与 Claude checkpointing 并存不冲突：checkpoint 管「回滚到锚点」（二期撤销的底座），轮次快照管「按轮归因与审查」——前者是 SDK 能力，后者是 mobi 事实源
- 本决定即 pending #87「code review 立项时按真实需求重建 git 数据链」的落点；旧 git 链（2026-09-20 删除）依然不参考

## Amendment：审查 v3 供数反转（2026-09-29）

审查 v3 裁决把 turn 档事实源分层，原文「轮次变更 = 相邻两快照之差」从唯一口径**降级为兜底实况源**：

- **归因层（主源）**：turn 内工具层 journal 内容对累积（本会话 Edit 族工具的 before/after 全文对），合成后封口归档（`.mobi/turn-diffs/<sid>/turn-archive.json`），历史轮回看的精确事实源——会话私有，天然免疫并发会话 / 用户手改 / shell 改动的归因污染（Codex TurnDiffTracker / ZCode per-turn 快照同款机制）
- **实况层（兜底）**：相邻快照两树 diff（即原文口径）——累积为空时回落（旧会话 / journal 不可用）；并发场景会把别人的改动归到本轮头上，只作兜底不作主源
- **投影层（末位）**：非 git 且无累积时的工具事件投影（`git: null` 显式标记）

快照链本身不废：它是会话资产（审查 generation、历史兜底、checkpoint 接缝），照常 capture 不断链。供数收敛于 `TurnAttributionProvider`（降级链单点：封口归档 → 快照两树 → journal 补全），`diffTargetResolver` 不再平行解析 turn。

裁决理由：审查视图要的是「这一轮**这个会话**改了什么」的归因口径，快照 diff 给的是「工作区两时点之差」的实况口径。原文 Consequences 里「用户在轮间手改的内容会被如实归入其中一轮，是归因口径的诚实呈现」的辩护，在真实并发场景（多会话同工作区，E2E 实证）下站不住——另一会话的改动会被算进本轮卡片与审查档位，故反转供数而非修正解释。
