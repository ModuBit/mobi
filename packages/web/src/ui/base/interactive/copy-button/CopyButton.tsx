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

// uiarc 源码组件（shadcn 模型，进项目即归我们维护）；升级 add --overwrite 会冲掉本头
// 与下方本地修改，需按 registry.json localMods 登记恢复。
// 本地修改：新增 copiedLabel/failedLabel props（上游硬编码英文 "Copied"/"Failed"/
// "Could not copy"，违反 i18n 纪律——调用方传译文案，默认值保上游语义）。
"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { CircleAlert, Copy } from "lucide-react";
import { motionTokens } from "../../motion/motionTokens";
import { useCopyFeedback } from "./useCopyFeedback";
import styles from "./copy-button.module.css";

export interface CopyButtonProps {
  value: string;
  label?: string;
  /** 复制成功文案（icon 形态无可见文案，仅进 aria-live；上游默认 "Copied"） */
  copiedLabel?: string;
  /** 复制失败文案（上游默认 "Failed" / "Could not copy"） */
  failedLabel?: string;
  className?: string;
  iconOnly?: boolean;
  variant?: "outline" | "plain";
  disabled?: boolean;
}

/** Copy feedback stays calm but keeps pace with the rest of the UI (mobi 动效调速，与 morph-select 同比例提速约 30%):
 *  a critically damped spring and soft crossfades, same motion in reverse when the confirmation hands back to idle — nothing snaps. */
const settle = { type: "spring", visualDuration: .35, bounce: .06 } as const;
const enter = { duration: .25, ease: [...motionTokens.ease.enter] } as const;
const leave = { duration: .14, ease: [...motionTokens.ease.standard] } as const;
const instant = { duration: motionTokens.duration.instant } as const;
const soft = `blur(${motionTokens.blur.soft}px)`;
const rest: TargetAndTransition = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" };
const fadeIn: TargetAndTransition = { ...rest, opacity: 0 };
const fadeOut: TargetAndTransition = { opacity: 0, transition: instant };
/** Icons trade places in one soft breath: the old glyph shrinks into a blur while the new one grows out of it on the slow spring. */
const iconIn: TargetAndTransition = { opacity: 0, scale: .6, filter: soft };
const iconOut: TargetAndTransition = { opacity: 0, scale: .6, filter: soft, transition: { duration: .16, ease: [...motionTokens.ease.standard] } };
const iconEnter: Transition = { scale: settle, opacity: { ...enter, delay: .02 }, filter: { ...enter, delay: .02 } };
/** Letters rise about .3em out of a soft blur; the outgoing ones lift away a little faster. */
const glyphIn: TargetAndTransition = { opacity: 0, y: 4, filter: soft };
const glyphOut: TargetAndTransition = { opacity: 0, y: -3, filter: soft, transition: leave };

/** The success tick draws itself from its short stroke, the way a hand would write it: quick to start, then easing into place while the icon settles. */
function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <motion.path d="M4 12l5 5L20 6" initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: .35, ease: [...motionTokens.ease.standard], delay: .03 }, opacity: { duration: .01, delay: .03 } }} />
  </svg>;
}

type Glyph = { id: string; char: string; order: number };
const toGlyphs = (chars: string[], seq: number): Glyph[] => chars.map((char, order) => ({ id: `${seq}:${order}`, char, order }));

/** Shared leading and trailing characters keep their identity, so "Copy" to "Copied" only replaces the changed letters. */
function useGlyphs(text: string) {
  const [state, setState] = useState(() => ({ text, seq: 0, glyphs: toGlyphs([...text], 0) }));
  if (state.text === text) return state.glyphs;
  const prev = [...state.text], next = [...text];
  let start = 0, end = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  while (end < prev.length - start && end < next.length - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  if (start < 2) start = 0;
  if (end < 2) end = 0;
  const seq = state.seq + 1;
  const glyphs = [...state.glyphs.slice(0, start), ...toGlyphs(next.slice(start, next.length - end), seq), ...state.glyphs.slice(state.glyphs.length - end)];
  setState({ text, seq, glyphs });
  return glyphs;
}

/**
 * The label cell already reserves its widest state, so the row stays put and only the letters move. It is a layout root:
 * the letters measure their glide inside the label only, so when the button itself moves (a page entering, a panel
 * sliding, a list reflowing) they ride along instead of flying in from where the button used to be.
 */
function MorphText({ text, reduced }: { text: string; reduced: boolean }) {
  const glyphs = useGlyphs(text);
  return <motion.span className={styles.glyphs} layoutRoot>
    <AnimatePresence mode="popLayout" initial={false}>
      {glyphs.map(glyph => <motion.span key={glyph.id} className={styles.glyph} layout={reduced ? false : "position"} layoutDependency={text} initial={reduced ? fadeIn : glyphIn} animate={rest} exit={reduced ? fadeOut : glyphOut} transition={reduced ? instant : { ...enter, delay: Math.min(glyph.order * .015, .08), layout: settle }}>{glyph.char}</motion.span>)}
    </AnimatePresence>
  </motion.span>;
}

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", failedLabel = "Failed", className, iconOnly = false, variant = "outline", disabled }: CopyButtonProps) {
  const { state, copy } = useCopyFeedback();
  const reduced = useReducedMotion() ?? false;
  const text = state === "copied" ? copiedLabel : state === "error" ? failedLabel : label;

  return <><button
    type="button"
    className={[styles.button, iconOnly && styles.iconOnly, variant === "plain" && styles.plain, className].filter(Boolean).join(" ")}
    onClick={() => void copy(value)}
    aria-label={label}
    data-copy-state={state}
    disabled={disabled}
  >
    <span className={styles.icon} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span key={state} className={styles.iconInner} data-state={state} initial={reduced ? fadeIn : iconIn} animate={rest} exit={reduced ? fadeOut : iconOut} transition={reduced ? instant : iconEnter}>
          {state === "copied" ? <DrawnCheck reduced={reduced} /> : state === "error" ? <CircleAlert size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
        </motion.span>
      </AnimatePresence>
    </span>
    {!iconOnly && <span className={styles.label} aria-hidden="true">
      <span className={styles.measure}>{label}</span><span className={styles.measure}>{copiedLabel}</span><span className={styles.measure}>{failedLabel}</span>
      <MorphText text={text} reduced={reduced} />
    </span>}
  </button><span className={styles.srOnly} role="status" aria-live="polite">{state === "idle" ? "" : state === "error" ? `${label}: ${failedLabel}` : `${label}: ${copiedLabel}`}</span></>;
}
