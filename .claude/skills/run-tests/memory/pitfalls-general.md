---
name: pitfalls-general
description: 跨任务通用误判（token 用途、诊断命令、工具禁用、短生命周期 DOM 验证）
metadata:
  type: pitfall
  last_verified: 2026-08-01
---

# 通用误判

## token 用途（易用错）

E2E 环境 `cliApiToken` 与 `webApiToken` **同值**（`e2e-test-token-mobi`，见 `profiles/e2e.env`）。在 web 登录框输入 → 被 `/api/auth` 当 **webApiToken** 校验。**不能**直接当 `Authorization: Bearer` 去 curl API（API 需 web 登录换取的 JWT）。诊断 API 用 `/api/health`（免 token）或先登录拿 JWT 再查。

## 诊断命令（环境异常时查，不要猜）

- 端口监听：`lsof -nP -iTCP:2224 -sTCP:LISTEN`（2224=hub, 5175=web；`-nP` 避免 DNS / 端口名解析干扰）
- 进程身份：`ps -p <PID> -o command=`
- 日志：`cat ~/.mobi-e2e/logs/{hub,web,runner}.log`
- 就绪信号：`test -f ~/.mobi-e2e/ready.flag && echo ready`

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

## 工具禁用

- **不用 `analyze_image` 等工具访问 localhost** — 不支持 localhost URL
- **不用 `evaluate_script` 改前端状态 / localStorage** — 违反 E2E 模拟真实用户原则（只读诊断 OK：ref callback dump、`document.body.contains`、`getBoundingClientRect` 等读 DOM 状态不改）
- **不用 curl / 脚本直接调 Hub API 造数据** — 必须走浏览器 UI
