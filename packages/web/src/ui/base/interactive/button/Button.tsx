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

// uiarc button（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①motionTokens 改引 @/ui/base/motion/motionTokens（上游 ../lib/motion-tokens 不存在）
// ②arc foundation 变量消费 cssVars.ts :root 单源（UIARC_ALIAS_VARS），组件 css 无本地映射块
// 其余与上游一致；antd 迁移映射（spec：.scratch/button-migration/spec.md）：
// type="primary"→primary、default→secondary、text→ghost、danger→danger、loading→loading、
// size small/缺省/large→sm/md/lg、block→style 宽度、icon={<X/>}→children 内联。
import { forwardRef, useCallback, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode, Ref, RefObject } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { motionTokens } from "@/ui/base/motion/motionTokens";
// morph 基建（宽度 spring / glyph diff / 进出场常量）与 ActionButton/SplitButton/ButtonGroup 共享单源
import { fadeIn, fadeOut, iconEnter, iconIn, iconOut, labelKey, rest, textIn, textOut, useMorphWidth } from "../morphShared";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 占满容器宽度（antd block 的等价 prop，替代散落的 style={{ width: '100%' }}） */
  block?: boolean;
  /** 危险语义色：ghost 底红字（原 antd text danger 的落位，替代散落的 colorError 内联） */
  danger?: boolean;
}

/** Icon buttons press a little deeper, wide buttons a little less, so every size reads as the same push. */
const pressVariants: Variants = {
  pressed: (button: RefObject<HTMLButtonElement | null>) => {
    const width = button.current?.offsetWidth ?? 0;
    return { scale: width > 220 ? .985 : width && width <= 48 ? .96 : .97, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } };
  },
};

function LabelPhase({ children, icon, reduced, ref }: { children: ReactNode; icon: boolean; reduced: boolean; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  return <motion.span ref={ref} className={styles.labelPhase} aria-hidden={present ? undefined : true} initial={reduced ? fadeIn : icon ? iconIn : textIn} animate={rest} exit={reduced ? fadeOut : icon ? iconOut : textOut} transition={reduced ? { duration: motionTokens.duration.instant } : icon ? iconEnter : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{children}</motion.span>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, block = false, danger = false, disabled, children, onClick, ...props },
  ref,
) {
  const reduceMotion = useReducedMotion() ?? false;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const key = labelKey(children);
  const width = useMorphWidth(contentRef, key, reduceMotion);
  const setRefs = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
  }, [ref]);
  // A trigger that anchors a menu, popover, or dialog keeps its rect still while pressed, so the layer never measures a scaled anchor.
  // Radix triggers (asChild) pass aria-haspopup or data-state through; the stylesheet repeats the guard.
  const popup = props["aria-haspopup"];
  const anchorsLayer = (popup !== undefined && popup !== false && popup !== "false") || props.role === "combobox" || (props as Record<string, unknown>)["data-state"] !== undefined;
  const inert = disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const classes = [styles.button, styles[variant], styles[size], block && styles.block, danger && styles.dangerTone, className].filter(Boolean).join(" ");

  return (
    <motion.button
      ref={setRefs}
      tabIndex={props.tabIndex ?? 0}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      custom={buttonRef}
      variants={pressVariants}
      whileTap={reduceMotion || anchorsLayer || inert ? undefined : "pressed"}
      transition={motionTokens.spring.snappy}
      {...props}
      // Loading keeps the button focusable (a disabled button would drop keyboard focus mid-action) and swallows presses instead.
      aria-disabled={loading || props["aria-disabled"] || undefined}
      onClick={loading ? event => event.preventDefault() : onClick}
    >
      <motion.span className={styles.labelSlot} style={{ width }}>
        <span ref={contentRef} className={styles.labelContent}>
          {/* loading 与文案共存（antd 形态）：spinner 行内占位在文案前，文案保持可见 */}
          <AnimatePresence initial={false}>
            {loading ? <motion.span key="loader" className={styles.loader} aria-hidden="true" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? fadeOut : { ...iconOut, scale: .8 }} transition={reduceMotion ? { duration: motionTokens.duration.instant } : iconEnter}><span className={styles.spinner} /></motion.span> : null}
          </AnimatePresence>
          <AnimatePresence mode="popLayout" initial={false}>
            <LabelPhase key={key} icon={!/\S/.test(key.replace(/<[^>]*>/g, ""))} reduced={reduceMotion}>{children}</LabelPhase>
          </AnimatePresence>
        </span>
      </motion.span>
    </motion.button>
  );
});

Button.displayName = "Button";

export default Button;
