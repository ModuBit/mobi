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

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styled from '@emotion/styled'

export interface ToolStripItem {
  key: string
  content: ReactNode
}

export interface ToolStripProps {
  items: ToolStripItem[]
  /** 布局占用透传（主栏里 flex:1 占满 + 与 send 之间的全部剩余空间） */
  style?: CSSProperties
}

/** 拖拽位移超过该阈值才算拖动（否则是点击，须原样放行给控件） */
const DRAG_SLOP_PX = 5
/** 两侧渐隐的过渡带宽 */
const FADE_WIDTH = 32
/** 渐隐缓坡的中间停点（带内 40% 处 alpha 0.45）——条级 CSS mask 与逐项投影 mask 共用同一条曲线，只此一份 */
const FADE_MID_ALPHA = 0.45
const FADE_MID_POS = 0.4
/** 松手吸附的回弹时长（与 morph 的定长过渡同档） */
const SNAP_MS = 260
const SNAP_EASE = 'cubic-bezier(.2, 0, 0, 1)'
/** 收起后维持「不裁剪」的时长：morph 退场动画播完再收回裁剪，否则面板被切在半途
 *  （不能交给 CSS transition——clip-path 的 none ↔ inset() 是离散属性，delay 不生效）。
 *  预算对齐 morph 收起全程（物理 spring 的 visual duration 即近似 settle 时长）：
 *  shapeW/shapeX 归位 NARROW .3s、shapeH 收缩 SHRINK .24s、listFace 退场 fade .08s，
 *  取上限加裕量定 400ms——定时器若先于动画到期，条级裁剪与 z 提层在动画中途恢复，
 *  仍宽于 pill 的 shape 会被突然截断、并跌到相邻 pill 下层（描边交叉，真机实锤） */
const UNCLIP_HOLDOVER_MS = 400

/**
 * 横向平移条（composer 参数区专用，替代 ResponsiveActionBar 的溢出收纳）：
 *
 * - **空间不够不折叠、不进「更多」面板**——内容整体横向平移，拖拽 / 滚轮 / 触摸都直接驱动；
 * - **条不做滚动容器**（`overflow: visible`）：裁剪只做视觉（`clip-path: inset(0)`），
 *   平移只做绘制（row 的 `translateX`）。这是与 morph-select 共存的关键——展开面板是
 *   inline 生长、要被条外的空间容纳，若条是滚动容器就必须在展开期间切换 `overflow`，
 *   而那次切换会把 `scrollLeft` 强制归零（整行跳位）、抢在 morph 测量之后改布局
 *   （面板钳制算错）、收起时又把退场动画裁掉。改绘制层平移后三者一并消失；
 * - **展开期间撤视觉裁剪与渐隐**（纯绘制属性，零布局影响）：展开即撤；收起后按
 *   `UNCLIP_HOLDOVER_MS` **延时恢复**（JS 定时器，见常量注释——CSS transition 的
 *   delay 对 clip-path 的离散值切换不生效），让 morph 退场动画播完再收裁剪；
 * - **拖拽结尾吞点击**：拖过的那次 click 是拖拽收势，不是选择，capture 阶段拦掉；
 * - **松手吸附**：就近落到项边界或两端，静止态永远是完整 pill 起头，不切半个；
 * - **键盘可达**：焦点进入条内控件时自动把它平移进视野。
 */
/** 条级渐隐 mask 的三态渐变（停点与 fadeAlphaAt 是同一条曲线，见 FADE_MID_* 注释）；-webkit- 前缀给 iOS PWA（同 tabStrip） */
const MASK_END = `linear-gradient(to right, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / ${FADE_MID_ALPHA}) calc(100% - ${FADE_WIDTH * FADE_MID_POS}px), transparent)`
const MASK_START = `linear-gradient(to right, transparent, rgb(0 0 0 / ${FADE_MID_ALPHA}) ${FADE_WIDTH * FADE_MID_POS}px, #000 ${FADE_WIDTH}px)`
const MASK_BOTH = `linear-gradient(to right, transparent, rgb(0 0 0 / ${FADE_MID_ALPHA}) ${FADE_WIDTH * FADE_MID_POS}px, #000 ${FADE_WIDTH}px, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / ${FADE_MID_ALPHA}) calc(100% - ${FADE_WIDTH * FADE_MID_POS}px), transparent)`

const Root = styled.div<{ 'data-fade'?: 'none' | 'start' | 'end' | 'both' }>`
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: visible;
  /* 横向交给我们自己拖（pointer 事件），纵向仍归浏览器（页面滚动、面板内长列表） */
  touch-action: pan-y;
  /* 视觉裁剪：内容溢出不外泄。展开期间撤掉（data-panel=open，纯绘制属性、零布局影响），
     收起后由 JS 延时恢复以播完 morph 退场动画（见 UNCLIP_HOLDOVER_MS 注释）。
     撤裁剪的同时逐项做「窗口修饰」（decorateItems：裁到可视窗口 + 逐项渐隐），
     否则滚出条外的项会一起漏出来、而条级渐隐又跟着丢了 */
  clip-path: inset(0);
  &[data-panel='open'] {
    clip-path: inset(-9999px);
    /* 展开期间整条提层：row 的 transform/will-change 自成堆叠上下文，morph 给展开态
       root 的 z-index:30 出不去，不提层就会被 DOM 靠后的 send 按钮压住 */
    z-index: 20;
  }
  /* 渐隐双停点缓坡：描边淡出是渐进的，不是线性硬切 */
  &[data-fade='end'] {
    mask-image: ${MASK_END};
    -webkit-mask-image: ${MASK_END};
  }
  &[data-fade='start'] {
    mask-image: ${MASK_START};
    -webkit-mask-image: ${MASK_START};
  }
  &[data-fade='both'] {
    mask-image: ${MASK_BOTH};
    -webkit-mask-image: ${MASK_BOTH};
  }
  /* 展开中的 morph 面板不容裁剪：渐隐一并撤（mask 同样会裁到条外的面板） */
  &[data-panel='open'] {
    mask-image: none;
    -webkit-mask-image: none;
  }
  @media (hover: hover) {
    /* 有溢出才提示可拖；拖动进行中换抓握 */
    &[data-fade='end'], &[data-fade='start'], &[data-fade='both'] {
      cursor: grab;
    }
    &[data-dragging='true'] {
      cursor: grabbing;
    }
  }
`

const Row = styled.div`
  display: flex;
  align-items: center;
  flex: none;
  /* 项间距与 ResponsiveActionBar 同档 4px */
  gap: 4px;
  will-change: transform;
`

type FadeState = 'none' | 'start' | 'end' | 'both'

/** morph-select 展开态在其根元素上的公开标记（registry 组件有意暴露的 data-open），勿再探测其内部 ARIA 结构 */
const OPEN_PANEL_SELECTOR = '[data-open]'

/** 展开面板（列表/搜索框）内部的按下不属于拖条——拖的是面板自己的内容 */
function insideOpenPanel(target: Element): boolean {
  return target.closest('[role="listbox"], input, textarea') !== null
}

function computeFade(offset: number, max: number): FadeState {
  if (max <= 1) return 'none'
  if (offset >= -1) return 'end'
  if (offset <= -max + 1) return 'start'
  return 'both'
}

/**
 * 条级渐隐的 alpha 曲线（条坐标 x，视口宽 view，渐隐带 band）：
 * 带内 0 → 0.45(40%) → 1 的缓坡，带外为 1（窗口内）或 0（窗口外）。
 * 与条自身 mask-image 的停点同形（FADE_MID_* 双方共用）——逐项渐隐靠它投影。
 */
function fadeAlphaAt(x: number, view: number, band: number): number {
  if (x <= 0 || x >= view) return 0
  const ramp = (r: number) => r < FADE_MID_POS
    ? FADE_MID_ALPHA * (r / FADE_MID_POS)
    : FADE_MID_ALPHA + (1 - FADE_MID_ALPHA) * ((r - FADE_MID_POS) / (1 - FADE_MID_POS))
  if (x < band) return ramp(x / band)
  if (x > view - band) return ramp((view - x) / band)
  return 1
}

/**
 * 把条的渐隐曲线投影到单个项自身的坐标（项在条内的区间 [left, left+width]）。
 * 展开期间条级的 mask 必须撤（否则面板被裁），渐隐改由每个「未展开项」自己表达。
 * 返回空串表示该项区间内 alpha 恒为 1（无需 mask）。
 */
function itemFadeMask(left: number, width: number, view: number, band: number): string {
  const stops = new Map<number, number>([
    // 项两端各取一次，保证覆盖整个项宽
    [0, fadeAlphaAt(left, view, band)],
    [width, fadeAlphaAt(left + width, view, band)],
  ])
  // 落在项区间内的曲线关键点（停点转折处）逐个采样
  for (const x of [0, band * FADE_MID_POS, band, view - band, view - band * FADE_MID_POS, view]) {
    if (x > left && x < left + width) stops.set(Math.round((x - left) * 10) / 10, fadeAlphaAt(x, view, band))
  }

  const ordered = [...stops.entries()].sort((a, b) => a[0] - b[0])
  if (ordered.every(([, alpha]) => alpha >= 0.999)) return ''
  const parts = ordered.map(([pos, alpha]) => `rgba(0, 0, 0, ${alpha.toFixed(3)}) ${pos.toFixed(1)}px`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

export function ToolStrip({ items, style }: ToolStripProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<FadeState>('none')
  const [dragging, setDragging] = useState(false)
  const [unclipped, setUnclipped] = useState(false)
  const offsetRef = useRef(0)
  // 内容宽 − 视口宽，只在 ResizeObserver 回调里现测（避免拖拽/滚轮热路径强制布局）
  const maxRef = useRef(0)
  // unclipped 的 ref 镜像，仅供拖拽/滚轮热路径读取——applyOffset 身份因此稳定，
  // ResizeObserver 与 wheel 监听不随面板开合拆除重建；state 仍是渲染事实源
  const unclippedRef = useRef(false)

  /**
   * 展开期间逐项「窗口修饰」：裁到条的可视窗口（防止滚出条外的项漏出来）+
   * 按条的渐隐曲线做逐项 mask（条级 mask 已撤，渐隐不能跟着丢）。
   * 被展开的那项整体跳过——它的面板正是要越出条边界的。
   * 判据用布局盒（offsetLeft/offsetWidth），不用 getBoundingClientRect：
   * 面板是绝对定位的子孙，会让 rect 远大于项本身。
   */
  const decorateItems = useCallback((active: boolean) => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return
    const view = root.clientWidth
    for (const el of Array.from(row.children) as HTMLElement[]) {
      const isExpanded = el.querySelector(OPEN_PANEL_SELECTOR) !== null
      if (!active || isExpanded) {
        el.style.clipPath = ''
        el.style.maskImage = ''
        continue
      }
      const left = el.offsetLeft + offsetRef.current
      const right = left + el.offsetWidth
      const clip = (left >= -0.5 && right <= view + 0.5)
        ? ''
        : `inset(0px ${Math.max(0, right - view).toFixed(1)}px 0px ${Math.max(0, -left).toFixed(1)}px)`
      const mask = (left < FADE_WIDTH || right > view - FADE_WIDTH)
        ? itemFadeMask(left, el.offsetWidth, view, FADE_WIDTH)
        : ''
      // -webkit- 前缀给 iOS PWA（同条级 mask 三态，见 Root 样式）
      el.style.clipPath = clip
      el.style.maskImage = mask
      el.style.webkitMaskImage = mask
    }
  }, [])

  /** 平移量（≤0，左移为正）→ 绘制。materialize=false 跟手，true 走吸附回弹 */
  const applyOffset = useCallback((next: number, animate: boolean) => {
    const row = rowRef.current
    if (!row) return
    const max = maxRef.current
    const clamped = Math.min(0, Math.max(-max, next))
    offsetRef.current = clamped
    row.style.transition = animate ? `transform ${SNAP_MS}ms ${SNAP_EASE}` : 'none'
    row.style.transform = `translateX(${clamped}px)`
    setFade(computeFade(clamped, max))
    if (unclippedRef.current) decorateItems(true)
  }, [decorateItems])

  /** 就近吸附：候选为两端与每个项的起点，松手后静止态不切半个 pill */
  const snapTarget = useCallback((current: number) => {
    const row = rowRef.current
    if (!row) return 0
    const max = maxRef.current
    if (max <= 0) return 0
    const candidates = [0, -max]
    for (const el of Array.from(row.children) as HTMLElement[]) {
      const c = -el.offsetLeft
      if (c < 0 && c > -max) candidates.push(c)
    }
    let best = candidates[0]
    for (const c of candidates) {
      if (Math.abs(c - current) < Math.abs(best - current)) best = c
    }
    return best
  }, [])

  // 尺寸变化（容器收窄、项增删——row 尺寸随项增删变化，ResizeObserver 即可覆盖）后
  // 重测溢出量并重新夹紧。items 数组身份每渲染都变（父组件内联构造），不作依赖，
  // 否则每次击键都拆建观察器 + 强制布局。
  useEffect(() => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return
    const sync = () => {
      maxRef.current = Math.max(0, row.getBoundingClientRect().width - root.clientWidth)
      applyOffset(offsetRef.current, false)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    observer.observe(row)
    return () => observer.disconnect()
  }, [applyOffset])

  // 触控板/滚轮横向滑动：仅接管横向分量，纵向放行给页面
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      if (maxRef.current <= 0) return
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      applyOffset(offsetRef.current - event.deltaX, false)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [applyOffset])

  // 裁剪开关归 JS：展开即撤（面板是 inline 生长，条会把它切掉），收起延时恢复
  // （morph 退场动画要播完）。只切纯绘制属性，不碰布局，与 morph 的测量无交互。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer: number | null = null
    const sync = () => {
      const open = root.querySelector(OPEN_PANEL_SELECTOR) !== null
      if (open) {
        if (timer !== null) { window.clearTimeout(timer); timer = null }
        setUnclipped(true)
      } else if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null
          setUnclipped(false)
        }, UNCLIP_HOLDOVER_MS)
      }
    }
    const observer = new MutationObserver(sync)
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-open'] })
    sync()
    return () => {
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  // 项增删（权限模式等条件渲染）或展开态切换时重算逐项裁剪；
  // 依赖用 key 序列而非数组身份（items 每渲染都是新数组）；
  // 同一处把 unclipped 同步进热路径 ref（单一写点，见 unclippedRef 注释）
  const itemKeys = items.map(item => item.key).join()
  useEffect(() => {
    unclippedRef.current = unclipped
    decorateItems(unclipped)
  }, [unclipped, decorateItems, itemKeys])

  const drag = useRef({ active: false, moved: false, startX: 0, startOffset: 0, pointerId: -1 })

  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target
    if (!(target instanceof Element) || insideOpenPanel(target)) return
    drag.current = { active: true, moved: false, startX: event.clientX, startOffset: offsetRef.current, pointerId: event.pointerId }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    // 只认启动拖拽的那根指针：多指触摸时第二指的 move 不参与位移计算
    if (!d.active || event.pointerId !== d.pointerId) return
    const dx = event.clientX - d.startX
    if (!d.moved && Math.abs(dx) < DRAG_SLOP_PX) return
    const root = rootRef.current
    if (!root) return
    if (!d.moved) {
      // 过阈值才算拖：捕获指针，移出条外也继续收 move；此后同指针的 click 是收势
      d.moved = true
      setDragging(true)
      try { root.setPointerCapture(d.pointerId) } catch { /* 指针可能已抬起 */ }
    }
    applyOffset(d.startOffset + dx, false)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current
    if (!d.active || event.pointerId !== d.pointerId) return
    const moved = d.moved
    d.active = false
    setDragging(false)
    if (!moved) return
    applyOffset(snapTarget(offsetRef.current), true)
    // 吞点击判据须活到收势 click（pointerup 之后同步派发）之后，用宏任务兜底复位：
    // 否则被中断的拖拽（pointercancel / 条外松手，无 click 跟随）会让 moved 残留，
    // 误吞下一次不经 pointerdown 的 click（如键盘 Tab + Enter）
    window.setTimeout(() => { drag.current.moved = false })
  }

  const onClickCapture = (event: React.MouseEvent) => {
    if (!drag.current.moved) return
    // 拖拽收势不是选择：拦掉本次点击，并复位标记
    event.preventDefault()
    event.stopPropagation()
    drag.current.moved = false
  }

  // 键盘焦点进入条内控件时，把它平移进视野（条本身不可滚动，须显式保证可达）。
  // 判据是「最近一次交互来自键盘」：指针的点击/拖动也会让控件获得焦点（morph 展开时
  // 还会主动 focus trigger），而它就在指针下、本来可见——此时平移反而把内容顶走
  // （曾导致每次展开内容跳动）。不用 :focus-visible：Chrome 对程序化 focus 的判定
  // 会把它算作可见（实测拦不住）。
  const lastInputRef = useRef<'keyboard' | 'pointer'>('pointer')
  useEffect(() => {
    const onKeyDown = () => { lastInputRef.current = 'keyboard' }
    const onPointerDown = () => { lastInputRef.current = 'pointer' }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  const onFocusCapture = (event: React.FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    window.requestAnimationFrame(() => {
      const root = rootRef.current
      const row = rowRef.current
      if (!root || !row || !target.isConnected) return
      if (lastInputRef.current !== 'keyboard') return
      const item = (target.closest('[data-strip-item]') as HTMLElement | null) ?? target
      const left = item.offsetLeft + offsetRef.current
      const right = left + item.offsetWidth
      let next = offsetRef.current
      if (left < 0) next = -item.offsetLeft
      else if (right > root.clientWidth) next = root.clientWidth - item.offsetLeft - item.offsetWidth
      if (next !== offsetRef.current) applyOffset(next, true)
    })
  }

  return (
    <Root ref={rootRef} data-fade={fade} data-dragging={dragging} data-panel={unclipped ? 'open' : undefined}
      style={style}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture} onFocusCapture={onFocusCapture}
    >
      <Row ref={rowRef}>
        {items.map(item => (
          <span key={item.key} data-strip-item style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
            {item.content}
          </span>
        ))}
      </Row>
    </Root>
  )
}
