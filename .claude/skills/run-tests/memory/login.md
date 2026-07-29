---
name: login
description: E2E 登录 — token 输入框 + Connect 按钮提交、验证跳转
metadata:
  type: recipe
  last_verified: 2026-07-29
---

# 登录

## 步骤

1. `new_page` 打开 `http://localhost:5175` → 自动跳 `/login`
2. `click` Access Token 输入框（聚焦）
3. `press_key Control+A`（清空，空也执行稳妥）
4. `type_text` 输入 `e2e-test-token-mobi`（**不带 `submitKey`**）
5. `click` "Connect" 按钮提交（**显式点按钮，不依赖 Enter**）
6. 验证：`take_snapshot` 确认 URL 变 `/sessions/new`（或 `/sessions`）

## 验证就绪

Connect 变 loading 后通常 1-2s 跳转；卡 loading >5s → `list_network_requests` 看 `POST /api/auth` 是否 `ERR_CONNECTION_REFUSED`（proxy env 问题，见 [[env-bootstrap]]）。

## 坑

- **禁用 `fill`** — 对自定义输入框常超时失败
- **不靠 Enter 提交** — Enter 在自定义输入框不触发提交，必须 click "Connect"
- 输入操作通用规范见 [[input-box]]
