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
/** 两侧渐隐的过渡带宽（也是 scroll-snap 的对齐内缩量：静止时 pill 起点恰落在渐隐带外） */
const FADE_WIDTH = 32

/**
 * 横向滚动条（composer 参数区专用，替代 ResponsiveActionBar 的溢出收纳）：
 *
 * - **空间不够不折叠、不进「更多」面板**——直接横向滚动，移动端吃原生触摸滚动，
 *   PC（鼠标/触控板指针）走自实现拖拽滚动（按下横移即滚，超过 SLOP 判拖拽）；
 * - **拖拽结尾吞点击**：拖过的那次 click 是拖拽收势，不是选择，capture 阶段拦掉，
 *   避免拖完顺手误开触发器；morph 触发器是 click 开合，阈值判定天然错过拖拽；
 * - **两侧渐进渐隐**（mask-image）：只给真正溢出的一侧上淡出，滚到头即撤；
 * - **morph-select 展开的兼容**：展开面板是 inline 生长（非 portal），会被滚动容器
 *   裁剪，展开期间须整条放开裁剪与渐隐。但 overflow 转 visible 会把 scrollLeft 强制
 *   归零——整行内容瞬间右弹 scrollLeft 像素（收起再弹回去）。故放开由 JS 接管
 *   （MutationObserver 盯 aria-expanded），在样式重算前读旧 scrollLeft、同批写入
 *   负 margin 补偿位移 + 隐藏滚出可视窗的项（它们原本就被裁剪不可见），视觉零跳动；
 *   收起时恢复 margin 与滚动位。展开中滚动天然停在面板（指针都在面板里）。
 */
const Root = styled.div<{ 'data-fade'?: 'none' | 'start' | 'end' | 'both' }>`
  display: flex;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  /* 静止位置对齐 pill 边界：微滚松手回弹到 0，渐隐带里永远是 pill 尾巴而非半个新 pill。
     proximity 档不打扰拖拽；PC 拖拽期间显式关掉（scrollLeft 逐帧赋值会和 snap 打架），松手恢复由浏览器吸附 */
  scroll-snap-type: x proximity;
  scroll-padding-inline: ${FADE_WIDTH}px;
  &[data-dragging='true'] {
    scroll-snap-type: none;
  }
  /* 内衬让 pill 的描边/投影不贴 overflow 边界硬裁；负外边距把占位还回去，内容起点不变 */
  padding-inline: 6px;
  margin-inline: -6px;
  /* 条很矮，滚动条不占空间：藏掉但保留可滚性（滚轮/拖拽/触摸都在） */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  /* 渐隐挂在滚动容器自身（mask 会裁剪全部子树，展开态必须整条撤掉）。
     双停点缓坡：阴影/描边淡出是渐进的，不是线性硬切 */
  &[data-fade='end'] {
    mask-image: linear-gradient(to right, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / 0.45) calc(100% - ${FADE_WIDTH * 0.4}px), transparent);
  }
  &[data-fade='start'] {
    mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.45) ${FADE_WIDTH * 0.4}px, #000 ${FADE_WIDTH}px);
  }
  &[data-fade='both'] {
    mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.45) ${FADE_WIDTH * 0.4}px, #000 ${FADE_WIDTH}px, #000 calc(100% - ${FADE_WIDTH}px), rgb(0 0 0 / 0.45) calc(100% - ${FADE_WIDTH * 0.4}px), transparent);
  }
  /* 展开中的 morph 面板不容裁剪：两轴一起放开（见组件头注释），渐隐一并撤。
     放开时机由 JS 接管（data-panel-open），不用 :has——attribute 变更与补偿写入必须
     落在同一次样式重算里，:has 会让 scrollLeft 在 JS 读到旧值前就先归零 */
  &[data-panel-open='true'] {
    overflow: visible;
    mask-image: none;
    scroll-snap-type: none;
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
  /* snap 目标 = 每个项的起点（scroll-padding 把对齐线推到渐隐带外） */
  & > * {
    scroll-snap-align: start;
  }
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

  // 展开补偿（组件头注释「morph-select 展开的兼容」条目）：滚动容器放开裁剪的瞬间
  // scrollLeft 归零会右弹整行——读旧值、同批写入补偿与隐藏，收起时一并恢复。
  const panelOpenRef = useRef(false)
  const savedScrollRef = useRef(0)
  useEffect(() => {
    const root = rootRef.current
    const row = rowRef.current
    if (!root || !row) return

    const apply = (open: boolean) => {
      if (open === panelOpenRef.current) return
      panelOpenRef.current = open
      if (open) {
        const saved = root.scrollLeft // 此时裁剪仍在，scrollLeft 尚未归零
        savedScrollRef.current = saved
        row.style.marginLeft = saved > 0 ? `-${saved}px` : ''
        const win = [saved, saved + root.clientWidth]
        for (const item of Array.from(row.children) as HTMLElement[]) {
          // 滚出可视窗的项原本被裁剪不可见，放开后会漏出来叠到 +/-send 上，临时藏掉
          if (item.offsetLeft + item.offsetWidth < win[0] || item.offsetLeft > win[1]) {
            item.style.visibility = 'hidden'
          }
        }
        root.setAttribute('data-panel-open', 'true')
      } else {
        row.style.marginLeft = ''
        for (const item of Array.from(row.children) as HTMLElement[]) item.style.visibility = ''
        root.removeAttribute('data-panel-open')
        root.scrollLeft = savedScrollRef.current // overflow 回 auto 后恢复滚动位
      }
    }

    const observer = new MutationObserver(() => apply(!!root.querySelector('[role="combobox"][aria-expanded="true"]')))
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => {
      observer.disconnect()
      panelOpenRef.current = false
    }
  }, [])

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
