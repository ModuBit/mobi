# ADR 0005: Agent 自控工具走 host-owned MCP 路线

- 状态：已接受（2026-09-11，探索会话收敛）
- 关联 spec：`.scratch/agent-apps/spec.md`

## 背景

mobi 会话内的 agent 工具目前只能本地执行。期望 agent 能触达 mobi 自身：在 Web 端呈现内容（"打开文件 xxx"）、代替用户执行管理操作（"新建会话并跑任务"）。需要决定这批能力的接口形态。

## 决策

**接口形态 = wrapper 进程内 host-owned MCP server（codex 同构）+ 客户端 tool search。**

对照对象：OpenAI Codex 的 `codex_apps`——桌面 App 持有的 HTTP MCP server，31 个工具（线程管理、侧边栏、面板导航、自动化、额度）全部 MCP 注册，配合客户端 tool search deferral 抗规模。mobi 的对应物是 CLI wrapper 的 in-process SDK MCP server（现有 `mobi` server / `change_title` 先例），wrapper 即 host。

配套：

1. wrapper 为 remote 会话注入 `ENABLE_TOOL_SEARCH=true`。
2. 新工具默认进 `mobi` server（`mcp__mobi__*` 前缀，预授权策略零变更）。
3. 编排指导（多工具流程 playbook）后续按需以 skill 形态沉淀，不注册为工具。

## 否决的备选

**CLI 子命令 + skill（经 Bash 调用）**——否决主因是实验证据反转了其决定性论据：

- 实测（本机真实链路，SDK 0.3.267，ANTHROPIC_BASE_URL → mobi proxy → GLM 后端）：
  - 默认（不设 env）：tool search 被 SDK 禁用，40 个 MCP 工具定义全量下发（~101KB 工具 JSON）——文档所述"非官方 BASE_URL 默认禁用"成立。
  - 强制 `ENABLE_TOOL_SEARCH=true`：defer 生效（请求体只剩 `ToolSearch` + `DeferredToolPlaceholder`，工具 JSON ~28KB），GLM 后端零异常，行为正确，成本约降至 1/25~1/4。
  - 工具选择准确率（60 工具）：全量 10/10 vs defer 10/10（选名）；实际调用 5/5 vs 4~5/5，defer 平均多 ~1.5 turn（检索 round-trip）。
- 即"proxy 链路 → defer 不可用 → MCP 工具上下文必爆"的前提不成立：CC 的 MCP tool search 是客户端实现（占位符 + 普通工具形态的 ToolSearch），不依赖服务端 tool_reference 块，对代理/第三方后端透明。
- CLI 路线的剩余优势（人类可直接用命令、服务非 mobi 会话）不足以抵消其成本（子进程鉴权连 Hub 基建、审批显示为命令行文本、回执非结构化）。

**dispatch tool（按域聚合 action 判别联合）**——被用户否决：接口形态被压扁，宽 schema 的分支参数模型猜不准，zod 只能事后报错。仅在 defer 不可用时才值得考虑，而 defer 已实测可用。

## 后果与已知风险

- 模型在有 Bash 可选时会优先用 Bash 完成任务（实测 5 问中 4 问绕开 MCP 工具）——mobi 自控工具无 CLI 命令对应物，天然无此竞争；但设计工具描述时需认知这一点。
- defer 代价：每次检索 +1 round-trip；compact 后已加载定义会被压缩、需重搜；检索命中依赖工具命名与描述质量（动词化命名）。
- 独立待办：wrapper 不设 `settingSources` 时，用户 `~/.claude/settings.json` 的 env 块会穿透覆盖 wrapper 传入的 env（实测 `ANTHROPIC_BASE_URL` 被劫持）——`ENABLE_TOOL_SEARCH` 同样暴露于此风险，需在实现中验证并考虑治理。
- 实验脚手架保留在 `.scratch/defer-test/`（bench.ts 选名准确率 / bench2.ts 实际调用 / proxy.ts 请求体抓包），可复测。
