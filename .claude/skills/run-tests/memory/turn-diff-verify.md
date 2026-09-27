---
name: turn-diff-verify
description: turn-diff 特性 E2E recipe——卡片对表/审查 tab/删会话清引用全链路步骤与两个实证坑
metadata:
  type: recipe
last_verified: 2026-09-27
---

# turn-diff 轮次变更卡 + 审查视图验证

## 前置

- **不需要构建二进制**：e2e 环境全程源码直跑（bootstrap `bun run packages/cli/src/index.ts` 起 hub/runner，
  runner spawn 会话 CLI 走 spawnMobiCli 开发模式同样指向 src/index.ts）——新代码即时生效
- demo 项目（`/Users/manerfan/workspace/demo`）已是 git 仓库，首轮快照基线 = HEAD 树，
  **会把该目录长期未提交的既有变更全部算进首卡**（52 文件 +6205 是 demo 脏工作区的真实口径，非 bug）

## 链路步骤

1. bootstrap + 登录（[[env-bootstrap]] [[login]]）→ 新建会话选 demo 项目，权限模式确认 Auto（[[create-session]]）
2. 发「用 Write 创建文件 X，内容 N 行」类确定性 prompt → 等 result（[[chat-verify]]）
3. 卡片断言：`document.querySelectorAll('[data-testid="turn-diff-card"]')`；对表：
   `git diff HEAD^{tree} <ref1> --numstat -M` 汇总（files/add/del 三数应与卡一致）
4. 点「审核」：`[data-testid="turn-diff-review"]` 直调 React props onClick（摘要行有冒泡折叠干扰，必须 stopPropagation——组件已内置）
5. 审查 tab：`[data-testid="git-review-view"]` + `[data-testid="review-file-row"]`；
   档位切换点 Segmented 的 `input.click()`；diff 断言看 `.cm-line` / `.cm-changedLine` / `.cm-collapsedLines`
6. untracked 文件 diff 走 no-index（首行 before 空属正常）；二进制文件右栏显示「二进制」提示（.pyc 实证）
7. 删会话清引用：DELETE 前须先 archive（409 active 守卫）→ `git for-each-ref refs/mobi/turn-diffs/<sid>/` 应为 0 条

## 实证坑（均已修复，此处留判读依据）

- **capture 曾因 exclude pathspec 整体报错**：`.gitignore` 忽略 `.mobi/artifacts` 时
  `git add -A -- . ':(exclude).mobi/artifacts'` 直接「Use -f」失败 → 卡静默消失。
  已改 add -A 后 `git rm --cached --ignore-unmatch` 摘除（2b85f334）。诊断入口：仓库 refs 为空 + DB 无 role:custom 行
- **审查 tab 常挂数据陈旧**：antd Tabs 不卸载 tabpane，review 数据靠 running→idle 翻转 refetch 驱动（同 commit）
- 会话 CLI 进程持有旧代码：**同会话内修复不生效**，必须新建会话（新 spawn 才载新源码）
- 主题切换：`localStorage['mobi-ui']` state.theme 改后 reload（prefers-color-scheme emulation 不影响手动主题）
- 窄屏 375px 已知小瑕疵：四档 Segmented 文案截断（上…/未…），功能可用
