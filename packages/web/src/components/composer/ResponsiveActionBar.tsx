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

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Button, Dropdown, Divider, theme as antTheme } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import styled from '@emotion/styled'

export interface ActionItem {
  key: string
  render: () => ReactNode
  label?: ReactNode
}

export interface ResponsiveActionBarProps {
  items: ActionItem[]
  prefix?: ReactNode
  suffix?: ReactNode
  gap?: number
}

const MORE_BUTTON_WIDTH = 28

const DropdownItem = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
  display: flex;
  align-items: center;
  cursor: pointer;
  border-radius: ${props => props.$token.borderRadius}px;
  transition: background 0.2s;

  &:hover {
    background: ${props => props.$token.colorBgTextHover};
  }
`

/**
 * 响应式操作栏
 * 先将所有项渲染到隐藏测量层获取实际 DOM 宽度，再根据容器宽度决定可见项
 */
export function ResponsiveActionBar(props: ResponsiveActionBarProps) {
  const { items, prefix, suffix, gap = 4 } = props

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

  // 测量所有 item 的实际宽度
  useEffect(() => {
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

  const { token } = antTheme.useToken()

  const moreButton = useCallback(() => (
    <Button
      type="text"
      size="small"
      icon={<MoreOutlined />}
      style={{ borderRadius: '50%' }}
    />
  ), [])

  const dropdownContent = useMemo(() => {
    if (hiddenItems.length === 0) return null
    return (
      <div
        data-in-dropdown
        onMouseDown={e => e.stopPropagation()}
        style={{
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          padding: '4px 0',
        }}
      >
        {hiddenItems.map((item, index) => (
          <div key={item.key}>
            <DropdownItem
              $token={token}
              style={{ margin: '0 4px' }}
              onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.closest('button')) return
                const btn = e.currentTarget.querySelector('button')
                btn?.click()
              }}
            >
              <div style={{ padding: '4px 8px', minWidth: 140, width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
                {item.render()}
                {item.label && (
                  <span style={{ fontSize: 12, color: token.colorText }}>{item.label}</span>
                )}
              </div>
            </DropdownItem>
            {index < hiddenItems.length - 1 && (
              <Divider style={{ margin: '2px 12px', width: 'calc(100% - 24px)' }} />
            )}
          </div>
        ))}
      </div>
    )
  }, [hiddenItems, token])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      {/* 左侧：可见项 + 更多按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {visibleItems.map((item) => (
          <div key={item.key}>{item.render()}</div>
        ))}
        {hiddenItems.length > 0 && dropdownContent && (
          <Dropdown dropdownRender={() => dropdownContent} placement="topLeft">
            {moreButton()}
          </Dropdown>
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
    </div>
  )
}
