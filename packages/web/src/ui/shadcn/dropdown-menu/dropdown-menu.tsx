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
// 与下方 mobi 本地修改，需按 registry.json localMods 登记恢复。
// 本地修改：
//  1. trigger 插槽——上游把触发器收归自己（icon + 文本 + chevron，label 必填字符串），
//     mobi 的菜单触发器多数是纯图标或业务按钮，故开一个 ReactNode 插槽走 Trigger asChild；
//     给出 trigger 时上游那套触发器动效（文本宽度补间 / chevron 旋转）自然让位。
//  2. 弹层内容结构重写——上游 items 是扁平纯字符串数组，mobi 需要多级子菜单、ReactNode
//     文案、选中态、悬停提示、自定义项内容（加载占位 / 滚动哨兵）。面板抽成递归的 MenuLevel
//     （每级自带高亮态与焦点判据），子菜单走 Radix Sub（桌面 hover 展开、触屏与键盘 click 展开，
//     均为 Radix 内建），子菜单关闭即卸载由 Radix Presence 保证，无需 antd 时代的 destroyOnHidden。
//  3. Root 改 modal={false}——Radix 的 DropdownMenu 默认 modal，会把 body 置为
//     pointer-events:none，开着一个菜单时整页对其他指针事件失效：点另一个触发器打不开、
//     点空白处也不落到下面的元素。mobi 与 antd Dropdown 共存，antd 非模态（点别的触发器
//     即切换菜单）。改非模态后 Radix 的外点关闭仍生效，且不再锁页面滚动。
//  4. Content 上停掉点击冒泡——React portal 的事件沿 React 树冒泡，菜单挂在可点击的
//     行内部时，选中项会连带触发行自身的 onClick（如导航到会话）。
//  5. 新增 side/align 入参——上游写死 align="end"，antd 站点各有 placement（topLeft /
//     bottomLeft / bottomRight），迁移须能指名方位。
// 注：Radix 的弹层按触发器的矩形定位（floating-ui autoUpdate），因此**触发器必须常驻布局**——
// 消费方若把触发器放进 hover-only 的容器，关闭瞬间容器塌成 display:none、rect 归零到视口
// 原点，仍在退场的菜单会被甩到左上角。此为消费方约束，组件侧不做兜底。
"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, ReactNode, Ref } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { motionTokens } from "../motion-tokens";
import styles from "./dropdown-menu.module.css";

export interface DropdownItem {
  /** 项文案（ReactNode——携带灰字后缀、双行等复合结构都是常态）；与 content 二选一 */
  label?: ReactNode;
  /**
   * 自定义整项内容：渲染为非菜单项（无 role=menuitem、不参与键盘漫游）。
   * 加载占位 / 滚动哨兵 / 空态这类东西塞这里，别塞 label——它们不是可选项。
   */
  content?: ReactNode;
  /** 非空即渲染为二级子菜单（桌面 hover 展开、触屏与键盘 click 展开，关闭即卸载） */
  children?: DropdownItem[];
  /** React key；列表会增删（如分页追加）时必须给，否则用索引 */
  key?: string;
  icon?: ReactNode;
  /**
   * 选中回调。事件是 Radix 在**菜单项元素上**派发的 CustomEvent（target 即该项），
   * 需要按项内容代理点击时（如把动作留在项内自带的按钮上）可从 target 里取。
   */
  onSelect?: (event: Event) => void;
  /** 当前选中：文案转强调色 */
  selected?: boolean;
  /** 原生 title 悬停提示（长文案截断时用） */
  title?: string;
  disabled?: boolean;
  destructive?: boolean;
  /** 在本项前插入一条分隔线 */
  separatorBefore?: boolean;
}

/** label 与 trigger 二选一：给 trigger 时用它作触发器，否则渲染上游的「icon + label + chevron」按钮 */
type DropdownMenuTriggerProps = { label: string; trigger?: ReactNode } | { label?: string; trigger: ReactNode };
export type DropdownMenuProps = DropdownMenuTriggerProps & {
  items: DropdownItem[];
  icon?: ReactNode;
  /** 弹层相对触发器的方位（用 Radix 词汇而非 antd 的 placement，消费方自行换算） */
  side?: MenuSide;
  align?: MenuAlign;
};

type Highlight = { top: number; height: number; danger: boolean; glide: boolean };

/** 弹层的水平对齐：只开放 start / end 两档（antd 的 Left/Right 落点）。
 *  不开放 center——没有站点需要，且 Radix 子菜单面板本身只接受 start/end，一级二级保持同一取值域。 */
type MenuAlign = "start" | "end";
type MenuSide = "top" | "right" | "bottom" | "left";

/** A new trigger label rises in while the old one leaves, and the trigger width springs to the measured text instead of snapping. */
function TriggerLabel({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const measure = useRef<HTMLSpanElement>(null);
  const measured = useRef<string | null>(null);
  const [size, setSize] = useState<{ width: number | "auto"; animate: boolean }>({ width: "auto", animate: false });
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const current = node.textContent;
      // Only a text change morphs; the first measure and font swaps settle instantly.
      const animate = measured.current !== null && measured.current !== current;
      measured.current = current;
      setSize({ width: Math.ceil(entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth), animate });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.span className={styles.label} initial={false} animate={{ width: size.width }} transition={size.animate && !reduced ? motionTokens.spring.morph : { duration: 0 }}>
    <span ref={measure} className={styles.labelMeasure} aria-hidden="true">{text}</span>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={text} className={styles.labelText} initial={reduced ? false : { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{text}</motion.span>
    </AnimatePresence>
  </motion.span>;
}

/**
 * 菜单面板（一级 Content 或子菜单 SubContent）：自带本级的滑动高亮与键盘/指针判据。
 * 抽成一层是因为子菜单是独立弹出的面板，高亮态必须每级各持一份——子项若共用一级的
 * 高亮元素，会画到一级面板上。
 * 面板带 `data-dropdown-scroll-root`：子项里的滚动哨兵靠它找滚动容器（不给消费方
 * 暴露 CSS Modules 的哈希类名）。
 *
 * **ref 必须透传到面板根元素**：Radix 的 portal 级 `Presence` 把探测 ref 通过
 * `cloneElement` 交给 Portal 的**直接子元素**——也就是本组件。它拿不到 DOM 节点时
 * `stylesRef` 恒为 null，关闭时 `getAnimationName(null)` 判成 `"none"`，于是当帧
 * 就把整棵 portal 卸掉，`.menu[data-state="closed"]` 的退出动画永远跑不起来
 * （上游把 Content 内联在 Portal 里所以没这层；React 19 起函数组件的 ref 走 props）。
 */
function MenuLevel({ variant, items, side, align, sideOffset, alignOffset, ref }: { variant: "root" | "sub"; items: DropdownItem[]; side?: MenuSide; align?: MenuAlign; sideOffset: number; alignOffset?: number; ref?: Ref<HTMLDivElement> }) {
  const reduced = useReducedMotion();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const pointer = useRef(false);
  const clearTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  // Radix focuses the highlighted item (pointer or keyboard) and the content when the pointer leaves an item.
  function onPanelFocus(event: FocusEvent<HTMLDivElement>) {
    // 子菜单面板是**本面板的 DOM 后代**（Radix 把 SubContent 渲染在父面板里），焦点进子菜单时
    // focusin 会一路冒到本级。不按面板归属过滤的话，本级会把子菜单项的 offsetTop 当成自己的，
    // 高亮被画到面板外——悬停子菜单时面板下方漂着第二个背景色就是这么来的。
    // data-dropdown-scroll-root 是每级面板的唯一标记（同一属性也供子项里的滚动哨兵找容器）。
    if (event.target instanceof HTMLElement && event.target.closest('[data-dropdown-scroll-root]') !== event.currentTarget) return;
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    window.clearTimeout(clearTimer.current);
    if (!item) {
      // A short grace period keeps the highlight gliding across separators and item gaps.
      clearTimer.current = window.setTimeout(() => setHighlight(null), pointer.current ? 70 : 0);
      return;
    }
    const next = { top: item.offsetTop, height: item.offsetHeight, danger: item.dataset.tone === "danger" };
    const glide = pointer.current;
    setHighlight(current => ({ ...next, glide: glide && current !== null }));
  }

  function entry(item: DropdownItem, index: number) {
    const separator = item.separatorBefore ? <DropdownPrimitive.Separator className={styles.separator} /> : null;
    const tone = item.destructive ? "danger" : undefined;
    const style = { "--i": index } as CSSProperties;
    // 非菜单项内容（占位/哨兵）：没有 role=menuitem，键盘漫游与选中语义都不该落到它头上
    if (item.content !== undefined) {
      return <Fragment key={item.key ?? index}>{separator}<div className={styles.custom} style={style}>{item.content}</div></Fragment>;
    }
    const inner = <>{item.icon && <span className={styles.icon} aria-hidden="true">{item.icon}</span>}{item.label}</>;
    if (item.children?.length) {
      return <Fragment key={item.key ?? index}>{separator}<DropdownPrimitive.Sub>
        <DropdownPrimitive.SubTrigger className={styles.item} data-tone={tone} data-selected={item.selected ? "" : undefined} style={style} disabled={item.disabled} title={item.title}>
          {inner}
          <ChevronRight className={styles.subChevron} size={14} strokeWidth={1.8} aria-hidden="true" />
        </DropdownPrimitive.SubTrigger>
        <MenuLevel variant="sub" items={item.children} sideOffset={2} alignOffset={-5} />
      </DropdownPrimitive.Sub></Fragment>;
    }
    return <Fragment key={item.key ?? index}>{separator}<DropdownPrimitive.Item className={item.destructive ? `${styles.item} ${styles.destructive}` : styles.item} data-tone={tone} data-selected={item.selected ? "" : undefined} style={style} disabled={item.disabled} title={item.title} onSelect={item.onSelect}>{inner}</DropdownPrimitive.Item></Fragment>;
  }

  const body = <>
    {/* One highlight glides between items for the pointer and jumps instantly for the keyboard. */}
    <motion.span className={styles.highlight} data-tone={highlight?.danger ? "danger" : undefined} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduced ? motionTokens.spring.snappy : { duration: 0 }, opacity: { duration: reduced ? 0 : .08 } }}/>
    {items.map(entry)}
  </>;
  // 子菜单关闭即卸载（Radix Presence）——antd 时代靠 destroyOnHidden 兜的 popup 残留问题不存在
  if (variant === "sub") {
    return <DropdownPrimitive.SubContent ref={ref} className={styles.subMenu} data-dropdown-scroll-root sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={12} loop onFocus={onPanelFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }} onClick={event => event.stopPropagation()}>{body}</DropdownPrimitive.SubContent>;
  }
  return <DropdownPrimitive.Content ref={ref} className={styles.menu} data-dropdown-scroll-root side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={12} loop onFocus={onPanelFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }} onClick={event => event.stopPropagation()}>{body}</DropdownPrimitive.Content>;
}

export function DropdownMenu({ label, trigger, items, icon, side = "bottom", align = "end" }: DropdownMenuProps) {
  return <DropdownPrimitive.Root modal={false}>
    {/* mobi 本地修改 1：trigger 插槽走 asChild（不挂上游 .trigger 样式——外部触发器自带外观）；未给时保留上游触发器 */}
    {trigger !== undefined
      ? <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      : <DropdownPrimitive.Trigger className={styles.trigger} type="button">{icon && <span className={styles.triggerIcon} aria-hidden="true">{icon}</span>}<TriggerLabel text={label ?? ""}/><ChevronDown className={styles.chevron} size={15} strokeWidth={1.8} aria-hidden="true"/></DropdownPrimitive.Trigger>}
    <DropdownPrimitive.Portal><MenuLevel variant="root" items={items} side={side} align={align} sideOffset={6} /></DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

export default DropdownMenu;
