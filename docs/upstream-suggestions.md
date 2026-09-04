# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。采纳后由 `docs/pending.md` 立项跟进；每条终态后回写本表状态。

**来源版本区间**：`@anthropic-ai/claude-agent-sdk` 0.3.251 → 0.3.259（内嵌 claude v2.1.251 → v2.1.259）、`@anthropic-ai/sdk` 0.122 → 0.123（2026-09-03 升级，commit daa8ca31）

| # | 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `getContextUsage({ detail: 'summary' })` | SDK 0.3.259（Query 方法新增可选参数；`'summary'` 从最近 response usage + 本地估算作答，不做 per-category token-count 调用） | context 水位展示零 API 调用——现状 `detail:'full'` 主路径走 countTokens API，第三方网关（glm/CCR）必触限流（历史坑，见 memory `project_getcontextusage-api-calls`） | cli：runtime state 水位计算处改传 `detail:'summary'`（或 web 请求时参数化） | 高 | pending |
| 2 | Proactive style 空转修复 | claude v2.1.257（Fixed Proactive output style sessions busy-looping with filler messages… instead of idling while a background command or Monitor is running） | 切到 Proactive 的会话在后台任务运行期间不再灌 filler 消息，会话流干净 | 无需改动，随 claude v2.1.259 生效 | 高 | ✅ 已随升级生效 |
| 3 | 多会话 `~/.claude.json` 并发覆写修复 | claude v2.1.259（Fixed concurrent sessions silently reverting each other's `~/.claude.json` changes — workspace trust no longer resets and MCP/project state is no longer lost） | mobi 多并发会话是核心场景，此前多会话互踩 trust/MCP 状态 | 无需改动，随 claude v2.1.259 生效 | 高 | ✅ 已随升级生效 |
| 4 | `systemPrompt.snapshot: true` | SDK 0.3.259（systemPrompt preset/custom 变体新增 `snapshot?: boolean`；记录会话 system prompt 后 resume/后续请求原样复用） | mobi 用 `preset + append`（默认每次 launch fresh 渲染）；开启后 resume / 重启轮 prompt 稳定、API prompt-cache 前缀稳定。需评估与 output style 切换（/clear 语义，settings 层）的交互——理论无冲突，切 style 仍走新 query | cli：`systemPrompt.ts` / claudeRemote sdkOptions 构造处加 `snapshot: true` | 中 | pending |
| 5 | task `detail` 状态行 + `agentProgressSummaries` | SDK 0.3.259（task notification 新增 `detail`：local_agent 为模型生成的进度摘要（需开 `agentProgressSummaries` option）、backgrounded mcp_task 为 MCP 服务器自带状态行） | 任务面板从「状态点」升级为「一行实时进度」 | cli：task 转发透传 + option 开启；web：TaskPanel 行渲染 detail | 中 | pending |
| 6 | task `resource_links` | SDK 0.3.259（backgrounded mcp_task 完成时，最终结果中的 `resource_link` 文件引用收集进 notification，join tool_use_id） | 后台 MCP 任务产出的文件可直接从任务面板打开 | cli task notification 转发 + web TaskPanel 链接渲染 | 低 | pending |
| 7 | `user_message_uuids` | SDK 0.3.259（stream_event / result / user 消息新增：本轮已消费的全部 client uuid 列表，含排队并入的消息） | 排队消息批量并入一轮时，回复可精确绑定到具体用户消息（现状只知最后一条） | cli 消息流透传 + web 消息来源标注 | 低 | pending |
| 8 | `updateSettings('localSettings', { outputStyle })` | SDK 0.3.259（Query 新增 updateSettings：走 /config 同款 settings 文件写入路径 + live-apply，key allowlist 当前仅 outputStyle） | 「把当前 style 设为默认」写回用户 settings 的官方通道。注意：output style spec §5 曾明确不做回写；现 SDK 有一等支持，属产品决策重启 | cli switch-output-style handler 扩展 + web 切换器「设为默认」入口 | 低 | pending |
