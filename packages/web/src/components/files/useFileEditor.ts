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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSaveFile } from '@/core/data/hooks/mutations/useSaveFile'
import { queryKeys } from '@/core/lib/query-keys'
import { AUTOSAVE_DEBOUNCE_MS } from '@/core/config/editConfig'

export interface FileEditorState {
    /** 当前编辑内容（draft 为 null 时回退到 baseText，即磁盘原文） */
    draft: string
    dirty: boolean
    saving: boolean
    /** OCC 冲突（保存返回 409）；null 表示无冲突 */
    conflict: { currentEtag: string } | null
    /** 更新草稿（编辑器 onChange），触发 debounce 自动保存 */
    update: (text: string) => void
    /** 立即保存（手动 Ctrl/Cmd+S / 关 tab flush）。返回是否成功（无冲突） */
    saveNow: () => Promise<{ ok: boolean }>
    /** 强制覆盖（冲突后用户选「强制覆盖」），跳过 OCC */
    forceOverwrite: () => Promise<void>
    /** 丢弃本地修改（冲突后用户选「重新加载」，配合外部按 currentEtag 重拉 content） */
    reload: () => void
}

/**
 * 文件编辑状态机：draft 跟踪 + debounce 3s 自动保存 + etag OCC 冲突处理。
 *
 * **闭包陷阱规避**：draft/baseEtag 同时用 ref 持有，doSave 从 ref 读最新值。
 * 否则 `update` 里 setTimeout 回调捕获的 doSave 闭包会持有 stale draft
 * （setDraft 异步 re-render，update 调用那一刻的 draft 是旧值），
 * 导致 debounce 自动保存读到"倒数第二次输入"甚至不保存。
 */
export function useFileEditor(
    sessionId: string,
    filePath: string,
    initial: { text: string; etag: string },
): FileEditorState {
    const [baseText, setBaseText] = useState(initial.text)
    const [draft, setDraft] = useState<string | null>(null)
    const [conflict, setConflict] = useState<{ currentEtag: string } | null>(null)
    const [saving, setSaving] = useState(false)

    // refs：让 setTimeout / useCallback 闭包读到最新值，规避闭包陷阱
    const draftRef = useRef<string | null>(null)
    const baseEtagRef = useRef(initial.etag)

    const qc = useQueryClient()
    const { mutateAsync: saveAsync } = useSaveFile(sessionId)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 同步 draft state + ref
    const setDraftSync = useCallback((v: string | null) => {
        draftRef.current = v
        setDraft(v)
    }, [])

    // 文件切换 / etag 变化 → 重置（重新加载磁盘版本）
    useEffect(() => {
        baseEtagRef.current = initial.etag
        setBaseText(initial.text)
        setDraftSync(null)
        setConflict(null)
    }, [filePath, initial.etag])

    const dirty = draft !== null && draft !== baseText

    const doSave = useCallback(async (force: boolean): Promise<{ ok: boolean }> => {
        const curDraft = draftRef.current
        if (curDraft === null) return { ok: true }
        setSaving(true)
        setConflict(null)
        try {
            const r = await saveAsync({
                path: filePath,
                content: new TextEncoder().encode(curDraft),
                baseEtag: baseEtagRef.current,
                force,
            })
            if (r.conflict) {
                setConflict({ currentEtag: r.currentEtag ?? '' })
                return { ok: false }
            }
            if (r.error) return { ok: false }
            // 成功：推进 baseEtag/baseText，清 draft
            if (r.etag) baseEtagRef.current = r.etag
            setBaseText(curDraft)
            setDraftSync(null)
            // invalidate 触发 meta refetch（fire-and-forget；draft 已推进，
            // refetch 内容与 baseText 一致 → 编辑器 text 不变 → 不触发重置）
            void qc.invalidateQueries({ queryKey: queryKeys.sessionFileMeta(sessionId, filePath) })
            return { ok: true }
        } finally {
            setSaving(false)
        }
    }, [saveAsync, filePath, qc, sessionId, setDraftSync])

    const update = useCallback((text: string) => {
        setConflict(null)
        setDraftSync(text)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { void doSave(false) }, AUTOSAVE_DEBOUNCE_MS)
    }, [doSave, setDraftSync])

    const saveNow = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null }
        return doSave(false)
    }, [doSave])

    const forceOverwrite = useCallback(async () => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null }
        await doSave(true)
    }, [doSave])

    const reload = useCallback(() => {
        setDraftSync(null)
        setConflict(null)
    }, [setDraftSync])

    // 卸载清定时器
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

    return {
        draft: draft ?? baseText,
        dirty,
        saving,
        conflict,
        update,
        saveNow,
        forceOverwrite,
        reload,
    }
}
