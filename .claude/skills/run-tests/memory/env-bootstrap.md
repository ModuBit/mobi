---
name: env-bootstrap
description: E2E 环境启动 / 清理 / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复
metadata:
  type: recipe
  last_verified: 2026-07-29
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

## 坑（误判）

- **bootstrap 不退出不是卡死** — 末尾 `wait` 常驻是设计（保持环境）；background 跑 + 轮询 `ready.flag`，ready 后直接用，**不等脚本退出 / stdout echo**（stdout 后台被缓冲看不到）
- **hub 早期 banner 端口不可信** — banner 可能打默认 2222；以 bootstrap 输出的 `HUB_PORT`=2224 为准
- **default 共存时登录 REFUSED** — 确认 e2e web 进程 `MOBI_API_URL=2224`；若显 2222（fallback），vite proxy 会连错端口 → 登录 `ERR_CONNECTION_REFUSED`
- **旧 e2e 残留进程干扰** — cleanup 已加 `--profile e2e` pattern 兜底；仍异常手动 `pkill -f -- '--profile e2e'`
- **必须用脚本管环境** — 禁止手动 `nohup bun run dev` 或 `kill` + 手启；脚本已处理端口冲突 / profile / 进程管理
