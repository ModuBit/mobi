/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * morph-select 的形变 spring 与其推导出的「收起全程」预算。
 *
 * 单独成文件只为一件事：**收起预算得让 ToolStrip 看见**。composer 的工具条用
 * `clip-path` 裁掉溢出内容，展开期间必须撤掉（面板是 inline 生长的，会被裁没），
 * 收起后要等 morph 的退场动画播完才能恢复——那个延时的正确值由本文件的 spring
 * 参数决定，此前以 400ms 的字面量复制在 ToolStrip 里，只靠一行注释维系同步。
 */

import type { Transition } from "motion/react";

/** Duration springs restated as stiffness and damping, so a retarget mid flight keeps the velocity it already has. */
export const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};

/* mobi 调速：上游观感偏缓（GROW .4 / WIDTH .42），整体提速约 30%——pill 长成列表干脆利落。
   2026-10-16 对**展开路径**二次提速（.28/.3 → .22）：e2e 实测按下到面板出现 17–27ms、
   零掉帧、零 long task，但视觉 213ms 已走完 95%、尺寸要 530ms 才收敛——慢的是弹簧
   尾巴不是帧，缩 visualDuration 直接砍掉这段空转。收起路径（SHRINK/NARROW）未动。 */
const GROW_VD = .22, WIDTH_VD = .22, NARROW_VD = .3, SHRINK_VD = .24, GLIDE_VD = .2;

export const GROW = physical(GROW_VD, .12);
export const SHRINK = physical(SHRINK_VD, 0);
export const GLIDE = physical(GLIDE_VD, .08);
export const WIDTH = physical(WIDTH_VD, .16);
/** Width that narrows never overshoots: dipping even half a pixel under the closed width ellipsizes the label and nudges the chevron. */
export const NARROW = physical(NARROW_VD, 0);

/**
 * 收起全程预算：收起时 shapeW/shapeX 走 NARROW、shapeH 走 SHRINK，叠加 listFace 的
 * 退场 fade（.08s）。取各 visualDuration 上限 + 100ms 裕量。兄弟组件（ToolStrip 的
 * 裁剪恢复延时）按它排期——改上面的 spring 参数，那边自动跟随。
 */
export const CLOSE_SETTLE_MS = Math.ceil(Math.max(NARROW_VD, SHRINK_VD, 0.08) * 1000) + 100;
