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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { DesktopStreamSurface } from '@/components/desktop/DesktopStreamSurface'

export function DesktopPage() {
    const { t } = useTranslation()
    const { machines, error: machinesError } = useMachines()
    // 单一事实源是 URL：侧边栏点击流直达 ?machine=A 始终生效（曾用 state 固化
    // `cur ?? route` 导致手选一次后所有直达失效）；Select 选择写回 URL，两种
    // 入口不再互相覆盖
    const routeMachineId = useSearch({ from: '/mainLayout/desktop' }).machine
    const navigate = useNavigate()
    // 无 URL 参数时的兜底（第一台在线机器）：落 state 钉住一次，防 machines
    // 列表重排让观看流在机器间跳变（切换即抢占旧流）
    const [fallbackMachineId, setFallbackMachineId] = useState<string | null>(null)
    useEffect(() => {
        setFallbackMachineId((cur) => cur ?? machines.find((m) => m.active)?.id ?? machines[0]?.id ?? null)
    }, [machines])

    const machineId = routeMachineId ?? fallbackMachineId

    const options = useMemo(
        () => machines.map((m) => ({ value: m.id, label: m.id })),
        [machines],
    )

    const surface = useMemo(() => (machineId ? <DesktopStreamSurface machineId={machineId} /> : null), [machineId])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                    {t('desktop.title')}
                </Typography.Title>
                <Select
                    size="small"
                    style={{ minWidth: 180 }}
                    value={machineId ?? undefined}
                    placeholder={t('desktop.noMachine')}
                    onChange={(id) => void navigate({ to: '/desktop', search: { machine: id } })}
                    options={options}
                />
            </div>
            <Typography.Text type="secondary">{t('desktop.viewOnlyHint')}</Typography.Text>

            {machinesError && (
                <Typography.Text type="danger">{machinesError}</Typography.Text>
            )}

            {/* 画面容器：DesktopStreamSurface 挂载即 acquire（连接与 inspector tab 共享） */}
            <div style={{ flex: 1, minHeight: 320, borderRadius: 8, overflow: 'hidden' }}>{surface}</div>
        </div>
    )
}
