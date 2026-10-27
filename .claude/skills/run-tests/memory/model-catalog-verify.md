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
- pill 按钮带 `aria-haspopup="dialog"`，点开后 **pill 原地长成** `[role="dialog"]` 面板
  （2026-10-27 改版：MorphSurface 形变容器，portal 到 body + fixed 锚在 pill 实测矩形，
  底边恒对齐 pill 底边、向上生长；桌面宽 320，移动端满宽 `innerWidth - 24`）：
  - 面板大字标题 = 当前档位；模型行是**自管 MorphSelect**（`[role="combobox"]`，
    accessible name = `composer.modelPanel.selectModel`，`stretch` 撑满面板宽、
    `direction="up"` 列表向上展开覆盖面板）。当前模型不在宿主目录时行上显示原值，不是「请选择」。
  - `[role="slider"]` 的 `aria-valuemax` = 档位数 − 1（4 = 五档含 max；3 = 四档）。
  - 档位名按钮（低 / 中 / 高 / 超高 / 最高）；重置按钮的 `aria-label`/description 是「重置为默认」。
- **形变几何断言**（真机 `evaluate_script` 量 rect）：展开后 surface 的 `bottom` == pill 的
  `bottom`（收起动画结束回到 pill 尺寸且与 pill 完全重合）。面板在 composer 里必须走 portal——
  内联表面会被 composer 上方的工作区行（`z-index: 2`，`.ant-sender` 只有 1）压住穿模。
- 点档位名与点按轨道走同一路径：`POST /api/sessions/<sid>/effort {"effort":"…"}`。
  读响应 + `GET /api/sessions/<sid>` 的 `session.runtimeState.effort` 做权威断言。
- 重置 = 模型回 `auto`、档位回 `medium`；auto 无能力位，档位集合随之回落四档（UI 只剩低中高超高）。

### 手机视口

- `resize_page 390x844` 在本机 Chrome 实际得到 `innerWidth=500`（窗口最小宽度），
  断言别写死 390：面板 `rect.width` ≈ `innerWidth - 20`、`scrollWidth === clientWidth` 即满宽无溢出。
- 五档、模型行、重置钮在 500 宽下全部可见，无裁切。

### 拖动换档：跟手预览、松手吸附才算数（2026-10-27 改版）

滑块改成 ChatGPT 形态后（轨道内嵌档位点、渐变填充、最高档星屑）：

- **CDP drag 真实拖动生效**（真实指针事件）。拖动的语义是：pointerdown 起跟手 →
  pointermove 只更新预览（顶栏大字 + pill 不变）→ **pointerup 吸附到最近档位才提交**
  （一次拖动 = 一次请求；旧实现是每跨一档就发一次 POST）。
- **不要在滑块上用 `setPointerCapture`**（2026-10-27 实踩）：CDP drag 实测
  `lostpointercapture` 先于 `pointerup` 触发，之后的 pointermove/up 落到别的元素
  （target 变成外层 DIV），松手不提交、pill 停在旧档。实现已改 window 级 pointermove/up
  监听；诊断同类「拖完没生效」先抓 `pointerdown/move/up/lostpointercapture` 序列。
- **合成 PointerEvent 仍可用**：往 `[role="slider"]` 依次 dispatch pointerdown / move / up
  （bubbles 到 window 即被接住），能精确落在两档之间验「吸附最近档」：
  `x = rect.left + thumb/2 + ratio * (rect.width - thumb)`（桌面 thumb 22 / 手机 28）。
  实测 ratio 0.625（5 档，介于「高」「超高」之间）松手 → 落「超高」。
- **断言**：pill 文案（`模型 · 档位`，档位名带渐变取色）、顶栏大字、最高档
  `[data-testid="effort-sparkle"]` 共 7 个；拖动/取消（pointercancel）不提交见单测。
- 手机视口（innerWidth 500）下新会话页 composer 行本身是 `overflow-x: auto` 横滚条
  （scrollWidth ~647 > 500），不是本轮滑杆引入的溢出。

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
冷却态（`fastModeState=cooldown`）的真实来源依赖 SDK 限流上报，本机未复现；但**渲染侧已可廉价真机验**：
切到唯一带 `supportsFastMode` 的 `claude-opus-5-5` 模型 + DB 注入 `runtime_state.fastModeState='cooldown'`，
闪电按钮即显示冷却态。完整注入 recipe 见 [[fast-mode-state-verify]]（含 runtimeState 优先 / metadata 兜底两分支）。

### 换模型按能力收敛（effort / fastMode）

规则在 shared `reconcileSessionConfigForModel`，daemon 的 `applySessionConfig` / 休眠暂存两条路径都过它。
本机最好的对照组：`claude-opus-5-5`（五档含 xhigh、支持 fast）↔ `claude-opus-4-6`（只有 low/medium/high/**max**、无 fast）。

- API 直验：会话设成 5-5 + `effort:xhigh` + `fastMode:true` → `POST /sessions/:id/model` 传 4-6 →
  `runtimeState` 变 `{effort:'max', fastMode:false}`（值来自 CLI 回的 `applied`，证明真下发过）。
  切回 5-5：`max` 保持、fastMode 保持 false（不自动重开）。
- 休眠路径：先 `/dormant` 再依次 POST effort/models → 同样收敛，唤醒不会带上越界值。
- 会话内面板（SSE 驱动，浏览器）：换到 4-6 后 pill 变「… · 最高」、闪电按钮**消失**、档位只剩四档；
  切回 5-5 闪电重现且为「快速模式已关闭」(`aria-pressed=false`)。

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
