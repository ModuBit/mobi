---
name: pitfalls-general
description: 跨任务通用误判（token 用途、诊断命令、工具禁用、短生命周期 DOM 验证、懒加载验证、React 控制的 inline style、claude 进程数观测归因）
metadata:
  type: pitfall
  last_verified: 2026-10-12
---

# 通用误判

## 附件上传测试文件必须放 repo 内（2026-08-27）

CDP `upload_file` 的 filePath 只允许 workspace roots 内路径，`/tmp/...` 直接 Access denied。
测试图片先复制进仓库内目录（如 `.scratch/e2e/`，已 gitignore）再传。


## claude 进程数观测：HEADLESS 兜底进程别误判为「extractor 未退场」（2026-09-02）

验证「会话启动不再 spawn 第二个 claude 进程」类命题时，**resume/激活窗口会出现 1-2 个瞬态
HEADLESS 进程（存活仅几秒）**——它们来自 hub 侧既有 refreshMetadata 兜底路径
（`syncEngine.ts` 首次激活补拉 + SWR 后台刷新 → session RPC `refreshMetadata` →
CLI `extractSDKMetadata` headless spawn），**不是** CLI bootstrap 的旧 extractor
（该链路已在批次 G 删除）。只数进程数会把这俩误判成「extractor 还在」。

正确做法（身份级采样，300ms 轮询记录 pid/ppid/特征而非只记 count）：

```bash
ps -eo pid,ppid,command | grep stream-json | grep -v grep \
  | grep "claude-agent-sdk-darwin-arm64/claude" \
  | awk '{print $1"|"$2"|"($0 ~ /no-session-persistence/ ? "HEADLESS" : ($0 ~ /permission-prompt-tool/ ? "SESSION" : "OTHER"))}'
```

- `HEADLESS` = `--no-session-persistence`、无 `--permission-prompt-tool`/`--model`（extractSDKMetadata 形态）
- `SESSION` = 带 `--session-id`/`--permission-prompt-tool`（会话主进程）
- 坑：shell 单遍 awk 收集「runner 全部后代」不可靠（spawn detach 后 ppid 链断）；也别用
  `--profile e2e` grep 后代——会话 CLI 是 runner 经中间层 spawn 的。直接全表 grep + 参数特征分类最稳
- 注意排除生产进程：`/tmp/claude-501/...bin` 路径是安装版 SDK 提取目录（生产/其他会话），
  repo `node_modules/.bun/...` 路径才是 dev/e2e 树。**观测绝不能变成 kill**——生产进程混在同表里

## token 用途（易用错）

E2E 环境 `cliApiToken` 与 `webApiToken` **同值**（`e2e-test-token-mobi`，见 `profiles/e2e.env`）。在 web 登录框输入 → 被 `/api/auth` 当 **webApiToken** 校验。**不能**直接当 `Authorization: Bearer` 去 curl API（API 需 web 登录换取的 JWT）。诊断 API 用 `/api/health`（免 token）或先登录拿 JWT 再查。

## 诊断命令（环境异常时查，不要猜）

- 端口监听：`lsof -nP -iTCP:2224 -sTCP:LISTEN`（2224=hub, 5175=web；`-nP` 避免 DNS / 端口名解析干扰）
- 进程身份：`ps -p <PID> -o command=`
- 日志：`cat ~/.mobi-e2e/logs/{hub,web,runner}.log`
- 就绪信号：`test -f ~/.mobi-e2e/ready.flag && echo ready`

## 定位精确短文本（reasoning title / 状态标签）—— 用 TreeWalker，别 querySelector('*')

要断言页面出现某个短文本（如 reasoning 的 `Thinking...` / `Thought · 11.0s`、状态标签），**不要** `document.querySelectorAll('*')` 后比 `textContent` —— 会把 `<style>` 标签里整坨 CSS 也匹配进来（CSS 文本动辄几百 KB），`evaluate_script` 输出瞬间爆炸（>500KB 被持久化到文件）。

**正确做法**：TreeWalker 只遍历文本节点，天然排除 `<style>`/`<script>`，且精确匹配短文本：

```js
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
const hits = []; let n;
while ((n = walker.nextNode())) {
  const t = n.textContent.trim();
  if (t === 'Thinking...' || /^Thought( · .+?s)?$/.test(t)) hits.push(t);
}
return { titles: hits };
```

正则也要收窄（`/^Thought\b/` 比 `/Thought/` 安全；后者会匹中 CSS 里的 `load-font-thought` 之类）。

## 短生命周期 DOM 的可见性验证（loadig skeleton / transient 反馈）

验证「条件渲染 + 短生命周期」的 UI（如加载骨架、`isFetching` 期间的反馈、过渡态），**不要只靠 `evaluate` + `querySelector` 轮询**——本地 hub/server 响应快（几十 ms），渲染窗口可能短于轮询间隔，会误判「未渲染」，浪费大量时间排查不存在的 bug。

**正确做法（按可信度递增）**：
1. **人为拉长窗口**：在 queryFn/handler 里临时 `await sleep(N)` 模拟慢网络，让目标 UI 持续显示几秒（测后删 sleep）。
2. **截图确认**：拉长窗口后 `take_screenshot`，浏览器实际渲染的最可靠证据（evaluate querySelector 会因时机/并发 miss）。
3. **ref callback mount dump**：目标元素挂 `ref={el => { if (el) window.__dump = { outerHTML: el.outerHTML, inBody: document.body.contains(el), ... } }}`，在 React commit 瞬间同步捕获（比 querySelector 早，不会 miss）——能区分「组件函数被调用但 JSX 未挂载」vs「挂载了但 querySelector 时机错过」。

**反面案例（曾误判）**：虚拟化 Skeleton（`components.Header`）「未显示」排查——querySelector 轮询（40×50ms）全 miss，误以为 react-virtuoso Header 渲染异常。实际 Skeleton 完全正常，只是本地 fetchNextPage ~50ms 窗口短于轮询间隔。用 ref dump 证明 mount + 拉长窗口截图后立刻确认可见。

## 性能验证 ≠ 功能验证（虚拟化改造教训）

改渲染容器（虚拟化 / 列表重写）时，**只跑 performance trace 看 DOM 数 / reflow / CLS 就宣称「E2E 通过」是错的**。
性能指标全达标的同时，功能可以是完全坏的——虚拟化迁移后 DOM 降了 91%，但 React key 大面积碰撞导致
消息重复渲染、滚到底按钮错位、流式看不到新消息，三个 P0 现象一个都没被性能 trace 捕捉到。

**列表类改动必须单独验证的功能项**（性能 trace 不覆盖）：
1. `document.querySelectorAll('[data-testid="virtuoso-item-list"] > *')` 读 `data-index`，**断言无重复值**
2. `list_console_messages` 查 React `Encountered two children with the same key` 报错（key 碰撞的直接证据）
3. 滚到顶后点「滚到底」按钮，断言 `scrollHeight - clientHeight - scrollTop ≈ 0`
4. **真实发一条消息**跑完整流式，采样断言自己的消息与 agent 输出都可见、贴底跟随生效

## 懒加载验证（2026-08-15，xterm/katex 按需加载）

验证「某模块是否只在触发时才加载」：

1. **基线先行**：进入页面后先记一次请求快照（此时必须无目标模块请求），再触发动作——
   只查「没有」是空洞的真（模块可能从头就没进依赖图）
2. **用 CDP `list_network_requests` 看时序，不用 `performance.getEntriesByType('resource')`**——
   resource buffer 默认 250 条上限，dev 模式模块请求多，很快塞满，**新请求不入 entries**
   （实测误判「katex/xterm 未加载」而 DOM 明明渲染了）；CDP 网络列表无此限制
3. **dev 模式是懒加载验证的最佳环境**：模块按需逐个拉，静态 import 会立刻出现在
   加载链里（如 InspectorPane.tsx 加载但 TerminalView.tsx 不在 = 懒加载生效）
4. 功能验证不可省：`.katex` DOM 出现（公式渲染）、`.xterm-screen` 出现（终端渲染）——
   按需加载 + 渲染正确是两个独立命题
5. inspector 展开按钮是 ChatPane 的 lucide `PanelRight`（`svg.lucide-panel-right`）；
   locale 可能是英文——`wait_for` 别用中文文案「终端」，用 DOM/按钮语义定位

## 合成粘贴事件（ClipboardEvent）的局限

测粘贴类特性（如「大段文本自动转附件」）时，用 `evaluate_script` 合成 `ClipboardEvent` + `DataTransfer` dispatch 到 textarea：

```js
const dt = new DataTransfer();
dt.setData('text/plain', 'A'.repeat(1001));
const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
textarea.dispatchEvent(ev);
return { defaultPrevented: ev.defaultPrevented };
```

**能验证**：`preventDefault` 是否被调用、附件卡片是否生成、textarea 是否被阻止插入（`textarea.value === ''`）。

**不能验证**：合成事件是 `isTrusted=false`，浏览器**默认文本插入只对 trusted 真实粘贴生效**——即使 handler 不 `preventDefault`，合成事件也不会把文本插进 textarea。故「小文本正常插入」的正向路径无法用合成事件验证，只能断言「不 preventDefault + 附件数不变」间接证明「未干预」，插入本身交给浏览器默认行为。

## React/antd 控制的 inline style 不能用 evaluate_script 改（模拟布局不可行）

想模拟「内容溢出 drawer 最大高度」等布局场景时，用 `evaluate_script` 改 antd 组件的 inline style
（如压 `content-wrapper` 的 maxHeight、压 body 高度逼滚动区溢出）**不可行**（2026-08-17 验证 drawer 滚动时踩过）：

- antd Drawer 的 `styles.wrapper` / `styles.body` 是 React 受控 inline style，任何 re-render（SSE 流、query 刷新）
  都会把改动覆盖回去，rAF 后读到的全是原始值，白测一轮
- 连环坑：body 是 flex 列且高度 auto，单压子元素 height 不生效（被 flex 拉伸抵消），多层尝试都在原地打转

**正确做法**：
- 造**真实溢出**：用 env-bootstrap 的 seed 脚本插足量数据让内容真的超过 maxHeight（注意 `usePagedSectionList`
  分页会限长列表，需点「展开显示」或插到多分组）
- 或退到**结构断言**：只读验证 DOM 结构（滚动容器与把手是否兄弟节点、body overflow 是否 hidden）+ 单测锁定，
  这对「把手固定不随内容滚」这类结构性命题已充分

## 工具禁用

- **不用 `analyze_image` 等工具访问 localhost** — 不支持 localhost URL
- **不用 `evaluate_script` 改前端状态 / localStorage** — 违反 E2E 模拟真实用户原则（只读诊断 OK：ref callback dump、`document.body.contains`、`getBoundingClientRect` 等读 DOM 状态不改）
- **不用 curl / 脚本直接调 Hub API 造数据** — 必须走浏览器 UI

## 图标选择器必须 scoped 到容器——全页 `.anticon-delete` 会误中「删除会话」按钮（2026-09-20）

验证「排队消息取消」时用 `evaluate_script` 全页找 `.anticon-delete` 按钮点击，结果点中的是
会话 hover 菜单里的「删除会话」（弹 confirm，未确认无实害，但差点真删）——同一图标在页面多处复用。

**正确做法**：
1. 先 `closest('[class*="queued"]')` 之类把目标按钮 scope 到功能容器内，找不到就报 found:false 而不是全页兜底
2. 点击后**立即检查副作用是否是预期的**（排队条消失 + 无意外 modal）——本次误点后出现两个「删除会话」confirm，及时取淌才没出事
3. 排队条按钮实测 `take_snapshot` 拿 uid 后 `click`（真实 CDP 点击）一次成功，比直调 React onClick 更可靠（后者找错按钮时同样「执行成功」，误导排查）

## MCP `click` 打不开 Radix 菜单——改用 focus + `press_key ArrowDown`（2026-10-12）

测会话行 kebab（uiarc/Radix DropdownMenu）时 `click` 拿 uid 点下去**菜单不开**，
事件直接冒泡到行 onClick 导致导航去了会话页。原因：Radix 的 Trigger 在 `pointerdown`
上开合（dropdown-menu dist：`onPointerDown: ... event.button === 0 && !event.ctrlKey → onOpenToggle`），
而 MCP `click` 走的是 click 语义，Radix 收不到——antd Dropdown（click 触发）则正常。

**绕法**：`evaluate_script` 里 `anchor.focus()` → `press_key ArrowDown`（Radix 监听 keydown，
Enter/Space/ArrowDown 均可开），关用 `press_key Escape`。全程真实键盘输入，可直接挂 rAF 探针采样。

**另一个假象**：`elementFromPoint(锚点中心)` 返回的不是按钮而是某个祖先 DIV 时，先确认锚点
**可见**——折叠分组里的会话行仍在 DOM 中（外层 `grid-template-rows: 0fr` + overflow hidden），
rect 照常返回但命不中，且 MCP hover/click 报 "did not become interactive"。先展开分组再操作。

**补充（2026-10-13 实测）**：`evaluate_script` 里**合成 pointerdown 也能开**，而且更适合「一个脚本里循环操作」：
`el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }))` + `pointerup` + `click()`
（菜单项的选中同样吃合成 pointerdown/click）。**坑**：菜单已经开着时再对触发器发 pointerdown 会 toggle **关掉**它——
循环里先判 `document.querySelectorAll('[role="menuitem"]').length === 0` 再开。
真实鼠标路径仍优先用 MCP `click`（拿 uid），合成事件留给批量/循环场景。

**补充**：**子菜单触发器**和根触发器不一样——Radix `MenuSubTrigger` 内建 `onClick`
开合（`if (!context.open) onOpenChange(true)`），所以 `click` 反而能开、`pointerdown` 也许；
键盘则是 `ArrowRight`。验子菜单时别照搬根触发器的 focus+ArrowDown 套路。
真机鼠标路径验 hover 展开：CDP `hover` 拿 uid 悬停约 100ms 即展开（Radix 内建延迟）。

## Radix 弹层开在 `role="tab"` label 内会「开完即关」——rc-tabs 抢焦点（2026-10-12）

**现象**：把 Radix 菜单的触发器放进 antd `Tabs` 的 `label`（自绘成 tab 头上的图标按钮）后，
点开菜单瞬间自动关闭，根本来不及点选。

**根因（两层，缺一不成立）**：
1. **React portal 的事件沿 React 树冒泡，不是 DOM 树**——Radix 把 `Content` portal 到 `body`，
   但它的 `focusin` 在 React 合成系统里仍会冒泡经过**原 JSX 位置的祖先**（即那个 tab 节点）。
2. rc-tabs（`@rc-component/tabs`）的 `TabNode` 有 `onFocus`：`if (!isMouse) setFocusKey(key)`，
   配对的 effect 是 `if (focus && btnRef.current) btnRef.current.focus()` ——
   于是 focus 被抢回那个 tab 按钮，Radix 判定 focus 移出 `Content` → 关闭。
   鼠标路径之所以有时躲过，是靠 `onMouseDown` 里的 `e.preventDefault()` + `setIsMouse(true)`
   抑制（键盘打开时 `isMouse=false`，必现）。

**诊断法（不必读源码猜）**：给 `HTMLElement.prototype.focus` 打桩拿调用栈 +
`MutationObserver` 盯弹层 `data-state`，一条链就能定位到「谁在菜单打开后抢了 focus」：

```js
const orig = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function () {
  console.log('FOCUS →', this.tagName, this.getAttribute('aria-label'), new Error().stack);
  return orig.apply(this, arguments);
};
```

**修法**：把触发器**移出 tab label**，挂到 antd 的 `tabBarExtraContent`（tab 栏专属的「附属动作」
位置，不属于任何 `role="tab"` 元素）。已经在 registry.json `localMods` 记为消费方约束。

**判据**：这是真机同样存在的 bug，不是 jsdom 假象——React 事件沿 React 树冒泡是框架行为。
遇到「弹层开完即关」别先怀疑测试环境。

## Radix 弹层「退出动画不播、当帧被摘掉」——portal 级 Presence 的 ref 被组件层吞掉（2026-10-12）

**现象**：`dropdown-menu` 的 `.menu[data-state="closed"]`（`animation: menu-exit … both` + 130ms 过渡）
进入动画完全正常、退出动画一条 `transitionstart`/`animationstart` 都没有，节点在**与 `data-state=closed`
同一次提交内**就从 DOM 消失。CSS 逐条核对与上游 uiarc 站点完全相同，上游**同一组件在自己站上退出动画是正常的**。

**根因**：`@radix-ui/react-menu` 有**两层** `Presence`——portal 级（`MenuPortal`）和 content 级（`MenuContent`）。
两层的探测 ref 都经 `cloneElement(child, { ref })` 交给**各自的直接子元素**：
- content 级直接子元素就是 ContentImpl → 拿到 DOM 节点 → 读到 `animationName` 正常 → 会走 `ANIMATION_OUT`；
- portal 级的直接子元素是 **Portal 的 children**（上游内联的 `<Content>`，我们抽出的 **`<MenuLevel>` 函数组件**）。

React 19 起函数组件的 `ref` 走 props，**组件不接不转 = ref 被静默吞掉** → 该 Presence 的
`stylesRef.current` 一直是 `null`（`@radix-ui/react-presence@1.1.11` 的初值就是 `null`）→
关闭时 `getAnimationName(null)` 得 `"none"` → 直接 `send("UNMOUNT")`，整棵 portal 当帧拆掉，
内层的退出动画根本没机会播。

**判据链（本次全套实测）**：
- 关闭时只有 **1 次** `getAnimationName` 读取被记录——`getAnimationName(null)` 不碰任何元素，**不会留下痕迹**，别指望从读取日志看出它。
- 反证：把 `modal={false}` 还原、关掉 `StrictMode`、给 open 态/菜单/portal 包裹层全部注入非 `none` 的
  `animationName`（`getComputedStyle` 打 Proxy 强改返回值），**四种都仍当帧卸载** → 说明决定卸载的那一方
  不是在看这些元素。
- 对照：上游 `https://uiarc.dev/components/dropdown-menu` 现场开合，DOM 结构一模一样
  （`body > div(无类) > div[role=menu]`），关闭事件是 `transitionstart` → `animationstart menu-exit` → **~140ms 后才 REMOVED**。

**诊断 recipe（含 Proxy 看 Radix 到底读了什么）**：

```js
// 只看 Radix 自己的读取：Proxy 包 getComputedStyle 返回的活对象，记录 caller 栈区分是不是自己的探针
const prev = window.getComputedStyle;
window.getComputedStyle = function (el, ps) {
  const real = prev.call(this, el, ps);
  if (el?.getAttribute?.('role') !== 'menu') return real;
  return new Proxy(real, { get(t, p) {
    if (p === 'animationName' || p === 'display')
      window.__reads.push({ p: String(p), v: String(t[p]), stack: new Error().stack.split('\n')[2] });
    return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
  }});
};
// 再配 MutationObserver 盯 [role=menu] 的 data-state + childList，看「翻转」与「REMOVED」是否同一微任务批
```

**修法**：让中间层把 ref 转下去——`MenuLevel` 接 `ref?: Ref<HTMLDivElement>` 并挂到
`DropdownPrimitive.Content` / `SubContent` 上（React 19 下函数组件直接收 `ref` prop 即可，无需 `forwardRef`）。
**通用规律**：任何在 Radix `Portal` 与 `Content` 之间插入的组件层都必须透传 ref，否则退出动画必失效。

**不可用单测兜底**：jsdom 不算 CSS 动画，`getComputedStyle().animationName` 恒为空 → Radix presence 无论对错都立即卸载，
写不出能红能绿的 jsdom 复现。此条只能靠真机开合时序验收（`data-state=closed` 之后必须还有
`animationstart`/`transitionstart`，且 `REMOVED` 要晚 ~130ms）。

## 级联菜单「父面板漂着第二个高亮」——子菜单面板是父面板的 DOM 后代，focusin 冒上来（2026-10-12）

**现象**：悬停/聚焦子菜单里的项时，父面板外侧（甚至面板下方几百 px 的空白处）多出一块同色圆角背景，
和一个正常高亮并排出现——「有两个 hover 背景色」。

**根因**：Radix 把 `SubContent` 渲染在**父面板 DOM 内部**（不是并列的兄弟 portal），所以
`parent.querySelectorAll('[role="menuitem"]')` 会连子菜单的项一起抓到。面板的 `onFocus` 若用
`event.target.closest('[role="menuitem"]')` 取项、直接吃 `item.offsetTop`，子菜单项的 `offsetTop`
（相对 `SubContent`，可达数百 px）就被父级当成自己的，高亮被 `translateY` 到面板外。

**诊断**：面板与外层高亮各挂 `position:absolute` + `translateY(offsetTop)`，直接量 `getBoundingClientRect()`
与父面板 rect 比对即可——高亮 rect 落在面板 rect 之外就是它。真机一次量到位，不必读源码。
本次实测：子菜单第 20 项 `offsetTop: 725` → 父高亮 rect `y=800`，而父面板只有 `y 74–266`。

**修法**：按面板归属过滤——每级面板都带 `data-dropdown-scroll-root`（本来就是子项滚动哨兵找容器用的标记），
`event.target.closest('[data-dropdown-scroll-root]') !== event.currentTarget` 就直接 return。
**通用规律**：任何「面板类容器」的 focus/pointer 处理器都要先判「事件是不是落在我这层」，
因为嵌套面板在 DOM 上是后代关系。

**可单测**：这条能在 jsdom 复现——聚焦子菜单里的 `destructive` 项，断言 `document.querySelectorAll('span[data-tone="danger"]')`
长度为 1（红：父级也变色 → 2）。注意**弹层 portal 到 body，要查 `document` 而不是 render 容器**，
否则拿到空集合、测试会假绿。


