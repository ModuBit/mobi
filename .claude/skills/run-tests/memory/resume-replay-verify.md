---
name: resume-replay-verify
description: 会话 resume 场景验证（attach 重播 / backfill 语义 / ghost 气泡）——复现脚本 + SSE 抓包解析 + 手造存量 NULL 行
metadata:
  type: recipe
  last_verified: 2026-09-10
---

# 会话 resume 重播验证（attach / nsid / backfill）

验证「CLI 重启（resume）后 attach 补写重播历史行」类改动（backfill 语义、落库自动补 nsid）。

## 复现脚本（造素材 → kill → resume → 发首条消息）

1. 会话内制造素材：`! <cmd>`（产 `!bash_` 合成 tool 对）+ `/compact `（**尾随空格**，见 input-box.md）+ 各事件行
2. kill 会话 CLI（按 PID 精确）：`ps -eo pid,command | grep "index.ts claude"`，注意排除 `--project a5b79c62` 等其他环境
3. 页面 reload → 点 Resume（`document.querySelectorAll('button')` 文本 === 'Resume' 取最后一个 click）
4. **发首条消息**才触发 fallback attach（resume 后 CLI 不立即启动 SDK，SDK init 在首条消息时发生）→ onSessionFound → attach → 重播
5. 观察：DOM 高频采样（空 `Tool` 文本行 / `Compressing` 文案）+ SSE 抓包

## SSE 抓包（hub 侧真相，不受浏览器干扰）

```bash
curl -c jar -X POST -H "Content-Type: application/json" \
  -d '{"accessToken":"e2e-test-token-mobi"}' http://localhost:2224/api/auth
curl -N -b jar "http://localhost:2224/api/events?sessionId=<sid>&snapshotDelta=1" > capture.txt  # 后台
```

python 解析：`data:` 行 JSON，重播特征 = `message-received` 且 `message.positionAt` 是历史时间、seq 降序；修复后应带 `backfill: true`，真新消息不带。

## 手造存量 NULL 行（模拟旧库，验证 backfill 防御）

修复后新行落库自动补 nsid，NULL 池不再增长——验证 backfill 需手动 sqlite 清几行：

```bash
sqlite3 ~/.mobi-e2e/mobi.db "
UPDATE messages SET metadata = json_remove(COALESCE(metadata,'{}'), '\$.nativeSessionId')
WHERE session_id='<sid>' AND seq IN (...);"
```

再走 kill → resume → 发消息：SSE 里这些行应带 `backfill:true` 且页面无 ghost。

## 坑

- **浏览器侧 SSE instrumentation 别用 fetch patch** — web 用 `@microsoft/fetch-event-source`，patch `window.fetch` 后包装 reader 会把流消费掉导致 Connection Lost、页面收不到事件（观测手段破坏被观测系统）；hub 侧 curl 抓包即可
- **`initScript` patch EventSource 无效** — 同上，不是原生 EventSource
- 发消息可靠姿势：textarea 原生 setter + `dispatchEvent(input)` + 合成 `keydown Enter`（比找发送按钮 uid 稳，reload 后 uid 失效）
- `wait_for "Run 1 shell command"` 在新 UI 文案下可能匹配不到，改用 DOM `innerText` 查 `! <cmd>` 原文 + 模型回复到达
