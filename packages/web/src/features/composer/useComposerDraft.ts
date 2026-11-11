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

import { useEffect, useRef } from 'react'
import { getDraft, saveDraft } from '@/core/lib/composerDrafts'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { bucketCompletedAttachments, fileRefToPlaceholderAttachment } from '@/core/lib/fileAttachments'
import { QUOTE_MAX_COUNT, type PendingQuoteRef } from '@/domain/chat/composerSegments'

interface UseComposerDraftState {
    text: string
    attachments: FileAttachment[]
    quotes: PendingQuoteRef[]
    /** 结构化草稿读出（卸载保存时调）：返回 TipTap EditorState JSON，空/未就绪返回 null 则只存 text 单路 */
    getEditorState?: () => string | null
}

interface UseComposerDraftSetters {
    setText: (text: string) => void
    setAttachments: (attachments: FileAttachment[]) => void
    setQuotes: (quotes: PendingQuoteRef[]) => void
    /** 结构化草稿回填：解析失败由实现方静默 no-op（此时 setText 的文本兜底已生效） */
    applyEditorState?: (json: string) => void
}

/**
 * 管理 composer 草稿的保存/恢复生命周期（P5 分段持久化：text + 附件双桶 + 引用；
 * 结构化双路：editorState JSON 优先、纯文本兜底）。
 *
 * - 挂载 / sessionId 变化：延迟一帧从草稿库恢复 text + 文件/图片/引用分段；
 *   文件引用还原为占位附件（不再上传），随后由 ChatComposer.segmentBuckets 经
 *   isImageFileAttachment 扩展名兜底重新分桶，与保存时的投影语义自洽
 * - 结构化双路：draft.editorState 存在时先 setText（文本兜底）再 applyEditorState
 *   （成功即覆盖前者结果，无需探测成败——顺序保证终态正确；解析失败由实现方 no-op）
 * - 卸载 / sessionId 切走：把当前分段经 bucketCompletedAttachments 投影后存入旧 sessionId 草稿；
 *   同时经 getEditorState 读出结构化快照（含未来 chip 节点），一并持久化
 * - draftReady 守卫：恢复完成前不保存，避免初始空态覆盖真实草稿
 *
 * @param sessionId 当前会话 id；undefined 时跳过读写
 */
export function useComposerDraft(
    sessionId: string | undefined,
    state: UseComposerDraftState,
    setters: UseComposerDraftSetters,
): void {
    // 用 ref 镜像最新值，使卸载时的清理函数能读到最新 text/attachments/quotes（避免闭包陈旧）
    const textRef = useRef(state.text)
    textRef.current = state.text
    const attachmentsRef = useRef(state.attachments)
    attachmentsRef.current = state.attachments
    const quotesRef = useRef(state.quotes)
    quotesRef.current = state.quotes
    const getEditorStateRef = useRef(state.getEditorState)
    getEditorStateRef.current = state.getEditorState

    // 恢复完成守卫：rAF 内恢复完成后置 true；未完成即卸载则跳过保存
    const draftReadyRef = useRef(false)

    // setters 解构进 deps：当前各 setter 为稳定引用（useState setter），
    // effect 实际仅在 sessionId 变化时重跑；显式声明依赖避免未来 setter 变为不稳定时静默用过期闭包
    const { setText, setAttachments, setQuotes, applyEditorState } = setters

    useEffect(() => {
        if (!sessionId) return
        const currentSessionId = sessionId

        // 延迟一帧恢复，避免与 Sender 受控组件渲染竞争（同 hapi）
        const frame = requestAnimationFrame(() => {
            const draft = getDraft(currentSessionId)
            if (draft) {
                if (draft.text) setText(draft.text)
                // 结构化优先：text 已写入兜底，结构化恢复成功后覆盖（顺序即正确性）
                if (draft.editorState) applyEditorState?.(draft.editorState.json)
                // 双桶合一还原为占位附件数组；分桶语义由渲染层派生时按扩展名兜底重建
                const refs = [...draft.files, ...draft.images]
                if (refs.length > 0) {
                    setAttachments(refs.map(fileRefToPlaceholderAttachment))
                }
                if (draft.quotes.length > 0) {
                    // 结构化快照（含引用 chip 节点）存在时由它整体恢复，跳过 quotes 桶
                    // （保存侧同源，两路都跑会让 chip 双份）；旧格式草稿（无 editorState）
                    // 才走桶恢复，消费方实现为「逐条插入编辑器」
                    if (!draft.editorState) setQuotes(draft.quotes.slice(0, QUOTE_MAX_COUNT))
                }
            }
            draftReadyRef.current = true
        })

        return () => {
            cancelAnimationFrame(frame)
            // 仅在恢复已完成时保存，避免挂载即卸载的空态覆盖真实草稿。
            // 存储形态为完整分段：text + 完成附件双桶投影 + 引用 + 结构化快照（可选）
            if (draftReadyRef.current) {
                const editorStateJson = getEditorStateRef.current?.() ?? null
                saveDraft(currentSessionId, {
                    text: textRef.current,
                    ...bucketCompletedAttachments(attachmentsRef.current),
                    quotes: quotesRef.current,
                    ...(editorStateJson ? { editorState: { v: 1 as const, json: editorStateJson } } : {}),
                })
            }
            draftReadyRef.current = false
        }
    }, [sessionId, setText, setAttachments, setQuotes, applyEditorState])
}
