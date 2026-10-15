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

// 高亮色块弹簧跟随当前项（uiarc 系选择组件共享：select / combobox / multi-select）。
// 调用方传「当前项元素」（各自经 focusin / activeIndex 追踪），本组件只负责弹簧挪动；
// 首次落位与 reduced motion 直接就位不动画；target 卸挂（菜单关闭残留引用）时复位，
// 下次重开从干净状态开始。绝对定位在滚动容器内，随内容一起滚，无需滚动补偿。
"use client";

import { motion, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef } from "react";
import { motionTokens } from "./motionTokens";

export function GlidingHighlight({ className, target }: { className?: string; target: HTMLElement | null }) {
  const reduceMotion = useReducedMotion();
  // 高亮跟随用 snappy 档（dropdown-menu 的 highlight 同款）：smooth（0.4s 临界阻尼）对
  // 逐项滑动来说偏肉，真机手感对比后收敛到 snappy（0.26s 带一点弹性）
  const top = useSpring(0, motionTokens.spring.snappy);
  const height = useSpring(0, motionTokens.spring.snappy);
  const placedRef = useRef(false);
  useEffect(() => {
    // 卸挂节点（菜单关闭后的残留 target）视同复位：重开时首个有效目标直接落位
    if (!target || !target.isConnected) {
      placedRef.current = false;
      return;
    }
    const jump = !placedRef.current || !!reduceMotion;
    placedRef.current = true;
    if (jump) {
      top.jump(target.offsetTop);
      height.jump(target.offsetHeight);
      return;
    }
    top.set(target.offsetTop);
    height.set(target.offsetHeight);
  }, [target, reduceMotion, top, height]);
  return <motion.div className={className} data-on={target?.isConnected ? "" : undefined} style={{ top, height }} aria-hidden="true" />;
}
