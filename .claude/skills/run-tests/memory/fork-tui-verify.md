---
name: fork-tui-verify
description: 验证 mobi fork（TUI 接续）与历史 local 会话只读——fake claude 抓 argv、真实 claude 分叉、legacy local 心跳模拟
metadata:
  type: recipe
  last_verified: 2026-11-18
---

# mobi fork / 历史 local 只读 验收（tui-fork 票 08，2026-11-18 实证）

## 1. fork 抓参数（不启动真 TUI）

`fork` 走 `getClaudeExecutablePath()`：dev 态返回 `undefined`，调用方回退 PATH 的 `claude`；
但 `MOBI_CLAUDE_PATH` 是第一优先级（不做存在性校验），直接指到假脚本即可抓 argv + cwd：

```bash
cat > /tmp/fake-claude <<'EOF'
#!/bin/bash
{ echo "cwd=$(pwd)"; echo "argv=$@"; } > /tmp/fork-args.txt
exit 0
EOF
chmod +x /tmp/fake-claude
MOBI_CLAUDE_PATH=/tmp/fake-claude bun packages/cli/src/index.ts --profile e2e fork <mobi-session-id>
```

预期：`argv=--resume <nativeSessionId> --fork-session`，`cwd=<会话 metadata.path>`。
daemon 停机时同样可用（只读 SQLite）；进程仍在线会先打黄色告警再继续。

## 2. 真实 claude 分叉语义

```bash
cd ~/workspace/demo && claude --resume <nativeSessionId> --fork-session -p "只回复 OK"
```

判据（原会话不受影响 + 产生独立分支）：
- 原 transcript `~/.claude/projects/<cwd-slug>/<nativeSessionId>.jsonl` 的 size 与 mtime 前后不变
- 目录下新增一个 `<新uuid>.jsonl`（fork 分支）
- mobi DB 的 messages 行数不变；Web 会话列表不新增行

## 3. 模拟「历史 local 会话」（legacy CLI 心跳）

`mode` 不落库、只在 daemon 内存（session-alive / getOrCreateSession 注入）。所以不能靠 seed 造
local 会话，必须模拟一个「尚未升级的 local CLI」：

1. 宿主通道（端口 = 主端口 + 10000；e2e 是 **12224**，不是 2224）注册带 mode 的会话：
   ```bash
   curl -X POST http://127.0.0.1:12224/cli/sessions \
     -H "Authorization: Bearer $CLI_TOKEN" -H 'Content-Type: application/json' \
     -d '{"tag":"legacy-local-e2e","metadata":{"path":"...","nativeSessionId":"..."},"mode":"local","workspaceId":"<ws>"}'
   ```
2. socket.io 连 `<hostPort>/cli`，auth `{token, clientType:'session-scoped', sessionId}`，
   每 2s emit `session-alive {sid,time,running:false,mode:'local'}`。
   脚本见 `.scratch/tui-fork/legacy-local-alive.ts`（socket.io-client 只在 `packages/session/node_modules`，
   脚本从根目录跑要用绝对路径 import）。
3. Web 断言：会话页出现 `LocalModeCover` 文案「该会话在本地终端运行，Web 端仅可查看」，
   `[contenteditable]` 数量 0，页面全文无「切换到远程」；PC + 390×844 两档截图走查。

⚠️ daemon 重启后 mode 随内存丢失（history 行不再有只读遮罩）——这是当前设计：
只有仍在上报的 legacy CLI 才呈只读；休眠的历史 local 行会按普通会话处理。

## 4. 环境注意

- 停 daemon 保留数据：`kill -9` bootstrap 全家（79966/80004 及其子进程），或 bootstrap 已退出后清杀；
  会话 CLI 会成为孤儿（ppid=1）并自动重连，重启 daemon 后 active 恢复，可直接验证「原会话继续收发」。
- 重启 daemon/web 走 [[env-bootstrap]]「daemon 单独重启」：setsid + run_in_background，web 用
  `MOBI_API_URL=http://127.0.0.1:2224 bun run dev --profile e2e`（src/app/dev.ts）；web 刚起时
  SessionDetailPage 可能瞬时 500（vite 依赖预构建中），刷新即恢复。
