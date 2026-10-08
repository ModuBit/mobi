---
name: memory-verify
description: 长期记忆（hindsight）E2E 主线——fake 服务桩四场景（off/active/改设置/非法配置），断言面=mobi 侧行为
metadata:
  type: recipe
  last_verified: 2026-10-08
---

# 记忆（agent-memory）E2E 验证

一键脚本：`bash .claude/skills/run-tests/scripts/e2e-memory.sh`（前置：e2e 环境已 bootstrap；改过 daemon/session 源码先 cleanup+bootstrap）。

## 断言面（不模拟引擎语义）

- 挂载 = 会话 CLI 进程树（cli 自身或内层 claude）args 含 `--plugin-dir …/plugins/memory-hindsight`
- env 注入 = fake 服务收到 hook 请求且 `hasAuth:true`（HINDSIGHT_API_TOKEN 到达会话进程）
- 管理配置文件 = `~/.mobi-e2e/memory/hindsight/coding-agent.json` 含 bankId=mobi-personal + retainTags
- settings 开关直改 `~/.mobi-e2e/settings.daemon.json` memory 段（spawn 每次现读，「下会话生效」）

## 场景

1. off → spawn 正常、无 plugin-dir、fake 零请求
2. hindsight+fake endpoint → plugin-dir 挂载、hook 请求、token、管理配置文件
3. 旧会话发消息（hook 请求）→ 改 off → 新会话不挂载；旧会话进程存活且 hook 仍请求（env 固化）
4. engine 开但 endpoint 缺 → 会话正常启动、不挂载（fail-open）

## 坑（2026-10-08 实踩）

- **macOS bash 3.2 `$VAR` 后跟全角字符**：`（cli=$CLI2）` 会把 `）` 的字节吞进变量名报 unbound variable——非 ASCII 前必须 `${VAR}`
- **`bash -c` 子进程里脚本函数不可见**：wait_for 轮询必须用 helper 函数直调（`cli_found`/`mounted`/`log_ge`），不能 `bash -c "find_cli_pid …"`
- **lstart 日期空格补位**：`Oct␣␣8` 双空格，`date -j -f` 解析前须 `tr -s ' '` 压缩
- **回合中消息排队不触发 UserPromptSubmit hook**：连发两条消息时第二条须先轮询 `session.running=false`（60s）再发
- **上一轮残留会话污染「零请求」断言**：脚本开头按归属（daemon 直属 + `index.ts claude`）杀残留 CLI
- **debug 日志默认不落盘**（仅 ringBuffer）：诊断断言需 daemon 带 `DEBUG=1` 启动；行为断言（spawn 成功+不挂载）为主
- fake 服务：`packages/cli/scripts/fake-memory-server.ts`（默认 :3999，任意路径 200，请求 JSONL 记 `FAKE_MEMORY_LOG`）
