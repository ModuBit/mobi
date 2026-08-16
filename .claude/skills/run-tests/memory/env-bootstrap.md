---
name: env-bootstrap
description: E2E 环境启动 / 清理 / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复
metadata:
  type: recipe
  last_verified: 2026-08-15
---

# 环境启动

## 步骤

1. 清理残留：`bash .claude/skills/run-tests/scripts/e2e-cleanup.sh`
2. 后台启动（脚本前台常驻，必须 nohup &）：`nohup bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh >/dev/null 2>&1 &`
3. 轮询就绪（典型 10-20s，超时 ~60s 判失败）：
   ```bash
   for i in $(seq 1 30); do test -f ~/.mobi-e2e/ready.flag && echo READY && break; sleep 2; done
   ```
4. 确认 web 读对 profile（应含 `MOBI_API_URL=http://localhost:2224`）：
   ```bash
   grep "PROFILE" ~/.mobi-e2e/logs/web.log
   ```

## 端口隔离

| 环境 | hub | web |
|---|---|---|
| 默认 | 2222 | 5173 |
| dev | 2223 | 5174 |
| e2e | 2224 | 5175 |

default 与 e2e 端口隔离、互不冲突；冲突即环境异常。

## 故障恢复

1. cleanup：`bash .claude/skills/run-tests/scripts/e2e-cleanup.sh`
2. 端口仍占：`kill $(lsof -ti :5175)` / `kill $(lsof -ti :2224)`
3. 重新 bootstrap

## 快速造测试数据（免走真实 runner）

不需要真实对话时，直接用 hub Store 脚本往 e2e 库插数据（WAL 多进程共存，hub 无需重启；
hub 的 `getSessionsByNamespace` 每次调用都会从 DB 同步，新行即写即见）：

```ts
// /tmp/e2e-seed.ts（绝对路径导入 store）
import { Store } from '/Users/manerfan/workspace/github/modu/mobi/packages/hub/src/store'
const store = new Store(process.env.HOME + '/.mobi-e2e/mobi.db')
const p = store.projects.createProject({ namespace: 'default', machineId: 'm-e2e', name: 'X', folders: [{ path: '/tmp/x', primary: true }] })
store.sessions.getOrCreateSession('tag-a', { path: '/tmp/x', host: 'e2e', name: 'Session A' }, {}, 'default', undefined, p.id)
store.close()
```

`bun /tmp/e2e-seed.ts` 后浏览器刷新即见。机器无需在线（列表/置顶/归组等纯 DB 链路均可用）。

## 坑（误判）

- **偶发：hub 以 `start-sync` 直跑形态残留、脱离 supervisor 托管（2026-08-16 踩过）** — bootstrap 的 `mobi hub start` 竞态产物：一个 hub 变成直跑 `start-sync` 进程（不在 supervisor desired 集内），cleanup 的 `service stop`（IPC）管不到它；后续 supervisor 托管链的 hub 反复撞它端口 EADDRINUSE 秒退（exits.log 连续 error-exit code 1 可辨）。**判定**：`lsof -nP -iTCP:2224 -sTCP:LISTEN` + `ps -p <PID> -o command=` 看是 `hub start-sync` 直跑即中招。**处置**：按 PID 精确 kill（纪律：禁全局 pkill）后，**不必重跑 bootstrap**——存活的 supervisor 退避重试链会在数秒内自己占住端口拉起托管 hub（2026-08-16 二次复现验证）；kill 后 `lsof -nP -iTCP:2224 -sTCP:LISTEN` + 确认新 hub 的 ppid 是本环境 supervisor 即恢复。READY 之后顺手 lsof 一次可提前发现

- **bootstrap 不退出不是卡死** — 末尾 `wait` 常驻是设计（保持环境）；background 跑 + 轮询 `ready.flag`，ready 后直接用，**不等脚本退出 / stdout echo**（stdout 后台被缓冲看不到）
- **supervised 架构下 hub start 必须显式 `--port`（2026-08-15 踩坑，产品层已根治）** — `mobi hub start` 走 supervisor 托管，端口来自 desired state；踩坑当时兜底硬编码 2222（default 环境端口）会撞端口 + 健康门假通过。**产品层已修**：desired state 兜底感知 profile env（`MOBI_LISTEN_PORT`），不带 `--port` 也能落在 2224（已冒烟验证）。bootstrap 脚本仍显式传 `--host 127.0.0.1 --port ${HUB_PORT}` 作双保险；cleanup 已加 `service stop` 且**先于** `e2e_stop_runner` 执行（先 kill runner 会被 supervisor 退避重启拉回，端口竞态）
- **hub 早期 banner 端口不可信** — banner 可能打默认 2222；以 bootstrap 输出的 `HUB_PORT`=2224 为准
- **default 共存时登录 REFUSED** — 确认 e2e web 进程 `MOBI_API_URL=2224`；若显 2222（fallback），vite proxy 会连错端口 → 登录 `ERR_CONNECTION_REFUSED`
- **旧 e2e 残留进程干扰** — cleanup 已加 `--profile e2e` pattern 兜底；仍异常手动 `pkill -f -- '--profile e2e'`
- **必须用脚本管环境** — 禁止手动 `nohup bun run dev` 或 `kill` + 手启；脚本已处理端口冲突 / profile / 进程管理
- **curl 直调生产 /api 需 JWT** — settings.json 的 webApiToken 不能直接当 Bearer 用；先 `POST /api/auth {token}` 换 cookie（`curl -c jar`）再带 jar 调用
