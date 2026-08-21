---
name: motion-verify
description: CDP 逐帧采样验证动效——rAF 探针记录 computed style 时间序列，暴露 jsdom 测不出的 CSS transition 问题
metadata:
  type: recipe
  last_verified: 2026-08-21
---

# CDP 逐帧采样验证动效

jsdom 不执行 CSS transition / 合成动画——「组件逻辑对但 CSS 未生效」类问题
（如选择器层级错配导致规则从未命中）单测全绿也照样翻车，须真实浏览器采样。

## 步骤（chrome-devtools MCP）

1. `emulate` 移动 viewport（`375x812x2,mobile,touch`）
2. `evaluate_script` 开 drawer 等动画落定（sleep ~700ms）
3. 注入 rAF 探针：每帧 push `{t, 关键元素 computed style}`，采 2s；
   同一脚本里 `setTimeout(() => mask.click(), 500)` 触发关闭
4. 再 `evaluate_script`（sleep > 采样时长）读 `window.__samples`，
   只返回「状态变化帧」（相邻帧 key 去重）防输出爆炸
5. 断言：不该动的元素（如被 CSS 锁的 wrapper）transform/opacity 全程恒定；
   该同步的两条曲线（mask opacity vs sheet translateY）逐帧对齐

## 采过的坑

- antd v6 rootClassName 挂在 `.ant-drawer` 元素本身（wrapper 是直接子元素，
  两层）——按「root > .ant-drawer > wrapper」三层写的 CSS 锁从未命中，
  `.matches(选择器)` 一发命中真相；leave 期间 wrapper opacity 渐变到 0.7
  = 半透明残影
- 采样输出必须去重/抽样，151 帧全量返回会撑爆结果
- 切主题验证：直接写 `localStorage['mobi-ui']` 的 state.theme 后 reload，
  比 UI 点主题切换项可靠
- **antd v6 panel 挂载/可测时序晚于调用方 useLayoutEffect**（fdbd9983 踩坑）：
  首开时 panel 尚未挂载（children 的 ref 为 null），重开时 panel 处于 leave 后
  hidden 态（display:none 子树，offsetHeight 恒 0）——任何「commit 时刻测 panel
  高度」的 effect 两条路径都拿到 0。动画起点这类需求用 `window.innerHeight`
  等视口常量解耦，不要读 offsetHeight。诊断法：临时在 effect 里
  `console.warn({open, mounted, hasRef, h})`，evaluate 里 hook console.warn
  收集（CDP 的 list_console_messages 有时序坑），配合 React 组件栈定位实例
  （`querySelector('[data-testid]')` 在多 drawer 实例时会抓错元素！）
- **布局收缩链验证**：往内容区塞 `style.height='2000px'` 的探针 div 再量各层
  offsetH/clientH/scrollH，断言「该钳的钳住、该滚的 scrollH > clientH」——
  jsdom 不做真实布局（offsetHeight 恒 0），此类问题只能真机/CDP 采样
