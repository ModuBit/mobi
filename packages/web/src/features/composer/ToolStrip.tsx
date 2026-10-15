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
  render: () => ReactNode
}

export interface ToolStripProps {
  items: ToolStripItem[]
  /** 项间距（composer 参数区与 ResponsiveActionBar 同档 4px） */
  gap?: number
  className?: string
  /** 布局占用透传（主栏里 flex:1 占满 + 与 send 之间的全部剩余空间） */
  style?: CSSProperties
}

/** 拖拽位移超过该阈值才算拖动（否则是点击，须原样放行给控件） */
const DRAG_SLOP_PX = 5
/** 两侧渐隐的过渡带宽 */
const FADE_WIDTH = 32
/** 松手吸附的回弹时长（与 morph 的定长过渡同档） */
const SNAP_MS = 260
const SNAP_EASE = 'cubic-bezier(.2, 0, 0, 1)'
/** 收起后维持「不裁剪」的时长：morph 退场动画播完再收回裁剪，否则面板被切在半途
 *  （不能交给 CSS transition——clip-path 的 none ↔ inset() 是离散属性，delay 不生效） */
const UNCLIP_HOLDOVER_MS = 200

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
const Root = styled.div<{ 'data-fade'?: 'none' | 'start' | 'end' | 'both' }>`
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: visible;
  /* 横向交给我们自己拖（pointer 事件），纵向仍归浏览器（页面滚动、面板内长列表） */
  touch-action: pan-y;
  /* 视觉裁剪：内容溢出不外泄。展开期间撤掉（data-panel=open，纯绘制属性、零布局影响），
     收起后由 JS 延时恢复以播完 morph 退场动画（见 UNCLIP_HOLDOVER_MS 注释） */
  clip-path: inset(0);
  &[data-panel='open'] {
    clip-path: inset(-9999px);
  }
  /* 渐隐双停点缓坡：描边淡出是渐进的，不是线性硬切 */
  &[data-fade='end'] {
    mask-image: linear-gradient(to right, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / 0.45) calc(100% - ${FADE_WIDTH * 0.4}px), transparent);
  }
  &[data-fade='start'] {
    mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.45) ${FADE_WIDTH * 0.4}px, #000 ${FADE_WIDTH}px);
  }
  &[data-fade='both'] {
    mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.45) ${FADE_WIDTH * 0.4}px, #000 ${FADE_WIDTH}px, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / 0.45) calc(100% - ${FADE_WIDTH * 0.4}px), transparent);
  }
  /* 展开中的 morph 面板不容裁剪：渐隐一并撤（mask 同样会裁到条外的面板） */
  &[data-panel='open'] {
    mask-image: none;
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

const Row = styled.div<{ gap: number }>`
  display: flex;
  align-items: center;
  flex: none;
  gap: ${(props) => props.gap}px;
  will-change: transform;
`

type FadeState = 'none' | 'start' | 'end' | 'both'

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

export function ToolStrip({ items, gap = 4, className, style }: ToolStripProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<FadeState>('none')
  const [dragging, setDragging] = useState(false)
  const [unclipped, setUnclipped] = useState(false)
  const offsetRef = useRef(0)

  /** 平移量（≤0，左移为正）→ 绘制。materialize=false 跟手，true 走吸附回弹 */
  const applyOffset = useCallback((next: number, animate: boolean) => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return
    const max = Math.max(0, row.getBoundingClientRect().width - root.clientWidth)
    const clamped = Math.min(0, Math.max(-max, next))
    offsetRef.current = clamped
    row.style.transition = animate ? `transform ${SNAP_MS}ms ${SNAP_EASE}` : 'none'
    row.style.transform = `translateX(${clamped}px)`
    setFade(computeFade(clamped, max))
  }, [])

  /** 就近吸附：候选为两端与每个项的起点，松手后静止态不切半个 pill */
  const snapTarget = useCallback((current: number) => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return 0
    const max = Math.max(0, row.getBoundingClientRect().width - root.clientWidth)
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

  // 尺寸变化（容器收窄、项增删）后重新夹紧；items 变化保持当前位置
  useEffect(() => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return
    const sync = () => applyOffset(offsetRef.current, false)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    observer.observe(row)
    return () => observer.disconnect()
  }, [items, applyOffset])

  // 触控板/滚轮横向滑动：仅接管横向分量，纵向放行给页面
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      const row = rowRef.current
      if (!row) return
      if (Math.max(0, row.getBoundingClientRect().width - root.clientWidth) <= 0) return
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
      const open = root.querySelector('[role="combobox"][aria-expanded="true"]') !== null
      if (open) {
        if (timer !== null) { window.clearTimeout(timer); timer = null }
        setUnclipped(true)
      } else if (timer === null && root.getAttribute('data-panel') === 'open') {
        timer = window.setTimeout(() => { timer = null; setUnclipped(false) }, UNCLIP_HOLDOVER_MS)
      }
    }
    const observer = new MutationObserver(sync)
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    sync()
    return () => {
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const drag = useRef({ active: false, moved: false, startX: 0, startOffset: 0, pointerId: -1 })

  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target
    if (!(target instanceof Element) || insideOpenPanel(target)) return
    drag.current = { active: true, moved: false, startX: event.clientX, startOffset: offsetRef.current, pointerId: event.pointerId }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    if (!d.active) return
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

  const onPointerUp = () => {
    const d = drag.current
    if (!d.active) return
    const moved = d.moved
    d.active = false
    setDragging(false)
    if (moved) applyOffset(snapTarget(offsetRef.current), true)
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
      className={className} style={style}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture} onFocusCapture={onFocusCapture}
    >
      <Row ref={rowRef} gap={gap}>
        {items.map(item => (
          <span key={item.key} data-strip-item style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
            {item.render()}
          </span>
        ))}
      </Row>
    </Root>
  )
}
