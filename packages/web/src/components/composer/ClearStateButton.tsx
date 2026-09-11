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
import { AppTooltip } from '@/components/ui/AppTooltip'
import { BrushCleaning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import type { ClearableRuntimeStateField } from '@mobi/shared/types'

/** 可清理的运行时状态字段：单源在 shared（CLEARABLE_RUNTIME_STATE_FIELDS），此处别名兼容既有引用 */
export type ClearRuntimeStateField = ClearableRuntimeStateField

export type ClearStateButtonProps = {
    sessionId: string
    /** 本次清理的字段集合（单字段面板传单项，运行中任务面板传前台 + 后台两类） */
    clearFields: ClearRuntimeStateField[]
    /** 组合清理的确认文案 key（多字段时语义不能由字段集合推断，由调用方声明）；缺省按单字段回退 */
    confirmKey?: string
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}

export function ClearStateButton({ sessionId, clearFields, confirmKey, onClear }: ClearStateButtonProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [loading, setLoading] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [hovered, setHovered] = useState(false)

    const confirmText = t(confirmKey ?? `chat.clearState.${clearFields[0]}`)
    const doClear = useCallback(async () => {
        setLoading(true)
        try {
            await onClear(sessionId, clearFields)
        } finally {
            setLoading(false)
            setDrawerOpen(false)
        }
    }, [sessionId, clearFields, onClear])

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
        <AppTooltip title={t('chat.clearState.label')} mouseEnterDelay={0.5}>
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
        </AppTooltip>
    )
}
