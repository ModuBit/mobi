---
name: pitfalls-general
description: 跨任务通用误判（token 用途、诊断命令、工具禁用）
metadata:
  type: pitfall
  last_verified: 2026-07-29
---

# 通用误判

## token 用途（易用错）

E2E 环境 `cliApiToken` 与 `webApiToken` **同值**（`e2e-test-token-mobi`，见 `profiles/e2e.env`）。在 web 登录框输入 → 被 `/api/auth` 当 **webApiToken** 校验。**不能**直接当 `Authorization: Bearer` 去 curl API（API 需 web 登录换取的 JWT）。诊断 API 用 `/api/health`（免 token）或先登录拿 JWT 再查。

## 诊断命令（环境异常时查，不要猜）

- 端口监听：`lsof -nP -iTCP:2224 -sTCP:LISTEN`（2224=hub, 5175=web；`-nP` 避免 DNS / 端口名解析干扰）
- 进程身份：`ps -p <PID> -o command=`
- 日志：`cat ~/.mobi-e2e/logs/{hub,web,runner}.log`
- 就绪信号：`test -f ~/.mobi-e2e/ready.flag && echo ready`

## 工具禁用

- **不用 `analyze_image` 等工具访问 localhost** — 不支持 localhost URL
- **不用 `evaluate_script` 改前端状态 / localStorage** — 违反 E2E 模拟真实用户原则
- **不用 curl / 脚本直接调 Hub API 造数据** — 必须走浏览器 UI
