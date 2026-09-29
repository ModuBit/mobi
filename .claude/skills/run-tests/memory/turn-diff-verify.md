---
name: turn-diff-verify
description: turn-diff 特性 E2E recipe——卡片对表/审查 tab/归档断言全链路步骤与实证坑（hydration 后口径）
metadata:
  type: recipe
last_verified: 2026-09-30
---

# turn-diff 轮次变更卡 + 审查视图验证

## 前置

- **不需要构建二进制**：e2e 环境全程源码直跑（bootstrap `bun run packages/cli/src/index.ts` 起 hub/runner，
  runner spawn 会话 CLI 走 spawnMobiCli 开发模式同样指向 src/index.ts）
- **但进程启动即固化代码**：改 CLI 源码（含封口写侧 turnDiffReporter/turnFulltextStore）后必须
  cleanup + bootstrap 重启环境，再新建会话验证（[[env-bootstrap]] 会话 CLI 代码新鲜度）；
  改 web 源码 vite 热更即生效（保险起见 reload 页面）
- demo 工作区（`/Users/manerfan/workspace/demo`）是 git 仓库且有其他脏文件——
  审查「Unstaged」档会把它们全列出来（真实口径，非 bug）；turn 档只看归档

## 链路步骤

1. bootstrap + 登录（[[env-bootstrap]] [[login]]）→ 新建工作区/会话选 demo，权限模式确认 Auto（[[create-project]] [[create-session]]）
2. 发「用 Write 创建文件 X，内容 N 行」类确定性 prompt → 等 result（[[chat-verify]]）
3. 卡片断言：turn 卡（`Edited N files`）出现在 result 之后；统计来自封口归档；
   subagent 轮（Task 派活）卡片也有统计（hydration sidechain 兜底，修复前是 0/0）
4. **审查入口（2026-09-29 起）**：turn 卡上不再有审核按钮（`payload.git` 恒 null 不渲染）——
   点 header「Open file panel」→ inspector 面板内「Review」按钮（**CDP click uid 可靠**；
   inspector 未展开时先点「Open file panel」，EmptyState 即含 Open File/Terminal/Review 按钮）
5. 审查 tab：`[data-testid="git-review-view"]` + `[data-testid="review-file-row"]`；默认「Last turn」档
   （combobox 非 Segmented，选项 Last turn/Uncommitted/Unstaged/Staged/Commits…，option 用 evaluate click）
6. **diff 断言（pierre 渲染已换 shadow DOM）**：内容在 `<diffs-container>` 的 shadowRoot 里，
   `.cm-line`/`.cm-changedLine` 恒 0（过时断言）——断言用
   `document.querySelector('diffs-container').shadowRoot.textContent` 含期望行内容；
   file row 需展开后才渲染。**展开行必须用 CDP click（take_snapshot 拿 uid）**——evaluate
   `.click()` 对受控 Collapse（activeKey=expandedPaths）不触发 onChange
7. **oversized 行（2026-09-30 起）**：可展开（isDiffable 不再排除），照常拉 patch 渲染真实 diff
   （读侧对带 ref 归档现场合成）；`[data-testid="review-too-big"]` 只在旧归档无 ref 时出现
8. **归档落盘断言**（事实源直读，最可靠）：
   `~workspace/demo/.mobi/turn-diffs/<sessionId>/turn-archive.json` —— wire 形状
   `{turnIndex, baseTurnIndex, sealedAt, files:[{path, kind, additions, deletions, writeCount, toolNames, patch, oversizedPatch, ref?}]}`；
   **滚动单条**（第二轮 seal 后旧 turn 目录被删）；hydration 后同目录有 `<turnIndex>/{a,b}/` 全文目录
   （turn 目录只留最新 1 个）；oversized 条目 `patch:''` + `oversizedPatch:true` + `ref:{after:'b/...'}`；
   patch 头必须无临时路径泄漏（`mobi-review-patch-` / `/var/folders/` / `/tmp/`）

## 实证坑

- **patch 头泄漏临时路径（2026-09-29 修复 ea14b5ae）**：`git diff --no-index` 目录模式下单侧 null
  时 git 把非缺侧路径指到对端目录（add: a 侧路径指 b 目录），剥前缀须按四 token 归位而非
  `a{TMP}/a/`→`a/` 单形态
- **审查 tab 常挂数据陈旧**：antd Tabs 不卸载 tabpane，review 数据靠 running→idle 翻转 refetch 驱动；
  切走再切回档位可强制 refetch
- **会话/runner CLI 进程持有旧代码**：同会话内修复不生效，重启环境 + 新会话才载新源码
- **页面 reload 后 inspector 收起**：review tab 状态不跨刷新，重新「Open file panel」→「Review」
- 主题切换：`localStorage['mobi-ui']` state.theme 改后 reload（prefers-color-scheme emulation 不影响手动主题）
- 窄屏 375px 已知小瑕疵：档位下拉文案截断，功能可用
