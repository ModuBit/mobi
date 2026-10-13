---
name: bottom-sheet-verify
description: 移动端底部 sheet（BottomSheet，2026-10-13 起全量替代旧 MobileDrawer）真机化验证 —— CDP 移动视口 + 合成拖拽采样（跟手/遮罩连续、嵌套层号、内容自滚、关闭路径）
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# 移动端 sheet 验证（CDP 移动视口）

用 CDP 移动模拟（`emulate` 390x844x3,mobile,touch）跑真实 Radix+motion 的 sheet，
单测（jsdom）测不出的东西在这里现形：跟手位移、遮罩随位移连续变暗、嵌套层号、真实滚动链。

## 入口路径（虚拟按键编辑器 = 唯一的嵌套 sheet 站位）

1. 登录 → 打开某个会话页 `/sessions/<id>`
2. `打开文件面板`（aria-label，「文件面板」是移动端 InspectorPane 的展开按钮）
3. 面板内点「终端」→ 等终端连上（`[Terminal connected]`）
4. 底部虚拟按键条最右的 `编辑虚拟按键`（aria-label，横滚才露头，用
   `document.querySelector('[aria-label="编辑虚拟按键"]').click()` 比 CDP click 省事）
5. 编辑器 sheet 里点「添加按键」→ 第二层 sheet（嵌套用例）

## 采样探针（合成指针拖拽）

在 header 上派发 `new PointerEvent(...)`，**move/up 必须打在 header 上**——打在 window
会被 Radix 判成「外部抬起」而多关一次。每步 `requestAnimationFrame` 两次后读
computed style 的 `transform` 与 overlay `opacity`：

- 跟手：`transform: matrix(1,0,0,1,0,N)` 的 N 应等于手指位移
- 遮罩连续：opacity 是位移的线性函数（1 → 0 到 `可见高 + 40`）；**起步若一帧内从 1 跳到
  0.78 就是台阶**（上游分段写法的残留）
- 小位移释放（< 可见高/3 且低速）→ 沉降回 `none` 且 sheet 仍在

## 关键坑

- **返回到底退出页面 = 哨兵「重臂」踩了 Android Chrome 的雷（2026-10-13 实锤，已修）**：覆盖物层
  在手势返回关掉本层后，滑出动画起手会**再 push 一条哨兵**、落定再自己 `history.back()` 弹掉
  （旧 MobileDrawer 与 BottomSheet 当时都这么写，现已双双删除）。真机上这会让返回键彻底失能：**第二次返回既不来
  popstate 也不来 navigate**（移动视口实测 `navigation.currentEntry.index`=4、`hl`=6，浏览器
  自己的历史完好，却零事件直接把应用关掉）。判据：popstate 里再补 entry 就是雷，别用重臂去
  覆盖退出动画窗口——按落点对齐的记账本就能让第二次返回落到下一层哨兵上。
  **桌面 Chrome 复现不出**（同序列在 mac 上正常），别拿桌面结论收工；也别先怀疑浏览器，
  先问「我们做了什么别的网站不做的事」。
  复现路径（真机）：打开 app → session → terminal → 设置 → 添加按键 → 返回(关二级) → 返回(第二次必须关一级)。
  **复现探针**：临时把每次 push/自弹/落点 + `navigation.currentEntry.index` 上报到 daemon 日志
  （页面被关掉时用 `navigator.sendBeacon` 在 pagehide 兜底上报内存缓冲），一次就能看清。
  判定口径：**URL 是否离开会话页**，不是 sheet 数。
- **可见高要用 `innerHeight − rect.top` 量**（peek 档下 `rect.height − 160` 会给出整盒高，
  看着像没生效）：peek 档实测 `844 − top` = 380 = 0.45×844。
- **移动端文件面板的展开态不能用 `innerText` 判**：`MobilePane` 是用 `transform: translateX`
  移出屏外的，节点还在、`innerText` 照收。判据用承载 pane 的 `getBoundingClientRect().left`
  （展开 = 无平移或 left 0；收起 = 平移满宽）。
- **遮罩在 peek 档停在 0.78**（LOW_DIM），展开档回 1——两段斜坡在 peek 档接续，不是单段。
- **遮罩关闭需完整 pointerdown → pointerup → click**（2026-10-13 实测）：Radix 1.1.20 的
  DismissableLayer 对「dismissable surface」在 click 阶段才判 dismiss；只发 down/up 会
  看到 sheet 纹丝不动，极易误判成组件坏了。同理测「点遮罩关闭」不要只发 pointerdown。
- **历史哨兵在 dev 会累积**：StrictMode 双调用 effect → 一次 open 推两个哨兵、close 只弹一个，
  `history.length` 每轮 +1。**生产构建无此问题**（实测临时摘掉 StrictMode 后每轮净 0）。
  验证哨兵别拿 dev 的 history.length 当结论。
- **热更新会串味**：HMR 会重置模块级变量（如 sheet 的层号发号器），嵌套层号会假性相等；
  测层号/嵌套前必须整页 reload。
- 层号断言：子层 overlay 的 z 必须大于父层 sheet 的 z（`--sheet-z` / `--sheet-z-top`），
  否则子层遮罩压不住父层。
- 内容自滚链：往 sheet 内容里塞够多元素，断言 `body.scrollHeight > clientHeight` 且滚动后
  header 的 `getBoundingClientRect().top` 不变、sheet 带 `data-scrolled`。
- 安全区：`getComputedStyle(sheet).paddingBottom` 应为 `160px + max(24px, env(safe-area-inset-bottom))`，
  且 `bottom: -160px`（sheet 底缘贴屏，不露遮罩缝）。

## 环境

见 [[env-bootstrap]]：`env -u MOBI_* perl setsid … e2e-bootstrap.sh`，
**后台 timeout 要给足**（10 分钟会被回收，触发 trap 连数据目录一起 rm）。
造素材可 curl 直调：`POST /api/workspaces` → `POST /api/sessions/spawn`（见 [[env-bootstrap]] 的 auth 段）。

## 验哨兵行为必须用 production 构建（2026-10-13 实踩）

dev(5175) 的 React StrictMode 把每个覆盖物的 effect 跑两遍 → **一次打开推两条哨兵**，加上历史里
累积的孤儿 entry，`history.back()` 的落点与逻辑层数对不上：实测「一次返回把菜单 + 二级弹层全关掉」，
换 production 构建同样的操作是「一次返回只关二级」。结论：任何靠 history 记账的验证（哨兵、
多级返回、切 session 不丢）**别在 dev 上做结论**。
做法：`bun run build:web` → 直接开 e2e daemon 的 `http://localhost:2224`（源码形态 daemon 从
`packages/web/dist` 读产物，不读 embedded assets）→ 同样 CDP 移动视口。

## 孤儿哨兵：菜单 ActionSheet 选中后开二级（2026-10-13 修）

真机可达路径：菜单 → 工作区行的「更多」（antd ActionSheet）→ 「换工作区」/「重命名」。
ActionSheet 关自己的**同一个回调**里二级 sheet 压了上来 → 它的哨兵 entry 没被弹掉，成了孤儿。
用户返回正好停在孤儿上：此前落点「编号在栈里找不到」→ 走整栈收起分支，**菜单 + 二级弹层一起消失**，
再按一次返回就落到路由层退出页面（与「两次返回退出 PWA」同源）。修法：已关闭的哨兵不从栈里摘除，
降级为 `dead` 死标记，落点对齐仍找得到它 → 只收它之上的活层。
残留行为：这条路径下用户会多按一次空返回（孤儿 entry 被消费那一下），比整栈收起轻，已接受。

## 真机四问题（2026-10-13 第二轮，均已修）——复验时逐条看

1. **菜单内容不能滚、要拉一下才行**：CSS 的锁滚判据原先挂在 `data-expanded` 上，而单档 sheet
   （矮内容 / `peek={false}`）永远不会进 top 档 → 永远锁着。现在判据是显式的
   `data-scroll-locked`（= 有两档且停在 peek 档）。
2. **新建工作区没内衬**：BottomSheet 不给 padding（内衬归调用方），迁移时漏了给表单加。
3. **长按 session 弹出的二级退到后面**：antd 浮层 z 1000 < BottomSheet 1080；修法是共享层号
   分配器 `ui/base/layout/overlayLayer`（antd 侧按 `open` 领号，命令式 `modal.confirm` 用
   `nextOverlayLayer()`）。**验证法**：开菜单 → `更多` → 读 `.ant-drawer` 的 computed z
   与 surface 的 `--sheet-z-top` 比大小；再看重命名 Modal 的 `.ant-modal-wrap` z，应严格递增。
4. **工具详情长标题左右溢出 / 内容不能左右滚**：标题是中栏 `minmax(0,auto)` 的 grid 条目，
   条目按 max-content 居中 → 两侧一起溢出（改成占满 track + 内部 flex 居中）；
   `.body` 的 `touch-action: pan-y` 会限制整个子树 → diff 的横向滚动被锁（改 `pan-x pan-y`）。

验证要在 production 构建上做（见上节），dev 的 StrictMode 会污染 history 记账。

## 第三轮（2026-10-13）：会话操作菜单改二级 BottomSheet + peek 锁滚档死区

**已改**：`MobileWorkspaceList` 的长按会话菜单从 antd Drawer 换成 `<BottomSheet peek={false}>`
（层号由组件自领，不再手工 `zIndex`）；删除确认从 `modal.confirm` 改成 **sheet 内就地换视图**
（`actionView: 'menu' | 'confirmDelete'`，自带一层 `pushHistoryGuard`，返回=退回菜单）。

**验证结果（production 构建 2224 实测）**：

- 菜单 1083 / 操作菜单 1085 / 重命名 Modal 1086 —— 严格递增。**dev 下两者会相等**（StrictMode
  把 effect 跑两遍触发 `retainOverlayLayer` 的归零，层号发号器被重置）——判层号只能上生产构建。
- 返回记账：返回 ①=只关操作菜单（菜单仍在）②=关菜单 ③=退出路由；删除确认视图里返回=退回菜单
  （URL 不变、sheet 不关）。这就是「二级 sheet」该有的三层记账。
- antd 浮层叠在 sheet 之上**是能用的**：`.ant-modal-wrap` computed 是 `none`（从 body 继承），
  但 antd 把内容提回 `auto` —— `elementFromPoint` 命中按钮/输入框，输入框还能正常受控更新。
  能用但 fragile，别当规范用（见 web/CLAUDE.md 的「不要在打开的 sheet 之上叠 antd 弹层」）。

### peek 锁滚档的死区（真机「工具详情里 diff / bash 结果横竖都滚不动」）

根因两层：① `data-scroll-locked` 下 body 是 `touch-action: none` → 整棵子树横竖都动不了；
② 内容区仲裁只看 `body.scrollTop` 判方向，而锁滚档 scrollTop 恒 0、scrollHeight 又大于
clientHeight → **上推被判成「交给浏览器滚」**，浏览器那一刻也动不了 → 内容区成了一片死区
（下拉能关、上推无反应）。修法：仲裁读同一个 `data-scroll-locked` 属性，锁滚档纵向一律归
sheet；CSS 把锁滚档的 `touch-action` 由 `none` 改成 `pan-x`（横向没有改档语义，放行嵌套滚动区）。

**验证法（不需要真机、不需要造素材）**：这个修复全在 JS 仲裁侧，**合成 TouchEvent 走的是同一条
路径**——在真实浏览器（生产构建）里 `new TouchEvent(type, { touches: [new Touch({...})] })`
派发到内容区即可，看 sheet 的 `data-scroll-locked` 是否翻 false、transform 是否回 `none`：

```js
const body = sheet.children[1]
const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true,
  touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: body, clientX: 195, clientY: y })],
  changedTouches: [new Touch({ identifier: 1, target: body, clientX: 195, clientY: y })] })
body.dispatchEvent(mk('touchstart', 700)); body.dispatchEvent(mk('touchmove', 690))  // 首帧 move 只定模式
body.dispatchEvent(mk('touchmove', 520)); body.dispatchEvent(mk('touchend', 520))
```

注意 **首帧 move 只用于定模式**（`beginDrag` 落在该点、位移为 0），要真的拖必须再来一次 move。
**原生平移（横向滚 diff）合成事件驱动不了**——那需要 CDP `Input.dispatchTouchEvent`，本工具的
MCP 没暴露，只能真机看。

**可达的真实两档 sheet（没有工具卡时拿它当靶子）**：会话页 → `[aria-label="打开文件面板"]` →
点「终端」→ 底部 `[aria-label="编辑虚拟按键"]`。实测打开即 `data-scroll-locked=true`、
`touch-action: pan-x`、`top=464`（= 844 − 45dvh），是标准的两档 peek 态。

## 第四轮（2026-10-13）：真机「diff 不能横向滚」的锅在 Radix 滚动锁，不在内容区手势仲裁

`react-remove-scroll`（Radix Dialog 的滚动锁）挂了一条 **`document` 级 `touchmove`**
（非 passive），判据是 `locationCouldBeScrolled(方向, event.target)`：**从 target 沿浅 DOM 的
`parentNode` 上溯**找该方向可滚的祖先（`overflowX !== hidden` 且 `scrollWidth > clientWidth`）。
pierre 的 diff 把横向滚动放在**自己的 shadow root** 里（`<code overflow-x: scroll>`），
浅 DOM 侧看不出来 → 判成「无处可滚」→ `preventDefault` 整段手势。真机表现＝工具详情里
diff 横竖都滚不动（纵向有 peek 锁滚那套；横向被滚动锁吞掉）。

- **判据（不用真机）**：合成 TouchEvent 的 `dispatchEvent(...)` 返回值 = false 即被
  preventDefault。`Event.prototype.preventDefault` 打桩能看到调用栈——是
  `HTMLDocument.<anonymous>` 就说明是滚动锁干的（我们自己的仲裁是挂在内容区元素上的）。
- **修法**：让横向溢出落在**浅 DOM** 元素上——`DiffView` 的 pierre host 由
  `flex:1; min-width:0` 改成 `flex:none; min-width:max-content`，溢出就落到外层
  `overflow:auto` 的 `[data-testid=tool-diff-viewer]` 上（浅 DOM，滚动锁看得见）。
  现场实验（生产构建真实 diff）：改前 host 内容宽 625 收成 354、横向 `prevented:[true,true]`；
  改后 host 撑到 625、viewer `sw 844 > cw 348`、`prevented:[false,false]`、`scrollLeft` 生效，
  行数/高度不变。
- **代价**：pierre 的行号 gutter 是 `position: sticky` 相对**它自己的**滚动区，横向改由外层滚之后
  平移期间行号会跟着滚走（权衡后接受：滚不动比行号滚走严重）。
- 同一类坑：**任何** shadow DOM 内（或滚动锁判不出的）滚动区在 sheet 里都会中招。

**工具卡的验证路径（当前消息窗口里就能拿到靶子）**：展开带工具调用的思考块 →
卡片内容超出内联上限时 `OverflowContainer` 会给一个「查看详情 →」，点了才开
`ToolDetailDrawer` 那个 BottomSheet（矮内容没有这个链接——所以别拿普通卡片找）。
`测试用例里 Edit 卡的内联 diff` 直接挂在消息流里（`[data-testid=tool-diff-viewer]`），
测 style/溢出不用开 sheet。**reload 后消息窗口不会自动回填更早的消息**（wheel 上滚到顶也停在小窗口），
别指望翻回旧的卡片。

**长按会话菜单（二级 sheet）**：会话页 → `[aria-label="菜单"]` → 在 session 行上派发
`new Event('touchstart', { bubbles: true })` → 等 700ms（`useLongPress` 500ms 阈值，只看
touchstart 计时，touchend 是取消）→ 弹出操作菜单；父层菜单仍在（两个 `[data-testid="bottom-sheet-surface"]`）。

**本轮改的两个交互**：①操作菜单底部「取消」按钮已删（关闭途径＝点遮罩/下拉/手势返回，
是用户点名要的删减）；②内容区手势仲裁加了 8px 起步阈值（`GESTURE_SLOP_PX`：按首帧 1~3px
抖动定方向会把整段横向滑动 preventDefault 掉，单测红→绿已锁）。

## 第五轮（2026-10-13）：详情 sheet 里 diff 的「假的纵向滚动条」＋手势被内容区抢走

真机复报：①diff 里出现**竖向滚动条**（用户问「diff 不该高度自适应么」）；②横竖都还是滚不动。

- **竖向滚动条 = 嵌套滚动区 + 横向滚动条占位**：详情 sheet 里 diff 走的是消息卡那套
  `INLINE_DIFF_MAX_HEIGHT = 320` 上限 → 在大 diff 上嵌出第二层滚动区（sheet 自己还在滚）。
  修法：`views/toolViewScope.tsx` 的 context（`ToolViewScopeProvider fullHeight` 由
  `ToolDetailDrawer` 提供），详情容器里的 diff 不限高。
  另有一个更隐蔽的来源：**经典滚动条占盒内空间**（本机 360x800 实测 `offsetHeight - clientHeight = 6`），
  横向一溢出就把内容挤出 6px 的纵向余量 → 顶出一条假竖条。修法：内容在上限内时按
  `内容高 + (offsetHeight - clientHeight)` 给高（`AutoHeightPatchDiff` 的量测循环多跑几轮收敛）。
  **注意**：390x844 视口下 `offsetHeight - clientHeight` 是 0（覆盖式滚动条），**360x800 才是 6**
  ——量这个坑要按真机视口量。
- **横竖都滚不动 = 仲裁只看内容区**：旧判据 `body.scrollHeight > body.clientHeight` 判「内容区
  能不能滚」，装得下嵌套滚动区时就归 sheet 并 preventDefault（用户以为在滚 diff，其实是拖动 sheet）。
  修法：`canScrollChain(target, dy)` 从落点沿 `parentElement` 上溯到内容区，逐个看 `overflowY` 与
  当前方向余量（dy>0 要 `scrollTop > 0`，反之 `< max`）。**锁滚档（peek）例外**：纵向一律归 sheet
  （CSS 那档本来就是 `touch-action: pan-x`），横向照旧交回浏览器。单测红→绿。
- 剩一个已知代价：diff 横向平移时 pierre 的行号 gutter 会跟着滚走（它的 `position: sticky`
  挂在 shadow 内 `<code>` 这个滚动区上，横向改由外层浅 DOM 滚之后 pin 不上了）。**第六轮已改**：
  横向溢出还给 pierre 自己，改由 sheet 层拦掉 document 级滚动锁（见文末第六轮），行号不再滚走。

**验证用到的真机视口**：`emulate 360x800x3,mobile,touch`（用户手机 1080x2400@3x）；
390x844 下量不出滚动条占位这个坑。

**造素材的现实约束（2026-10-13 遇到）**：模型周额度耗尽的 429 会让会话连工具调用都产不出来
（重试 10/10 后 `API Error: Request rejected (429)`）；seed 的会话 daemon 不认；真机上
`new_page` 各端口不共享登录态（cookie 是同一域的东西，但**不同 daemon 的 jwt-secret 不同** →
别的端口打开就是 401 跳 /login）。所以「要一张真实工具卡」这件事没有便宜的路子，先想清楚
能不能用别的方式验。

## 第六轮（2026-10-13）：横向手势的锅在 document 级滚动锁——修在 sheet，不在消费方

**两个被否的方案**（都错在层次）：①把横向溢出提到外层浅 DOM（`flex:none; min-width:max-content`）——
能绕开滚动锁，但整个 diff 连**行号**一起平移（真机「行号也滚没了」）；②在消费方（DiffView）挂
hook 手动接管手势、用 `findXScroller` 穿透 shadow 驱动 pierre 内部滚动区——能滚，但**pierre 本来
就支持滚动**，往视图里塞接管代码是打错层次的补丁（用户直接点的这一条）。两个都已删除。

**定稿（四步一次做完）**：
1. 判据收一：`ui/base/interactive/scrollableInPath.ts` 的 `findScrollableInPath(composedPath, axis, delta, stopAt)`
   ——**吃 `event.composedPath()`（浏览器给的完整路径，天然含 shadow 内部与各级宿主）**，
   同时看方向余量与 overflow。sheet 的 `canScrollChain` 改为调它（原来只走 `parentElement`，
   shadow 里的滚动区一律判错）。
2. 拿掉第三方锁：`BottomSheet` 走 `modal={false}` + 自建 `ui/base/interactive/bodyScrollLock.ts`
   （引用计数，`position: fixed` 钉 body，**不拦任何触摸事件**）。连带处理：Radix 在 `modal={false}`
   下**根本不渲染 Overlay**（源码 `context.modal ? <DialogOverlayImpl/> : null`）→ 遮罩自己渲染
   （点它＝点外部，走 DismissableLayer 的 onPointerDownOutside 关闭，实测可关）；`onOpenAutoFocus`
   也不跑了 → 补一个挂载即 focus 到 sheet 本体的 effect。
3. 消费方零接入：DiffView 里的接管 hook 与文件全部删除，横向滚动还给 pierre 自己。
4. 高度归属：量 shadow 内容高 + 滚动条占位补偿从 DiffView 下沉到 `ui/base/layout/AutoHeightHost`
   （量「第一个带 shadow root 的后代」，不写死 `diffs-container`；`contentKey` 触发重量）。

**实测（真 Radix + 真 sheet + 真 pierre，见下方「靶子自己搭」）**：
裸 pierre diff 横向 `prevented` 从 `[true,true]`（document 级锁吞掉，sheet 内/外都一样）变为
`[false,false]`；纵向仍归 sheet；`hostHeight 377 / contentHeight 376 / hostVerticalOverflow 0`
（无假竖条）；Esc 与遮罩点击都能关；body 内联样式开时钉住、关后还原为空。

**靶子自己搭（不用等会话里出现真实工具卡）**：web dev 服务器（5174 存活即可）本身能当模块
CDN——在**任意 5174 页面**上 evaluate，用 vite 的变换后 URL 动态 import，把真组件挂起来：

```js
const unwrap = (m, k) => (typeof m?.[k] === 'function' ? m : (m?.default && typeof m.default[k] === 'function' ? m.default : m))
const R = unwrap(await import('/node_modules/.vite/deps/react.js?v=<hash>'), 'createElement')  // hash 从
const { createRoot } = await import('/node_modules/.vite/deps/react-dom_client.js?v=<hash>')     // /src/.../*.tsx
const P = unwrap(await import('/node_modules/.vite/deps/@pierre_diffs_react.js?v=<hash>'), 'PatchDiff')
const BS = unwrap(await import('/src/ui/shadcn/bottom-sheet/bottom-sheet.tsx?t=' + Date.now()), 'BottomSheet')
// 组件：<BottomSheet open peek={false}><div style={{height:260}}><PatchDiff .../></div></BottomSheet>
// 然后向 pierre shadow 里的 <code> 派发合成 TouchEvent（composed: true 才能穿 shadow 边界），
// 读 event.defaultPrevented / scrollLeft。既有「sheet 内」也有「sheet 外」两个 diff 时，
// 用 sheet.contains(diffs-container) 区分，别按宽度猜。
```

要拿 `<hash>`：`curl -s http://localhost:5174/src/<任一组件>.tsx | grep '^import'`，里面就是
带 hash 的 dep URL。注意 vite 的 CJS interop——`react`/`react-dom_client` 常常只能从
`default` 拿到具名导出，所以先 `unwrap` 再取。**合成 TouchEvent 只能验 JS 侧**（谁 preventDefault、
谁拿到手势），验不了「浏览器原生平移」，所以要断言的是 `defaultPrevented` 这种可观测事实。
