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
import { getDraft, saveDraft, type PersistedAttachment } from '@/core/lib/composerDrafts'
import type { FileAttachment } from '@/core/lib/fileAttachments'

interface UseComposerDraftState {
    text: string
    attachments: FileAttachment[]
}

interface UseComposerDraftSetters {
    setText: (text: string) => void
    setAttachments: (attachments: FileAttachment[]) => void
}

/**
 * 管理 composer 草稿的保存/恢复生命周期。
 *
 * - 挂载 / sessionId 变化：延迟一帧从草稿库恢复 text + 附件
 * - 卸载 / sessionId 切走：把当前 text + 附件保存到旧 sessionId 的草稿
 * - draftReady 守卫：恢复完成前不保存，避免初始空态覆盖真实草稿
 *
 * @param sessionId 当前会话 id；undefined 时跳过读写
 */
export function useComposerDraft(
    sessionId: string | undefined,
    state: UseComposerDraftState,
    setters: UseComposerDraftSetters,
): void {
    // 用 ref 镜像最新值，使卸载时的清理函数能读到最新 text/attachments（避免闭包陈旧）
    const textRef = useRef(state.text)
    textRef.current = state.text
    const attachmentsRef = useRef(state.attachments)
    attachmentsRef.current = state.attachments

    // 恢复完成守卫：rAF 内恢复完成后置 true；未完成即卸载则跳过保存
    const draftReadyRef = useRef(false)

    // setters 解构进 deps：当前 setText/setAttachments 为稳定引用（useState setter），
    // effect 实际仅在 sessionId 变化时重跑；显式声明依赖避免未来 setter 变为不稳定时静默用过期闭包
    const { setText, setAttachments } = setters

    useEffect(() => {
        if (!sessionId) return
        const currentSessionId = sessionId

        // 延迟一帧恢复，避免与 Sender 受控组件渲染竞争（同 hapi）
        const frame = requestAnimationFrame(() => {
            const draft = getDraft(currentSessionId)
            if (draft) {
                if (draft.text) setText(draft.text)
                if (draft.attachments.length > 0) {
                    const restored: FileAttachment[] = draft.attachments.map((a: PersistedAttachment) => ({
                        id: a.id,
                        // 占位 File：不再上传，仅供渲染层 name fallback
                        file: new File([], a.name),
                        status: 'complete' as const,
                        path: a.path,
                        name: a.name,
                        size: a.size,
                    }))
                    setAttachments(restored)
                }
            }
            draftReadyRef.current = true
        })

        return () => {
            cancelAnimationFrame(frame)
            // 仅在恢复已完成时保存，避免挂载即卸载的空态覆盖真实草稿
            if (draftReadyRef.current) {
                saveDraft(currentSessionId, textRef.current, attachmentsRef.current)
            }
            draftReadyRef.current = false
        }
    }, [sessionId, setText, setAttachments])
}
