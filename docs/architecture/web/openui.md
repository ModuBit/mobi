# OpenUI 渲染层（Intelligent UI Native 层）

fenced `openui` / `openui-lang` 代码块渲染为可交互 UI（官方 @openuidev/react-ui 组件库 + react-lang 解释器），并向上接通两条回灌回路：操作发消息（档②）、操作状态随 agent turn 原地更新（档③）。与 Sandbox App（`mode=app` 的 .html 文件 iframe，`ui/SandboxHtmlFrame.tsx`）是平行两层，按场景分工——本文只覆盖 Native 层。

## 渲染入口与懒加载链路

```
TextBlock ──annotateOpenuiFences()──▶ Markdown
                                        │ code 组件按 lang 分流
                          lang ∈ {openui, openui-lang}
                                        ▼
                            OpenUIBlock（薄壳，进主 bundle）
                                        │ React.lazy
                                        ▼
                       openui/renderer.tsx（懒 chunk，300K+）
```

- **annotateOpenuiFences**（`fenceIndex.ts`）：content 进 XMarkdown 前的纯函数变换，给每个完整 openui fence 的 info string 追加文档序 token（` mobi-fence-<n>`）。TextBlock 消费同一函数；DefaultCode 经 `parseFenceIndexToken(lang)` 反解序号，档③锚点据此从 block 级下钻到 fence 级（`${blockId}:${n}`）。稳定性依赖两条既有不变量：消息 content 落库后不可变、流式 append-only（未闭合 fence 不编号）。
- **GFM 围栏扫描**：非 openui 外层围栏整体透传（其内部出现的 openui 样行只是示例文本，不注解不编号）；闭栏反引号数须 ≥ 开栏（内容里的短反引号行不是闭栏）。
- **dev 坑**：`OpenUIBlock` 模块顶层预置 `Symbol.for('openui.devtools.autoMount')`——react-lang 在 development 下会向 body 注入第三方调试挂件，必须在懒 chunk 加载前置位阻断。

## 三条交互回路

| 回路 | 触发 | 链路 |
|------|------|------|
| 档② 回灌 | 用户点击 Button / 表单提交 | onAction → `buildOpenUIMessage`（i18n 表头）→ `useUiSendMessage` → 与手打消息同一 intake（乐观气泡/排队/rewind 同链路） |
| 档③ 原地更新 | 档② 发起后 agent turn 收尾 | 锚点随消息 meta 落库 → `deriveOpenUITerminalStates` 扫描 → actionStore 推进 → renderer 经 initialState 注入按钮文案翻转 |
| 无 provider 降级 | 会话页外渲染（Drawer 预览等） | `useUiSendMessage` 返回 null，交互块照常渲染，发送静默 no-op；`useOpenUIAnchor` 为 null 时档③退化为档② |

发送只可能由用户手势触发（react-lang 的 onAction 仅在交互回调里被调起），流式期间 renderer 一律不发送。

### 档③状态管道（数据流）

```mermaid
graph LR
    click["用户点击按钮"] -->|"capture 同步帧写 statementId"| reg["点击 registry<br/>(mobiLibrary, globalThis 槽位)"]
    click -->|"onAction 同帧 take"| ra["renderer handleAction"]
    ra -->|"回查绑定表 actions"| sv["状态变量 stateVar"]
    ra -->|"setPhase 乐观 running"| store["actionStore<br/>(anchor#var → phase)"]
    ra -->|"sendMessage + meta"| daemon["daemon messageService<br/>buildUiAnchorMeta 落库<br/>(openuiAnchor/openuiStateVar/openuiFormState)"]
    daemon --> msgs["消息窗口"]
    msgs -->|"签名门控重扫"| derive["deriveOpenUITerminalStates<br/>孤儿 result 剥离 + 按序配对"]
    derive -->|"applyDerived 只推进不回退"| store
    store -->|"per-key 切片订阅"| init["initialState { $var: phase, ...快照回注 }"]
    init --> ui["react-lang 按钮文案翻转<br/>idle → 执行中… → 已完成 ✓"]
```

**刷新恢复**：锚点与快照随消息 meta 落库，重扫同一窗口数据即可重建全部状态——actionStore 是内存单例，ChatContainer 卸载时清空，下次挂载由首扫恢复。

## 模块索引

| 文件 | 职责 |
|------|------|
| `OpenUIBlock.tsx`（`ui/`） | 渲染入口薄壳：React.lazy + Suspense；dev 调试挂件屏蔽 |
| `openui/renderer.tsx` | 懒 chunk 渲染器：Renderer 装配（mobiLibrary/主题/initialState）、handleAction（身份回查 → running 去重 → 发送 + 失败回滚）、错误降级呈现（非法语句被 parser 丢弃，块不移除） |
| `openui/actionContext.tsx` | UI 回灌注入 seam（UiSendProvider / OpenUIAnchorProvider）；零重依赖，进主 bundle |
| `openui/actionMessage.ts` | ActionEvent → 用户消息文本组装（纯函数，缺省中文表头，labels 由 renderer 传 i18n） |
| `openui/actionState.ts` | 档③终态扫描纯函数：锚点/result 配对、孤儿剥离、failed 判定；phase 值域词汇 |
| `openui/actionStore.ts` | zustand 模块级单例：`anchor#var → phase` + 表单快照；setPhase 乐观口 / applyDerived（终态单调守卫）/ clearAll |
| `openui/useOpenUIActionLifecycle.ts` | ChatContainer 喂数据的接线收口：签名门控重扫（length\|末条 id\|running），卸载清空 |
| `openui/bindingParser.ts` | fence 源码 → 操作绑定表（AST 主 seam，parser 与 react-lang 同源）；产出 setTargets/stateVars/actions/forms |
| `openui/snapshotInjection.ts` | 表单快照 → initialState `$` 键映射（direct 单通道）；多快照逐条解析后合并 |
| `openui/fenceIndex.ts` | fence 身份 token 注解/反解（GFM 围栏扫描） |
| `openui/mobiLibrary.tsx` | 组件库覆盖：Button capture 同步帧写 statementId 到 globalThis registry（取后即清） |
| `openui/theme.ts` | antd token → react-ui Theme 双档翻译（主题同源跟随） |

## 关键决策

| 决策 | 原因 |
|------|------|
| 操作身份由渲染层提供（Button 覆盖 + statementId registry） | react-lang 的 ActionEvent 不携带操作身份（formPayload 在 steps 循环前捕获，`Set` 置位不进载荷）；capture 同步帧写、onAction 同帧 take，无交错窗口。registry 走 `Symbol.for` globalThis 槽位——vite re-optimize 会产生同模块双实例，模块级变量各持一份必断 |
| 终点判据走 shared 单源（`isTurnResultUnwrapped`，data.type === 'result'） | 字段启发式（stop_reason/usage 在场）会因 `typeof null === 'object'` 把 usage:null 误判为终态证据 |
| 孤儿 result 剥离算术：`孤儿数 = result数 − 已消费锚点数` | turn 进行中点击 → 锚点消费翻转不触发重扫 → 重扫时旧 turn 的收尾 result 已滞留窗口、会被队首闸门错配。顺序 turn 保证孤儿必在合法 result 之前，纯算术剥离让扫描时刻/刷新窗口同口径，无需历史消费时刻 |
| applyDerived 终态单调守卫（done/failed 不被打回 running） | rewind 删掉 result 行后派生会给出 running，覆写让一次性按钮复活且终态证据已不在窗口；重跑走 setPhase 乐观口不经此。守卫条目整条跳过（phase 与快照同进退） |
| 跨包 meta 单源（`buildUiAnchorMeta`）+ `$var` 形状单源（`STATE_VAR_RE`） | daemon 落库与 web 乐观气泡必须逐字段一致（echo 合并不回填 meta，缺字段导致扫描按无身份配对）；两端正则漂移会造成「daemon 收下、回注拒绝」的静默失败 |
| 快照回注只认 `$` 键（direct 单通道） | 快照键集 = react-lang getFormPayload 的返回形状（键即绑定变量名带 `$`）；legacy 容器定位与值域正则降级随「生产未部署无旧数据」裁决（63aacaa5）删除。值 ∈ phase 值域的机制键剔除——否则回注以 idle 覆盖派生 done，一次性操作复开 |
| stateVars 只认绑定表，无正则降级 | bindingParser 与 react-lang 同 parser（`createParser(openuiLibrary.toJSONSchema())`）——源码 react-lang 渲染不了时这里也为空，不存在「绑定表空但 UI 正常」的中间态 |
| per-key 切片订阅（useShallow） | 整 phases Map 订阅下任意块写入换新引用，屏幕上全部 openui 块重渲染且 react-lang 随 initialState 重建 store；切片后只有本 fence 变化重渲染。事件内读最新值走 getState |
| 流式期间跳过 AST 解析（EMPTY_BINDINGS 门控） | code 每 delta 变化，解析结果无处消费——点击被 streaming 闸门挡、快照回注只在封口后生效 |
| `updateSessionMetadata` 永不顶起 updated_at | 档③ meta 回写若顶起 updated_at 会把会话顶到列表首位 |

## 测试 seam

纯函数直测（`tests/ui/openui/`）：actionState（配对/孤儿/queued 窗口）、actionStore（单调守卫/乐观口）、snapshotInjection（direct 单通道/合并）、bindingParser、fenceIndex（GFM 扫描/幂等）、actionMessage（组装）。集成面：`OpenUIAction.integration.test.tsx`（回路② 点击 → 发送）、`OpenUIInPlaceUpdate.integration.test.tsx`（档③ 原地更新）。真机验收 recipe 见 `.claude/skills/run-tests/memory/generative-ui-verify.md`；特性 spec 在 `.scratch/generative-ui/spec.md`。
