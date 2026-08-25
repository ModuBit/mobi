---
name: real-session-seed
description: 把生产库真实会话（含全部消息）拷入 e2e 库，做消息加载 / 窗口化 / fill 级联类验证
metadata:
  type: recipe
  last_verified: 2026-08-25
---

# 真实大会话注入（prod → e2e 拷库）

消息窗口化 / fill 级联 / 分页加载类验证需要**真实规模**的会话数据（tool-heavy、几千条消息），
手工 seed 无法还原 bubble:消息比。直接从生产库拷行：

## 步骤

1. 正常 [[env-bootstrap]] 启动 e2e 环境（hub 运行中即可，WAL 多进程共存，**无需重启**，
   sessions/messages 即写即见）
2. 拷贝（sqlite3 直连 `~/.mobi-e2e/mobi.db`，ATTACH 生产库）：

```sql
ATTACH '/Users/manerfan/.mobi/mobi.db' AS prod;
-- sessions 行：project_id / machine_id 置 NULL，避免引用 e2e 库不存在的行
INSERT OR REPLACE INTO sessions
  SELECT id, tag, namespace, NULL, created_at, updated_at, metadata, metadata_version,
         agent_state, agent_state_version, runtime_state, runtime_state_updated_at, seq, NULL, 0
  FROM prod.sessions WHERE id='<目标会话>';
-- messages：⚠️ 必须显式列出 position_at——NOT NULL 实体列，且 PRAGMA table_info 不列出它
--（生成列坑的反向：不显式列出必报 NOT NULL constraint failed: messages.position_at）
INSERT OR REPLACE INTO messages
  (id, session_id, content, created_at, seq, local_id, metadata, deleted_at,
   is_sidechain, parent_tool_use_id, lifecycle, lifecycle_at, position_at)
  SELECT id, session_id, content, created_at, seq, local_id, metadata, deleted_at,
         is_sidechain, parent_tool_use_id, lifecycle, lifecycle_at, position_at
  FROM prod.messages WHERE session_id='<目标会话>';
DETACH prod;
```

3. 浏览器刷新/直开 `/sessions/<id>` 即见（机器无需在线）

## 验证手法（fill 级联回归，2026-08-25）

- 打开会话后 `list_network_requests` 过滤 `messages`：**只应有 1 次**（fetchLatest 首页），
  无 beforeSeq 级联
- 验证上滚未被误伤：`evaluate_script` 设 `.ant-bubble-list-scroll-box` 的 `scrollTop=0` 并
  `dispatchEvent(new Event('scroll'))`，应恰好触发 1 次 `?beforeSeq=` 请求且不再续拉
- content 为明文存储（`toDecrypted` 仅历史命名），跨库拷贝无需解密处理

## 坑

- **position_at 列**：见上，PRAGMA 不显示但 NOT NULL
- **机器/项目引用**：置 NULL，否则分组/关联查询可能碰上缺失行
