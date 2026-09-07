---
name: fork-verify
description: fork 分叉会话 E2E 验证 — fork API 直调 / 待激活观察 / 激活路径断言 / 409 首条消息竞态（2026-09-07 P0 修复后回归）
metadata:
  type: recipe
  last_verified: 2026-09-07
---

# fork 分叉会话验证

## 直调 API 造 fork（免走 UI Popover）

```bash
WEB_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.mobi-e2e/settings.hub.json'))['webApiToken'])")
curl -s -c /tmp/jar -X POST http://localhost:2224/api/auth -H 'Content-Type: application/json' \
  -d "{\"accessToken\":\"$WEB_TOKEN\"}"     # 字段名是 accessToken（不是 token）
curl -s -b /tmp/jar -X POST http://localhost:2224/api/sessions/<parent-id>/fork \
  -H 'Content-Type: application/json' -d '{"anchorNativeId":"<agent回复nativeId>"}'
```

- 锚点 nativeId 查询：`sqlite3 ~/.mobi-e2e/mobi.db "SELECT seq,native_id,json_extract(content,'$.role') FROM messages WHERE session_id='<sid>' ORDER BY seq"`
- 复制完整性断言：fork 行 seq 从 1（custom 溯源消息）起，后续行 native_id 与 parent 锚点 turn 一一对应（含 native_id 为空的行与 is_sidechain 行）；`metadata.nativeSessionId` 保留 parent 链值
- 服务端边界守卫：对 `seq<=contextBoundarySeq` 的锚点 fork → HTTP 400 `anchor-before-boundary`

## CLI 侧接口（带 cliApiToken Bearer）

`~/.mobi-e2e/settings.cli.json` 的 cliApiToken 作 Bearer 调 `/cli/sessions/by-claude-session/<nativeId>`——返回体含完整 metadata（forkFrom/forkedFrom），active=false。CLI bootstrapSession 靠响应里的 `tag` 复用会话行。

## 断言要点

- 激活探针（最硬断言）：fork 会话里发「只根据上下文历史回答…看不到就回答看不到历史」→ 答「看不到历史」= 激活失败/上下文丢失
- parent /clear 后 contextBoundarySeq 推进、native id 更换（CC /clear 开新 transcript）；旧 transcript 文件仍在 → 旧链 fork 锚点预检不受影响
- parent 删除后溯源消息降级灰文本「fork 自会话 Deleted session」（无链接）

## 已知 P0（2026-09-07 首验发现 → ✅ 同日已修，commit 77d9c6ae）

待激活 fork 会话 composer 禁用（`ChatComposer` 通用 inactive 门控，`allowSendWhenInactive` 硬编码 false）→ 唯一出路是 Resume 按钮；而 hub `resumeSession` 对 fork 行只做普通 resume（resumeSessionId=预生成 id，无 transcript）→ CLI `bootstrapSession` 因 fork 行 **tag=NULL**（sessionFork.ts 有意置 null）而 `existingSession?.tag` 判空新建 mobi 行 → forkActivation 永不装配 → CC 另起全新 native session → hub `mergeSessions` 删掉 fork 行、forkFrom/forkedFrom 在合并中丢失 → fork 语义静默损毁。根因=03 行创建（tag:null）与 04 CLI 绑定（只认 tag 复用）的跨票集成缺口。

**修复**：fork 行建行赋 tag（bootstrapSession 据此绑定）；web 待激活 composer 放行（`isPendingFork` → `allowSendWhenInactive`）+ 发送先自动触发 resume spawn（失败不拦截入队，消息 queued 待重试）。

## 另一已知 P1（✅ 同日已修，同 commit）

shared `toSessionSummary`（sessionSummary.ts）metadata 白名单不含 forkFrom/forkedFrom → 会话列表 API 摘要无 fork 字段 → 侧栏行 `resolveForkSessionState` 恒非 fork → 「〈parent 标题〉 · 分叉」后缀与「待激活」徽标在列表永不渲染（web 端 SessionMetadataSummary 类型声明了字段但 hub 不发）。**修复**：白名单补 forkFrom/forkedFrom/forkError/contextBoundarySeq（这是独立于 MetadataSchema 的第二道白名单——两处都要声明字段才可达 web）。

## P0/P1 修复后全链路回归（2026-09-07，全部通过 + 1 新问题）

UI 路径：建会话发消息 → 回复气泡下「Fork from here」→ 确认 → 跳转 fork 会话。验证过的断言：
- 侧栏 fork 行「〈parent 标题〉 · forked」+ Pending badge（英文 locale 文案）；会话页顶部「fork 自会话 <parent 标题>」溯源链接
- 待激活 composer 可直接输入发送（不再依赖 Resume 按钮）；发送即自动触发 `POST .../resume`
- 激活 spawn 参数（ps 硬证据）：`--resume=<parentNativeId> --fork-session --resume-session-at=<anchorNativeId> --session-id=<预生成forkNativeId>`
- 激活后 DB：forkFrom 清除 / forkedFrom 保留 / nativeSessionId 仍是预生成值 / 行未被 merge（GET 会话仍 200）
- fork transcript（`~/.claude/projects/-Users-manerfan-workspace-demo/<forkNativeId>.jsonl`）含完整锚点 turn 复制；探针轮 result 的 `cache_read_input_tokens` ≈ parent 历史量级（上下文在场证据）
- badge 消失、parent 历史完整可继续对话

## 已知问题：激活首条消息 409 竞态（✅ 2026-09-07 已修）

`ChatContainer.handleSend` fire-and-forget `resumeSession()` 后**立即** `sendMutation.mutate`，而 hub `POST /messages` 原有 `{ requireActive: true }` 门控 → resume 窗口期（~600ms+）内首条消息 409 被拒，乐观气泡成幽灵。**修复**（hub 放行入队方案，spec §4.3/§5.3）：`POST /messages` 改 `requireActive:false` + 手动门控——inactive 且无 `metadata.forkFrom` 仍 409；待激活 fork 会话放行 `sendMessage` 入队，CLI 激活后消费。回归测试：hub tests/routes/messages.test.ts 两用例（非 fork 409 / pendingFork 200）。

## 探针设计坑

parent 首轮 prompt 让模型「记住暗号」时，模型会自发把暗号写进项目 auto-memory（MEMORY.md）→ 激活探针的「答出密码」可来自 memory 而非会话历史，不纯净。最硬证据改看：transcript 复制内容 + spawn 参数 + cache_read 量级，探针回答只作辅助。
