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

import { useState, useCallback } from 'react'
import { Popconfirm, Drawer, Button, theme } from 'antd'
import { CloseCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

export type ClearStateButtonProps = {
    sessionId: string
    clearField: 'todos' | 'tasks' | 'backgroundTasks'
    onClear: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks')[]) => Promise<void>
}

export function ClearStateButton({ sessionId, clearField, onClear }: ClearStateButtonProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [loading, setLoading] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)

    const confirmKey = `chat.clearState.${clearField}` as const
    const confirmText = t(confirmKey)
    const doClear = useCallback(async () => {
        setLoading(true)
        try {
            await onClear(sessionId, [clearField])
        } finally {
            setLoading(false)
            setDrawerOpen(false)
        }
    }, [sessionId, clearField, onClear])

    if (isMobile) {
        return (
            <>
                <CloseCircleOutlined
                    style={{ fontSize: 12, color: token.colorTextQuaternary, cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); setDrawerOpen(true) }}
                />
                <Drawer
                    placement="bottom"
                    open={drawerOpen}
                    onClose={() => { if (!loading) setDrawerOpen(false) }}
                    closable={false}
                    styles={{ body: { padding: '8px 0' } }}
                >
                    <div style={{ padding: '12px 20px', fontSize: 14, color: token.colorTextSecondary }}>
                        {confirmText}
                    </div>
                    <Button
                        type="text"
                        block
                        danger
                        loading={loading}
                        style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                        onClick={doClear}
                    >
                        {t('chat.clearState.confirm')}
                    </Button>
                    <Button
                        type="text"
                        block
                        disabled={loading}
                        style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                        onClick={() => setDrawerOpen(false)}
                    >
                        {t('chat.clearState.cancel')}
                    </Button>
                </Drawer>
            </>
        )
    }

    return (
        <Popconfirm
            title={confirmText}
            onConfirm={doClear}
            okText={t('chat.clearState.confirm')}
            cancelText={t('chat.clearState.cancel')}
            okButtonProps={{ danger: true, loading }}
            onCancel={(e) => e?.stopPropagation()}
        >
            <CloseCircleOutlined
                style={{ fontSize: 12, color: token.colorTextQuaternary, cursor: 'pointer' }}
                onClick={(e) => e.stopPropagation()}
            />
        </Popconfirm>
    )
}
