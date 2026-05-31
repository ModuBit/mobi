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
import { BrushCleaning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

export type ClearStateButtonProps = {
    sessionId: string
    clearField: 'todos' | 'tasks' | 'backgroundTasks' | 'teamState'
    onClear: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks' | 'teamState')[]) => Promise<void>
}

export function ClearStateButton({ sessionId, clearField, onClear }: ClearStateButtonProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [loading, setLoading] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [hovered, setHovered] = useState(false)

    const confirmText = t(`chat.clearState.${clearField}`)
    const doClear = useCallback(async () => {
        setLoading(true)
        try {
            await onClear(sessionId, [clearField])
        } finally {
            setLoading(false)
            setDrawerOpen(false)
        }
    }, [sessionId, clearField, onClear])

    const triggerStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: 4,
        border: 'none',
        background: hovered ? token.colorErrorBg : 'transparent',
        color: hovered ? token.colorError : token.colorTextQuaternary,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all 0.2s',
        padding: 0,
    }

    const trigger = (
        <button
            style={triggerStyle}
            onClick={(e) => { e.stopPropagation(); if (isMobile) setDrawerOpen(true) }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            type="button"
        >
            <BrushCleaning size={11} />
        </button>
    )

    if (isMobile) {
        return (
            <>
                {trigger}
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
            {trigger}
        </Popconfirm>
    )
}
