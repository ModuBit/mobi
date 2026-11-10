---
name: design-walkthrough
description: 设计走查 recipe——seed 数据 / computed style 实测取值 / 双主题切换 / 移动端键盘状态 / 几何四向全量 / token 未生效判别
metadata:
  type: recipe
  last_verified: 2026-11-10
---

# 设计走查（DESIGN.md 合规走查）

## 流程

1. bootstrap E2E 环境（见 [[env-bootstrap]]）+ 浏览器连接（见 [[browser-connect]]）
2. seed 数据：项目 + 会话（Store 脚本，machineId 取 `SELECT id FROM machines`，folder 用 `~/workspace/demo`）
3. 登录（见 [[login]]；可用 evaluate_script 以 native setter 填 input 后点 Connect，同效）
4. 逐页截图（存 `.scratch/design-walkthrough/shots/`，gitignore 内）+ **computed style 实测**取值，不要目测截图颜色
5. 主题切换：`mobi-ui` localStorage 的结构是 `{state:{theme:...}}`——**只改顶层 `theme` 键无效**，必须改 `obj.state.theme` 后 reload
6. **移动端视口必测键盘弹出状态**（见下「移动端键盘状态」）
7. **几何对齐四向全量**（见下「几何对齐」）

## 移动端键盘状态（2026-11-10 悬浮搜索遮挡教训）

移动端走查只切窄视口不够——**键盘弹出是独立状态**，必须实测：

- Android overlay 模式键盘**浮在内容上不缩视口**，`position: fixed` 贴底浮层若没消费 `--kb-inset` 就被盖住（布局正确≠键盘下可见）。CDP 无法真弹键盘，注入变量等价验证腾出路径：
  ```js
  document.documentElement.style.setProperty('--kb-inset', '300px');
  // 量目标浮层 rect 是否精确抬升 300 → removeProperty 回落
  ```
- 顺手验证浮层挂了 `transition: … var(--kb-anim)`（computed transitionProperty/Duration），保证真机上与键盘动画同步。
- 规范条目：docs/conventions/web.md「fixed 贴底浮层必须消费键盘腾出变量」——**新写贴底浮层前先查这条**。

## 几何对齐四向全量（2026-11-10 switch 居中两轮教训）

对齐问题**必须四向全量**（上下左右各自量 inset 再比差值），只量一个方向就下「居中」结论是误判温床——switch knob 上轮只量了左右 2/2 对称就放行，实际垂直 2/4 偏上 1px，用户两轮才等来修复。

```js
const r = knob.getBoundingClientRect(), t = track.getBoundingClientRect();
({ top: r.top - t.top, bottom: t.bottom - r.bottom, left: r.left - t.left, right: t.right - r.right })
```

## computed style 实测法（核心，比截图准）

```js
// hover/selected 实测：hover 用 CDP hover 工具触发后读 computed
getComputedStyle(el).backgroundColor
// 找元素命中的全部背景规则（判别优先级覆盖）：
[...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
  .filter(r => { try { return r.selectorText && el.matches(r.selectorText) } catch { return false } })
```

## 坑

- **改 theme 源码后必须整页 reload**：路由内导航（back/pushState）不重载 JS 模块，antd cssinjs token 仍是旧值——表现为「修改无效」误判。
- **Select 选中项恒带 `option-active` 类**：computed 背景命中第三条规则 `--ant-control-item-bg-active-hover`（pressed 档），不是 bug；要测「纯 selected」需先排除 active 类或读 `--ant-select-option-selected-bg` 变量值。
- antd cssVars 不挂 `:root`——变量要取目标元素自身或 `html` 的 computed（`documentElement` 上部分变量为空）。
- seed 的会话无 runner 关联，「恢复会话」点了无反应是预期；要激活 composer 走真实链路需从新建页发消息（见 [[chat-verify]]）。
- E2E 完成后 cleanup（会话 CLI 可能已被 spawn）。
