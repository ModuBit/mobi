---
name: input-box
description: 自定义输入框通用操作规范（登录 token / 聊天框共用）
metadata:
  type: recipe
  last_verified: 2026-07-29
---

# 自定义输入框操作

mobi 的输入框（登录 token、聊天框）多为自定义组件，标准三步走：

## 标准步骤

1. `click` 目标输入框（聚焦）
2. `press_key Control+A`（全选清空已有内容）
3. `type_text` 输入新内容

## 坑

- **不用 `fill`** — 对自定义输入框常超时失败
- **不直接 `type_text` 不全选** — 会追加而非替换，内容重复
- **提交差异** — 聊天框可 `type_text` 带 `submitKey: Enter` 提交；登录框 Enter 无效，见 [[login]]
