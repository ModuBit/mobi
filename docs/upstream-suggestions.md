# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。


## 2026-09-11 · SDK 0.3.259→0.3.267 / CC 2.1.259→2.1.267

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| prompt-cache miss 可能原因诊断（/cost 与状态行 prompt_cache 字段标注原因：tool 定义/system prompt 变化、超 TTL） | CC 2.1.260 | 已核实：miss 原因标注不经 SDK 帧暴露（CLI 内部 UI）；可编程信号为 SessionStart hook input 的 `prompt_cache_likely_expired` / `context_tokens` / `seconds_since_last_response`（仅 resume/fork）。已落地为会话级 cacheStatus 事实（cli hook 观测 → hub 落 runtimeState → web StatusBar 提示 chip，首 turn result 后清空），同时供 cache-miss-after-resume 调查查库归因「超 TTL」分支；「回放缩水前缀失配」仍需 proxy 抓包。turn 统计卡归因待调查有结论后再评估 | ✅ 已落地（shared CacheStatus + cli 两模式上报 + hub sessionFacts + web StatusBar chip） | 中 | 已落地 |
| `bashOutputMaxChars` / `taskOutputMaxChars` 设置（内联工具输出上限最高 128K，超出才落文件） | CC 2.1.261 | 评估后不采纳：该字段主要改善**模型**上下文体验（减少读输出文件的回合），对移动端 UI 无直接收益——web 工具卡片本就折叠展示、真实长输出仍会超 128K 落文件；inline 上限提高反而加剧水位消耗与 autocompact 频率。如需调读回窗口，settings.cli.json 的 claudeEnv 注入 `BASH_MAX_OUTPUT_LENGTH`/`TASK_MAX_OUTPUT_LENGTH` 今天已可达（零开发） | — | 中 | 不采纳（claudeEnv 兜底） |
| result 延迟分解字段 `first_content_frame_ms` / `first_stream_post_ms` 等 | SDK 0.3.260 | 核实：turn 统计卡 "First token" 已取 SDK 权威 `ttft_ms`（normalizeAgent），台账"本地测量"前提不成立；网络段拆分字段不采纳——sdk.d.ts 无 JSDoc 语义不明、受众窄（开发者诊断）、UI 塞毫秒指标是倒退；字段已随 result 帧整体落库，有诊断需求时可直接查库 | — | 低 | 部分已达成（ttft_ms 已权威） |

## 2026-09-12 · SDK 0.3.267→0.3.268 / CC 2.1.267→2.1.268

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `initialize` 成功响应恒带 `pending_permission_requests`（空列表区分「无待批」与「旧 CLI」） | SDK 0.3.268 | E2E 实证（2026-09-12）：审批挂起时重启 hub（CLI socket 断连重连），弹窗状态经 agentState.requests（hub DB 权威）完整存活，批准后工具真实执行——mobi 场景「断连」只发生在 cli↔hub 层，pending 在 cli 内存+hub DB 双存活，天然恢复零改动。SDK 重放机制覆盖的是 cli 进程死亡场景（resume 恢复中断 turn 重新发起审批），与既有链路衔接 | — | 高 | 已验证（零改动） |
| `canUseTool` 新 hint：`defaultToNo` / `suppressAlwaysAllowRule` | SDK 0.3.268 | 敏感工具审批安全增强：hint 经 cli sdkHints 透传到 web 审批面板——suppress 时隐藏全部持久档（suggestion 档/fallback 字面档/Edit 全部允许），defaultToNo 时拒绝升主位（danger 实心）、approve 降次要行，消除单键误批与超范围持久规则的视觉引导 | shared SDKUIHintsSchema + cli permissionHandler 透传 + web PermissionFooter（已交付，单测锁定） | 中 | 已落地 |
| `get_context_usage` 分类带 `kind`（used/free/buffer/deferred，对齐 /context 行） | SDK 0.3.268 | 核实：mobi 已消费 getContextUsage（summary 零 LLM），水位四类拆分大半达成（ContextRing Popover 明细已含 used 细分/free/buffer）。加固已交付：extractBreakdown 的 free/buffer/deferred 行从英文行名硬编码（'Free space' 等）迁移为 kind 权威分类（SDK 警告 "never on the English name"，防 CC 行名漂移致细分静默丢失）；used 类目 kind 无语义，name 映射表保留 | cli utils/contextBreakdown.ts（单测锁定 kind 优先语义） | 中低 | 已落地（加固） |
| `resume_reason`（assistant/stream-event/result 帧标记 host 重启自动重跑） | SDK 0.3.268 | 核实：mobi 未设 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`，resume 从不自动重跑被打断 turn——badge 是重跑特性的附属品，前提不成立。暂缓：待产品决策「是否启用 resume 自动重跑」（行为变更：续跑耗 token + 工具副作用可能重复；mid-turn 死亡检测亦待设计），badge 渲染极小届时同步做，详见 pending.md #75 | — | 低 | 暂缓（依赖产品决策） |
