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
 * 远程桌面设置分区：VNC 密码配置向导。
 *
 * 两步引导——① 去 macOS 系统设置开启屏幕共享并勾选「VNC 观看者可以用密码控制屏幕」；
 * ② 在表单录入同一个密码（经 hub RPC 中转，落 cli 侧 settings；hub/web 不存副本）。
 * 状态只显示「是否已配置」，密码不可回读。
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Input, Typography, App as AntdApp } from 'antd'
import { useMobiApi, extractApiError } from '@/core/data/api/client'
import { useMachines } from '@/core/data/hooks/queries/useMachines'

export function DesktopSection() {
    const { t } = useTranslation()
    const { message } = AntdApp.useApp()
    const api = useMobiApi()
    const { machines } = useMachines()
    // tracer：取第一台在线机器（多机器选择随侧边栏列表 ticket）
    const machineId = machines.find((m) => m.active)?.id ?? null
    const [configured, setConfigured] = useState<boolean | null>(null)
    const [password, setPassword] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refreshStatus = useCallback(async () => {
        if (!machineId) return
        try {
            const { data } = await api.desktop.vncStatus(machineId)
            setConfigured(data.configured)
        } catch {
            setConfigured(null)
        }
    }, [api, machineId])

    useEffect(() => {
        void refreshStatus()
    }, [refreshStatus])

    const submit = useCallback(async () => {
        if (!machineId || !password) return
        setSaving(true)
        setError(null)
        try {
            await api.desktop.setVncPassword(machineId, password)
            setPassword('')
            setConfigured(true)
            message.success(t('desktop.settings.saved'))
        } catch (err) {
            setError(extractApiError(err))
        } finally {
            setSaving(false)
        }
    }, [api, machineId, password, message, t])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                {t('desktop.settings.title')}
            </Typography.Title>

            <Alert
                type="info"
                showIcon
                message={t('desktop.settings.guideTitle')}
                description={
                    <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <li>{t('desktop.settings.guideStep1')}</li>
                        <li>{t('desktop.settings.guideStep2')}</li>
                    </ol>
                }
            />

            {configured !== null && (
                <Typography.Text type={configured ? 'success' : 'warning'}>
                    {configured ? t('desktop.settings.configured') : t('desktop.settings.notConfigured')}
                </Typography.Text>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
                <Input.Password
                    data-testid="desktop-vnc-password"
                    value={password}
                    maxLength={16}
                    placeholder={t('desktop.settings.passwordPlaceholder')}
                    onChange={(e) => setPassword(e.target.value)}
                    onPressEnter={() => void submit()}
                />
                <Button
                    type="primary"
                    loading={saving}
                    disabled={!machineId || !password}
                    onClick={() => void submit()}
                >
                    {t('desktop.settings.save')}
                </Button>
            </div>

            {error && <Typography.Text type="danger">{error}</Typography.Text>}

            <Typography.Text type="secondary">{t('desktop.settings.privacyNote')}</Typography.Text>
        </div>
    )
}
