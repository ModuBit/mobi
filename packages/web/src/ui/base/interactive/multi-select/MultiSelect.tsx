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

// uiarc multi-select（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选 ②占位/清空文案走 i18n ③motionTokens 改引 @/ui/base/motion/motionTokens
"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import styles from "./multi-select.module.css";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  label?: string;
  options: MultiSelectOption[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  description?: string;
  maxVisible?: number;
  disabled?: boolean;
  /** 触发器的可访问名（无可见 label 场景） */
  ariaLabel?: string;
  className?: string;
}

const enter = motionTokens.ease.enter;
const standard = motionTokens.ease.standard;
/** 每个 chip 坐在一个弹簧开合的宽度槽里，邻居随之移动，互不重叠。 */
const slot: Variants = {
  hidden: { width: 0, opacity: 0 },
  shown: { width: "auto", opacity: 1, transition: { width: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: enter } } },
  gone: { width: 0, opacity: 0, transition: { width: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.instant, ease: standard } } },
};
/** chip 本体从 .9 缩放带柔焦长入，离开时缩回。 */
const chip: Variants = {
  hidden: { scale: 0.9, filter: `blur(${motionTokens.blur.soft}px)` },
  shown: { scale: 1, filter: "blur(0px)", transition: { ...motionTokens.spring.snappy, filter: { duration: motionTokens.duration.standard, ease: enter } } },
  gone: { scale: 0.9, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.instant, ease: standard } },
};
/** reduced motion 保留短交叉淡入；静止态与动效变体一致，保证服务端与客户端标记一致。 */
const fade: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };
const slotFade: Variants = { hidden: { opacity: 0 }, shown: { width: "auto", opacity: 1, transition: { duration: motionTokens.duration.instant } }, gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };
const chipStill: Variants = { hidden: { scale: 1, filter: "blur(0px)" }, shown: { scale: 1, filter: "blur(0px)" }, gone: { scale: 1, filter: "blur(0px)" } };
/** 溢出计数滚动：更大的数从下方升起，更小的从上方落下。 */
const roll: Variants = {
  hidden: (direction: number) => ({ opacity: 0, y: `${direction * 0.5}em`, filter: `blur(${motionTokens.blur.subtle}px)` }),
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: enter } },
  gone: (direction: number) => ({ opacity: 0, y: `${direction * -0.5}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.instant, ease: standard } }),
};

/** 选项被选中时自绘的对勾，移除时收回。 */
function CheckMark({ reduce }: { reduce: boolean | null }) {
  return <svg className={styles.check} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <motion.path d="M4 12.5 9 17.5 20 6.5" initial={reduce ? { opacity: 0 } : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={reduce ? { opacity: 0 } : { pathLength: 0, opacity: 0 }} transition={reduce ? { duration: motionTokens.duration.instant } : { pathLength: { duration: motionTokens.duration.standard, ease: enter }, opacity: { duration: motionTokens.duration.instant } }} />
  </svg>;
}

export function MultiSelect({ label, options, value, defaultValue = [], onValueChange, placeholder, description, maxVisible = 2, disabled = false, ariaLabel, className }: MultiSelectProps) {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t("common.select");
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = value ?? internal;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const labelFor = (item: string) => options.find((option) => option.value === item)?.label ?? item;
  const visible = selected.slice(0, maxVisible).map((item) => ({ value: item, label: labelFor(item) }));
  const remaining = Math.max(0, selected.length - visible.length);
  // 关闭的菜单忘记高亮，下次打开从干净状态开始，而非停在过期的悬停行。
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) { setWasOpen(open); if (!open) setActiveIndex(-1); }
  const [previousRemaining, setPreviousRemaining] = useState(remaining);
  const [countDirection, setCountDirection] = useState(1);
  if (previousRemaining !== remaining) { setPreviousRemaining(remaining); setCountDirection(remaining > previousRemaining ? 1 : -1); }

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const update = (next: string[]) => { if (value === undefined) setInternal(next); onValueChange?.(next); };
  const toggle = (option: MultiSelectOption) => {
    if (disabled || option.disabled) return;
    update(selectedSet.has(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value]);
  };
  const clear = () => { update([]); setOpen(false); };
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Enter" && open && activeIndex >= 0) { event.preventDefault(); toggle(options[activeIndex]!); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((current) => !current); return; }
    if (event.key === "Escape") { setOpen(false); return; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && enabled.length) {
      event.preventDefault(); setOpen(true);
      const current = enabled.indexOf(activeIndex);
      const next = current < 0 ? (event.key === "ArrowDown" ? 0 : enabled.length - 1) : event.key === "ArrowDown" ? (current + 1) % enabled.length : (current - 1 + enabled.length) % enabled.length;
      setActiveIndex(enabled[next]!);
    }
  };
  const reduce = useReducedMotion();

  return <div ref={rootRef} className={[styles.field, className].filter(Boolean).join(" ")}>
    {label && <span id={labelId} className={styles.label}>{label}</span>}
    <div className={styles.control}><button type="button" className={`${styles.trigger} ${selected.length ? styles.hasClear : ""}`} disabled={disabled} aria-label={ariaLabel} aria-labelledby={label && !ariaLabel ? `${labelId} ${valueId}` : undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown}>
      <span id={valueId} className={styles.srOnly}>{selected.length ? selected.map(labelFor).join(", ") : placeholderText}</span>
      <span className={styles.value} aria-hidden="true">
        <AnimatePresence initial={false}>
          {visible.map((item) => <motion.span key={`chip-${item.value}`} className={styles.slot} variants={reduce ? slotFade : slot} initial="hidden" animate="shown" exit="gone"><motion.span className={styles.chip} variants={reduce ? chipStill : chip}>{item.label}</motion.span></motion.span>)}
          {remaining > 0 && <motion.span key="more" className={styles.slot} variants={reduce ? slotFade : slot} initial="hidden" animate="shown" exit="gone"><motion.span className={styles.more} variants={reduce ? chipStill : chip}>+<span className={styles.count}><AnimatePresence initial={false} custom={countDirection}><motion.span key={remaining} custom={countDirection} variants={reduce ? fade : roll} initial="hidden" animate="shown" exit="gone">{remaining}</motion.span></AnimatePresence></span></motion.span></motion.span>}
          {!selected.length && <motion.span key="placeholder" className={styles.placeholder} variants={fade} initial="hidden" animate="shown" exit="gone">{placeholderText}</motion.span>}
        </AnimatePresence>
      </span>
      <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
    </button>
    <AnimatePresence initial={false}>{selected.length > 0 && !disabled && <motion.button type="button" aria-label={t("common.clearSelection")} className={styles.clear} onClick={clear}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: reduce ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast } } }}
      exit={{ opacity: 0, ...(reduce ? {} : { scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }), transition: { duration: motionTokens.duration.instant, ease: standard } }}
      whileTap={{ scale: reduce ? 1 : 0.96, transition: { duration: motionTokens.duration.instant, ease: standard } }}><X size={14} aria-hidden="true" /></motion.button>}</AnimatePresence>
    <AnimatePresence initial={false}>
      {open && <motion.div id={`${id}-listbox`} className={styles.menu} role="listbox" aria-label={label} aria-multiselectable="true"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: enter } } }}
        exit={{ opacity: 0, ...(reduce ? {} : { y: -4, scale: .98 }), transition: { duration: motionTokens.duration.instant, ease: standard } }}>
        {options.map((option, index) => <button type="button" role="option" aria-selected={selectedSet.has(option.value)} aria-disabled={option.disabled || undefined} key={option.value} className={styles.option} data-active={activeIndex === index} disabled={option.disabled} onPointerMove={() => { if (activeIndex !== index) setActiveIndex(index); }} onClick={() => toggle(option)}>
          <span>{option.label}</span><AnimatePresence initial={false}>{selectedSet.has(option.value) && <CheckMark key="check" reduce={reduce} />}</AnimatePresence>
        </button>)}
      </motion.div>}
    </AnimatePresence>
    </div>
    {description && <span className={styles.description}>{description}</span>}
  </div>;
}
