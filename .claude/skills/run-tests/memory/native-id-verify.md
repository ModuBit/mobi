---
name: native-id-verify
description: 用户消息 native_id 绑定 E2E — SQL 断言 / API 暴露 / 各 push 路径场景；Change Title 审批解锁输入坑
metadata:
  type: recipe
  last_verified: 2026-08-17
---

# native_id 绑定验证（Rewind Phase 1）

## 场景与断言（全部对着 e2e 库 SQL 查，不用 UI 断言）

```bash
# 1. 普通消息：native_id 非空且 ≠ local_id
sqlite3 ~/.mobi-e2e/mobi.db "SELECT local_id, native_id FROM messages WHERE local_id LIKE 'local-%' ORDER BY seq;"
# 2. SDK 下发消息（assistant/tool）：native_id = local_id 双写
sqlite3 ~/.mobi-e2e/mobi.db "SELECT local_id, native_id FROM messages WHERE local_id NOT LIKE 'local-%' AND category='persistent' LIMIT 5;"
# 3. !bash（bashInjectContext 开）：!cmd 消息行 native_id = 注入消息的 uuid（非空即过）
# 4. API 暴露：页面 evaluate_script fetch /api/sessions/<sid>/messages?limit=5，确认 DTO 含 nativeId
```

## 观察（2026-08-17 实测）

- **排队消息大多不走 collectBatch 合并**：running 中连发两条，会经 **steer 提前提交路径**（stealByLocalId → sink 单独 push）各自绑定独立 uuid——不是 bug；1:N 批内共享仅当两消息恰好在同一 collect 时刻排队（steer 窗口外）。1:N 语义靠单测覆盖
- **第一个回合可能触发 Change Title 工具审批**（"Irreversible — proceed with care" 卡住输入框 disabled）——snapshot 找 "Allow" 按钮批准后继续，不算失败
- E2E runner 的模型（glm-5.2）首 token ~5-11s，纯文本回合 5-50s；`sleep 10-20` 后直接查 SQL 即可，不必等 UI

## 相关

- 设计/实施记录：`docs/superpowers/HANDOFF-2026-08-17-rewind.md`、`docs/superpowers/specs/2026-08-17-rewind-phase1-native-id-design.md`
