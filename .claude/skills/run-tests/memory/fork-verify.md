---
name: fork-verify
description: fork 分叉会话 E2E 验证 — fork API 直调 / 待激活观察 / 激活路径断言 / mobi URI 动作链接形态溯源消息（2026-09-07 动作链接版回归）
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

- ⚠️ **锚点必须选 transcript 里真实存在的 agent text 消息 nativeId**（2026-09-07 踩坑）：
  result 信封行也有 nativeId（uuid），但 **result entry 不落 CC transcript**——用它作锚点，
  CLI 激活预检查不到 → `anchor-invalidated` forkError 错误态（降级本身符合设计，但 fork
  没建成）。SQL 筛锚点时按 `content LIKE '%"type":"text"%'` 或逐条与
  `~/.claude/projects/<encoded-cwd>/<parentNativeId>.jsonl` 的 uuid 核对
- 锚点 nativeId 查询：`sqlite3 ~/.mobi-e2e/mobi.db "SELECT seq,native_id,json_extract(content,'$.role') FROM messages WHERE session_id='<sid>' ORDER BY seq"`
- 复制完整性断言：fork 行 seq 从 1（custom 溯源消息）起，后续行 native_id 与 parent 锚点 turn 一一对应（含 native_id 为空的行与 is_sidechain 行）；`metadata.nativeSessionId` 保留 parent 链值
- 服务端边界守卫：对 `seq<=contextBoundarySeq` 的锚点 fork → HTTP 400 `anchor-before-boundary`
- forkError 错误态行可直接 DELETE 换锚点重 fork（删除守卫放行未激活 fork 行）

## CLI 侧接口（带 cliApiToken Bearer）

`~/.mobi-e2e/settings.cli.json` 的 cliApiToken 作 Bearer 调 `/cli/sessions/by-claude-session/<nativeId>`——返回体含完整 metadata（forkFrom/forkedFrom），active=false。CLI bootstrapSession 靠响应里的 `tag` 复用会话行。

## 溯源消息形态（ADR 0003 动作链接版，2026-09-07 起）

- **权威形态 = md 动作链接文本**：`{"role":"custom","content":[{"type":"text","text":"fork 自会话 [〈parent 标题〉](mobi://session/open?id=…)"}]}`——ref block 已从词汇表退场
- **文案写入时冻结**（消息即快照）：parent 改名不跟随；parent 删除文案不变、点击进会话页 not-found 态（旧版「灰文本降级无链接」已废弃，勿再按旧断言验证）
- 标题解析链（hub `resolveSessionTitle`）：`metadata.name` → path 基名 → id 前 8 位
- **web 渲染管线关键坑（P0，已修 6ef6aa76）**：x-markdown 渲染管线在 sanitize 阶段用
  DOMPurify 默认协议白名单过滤 href，`mobi://` 被整体剥除 → ExternalLink 拿不到 href，
  ActionLink 永不触发（点击无 toast 无跳转）。修复 = Markdown.tsx 传
  `dompurifyConfig` 扩展默认 URI 正则放行 mobi scheme。**单测 mock 了 XMarkdown 测不出
  此类管线级回归，真实链路靠 E2E**；回归测试见 `web/tests/ui/MarkdownActionLink.integration.test.tsx`（真实 XMarkdown 渲染）
- 未注册动作（`mobi://file/open?path=x`）/ 畸形 URI（`mobi://session`）→ 正常链接样式，点击 toast「Unsupported action」（zh：不支持的操作）
- agent 输出/用户消息里的手写 mobi:// 链接走同一 Markdown 拦截路径，已注册动作可跨来源跳转

## 存量迁移（hub 启动时，legacyRefMigration）

- 判据：`content LIKE '%"type":"ref"%'` 且 `role=custom`；改写为单 text block 动作链接（前缀 text 合并）
- 断言：hub 日志 `[Store] legacy ref 消息迁移完成: scanned=N rewritten=M`；改写后行无 ref（幂等，LIKE 归零）；parent 行已删 → 冻结文案「已删除的会话」
- E2E 复现：停 hub → `sqlite3` 直插 ref 形态 custom 消息行 → 重启 hub → 断言改写 + UI 点击跳转

## 断言要点

- 激活探针（辅助证据）：fork 会话里发「只根据上下文历史回答…看不到就回答看不到历史」→ 答「看不到历史」提示上下文丢失。⚠️ 探针回答只是辅助——2026-09-07 出现过「模型承认看到系统提醒但答看不到正文」的回答偏差，而 transcript 复制/spawn 参数/input 量级全部证明激活成功。**最硬证据看下三条**
- 激活 spawn 参数（ps 硬证据）：`--resume=<parentNativeId> --fork-session --resume-session-at=<anchorNativeId> --session-id=<预生成forkNativeId>`
- fork transcript（`~/.claude/projects/-Users-manerfan-workspace-demo/<forkNativeId>.jsonl`）存在且含锚点 turn 文本
- 激活轮 result：input_tokens（或 cache_read）≈ parent 历史量级 = 上下文在场；后续轮 cache hit 99%+ = 上下文持续在场
- parent /clear 后 contextBoundarySeq 推进、native id 更换（CC /clear 开新 transcript）；旧 transcript 文件仍在 → 旧链 fork 锚点预检不受影响

## 历史 P0/P1（均已修，背景速查）

- **P0（77d9c6ae，2026-09-07）**：待激活 composer 禁用 + fork 行 tag=NULL → bootstrapSession 新建 mobi 行 → mergeSessions 摧毁 fork 语义。修复：建行赋 tag + `isPendingFork` 放行 composer + 发送自动触发 resume。
- **P1（77d9c6ae，同 commit）**：`toSessionSummary` metadata 白名单缺 fork 字段 → 列表无「· 分叉」后缀与 Pending 徽标。修复：白名单补 forkFrom/forkedFrom/forkError/contextBoundarySeq。
- **409 竞态（同日）**：`POST /messages` 对待激活 fork 放行入队（`requireActive:false` + forkFrom 门控），防 resume 窗口期首条消息 409 幽灵气泡。
- **P1 入队后无投递（85ddd0b2，2026-09-07）**：入队广播落在 CLI 进房之前（web 发送侧先触发 resume spawn，POST /messages 的 room emit 早于 socket join），消息永久滞留 queued——「CLI 激活后消费」缺投递腿；CLI 断线 backfill 只覆盖重连且 lastSeenMessageSeq 非空的场景。修复：`MessageService.redeliverQueued` 在 `handleSessionAlive` 激活翻转点补发（幂等：CLI seq 去重 + lifecycle 推进）。

## 激活后 DB 断言（2026-09-07 动作链接版回归通过）

- forkFrom 清除 / forkedFrom 保留 / nativeSessionId 仍是预生成值 / 行未被 merge（GET 会话仍 200）
- badge 消失（侧栏行从「〈parent 标题〉 · forked + Pending」回归普通行）
- parent 历史完整可继续对话（follow-up 轮正常回复）

## 探针设计坑

parent 首轮 prompt 让模型「记住暗号」时，模型会自发把暗号写进项目 auto-memory（MEMORY.md）→ 激活探针的「答出密码」可来自 memory 而非会话历史，不纯净。最硬证据改看：transcript 复制内容 + spawn 参数 + input/cache_read 量级，探针回答只作辅助。

## E2E 环境共享坑（2026-09-07）

多 agent 并行跑 E2E 时，别人跑 `e2e-cleanup.sh`（`rm -rf ~/.mobi-e2e`）会**在你验证中途整库重建**——先 `stat ~/.mobi-e2e/mobi.db` + 核对进程树起点时间，确认自己早前断言是否发生在 wipe 前；需要 hub 带新代码重启时用常驻 wrapper bash 包一层（`bash -c 'bun run … hub start-sync & echo $! > pid; wait'`），否则 PPID 看门狗会在 wrapper 退出后 5s 杀掉 hub。
