---
name: teammate-verify
description: teammate/teamState 生命周期验证 — 派发带 name 的 Agent、权限审批、DB 轮询 teamState 生成/清空
metadata:
  type: recipe
  last_verified: 2026-08-15
---

# teammate（teamState）生命周期验证

验证 hub 侧 teamState 提取 / teammate 完成出口（tool_result 消费）相关改动。

## 触发 teammate 派发

Web 会话发 prompt（明确 name 参数才注册 member——`processTaskToolWithTeam` 判定 `input.name` 存在）：

> 请用 Agent 工具派发一个 subagent，name 参数必须设为 'e2e-analyzer'，让它读取当前目录的 package.json 并总结其内容，等它完成后再回复我。

## 关键时序

1. 发消息 → **Agent 派发触发权限审批**（Allow this session / Allow / Deny）→ 必须批准才继续
2. 批准后 teamState 立即落库（member running + toolUseIds）
3. subagent 完成 → tool_result 到达 → member completed → 全 done 自动清空 teamState

## DB 轮询（比 UI 快照可靠）

```bash
SID=$(sqlite3 ~/.mobi-e2e/mobi.db "SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1;")
# 等 teamState 出现（批准后即现）
sqlite3 ~/.mobi-e2e/mobi.db "SELECT runtime_state FROM sessions WHERE id='$SID';" | python3 -m json.tool
# 等清空（轮询 grep -q teamState 取反）
```

验证点：member 带 `toolUseIds`（tool_use id，GLM 下是 `call_xxx` 格式）；完成后 runtime_state 无 `teamState` 键（remaining keys 只剩 effort/model）。

## UI 验证

- 运行中：`document.body.innerText` 含 `Team: session-xxxxxxxx`（TeamAgentPanel）
- 完成后：`Team:` 消失；消息流里 Agent 卡片（`e2e-analyzer` 字样）保留是正常历史

## 坑

- **消息 envelope 外层 role 恒为 'agent'**（SDK 统一 envelope），真实消息类型看 `data.type`（user/assistant/system）——hub 侧解析 tool_result 时对齐 `sync/tasks.ts`，别检查外层 role（2026-08-15 踩过：检查 `role !== 'user'` 导致提取永不命中）
- 审批前 teamState 不出现（派发 tool_use 未执行不发消息），别误判为提取失败
