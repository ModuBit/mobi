# E2E 测试指南

> **操作 recipe 与踩坑记录已迁至 `../memory/`**（每次 E2E 前先读 `memory/MEMORY.md`，照已知 recipe 走）。本文件只保留**稳定的原则、流程与命令参考**——不重复 memory 的内容，避免两处失同步。

## 核心原则

**E2E 测试 = 模拟真实用户行为。所有操作必须通过浏览器完成。**

禁止的行为：
- ❌ 用 curl/脚本直接调 Hub API 创建会话、注入数据
- ❌ 用 `evaluate_script` 修改前端状态或 localStorage
- ❌ 跳过浏览器 UI，绕过正常用户操作流程
- ❌ 把调试排错当成 E2E 测试（数据没出现时应该排查代码，不是注入数据）

正确的行为：
- ✅ 通过浏览器 UI 登录、创建会话、发送消息
- ✅ 等待真实响应，验证页面上的实际渲染结果
- ✅ 用 `take_snapshot` / `take_screenshot` 观察页面状态
- ✅ 遇到数据缺失时，回到代码排查问题，修复后重新走完整用户流程

## 什么时候需要 E2E

不是只有 UI 变更才需要 E2E。任何可能影响用户通过 Web 使用 Mobi 的改动，都应该跑 E2E 验证：

- **Web 前端变更** → 需要 E2E
- **Hub API/协议变更** → 需要 E2E（前端依赖这些接口）
- **CLI/Runner 变更** → 需要 E2E（会话创建和管理走 Runner）
- **Shared 协议/Schema 变更** → 需要 E2E（影响前后端通信）
- **仅内部工具/构建脚本变更** → 跳过 E2E
- **用户明确要求 E2E** → 执行

判断原则：改动的代码是否影响用户在浏览器中看到的页面行为或数据流？如果影响，就跑 E2E。

## 1. 环境准备

先清理残留，再启动新环境（脚本会处理端口冲突、profile、进程管理，**禁止手动 `nohup bun run dev` / `kill`**）：

```bash
bash .claude/skills/run-tests/scripts/e2e-cleanup.sh
nohup bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh >/dev/null 2>&1 &
```

就绪判断：轮询 `~/.mobi-e2e/ready.flag`（**不要等脚本退出 / stdout echo**，bootstrap 常驻 `wait` 不退出）：

```bash
for i in $(seq 1 30); do test -f ~/.mobi-e2e/ready.flag && echo "READY" && break; sleep 2; done
```

超时（~60s）无 ready.flag → 启动失败，查日志 `~/.mobi-e2e/logs/`（hub.log / web.log / runner.log）。

> 启动细节、profile 检查、端口隔离表、故障恢复、常见误判 → 见 `memory/env-bootstrap.md`

## 2. 浏览器操作

只用 Chrome DevTools MCP 工具操作浏览器（不要用 `analyze_image` 等访问 localhost）。

> 连接 / 复用 / 僵尸进程清理 → 见 `memory/browser-connect.md`
> 登录、创建会话、对话验证、输入框操作 → 见 `memory/` 对应文件

## 3. 清理

验证完成后：

1. `list_pages` 找到测试页 → `close_page` 关闭
2. 清理环境：`bash .claude/skills/run-tests/scripts/e2e-cleanup.sh`

## 配置

E2E profile 配置位于 `~/.mobi/profiles/e2e.env`，定义了端口、数据目录和 API Token（`e2e-test-token-mobi`）。token 用途与诊断命令见 `memory/pitfalls-general.md`。
