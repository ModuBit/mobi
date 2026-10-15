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

// uiarc combobox（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选 ②占位/清空/空态文案走 i18n ③motionTokens 改引 @/ui/base/motion/motionTokens
// ④className/style 挂组件根（field）——布局尺寸从根上给，消费方无需包裹 div
// ⑤受控 open/onOpenChange（footer 入口需主动收起弹层的场景，缺省内部自管）
// ⑥footer：弹层底部固定区（listbox 滚动区之后，如「+ 新建」入口，EnvironmentBar 先例）
// ⑦variant="borderless"：无边框紧凑触发器（嵌入工具条/环境条场景）
// ⑧allowClear 开关（默认 true）：环境条无清空语义（父组件没有「未选」态接口），关掉清除钮
"use client";

import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, InputHTMLAttributes, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import { GlidingHighlight } from "@/ui/base/motion/GlidingHighlight";
import { ClearButton } from "@/ui/base/motion/ClearButton";
import styles from "./combobox.module.css";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  keywords?: string[];
}

export interface ComboboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "placeholder"> {
  label?: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  description?: string;
  placeholder?: string;
  emptyMessage?: string;
  /** 受控开合（footer 入口需主动收起弹层的场景）；缺省 = 内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 弹层底部固定区（listbox 滚动区之后）——放「+ 新建」这类常驻入口 */
  footer?: ReactNode;
  /** borderless：无边框紧凑触发器（嵌入工具条场景） */
  variant?: "default" | "borderless";
  /** 有值时显示清除钮（默认 true） */
  allowClear?: boolean;
  /** 挂组件根（field）的类名与样式——布局尺寸从根上给，消费方无需包裹 div */
  className?: string;
  style?: CSSProperties;
}

/** 高度追随 listbox，走临界阻尼弹簧，过滤时菜单不跳变。 */
function AutoHeight({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean | null }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return <motion.div className={styles.autoHeight} initial={false} animate={{ height }} transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}><div ref={innerRef}>{children}</div></motion.div>;
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    label,
    options,
    value: controlledValue,
    defaultValue = "",
    onValueChange,
    description,
    placeholder,
    emptyMessage,
    id,
    className,
    style,
    disabled,
    onFocus,
    open: openProp,
    onOpenChange,
    footer,
    variant = "default",
    allowClear = true,
    ...inputProps
  },
  forwardedRef,
) {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t("common.searchOrSelect");
  const emptyMessageText = emptyMessage ?? t("common.noMatches");
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const hintId = description ? `${controlId}-description` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reduceMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  // 半受控开合：open prop 在 props 上（!== undefined）即受控（Select 同款判定）
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp !== undefined ? openProp : uncontrolledOpen;
  const updateOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  // 受控判定：value 在 props 上（!== undefined）即受控——`?? uncontrolled` 的写法会把
  // 受控清空（value 从有值改回 undefined）误读成未受控而回显旧值（Select 同款修复）
  const selectedValue = controlledValue !== undefined ? controlledValue : uncontrolledValue;
  const selectedOption = options.find((option) => option.value === selectedValue);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  // 选中的 label 沉淀进输入框：从下方升起带柔焦。清空时占位文案淡入，而非从旧 label 硬切。
  const settledValue = useRef(selectedValue);
  useEffect(() => {
    if (settledValue.current === selectedValue) return;
    settledValue.current = selectedValue;
    const input = inputRef.current;
    if (!input || reduceMotion || (selectedValue && open)) return;
    const controls = selectedValue
      ? animate(input, { opacity: [0, 1], y: ["0.35em", "0em"], filter: [`blur(${motionTokens.blur.soft}px)`, "blur(0px)"] }, { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] })
      : animate(input, { opacity: [0, 1] }, { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] });
    return () => controls.complete();
  }, [selectedValue, reduceMotion, open]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      [option.label, ...(option.keywords ?? [])].some((term) => term.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [options, query]);

  const enabledIndices = filteredOptions.reduce<number[]>((indices, option, index) => {
    if (!option.disabled) indices.push(index);
    return indices;
  }, []);

  useEffect(() => {
    if (!open) return;
    const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
    const option = activeOption ? optionRefs.current[activeOption.value] : null;
    const listbox = option?.parentElement;
    if (option && listbox) {
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < listbox.scrollTop) listbox.scrollTop = top;
      else if (bottom > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = bottom - listbox.clientHeight;
    }
  }, [activeIndex, filteredOptions, open]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        updateOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // 弹层翻转：视口底缘放不下且上方空间更大时向上弹（open 时测一次，开合间不追踪）。
  // close 时保留 dropUp——重开时 effect 会重测，中间态不可见
  const [dropUp, setDropUp] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const popover = root?.querySelector<HTMLDivElement>("." + styles.popover);
    if (!root || !popover) return;
    const rect = root.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setDropUp(below < popover.scrollHeight + 12 && rect.top > below);
  }, [open]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    setUncontrolledValue(option.value);
    onValueChange?.(option.value);
    setQuery("");
    updateOpen(false);
    inputRef.current?.focus();
  };

  const clear = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setUncontrolledValue("");
    onValueChange?.("");
    setQuery("");
    updateOpen(true);
    inputRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled) return;
    updateOpen(true);
    setQuery("");
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (!enabledIndices.length) return;
      const currentPosition = enabledIndices.indexOf(activeIndex);
      const nextPosition = event.key === "ArrowDown"
        ? (currentPosition + 1) % enabledIndices.length
        : (currentPosition - 1 + enabledIndices.length) % enabledIndices.length;
      setActiveIndex(enabledIndices[nextPosition]!);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      // open 未导航（activeIndex=-1）时也要拦住：Enter 冒泡会误触外层表单提交
      const option = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
      if (option) choose(option);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      updateOpen(false);
      setQuery("");
      return;
    }
  };

  const inputValue = open ? query : selectedOption?.label ?? "";
  const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
  // gliding highlight 的当前项（键盘 activeIndex 与悬停 onMouseEnter 同源）
  const activeTarget = (open && activeOption ? optionRefs.current[activeOption.value] : null) ?? null;

  return (
    <div ref={rootRef} className={[styles.field, className].filter(Boolean).join(" ")} style={style}>
      {label && <label htmlFor={controlId}>{label}</label>}
      <div className={[styles.control, variant === "borderless" ? styles.borderless : "", open ? styles.open : "", disabled ? styles.disabled : ""].filter(Boolean).join(" ")}>
        <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          {...inputProps}
          // 可访问名：消费方显式 aria-label 优先，其次可见 label prop 的文本（label htmlFor 场景）
          aria-label={inputProps["aria-label"] ?? label}
          ref={inputRef}
          id={controlId}
          type="text"
          role="combobox"
          value={inputValue}
          // 搜索时已选 label 以弱化占位文案留在原地，而非消失。
          placeholder={selectedOption?.label ?? placeholderText}
          disabled={disabled}
          aria-describedby={hintId}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeOption ? `${controlId}-option-${activeOption.value}` : undefined}
          onFocus={(event) => {
            onFocus?.(event);
            openMenu();
          }}
          onClick={openMenu}
          onChange={(event) => {
            setQuery(event.target.value);
            updateOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <AnimatePresence initial={false}>
          {selectedOption && allowClear && !disabled && (
            <ClearButton
              reduce={reduceMotion}
              ariaLabel={t("common.clearSelection")}
              className={styles.clear}
              iconSize={16}
              strokeWidth={1.75}
              onMouseDown={event => event.preventDefault()}
              onClick={clear}
            />
          )}
        </AnimatePresence>
        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
      </div>
      {description && <span id={hintId} className={styles.hint}>{description}</span>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={[styles.popover, dropUp ? styles.dropUp : ""].filter(Boolean).join(" ")}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: dropUp ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: reduceMotion ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } } }}
            exit={{ opacity: 0, ...(reduceMotion ? {} : { y: dropUp ? 4 : -4, scale: 0.98 }), transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
            role="presentation"
          >
            <AutoHeight reduceMotion={reduceMotion}>
            <div id={listboxId} className={styles.listbox} role="listbox" aria-label={label}>
              <GlidingHighlight className={styles.highlight} target={activeTarget} />
              {filteredOptions.length ? filteredOptions.map((option, index) => (
                <div
                  key={option.value}
                  ref={(element) => {
                    // 卸载侧 delete（而非置 null 留键）：历史出现过的 value 键不无限累积
                    if (element) optionRefs.current[option.value] = element;
                    else delete optionRefs.current[option.value];
                  }}
                  id={`${controlId}-option-${option.value}`}
                  className={styles.option}
                  data-active={index === activeIndex ? "true" : undefined}
                  data-disabled={option.disabled ? "true" : undefined}
                  role="option"
                  aria-selected={option.value === selectedValue}
                  aria-disabled={option.disabled || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  {option.value === selectedValue && <Check className={styles.check} size={16} strokeWidth={1.75} aria-hidden="true" />}
                </div>
              )) : <motion.div className={styles.empty} role="status" initial={reduceMotion ? false : { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{emptyMessageText}</motion.div>}
            </div>
            {footer && <div className={styles.footer}>{footer}</div>}
            </AutoHeight>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

Combobox.displayName = "Combobox";
