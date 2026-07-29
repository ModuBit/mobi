---
name: chat-verify
description: 对话交互 / 等待轮询 / 权限审批 / 渲染验证
metadata:
  type: recipe
  last_verified: 2026-07-29
---

# 对话与验证

## 步骤

1. 聊天输入框发消息（[[input-box]] 规范，可带 `submitKey: Enter` 提交）
2. 等待 Claude 思考回复：`take_snapshot` 每 2-3s 轮询
3. 遇权限请求 → 浏览器点「允许」/「本次会话允许」
4. 验证渲染：`take_snapshot`（优先，查组件存在与状态）/ `take_screenshot`（视觉效果）

## 坑

- **不用 `wait_for`** — 文本匹配不可靠；用 `take_snapshot` 轮询
- **等待不要急** — Claude 处理需时间，2-3s 轮询
- **i18n JSON 改动 HMR 不生效** — `navigate_page` 刷新页面（注意 reload 偶发丢 page，见 [[browser-connect]]）
- **诊断数据缺失回到代码排查** — 不要用 `evaluate_script` 注入数据或绕过 UI；数据没出现说明代码有问题
