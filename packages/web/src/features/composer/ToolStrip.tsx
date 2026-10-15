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
const FADE_WIDTH = 24

/**
 * 横向滚动条（composer 参数区专用，替代 ResponsiveActionBar 的溢出收纳）：
 *
 * - **空间不够不折叠、不进「更多」面板**——直接横向滚动，移动端吃原生触摸滚动，
 *   PC（鼠标/触控板指针）走自实现拖拽滚动（按下横移即滚，超过 SLOP 判拖拽）；
 * - **拖拽结尾吞点击**：拖过的那次 click 是拖拽收势，不是选择，capture 阶段拦掉，
 *   避免拖完顺手误开触发器；morph 触发器是 click 开合，阈值判定天然错过拖拽；
 * - **两侧渐进渐隐**（mask-image）：只给真正溢出的一侧上淡出，滚到头即撤；
 * - **morph-select 展开的兼容**：展开面板是 inline 生长（非 portal），会被滚动容器
 *   裁剪。展开期间（`:has([aria-expanded="true"])`）整条放开裁剪与渐隐——滚动天然
 *   停在展开态（指针都在面板里），收起后恢复；滚动容器规则里 overflow 一旦非
 *   visible，另一轴的 visible 会被计算成 auto，所以放开时两轴一起放开。
 */
const Root = styled.div<{ 'data-fade'?: 'none' | 'start' | 'end' | 'both' }>`
  display: flex;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  /* 条很矮，滚动条不占空间：藏掉但保留可滚性（滚轮/拖拽/触摸都在） */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  /* 渐隐挂在滚动容器自身（mask 会裁剪全部子树，展开态必须整条撤掉） */
  &[data-fade='end'] {
    mask-image: linear-gradient(to right, #000 calc(100% - ${FADE_WIDTH}px), transparent);
  }
  &[data-fade='start'] {
    mask-image: linear-gradient(to right, transparent, #000 ${FADE_WIDTH}px);
  }
  &[data-fade='both'] {
    mask-image: linear-gradient(to right, transparent, #000 ${FADE_WIDTH}px, #000 calc(100% - ${FADE_WIDTH}px), transparent);
  }
  /* 展开中的 morph 面板不容裁剪：两轴一起放开（见组件头注释），渐隐一并撤 */
  &:has([role='combobox'][aria-expanded='true']) {
    overflow: visible;
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
`

type FadeState = 'none' | 'start' | 'end' | 'both'

/** 展开面板（列表/搜索框）内部的按下不属于拖条——拖的是面板自己的内容 */
function insideOpenPanel(target: Element): boolean {
  return target.closest('[role="listbox"], input, textarea') !== null
}

export function ToolStrip({ items, gap = 4, className, style }: ToolStripProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<FadeState>('none')
  const [dragging, setDragging] = useState(false)

  const updateFade = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const next: FadeState = max <= 1
      ? 'none'
      : el.scrollLeft <= 1 ? 'end'
        : el.scrollLeft >= max - 1 ? 'start'
          : 'both'
    setFade((prev) => prev === next ? prev : next)
  }, [])

  // 尺寸（容器/内容任一）与滚动位置变化都重算两侧渐隐
  useEffect(() => {
    const el = rootRef.current
    const row = rowRef.current
    if (!el || !row) return
    const observer = new ResizeObserver(updateFade)
    observer.observe(el)
    observer.observe(row)
    el.addEventListener('scroll', updateFade, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', updateFade)
    }
  }, [updateFade])

  // items 增删（权限模式等条件渲染）也可能改变溢出态
  useEffect(updateFade, [items, updateFade])

  const drag = useRef({ active: false, dragged: false, startX: 0, startScroll: 0, pointerId: -1 })

  const onPointerDown = (event: React.PointerEvent) => {
    // 触摸端交给原生滚动；面板内部按下不拖
    if (event.pointerType === 'touch') return
    const target = event.target
    if (!(target instanceof Element) || insideOpenPanel(target)) return
    const el = rootRef.current
    if (!el) return
    drag.current = { active: true, dragged: false, startX: event.clientX, startScroll: el.scrollLeft, pointerId: event.pointerId }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    if (!d.active) return
    const dx = event.clientX - d.startX
    if (!d.dragged && Math.abs(dx) < DRAG_SLOP_PX) return
    const el = rootRef.current
    if (!el) return
    if (!d.dragged) {
      // 过阈值才算拖：捕获指针，移出条外也继续收 move；此后同指针的 click 是收势
      d.dragged = true
      setDragging(true)
      try { el.setPointerCapture(d.pointerId) } catch { /* 指针可能已抬起 */ }
    }
    el.scrollLeft = d.startScroll - dx
  }

  const endDrag = () => {
    drag.current.active = false
    setDragging(false)
  }

  const onClickCapture = (event: React.MouseEvent) => {
    if (!drag.current.dragged) return
    // 拖拽收势不是选择：拦掉本次点击，并复位标记（下一次按下重置，双保险）
    event.preventDefault()
    event.stopPropagation()
    drag.current.dragged = false
  }

  return (
    <Root ref={rootRef} data-fade={fade} data-dragging={dragging} className={className} style={style}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag} onClickCapture={onClickCapture}
    >
      <Row ref={rowRef} gap={gap}>
        {items.map(item => <span key={item.key} style={{ display: 'flex', alignItems: 'center' }}>{item.render()}</span>)}
      </Row>
    </Root>
  )
}
