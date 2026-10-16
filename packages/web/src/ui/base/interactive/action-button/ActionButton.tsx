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

// uiarc action-button（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①默认 successLabel/pendingLabel 改走 i18n（uiarc.actionButton.*，上游硬编码英文）
// ②motionTokens 改引 @/ui/base/motion/motionTokens（上游 ../lib/motion-tokens 不存在）
// ③arc foundation 变量消费 cssVars.ts :root 单源（UIARC_ALIAS_VARS），组件 css 无本地映射块
// 其余与上游一致；antd 迁移映射（spec：.scratch/button-migration/spec.md）：
// <Button loading onClick={async () => {...}} /> + message.success 的「执行中/已成功」双态
// → onAction 返回 Promise + successLabel/resetAfterMs（状态内聚在按钮内，无需外部反馈）。
"use client";

import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TargetAndTransition, Variants } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
// morph 基建（宽度 spring / glyph diff / 进出场常量）与 Button/SplitButton/ButtonGroup 共享单源
import { fadeIn, fadeOut, iconEnter, iconIn, iconOut, MorphGlyphs, rest, useMorphWidth } from "../morphShared";
import styles from "./action-button.module.css";

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> {
  label: string;
  successLabel?: string;
  pendingLabel?: string;
  onAction: () => void | Promise<void>;
  resetAfterMs?: number;
  onActionError?: (error: unknown) => void;
}

const pressVariants: Variants = {
  pressed: (button: RefObject<HTMLButtonElement | null>) => ({ scale: (button.current?.offsetWidth ?? 0) > 220 ? .985 : .97, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }),
};
/** The arrow leaves in the direction of the action and returns from behind once the button resets. */
const arrowIn: TargetAndTransition = { opacity: 0, x: -6, filter: `blur(${motionTokens.blur.subtle}px)` };
const arrowOut: TargetAndTransition = { opacity: 0, x: 8, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const iconRest: TargetAndTransition = { ...rest, x: 0 };

/** The success tick draws itself from its short stroke, the way a hand would write it. */
function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg className={styles.statusIcon} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <motion.path d="M4 12l5 5L20 6" initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: .05 }, opacity: { duration: .05, delay: .05 } }} />
  </svg>;
}

/** Morphs one label into the next: kept letters glide into place, new ones rise in from a soft blur, and the width follows on a spring. */
function MorphText({ text, reduced }: { text: string; reduced: boolean }) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const width = useMorphWidth(rowRef, text, reduced);
  return <motion.span className={styles.morph} style={{ width }} aria-hidden="true">
    <MorphGlyphs text={text} reduced={reduced} rowClassName={styles.glyphs} glyphClassName={styles.glyph} rowRef={rowRef} />
  </motion.span>;
}

export function ActionButton({ label, successLabel, pendingLabel, onAction, resetAfterMs = 2400, onActionError, className, disabled, ...props }: ActionButtonProps) {
  const { t } = useTranslation();
  // 默认态文案走 i18n（上游此处硬编码英文）；显式传入的 label 优先
  const successText = successLabel ?? t("uiarc.actionButton.saved");
  const pendingText = pendingLabel ?? t("uiarc.actionButton.saving");
  const [state, setState] = useState<"idle" | "pending" | "success">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const text = state === "pending" ? pendingText : state === "success" ? successText : label;

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function run() {
    if (state === "pending") return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState("pending");
    try {
      await onAction();
      setState("success");
      if (resetAfterMs > 0) resetTimer.current = setTimeout(() => setState("idle"), resetAfterMs);
    } catch (error) {
      setState("idle");
      onActionError?.(error);
    }
  }

  const pending = state === "pending";
  const arrow = state === "idle";

  // Pending stays focusable (aria-disabled instead of disabled), so a keyboard user keeps focus through the whole save.
  return <motion.button {...props} ref={buttonRef} tabIndex={props.tabIndex ?? 0} type={props.type ?? "button"} className={[styles.button, className].filter(Boolean).join(" ")} disabled={disabled} aria-disabled={pending ? true : props["aria-disabled"]} aria-busy={pending} data-state={state} onClick={run} custom={buttonRef} variants={pressVariants} whileTap={reduceMotion || disabled || pending ? undefined : "pressed"} transition={motionTokens.spring.snappy}>
    <span className={styles.content} aria-hidden="true">
      <MorphText text={text} reduced={reduceMotion} />
      <span className={styles.iconSlot}><AnimatePresence initial={false}><motion.span key={state} className={styles.phase} initial={reduceMotion ? fadeIn : arrow ? arrowIn : iconIn} animate={iconRest} exit={reduceMotion ? fadeOut : arrow ? arrowOut : iconOut} transition={reduceMotion ? { duration: motionTokens.duration.instant } : iconEnter}>{pending ? <span className={styles.spinner} /> : state === "success" ? <DrawnCheck reduced={reduceMotion} /> : <ArrowRight className={styles.arrow} width={17} height={17} />}</motion.span></AnimatePresence></span>
    </span>
    <span className={styles.visuallyHidden}>{label}</span>
    <span className={styles.visuallyHidden} role="status">{state === "pending" ? pendingText : state === "success" ? successText : ""}</span>
  </motion.button>;
}

export default ActionButton;
