# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。

字段：功能名 / 出处 / 对 mobi 的价值 / 建议落地位置 / 优先级 / 状态 + 来源版本区间。采纳后立项跟进在 `docs/pending.md`，终态后回写此处状态。

---

## 2026-10-09 升级挖掘（来源：agent-sdk 0.3.284~0.3.295 / CC 2.1.284~2.1.295）

> 2026-10-09 晚：#108 竞态已定位修复，SDK 已恢复 `^0.3.295`，下列条目可直接评估落地。

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `background_tasks_changed` 条目新增 `subagent_type` | SDK 0.3.293 | 任务面板直接区分 subagent 类型，免与 `task_started` 配对拼接 | `claudeRemoteLauncher.ts` 后台任务集合 → web TaskPanel | 中 | 已落地（2026-10-28 eb628b43：主链路原已通，补齐 taskInfo 缓存层采集与补建回填） |
| 子代理消息 `agent_id` + task 事件 `parent_task_id`/`run_id` | SDK 0.3.292 | agent drawer 消息归属链（子代理消息 ↔ 任务）、resume 后区分同一任务的多次 run | `claudeRemote.ts` 消息/任务事件消费 → AgentDrawer | 中 | 不采纳（2026-10-28 评估：抽屉按 toolUseId 归属已闭合、任务面板平铺无树概念、task_id upsert 已覆盖 resume；引入仅加冗余映射层） |
| SendMessage `tool_use` 输入新增 `recipient_kind`、`approve` 恒为 boolean | SDK 0.3.292 | 跨会话投递卡片免从 raw input 猜收件人类型 | ToolCallBlock（SendMessage 工具卡） | 低 | 不采纳（2026-10-28 评估：卡片只显示收件人名，routing.target 权威回执已够，无类型展示需求与猜类型逻辑） |
| result 新增 remote-session 延迟字段（`first_text_post_queue_wait_ms` 等） | SDK 0.3.287 | StatusBar 轮次计时可区分「排队等待」与「生成」两段 | `claudeRemote.ts` result 消费 → StatusBar | 低 | 不采纳（2026-10-28 实证：仅 claude.ai 中继形态下发，本地库 4572 条 result 帧零出现；排队语义已有 queued_turn_count/stillQueuedCount 覆盖） |

---

## 2026-10-28 升级挖掘（来源：agent-sdk 0.3.304~0.3.312 / CC 2.1.305~2.1.312）

> 2026-10-28：SDK 已升至 ^0.3.312（changelog 检查 + E2E 回归过），上节「待升级」条目的帧/字段现已可用，可开始评估落地。

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `command_lifecycle` started 帧新增 `wakeup_source` / `scheduled_for`（capability `lifecycle_wakeup_source_v1`） | SDK 0.3.307 | 休眠/唤醒特性可观测：区分「调度唤醒」与「任务唤醒」，唤醒原因进 UI | session 帧消费（claudeRemote）→ web 会话状态行/任务面板 | 中 | 已立项（2026-10-28，用户拍板；capability 本地形态广播已实证；spec/两票在 `.scratch/wakeup-source-observability/`，跟进 pending #128） |
| `ModelUsage` 拆分 `cacheCreationEphemeral5mInputTokens` / `cacheCreationEphemeral1hInputTokens` | SDK 0.3.311 | 成本显示按缓存生命周期细分（5m/1h 价差大），turn 概要与 costUsd 更准 | turn 概要渲染（web）+ usage 聚合（runtimeState） | 低 | 不采纳（2026-10-28 评估：CLI costUSD 已按分档费率计价，mobi 显示的成本已准确且不自算；字段仅对自算成本/构成展示有用，两者皆无） |
| AskUserQuestion 每问 `annotations.unanswered`（`skipped`/`replied_in_chat`/`dismissed`，capability `ask_user_question_unanswered_v1`） | SDK 0.3.312 | 问答卡可显示「已跳过/已关闭」终态，免猜无答复原因 | web AskUserQuestionFooter | 低 | 已立项（2026-10-28，用户拍板；语义=mobi→CLI 答案载荷，只做 skipped；spec/两票在 `.scratch/askuserquestion-unanswered/`，跟进 pending #127） |

另：0.3.309 `extractFromBunfs` 改为按字节校验复用 + 独立临时目录——mobi 编译态直接受益（SDK 升级后不再复用陈旧提取二进制），无需 mobi 侧动作，已随本次升级生效。
