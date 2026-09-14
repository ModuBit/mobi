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
 * 远程桌面的展示面（inspector tab 与 /desktop 独立页共用）。
 *
 * 挂载即 acquire Provider 的 lease 并把画面容器 DOM 搬迁进本组件的 host——
 * 切换展示面（tab ↔ 独立页）连接不动，只有容器搬家；卸载 release 走引用
 * 计数 GC（归零 30s 宽限）。容器尺寸变化经 ResizeObserver 通知 noVNC 重算缩放。
 * connecting/error 覆盖层仅在本面持有 lease 时展示（画面在哪个面，状态在哪个面）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Spin, Typography } from 'antd'
import { desktopStreamProvider, DESKTOP_STREAM_GRACE_MS, type DesktopStreamState } from '@/core/desktop/desktopStreamProvider'
import { describeDesktopFailure } from '@/core/desktop/desktopStreamClient'

interface DesktopStreamSurfaceProps {
    machineId: string
}

/** 已知归因 → 可理解文案；未知归因回退原始 reason */
function failureText(state: DesktopStreamState, t: (key: string) => string): string {
    if (!state.message) return t('desktop.disconnected')
    const key = describeDesktopFailure(state.message)
    return key ? t(key) : `${t('desktop.connectFailed')}: ${state.message}`
}

// 模块级稳定引用（useSyncExternalStore 的 subscribe 须稳定，否则无限循环——项目已知陷阱）
const subscribeStreamState = desktopStreamProvider.subscribe.bind(desktopStreamProvider)

export function DesktopStreamSurface({ machineId }: DesktopStreamSurfaceProps) {
    const { t } = useTranslation()
    const hostRef = useRef<HTMLDivElement | null>(null)
    const state = useSyncExternalStore(subscribeStreamState, () => desktopStreamProvider.getState(machineId))

    useEffect(() => {
        const lease = desktopStreamProvider.acquire(machineId)
        if (hostRef.current) {
            lease.attachTo(hostRef.current)
        }

        // 展示面尺寸变化（搬迁/分栏拖动/窗口缩放）通知 noVNC 重算 scaleViewport
        const observer = new ResizeObserver(() => {
            window.dispatchEvent(new Event('resize'))
        })
        if (hostRef.current) {
            observer.observe(hostRef.current)
        }
        return () => {
            observer.disconnect()
            lease.release()
        }
    }, [machineId])

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--mobi-color-bg-layout, #141414)' }}>
            {/* 画面容器：Provider 的 canvas 容器被搬迁进此节点（连接不动，只搬家） */}
            <div ref={hostRef} style={{ width: '100%', height: '100%' }} />

            {state.phase === 'connecting' && (
                <Overlay>
                    <Spin size="small" />
                    <Typography.Text type="secondary">{t('desktop.connecting')}</Typography.Text>
                </Overlay>
            )}
            {state.phase === 'error' && (
                <Overlay>
                    <Typography.Text type="danger">{failureText(state, t)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('desktop.surface.retryHint', { seconds: Math.round(DESKTOP_STREAM_GRACE_MS / 1000) })}
                    </Typography.Text>
                </Overlay>
            )}
        </div>
    )
}

function Overlay({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: 'var(--mobi-color-bg-layout, #141414)',
            }}
        >
            {children}
        </div>
    )
}
