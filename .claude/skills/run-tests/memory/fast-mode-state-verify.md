---
name: fast-mode-state-verify
description: 快速模式执行态（SDK 权威 fastModeState）全链验证 — result 帧 / 切换后 reinitialize 两条来源、runtimeState 落库、web 优先级与兜底；含 claudeRemote 事件白名单漏转发的坑与 DB 注入法
metadata:
  type: recipe
  last_verified: 2026-10-27
---

# 快速模式执行态（fastModeState）验证

覆盖 2026-10-27「按组合改」后新增链路：用户意图 `runtimeState.fastMode`（开关）与
SDK 权威执行态 `runtimeState.fastModeState`（off / cooldown / on）+ `fastModeDisabledReason`
分开存放。两条来源：**每轮 result 帧**、**用户显式切换 fastMode 后的 `reinitialize()` 回读**。
读取方 web 优先 runtimeState，缺失回落 `metadata.sdkMetadata.fastModeState`（启动快照）。

## 链路断言（curl 即可，无浏览器）

```bash
curl -s -c jar -X POST localhost:2224/api/auth -d '{"accessToken":"e2e-test-token-mobi"}'   # 字段是 accessToken
SID=$(curl -s -b jar -X POST localhost:2224/api/sessions/spawn -d '{"directory":"~/workspace/demo"}' | jq -r .sessionId)
curl -s -b jar -X POST localhost:2224/api/sessions/$SID/messages -d '{"text":"只回复 OK"}'
curl -s -b jar localhost:2224/api/sessions/$SID | jq '.session.runtimeState'   # 响应外层有 {session}
```

- **result 路径**：一轮结束后 `runtimeState.fastModeState='off'`、`fastModeDisabledReason='sdk_opt_in_required'`。
- **切换路径**：`POST /api/sessions/$SID/fast-mode {"fastMode":true}` → 数秒后 `fastModeState='off'`、reason **被清空**。
- 两个来源的判别点就是 reason：result 帧带原因（本机 sdk_opt_in_required），切换回读只给 state。
  想看真实值可 `POST /fast-mode {"fastMode":false}`，reason 会重新出现。

## 坑 1：事件回调白名单漏转发（2026-10-27 E2E 实踩）

`claudeRemote` 收齐 `RemoteSessionEvents` 后，在 `startOutputLoop` 里**逐字段**转给
`sdkOutputLoop`——不是整体透传。只给 `sdkOutputLoop` 加回调、没在这处补一行，
结果是「单测全绿、真机永不出现」。新事件回调三处齐改：`RemoteSessionEvents` 类型、
`startOutputLoop` 的白名单、launcher 的事件对象。回归测试从 `claudeRemote(...)` 进
（`tests/claude/remoteEventsForwarding.test.ts`），别只测 `sdkOutputLoop`。

## 坑 2：闪电按钮只在 supportsFastMode 模型上渲染

本机模型目录里**只有** `ccs-claude-apikey-fun-claude--claude-opus-5-5[1M]` 带
`supportsFastMode: true`。默认模型（glm 系）的模型面板没有闪电按钮，
别误判成「web 没读到执行态」。`POST /api/sessions/$SID/model` 切过去即可
（不需要真发一轮；会话休眠时 applySessionConfig 也能落 runtimeState）。

## web 优先级 / 兜底的真机验法（DB 注入 + daemon 重启）

两个分支的可见判别点只有 **cooldown**（off 与缺失渲染相同）：

1. 停 daemon → 改 `~/.mobi-e2e/mobi.db` 的 `sessions.runtime_state` JSON，加
   `fastModeState:"cooldown"` + `fastModeDisabledReason:"extra_usage_disabled"`，保持 `fastMode:true` →
   重启 daemon → 开模型面板，闪电按钮 `aria-label` = 「快速模式冷却中：限流临时不可用，稍后自动恢复」、
   颜色 `--mobi-warning`。此时 metadata 快照仍是 `off` → 证明**优先读 runtimeState**。
2. 反过来：删掉 runtime_state 的两个字段、把 `sessions.metadata.sdkMetadata.fastModeState`
   改成 `'cooldown'` → 重启 → 同样显示冷却 → 证明**缺失时回落 metadata**。
   （页面刷新后 daemon 的 refreshMetadata 可能把 metadata 刷回实时值，断言要在刚加载时看。）
3. 只改 DB 不改代码就能验 web，但**改了 daemon/session 源码必须重启进程**——会话 CLI 与
   daemon 都是源码直跑、启动即固化代码。

## 环境小抄

- 停 bootstrap 全家保数据：`kill -9 <bootstrap> <daemon> <web> <会话 CLI>`；随后手动
  `setsid` 重启 daemon（`--profile e2e daemon start-sync --host 127.0.0.1 --port 2224`）与
  web（**packages/web 下 `bun run dev --profile e2e`**，写 `src/dev.ts` 会 Module not found）。
- 浏览器 cookie 与 curl jar 不共享；两边各自登录（token `e2e-test-token-mobi`）。
