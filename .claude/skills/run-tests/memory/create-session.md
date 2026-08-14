---
name: create-session
description: 创建会话 — 项目即环境（可搜索下拉选项目 / 下拉底部新建项目 / 发消息即建）
metadata:
  type: recipe
  last_verified: 2026-08-14
---

# 创建会话（项目即环境）

2026-08-14 起：新建会话**必须选项目**，机器与工作目录从项目派生（primary folder），
不再有机器选择器和目录输入框（PathCascader 已删除，web 暂不支持创建游离会话）。

## 步骤

1. 进入 `/sessions/new`（侧边栏 New Chat / 项目组「+」 / Logo 点击均可）
2. 项目下拉（placeholder "Search and select a project"）可搜索按名称过滤
3. 选中项目 → 下拉下方出现只读回显行（`机器名 · ~/主目录`），消息框从 disabled 变 enabled = gate 通过
4. 消息框发首条消息即创建会话（无独立「创建」按钮）

## 无项目时

下拉底部固定「+ New Project」按钮 → 打开新建项目 Modal → 创建完成后**自动回填选中**
（无需手动再选），机器/目录随项目派生。见 [[create-project]]。

## URL 预选

`/sessions/new?projectId=<id>`（项目组「+」入口）：projects 缓存就绪后自动选中，
Sender 即刻可用。`?cwd=` 已从路由移除。

## 坑

- 目录由项目 primary folder 决定，无手输；folders 真实性由 hub 校验
- 输入操作通用规范见 [[input-box]]
