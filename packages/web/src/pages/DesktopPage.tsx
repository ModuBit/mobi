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
 * 远程桌面独立页（迭代 1 只读）。
 *
 * 画面经 DesktopStreamProvider 复用：本页只是展示面之一（与 inspector 的
 * desktop tab 竞争同一个 Provider 容器，DOM 搬迁连接不动）。页面自身仅负责
 * 选机器与引导；卸载 release 走引用计数 GC（归零 30s 宽限）。
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, Typography } from 'antd'
import { useMobiApi, extractApiError } from '@/core/data/api/client'
import { DesktopStreamSurface } from '@/components/desktop/DesktopStreamSurface'

type DesktopViewState =
    | { phase: 'idle' }
    | { phase: 'error'; message: string }

export function DesktopPage() {
    const { t } = useTranslation()
    const api = useMobiApi()
    const [machineId, setMachineId] = useState<string | null>(null)
    const [machines, setMachines] = useState<Array<{ id: string; label: string }>>([])
    const [viewState, setViewState] = useState<DesktopViewState>({ phase: 'idle' })

    // tracer 简化：拉一次在线机器列表（侧边栏列表与多机器管理在 ticket 06）
    useEffect(() => {
        let cancelled = false
        api.machines
            .list()
            .then(({ data }) => {
                if (cancelled) return
                const options = data.machines.map((m) => ({ id: m.id, label: m.id }))
                setMachines(options)
                const active = data.machines.find((m) => m.active)
                setMachineId((cur) => cur ?? active?.id ?? options[0]?.id ?? null)
            })
            .catch((error) => {
                if (!cancelled) setViewState({ phase: 'error', message: extractApiError(error) })
            })
        return () => {
            cancelled = true
        }
    }, [api])

    const surface = useMemo(() => (machineId ? <DesktopStreamSurface machineId={machineId} /> : null), [machineId])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                    {t('desktop.title')}
                </Typography.Title>
                <Select
                    size="small"
                    style={{ minWidth: 180 }}
                    value={machineId ?? undefined}
                    placeholder={t('desktop.noMachine')}
                    onChange={(id) => setMachineId(id)}
                    options={machines.map((m) => ({ value: m.id, label: m.label }))}
                />
            </div>
            <Typography.Text type="secondary">{t('desktop.viewOnlyHint')}</Typography.Text>

            {viewState.phase === 'error' && (
                <Typography.Text type="danger">{viewState.message}</Typography.Text>
            )}

            {/* 画面容器：DesktopStreamSurface 挂载即 acquire（连接与 inspector tab 共享） */}
            <div style={{ flex: 1, minHeight: 320, borderRadius: 8, overflow: 'hidden' }}>{surface}</div>
        </div>
    )
}
