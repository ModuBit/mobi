---
name: dev-env-restart
description: dev 环境（~/.mobi-dev，daemon 2223 / web 5174）停服迁移重启 recipe；web 必须 cwd=packages/web 启动否则 vite 落 5173；凭据丢失后的自愈恢复法
metadata:
  type: recipe
  last_verified: 2026-10-12
---

# dev 环境停服迁移重启

launch.json 三件套形态：`bun packages/cli/src/index.ts --profile dev daemon start-sync` +
`bun packages/web/src/app/dev.ts --profile dev`（**2026-10-12 起 web 入口在 `src/app/dev.ts`**，
票 02 大迁移搬过家，launch.json 曾漏改导致 VS Code web 调试起不来）。端口 2223 / 5174，与
default(2222/5173) 和 e2e(2224/5175) 隔离。生产 supervisor（`service supervise --sync` 无
--profile = default）**禁碰**。

## dev 凭据丢失：症状与自愈（2026-10-12 实测）

**症状**：`~/.mobi-dev` 只剩 `cleanup.sh` / `logs/` / `runtime/` / `supervisor*.{json,sock}`——
`settings.cli.json`、`settings.daemon.json`、`mobi.db` 全无。VS Code 起 daemon（launch.json，
非 TTY）当帧崩：`exits.log` 记 `crash-unhandled: CLI_API_TOKEN is required`，栈顶
`initializeToken (cli/src/ui/tokenInit.ts)` ← `commands/daemon.ts:62`。
（该目录形态与手跑一次 `~/.mobi-dev/cleanup.sh` 的结果一致：它保留自身与 `settings.json`，
而配置拆分后 token 已改名 `settings.cli.json`，不再受保护 → 被一并删掉。执行者无法坐实。）

**为什么卡死**：`daemon start-sync` 先 `initializeToken()`（要 token）才起 daemon，而
daemon 首启才会 `getOrCreateCliApiToken` 生成并回写 co-located `settings.cli.json`
（daemon/src/configuration.ts `syncCliApiTokenToCoLocated`）——**先有鸡还是先有蛋**。
非 TTY（VS Code / 脚本）不会走交互提示，直接抛错。e2e 用 `CLI_API_TOKEN` env 供 token，
生产是 setup 过的，所以只有 dev profile 会踩到。

**恢复（一次性，之后自愈）**：

```bash
CLI_API_TOKEN=$(openssl rand -hex 16) nohup bun packages/cli/src/index.ts \
  --profile dev daemon start-sync > /tmp/dev.log 2>&1 &
# daemon 自建 settings.daemon.json + 生成 webApiToken + 回写 settings.cli.json + 建空 mobi.db
```

随后 `curl -m5 http://127.0.0.1:2223/health` → `{"status":"ok",...}`。
下次不带 env 直接启也能从 `settings.daemon.json` 读到 token（日志会打
`CLI_API_TOKEN: loaded from settings.daemon.json`）。**旧的 dev mobi.db 无法找回**（无 .bak）。

## 坑

- **在 mobi 会话内跑 dev daemon，宿主注入的 `MOBI_*` 会顶掉 profile 值**（2026-10-12 实踩）：
  profile 只填未设置的变量。会话里天然带 `MOBI_LISTEN_PORT=2222` / `MOBI_LISTEN_HOST` /
  `MOBI_API_URL`，于是 `--profile dev` 起来仍去抢 2222 → `Failed to start server. Is port
  2222 in use?`，且这次启动把 `listenPort: 2222` **写进了 settings.daemon.json**（须手工改回
  2223）。在会话内验证 dev 要 `env -u MOBI_LISTEN_PORT -u MOBI_LISTEN_HOST -u MOBI_API_URL`。
  用户自己的终端无这些变量（`env -i /bin/zsh -lc 'env | grep ^MOBI'` 为空）。
- **`bun run dev` 曾经跑的是生产 home（已修 2026-10-12）**：根脚本原不带 `--profile`，
  `dev:hub` 直跑 `src/daemonEntry.ts`，MOBI_HOME 落默认 `~/.mobi`（**生产 home**）、端口 2222，
  与生产 daemon 撞端口。现 `packages/daemon` 的 dev 脚本改为
  `bun run --watch --preload ./scripts/preloadProfile.ts src/daemonEntry.ts --profile dev`。
  **preload 不是装饰**：daemonEntry 静态 import `configuration`（模块求值即读 process.env），
  它自己没机会先加载 profile；也不能改走 CLI 形态——`bun --watch` **不跟踪运行时动态 import**，
  走 `cli/src/index.ts ... daemon start-sync` 会让 daemon 源码的改动不再触发热重载
  （2026-10-12 实测：改 `daemon/src/server.ts` 原形态重启、CLI 形态纹丝不动）。
- **web 必须 cwd=`packages/web` 启动（2026-09-28 实踩）** — `dev.ts` 里 `createServer()` 无 root
  参数，vite 按 **process.cwd()** 找 vite.config.ts；从仓库根跑时找不到 config → 静默用 vite
  默认值（port 5173、无 proxy），且 profile 注入的 `MOBI_WEB_PORT` 完全不生效（连显式 env
  `MOBI_WEB_PORT=5174` 也无效，因为 config 文件本身没被加载）。表现为「PROFILE 日志说 5174、
  vite 起在 5173」。VS Code launch.json 的 web 配置带 `cwd: packages/web` 所以从没暴露
- runner 起来后 machines 列表 active 需十几秒；session 页历史消息加载是最终验证点


## 步骤（2026-09-28 工作区更名迁移实测）

1. 侦察：`ps -eo pid,ppid,command | grep -E "profile dev|packages/(cli/src/index|web/src/dev)"`，
   按 PID 精确 kill -TERM（dev hub/runner 常不在跑，只有 web 由 VS Code 持有）
2. 迁移：`bun scripts/migrate-workspaces.ts ~/.mobi-dev/mobi.db`（自带 WAL checkpoint + 备份 +
   三形态兼容：group_key / projects 旧命名 / 已 workspace，幂等）
3. 启动：三件套各自 **run_in_background + setsid**（防沙箱回收），env：hub 加
   `MOBI_LISTEN_HOST=0.0.0.0`，web 加 `MOBI_DEV_HTTPS=0`
4. 验证：`curl :2223/health`；web token 在 `~/.mobi-dev/settings.hub.json` 的
   `webApiToken`（注意：**不是** settings.json，见 [[dev-login]]）；`/api/auth` 换 cookie 后
   curl `/api/workspaces` 与 `/api/workspaces/:id/sessions`

## 坑

- **web 必须 cwd=`packages/web` 启动（2026-09-28 实踩）** — `dev.ts` 里 `createServer()` 无 root
  参数，vite 按 **process.cwd()** 找 vite.config.ts；从仓库根跑时找不到 config → 静默用 vite
  默认值（port 5173、无 proxy），且 profile 注入的 `MOBI_WEB_PORT` 完全不生效（连显式 env
  `MOBI_WEB_PORT=5174` 也无效，因为 config 文件本身没被加载）。表现为「PROFILE 日志说 5174、
  vite 起在 5173」。VS Code launch.json 的 web 配置带 `cwd: packages/web` 所以从没暴露
- runner 起来后 machines 列表 active 需十几秒；session 页历史消息加载是最终验证点
