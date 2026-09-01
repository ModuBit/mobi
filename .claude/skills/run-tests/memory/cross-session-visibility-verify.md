---
name: cross-session-visibility-verify
description: 跨会话消息可见性（hook 观测+落库+标签）E2E 验证 recipe、SDK emit 判据与 CC 行为坑
metadata:
  type: recipe
  last_verified: 2026-09-01
---

# 跨会话消息可见性验证

特性：CLI 经 SDK 进程内 UserPromptSubmit hook 观测入站跨会话消息，落库 `role=user` + `meta.sentFrom='cli'` + `meta.crossSession={from}` + `meta.turnOrigin`（批次 D：peer/scheduled/loop），web 按 turnOrigin 渲染「📨 来自 xxx」/「⏰ 定时任务」/「🔁 /loop」标签。提前激活（不等首条 web 消息）在 claudeRemote。

## 核心事实：SDK 不 emit peer 到 onMessage（0.3.251 spike 实测 2026-09-01）

launcher onMessage 对普通 user message 会 convert+落库 → **判据：目标会话收到 peer 消息后，DB user 行只有 1 条（hook 落的，sentFrom='cli' 带 crossSession）= SDK 不 emit；出现第 2 条普通 user 行 = emit**。0.3.237 首证、0.3.251 复测均不 emit——hook 是唯一观测点，`SDKUserMessage.origin` 结构化字段在 onMessage 路径拿不到，别试图撤 hook 改读 SDK。

## Recipe（0.3.251 实测全通）

1. bootstrap e2e 环境（env-bootstrap.md）→ 登录 → 建项目（~/workspace/demo）→ 发消息建会话
2. 对话回归：消息→回复正常；DB 断言 user 行仅 1 条（webapp，无重复）
3. **目标会话必须完全空闲**（见坑①）——确认无 Stop 按钮、无审批卡
4. 跨会话全链路：主会话 `ListAgents` 找目标会话名 → `SendMessage` → DB 出现 role=user 行 `meta.sentFrom='cli'` + `meta.crossSession={"from":"..."}` → web 见标签气泡
5. emit 判据（要测 SDK 行为时）：查 DB 该会话 user 行数（见核心事实）

## 坑

- **目标会话不空闲则消息被静默丢弃**（0.3.251 spike 精确复现）：B 回复首条消息时自动调 change_title 卡审批 → 此窗口入站 peer 消息以 `queue-operation: enqueue` 排队（transcript 可见）→ 审批恢复后被 `queue-operation: remove` **丢弃**——不作为 user turn 送达、hook 不触发、不落库。transcript 末尾见 enqueue+remove 即此坑。验证前先批掉目标会话的审批让它真空闲
- **ListAgents 报的 `[短id]` 不是 nativeSessionId**（如 `demo-34 [e9b32a]`）：排查「A 发给了谁」别拿短 id 匹配 sessions.metadata.nativeSessionId；用会话名 + transcript 里的 `<cross-session-message from-name="...">` 确认
- **/tmp/cc-socks 跨 e2e/生产共享**：e2e 会话的 ListAgents 能看到生产会话——SendMessage 目标选错会打到生产会话。认准目标会话名
- web 空文案提交按钮 PlusOutlined 态点击 = 仅 spawn 空会话不发送消息（空会话直接 SendMessage 立即落库+标签+回复，已验证）
- turn 卡审批时 web 无 stop 态（按钮不翻方块）——先看审批卡而非怀疑挂流
- e2e 会话 CLI 是 repo 直跑（bun src/index.ts），claude 二进制在 `node_modules/.bun/@anthropic-ai+claude-agent-sdk-darwin-arm64@<版本>/...`，hook settings 在 `~/.mobi-e2e/tmp/hooks/session-hook-<pid>.json`，验证 `crossSessionInbound: "accept"` 注入看这里
