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
import { useSearch } from '@tanstack/react-router'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { DesktopStreamSurface } from '@/components/desktop/DesktopStreamSurface'

export function DesktopPage() {
    const { t } = useTranslation()
    const { machines, error: machinesError } = useMachines()
    // 侧边栏点击流进入时经 ?machine= 直达该机器（router validateSearch 已归一化）；无参数走在线机器兜底
    const routeMachineId = useSearch({ from: '/mainLayout/desktop' }).machine
    const [machineId, setMachineId] = useState<string | null>(routeMachineId ?? null)

    useEffect(() => {
        setMachineId((cur) => cur ?? routeMachineId ?? null)
    }, [routeMachineId])

    // 无 URL 参数时兜底选第一台在线机器
    useEffect(() => {
        setMachineId((cur) => cur ?? machines.find((m) => m.active)?.id ?? machines[0]?.id ?? null)
    }, [machines])

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
                    onChange={(id) => setMachineId(id)}
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
