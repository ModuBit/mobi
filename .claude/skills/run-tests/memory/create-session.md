---
name: create-session
description: 创建会话 — 新建 / 选机器 / 工作目录
metadata:
  type: recipe
  last_verified: 2026-07-29
---

# 创建会话

## 步骤

1. 点击「新建会话」
2. 选择机器（点击下拉列表选择）
3. 输入工作目录（**必须 home 目录下**，如 `/Users/<user>/workspace/demo`）
4. 点击「创建会话」

## 坑

- **工作目录限制** — 只能选 home 目录下路径（Hub 安全限制），`/tmp` 等不在 home 下的路径会被 403 拒绝
- 输入路径用 [[input-box]] 规范操作
