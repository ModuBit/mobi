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
import { QUOTE_MAX_COUNT, type ComposerSegments, type PendingQuoteRef } from '@/domain/chat/composerSegments'

interface UseComposerDraftState {
    text: string
    attachments: FileAttachment[]
    quotes: PendingQuoteRef[]
}

interface UseComposerDraftSetters {
    setText: (text: string) => void
    setAttachments: (attachments: FileAttachment[]) => void
    setQuotes: (quotes: PendingQuoteRef[]) => void
}

/**
 * 管理 composer 草稿的保存/恢复生命周期（P5 分段持久化：text + 附件双桶 + 引用）。
 *
 * - 挂载 / sessionId 变化：延迟一帧从草稿库恢复 text + 文件/图片/引用分段；
 *   文件引用还原为占位附件（不再上传），随后由 ChatComposer.segmentBuckets 经
 *   isImageFileAttachment 扩展名兜底重新分桶，与保存时的投影语义自洽
 * - 卸载 / sessionId 切走：把当前分段经 bucketCompletedAttachments 投影后存入旧 sessionId 草稿
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

    // 恢复完成守卫：rAF 内恢复完成后置 true；未完成即卸载则跳过保存
    const draftReadyRef = useRef(false)

    // setters 解构进 deps：当前各 setter 为稳定引用（useState setter），
    // effect 实际仅在 sessionId 变化时重跑；显式声明依赖避免未来 setter 变为不稳定时静默用过期闭包
    const { setText, setAttachments, setQuotes } = setters

    useEffect(() => {
        if (!sessionId) return
        const currentSessionId = sessionId

        // 延迟一帧恢复，避免与 Sender 受控组件渲染竞争（同 hapi）
        const frame = requestAnimationFrame(() => {
            const draft = getDraft(currentSessionId)
            if (draft) {
                if (draft.text) setText(draft.text)
                // 双桶合一还原为占位附件数组；分桶语义由渲染层派生时按扩展名兜底重建
                const refs = [...draft.files, ...draft.images]
                if (refs.length > 0) {
                    setAttachments(refs.map(fileRefToPlaceholderAttachment))
                }
                if (draft.quotes.length > 0) {
                    setQuotes(draft.quotes.slice(0, QUOTE_MAX_COUNT))
                }
            }
            draftReadyRef.current = true
        })

        return () => {
            cancelAnimationFrame(frame)
            // 仅在恢复已完成时保存，避免挂载即卸载的空态覆盖真实草稿。
            // 存储形态为完整分段：text + 完成附件双桶投影 + 引用
            if (draftReadyRef.current) {
                saveDraft(currentSessionId, {
                    text: textRef.current,
                    ...bucketCompletedAttachments(attachmentsRef.current),
                    quotes: quotesRef.current,
                } satisfies ComposerSegments)
            }
            draftReadyRef.current = false
        }
    }, [sessionId, setText, setAttachments, setQuotes])
}
