---
name: env-bootstrap
description: E2E 环境启动 / 清理 / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复 / hub 单独重启
metadata:
  type: recipe
  last_verified: 2026-09-10
---

# 环境启动

## 架构形态（2026-08-26 起：直跑，不经 supervisor）

hub/web/runner 均为 `start-sync` 直跑形态——bootstrap 的**直接子进程**（PID 即 bun 本体，
kill TERM 直达），PPID 看门狗保证 bootstrap 死亡时组件自杀。e2e 环境不存在 supervisor；
`mobi service *`（supervisor 托管）只属于生产 default profile。
背景：supervisor 托管形态曾在 E2E 泄漏「幽灵 supervisor」（绕过强杀子进程 + rm -rf 后
failed 态常驻且 socket 失联不可发现），累积 10 个后才根治为直跑。

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

⚠️ **seed 项目的 machineId 必须用真实机器 id**（先 `SELECT id FROM machines;` 取，或 bootstrap
就绪后从 /api/machines 读）——虚构 id（如 `m-e2e`）建出的项目在发消息建会话时报 404
`Machine not found`（spawn 按 machineId 找机器）。事后可 `UPDATE projects SET machine_id=...` 补救。

## 会话 CLI 代码新鲜度（2026-09-08）

runner spawn 的会话 CLI 是 `bun packages/cli/src/index.ts` 源码直跑，但**进程启动即固化代码**——
改 CLI 源码后，已运行的 runner / 会话 CLI 仍是旧代码。验证 CLI 侧行为变更（RPC handler、
边界校验等）前必须 cleanup + bootstrap 重启环境；否则表现为「修复无效」，极易误判为代码 bug。
判别手段：`ps -eo pid,ppid,command | grep "packages/cli/src/index.ts claude"` 看会话 CLI 启动时间。

## hub 单独重启（验证 CLI socket 断线重连，2026-09-09）

不 cleanup 整环境，只重启 hub（触发 CLI socket 断连→重连，snapshot delta 场景实测 forceFull 重发）：

1. 找 PID：`ps -eo pid,ppid,command | grep "hub start-sync"`（e2e hub 带 `--profile e2e --port 2224`；24520/66011 是用户 dev/生产 hub，禁碰）
2. `kill -TERM <pid>` → `run_in_background` 拉起同命令同 env（日志 `>>` 追加保持 stats 历史）
3. 轮询 `/health` 就绪

**坑**：Bash 工具里 `nohup ... &` 拉起的进程在**工具调用结束时被沙箱 SIGTERM 回收**（exits.log 见 signal-term、uptime ~5s）——必须用 `run_in_background: true`。

## curl 直调 hub API（不走浏览器）

`POST /api/auth` body 字段是 **`accessToken`**（不是 token）：`curl -c jar -d '{"accessToken":"e2e-test-token-mobi"}'` 换 httpOnly cookie，后续 `-b jar`。SSE 直接 `curl -N -b jar "http://localhost:2224/api/events?all=1[&snapshotDelta=1]"`（后者协商 delta，模拟新 web；缺省模拟老 web）。

## 坑（误判）

- **bootstrap 依赖 shell PATH 里的 bun** — 脚本内部裸调 `bun`；Claude 会话的 shell 常无 `~/.bun/bin`，表现为「等待 Hub 就绪超时 + 日志 `bun: command not found`」且静默失败。先 `export PATH="$HOME/.bun/bin:$PATH"` 再跑 bootstrap（2026-09-03）
- **直跑进程识别** — `ps -eo pid,ppid,command | grep start-sync`：e2e 组件 ppid 指向
  bootstrap 脚本；若 ppid 变 1 且环境应已清理，按 PID 精确 kill（禁全局 pkill）
- **bootstrap 不退出不是卡死** — 末尾 `wait` 常驻是设计（保持环境）；background 跑 + 轮询 `ready.flag`，ready 后直接用，**不等脚本退出 / stdout echo**（stdout 后台被缓冲看不到）
- **bootstrap 必须显式 `--host 127.0.0.1 --port ${HUB_PORT}`** — start-sync 直跑下参数直接生效；不带 --port 会落 profile env 兜底值，显式传作双保险
- **hub 早期 banner 端口不可信** — banner 可能打默认 2222；以 bootstrap 输出的 `HUB_PORT`=2224 为准
- **default 共存时登录 REFUSED** — 确认 e2e web 进程 `MOBI_API_URL=2224`；若显 2222（fallback），vite proxy 会连错端口 → 登录 `ERR_CONNECTION_REFUSED`
- **旧 e2e 残留进程干扰** — cleanup 已有 doctor clean（识别 runner/hub/session/supervisor 四类）+ 端口兜底 + `--profile e2e` pattern 兜底三道；仍异常手动按 PID kill
- **bootstrap 每次重启清空数据目录（2026-09-10）** — 脚本内 `rm -rf "${E2E_TMPDIR}"` 后重建：旧会话 / 项目 / 机器全丢（token 仍是 e2e-test-token-mobi），浏览器再开旧会话 URL 报 Session not found。重启环境后必须重建素材（建项目 → 建会话）；webApiToken/web 登录 cookie 也随 jwt-secret 重建失效，需重新 `/api/auth`
- **bun run 包装层 kill 后残留** — bootstrap 的 `bun run` 子进程 TERM 后可能不退出，需二段 `kill -9`（仍按精确 PID，先 grep `profile e2e|e2e-bootstrap`）
- **必须用脚本管环境** — 禁止手动 `nohup bun run dev` 或 `kill` + 手启；脚本已处理端口冲突 / profile / 进程管理
- **curl 直调生产 /api 需 JWT** — settings.json 的 webApiToken 不能直接当 Bearer 用；先 `POST /api/auth {token}` 换 cookie（`curl -c jar`）再带 jar 调用
