---
name: capability-catalog-verify
description: 能力目录（slash 命令/agents 探针）验证：DEBUG 日志计数、host-metadata API、live Query 零探针、per-cwd 缓存与签名失效、后台刷新节流
metadata:
  type: recipe
  last_verified: 2026-10-20
---

# 能力目录验证（capabilityCatalog）

验证面全靠 **daemon debug 日志计数** + 直接 HTTP 调用，无需浏览器。

## 启动前提

`logger.debug` 仅在 `DEBUG` 非空时落盘（`packages/shared/src/logger.ts`），普通 bootstrap
看不到 `[capability]` 行。启动时带上：

```bash
env -u MOBI_API_URL -u MOBI_LISTEN_PORT -u MOBI_LISTEN_HOST -u MOBI_HOME -u MOBI_WEB_PORT -u MOBI_PUBLIC_URL -u MOBI_PROXY_PORT \
  DEBUG=1 nohup bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh >/tmp/mobi-e2e-bootstrap.out 2>&1 &
```

日志文件是 `~/.mobi-e2e/logs/<ts>-pid-<pid>-daemon.log`（不是 `daemon.log`，后者只有 HTTP 行）。

## 认证

受保护 API 走 JWT cookie/header，`webApiToken` 不能直接当 Bearer：

```bash
JWT=$(curl -s -X POST http://localhost:2224/api/auth -H 'Content-Type: application/json' \
  -d '{"accessToken":"e2e-test-token-mobi"}' | python3 -I -c "import sys,json;print(json.load(sys.stdin)['token'])")
```

`webApiToken` 在 `~/.mobi-e2e/settings.daemon.json`。

## host 路径（per-cwd 缓存，票 03）

```bash
BASE=$HOME/workspace/demo/mobi-cap-e2e; mkdir -p "$BASE/.claude/commands"
curl -s -H "Authorization: Bearer $JWT" "http://localhost:2224/api/sdk/host-metadata?cwd=$BASE"
```

- cwd 必须存在且在 home 内（`validateCwd`）
- 断言日志：首次 `miss → probe start → probe-ok`；30s 内二次 `hit`（实测 14ms）
- 并发：4 个不同 cwd 同时请求 → 任意时刻 `probe start` 未完成数 ≤2（FIFO 信号量）
- 单飞：同一 cwd 并发 2 请求 → 1 条 `probe start`
- 签名失效：探针后 **等 >30s**（fresh 窗口），再在 `<cwd>/.claude/commands/` 增删 `.md`
  → 下一次请求立即重探，新命令出现在响应里。签名只看 mtimeMs:size，同秒内反复写可漏判
- 探测失败：日志 `probe-fail`，10 分钟内仍返回旧值

## 会话路径（live Query，票 01）

```bash
WID=... # POST /api/workspaces {"name","folders":[{"path":"$BASE","primary":true}]}
SID=... # POST /api/sessions/spawn {"directory":"$BASE","workspaceId":"$WID"}
curl -s -H "Authorization: Bearer $JWT" "http://localhost:2224/api/sessions/$SID/metadata"
```

- 会话 `active:true` 后请求；live 路径响应含 `account`/`fastModeState`/`availableOutputStyles`
- 断言：日志无新增 `probe start`（活 Query 不需要临时 CLI）
- 若在 CLI 初始化前请求会回落探针，先等 `GET /api/sessions` 里 `active:true`

## 后台刷新节流（票 04）

`[capability] background-refresh` 只在真正发起 RPC 时打。快速连续多次 metadata GET
（会话已有 sdkMetadata 缓存）→ 30s 窗口内只 1 条；超过 30s 再请求恢复触发。

## 坑

- `lsof -ti :2224` 会把 Chrome 的 **客户端** socket 也算进来（PID 是 Google Chrome Helper），
  判断端口占用必须 `lsof -nP -iTCP:2224 -sTCP:LISTEN`
- 新 e2e 环境 `GET /api/workspaces` 返回 `{"workspaces":[]}`，需先 POST 建工作区
- workspace folder 在 home 外会 400/403；临时目录放 `~/workspace/demo/` 下
- 清尾：`e2e-cleanup.sh` 后删临时目录；`rm -rf` 可能被权限拒，需单独确认
