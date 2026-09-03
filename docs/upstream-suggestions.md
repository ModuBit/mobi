# 上游新功能引入建议

记录从 Anthropic 上游（Claude Agent SDK + 内嵌 claude 二进制）changelog 中挖掘出的、对 mobi 有价值的新能力建议。来源：`/upgrade-deps` skill 第八步「机会挖掘」。

**条目生命周期**：`待决策` → `已采纳`（进 pending.md 立项或直接实施）/ `不采纳`（附理由）。已实施/已否决条目定期清理，历史详情见 git log（首轮 2026-08-31 建档，覆盖 SDK 0.3.178→0.3.251 / claude 2.1.178→2.1.251，30 条全部终态化；2026-09-03 清理）。

---

## 处理批次总览

| 批次 | 范围 | 结果 |
|---|---|---|
| A 停止×队列语义闭环 | U-2/U-11/U-13(+U-8)/U-5 | ✅ 2026-08-31 实施（U-5 诉求由 QueuedMessagesBar 自研覆盖，SDK 字段不引入） |
| B 任务面板与子代理可观测性 | U-1/U-3/U-23/U-4 | ✅ 2026-08-31 实施（U-4 未自动受益，根因 hub 双写竞态 → pending #62） |
| C 审批、工具与 MCP 状态保真 | U-12/U-26/U-14b/U-25/U-15/U-7/U-14a/U-17 | ✅ 2026-09-01 实施（U-25→#63、U-15→#64、U-7→#65；U-14a/U-17 上游已撤除字段）。教训：**实施前必须对照当前 sdk.d.ts 重验** |
| D 跨会话数据面 | U-18 | ✅ 2026-09-01 实施（source 细分三标签；结构化 name/body spike 证 SDK 不 emit peer 到 onMessage） |
| E rewind/resume 护栏 | U-16 | ✅ 2026-09-01 实施 |
| F 成本与预算 | U-6/U-22/U-10 | ⏸️ 整体搁置等 gateway-ccr-backend → pending #66（预算限额逻辑确认不做） |
| G 低优杂项 | U-27/U-20 等 7 条 | ✅ U-27/U-20 已实施（commits b51cc557..2b169578）；U-29/U-21/U-28 不做；U-19 暂缓；U-9 上游未暴露；U-30 → pending #67 |
| H 架构演进观察 | U-24 sessionStore | ⏸️ 暂缓观察（@alpha），上游 stable 后启动 |

## ⚠️ 行为变化注意（非机会，已全部核实，2026-09-02）

- **Todo/task 工具新模型默认移除**（SDK 0.3.233）→ 已适配：移除 mobi 保底注入跟随上游默认，`claudeEnv` 可显式开回
- **subagent 不嵌套（depth 1）+ 并发 20**（SDK 0.3.217）→ 无影响：后台任务面板扁平无层级概念，超限错误经工具卡片可见
- **auto-compact 未知模型窗口钳制**（claude 2.1.223）→ 跟随新默认：防网关小窗口模型爆窗，且与 mobi 水位 200k 猜测口径对齐（根治归 #57 方向 3）
- **canUseTool allow 无 updatedInput 契约修正**（SDK 0.3.207）→ 无影响：mobi 7 处 allow 全带 updatedInput，纯利好
- **usage limit 重置自动续跑**（claude 2.1.234）→ 无影响：run-started 链路 + 计时 max 单调已覆盖；idleTimer 默认 1 天不打断 5h 重置窗口
- **system-reminder 轮间包裹投递**（claude 2.1.234）→ 不适配不展示：内容是给模型的状态注入，专用通道（TodoPanel/任务卡片）已覆盖用户所需；可见属错误归因，真涌入时识别转灰行
- **Bash 重定向权限检查反复**（2.1.232/233）→ 无影响：mobi 审批兜底是 command 字面匹配，与上游规则引擎语义解耦

## 已自动受益（无需动作，留档）

- 并行工具调用权限双发竞态修复 / `system/init` permissionMode 实时性（2.1.247 / SDK 0.3.247）
- 第三方端点无 id tool_use 不 crash / resumed 400 修复 / subagent 首调 404 fallback（2.1.246/247，网关受益）
- hook 非法 JSON 不再静默（2.1.248）；迟连补收挂起权限弹窗（SDK 0.3.217）；后台任务运行期正确报 idle（SDK 0.3.179）
- `isSynthetic`→`isMeta` 修复（SDK 0.3.198）；网关 prompt caching 修复（2.1.237）；非流式 fallback 崩溃修复（2.1.234）
- 沙盒违规细节入 Bash tool result（2.1.224）；自动标题短专名（2.1.234）；SendMessage 长 summary 截断（2.1.222）
- `interrupt_receipt_v1` 能力（SDK 0.3.205）——pending #28 实施时直接用

## 不适用（防止重复评估）

- `createSdkMcpServer({ timeout })`——mobi-web 自建 in-process MCP；`managedSettings` host 托管模式——mobi 未采用
- spinnerTipsOverride / `/claude-api` / fullscreen / `claude agents` TUI——无 TUI 消费面；`PostToolUse.classifierContext`——不注入分类备注
- `sandbox.*` SDK 设置面——沙盒走自研 `~/.mobi/sandbox.json`；`CLAUDE_CODE_PROJECT_DIR_NAME`——不用每会话独立 config 目录形态
- `self-hosted runner`——与 mobi 定位重叠仅概念对标；skills `'all'` 校验 / fast mode / credits 引导——网关场景无消费面
- `rewind_conversation` 控制请求——rewind 已自研，留作未来替代方案
- SDK API 面（0.3.251 对照）：`getContextUsage`（内部调 countTokens API 触发网关限流，改读消息 usage）/ `settingSources` / `strictMcpConfig`（需用户与项目配置生效，不隔离）/ `persistSession: false`（依赖 transcript 落盘）/ `plugins`/`reloadPlugins` / `permissionPromptToolName` / `spawnClaudeCodeProcess` / `maxTurns`/`outputFormat` / `betas`（[1m] 由 CLI 处理）/ `thinking`（用 effort）
