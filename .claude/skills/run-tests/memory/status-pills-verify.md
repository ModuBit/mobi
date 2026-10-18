---
name: status-pills-verify
description: composer 状态气泡（浮层，Todo/Tasks 摘要 + Popover 详情）验证 — Store 直接 seed runtimeState + 消息，免真实对话
metadata:
  type: recipe
  last_verified: 2026-10-18
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
  - todo：`{completed}/{total} 已完成 · 执行中 {count}`（`/` 两侧不加空格；en：`{completed}/{total} done · {count} in progress`）。total = todos +
    非 deleted tasks；全部完成 → `全部完成`。`data-testid="status-pill-todo"`
  - tasks：`执行中 {active}/{total}`（无空格）；active = 前台任务 + running 后台 + running/active/无状态
    团队成员；`data-testid="status-pill-tasks"`
- 运行态底部光晕：有进行中项时气泡带 `data-running="true"`，`::before` 是底部径向运行蓝光晕
  （`radial-gradient(120% 190% at 50% 120%, color-mix(in srgb, #4dabf7 60%, transparent), transparent 62%)`），
  2.6s ease-in-out 在 opacity 0.12 ↔ 0.52 间呼吸，只动 opacity、不重绘文字/阴影。
  断言口径：`getComputedStyle(pill, '::before')` 的 `content !== 'none'`、
  `backgroundImage` 含 `radial-gradient`、`animationName` 非 none 且 `animationDuration` 为 `2.6s`。
  空闲 / 全部完成时无 `data-running`，且不生成 `::before`（`content === 'none'`）。reduced-motion 停转、
  保留 opacity 0.3 的静态微光。
- 定位：`pillsRect.bottom + 12 == composerTop`（`.ant-sender` 的 top）；水平居中：pills center ==
  `.chat-scroll-container` center（2026-10-17 实测 526.5 == 526.5）。⚠️ 2026-10-18 几何改版
  （底距 8→12、spacer 44）后的 +12 与间距 12 为常数推导，**待下次 E2E 复验**。
- 贴底：`scrollTop + clientHeight == scrollHeight` 时，最后一条**真实**气泡的 bottom 距 pills top 12px
  （`PILLS_TO_MESSAGE_GAP`；spacer 高度 44 已扣除容器 padding-bottom 8，且 spacer 的 antd
  bubble 内衬已在 `chatScrollStyles` 中归零）。
  （尾部还有一个空文本 spacer 带 `.ant-bubble`，取倒数第二个才是最后一条消息）。
- 上滚穿层：`scrollTop=0` 时中间消息会落在气泡后面，胶囊背后可透过模糊看到文字。
- 毛玻璃：`getComputedStyle(pill).backdropFilter === 'blur(12px) saturate(1.4)'`。
- 阴影裁切：横向滚动容器（`overflow-x: auto` 会让另一轴也变裁剪轴）的 padding box 是裁剪边界，
  气泡 8px 模糊阴影需由 `RowInner` 内衬提供绘制空间（当前 12px）。底距与内衬同值（12），
  行盒不越出外层滚动容器；阴影向下范围 2 + 8 = 10 < 12。验收断言：row 与 pill 四向
  headroom ≥ 10px，且 `rowRect` 四边都在 `.chat-scroll-container` 内、`pill.bottom + 12 == composerTop`。
  2026-10-18 实踩：内衬 2px 时阴影上下被齐平切断；Wrap 底距回退过少时下缘仍被容器裁 2px。
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
