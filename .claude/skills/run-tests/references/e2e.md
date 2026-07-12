# E2E 测试指南

E2E 脚本位于 skill 目录的 `scripts/` 下，使用 Chrome DevTools MCP 工具操作浏览器。

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

先清理可能残留的旧环境，再启动新环境（bootstrap 脚本会检查端口冲突，旧环境会导致启动失败）：

```bash
# 清理残留环境（含 --profile e2e 旧进程 pattern 兜底，彻底清）
bash .claude/skills/run-tests/scripts/e2e-cleanup.sh

# 后台启动 E2E 环境（Hub + Web + Runner）
nohup bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh >/dev/null 2>&1 &
```

**⚠️ bootstrap 脚本是前台常驻设计**（末尾 `wait` 保持环境运行，Ctrl+C 触发 cleanup）。所以：
- **必须 nohup ... & 后台跑**（否则阻塞）
- **判断就绪：轮询 `~/.mobi-e2e/ready.flag`**（`test -f ~/.mobi-e2e/ready.flag`），**不要等脚本退出/stdout echo**——脚本常驻不退出，stdout 在后台被缓冲看不到
- 超时（约 60s）仍无 ready.flag 则判定启动失败，查日志 `~/.mobi-e2e/logs/`（hub.log/web.log/runner.log）定位

```bash
# 轮询就绪（典型 10-20s）
for i in $(seq 1 30); do test -f ~/.mobi-e2e/ready.flag && echo "READY" && break; sleep 2; done
```

### default 环境隔离（重要）

mobi 有三套端口（default 2222/5173、dev 2223/5174、e2e 2224/5175）。**default 环境（你日常运行的 mobi）和 e2e 端口隔离，互不冲突**。但需确认 e2e web 进程读到正确的 `MOBI_API_URL=2224`（而非 default 的 2222）：

```bash
# 确认 web 进程 PROFILE（应显示 MOBI_API_URL=http://localhost:2224）
grep "PROFILE" ~/.mobi-e2e/logs/web.log
```

若显示 `2222`（fallback），说明 vite 没读到 profile env，proxy 会连错端口 → 登录 `ERR_CONNECTION_REFUSED`。

### 环境操作规范（重要）

- **启动/重启必须使用脚本**：禁止手动 `nohup bun run dev` 或 `kill` + 手动启动。脚本已处理端口冲突、profile 加载、进程管理等所有边界情况，手动操作必然踩坑
- **修改代码后**：Vite 支持源码 HMR，大多数改动自动热更新；但如果 i18n JSON 翻译未生效，需要刷新浏览器页面（`navigate_page` 重新加载）
- **故障排查**：先看脚本日志 `~/.mobi-e2e/logs/` 下的文件，不要猜测原因

### 环境故障恢复

测试过程中环境可能出问题（Hub 挂掉、端口被占等）。恢复步骤：

1. 先执行 cleanup：`bash .claude/skills/run-tests/scripts/e2e-cleanup.sh`
2. 如果端口仍被占用，手动 kill：`kill $(lsof -ti :5175)` 或 `kill $(lsof -ti :2224)`
3. 重新 bootstrap

**这一步不可跳过。每次进入 E2E 流程时都必须执行。**

## 2. 浏览器连接

Chrome DevTools MCP 首次调用时自动启动 Chrome，后续复用。按以下顺序尝试：

1. **尝试 `new_page` 打开目标 URL** — 大多数情况下直接成功
2. **如果报错 "browser already running"** — 上个会话的 Chrome 还在运行：
   - 先尝试 `list_pages`，如果能连上，说明 MCP 还能控制这个浏览器
   - 用 `close_page` 关闭不需要的页面，再用 `new_page` 打开目标 URL
   - 或者直接用 `navigate_page` 在已有页面上导航到目标 URL
3. **如果 `list_pages` 也连不上** — 浏览器进程僵死了，需要手动清理：
   ```bash
   pkill -f 'chrome-devtools-mcp/chrome-profile'
   ```
   然后重试 `new_page`

## 3. 页面操作规范

只用 Chrome DevTools MCP 工具操作浏览器。不要用 `analyze_image` 等工具访问 localhost 页面（它们不支持 localhost URL）。

**核心操作模式：**

| 操作 | 方法 |
|------|------|
| 打开页面 | `new_page` → URL |
| 查看页面状态 | `take_snapshot`（优先）或 `take_screenshot` |
| 等待状态变化 | `take_snapshot` 轮询（不要用 `wait_for`，文本匹配不可靠） |
| 输入文本 | `click` 聚焦 → `press_key Control+A` → `type_text` 输入 |
| 点击按钮 | `click` |
| 提交表单 | `type_text` 带 `submitKey: Enter` |

**输入框操作的正确步骤：**

1. `click` 目标输入框（使其获得焦点）
2. `press_key Control+A`（全选，清空已有内容）
3. `type_text` 输入新内容

不要使用 `fill` — 它对自定义输入框经常超时失败。不要直接 `type_text` 不全选 — 它会追加而非替换，导致内容重复。

## 4. 典型验证流程

使用 profile `e2e` 中的 token `e2e-test-token-mobi`。

> **⚠️ token 用途（重要，勿用错）**：E2E 环境 `cliApiToken` 与 `webApiToken` **同值**（均为 `e2e-test-token-mobi`，见 `profiles/e2e.env`）。在 web 登录框输入它，会被 `/api/auth` 当作 **webApiToken** 校验（双密钥后 `/api/auth` 不再接受 cliApiToken）。**不能**直接当 `Authorization: Bearer` 去 curl API（API 需要的是 web 登录后换取的 JWT）。诊断 API 用 health 端点（`/api/health`，不需 token）或先登录拿 JWT 再查询。

### 完整用户流程

1. **登录**（步骤固定，避免自定义输入框超时）
   - `new_page` 打开 `http://localhost:5175` → 自动跳转到 `/login`
   - `click` Access Token 输入框（聚焦）
   - `press_key Control+A`（清空，输入框初始为空也执行，稳妥）
   - `type_text` 输入 `e2e-test-token-mobi`（**不带 `submitKey`**——Enter 在这个自定义输入框常不触发提交，输入完无反应）
   - `click` "Connect" 按钮提交（**显式点按钮，不依赖 Enter**）
   - **禁用 `fill`**——对自定义输入框常超时失败
   - 验证跳转：`take_snapshot` 确认 URL 变为 `/sessions/new`（或 `/sessions`）。Connect 按钮变 `loading` 后通常 1-2s 跳转；若卡 loading 超过 5s，查 `list_network_requests` 看 `POST /api/auth` 是否 `ERR_CONNECTION_REFUSED`（proxy env 问题，见 default 隔离）

2. **创建会话**
   - 点击 "新建会话"
   - 选择机器（点击下拉列表选择）
   - 输入工作目录（必须选择 home 目录下的路径，如 `/Users/<user>/workspace/demo`，`/tmp` 等不在 home 下的路径会被 403 拒绝）
   - 点击 "创建会话"

3. **对话交互**
   - 在聊天输入框中发送消息
   - 等待 Claude 思考和回复（用 `take_snapshot` 轮询）
   - 如遇权限请求，在浏览器中点击"允许"或"本次会话允许"
   - 验证消息正常渲染

4. **验证特定功能**
   - 根据变更内容，检查对应 UI 元素是否正确渲染
   - 用 `take_snapshot` 确认组件存在且状态正确
   - 用 `take_screenshot` 捕获视觉效果

### 注意事项

- **工作目录限制**：只能选择 home 目录下的路径（Hub 安全限制），否则会 403
- **权限审批**：Claude 可能请求工具执行权限，需要在浏览器中审批才能继续
- **等待策略**：Claude 处理需要时间，用 `take_snapshot` 每 2-3 秒轮询，不要急于操作

### 诊断与常见误判（环境异常时查，不要猜）

**诊断命令**：
- 端口监听：`lsof -nP -iTCP:2224 -sTCP:LISTEN`（2224=hub, 5175=web；用 `-nP` 避免 DNS/端口名解析干扰）
- 进程命令行：`ps -p <PID> -o command=`（确认进程身份/参数）
- 日志：`cat ~/.mobi-e2e/logs/{hub,web,runner}.log`
- 就绪信号：`test -f ~/.mobi-e2e/ready.flag && echo ready`

**常见误判（避免重复犯）**：

| 误判 | 正解 |
|---|---|
| 看 hub.log 早期 banner 端口判冲突 | hub 早期 banner 可能打默认 2222（已修为读 env，但以 bootstrap 输出的 `HUB_PORT`=2224 为准） |
| 把 cliApiToken 当 JWT 去 curl API | token 仅 web 登录框用；API 需先登录换 JWT |
| 等 stdout echo 判就绪 | 轮询 `ready.flag` 或 `curl` 端口（bootstrap 常驻 `wait` 不退出） |
| 手动 `nohup bun run dev` 或 `kill` 管环境 | 必须用 `e2e-bootstrap.sh` / `e2e-cleanup.sh` 脚本 |
| 用 `fill` 填 token 登录超时 | 用 `click` + `Control+A` + `type_text` + `click Connect` |
| **`type_text` 带 `submitKey: Enter` 以为会登录** | Enter 在自定义输入框不触发提交；必须 `click` "Connect" 按钮 |
| **旧 e2e 残留进程（上次没清干净）干扰新环境** | cleanup 脚本已加 `--profile e2e` pattern 兜底 kill；若仍异常，手动 `pkill -f -- '--profile e2e'` |
| **default 环境（2222/5173）与 e2e 共存时登录 REFUSED** | 端口隔离不冲突，但确认 e2e web 进程 `MOBI_API_URL=2224`（`grep PROFILE ~/.mobi-e2e/logs/web.log`），否则 vite proxy fallback 到 2222 连不上 e2e hub |
| **`navigate_page reload` 后测试 page 消失** | reload 偶发丢 page；改用 `new_page` 重新打开 URL，或 `list_pages` 确认后 `select_page` |
| **bootstrap 不退出以为是卡死** | bootstrap 末尾 `wait` 常驻是设计（保持环境）；background 跑 + 轮询 `ready.flag`，ready 后直接用，不等脚本退出 |

**端口隔离**（dev 与 e2e 完全隔离，配置上不冲突；若冲突说明环境异常）：

| 环境 | hub | web |
|---|---|---|
| 默认 | 2222 | 5173 |
| dev | 2223 | 5174 |
| e2e | 2224 | 5175 |

根据实际变更内容，可以重点验证特定环节，不必每次都走完整流程。

## 5. 清理

验证完成后按顺序清理：

1. **关闭测试页面** — 用 `list_pages` 找到测试页，`close_page` 关闭
2. **清理 E2E 环境**：
   ```bash
   bash .claude/skills/run-tests/scripts/e2e-cleanup.sh
   ```

## 配置

E2E profile 配置位于 `~/.mobi/profiles/e2e.env`，定义了端口、数据目录和 API Token。
