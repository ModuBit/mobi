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

import { useEffect, useRef } from 'react'
import { Button, Typography, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ReloadOutlined } from '@ant-design/icons'
import '@xterm/xterm/css/xterm.css'
import { useCachedInstance } from '@/core/hooks/useCachedInstance'
import {
    createCachedTerminal,
    disposeCachedTerminal,
    type CachedTerminal,
} from '@/components/terminal/cachedTerminal'

const { Text } = Typography
const { useToken } = antTheme

interface TerminalViewProps {
    sessionId: string
}

export default function TerminalView({ sessionId }: TerminalViewProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const containerRef = useRef<HTMLDivElement>(null)
    const attachedRef = useRef(false)

    const cacheKey = `terminal:${sessionId}`

    const { instance } = useCachedInstance<CachedTerminal>(
        cacheKey,
        () =>
            createCachedTerminal({
                sessionId,
            }),
        disposeCachedTerminal,
    )

    // attach 缓存的 domNode 到可见容器
    useEffect(() => {
        if (!instance || !containerRef.current || attachedRef.current) return
        containerRef.current.appendChild(instance.domNode)
        attachedRef.current = true
        try {
            instance.fitAddon.fit()
        } catch {
            // 容器宽度为 0 时 fit 抛错，忽略
        }
    }, [instance])

    // 监听可见容器尺寸变化 → fit（宽度 0 时跳过）
    useEffect(() => {
        if (!containerRef.current || !instance) return
        const el = containerRef.current
        const ro = new ResizeObserver(() => {
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                try {
                    instance.fitAddon.fit()
                } catch {
                    // 忽略
                }
            }
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [instance])

    const handleReconnect = () => {
        instance?.reconnect()
    }

    // 组件卸载：移除 domNode（保留实例，不发 terminal:close，进程常驻）
    useEffect(() => {
        return () => {
            if (instance && instance.domNode.parentElement) {
                instance.domNode.parentElement.removeChild(instance.domNode)
            }
            attachedRef.current = false
        }
    }, [instance])

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
                style={{
                    padding: '8px 16px',
                    borderBottom: `1px solid ${token.colorBorder}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: token.colorBgLayout,
                }}
            >
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('terminal.title')} {sessionId.slice(0, 8)}
                </Text>
                <Button icon={<ReloadOutlined />} size="small" onClick={handleReconnect}>
                    {t('terminal.reconnect')}
                </Button>
            </div>
            <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
        </div>
    )
}
