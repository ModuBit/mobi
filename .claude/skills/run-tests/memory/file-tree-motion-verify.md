---
name: file-tree-motion-verify
description: inspector 文件树动效验证（switcher 弹簧 / 选中与悬停滑移）——CDP rAF 采样 + 三条可观察面
metadata:
  type: recipe
  last_verified: 2026-10-18
---

# 文件树动效验证

`FileTreeView`（antd Tree + rc-virtual-list）的动效，jsdom 测不出，须真机/CDP 采样。
2026-10-18 产品决定：**取消展开错峰进场**（antd 展开时行会先在临时 motion 容器里出现、
再被重挂到正式列表，二次挂载会让错峰动画重跑，观感是「先显示再进场」；与其打补丁不如去掉）。

## 怎么把树打开

- E2E 会话 → 右上「打开文件」页签 → 树在 Popover 里，**点文件会关掉弹层**，选中态来不及看。
- 要看**选中滑移**：先点一个文件进入内容视图 → 文件头「从文件树打开」→ 右侧停靠树
  （`[data-testid="file-tree-holder"]`，`aria-hidden="false"`），这棵是常驻的；再点另一个文件，
  树不卸载，滑移可观察。
- 停靠树默认很窄（split ratio），必要时先点「最大化」。

## 断言（rAF 每帧重新查询元素，别持有点击前的引用）

1. **switcher 弹簧**：展开目录后逐帧读 `.ant-tree-switcher-icon` 的 computed transform，
   应看到 `matrix(...)` 连续中间角度（0°→90°），而不是 `none` 直接跳 `matrix(0,1,-1,0,0,0)`。
   ⚠️ 首写脚本持有了点击前的节点引用，采到「瞬跳」假象；第二次每帧重新 querySelector 才看到弹簧。
2. **展开错峰**：点目录 switcher 后 0–1.4s 内查询 `.ant-tree-treenode.tree-row-enter`，
   断言 `animationDelay` 依次 `0s / 0.045s / 0.09s …`，opacity 按行号先后从 0 → 1 级联。
   - 撤标窗口从**目录数据就绪**起算（懒加载目录要等 loadData），不是从点击起算；
   - 窗口结束后类名消失属正常，之后再查为 0 行。
3. **选中滑移**：每帧读 `.tree-title-inner > span[aria-hidden="true"]` 的 `getBoundingClientRect().y`，
   点击另一个文件后应出现连续中间值（实测 245 → 617 经 13 个位置）。
   - 该 span 宽 = 标签文字宽（`width: max-content`）。若外层 `.ant-tree-title` 被 flex 压窄，
     `inset: 0` 会退化成十几像素的窄条——别把「宽 0/极窄」误判成没渲染。
4. **悬停滑移**：`.tree-hover-fill`（TreeWrap 的绝对定位覆盖层，`z-index:-1` + `isolation:isolate`）。
   对行派发 `new PointerEvent('pointerover', { bubbles: true })` 后逐帧读它的 `getBoundingClientRect().y`，
   跨行时应出现连续中间值（实测 43 帧 / 24 个不同 y，158 → 387）。scroll 时会淡出（几何失效即隐藏）。
4. **悬停滑移**：`.tree-hover-fill`（TreeWrap 的绝对定位覆盖层，`z-index:-1` + `isolation:isolate`）。
   对行派发 `new PointerEvent('pointerover', { bubbles: true })` 后逐帧读它的 `getBoundingClientRect().y`，
   跨行时应出现连续中间值（实测 43 帧 / 24 个不同 y，158 → 387）。scroll 时会淡出（几何失效即隐藏）。
5. **展开不再有进场动画**：展开目录后新增行应立刻按最终样式渲染（无 `tree-row-enter`、
   无 opacity/位移过渡）。若又出现「先显示、再进场」，先查是否有代码给新行加了挂载动画。
6. reduced-motion：motion 三处（switcher / 选中块 / 悬停块）走 `duration: 0`；
   刷新图标转圈由 CSS 媒体查询关闭。MCP 的 emulate 不暴露该特性，未单独采样。

## 坑

- antd 会 cloneElement 给自定义 switcherIcon **追加 className**（`ant-tree-switcher-icon`），
  并对内部 svg 施加 `rotate(-90deg)`；旋转由自绘 motion 承担，CSS 里已压掉 svg 的 transform。
- **switcher 图标在 hover 时消失**（2026-10-18 实踩）：antd 的 `.ant-tree-switcher:not(-noop):hover::before`
  是一个**绝对定位**的圆点，绘制顺序在常规流内容之上；本主题里它的底色（`colorBgTextHover`）
  被映射成**不透明**的 `--mobi-hover`，于是把 chevron 整个盖掉。修法 = 图标提层
  `&& .ant-tree-switcher-icon { position: relative; z-index: 1 }`。验证须把真实鼠标停在
  **switcher 本身**（hover 整行不算）：给 `.ant-tree-switcher` 临时加 `role="button"` +
  `aria-label` 拿到 snapshot uid 再 `hover`，验完删属性。
- 树里选中态由自绘滑移块承担，antd 的静态选中底色已被置透明；如果看到双底色 = CSS 覆盖没命中。
- 行悬停底色同理被置透明，改由覆盖层承担；如果看到「先亮后滑」= 覆盖层没生效、旧 hover 底色还在。
