---
name: worktree-verify
description: worktree 生命周期 E2E — worktree 会话创建 / 合回 no-ff 与 squash / 脏保留 toast / 设置页丢弃 / 冲突诚实失败
metadata:
  type: recipe
  last_verified: 2026-10-25
---

# worktree 生命周期验证（worktree-lifecycle 票 06 实战）

## 环境与素材

- 不要用 `~/workspace/demo` 做合回素材：它本身有未提交改动，merge-back 前置闸会按
  `main-dirty` 拒绝。另建**干净专用仓库**：
  ```bash
  mkdir -p ~/workspace/wt-e2e && cd ~/workspace/wt-e2e && git init -q
  printf '# wt-e2e\n' > README.md && printf 'base line\n' > conflict.txt
  git add . && git -c user.name=E2E -c user.email=e2e@local commit -qm init
  ```
- E2E 工作区 folder 指向该仓库（新建工作区对话框 folder combobox 必须 snapshot-uid click 后 type_text，
  见 [[create-project]]）。
- 合回后 worktree 目录在 `<repoParent>/<repoName>-worktrees/<name>`（`~/workspace/wt-e2e-worktrees/…`）。

## 建 worktree 会话

1. `/sessions/new?workspaceId=<id>` → 权限模式先确认「自动审批」（localStorage 会残留上次的档位）
2. 会话类型分段控件是 antd Segmented（a11y 快照里有 radio，但 DOM 里 `[role=radio]` 查不到）：
   ```js
   Array.from(document.querySelectorAll('label.ant-segmented-item'))
     .filter(l => l.textContent.trim() === 'Worktree' && l.offsetParent !== null)[0]
     .querySelector('input').click()
   ```
   名称输入框用原生 setter + input 事件（React 受控）：
   `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'feat-a'); input.dispatchEvent(new Event('input',{bubbles:true}))`
3. 首条消息即创建会话；让 agent 改文件的 prompt 要显式「不要执行任何 git 命令，不要提交」
   （否则它可能自己 commit，脏判定就测不到）。

## 关键语义：active 会话的 worktree 视为「运行中」，不可合回

列表接口的 running 判定是 **active（CLI 进程在）或 running（轮次进行中）**——轮次结束后
会话仍 active，吊顶弹层会显示「运行中，暂不可合回」。合回前必须先**休眠**：

- 行内 `button[title="更多"]` 用 `pointerdown`（`{button:0,buttons:1,pointerType:'mouse',bubbles:true}`
  + pointerup）打开 uiarc 菜单；`.click()` 对 hover 隐藏按钮不可靠
- 菜单项「休眠」→ 等 `/api/sessions` 里 `active=false`
- **休眠后列表缓存仍是旧值**：`useWorktrees` staleTime 5s 且无轮询，吊顶会继续显示「运行中/0 个改动」。
  验证前 `navigate_page reload`（重新挂载才 fetch）——不是产品 bug，是缓存语义。

## 场景 ① 合回（no-ff / squash）

1. 吊顶 `[data-testid="worktree-badge"]` → 弹层「合回主仓库」→ Modal（默认 no-ff，目标 = 主仓库当前分支）
2. 确认后断言（全部在仓库里，不要只看 UI）：
   ```bash
   git -C ~/workspace/wt-e2e log --oneline --graph -5      # no-ff：Merge 提交 + WIP 提交
   git -C ~/workspace/wt-e2e log -1 <merge> --pretty=%P    # 两个父提交
   ls ~/workspace/wt-e2e-worktrees/                        # 目录已消失
   git -C ~/workspace/wt-e2e branch                        # 只剩 main
   cat ~/workspace/wt-e2e/e2e-feature.txt                  # 内容已落主仓库
   ```
   squash：HEAD message `mobi worktree <name>: squash merge`，**单父提交**，无 merge 提交
3. 成功反馈必须持续可见（「已合回主仓库 / worktree 已移除；分支已删除」+ 仅「关闭」按钮）——
   这正是票 04 修过的坑：列表刷新把 summary 变 null 会重置弹窗状态。

## 场景 ② 脏保留 → 会话删除 toast → 设置页丢弃

1. worktree 里留一个**未提交**文件（agent 创建且不提交；或确认脏判定 `git status --porcelain`）
2. 休眠 → 行菜单「删除」→ 确认 → 弹 antd notification：
   「工作树已保留 / 「<name>」有 N 个未提交改动…」+「去设置处理」
3. 点「去设置处理」→ `/settings/worktrees`。**toast 只活 8s，且退场动画期间点击无效**——
   删除确认后要在 1-2s 内点；超时窗口重跑一次完整链路，别断言「跳转坏了」
4. 设置页行内「丢弃」→ 二次确认文案含脏文件数 → 确认 → message「worktree 已丢弃」，
   `ls ~/workspace/wt-e2e-worktrees/` 空、`git branch` 无 `mobi-<name>`

## 场景 ③ 冲突诚实失败

1. worktree 会话改 `conflict.txt`（不提交）
2. **主仓库**提交同一文件的另一版本（`git commit`），保持主树 clean（否则先命中 main-dirty）
3. 休眠 → 合回 → 弹窗出现「合回冲突，已回滚」+ 冲突文件清单；按钮仍是 取消/合回（可重试）
4. 断言：主仓库文件仍是主分支版本、`.git/MERGE_HEAD` 不存在、`git log` 未变；
   worktree 目录与分支保留，分支上多一条 `WIP: mobi <name> pre-merge`

## 双档 / 移动端

- 主题默认 dark（uiStore 初始 theme='dark'）：先验 dark，再从侧栏「设置」菜单切「浅色模式」
  （菜单同样要 pointerdown），切完等 500ms 再截图
- 移动端 `resize_page(390x844)` 后设置页与合回 Modal 均可用（Modal 宽度 clamp 到视口）；
  吊顶弹层 `[data-mobi-popover]` 宽度 min(320, 100vw-32)，不溢出

## 坑速记

- 菜单/分段控件用指针事件或原生 input click，不要指望 a11y uid click
- 合回/丢弃都会让列表缓存失效；断言 UI 前先确认数据源已刷新
- `.mobi/` 目录出现在 worktree 里是 mobi 自产状态，脏判定已排除，不算脏文件
