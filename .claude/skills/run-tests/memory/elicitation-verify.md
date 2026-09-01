---
name: elicitation-verify
description: MCP elicitation 表单全链路验证 — 测试 MCP 接线、表单卡片操作、accept/decline 断言
metadata:
  type: recipe
  last_verified: 2026-09-01
---

# MCP elicitation 表单验证（批次 C）

## 测试 MCP 接线

fixture：`packages/cli/tests/fixtures/elicitation-mcp/server.ts`（stdio，`trigger_elicitation` 工具，string/number/boolean 三字段表单，响应 JSON 回显进工具结果）。

在会话工作目录放 `.mcp.json` 注册（如 `~/workspace/demo/.mcp.json`）：

```json
{ "mcpServers": { "elicitation-test": { "type": "stdio", "command": "bun",
  "args": ["/Users/manerfan/workspace/github/modu/mobi/packages/cli/tests/fixtures/elicitation-mcp/server.ts"] } } }
```

claude 从项目 .mcp.json 加载（settingSources 不隔离），会话内直接可用。首次调用 MCP 工具仍弹工具审批（Allow this session 后不再弹）。

## 验证步骤

1. 发消息让模型调用 `trigger_elicitation` → 先弹**工具审批**（批准）→ 再弹 **ElicitationFormCard**（serverName + message + required 星标 Input + InputNumber + Switch + Decline/Submit）
2. 填写 → Submit → 卡片即消失（已决即消失）；等 turn 结束
3. **断言靠工具结果回显**（fixture 把 content JSON 序列化回显）：accept 路径 `{"action":"accept","content":{"name":"墨墨","count":42,"flag":true}}`——**count/flag 必须是原生 number/boolean**（证明 answers 放宽 + cli 按 schema 转型成功）；decline 路径 `{"action":"decline","content":null}`（Decline 不填表单直接点，验证绕过 required 校验）

## 坑

- 模型可能先弹 Change Title 审批再弹工具审批——逐个批准，看卡片标题区分
- fixture 的 elicitation 等待超时 60s，表单挂着不填会超时 decline
