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

import { create } from 'zustand'
import type { ChatBlocksById } from '@/domain/chat/reconcile'

interface ChatBlocksByIdState {
    byIdBySession: Map<string, ChatBlocksById>
    setById: (sessionId: string, byId: ChatBlocksById) => void
    clearSession: (sessionId: string) => void
}

export const useChatBlocksByIdStore = create<ChatBlocksByIdState>((set) => ({
    byIdBySession: new Map(),

    setById: (sessionId, byId) =>
        set((state) => {
            const next = new Map(state.byIdBySession)
            next.set(sessionId, byId)
            return { byIdBySession: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            const next = new Map(state.byIdBySession)
            next.delete(sessionId)
            return { byIdBySession: next }
        }),
}))

const EMPTY_BY_ID: ChatBlocksById = new Map()

export function useChatBlocksById(sessionId: string): ChatBlocksById {
    return useChatBlocksByIdStore((state) => state.byIdBySession.get(sessionId) ?? EMPTY_BY_ID)
}
