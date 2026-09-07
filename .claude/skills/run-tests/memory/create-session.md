---
name: create-session
description: 创建会话 — 项目即环境（可搜索下拉选项目 / 下拉底部新建项目 / 发消息即建 / 权限模式显式选 auto）
metadata:
  type: recipe
  last_verified: 2026-09-06
---

# 创建会话（项目即环境）

2026-08-14 起：新建会话**必须选项目**，机器与工作目录从项目派生（primary folder），
不再有机器选择器和目录输入框（PathCascader 已删除，web 暂不支持创建游离会话）。

## 步骤

1. 进入 `/sessions/new`（侧边栏 New Chat / 项目组「+」 / Logo 点击均可）
2. 项目下拉（placeholder "Search and select a project"）可搜索按名称过滤
3. 选中项目 → 下拉下方出现只读回显行（`机器名 · ~/主目录`），消息框从 disabled 变 enabled = gate 通过
4. **检查权限模式下拉（Sender 左下角），非 auto 则显式切回 Auto**——见下方「权限模式残留」
5. 消息框发首条消息即创建会话（无独立「创建」按钮）

## 权限模式残留（2026-09-06）

权限模式偏好存 Chrome profile 的 localStorage（`savePreferredPermissionMode`），
且**会被跨次 E2E 残留**：跑过 [[plan-mode-verify]] 类用例后（切到 plan 会 save），
之后每次创建会话都默认 plan——不是产品默认值问题（`loadPreferredPermissionMode`
无偏好时返回 auto）。所以创建会话前一律显式确认/选 Auto；需要弹审批/plan 的
用例（[[plan-mode-verify]]、审批链路验证）再显式切到对应模式。

操作：Sender 权限模式下拉（a11y snapshot 中 combobox，当前值文案如 "Plan Mode"）
→ snapshot 拿 uid click → listbox option 文本匹配 "Auto" → evaluate click 或 uid click。

## 无项目时

下拉底部固定「+ New Project」按钮 → 打开新建项目 Modal → 创建完成后**自动回填选中**
（无需手动再选），机器/目录随项目派生。见 [[create-project]]。

## URL 预选

`/sessions/new?projectId=<id>`（项目组「+」入口）：projects 缓存就绪后自动选中，
Sender 即刻可用。`?cwd=` 已从路由移除。

## 坑

- 目录由项目 primary folder 决定，无手输；folders 真实性由 hub 校验
- 权限模式残留（见上）：会话进 plan 的第一嫌疑，先查下拉当前值再排查代码
- 输入操作通用规范见 [[input-box]]

