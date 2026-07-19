# Issue tracker: Local Markdown

本仓库的 issue 与 spec 以 markdown 文件形式追踪。高层 backlog 在 `docs/pending.md`，特性级工作在 `.scratch/`。

## Conventions

- 高层 backlog：`docs/pending.md` — 跨特性的待处理项总览
- 一个特性一个目录：`.scratch/<feature-slug>/`
- spec 文件：`.scratch/<feature-slug>/spec.md`
- 实现 issue 一个 ticket 一个文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号 — 永不合并成单个 tickets 文件
- Triage 状态记在 issue 文件顶部的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 讨论历史追加到文件底部 `## Comments` 段落下

## When a skill says "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下新建文件（必要时创建目录）。若属于跨特性高层项，记入 `docs/pending.md`。

## When a skill says "fetch the relevant ticket"

读取引用路径的文件。用户通常会直接传路径或 issue 编号。

## Wayfinding operations

供 `/wayfinder` 使用。**map** 是一个文件，每个 ticket 对应一个 **child** 文件。

- **Map**: `.scratch/<effort>/map.md` — Notes / Decisions-so-far / Fog body。
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，问题写在 body。`Type:` 行记录 ticket 类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **Blocking**: 文件顶部 `Blocked by: NN, NN` 行。所列文件全部 `resolved` 时该 ticket 解除阻塞。
- **Frontier**: 扫描 `.scratch/<effort>/issues/` 中 open、unblocked、unclaimed 的文件；编号小者优先。
- **Claim**: 工作前先设 `Status: claimed` 并保存。
- **Resolve**: 在 `## Answer` 段落下附上答案，设 `Status: resolved`，然后把上下文指针（gist + 链接）追加到 `map.md` 的 Decisions-so-far。
