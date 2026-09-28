---
name: dev-env-restart
description: dev 环境（~/.mobi-dev，hub 2223 / web 5174）停服迁移重启 recipe；web 必须 cwd=packages/web 启动否则 vite 落 5173
metadata:
  type: recipe
  last_verified: 2026-09-28
---

# dev 环境停服迁移重启

launch.json 三件套形态：`bun packages/cli/src/index.ts --profile dev hub|runner start-sync` +
`bun packages/web/src/dev.ts --profile dev`。端口 2223 / 5174，与 default(2222/5173) 和
e2e(2224/5175) 隔离。生产 supervisor（`service supervise --sync` 无 --profile = default）**禁碰**。

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
