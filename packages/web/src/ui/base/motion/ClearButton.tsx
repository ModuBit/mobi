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

// 带动效的清除钮（uiarc 系选择组件共享：combobox / multi-select 的 AnimatePresence 出入场）。
// 动效参数（spring.snappy 长入 + 0.6 缩放柔焦、瞬时退出、0.96 按压缩放）为两处上游快照
// 收敛后的单源；外观（尺寸/配色/悬停态）归各组件 css 模块，经 className 传入。
"use client";

import { motion } from "motion/react";
import type { MouseEventHandler } from "react";
import { X } from "lucide-react";
import { motionTokens } from "./motionTokens";

export function ClearButton({ reduce, onClick, onMouseDown, ariaLabel, className, iconSize = 14, strokeWidth = 2 }: {
  reduce: boolean | null;
  onClick: MouseEventHandler<HTMLButtonElement>;
  /** combobox 传入 preventDefault 以保住输入框焦点（multi-select 不需要） */
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  ariaLabel: string;
  className?: string;
  iconSize?: number;
  strokeWidth?: number;
}) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      className={className}
      onClick={onClick}
      onMouseDown={onMouseDown}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: reduce ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast } } }}
      exit={{ opacity: 0, ...(reduce ? {} : { scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }), transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
      whileTap={{ scale: reduce ? 1 : 0.96, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
    >
      <X size={iconSize} strokeWidth={strokeWidth} aria-hidden="true" />
    </motion.button>
  );
}
