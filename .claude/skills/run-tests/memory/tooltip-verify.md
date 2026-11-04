---
name: tooltip-verify
description: AppTooltip/Tooltip 真机验证与秒关诊断：CDP hover 超时、折叠分组隐形行、受控封装互斥自毁（jsdom 测不出）
metadata:
  type: recipe
  last_verified: 2026-11-03
---

# Tooltip 验证与诊断

## 真机验证手法（2026-11-03 实战）

- **tooltip 生命周期观测**：MutationObserver 盯 `[data-radix-popper-content-wrapper]`（childList + `data-state` 属性）+ `performance.now()` 时间戳；**hook `document.dispatchEvent`** 抓 `tooltip.open`（Radix 多实例互斥广播，CustomEvent 不冒泡、普通事件探针抓不到）
- **定位关闭发起者**：给 Tooltip.tsx 的 onOpenChange 加 `new Error().stack` log（Vite HMR 热更后复现），stack 里 `HTMLDocument.<anonymous> @ react-tooltip.js:90` = Root 的 handleClose，被 document 级监听器（TOOLTIP_OPEN / scroll capture）触发
- **CDP hover actionability 超时的两个坑**：
  1. 折叠分组的行（`grid-template-rows: 0fr + opacity: 0`）在 a11y snapshot 里**仍有文本节点**但整子树不可命中——先 elementFromPoint 确认 span 是命中目标，再展开分组
  2. 部分 span 反复超时（原因未定因）——退路：给目标标 `role=button + aria-label` 后 snapshot 拿 uid；仍失败就用合成 `PointerEvent('pointerover'/'pointerout')`（React 不校验 isTrusted；物理光标先停在无 AppTooltip 的区域避免 pointerleave 风暴）
- **找对目标行**：主区标题可能含同名文本（如 "demo"）——过滤 `!closest('main')` + 沿祖先乘 opacity 排除折叠行

## 已修复的坑（勿重蹈）

- **受控封装 × Radix 内建 delayed-open timer 自毁**：全受控 Tooltip 必须传 `delayDuration={0}`——否则 Trigger 的 700ms 内建 timer 到点时闭包 prop 是旧值 false，setOpen(true) 判为「值有变化」→ dispatch tooltip.open 互斥广播 → 把自己关掉（mouseEnterDelay 0.5s 的 tooltip 打开 ~200ms 后自灭）。根因与修复详见 `src/ui/base/interactive/tooltip/Tooltip.tsx` 注释
- **jsdom 测不出该 bug**：fake timers 下 timer 正常触发但闭包 prop 是新值，onChange 不被调（纯 Radix 受控/带 Tooltip.tsx 两种形态均复现不了；最小 useCallback+setTimeout 实验证明 stale closure 机制本身在 jsdom 成立，差异在 Radix 链路内部，未定因）。复现必须真机 E2E；单测只作行为护栏
