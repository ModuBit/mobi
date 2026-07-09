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

import { useState, useRef, type KeyboardEvent } from 'react'
import { Input } from 'antd'
import { Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InspectorTabEntry } from '@/core/data/stores/workspaceStore'

interface TerminalTabLabelProps {
    tab: InspectorTabEntry
    onRename: (title: string) => void
}

/**
 * 终端 tab 的标签：lucide Terminal 图标 + 显示名。
 * 显示名 = tab.title ?? t('terminalName', { n: terminalSeq })（默认「终端 N」）。
 * 双击进入编辑态（Input），回车/失焦确认调 onRename，Esc 取消。
 */
export function TerminalTabLabel({ tab, onRename }: TerminalTabLabelProps) {
    const { t } = useTranslation()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    // 编辑是否仍有效：commit/cancel 置 false，防止 Input 卸载时 onBlur 再次触发 commit
    // （Esc 取消后若 blur 先于卸载触发，会误提交）
    const activeRef = useRef(false)

    const display = tab.title ?? t('session.inspector.terminalName', { n: tab.terminalSeq ?? 1 })

    const startEdit = () => {
        activeRef.current = true
        setDraft(display)
        setEditing(true)
    }
    const commit = () => {
        if (!activeRef.current) return
        activeRef.current = false
        setEditing(false)
        // 无变化（含默认名 tab 未改动）则不触发 rename：
        // 否则默认名 tab（title=undefined）会被写入 title="终端 1"，
        // 永久失去 i18n 语言切换时的本地化回退（title 语义被污染）
        if (draft.trim() === display.trim()) return
        onRename(draft)
    }
    const cancel = () => {
        activeRef.current = false
        setEditing(false)
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') cancel()
    }

    if (editing) {
        return (
            <Input
                size="small"
                autoFocus
                value={draft}
                placeholder={t('session.inspector.terminalRenamePlaceholder')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={commit}
                style={{ width: 120 }}
            />
        )
    }
    return (
        <span
            onDoubleClick={startEdit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
        >
            <TerminalIcon size={14} />
            {display}
        </span>
    )
}
