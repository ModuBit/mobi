# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。

字段：功能名 / 出处 / 对 mobi 的价值 / 建议落地位置 / 优先级 / 状态 + 来源版本区间。采纳后立项跟进在 `docs/pending.md`，终态后回写此处状态。

---

## 2026-10-09 升级挖掘（来源：agent-sdk 0.3.284~0.3.295 / CC 2.1.284~2.1.295）

> ⚠️ 前置：0.3.295 存在首条消息管线回归（pending #108），SDK 钉死 0.3.283——下列条目在回归修复升级后方可落地。

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `background_tasks_changed` 条目新增 `subagent_type` | SDK 0.3.293 | 任务面板直接区分 subagent 类型，免与 `task_started` 配对拼接 | `claudeRemoteLauncher.ts` 后台任务集合 → web TaskPanel | 中 | 待升级 |
| 子代理消息 `agent_id` + task 事件 `parent_task_id`/`run_id` | SDK 0.3.292 | agent drawer 消息归属链（子代理消息 ↔ 任务）、resume 后区分同一任务的多次 run | `claudeRemote.ts` 消息/任务事件消费 → AgentDrawer | 中 | 待升级 |
| SendMessage `tool_use` 输入新增 `recipient_kind`、`approve` 恒为 boolean | SDK 0.3.292 | 跨会话投递卡片免从 raw input 猜收件人类型 | ToolCallBlock（SendMessage 工具卡） | 低 | 待升级 |
| result 新增 remote-session 延迟字段（`first_text_post_queue_wait_ms` 等） | SDK 0.3.287 | StatusBar 轮次计时可区分「排队等待」与「生成」两段 | `claudeRemote.ts` result 消费 → StatusBar | 低 | 待升级 |
