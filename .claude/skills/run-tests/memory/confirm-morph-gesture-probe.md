---
name: confirm-morph-gesture-probe
description: ConfirmMorph 手感回归探针——受信慢按 + 逐帧跳变检测，验「末端震一下」类缺陷
metadata:
  type: recipe
  last_verified: 2026-11-17
---

# ConfirmMorph 手势级回归探针

验「arm 动画末端震一下」类缺陷。合成 `.click()` 触发不了 `:active`，必须受信输入。

## 手势
`chrome-devtools__drag`（from_uid=to_uid）= mousedown→驻留→mouseup 的真实按压，能触发按压挤压（scale .97）。`click` 工具按下-抬起间隔 ~0ms，触发不了中间态，验不了这类 bug。

## 探针（sheet 打开后）
1. evaluate 挂 rAF 采样器到 `window.__samples`（记 surface gBCR width + t），`waitForStableDom: false`
2. take_snapshot 找「卸载」uid → drag(uid, uid) 触发 arm
3. 1.6s 后停采样，断言：**稳定 ≥5 帧（|Δ|<0.4px）后的单帧 |Δ|≥1.5px = 跳变（fail）**
4. 对照值：settle 应为真自然宽 ~212.02（受挤压污染时停 ~205.6 = ×0.97）

## 已修缺陷（勿回归）
- 2026-11-17 cbd6d0a7：arm 同帧 gBCR 被按压回弹 transform 污染（含祖先 transform），spring 停假宽、交还 auto 单帧跳 +6.4px。修 = 非 idle 态 surface transform 0ms 归位（css 本地修改块）。
- 窄容器越界：surface 补 max-width:100%（只钳 surface 不钳 face——face 恒自然宽是 RO 测量前提）。

## 坑
- rAF 在 CDP 环境会节流到 ~20-60fps，断言阈值放宽到 1.5px/帧
- 采样器脚本必须 `waitForStableDom: false`，否则动画期间 DOM 永不稳定 → protocolTimeout
- 手动给 surface 挂 inline transform 模拟污染会连带污染渲染采样（gBCR 含 transform），仅用于机制演示，不用于验收断言
