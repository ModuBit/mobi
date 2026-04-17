# E2E 测试指南

E2E 脚本位于 skill 目录的 `scripts/` 下，使用 Chrome DevTools MCP 工具操作浏览器。

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
# 清理残留环境
bash .claude/skills/run-tests/scripts/e2e-cleanup.sh

# 后台启动 E2E 环境（Hub + Web + Runner）
bash .claude/skills/run-tests/scripts/e2e-bootstrap.sh
```

bootstrap 在后台运行，等待输出中出现 `E2E 测试环境就绪` 后继续。如果启动失败，检查日志 `~/.mobi-e2e/logs/` 下的对应文件。

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

1. 打开 Web 页面（`http://localhost:5175`）→ 自动跳转到 `/login`
2. 在 Access Token 输入框中输入 `e2e-test-token-mobi`，点击 Connect
3. 验证跳转到 `/sessions`，状态显示 "Connected"
4. 点击 "New Session"，填写工作目录，创建会话
5. 在聊天输入框中发送消息，验证 Claude 回复正常
6. 验证完成后，报告结果

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
