# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。


## 2026-09-11 · SDK 0.3.259→0.3.267 / CC 2.1.259→2.1.267

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| prompt-cache miss 可能原因诊断（/cost 与状态行 prompt_cache 字段标注原因：tool 定义/system prompt 变化、超 TTL） | CC 2.1.260 | 填补已知短板：cache-miss-after-resume 调查（resume 回放缩水 24k 致前缀失配）正缺一根"上游视角"的探针；若 SDK host 可读该信号即可免 proxy 抓包实锤 | 待核实信号是否经 SDK 帧暴露（result/system 帧 grep prompt_cache）；是→cli 上报 hub→web 状态行展示 | 中 | 待核实 |
| `bashOutputMaxChars` / `taskOutputMaxChars` 设置（内联工具输出上限最高 128K，超出才落文件） | CC 2.1.261 | 移动端直接看到更长命令/后台任务输出，减少"打开文件 inspector"跳转 | packages/cli 会话 settings 装配（sdkOptions settings 槽）+ settings.cli.json 可配 | 中 | 待采纳 |
| result 延迟分解字段 `first_content_frame_ms` / `first_stream_post_ms` 等 | SDK 0.3.260 | mobi turn 统计卡的 "First token" 现为本地测量，SDK 权威值可对齐口径（远程会话网络段拆分） | packages/cli launcher 的 onContextUsage/result 组装处 | 低 | 待采纳 |

## 2026-09-12 · SDK 0.3.267→0.3.268 / CC 2.1.267→2.1.268

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| `initialize` 成功响应恒带 `pending_permission_requests`（空列表区分「无待批」与「旧 CLI」） | SDK 0.3.268 | 填补已知短板：CLI 断连重连后 mobi 丢待审批弹窗、无法恢复；现在可在会话 attach/重连时拉取待批清单恢复 UI | packages/cli sessionHandlers 的 initialize 响应组装 + web 会话激活时拉取 | 高 | 待采纳 |
| `canUseTool` 新 hint：`defaultToNo` / `suppressAlwaysAllowRule` | SDK 0.3.268 | 敏感工具审批弹窗默认落在拒绝项 / 不提供「always allow」持久项，减少误批准 | packages/cli utils/permissionHandler.ts → web 权限弹窗 | 中 | 待采纳 |
| `get_context_usage` 分类带 `kind`（used/free/buffer/deferred，对齐 /context 行） | SDK 0.3.268 | 上下文水位显示可按四类拆分（配合既有 assistant usage 读数，注意 getContextUsage 换 LLM 的坑） | web 水位圆环 / cli usage 装配处 | 中低 | 待采纳 |
| `resume_reason`（assistant/stream-event/result 帧标记 host 重启自动重跑） | SDK 0.3.268 | 会话自动 resume 后 UI 可打「自动恢复」标识，用户不困惑消息为何重发 | cli 帧透传 → web 消息列表 badge | 低 | 待采纳 |
