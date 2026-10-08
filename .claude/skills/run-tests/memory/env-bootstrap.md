---
name: env-bootstrap
description: E2E 环境启动 / 清理 / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复 / daemon 单独重启
metadata:
  type: recipe
  last_verified: 2026-10-07
---

# 环境启动

## 架构形态（2026-10-03 起：daemon 同进程直跑，不经 supervisor）

bootstrap 起 **daemon start-sync 单进程**（原 hub+runner 已合并，ticket-16 起），加 web dev server。
daemon 是 bootstrap 的**直接子进程**（PID 即 bun 本体，kill TERM 直达），PPID 看门狗保证
bootstrap 死亡时组件自杀。就绪判据 = `/health` + `daemon.state.json`（pid/runnerHttpPort）
写入且 pid 存活。日志落 `logs/daemon.log`（2026-10-04 起，原 hub.log）。会话 CLI 由
daemon 进程内 spawn（ppid=daemon）。
e2e 环境默认无 supervisor；但 R15 类验证用 supervisor 形态（见下方 supervisor 段）。
背景：supervisor 托管形态曾在 E2E 泄漏「幽灵 supervisor」（绕过强杀子进程 + rm -rf 后
failed 态常驻且 socket 失联不可发现），累积 10 个后才根治为直跑。

## supervisor 形态（R15 验证用，2026-10-03 实证）

直跑环境清掉后：
1. `setsid + run_in_background` 起 `bun run packages/cli/src/index.ts --profile e2e service supervise --sync`（日志 >> ~/.mobi-e2e/logs/supervisor.log）
2. `mobi --profile e2e service daemon start --host 127.0.0.1 --port 2224`（默认托管 daemon 组件）
3. `kill -TERM <daemon pid>` → supervisor 数秒内重拉（daemon.state.json pid 翻新）；会话进程 PID 不变（孤儿化 ppid→1）且重连后 active 恢复
4. `service stop` 收尾（scope=daemon）；空 `service shutdown` 报「顶层命令是别名」——直接 kill supervisor PID

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

| 环境 | daemon | web |
|---|---|---|
| 默认 | 2222 | 5173 |
| dev | 2223 | 5174 |
| e2e | 2224 | 5175 |

default 与 e2e 端口隔离、互不冲突；冲突即环境异常。

**宿主 env 泄漏盖过 profile（2026-10-07 实踩）**：在 mobi Web 会话里跑
`smoke.sh`，宿主导出的 `MOBI_LISTEN_PORT=2222` 优先级高于 `--profile e2e`
的 2224，daemon 落 2222 撞生产实例（报 `Is port 2222 in use?` 启动超时）。
解法：`env -u MOBI_LISTEN_PORT -u MOBI_API_URL .claude/skills/run-tests/scripts/smoke.sh --source`。
凡在 mobi 宿主会话内起 e2e 组件，先剥离 MOBI_LISTEN_PORT / MOBI_API_URL。

## 故障恢复

1. cleanup：`bash .claude/skills/run-tests/scripts/e2e-cleanup.sh`
2. 端口仍占：`kill $(lsof -ti :5175)` / `kill $(lsof -ti :2224)`
3. 重新 bootstrap

## 快速造测试数据（免真实对话）

不需要真实对话时，直接用 daemon Store 脚本往 e2e 库插数据（WAL 多进程共存，daemon 无需重启；
`getSessionsByNamespace` 每次调用都会从 DB 同步，新行即写即见）：

```ts
// /tmp/e2e-seed.ts（绝对路径导入 store）
import { Store } from '/Users/manerfan/workspace/github/modu/mobi/packages/daemon/src/store'
const store = new Store(process.env.HOME + '/.mobi-e2e/mobi.db')
const w = store.workspaces.createWorkspace({ namespace: 'default', name: 'X', folders: [{ path: '/tmp/x', primary: true }] })
store.sessions.getOrCreateSession('tag-a', { path: '/tmp/x', host: 'e2e', name: 'Session A' }, {}, 'default', undefined, w.id)
store.close()
```

`bun /tmp/e2e-seed.ts` 后浏览器刷新即见（machine 概念 2026-10-06 已彻底移除：工作区无 machineId、machines 表不存在，seed 不再需要机器在线）。

⚠️ **seed 工作区的 folder 路径必须在机器 homeDir 之内**（如 `~/workspace/demo`）——上传端点有
`validateHomeDirPath` 安全校验，home 外路径（如 `/tmp/x`）返回 403（2026-09-19 画板 E2E 实测，
根因是 seed 数据而非代码）；spawn 也会因 primary folder 不存在/越界失败（④门演练实测
`Primary folder does not exist: /tmp/x`）。session 内上传不受此限（走 session 通道）。

## 会话 CLI 代码新鲜度（2026-09-08）

daemon spawn 的会话 CLI 是 `bun packages/cli/src/index.ts` 源码直跑，但**进程启动即固化代码**——
改 CLI 源码后，已运行的 daemon / 会话 CLI 仍是旧代码。验证 CLI 侧行为变更（RPC handler、
边界校验等）前必须 cleanup + bootstrap 重启环境；否则表现为「修复无效」，极易误判为代码 bug。
判别手段：`ps -eo pid,ppid,command | grep "packages/cli/src/index.ts claude"` 看会话 CLI 启动时间。

## daemon 单独重启（保留数据目录）

不 cleanup 整环境，只重启 daemon（触发 CLI socket 断连→重连，snapshot delta 场景实测 forceFull 重发）。
**改了 daemon / session 模块源码后验新逻辑走这条**——cleanup+bootstrap 会清空数据目录，项目/会话
全丢要重建；只重启 daemon 则数据目录保留，已有会话的 CLI 重连后依旧 active（2026-09-12 实测）。
（审查 RPC 曾在独立 runner 进程执行、需单独重启 runner——ticket-16 起 runner 并入 daemon，
重启 daemon 即可，原 runner 单独重启段已失效删除。）

⚠️ **前提：bootstrap 已退出（2026-10-09 实测）**。bootstrap 常驻（末尾 `wait`）期间 kill 它的
daemon 子进程 → `wait` 返回 → 脚本退出路径触发 trap 清理，**整个数据目录被 rm**（`~/.mobi-e2e/logs`
连同消失，重启后现起 daemon 会因日志重定向目录不存在直接退出 1）。bootstrap 还活着时没有
「只重启 daemon」——要么等/杀 bootstrap 后自管 daemon，要么接受清空走完整 bootstrap 重建素材。

1. 找 PID：`ps -eo pid,ppid,command | grep -E "profile e2e|2224" | grep -v grep`
   （e2e 两件套：daemon / `bun run dev`；生产 daemon 是 `~/.local/bin/mobi`，**禁碰**）
2. `kill -TERM <daemon pid>` → 轮询 `lsof -nP -iTCP:2224 -sTCP:LISTEN` 直到端口释放（实测 1s）
3. `run_in_background` 套 **setsid** 拉起同命令，日志 `>> logs/daemon.log` 追加：
   `perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' bash -c 'exec bun run <repo>/packages/cli/src/index.ts --profile e2e daemon start-sync --host 127.0.0.1 --port 2224 >>"$HOME/.mobi-e2e/logs/daemon.log" 2>&1'`
4. 轮询 `/health` 就绪

§ 重启后的 daemon 父进程不是 bootstrap，`ready.flag` 也早就在——**别拿 ready.flag 判断**，直接 `curl /health`。
§ cleanup 仍能找到它（pattern 兜底按 `--profile e2e` 匹配），不用手工收尾。

**坑**：Bash 工具里 `nohup ... &` 拉起的进程在**工具调用结束时被沙箱 SIGTERM 回收**（exits.log 见 signal-term、uptime ~5s）——必须用 `run_in_background: true` 且**套 setsid**（与 bootstrap 同理，见下方坑表）。

## curl 直调 daemon API（不走浏览器）

`POST /api/auth` body 字段是 **`accessToken`**（不是 token）：`curl -c jar -d '{"accessToken":"e2e-test-token-mobi"}'` 换 httpOnly cookie，后续 `-b jar`。SSE 直接 `curl -N -b jar "http://localhost:2224/api/events?all=1[&snapshotDelta=1]"`（后者协商 delta，模拟新 web；缺省模拟老 web）。

## 坑（误判）

- **bootstrap 依赖 shell PATH 里的 bun** — 脚本内部裸调 `bun`；Claude 会话的 shell 常无 `~/.bun/bin`，表现为「等待 Daemon 就绪超时 + 日志 `bun: command not found`」且静默失败。先 `export PATH="$HOME/.bun/bin:$PATH"` 再跑 bootstrap（2026-09-03）
- **bootstrap 被沙箱按进程组回收（2026-09-11）** — 工具调用结束时沙箱可能 SIGTERM 整个进程组：`nohup &` 内联跑和 `run_in_background` 跑都被回收过（脚本有 TERM trap → cleanup → exit 0，exits.log 见 signal-term，uptime 10-40s 不等；同形状调用存活与否不确定）。**稳定解法：`perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' bash …/e2e-bootstrap.sh`**——setsid 脱离进程组，组杀不可及；READY 后必须 `curl /health` 复核 daemon 真活
- **setsid 也必须配 run_in_background（2026-10-02 实证）** — daemon 单独重启时在普通 Bash 调用里 `perl setsid … &` 拉起，health 曾就绪、API 短暂可用，~1 分钟后仍被沙箱回收（页面报 Session not found → 接着连接拒绝）。**setsid + `run_in_background: true` 双保险缺一不可**；拉起后隔 20s 再 `curl /health` 复核一次才可信
- **直跑进程识别** — `ps -eo pid,ppid,command | grep start-sync`：e2e 组件 ppid 指向
  bootstrap 脚本；若 ppid 变 1 且环境应已清理，按 PID 精确 kill（禁全局 pkill）
- **bootstrap 不退出不是卡死** — 末尾 `wait` 常驻是设计（保持环境）；background 跑 + 轮询 `ready.flag`，ready 后直接用，**不等脚本退出 / stdout echo**（stdout 后台被缓冲看不到）
- **bootstrap 必须显式 `--host 127.0.0.1 --port ${DAEMON_PORT}`** — start-sync 直跑下参数直接生效；不带 --port 会落 profile env 兜底值，显式传作双保险
- **daemon 早期 banner 端口不可信** — banner 可能打默认 2222；以 bootstrap 输出的 `DAEMON_PORT`=2224 为准
- **default 共存时登录 REFUSED** — 确认 e2e web 进程 `MOBI_API_URL=2224`；若显 2222（fallback），vite proxy 会连错端口 → 登录 `ERR_CONNECTION_REFUSED`
- **旧 e2e 残留进程干扰** — cleanup 已有 doctor clean（识别 daemon/session/supervisor 等）+ 端口兜底 + `--profile e2e` pattern 兜底三道；仍异常手动按 PID kill
- **bootstrap 每次重启清空数据目录（2026-09-10）** — 脚本内 `rm -rf "${E2E_TMPDIR}"` 后重建：旧会话 / 项目 / 机器全丢（token 仍是 e2e-test-token-mobi），浏览器再开旧会话 URL 报 Session not found。重启环境后必须重建素材（建项目 → 建会话）；webApiToken/web 登录 cookie 也随 jwt-secret 重建失效，需重新 `/api/auth`
- **bun run 包装层 kill 后残留** — bootstrap 的 `bun run` 子进程 TERM 后可能不退出，需二段 `kill -9`（仍按精确 PID，先 grep `profile e2e|e2e-bootstrap`）
- **必须用脚本管环境** — 禁止手动 `nohup bun run dev` 或 `kill` + 手启；脚本已处理端口冲突 / profile / 进程管理
- **curl 直调生产 /api 需 JWT** — settings.json 的 webApiToken 不能直接当 Bearer 用；先 `POST /api/auth {token}` 换 cookie（`curl -c jar`）再带 jar 调用
