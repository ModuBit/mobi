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

import { Copy, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { RewindConfirmView, type RewindDryRunResult } from './RewindConfirmView'
import { copyTextToClipboard } from './CopyButton'

/** 长按选中的用户消息（canRewind 与 PC footer 判据同源——canRewindMessage） */
export interface MessageActionTarget {
    /** bubble item key（定位用） */
    key: string
    /** 消息原文（复制用） */
    text: string
    /** rewind 锚点（null = 不可回退） */
    nativeId: string | null
    /** rewind 判据结果 */
    canRewind: boolean
}

export interface MessageActionsDrawerProps {
    open: boolean
    /** 长按选中的消息（open 时非 null） */
    target: MessageActionTarget | null
    /** rewind 确认视图激活（点「回退并编辑」后同 Drawer 切换内容，spec §5.2） */
    rewindActive: boolean
    /** dry-run 结果；null = 预检拉取中 */
    dryRun: RewindDryRunResult | null
    /** 执行中（POST 受理后等 SSE 终态） */
    loading: boolean
    onClose: () => void
    /** 点「回退并编辑」→ 父组件发起 dry-run（dryRun/draft 状态由父持有） */
    onRewind: (nativeId: string) => void
    /** 确认执行（透传 RewindConfirmView） */
    onConfirmRewind: (restoreFiles: boolean) => void
    /** 取消 rewind（回到菜单态或关闭） */
    onCancelRewind: () => void
}

/** 菜单行：全宽可点（图标 + 文案），触控友好的最小高度 */
function MenuRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                minHeight: 48, padding: '0 20px',
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 15, color: 'var(--ant-color-text)',
                textAlign: 'left',
            }}
        >
            <span style={{ fontSize: 16, color: 'var(--ant-color-text-secondary)', display: 'inline-flex' }}>{icon}</span>
            {label}
        </button>
    )
}

/**
 * 移动端消息长按操作菜单（spec §5.2）：底部 Drawer，可扩展（后续引用等操作加行即可）。
 * 复制始终可用；「回退并编辑」按判据显隐；点回退后同一 Drawer 内容切换为确认视图
 * （RewindConfirmView 与 PC 弹窗共用，spec §5.5）。
 */
export function MessageActionsDrawer({
    open, target, rewindActive, dryRun, loading,
    onClose, onRewind, onConfirmRewind, onCancelRewind,
}: MessageActionsDrawerProps) {
    const { t } = useTranslation()

    const handleCopy = async () => {
        if (!target) return
        await copyTextToClipboard(target.text)
        onClose()
    }

    return (
        <MobileDrawer
            title={rewindActive ? t('chat.rewind.title') : undefined}
            open={open}
            onClose={loading ? () => { /* 执行中不允许手势关闭，等 SSE 终态统一收尾 */ } : onClose}
            maskClosable={!loading}
            destroyOnHidden
        >
            <div style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
                {/* 合并一层：复制始终可用；「回退并编辑」点击后隐藏，确认视图就地展开在下方，
                    不再整页切换（spec §5.2） */}
                <nav role="menu" aria-label={t('chat.rewind.title')}>
                    <MenuRow
                        icon={<Copy size={16} />}
                        label={t('chat.copy')}
                        onClick={() => { void handleCopy() }}
                    />
                    {target?.canRewind && target.nativeId && !rewindActive && (
                        <MenuRow
                            icon={<Undo2 size={16} />}
                            label={t('chat.rewind.title')}
                            onClick={() => onRewind(target.nativeId!)}
                        />
                    )}
                </nav>
                {rewindActive && (
                    <div style={{ padding: 16, borderTop: '1px solid var(--ant-color-border-secondary)' }}>
                        <RewindConfirmView targetText={target?.text ?? null} dryRun={dryRun} loading={loading} onConfirm={onConfirmRewind} onCancel={onCancelRewind} />
                    </div>
                )}
            </div>
        </MobileDrawer>
    )
}
