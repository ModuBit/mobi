# Upstream Suggestions 台账

SDK / Claude Code 升级附带的新能力挖掘记录（`/upgrade-deps` 第八步产出）。


## 2026-09-11 · SDK 0.3.259→0.3.267 / CC 2.1.259→2.1.267

| 功能名 | 出处 | 对 mobi 的价值 | 建议落地位置 | 优先级 | 状态 |
|---|---|---|---|---|---|
| prompt-cache miss 可能原因诊断（/cost 与状态行 prompt_cache 字段标注原因：tool 定义/system prompt 变化、超 TTL） | CC 2.1.260 | 填补已知短板：cache-miss-after-resume 调查（resume 回放缩水 24k 致前缀失配）正缺一根"上游视角"的探针；若 SDK host 可读该信号即可免 proxy 抓包实锤 | 待核实信号是否经 SDK 帧暴露（result/system 帧 grep prompt_cache）；是→cli 上报 hub→web 状态行展示 | 中 | 待核实 |
| `bashOutputMaxChars` / `taskOutputMaxChars` 设置（内联工具输出上限最高 128K，超出才落文件） | CC 2.1.261 | 移动端直接看到更长命令/后台任务输出，减少"打开文件 inspector"跳转 | packages/cli 会话 settings 装配（sdkOptions settings 槽）+ settings.cli.json 可配 | 中 | 待采纳 |
| result 延迟分解字段 `first_content_frame_ms` / `first_stream_post_ms` 等 | SDK 0.3.260 | mobi turn 统计卡的 "First token" 现为本地测量，SDK 权威值可对齐口径（远程会话网络段拆分） | packages/cli launcher 的 onContextUsage/result 组装处 | 低 | 待采纳 |
