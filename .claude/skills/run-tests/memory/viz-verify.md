---
name: viz-verify
description: visualize viz 档（mode="viz" fragment + serve-file ?viz=1 组装）E2E 验收 recipe——探针 prompt、iframe 内断言集、双档/422/tabs 容错坑
metadata:
  type: recipe
  last_verified: 2026-10-16
---

# viz 档验收（visualize-runtime 票 02+）

## 探针 prompt（单行）

点名 fragment 结构与声明方式，模型首轮遵从率高；要求落 `.mobi/artifacts/YYYY-MM/`：
「内容必须是纯 HTML fragment，严禁 doctype/html/head/body；包含 h2 + .viz-grid 三个 .card（.viz-stat-value）+ .nav.nav-pills[role=tablist] 两 tab/两 [role=tabpanel]（第二个 hidden）+ .btn.btn-primary 带 data-tooltip + .viz-carousel 两个 data-variant section（第二个 hidden）；写完后用 mode="viz" 声明」。

## 断言集（iframe 同源，`contentDocument` 直查）

1. **声明链路**：`[data-testid="artifact-inline-html"] iframe` src 含 `serve-file/...?viz=1`、sandbox 含 allow-scripts、初始 640（viz 蕴含 wide；之后高度自适应接管）
2. **组装**：`--viz-bg` 计算值 = `--mobi-bg`（token 派生）；`.card` 圆角 = 宿主 `--mobi-radius`；`#mobi-app-theme` 已注入
3. **tabs**：click tab → aria-selected 翻转 + 对应 panel.hidden 翻转；键盘 ArrowRight 选中下一个
4. **carousel**：`.viz-carousel-controls` 自动注入、count「1 / 2」；切走再切回，预插的 marker 仍在（DOM 保真，variant 内部状态存活）
5. **tooltip**：`[data-tooltip]` focus → `.tooltip` 出现且文本正确
6. **双档**：`localStorage['mobi-ui'].state.theme` 改 light/dark → **整页 reload** → iframe `--viz-bg` 跟随翻转（验完恢复 dark）
7. **422 契约**：完整 HTML 文件 fetch `?viz=1` → 422 + 错误页文案（页面内 fetch 即可，同源带 cookie）
8. **widgetState（票 03）**：iframe 内点交互 → `win.MobiApp.getWidgetState()` 变化 +
   `localStorage['mobi:viz-state:v1:' + win.location.pathname]` 落盘 → 整页 reload →
   轮询 50ms 抢首帧读 innerText 应直接是恢复值（无闪默认态）；`setWidgetState(>16KiB)`
   应 reject 且旧值保留；`statePersistence === 'local'`
9. **高度自适应（票 03）**：`frame.style.height` 收缩到 `contentDocument.body.scrollHeight`
   （初始 640 → 内容 219 → 219px）+ `style.transition` 含 height；撑开用点开面板/加内容验

## 坑

- **模型会漏写 aria-controls**（2026-10-16 实测）——运行时已加位置兜底（tab 序 ↔ 文档序 panel），
  验收时若面板不切先看 fragment 标记是否合规，再疑运行时
- **`documentElement.scrollHeight` 语义是 max(内容, 视口)**（2026-10-16 实锤）——iframe 比内容
  高时它返回视口高度（初始 chrome 638），桥若取 max(body, de) 会把高度**粘死在初始值只涨
  不缩**。修复：仅 `de.scrollHeight > de.clientHeight + 1`（真溢出）才信 de，否则量 body
  内容高。回归锚点 = daemon `vizStateBridge.test.ts`（new Function 求值桥脚本 + 手写 DOM 桩）
- **daemon 侧改 viz 运行时**（vizRuntimeScript/vizStyles）后必须重启 daemon 才生效
  （组装在 daemon 进程内）——用 [[env-bootstrap]] 的 kill -9 bootstrap 保数据重启法；
  web dev（5175）也要一起拉起（bootstrap 死则 PPID 看门狗带走全家）
- iframe 断言前等 ~800ms（组装文档 + 主题注入 onLoad 后才有计算值）
