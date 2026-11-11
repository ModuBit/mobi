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

// uiarc search-field（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选——可选时不渲染 label 节点（行内/侧栏搜索靠 placeholder 自述，
//   无障碍名退化用 aria-label 或 placeholder）②motionTokens 改引 @/ui/base/motion/motionTokens
// ③className 挂组件根（field）——布局尺寸从根上给（上游挂在 input 上）
// ④aria-label "Clear search" 改走 i18n（ui.searchField.clear）
// ⑤shell 圆角暴露 --search-field-radius 变量 seam——胶囊形态由调用方声明意图，
//   不再依赖「field 的直接子即 shell」的内部 DOM 结构
// ⑥清除钮接 ClearButton 单源（与 combobox/multi-select 同一编排，消漂移副本）
// ⑦loading prop——搜索进行中前导图标换旋转指示（旧 antd Input.Search 的 prefix loading 语义保全）
// ⑧style 上提组件根（.field 是 display:grid 无宽度语义，消费方的 flex/width 挂内层 input
//   在 flex 行里失效缩到固有宽）——布局用 style、文字用 inputStyle 分轨
"use client";

import { forwardRef, useCallback, useId, useRef } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Search, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ClearButton } from "@/ui/base/motion/ClearButton";
import styles from "./search-field.module.css";

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** 搜索进行中：前导图标换旋转 loading（替代旧 antd Input.Search 的 prefix loading 指示） */
  loading?: boolean;
  /** 内层 input 的文字样式（fontSize/fontFamily 等）；布局尺寸走 style（落组件根） */
  inputStyle?: CSSProperties;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ label, value, onValueChange, loading, id, className, style, inputStyle, ...props }, ref) {
  const { t } = useTranslation();
  const generated = useId(); const controlId = id ?? generated; const reduced = useReducedMotion(); const inputRef = useRef<HTMLInputElement | null>(null);
  // useCallback 稳定回调 ref 身份：受控组件每次键入都重渲染，内联箭头会让 React 每个 commit 都解绑/重绑
  const setRefs = useCallback((node: HTMLInputElement | null) => { inputRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }, [ref]);
  // Clearing returns focus to the field, since the clear button unmounts under the pointer.
  function clear() { onValueChange(""); inputRef.current?.focus(); }
  const clearLabel = t("ui.searchField.clear");
  return <div style={style} className={[styles.field, className].filter(Boolean).join(" ")}>
    {label && <label htmlFor={controlId}>{label}</label>}
    <div className={styles.shell} data-filled={value ? "true" : undefined}>
      {loading ? <Loader2 width={18} height={18} aria-hidden="true" className={styles.loadingIcon} /> : <Search width={18} height={18} aria-hidden="true" />}
      <input {...props} style={inputStyle} ref={setRefs} id={controlId} type="search" value={value} onChange={event => onValueChange(event.target.value)} className={styles.input} aria-label={props["aria-label"] ?? (label ? undefined : props.placeholder)} />
      {/* The clear button has a reserved slot, so the field never changes width when it appears or leaves. */}
      {/* 清除钮走 ClearButton 单源（combobox/multi-select 同一编排），外观归 .shell button 规则 */}
      <span className={styles.clearSlot}><AnimatePresence initial={false}>{value ? <ClearButton key="clear" reduce={reduced} onClick={clear} ariaLabel={clearLabel} iconSize={16} /> : null}</AnimatePresence></span>
    </div>
  </div>;
});

SearchField.displayName = "SearchField";
