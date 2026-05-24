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
import type { RunningAgent } from '@/domain/chat/extractRunningAgents'

interface RunningAgentsState {
    agentsBySession: Map<string, RunningAgent[]>
    setAgents: (sessionId: string, agents: RunningAgent[]) => void
    clearSession: (sessionId: string) => void
}

export const useRunningAgentsStore = create<RunningAgentsState>((set) => ({
    agentsBySession: new Map(),

    setAgents: (sessionId, agents) =>
        set((state) => {
            const next = new Map(state.agentsBySession)
            next.set(sessionId, agents)
            return { agentsBySession: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            const next = new Map(state.agentsBySession)
            next.delete(sessionId)
            return { agentsBySession: next }
        }),
}))

// 空数组常量，避免每次 selector 返回新引用导致 React 19 无限渲染
const EMPTY_AGENTS: RunningAgent[] = []

export function useRunningAgents(sessionId: string): RunningAgent[] {
    return useRunningAgentsStore((state) => state.agentsBySession.get(sessionId) ?? EMPTY_AGENTS)
}
