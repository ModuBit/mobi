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

/**
 * 远程桌面观看页（迭代 1 只读）。
 *
 * 数据流：选在线机器 → desktop.watch 换 observe token → noVNC 连
 * /desktop/observe?token=（token 只在内存，不进 URL）。
 * 页面卸载/重连前必须 disconnect——noVNC 的连接对象终态永久，不可复用。
 * 多展示面共享链路（portal 跟随）与引用计数 GC 在后续迭代上提为 Provider。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spin, Button, Typography } from 'antd'
import { useMobiApi, extractApiError } from '@/core/data/api/client'
import { connectDesktopView, describeDesktopFailure, type DesktopViewConnection } from '@/core/desktop/desktopStreamClient'

type DesktopViewState =
    | { phase: 'idle' }
    | { phase: 'connecting' }
    | { phase: 'connected' }
    | { phase: 'error'; message: string }

export function DesktopPage() {
    const { t } = useTranslation()
    const api = useMobiApi()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const connectionRef = useRef<DesktopViewConnection | null>(null)
    const [machineId, setMachineId] = useState<string | null>(null)
    const [viewState, setViewState] = useState<DesktopViewState>({ phase: 'idle' })

    // 卸载兜底：noVNC 连接对象必须显式回收（canvas/WS 生命周期在其内部）
    useEffect(() => {
        return () => {
            connectionRef.current?.disconnect()
            connectionRef.current = null
        }
    }, [])

    const startWatch = useCallback(async () => {
        if (!machineId || !containerRef.current) {
            return
        }
        connectionRef.current?.disconnect()
        connectionRef.current = null
        setViewState({ phase: 'connecting' })

        try {
            const { data } = await api.desktop.watch(machineId)
            // watch 成功后 hub 侧会话短时效；token 只进内存与 WS URL（不进地址栏）
            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
            const wsUrl = `${proto}://${window.location.host}/desktop/observe?token=${encodeURIComponent(data.observeToken)}`
            const connection = await connectDesktopView({
                url: wsUrl,
                container: containerRef.current,
                callbacks: {
                    onConnect: () => setViewState({ phase: 'connected' }),
                    onDisconnect: ({ clean }) => {
                        if (!clean) {
                            setViewState({ phase: 'error', message: t('desktop.disconnected') })
                        }
                    },
                    // 认证失败走 securityfailure：已知归因映射为可理解文案，未知归因展示原始 reason
                    onFailure: (message) => {
                        const key = describeDesktopFailure(message)
                        setViewState({
                            phase: 'error',
                            message: key ? t(key) : `${t('desktop.connectFailed')}: ${message}`,
                        })
                    },
                },
            })
            connectionRef.current = connection
        } catch (error) {
            setViewState({ phase: 'error', message: extractApiError(error) })
        }
    }, [api, machineId, t])

    // tracer：取第一台在线机器（多机器选择/侧边栏列表在后续 ticket）
    useEffect(() => {
        let cancelled = false
        api.machines
            .list()
            .then(({ data }) => {
                if (cancelled) return
                const online = data.machines.find((m) => m.active) ?? null
                setMachineId(online?.id ?? null)
            })
            .catch(() => {
                if (!cancelled) setMachineId(null)
            })
        return () => {
            cancelled = true
        }
    }, [api])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 12 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                {t('desktop.title')}
            </Typography.Title>
            <Typography.Text type="secondary">{t('desktop.viewOnlyHint')}</Typography.Text>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {viewState.phase === 'connecting' && <Spin size="small" />}
                {viewState.phase === 'connected' && (
                    <Typography.Text type="success">{t('desktop.connected')}</Typography.Text>
                )}
                {viewState.phase === 'error' && (
                    <Typography.Text type="danger">{viewState.message}</Typography.Text>
                )}
                <Button
                    type="primary"
                    size="small"
                    disabled={!machineId || viewState.phase === 'connecting'}
                    onClick={() => void startWatch()}
                >
                    {viewState.phase === 'error' ? t('desktop.reconnect') : t('desktop.start')}
                </Button>
            </div>

            {!machineId && viewState.phase === 'idle' && (
                <Typography.Text type="warning">{t('desktop.noMachine')}</Typography.Text>
            )}

            {/* noVNC 会向容器注入 canvas；保持容器在 DOM 中由 noVNC 管理尺寸 */}
            <div
                ref={containerRef}
                style={{ flex: 1, minHeight: 320, background: 'var(--mobi-color-bg-layout, #141414)', borderRadius: 8, overflow: 'hidden' }}
            />
        </div>
    )
}
