# E2E 测试用例：Session Context Bar

> 特性：session detail 页面吊顶上下文信息条
> 测试日期：2026-05-18
> 环境：E2E profile (`e2e`)，token: `e2e-test-token-mobi`

## 测试环境准备

### 测试工作目录

使用独立目录，避免影响现有项目：

```bash
# 创建测试工作目录（必须在 home 下，Hub 安全限制）
mkdir -p ~/workspace/mobi-e2e-test

# 初始化 git 仓库（TC-001 ~ TC-005 需要）
cd ~/workspace/mobi-e2e-test
git init
git commit --allow-empty -m "init"

# 创建裸仓库用于 worktree 测试（TC-005 需要）
mkdir -p ~/workspace/mobi-e2e-worktree-bare
cd ~/workspace/mobi-e2e-worktree-bare
git init --bare
cd ~/workspace/mobi-e2e-test
git remote add wt-origin ~/workspace/mobi-e2e-worktree-bare
git push wt-origin HEAD
```

### 清理

测试完成后清理：

```bash
rm -rf ~/workspace/mobi-e2e-test
rm -rf ~/workspace/mobi-e2e-nogit
rm -rf ~/workspace/mobi-e2e-worktree-bare
rm -rf ~/workspace/mobi-e2e-longname
```

---

## 前置条件

所有 TC 共享以下前置步骤：

1. 启动 E2E 环境：`bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh`
2. 浏览器登录 `http://localhost:5175`，使用 token `e2e-test-token-mobi`
3. 确认到达 `/sessions` 页面

---

## TC-001：Git 仓库 — 显示 workdir + 分支信息

**目标**：验证在 git 管理的目录创建 session 时，吊顶条显示 workdir 和 branch 标签

**前置**：测试目录 `~/workspace/mobi-e2e-test` 已 `git init` 且有初始提交

**步骤**：
1. 点击"新建会话"
2. 选择机器
3. 输入工作目录：`~/workspace/mobi-e2e-test`
4. 点击"创建会话"，等待进入 session detail
5. 观察 header 下方的 SessionContextBar

**预期**：
- 吊顶条出现，显示 📁 路径标签（内容包含 `mobi-e2e-test`）
- 显示 🌿 branch 标签（内容为当前分支名，如 `main` 或 `master`）
- 不显示 🌳 worktree 标签
- 约 3 秒后自动收起为紧凑模式（path + branch 标签仍可见，padding 缩小）

**验证方式**：`take_snapshot` 检查页面元素

---

## TC-002：非 Git 目录 — 仅显示 workdir

**目标**：验证在非 git 管理的目录创建 session 时，吊顶条仍显示 workdir

**前置**：创建一个无 git 的测试目录

```bash
mkdir -p ~/workspace/mobi-e2e-nogit
```

**步骤**：
1. 点击"新建会话"
2. 选择机器
3. 输入工作目录：`~/workspace/mobi-e2e-nogit`
4. 点击"创建会话"，等待进入 session detail
5. 观察 header 下方的 SessionContextBar

**预期**：
- 吊顶条出现，显示 📁 路径标签（内容包含 `mobi-e2e-nogit`）
- 不显示 🌿 branch 标签
- 不显示 🌳 worktree 标签
- 展开/收起交互正常（hover/tap）

**验证方式**：`take_snapshot` 检查路径标签存在

---

## TC-003：展开/收起交互 — 桌面端 hover

**目标**：验证桌面端 hover 展开/收起行为

**前置**：浏览器窗口宽度 ≥ 768px，已完成 TC-001（处于 session detail 页面）

**步骤**：
1. 等待约 3 秒，观察吊顶条自动收起（padding 缩小）
2. 鼠标 hover 到吊顶条区域
3. 观察吊顶条恢复展开（padding 恢复）
4. 鼠标移开吊顶条区域
5. 等待约 3 秒，观察吊顶条再次收起

**预期**：
- 收起后标签仍可见，padding 变小
- Hover 时 padding 恢复，视觉效果更宽松
- 移开后延迟收起

**验证方式**：`take_snapshot` 在每个状态节点检查

---

## TC-004：展开/收起交互 — 移动端 tap

**目标**：验证移动端 tap 切换展开/收起行为

**前置**：浏览器窗口宽度 < 768px（用 `resize_page` 设置为 375×667），已完成 TC-001

**步骤**：
1. 等待约 3 秒，观察吊顶条自动收起
2. Tap 点击吊顶条
3. 观察吊顶条展开
4. 再次 Tap 点击吊顶条
5. 观察吊顶条收起

**预期**：
- 移动端收起态标签有 ellipsis 截断（长路径被截断）
- Tap 切换为展开态，显示完整信息
- 再次 Tap 切回收起态

**验证方式**：`take_snapshot` + `take_screenshot`

---

## TC-005：Worktree — 显示 worktree 标签

**目标**：验证在 worktree 模式下创建 session 时，显示 worktree 标签

**前置**：测试目录 `~/workspace/mobi-e2e-test` 已有 git 仓库和 remote

**步骤**：
1. 点击"新建会话"
2. 选择机器
3. 输入工作目录：`~/workspace/mobi-e2e-test`
4. 切换 session 类型为 "Worktree"
5. 输入 worktree 名称：`e2e-test-wt`
6. 点击"创建会话"，等待进入 session detail
7. 观察吊顶条

**预期**：
- 显示 📁 路径标签
- 显示 🌿 branch 标签
- 显示 🌳 worktree 标签（内容为 `e2e-test-wt`）
- 展开/收起交互正常

**验证方式**：`take_snapshot` 检查 worktree 标签文本

---

## TC-006：切换 session — 信息条更新

**目标**：验证在多个 session 之间切换时，信息条正确更新

**前置**：已创建 TC-001 的 session（git 仓库目录）和 TC-002 的 session（非 git 目录）

**步骤**：
1. 返回 session 列表
2. 点击 TC-001 的 session（git 仓库）→ 进入 detail
3. 观察吊顶条显示 workdir + branch 信息
4. 返回 session 列表
5. 点击 TC-002 的 session（非 git 目录）→ 进入 detail
6. 观察吊顶条仅显示 workdir，无 branch

**预期**：
- Git 仓库 session 显示 workdir + branch
- 非 git 目录 session 仅显示 workdir
- 切换无残留（不会显示上一个 session 的信息）

**验证方式**：`take_snapshot` 对比两个 session detail 页面

---

## TC-007：长路径/长分支名 — ellipsis 截断

**目标**：验证长文本在标签中的 ellipsis 处理

**前置**：创建一个长分支名的测试目录

```bash
mkdir -p ~/workspace/mobi-e2e-longname
cd ~/workspace/mobi-e2e-longname
git init
git commit --allow-empty -m "init"
git checkout -b feature/this-is-a-very-long-branch-name-for-testing-ellipsis
```

**步骤**：
1. 在 `~/workspace/mobi-e2e-longname` 创建新 session
2. 观察吊顶条收起态
3. 将浏览器窗口缩窄（`resize_page` 375×667）
4. 观察收起态标签截断效果

**预期**：
- 收起态 path 标签在窄屏下被 ellipsis 截断
- branch 标签也可能被截断
- 布局不溢出、不破坏页面结构
- 展开/hover 后信息完整

**清理**：`rm -rf ~/workspace/mobi-e2e-longname`

**验证方式**：`take_screenshot` 对比桌面端和移动端

---

## 测试矩阵

| TC | 场景 | 核心验证点 | 优先级 |
|----|------|-----------|--------|
| TC-001 | Git 仓库 session | workdir + branch 标签 + 自动收起 | P0 |
| TC-002 | 非 Git 目录 session | 仅显示 workdir | P0 |
| TC-003 | 桌面端 hover | 展开/收起交互 | P1 |
| TC-004 | 移动端 tap | 展开/收起交互 | P1 |
| TC-005 | Worktree session | worktree 标签显示 | P1 |
| TC-006 | 切换 session | 信息条正确更新 | P0 |
| TC-007 | 长文本截断 | ellipsis 布局 | P2 |
