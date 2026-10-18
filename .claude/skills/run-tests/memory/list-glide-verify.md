---
name: list-glide-verify
description: 列表滑移底色（hover / 选中）验证——侧栏会话列表造多行 + GlidingHighlight 层断言
metadata:
  type: recipe
  last_verified: 2026-10-18
---

# 列表滑移底色验证

列表行不再各自画 hover/激活底色，改由 `GlidingHighlight`（`ui/base/motion`）在列表容器里
按目标行的 `offsetTop/offsetHeight` 弹簧跟随。行需 `position: relative`、容器 `position: relative`。

复用件：`ui/base/motion/GlideLayer.tsx`（styled GlidingHighlight，$background/$radius）+ `useGlideHighlight`（行选择器 / 激活选择器 / activeKey）。覆盖：侧栏会话列表、侧栏导航（NavItem）、
移动端三个会话分组（MobileSessionList，仅选中档）、审查 diff 树（DiffTreePanel，antd Tree 的
`.ant-tree-treenode` / `.ant-tree-node-selected`）、RequestUserInput 选项列表（按钮自带
`data-glide-row` / `data-glide-active`）。antd Tree 的行不是定位元素，层需 `z-index: -1` +
容器 `isolation: isolate`，否则层会盖住文字。

## 造多行（E2E）

侧栏默认可能只有 1 个会话，滑移看不到。往 `~/.mobi-e2e/mobi.db` 直接种：

```ts
// /tmp/e2e-seed-glide.ts，bun 跑
import { Store } from '/Users/manerfan/workspace/github/modu/mobi/packages/daemon/src/store'
const store = new Store(`${process.env.HOME}/.mobi-e2e/mobi.db`)
const ws = store.workspaces.getWorkspaces('default').find((w) => w.name === 'Task Rows E2E')
for (const i of [1, 2, 3]) {
    store.sessions.getOrCreateSession(
        `glide-e2e-${i}`,
        { path: `${process.env.HOME}/workspace/demo`, host: 'e2e', name: `滑移验证 ${i}` },
        {}, 'default', undefined, ws?.id ?? null,
    )
}
store.close()
```

写完 reload 页面即可见（无需重启 daemon）。

## 断言

1. 容器里应有两层绝对定位的 `div`（hover / 激活），带 `data-on` 时可见。
2. **hover 滑移**：对第 1 行派发 `new PointerEvent('pointerover', { bubbles: true })`，
   等 400ms 后读第一层的内联 `top`（= 行 offsetTop）；再派发到第 4 行，逐帧采 `style.top`，
   应出现连续中间值（实测 37 帧 / 22 个不同值，2 → 95）。
3. **选中滑移**：点另一行后逐帧采第二层 `style.top`（实测 95 → 14 → 2；导航期间 rAF 会被抽帧，
   中间值变少属正常，只要不是一次跳变即可）。
4. 底色：hover = `colorBgTextHover`（#e9e9ee），激活 = `colorPrimaryBg`（#e1e1e7），
   圆角 = `--radius-icon`（6px），行高 30px。
5. 列表面板收拢（grid 0fr）时层被 `SessionListInner` 的 overflow hidden 裁掉，不应溢出。

## 坑

- `pointerleave` 不冒泡，React 的 `onPointerLeave` 靠 `pointerout` 合成；用合成事件测「离开」
  测不出来，须用真实鼠标（MCP `hover` 到列表外元素）。hover 进入可以用合成 `pointerover`。
- 点会话会导航，采样期间 rAF 可能被长任务抽帧；别把「中间帧少」误判成没动画。
- 行内 `:hover` 规则（显隐操作钮、隐藏时间）仍由 CSS 负责，与滑移层无关，别一起删。
