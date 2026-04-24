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
  width: number
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
 * 根据容器宽度自动折叠溢出的操作项到 Dropdown 中
 */
export function ResponsiveActionBar(props: ResponsiveActionBarProps) {
  const { items, prefix, suffix, gap = 4 } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const prefixRef = useRef<HTMLDivElement>(null)
  const suffixRef = useRef<HTMLDivElement>(null)

  const [containerWidth, setContainerWidth] = useState(0)

  // 用 ResizeObserver 监听容器宽度变化
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

  // 测量 prefix 和 suffix 的实际 DOM 宽度
  const prefixWidth = prefixRef.current?.getBoundingClientRect().width ?? 0
  const suffixWidth = suffixRef.current?.getBoundingClientRect().width ?? 0

  // 计算可用宽度
  const availableWidth = useMemo(() => {
    if (containerWidth === 0) return 0
    return containerWidth - prefixWidth - suffixWidth - MORE_BUTTON_WIDTH - gap
  }, [containerWidth, prefixWidth, suffixWidth, gap])

  // 从左到右累加 items 的 width + gap，超出时停止
  // 初始 containerWidth=0 时返回全部，避免首帧跳动
  const visibleCount = useMemo(() => {
    if (availableWidth <= 0) return items.length

    let total = 0
    let count = 0
    for (const item of items) {
      const itemWidth = count === 0 ? item.width : item.width + gap
      if (total + itemWidth > availableWidth) break
      total += itemWidth
      count++
    }
    return count
  }, [items, availableWidth, gap])

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
                  <span style={{ fontSize: 13, color: token.colorText }}>{item.label}</span>
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
      {/* 左侧：prefix + 可见项 + 更多按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap }}>
        {prefix && (
          <div ref={prefixRef} data-role="prefix">
            {prefix}
          </div>
        )}

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
    </div>
  )
}
