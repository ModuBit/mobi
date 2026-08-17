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

import { useState } from 'react'
import { Button, Modal, Spin, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

/** dry-run 预检结果（hub POST /api/sessions/:id/rewind/dry-run 响应体） */
export type RewindDryRunResult = {
    canRewind: boolean
    canRestoreFiles: boolean
}

export interface RewindConfirmViewProps {
    /** dry-run 结果；null = 预检拉取中（移动 Drawer 内的 loading 态） */
    dryRun: RewindDryRunResult | null
    /** 执行中（POST 受理后等待 SSE rewind-completed 终态） */
    loading: boolean
    /** 确认执行；参数 = 是否恢复文件（降级形态恒为 false） */
    onConfirm: (restoreFiles: boolean) => void
    onCancel: () => void
}

/**
 * rewind 确认视图（共用组件，spec §5.5）：
 * PC 弹窗（RewindDialog）与移动端长按 Drawer（MessageActionsDrawer）两个薄入口共用。
 * 三形态（spec §5.3）：双 true 两选项 / canRestoreFiles false 单选项 + 说明 / canRewind false 不弹窗（入口层拦截）。
 */
export function RewindConfirmView({ dryRun, loading, onConfirm, onCancel }: RewindConfirmViewProps) {
    const { t } = useTranslation()
    // 已点选的选项（loading 态只给被点击的按钮转圈）
    const [chosen, setChosen] = useState<boolean | null>(null)

    if (!dryRun) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                <Spin />
            </div>
        )
    }

    const canRestore = dryRun.canRewind && dryRun.canRestoreFiles
    const handleConfirm = (restoreFiles: boolean) => {
        setChosen(restoreFiles)
        onConfirm(restoreFiles)
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canRestore ? (
                <>
                    <Button
                        block
                        type="primary"
                        loading={loading && chosen === true}
                        disabled={loading}
                        onClick={() => handleConfirm(true)}
                    >
                        {t('chat.rewind.restoreAndRewind')}
                    </Button>
                    <Button
                        block
                        loading={loading && chosen === false}
                        disabled={loading}
                        onClick={() => handleConfirm(false)}
                    >
                        {t('chat.rewind.rewindOnly')}
                    </Button>
                </>
            ) : (
                <>
                    <Button
                        block
                        type="primary"
                        loading={loading}
                        disabled={loading}
                        onClick={() => handleConfirm(false)}
                    >
                        {t('chat.rewind.rewindOnly')}
                    </Button>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('chat.rewind.filesUnavailable')}
                    </Typography.Text>
                </>
            )}
            <Button block type="text" disabled={loading} onClick={onCancel}>
                {t('common.cancel')}
            </Button>
        </div>
    )
}

export interface RewindDialogProps {
    open: boolean
    /** dry-run 结果（PC 入口在结果到达且 canRewind 后才打开，此处不为 null；保守起见仍容忍 null 显示 loading） */
    dryRun: RewindDryRunResult | null
    /** 执行中（POST 受理后等待 SSE 终态，期间关闭弹窗由 SSE 完成效应接管） */
    loading: boolean
    onConfirm: (restoreFiles: boolean) => void
    onCancel: () => void
}

/** rewind 确认弹窗：桌面居中 Modal / 移动端底部 Drawer（New Project 响应式先例） */
export function RewindDialog({ open, dryRun, loading, onConfirm, onCancel }: RewindDialogProps) {
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const confirmView = (
        <RewindConfirmView dryRun={dryRun} loading={loading} onConfirm={onConfirm} onCancel={onCancel} />
    )

    if (isMobile) {
        return (
            <MobileDrawer
                title={t('chat.rewind.title')}
                open={open}
                onClose={onCancel}
                maskClosable={!loading}
                destroyOnHidden
            >
                <div style={{ padding: 16, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
                    {confirmView}
                </div>
            </MobileDrawer>
        )
    }

    return (
        <Modal
            title={t('chat.rewind.title')}
            open={open}
            onCancel={onCancel}
            footer={null}
            maskClosable={!loading}
            destroyOnHidden
        >
            {confirmView}
        </Modal>
    )
}
