---
name: design-walkthrough
description: 设计走查 recipe——seed 数据 / computed style 实测取值 / 双主题切换 / token 未生效判别
metadata:
  type: recipe
  last_verified: 2026-09-22
---

# 设计走查（DESIGN.md 合规走查）

## 流程

1. bootstrap E2E 环境（见 [[env-bootstrap]]）+ 浏览器连接（见 [[browser-connect]]）
2. seed 数据：项目 + 会话（Store 脚本，machineId 取 `SELECT id FROM machines`，folder 用 `~/workspace/demo`）
3. 登录（见 [[login]]；可用 evaluate_script 以 native setter 填 input 后点 Connect，同效）
4. 逐页截图（存 `.scratch/design-walkthrough/shots/`，gitignore 内）+ **computed style 实测**取值，不要目测截图颜色
5. 主题切换：`mobi-ui` localStorage 的结构是 `{state:{theme:...}}`——**只改顶层 `theme` 键无效**，必须改 `state.theme` 后 reload

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
