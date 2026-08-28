---
name: cross-session-visibility-verify
description: 跨会话消息可见性（hook 观测+落库+标签）E2E 验证 recipe 与 CC 行为坑
metadata:
  type: recipe
  last_verified: 2026-08-29
---

# 跨会话消息可见性验证

特性：CLI 经 SDK 进程内 UserPromptSubmit hook 观测入站跨会话消息，落库 `meta.crossSession={from}`，web 渲染「📨 来自 xxx」标签。提前激活（不等首条 web 消息）在 claudeRemote。

## Recipe（2026-08-29 实测全通）

1. bootstrap e2e 环境（env-bootstrap.md）→ 登录 → 建项目（~/workspace/demo）→ 发消息建会话
2. 对话回归：消息→回复正常；DB 断言 user 行仅 1 条（webapp，无重复）
3. 首条特殊命令：新会话首条 `!echo xxx` → 本地执行出 tool_use/tool_result 对（isBashInitial 路径）
4. 跨会话全链路：主会话 `ListAgents` 找到 e2e 会话名（如 demo-f4）→ `SendMessage` → DB 出现 role=user 行带 `meta.crossSession={"from":"mobi-ab"}` → web 截图见「📨 来自 mobi-ab」气泡

## 坑

- **审批等待窗口入站消息被 CC 丢弃**：turn 卡权限审批时入站的跨会话消息以 `queued_command` attachment 排队，审批恢复后被 `queue-operation: remove` 丢弃——**不作为 user turn 送达、hook 不触发、不落库**（CC 内部行为，非本特性 bug）。验证须在会话空闲态发送
- **web 可不填消息直接创建空会话**——「未 prompt 会话」场景在 E2E 可覆盖：`/sessions/new?projectId=` 选定项目后，空文案时提交按钮呈 PlusOutlined 态，点击即**仅 spawn 会话不发送消息**（NewSessionPage.handleSubmit：spawnSession 先行，`if (currentText || attachments)` 才发消息）。2026-08-29 已 E2E 验证：空会话（0 消息）直接 SendMessage → 入站消息立即落库（crossSession meta）+ web 显示标签 + 助手回复正常——提前激活全链路生效，无需真机
- **审批等待窗口入站消息被 CC 丢弃**：turn 卡权限审批时入站的跨会话消息以 `queued_command` attachment 排队，审批恢复后被 `queue-operation: remove` 丢弃——**不作为 user turn 送达、hook 不触发、不落库**（CC 内部行为，非本特性 bug）。验证须在会话空闲态发送
- turn 卡审批时 web 无 stop 态（按钮不翻方块）——先看审批卡而非怀疑挂流
- turn 卡审批时 web 无 stop 态（按钮不翻方块）——先看审批卡而非怀疑挂流
- e2e 会话 CLI 是 repo 直跑（bun src/index.ts），claude 二进制在 `node_modules/.bun/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.250/...`，hook settings 在 `~/.mobi-e2e/tmp/hooks/session-hook-<pid>.json`，验证 `crossSessionInbound: "accept"` 注入看这里
