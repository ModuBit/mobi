---
name: retention-entrypoint-verify
description: CLAUDE_CODE_ENTRYPOINT 四组（基线/claude-desktop/3p/local-agent）E2E 与 cleanup sweep 豁免验法
metadata:
  type: recipe
  last_verified: 2026-10-30
---

# entrypoint 与 retention sweep 验证

## 验法（可复用）

**A. mobi 内跑一组会话能力**：`/tmp/e2e-entrypoint-probe/run-group.sh <label> <entrypoint|空>`
经官方 bootstrap 起环境（daemon 必须是 bootstrap 直接子进程；手工 perl setsid 双 fork 的 daemon 会被沙箱 ~5s SIGTERM，且 PPID 看门狗形态不同），
API 直调：auth → 建工作区 → spawn（permissionMode default）→ 发消息 → dormant/resume → 触发权限（**用 Write 提示词，`echo` 类命令会被自动放行，拿不到 permission 事件**）→ 点名 `change_title` 验 MCP。
SSE 权限事件在 `GET /api/events?all=1` 流里，`requestId` 正则抓 `"requestId":"..."`，再 `POST /permissions/:id/approve`。

**B. sweep 豁免（离线直跑 CLI）**：
`CLAUDE_CONFIG_DIR=<tmp> CLAUDE_CODE_ENTRYPOINT=<ep> claude -p hi`，`<tmp>/settings.json` 写 `{"cleanupPeriodDays":1}`，
把 transcript 复制到 `<tmp>/projects/<proj>/<uuid>.jsonl` 并 `touch -t` 到 10 天前。
- **CLI 必须存活 ~60s** sweep 才会跑：桩 API 每个 `/v1/messages` 延迟 60s 再返回（`PROBE_DELAY_MS`），否则 `-p` 秒退、sweep 不触发
- 首尾 4KB 内要有 `"entrypoint"` 字段（`Fme`/`L9t` 只扫 head/tail 4096B）
- 判定看文件是否还在 + `<tmp>/.last-cleanup` 是否写入

## 坑

- **宿主 env 泄漏**：mobi 会话 shell 带 `ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL/CLAUDE_CODE_*`，直接跑 E2E 会让会话走宿主网关。起 bootstrap 必须 `env -i HOME PATH USER SHELL TMPDIR LANG` 全裸。
- bootstrap 会 `rm -rf` 数据目录，脚本里 `mkdir logs` 必须放在 cleanup 之后。
- bash 3.2 + `set -u`：空数组要 `${A[@]+"${A[@]}"}`；`$VAR` 紧跟中文标点会被吞进变量名，写 `${VAR}`。
- 消息接口返回 `{messages,page}`；刚发完消息立即取 count 只看到 user 行，**等 +2** 才是「用户行 + 助手行」。
- 结论证据：`~/.claude/projects/<proj>/<nativeSessionId>.jsonl` 的 `entrypoint` 字段即 CC 实际记录值（mobi SDK 路径记录 env 值，非固定 sdk-ts）。
