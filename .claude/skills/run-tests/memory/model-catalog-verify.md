---
name: model-catalog-verify
description: 模型目录 + 能力感知设置验收 — 创建页/会话内面板（换模型/换档/重置）真机 recipe / 手机视口与 CDP drag 换档 / max（session-only）落库断言 / agent 侧 list_models + create_session（含未知模型回落 notice）/ 快速模式创建预设双证据
metadata:
  type: recipe
  last_verified: 2026-10-27
---

# 模型目录 + 能力感知设置验收

覆盖 2026-10-27 model-catalog 票 01–05 的真机验法：创建页接宿主真实模型目录、
面板按模型能力过滤档位、快速模式、agent 侧模型清单工具族。agent 侧通用工具检索
手法见 [[agent-tool-verify]]，这里只记本特性独有路径。

## 创建页 / 会话内面板（同一组件）

- 入口：创建页 `/sessions/new?workspaceId=<id>`；会话内底栏「模型 · 档位」pill。
- pill 按钮带 `aria-haspopup="dialog"`，点开是 `[role="dialog"]`：
  - 大字标题 = 当前档位；模型行按钮点开后切到列表视图（Auto 合成项 + 宿主模型）。
  - `[role="slider"]` 的 `aria-valuemax` = 档位数 − 1（4 = 五档含 max；3 = 四档）。
  - 档位名按钮（低 / 中 / 高 / 超高 / 最高）；重置按钮的 `aria-label`/description 是「重置为默认」。
- 点档位名与点按轨道走同一路径：`POST /api/sessions/<sid>/effort {"effort":"…"}`。
  读响应 + `GET /api/sessions/<sid>` 的 `session.runtimeState.effort` 做权威断言。
- 重置 = 模型回 `auto`、档位回 `medium`；auto 无能力位，档位集合随之回落四档（UI 只剩低中高超高）。

### 手机视口

- `resize_page 390x844` 在本机 Chrome 实际得到 `innerWidth=500`（窗口最小宽度），
  断言别写死 390：面板 `rect.width` ≈ `innerWidth - 20`、`scrollWidth === clientWidth` 即满宽无溢出。
- 五档、模型行、重置钮在 500 宽下全部可见，无裁切。

### 拖动换档：CDP drag 才行

- `chrome-devtools drag`（`from_uid` = slider，`to_uid` = 目标档位按钮）**真实拖动生效**。
- 页面内 `evaluate_script` 合成 `PointerEvent`（pointerdown on thumb + document pointermove/up）
  **拖不动**（Radix slider 只认真实指针）；合成事件还可能触发一次意外点按，把已有值改掉——
  诊断「值怎么自己变了」时先翻 `list_network_requests` 的 `/effort` 请求体，别怀疑回写 bug。
  （2026-10-27 实踩：max 值「被回写成 high」其实是自己合成事件发的第二次请求。）

### max 是 session-only，但运行时切换照样落库

- 点「最高」→ `POST /effort {"effort":"max"}` 200 → `runtime_state.effort = 'max'` 稳定保持，
  pill 显示「最高」。若某模型 supportedEffortLevels 不含 max，第五档不渲染是能力过滤，不是缺陷。

## 快速模式（创建时预设 / 运行中切换）

创建时预设要**双证据**：`POST /api/sessions/spawn` 请求体有 `"fastMode":true`，且
`ps`/DB 侧 CLI args 出现 `--fast-mode true`、`runtime_state.fastMode = 1`、pill 闪电点亮。
只验 pill 不够——2026-10-27 实踩 `handleSubmit` 的 useCallback 依赖漏 `fastMode`：面板
直接读渲染态所以显示已开，提交却带旧值（已修，提交 ce42ffde）。复现测试 mock
`useMobiApi` 必须用模块级稳定引用，否则每次渲染换对象会掩盖依赖漏项。

运行中切换：点闪电 → 请求发出 → `runtime_state.fastMode` 翻 0/1、pill 同步。
冷却态（`fastModeState=cooldown`）依赖 SDK 限流上报，真机不廉价复现——只做组件级验证，
验收结论要显式标注「真机未复现」，别降级打勾。

## agent 侧：list_models + create_session

探针会话用 `deepseek-flash` 直接建（claude-opus-5-5 provider 本轮持续 502
`api_retry attempt 1/10`，换模型继续，不是代码缺陷）。探针 prompt 要点：

> 请依次做三件事，并把每步结果原样贴出，不要用命令行或读文件：1) 调用
> mcp__mobi-apps__list_models，把返回 JSON 里每个 model 的 value 列出来；2) 调用
> mcp__mobi-apps__create_session，directory 传 <demo 目录>，model 用清单里第一个不是
> auto 也不是 default 的 value，title 传 "agent-list-model"，贴出完整返回文本；
> 3) 再调用一次，model 传 "ghost-model-xyz"，title 传 "agent-ghost-model"，贴出完整返回文本。

- `list_models` 返回 `{models:[…]}`，每项含 `value/displayName/description/supportsEffort/
  supportedEffortLevels/supportsFastMode`；清单是 `default` + 宿主全部模型（含代理前缀
  `ccs-claude-zhipu--…`、自建 `glm-5.3-flash[1M]`）。**没有 `auto`**——auto 是 web 合成项。
- 按清单建会话：成功文案 `Created session <id> … ready for messages now`；
  DB 断言新会话 `runtime_state.model` = 传入的目录 value。
- 未知模型：**会话照样建成**，返回文本追加
  `The requested model "ghost-model-xyz" is not in this host's model catalog, so the session
  was created with the default model instead. Available models: …`；
  DB 里新会话 `runtime_state.model` 为空（回落默认）。
  软校验预算 2s：目录缓存未命中时不等 90s 冷探针。

### 读 tool_result 的正确姿势

`messages.content` 是 `{"role":"agent","content":{"type":"output","data":{…}}}`，
真的消息体在 `content.data.message.content[]`（多一层 `.data`）；`role` 只在
`content.data.message.role` 里，表上无 role 列。用 python 解析比 grep 稳：

```bash
python3 - <<'PY'
import sqlite3, json
db = sqlite3.connect('file:' + __import__('os').path.expanduser('~/.mobi-e2e/mobi.db') + '?mode=ro', uri=True)
for seq, raw in db.execute("SELECT seq, content FROM messages WHERE session_id='<sid>' ORDER BY position_at"):
    m = (json.loads(raw).get('content') or {}).get('data', {}).get('message')
    if not isinstance(m, dict) or not isinstance(m.get('content'), list): continue
    for b in m['content']:
        if b.get('type') == 'tool_use': print(seq, 'USE', b['name'], json.dumps(b.get('input'), ensure_ascii=False)[:600])
        if b.get('type') == 'tool_result': print(seq, 'RESULT', str(b.get('content'))[:1200])
PY
```

## 探针到达不冲掉已选值

创建页 `model` 是 `useState`（localStorage 初值）+ `onModelChange` 才更新；metadata 刷新
（切目录 / 30s fresh 过期后 reload）只换下拉清单，不回写选择。真机验法：选非默认模型 →
等 30s → reload → pill 仍是原模型且下拉里清单已刷新（Auto + 全部宿主模型）。
