---
name: antd-cssvar-portal-scope
description: antd cssVar（--ant-*）只在 antd 组件子树内可解析，portal 弹层取不到——registry 组件 token 归零的元凶与诊断法
metadata:
  type: pitfall
  last_verified: 2026-10-12
---

# antd cssVar 的作用域陷阱（portal 弹层 token 归零）

## 事实（2026-10-12 CDP 实测）

antd v6 `cssVar` **不是**全局 `:root` 注入。`--ant-*` 只出现在 antd 组件元素自带的
`.css-var-*` / `.ant-<comp>-css-var` 规则里：

```js
// 挂在 body 下的探针 div —— 全空
getComputedStyle(probeInBody).getPropertyValue('--ant-color-border')  // ""
// .ant-app 元素 —— 有值
getComputedStyle(document.querySelector('.ant-app')).getPropertyValue('--ant-color-border')  // "#f0eee6"
// document.documentElement —— 全空（含 --ant-motion-duration-*、--ant-box-shadow、--ant-border-radius-lg）
```

**推论**：任何 portal 到 `body` 的元素（Radix/uiarc 弹层、shadcn Dialog…）拿不到任何
`--ant-*`。若组件 CSS 的设计变量映射写在 portal 元素的作用域里却取值 `var(--ant-*)`，
则该元素**所有**颜色/圆角/投影/时长变量在计算值阶段失效 → 表现是
「无底色 + 无描边 + radius 0 + 无投影 + 过渡整体失效（无动画）」，而单测全绿（jsdom 不跑 CSS）。

反例对照：antd 自家弹层（Dropdown/Select）能正常工作，是因为 antd 把
`.ant-dropdown-css-var` 这类类名**挂到了 portal 元素本身**。不用 antd 组件类就没有这层。

## 诊断 recipe

```js
// 1. 打开弹层后读元素的变量是否为空
const menu = document.querySelector('[role="menu"]');
getComputedStyle(menu).getPropertyValue('--border')   // "" → 源头就断了
// 2. 定位到哪一层才有值：把探针 div 分别挂 body / .ant-app / portal 元素下逐层读
// 3. 反查定义处：遍历 document.querySelectorAll('style') 找 '--ant-color-border:' 所在选择器
```

判据：`background: transparent` / `border-width: 0` / `border-radius: 0` / `box-shadow: none`
四项同时出现 + `transitionDuration` 为空 → 直接怀疑变量源不可达，别再查组件逻辑。

## mobi 的正确取值源

`core/config/theme/cssVars.ts` → `injectShadcnThemeCss` 把 shadcn 命名变量写进
`:root`（light）/ `.dark`（dark），**对 portal 同样可见**，是 registry 组件的单一 token 源
（web.md「组件选型」第 4 条）。缺口（描边强弱档、次级文字、面板圆角、两级投影、
motion 变量）补在 `SHADCN_VAR_MAPPINGS` 与 `MOTION_VARS` 里，不在组件里自持。

## 组件侧写法（同名变量会自引用）

组件映射块里**不要重复声明全局已有的同名变量**——`--border: var(--border)` 在同一元素上
构成循环，双方一起失效。规则：全局有的（`--border` / `--border-strong` / `--border-subtle` /
`--foreground` / `--text-secondary` / `--shadow-*`）直接继承，组件只声明全局没有的别名
（`--surface-raised: var(--popover)` 这类）。

## 未清同类隐患

`copy-button.module.css` 仍在用 `var(--ant-*)` 映射。它当前渲染在 `.ant-app` 子树内所以「碰巧」
正常，但一旦被放进 Drawer/Modal（antd 这些也 portal）就会以同样方式失效。
