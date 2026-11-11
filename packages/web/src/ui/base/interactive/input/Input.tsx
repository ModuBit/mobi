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

// uiarc input（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选——可选时不渲染 label 节点（设置行左标签/FieldRow 自管 label
//   的行内场景，壳内 label 是多余的）②motionTokens 改引 @/ui/base/motion/motionTokens
// ③className 挂组件根（field）——布局尺寸从根上给，消费方无需包裹 div
// ④消息动效链收拢 fieldMessageShared（与 password-field 同源）
// ⑤补 onPressEnter prop——bindInput 四件套的回车提交（IME 组合中的 Enter 不触发）
// ⑥style 上提组件根（.field 是 display:grid 无宽度语义，消费方的 flex/width 挂内层 input
//   在 flex 行里失效缩到固有宽）——布局用 style、文字用 inputStyle 分轨
"use client";

import { forwardRef, useId } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";
import { FieldMessage } from "@/ui/base/interactive/fieldMessageShared";
import { isSubmitEnter } from "@/core/lib/inputEnterKeys";
import styles from "./input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
  /** 控件高度档：md（默认 36，--control-height-md）/ sm（行内 28，--control-height-sm） */
  inputSize?: "sm" | "md";
  /** 回车提交（bindInput 四件套）：IME 组合中的 Enter（确认候选词）不触发 */
  onPressEnter?: () => void;
  /** 内层 input 的文字样式（fontSize/fontFamily 等）；布局尺寸走 style（落组件根） */
  inputStyle?: CSSProperties;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, description, error, inputSize, onPressEnter, id, className, style, inputStyle, ...props }, ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  return <div style={style} className={[styles.field, inputSize === "sm" ? styles.sm : "", className].filter(Boolean).join(" ")}>
    {label && <label className={styles.label} htmlFor={controlId}>{label}</label>}
    <input {...props} style={inputStyle} id={controlId} ref={ref} className={styles.input} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
      onKeyDown={onPressEnter ? (event) => {
        // Enter 提交与消费方 onKeyDown 共存（Escape 取消等场景），组合态不触发
        if (isSubmitEnter(event)) onPressEnter();
        props.onKeyDown?.(event);
      } : props.onKeyDown} />
    <FieldMessage id={hintId} text={description} className={styles.description} />
    <FieldMessage id={errorId} text={error} className={styles.error} alert />
  </div>;
});

Input.displayName = "Input";
