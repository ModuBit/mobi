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
 * uiarc 组件族（Button/ActionButton/SplitButton/ButtonGroup）共享的宽度 morph 基建。
 * 这批件源自同一 registry 快照，四份组件原本各持逐字相同的副本；收拢一处后任何
 * 手感调整（armedUntil 窗口、弹簧参数、进出场曲线）只改这里。
 *
 * 注意：FloatingButtonGroup 的常量是有意分叉（浮动场景无 scale），勿收编进来。
 */

import { isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref, RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import { motionTokens } from "@/ui/base/motion/motionTokens";

/** 进出场常量公共集：值与各组件原本地定义逐字一致 */
export const rest: TargetAndTransition = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" };
export const textIn: TargetAndTransition = { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.soft}px)` };
export const textOut: TargetAndTransition = { opacity: 0, y: -3, filter: `blur(${motionTokens.blur.soft}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
export const glyphIn: TargetAndTransition = { opacity: 0, y: 5, filter: `blur(${motionTokens.blur.soft}px)` };
export const glyphOut: TargetAndTransition = { opacity: 0, y: -4, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
export const iconIn: TargetAndTransition = { opacity: 0, scale: .6, filter: `blur(${motionTokens.blur.subtle}px)` };
export const iconOut: TargetAndTransition = { ...iconIn, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
export const fadeIn: TargetAndTransition = { ...rest, opacity: 0 };
export const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** Scale rides the spring; opacity and blur tween so blur never overshoots below zero. */
export const iconEnter = { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }, filter: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } } as const;

/** Names the icon element, so swapping Copy for Check morphs while a re-render of the same icon stays still. */
export function iconKey(node: ReactNode): string {
  if (!isValidElement(node)) return node == null || typeof node === "boolean" ? "" : String(node);
  const type = node.type as string | { displayName?: string; name?: string };
  return typeof type === "string" ? type : type?.displayName ?? type?.name ?? "icon";
}

/** A key for the label content: text plus element names, so a new label or icon crossfades while prop-only updates stay in place. */
export function labelKey(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(labelKey).join("");
  if (!isValidElement(node)) return "";
  const type = node.type as string | { displayName?: string; name?: string };
  return `<${typeof type === "string" ? type : type?.displayName ?? type?.name ?? ""}>${labelKey((node.props as { children?: ReactNode }).children)}`;
}

/** Springs the wrapper to the natural width of its content when the text changes, so new text never snaps the layout.
 *  The outgoing label is popped out of flow at once, so it never holds the old width. Other resizes (a late web font, a parent reflow) jump straight to the new width, so nothing wobbles on first paint. */
export function useMorphWidth(content: RefObject<HTMLElement | null>, key: string, reduced: boolean) {
  const width = useMotionValue<number | "auto">("auto");
  const lastKey = useRef(key), armedUntil = useRef(0);
  useLayoutEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    armedUntil.current = performance.now() + 700;
  }, [key]);
  useEffect(() => {
    const node = content.current, slot = node?.parentElement;
    if (!node || !slot || typeof ResizeObserver === "undefined") return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.contentRect.width;
      if (!next || !measured || reduced || performance.now() > armedUntil.current) { measured = next > 0; width.jump(next || "auto"); delete slot.dataset.morphing; return; }
      slot.dataset.morphing = "";
      animate(width, next, { ...motionTokens.spring.morph, onComplete: () => { delete slot.dataset.morphing; } });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [content, reduced, width]);
  return width;
}

export type Glyph = { id: string; char: string; order: number };
const toGlyphs = (chars: string[], seq: number): Glyph[] => chars.map((char, order) => ({ id: `${seq}:${order}`, char, order }));

/** Shared leading and trailing characters keep their identity, so only the changed run of text is replaced. */
export function useGlyphs(text: string) {
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

/** The morphing glyph row shared by ActionButton / SplitButton. Width handling differs between the two
 *  (ActionButton wraps it in a motion slot, SplitButton morphs its outer slot), so only the glyph row lives here. */
export function MorphGlyphs({ text, reduced, rowClassName, glyphClassName, rowRef }: {
  text: string;
  reduced: boolean;
  rowClassName: string;
  glyphClassName: string;
  rowRef?: Ref<HTMLSpanElement>;
}) {
  const glyphs = useGlyphs(text);
  return <span ref={rowRef} className={rowClassName}>
    <AnimatePresence mode="popLayout" initial={false}>
      {glyphs.map(glyph => <motion.span key={glyph.id} className={glyphClassName} layout={reduced ? false : "position"} layoutDependency={text} initial={reduced ? fadeIn : glyphIn} animate={rest} exit={reduced ? fadeOut : glyphOut} transition={reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: Math.min(glyph.order * motionTokens.stagger.char, .1), layout: motionTokens.spring.morph }}>{glyph.char}</motion.span>)}
    </AnimatePresence>
  </span>;
}
