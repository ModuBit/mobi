---
name: spawn-chain-timing
description: spawn/首响应链路分段计时 recipe——API 计时 + 子进程 lstart 定位，非侵入诊断
metadata:
  type: recipe
  last_verified: 2026-10-29
---

# spawn 链路计时（诊断建环用）

不跑真实对话也可测的分段计时，用于「创建慢/首响应慢/唤醒慢」类诊断：

```bash
# 登录（POST /api/auth 体是 {accessToken} 不是 {token}；响应包 {token,user}）
curl -s -c jar -X POST $BASE/api/auth -d '{"accessToken":"<webApiToken>"}'
# 计时 spawn（响应体 {type:'success',sessionId}，HTTP 恒 200 需读 body）
curl -s -b jar -w "%{time_total}" -X POST $BASE/sessions/spawn \
  -d '{"directory":"...","workspaceId":"..."}'
# 工作区响应包 {workspaces:[...]}（创建包 {workspace:{...}}）
```

- **子进程真实启动时刻用 `ps -o lstart`**，别用日志文件名/文件创建时间——logger 文件懒创建
  （首个 INFO 写入才建，生产 cli 日志首行=IdleTimer=bootstrap 尾段），文件名时间 ≠ 进程启动。
- **消息表 role 在 `json_extract(content,'$.role')`，值为 `user|agent|system`**——轮询脚本判
  `== 'assistant'` 恒空转 180s 假超时（2026-10-29 实踩，整个「3 分钟卡顿」结论全是它+调用
  队列延迟联合造的假象）。
- **bash 工具调用实际开始时刻不可假设**（可能排队），测时延一律在脚本内打 `date +%H:%M:%S`。
- 生产 daemon stdout→/dev/null、debug 级别不落盘——**prod spawn/dormancy 事故日志不可考**，
  诊断要么在 e2e 复现要么先加落盘观测。
- 二进制 daemon（~/.local/bin/mobi）用 perl 双 fork 孤儿化会被会话清理掉（源码 bootstrap 同法
  却能活，原因未明）；要跨调用存活一律走 Bash run_in_background 受管任务。
- 基线（2026-10-29，干净 e2e）：spawn HTTP 0.3–0.9s；spawn→发消息→首条真实模型回复 1–10s；
  demo 目录与 mobi 仓库 cwd（含项目 MCP/CLAUDE.md）无显著差异；源码 vs dist-exe 二进制无差异。
