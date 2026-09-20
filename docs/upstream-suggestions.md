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

## 2026-09-20 · SDK 0.3.268→0.3.278 / CC 2.1.268→2.1.278

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`（首回合 MCP 连接等待上限，`0` 禁用；`options.mcpServers` 的 server 仍被等待） | SDK 0.3.274 | 填补已知短板：会话首 token 延迟（E2E 实测 ttft 8.2s）中 MCP 等待是可控成分——旧版首回合硬等最长 2s。mobi 的 host-owned server 走 options.mcpServers 不受影响，但外部/慢 MCP 不再拖累首回合 | settings claudeEnv 注入（零开发）；如需按 machine 配置再立 ticket | 高 | 待采纳 |
| `canUseTool` options 新增 `mcpServer: {name, source}` + MCP status `source`（host 可凭 `source === "sdk"` 识别自己注入的 server） | SDK 0.3.274 | 增强现有功能：审批面板可对 host-owned MCP（mobi-core / mobi-apps，ADR 0005）标注「Mobi 内置」徽标，与外部 MCP 视觉区分，降低误批焦虑；agent-apps 红线（防刷新重放）链路可加权威判定 | cli permissionHandler 读 options.mcpServer → shared SDKUIHints 透传 → web PermissionFooter 徽标 | 中 | 待采纳 |
| resume/fork 会话 `total_cost_usd` / `modelUsage` / `get_usage` 延续历史 turns（不再从零，`maxBudgetUsd` 不变） | SDK 0.3.277 | 直接受益零改动：fork-on-result 与 resume 场景的 turn 统计卡成本/缓存数字恢复连续性（此前每次激活从 0 起算，用户会看到成本「清零」） | — | 高 | 已随升级自动获得 |
| `getSessionMessages` / `forkSession` 五项修复（turn 首条 assistant 消息不丢、queued 消息按读取位置回放、`upToMessageId` uuid 校验、fork 重跑 prompt 不再显示两次等） | SDK 0.3.275 | 直接受益零改动：fork-on-result 特性（.scratch 分叉 spec）的消息复制完整性由上游加固 | — | 高 | 已随升级自动获得 |
| `SlashCommand.builtin`（标记内置命令） | SDK 0.3.277 | 增强现有功能：能力面板（capabilityDiscovery → web）可区分 CC 内置命令与项目/用户 skill，为「斜杠命令补全过滤内置」做数据准备 | cli capabilityDiscovery 透传字段 → shared SlashCommandSchema 加 optional 字段 → web 命令列表 | 低 | 待采纳 |
| `SDKUserMessage.pasted_content`（用户粘贴而非键入的文本，附在 prompt 后） | SDK 0.3.277 | 全新能力：移动端「粘贴长文本到会话」场景可标注来源，或折叠展示粘贴块；需产品决策是否值得 UI 呈现 | web composer / 消息渲染 | 低 | 需决策 |
| `task_notification.reason: "worker_restart"`（后台任务因 worker 进程重启被停） | SDK 0.3.273 | 增强现有功能：任务面板可把「意外终止」与「正常完成/用户停止」区分展示 | hub sessionMessageRuntimeProjector 消费 → web TaskPanel 状态标注 | 低 | 待采纳 |
| 远端会话延迟字段 `first_text_post_ms` / `first_stream_post_queue_wait_ms` 等（success result） | SDK 0.3.277 | 核实：与上次台账 0.3.260 结论同理——ttft_ms 已权威覆盖「首 token」，新增字段拆的是 remote 中继段的细粒度成分，受众窄；字段已随 result 帧落库可查 | — | 低 | 不采纳（有诊断需求查库） |
