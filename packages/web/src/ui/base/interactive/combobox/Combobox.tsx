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
// ⑨freeText：自由输入模式——输入框文本本身就是值（不再回落到选中 label），选项作为
//   建议由调用方按当前输入提供（如工作区路径的目录补全），不做内部过滤；配合 loading
//   显示补全请求进行中。默认关闭，既有选择语义不受影响
"use client";

import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, InputHTMLAttributes, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import { AutoHeight } from "@/ui/base/motion/AutoHeight";
import { GlidingHighlight } from "@/ui/base/motion/GlidingHighlight";
import { ClearButton } from "@/ui/base/motion/ClearButton";
import { normalizeNeedle, optionMatches } from "@/ui/base/interactive/optionSearch";
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
  /**
   * 自由输入模式：输入文本即值，选项仅作建议（不做内部过滤、不显示选中勾）。
   * 适合路径补全这类「可以输任意文本，也可以从建议里选」的场景。
   */
  freeText?: boolean;
  /** 建议加载中（freeText 场景显示在输入框右侧） */
  loading?: boolean;
  /** 输入框左侧图标，默认放大镜；路径等场景可换成文件夹 */
  icon?: ReactNode;
  /** 挂组件根（field）的类名与样式——布局尺寸从根上给，消费方无需包裹 div */
  className?: string;
  style?: CSSProperties;
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
    onBlur,
    open: openProp,
    onOpenChange,
    footer,
    variant = "default",
    allowClear = true,
    freeText = false,
    loading = false,
    icon,
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
  // freeText 下输入文本本身就是值：没有「选中项」概念（不显示勾、清除钮也不作用于选项）
  const selectedOption = freeText ? undefined : options.find((option) => option.value === selectedValue);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  // 选中的 label 沉淀进输入框：从下方升起带柔焦。清空时占位文案淡入，而非从旧 label 硬切。
  const settledValue = useRef(selectedValue);
  useEffect(() => {
    if (settledValue.current === selectedValue) return;
    settledValue.current = selectedValue;
    // freeText：每次按键都在改值，不做「选中 label 升起」动画
    if (freeText) return;
    const input = inputRef.current;
    if (!input || reduceMotion || (selectedValue && open)) return;
    const controls = selectedValue
      ? animate(input, { opacity: [0, 1], y: ["0.35em", "0em"], filter: [`blur(${motionTokens.blur.soft}px)`, "blur(0px)"] }, { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] })
      : animate(input, { opacity: [0, 1] }, { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] });
    return () => controls.complete();
  }, [selectedValue, reduceMotion, open, freeText]);

  const filteredOptions = useMemo(() => {
    // freeText：候选由调用方按当前输入提供（如目录补全），组件不再二次过滤
    if (freeText) return options;
    const needle = normalizeNeedle(query);
    if (!needle) return options;
    return options.filter((option) => optionMatches(option, needle));
  }, [options, query, freeText]);

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

  // 单次注册 + latest ref：document 级监听器持有首帧闭包，转发到最新 updateOpen
  // （受控形态切换/回调更换后外点关闭依旧走新回调，不重挂监听）
  const updateOpenRef = useRef(updateOpen);
  updateOpenRef.current = updateOpen;
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        updateOpenRef.current(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // 弹层翻转：视口底缘放不下且上方空间更大时向上弹。
  // 弹层节点以状态承接（回调 ref）：挂载即测量，不靠轮询猜挂载时机；
  // ResizeObserver 追踪异步建议到达后的高度变化（首测偏小会误判向下弹而被视口裁掉）。
  const [dropUp, setDropUp] = useState(false);
  const [popoverNode, setPopoverNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !popoverNode) return;
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < popoverNode.scrollHeight + 12 && rect.top > below);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(popoverNode);
    return () => observer.disconnect();
  }, [open, popoverNode]);

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
      // freeText：回车确认已输入的文本（路径），只收起建议，不提交外层表单
      else if (freeText) {
        updateOpen(false);
        setQuery("");
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      updateOpen(false);
      setQuery("");
      return;
    }
  };

  const inputValue = freeText ? selectedValue : open ? query : selectedOption?.label ?? "";
  const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
  // gliding highlight 的当前项（键盘 activeIndex 与悬停 onMouseEnter 同源）
  const activeTarget = (open && activeOption ? optionRefs.current[activeOption.value] : null) ?? null;

  return (
    <div ref={rootRef} className={[styles.field, className].filter(Boolean).join(" ")} style={style}>
      {label && <label htmlFor={controlId}>{label}</label>}
      <div className={[styles.control, variant === "borderless" ? styles.borderless : "", open ? styles.open : "", disabled ? styles.disabled : ""].filter(Boolean).join(" ")}>
        <span className={styles.searchIcon} aria-hidden="true">
          {icon ?? <Search size={16} strokeWidth={1.75} />}
        </span>
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
          // freeText 下输入框承载值本身，占位就是常规占位文案
          placeholder={freeText ? placeholderText : selectedOption?.label ?? placeholderText}
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
          onBlur={(event) => {
            onBlur?.(event);
            // freeText：焦点离开即收起建议（点击建议在 list 上 preventDefault，不会触发失焦）
            if (!freeText) return;
            updateOpen(false);
            setQuery("");
          }}
          onClick={openMenu}
          onChange={(event) => {
            if (freeText) {
              setUncontrolledValue(event.target.value);
              onValueChange?.(event.target.value);
            } else {
              setQuery(event.target.value);
            }
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
        {loading
          ? <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.75} aria-hidden="true" />
          : <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />}
      </div>
      {description && <span id={hintId} className={styles.hint}>{description}</span>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            ref={setPopoverNode}
            className={[styles.popover, dropUp ? styles.dropUp : ""].filter(Boolean).join(" ")}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: dropUp ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: reduceMotion ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } } }}
            exit={{ opacity: 0, ...(reduceMotion ? {} : { y: dropUp ? 4 : -4, scale: 0.98 }), transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
            role="presentation"
          >
            <AutoHeight>
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
