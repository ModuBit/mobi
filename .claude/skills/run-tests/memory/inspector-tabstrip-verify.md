---
name: inspector-tabstrip-verify
description: 检查器页签条（TabStrip，uiarc 观感）验证 recipe——堆页签造溢出 / 量不收缩与滑动选中块 / 两端渐隐 / reveal 落点 / 关终端页签验 PTY 真被杀
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# 检查器页签条（TabStrip）验证

页签条是 **uiarc Tabs 的观感**（分段控件外壳 + 滑移选中块 + 溢出时两端渐隐），
**两端没有滚动按钮**（用户明确否掉：拖动直接滚就好，按钮会盖住正在淡出的那段）。
真机命题：**溢出时滚不滚**、**页签不收缩**、**选中块跟不跟手**、**两端渐隐在不在**、**reveal 落点对不对**、**关闭的副作用**。

## 0. 观感断言（computed style 一把抓，别靠肉眼看截图）

```js
const shell = document.querySelector('[data-left]')
const vp = [...shell.children].find(c => getComputedStyle(c).overflowX === 'auto')  // 滚动视口
const sel = document.querySelector('[data-tab-selection]')                          // 滑移的选中块
```
- 外壳：`backgroundColor` = 轨道底色（`--mobi-hover`）、1px 描边、`border-radius: 14px`；
  `data-left` / `data-right` / `data-overflow` 三个属性是渐隐与溢出的机器可读态
- 视口：`mask-image` 含 `35px` 渐隐（**仅**在对应 `data-*` 为 true 时命中）；jsdom 验不了，只能真机。
  渐隐只在**边缘那段真有内容**时看得出来——选中项刚被 reveal 过时边缘是空轨道，别据此判「没生效」，
  手动滚一点让页签压到边缘再看
- 选中块：`zIndex: -1` + `position: absolute` + `backgroundColor` 升一档（light `#fff` / dark `#25252a`）+ 圆角 10
- **滑移动效 jsdom 测不出**（`motion` 共享布局走 FLIP transform，jsdom 不算布局）：单测只能锁「同一时刻
  只存在一个选中块、归选中项所有」，真机要看**切页签那一刻块是否从旧位置滑过去**——rAF 采样选中块的
  `getBoundingClientRect()`，起止两帧位置不同、中间有过渡帧即动效在跑（`transform` 不走 `transition`，
  别去查 `transitionDuration`）
- 页签：`flex: 0 0 auto`（**不收缩**）、`minWidth: 88px`（5.5rem）；选中的文字色是 `--mobi-ink`，
  其余 `--mobi-ink-secondary`
- **别拿 `--mobi-primary` 当强调色**：本项目的 primary 是中性墨族（dark 档 `#f6f6f8` **等于** ink，
  light 档 `#3a3a41` 比 ink 还浅）——2026-10-13 实测「选中色设成 primary」在暗档等于没生效，
  靠查 `getComputedStyle(document.documentElement).getPropertyValue('--mobi-primary')` 才发现

## 1. 堆页签：`+ → 打开文件 → 点文件` 循环，每轮净增一个 tab

单靠终端（最多 3 个）+ 审查 + 文件树最多 4-5 个页签，在 420px 面板里**造不出溢出**。
要多少有多少的做法：`openFileTreeTab` 只在「当前没有 tree tab」时新建，而点文件会把 tree tab
**就地转成 file tab** —— 于是每轮「打开文件 → 点一个文件」净增一个 file tab（**每轮换不同文件**，
同路径会命中去重、退化成只激活）。6 轮 + 3 个基础页签 ≈ 9 个，稳定溢出。

```js
// 「+」是 Radix DropdownMenu：合成 pointerdown 就能开（见 [[pitfalls-general]]）
const fire = (el, t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0 }))
const plus = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '新建')
fire(plus, 'pointerdown'); fire(plus, 'pointerup'); plus.click()
await sleep(300)
const item = [...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.trim() === '打开文件')
fire(item, 'pointerdown'); fire(item, 'pointerup'); item.click()
await sleep(700)
// antd Tree 的选中在内容 span 上：点 role=treeitem 外层不触发 onSelect
const node = [...document.querySelectorAll('[role="treeitem"]')].find(t => t.textContent.trim() === 'CLAUDE.md')
const cands = [...node.querySelectorAll('*')].filter(e => e.textContent.trim() === 'CLAUDE.md')
;(cands[cands.length - 1] ?? node).click()
```

- **页签条空态时没有「+」**：空态走 `InspectorEmptyState` 的动作卡（按钮文字即 `审查` / `终端` / `打开文件`），
  直接按 `textContent.trim() === label` 找按钮点；有 tab 后「+」才出现在行右端
- 菜单已开时别再对着 `+` 发 pointerdown（会 toggle 关掉），先判 `document.querySelectorAll('[role="menuitem"]').length`
- 页签是**内存态**，整页 reload（换主题等）会清空，得重堆

## 2. 量溢出与不收缩

```js
const list = document.querySelector('[role="tablist"]')
list.clientWidth; list.scrollWidth                      // 内容宽 > 视口宽 = 真溢出
shell.getAttribute('data-overflow')                      // 组件自己算的溢出态
;[...document.querySelectorAll('[role="tab"]')].map(t => t.getBoundingClientRect().width)
```
- 页签宽度应保持**自然宽**（96 / 151 / 215 …），不随容器收窄——收到 38-51px 就是收缩回归了
- 外壳里**不该有滚动按钮**（只有页签自己的关闭 ×）：`shell.querySelectorAll('button')` 应全是
  `aria-label` 形如「关闭 X」的，出现别的就是旧的滚动按钮回来了
- 滚动：鼠标按住横拖（自建 pointer 拖拽，超 4px 才算拖）、触摸原生拖动、触控板横滑、Shift+滚轮

## 2.5 拖动滚动怎么验（拖拽是自建逻辑，真机才测得准）

**鼠标**：MCP `drag`（from_uid/to_uid 取两个相距远的页签）是真输入，实测 703→0、0→846；
判据是三件事一起看：`scrollLeft` 变了、**选中项没变**（拖动没被当成点击）、松手后不残留拖动态。

**触摸**：必须用带调试端口的独立 Chrome（MCP 那个走 `--remote-debugging-pipe`，发不了自定义 CDP）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9413 --user-data-dir=/tmp/<新目录>/profile about:blank &
```
然后 bun + WebSocket 发 CDP：`Emulation.setDeviceMetricsOverride{width:390,height:844,mobile:true}`
+ `Emulation.setTouchEmulationEnabled{enabled:true}`，再用
`Input.synthesizeScrollGesture{x,y,xDistance:∓150,yDistance:0,speed:800,gestureSourceType:'touch'}`。
- **手搓 `Input.dispatchTouchEvent` 驱动不了滚动**（同一坐标的朴素 div 也不动）——别用它下结论，
  它是环境假象；`synthesizeScrollGesture` 才行
- **CDP 的 emulation 是会话级的**：WebSocket 一断（脚本退出）就还原成窗口尺寸。分脚本跑会把
  「移动端 390」悄悄变回「桌面 500」，此时 3 个页签根本不溢出——**看着像「拖不动」，其实是无处可拖**。
  设完 metrics 必须同一脚本内复核 `scrollWidth > clientWidth`
- **坑：antd 通知 toast 盖在页签条上吞输入**（2026-10-13 排查半天）：`elementFromPoint(视口中心)`
  返回 `div.ant-notification-notice`（顶部居中的「新版本」胶囊），手势全打在它身上。移动端 390px 下
  页签条中心 x≈220 正好被居中通知压住；桌面 1280px 下页签条在右侧 x≈976，躲开了——所以「桌面能拖、
  移动端拖不动」的假象。**动手势前先 `elementFromPoint` 确认命中自己**（或先点掉 `.ant-notification-notice-close`）

## 3. reveal 落点（选中项必须滚进可视区）

选中间/末尾的页签后量：

```js
const vpr = vp.getBoundingClientRect(), sr = document.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect()
sr.left - vpr.left      // 期望 ≈ 35（左侧渐隐宽），不能落在渐隐区里
vpr.right - sr.right    // 期望 ≈ 35，或 scrollLeft 已到 max（尽头，该端不再渐隐）
```
- **落进渐隐区 = 选中项被蒙上一层淡出**：组件按 35px 给渐隐让位，所以期望值就是 35（不是 0）
- **stale-layout 陷阱（2026-10-13 实测）**：新建页签那一帧它的宽度往往还没定稿（先按占位标题摆一道），
  此刻算出的可达滚动范围偏小 → 平滑滚动**定格在「新页签仍被右侧挡着」**（实测选中项右缘超视口 48px，
  `scrollLeft` 停在 795 而 max 是 845，且**不会自己恢复**）。组件侧的修法是把「带进视口」当待办布局义务、
  依靠 ResizeObserver 复核；验收方法是**新增一个文件页签后就地量落点**（别只手点已有页签——那样测不出来）
- 采样平滑滚动轨迹：rAF 里 push `scrollLeft`，只保留变化帧（相邻同值去重），看它是否走到 `max`

## 4. 关终端页签 → PTY 真被杀

`clearCachedInstance('terminal:<sessionId>:<terminalId>')` → dispose → `terminal:close`，PTY 是
**daemon 的直接子进程**（`ppid === daemon pid`），PTY 里跑的是 `/bin/zsh`：

```bash
ps -eo pid,ppid,command | awk '$2==<daemonPID>'          # 建终端前先记基线
ps -o pid,ppid,command -p <ptyPid>                       # 关闭后只应剩表头 = 已回收
```

- **只读！** 严禁 `pkill`/`pgrep -f`（本机曾误杀生产 hub，见 feedback_pkill-scope-isolation）
- 顺带确认会话自身的 CLI 进程（`bun ... claude --mobi-startin…` + SDK 子进程）仍在 = 没误伤会话
- 关闭 × 用**真实 CDP click**（uid 来自 snapshot）；非活动 tab 的 × 是 `opacity: 0`，
  但透明元素照常命中，不必先 hover

## 5. 关活动 tab 后的焦点

关活动 tab 时组件接管焦点（`nextFocusAfterClose` → 顶上来的那一项）。断言：
`document.activeElement === document.querySelector('[role="tab"][aria-selected="true"]')`
（关最后一个 tab → 焦点落到它的前一个）。关**非活动** tab 则选中与焦点都不动。
