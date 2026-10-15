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
// ④弹层翻转 + gliding highlight + ClearButton 共享件接入
// ⑤className/style 挂组件根（field）——布局尺寸从根上给，消费方无需包裹 div
// ⑥mode="tags"：chip 内联输入（antd Select mode="tags" 对应物）——候选可点选，
//   任意值可自由输入（Enter/逗号创建 chip、Backspace 空查询删尾、输入过滤候选），
//   自由值 label 兜底为值本身；MemorySection 记忆隔离先例
"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import { GlidingHighlight } from "@/ui/base/motion/GlidingHighlight";
import { ClearButton } from "@/ui/base/motion/ClearButton";
import styles from "./multi-select.module.css";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** chip 窄盒里的短形态（长值截断后不可读时用，如路径取尾段目录名）；下拉仍显 label */
  shortLabel?: string;
  /** chip 悬停提示（默认 chip 上显示完整 label；shortLabel 场景传全值） */
  title?: string;
}

export interface MultiSelectProps {
  label?: string;
  options: MultiSelectOption[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  description?: string;
  /** 折叠溢出 chip 为 +N 计数；缺省 = default 模式 2、tags 模式全显（换行不折叠） */
  maxVisible?: number;
  disabled?: boolean;
  /** 触发器的可访问名（无可见 label 场景） */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  /** tags：chip 内联输入，候选可点选、任意值可自由输入（antd Select mode="tags" 对应物） */
  mode?: "default" | "tags";
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

export function MultiSelect({ label, options, value, defaultValue = [], onValueChange, placeholder, description, maxVisible, disabled = false, ariaLabel, className, style, mode = "default" }: MultiSelectProps) {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t("common.select");
  const tags = mode === "tags";
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const selected = value ?? internal;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const optionOf = (item: string) => options.find((option) => option.value === item);
  const labelFor = (item: string) => optionOf(item)?.label ?? item;
  const effectiveMaxVisible = maxVisible ?? (tags ? Number.POSITIVE_INFINITY : 2);
  const visible = selected.slice(0, effectiveMaxVisible).map((item) => {
    const option = optionOf(item);
    return { value: item, label: labelFor(item), shortLabel: option?.shortLabel, title: option?.title ?? option?.label };
  });
  const remaining = Math.max(0, selected.length - visible.length);
  // 关闭的菜单忘记高亮与搜索词，下次打开从干净状态开始，而非停在过期的悬停行。
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) { setWasOpen(open); if (!open) { setActiveIndex(-1); if (query) setQuery(""); } }
  const [previousRemaining, setPreviousRemaining] = useState(remaining);
  const [countDirection, setCountDirection] = useState(1);
  if (previousRemaining !== remaining) { setPreviousRemaining(remaining); setCountDirection(remaining > previousRemaining ? 1 : -1); }

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  // 弹层翻转：视口底缘放不下且上方空间更大时向上弹（开合各测一次，开合间不追踪）。
  // close 时保留 dropUp——重开时 effect 会重测，中间态不可见
  const [dropUp, setDropUp] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const menu = root?.querySelector<HTMLDivElement>("." + styles.menu);
    if (!root || !menu) return;
    const rect = root.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setDropUp(below < menu.scrollHeight + 12 && rect.top > below);
  }, [open]);

  // tags 模式：输入过滤候选（自由值不在候选里，Enter 直接创建）
  const filteredOptions = useMemo(() => {
    if (!tags) return options;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery));
  }, [tags, options, query]);

  const update = (next: string[]) => { if (value === undefined) setInternal(next); onValueChange?.(next); };
  const toggle = (option: MultiSelectOption) => {
    if (disabled || option.disabled) return;
    update(selectedSet.has(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value]);
  };
  const clear = () => { update([]); setOpen(false); };
  const menuOptions = tags ? filteredOptions : options;
  const enabled = menuOptions.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  const commitQuery = () => {
    const next = query.trim();
    setQuery("");
    setActiveIndex(-1);
    if (next && !selectedSet.has(next)) update([...selected, next]);
  };
  const pickActive = () => {
    const option = activeIndex >= 0 ? menuOptions[activeIndex] : undefined;
    setQuery("");
    setActiveIndex(-1);
    if (option) toggle(option);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
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
  // tags 输入框键盘：Enter/逗号创建自由值（有导航项时优先点选）、空查询 Backspace 删尾 chip
  const onTagsKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (open && activeIndex >= 0 && menuOptions[activeIndex]) pickActive();
      else commitQuery();
      return;
    }
    if (event.key === "Backspace" && !query && selected.length) { event.preventDefault(); update(selected.slice(0, -1)); return; }
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); return; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && enabled.length) {
      event.preventDefault(); setOpen(true);
      const current = enabled.indexOf(activeIndex);
      const next = current < 0 ? (event.key === "ArrowDown" ? 0 : enabled.length - 1) : event.key === "ArrowDown" ? (current + 1) % enabled.length : (current - 1 + enabled.length) % enabled.length;
      setActiveIndex(enabled[next]!);
    }
  };
  const reduce = useReducedMotion();

  // chips 溢出折叠 + 弹簧开合动效（default/tags 两种触发器共用）；tags 模式 chip 带单删 ×
  const removeItem = (item: string) => { if (!disabled) update(selected.filter((v) => v !== item)); };
  const chipsNode = (
    <AnimatePresence initial={false}>
      {visible.map((item) => <motion.span key={`chip-${item.value}`} className={styles.slot} variants={reduce ? slotFade : slot} initial="hidden" animate="shown" exit="gone"><motion.span className={styles.chip} variants={reduce ? chipStill : chip}>{tags ? (
        <>
          {/* label 收进独立截断盒：× 常驻流内不被长路径的 ellipsis 挤出裁掉；
              shortLabel 短形态 + title 悬停全值保证截断后仍可辨认 */}
          <span className={styles.chipLabel} title={item.title}>{item.shortLabel ?? item.label}</span>
          <button
            type="button"
            className={styles.chipX}
            aria-label={t("common.removeItem", { name: item.shortLabel ?? item.label })}
            disabled={disabled}
            onClick={(event) => { event.stopPropagation(); removeItem(item.value); }}
          >
            <X size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        </>
      ) : item.label}</motion.span></motion.span>)}
      {remaining > 0 && <motion.span key="more" className={styles.slot} variants={reduce ? slotFade : slot} initial="hidden" animate="shown" exit="gone"><motion.span className={styles.more} variants={reduce ? chipStill : chip}>+<span className={styles.count}><AnimatePresence initial={false} custom={countDirection}><motion.span key={remaining} custom={countDirection} variants={reduce ? fade : roll} initial="hidden" animate="shown" exit="gone">{remaining}</motion.span></AnimatePresence></span></motion.span></motion.span>}
    </AnimatePresence>
  );

  return <div ref={rootRef} className={[styles.field, className].filter(Boolean).join(" ")} style={style}>
    {label && <span id={labelId} className={styles.label}>{label}</span>}
    <div className={styles.control}>
      {tags ? <div className={`${styles.trigger} ${styles.triggerTags} ${selected.length ? styles.hasClear : ""}`} onClick={() => inputRef.current?.focus()}>
        {chipsNode}
        <input
          ref={inputRef}
          className={styles.tagsInput}
          value={query}
          type="text"
          autoComplete="off"
          disabled={disabled}
          placeholder={selected.length ? "" : placeholderText}
          aria-label={ariaLabel ?? label ?? placeholderText}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? `${id}-listbox` : undefined}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={onTagsKeyDown}
        />
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      </div> : <button type="button" className={`${styles.trigger} ${selected.length ? styles.hasClear : ""}`} disabled={disabled} aria-label={ariaLabel} aria-labelledby={label && !ariaLabel ? `${labelId} ${valueId}` : undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown}>
        <span id={valueId} className={styles.srOnly}>{selected.length ? selected.map(labelFor).join(", ") : placeholderText}</span>
        <span className={styles.value} aria-hidden="true">
          {chipsNode}
          {!selected.length && <motion.span key="placeholder" className={styles.placeholder} variants={fade} initial="hidden" animate="shown" exit="gone">{placeholderText}</motion.span>}
        </span>
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      </button>}
      <AnimatePresence initial={false}>{selected.length > 0 && !disabled && <ClearButton reduce={reduce} ariaLabel={t("common.clearSelection")} className={styles.clear} onClick={clear} />}</AnimatePresence>
      <AnimatePresence initial={false}>
        {open && <motion.div id={`${id}-listbox`} className={[styles.menu, dropUp ? styles.dropUp : ""].filter(Boolean).join(" ")} role="listbox" aria-label={label} aria-multiselectable="true"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: dropUp ? 6 : -6, scale: .97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: enter } } }}
          exit={{ opacity: 0, ...(reduce ? {} : { y: dropUp ? 4 : -4, scale: .98 }), transition: { duration: motionTokens.duration.instant, ease: standard } }}>
          {/* gliding highlight 的当前项（键盘 activeIndex 与悬停 onPointerMove 同源） */}
          <GlidingHighlight className={styles.highlight} target={(activeIndex >= 0 ? optionRefs.current[menuOptions[activeIndex]?.value ?? ""] : null) ?? null} />
          {menuOptions.map((option, index) => <button type="button" role="option" aria-selected={selectedSet.has(option.value)} aria-disabled={option.disabled || undefined} key={option.value} ref={(el) => { if (el) optionRefs.current[option.value] = el; else delete optionRefs.current[option.value]; }} className={styles.option} data-active={activeIndex === index} disabled={option.disabled} onPointerMove={() => { if (activeIndex !== index) setActiveIndex(index); }} onClick={() => { toggle(option); if (tags) { setQuery(""); setActiveIndex(-1); } }}>
            <span>{option.label}</span><AnimatePresence initial={false}>{selectedSet.has(option.value) && <CheckMark key="check" reduce={reduce} />}</AnimatePresence>
          </button>)}
        </motion.div>}
      </AnimatePresence>
    </div>
    {description && <span className={styles.description}>{description}</span>}
  </div>;
}
