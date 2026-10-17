---
name: status-pills-verify
description: composer 状态气泡（浮层，Todo/Tasks 摘要 + Popover 详情）验证 — Store 直接 seed runtimeState + 消息，免真实对话
metadata:
  type: recipe
  last_verified: 2026-10-17
---

# composer 状态气泡验证

`ComposerStatusPills`（`data-testid="composer-status-pills"`）**浮在聊天区底部**（composer 上方、
dock 之外，ChatContainer 里渲染）：毛玻璃胶囊 + 点击 Popover（`variant="flat"` 的面板）。
贴底时列表尾部有 `STATUS_PILLS_SPACER_HEIGHT` 的让位 spacer；上滚时消息从气泡后面穿过。

## 造数据：Store 直接写 runtimeState + 消息（免真实对话、免重启 daemon）

```ts
// /tmp/e2e-seed-pills.ts（bun 跑；绝对路径导入 Store）
import { Store } from '/Users/manerfan/workspace/github/modu/mobi/packages/daemon/src/store'
const home = process.env.HOME!
const store = new Store(`${home}/.mobi-e2e/mobi.db`)
const ws = store.workspaces.createWorkspace({
    namespace: 'default', name: 'Pills E2E',
    folders: [{ path: `${home}/workspace/demo`, primary: true }],
})
const session = store.sessions.getOrCreateSession(
    'pills-e2e',
    { path: `${home}/workspace/demo`, host: 'e2e', name: '状态气泡验收' },
    {}, 'default',
    {
        todos: [{ content: '核对旧机', status: 'in_progress', activeForm: '正在核对旧机' }],
        tasks: [{ id: '12', subject: '补齐流水线配置', status: 'pending', description: '...' }],
        foregroundTasks: [{ toolUseId: 'toolu_fg_1', description: '分析旧机日志', subagentType: 'Explore', startedAt: Date.now() }],
        backgroundTasks: [{ taskId: 'bt_1', toolUseId: 'toolu_bg_1', toolName: 'Bash', description: '扫描发布记录', status: 'running', isBackground: true, startedAt: Date.now() }],
        teamState: { teamName: '发布核对', members: [{ name: 'Alice', status: 'running' }] },
    },
    ws.id,
)
store.messages.addMessage(session.id, {
    role: 'agent',
    content: { type: 'output', data: { /* CLI raw：type:'user'|'assistant', uuid, message:{...} */ } },
}, `pills-local-u1`)
store.close()
```

⚠️ **消息必须包成 `{ role:'agent', content:{ type:'output', data: <CLI 原始行> } }`**。
直接存 CLI 原始行时 user 气泡还能渲染，assistant 会把 content 数组原样打成 JSON 文本。
assistant 的 `message` 需要 `{ id, type:'message', role:'assistant', model, content:[{type:'text',text}], stop_reason, usage }`。

## 断言口径

- 气泡文案：
  - todo：`待执行 {pending}/{total} · 执行中 {inProgress}`；total = todos + 非 deleted tasks；
    全部完成 → `全部完成`。`data-testid="status-pill-todo"`
  - tasks：`执行中 {active} / {total}`；active = 前台任务 + running 后台 + running/active/无状态团队成员；
    `data-testid="status-pill-tasks"`
- 定位：`pillsRect.bottom + 8 == composerTop`（`.ant-sender` 的 top）；水平居中：pills center ==
  `.chat-scroll-container` center（2026-10-17 实测 526.5 == 526.5）。
- 贴底：`scrollTop + clientHeight == scrollHeight` 时，最后一条**真实**气泡的 bottom ≤ pills top
  （尾部还有一个空文本 spacer 带 `.ant-bubble`，取倒数第二个才是最后一条消息）。
- 上滚穿层：`scrollTop=0` 时中间消息会落在气泡后面，胶囊背后可透过模糊看到文字。
- 毛玻璃：`getComputedStyle(pill).backdropFilter === 'blur(12px) saturate(1.4)'`。
- 主题：`localStorage.mobi-ui` 的 `state.theme` + reload。
- 横向渐隐：把 row 宽度临时压到 120px，`scrollLeft=0` 只有右侧渐变，滚到末尾只有左侧。

## 坑

- `getOrCreateSession` 已存在同 tag 会话时**不会覆盖 runtimeState**：重跑 seed 需先 cleanup 或换 tag。
- 团队成员无 `teamName` 时整个团队区块被过滤（与合并前 TeamAgentPanel 守卫一致）。
- e2e cleanup 后 httpOnly cookie 失效，浏览器会回 /login，需重新登录（同 token）。
- 种子可加 `goalStatus: { met: false, condition, durationMs, iterations, tokens, reason }` 顺带验收
  composer 上方 goal 行（缺必填 `met` 会被 schema 整条 strip）。
- 宿主会话 shell 自带 `MOBI_API_URL=127.0.0.1:12222`，会让 web proxy 指向错误 daemon（登录 404）：
  启动 bootstrap 必须 `env -u MOBI_API_URL -u MOBI_LISTEN_PORT -u MOBI_LISTEN_HOST`，详见 pitfalls-general.md。
- bootstrap 收到 SIGTERM 会**删除 `~/.mobi-e2e`**——种子必须在启动后重写、且不能靠重启 daemon 刷新缓存。
