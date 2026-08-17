---
name: pitfalls-general
description: 跨任务通用误判（token 用途、诊断命令、工具禁用、短生命周期 DOM 验证、懒加载验证、React 控制的 inline style）
metadata:
  type: pitfall
  last_verified: 2026-08-17
---

# 通用误判

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
