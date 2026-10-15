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

// uiarc select（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选（mobi 大量内联场景无可见 label）②占位文案走 i18n
// ③motionTokens 改引 @/ui/base/motion/motionTokens
// ④allowClear：清除钮在触发器外（button 不嵌套），清空走独立 onClear（onValueChange 恒发合法项值）
// ⑤options 支持 title（悬停提示，antd 迁移站点的能力保留）
// ⑥受控判定改 value !== undefined（上游 ?? 回退会把受控清空误读成未受控旧值）；Root 恒受控化——
//   值恒由镜像 state 驱动（"" = 清空态），否则非受控 clear 后 Radix 内部值失同步，重选同一项不再回调
// ⑦ariaLabel 透传到触发器（无可见 label 场景的可访问名）
// ⑧className/style 挂组件根（field）——布局尺寸从根上给，消费方无需包裹 div
// ⑨footer：弹层底部固定区（viewport 滚动区之外，如「+ 新建」入口，EnvironmentBar 先例）
// ⑩variant="borderless"：无边框紧凑触发器（嵌入工具条/环境条场景，antd borderless 对应物）
"use client";

import { forwardRef, useEffect, useId, useState } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ForwardedRef, ReactElement, ReactNode, RefAttributes } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import { GlidingHighlight } from "@/ui/base/motion/GlidingHighlight";
import styles from "./select.module.css";

/** 泛型 over 选项值字面量类型（antd 迁移站点多为联合字面量，onValueChange 不得放宽成 string） */
export interface SelectProps<T extends string = string> extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children" | "value" | "defaultValue" | "onValueChange"> {
  label?: string;
  description?: string;
  placeholder?: string;
  id?: string;
  /** 挂组件根（field）的类名与样式——布局尺寸从根上给，消费方无需包裹 div */
  className?: string;
  style?: CSSProperties;
  /** 清空入口（触发器内清除钮）；清空发 onValueChange(undefined) */
  allowClear?: boolean;
  /** 触发器的可访问名（无可见 label 场景） */
  ariaLabel?: string;
  /** 弹层底部固定区（viewport 滚动区之外）——放「+ 新建」这类常驻入口 */
  footer?: ReactNode;
  /** borderless：无边框紧凑触发器（嵌入工具条场景） */
  variant?: "default" | "borderless";
  value?: T | "";
  defaultValue?: T;
  /** 选中回调（恒发合法项值；清空走 onClear，不触发本回调） */
  onValueChange?: (value: T) => void;
  /** 清空回调（仅 allowClear 渲染的清除钮触发）；与 onValueChange 分离，消费方无需收窄 "" 哨兵 */
  onClear?: () => void;
  options: { value: T; label: string; disabled?: boolean; /** 悬停提示（antd 迁移站点的能力保留） */ title?: string }[];
}

/** 展示值朝列表方向滚动：选更靠后的项从下方升起，更靠前的项从上方落下。 */
const valueRoll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 0.35}em`, filter: `blur(${motionTokens.blur.soft}px)` }),
  center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -0.3}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }),
};
/** reduced motion 保留短交叉淡入；静止态与 valueRoll 一致，保证服务端与客户端标记一致。 */
const valueFade: Variants = { enter: { opacity: 0 }, center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

// 泛型组件 + forwardRef：外层 cast 保留 T 推断（forwardRef 本身无法带泛型参数）
export const Select = forwardRef(function SelectInner<T extends string>(
  { label, description, placeholder, options, id, className, style, disabled, allowClear, ariaLabel, footer, variant = "default", onValueChange, onClear, ...rootProps }: SelectProps<T>,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t("common.select");
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = description ? `${controlId}-description` : undefined;
  const reduceMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState<string>(rootProps.defaultValue ?? "");
  // viewport 用回调 ref 存 state（Radix Viewport 不收 onFocusIn 这类事件 prop，原生监听挂它）
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  // gliding highlight 的当前项：Radix 对键盘导航与鼠标悬停（pointermove 聚焦当前项）都会发
  // focusin，借它感知「当前项」
  const [activeEl, setActiveEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!viewportEl) return;
    const handleFocusIn = (event: FocusEvent) => {
      setActiveEl((event.target as HTMLElement).closest<HTMLElement>('[role="option"]'));
    };
    viewportEl.addEventListener("focusin", handleFocusIn);
    return () => viewportEl.removeEventListener("focusin", handleFocusIn);
  }, [viewportEl]);
  // 受控判定：value 在 props 上（!== undefined）即受控——上游 `value ?? uncontrolled` 的写法会把
  // 受控清空（value 从有值改回 undefined）误读成未受控而回显旧值
  const currentValue: string = rootProps.value !== undefined ? rootProps.value : uncontrolledValue;
  const index = options.findIndex((option) => option.value === currentValue);
  const shown = currentValue ? options[index]?.label ?? "" : placeholderText;
  const [previousIndex, setPreviousIndex] = useState(index);
  const [direction, setDirection] = useState(1);
  if (previousIndex !== index) { setPreviousIndex(index); setDirection(index > previousIndex ? 1 : -1); }
  const showClear = allowClear && !!currentValue && !disabled;
  const clear = (event: React.MouseEvent) => {
    // 拦住冒泡：清除不该顺带开菜单
    event.preventDefault();
    event.stopPropagation();
    setUncontrolledValue("");
    onClear?.();
  };

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")} style={style}>
      {label && <label htmlFor={controlId}>{label}</label>}
      {/* Root 恒受控化：值恒由镜像 state 驱动（"" 是 Radix 认可的清空态，占位正常显示）。
          非受控 clear 若只改本地 state，Radix 内部值还停在旧值——重选同一项因值未变不再回调 */}
      <SelectPrimitive.Root {...rootProps} value={currentValue} disabled={disabled} onValueChange={(next) => { setUncontrolledValue(next); onValueChange?.(next as T); }}>
        <div className={styles.triggerWrap}>
          <SelectPrimitive.Trigger
            ref={ref}
            id={controlId}
            aria-label={ariaLabel}
            aria-describedby={hintId}
            className={[styles.trigger, variant === "borderless" ? styles.triggerBorderless : "", showClear ? styles.hasClear : ""].filter(Boolean).join(" ")}
          >
            {/* Radix 为辅助技术保留真实值；下方的可见文案在值之间做动画。 */}
            <span className={styles.srOnly}><SelectPrimitive.Value placeholder={placeholderText} /></span>
            <span className={styles.valueText} aria-hidden="true">
              <AnimatePresence initial={false} custom={direction}>
                <motion.span key={currentValue ? `value-${currentValue}` : "placeholder"} data-placeholder={currentValue ? undefined : ""} custom={direction} variants={reduceMotion ? valueFade : valueRoll} initial="enter" animate="center" exit="exit">{shown}</motion.span>
              </AnimatePresence>
            </span>
            {/* 清除态由 CSS 隐藏 chevron（.triggerWrap:has(.clear)），位置让给外层清除钮 */}
            <SelectPrimitive.Icon className={styles.chevron}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          {/* 清除钮在触发器外（button 不嵌套），绝对定位叠在 chevron 位 */}
          {showClear && (
            <button type="button" className={styles.clear} aria-label={t("common.clearSelection")} onClick={clear}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className={styles.content} position="popper" sideOffset={4} collisionPadding={12}>
            <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
              <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport ref={setViewportEl} className={styles.viewport}>
              <GlidingHighlight className={styles.highlight} target={activeEl} />
              {options.map((option) => (
                <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} title={option.title} className={styles.item}>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className={styles.indicator}>
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
            {footer && <div className={styles.footer}>{footer}</div>}
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {description && <span id={hintId} className={styles.hint}>{description}</span>}
    </div>
  );
}) as <T extends string = string>(props: SelectProps<T> & RefAttributes<HTMLButtonElement>) => ReactElement | null;
