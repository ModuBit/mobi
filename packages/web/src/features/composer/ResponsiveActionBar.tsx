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

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { Button } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import styled from '@emotion/styled'
import { DropdownMenu, type DropdownItem } from '@/ui/base/interactive/dropdown-menu/DropdownMenu'

export interface ActionItem {
  key: string
  render: () => ReactNode
  label?: ReactNode
}

export interface ResponsiveActionBarProps {
  items: ActionItem[]
  suffix?: ReactNode
  gap?: number
}

const MORE_BUTTON_WIDTH = 28

/**
 * 行里那件「能点开东西」的控件：按钮自身，或带 popup 语义的触发器——Radix 的 Trigger 是
 * button + aria-haspopup、antd Select 是 role=combobox（没有 button）。
 */
function rowControl(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('button, [aria-haspopup], [role="combobox"]')
}

/** 该控件自带弹层——决定外层面板能不能顺带关掉（见 onSelect 注释） */
function ownsPopup(control: HTMLElement | null): boolean {
  return !!control && (control.hasAttribute('aria-haspopup') || control.getAttribute('role') === 'combobox')
}

/**
 * 把行的点击代理给控件本身：**必须重放整条指针序列**，只 dispatch 一个 click 不够——
 * Radix 的触发器在 pointerdown 上开合、antd Select 在 mousedown 上开合，孤立的 click
 * 两者都不动（合成事件的 isTrusted=false 对自家监听器无差别，只影响浏览器默认行为）。
 * PointerEvent 在老内核/jsdom 可能缺构造器，退了便用 MouseEvent（监听器只看 type）。
 */
function replayPointerSequence(control: HTMLElement): void {
  const base = { bubbles: true, cancelable: true, composed: true, button: 0 } as const
  const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
  control.dispatchEvent(new Pointer('pointerdown', { ...base, buttons: 1 }))
  control.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1, detail: 1 }))
  control.dispatchEvent(new Pointer('pointerup', { ...base, buttons: 0 }))
  control.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0, detail: 1 }))
  control.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }))
}

const ActionBarContainer = styled.div`
  & *:not(.anticon):not(.anticon *) {
    font-size: 12px !important;
  }
`


/**
 * 响应式操作栏
 * 先将所有项渲染到隐藏测量层获取实际 DOM 宽度，再根据容器宽度决定可见项
 */
export function ResponsiveActionBar(props: ResponsiveActionBarProps) {
  const { items, suffix, gap = 4 } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const suffixRef = useRef<HTMLDivElement>(null)
  // 测量层：每个 item 的测量容器
  const measureRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const [containerWidth, setContainerWidth] = useState(0)
  // 记录每个 item 的实际 DOM 宽度
  const [measuredWidths, setMeasuredWidths] = useState<Map<string, number>>(new Map())

  // 监听容器宽度
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const lastKeysRef = useRef('')

  // 测量所有 item 的实际宽度，并清理已移除 item 的 ref
  // 使用 useLayoutEffect 无依赖数组，通过 key 列表追踪避免 parent 重建数组导致的无效测量
  useLayoutEffect(() => {
    const keys = items.map(i => i.key).join(',')
    // key 列表未变且所有 item 都已测量 → 跳过（parent 重建数组不会触发重复测量）
    if (keys === lastKeysRef.current && measuredWidths.size === items.length) return
    lastKeysRef.current = keys

    const validKeys = new Set(items.map(i => i.key))
    for (const key of measureRefs.current.keys()) {
      if (!validKeys.has(key)) measureRefs.current.delete(key)
    }

    const map = new Map<string, number>()
    let changed = false
    for (const item of items) {
      const el = measureRefs.current.get(item.key)
      if (el) {
        const w = el.getBoundingClientRect().width
        if (measuredWidths.get(item.key) !== w) changed = true
        map.set(item.key, w)
      }
    }
    if (changed) setMeasuredWidths(map)
  })

  const suffixWidth = suffixRef.current?.getBoundingClientRect().width ?? 0

  // 计算可见项数量
  const visibleCount = useMemo(() => {
    if (containerWidth === 0 || measuredWidths.size === 0) return items.length

    const available = containerWidth - suffixWidth - MORE_BUTTON_WIDTH - gap
    let total = 0
    let count = 0
    for (const item of items) {
      const w = measuredWidths.get(item.key) ?? 0
      const cost = count === 0 ? w : w + gap
      if (total + cost > available) break
      total += cost
      count++
    }
    return count
  }, [items, containerWidth, measuredWidths, suffixWidth, gap])

  const visibleItems = items.slice(0, visibleCount)
  const hiddenItems = items.slice(visibleCount)

  const { t } = useTranslation()

  const moreButton = useCallback(() => (
    <Button
      type="text"
      size="small"
      icon={<MoreOutlined />}
      aria-label={t('common.more')}
      style={{ borderRadius: '50%' }}
    />
  ), [t])

  /**
   * 溢出面板（承载用 registry 的 DropdownMenu，与全站菜单同一套弹层观感）。
   * 一项 = 「项按钮 + 文字」：动作长在 `item.render()` 返回的按钮自身（tooltip / onClick / 快捷键
   * 都在它上面），行点击代理到那个按钮——不在菜单项里再写一份动作，避免两处定义漂移。
   * 故 label 是既能点整行、又能点按钮本身的一团内容；分隔线走菜单自带的 separatorBefore。
   */
  // 点在项自带按钮上时，动作已由按钮自己跑过一遍，行点击代理不该再来一次（否则执行两遍：
  // 附件面板开了又关、终端建出两个）。Radix 2.x 的 onSelect 给的是它自己派发的 CustomEvent
  // （target 是菜单项元素，不带原始事件），拿不到 `e.target.closest('button')`，故在 document
  // 捕获阶段记下「最近这次交互是否落在按钮上」。记在 label 上不够——菜单项自身的内边距不在
  // label 子树里，那片点击会让判定过期成「是按钮」。键盘选中不产生 click，keydown 时一并刷新
  // （菜单项元素不是按钮 → 判否，照常走代理）。
  const hitInnerButton = useRef(false)
  useEffect(() => {
    const mark = (event: Event) => {
      const target = event.target
      hitInnerButton.current = target instanceof Element && target.closest('button') !== null
    }
    document.addEventListener('click', mark, true)
    document.addEventListener('keydown', mark, true)
    return () => {
      document.removeEventListener('click', mark, true)
      document.removeEventListener('keydown', mark, true)
    }
  }, [])

  const overflowItems: DropdownItem[] = useMemo(() => items.slice(visibleCount).map((item, index) => ({
    key: item.key,
    separatorBefore: index > 0,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        {item.render()}
        {item.label && <span>{item.label}</span>}
      </span>
    ),
    onSelect: (event) => {
      const row = event.target as HTMLElement | null
      const control = row ? rowControl(row) : null
      // 自带弹层的一行不能顺带关掉外层面板：行里那层弹层挂在行组件上（Radix Portal），
      // 外层一关它就跟着卸载，用户看到的是一闪而过。Radix 用 onSelect 事件的
      // preventDefault 表达「这一项选中后不关」（menu dist：defaultPrevented ? 保持 : onClose）。
      // 纯动作行照旧关。
      if (ownsPopup(control)) event.preventDefault()
      // 点在控件本身上：它自己已经处理过，代理再来一次会执行两遍
      if (hitInnerButton.current) return
      if (control) replayPointerSequence(control)
    },
  // 依赖 items/visibleCount 而非 hiddenItems：后者是 slice 出来的新数组，引用每次都变，memo 永不命中
  })), [items, visibleCount])

  return (
    <ActionBarContainer
      ref={containerRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      {/* 左侧：可见项 + 更多按钮。不设 overflow hidden：折叠测量在 useLayoutEffect（paint 前
          收口，不会有溢出帧），而裁剪会切掉 morph-select 内联向上生长的展开面板 */}
      <div style={{ display: 'flex', alignItems: 'center', gap, flexWrap: 'nowrap' }}>
        {visibleItems.map((item) => (
          <div key={item.key}>{item.render()}</div>
        ))}
        {hiddenItems.length > 0 && (
          <DropdownMenu trigger={moreButton()} items={overflowItems} side="top" align="start" />
        )}
      </div>

      {/* 右侧：suffix */}
      {suffix && (
        <div ref={suffixRef} data-role="suffix">
          {suffix}
        </div>
      )}

      {/* 隐藏测量层：渲染所有 item 获取真实宽度 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap,
          whiteSpace: 'nowrap',
          top: -9999,
          left: -9999,
        }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            ref={(el) => {
              if (el) measureRefs.current.set(item.key, el)
            }}
          >
            {item.render()}
          </div>
        ))}
      </div>
    </ActionBarContainer>
  )
}
