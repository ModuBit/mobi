---
name: tool-ui-verify
description: 验证「工具调用渲染出的 UI」（AskUserQuestion 页签 / 权限审批 / 各类 footer）—— e2e 会话只能走 spawn API，不能 seed
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# 验证工具调用派生的 UI（AskUserQuestion footer 一类）

主角是 **CLI 真跑一次工具调用** 才能出现的界面（多题页签、选项卡、审批 footer）。要点只有两条：
会话必须由 daemon 亲手 spawn，提示词必须**点名工具**。

## 1. 会话必须走 spawn API —— 别用 seed 脚本

`env-bootstrap.md` 里的 Store seed 脚本（`getOrCreateSession`）只把行写进 DB，**daemon 的内存会话表认不到它**：
页面能打开、消息能 POST（回到 200），但会话起来后所有 `/api/sessions/<id>/*` 立刻 404，CLI 永不 attach
（2026-10-13 实测：seed 会话发消息 → 无任何 agent 回复）。给它发消息看不出错，只是静默没反应，极易误判成「UI 坏了」。

改用 daemon 自己的接口（cookie 认证，`env-bootstrap` 的 `POST /api/auth {accessToken}` 换 jar）：

```bash
# body 字段见 packages/daemon/src/web/routes/sessions.ts 的 spawnBodySchema
curl -s -b jar -X POST -H 'content-type: application/json' \
  -d '{"directory":"/Users/<you>/workspace/demo","workspaceId":"<已存在工作区 id>"}' \
  http://localhost:2224/api/sessions/spawn
# → {"type":"success","sessionId":"…"}
```

`directory` 必须在 homeDir 内（403 校验）；`workspaceId` 可省，但带上就不用在新建页再选工作区。
拿到 id 后浏览器直接开 `/sessions/<id>`。

## 2. 提示词点名工具

「问我两个问题」不够——模型可能只用文字反问。写成**点名 + 排他**：
`用 AskUserQuestion 工具问我两个问题，每题给两个选项。只调用这个工具，不要做别的。`
渲染出的 footer 出现在聊天流末尾（不在 inspector 里），`role="tablist"` 上带 `aria-label`。

## 3. 断言前先确认工具真调了

消息 API 是权威（UI 可能还在审批态）：

```bash
curl -s -b jar "http://localhost:2224/api/sessions/<id>/messages" | python3 -c "
import json,sys
for m in json.load(sys.stdin)['messages']:
    c=m.get('content') or {}
    if not isinstance(c,dict) or c.get('type')!='output': continue
    d=c.get('data') or {}
    if d.get('type')=='assistant':
        for b in (d.get('message') or {}).get('content',[]):
            if b.get('type')=='tool_use': print('TOOL_USE', b.get('name'))
"
```

`system/init` 那条的 `tools` 数组可用来确认工具确实在会话工具集里（`AskUserQuestion` 一般都在）。

## 坑

- **模型 429 会让整条链路看起来是坏的** —— 错误在 UI 上只是个气泡，`system/api_retry` 才是真因（每次 `attempt` 递增到 10 然后整回合 cancelled）。换模型比重试快：见 [[switch-model]]（`POST /api/sessions/<id>/model`，**下一回合**生效，需整页 reload）。
- **回合进行中别反复 reload** —— 用户消息会落到 `cancelled`，白等一轮。
- **页签类 UI 的探针**＝`[role="tab"]` 的 `aria-selected`/`tabindex` + `[role="tabpanel"]` 的 `display`；
  「切走即卸载」看 **面板节点数**（默认不 keepMounted → DOM 里只剩 1 个），「keepalive」看同一节点的对象身份。
