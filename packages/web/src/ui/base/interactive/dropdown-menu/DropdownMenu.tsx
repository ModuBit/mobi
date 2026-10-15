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
//  6. 透传 open / onOpenChange 受控开合——`content` 项不是菜单项，Radix 不会替它关弹层
//     （附件面板的相机行点了要收起面板），消费方需要能自己关。
//  7. 面板横向贴边校正——Radix 的 shift/flip 对 left/right 档位挪不动横向（原因见
//     usePanelEdgeShift 注释），宽面板在窄屏直接顶出屏幕右缘，由组件侧按实测矩形补上（两级通用）。
//  8. 条目容器——高亮与条目收进 .items（子菜单的滚动容器），面板 padding 留在外层：滚动容器
//     自身的 padding 会随内容滚出视口，表现为「滚动后内容紧贴上下边缘」。
// 注：Radix 的弹层按触发器的矩形定位（floating-ui autoUpdate），因此**触发器必须常驻布局**——
// 消费方若把触发器放进 hover-only 的容器，关闭瞬间容器塌成 display:none、rect 归零到视口
// 原点，仍在退场的菜单会被甩到左上角。此为消费方约束，组件侧不做兜底。
"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, ReactNode, RefCallback } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { motionTokens } from "../../motion/motionTokens";
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
  /**
   * 受控开合（Radix Root 同名 prop 原样透传）。给需要「点了面板里的自定义内容也要收起弹层」
   * 的消费方用——`content` 项不是菜单项，Radix 不会替它关（如附件面板的相机行）。
   * 不给时是 Radix 的非受控形态，行为与之前一致。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

/** 面板与视口边缘的最小间距：与 Radix 入参 collisionPadding 同值，避免两套口径 */
const EDGE_PADDING = 12;

/** 横向贴边校正量的载体（CSS 侧由 .menu/.subMenu 的 translate 消费；未设时 translate 取 none） */
const PANEL_SHIFT_VAR = "--panel-shift-x";

/**
 * 面板的横向贴边校正（本地修改 7）。
 *
 * Radix 的定位中间件管不了横向溢出：PopperContent 写死 `shift({ mainAxis: true, crossAxis: false })`，
 * 而 floating-ui 对 left/right 档位的「crossAxis」正是**横向**（getSideAxis('right') === 'x'）——
 * 开关反了：侧向面板只会上下挪，永远不左右挪；`flip` 在锚点自身就贴着屏幕边时也无处可翻。
 * 结果 = 宽面板直接顶出屏幕右缘（2026-10-12 实测：390px 视口里 340px 的子菜单面板落在 x=200，
 * 右缘 540，溢出 150px；同一份数据在宽屏上看不出来，纯窄屏才暴露）。子菜单是主战场，但一级菜单
 * 指名 side=left/right 时同理，故不分层级一律校正。
 *
 * 这里按实测矩形把面板整体平移回屏内：允许压住父面板（原生菜单就是这个观感），只保证左右各留
 * EDGE_PADDING。位移写进自定义属性，由 CSS 的 `translate` 消费——**不能借用 transform**，那被开合
 * 动画占着。
 *
 * 量的是**外层包裹元素**的矩形而不是面板自身：开合动画给面板挂了 scale，动画期间面板矩形是缩过的
 * （按它算出来的位移会少一截，实测残留 3px 溢出）。包裹元素的布局盒不含这层 transform，取值稳定，
 * 于是位移是绝对量，重算天然幂等。
 */
function usePanelEdgeShift(panel: HTMLDivElement | null): void {
  useLayoutEffect(() => {
    if (!panel) return;
    const el = panel;
    // Radix 的定位写在这层包裹元素的 style 上，它同时是「未被动画缩放」的布局盒
    const wrapper = el.parentElement;
    const apply = () => {
      const box = (wrapper ?? el).getBoundingClientRect();
      const overflowRight = box.right - (window.innerWidth - EDGE_PADDING);
      const overflowLeft = EDGE_PADDING - box.left;
      // 两侧都溢出（面板比视口还宽）时以右缘为准——左缘贴边后右侧仍被裁，总比两侧都露在外面强
      const shift = overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0;
      // 归零时删掉变量而不是写 0px：CSS 靠「未设 ⇒ translate:none」避免面板成为 fixed 后代的包含块
      if (shift === 0) el.style.removeProperty(PANEL_SHIFT_VAR);
      else el.style.setProperty(PANEL_SHIFT_VAR, `${shift}px`);
    };
    // **不能只测一次**：Radix 的定位落在它自己的提交里，可能晚于本 effect——那时量到的矩形还是
    // 「没溢出」，此后再无触发就永远校正不上（首版实测栽在这）。主力是盯包裹元素的 style：
    // 定位一落地/一重算就量一次，确定性来自 Radix 的动作而非帧序。
    // 但 Radix 在菜单开着的每次祖先滚动/窗口变化都会重写定位，逐个 mutation 读矩形＝每次强制一次
    // 布局；故只在「定位或视口宽真变了」时才量（面板自身尺寸变化走下面的 ResizeObserver）。
    let lastPosition = "";
    const positioning = new MutationObserver(() => {
      const signature = `${wrapper?.style.transform ?? ""}|${window.innerWidth}`;
      if (signature === lastPosition) return;
      lastPosition = signature;
      apply();
    });
    if (wrapper) positioning.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
    // 尺寸变化：首次回调本身就带当前尺寸（可当首测），此后面板内容长出来（列表分页）也走这里
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      positioning.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [panel]);
}

/**
 * 菜单面板（一级 Content 或子菜单 SubContent）：自带本级的滑动高亮与键盘/指针判据。
 * 抽成一层是因为子菜单是独立弹出的面板，高亮态必须每级各持一份——子项若共用一级的
 * 高亮元素，会画到一级面板上。
 * 面板带 `data-dropdown-panel`（本级归属标记，判焦点是否从子菜单冒上来）；条目收在
 * `data-dropdown-scroll-root` 的容器里（子项里的滚动哨兵靠它找滚动容器，不给消费方
 * 暴露 CSS Modules 的哈希类名）。
 *
 * **ref 必须透传到面板根元素**：Radix 的 portal 级 `Presence` 把探测 ref 通过
 * `cloneElement` 交给 Portal 的**直接子元素**——也就是本组件。它拿不到 DOM 节点时
 * `stylesRef` 恒为 null，关闭时 `getAnimationName(null)` 判成 `"none"`，于是当帧
 * 就把整棵 portal 卸掉，`.menu[data-state="closed"]` 的退出动画永远跑不起来
 * （上游把 Content 内联在 Portal 里所以没这层；React 19 起函数组件的 ref 走 props）。
 */
function MenuLevel({ variant, items, side, align, sideOffset, alignOffset, ref }: { variant: "root" | "sub"; items: DropdownItem[]; side?: MenuSide; align?: MenuAlign; sideOffset: number; alignOffset?: number; ref?: RefCallback<HTMLDivElement> }) {
  const reduced = useReducedMotion();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const pointer = useRef(false);
  const clearTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  // 面板元素：既要把 Radix Presence 的探测 ref 透传下去（见上方注释），本级还要拿它做贴边校正。
  // 走 state 而非 ref：Radix 的面板比本级的 layout effect 晚一拍才挂上节点（实测 effect 跑时
  // 恒为 null），state 一到就重跑校正 effect，正好赶上可测的时机。
  const [panel, setPanelNode] = useState<HTMLDivElement | null>(null);
  // ref 恒为回调（Radix 的 Presence 用 useComposedRefs 组合探测 ref 后 cloneElement 下来），故只留回调这一路
  const setPanel = useCallback((node: HTMLDivElement | null) => {
    setPanelNode(node);
    ref?.(node);
  }, [ref]);
  // 纵向由 Radix 的 shift 负责（对 left/right 档位它调的正是纵向），横向只能自己补——两级都要
  usePanelEdgeShift(panel);
  // Radix focuses the highlighted item (pointer or keyboard) and the content when the pointer leaves an item.
  function onPanelFocus(event: FocusEvent<HTMLDivElement>) {
    // 子菜单面板是**本面板的 DOM 后代**（Radix 把 SubContent 渲染在父面板里），焦点进子菜单时
    // focusin 会一路冒到本级。不按面板归属过滤的话，本级会把子菜单项的 offsetTop 当成自己的，
    // 高亮被画到面板外——悬停子菜单时面板下方漂着第二个背景色就是这么来的。
    // data-dropdown-panel 是每级面板的唯一标记（条目容器的滚动标记另有其名，见下方 body）。
    if (event.target instanceof HTMLElement && event.target.closest('[data-dropdown-panel]') !== event.currentTarget) return;
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

  // 条目容器（本地修改 8）：高亮与条目同层——一起随内容滚动，offsetTop 也才有同一基准。
  // 面板 padding 留在外层，滚动收在这一层，滚动时上下留白才不会跟着滚走。
  // 子项里的滚动哨兵拿 data-dropdown-scroll-root 当 IntersectionObserver 的 root，故它必须落在
  // 真正滚动的元素上（子菜单高度受限时才是滚动容器）。
  // role="none"：这一层只是布局用的包装，不该插进 role=menu 与 role=menuitem 的归属链中间。
  const body = <div className={styles.items} role="none" data-dropdown-scroll-root>
    {/* One highlight glides between items for the pointer and jumps instantly for the keyboard. */}
    <motion.span className={styles.highlight} data-tone={highlight?.danger ? "danger" : undefined} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduced ? motionTokens.spring.snappy : { duration: 0 }, opacity: { duration: reduced ? 0 : .08 } }}/>
    {items.map(entry)}
  </div>;
  // 子菜单关闭即卸载（Radix Presence）——antd 时代靠 destroyOnHidden 兜的 popup 残留问题不存在
  if (variant === "sub") {
    return <DropdownPrimitive.SubContent ref={setPanel} className={styles.subMenu} data-dropdown-panel sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={EDGE_PADDING} loop onFocus={onPanelFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }} onClick={event => event.stopPropagation()}>{body}</DropdownPrimitive.SubContent>;
  }
  return <DropdownPrimitive.Content ref={setPanel} className={styles.menu} data-dropdown-panel side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={EDGE_PADDING} loop onFocus={onPanelFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }} onClick={event => event.stopPropagation()}>{body}</DropdownPrimitive.Content>;
}

export function DropdownMenu({ label, trigger, items, icon, side = "bottom", align = "end", open, onOpenChange }: DropdownMenuProps) {
  return <DropdownPrimitive.Root modal={false} open={open} onOpenChange={onOpenChange}>
    {/* mobi 本地修改 1：trigger 插槽走 asChild（不挂上游 .trigger 样式——外部触发器自带外观）；未给时保留上游触发器 */}
    {trigger !== undefined
      ? <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      : <DropdownPrimitive.Trigger className={styles.trigger} type="button">{icon && <span className={styles.triggerIcon} aria-hidden="true">{icon}</span>}<TriggerLabel text={label ?? ""}/><ChevronDown className={styles.chevron} size={15} strokeWidth={1.8} aria-hidden="true"/></DropdownPrimitive.Trigger>}
    <DropdownPrimitive.Portal><MenuLevel variant="root" items={items} side={side} align={align} sideOffset={6} /></DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

export default DropdownMenu;
